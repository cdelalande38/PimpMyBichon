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
import { BUDGETS, lireTroncon, validerManifeste, validerRoute } from '../../tools/maps/check.mjs';
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
    expect(listeCartes(dir)).toEqual(['essai']);
  });

  it('valide un manifeste', () => {
    const m = { id: 'essai', name: 'Essai', kind: 'route', order: 1, route: 'route.json', credits: [{ source: 'IGN, BD TOPO', licence: 'Licence Ouverte 2.0', date: '2026-11' }] };
    expect(validerManifeste(m, 'essai')).toEqual([]);
    expect(validerManifeste({ ...m, credits: [] }, 'essai').length).toBe(1);
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
        expect(mesures.ecartBord).toBeLessThan(0.01);
        expect(mesures.terrainSurRoute).toBe(0);
      }
    },
    120_000,
  );
});
