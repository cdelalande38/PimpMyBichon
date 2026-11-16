// Roues partagées modelées par le code (tools/vehicles/roues.mjs) : chaque jante a sa lèvre, son
// moyeu, ses écrous (voiture) et sa valve ; chaque pneu sa marque colorable ; le recalage d'un pneu
// sur une autre cote (src/scene/vehicle/wheels.ts) ; les budgets du véhicule complet (§ 8).

import { Box3, BufferAttribute, BufferGeometry } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { describe, expect, it } from 'vitest';
import { buildVehicle, summarize, VEHICLE_MAX } from '../../tools/vehicles/build.mjs';
import * as kit from '../../tools/vehicles/kit.mjs';
import { buildRim, buildTire, readCatalogue } from '../../tools/vehicles/roues.mjs';
import { remapTire } from '../../src/scene/vehicle/wheels.ts';

const catalogue = readCatalogue();

const box = (parts: { geometry: BufferGeometry }[]) => {
  const b = new Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    b.union(p.geometry.boundingBox!);
  }
  return b;
};

describe('jantes partagées', () => {
  it.each(catalogue.rims.map((rim) => [rim.id, rim] as const))('%s : lèvre peinte, moyeu, valve, aux conventions', (_id, rim) => {
    const parts = buildRim(rim, catalogue);
    const ref = catalogue.reference[rim.kind];
    const materials = new Set(parts.map((p) => p.material));
    for (const m of materials) expect(m).toMatch(kit.MATERIAL_NAME);
    expect(materials.has('paint_jantes')).toBe(true);
    expect(materials.has('alu')).toBe(true); // tige de valve
    expect(materials.has('black')).toBe(true); // bouchon de valve
    if (rim.kind === 'car') expect(materials.has('chrome')).toBe(true); // écrous, enjoliveur, rayons
    // La lèvre déborde à peine du rayon de jante ; la jante tient dans la largeur du pneu, face vers +Z.
    const b = box(parts);
    expect(b.max.x).toBeGreaterThan(ref.rim);
    expect(b.max.x).toBeLessThan(ref.rim + 0.025);
    expect(b.max.z).toBeLessThan(ref.width / 2 + 0.04);
    expect(b.min.z).toBeGreaterThan(-ref.width / 2 - 0.04);
    // Assez de détail pour tenir de près, pas plus qu'une roue de série.
    const triangles = kit.partsTriangles(parts);
    expect(triangles).toBeGreaterThan(2000);
    expect(triangles).toBeLessThan(20_000);
  });
});

describe('pneus partagés', () => {
  it.each(catalogue.tires.flatMap((tire) => (['car', 'bike'] as const).map((kind) => [`${tire.id} ${kind}`, tire, kind] as const)))('%s : caoutchouc et marque colorable, à la cote de référence', (_name, tire, kind) => {
    const parts = buildTire(tire, kind, catalogue);
    const ref = catalogue.reference[kind];
    const materials = new Set(parts.map((p) => p.material));
    expect([...materials].sort()).toEqual(['paint_flanc', 'rubber']);
    const b = box(parts);
    expect(b.max.y).toBeCloseTo(ref.outer, 2);
    expect(b.max.z).toBeLessThan(ref.width / 2 + 0.02);
    // La marque est sur le flanc extérieur (+Z), jamais dedans.
    const mark = box(parts.filter((p) => p.material === 'paint_flanc'));
    expect(mark.min.z).toBeGreaterThan(0);
  });
});

describe('recalage d’un pneu sur la cote choisie', () => {
  it('talon sur la jante, rayon extérieur et largeur de la cote', () => {
    const ref = catalogue.reference.car;
    const parts = buildTire(catalogue.tires[0]!, 'car', catalogue);
    const merged = mergeGeometries(parts.map((p) => {
      const g = new BufferGeometry();
      g.setAttribute('position', p.geometry.getAttribute('position') as BufferAttribute);
      g.setIndex(p.geometry.getIndex());
      return g;
    }));
    const axle = { rim: 0.254, outer: 0.34, width: 245 };
    const out = remapTire(merged, ref, axle);
    out.computeBoundingBox();
    expect(out.boundingBox!.max.y).toBeCloseTo(axle.outer, 3);
    expect(out.boundingBox!.max.z - out.boundingBox!.min.z).toBeCloseTo((ref.width + 0.016) * (axle.width / 1000 / ref.width), 2);
    // Plus petit rayon : le talon, juste au-dessus de la jante.
    const pos = out.getAttribute('position');
    let inner = Infinity;
    for (let i = 0; i < pos.count; i += 1) inner = Math.min(inner, Math.hypot(pos.getX(i), pos.getY(i)));
    expect(inner).toBeGreaterThan(axle.rim);
    expect(inner).toBeLessThan(axle.rim + 0.01);
  });
});

describe('budgets du véhicule complet (§ 8), roues les plus lourdes posées', () => {
  const heaviest = (kind: 'car' | 'bike') => {
    const rims = catalogue.rims.filter((rim) => rim.kind === kind).map((rim) => {
      const m = new kit.Model('j');
      m.add('jante', buildRim(rim, catalogue));
      return summarize(m.toGlb().bytes);
    });
    const tires = catalogue.tires.map((tire) => {
      const m = new kit.Model('p');
      m.add('pneu', buildTire(tire, kind, catalogue));
      return summarize(m.toGlb().bytes);
    });
    return {
      triangles: Math.max(...rims.map((s) => s.triangles)) + Math.max(...tires.map((s) => s.triangles)),
      primitives: Math.max(...rims.map((s) => s.primitives)) + Math.max(...tires.map((s) => s.primitives)),
    };
  };
  it.each([
    ['cox', 'car', 4],
    ['van', 'car', 4],
    ['bobber', 'bike', 2],
    ['sportive', 'bike', 2],
  ] as const)('%s', async (id, kind, anchors) => {
    const { summary } = await buildVehicle(id);
    expect(summary.nodes.filter((n) => n.startsWith('roue_'))).toHaveLength(anchors);
    const wheel = heaviest(kind);
    expect(summary.triangles + anchors * wheel.triangles).toBeLessThanOrEqual(VEHICLE_MAX.triangles);
    expect(summary.primitives + anchors * wheel.primitives).toBeLessThanOrEqual(VEHICLE_MAX.drawCalls);
  }, 60_000);
});
