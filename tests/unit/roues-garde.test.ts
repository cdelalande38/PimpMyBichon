// Les roues ne traversent ni les ailes ni les garde-boue (§ 5.4) : pour chaque substitut, la roue
// posée (rayon et largeur résolus) est confrontée aux sommets de la caisse, assiette au plus bas,
// aux cotes d'origine, aux plus grandes et aux plus petites. La voûte noire des passages de roue
// (matériau `black` des voitures, dessous de caisse) peut accueillir le haut du pneu, comme sur une
// voiture rabaissée ; la peau peinte, le chrome et les optiques, jamais.

import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as kit from '../../tools/vehicles/kit.mjs';
import { VEHICLES } from '../../src/data/vehicles.ts';
import type { Build, VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { outerRadius, resolveWheels, WHEEL_TUNE } from '../../src/data/wheels.ts';

type ModelNode = { parts: { material: string; geometry: { getAttribute: (n: string) => { count: number; getX: (i: number) => number; getY: (i: number) => number; getZ: (i: number) => number } } }[]; position?: number[]; anchor?: boolean };

async function model(id: string): Promise<Map<string, ModelNode>> {
  const url = pathToFileURL(new URL(`../../assets-src/vehicles/${id}/model.mjs`, import.meta.url).pathname).href;
  const mod = (await import(url)) as { default: (k: typeof kit) => Promise<{ nodes: Map<string, ModelNode> }> | { nodes: Map<string, ModelNode> } };
  return (await mod.default(kit)).nodes;
}

/**
 * Demi-largeur du pneu à la distance `d` de l'axe : flanc bombé et épaule arrondie (auto), sommet
 * rond (moto), comme le profil de tools/vehicles/roues.mjs.
 */
function halfWidthAt(kind: VehicleManifest['kind'], w: { radius: number; rim: number; half: number }, d: number): number {
  if (kind === 'bike') {
    const c = w.radius - w.half;
    return d <= c ? w.half : Math.sqrt(Math.max(0, w.half * w.half - (d - c) * (d - c)));
  }
  const half = w.half + 0.008;
  const sh = Math.min(0.035, (w.radius - w.rim) * 0.3);
  const c = w.radius - sh;
  return d <= c ? half : half - sh + Math.sqrt(Math.max(0, sh * sh - (d - c) * (d - c)));
}

/**
 * Plus forte pénétration (m) d'un sommet de la caisse dans le pneu posé (entre la lèvre de la jante
 * et la bande de roulement) ; 0 : aucune. Fourche, bras, étrier et moyeu vivent dans la jante.
 */
function penetration(vehicle: VehicleManifest, nodes: Map<string, ModelNode>, build: Build): { depth: number; where: string } {
  const r = resolveWheels(vehicle, build)!;
  const fit = vehicle.wheels!.fit!;
  const grounded = new Set(vehicle.wheels!.grounded ?? []);
  const wheels = [...nodes].filter(([name]) => name.startsWith('roue_')).map(([, node]) => {
    const [x = 0, , z = 0] = node.position ?? [];
    const front = x > 0;
    const axle = front ? r.front! : r.rear!;
    const origin = outerRadius(front ? fit.front : (fit.rear ?? fit.front));
    // Repère de la caisse : le centre de la roue est à son rayon d'origine, plus la descente.
    return { x, z, cy: origin + r.drop, radius: axle.outer, rim: axle.rim, half: axle.width / 2000 };
  });
  let worst = 0;
  let where = '';
  for (const [name, node] of nodes) {
    if (name.startsWith('roue_') || grounded.has(name)) continue;
    for (const part of node.parts) {
      if (vehicle.kind === 'car' && part.material === 'black') continue;
      const pos = part.geometry.getAttribute('position');
      for (let i = 0; i < pos.count; i += 1) {
        const px = pos.getX(i);
        const py = pos.getY(i);
        const pz = pos.getZ(i);
        for (const w of wheels) {
          // Voiture : seule la moitié extérieure du pneu se voit sous l'aile ; dedans, il frôle la doublure.
          if (vehicle.kind === 'car' && (pz - w.z) * Math.sign(w.z) < 0) continue;
          const d = Math.hypot(px - w.x, py - w.cy);
          // Tangent à 2 mm près (tube de cadre qui longe le flanc) : pas une traversée.
          if (Math.abs(pz - w.z) > halfWidthAt(vehicle.kind, w, d) - 0.002) continue;
          if (d < w.radius && d > w.rim + 0.02 && w.radius - d > worst) {
            worst = w.radius - d;
            where = `${name}/${part.material} (${px.toFixed(3)}, ${py.toFixed(3)}, ${pz.toFixed(3)})`;
          }
        }
      }
    }
  }
  return { depth: worst, where };
}

describe('les roues posées ne traversent pas la caisse, assiette au plus bas', () => {
  for (const id of ['cox', 'van', 'bobber', 'sportive']) {
    it(id, async () => {
      const vehicle = VEHICLES.find((item) => item.id === id)!;
      const fit = vehicle.wheels!.fit!;
      const nodes = await model(id);
      const low = { [WHEEL_TUNE.ride]: 1 };
      const builds: Array<[string, Build]> = [
        ['origine', { paints: {}, tune: { ...low } }],
        ['plus grande', { paints: {}, tune: { ...low, [WHEEL_TUNE.diameter]: fit.diameter[1], [WHEEL_TUNE.aspect]: fit.aspect[1], ...(fit.width ? { [WHEEL_TUNE.width]: fit.width[1] } : {}), ...(fit.rearWidth ? { [WHEEL_TUNE.rearWidth]: fit.rearWidth[1] } : {}) } }],
        ['plus petite', { paints: {}, tune: { ...low, [WHEEL_TUNE.diameter]: fit.diameter[0], [WHEEL_TUNE.aspect]: fit.aspect[0] } }],
        ['origine, assiette d’usine', { paints: {}, tune: {} }],
      ];
      for (const [label, build] of builds) {
        // Tolérance : 5 mm (pli de garde-boue, rebord de bourrelet).
        const hit = penetration(vehicle, nodes, build);
        expect(hit.depth, `${id}, ${label} : ${hit.where}`).toBeLessThan(0.005);
      }
    }, 60_000);
  }
});
