// La Cox (placeholder_cox) : manifeste et modèle généré par assets-src/vehicles/cox/model.mjs,
// contrôlés contre les conventions du § 8 du cahier des charges et les cotes de la fiche « La Cox ».

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseGlb } from '../../tools/lib/glb.mjs';
import { buildVehicle } from '../../tools/vehicles/build.mjs';
import * as kit from '../../tools/vehicles/kit.mjs';
import { buildRim, buildTire, readCatalogue } from '../../tools/vehicles/roues.mjs';
import * as habitacle from '../../tools/vehicles/habitacle.mjs';
import { outerRadius } from '../../src/data/wheels.ts';
import { FINISHES } from '../../src/data/finishes.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { DEFAULT_SEAT, placeEye } from '../../src/scene/fit.ts';

const manifest = JSON.parse(readFileSync(new URL('../../public/assets/vehicles/cox/vehicle.json', import.meta.url), 'utf8')) as VehicleManifest;

/** Écart relatif sous 5 %. */
const near = (value: number, expected: number) => expect(Math.abs(value - expected) / expected).toBeLessThan(0.05);

/** Matériaux des roues partagées que l'app pose sur les ancres (jantes du genre, tous les pneus). */
function sharedWheelMaterials(kind: 'car' | 'bike'): string[] {
  const catalogue = readCatalogue();
  const parts = [...catalogue.rims.filter((rim) => rim.kind === kind).flatMap((rim) => buildRim(rim, catalogue)), ...catalogue.tires.flatMap((tire) => buildTire(tire, kind, catalogue))];
  return [...new Set(parts.map((part) => part.material))];
}

/** Matériaux des pièces d'habitacle partagées que l'app pose sur les ancres (volants, pommeaux, sièges). */
function sharedInteriorMaterials(): string[] {
  const catalogue = habitacle.readCatalogue();
  const parts = [...catalogue.steering.flatMap(habitacle.buildSteering), ...catalogue.knobs.flatMap(habitacle.buildKnob), ...catalogue.seats.flatMap(habitacle.buildSeat)];
  return [...new Set(parts.map((part) => part.material))];
}

describe('manifeste de la Cox', () => {
  it('décrit le substitut déclaré, au rang 10 de la vague 1', () => {
    expect(manifest.id).toBe('cox');
    expect(manifest.kind).toBe('car');
    expect(manifest.wave).toBe(1);
    expect(manifest.order).toBe(10);
    expect(manifest.glb).toBe('body.glb');
    expect(manifest.placeholder).toBe('placeholder_cox');
    expect(manifest.hint).toBeTruthy();
    expect(manifest.hint).not.toContain('\n');
    near(manifest.halfLengthHint, 3.84 / 2);
  });

  it('porte les zones de la fiche, peintes d’origine en sarcelle pailleté fin', () => {
    const ids = manifest.zones.map((z) => z.id);
    expect(ids).toEqual(expect.arrayContaining(['carrosserie', 'toit', 'capot', 'capot_moteur', 'ailes', 'jantes', 'sellerie']));
    expect(new Set(ids).size).toBe(ids.length);
    expect(manifest.zones[0]!.id).toBe('carrosserie');
    const finishIds = new Set<string>(FINISHES.map((f) => f.id));
    for (const zone of manifest.zones) {
      expect(zone.id).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(zone.label.length).toBeGreaterThan(0);
      expect(zone.paint.color).toMatch(/^#[0-9a-f]{6}$/);
      expect(finishIds.has(zone.paint.finish)).toBe(true);
      expect(zone.materials).toEqual([`paint_${zone.id}`]);
    }
    const byId = Object.fromEntries(manifest.zones.map((z) => [z.id, z]));
    for (const id of ['carrosserie', 'toit', 'capot', 'capot_moteur', 'ailes']) {
      expect(byId[id]!.group).toBe('carrosserie');
      expect(byId[id]!.paint.color).toBe('#0a3a46');
      expect(byId[id]!.paint.finish).toBe('paillete');
      // Paillettes plus fines que celles de la finition, réglées dans le manifeste (en mm).
      expect(byId[id]!.paint.flake).toBeGreaterThan(0);
      expect(byId[id]!.paint.flake!).toBeLessThan(FINISHES.find((f) => f.id === 'paillete')!.flakeSize);
      expect(byId[id]!.linked).not.toBe(false); // ailes liées, comme le reste de la caisse
    }
    expect(byId.jantes!.group).toBe('accastillage');
    expect(byId.jantes!.paint.finish).toBe('chrome');
    expect(byId.sellerie!.group).toBe('accastillage');
    expect(byId.sellerie!.paint.finish).toBe('satine');
  });

  it('déclare trois places, posées sur les ancres des sièges : conducteur à gauche, passager, arrière derrière eux', () => {
    const views = [manifest.interiorView!, ...(manifest.interiorViews ?? [])];
    expect(views.map((view) => [view.place, view.label])).toEqual([
      ['conducteur', 'Conducteur'],
      ['passager', 'Passager'],
      ['arriere', 'Arrière'],
    ]);
    const [driver, passenger, rear] = views.map((view) => view.seat!);
    expect(driver!.anchors).toEqual(['siege_avant_gauche']); // conduite à gauche
    expect(passenger!.anchors).toEqual(['siege_avant_droit']);
    expect([...rear!.anchors].sort()).toEqual(['siege_avant_droit', 'siege_avant_gauche']);
    expect(rear!.side ?? 0).toBe(0); // entre les deux sièges avant, vers le pare-brise
    for (const seat of [driver, passenger]) {
      expect(seat!.up).toBeGreaterThanOrEqual(0.8); // tête d'une personne assise
      expect(seat!.up).toBeLessThanOrEqual(0.9);
      expect(seat!.ahead).toBeGreaterThan(0); // devant le dossier
    }
    expect(rear!.behind).toBeGreaterThan(0.2); // derrière le dos des sièges avant
    for (const view of views) {
      expect(view.look!.pitch).toBeLessThan(0); // volant, compteur, pommeau
      expect(view.look!.pitch).toBeGreaterThan(-20);
    }
  });

  it('donne le moteur de la fiche', () => {
    expect(manifest.engine).toEqual({ label: '4 cylindres à plat refroidi par air', fuel: 'essence', feed: 'carburateur', boost: 'atmo', power: 50, sound: 'quatre-a-plat' });
  });
});

describe('modèle de la Cox', () => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON glTF lu tel quel
  let json: Record<string, any>;
  let summary: Awaited<ReturnType<typeof buildVehicle>>['summary'];

  beforeAll(async () => {
    const built = await buildVehicle('cox');
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
    // Le pommeau et les sièges avant sont des pièces d'habitacle partagées (tools/vehicles/habitacle.mjs) :
    // leurs zones, déclarées par le manifeste (interior), sont portées par ces pièces.
    const interiorZones = [manifest.interior?.knob?.zone, manifest.interior?.seats?.zone];
    expect(interiorZones).toEqual(['pommeau', 'sellerie']);
    const interiorMaterials = sharedInteriorMaterials();
    for (const zone of manifest.zones) {
      if (zone.id === fitZone) continue;
      for (const mat of zone.materials) expect(interiorZones.includes(zone.id) ? interiorMaterials : summary.materials).toContain(mat);
    }
    const wheelMaterials = sharedWheelMaterials(manifest.kind);
    expect(wheelMaterials).toContain(`paint_${fitZone}`);
    for (const role of ['glass', 'lamp', 'tail', 'signal', 'chrome', 'rubber', 'black']) expect([...summary.materials, ...wheelMaterials]).toContain(role);
  });

  // Budget relevé pour la Cox (habitacle complet pour la vue intérieure) : 150 000 triangles.
  it('tient les budgets : 40 000 à 150 000 triangles, moins de 60 appels de dessin', () => {
    expect(summary.triangles).toBeGreaterThanOrEqual(40_000);
    expect(summary.triangles).toBeLessThanOrEqual(150_000);
    expect(summary.primitives).toBeLessThan(60);
  });

  it('garnit l’habitacle en noir : sellerie, ciel de toit, pommeau dans sa zone, dans la caisse', () => {
    const node = json.nodes.find((n: { name: string }) => n.name === 'habitacle');
    expect(node).toBeDefined();
    const mats = json.meshes[node.mesh].primitives.map((p: { material: number }) => json.materials[p.material].name as string);
    for (const m of ['paint_sellerie', 'black', 'tail', 'chrome']) expect(mats).toContain(m);
    // Le pommeau d'origine (tête de mort couleur os, langue rouge) est posé par l'app sur l'ancre `pommeau`.
    const knob = habitacle.readCatalogue().knobs.find((item) => item.id === manifest.interior?.knob?.default);
    expect(knob?.id).toBe('tete_de_mort');
    const knobMats = habitacle.buildKnob(knob!).map((part) => part.material);
    for (const m of ['paint_pommeau', 'tail', 'black']) expect(knobMats).toContain(m);
    const anchor = json.nodes.find((n: { name: string }) => n.name === 'pommeau');
    expect(anchor).toBeDefined();
    expect(anchor.mesh).toBeUndefined();
    // Tout noir mat d'après la fiche : plus de ciel de toit en cuir.
    expect(mats).not.toContain('leather');
    const cabin = nodeBox('habitacle');
    const body = nodeBox('carrosserie');
    for (let i = 0; i < 3; i += 1) {
      expect(cabin.min[i]!).toBeGreaterThan(body.min[i]!);
      expect(cabin.max[i]!).toBeLessThan(body.max[i]!);
    }
    for (let i = 0; i < 3; i += 1) {
      expect(anchor.translation[i]).toBeGreaterThan(cabin.min[i]!);
      expect(anchor.translation[i]).toBeLessThan(cabin.max[i]!);
    }
    // Chaque œil, posé sur les ancres de ses sièges (siège moyen ; chaque siège du catalogue et le
    // pavillon mesuré : tests/unit/places.test.ts), est dans l'habitacle garni.
    for (const view of [manifest.interiorView!, ...(manifest.interiorViews ?? [])]) {
      const seats = view.seat!.anchors.map((name) => ({ anchor: json.nodes.find((n: { name: string }) => n.name === name).translation as [number, number, number], metrics: DEFAULT_SEAT }));
      const eye = placeEye(view.seat!, seats, () => cabin.max[1]!)!;
      for (let i = 0; i < 3; i += 1) {
        expect(eye[i]!).toBeGreaterThan(cabin.min[i]!);
        expect(eye[i]!).toBeLessThan(cabin.max[i]!);
      }
    }
  });

  it('pose ses roues au centre de l’empattement de 2,40 m, sur les voies de la fiche', () => {
    // Caisse seule (les roues sont posées par l'app) : son point le plus bas est la garde au sol du manifeste.
    expect(summary.min[1]).toBeCloseTo(manifest.wheels!.floor, 2);
    const wheels = json.nodes.filter((n: { name: string }) => n.name.startsWith('roue_'));
    expect(wheels.map((n: { name: string }) => n.name).sort()).toEqual(['roue_arriere_droite', 'roue_arriere_gauche', 'roue_avant_droite', 'roue_avant_gauche']);
    const at = (name: string) => wheels.find((n: { name: string }) => n.name === name).translation as number[];
    near(at('roue_avant_droite')[0]! - at('roue_arriere_droite')[0]!, 2.4);
    expect(at('roue_avant_droite')[0]! + at('roue_arriere_droite')[0]!).toBeCloseTo(0, 3);
    near(at('roue_avant_droite')[2]! - at('roue_avant_gauche')[2]!, 1.31);
    near(at('roue_arriere_droite')[2]! - at('roue_arriere_gauche')[2]!, 1.35);
    // Ancres sans maillage ; roues d'origine de 0,60 m de diamètre (cotes du manifeste, avant et
    // arrière), centre de chaque ancre à son rayon : la roue posée touche le sol.
    for (const name of ['roue_avant_droite', 'roue_avant_gauche', 'roue_arriere_droite', 'roue_arriere_gauche']) {
      expect(wheels.find((n: { name: string }) => n.name === name).mesh).toBeUndefined();
    }
    const fit = manifest.wheels!.fit!;
    near(2 * outerRadius(fit.front), 0.6);
    near(2 * outerRadius(fit.rear!), 0.6);
    expect(at('roue_avant_droite')[1]!).toBeCloseTo(outerRadius(fit.front), 2);
    expect(at('roue_arriere_droite')[1]!).toBeCloseTo(outerRadius(fit.rear!), 2);
    // Pneus plus larges à l'arrière (165 et 185 de la fiche).
    expect(fit.front.width).toBe(165);
    expect(fit.rear!.width).toBe(185);
  });

  it('a les cotes du gabarit à 5 % près (caisse hors rétroviseur)', () => {
    const body = nodeBox('carrosserie');
    // Caisse sans pare-chocs : 3,76 m (gabarit de profil, captures/notes-agents/vague-n-cox.md).
    near(body.max[0]! - body.min[0]!, 3.76);
    near(body.max[2]! - body.min[2]!, 1.55);
    near(body.max[1]!, 1.44);
    expect(body.max[2]! + body.min[2]!).toBeCloseTo(0, 2); // symétrique gauche-droite
    // Garde au sol de 0,11 m, à 1 cm près.
    expect(Math.abs(body.min[1]! - 0.11)).toBeLessThan(0.01);
    // Avant vers +X : le porte-à-faux avant (0,58 m) est plus court que l'arrière (0,77 m).
    expect(body.max[0]! - 1.2).toBeLessThan(-body.min[0]! - 1.2);
    // Longueur hors tout, échappements compris.
    near(summary.max[0] - summary.min[0], 3.84);
  });
});
