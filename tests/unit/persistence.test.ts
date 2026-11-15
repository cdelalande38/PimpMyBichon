// Sauvegarde partagée entre pages (INT-1) : l'app ouverte deux fois ne doit rien effacer. Deux
// « pages » partagent ici une même table ; chacune a son stockage et son store, comme deux onglets.
import { describe, expect, it } from 'vitest';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { createSharedStorage, mergeChanges, type Json, type SharedStorage } from '../../src/state/persistence.ts';

describe('fusion à trois', () => {
  const base: Json = { current: 'cox', builds: { cox: { paints: { caisse: { color: '#111111' } } } }, recents: ['#111111'] };

  it('ce que la page n’a pas touché vient de la sauvegarde', () => {
    const stored: Json = { current: 'cox', builds: { cox: { paints: { caisse: { color: '#111111' } } }, van: { paints: { toit: { color: '#ff0000' } } } }, recents: ['#ff0000', '#111111'] };
    const local: Json = { ...base, current: 'van' };
    expect(mergeChanges(base, local, stored)).toEqual({ ...stored, current: 'van' });
  });

  it('ce que la page a changé l’emporte, champ par champ', () => {
    const stored: Json = { current: 'cox', builds: { cox: { paints: { caisse: { color: '#111111', finish: 'candy' } } } }, recents: ['#111111'] };
    const local: Json = { ...base, builds: { cox: { paints: { caisse: { color: '#222222' } } } } };
    expect(mergeChanges(base, local, stored)).toEqual({ ...base, builds: { cox: { paints: { caisse: { color: '#222222', finish: 'candy' } } } } });
  });

  it('une clé retirée par la page disparaît ; un tableau changé est remplacé en entier', () => {
    const stored: Json = { ...base, recents: ['#333333', '#111111'] };
    const local: Json = { current: 'cox', builds: {}, recents: ['#444444', '#111111'] };
    expect(mergeChanges(base, local, stored)).toEqual({ current: 'cox', builds: {}, recents: ['#444444', '#111111'] });
  });

  it('rien de changé : la sauvegarde telle quelle', () => {
    const stored: Json = { current: 'van', builds: {}, recents: [] };
    expect(mergeChanges(base, base, stored)).toBe(stored);
  });
});

interface Essai {
  current: string;
  paints: Record<string, string>;
  recents: string[];
  /** Hors sauvegarde, comme l'état du modèle dans la scène. */
  status: string;
  hydrated: boolean;
}

const KEY = 'pmb-essai';
const ORIGIN: Pick<Essai, 'current' | 'paints' | 'recents'> = { current: 'cox', paints: {}, recents: [] };

/** Lecture tolérante, comme celle des stores de l'app. */
function sanitize(raw: unknown): Pick<Essai, 'current' | 'paints' | 'recents'> {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  const paints: Record<string, string> = {};
  if (typeof source.paints === 'object' && source.paints !== null) {
    for (const [zone, color] of Object.entries(source.paints)) if (typeof color === 'string' && /^#[0-9a-f]{6}$/.test(color)) paints[zone] = color;
  }
  return {
    current: typeof source.current === 'string' ? source.current : ORIGIN.current,
    paints,
    recents: Array.isArray(source.recents) ? source.recents.filter((item): item is string => typeof item === 'string') : [],
  };
}

function makeStore(shared: SharedStorage) {
  const store = create<Essai>()(
    persist((): Essai => ({ ...ORIGIN, status: 'chargement', hydrated: false }), {
      name: KEY,
      version: 1,
      storage: createJSONStorage(() => shared.storage),
      partialize: ({ current, paints, recents }) => ({ current, paints, recents }),
      merge: (persisted, current) => ({ ...current, ...sanitize(persisted) }),
      onRehydrateStorage: () => () => {
        store.setState({ hydrated: true });
      },
    }),
  );
  shared.share(store);
  return store;
}

/** Laisse passer les lectures et écritures en attente (la table répond de façon asynchrone). */
async function settle(): Promise<void> {
  for (let round = 0; round < 20; round += 1) await new Promise((done) => setTimeout(done, 0));
}

/**
 * Deux pages sur une même table. `announce` : les écritures de l'une sont annoncées à l'autre
 * (le canal entre onglets) ; sans, l'autre page est un vieil onglet sourd.
 */
async function twoPages(announce: boolean, initial?: Json) {
  const table = new Map<string, string>();
  if (initial !== undefined) table.set(KEY, JSON.stringify(initial));
  let writes = 0;
  const backend = {
    get: async (name: string) => table.get(name) ?? null,
    update: async (name: string, compute: (raw: string | null) => string | null) => {
      const next = compute(table.get(name) ?? null);
      if (next === null) return false;
      writes += 1;
      table.set(name, next);
      return true;
    },
    del: async (name: string) => {
      table.delete(name);
    },
  };
  const pages: SharedStorage[] = [];
  const tell = (from: number) => (name: string) => {
    if (announce) void pages[1 - from]?.refresh(name);
  };
  const first = createSharedStorage(backend, tell(0));
  const second = createSharedStorage(backend, tell(1));
  pages.push(first, second);
  const a = makeStore(first);
  const b = makeStore(second);
  await settle();
  return {
    a,
    b,
    pages,
    saved: () => (JSON.parse(table.get(KEY) ?? 'null') as { state: Json } | null)?.state,
    writes: () => writes,
  };
}

describe('deux pages sur la même sauvegarde', () => {
  it('un vieil onglet sourd n’efface pas ce que l’autre a enregistré, puis le reprend', async () => {
    const { a, b, saved } = await twoPages(false, { state: ORIGIN, version: 1 });
    a.setState({ paints: { caisse: '#ff0000' }, recents: ['#ff0000'] });
    await settle();
    expect(saved()).toEqual({ current: 'cox', paints: { caisse: '#ff0000' }, recents: ['#ff0000'] });
    // B n'a rien entendu : sa mémoire est restée à l'origine. Il change de véhicule.
    expect(b.getState().paints).toEqual({});
    b.setState({ current: 'van' });
    await settle();
    expect(saved()).toEqual({ current: 'van', paints: { caisse: '#ff0000' }, recents: ['#ff0000'] });
    // Son écriture a trouvé du neuf : il a relu la sauvegarde.
    expect(b.getState()).toMatchObject({ current: 'van', paints: { caisse: '#ff0000' }, recents: ['#ff0000'], status: 'chargement' });
  });

  it('chacun garde ce qu’il a touché, le dernier qui écrit une même valeur gagne', async () => {
    const { a, b, saved } = await twoPages(false, { state: ORIGIN, version: 1 });
    a.setState({ paints: { caisse: '#ff0000' } });
    b.setState({ paints: { toit: '#00ff00' } });
    await settle();
    expect(saved()).toMatchObject({ paints: { caisse: '#ff0000', toit: '#00ff00' } });
    a.setState((state) => ({ paints: { ...state.paints, toit: '#0000ff' } }));
    await settle();
    expect(saved()).toMatchObject({ paints: { caisse: '#ff0000', toit: '#0000ff' } });
  });

  it('une écriture annoncée met l’autre page à jour, sans écho ni boucle', async () => {
    const { a, b, pages, writes, saved } = await twoPages(true, { state: ORIGIN, version: 1 });
    const before = writes();
    a.setState({ paints: { caisse: '#ff0000' }, recents: ['#ff0000'] });
    await settle();
    expect(b.getState()).toMatchObject({ paints: { caisse: '#ff0000' }, recents: ['#ff0000'], hydrated: true });
    expect(writes() - before, 'une seule écriture').toBe(1);
    b.setState({ current: 'van' });
    await settle();
    expect(a.getState().current).toBe('van');
    expect(saved()).toEqual({ current: 'van', paints: { caisse: '#ff0000' }, recents: ['#ff0000'] });
    expect(writes() - before).toBe(2);
    // Au repos : les pages redeviennent visibles, rien ne bouge, rien ne s'écrit.
    await Promise.all(pages.map((page) => page.refreshAll()));
    await settle();
    expect(writes() - before).toBe(2);
  });

  it('aucune écriture quand rien de sauvegardé ne change, ni à la relecture', async () => {
    const { a, b, pages, writes } = await twoPages(true, { state: ORIGIN, version: 1 });
    expect(writes(), 'le démarrage relit sans réécrire').toBe(0);
    a.setState({ status: 'pret' });
    b.setState({ status: 'erreur' });
    await settle();
    await Promise.all(pages.map((page) => page.refreshAll()));
    await settle();
    expect(writes()).toBe(0);
  });

  it('des changements rapprochés se regroupent, l’aller-retour compris', async () => {
    const { a, writes, saved } = await twoPages(false, { state: ORIGIN, version: 1 });
    a.setState({ current: 'van' });
    a.setState({ current: 'cox' });
    await settle();
    expect(writes()).toBe(0);
    a.setState({ current: 'van' });
    a.setState({ current: 'moto' });
    await settle();
    expect(writes()).toBe(1);
    expect(saved()).toMatchObject({ current: 'moto' });
  });

  it('la lecture tolérante reste : une sauvegarde abîmée retombe sur l’origine, sans boucle', async () => {
    const { a, b, writes } = await twoPages(true, { state: { current: 42, paints: { caisse: 'rouge' }, recents: 'non' }, version: 1 });
    expect(a.getState()).toMatchObject({ current: 'cox', paints: {}, recents: [], hydrated: true });
    expect(b.getState()).toMatchObject({ current: 'cox', paints: {}, recents: [] });
    a.setState({ paints: { caisse: '#ff0000' } });
    await settle();
    expect(b.getState().paints).toEqual({ caisse: '#ff0000' });
    const after = writes();
    await settle();
    expect(writes()).toBe(after);
  });

  it('premier lancement : la première écriture pose l’origine, et chaque page garde ce qu’elle a fait', async () => {
    const { a, b, saved } = await twoPages(false);
    a.setState({ paints: { caisse: '#ff0000' } });
    await settle();
    b.setState({ recents: ['#00ff00'] });
    await settle();
    expect(saved()).toEqual({ current: 'cox', paints: { caisse: '#ff0000' }, recents: ['#00ff00'] });
  });
});
