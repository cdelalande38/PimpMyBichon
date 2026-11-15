// La sauvegarde des réglages, de bout en bout : Zustand → idb-keyval → IndexedDB (simulé).
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, get, set } from 'idb-keyval';
import { beforeEach, describe, expect, it, vi } from 'vitest';

type StoreModule = typeof import('../../src/state/store.ts');

/** Simule un lancement de l'app : le module est rechargé, la sauvegarde est relue. */
async function launch(): Promise<StoreModule['useSettings']> {
  vi.resetModules();
  const { useSettings } = await import('../../src/state/store.ts');
  await vi.waitFor(() => expect(useSettings.getState().hydrated).toBe(true));
  return useSettings;
}

function db() {
  return createStore('pimpmybichon', 'kv');
}

async function savedSettings(): Promise<unknown> {
  const raw = await get<string>('pmb-reglages', db());
  return raw ? (JSON.parse(raw) as { state: unknown }).state : null;
}

beforeEach(() => {
  // Chaque test repart d'un téléphone neuf : une base IndexedDB vierge.
  globalThis.indexedDB = new IDBFactory();
});

describe('store des réglages', () => {
  it('démarre sur les valeurs d’origine', async () => {
    const useSettings = await launch();
    const { quality, autoRotate, textSize, autoPlay } = useSettings.getState();
    expect({ quality, autoRotate, textSize, autoPlay }).toEqual({
      quality: 'auto',
      autoRotate: true,
      textSize: 'normal',
      autoPlay: true,
    });
  });

  it('sauvegarde à chaque changement et retrouve tout au lancement suivant', async () => {
    const first = await launch();
    first.getState().change('textSize', 'tres-grand');
    first.getState().change('quality', 'eco');
    first.getState().change('autoRotate', false);
    first.getState().change('autoPlay', false);
    await vi.waitFor(async () =>
      expect(await savedSettings()).toEqual({
        quality: 'eco',
        autoRotate: false,
        textSize: 'tres-grand',
        autoPlay: false,
      }),
    );

    const second = await launch();
    const { quality, autoRotate, textSize, autoPlay } = second.getState();
    expect({ quality, autoRotate, textSize, autoPlay }).toEqual({
      quality: 'eco',
      autoRotate: false,
      textSize: 'tres-grand',
      autoPlay: false,
    });
  });

  it('ne sauvegarde que les réglages, pas l’état interne', async () => {
    const useSettings = await launch();
    useSettings.getState().change('quality', 'max');
    await vi.waitFor(async () => expect(await savedSettings()).toMatchObject({ quality: 'max' }));
    expect(Object.keys((await savedSettings()) as object).sort()).toEqual([
      'autoPlay',
      'autoRotate',
      'quality',
      'textSize',
    ]);
  });

  it('survit à une sauvegarde abîmée', async () => {
    await set(
      'pmb-reglages',
      JSON.stringify({ state: { quality: 'ultra', textSize: 42 }, version: 1 }),
      db(),
    );
    const useSettings = await launch();
    expect(useSettings.getState().quality).toBe('auto');
    expect(useSettings.getState().textSize).toBe('normal');
  });

  it('survit à une sauvegarde illisible', async () => {
    await set('pmb-reglages', '{pas du json', db());
    const useSettings = await launch();
    expect(useSettings.getState().hydrated).toBe(true);
    expect(useSettings.getState().quality).toBe('auto');
  });

  it('relit une sauvegarde d’une version plus ancienne sans rien casser', async () => {
    await set(
      'pmb-reglages',
      JSON.stringify({ state: { quality: 'max', inconnu: true }, version: 0 }),
      db(),
    );
    const useSettings = await launch();
    expect(useSettings.getState().quality).toBe('max');
    expect(useSettings.getState().autoRotate).toBe(true);
    expect(useSettings.getState().autoPlay).toBe(true);
  });

  it('revient à l’origine sur demande', async () => {
    const useSettings = await launch();
    useSettings.getState().change('quality', 'max');
    useSettings.getState().reset();
    expect(useSettings.getState().quality).toBe('auto');
  });
});
