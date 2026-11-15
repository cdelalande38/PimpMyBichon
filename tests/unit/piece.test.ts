// Pièce cliquable : données des points d'intérêt, lancer de rayon sur des boîtes, geste d'appui
// court, matériau du véhicule → zone du manifeste.

import { Texture } from 'three';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCK_MENU } from '../../src/data/dockMenu.ts';
import { GARAGE } from '../../src/data/garage.ts';
import { POINTS_INTERET } from '../../src/data/pointsInteret.ts';
import { VEHICLES } from '../../src/data/vehicles.ts';
import { parseHash, routeToHash } from '../../src/app/router.ts';
import type { GarageScene } from '../../src/scene/garage/build.ts';
import type { Box } from '../../src/scene/garage/cut.ts';
import { anchorOf, createTapTracker, materialOf, pickTarget, rayBox, targetsFromElements, zoneForMaterial, type PieceTarget } from '../../src/scene/extras/piece.ts';
import { masterZone } from '../../src/state/builds.ts';
import { PIN_HINT_MS, samePins, usePiece } from '../../src/state/piece.ts';

/** Les textures du garage se dessinent au canvas : sans DOM, elles restent vides. */
function stubDocument(): () => void {
  const scope = globalThis as unknown as { document?: unknown };
  if (scope.document !== undefined) return () => {};
  scope.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
  return () => {
    delete scope.document;
  };
}

let garage: GarageScene;
let unstub: () => void = () => {};
beforeAll(async () => {
  unstub = stubDocument();
  const { createGarage } = await import('../../src/scene/garage/build.ts');
  garage = createGarage(GARAGE, { artwork: () => ({ texture: new Texture(), release: () => {} }) });
});
afterAll(() => {
  garage.dispose();
  unstub();
});

const box = (min: [number, number, number], max: [number, number, number]): Box => ({ min, max });
const target = (id: string, boxes: Box[]): PieceTarget => {
  const point = POINTS_INTERET[0];
  if (!point) throw new Error('aucun point');
  return { point: { ...point, id }, boxes, cutId: 0, anchor: { x: 0, y: 0, z: 0 } };
};

describe('points d’intérêt : les données', () => {
  it('chaque point vise un objet du décor qui existe, une seule fois', () => {
    const names = new Set([...GARAGE.props.map((prop) => prop.name), ...GARAGE.signs.map((sign) => sign.name)]);
    for (const point of POINTS_INTERET) expect(names.has(point.target), point.target).toBe(true);
    expect(new Set(POINTS_INTERET.map((point) => point.id)).size).toBe(POINTS_INTERET.length);
  });

  it('chaque objet visé est un élément de la coupe caméra, avec des boîtes', () => {
    const targets = targetsFromElements(garage.cut.elements, POINTS_INTERET);
    expect(targets.map((item) => item.point.id)).toEqual(POINTS_INTERET.map((point) => point.id));
    for (const item of targets) {
      expect(item.boxes.length).toBeGreaterThan(0);
      expect(garage.cut.elements[item.cutId - 1]?.name).toBe(item.point.target);
    }
  });

  it('chaque action est connue : un panneau routé, ou une entrée disponible du dock', () => {
    for (const point of POINTS_INTERET) {
      const { action } = point;
      if (action.kind === 'panneau') expect(parseHash(routeToHash({ name: action.sheet })).name).toBe(action.sheet);
      else expect(DOCK_MENU.some((section) => section.entries.some((entry) => entry.id === action.entry && entry.available)), point.id).toBe(true);
      expect(point.label.length).toBeGreaterThan(0);
    }
  });

  it('les menus attendus : radio, préparation, sous le capot, ambiance', () => {
    const byTarget = (name: string) => POINTS_INTERET.find((point) => point.target === name)?.action;
    expect(byTarget('placeholder_enceintes')).toEqual({ kind: 'panneau', sheet: 'radio' });
    expect(byTarget('placeholder_bloc_moteur')).toEqual({ kind: 'entree', entry: 'preparation' });
    expect(byTarget('placeholder_etabli')).toEqual({ kind: 'panneau', sheet: 'capot' });
    expect(byTarget('placeholder_servante')).toEqual({ kind: 'panneau', sheet: 'capot' });
    expect(byTarget('neon_pimpmybichon')).toEqual({ kind: 'entree', entry: 'ambiance' });
  });
});

describe('lancer de rayon sur des boîtes', () => {
  it('distance d’entrée, origine dedans, boîte manquée ou derrière', () => {
    const unit = box([-1, -1, -1], [1, 1, 1]);
    expect(rayBox({ x: -5, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, unit)).toBeCloseTo(4);
    expect(rayBox({ x: 0, y: 0, z: 0 }, { x: 0, y: 1, z: 0 }, unit)).toBe(0);
    expect(rayBox({ x: -5, y: 3, z: 0 }, { x: 1, y: 0, z: 0 }, unit)).toBeNull();
    expect(rayBox({ x: 5, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, unit)).toBeNull();
  });

  it('le plus proche gagne, un objet coupé est ignoré', () => {
    const near = target('pres', [box([1, -1, -1], [2, 1, 1])]);
    const far = target('loin', [box([5, -1, -1], [6, 1, 1])]);
    const origin = { x: 0, y: 0, z: 0 };
    const dir = { x: 1, y: 0, z: 0 };
    expect(pickTarget(origin, dir, [far, near])?.target.point.id).toBe('pres');
    expect(pickTarget(origin, dir, [far, near], (item) => item.point.id === 'pres')?.target.point.id).toBe('loin');
    expect(pickTarget(origin, { x: 0, y: 1, z: 0 }, [far, near])).toBeNull();
  });

  it('un rayon tiré de la pièce vers l’ancre d’un objet le touche (boîtes réelles du décor)', () => {
    const targets = targetsFromElements(garage.cut.elements, POINTS_INTERET);
    // Œil au milieu de la pièce, à hauteur d'homme : chaque ancre est sur son objet.
    const eye = { x: 0, y: 1.6, z: 1.5 };
    for (const item of targets) {
      const d = { x: item.anchor.x - eye.x, y: item.anchor.y - eye.y, z: item.anchor.z - eye.z };
      const length = Math.hypot(d.x, d.y, d.z);
      const dir = { x: d.x / length, y: d.y / length, z: d.z / length };
      const hit = pickTarget(eye, dir, [item]);
      expect(hit?.target.point.id, item.point.id).toBe(item.point.id);
    }
  });

  it('ancre : sur une pièce de l’objet, même quand ses pièces forment deux groupes', () => {
    const left = box([0, 0, 0], [1, 1, 1]);
    const right = box([9, 0, 0], [10, 1, 1]);
    const anchor = anchorOf([left, right]);
    expect(anchor && (anchor.x === 0.5 || anchor.x === 9.5)).toBe(true);
    expect(anchorOf([left], [1, 2, 3])).toEqual({ x: 1, y: 2, z: 3 });
  });
});

describe('appui court', () => {
  it('bref et immobile : oui ; long, glissé ou à deux doigts : non', () => {
    const tap = createTapTracker();
    tap.down(1, 100, 100, 0);
    expect(tap.up(1, 104, 103, 150)).toBe(true);
    tap.down(1, 100, 100, 0);
    expect(tap.up(1, 100, 100, 400)).toBe(false);
    tap.down(1, 100, 100, 0);
    tap.move(1, 140, 100);
    expect(tap.up(1, 100, 100, 100)).toBe(false);
    tap.down(1, 100, 100, 0);
    tap.down(2, 200, 200, 10);
    expect(tap.up(2, 200, 200, 50)).toBe(false);
    expect(tap.up(1, 100, 100, 60)).toBe(false);
    tap.down(3, 0, 0, 0);
    tap.cancel(3);
    expect(tap.up(3, 0, 0, 10)).toBe(false);
  });

  it('les pastilles ne changent que si une position bouge', () => {
    expect(samePins([{ id: 'a', x: 1, y: 2 }], [{ id: 'a', x: 1, y: 2 }])).toBe(true);
    expect(samePins([{ id: 'a', x: 1, y: 2 }], [{ id: 'a', x: 1, y: 3 }])).toBe(false);
    expect(samePins([], [{ id: 'a', x: 1, y: 2 }])).toBe(false);
  });
});

describe('matériau du véhicule → zone', () => {
  it('maillage fusionné : le nom porte le matériau', () => {
    expect(materialOf('fusion_carrosserie', 'autre')).toBe('carrosserie');
    expect(materialOf('roue_avant', 'pneu')).toBe('pneu');
  });

  it('chaque matériau d’une zone mène à sa zone ; hors zone : la zone maîtresse', () => {
    for (const vehicle of VEHICLES) {
      for (const zone of vehicle.zones) {
        for (const material of zone.materials) {
          const owner = vehicle.zones.find((candidate) => candidate.materials.includes(material));
          expect(zoneForMaterial(vehicle, material), `${vehicle.id} · ${material}`).toBe(owner?.id);
        }
      }
      expect(zoneForMaterial(vehicle, 'materiau_inconnu')).toBe(masterZone(vehicle)?.id);
      const last = vehicle.zones.at(-1);
      if (last) expect(zoneForMaterial(vehicle, `paint_${last.id}.001`), `${vehicle.id} · paint_${last.id}`).toBe(last.id);
    }
  });
});

describe('repères brefs de la pièce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    usePiece.getState().hide();
  });
  afterEach(() => {
    usePiece.getState().hide();
    vi.useRealTimers();
  });

  it('effacés au repos, allumés par reveal, puis effacés seuls après le délai', () => {
    expect(usePiece.getState().shown).toBe(false);
    usePiece.getState().reveal();
    expect(usePiece.getState().shown).toBe(true);
    vi.advanceTimersByTime(PIN_HINT_MS - 1);
    expect(usePiece.getState().shown).toBe(true);
    vi.advanceTimersByTime(1);
    expect(usePiece.getState().shown).toBe(false);
  });

  it('un nouveau geste relance le délai, et hide efface tout de suite sans rallumage tardif', () => {
    usePiece.getState().reveal();
    vi.advanceTimersByTime(PIN_HINT_MS - 100);
    usePiece.getState().reveal();
    vi.advanceTimersByTime(PIN_HINT_MS - 100);
    expect(usePiece.getState().shown).toBe(true);
    usePiece.getState().hide();
    expect(usePiece.getState().shown).toBe(false);
    vi.advanceTimersByTime(PIN_HINT_MS * 2);
    expect(usePiece.getState().shown).toBe(false);
  });
});
