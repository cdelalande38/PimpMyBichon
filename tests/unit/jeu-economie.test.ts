// Économie du jeu : gains d'une course, hauts faits, clôture, achat, lecture tolérante et fusion entre pages.
import { describe, expect, it } from 'vitest';
import { A_VENDRE, ARTICLES, PACKS, TROPHEES, articleParId } from '../../src/data/boutique.ts';
import { ECONOMIE } from '../../src/data/economie.ts';
import { CHAMPS, HAUTS_FAITS, type HautFaitDef } from '../../src/data/hautsFaits.ts';
import { acheterDans, possedeDans } from '../../src/jeu/achats.ts';
import { accorder, ajouterCourse, cloturer, verifierCumuls, type ReglesCloture } from '../../src/jeu/cloture.ts';
import type { ResultatCourse } from '../../src/jeu/contrat.ts';
import { cumulsVides, etatVide, nettoyerEtat, type EtatJeu } from '../../src/jeu/etat.ts';
import { calculerGains, recordBattu } from '../../src/jeu/gains.ts';
import { progression, testTient } from '../../src/jeu/hautsFaits.ts';
import { mergeChanges, type Json } from '../../src/state/persistence.ts';
import { dollars, gain, kilometres, pluriel } from '../../src/ui/jeu/libelles.ts';

function course(partiel: Omit<Partial<ResultatCourse>, 'stats'> & { stats?: Partial<ResultatCourse['stats']> } = {}): ResultatCourse {
  const { stats, ...reste } = partiel;
  return {
    carte: 'carte-a',
    depart: 'depart-a',
    vehicule: 'vehicule-a',
    format: 'tour1',
    meteo: 'sec',
    moment: 'nuit',
    temps: 95,
    tours: [95],
    ancienRecord: null,
    medaille: null,
    stats: { distance: 3000, vitesseMax: 100, glisse: 0, chocs: 2, nos: 0, ...stats },
    ...reste,
  };
}

/** Règles sans la boutique réelle : les tests de clôture ne dépendent pas du catalogue de cartes. */
const REGLES: ReglesCloture = { defs: HAUTS_FAITS, nbCartes: 4, article: articleParId };

describe('gains d’une course', () => {
  it('une course finie avec des chocs ne rapporte que sa base, avec son motif en clair', () => {
    const g = calculerGains(course());
    expect(g.dollars).toBe(ECONOMIE.tour1.base);
    expect(g.detail).toEqual([{ motif: 'Course d’un tour finie', dollars: 40 }]);
  });

  it('chaque ligne a son motif et la somme est celle des lignes', () => {
    const g = calculerGains(course({ medaille: 'or', ancienRecord: 120, meteo: 'neige', stats: { chocs: 0 } }));
    expect(g.detail.map((l) => l.motif)).toEqual(['Course d’un tour finie', 'Médaille d’or', 'Record battu', 'Aucun choc contre le bord de la route', 'Course sous la neige']);
    expect(g.detail.map((l) => l.dollars)).toEqual([40, 60, 25, 20, 20]);
    expect(g.dollars).toBe(165);
    expect(g.dollars).toBe(g.detail.reduce((s, l) => s + l.dollars, 0));
    for (const ligne of g.detail) expect(ligne.motif.length).toBeGreaterThan(5);
  });

  it('un bonus par médaille, croissant du bronze à l’or, dans chaque format', () => {
    for (const bareme of Object.values(ECONOMIE)) {
      expect(bareme.medaille.bronze).toBeLessThan(bareme.medaille.argent);
      expect(bareme.medaille.argent).toBeLessThan(bareme.medaille.or);
      expect(bareme.meteo.sec).toBe(0);
      expect(bareme.meteo.pluie).toBeLessThan(bareme.meteo.neige);
    }
    const pluie = calculerGains(course({ meteo: 'pluie', medaille: 'bronze' }));
    expect(pluie.dollars).toBe(40 + 15 + 10);
  });

  it('trois tours paient plus qu’un tour, ligne par ligne', () => {
    const un = calculerGains(course({ medaille: 'or', stats: { chocs: 0 } }));
    const trois = calculerGains(course({ format: 'tours3', tours: [90, 90, 90], temps: 270, medaille: 'or', stats: { chocs: 0 } }));
    expect(trois.dollars).toBeGreaterThan(un.dollars);
    expect(trois.detail[0]?.motif).toBe('Course de trois tours finie');
  });

  it('le record ne se bat que s’il y en avait un, et strictement', () => {
    expect(recordBattu(course({ ancienRecord: null }))).toBe(false);
    expect(recordBattu(course({ ancienRecord: 95 }))).toBe(false);
    expect(recordBattu(course({ ancienRecord: 96 }))).toBe(true);
    expect(calculerGains(course({ ancienRecord: null })).detail.some((l) => l.motif === 'Record battu')).toBe(false);
  });

  it('un format inconnu ne rapporte rien', () => {
    expect(calculerGains(course(), {}).dollars).toBe(0);
  });
});

describe('prix et rythme', () => {
  it('un pack coûte quelques courses : 2 à 4 pour le premier, 4 à 7 pour le deuxième, 6 à 11 pour le dernier', () => {
    // Course de référence : un tour, sans choc, médaille de bronze, sec.
    const typique = calculerGains(course({ medaille: 'bronze', stats: { chocs: 0 } })).dollars;
    expect(typique).toBe(75);
    const nb = (id: string) => Math.ceil((articleParId(id)?.prix ?? 0) / typique);
    expect(nb('pack-flammes')).toBe(2);
    expect(nb('pack-course')).toBe(4);
    expect(nb('pack-atelier')).toBe(7);
    // Sans médaille ni propreté (40 $), le premier pack reste à portée de quatre courses.
    expect(Math.ceil((articleParId('pack-flammes')?.prix ?? 0) / ECONOMIE.tour1.base)).toBeLessThanOrEqual(4);
  });

  it('le pack de départ est offert, les trois autres s’achètent, les trophées ne s’achètent pas', () => {
    expect(articleParId('pack-depart')).toMatchObject({ prix: 0, offert: true });
    expect(A_VENDRE.filter((a) => a.famille === 'pack').map((a) => a.id)).toEqual(['pack-flammes', 'pack-course', 'pack-atelier']);
    for (const trophee of TROPHEES) {
      expect(trophee.prix).toBeNull();
      expect(trophee.famille).toBe('sticker');
      expect(trophee.id).toMatch(/^sticker-/);
    }
    for (const pack of PACKS) expect(pack.id).toMatch(/^pack-/);
  });

  it('chaque article a un identifiant unique, un nom et une phrase', () => {
    expect(new Set(ARTICLES.map((a) => a.id)).size).toBe(ARTICLES.length);
    for (const a of ARTICLES) {
      expect(a.label.length).toBeGreaterThan(3);
      expect(a.description.length).toBeGreaterThan(10);
    }
  });
});

describe('données des hauts faits', () => {
  it('au moins vingt, aux identifiants uniques, textes courts et tutoyés', () => {
    expect(HAUTS_FAITS.length).toBeGreaterThanOrEqual(20);
    expect(new Set(HAUTS_FAITS.map((h) => h.id)).size).toBe(HAUTS_FAITS.length);
    for (const h of HAUTS_FAITS) {
      expect(h.label.length, h.id).toBeLessThanOrEqual(40);
      expect(h.description.length, h.id).toBeLessThanOrEqual(90);
      expect(h.description, h.id).toMatch(/\.$/);
      expect(h.quand.length, h.id).toBeGreaterThan(0);
      for (const test of h.quand) expect(CHAMPS, h.id).toContain(test.champ);
      const r = h.recompense;
      expect((r.dollars ?? 0) > 0 || (r.articles?.length ?? 0) > 0, h.id).toBe(true);
    }
  });

  it('les articles offerts existent à la boutique et se gagnent, sans s’acheter ; chaque trophée a un haut fait, un seul', () => {
    for (const h of HAUTS_FAITS) {
      for (const id of h.recompense.articles ?? []) expect(articleParId(id)?.prix, `${h.id} → ${id}`).toBeNull();
    }
    for (const trophee of TROPHEES) {
      const donneurs = HAUTS_FAITS.filter((h) => h.recompense.articles?.includes(trophee.id));
      expect(donneurs.length, trophee.id).toBe(1);
    }
    expect(TROPHEES.length).toBeGreaterThanOrEqual(6);
  });

  it('aucune carte ni aucun véhicule codé en dur dans les données', () => {
    const texte = JSON.stringify(HAUTS_FAITS);
    expect(texte).not.toMatch(/plateau|monaco|miami|cox|van\b|moto/i);
  });

  it('les récompenses en dollars ne font pas exploser l’économie : moins de 3 000 $ en tout', () => {
    const total = HAUTS_FAITS.reduce((s, h) => s + (h.recompense.dollars ?? 0), 0);
    expect(total).toBeLessThan(3000);
    expect(total).toBeGreaterThan(1500);
  });
});

describe('lecture des conditions', () => {
  const ctx = (resultat: ResultatCourse | undefined, cumuls = cumulsVides()) => ({ resultat, record: false, cumuls, nbCartes: 4 });

  it('compare les nombres, les textes et « toutesLesCartes »', () => {
    const r = course({ meteo: 'neige', stats: { vitesseMax: 210 } });
    expect(testTient({ champ: 'course.vitesseMax', op: '>=', valeur: 200 }, ctx(r))).toBe(true);
    expect(testTient({ champ: 'course.vitesseMax', op: '>', valeur: 210 }, ctx(r))).toBe(false);
    expect(testTient({ champ: 'course.meteo', op: '=', valeur: 'neige' }, ctx(r))).toBe(true);
    expect(testTient({ champ: 'course.meteo', op: '!=', valeur: 'neige' }, ctx(r))).toBe(false);
    expect(testTient({ champ: 'course.meteo', op: '>=', valeur: 'neige' }, ctx(r))).toBe(false);
    const cumuls = { ...cumulsVides(), cartes: { a: true, b: true, c: true, d: true } as Record<string, true> };
    expect(testTient({ champ: 'cumul.cartes', op: '>=', valeur: 'toutesLesCartes' }, ctx(r, cumuls))).toBe(true);
    expect(testTient({ champ: 'cumul.cartes', op: '>=', valeur: 'toutesLesCartes' }, ctx(r))).toBe(false);
  });

  it('sans course, un test sur la course ne tient jamais, même « différent de »', () => {
    expect(testTient({ champ: 'course.meteo', op: '!=', valeur: 'neige' }, ctx(undefined))).toBe(false);
    expect(testTient({ champ: 'course.chocs', op: '<=', valeur: 99 }, ctx(undefined))).toBe(false);
  });

  it('mesure l’avancement d’un haut fait de cumul', () => {
    const def = HAUTS_FAITS.find((h) => h.id === 'dix-courses') as HautFaitDef;
    expect(progression(def, { ...cumulsVides(), courses: 4 }, 4)).toEqual({ champ: 'cumul.courses', actuel: 4, cible: 10 });
    expect(progression(def, { ...cumulsVides(), courses: 40 }, 4)?.actuel).toBe(10);
    const propre = HAUTS_FAITS.find((h) => h.id === 'tour-propre') as HautFaitDef;
    expect(progression(propre, cumulsVides(), 4)).toBeNull();
  });
});

describe('clôture d’une course', () => {
  it('la première course : gains, premier tour de piste, solde', () => {
    const { etat, bilan } = cloturer(etatVide(), course(), REGLES);
    expect(bilan.gains.dollars).toBe(40);
    expect(bilan.hautsFaits.map((h) => h.id)).toEqual(['premiere-course']);
    expect(bilan.solde).toBe(40 + 50);
    expect(etat.solde).toBe(bilan.solde);
    expect(etat.cumuls.courses).toBe(1);
    expect(etat.cumuls.cartes).toEqual({ 'carte-a': true });
    expect(etat.hautsFaits).toEqual({ 'premiere-course': true });
    expect(bilan.deblocages).toEqual([]);
    expect(bilan.resultat.carte).toBe('carte-a');
  });

  it('ne modifie pas l’état reçu', () => {
    const avant = etatVide();
    const copie = JSON.stringify(avant);
    cloturer(avant, course({ medaille: 'or' }), REGLES);
    expect(JSON.stringify(avant)).toBe(copie);
  });

  it('un haut fait ne s’obtient qu’une fois', () => {
    const premiere = cloturer(etatVide(), course(), REGLES);
    const seconde = cloturer(premiere.etat, course(), REGLES);
    expect(seconde.bilan.hautsFaits.map((h) => h.id)).not.toContain('premiere-course');
    expect(seconde.bilan.solde).toBe(premiere.bilan.solde + 40);
  });

  it('un premier or donne ses dollars et son sticker de trophée, listé en déblocage', () => {
    const { etat, bilan } = cloturer(etatVide(), course({ medaille: 'or', stats: { chocs: 0 } }), REGLES);
    const ids = bilan.hautsFaits.map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining(['premiere-course', 'premiere-medaille', 'premier-argent', 'premier-or', 'tour-propre']));
    expect(bilan.deblocages.map((a) => a.id)).toEqual(['sticker-trophee-or']);
    expect(possedeDans(etat, 'sticker-trophee-or')).toBe(true);
    const gainsCourse = 40 + 60 + 20;
    const recompenses = HAUTS_FAITS.filter((h) => ids.includes(h.id)).reduce((s, h) => s + (h.recompense.dollars ?? 0), 0);
    expect(bilan.solde).toBe(gainsCourse + recompenses);
  });

  it('trois tours sans choc, une longue glisse, 200 km/h, la neige : trophées en même temps', () => {
    const r = course({ format: 'tours3', tours: [80, 80, 80], temps: 240, meteo: 'neige', stats: { chocs: 0, glisse: 320, vitesseMax: 205 } });
    const { bilan } = cloturer(etatVide(), r, REGLES);
    const ids = bilan.hautsFaits.map((h) => h.id);
    expect(ids).toEqual(expect.arrayContaining(['trois-tours-propres', 'longue-glisse', 'glisse', 'vitesse-200', 'vitesse-160', 'vitesse-120', 'sous-la-neige', 'trois-tours']));
    expect(bilan.deblocages.map((a) => a.id).sort()).toEqual(['sticker-trophee-glisse', 'sticker-trophee-neige', 'sticker-trophee-propre', 'sticker-trophee-vitesse']);
  });

  it('un record battu avec une ancienne marque donne « Meilleur que toi-même »', () => {
    const { bilan } = cloturer(etatVide(), course({ ancienRecord: 100, temps: 90 }), REGLES);
    expect(bilan.hautsFaits.map((h) => h.id)).toContain('premier-record');
    const sans = cloturer(etatVide(), course({ ancienRecord: 80, temps: 90 }), REGLES);
    expect(sans.bilan.hautsFaits.map((h) => h.id)).not.toContain('premier-record');
  });

  it('dix courses puis vingt-cinq : les cumuls font obtenir leurs hauts faits à la bonne course', () => {
    let etat: EtatJeu = etatVide();
    const vus: Record<number, string[]> = {};
    for (let n = 1; n <= 25; n += 1) {
      const suite = cloturer(etat, course({ vehicule: 'v', carte: 'c' }), REGLES);
      etat = suite.etat;
      vus[n] = suite.bilan.hautsFaits.map((h) => h.id);
    }
    expect(vus[1]).toContain('premiere-course');
    expect(vus[10]).toEqual(['dix-courses']);
    expect(vus[25]).toEqual(['vingt-cinq-courses', 'mille-dollars']);
    expect(possedeDans(etat, 'sticker-trophee-series')).toBe(true);
    expect(etat.cumuls.courses).toBe(25);
  });

  it('cent kilomètres, toutes les cartes, deux véhicules', () => {
    let etat: EtatJeu = etatVide();
    const cartes = ['a', 'b', 'c', 'd'];
    const vus: string[] = [];
    cartes.forEach((carte, i) => {
      const suite = cloturer(etat, course({ carte, vehicule: i % 2 ? 'v1' : 'v2', stats: { distance: 30_000 } }), REGLES);
      etat = suite.etat;
      vus.push(...suite.bilan.hautsFaits.map((h) => h.id));
    });
    expect(vus).toEqual(expect.arrayContaining(['deux-cartes', 'deux-vehicules', 'toutes-les-cartes', 'dix-kilometres', 'cent-kilometres']));
    expect(etat.cumuls.distance).toBe(120_000);
    expect(possedeDans(etat, 'sticker-trophee-cartes')).toBe(true);
    expect(possedeDans(etat, 'sticker-trophee-route')).toBe(true);
  });

  it('les cumuls : pointe de vitesse retenue, médailles par couleur, météo, jour, courses sans choc', () => {
    let c = cumulsVides();
    c = ajouterCourse(c, course({ medaille: 'bronze', meteo: 'pluie', moment: 'jour', stats: { vitesseMax: 150, chocs: 0, glisse: 10, nos: 2 } }), 55, false);
    c = ajouterCourse(c, course({ medaille: 'or', meteo: 'neige', stats: { vitesseMax: 120, chocs: 3 } }), 100, true);
    expect(c).toMatchObject({ courses: 2, bronze: 1, argent: 0, or: 1, records: 1, pluie: 1, neige: 1, jour: 1, sansChoc: 1, vitesseMax: 150, gains: 155, glisse: 10, nos: 2, chocs: 3 });
  });

  it('accorder ne redonne pas un article déjà possédé', () => {
    const def = HAUTS_FAITS.find((h) => h.id === 'premier-or') as HautFaitDef;
    const deja: EtatJeu = { ...etatVide(), articles: { 'sticker-trophee-or': true } };
    const { etat, deblocages } = accorder(deja, [def], REGLES);
    expect(deblocages).toEqual([]);
    expect(etat.solde).toBe(80);
  });
});

describe('achat', () => {
  const riche: EtatJeu = { ...etatVide(), solde: 400 };

  it('acheter un pack : le solde baisse du prix, l’article est acquis, l’achat est compté', () => {
    const issue = acheterDans(riche, 'pack-flammes');
    expect(issue.ok).toBe(true);
    if (!issue.ok) return;
    expect(issue.etat.solde).toBe(250);
    expect(possedeDans(issue.etat, 'pack-flammes')).toBe(true);
    expect(issue.etat.cumuls.achats).toBe(1);
    expect(riche.solde).toBe(400);
  });

  it('solde insuffisant : rien ne change, on sait ce qu’il manque', () => {
    const issue = acheterDans({ ...etatVide(), solde: 100 }, 'pack-course');
    expect(issue).toEqual({ ok: false, raison: 'insuffisant', manque: 200 });
  });

  it('au centime près : le solde exact suffit', () => {
    expect(acheterDans({ ...etatVide(), solde: 150 }, 'pack-flammes').ok).toBe(true);
    expect(acheterDans({ ...etatVide(), solde: 149 }, 'pack-flammes')).toMatchObject({ ok: false, manque: 1 });
  });

  it('refuse : déjà acquis, offert d’office, trophée, inconnu', () => {
    const achete = acheterDans(riche, 'pack-flammes');
    if (!achete.ok) throw new Error('achat attendu');
    expect(acheterDans(achete.etat, 'pack-flammes')).toEqual({ ok: false, raison: 'deja' });
    expect(acheterDans(riche, 'pack-depart')).toEqual({ ok: false, raison: 'deja' });
    expect(acheterDans({ ...riche, solde: 9999 }, 'sticker-trophee-or')).toEqual({ ok: false, raison: 'pas-a-vendre' });
    expect(acheterDans(riche, 'pack-fantome')).toEqual({ ok: false, raison: 'inconnu' });
  });

  it('possède : le pack de départ d’office, les autres seulement acquis, l’inconnu jamais', () => {
    expect(possedeDans(etatVide(), 'pack-depart')).toBe(true);
    expect(possedeDans(etatVide(), 'pack-flammes')).toBe(false);
    expect(possedeDans(etatVide(), 'sticker-trophee-or')).toBe(false);
    expect(possedeDans(etatVide(), 'sticker-fantome')).toBe(false);
    expect(possedeDans({ articles: { 'sticker-fantome': true } }, 'sticker-fantome')).toBe(true);
  });

  it('« Premier achat » vient avec l’achat, pas avec la course suivante', () => {
    const issue = acheterDans(riche, 'pack-flammes');
    if (!issue.ok) throw new Error('achat attendu');
    const suite = verifierCumuls(issue.etat, REGLES);
    expect(suite.hautsFaits.map((h) => h.id)).toEqual(['premier-achat']);
    expect(suite.etat.solde).toBe(250 + 25);
    // Aucun haut fait « course » ne se déclenche sans course.
    expect(verifierCumuls(etatVide(), REGLES).hautsFaits).toEqual([]);
  });
});

describe('lecture tolérante de la sauvegarde', () => {
  it('une sauvegarde illisible donne un état vide', () => {
    expect(nettoyerEtat(null)).toEqual(etatVide());
    expect(nettoyerEtat('texte')).toEqual(etatVide());
    expect(nettoyerEtat([1, 2])).toEqual(etatVide());
  });

  it('nombres abîmés à zéro, articles et hauts faits inconnus oubliés, rien d’hérité du prototype', () => {
    const lu = nettoyerEtat({
      solde: -5,
      articles: { 'pack-flammes': true, 'pack-fantome': true, 'sticker-trophee-or': 'oui', __proto__: { 'pack-course': true } },
      hautsFaits: { 'premiere-course': true, fantome: true, 'dix-courses': false },
      cumuls: { courses: 'beaucoup', distance: Number.NaN, or: 2.9, cartes: { a: true, 'x y': true, b: 1 } },
    });
    expect(lu.solde).toBe(0);
    expect(lu.articles).toEqual({ 'pack-flammes': true });
    expect(lu.hautsFaits).toEqual({ 'premiere-course': true });
    expect(lu.cumuls.courses).toBe(0);
    expect(lu.cumuls.distance).toBe(0);
    expect(lu.cumuls.or).toBe(2);
    expect(lu.cumuls.cartes).toEqual({ a: true });
  });

  it('un solde énorme est borné', () => {
    expect(nettoyerEtat({ solde: 1e30 }).solde).toBe(1_000_000_000);
  });

  it('une sauvegarde valide se relit à l’identique', () => {
    const { etat } = cloturer(etatVide(), course({ medaille: 'or', ancienRecord: 100 }), REGLES);
    expect(nettoyerEtat(JSON.parse(JSON.stringify(etat)))).toEqual(etat);
  });
});

describe('fusion entre pages', () => {
  const base = JSON.parse(JSON.stringify(etatVide())) as Json;

  it('deux pages qui obtiennent chacune un haut fait différent gardent les deux', () => {
    const stored = JSON.parse(JSON.stringify({ ...etatVide(), hautsFaits: { 'premiere-course': true } })) as Json;
    const local = JSON.parse(JSON.stringify({ ...etatVide(), hautsFaits: { 'premier-or': true }, articles: { 'sticker-trophee-or': true } })) as Json;
    const fusion = mergeChanges(base, local, stored) as { hautsFaits: Record<string, true>; articles: Record<string, true> };
    expect(fusion.hautsFaits).toEqual({ 'premiere-course': true, 'premier-or': true });
    expect(fusion.articles).toEqual({ 'sticker-trophee-or': true });
  });

  it('une page qui n’a pas touché au jeu ne l’efface pas', () => {
    const stored = JSON.parse(JSON.stringify({ ...etatVide(), solde: 300, articles: { 'pack-flammes': true } })) as Json;
    expect(mergeChanges(base, base, stored)).toBe(stored);
  });

  it('les cartes courues dans l’une et l’autre se cumulent', () => {
    const stored = JSON.parse(JSON.stringify({ ...etatVide(), cumuls: { ...cumulsVides(), cartes: { a: true } } })) as Json;
    const local = JSON.parse(JSON.stringify({ ...etatVide(), cumuls: { ...cumulsVides(), cartes: { b: true } } })) as Json;
    const fusion = mergeChanges(base, local, stored) as { cumuls: { cartes: Record<string, true> } };
    expect(fusion.cumuls.cartes).toEqual({ a: true, b: true });
  });
});

describe('mots et nombres', () => {
  it('dollars, gains, kilomètres, pluriels', () => {
    expect(dollars(0)).toBe('0 $');
    expect(dollars(1250)).toBe('1 250 $');
    expect(dollars(-4)).toBe('0 $');
    expect(dollars(Number.NaN)).toBe('0 $');
    expect(gain(50)).toBe('+50 $');
    expect(kilometres(12_340)).toBe('12,3 km');
    expect(kilometres(0)).toBe('0 km');
    expect(pluriel(1, 'course')).toBe('1 course');
    expect(pluriel(3, 'course finie', 'courses finies')).toBe('3 courses finies');
  });
});
