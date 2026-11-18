// Le store du jeu : sauvegarde dans IndexedDB, relecture tolérante, achat, clôture enregistrée, remise à zéro.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, get, set } from 'idb-keyval';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseHash, routeToHash } from '../../src/app/router.ts';
import type { ResultatCourse } from '../../src/jeu/contrat.ts';

const KEY = 'pmb-jeu';
const db = () => createStore('pimpmybichon', 'kv');

const COURSE: ResultatCourse = {
  carte: 'carte-a',
  depart: 'depart-a',
  vehicule: 'vehicule-a',
  format: 'tour1',
  meteo: 'sec',
  moment: 'nuit',
  temps: 95,
  tours: [95],
  ancienRecord: null,
  medaille: 'bronze',
  stats: { distance: 3000, vitesseMax: 130, glisse: 5, chocs: 0, nos: 1 },
};

async function lancer() {
  vi.resetModules();
  const store = await import('../../src/state/jeu.ts');
  const bilan = await import('../../src/jeu/bilan.ts');
  await vi.waitFor(() => expect(store.useJeu.getState().hydrated).toBe(true));
  return { ...store, ...bilan };
}

async function sauvegarde(): Promise<Record<string, unknown> | null> {
  const raw = await get<string>(KEY, db());
  return raw ? ((JSON.parse(raw) as { state: Record<string, unknown> }).state) : null;
}

describe('store du jeu', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('démarre vide ; seul le pack de départ est possédé', async () => {
    const { useJeu, possede } = await lancer();
    expect(useJeu.getState().solde).toBe(0);
    expect(possede('pack-depart')).toBe(true);
    expect(possede('pack-flammes')).toBe(false);
  });

  it('clôture une course : le bilan est rendu, l’état et la sauvegarde suivent, une seconde clôture du même résultat ne paie pas deux fois', async () => {
    const { useJeu, cloturerCourse } = await lancer();
    const bilan = cloturerCourse(COURSE);
    expect(bilan.gains.dollars).toBe(40 + 15 + 20);
    expect(bilan.hautsFaits.map((h) => h.id)).toContain('premiere-course');
    expect(useJeu.getState().solde).toBe(bilan.solde);
    expect(cloturerCourse(COURSE)).toBe(bilan);
    expect(useJeu.getState().solde).toBe(bilan.solde);
    await vi.waitFor(async () => expect((await sauvegarde())?.solde).toBe(bilan.solde));
    const dernier = await sauvegarde();
    expect((dernier?.cumuls as { courses: number }).courses).toBe(1);
  });

  it('un achat est gardé d’un lancement à l’autre ; un solde insuffisant ne touche à rien', async () => {
    await set(KEY, JSON.stringify({ state: { solde: 200 }, version: 1 }), db());
    const premier = await lancer();
    expect(premier.useJeu.getState().solde).toBe(200);
    expect(premier.useJeu.getState().acheter('pack-course')).toMatchObject({ ok: false, raison: 'insuffisant', manque: 100 });
    expect(premier.useJeu.getState().solde).toBe(200);
    const issue = premier.useJeu.getState().acheter('pack-flammes');
    expect(issue.ok).toBe(true);
    expect((issue.ok && issue.hautsFaits?.map((h) => h.id)) || []).toEqual(['premier-achat']);
    expect(premier.useJeu.getState().solde).toBe(50 + 25);
    await vi.waitFor(async () => expect((await sauvegarde())?.solde).toBe(75));

    const second = await lancer();
    expect(second.useJeu.getState().solde).toBe(75);
    expect(second.possede('pack-flammes')).toBe(true);
    expect(second.useJeu.getState().hautsFaits).toEqual({ 'premier-achat': true });
  });

  it('relit une sauvegarde venue d’ailleurs sans tomber', async () => {
    await set(KEY, JSON.stringify({ state: { solde: 'riche', articles: { 'pack-fantome': true, 'pack-atelier': true }, cumuls: 12 }, version: 1 }), db());
    const { useJeu } = await lancer();
    expect(useJeu.getState().solde).toBe(0);
    expect(useJeu.getState().articles).toEqual({ 'pack-atelier': true });
    await set(KEY, '{pas du json', db());
    expect((await lancer()).useJeu.getState().solde).toBe(0);
  });

  it('la remise à zéro efface la progression', async () => {
    await set(KEY, JSON.stringify({ state: { solde: 500, articles: { 'pack-course': true } }, version: 1 }), db());
    const { useJeu, possede } = await lancer();
    useJeu.getState().remettreAZero();
    expect(useJeu.getState().solde).toBe(0);
    expect(possede('pack-course')).toBe(false);
    await vi.waitFor(async () => expect((await sauvegarde())?.solde).toBe(0));
  });
});

describe('route du jeu', () => {
  it('#/jeu ouvre la rubrique Jeu du panneau Atelier', () => {
    expect(parseHash('#/jeu')).toEqual({ name: 'jeu' });
    expect(routeToHash({ name: 'jeu' })).toBe('#/jeu');
  });
});
