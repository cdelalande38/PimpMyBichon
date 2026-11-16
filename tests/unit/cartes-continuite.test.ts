// Chaussée continue et assez large (retour du commanditaire : « à un moment la route est coupée »,
// « il faut bien l'élargir pour que la voiture ne prenne que 50 % de la largeur au max ») :
// tools/maps/continuite.mjs (rayons vers le bas tous les 50 cm sous les roues, balayage en travers),
// tools/maps/trace.mjs (virages adoucis au rayon minimal, largeur jamais sous celle de la section),
// et contrôle strict des quatre cartes fabriquées : aucune faute, 5 m au moins, 6 m à deux voies,
// la demi-largeur déclarée de chaque côté du rail, rail à moins de 0,5 m du milieu, rayon de 7,5 m.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { maillagesTroncon, RAYON_RAIL_MIN } from '../../tools/maps/check.mjs';
import { continuiteChaussee, erreursContinuite, resumerContinuite } from '../../tools/maps/continuite.mjs';
import { adoucirVirages, densifier, largeurAdoucie, lisserSerie, rayonCercle, rayons } from '../../tools/maps/trace.mjs';
import type { MapRoute } from '../../src/data/mapTypes.ts';

/** Rail droit vers le sud (Z croissant), un point tous les 2 m, et son ruban de chaussée. */
function rubanDroit(o: { longueur?: number; hw?: number; trou?: number; retourne?: number; marche?: number; decale?: number } = {}) {
  const L = o.longueur ?? 40;
  const hw = o.hw ?? 3;
  const rail: number[] = [];
  for (let z = 0; z <= L; z += 2) rail.push(0, 0, z);
  const route = { rail, step: 2, loop: false, length: L, sections: [{ from: 0, to: L, ground: 'sol', urban: false, lanes: 2, width: hw * 2 }] };
  const positions: number[] = [];
  // Normale à droite de la marche vers +Z : (−1, 0) ; u > 0 vers les X négatifs.
  for (let z = 0; z < L; z += 2) {
    if (o.trou !== undefined && z === o.trou) continue;
    const y0 = o.marche !== undefined && z >= o.marche ? 0.08 : 0;
    const dx = o.decale ?? 0;
    const a = [dx + hw, y0, z];
    const b = [dx - hw, y0, z];
    const c = [dx - hw, y0, z + 2];
    const d = [dx + hw, y0, z + 2];
    const tris = [
      [a, b, c],
      [a, c, d],
    ];
    for (const t of tris) {
      const [p0, p1, p2] = t as [number[], number[], number[]];
      const ny = (p1[2]! - p0[2]!) * (p2[0]! - p0[0]!) - (p1[0]! - p0[0]!) * (p2[2]! - p0[2]!);
      const dessus = ny > 0;
      const voulu = !(o.retourne !== undefined && z === o.retourne);
      const ordre = dessus === voulu ? [p0, p1, p2] : [p0, p2, p1];
      for (const p of ordre) positions.push(...p);
    }
  }
  return { route, maillages: [{ role: 'chaussee', positions: new Float64Array(positions), index: null }] };
}

describe('continuité de la chaussée sous les roues', () => {
  it('un ruban entier : aucune faute, largeur et milieu mesurés', () => {
    const { route, maillages } = rubanDroit();
    const c = continuiteChaussee(route, maillages);
    expect(c.fautes).toEqual([]);
    const z = resumerContinuite(c);
    expect(z.largeurMin).toBeGreaterThan(5.95);
    expect(z.ecartMax).toBeLessThan(0.02);
    expect(erreursContinuite(c)).toEqual([]);
  });

  it('une face manquante, une face retournée, une marche de 8 cm : trouvées à leur abscisse', () => {
    const mesurer = (o: Parameters<typeof rubanDroit>[0]) => {
      const r = rubanDroit(o);
      return continuiteChaussee(r.route, r.maillages);
    };
    const trou = mesurer({ trou: 10 });
    expect(trou.fautes.some((f) => f.faute === 'trou' && f.s > 10 && f.s < 12)).toBe(true);
    const ret = mesurer({ retourne: 20 });
    expect(ret.fautes.some((f) => f.faute === 'retournee' && f.s > 20 && f.s < 22)).toBe(true);
    const marche = mesurer({ marche: 30 });
    expect(marche.fautes.filter((f) => f.faute === 'marche').map((f) => f.s)).toContain(30);
    for (const c of [trou, ret, marche]) expect(erreursContinuite(c)[0]).toMatch(/interrompue/);
  });

  it('trop étroite, ou décalée du rail : erreurs bloquantes', () => {
    const etroite = rubanDroit({ hw: 2 });
    expect(erreursContinuite(continuiteChaussee(etroite.route, etroite.maillages)).join(' ')).toMatch(/moins de 5 m/);
    const decalee = rubanDroit({ decale: 0.9 });
    const e = erreursContinuite(continuiteChaussee(decalee.route, decalee.maillages)).join(' ');
    expect(e).toMatch(/milieu de la chaussée/);
    expect(e).toMatch(/demi-largeur déclarée/);
  });
});

describe('virages adoucis et largeur', () => {
  it('un angle droit lissé atteint 8 m de rayon, les bouts restent en place', () => {
    const pts: number[][] = [];
    for (let x = 0; x <= 60; x += 10) pts.push([x, 0, 0]);
    for (let z = 10; z <= 60; z += 10) pts.push([60, z, 0]);
    const d = densifier(pts, pts.map(() => 0), 1).points;
    const xs = lisserSerie(d.map((p) => p[0]!), 5);
    const zs = lisserSerie(d.map((p) => p[1]!), 5);
    const r = adoucirVirages(xs, zs, 8);
    expect(r.avant).toBeLessThan(8);
    expect(r.apres).toBeGreaterThanOrEqual(8);
    expect(r.xs[0]).toBeCloseTo(0, 6);
    expect(r.zs[r.zs.length - 1]).toBeCloseTo(60, 6);
    // Le coin n'est pas coupé de beaucoup plus qu'un congé de 8 m de rayon (3,3 m du sommet).
    const coin = Math.min(...r.xs.map((x, i) => Math.hypot(x - 60, r.zs[i]! - 0)));
    expect(coin).toBeLessThan(8);
  });

  it('largeur adoucie : jamais sous celle du point, transition dans la section étroite', () => {
    const w = [...Array(30).fill(5), ...Array(30).fill(7)];
    const a = largeurAdoucie(w, 4);
    a.forEach((v, i) => expect(v).toBeGreaterThanOrEqual(w[i]!));
    expect(a[29]).toBeGreaterThan(5.5);
    expect(a[0]).toBeCloseTo(5, 6);
    expect(rayonCercle(0, 0, 1, 1, 2, 0)).toBeCloseTo(1, 6);
  });
});

const CARTES = ['plateau-matheysin', 'monaco-ville', 'monaco-circuit', 'miami-beach'];

describe('les quatre cartes fabriquées : chaussée continue, assez large, rail au milieu', () => {
  for (const id of CARTES) {
    const dir = new URL(`../../public/assets/maps/${id}/`, import.meta.url);
    it.skipIf(!existsSync(new URL('route.json', dir)))(id, () => {
      const r = JSON.parse(readFileSync(new URL('route.json', dir), 'utf8')) as MapRoute;
      const maillages = r.chunks.flatMap((c) => maillagesTroncon(new Uint8Array(readFileSync(new URL(c.file, dir))), c.origin));
      const c = continuiteChaussee(r, maillages);
      expect(erreursContinuite(c)).toEqual([]);
      const z = resumerContinuite(c);
      expect(z.sous5).toBe(0);
      expect(z.sous6DeuxVoies).toBe(0);
      expect(z.ecartMax).toBeLessThanOrEqual(0.5);
      // Aucune section ne promet plus de chaussée que le dessin (le pilote s'y fie pour se placer).
      expect(z.surDeclaree).toBe(0);
      for (const s of r.sections) expect(s.width).toBeGreaterThanOrEqual(s.lanes >= 2 ? 6 : 5);
      const pts: number[][] = [];
      for (let i = 0; i + 2 < r.rail.length; i += 3) pts.push([r.rail[i]!, r.rail[i + 1]!, r.rail[i + 2]!]);
      expect(Math.min(...rayons(pts, Math.max(1, Math.round(4 / r.step))))).toBeGreaterThanOrEqual(RAYON_RAIL_MIN);
    });
  }
});
