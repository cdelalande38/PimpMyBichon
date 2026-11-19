// Néons du véhicule (Custom › Néons, vague V) : catalogue des zones, sections `neons` des cinq manifestes,
// lecture tolérante du build (rien d'écrit quand tout est éteint, valeur inconnue = éteint), articles de
// la boutique, géométrie (tubes, arceaux, nappes), niveau du dock, LED d'habitacle et lumière d'habitacle.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARTICLES_NEONS } from '../../src/data/articles/neons.ts';
import { PIECES } from '../../src/data/boutique.ts';
import { cabinFor, interiorTints, ledHabitacle } from '../../src/data/habitacle.ts';
import {
  arceaux,
  articleNeon,
  checkNeons,
  etatNeon,
  etatsDeSignature,
  forceLueur,
  intensiteNeon,
  NEON_INTENSITE,
  NEON_TEINTES,
  NEON_TUBE,
  NEON_ZONES,
  neonKeys,
  neonSignature,
  neonZonesOf,
  porteeLueur,
  resolveNeons,
  zoneInfo,
} from '../../src/data/neons.ts';
import { validateManifest } from '../../src/data/vehicles.ts';
import type { Build, VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { buildNeonGeometry } from '../../src/scene/vehicle/neons.ts';
import { sanitizeLevels } from '../../src/state/dock.ts';
import { resolveWheels, WHEEL_TUNE } from '../../src/data/wheels.ts';
import { Box3, Group, Mesh, Raycaster, Vector3, type Object3D } from 'three';
import { builtModel, storedModel } from './places-modeles.ts';

const read = (id: string) => validateManifest(JSON.parse(readFileSync(new URL(`../../public/assets/vehicles/${id}/vehicle.json`, import.meta.url), 'utf8')), id);
const VOITURES = ['concept', 'cox', 'van'].map(read);
const MOTOS = ['sportive', 'bobber'].map(read);
const concept = VOITURES[0] as VehicleManifest;
const bobber = MOTOS[1] as VehicleManifest;
const HEX = /^#[0-9a-f]{6}$/;

describe('catalogue des zones', () => {
  it('identifiants uniques, couleurs d’origine, une zone libre par genre, l’habitacle à part', () => {
    const ids = NEON_ZONES.map((zone) => zone.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const zone of NEON_ZONES) expect(zone.couleur, zone.id).toMatch(HEX);
    expect(NEON_ZONES.filter((zone) => zone.libre).map((zone) => zone.id)).toEqual(['avant', 'cadre']);
    expect(NEON_ZONES.filter((zone) => zone.habitacle).map((zone) => zone.id)).toEqual(['habitacle']);
    for (const teinte of NEON_TEINTES) expect(teinte.color).toMatch(HEX);
  });

  it('chaque zone payante a son article, de 60 à 400 $, rangé dans la boutique ; les libres n’en ont pas', () => {
    for (const zone of NEON_ZONES) {
      const id = articleNeon(zone.id);
      if (zone.libre) {
        expect(id, zone.id).toBeNull();
        continue;
      }
      expect(id).toBe(`piece-neon-${zone.id}`);
      const article = ARTICLES_NEONS.find((item) => item.id === id);
      expect(article, zone.id).toBeDefined();
      expect(article?.famille).toBe('piece');
      expect(article?.prix).toBeGreaterThanOrEqual(60);
      expect(article?.prix).toBeLessThanOrEqual(400);
      expect(PIECES.some((item) => item.id === id), zone.id).toBe(true);
    }
    expect(new Set(ARTICLES_NEONS.map((item) => item.id)).size).toBe(ARTICLES_NEONS.length);
  });
});

describe('manifestes', () => {
  it('les trois voitures : avant, flancs, arrière, roues et habitacle ; les deux motos : cadre et roues', () => {
    for (const voiture of VOITURES) expect(neonZonesOf(voiture).map((zone) => zone.id), voiture.id).toEqual(['avant', 'flancs', 'arriere', 'roues', 'habitacle']);
    for (const moto of MOTOS) expect(neonZonesOf(moto).map((zone) => zone.id), moto.id).toEqual(['cadre', 'roues']);
  });

  it('les tubes passent sous la caisse (au-dessus du sol, sous le plancher de l’habitacle) et dans son gabarit', () => {
    for (const vehicle of [...VOITURES, ...MOTOS]) {
      for (const zone of neonZonesOf(vehicle)) {
        for (const line of zone.spec.tubes ?? []) {
          for (const [x, y, z] of line) {
            expect(y, `${vehicle.id}.${zone.id}`).toBeGreaterThan(0.03);
            expect(Math.abs(x), `${vehicle.id}.${zone.id}`).toBeLessThan(2.6);
            expect(Math.abs(z), `${vehicle.id}.${zone.id}`).toBeLessThan(1.2);
            if (!zone.habitacle) expect(y, `${vehicle.id}.${zone.id} : sous la caisse`).toBeLessThan(0.35);
          }
        }
      }
    }
  });

  it('refuse une zone inconnue, des tubes mal formés, des nappes hors de l’habitacle, un habitacle de moto', () => {
    const problems = (raw: unknown, kind = 'car') => {
      const list: string[] = [];
      checkNeons(raw, kind, list);
      return list;
    };
    expect(problems(undefined)).toEqual([]);
    expect(problems({ avant: { tubes: [[[0, 0.1, 0], [1, 0.1, 0]]] } })).toEqual([]);
    expect(problems({ toit: { tubes: [[[0, 0.1, 0], [1, 0.1, 0]]] } }).join()).toMatch(/zone inconnue/);
    expect(problems({ avant: { tubes: [[[0, 0.1, 0]]] } }).join()).toMatch(/tubes/);
    expect(problems({ avant: {} }).join()).toMatch(/des tubes, ou des arceaux/);
    expect(problems({ avant: { arceaux: true } }).join()).toMatch(/seulement pour la zone roues/);
    expect(problems({ flancs: { tubes: [[[0, 0.1, 0], [1, 0.1, 0]]], pools: [] } }).join()).toMatch(/seulement pour l’habitacle/);
    expect(problems({ habitacle: { tubes: [[[0, 0.5, 0], [1, 0.5, 0]]] } }, 'bike').join()).toMatch(/moto/);
    expect(problems({ roues: { arceaux: true, radius: 0.5 } }).join()).toMatch(/radius/);
    // Les arceaux d'une voiture sont ancrés aux passages de roue de la caisse, déclarés ; une moto n'en a pas.
    const passages = [{ centre: [1.3, 0.33, 0.9], rayon: 0.38 }];
    expect(problems({ roues: { arceaux: true } }).join()).toMatch(/passages/);
    expect(problems({ roues: { arceaux: true, passages } })).toEqual([]);
    expect(problems({ roues: { arceaux: true, passages: [{ centre: [1.3, 0.33, 0.9], rayon: 2 }] } }).join()).toMatch(/passages doit/);
    expect(problems({ roues: { arceaux: true, passages: [{ centre: [1.3, -0.1, 0.9], rayon: 0.38 }] } }).join()).toMatch(/passages doit/);
    expect(problems({ roues: { arceaux: true } }, 'bike')).toEqual([]);
    expect(problems({ roues: { arceaux: true, passages } }, 'bike').join()).toMatch(/seulement pour les arceaux d’une voiture/);
  });
});

describe('sauvegarde', () => {
  const avant = zoneInfo('avant')!;

  it('rien d’écrit : éteinte, couleur et intensité d’origine ; un mode inconnu retombe sur éteint', () => {
    expect(etatNeon(avant, undefined)).toMatchObject({ on: false, mode: 'fixe', color: avant.couleur, intensity: NEON_INTENSITE.origine });
    expect(etatNeon(avant, { parts: { neon_avant: 'stroboscope' } }).on).toBe(false);
    expect(etatNeon(avant, { parts: { neon_avant: 'respiration' }, partPaints: { neon_avant: { color: 'rouge' } } })).toMatchObject({ on: true, mode: 'respiration', color: avant.couleur });
    expect(intensiteNeon(5)).toBe(NEON_INTENSITE.max);
    expect(intensiteNeon(-1)).toBe(NEON_INTENSITE.min);
    expect(intensiteNeon('fort')).toBe(NEON_INTENSITE.origine);
  });

  it('la clé ne dit que les zones allumées, et se relit telle quelle ; vide quand tout est éteint', () => {
    const build: Build = { paints: {}, parts: { neon_avant: 'fixe', neon_flancs: 'respiration' }, partPaints: { neon_flancs: { color: '#ff2bd6' } }, tune: { neon_avant: 0.5 } };
    expect(neonSignature(concept, {})).toBe('');
    const signature = neonSignature(concept, build);
    expect(signature).toBe('avant:fixe:#18e4ff:0.50|flancs:respiration:#ff2bd6:0.80');
    const relus = etatsDeSignature(signature);
    expect(relus.map((etat) => [etat.zone.id, etat.mode, etat.color, etat.intensity])).toEqual(
      resolveNeons(concept, build)
        .filter((etat) => etat.on)
        .map((etat) => [etat.zone.id, etat.mode, etat.color, etat.intensity]),
    );
    expect(etatsDeSignature('toit:fixe:#ffffff:1|avant:fixe:pas-une-couleur:1')).toEqual([]);
  });

  it('« Tout éteindre » retire les trois postes de chaque zone', () => {
    const keys = neonKeys(bobber);
    expect(keys.parts).toEqual(['neon_cadre', 'neon_roues']);
    expect(keys.partPaints).toEqual(keys.parts);
    expect(keys.tune).toEqual(keys.parts);
  });
});

describe('géométrie', () => {
  const roue = (x: number, z: number) => ({ centre: [x, 0.33, z] as const, rayon: 0.33, jante: 0.22, demiLargeur: 0.11 });

  it('voiture : un arc dans chaque passage de roue déclaré, des deux côtés, qui remonte dans l’arche au-dessus d’un grand pneu ; moto : deux cercles par roue', () => {
    const passages = [{ centre: [1.3, 0.33, 0.9] as const, rayon: 0.38 }];
    const arcs = arceaux('car', [roue(1.3, 0.75), roue(1.3, -0.75)], passages, 0.006);
    expect(arcs).toEqual(arceaux('car', [], passages));
    // Un pneu plus grand, caisse posée au sol : l'arc garde son centre et s'écarte du pneu de son épaisseur.
    const grand = { centre: [1.3, 0.35, 0.75] as const, rayon: 0.37, jante: 0.25, demiLargeur: 0.11 };
    const ecarte = arceaux('car', [grand], passages, 0.006)[0] ?? [];
    for (const p of ecarte) expect(Math.hypot(p[0] - 1.3, p[1] - 0.35) - 0.37 - 0.006).toBeGreaterThan(0);
    expect(arcs).toHaveLength(2);
    for (const line of arcs) for (const p of line) expect(Math.hypot(p[0] - 1.3, p[1] - 0.33)).toBeCloseTo(0.38, 6);
    for (const line of arcs) for (const p of line) expect(p[1]).toBeGreaterThan(0.33);
    expect(arcs[0]?.every((p) => p[2] === 0.9)).toBe(true);
    expect(arcs[1]?.every((p) => p[2] === -0.9)).toBe(true);
    const cercles = arceaux('bike', [roue(0.7, 0)]);
    expect(cercles).toHaveLength(2);
    expect(cercles[0]?.[0]?.[2]).toBeLessThan(0);
    expect(cercles[1]?.[0]?.[2]).toBeGreaterThan(0);
  });

  it('la lueur s’élargit et faiblit quand le tube monte', () => {
    expect(porteeLueur(0.1)).toBeLessThan(porteeLueur(0.6));
    expect(forceLueur(0.1)).toBeGreaterThan(forceLueur(0.6));
    expect(porteeLueur(5)).toBeLessThanOrEqual(1.05);
  });

  it('un maillage de tubes, un de nappes au sol, un de nappes dans l’habitacle ; un tube par ligne', () => {
    const geometry = buildNeonGeometry(concept, [roue(1.25, 0.98), roue(1.25, -0.98), roue(-1.55, 0.98), roue(-1.55, -0.98)], { y: 0, pitch: 0 });
    const lignes = neonZonesOf(concept).reduce((sum, zone) => sum + (zone.spec.tubes?.length ?? 0), 0) + 4;
    expect(geometry.compte.tubes).toBe(lignes);
    expect(geometry.tubes.getAttribute('aZone').count).toBe(geometry.tubes.getAttribute('position').count);
    expect(geometry.sol.index?.count ?? 0).toBeGreaterThan(0);
    expect(geometry.cabine?.index?.count ?? 0).toBeGreaterThan(0);
    // Les nappes au sol sont à plat, au ras du sol ; celles de l'habitacle, sur son plancher.
    const sol = geometry.sol.getAttribute('position');
    for (let i = 0; i < sol.count; i += 1) expect(sol.getY(i)).toBeLessThan(0.01);
    // Tous les triangles des nappes regardent vers le haut (matière à une face) : aucun bout n'est éliminé.
    for (const nappes of [geometry.sol, geometry.cabine!]) {
      const index = nappes.index!;
      const position = nappes.getAttribute('position');
      // Le bord d'une nappe est posé par le nuanceur : le point de la ligne plus son débord (aOut).
      const out = nappes.getAttribute('aOut');
      const x = (i: number) => position.getX(i) + out.getX(i);
      const z = (i: number) => position.getZ(i) + out.getY(i);
      let vers = 0;
      for (let i = 0; i < index.count; i += 3) {
        const [a, b, c] = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
        // Composante verticale du produit vectoriel (b − a) × (c − a) : positive, face vers le haut.
        const up = (z(b) - z(a)) * (x(c) - x(a)) - (x(b) - x(a)) * (z(c) - z(a));
        expect(up).toBeGreaterThan(0);
        vers += 1;
      }
      expect(vers).toBe(index.count / 3);
    }
    const cabine = geometry.cabine!.getAttribute('position');
    for (let i = 0; i < cabine.count; i += 1) expect(cabine.getY(i)).toBeGreaterThan(0.1);
    // Une moto : pas d'habitacle.
    expect(buildNeonGeometry(bobber, [], { y: 0, pitch: 0 }).cabine).toBeNull();
  });
});

describe('dock et habitacle', () => {
  it('Néons : un seul niveau sous l’entrée, la zone choisie et son nom (comme Moteur et Carrosserie) ; tout le reste est écarté', () => {
    expect(sanitizeLevels('neons', [{ kind: 'element', element: 'flancs', libelle: 'Flancs' }])).toEqual([{ kind: 'element', element: 'flancs', libelle: 'Flancs' }]);
    expect(sanitizeLevels('neons', [{ kind: 'zone', zone: 'flancs', step: 'couleur' }])).toEqual([]);
    expect(sanitizeLevels('peinture', [{ kind: 'element', element: 'flancs', libelle: 'Flancs' }])).toEqual([]);
  });

  it('LED d’habitacle : la lumière d’habitacle du van prend leur couleur ; éteintes, rien ne change', () => {
    const van = VOITURES[2] as VehicleManifest;
    expect(ledHabitacle(van, undefined)).toBeNull();
    expect(cabinFor(van, undefined)?.light?.color).toBe(cabinFor(van, { paints: {} })?.light?.color);
    const build: Build = { paints: {}, parts: { neon_habitacle: 'fixe' }, partPaints: { neon_habitacle: { color: '#3dff7a' } } };
    expect(ledHabitacle(van, build)).toEqual({ color: '#3dff7a', intensity: NEON_INTENSITE.origine });
    expect(cabinFor(van, build)?.light?.color).toBe('#3dff7a');
  });

  it('le concept : ses teintes d’habitacle sont des zones de peinture, son ciel étoilé est éteint d’origine', () => {
    expect(interiorTints(concept).map((zone) => zone.id)).toEqual(['sellerie', 'planche', 'sieges_ton', 'tapis']);
    expect(concept.cabin?.sky?.on).toBe(false);
    expect(cabinFor(concept, undefined)?.sky).toBeUndefined();
    expect(cabinFor(concept, { paints: {}, parts: { ciel: 'allume' } })?.sky?.count).toBeGreaterThan(0);
  });
});

// Les arcs des passages de roue contre le modèle (vague V, lot neons2 : « des arcs qui flottent à côté de
// la caisse »). Le modèle est lu comme dans l'app (posé au sol, centré, roues d'atelier comptées par leur
// rayon) ; pour chaque voiture et chaque réglage de roue extrême (jante, largeur et série du pneu à leurs
// bornes, caisse posée au sol ou rehaussée), aucun point d'un arc ne dépasse la tôle en travers (rayon
// horizontal tiré du dehors, juste au-dessus de l'arche), ni ne passe sous le sol, ni n'entre dans le pneu.
describe('arcs des passages de roue, contre le modèle', () => {
  /** Modèle posé comme `prepare` (src/scene/vehicle/VehicleModel.tsx, étape 6) : rend la caisse, sans les roues. */
  async function caisseDe(vehicle: VehicleManifest): Promise<Mesh[]> {
    const root = await builtModel(vehicle.id).catch(() => storedModel(vehicle.id));
    const turn = root.children[0] as Group;
    const named = new Set(vehicle.wheels?.nodes ?? []);
    const wheels: Object3D[] = [];
    const visit = (node: Object3D) => (/^(roue|wheel)_/i.test(node.name) || named.has(node.name) ? wheels.push(node) : node.children.forEach(visit));
    visit(turn);
    turn.position.set(0, 0, 0);
    turn.updateMatrixWorld(true);
    const box = new Box3().setFromObject(turn, true);
    for (const node of wheels) {
      if (!new Box3().setFromObject(node, true).isEmpty()) continue;
      const at = node.getWorldPosition(new Vector3());
      const r = Math.max(0.05, at.y);
      box.expandByPoint(at.clone().addScalar(r)).expandByPoint(at.clone().subScalar(r));
    }
    const center = box.getCenter(new Vector3());
    turn.position.set(-center.x, -box.min.y, -center.z);
    root.updateMatrixWorld(true);
    const roues = new Set<Object3D>();
    for (const node of wheels) node.traverse((object) => roues.add(object));
    const caisse: Mesh[] = [];
    root.traverse((object) => {
      if (object instanceof Mesh && !roues.has(object)) caisse.push(object);
    });
    return caisse;
  }

  for (const vehicle of VOITURES) {
    it(`${vehicle.id} : dans l’arche, sous la tôle, au-dessus du sol et du pneu, roues à leurs extrêmes`, { timeout: 60_000 }, async () => {
      const spec = vehicle.neons?.roues;
      expect(spec?.passages?.length).toBe(2);
      const ruban = spec?.radius ?? NEON_TUBE.rayon;
      const arcs = arceaux('car', [], spec?.passages, ruban);
      const caisse = await caisseDe(vehicle);
      const ray = new Raycaster();
      const origin = new Vector3();
      const down = new Vector3();
      for (const [rang, line] of arcs.entries()) {
        const passage = spec?.passages?.[rang >> 1];
        if (!passage) throw new Error('passage manquant');
        const [cx, cy] = passage.centre;
        for (const p of line) {
          // La lèvre de l'aile, vue du dehors, de 3 à 5 cm au-dessus de l'arc (la tôle la plus en dehors au
          // bord de l'arche) : le ruban reste en retrait.
          const side = Math.sign(p[2]);
          let levre = 0;
          for (const plus of [0.03, 0.04, 0.05]) {
            const k = (passage.rayon + plus) / passage.rayon;
            ray.set(origin.set(cx + (p[0] - cx) * k, cy + (p[1] - cy) * k, side * 4), down.set(0, 0, -side));
            levre = Math.max(levre, Math.abs(ray.intersectObjects(caisse, false)[0]?.point.z ?? 0));
          }
          expect(levre, `${vehicle.id} : pas de tôle au-dessus de l'arc en ${p.map((n) => n.toFixed(2)).join(', ')}`).toBeGreaterThan(0);
          expect(Math.abs(p[2]) + ruban).toBeLessThanOrEqual(levre);
        }
      }
      // Réglages extrêmes : les roues bougent, la caisse monte ou descend ; l'arc, lui, est dans la caisse.
      const fit = vehicle.wheels?.fit;
      const bornes = (range: readonly [number, number] | undefined, base: number) => (range ? [range[0], range[1]] : [base]);
      for (const diameter of bornes(fit?.diameter, 0))
        for (const width of bornes(fit?.width, 0))
          for (const aspect of bornes(fit?.aspect, 0))
            for (const ride of [-1, 1]) {
              const tune = { [WHEEL_TUNE.diameter]: diameter, [WHEEL_TUNE.width]: width, [WHEEL_TUNE.aspect]: aspect, [WHEEL_TUNE.ride]: ride };
              const resolved = resolveWheels(vehicle, { paints: {}, tune });
              if (!resolved) throw new Error('roues');
              // Repère de la caisse au repos : la roue (au sol) remonte de la descente, son rayon change.
              const posees = (spec?.passages ?? []).flatMap((passage) => {
                const front = passage.centre[0] > 0;
                const outer = (front ? resolved.front?.outer : resolved.rear?.outer) ?? passage.centre[1];
                const lift = front ? resolved.lift.front : resolved.lift.rear;
                return [1, -1].map((s) => ({ centre: [passage.centre[0], outer - lift, s * 0.8] as const, rayon: outer, jante: outer * 0.68, demiLargeur: 0.1 }));
              });
              for (const [rang, line] of arceaux('car', posees, spec?.passages, ruban).entries()) {
                const passage = spec?.passages?.[rang >> 1];
                const front = (passage?.centre[0] ?? 0) > 0;
                const lift = front ? resolved.lift.front : resolved.lift.rear;
                const outer = (front ? resolved.front?.outer : resolved.rear?.outer) ?? (passage?.centre[1] ?? 0);
                const wheelY = outer - lift;
                for (const p of line) {
                  expect(p[1] + lift - ruban, `${vehicle.id} : sous le sol`).toBeGreaterThan(0);
                  const gap = Math.hypot(p[0] - (passage?.centre[0] ?? 0), p[1] - wheelY) - outer - ruban;
                  expect(gap, `${vehicle.id} ${JSON.stringify(tune)} : l'arc entre dans le pneu`).toBeGreaterThanOrEqual(-1e-3);
                }
              }
            }
    });
  }
});
