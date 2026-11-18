// Cartes de sortie (tools/maps/build.mjs, check.mjs) : fabrication d'une carte synthétique (route en
// S en pente, lac, bâtiment, route voisine, arbres) puis contrôle du contrat (MapRoute, maillages
// fusion_<rôle>), des budgets, du raccord chaussée-terrain, de l'orientation des faces et du
// déterminisme. La vraie carte est contrôlée aussi si ses données sont là.

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { parseGlb } from '../../tools/lib/glb.mjs';
import { buildMap, listeCartes } from '../../tools/maps/build.mjs';
import { BUDGETS, lireTroncon, maillagesTroncon, validerManifeste, validerRoute } from '../../tools/maps/check.mjs';
import { chausseeCouverte } from '../../tools/maps/couverture.mjs';
import type { MapRoute } from '../../src/data/mapTypes.ts';

const dir = mkdtempSync(join(tmpdir(), 'pmb-cartes-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

/** Terrain synthétique : pente douce vers le sud et une bosse à l'est. */
const sol = (x: number, z: number) => z * 0.03 + 6 * Math.exp(-(((x - 120) / 60) ** 2) - ((z - 500) / 120) ** 2);

function carteSynthetique(id: string) {
  const d = join(dir, id);
  mkdirSync(d, { recursive: true });
  const carte = {
    id,
    couloir: { demiLargeur: 80, pasRelief: 10 },
    fabrication: { pasRail: 2, lissagePlan: 6, lissageAltitude: 30, longueurTroncon: 300 },
    departs: [
      { id: 'debut', label: 'Début', debut: true },
      { id: 'lac', label: 'Le lac', pres: 'Lac d’essai' },
      { id: 'fin', label: 'Fin', avantFin: 200 },
    ],
  };
  // Axe : S de 1 200 m vers le sud, sommets tous les 20 m, avec une dent de scie de 0,4 m en altitude.
  const pts: number[] = [];
  const rang: number[] = [];
  for (let i = 0; i <= 60; i += 1) {
    const z = i * 20;
    const x = 60 * Math.sin(z / 250);
    pts.push(x, sol(x, z) + (i % 2 ? 0.4 : 0), z);
    rang.push(i < 30 ? 0 : i < 34 ? 1 : 2);
  }
  const suites: number[][] = [];
  const dm: number[] = [];
  for (let j = -12; j <= 132; j += 1) {
    suites.push([j, -18, 37]);
    for (let i = -18; i < 19; i += 1) dm.push(Math.round(sol(i * 10, j * 10) * 10));
  }
  const grille = (pas: number, n: number) => {
    const i0 = -Math.floor(n / 2);
    const vals: number[] = [];
    for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) vals.push(Math.round(sol((i0 + i) * pas, (i0 + j) * pas + 600) * 10));
    return { pas, i0, j0: i0 + Math.round(600 / pas), nx: n, nz: n, dm: vals };
  };
  const donnees = {
    format: 'pmb-carte-donnees',
    version: 1,
    id,
    repere: { altitude: 500 },
    axe: {
      points: pts,
      rang,
      troncons: [
        { largeur: 7, voies: 2, sol: 'sol', urbain: false },
        { largeur: 7, voies: 2, sol: 'pont', urbain: false },
        { largeur: 6, voies: 2, sol: 'sol', urbain: true },
      ],
    },
    voisines: [{ largeur: 5, importance: 4, points: [0, 0, 900, 70, 0, 900] }],
    lacs: [{ nom: 'Lac d’essai', nature: 'Lac', y: 2, anneaux: [[-40, 200, -15, 200, -15, 320, -40, 320]] }],
    batiments: [{ h: 9, e: 3, z: null, n: 'Indifférenciée', u: 'Résidentiel', a: [30, 1000, 45, 1000, 45, 1012, 30, 1012] }],
    arbres: [20, 100, 0, 22, 108, 1, -30, 400, 2, 0, 400, 0],
    couloir: { pas: 10, suites, dm },
    lointain: { proche: grille(100, 30), loin: grille(300, 20) },
  };
  writeFileSync(join(d, 'carte.json'), JSON.stringify(carte));
  writeFileSync(join(d, 'donnees.json'), JSON.stringify(donnees));
}

carteSynthetique('essai');
const a = buildMap('essai', { srcDir: dir });
const route = a.route as MapRoute;

function json(bytes: Uint8Array) {
  const p = parseGlb(bytes);
  if (!p.ok) throw new Error(p.message);
  return p.container.json;
}

describe('fabrication d’une carte', () => {
  it('produit une route conforme au contrat', () => {
    expect(validerRoute(route, 'essai')).toEqual([]);
    expect(route.length).toBe((route.rail.length / 3 - 1) * route.step);
    expect(route.sections.map((s) => s.ground)).toContain('pont');
    expect(route.starts.map((s) => s.id)).toEqual(['debut', 'lac', 'fin']);
    expect(route.starts[2]?.at).toBeCloseTo(route.length - 200, 0);
  });

  it('écrit des tronçons aux maillages fusion_<rôle> et aux triangles annoncés, dans les budgets', () => {
    for (const c of route.chunks) {
      const bytes = a.fichiers.get(c.file) as Uint8Array;
      const t = lireTroncon(bytes);
      expect(t.erreurs).toEqual([]);
      expect(t.triangles).toBe(c.triangles);
      expect(c.triangles).toBeLessThanOrEqual(BUDGETS.trianglesParTroncon);
      for (const v of Object.values(c.instances)) expect((v ?? []).length % 5).toBe(0);
    }
    const roles = new Set(route.chunks.flatMap((c) => (json(a.fichiers.get(c.file) as Uint8Array).meshes as Array<{ name: string }>).map((m) => m.name)));
    for (const r of ['fusion_chaussee', 'fusion_marquage', 'fusion_accotement', 'fusion_terrain', 'fusion_eau', 'fusion_mur', 'fusion_toit', 'fusion_ouvrage', 'fusion_voie'])
      expect(roles).toContain(r);
    expect(a.fichiers.has('lointain.glb')).toBe(true);
  });

  it('lisse l’altitude (plus de dent de scie) et raccorde le terrain à la chaussée', () => {
    expect(a.mesures.dentsDeScie).toBeLessThan(0.02);
    expect(a.mesures.ecartBord).toBeLessThan(0.01);
    expect(a.mesures.terrainSurRoute).toBe(0);
    expect(a.mesures.penteMax).toBeLessThan(0.06);
  });

  it('oriente la chaussée et le terrain vers le haut', () => {
    const j = json(a.fichiers.get(route.chunks[0]?.file ?? '') as Uint8Array);
    const p = parseGlb(a.fichiers.get(route.chunks[0]?.file ?? '') as Uint8Array);
    if (!p.ok) throw new Error(p.message);
    for (const nom of ['fusion_chaussee', 'fusion_terrain']) {
      const mi = (j.meshes as Array<{ name: string }>).findIndex((m) => m.name === nom);
      const acc = j.accessors[j.meshes[mi].primitives[0].attributes.NORMAL];
      const view = j.bufferViews[acc.bufferView];
      const n = new Float32Array(p.container.bin?.buffer ?? new ArrayBuffer(0), (p.container.bin?.byteOffset ?? 0) + view.byteOffset, acc.count * 3);
      let haut = 0;
      for (let i = 1; i < n.length; i += 3) if ((n[i] ?? 0) > 0) haut += 1;
      expect(haut / acc.count).toBeGreaterThan(0.99);
    }
  });

  it('est déterministe : deux fabrications donnent les mêmes octets', () => {
    const b = buildMap('essai', { srcDir: dir });
    expect(JSON.stringify(b.route)).toBe(JSON.stringify(route));
    for (const [nom, bytes] of a.fichiers) expect(Buffer.compare(Buffer.from(bytes), Buffer.from(b.fichiers.get(nom) as Uint8Array))).toBe(0);
  });

  it('ne connaît aucun identifiant de carte : il fabrique les dossiers qui ont carte.json', () => {
    expect(listeCartes(dir)).toEqual(['boucle', 'essai', 'lacets']);
  });

  it('valide un manifeste', () => {
    const m = { id: 'essai', name: 'Essai', kind: 'route', order: 1, route: 'route.json', credits: [{ source: 'IGN, BD TOPO', licence: 'Licence Ouverte 2.0', date: '2026-11' }] };
    expect(validerManifeste(m, 'essai')).toEqual([]);
    expect(validerManifeste({ ...m, credits: [] }, 'essai').length).toBe(1);
  });
});

/** Boucle synthétique : cercle de 150 m de rayon, un tunnel sous une colline, un bâtiment au-dessus. */
function boucleSynthetique(id: string) {
  const d = join(dir, id);
  mkdirSync(d, { recursive: true });
  const relief = (x: number, z: number) => 12 * Math.exp(-((x / 40) ** 2) - ((z - 150) / 40) ** 2);
  const carte = {
    id,
    couloir: { demiLargeur: 60, pasRelief: 10 },
    fabrication: { pasRail: 2, lissagePlan: 3, lissageAltitude: 10, longueurTroncon: 250, hauteurMax: 120, pasLampadaires: 10 },
    departs: [{ id: 'debut', label: 'Début', debut: true }, { id: 'etape', label: 'Étape', etape: 1 }],
  };
  const pts: number[] = [];
  const rang: number[] = [];
  for (let i = 0; i <= 96; i += 1) {
    const t = ((i % 96) / 96) * Math.PI * 2;
    pts.push(150 * Math.cos(t), 0, 150 * Math.sin(t));
    // Tunnel sous la colline (autour du quart de tour) : tronçon de rang 1, puis retour au rang 2.
    rang.push(i < 20 ? 0 : i <= 28 ? 1 : 2);
  }
  const suites: number[][] = [];
  const dm: number[] = [];
  for (let j = -24; j <= 24; j += 1) {
    suites.push([j, -24, 49]);
    for (let i = -24; i < 25; i += 1) dm.push(Math.round(relief(i * 10, j * 10) * 10));
  }
  const grille = (pas: number, n: number) => {
    const i0 = -Math.floor(n / 2);
    const vals: number[] = [];
    for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) vals.push(Math.round(relief((i0 + i) * pas, (i0 + j) * pas) * 10));
    return { pas, i0, j0: i0, nx: n, nz: n, dm: vals };
  };
  const donnees = {
    format: 'pmb-carte-donnees',
    version: 1,
    id,
    repere: { altitude: 10 },
    axe: {
      points: pts,
      rang,
      boucle: true,
      etapes: [
        [150, 0],
        [-150, 0],
      ],
      troncons: [
        { largeur: 8, voies: 2, sol: 'sol', urbain: true, nom: 'BOULEVARD' },
        { largeur: 8, voies: 2, sol: 'tunnel', urbain: true, nom: 'TUNNEL' },
        { largeur: 8, voies: 2, sol: 'sol', urbain: true, nom: 'BOULEVARD' },
      ],
    },
    voisines: [],
    lacs: [{ nom: 'La mer', nature: 'Mer', y: -1, anneaux: [[-40, -40, 40, -40, 40, 40, -40, 40], [-10, -10, 10, -10, 10, 10, -10, 10]] }],
    batiments: [{ h: 30, e: 9, z: null, n: 'Indifférenciée', u: 'Résidentiel', a: [-15, 135, 15, 135, 15, 165, -15, 165] }],
    arbres: [],
    couloir: { pas: 10, suites, dm },
    lointain: { proche: grille(100, 12), loin: grille(300, 8) },
  };
  writeFileSync(join(d, 'carte.json'), JSON.stringify(carte));
  writeFileSync(join(d, 'donnees.json'), JSON.stringify(donnees));
}

describe('boucle, tunnel et bâtiment au-dessus', () => {
  boucleSynthetique('boucle');
  const b = buildMap('boucle', { srcDir: dir });
  const r = b.route as MapRoute;

  it('referme le rail à pas constant et tient le contrat', () => {
    expect(r.loop).toBe(true);
    expect(validerRoute(r, 'boucle').join(' ; ')).toBe('');
    expect(validerRoute(r, 'boucle')).toEqual([]);
    expect(r.rail.slice(0, 3)).toEqual(r.rail.slice(-3));
    expect(r.length).toBeCloseTo(2 * Math.PI * 150, -1);
    expect(r.sections.some((s) => s.ground === 'tunnel')).toBe(true);
    expect(r.starts.find((s) => s.id === 'etape')?.at).toBeCloseTo(r.length / 2, -1);
  });

  it('habille le tunnel (piédroits, voûte, réglettes) sans terrain sur la chaussée, et garde le bâtiment posé dessus', () => {
    const noms = new Set(r.chunks.flatMap((c) => (json(b.fichiers.get(c.file) as Uint8Array).meshes as Array<{ name: string }>).map((m) => m.name)));
    for (const n of ['fusion_ouvrage', 'fusion_fenetre', 'fusion_mur', 'fusion_eau']) expect(noms).toContain(n);
    expect(b.mesures.terrainSurRoute).toBe(0);
    // Ni herbe sous la voûte ni plaque sur la chaussée ou le trottoir (tunnel compris).
    expect(b.mesures.solSurRoute.fautes).toBe(0);
    expect(b.mesures.tunnels).toBe(1);
    expect(b.mesures.batiments).toBe(1);
    // Aucun mur de bâtiment ne descend sous la voûte : le point le plus bas des murs est au-dessus de la chaussée + 7 m.
    const c = r.chunks.find((x) => {
      const j = json(b.fichiers.get(x.file) as Uint8Array);
      return (j.meshes as Array<{ name: string }>).some((m) => m.name === 'fusion_mur');
    });
    const j = json(b.fichiers.get(c?.file ?? '') as Uint8Array);
    const mi = (j.meshes as Array<{ name: string }>).findIndex((m) => m.name === 'fusion_mur');
    const acc = j.accessors[j.meshes[mi].primitives[0].attributes.POSITION];
    expect(acc.min[1] + (c?.origin[1] ?? 0)).toBeGreaterThan(7);
  });
});

/**
 * Lacets synthétiques : deux branches à 14 m l'une de l'autre sur un versant raide, reliées par une
 * épingle de 7 m de rayon, 8 m plus bas sur la seconde ; un bâtiment qui mord sur le trottoir.
 */
function lacetsSynthetiques(id: string) {
  const d = join(dir, id);
  mkdirSync(d, { recursive: true });
  const versant = (x: number, z: number) => 20 - 0.1 * z - 0.6 * x;
  const carte = {
    id,
    couloir: { demiLargeur: 60, pasRelief: 5 },
    fabrication: { pasRail: 2, lissagePlan: 2, lissageAltitude: 6, longueurTroncon: 120, pasProfil: 2 },
    departs: [{ id: 'debut', label: 'Début', debut: true }],
  };
  const pts: number[] = [];
  const rang: number[] = [];
  let s = 0;
  const pousser = (x: number, z: number) => {
    const n = pts.length;
    if (n) s += Math.hypot(x - (pts[n - 3] ?? 0), z - (pts[n - 1] ?? 0));
    pts.push(x, 20 - 0.1 * s, z);
    rang.push(0);
  };
  for (let z = -40; z <= 60; z += 5) pousser(0, z);
  for (let k = 1; k < 12; k += 1) pousser(7 - 7 * Math.cos((k / 12) * Math.PI), 60 + 7 * Math.sin((k / 12) * Math.PI));
  for (let z = 60; z >= -40; z -= 5) pousser(14, z);
  const suites: number[][] = [];
  const dm: number[] = [];
  for (let j = -30; j <= 30; j += 1) {
    suites.push([j, -20, 41]);
    for (let i = -20; i < 21; i += 1) dm.push(Math.round(versant(i * 5, j * 5) * 10));
  }
  const grille = (pas: number, n: number) => {
    const i0 = -Math.floor(n / 2);
    const vals: number[] = [];
    for (let j = 0; j < n; j += 1) for (let i = 0; i < n; i += 1) vals.push(Math.round(versant((i0 + i) * pas, (i0 + j) * pas) * 10));
    return { pas, i0, j0: i0, nx: n, nz: n, dm: vals };
  };
  const donnees = {
    format: 'pmb-carte-donnees',
    version: 1,
    id,
    repere: { altitude: 300 },
    axe: { points: pts, rang, troncons: [{ largeur: 6, voies: 2, sol: 'sol', urbain: true }] },
    voisines: [],
    lacs: [],
    // Bâtiment de 10 × 8 m dont la façade avance de 2 m sur le trottoir ouest de la première branche.
    batiments: [{ h: 12, e: 4, z: null, n: 'Indifférenciée', u: 'Résidentiel', a: [-15, 0, -3.2, 0, -3.2, 8, -15, 8] }],
    arbres: [],
    couloir: { pas: 5, suites, dm },
    lointain: { proche: grille(50, 16), loin: grille(150, 8) },
  };
  writeFileSync(join(d, 'carte.json'), JSON.stringify(carte));
  writeFileSync(join(d, 'donnees.json'), JSON.stringify(donnees));
}

describe('lacets : la route n’est jamais sous le terrain', () => {
  lacetsSynthetiques('lacets');
  const sans = buildMap('lacets', { srcDir: dir, sansGarde: true });
  const avec = buildMap('lacets', { srcDir: dir });

  it('sans la garde, le terrain d’une branche recouvre la chaussée de l’autre (le contrôle le voit)', () => {
    expect(sans.mesures.chausseeCouverte).toBeGreaterThan(0);
    expect(sans.mesures.terrainSurRoute).toBeGreaterThan(0);
    expect(sans.mesures.solSurRoute.fautes).toBeGreaterThan(0);
  });

  it('avec la garde, rien au-dessus de la chaussée, raccord exact au trottoir', () => {
    expect(avec.mesures.terrainRefuse).toBeGreaterThan(0);
    expect(avec.mesures.chausseeCouverte).toBe(0);
    expect(avec.mesures.ecartBord).toBeLessThan(0.01);
    // Aucune plaque d'herbe, même de quelques centimètres : le terrain est découpé et passe dessous.
    expect(avec.mesures.solSurRoute.fautes).toBe(0);
  });

  it('le contrôle des tronçons écrits (check.mjs) donne le même verdict que la fabrication', () => {
    const r = avec.route as MapRoute;
    const maillages = r.chunks.flatMap((c) => maillagesTroncon(avec.fichiers.get(c.file) as Uint8Array, c.origin));
    const lointain = maillagesTroncon(avec.fichiers.get('lointain.glb') as Uint8Array, [0, 0, 0]);
    expect(chausseeCouverte(r, maillages, lointain).couverts).toEqual([]);
    const r2 = sans.route as MapRoute;
    const m2 = r2.chunks.flatMap((c) => maillagesTroncon(sans.fichiers.get(c.file) as Uint8Array, c.origin));
    expect(chausseeCouverte(r2, m2).couverts.length).toBeGreaterThan(0);
  });

  it('rogne le bâtiment qui mord sur le trottoir au lieu de l’écarter : ses murs restent en retrait', () => {
    expect(avec.mesures.batiments).toBe(1);
    expect(avec.mesures.batimentsRognes).toBe(1);
    const r = avec.route as MapRoute;
    const c = r.chunks.find((x) => (json(avec.fichiers.get(x.file) as Uint8Array).meshes as Array<{ name: string }>).some((m) => m.name === 'fusion_mur'));
    const mur = maillagesTroncon(avec.fichiers.get(c?.file ?? '') as Uint8Array, c?.origin ?? [0, 0, 0]).find((m) => m.role === 'mur');
    let xMax = -Infinity;
    for (let i = 0; i < (mur?.positions.length ?? 0); i += 3) xMax = Math.max(xMax, mur?.positions[i] ?? 0);
    // Trottoir jusqu'à 3 + 2,2 = 5,2 m de l'axe (x = 0), retrait de 0,5 m : façade à x ≤ −5,7.
    expect(xMax).toBeLessThanOrEqual(-5.69);
    expect(xMax).toBeGreaterThan(-6.5);
  });
});

const reelle = join(process.cwd(), 'assets-src', 'maps');
describe.skipIf(listeCartes(reelle).every((id) => !existsSync(join(reelle, id, 'donnees.json'))))('cartes du dépôt', () => {
  it(
    'tiennent le contrat et les budgets du § 8',
    () => {
      for (const id of listeCartes(reelle)) {
        if (!existsSync(join(reelle, id, 'donnees.json'))) continue;
        const { route: r, fichiers, mesures } = buildMap(id);
        expect(validerRoute(r, id)).toEqual([]);
        let poids = JSON.stringify(r).length;
        for (const b of fichiers.values()) poids += b.byteLength;
        expect(poids).toBeLessThanOrEqual(BUDGETS.octetsCarte);
        const tri = r.chunks.map((c) => c.triangles);
        for (let i = 0; i < tri.length; i += 1) expect(tri.slice(i, i + 5).reduce((s, v) => s + v, 0)).toBeLessThanOrEqual(BUDGETS.trianglesVisibles);
        // Toutes les cartes, ville et circuit compris (rues parallèles, lacets, carrefours) : raccord
        // exact du terrain au bord du trottoir, et rien au-dessus de la chaussée hors tunnel déclaré
        // (terrain, bâtiment, ouvrage, autre portion du parcours, relief lointain).
        expect(mesures.ecartBord, id).toBeLessThan(0.01);
        expect(mesures.terrainSurRoute, id).toBe(0);
        expect(mesures.couverts.slice(0, 5), id).toEqual([]);
        // Herbe sur la route (vu sur le circuit de Monaco le 18 novembre 2026) : aucun point de la
        // chaussée ni des bas-côtés sous le terrain, tunnels et ponts compris.
        expect(mesures.solSurRoute.fautes, id).toBe(0);
        expect(mesures.batimentsEcartes / mesures.batiments, id).toBeLessThan(0.01);
      }
    },
    120_000,
  );
});
