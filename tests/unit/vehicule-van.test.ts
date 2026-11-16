// Le van (placeholder_van) : manifeste et modèle généré par assets-src/vehicles/van/model.mjs,
// contrôlés contre les conventions du § 8 du cahier des charges et le gabarit de la fiche « Le van ».

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseGlb } from '../../tools/lib/glb.mjs';
import { buildVehicle } from '../../tools/vehicles/build.mjs';
import * as kit from '../../tools/vehicles/kit.mjs';
import { buildRim, buildTire, readCatalogue } from '../../tools/vehicles/roues.mjs';
import { outerRadius } from '../../src/data/wheels.ts';
import { FINISHES } from '../../src/data/finishes.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';

const manifest = JSON.parse(readFileSync(new URL('../../public/assets/vehicles/van/vehicle.json', import.meta.url), 'utf8')) as VehicleManifest;

/** Écart relatif sous 5 %. */
const near = (value: number, expected: number) => expect(Math.abs(value - expected) / expected).toBeLessThan(0.05);

/** Matériaux des roues partagées que l'app pose sur les ancres (jantes du genre, tous les pneus). */
function sharedWheelMaterials(kind: 'car' | 'bike'): string[] {
  const catalogue = readCatalogue();
  const parts = [...catalogue.rims.filter((rim) => rim.kind === kind).flatMap((rim) => buildRim(rim, catalogue)), ...catalogue.tires.flatMap((tire) => buildTire(tire, kind, catalogue))];
  return [...new Set(parts.map((part) => part.material))];
}

describe('manifeste du van', () => {
  it('décrit le substitut déclaré, au rang 20 de la vague 1', () => {
    expect(manifest.id).toBe('van');
    expect(manifest.kind).toBe('car');
    expect(manifest.wave).toBe(1);
    expect(manifest.order).toBe(20);
    expect(manifest.glb).toBe('body.glb');
    expect(manifest.placeholder).toBe('placeholder_van');
    expect(manifest.hint).toBeTruthy();
    expect(manifest.hint).not.toContain('\n');
    near(manifest.halfLengthHint, 4.89 / 2);
  });

  it('garde ses zones d’origine (un build sauvegardé reste lisible), en blanc satiné et boucliers gris mat', () => {
    expect(manifest.zones.map((z) => z.id)).toEqual(['carrosserie', 'toit', 'boucliers', 'jantes']);
    const finishIds = new Set<string>(FINISHES.map((f) => f.id));
    for (const zone of manifest.zones) {
      expect(zone.paint.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(finishIds.has(zone.paint.finish)).toBe(true);
      expect(zone.materials).toEqual([`paint_${zone.id}`]);
    }
    const byId = Object.fromEntries(manifest.zones.map((z) => [z.id, z]));
    expect(byId.carrosserie!.paint).toEqual({ color: '#f0efe9', finish: 'satine' });
    expect(byId.boucliers!.paint).toEqual({ color: '#3a3d42', finish: 'mat' });
    expect(byId.boucliers!.linked).toBe(false);
    expect(byId.jantes!.group).toBe('accastillage');
  });

  it('donne le moteur de la fiche', () => {
    expect(manifest.engine).toEqual({ label: '4 cylindres turbo diesel', fuel: 'diesel', feed: 'injection', boost: 'turbo', power: 102, sound: 'diesel-turbo' });
  });

  // Vue intérieure retirée le 15 novembre 2026 (habitacle presque noir), revenue avec un habitacle
  // percé aux vitres, un ciel étoilé, des cadrans clairs et une lumière d'habitacle (cabin).
  it('la vue intérieure du van : conducteur, passager, et l’arrière sous le ciel étoilé, derrière les sièges avant', () => {
    const views = [manifest.interiorView!, ...(manifest.interiorViews ?? [])];
    expect(views.map((view) => view.place)).toEqual(['conducteur', 'passager', 'arriere']);
    const rear = views[2]!;
    expect([...rear.seat!.anchors].sort()).toEqual(['siege_avant_droit', 'siege_avant_gauche']);
    expect(rear.seat!.behind).toBeGreaterThan(0.5); // dans la cabine arrière, sous le ciel
    expect(rear.seat!.side).toBeGreaterThan(0); // derrière le passager
    expect(rear.look!.yaw).toBeLessThan(0); // vers l'avant, entre les deux sièges
    expect(rear.volets).toEqual(expect.arrayContaining(['ciel']));
    expect(views[0]!.seat!.anchors).toEqual(['siege_avant_gauche']); // conducteur à gauche
    expect(views[0]!.volets).toEqual(expect.arrayContaining(['volant', 'pommeau']));
  });

  it('allume en vue intérieure un ciel étoilé sous le pavillon, sa lumière et ses cadrans', () => {
    const cabin = manifest.cabin!;
    expect(cabin.sky).toBeDefined();
    expect(cabin.sky!.center[1]).toBeGreaterThan(1.8);
    expect(cabin.sky!.center[1]).toBeLessThan(1.86); // sous la doublure du pavillon (1,90 − 4,5 cm)
    expect(cabin.light!.position[1]).toBeLessThan(cabin.sky!.center[1]);
    expect(cabin.light!.distance).toBeLessThan(4); // n'éclaire pas le garage
    // Cadrans au tableau de bord, devant le conducteur (face du tableau : interior.clearance.dash).
    for (const panel of cabin.panels ?? []) expect(panel.center[0]).toBeGreaterThan(manifest.interior!.clearance!.dash[0]! - 0.05);
  });
});

describe('modèle du van', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON glTF lu tel quel
  let json: Record<string, any>;
  let summary: Awaited<ReturnType<typeof buildVehicle>>['summary'];

  beforeAll(async () => {
    const built = await buildVehicle('van');
    summary = built.summary;
    const parsed = parseGlb(built.bytes);
    if (!parsed.ok) throw new Error(parsed.message);
    json = parsed.container.json;
  }, 60_000);

  /** Boîte englobante d'un nœud (maillage posé sans rotation). */
  const nodeBox = (name: string) => {
    const node = json.nodes.find((n: { name: string }) => n.name === name);
    const t = node.translation ?? [0, 0, 0];
    const min = [Infinity, Infinity, Infinity];
    const max = [-Infinity, -Infinity, -Infinity];
    for (const p of json.meshes[node.mesh].primitives) {
      const acc = json.accessors[p.attributes.POSITION];
      for (let i = 0; i < 3; i += 1) {
        min[i] = Math.min(min[i]!, acc.min[i] + t[i]);
        max[i] = Math.max(max[i]!, acc.max[i] + t[i]);
      }
    }
    return { min, max };
  };

  it('nomme ses matériaux par rôle, et chaque peinture est une zone du manifeste', () => {
    const zoneMaterials = manifest.zones.flatMap((z) => z.materials);
    for (const name of summary.materials) {
      expect(name).toMatch(kit.MATERIAL_NAME);
      if (name.startsWith('paint_')) expect(zoneMaterials).toContain(name);
    }
    // La zone des jantes est portée par les jantes partagées (tools/vehicles/roues.mjs), que l'app pose sur les ancres.
    const fitZone = manifest.wheels?.fit?.zone;
    expect(fitZone).toBeDefined();
    for (const zone of manifest.zones) for (const mat of zone.materials) if (zone.id !== fitZone) expect(summary.materials).toContain(mat);
    const wheelMaterials = sharedWheelMaterials(manifest.kind);
    expect(wheelMaterials).toContain(`paint_${fitZone}`);
    for (const role of ['glass', 'lamp', 'tail', 'signal', 'chrome', 'rubber', 'black', 'leather']) expect([...summary.materials, ...wheelMaterials]).toContain(role);
  });

  it('tient les budgets : 40 000 à 120 000 triangles, moins de 60 appels de dessin', () => {
    expect(summary.triangles).toBeGreaterThanOrEqual(40_000);
    expect(summary.triangles).toBeLessThanOrEqual(120_000);
    expect(summary.primitives).toBeLessThan(60);
  });

  it('pose ses roues de 0,66 au centre de l’empattement de 3,00 m, sur des voies de 1,63', () => {
    // Caisse seule (les roues sont posées par l'app) : son point le plus bas est la garde au sol du manifeste.
    expect(summary.min[1]).toBeCloseTo(manifest.wheels!.floor, 2);
    const wheels = json.nodes.filter((n: { name: string }) => n.name.startsWith('roue_'));
    expect(wheels.map((n: { name: string }) => n.name).sort()).toEqual(['roue_arriere_droite', 'roue_arriere_gauche', 'roue_avant_droite', 'roue_avant_gauche']);
    const at = (name: string) => wheels.find((n: { name: string }) => n.name === name).translation as number[];
    expect(at('roue_avant_droite')[0]).toBeCloseTo(1.5, 3);
    expect(at('roue_arriere_droite')[0]).toBeCloseTo(-1.5, 3);
    near(at('roue_avant_droite')[2]! - at('roue_avant_gauche')[2]!, 1.63);
    near(at('roue_arriere_droite')[2]! - at('roue_arriere_gauche')[2]!, 1.63);
    // Ancres sans maillage ; roue d'origine de 0,66 (cotes du manifeste), centre à son rayon : au sol.
    expect(wheels.every((n: { mesh?: number }) => n.mesh === undefined)).toBe(true);
    const radius = outerRadius(manifest.wheels!.fit!.front);
    near(2 * radius, 0.66);
    for (const n of wheels) expect((n.translation as number[])[1]!).toBeCloseTo(radius, 2);
  });

  it('a les cotes du gabarit à 5 % près (caisse hors rétroviseurs)', () => {
    const body = nodeBox('carrosserie');
    expect(body.max[0]).toBeCloseTo(2.4, 2); // avant
    expect(body.min[0]).toBeCloseTo(-2.49, 2); // arrière
    near(body.max[2]! - body.min[2]!, 1.9);
    near(body.max[1]!, 1.9);
    expect(body.max[2]! + body.min[2]!).toBeCloseTo(0, 2); // symétrique gauche-droite
    // Rétroviseurs : hors de la caisse, à peu près 1,15 m de l'axe.
    const acc = nodeBox('accessoires');
    expect(acc.max[2]).toBeGreaterThan(1.05);
    expect(acc.max[2]).toBeLessThan(1.25);
  });
});
