// Décor de la sortie de nuit et OpenStreetMap (src/drive/scene/decor.ts, enseignes.ts) : géométrie
// du palmier, mots des enseignes de commerces (un par genre, aucun nom), enseignes d'ambiance.

import { describe, expect, it } from 'vitest';
import { MAP_SHOP_KINDS } from '../../src/data/mapTypes.ts';
import { palmGeometry } from '../../src/drive/scene/decor.ts';
import { DECOR_SIGN_CELLS, SHOP_SIGNS, shopSignCell, SIGN_ITEMS } from '../../src/drive/scene/enseignes.ts';

describe('décor des cartes enrichies par OpenStreetMap', () => {
  it('le palmier est une silhouette légère : stipe et sept palmes vues des deux faces', () => {
    const g = palmGeometry();
    const tri = g.getAttribute('position').count / 3;
    expect(g.getAttribute('normal')).toBeDefined();
    expect(tri).toBeGreaterThan(30);
    expect(tri).toBeLessThan(60);
    g.computeBoundingBox();
    expect(g.boundingBox?.max.y).toBeGreaterThan(7.5);
    g.dispose();
  });

  it('chaque genre de commerce a son mot dans l’atlas, et l’atlas tient en 4 × 6 cases', () => {
    expect(SIGN_ITEMS.length).toBeLessThanOrEqual(24);
    for (const k of MAP_SHOP_KINDS) {
      expect(SIGN_ITEMS[shopSignCell(k)]).toBe(SHOP_SIGNS[k]);
      expect(SHOP_SIGNS[k]).toMatch(/^[A-ZÀ-Ý]+$/);
    }
  });

  it('les enseignes d’ambiance ne se font pas passer pour un commerce', () => {
    const commerces = new Set(Object.values(SHOP_SIGNS));
    for (const c of DECOR_SIGN_CELLS) {
      expect(c).toBeGreaterThanOrEqual(0);
      expect(commerces.has(SIGN_ITEMS[c] ?? '')).toBe(false);
    }
  });
});
