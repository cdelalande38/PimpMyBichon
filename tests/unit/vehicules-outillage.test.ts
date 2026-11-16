// Outillage des véhicules substituts (tools/vehicles/) : écrivain GLB relu par tools/lib/glb.mjs,
// orientation des surfaces, et conventions du van (§ 8 du cahier des charges, fiche « Le van »).

import { readFileSync } from 'node:fs';
import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { parseGlb } from '../../tools/lib/glb.mjs';
import { buildVehicle, summarize } from '../../tools/vehicles/build.mjs';
import * as kit from '../../tools/vehicles/kit.mjs';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON glTF lu tel quel
function glbJson(bytes: Uint8Array): Record<string, any> {
  const parsed = parseGlb(bytes);
  if (!parsed.ok) throw new Error(parsed.message);
  return parsed.container.json;
}

/** Part des triangles dont la normale s'éloigne du point `inside`. */
function outwardShare(parts: kit.Parts, inside: Vector3): number {
  let out = 0;
  let total = 0;
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (const { geometry } of parts) {
    const p = geometry.getAttribute('position');
    const idx = geometry.index!;
    for (let i = 0; i < idx.count; i += 3) {
      a.fromBufferAttribute(p, idx.getX(i));
      b.fromBufferAttribute(p, idx.getX(i + 1));
      c.fromBufferAttribute(p, idx.getX(i + 2));
      const n = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
      if (n.lengthSq() < 1e-14) continue;
      const center = a.clone().add(b).add(c).divideScalar(3);
      total += 1;
      if (n.dot(center.sub(inside)) > 0) out += 1;
    }
  }
  return out / total;
}

describe('écrivain GLB', () => {
  it('un GLB écrit puis relu rend les mêmes nœuds, matériaux et triangles', () => {
    const box = kit.loft({ sectionAt: () => kit.mirrorSection(kit.roundedHalf({ bottom: 0.1, top: 0.6, halfWidthBottom: 0.4, halfWidthTop: 0.35 })), xs: [-1, 0, 1], material: (f) => (f.y > 0.5 ? 'paint_toit' : 'paint_caisse') });
    const wheel = kit.wheel({ outer: 0.3, rim: 0.2, width: 0.2, style: 'branches', material: 'paint_jantes' });
    const m = new kit.Model('essai');
    m.add('caisse', box);
    m.shared('roue', wheel);
    m.instance('roue_droite', 'roue', { position: [0.8, 0.3, 0.5] });
    m.instance('roue_gauche', 'roue', { position: [0.8, 0.3, -0.5], rotation: [0, Math.PI, 0] });
    const { bytes, materials, nodes } = m.toGlb();
    const json = glbJson(bytes);
    expect(json.nodes.map((n: { name: string }) => n.name)).toEqual(nodes);
    expect(nodes).toEqual(['essai', 'caisse', 'roue_droite', 'roue_gauche']);
    expect(json.materials.map((x: { name: string }) => x.name)).toEqual(materials);
    expect(new Set(materials)).toEqual(new Set([...box, ...wheel].map((p) => p.material)));
    const s = summarize(bytes);
    expect(s.triangles).toBe(kit.partsTriangles(box) + 2 * kit.partsTriangles(wheel));
    // Une primitive par matériau et par nœud.
    expect(s.primitives).toBe(new Set(box.map((p) => p.material)).size + 2 * new Set(wheel.map((p) => p.material)).size);
    // Même modèle, mêmes octets.
    expect(Buffer.from(m.toGlb().bytes).equals(Buffer.from(bytes))).toBe(true);
  });

  it('refuse un matériau hors conventions', () => {
    expect(() => new kit.Model('x').add('a', [{ material: 'Peinture', geometry: kit.loft({ sections: [{ x: 0, points: kit.circle(0, 0.5, 0.2, 8) }, { x: 1, points: kit.circle(0, 0.5, 0.2, 8) }], material: 'black' })[0]!.geometry }])).toThrow(/conventions/);
  });
});

describe('boîte à outils', () => {
  it('loft, bouchons compris, tourné vers l’extérieur (sections interpolées ou fonction)', () => {
    const sec = kit.mirrorSection(kit.roundedHalf({ bottom: 0.2, top: 1, halfWidthBottom: 0.8, halfWidthTop: 0.7, rTop: 0.1 }));
    const a = kit.loft({ sectionAt: () => sec, xs: kit.sampleX(-1, 1, { step: 0.1 }), around: 2, material: (f) => (f.cap ? 'black' : 'alu') });
    const inside = new Vector3(0, 0.6, 0);
    expect(outwardShare(a.filter((p) => p.material === 'alu'), inside)).toBe(1);
    // Bouchons en grille : quelques lames retournées dans les coins serrés (1 % environ), invisibles.
    expect(outwardShare(a.filter((p) => p.material === 'black'), inside)).toBeGreaterThan(0.98);
    const small = sec.map(([z, y]) => [z * 0.5, 0.6 + (y - 0.6) * 0.5] as [number, number]);
    const b = kit.loft({ sections: [{ x: -1, points: small }, { x: 0, points: sec }, { x: 1, points: small }], along: 6, material: 'alu' });
    expect(outwardShare(b, new Vector3(0, 0.6, 0))).toBe(1);
    const lining = kit.loft({ sectionAt: () => sec, xs: [-1, 1], material: 'black', inward: true });
    expect(outwardShare(lining, new Vector3(0, 0.6, 0))).toBe(0);
  });

  it('pneu, extrusion et symétrie tournés vers l’extérieur', () => {
    // Les talons (10 % des triangles) rentrent vers l'axe sous la jante : tous les autres regardent dehors.
    expect(outwardShare(kit.tire({ outer: 0.33, rim: 0.216, width: 0.215 }), new Vector3(0, 0, 0))).toBeGreaterThanOrEqual(0.9);
    const ext = kit.roundedExtrude(kit.roundedRect(0.4, 0.2, 0.05), { material: 'black', depth: 0.1, bevel: 0.02, axis: 'x' });
    expect(outwardShare(ext, new Vector3())).toBe(1);
    const mirrored = kit.symmetric(kit.place(kit.ellipsoid([0, 0, 0], [0.1, 0.1, 0.1], { material: 'black' }), { position: [0, 0, 1] }));
    expect(outwardShare(mirrored.slice(1), new Vector3(0, 0, -1))).toBe(1);
  });
});

describe('le van', () => {
  const manifest = JSON.parse(readFileSync(new URL('../../public/assets/vehicles/van/vehicle.json', import.meta.url), 'utf8')) as VehicleManifest;

  it('respecte les conventions : matériaux, zones, origine, cotes de la fiche, budgets', async () => {
    const { bytes, summary } = await buildVehicle('van');
    for (const name of summary.materials) expect(name).toMatch(kit.MATERIAL_NAME);
    // Toutes les zones dans le modèle, sauf celle des jantes : portée par les jantes partagées que l'app pose.
    for (const zone of manifest.zones) for (const mat of zone.materials) if (zone.id !== manifest.wheels?.fit?.zone) expect(summary.materials).toContain(mat);
    expect(manifest.wheels?.fit?.zone).toBe('jantes');
    expect(manifest.id).toBe('van');
    expect(manifest.placeholder).toBe('placeholder_van');
    // Budgets : 40 000 à 120 000 triangles, moins de 60 appels de dessin.
    expect(summary.triangles).toBeGreaterThanOrEqual(40_000);
    expect(summary.triangles).toBeLessThanOrEqual(120_000);
    expect(summary.primitives).toBeLessThan(60);
    // Origine au sol (caisse seule : sa garde au sol du manifeste), au centre de l'empattement
    // (3,00 m) ; quatre ancres de roue à 0,33 m, le rayon des roues d'origine.
    expect(summary.min[1]).toBeCloseTo(manifest.wheels!.floor, 2);
    const json = glbJson(bytes);
    const wheels = json.nodes.filter((n: { name: string }) => n.name.startsWith('roue_'));
    expect(wheels).toHaveLength(4);
    for (const n of wheels) expect((n.translation as number[])[1]).toBeCloseTo(0.33, 2);
    const xs = wheels.map((n: { translation: number[] }) => n.translation[0]);
    expect(Math.max(...xs) + Math.min(...xs)).toBeCloseTo(0, 3);
    expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(3.0, 2);
    // Cotes de la caisse (hors rétroviseurs) à 5 % près : 4,89 × 1,90 × 1,90 m, porte-à-faux avant 0,90.
    const body = json.meshes[json.nodes.find((n: { name: string }) => n.name === 'carrosserie').mesh];
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of body.primitives) {
      const acc = json.accessors[p.attributes.POSITION];
      for (let k = 0; k < 3; k += 1) {
        min[k] = Math.min(min[k]!, acc.min[k]);
        max[k] = Math.max(max[k]!, acc.max[k]);
      }
    }
    const near = (value: number, expected: number) => expect(Math.abs(value - expected) / expected).toBeLessThan(0.05);
    near(max[0]! - min[0]!, 4.89);
    near(max[2]! - min[2]!, 1.9);
    near(max[1]!, 1.9);
    near(max[0]! - Math.max(...xs), 0.9);
    // Avant vers +X : le pare-brise (verre incliné) est devant le centre.
    expect(summary.materials).toContain('glass');
  }, 60_000);
});
