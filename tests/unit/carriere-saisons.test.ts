// Les saisons de la carrière (vague V) : le fichier (saison 1 inchangée, saison 2 plus dure), la migration
// d'une sauvegarde d'avant les saisons (saison 1 bouclée, ou en cours), l'ouverture de la saison 2, le
// jugement à l'argent et à l'or, chaque contrainte tenue et manquée, la prime versée une seule fois, les
// hauts faits de la saison (des stickers, pas de dollars).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, set } from 'idb-keyval';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { articleParId } from '../../src/data/boutique.ts';
import { CARRIERE, PRIME_MAX, SAISONS, type RendezVous } from '../../src/data/carriere.ts';
import { MAPS } from '../../src/data/maps.ts';
import { HAUTS_FAITS } from '../../src/data/hautsFaits.ts';
import { indexCourant, indexSaisonCourante, jugerRendezVous, nettoyerProgression, saisonBouclee, saisonEnOr, saisonOuverte, type ResultatRendezVous } from '../../src/jeu/carriere.ts';
import type { ResultatCourse } from '../../src/jeu/contrat.ts';

const db = () => createStore('pimpmybichon', 'kv');

/** Les douze rendez-vous d'origine (vague U), tels que la saison 1 doit les garder : identifiant, objectif, prime. */
const ORIGINE = [
  ['premiers-tours', 'finir', 40],
  ['entree-la-mure', 'finir', 45],
  ['bord-de-mer', 'finir', 50],
  ['tour-du-port', 'finir', 60],
  ['averse-collins', 'finir', 60],
  ['pluie-plateau', 'finir', 70],
  ['casino-de-nuit', 'finir', 70],
  ['tunnel-pluie-nuit', 'finir', 80],
  ['sprint-de-nuit', 'bronze', 90],
  ['premieres-neiges', 'bronze', 110],
  ['trois-tours-soleil', 'bronze', 130],
  ['dernier-rendez-vous', 'bronze', 150],
] as const;

const S1 = SAISONS[0]!.rendezVous;
const S2 = SAISONS[1]!.rendezVous;

const resultat = (r: RendezVous, autre: Partial<ResultatCourse> = {}): ResultatCourse => ({
  carte: r.carte,
  depart: r.depart,
  vehicule: 'concept',
  format: r.format,
  meteo: r.meteo,
  moment: r.moment,
  temps: 60,
  tours: [60],
  ancienRecord: null,
  medaille: null,
  ...autre,
  stats: { distance: 1000, vitesseMax: 100, glisse: 0, chocs: 0, nos: 0, ...autre.stats },
});

const reussi = (medaille: ResultatRendezVous['medaille'] = null, temps = 60): ResultatRendezVous => ({ reussi: true, essais: 2, meilleurTemps: temps, medaille });

describe('le fichier : deux saisons, la première inchangée', () => {
  it('la saison 1 garde les douze rendez-vous d’origine, dans l’ordre, mêmes objectifs et mêmes primes, sans contrainte', () => {
    expect(SAISONS.length).toBeGreaterThanOrEqual(2);
    expect(S1.map((r) => [r.id, r.objectif, r.prime])).toEqual(ORIGINE.map((o) => [...o]));
    expect(S1.every((r) => r.contraintes.length === 0)).toBe(true);
    expect(SAISONS[0]!.hautFait).toBe('carriere-bouclee');
  });

  it('la saison 2 : douze rendez-vous, l’argent au sec d’abord, l’or dans le dur pour finir, toutes les cartes', () => {
    expect(S2).toHaveLength(12);
    expect(S2[0]).toMatchObject({ meteo: 'sec', objectif: 'argent' });
    expect(S2.slice(0, 3).every((r) => r.objectif === 'argent' && r.meteo === 'sec')).toBe(true);
    const premierOr = S2.findIndex((r) => r.objectif === 'or');
    expect(premierOr).toBeGreaterThanOrEqual(S2.length / 2);
    // Les quatre derniers à l'or, sous la pluie, la neige ou la nuit ; le final : l'or en trois tours.
    expect(S2.slice(-4).every((r) => r.objectif === 'or' && (r.meteo !== 'sec' || r.moment === 'nuit'))).toBe(true);
    expect(S2.at(-1)).toMatchObject({ objectif: 'or', format: 'tours3' });
    expect(new Set(S2.map((r) => r.carte))).toEqual(new Set(MAPS.map((m) => m.id)));
    // Les conditions se combinent (la saison 1 les présentait une par une) ; deux contraintes au plus.
    expect(S2.some((r) => r.meteo !== 'sec' && r.moment === 'nuit' && r.contraintes.length > 0)).toBe(true);
    expect(S2.every((r) => r.contraintes.length <= 2)).toBe(true);
  });

  it('les primes de la saison 2 : de 80 à 250 $, sans jamais baisser, 1 780 $ en tout', () => {
    expect(PRIME_MAX).toBe(250);
    for (let i = 1; i < S2.length; i += 1) expect(S2[i]!.prime).toBeGreaterThanOrEqual(S2[i - 1]!.prime);
    expect(S2[0]!.prime).toBe(80);
    expect(S2.at(-1)!.prime).toBe(250);
    expect(S2.reduce((t, r) => t + r.prime, 0)).toBe(1780);
  });

  it('les hauts faits que les saisons déclarent existent, et donnent des stickers, pas de dollars', () => {
    const ids = SAISONS.flatMap((s) => [s.hautFait, s.hautFaitOr]).filter((id): id is string => id !== undefined);
    expect(ids).toEqual(expect.arrayContaining(['carriere-bouclee', 'saison-2-bouclee', 'saison-2-en-or']));
    for (const id of ids) expect(HAUTS_FAITS.some((h) => h.id === id), id).toBe(true);
    for (const id of ['saison-2-bouclee', 'saison-2-en-or']) {
      const h = HAUTS_FAITS.find((x) => x.id === id)!;
      expect(h.recompense.dollars ?? 0, id).toBe(0);
      expect(h.recompense.articles?.length, id).toBeGreaterThan(0);
      for (const a of h.recompense.articles ?? []) expect(articleParId(a), a).toMatchObject({ famille: 'sticker', prix: null });
    }
  });
});

describe('migration d’une sauvegarde d’avant les saisons', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  async function relire(carriere: unknown) {
    await set('pmb-jeu', JSON.stringify({ state: { solde: 1234, articles: {}, hautsFaits: { 'carriere-bouclee': true }, cumuls: { courses: 40 }, carriere }, version: 1 }), db());
    vi.resetModules();
    const jeu = await import('../../src/state/jeu.ts');
    await vi.waitFor(() => expect(jeu.useJeu.getState().hydrated).toBe(true));
    return jeu.useJeu.getState();
  }

  it('les douze bouclés : la saison 1 reste bouclée avec ses records et ses médailles, la saison 2 s’ouvre au premier', async () => {
    const ancienne = { resultats: Object.fromEntries(ORIGINE.map(([id], i) => [id, { reussi: true, essais: 3, meilleurTemps: 50 + i, medaille: i % 2 ? 'argent' : null }])) };
    const etat = await relire(ancienne);
    expect(etat.solde).toBe(1234);
    expect(etat.carriere).toEqual(nettoyerProgression(ancienne));
    expect(etat.carriere.resultats['dernier-rendez-vous']).toEqual({ reussi: true, essais: 3, meilleurTemps: 61, medaille: 'argent' });
    expect(saisonBouclee(etat.carriere, SAISONS[0]!)).toBe(true);
    expect(saisonOuverte(etat.carriere, SAISONS, 1)).toBe(true);
    expect(indexSaisonCourante(etat.carriere, SAISONS)).toBe(1);
    expect(CARRIERE[indexCourant(etat.carriere, CARRIERE)]).toBe(S2[0]);
  });

  it('au milieu de la saison 1 : il reste où il est, la saison 2 est fermée', async () => {
    const ancienne = { resultats: Object.fromEntries(ORIGINE.slice(0, 5).map(([id]) => [id, { reussi: true, essais: 1, meilleurTemps: 70, medaille: null }])) };
    const etat = await relire(ancienne);
    expect(CARRIERE[indexCourant(etat.carriere, CARRIERE)]).toBe(S1[5]);
    expect(indexSaisonCourante(etat.carriere, SAISONS)).toBe(0);
    expect(saisonOuverte(etat.carriere, SAISONS, 1)).toBe(false);
    // Un rendez-vous de la saison 2 couru maintenant ne se valide pas.
    const rang = CARRIERE.indexOf(S2[0]!);
    expect(jugerRendezVous(S2[0]!, resultat(S2[0]!, { medaille: 'or' }), 100, rang, indexCourant(etat.carriere, CARRIERE), 'car')).toMatchObject({ reussi: false, raison: 'pas-encore' });
  });
});

describe('jugement : l’argent, l’or, les contraintes', () => {
  const r = (objectif: RendezVous['objectif'], contraintes: RendezVous['contraintes'] = []): RendezVous => ({ ...S2[0]!, objectif, contraintes });

  it('l’argent veut l’argent ou l’or ; l’or veut l’or ; manqué, il dit le seuil de la médaille visée', () => {
    expect(jugerRendezVous(r('argent'), resultat(r('argent'), { medaille: 'bronze', temps: 50 }), 45)).toMatchObject({ reussi: false, raison: 'trop-lent', seuil: 45, ecart: 5 });
    expect(jugerRendezVous(r('argent'), resultat(r('argent'), { medaille: 'argent' }), 45)).toMatchObject({ reussi: true, raison: 'medaille' });
    expect(jugerRendezVous(r('argent'), resultat(r('argent'), { medaille: 'or' }), 45)).toMatchObject({ reussi: true });
    expect(jugerRendezVous(r('or'), resultat(r('or'), { medaille: 'argent', temps: 44 }), 40)).toMatchObject({ reussi: false, raison: 'trop-lent', seuil: 40, ecart: 4 });
    expect(jugerRendezVous(r('or'), resultat(r('or'), { medaille: 'or' }), 40)).toMatchObject({ reussi: true, raison: 'medaille' });
    expect(jugerRendezVous(r('bronze'), resultat(r('bronze'), { medaille: 'bronze' }), 90)).toMatchObject({ reussi: true });
  });

  it.each([
    ['sans NOS', 'sans-nos', { stats: { nos: 1 } }],
    ['sans toucher le bord', 'sans-choc', { stats: { chocs: 2 } }],
  ] as const)('%s : tenu, réussi ; manqué, le rendez-vous est manqué même avec l’or', (_nom, contrainte, faute) => {
    const x = r('argent', [contrainte]);
    expect(jugerRendezVous(x, resultat(x, { medaille: 'or' }), 45, 0, 0, 'car')).toMatchObject({ reussi: true });
    const manque = jugerRendezVous(x, resultat(x, { medaille: 'or', stats: { distance: 1000, vitesseMax: 100, glisse: 0, chocs: 0, nos: 0, ...faute.stats } }), 45, 0, 0, 'car');
    expect(manque).toMatchObject({ reussi: false, raison: 'contrainte', manquees: [contrainte] });
  });

  it.each([
    ['à moto', 'moto', 'bike', 'car'],
    ['en voiture', 'voiture', 'car', 'bike'],
  ] as const)('%s : la bonne famille passe ; l’autre (ou un véhicule inconnu) n’est pas la course du rendez-vous', (_nom, contrainte, bonne, autre) => {
    const x = r('argent', [contrainte]);
    expect(jugerRendezVous(x, resultat(x, { medaille: 'argent' }), 45, 0, 0, bonne)).toMatchObject({ reussi: true });
    expect(jugerRendezVous(x, resultat(x, { medaille: 'argent' }), 45, 0, 0, autre)).toMatchObject({ reussi: false, raison: 'non-conforme', ecarts: ['vehicule'] });
    expect(jugerRendezVous(x, resultat(x, { medaille: 'argent' }), 45, 0, 0, null)).toMatchObject({ raison: 'non-conforme' });
  });
});

describe('clôture d’un rendez-vous de la saison 2', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  async function lancer() {
    vi.resetModules();
    const jeu = await import('../../src/state/jeu.ts');
    const drive = await import('../../src/state/drive.ts');
    const cloture = await import('../../src/jeu/carriereCloture.ts');
    const vue = await import('../../src/ui/drive/FinCourseVue.tsx');
    await vi.waitFor(() => expect(jeu.useJeu.getState().hydrated && drive.useDrive.getState().hydrated).toBe(true));
    return { ...jeu, ...drive, ...cloture, boutonsDeFin: vue.boutonsDeFin };
  }

  /** La course telle que la sortie la rend ; 1 s décroche l'or (seuils de la carte). */
  const courseDe = (x: RendezVous, temps: number, vehicule: string, stats: Partial<ResultatCourse['stats']> = {}) => ({ carte: x.carte, depart: x.depart, vehicule, format: x.format, meteo: x.meteo, moment: x.moment, temps, tours: [temps], stats: { distance: 1200, vitesseMax: 120, glisse: 0, chocs: 0, nos: 0, ...stats } });
  const vehiculeDe = (x: RendezVous) => (x.contraintes.includes('moto') ? 'bobber' : 'concept');
  const saison1Bouclee = () => Object.fromEntries(S1.map((x) => [x.id, reussi()]));

  it('la prime se verse une fois ; une contrainte manquée compte l’essai, sans temps ni médaille', async () => {
    const { useDrive, useJeu, verdictDe, motifPrime } = await lancer();
    useJeu.setState({ carriere: { resultats: saison1Bouclee() } });
    const x = S2.find((y) => y.contraintes.includes('sans-nos'))!;
    const i = S2.indexOf(x);
    useJeu.setState({ carriere: { resultats: { ...saison1Bouclee(), ...Object.fromEntries(S2.slice(0, i).map((y) => [y.id, reussi()])) } } });
    useDrive.getState().lancerRendezVous(x, i + 1, S2.length);
    useDrive.getState().terminerCourse(courseDe(x, 1, vehiculeDe(x), { nos: 2 }));
    expect(verdictDe(useDrive.getState().fin)).toMatchObject({ reussi: false, raison: 'contrainte', manquees: ['sans-nos'], prime: 0, saisonNumero: 2, numero: i + 1, total: 12 });
    expect(useJeu.getState().carriere.resultats[x.id]).toEqual({ reussi: false, essais: 1, meilleurTemps: null, medaille: null });
    useDrive.getState().terminerCourse(courseDe(x, 1, vehiculeDe(x)));
    const fin = useDrive.getState().fin!;
    expect(verdictDe(fin)).toMatchObject({ reussi: true, prime: x.prime, dejaReussi: false });
    expect(fin.gains.detail.at(-1)).toEqual({ motif: motifPrime(i + 1, 2), dollars: x.prime });
    expect(useJeu.getState().carriere.resultats[x.id]).toMatchObject({ reussi: true, essais: 2, meilleurTemps: 1, medaille: 'or' });
    // Rejouée depuis la liste de la saison : pas de seconde prime, la meilleure médaille reste.
    useDrive.getState().terminerCourse(courseDe(x, 9999, vehiculeDe(x)));
    expect(verdictDe(useDrive.getState().fin)).toMatchObject({ dejaReussi: true, prime: 0 });
    expect(useJeu.getState().carriere.resultats[x.id]).toMatchObject({ reussi: true, essais: 3, meilleurTemps: 1, medaille: 'or' });
  });

  it('un rendez-vous de la saison 1 rejoué une fois la saison 2 ouverte : la médaille monte, pas de prime, « Course suivante » mène à la saison 2', async () => {
    const { useDrive, useJeu, verdictDe } = await lancer();
    useJeu.setState({ carriere: { resultats: saison1Bouclee() } });
    useDrive.getState().lancerRendezVous(S1[2]!, 3, 12);
    useDrive.getState().terminerCourse(courseDe(S1[2]!, 1, 'concept'));
    expect(verdictDe(useDrive.getState().fin)).toMatchObject({ reussi: true, dejaReussi: true, prime: 0, suivant: S2[0], suivantSaison: 2, suivantNumero: 1 });
    expect(useJeu.getState().carriere.resultats[S1[2]!.id]?.medaille).toBe('or');
  });

  it('l’écran de fin du dernier de la saison 1 : saison bouclée, la saison 2 s’ouvre, « Course suivante » y mène ; au tout dernier, une suite viendra', async () => {
    const { useDrive, useJeu, boutonsDeFin, verdictDe } = await lancer();
    const { FinCourseVue } = await import('../../src/ui/drive/FinCourseVue.tsx');
    const rendre = () => renderToStaticMarkup(createElement(FinCourseVue, { bilan: useDrive.getState().fin!, onRejouer: () => undefined, onGarage: () => undefined }));
    useJeu.setState({ carriere: { resultats: Object.fromEntries(S1.slice(0, -1).map((y) => [y.id, reussi()])) } });
    useDrive.getState().lancerRendezVous(S1.at(-1)!, 12, 12);
    useDrive.getState().terminerCourse(courseDe(S1.at(-1)!, 1, 'concept'));
    let html = rendre();
    expect(html).toContain('Saison 1 bouclée');
    expect(html).toContain(`La saison 2, « ${SAISONS[1]!.titre} », s’ouvre`);
    expect(html).toContain('Saison 2, premier rendez-vous');
    expect(html).toContain(S2[0]!.titre);
    expect(boutonsDeFin(verdictDe(useDrive.getState().fin))[0]?.detail).toMatch(/^Saison 2 · rendez-vous 1 · /);
    // Le tout dernier : plus de « Course suivante », une suite viendra (sans date).
    useJeu.setState({ carriere: { resultats: { ...saison1Bouclee(), ...Object.fromEntries(S2.slice(0, -1).map((y) => [y.id, reussi()])) } } });
    useDrive.getState().leave();
    useDrive.getState().lancerRendezVous(S2.at(-1)!, 12, 12);
    useDrive.getState().terminerCourse(courseDe(S2.at(-1)!, 1, vehiculeDe(S2.at(-1)!)));
    html = rendre();
    expect(html).toContain('Carrière bouclée');
    expect(html).toContain('Une suite viendra');
    expect(html).not.toContain('Course suivante');
  });

  it('le dernier de la saison 2 boucle la carrière et accorde son haut fait ; tout en or, le second', async () => {
    const { useDrive, useJeu, verdictDe } = await lancer();
    const fin = S2.at(-1)!;
    useJeu.setState({ carriere: { resultats: { ...saison1Bouclee(), ...Object.fromEntries(S2.slice(0, -1).map((y) => [y.id, reussi('or', 30)])) } } });
    useDrive.getState().lancerRendezVous(fin, 12, 12);
    useDrive.getState().terminerCourse(courseDe(fin, 1, vehiculeDe(fin)));
    const bilan = useDrive.getState().fin!;
    expect(verdictDe(bilan)).toMatchObject({ reussi: true, saisonBouclee: true, bouclee: SAISONS.length === 2, prime: fin.prime });
    expect(bilan.hautsFaits.map((h) => h.id)).toEqual(expect.arrayContaining(['saison-2-bouclee', 'saison-2-en-or']));
    expect(useJeu.getState().articles['sticker-couronne-laurier']).toBe(true);
    expect(useJeu.getState().articles['sticker-coupe-or']).toBe(true);
    expect(saisonEnOr(useJeu.getState().carriere, SAISONS[1]!)).toBe(true);
  });
});
