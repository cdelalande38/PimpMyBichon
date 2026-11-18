// La Cox (placeholder_cox) : les proportions qui font la berline ronde des années 70, chiffrées
// d'après le gabarit tiré de vues de profil (voiture rabaissée de 6 cm, pavillon à 1,44 m,
// empattement de 2,40 m). Ce que le commanditaire a reproché au substitut précédent : coupé fuyant
// et bas, pavillon écrasé, pare-brise très incliné, nez long et pointu, ailes basses et étirées.
// Chaque cote ci-dessous tient une de ces fautes à distance.

import { pathToFileURL } from 'node:url';
import { beforeAll, describe, expect, it } from 'vitest';
import * as kit from '../../tools/vehicles/kit.mjs';

type Part = { material: string; geometry: { getAttribute: (n: string) => { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number } } };
type Node = { parts: Part[] };
type P3 = [number, number, number];

/** Sommets des pièces d'un nœud, filtrés par matériau. */
function points(nodes: Map<string, Node>, node: string, keep: (material: string) => boolean): P3[] {
  const out: P3[] = [];
  for (const part of nodes.get(node)?.parts ?? []) {
    if (!keep(part.material)) continue;
    const pos = part.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i += 1) out.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);
  }
  return out;
}

const maxOf = (list: number[]) => list.reduce((a, b) => Math.max(a, b), -Infinity);
const minOf = (list: number[]) => list.reduce((a, b) => Math.min(a, b), Infinity);

describe('silhouette de la Cox', () => {
  let nodes: Map<string, Node>;
  let shell: P3[];

  beforeAll(async () => {
    const url = pathToFileURL(new URL('../../assets-src/vehicles/cox/model.mjs', import.meta.url).pathname).href;
    const mod = (await import(url)) as { default: (k: typeof kit) => { nodes: Map<string, Node> } };
    nodes = mod.default(kit).nodes;
    // Le capot moteur est un nœud à part, posé sur sa charnière (vague U, « capot ») : il fait partie de la caisse.
    const lid = nodes.get('capot_moteur') as (Node & { position?: P3 }) | undefined;
    const [hx, hy, hz] = lid?.position ?? [0, 0, 0];
    shell = [...points(nodes, 'carrosserie', () => true), ...points(nodes, 'capot_moteur', () => true).map(([x, y, z]): P3 => [x + hx, y + hy, z + hz])];
  }, 60_000);

  /** Haut de la caisse (toutes matières) dans la tranche [x - 2 cm, x + 2 cm]. */
  const topAt = (x: number) => maxOf(shell.filter((p) => Math.abs(p[0] - x) < 0.02).map((p) => p[1]));

  it('est courte et haute : 3,76 m de caisse pour 1,44 m, porte-à-faux courts', () => {
    const xs = shell.map((p) => p[0]);
    const length = maxOf(xs) - minOf(xs);
    expect(length).toBeGreaterThan(3.68);
    expect(length).toBeLessThan(3.84);
    expect(maxOf(shell.map((p) => p[1]))).toBeCloseTo(1.44, 2);
    // Rapport longueur sur hauteur hors sol (garde au sol comprise) : 2,6 environ (le coupé rejeté : 2,8).
    expect(length / 1.44).toBeLessThan(2.7);
    // Porte-à-faux avant de 0,58 m, arrière de 0,77 m (empattement de 2,40 m).
    expect(maxOf(xs) - 1.2).toBeLessThan(0.62);
    expect(-minOf(xs) - 1.2).toBeLessThan(0.8);
  });

  it('porte un pavillon en arche haute, du pare-brise à la lunette', () => {
    // Sommet du pavillon au-dessus des sièges avant.
    const peak = [-0.6, -0.45, -0.3, -0.15].map(topAt);
    for (const y of peak) expect(y).toBeGreaterThan(1.42);
    // Arche continue : encore haute au-dessus de la banquette, puis une seule descente.
    expect(topAt(-1.0)).toBeGreaterThan(1.32);
    expect(topAt(-1.3)).toBeGreaterThan(1.14);
    expect(topAt(-1.6)).toBeGreaterThan(0.92);
    expect(topAt(-1.6)).toBeLessThan(1.02);
    expect(topAt(0.2)).toBeGreaterThan(1.36);
  });

  it('a un pare-brise presque droit et un capot court qui plonge', () => {
    // Pare-brise : verre de la caisse à l'avant du pavillon.
    const ws = points(nodes, 'carrosserie', (m) => m === 'glass').filter((p) => p[0] > 0.25 && Math.abs(p[2]) < 0.3);
    const top = ws.reduce((a, b) => (b[1] > a[1] ? b : a));
    const bottom = ws.reduce((a, b) => (b[1] < a[1] ? b : a));
    const rake = (Math.atan2(bottom[0] - top[0], top[1] - bottom[1]) * 180) / Math.PI;
    expect(rake).toBeGreaterThan(25);
    expect(rake).toBeLessThan(40); // le coupé rejeté : 48°
    // Capot : haut à la base du pare-brise, rond, et qui plonge au nez.
    expect(topAt(0.75)).toBeGreaterThan(0.95);
    expect(topAt(1.2)).toBeGreaterThan(0.9);
    expect(topAt(1.2)).toBeLessThan(0.99);
    expect(topAt(1.6)).toBeLessThan(0.8);
  });

  it('a des ailes hautes et rondes, phares ronds dressés dans le nez des ailes avant', () => {
    const fenders = points(nodes, 'carrosserie', (m) => m === 'paint_ailes');
    const crest = (x0: number, x1: number) => maxOf(fenders.filter((p) => p[0] > x0 && p[0] < x1).map((p) => p[1]));
    expect(crest(1.0, 1.4)).toBeGreaterThan(0.74);
    expect(crest(1.0, 1.4)).toBeLessThan(0.8);
    expect(crest(-1.4, -1.1)).toBeGreaterThan(0.78);
    expect(crest(-1.4, -1.1)).toBeLessThan(0.84);
    // Ailes en bulles jusqu'à 0,775 de l'axe ; ceinture de l'habitacle à 0,70 : la caisse est plus étroite.
    expect(maxOf(fenders.map((p) => p[2]))).toBeGreaterThan(0.76);
    const belt = shell.filter((p) => p[1] > 0.86 && p[1] < 0.92 && Math.abs(p[0]) < 0.3);
    expect(maxOf(belt.map((p) => p[2]))).toBeGreaterThan(0.68);
    expect(maxOf(belt.map((p) => p[2]))).toBeLessThan(0.73);
    // Phares : verres ronds presque verticaux, au bout des ailes avant, à hauteur de roue.
    const lamps = points(nodes, 'accessoires', (m) => m === 'lamp').filter((p) => p[2] > 0);
    const lx = lamps.map((p) => p[0]);
    const ly = lamps.map((p) => p[1]);
    expect(minOf(lx)).toBeGreaterThan(1.7);
    expect(maxOf(lx) - minOf(lx)).toBeLessThan(0.05); // dressé, pas couché
    expect((maxOf(ly) + minOf(ly)) / 2).toBeGreaterThan(0.5);
    expect((maxOf(ly) + minOf(ly)) / 2).toBeLessThan(0.65);
  });

  it('a des vitres latérales penchées vers l’intérieur sous un pavillon rond', () => {
    const glass = points(nodes, 'carrosserie', (m) => m === 'glass').filter((p) => p[0] > -0.25 && p[0] < 0.1);
    const low = glass.filter((p) => p[1] < 0.95);
    const high = glass.filter((p) => p[1] > 1.2);
    const zLow = maxOf(low.map((p) => Math.abs(p[2])));
    const zHigh = maxOf(high.map((p) => Math.abs(p[2])));
    // Rentrée des vitres : 10 à 20 cm entre le bas et le haut de la vitre de porte.
    expect(zLow - zHigh).toBeGreaterThan(0.1);
    expect(zLow - zHigh).toBeLessThan(0.2);
  });
});
