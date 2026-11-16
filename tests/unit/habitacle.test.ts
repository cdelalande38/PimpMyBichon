// Habitacle (§ 5.4, demande du 15 novembre 2026) : volants, pommeaux, sièges avant et ciel étoilé.
// Catalogue partagé, valeurs inconnues qui retombent sur l'origine, ancres présentes dans les
// modèles, budgets du § 8 avec les pièces les plus lourdes, rien qui traverse le plancher ni le
// tableau de bord, et deux onglets qui ne s'écrasent pas.

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildVehicle, interiorAnchors, interiorClearance, summarize, VEHICLE_MAX } from '../../tools/vehicles/build.mjs';
import * as habitacle from '../../tools/vehicles/habitacle.mjs';
import * as kit from '../../tools/vehicles/kit.mjs';
import { buildRim, buildTire, readCatalogue as readWheels } from '../../tools/vehicles/roues.mjs';
import {
  cabinFor,
  INTERIOR_CATALOGUE,
  INTERIOR_SLOTS,
  interiorFiles,
  interiorMode,
  interiorTouched,
  resolveInterior,
  resolveSky,
  SKY_OFF,
  SKY_ON,
  SKY_TUNE,
  validateInteriorCatalogue,
} from '../../src/data/habitacle.ts';
import { TUTOS } from '../../src/data/tutos.ts';
import { validateManifest } from '../../src/data/vehicles.ts';
import type { Build, VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { skyHeight, starLayout } from '../../src/scene/cabin.ts';
import { sanitizeBuilds } from '../../src/state/builds.ts';
import { createSharedStorage } from '../../src/state/persistence.ts';

const read = (id: string) => JSON.parse(readFileSync(new URL(`../../public/assets/vehicles/${id}/vehicle.json`, import.meta.url), 'utf8')) as VehicleManifest;
const cox = validateManifest(read('cox'), 'cox');
const van = validateManifest(read('van'), 'van');
const concept = validateManifest(read('concept'), 'concept');
const bobber = validateManifest(read('bobber'), 'bobber');

type Piece = { summary: ReturnType<typeof summarize>; parts: kit.Parts; kind: 'steering' | 'knob' | 'seat' };

/** Les pièces du catalogue, modelées en mémoire (sans écrire de fichier), avec leur résumé. */
function pieces(): Map<string, Piece> {
  const catalogue = habitacle.readCatalogue();
  const out = new Map<string, Piece>();
  const add = (file: string, parts: kit.Parts, kind: Piece['kind']) => {
    const m = new kit.Model('piece');
    m.add('piece', parts);
    out.set(file, { summary: summarize(m.toGlb().bytes), parts, kind });
  };
  for (const e of catalogue.steering) add(habitacle.steeringFile(e.id), habitacle.buildSteering(e), 'steering');
  for (const e of catalogue.knobs) add(habitacle.knobFile(e.id), habitacle.buildKnob(e), 'knob');
  for (const e of catalogue.seats) add(habitacle.seatFile(e.id), habitacle.buildSeat(e), 'seat');
  return out;
}

describe('catalogue de l’habitacle', () => {
  it('se valide, et propose au moins quatre volants, quatre pommeaux et trois sièges de la demande', () => {
    expect(() => validateInteriorCatalogue(JSON.parse(readFileSync(habitacle.CATALOGUE_URL, 'utf8')))).not.toThrow();
    const styles = (list: ReadonlyArray<{ style: string }>) => list.map((item) => item.style);
    expect(styles(INTERIOR_CATALOGUE.steering)).toEqual(expect.arrayContaining(['deux_branches', 'trois_branches', 'tulipe', 'bois']));
    expect(styles(INTERIOR_CATALOGUE.knobs)).toEqual(expect.arrayContaining(['boule', 'poire', 'cylindre', 'motif']));
    expect(styles(INTERIOR_CATALOGUE.seats)).toEqual(expect.arrayContaining(['baquet', 'capitonne']));
    expect(INTERIOR_CATALOGUE.sky.densities).toHaveLength(3);
  });

  it('refuse un catalogue abîmé avec un message clair', () => {
    expect(() => validateInteriorCatalogue({ ...INTERIOR_CATALOGUE, knobs: [] })).toThrow(/knobs : au moins une pièce/);
    expect(() => validateInteriorCatalogue({ ...INTERIOR_CATALOGUE, steering: [{ id: 'x', style: 'y', label: 'z' }] })).toThrow(/steering\[0\]\.color/);
    expect(() => validateInteriorCatalogue('rien')).toThrow(/catalogue\.json/);
  });

  it('modèle chaque pièce aux conventions : matériaux par rôle, couleurs libres nommées, aucun texte', () => {
    for (const [file, piece] of pieces()) {
      expect(piece.summary.triangles, file).toBeGreaterThan(200);
      for (const material of piece.summary.materials) {
        expect(material, file).toMatch(kit.MATERIAL_NAME);
        if (material.startsWith('paint_')) expect(['paint_volant', 'paint_pommeau', 'paint_sellerie'], file).toContain(material);
      }
    }
    // Chaque volant a sa jante à couleur libre ; chaque pommeau sa couleur ; chaque siège sa sellerie.
    const all = pieces();
    for (const e of INTERIOR_CATALOGUE.steering) expect(all.get(habitacle.steeringFile(e.id))!.summary.materials).toContain('paint_volant');
    for (const e of INTERIOR_CATALOGUE.knobs) expect(all.get(habitacle.knobFile(e.id))!.summary.materials).toContain('paint_pommeau');
    for (const e of INTERIOR_CATALOGUE.seats) expect(all.get(habitacle.seatFile(e.id))!.summary.materials).toContain('paint_sellerie');
  });
});

describe('ce que l’atelier pose', () => {
  it('à l’origine : les pièces du manifeste, la sellerie et le pommeau de la Cox dans leurs zones', () => {
    const r = resolveInterior(cox, undefined)!;
    expect([r.steering?.id, r.knob?.id, r.seats?.id]).toEqual(['sport', 'tete_de_mort', 'bas']);
    expect(r.knobZone).toBe('pommeau');
    expect(r.seatZone).toBe('sellerie');
    const v = resolveInterior(van, undefined)!;
    expect([v.steering?.id, v.knob?.id, v.seats?.id]).toEqual(['moyeu_large', 'boule', 'confort']);
    expect(v.seatZone).toBeNull();
    expect(interiorFiles(v)).toEqual({ steering: 'volant_moyeu_large.glb', knob: 'pommeau_boule.glb', seat: 'siege_confort.glb' });
  });

  it('une valeur inconnue retombe sur l’origine : pièce, couleur, ciel, densité', () => {
    const build: Build = {
      paints: {},
      parts: { [INTERIOR_SLOTS.steering]: 'volant_de_course_fou', [INTERIOR_SLOTS.knob]: 'inconnu', [INTERIOR_SLOTS.seats]: 'trone', [INTERIOR_SLOTS.sky]: 'clignotant' },
      partPaints: { [INTERIOR_SLOTS.steering]: { color: 'rouge' }, [INTERIOR_SLOTS.sky]: { color: '#12' } },
      tune: { [SKY_TUNE]: 7 },
    };
    const r = resolveInterior(cox, build)!;
    expect([r.steering?.id, r.knob?.id, r.seats?.id]).toEqual(['sport', 'tete_de_mort', 'bas']);
    expect(r.steeringColor).toBe(INTERIOR_CATALOGUE.steering.find((item) => item.id === 'sport')!.color);
    expect(resolveSky(van, build)).toEqual({ on: true, color: van.cabin!.sky!.color, density: INTERIOR_CATALOGUE.sky.origin });
    expect(resolveSky(cox, build)?.on).toBe(false);
    expect(resolveSky(van, { paints: {}, tune: { [SKY_TUNE]: 1.5 } })?.density).toBe(INTERIOR_CATALOGUE.sky.origin);
    // La sauvegarde relue écarte ce qui n'est pas un identifiant.
    const saved = sanitizeBuilds({ builds: { cox: { paints: {}, parts: { volant: 'Volant Fou !', pommeau: 'boule' } } } });
    expect(saved.builds.cox?.parts).toEqual({ pommeau: 'boule' });
  });

  it('les choix posés : volant, pommeau, sièges et couleurs', () => {
    const build: Build = {
      paints: {},
      parts: { volant: 'bois', pommeau: 'motif', sieges: 'capitonne' },
      partPaints: { volant: { color: '#c81e1e' }, pommeau: { color: '#1b3fa0' } },
    };
    const r = resolveInterior(van, build)!;
    expect([r.steering?.id, r.knob?.id, r.seats?.id, r.steeringColor, r.knobColor]).toEqual(['bois', 'motif', 'capitonne', '#c81e1e', '#1b3fa0']);
    expect(interiorTouched(build)).toBe(true);
    expect(interiorTouched({ paints: {} })).toBe(false);
    expect(interiorTouched({ paints: { pommeau: { color: '#ffffff' } } }, 'pommeau')).toBe(true);
  });

  it('le concept garde son intérieur ; une moto n’a pas d’habitacle', () => {
    expect(interiorMode(concept)).toBe('fixe');
    expect(resolveInterior(concept, undefined)).toBeNull();
    expect(interiorMode(bobber)).toBe('aucun');
    expect(interiorMode(cox)).toBe('choix');
    expect(interiorMode(van)).toBe('choix');
  });
});

describe('ciel étoilé', () => {
  it('sur la Cox (éteint d’origine) comme sur le van (allumé, médaillon gardé)', () => {
    expect(cox.cabin?.sky?.on).toBe(false);
    expect(cabinFor(cox, undefined)?.sky).toBeUndefined();
    const lit = cabinFor(cox, { paints: {}, parts: { ciel: SKY_ON } })!;
    expect(lit.sky?.count).toBe(cox.cabin!.sky!.count);
    expect(cabinFor(van, undefined)?.sky?.medallion).toEqual(van.cabin!.sky!.medallion);
  });

  it('couleur libre, trois crans de densité, éteint : le plafonnier reprend, le pavillon sa garniture', () => {
    const counts = [0, 1, 2].map((rank) => cabinFor(van, { paints: {}, tune: { [SKY_TUNE]: rank } })!.sky!.count);
    expect(counts[0]).toBeLessThan(counts[1]!);
    expect(counts[1]).toBeLessThan(counts[2]!);
    expect(counts[2]).toBeLessThanOrEqual(2000);
    const blue = cabinFor(van, { paints: {}, partPaints: { ciel: { color: '#3b7bff' } } })!;
    expect(blue.sky?.color).toBe('#3b7bff');
    expect(blue.light?.color ?? blue.sky?.color).toBe('#3b7bff');
    const off = cabinFor(van, { paints: {}, parts: { ciel: SKY_OFF } })!;
    expect(off.sky).toBeUndefined();
    expect(off.light?.color).toBe('#ffe2c0');
    expect(off.light!.intensity).toBeLessThan(van.cabin!.light!.intensity);
    // Panneaux du van (cadrans, écran) : jamais touchés par le ciel.
    expect(off.panels).toEqual(van.cabin!.panels);
  });

  it('sous le pavillon bombé de la Cox, les points suivent sa courbe', () => {
    const sky = cox.cabin!.sky!;
    const stars = starLayout({ ...sky, on: true });
    expect(stars.length).toBe(sky.count);
    const middle = skyHeight(sky, sky.center[0], sky.center[2]);
    const edge = skyHeight(sky, sky.center[0] + sky.size[0] / 2, sky.center[2] + sky.size[1] / 2);
    expect(middle - edge).toBeCloseTo(sky.crown!, 6);
    for (const star of stars) {
      expect(star.y).toBeGreaterThanOrEqual(sky.center[1] - 1e-9);
      expect(star.y).toBeLessThanOrEqual(sky.center[1] + sky.crown! + 1e-9);
    }
  });
});

describe('pièces posées dans les modèles', () => {
  const built = new Map<string, Awaited<ReturnType<typeof buildVehicle>>>();
  let all: Map<string, Piece>;
  beforeAll(async () => {
    for (const id of ['cox', 'van']) built.set(id, await buildVehicle(id));
    all = pieces();
  }, 90_000);

  it('les ancres du catalogue sont dans la Cox et le van, sans maillage', () => {
    const names = [INTERIOR_CATALOGUE.anchors.steering, INTERIOR_CATALOGUE.anchors.knob, ...INTERIOR_CATALOGUE.anchors.seats];
    for (const id of ['cox', 'van']) {
      const anchors = interiorAnchors(built.get(id)!.bytes);
      expect([...anchors.keys()].sort(), id).toEqual([...names].sort());
      // Sièges en miroir : même x et même hauteur, de part et d'autre de l'axe.
      const [left, right] = INTERIOR_CATALOGUE.anchors.seats.map((name) => anchors.get(name)!.t);
      expect(left![0]).toBeCloseTo(right![0]!, 6);
      expect(left![2]).toBeCloseTo(-right![2]!, 6);
      // Volant côté conducteur (gauche, −Z).
      expect(anchors.get('volant')!.t[2]!).toBeLessThan(0);
    }
  });

  it('rien ne traverse le plancher ni le tableau de bord, quelle que soit la pièce', () => {
    for (const [id, manifest] of [['cox', cox], ['van', van]] as const) {
      expect(manifest.interior?.clearance, id).toBeDefined();
      expect(interiorClearance(manifest, interiorAnchors(built.get(id)!.bytes), all), id).toEqual([]);
    }
  });

  it('le contrôle voit une pièce qui traverserait : plancher remonté, tableau de bord avancé', () => {
    const anchors = interiorAnchors(built.get('cox')!.bytes);
    const floor = interiorClearance({ interior: { clearance: { floor: 0.3, dash: [0.575, 0.99] } } }, anchors, all);
    expect(floor.some((line: string) => /sous le plancher/.test(line))).toBe(true);
    const dash = interiorClearance({ interior: { clearance: { floor: 0.113, dash: [0.2, 0.99] } } }, anchors, all);
    expect(dash.some((line: string) => /volant_.*dans le tableau de bord/.test(line))).toBe(true);
  });

  it('tient les budgets du § 8 avec les roues et les pièces d’habitacle les plus lourdes', () => {
    const wheels = readWheels();
    const glb = (parts: kit.Parts) => {
      const m = new kit.Model('piece');
      m.add('piece', parts);
      return summarize(m.toGlb().bytes);
    };
    const rims = wheels.rims.filter((rim) => rim.kind === 'car').map((rim) => glb(buildRim(rim, wheels)));
    const tires = wheels.tires.map((tire) => glb(buildTire(tire, 'car', wheels)));
    const worst = (list: Array<ReturnType<typeof summarize>>, key: 'triangles' | 'primitives') => Math.max(...list.map((s) => s[key]));
    const kind = (k: Piece['kind']) => [...all.values()].filter((p) => p.kind === k).map((p) => p.summary);
    for (const id of ['cox', 'van']) {
      const body = built.get(id)!.summary;
      const triangles = body.triangles + 4 * (worst(rims, 'triangles') + worst(tires, 'triangles')) + worst(kind('steering'), 'triangles') + worst(kind('knob'), 'triangles') + 2 * worst(kind('seat'), 'triangles');
      const drawCalls = body.primitives + 4 * (worst(rims, 'primitives') + worst(tires, 'primitives')) + worst(kind('steering'), 'primitives') + worst(kind('knob'), 'primitives') + 2 * worst(kind('seat'), 'primitives');
      expect(triangles, id).toBeLessThanOrEqual(VEHICLE_MAX.triangles);
      expect(drawCalls, id).toBeLessThanOrEqual(VEHICLE_MAX.drawCalls);
    }
  });
});

describe('sauvegarde', () => {
  it('deux onglets qui changent chacun une pièce de l’habitacle ne s’écrasent pas', async () => {
    const KEY = 'pmb-builds';
    const table = new Map<string, string>();
    const initial = { state: { current: 'cox', builds: { cox: { paints: {} } }, recents: [] }, version: 1 };
    table.set(KEY, JSON.stringify(initial));
    const backend = {
      get: async (name: string) => table.get(name) ?? null,
      update: async (name: string, compute: (raw: string | null) => string | null) => {
        const next = compute(table.get(name) ?? null);
        if (next === null) return false;
        table.set(name, next);
        return true;
      },
      del: async (name: string) => {
        table.delete(name);
      },
    };
    const a = createSharedStorage(backend).storage;
    const b = createSharedStorage(backend).storage;
    await a.getItem(KEY);
    await b.getItem(KEY);
    const withParts = (parts: Record<string, string>, partPaints?: Record<string, { color: string }>) =>
      JSON.stringify({ ...initial, state: { ...initial.state, builds: { cox: { paints: {}, parts, ...(partPaints ? { partPaints } : {}) } } } });
    await a.setItem(KEY, withParts({ volant: 'bois' }, { volant: { color: '#c81e1e' } }));
    await b.setItem(KEY, withParts({ pommeau: 'boule', ciel: 'allume' }));
    const saved = sanitizeBuilds((JSON.parse(table.get(KEY)!) as { state: unknown }).state);
    expect(saved.builds.cox?.parts).toEqual({ volant: 'bois', pommeau: 'boule', ciel: 'allume' });
    expect(saved.builds.cox?.partPaints).toEqual({ volant: { color: '#c81e1e' } });
  });
});

describe('tutoriel', () => {
  it('l’entrée Intérieur a le sien, court', () => {
    const tuto = TUTOS.find((item) => item.ecrans.includes('entree:interieur'));
    expect(tuto).toBeDefined();
    for (const text of [tuto!.but, ...tuto!.etapes.map((etape) => etape.texte)]) expect(text.length, text).toBeLessThanOrEqual(140);
  });
});
