// Le mode carrière (vague U) : le fichier des rendez-vous et son contrôle (une carte, un départ ou un format
// inconnus refusent toute la carrière), les règles de la progression (src/jeu/carriere.ts), l'enregistrement
// d'une course de carrière et sa prime (src/jeu/carriereCloture.ts), la sauvegarde (migration d'une
// sauvegarde d'avant la carrière, remise à zéro), la sortie imposée (src/state/drive.ts) et l'écran de fin.
import 'fake-indexeddb/auto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, get, set } from 'idb-keyval';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CARRIERE, conseilDe, lireCarriere, PRIME_MAX, PRIME_MIN, PROBLEMES_CARRIERE, type RendezVous } from '../../src/data/carriere.ts';
import type { FichierCourses } from '../../src/data/courses.ts';
import { MAPS } from '../../src/data/maps.ts';
import { carriereBouclee, enregistrerCourse, indexCourant, jugerRendezVous, nettoyerProgression, primeDue, progressionVide, rendezVousCourant } from '../../src/jeu/carriere.ts';
import type { Bilan, ResultatCourse } from '../../src/jeu/contrat.ts';

const db = () => createStore('pimpmybichon', 'kv');

/** Un rendez-vous fabriqué, pour les règles. */
const rdv = (id: string, objectif: RendezVous['objectif'] = 'finir', prime = 50): RendezVous => ({ id, titre: id, carte: 'carte-a', depart: 'ligne', format: 'tour1', meteo: 'pluie', moment: 'nuit', objectif, prime });

const resultat = (temps: number, medaille: ResultatCourse['medaille'] = null, autre: Partial<ResultatCourse> = {}): ResultatCourse => ({
  carte: 'carte-a',
  depart: 'ligne',
  vehicule: 'v',
  format: 'tour1',
  meteo: 'pluie',
  moment: 'nuit',
  temps,
  tours: [temps],
  ancienRecord: null,
  medaille,
  stats: { distance: 1000, vitesseMax: 100, glisse: 0, chocs: 0, nos: 0 },
  ...autre,
});

describe('le fichier de la carrière (public/assets/carriere/carriere.json)', () => {
  it('est accepté tel quel : une douzaine de rendez-vous, sur les quatre cartes', () => {
    expect(PROBLEMES_CARRIERE).toEqual([]);
    expect(CARRIERE.length).toBeGreaterThanOrEqual(10);
    expect(new Set(CARRIERE.map((r) => r.carte))).toEqual(new Set(MAPS.map((m) => m.id)));
    for (const r of CARRIERE) {
      expect(r.prime, r.id).toBeGreaterThanOrEqual(PRIME_MIN);
      expect(r.prime, r.id).toBeLessThanOrEqual(PRIME_MAX);
    }
  });

  it('la difficulté monte : sec et jour d’abord ; pluie, nuit, neige et trois tours ensuite ; le bronze sur les derniers', () => {
    const premier = (test: (r: RendezVous) => boolean) => CARRIERE.findIndex(test);
    const [a, b] = CARRIERE;
    expect(a).toMatchObject({ meteo: 'sec', moment: 'jour', objectif: 'finir', format: 'tour1' });
    expect(b).toMatchObject({ meteo: 'sec', moment: 'jour', objectif: 'finir' });
    const pluie = premier((r) => r.meteo === 'pluie');
    const nuit = premier((r) => r.moment === 'nuit');
    const neige = premier((r) => r.meteo === 'neige');
    const trois = premier((r) => r.format === 'tours3');
    const bronze = premier((r) => r.objectif === 'bronze');
    expect(pluie).toBeGreaterThan(1);
    expect(nuit).toBeGreaterThan(pluie);
    expect(neige).toBeGreaterThan(nuit);
    expect(trois).toBeGreaterThan(neige);
    expect(bronze).toBeGreaterThan(CARRIERE.length / 2);
    // Une fois le bronze exigé, il l'est jusqu'au bout ; les primes ne baissent jamais.
    expect(CARRIERE.slice(bronze).every((r) => r.objectif === 'bronze')).toBe(true);
    for (let i = 1; i < CARRIERE.length; i += 1) expect(CARRIERE[i]!.prime).toBeGreaterThanOrEqual(CARRIERE[i - 1]!.prime);
  });

  it('chaque départ existe dans la carte (sources versionnées, et route fabriquée quand elle est là) ; trois tours sur une boucle seulement', () => {
    for (const r of CARRIERE) {
      const source = JSON.parse(readFileSync(resolve('assets-src/maps', r.carte, 'carte.json'), 'utf8')) as { departs: { id: string }[] };
      expect(source.departs.map((d) => d.id), r.id).toContain(r.depart);
      const route = resolve('public/assets/maps', r.carte, 'route.json');
      if (!existsSync(route)) continue;
      const lue = JSON.parse(readFileSync(route, 'utf8')) as { loop: boolean; starts: { id: string }[] };
      expect(lue.starts.map((s) => s.id), r.id).toContain(r.depart);
      if (r.format === 'tours3') expect(lue.loop, r.id).toBe(true);
    }
  });

  it('les conseils de préparation suivent la météo, la nuit et les trois tours, sans chiffre promis', () => {
    expect(conseilDe({ meteo: 'pluie', moment: 'jour', format: 'tour1' })).toContain('pense aux pneus et à l’assiette');
    expect(conseilDe({ meteo: 'neige', moment: 'nuit', format: 'tours3' })).toMatch(/Neige.*nuit.*Trois tours/);
    for (const r of CARRIERE) expect(conseilDe(r), r.id).not.toMatch(/\d/);
  });
});

describe('le contrôle refuse ce qui ne se court pas', () => {
  const references: Record<string, FichierCourses> = {
    boucle: { format: 'pmb-courses', version: 1, meteo: 'sec', departs: { ligne: { tour1: { auto: 100, main: 60, vehicules: {} }, tours3: { auto: 300, main: 180, vehicules: {} } } } },
    route: { format: 'pmb-courses', version: 1, meteo: 'sec', departs: { debut: { tour1: { auto: 100, main: 60, vehicules: {} } } } },
  };
  const contexte = { cartes: [{ id: 'boucle' }, { id: 'route' }, { id: 'sans-temps' }], references };
  const bon = { id: 'un', titre: 'Un', carte: 'boucle', depart: 'ligne', format: 'tours3', meteo: 'pluie', moment: 'nuit', objectif: 'bronze', prime: 100 };
  const lire = (...rendezVous: unknown[]) => lireCarriere({ format: 'pmb-carriere', version: 1, rendezVous }, contexte);

  it('accepte un fichier bien formé', () => {
    const lu = lire(bon, { ...bon, id: 'deux', carte: 'route', depart: 'debut', format: 'tour1', objectif: 'finir' });
    expect(lu.problemes).toEqual([]);
    expect(lu.rendezVous.map((r) => r.id)).toEqual(['un', 'deux']);
  });

  it.each([
    ['une carte inconnue', { carte: 'nulle-part' }, /carte « nulle-part » inconnue/],
    ['une carte sans temps de référence', { carte: 'sans-temps' }, /pas de temps de référence/],
    ['un départ inconnu', { depart: 'ailleurs' }, /départ « ailleurs » inconnu/],
    ['un format inconnu', { format: 'tours5' }, /format « tours5 » inconnu/],
    ['trois tours sur une route ouverte', { carte: 'route', depart: 'debut', format: 'tours3' }, /ne se court pas/],
    ['une météo inconnue', { meteo: 'grele' }, /météo « grele » inconnue/],
    ['un moment inconnu', { moment: 'aube' }, /moment « aube » inconnu/],
    ['un objectif inconnu', { objectif: 'or' }, /objectif « or » inconnu/],
    ['une prime trop forte', { prime: 400 }, /prime entre 40 et 150/],
    ['une prime trop faible', { prime: 10 }, /prime entre 40 et 150/],
  ])('refuse %s, et toute la carrière avec', (_nom, change, motif) => {
    const lu = lire({ ...bon, id: 'zero', carte: 'route', depart: 'debut', format: 'tour1' }, { ...bon, ...change });
    expect(lu.rendezVous).toEqual([]);
    expect(lu.problemes.join(' | ')).toMatch(motif);
  });

  it('refuse un identifiant en double, une liste vide, un format de fichier inconnu', () => {
    expect(lire(bon, bon).problemes.join()).toMatch(/en double/);
    expect(lire().problemes.join()).toMatch(/liste non vide/);
    expect(lireCarriere({ format: 'autre', version: 1, rendezVous: [bon] }, contexte).problemes.join()).toMatch(/format ou version/);
    expect(lireCarriere(null, contexte).rendezVous).toEqual([]);
  });
});

describe('règles de la progression', () => {
  const suite = [rdv('a'), rdv('b', 'bronze', 80), rdv('c', 'finir', 100)];

  it('le rendez-vous courant est le premier pas encore réussi ; la carrière se boucle au dernier', () => {
    let p = progressionVide();
    expect(rendezVousCourant(p, suite)?.id).toBe('a');
    p = enregistrerCourse(p, suite[0]!, resultat(90), true);
    expect(indexCourant(p, suite)).toBe(1);
    // Un échec ne fait pas reculer, ne fait rien perdre.
    p = enregistrerCourse(p, suite[1]!, resultat(120), false);
    expect(indexCourant(p, suite)).toBe(1);
    expect(p.resultats.b).toMatchObject({ reussi: false, essais: 1, meilleurTemps: 120 });
    p = enregistrerCourse(p, suite[1]!, resultat(95, 'bronze'), true);
    p = enregistrerCourse(p, suite[1]!, resultat(99, null), false);
    expect(p.resultats.b).toMatchObject({ reussi: true, essais: 3, meilleurTemps: 95, medaille: 'bronze' });
    expect(carriereBouclee(p, suite)).toBe(false);
    p = enregistrerCourse(p, suite[2]!, resultat(70), true);
    expect(carriereBouclee(p, suite)).toBe(true);
    expect(rendezVousCourant(p, suite)).toBeNull();
  });

  it('juge l’objectif : finir passe à la ligne ; le bronze veut une médaille, et dit de combien il manquait', () => {
    expect(jugerRendezVous(suite[0]!, resultat(500), 100)).toMatchObject({ reussi: true, raison: 'fini' });
    expect(jugerRendezVous(suite[1]!, resultat(95, 'bronze'), 100)).toMatchObject({ reussi: true, raison: 'medaille' });
    const manque = jugerRendezVous(suite[1]!, resultat(104.4), 100);
    expect(manque).toMatchObject({ reussi: false, raison: 'trop-lent', seuil: 100 });
    expect(manque.ecart).toBeCloseTo(4.4, 5);
    expect(jugerRendezVous(suite[1]!, resultat(104.4), null)).toMatchObject({ reussi: false, raison: 'trop-lent', seuil: null, ecart: null });
  });

  it('une course courue autrement que le rendez-vous, ou un rendez-vous pas encore ouvert, ne valide rien', () => {
    expect(jugerRendezVous(suite[0]!, resultat(90, null, { meteo: 'sec', moment: 'jour' }), 100)).toMatchObject({ reussi: false, raison: 'non-conforme', ecarts: ['meteo', 'moment'] });
    expect(jugerRendezVous(suite[2]!, resultat(90), 100, 2, 0)).toMatchObject({ reussi: false, raison: 'pas-encore' });
  });

  it('la prime se paie une fois, au premier passage réussi', () => {
    const avant = progressionVide();
    expect(primeDue(avant, suite[0]!, true)).toBe(50);
    expect(primeDue(avant, suite[0]!, false)).toBe(0);
    const apres = enregistrerCourse(avant, suite[0]!, resultat(90), true);
    expect(primeDue(apres, suite[0]!, true)).toBe(0);
  });

  it('relit une sauvegarde abîmée sans rien casser', () => {
    expect(nettoyerProgression(undefined)).toEqual(progressionVide());
    expect(nettoyerProgression('n’importe')).toEqual(progressionVide());
    expect(
      nettoyerProgression({
        resultats: {
          a: { reussi: true, essais: 2.7, meilleurTemps: 91.2, medaille: 'argent' },
          b: { reussi: 'oui', essais: -3, meilleurTemps: -1, medaille: 'platine' },
          '__proto__': { reussi: true },
          'Pas Bon': { reussi: true },
          c: 'rien',
        },
      }),
    ).toEqual({ resultats: { a: { reussi: true, essais: 2, meilleurTemps: 91.2, medaille: 'argent' }, b: { reussi: false, essais: 0, meilleurTemps: null, medaille: null } } });
  });
});

describe('sauvegarde, clôture d’une course de carrière, sortie imposée', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  async function lancer() {
    vi.resetModules();
    const jeu = await import('../../src/state/jeu.ts');
    const drive = await import('../../src/state/drive.ts');
    const cloture = await import('../../src/jeu/carriereCloture.ts');
    const donnees = await import('../../src/data/carriere.ts');
    await vi.waitFor(() => expect(jeu.useJeu.getState().hydrated && drive.useDrive.getState().hydrated).toBe(true));
    return { ...jeu, ...drive, ...cloture, ...donnees };
  }

  async function sauvegarde(cle: string): Promise<Record<string, unknown> | null> {
    const raw = await get<string>(cle, db());
    return raw ? (JSON.parse(raw) as { state: Record<string, unknown> }).state : null;
  }

  /** La course d'un rendez-vous, telle que la sortie la rend, avec le temps donné. */
  const courseDe = (r: RendezVous, temps: number) => ({ carte: r.carte, depart: r.depart, vehicule: 'concept', format: r.format, meteo: r.meteo, moment: r.moment, temps, tours: [temps], stats: { distance: 1200, vitesseMax: 120, glisse: 0, chocs: 0, nos: 0 } });

  it('une sauvegarde d’avant la carrière se relit : solde gardé, carrière au premier rendez-vous ; la remise à zéro la remet à zéro', async () => {
    await set('pmb-jeu', JSON.stringify({ state: { solde: 230, articles: {}, hautsFaits: { 'premiere-course': true }, cumuls: { courses: 3 } }, version: 1 }), db());
    const { useJeu, CARRIERE: suite } = await lancer();
    expect(useJeu.getState().solde).toBe(230);
    expect(useJeu.getState().carriere).toEqual({ resultats: {} });
    expect(rendezVousCourant(useJeu.getState().carriere, suite)?.id).toBe(suite[0]!.id);
    useJeu.setState({ carriere: { resultats: { [suite[0]!.id]: { reussi: true, essais: 1, meilleurTemps: 50, medaille: null } } } });
    await vi.waitFor(async () => expect((await sauvegarde('pmb-jeu'))?.carriere).toEqual({ resultats: { [suite[0]!.id]: { reussi: true, essais: 1, meilleurTemps: 50, medaille: null } } }));
    useJeu.getState().remettreAZero();
    expect(useJeu.getState().carriere).toEqual({ resultats: {} });
    expect(useJeu.getState().solde).toBe(0);
  });

  it('un rendez-vous lancé impose tout, garde les choix libres de côté (et dans la sauvegarde), les rend au garage', async () => {
    const { useDrive, CARRIERE: suite } = await lancer();
    const r = suite.find((x) => x.meteo === 'pluie' && x.moment === 'jour')!;
    useDrive.getState().setWeather('neige');
    useDrive.getState().setMoment('nuit');
    useDrive.getState().setFormat('balade');
    useDrive.getState().lancerRendezVous(r, 5, 12);
    let s = useDrive.getState();
    expect(s).toMatchObject({ weather: r.meteo, moment: r.moment, format: r.format, choice: { map: r.carte, start: r.depart } });
    expect(s.rendezVous).toMatchObject({ id: r.id, numero: 5, total: 12 });
    // Rien ne se change pendant le rendez-vous.
    s.setWeather('sec');
    s.setMoment('nuit');
    s.setFormat('balade');
    s = useDrive.getState();
    expect(s).toMatchObject({ weather: r.meteo, moment: r.moment, format: r.format });
    // La sauvegarde garde les choix libres.
    await vi.waitFor(async () => expect(await sauvegarde('pmb-sortie')).toMatchObject({ weather: 'neige', moment: 'nuit', format: 'balade' }));
    useDrive.getState().enter();
    expect(useDrive.getState().map).toBe(r.carte);
    useDrive.getState().leave();
    expect(useDrive.getState()).toMatchObject({ rendezVous: null, weather: 'neige', moment: 'nuit', format: 'balade', map: null });
  });

  it('une course de carrière finie : comptée comme une course libre, plus la prime (une fois) ; manquée, elle n’avance pas', async () => {
    const { useDrive, useJeu, verdictDe, motifPrime, CARRIERE: suite } = await lancer();
    const premier = suite[0]!;
    useDrive.getState().lancerRendezVous(premier, 1, suite.length);
    useDrive.getState().enter();
    useDrive.getState().terminerCourse(courseDe(premier, 60));
    const fin = useDrive.getState().fin!;
    const v = verdictDe(fin)!;
    expect(v).toMatchObject({ reussi: true, raison: 'fini', numero: 1, prime: premier.prime, dejaReussi: false, suivant: suite[1], suivantNumero: 2 });
    // Les gains de la course libre (Course d'un tour finie…), plus la ligne de la prime ; le solde suit.
    expect(fin.gains.detail.map((l) => l.motif)).toContain('Course d’un tour finie');
    expect(fin.gains.detail.at(-1)).toEqual({ motif: motifPrime(1), dollars: premier.prime });
    expect(fin.gains.dollars).toBe(fin.gains.detail.reduce((t, l) => t + l.dollars, 0));
    expect(useJeu.getState().solde).toBe(fin.solde);
    expect(useJeu.getState().cumuls.courses).toBe(1);
    expect(useJeu.getState().carriere.resultats[premier.id]).toMatchObject({ reussi: true, essais: 1, meilleurTemps: 60 });
    // Rejouer le même : pas de seconde prime.
    const solde = useJeu.getState().solde;
    useDrive.getState().terminerCourse(courseDe(premier, 55));
    const encore = verdictDe(useDrive.getState().fin)!;
    expect(encore).toMatchObject({ reussi: true, dejaReussi: true, prime: 0 });
    expect(useDrive.getState().fin!.gains.detail.some((l) => l.motif === motifPrime(1))).toBe(false);
    expect(useJeu.getState().solde).toBe(useDrive.getState().fin!.solde);
    expect(useJeu.getState().solde).toBeGreaterThan(solde);
    // Un rendez-vous au bronze, couru trop lentement : manqué, de combien, sans prime ni avancée.
    const iBronze = suite.findIndex((x) => x.objectif === 'bronze');
    const bronze = suite[iBronze]!;
    useJeu.setState({ carriere: { resultats: Object.fromEntries(suite.slice(0, iBronze).map((x) => [x.id, { reussi: true, essais: 1, meilleurTemps: 60, medaille: null }])) } });
    useDrive.getState().leave();
    useDrive.getState().lancerRendezVous(bronze, iBronze + 1, suite.length);
    useDrive.getState().terminerCourse(courseDe(bronze, 9999));
    const rate = verdictDe(useDrive.getState().fin)!;
    expect(rate).toMatchObject({ reussi: false, raison: 'trop-lent', prime: 0 });
    expect(rate.seuil).toBeGreaterThan(30);
    expect(rate.ecart).toBeCloseTo(9999 - rate.seuil!, 3);
    expect(indexCourant(useJeu.getState().carriere, suite)).toBe(iBronze);
    expect(useJeu.getState().carriere.resultats[bronze.id]).toMatchObject({ reussi: false, essais: 1 });
  });

  it('le dernier rendez-vous réussi boucle la carrière et accorde son haut fait', async () => {
    const { useDrive, useJeu, verdictDe, CARRIERE: suite } = await lancer();
    const dernier = suite.at(-1)!;
    useJeu.setState({ carriere: { resultats: Object.fromEntries(suite.slice(0, -1).map((x) => [x.id, { reussi: true, essais: 1, meilleurTemps: 60, medaille: null }])) } });
    useDrive.getState().lancerRendezVous(dernier, suite.length, suite.length);
    // Un temps de 1 s décroche forcément la médaille (référence de la carte), donc le bronze.
    useDrive.getState().terminerCourse(courseDe(dernier, 1));
    const fin = useDrive.getState().fin!;
    expect(verdictDe(fin)).toMatchObject({ reussi: true, bouclee: true, suivant: null });
    expect(fin.hautsFaits.map((h) => h.id)).toContain('carriere-bouclee');
    expect(useJeu.getState().hautsFaits['carriere-bouclee']).toBe(true);
    expect(carriereBouclee(useJeu.getState().carriere, suite)).toBe(true);
  });

  it('l’écran de fin : réussi, il annonce le suivant ; manqué, il dit de combien et propose de retenter ; course libre, rien', async () => {
    const { useDrive, useJeu, CARRIERE: suite } = await lancer();
    const { FinCourseVue } = await import('../../src/ui/drive/FinCourseVue.tsx');
    const rendre = (bilan: Bilan) => renderToStaticMarkup(createElement(FinCourseVue, { bilan, onRejouer: () => undefined, onGarage: () => undefined }));
    const premier = suite[0]!;
    useDrive.getState().lancerRendezVous(premier, 1, suite.length);
    useDrive.getState().terminerCourse(courseDe(premier, 60));
    let html = rendre(useDrive.getState().fin!);
    expect(html).toContain('Rendez-vous 1 réussi');
    expect(html).toContain('Prochain rendez-vous');
    expect(html).toContain(suite[1]!.titre);
    expect(html).toContain('Rentrer au garage préparer le véhicule');
    expect(html).not.toContain('Retenter');
    const iBronze = suite.findIndex((x) => x.objectif === 'bronze');
    useJeu.setState({ carriere: { resultats: Object.fromEntries(suite.slice(0, iBronze).map((x) => [x.id, { reussi: true, essais: 1, meilleurTemps: 60, medaille: null }])) } });
    useDrive.getState().leave();
    useDrive.getState().lancerRendezVous(suite[iBronze]!, iBronze + 1, suite.length);
    useDrive.getState().terminerCourse(courseDe(suite[iBronze]!, 600));
    html = rendre(useDrive.getState().fin!);
    expect(html).toContain(`Rendez-vous ${iBronze + 1} manqué`);
    expect(html).toMatch(/Il fallait le bronze, sous \d+:\d\d\.\d\. Tu as mis 10:00\.0 : \d+,\d s de trop\./);
    expect(html).toContain('Retenter');
    useDrive.getState().leave();
    useDrive.getState().terminerCourse(courseDe(suite[0]!, 60));
    html = rendre(useDrive.getState().fin!);
    expect(html).not.toContain('carriere-fin');
  });
});
