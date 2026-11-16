// Catalogue des cartes de sortie (src/data/maps.ts) : découvert dans les manifestes, validé, trié,
// sans identifiant écrit dans le code ; crédits obligatoires ; route validée avant d'être roulée.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMapCatalog, creditLine, mapById, mapFileUrl, MAPS, resolveMap, resolveStart, validateMapManifest, validateRoute } from '../../src/data/maps.ts';

const GOOD = {
  id: 'essai',
  name: 'Route d’essai',
  kind: 'route',
  order: 5,
  route: 'route.json',
  credits: [{ source: 'IGN, BD TOPO', licence: 'Licence Ouverte 2.0', date: '2026-11' }],
};

describe('catalogue des cartes', () => {
  it('lit les manifestes livrés : au moins une carte, chacune créditée', () => {
    expect(MAPS.length).toBeGreaterThan(0);
    for (const map of MAPS) {
      expect(map.credits.length, map.id).toBeGreaterThan(0);
      expect(creditLine(map.credits[0]!)).toMatch(/ · .+ · \d{4}-\d{2}$/);
    }
    expect(resolveMap(null)).toBe(MAPS[0]);
    expect(resolveMap('inconnue')).toBe(MAPS[0]);
    expect(mapById(MAPS[0]!.id)).toBe(MAPS[0]);
  });

  it('trie par rang, puis par identifiant ; un catalogue vide n’est pas une erreur', () => {
    const catalog = buildMapCatalog({
      '/x/maps/b/map.json': { ...GOOD, id: 'b', order: 2 },
      '/x/maps/a/map.json': { ...GOOD, id: 'a', order: 2 },
      '/x/maps/c/map.json': { ...GOOD, id: 'c', order: 1 },
    });
    expect(catalog.map((map) => map.id)).toEqual(['c', 'a', 'b']);
    expect(buildMapCatalog({})).toEqual([]);
    expect(resolveMap(null, [])).toBeUndefined();
  });

  it('refuse un manifeste faux, avec le chemin du fichier', () => {
    expect(() => validateMapManifest({ ...GOOD, credits: [] }, 'essai')).toThrow(/public\/assets\/maps\/essai\/map\.json.*credits/);
    expect(() => validateMapManifest({ ...GOOD, id: 'autre' }, 'essai')).toThrow(/dossier/);
    expect(() => validateMapManifest({ ...GOOD, route: '../../secret.json' }, 'essai')).toThrow(/route/);
    expect(() => validateMapManifest({ ...GOOD, route: 'https://ailleurs/route.json' }, 'essai')).toThrow(/route/);
    expect(() => validateMapManifest({ ...GOOD, kind: 'autoroute' }, 'essai')).toThrow(/kind/);
    expect(() => validateMapManifest({ ...GOOD, credits: [{ source: 'x', licence: 'y', date: 'hier' }] }, 'essai')).toThrow(/date/);
    expect(validateMapManifest(GOOD, 'essai').name).toBe('Route d’essai');
  });

  it('les fichiers d’une carte sont servis par l’app, sous son socle', () => {
    expect(mapFileUrl({ id: 'essai' }, 'route.json')).toMatch(/assets\/maps\/essai\/route\.json$/);
    expect(mapFileUrl({ id: 'essai' }, 'route.json')).not.toMatch(/^https?:/);
  });
});

describe('route d’une carte', () => {
  const route = {
    format: 'pmb-carte',
    version: 1,
    id: 'essai',
    loop: false,
    length: 4,
    step: 2,
    rail: [0, 0, 0, 2, 0, 0, 4, 0, 0],
    sections: [{ from: 0, to: 4, ground: 'sol', urban: false, lanes: 2, width: 7 }],
    chunks: [],
    starts: [{ id: 'a', label: 'A', at: 0 }, { id: 'b', label: 'B', at: 2 }],
    far: null,
  };

  it('valide la forme, et dit ce qui ne va pas', () => {
    expect(validateRoute(route, { id: 'essai' }).length).toBe(4);
    expect(() => validateRoute({ ...route, rail: [0, 0] }, { id: 'essai' })).toThrow(/rail/);
    expect(() => validateRoute({ ...route, length: 400 }, { id: 'essai' })).toThrow(/length/);
    expect(() => validateRoute({ ...route, id: 'autre' }, { id: 'essai' })).toThrow(/id/);
    expect(() => validateRoute({ ...route, sections: [{ from: 1, to: 4, ground: 'sol', urban: false, lanes: 2, width: 7 }] }, { id: 'essai' })).toThrow(/sections/);
    expect(() => validateRoute(null, { id: 'essai' })).toThrow(/objet/);
  });

  it('départ : celui choisi, sinon le premier, sinon le début du parcours', () => {
    expect(resolveStart(route, 'b').at).toBe(2);
    expect(resolveStart(route, 'inconnu').id).toBe('a');
    expect(resolveStart({ starts: [] }, null).at).toBe(0);
  });

  const real = new URL(`../../public/assets/maps/${MAPS[0]?.id ?? 'aucune'}/route.json`, import.meta.url);
  it.skipIf(!existsSync(real))('la route fabriquée de la première carte passe la validation', () => {
    const map = MAPS[0]!;
    const checked = validateRoute(JSON.parse(readFileSync(real, 'utf8')), map);
    expect(checked.starts.length).toBeGreaterThan(0);
  });
});
