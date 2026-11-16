// Cartes et OpenStreetMap (tools/maps/fournisseurs/osm.mjs, enrichissement.mjs, build.mjs, check.mjs) :
// lecture d'une réponse Overpass (routes découpées aux carrefours, nature des commerces sans leur nom),
// enrichissement limité au couloir, usage par le fabricant (vitesse par section, lampadaires à leur
// place, arbres et palmiers, feux, passages piétons, glissières, murs, commerces, étages et toits), et
// contrôle qu'aucun nom de commerce n'arrive dans les fichiers d'une carte.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { buildMap } from '../../tools/maps/build.mjs';
import { nomsInterdits, validerRoute } from '../../tools/maps/check.mjs';
import { compter, empreinteNom, enrichirTuiles, filtrerOverpass, MAP_SHOP_KINDS as GENRES_OUTIL, normaliserNom, vitessesLeLong } from '../../tools/maps/enrichissement.mjs';
import { decouperRoutes, lireTuile, natureCommerce, vitesseOsm } from '../../tools/maps/fournisseurs/osm.mjs';
import { MAP_SHOP_KINDS, MAP_SHOP_STRIDE, type MapRoute } from '../../src/data/mapTypes.ts';

const dir = mkdtempSync(join(tmpdir(), 'pmb-osm-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Projection d'essai : 1° = 100 000 m, x vers l'est, y vers le nord. */
const proj = { forward: (lon: number, lat: number): [number, number] => [lon * 1e5, lat * 1e5] };
/** Repère d'essai : X = x, Z = −y. */
const rep = { versCarte: (x: number, y: number, z = 0): [number, number, number] => [x, z, -y] };

describe('lecture d’OpenStreetMap', () => {
  it('traduit la nature des commerces en un mot générique, sans rien d’autre', () => {
    expect(natureCommerce({ amenity: 'bar' })).toBe('bar');
    expect(natureCommerce({ amenity: 'fuel' })).toBe('station');
    expect(natureCommerce({ tourism: 'hotel' })).toBe('hotel');
    expect(natureCommerce({ shop: 'clothes' })).toBe('boutique');
    expect(natureCommerce({ amenity: 'bank' })).toBeNull();
    expect(GENRES_OUTIL).toEqual(MAP_SHOP_KINDS);
  });

  it('lit les vitesses limites en km/h', () => {
    expect(vitesseOsm('50')).toBe(50);
    expect(vitesseOsm('30 mph')).toBe(48);
    expect(vitesseOsm('FR:urban')).toBe(50);
    expect(vitesseOsm('none')).toBeNull();
    expect(vitesseOsm(undefined)).toBeNull();
  });

  it('découpe les routes à chaque carrefour (nœud partagé), comme les tronçons de l’IGN', () => {
    const g = (pts: number[][]) => pts.map(([lon, lat]) => ({ lon, lat }));
    const els = [
      { type: 'way', id: 1, nodes: [10, 11, 12], geometry: g([[0, 0], [0.001, 0], [0.002, 0]]), tags: { highway: 'residential', name: 'Rue A', maxspeed: '30', oneway: 'yes' } },
      { type: 'way', id: 2, nodes: [11, 20], geometry: g([[0.001, 0], [0.001, 0.001]]), tags: { highway: 'residential' } },
      { type: 'way', id: 3, nodes: [12, 30], geometry: g([[0.002, 0], [0.003, 0]]), tags: { highway: 'pedestrian' } },
    ];
    const r = decouperRoutes(els, proj);
    expect(r.map((x) => x.id)).toEqual(['1-0', '1-1', '2-0']);
    expect(r[0]).toMatchObject({ nom: 'Rue A', vitesse: 30, sens: 'direct', importance: 5 });
  });

  it('ne lit aucun nom de commerce, de marque ni d’exploitant', () => {
    const t = lireTuile(
      [
        { type: 'node', id: 1, lon: 0.0005, lat: 0.0001, tags: { amenity: 'cafe', name: 'Chez Nomdecafe', brand: 'Marquefictive', operator: 'Exploitantfictif' } },
        { type: 'node', id: 2, lon: 0.0006, lat: 0, tags: { highway: 'street_lamp' } },
        { type: 'node', id: 3, lon: 0.0007, lat: 0.0001, tags: { natural: 'tree', genus: 'Phoenix' } },
      ],
      proj,
    );
    const texte = JSON.stringify(t);
    for (const n of ['Nomdecafe', 'Marquefictive', 'Exploitantfictif']) expect(texte).not.toContain(n);
    expect(t.commerces).toEqual([{ p: [50, 10], genre: 'cafe' }]);
    expect(t.lampadaires).toHaveLength(1);
    expect(t.arbres[0]?.[2]).toBe(3);
  });
});

/** Rue droite de 600 m vers l'est (X), au niveau 0. */
const axe = Array.from({ length: 61 }, (_, i) => [i * 10, 0, 0]);

describe('enrichissement', () => {
  const tuile = {
    routes: [{ id: 'r', points: [[0, 1], [600, 1]], vitesse: 30, voies: 2, sens: 'double', sol: 'sol', couche: 0 }],
    batiments: [],
    eaux: [],
    cote: [],
    bois: [],
    alignements: [{ id: 'al', points: [[100, 30], [170, 30]], genre: 0 }],
    parcs: [],
    barrieres: [{ id: 'b', type: 'glissiere', hauteur: null, points: [[200, -6], [300, -6]] }],
    lampadaires: [[50, -8], [55, -500]],
    arbres: [[120, -40, 3]],
    feux: [[300, 0]],
    passages: [[310, 0, 1], [310, 200, 0]],
    commerces: [{ p: [400, -20], genre: 'bar' }, { p: [400, -900], genre: 'cafe' }],
    pistes: [],
  };
  const o = enrichirTuiles([tuile, tuile], rep, axe, 80, []);

  it('garde ce qui est dans le couloir, une fois (les tuiles se chevauchent), en nombres seulement', () => {
    expect(o.lampadaires).toEqual([50, 8]);
    expect(o.passages).toEqual([310, 0, 1]);
    expect(o.commerces).toEqual([400, 20, MAP_SHOP_KINDS.indexOf('bar')]);
    expect(compter(o)).toMatchObject({ feux: 1, palmiers: 1, glissieres: 1, vitesses: 1 });
    // Alignement de 70 m : un arbre tous les 7 m.
    expect(o.arbres.length / 3).toBeGreaterThanOrEqual(10);
    const textes: string[] = [];
    JSON.stringify(o, (_k, v) => (typeof v === 'string' && textes.push(v), v));
    expect(textes).toEqual([]);
  });

  it('suit la vitesse limite des routes alignées sur la marche, pas des rues qui la croisent', () => {
    const croise = [{ v: 90, p: [300, -50, 300, 50] }];
    expect(vitessesLeLong(axe, croise).every((v) => v === 0)).toBe(true);
    expect(vitessesLeLong(axe, o.routes)[30]).toBe(30);
  });
});

describe('fabrication avec OpenStreetMap', () => {
  const id = 'rue';
  const d = join(dir, 'assets-src', 'maps', id);
  mkdirSync(join(d, 'brut'), { recursive: true });
  const carte = {
    id,
    couloir: { demiLargeur: 80, pasRelief: 10 },
    fabrication: { pasRail: 2, lissagePlan: 6, lissageAltitude: 30, longueurTroncon: 300, pasLampadaires: 15, palmiers: 0 },
    departs: [{ id: 'debut', label: 'Début', debut: true }],
  };
  const suites: number[][] = [];
  const dm: number[] = [];
  for (let j = -12; j <= 12; j += 1) {
    suites.push([j, -12, 85]);
    for (let i = -12; i < 73; i += 1) dm.push(0);
  }
  const grille = (pas: number, n: number) => ({ pas, i0: -2, j0: -Math.floor(n / 2), nx: n, nz: n, dm: new Array(n * n).fill(0) });
  const osm = enrichirTuiles(
    [
      {
        routes: [{ id: 'r', points: [[0, 0], [600, 0]], vitesse: 30, voies: 2, sens: 'double', sol: 'sol', couche: 0 }],
        batiments: [{ id: 'b', anneau: [[200, -15], [212, -15], [212, -25], [200, -25]], toit: 2, etages: 4, couleur: null }],
        eaux: [],
        cote: [],
        bois: [],
        alignements: [],
        parcs: [{ id: 'p', anneaux: [[[400, -20], [460, -20], [460, -60], [400, -60]]] }],
        barrieres: [
          { id: 'g', type: 'glissiere', hauteur: null, points: [[100, -6.5], [200, -6.5]] },
          { id: 'm', type: 'mur', hauteur: 1.5, points: [[300, 20], [360, 20]] },
        ],
        lampadaires: [[60, -6], [90, 0]],
        arbres: [[150, -30, 3], [160, -30, 0]],
        feux: [[300, 0]],
        passages: [[320, 0, 1]],
        commerces: [{ p: [500, -14], genre: 'cafe' }, { p: [502, -14], genre: 'bar' }],
        pistes: [],
      },
    ],
    rep,
    axe,
    80,
    [{ a: [200, 15, 212, 15, 212, 25, 200, 25] }],
  );
  const donnees = {
    format: 'pmb-carte-donnees',
    version: 1,
    id,
    repere: { altitude: 0 },
    axe: { points: axe.flat(), rang: axe.map(() => 0), troncons: [{ largeur: 7, voies: 2, sol: 'sol', urbain: true, nom: 'Rue d’essai' }] },
    voisines: [],
    lacs: [],
    batiments: [{ h: null, e: null, z: null, n: 'OSM', u: 'Résidentiel', a: [200, 15, 212, 15, 212, 25, 200, 25] }],
    arbres: [],
    couloir: { pas: 10, suites, dm },
    lointain: { proche: grille(100, 12), loin: grille(300, 6) },
    osm,
  };
  writeFileSync(join(d, 'carte.json'), JSON.stringify(carte));
  writeFileSync(join(d, 'donnees.json'), JSON.stringify(donnees));
  const { route, mesures } = buildMap(id, { srcDir: join(dir, 'assets-src', 'maps') });
  const r = route as MapRoute;

  it('tient le contrat et porte la vitesse limite par section', () => {
    expect(validerRoute(r, id)).toEqual([]);
    expect(r.sections.every((s) => s.speed === 30)).toBe(true);
  });

  it('pose lampadaires, arbres, palmiers et feux d’OSM, et garde le semis loin des lampadaires connus', () => {
    const n = (k: 'lampadaire' | 'feu' | 'palmier' | 'arbre') => r.chunks.reduce((s, c) => s + (c.instances[k]?.length ?? 0) / 5, 0);
    expect(n('feu')).toBe(1);
    expect(n('palmier')).toBe(1);
    expect(mesures.osm).toMatchObject({ lampadairesOsm: 2, feux: 1, passages: 1, commerces: 1, batimentsEtages: 1, toitsEnPente: 1 });
    expect(mesures.osm?.arbresParcs).toBeGreaterThan(5);
    expect(mesures.osm?.murs).toBeGreaterThan(50);
    expect(mesures.osm?.glissieres).toBeGreaterThan(50);
    // Semis tous les 15 m, sauf à moins de 30 m des deux lampadaires d'OSM (x de 60 à 90).
    expect(mesures.osm?.lampadairesSemes).toBeLessThan(600 / 15 - 3);
    // Le lampadaire posé sur l'axe (x = 90) est repoussé hors de la chaussée et du trottoir.
    const lampes = r.chunks.flatMap((c) => {
      const l = c.instances.lampadaire ?? [];
      const out: number[][] = [];
      for (let k = 0; k < l.length; k += 5) out.push([(l[k] ?? 0) + c.origin[0], (l[k + 2] ?? 0) + c.origin[2]]);
      return out;
    });
    const l90 = lampes.find((p) => Math.abs((p[0] ?? 0) - 90) < 1);
    expect(Math.abs(l90?.[1] ?? 0)).toBeGreaterThan(5);
  });

  it('range les commerces par tronçon, un par côté et par 12 m, avec leur genre seulement', () => {
    const shops = r.chunks.flatMap((c) => c.shops ?? []);
    expect(shops.length).toBe(MAP_SHOP_STRIDE);
    expect(MAP_SHOP_KINDS[shops[4] ?? -1]).toBe('cafe');
    expect(r.chunks.every((c) => Array.isArray(c.shops))).toBe(true);
  });

  it('refuse tout nom de commerce, de marque ou d’exploitant dans les fichiers de la carte', () => {
    const pub = join(dir, 'public', 'assets', 'maps', id);
    mkdirSync(pub, { recursive: true });
    writeFileSync(join(pub, 'route.json'), JSON.stringify(r));
    writeFileSync(join(pub, 'map.json'), JSON.stringify({ id }));
    // Empreintes notées par maps:fetch (les noms eux-mêmes ne sont jamais écrits).
    const r0 = filtrerOverpass({ elements: [{ type: 'node', id: 1, tags: { amenity: 'bar', name: 'Le Comptoir Fictif', brand: 'Rue d’essai', phone: 'contact fictif' } }] });
    expect(JSON.stringify(r0.json)).not.toMatch(/Comptoir|phone/);
    writeFileSync(join(d, 'brut', 'noms-commerces.json'), JSON.stringify(r0.noms.map((n) => empreinteNom(normaliserNom(n)))));
    const ok = nomsInterdits(id, dir);
    expect(ok.noms).toBe(2);
    // « Rue d’essai » est aussi le nom de la rue : toponyme, permis.
    expect(ok.erreurs).toEqual([]);
    writeFileSync(join(d, 'donnees.json'), JSON.stringify({ ...donnees, lacs: [{ nom: 'Le Comptoir Fictif', nature: 'Lac', y: 0, anneaux: [] }], osm: { ...osm, note: 'x' } }));
    const ko = nomsInterdits(id, dir);
    // Le nom passé dans un toponyme est excusé, pas le texte glissé dans la clé « osm ».
    expect(ko.erreurs).toEqual(['donnees.json : texte inattendu en osm.note']);
    writeFileSync(join(pub, 'map.json'), JSON.stringify({ id, hint: 'Le Comptoir Fictif' }));
    writeFileSync(join(d, 'donnees.json'), JSON.stringify(donnees));
    expect(nomsInterdits(id, dir).erreurs.join(' ')).toContain('le comptoir fictif');
  });
});
