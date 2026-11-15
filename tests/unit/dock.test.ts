// Dock : taille compacte ou agrandie (origine, lecture tolérante, sauvegarde) et recadrage de la
// scène au-dessus du dock agrandi.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, get, set } from 'idb-keyval';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCK_TOP_MARGIN, dockShift, easeOutCubic } from '../../src/scene/fit.ts';
import { DEFAULT_DOCK, DOCK_KEY, sanitizeDock } from '../../src/state/dock.ts';

describe('taille du dock', () => {
  it('part du dock compact', () => {
    expect(DEFAULT_DOCK).toEqual({ expanded: false });
    expect(Object.isFrozen(DEFAULT_DOCK)).toBe(true);
  });

  it('lit une sauvegarde abîmée sans casser : seul un « vrai » explicite agrandit', () => {
    expect(sanitizeDock({ expanded: true })).toEqual({ expanded: true });
    for (const raw of [null, undefined, 42, 'agrandi', [], {}, { expanded: 'true' }, { expanded: 1 }, { expanded: false }]) {
      expect(sanitizeDock(raw), JSON.stringify(raw)).toEqual({ expanded: false });
    }
  });
});

describe('sauvegarde du dock', () => {
  type DockModule = typeof import('../../src/state/dock.ts');

  async function launch(): Promise<DockModule['useDock']> {
    vi.resetModules();
    const { useDock } = await import('../../src/state/dock.ts');
    await vi.waitFor(() => expect(useDock.getState().hydrated).toBe(true));
    return useDock;
  }

  const db = () => createStore('pimpmybichon', 'kv');

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('retrouve le dock agrandi au lancement suivant, sans sa mesure à l’écran', async () => {
    const first = await launch();
    expect(first.getState().expanded).toBe(false);
    first.getState().toggle();
    first.getState().setTop(320);
    await vi.waitFor(async () => {
      const raw = await get<string>(DOCK_KEY, db());
      expect(raw ? (JSON.parse(raw) as { state: unknown }).state : null).toEqual({ expanded: true });
    });

    const second = await launch();
    expect(second.getState().expanded).toBe(true);
    expect(second.getState().top).toBeNull();

    second.getState().setExpanded(false);
    await vi.waitFor(async () => {
      const raw = await get<string>(DOCK_KEY, db());
      expect(raw ? (JSON.parse(raw) as { state: unknown }).state : null).toEqual({ expanded: false });
    });
  });

  it('une sauvegarde illisible rouvre le dock compact', async () => {
    await set(DOCK_KEY, JSON.stringify({ state: { expanded: '<script>' }, version: 1 }), db());
    const useDock = await launch();
    expect(useDock.getState().expanded).toBe(false);
  });

  it('une sauvegarde d’une autre version passe par la lecture tolérante', async () => {
    await set(DOCK_KEY, JSON.stringify({ state: { expanded: true, extra: 1 }, version: 0 }), db());
    const useDock = await launch();
    expect(useDock.getState().expanded).toBe(true);
  });
});

describe('recadrage au-dessus du dock agrandi', () => {
  it('ne bouge rien sans dock agrandi', () => {
    expect(dockShift(844, null)).toBe(0);
    expect(dockShift(844, Number.NaN)).toBe(0);
    expect(dockShift(0, 300)).toBe(0);
  });

  it('amène la cible au milieu de la partie libre', () => {
    const height = 844;
    const top = 340;
    const shift = dockShift(height, top);
    // La cible, au centre de l'image, remonte de `shift` pixels.
    expect(height / 2 - shift).toBeCloseTo((height * DOCK_TOP_MARGIN + top) / 2, 0);
    expect(shift).toBeGreaterThan(0);
  });

  it('ne descend jamais la vue, et borne un haut de dock hors de l’écran', () => {
    expect(dockShift(844, 844)).toBe(0);
    expect(dockShift(844, 2000)).toBe(0);
    expect(dockShift(844, -50)).toBe(dockShift(844, 0));
  });

  it('la courbe de transition part de 0 et arrive à 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});
