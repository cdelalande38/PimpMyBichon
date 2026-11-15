// Coupe caméra du décor : règles du module pur (R1 adossement, R2 dégagement, R3 support,
// hystérésis, fondu), puis preuves sur le garage réel : garde-fou de structure, rien ne flotte,
// balayage d'yeux autour du véhicule vérifié par lancer de rayons, et rien de trop masqué.
import { FrontSide, Mesh, ShaderLib, Texture, Vector3, type BufferGeometry, type Material } from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AMBIANCES } from '../../src/data/ambiances.ts';
import { FRAMINGS } from '../../src/data/framings.ts';
import { GARAGE } from '../../src/data/garage.ts';
import { CUT_ATTRIBUTE, CUT_CAPACITY, CUT_DITHER_DEFINE } from '../../src/render/cut.ts';
import { hasCutDither } from '../../src/render/cutDither.ts';
import { isDitherCarrier, patchGarageShader, patchSurfaceShader } from '../../src/render/floor.ts';
import { framingPose, frontFromTurn } from '../../src/render/photo/framing.ts';
import { fitCamera, orbitPosition } from '../../src/scene/fit.ts';
import type { GarageScene } from '../../src/scene/garage/build.ts';
import {
  analyzeCut,
  boxInHull,
  createCutState,
  decideCut,
  ditherNeeds,
  ditherOwners,
  inFade,
  protectedBoxes,
  stepFades,
  supportsOf,
  type Box,
  type CutElement,
  type CutState,
  type CutStructure,
  type Point,
  type ProtectBoxes,
} from '../../src/scene/garage/cut.ts';

const ROOM = { width: 8, depth: 6, height: 3 };
const TOL = { wall: 0.15, contact: 0.03 };
const box = (min: [number, number, number], max: [number, number, number]): Box => ({ min, max });
const eye = (x: number, y: number, z: number): Point => ({ x, y, z });
/** Véhicule d'essai au centre de la pièce, et son volume protégé. */
const VEHICLE = box([-2, 0, -1], [2, 1.3, 1]);
const P: ProtectBoxes = { vehicle: VEHICLE, small: box([-2.2, -0.5, -1.2], [2.2, 1.5, 1.2]), big: box([-2.4, -0.7, -1.4], [2.4, 1.7, 1.4]) };

function decide(structure: CutStructure, at: Point, state = createCutState(structure), protect = P, band = 0.1): CutState {
  return decideCut(structure, at, protect, band, state);
}

function hiddenNames(structure: CutStructure, state: CutState): string[] {
  return structure.names.filter((_, i) => state.hidden[i] === 1);
}

describe('coupe : R2, le volume balayé entre l’œil et P', () => {
  const front = eye(0, 1, 10);
  it('une boîte entre l’œil et le véhicule coupe le volume ; derrière ou à côté, non', () => {
    expect(boxInHull(front, P.small, box([-0.5, 0, 3], [0.5, 1, 4]))).toBe(true);
    expect(boxInHull(front, P.small, box([-0.5, 0, -3], [0.5, 1, -2]))).toBe(false);
    expect(boxInHull(front, P.small, box([3.5, 0, 3], [4, 1, 4]))).toBe(false);
    // Au-dessus du cône de vue vers P, même entre les deux : non.
    expect(boxInHull(front, P.small, box([-0.5, 2.5, 3], [0.5, 3, 4]))).toBe(false);
  });

  it('exact sur les bords : le volume s’évase de l’œil vers P', () => {
    // À mi-chemin (t = 0,5), la section va de x = -1,1 à 1,1.
    // Réunion des sections : la boîte (z de 1,75 à 1,85) recoupe celles de t ≤ 0,54, où x ≤ 1,19.
    expect(boxInHull(eye(0, 0.5, 2.4), P.small, box([1.15, 0, 1.75], [1.5, 1, 1.85]))).toBe(true);
    expect(boxInHull(eye(0, 0.5, 2.4), P.small, box([1.2, 0, 1.75], [1.5, 1, 1.85]))).toBe(false);
  });

  it('cas limites : œil dans la boîte, boîte plate, boîte vide, œil dans P', () => {
    expect(boxInHull(eye(0, 1, 5), P.small, box([-1, 0, 4], [1, 2, 6]))).toBe(true);
    expect(boxInHull(front, P.small, box([-1, 0, 5], [1, 2, 5]))).toBe(true);
    expect(boxInHull(front, P.small, box([1, 0, 5], [-1, 2, 5]))).toBe(false);
    expect(boxInHull(eye(0, 1, 0), P.small, box([-0.1, 0, 3], [0.1, 1, 4]))).toBe(false);
    // Œil dans le plan d'une face de P (coefficient nul sur un axe).
    expect(boxInHull(eye(2.2, 1, 10), P.small, box([2.3, 0, 4], [2.5, 1, 5]))).toBe(false);
    expect(boxInHull(eye(2.2, 1, 10), P.small, box([2.1, 0, 4], [2.5, 1, 5]))).toBe(true);
  });
});

describe('coupe : R1, R3 et hystérésis sur une pièce d’essai', () => {
  const elements: CutElement[] = [
    { name: 'canape_gauche', parts: [box([-4, 0, -1], [-3.2, 1, 1])] },
    { name: 'coussin', parts: [box([-3.8, 1, -0.5], [-3.4, 1.2, 0.5])] },
    { name: 'etagere', parts: [box([-4, 1.8, 1.5], [-3.6, 1.85, 2.5])] },
    { name: 'pot', parts: [box([-3.9, 1.85, 1.8], [-3.7, 2.1, 2])] },
    { name: 'spot_pendu', parts: [box([0, 2.7, -2.6], [0.1, 3, -2.5])] },
    { name: 'lampe', parts: [box([0, 2.5, -2.6], [0.1, 2.7, -2.5])] },
    { name: 'colonne', parts: [box([2.5, 0, -3], [3.5, 3, -2.6])] },
    { name: 'table', parts: [box([-0.5, 0, 2.2], [0.5, 0.5, 2.8])] },
    { name: 'cone', parts: [box([-0.5, 0.2, -2.9], [0.5, 2.5, -2.9])], on: ['lampe'], light: true },
    { name: 'cadre', parts: [box([1, 1.5, 1.5], [1.4, 1.9, 1.52])], on: ['table'] },
    { name: 'tableau', parts: [box([0.5, 1.2, -2.9], [1, 1.6, -2.8])] },
    { name: 'clou', parts: [box([0.7, 1.55, -2.8], [0.72, 1.57, -2.78])] },
  ];
  const structure = analyzeCut(ROOM, elements, TOL);

  it('supports déduits : posé dessus, pendu dessous, déclaré, contact pour ce qui ne tient pas seul', () => {
    expect(supportsOf(structure, 'coussin')).toEqual(['canape_gauche']);
    expect(supportsOf(structure, 'pot')).toEqual(['etagere']);
    expect(supportsOf(structure, 'lampe')).toEqual(['spot_pendu']);
    expect(supportsOf(structure, 'cone')).toEqual(['lampe']);
    expect(supportsOf(structure, 'cadre')).toEqual(['table']);
    expect(supportsOf(structure, 'clou')).toEqual(['tableau']);
    expect(supportsOf(structure, 'table')).toEqual([]);
    expect(structure.floating).toEqual([]);
  });

  it('rien ne flotte : un élément libre est signalé ; noms en double et supports inconnus refusés', () => {
    const loose = analyzeCut(ROOM, [{ name: 'ballon', parts: [box([0, 1, 0], [0.2, 1.2, 0.2])] }], TOL);
    expect(loose.floating).toEqual(['ballon']);
    const empty = analyzeCut(ROOM, [{ name: 'vide', parts: [box([1, 1, 1], [0, 0, 0])] }], TOL);
    expect(empty.floating).toEqual(['vide']);
    expect(() => analyzeCut(ROOM, [elements[0] as CutElement, elements[0] as CutElement], TOL)).toThrow(/double/);
    expect(() => analyzeCut(ROOM, [{ name: 'a', parts: [VEHICLE], on: ['b'] }], TOL)).toThrow(/inconnu/);
  });

  it('R1 : l’œil derrière le mur gauche efface ce qui y est adossé, et ce qu’il porte (R3)', () => {
    const inside = decide(structure, eye(0, 1.5, 0.5));
    expect(hiddenNames(structure, inside)).toEqual([]);
    const left = decide(structure, eye(-12, 1.5, 0));
    expect(hiddenNames(structure, left)).toEqual(expect.arrayContaining(['canape_gauche', 'coussin', 'etagere', 'pot']));
    expect(hiddenNames(structure, left)).not.toContain('colonne');
  });

  it('R1 plafond : ce qui y pend disparaît vu d’au-dessus, pas ce qui monte du sol', () => {
    const above = decide(structure, eye(0, 12, 0.5));
    const names = hiddenNames(structure, above);
    expect(names).toEqual(expect.arrayContaining(['spot_pendu', 'lampe', 'cone']));
    expect(names).not.toContain('colonne');
  });

  it('R2 et R3 : la table devant le véhicule disparaît, avec le cadre déclaré dessus', () => {
    const front = decide(structure, eye(0, 1.2, 2.95));
    expect(hiddenNames(structure, front)).toEqual(expect.arrayContaining(['table', 'cadre']));
    // Derrière le mur avant : la table, en travers du chemin, part aussi.
    expect(hiddenNames(structure, decide(structure, eye(0, 1.5, 12)))).toContain('table');
    // De côté (mur droit), la table n'est plus sur le chemin.
    expect(hiddenNames(structure, decide(structure, eye(12, 1.2, 0)))).not.toContain('table');
  });

  it('œil dans un élément : il disparaît', () => {
    expect(hiddenNames(structure, decide(structure, eye(0, 0.3, 2.5)))).toContain('table');
  });

  it('hystérésis R1 : bande de part et d’autre du plan du mur', () => {
    const state = createCutState(structure);
    const wall = -ROOM.width / 2;
    const left = (x: number) => hiddenNames(structure, decide(structure, eye(x, 1.5, 0), state)).includes('etagere');
    expect(left(wall + 0.05)).toBe(false);
    expect(left(wall - 0.05)).toBe(false);
    expect(left(wall - 0.11)).toBe(true);
    expect(left(wall + 0.05)).toBe(true);
    expect(left(wall + 0.11)).toBe(false);
  });

  it('hystérésis R2 : masqué par le petit volume, remontré une fois sorti du grand', () => {
    const solo = analyzeCut(ROOM, [{ name: 'pied', parts: [box([1.9, 0, 1.95], [1.98, 1, 2.05])] }], TOL);
    const state = createCutState(solo);
    const at = eye(0, 1, 6);
    // Le pied est juste hors du chemin vers le petit P, dans celui vers le grand.
    expect(decide(solo, at, state).hidden[0]).toBe(0);
    expect(decide(solo, eye(1, 1, 6), state).hidden[0]).toBe(1);
    expect(decide(solo, at, state).hidden[0]).toBe(1);
    expect(decide(solo, eye(-2, 1, 6), state).hidden[0]).toBe(0);
    // Sans état précédent, la même position reste visible : seul l'historique la masquait.
    expect(decide(solo, at).hidden[0]).toBe(0);
  });

  it('la décision est stable : même œil, même état (export en tuiles, sous-pixel)', () => {
    const state = createCutState(structure);
    const at = eye(-6, 2, 9);
    const first = Array.from(decide(structure, at, state).hidden);
    const version = state.version;
    for (let i = 0; i < 3; i += 1) decide(structure, at, state);
    expect(Array.from(state.hidden)).toEqual(first);
    expect(state.version).toBe(version);
  });
});

/**
 * Source telle que le préprocesseur la voit avec ou sans un define : les blocs `#ifdef name` /
 * `#ifndef name` (avec leur `#else`) sont gardés ou retirés, les autres directives laissées telles
 * quelles. Les sources brutes de three n'ont pas leurs `#include` développés : un `discard` qui y
 * reste vient forcément d'un patch.
 */
function preprocess(source: string, name: string, defined: boolean): string {
  const out: string[] = [];
  // Pile des blocs ouverts : null pour un bloc qui ne porte pas sur `name` (gardé tel quel).
  const stack: Array<{ keep: boolean } | null> = [];
  const keeping = () => stack.every((block) => block === null || block.keep);
  for (const line of source.split('\n')) {
    const directive = /^\s*#\s*(ifdef|ifndef|if|else|endif)\b\s*(\S*)/.exec(line);
    if (directive) {
      const [, kind, argument] = directive;
      if ((kind === 'ifdef' || kind === 'ifndef') && argument === name) {
        stack.push({ keep: kind === 'ifdef' ? defined : !defined });
        continue;
      }
      if (kind === 'ifdef' || kind === 'ifndef' || kind === 'if') stack.push(null);
      else if (kind === 'else') {
        const top = stack.at(-1);
        if (top) {
          top.keep = !top.keep;
          continue;
        }
      } else if (kind === 'endif') {
        if (stack.pop()) continue;
      }
    }
    if (keeping()) out.push(line);
  }
  expect(stack, `blocs ouverts dans la source`).toEqual([]);
  return out.join('\n');
}

describe('coupe : nuanceurs', () => {
  it('les repères existent dans three.js : standard (trame), basique opaque (trame), basique additif (atténuation)', () => {
    const cases = [
      { lib: ShaderLib.standard, standard: true, additive: false },
      { lib: ShaderLib.basic, standard: false, additive: false },
      { lib: ShaderLib.basic, standard: false, additive: true },
    ];
    for (const { lib, standard, additive } of cases) {
      const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
      expect(() => patchGarageShader(shader, { standard, surface: false, additive })).not.toThrow();
      expect(shader.vertexShader).toContain(`attribute float ${CUT_ATTRIBUTE}`);
      expect(shader.vertexShader).toContain(`pmbCutFade[ ${CUT_CAPACITY / 4} ]`);
      const dithered = preprocess(shader.fragmentShader, CUT_DITHER_DEFINE, true);
      expect(dithered.includes('discard'), `trame ${standard}/${additive}`).toBe(!additive);
      expect(shader.fragmentShader.includes('gl_FragColor.rgb *= vPmbFade'), `atténuation ${standard}/${additive}`).toBe(additive);
    }
  });

  it('sans le define PMB_CUT_DITHER, aucun programme de la coupe ne contient de discard', () => {
    const cases = [
      { name: 'décor standard', lib: ShaderLib.standard, variant: { standard: true, surface: false, additive: false } },
      { name: 'sol et plafond', lib: ShaderLib.standard, variant: { standard: true, surface: true, additive: false } },
      { name: 'basique opaque', lib: ShaderLib.basic, variant: { standard: false, surface: false, additive: false } },
      { name: 'basique additif', lib: ShaderLib.basic, variant: { standard: false, surface: false, additive: true } },
      { name: 'voile', lib: ShaderLib.basic, variant: { standard: false, surface: false, additive: false, alpha: true } },
    ];
    for (const { name, lib, variant } of cases) {
      const shader = { vertexShader: lib.vertexShader, fragmentShader: lib.fragmentShader };
      patchGarageShader(shader, variant);
      for (const source of [shader.vertexShader, shader.fragmentShader]) {
        expect(preprocess(source, CUT_DITHER_DEFINE, false).includes('discard'), name).toBe(false);
        // Le seul discard de la coupe est le rejet de la trame, dans son bloc.
        expect(source.match(/discard/g)?.length ?? 0, name).toBe(source === shader.fragmentShader && !variant.additive && variant.alpha !== true ? 1 : 0);
      }
    }
    const surface = { vertexShader: ShaderLib.standard.vertexShader, fragmentShader: ShaderLib.standard.fragmentShader };
    patchSurfaceShader(surface);
    const trame = preprocess(surface.fragmentShader, CUT_DITHER_DEFINE, true);
    expect(trame).toContain('if ( vPmbFade < 1.0 && vPmbFade <= pmbBayer( gl_FragCoord.xy ) ) discard;');
    expect(trame).toContain('float pmbBayer( vec2 fragCoord )');
    expect(preprocess(surface.fragmentShader, CUT_DITHER_DEFINE, false)).not.toContain('pmbBayer');
  });

  it('voile transparent (ombres de contact) : fondu par l’opacité, sans trame', () => {
    const shader = { vertexShader: ShaderLib.basic.vertexShader, fragmentShader: ShaderLib.basic.fragmentShader };
    patchGarageShader(shader, { standard: false, surface: false, additive: false, alpha: true });
    expect(shader.fragmentShader).toContain('gl_FragColor.a *= vPmbFade');
    expect(shader.fragmentShader.includes('discard')).toBe(false);
  });
});

describe('coupe : quel matériau porte la trame', () => {
  it('en fondu : strictement entre 0 (masqué) et 1 (visible)', () => {
    expect([0, 1e-6, 0.5, 0.999, 1].map(inFade)).toEqual([false, true, true, true, false]);
  });

  it('porteurs : identifiants triés, sans doublon ni 0', () => {
    const owners = ditherOwners([[3, 0, 1, 3], [], new Set([0]), [2]]);
    expect(owners.count).toBe(4);
    expect(Array.from(owners.ids)).toEqual([1, 3, 2]);
    expect(Array.from(owners.start)).toEqual([0, 2, 2, 2, 3]);
  });

  it('un porteur prend la trame si l’un de ses éléments est en fondu, la quitte dès qu’il est posé', () => {
    // Porteur 0 : éléments 1 et 2 ; porteur 1 : élément 2 ; porteur 2 : élément 3 ; porteur 3 : rien.
    const owners = ditherOwners([[1, 2], [2], [3], [0]]);
    const fades = new Float32Array(8).fill(1);
    const out = new Uint8Array(4).fill(7);
    // Au repos, tout visible : aucune trame.
    expect(ditherNeeds(fades, owners, out)).toBe(0);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
    // Masqué d'un coup (mouvement réduit, photo) : toujours aucune trame.
    fades[1] = 0;
    fades[3] = 0;
    expect(ditherNeeds(fades, owners, out)).toBe(0);
    // L'élément 2 en fondu : ses deux porteurs, et eux seuls.
    fades[2] = 0.6;
    expect(ditherNeeds(fades, owners, out)).toBe(2);
    expect(Array.from(out)).toEqual([1, 1, 0, 0]);
    fades[3] = 0.01;
    expect(ditherNeeds(fades, owners, out)).toBe(3);
    expect(Array.from(out)).toEqual([1, 1, 1, 0]);
    // Fondus terminés : plus rien.
    fades[2] = 0;
    fades[3] = 1;
    expect(ditherNeeds(fades, owners, out)).toBe(0);
    expect(Array.from(out)).toEqual([0, 0, 0, 0]);
  });

  it('suit stepFades : trame pendant le fondu, aucune avec un pas de 1', () => {
    const owners = ditherOwners([[1], [2]]);
    const fades = new Float32Array(4).fill(1);
    const hidden = Uint8Array.from([1, 0]);
    const out = new Uint8Array(2);
    const seen: number[] = [];
    while (stepFades(fades, hidden, 0.3)) seen.push(ditherNeeds(fades, owners, out));
    seen.push(ditherNeeds(fades, owners, out));
    expect(seen).toEqual([1, 1, 1, 0]);
    hidden[0] = 0;
    hidden[1] = 1;
    stepFades(fades, hidden, 1);
    expect(ditherNeeds(fades, owners, out)).toBe(0);
  });
});

describe('coupe : fondu et volume protégé', () => {
  it('le fondu avance d’un pas, se pose d’un coup avec un pas de 1, puis s’arrête', () => {
    const fades = new Float32Array(8).fill(1);
    const hidden = Uint8Array.from([1, 0, 1]);
    expect(stepFades(fades, hidden, 0.25)).toBe(true);
    expect(fades[1]).toBeCloseTo(0.75, 6);
    expect(fades[2]).toBe(1);
    expect(stepFades(fades, hidden, 1)).toBe(false);
    expect([fades[0], fades[1], fades[2], fades[3]]).toEqual([1, 0, 1, 0]);
    expect(stepFades(fades, hidden, 0.25)).toBe(false);
    hidden[0] = 0;
    expect(stepFades(fades, hidden, 0.5)).toBe(true);
    expect(stepFades(fades, hidden, 0.5)).toBe(false);
    expect(fades[1]).toBe(1);
  });

  it('P : boîte mesurée tournée dans la pièce, gonflée, prolongée sous le sol ; boîte d’attente sinon', () => {
    const settings = { waiting: VEHICLE, side: 0.3, top: 0.2, reflection: 0.5, hysteresis: 0.25 };
    const turned = protectedBoxes({ halfLength: 2, halfWidth: 1, height: 1.4 }, Math.PI / 2, settings);
    expect(turned.vehicle.max[0]).toBeCloseTo(1, 9);
    expect(turned.vehicle.max[2]).toBeCloseTo(2, 9);
    // La moitié du reflet : 0,5 × 1,4 m sous le sol.
    expect(turned.small.min[1]).toBeCloseTo(-0.7, 9);
    expect(turned.small.max[1]).toBeCloseTo(1.6, 9);
    expect(turned.big.max[0]).toBeCloseTo(1.55, 9);
    const waiting = protectedBoxes(null, Math.PI, settings);
    expect(waiting.vehicle).toBe(VEHICLE);
    expect(waiting.small.max[0]).toBeCloseTo(2.3, 9);
  });
});

// ---------------------------------------------------------------------------------------------
// Garage réel.

/** Les textures du garage se dessinent au canvas : sans DOM, elles restent vides. Rend de quoi revenir. */
function stubDocument(): () => void {
  const scope = globalThis as unknown as { document?: unknown };
  if (scope.document !== undefined) return () => {};
  scope.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
  return () => {
    delete scope.document;
  };
}

let garage: GarageScene;
let structure: CutStructure;
const turn = GARAGE.vehicle.turn;
const protect = protectedBoxes(null, turn, GARAGE.vehicle.protect);

let unstub = () => {};
beforeAll(async () => {
  unstub = stubDocument();
  const { createGarage } = await import('../../src/scene/garage/build.ts');
  // Œuvres : une texture vide, sans réseau (le chargement réel est vérifié dans le navigateur).
  garage = createGarage(GARAGE, { artwork: () => ({ texture: new Texture(), release: () => {} }) });
  structure = garage.cut.structure;
});
afterAll(() => {
  garage.dispose();
  unstub();
});

/** Exceptions nommées au garde-fou : maillages qui peuvent passer devant le véhicule, laissés exprès. */
const EXCEPTIONS: Record<string, string> = {
  garage_atmosphere_nappe: 'nappes de brume au ras du sol, additives : choix d’image, elles restent (consigne de la coupe)',
};

function corners(b: Box): Vector3[] {
  const result: Vector3[] = [];
  for (const x of [b.min[0], b.max[0]]) for (const y of [b.min[1], b.max[1]]) for (const z of [b.min[2], b.max[2]]) result.push(new Vector3(x, y, z));
  return result;
}

/**
 * Preuve qu'un triangle sans élément ne peut pas cacher le véhicule : face unique dont le
 * demi-espace avant contient tout P (la caméra ne peut pas à la fois la voir de face et l'avoir
 * devant P), ou posé sur le sol (il porte le reflet, il ne passe jamais devant).
 */
function provenHarmless(a: Vector3, b: Vector3, c: Vector3, material: Material, region: Vector3[]): boolean {
  if (material.side !== FrontSide) return false;
  const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a));
  if (normal.lengthSq() === 0) return true;
  normal.normalize();
  const onFloor = Math.max(Math.abs(a.y), Math.abs(b.y), Math.abs(c.y)) <= 0.01 && normal.y > 0.99;
  if (onFloor) return true;
  return region.every((corner) => normal.dot(new Vector3().subVectors(corner, a)) > 1e-6);
}

function meshesOf(scene: GarageScene): Mesh[] {
  const meshes: Mesh[] = [];
  scene.root.updateMatrixWorld(true);
  scene.root.traverse((object) => {
    if (object instanceof Mesh) meshes.push(object);
  });
  return meshes;
}

describe('coupe : garage réel', () => {
  it('éléments : sous la capacité du tableau d’uniformes, chacun présent dans un maillage', () => {
    expect(structure.count).toBeGreaterThan(40);
    expect(structure.count).toBeLessThan(CUT_CAPACITY);
    const seen = new Set<number>();
    for (const ambiance of AMBIANCES) {
      garage.update(ambiance);
      for (const mesh of meshesOf(garage)) {
        const ids = (mesh.geometry as BufferGeometry).getAttribute(CUT_ATTRIBUTE);
        if (!ids) continue;
        for (let i = 0; i < ids.count; i += 1) seen.add(ids.getX(i));
      }
    }
    for (let id = 1; id <= structure.count; id += 1) expect(seen.has(id), structure.names[id - 1]).toBe(true);
    expect(Math.max(...seen)).toBe(structure.count);
  });

  it('garde-fou de structure : tout maillage porte son élément, ou prouve qu’il ne cache rien', () => {
    const region = corners(protect.big);
    const failures: string[] = [];
    for (const ambiance of AMBIANCES) {
      garage.update(ambiance);
      for (const mesh of meshesOf(garage)) {
        const geometry = mesh.geometry as BufferGeometry;
        const material = mesh.material as Material;
        const ids = geometry.getAttribute(CUT_ATTRIBUTE);
        const patched = material.userData.pmbCut === true;
        if (patched !== (ids !== undefined)) {
          failures.push(`${ambiance.id}/${mesh.name} : attribut de coupe ${ids ? 'sans matériau patché' : 'absent'}`);
          continue;
        }
        if (EXCEPTIONS[mesh.name]) continue;
        const position = geometry.getAttribute('position');
        const index = geometry.getIndex();
        const triangles = (index ? index.count : position.count) / 3;
        const vertex = (i: number) => (index ? index.getX(i) : i);
        const at = (i: number) => new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld);
        let bad = 0;
        for (let t = 0; t < triangles; t += 1) {
          const [i0, i1, i2] = [vertex(3 * t), vertex(3 * t + 1), vertex(3 * t + 2)];
          const tags = ids ? [ids.getX(i0), ids.getX(i1), ids.getX(i2)] : [0, 0, 0];
          if (tags[0] !== tags[1] || tags[1] !== tags[2]) {
            bad += 1;
            continue;
          }
          if ((tags[0] ?? 0) > 0) continue;
          if (!provenHarmless(at(i0), at(i1), at(i2), material, region)) bad += 1;
        }
        if (bad > 0) failures.push(`${ambiance.id}/${mesh.name} : ${bad} triangle(s) sans élément qui peuvent passer devant le véhicule`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('trame : portée par les seuls matériaux opaques dont un élément est en fondu ; jamais dans la sonde', () => {
    const { dither, fades } = garage.cut;
    const ambiance = AMBIANCES[0];
    if (!ambiance) throw new Error('aucune ambiance');
    garage.update(ambiance);
    const patched = new Set<Material>();
    for (const mesh of meshesOf(garage)) if ((mesh.material as Material).userData.pmbCut === true) patched.add(mesh.material as Material);
    // Porteurs : tous les opaques patchés (sol, murs, mobilier, sources, œuvres), ni additifs ni voiles.
    expect(new Set(dither.carriers)).toEqual(new Set([...patched].filter(isDitherCarrier)));
    expect(dither.carriers.length).toBeGreaterThan(5);
    for (const material of patched) {
      if (!isDitherCarrier(material)) expect(material.transparent, material.name).toBe(true);
    }
    // Chaque élément dessiné par un matériau opaque est connu de ses porteurs.
    const owned = new Set(Array.from(dither.owners.ids));
    const furnitureIds = structure.names.flatMap((name, i) => (name.startsWith('placeholder_') ? [i + 1] : []));
    for (const id of furnitureIds) expect(owned.has(id), structure.names[id - 1]).toBe(true);

    const reset = () => {
      fades.fill(1);
      dither.apply(true);
    };
    reset();
    expect(dither.active).toBe(0);
    expect(dither.carriers.filter(hasCutDither)).toEqual([]);
    // Un objet du mobilier en fondu : ses matériaux, et eux seuls.
    const id = furnitureIds[0] ?? 1;
    fades[id] = 0.4;
    const active = dither.apply(true);
    const expected = dither.carriers.filter((_, m) => {
      for (let k = dither.owners.start[m] ?? 0; k < (dither.owners.start[m + 1] ?? 0); k += 1) if (dither.owners.ids[k] === id) return true;
      return false;
    });
    expect(active).toBe(expected.length);
    expect(active).toBeGreaterThan(0);
    expect(dither.carriers.filter(hasCutDither)).toEqual(expected);
    // Pendant la capture de la sonde : tout visible, aucune trame ; elle revient ensuite.
    const restore = (garage.root.userData.onProbe as () => () => void)();
    expect(dither.carriers.filter(hasCutDither)).toEqual([]);
    expect(fades[id]).toBe(1);
    restore();
    expect(dither.carriers.filter(hasCutDither)).toEqual(expected);
    expect(fades[id]).toBeCloseTo(0.4, 6);
    // Fondu interdit (variantes pas prêtes, mouvement réduit, photo) : aucune trame.
    expect(dither.apply(false)).toBe(0);
    expect(dither.carriers.filter(hasCutDither)).toEqual([]);
    // Fondu posé : plus rien.
    fades[id] = 0;
    expect(dither.apply(true)).toBe(0);
    expect(dither.carriers.filter(hasCutDither)).toEqual([]);
    reset();
  });

  it('ordre de dessin : le sol après tous les autres opaques du décor, murs et plafond à leur place', async () => {
    const { FLOOR_RENDER_ORDER } = await import('../../src/scene/garage/build.ts');
    expect(garage.floor.renderOrder).toBe(FLOOR_RENDER_ORDER);
    for (const mesh of meshesOf(garage)) {
      if (mesh === garage.floor || (mesh.material as Material).transparent) continue;
      expect(mesh.renderOrder, mesh.name).toBeLessThan(FLOOR_RENDER_ORDER);
      if (/^(plafond|mur_)/.test(mesh.name)) expect(mesh.renderOrder, mesh.name).toBe(0);
    }
  });

  it('rien ne flotte : tout élément tient au sol, à un mur, au plafond ou à un autre élément', () => {
    expect(structure.floating).toEqual([]);
  });

  it('supports attendus : peluche, bloc moteur, moto en pièces, évier, spots, cônes, casques', () => {
    expect(supportsOf(structure, 'placeholder_peluche')).toContain('placeholder_flipper');
    expect(supportsOf(structure, 'placeholder_bloc_moteur')).toContain('placeholder_table_basse');
    expect(supportsOf(structure, 'placeholder_moto_en_pieces')).toContain('placeholder_meubles_atelier');
    expect(supportsOf(structure, 'placeholder_evier')).toContain('placeholder_meubles_atelier');
    GARAGE.spots.forEach((spot, index) => {
      const name = `spot_${index + 1}`;
      if (spot.wallHalo) expect(supportsOf(structure, name), name).toContain('retombee_1');
      if (spot.beam) expect(supportsOf(structure, `cone_${index + 1}`)).toEqual([name]);
      if (spot.color === 'left') expect(supportsOf(structure, name), name).toContain('placeholder_casiers_casques');
    });
  });

  it('bandeau porté : il suit sa retombée, qui reste sur son mur vue d’au-dessus et part quand l’œil passe derrière', () => {
    const carried = GARAGE.strips.flatMap((strip, index) => (strip.on ? [{ name: `bandeau_${index + 1}`, on: strip.on }] : []));
    expect(carried.length).toBeGreaterThan(0);
    for (const { name, on } of carried) expect(supportsOf(structure, name)).toEqual([...on]);
    // Tour complet au recul maximal en portrait, hauteur de départ : l'œil est au-dessus du plafond.
    const fit = fitCamera(390, 844, halfLength * frameMargin);
    let kept = 0;
    let gone = 0;
    for (let a = 0; a < 72; a += 1) {
      const [x, y, z] = orbitPosition(target, fit.maxDistance, (a / 72) * Math.PI * 2);
      expect(y).toBeGreaterThan(GARAGE.room.height);
      const hidden = new Set(hiddenNames(structure, decideCut(structure, eye(x, y, z), protect, GARAGE.cut.wallBand, createCutState(structure))));
      for (const { name, on } of carried) {
        const supportHidden = on.some((support) => hidden.has(support));
        expect(hidden.has(name), `${name}, azimut ${a}`).toBe(supportHidden);
        if (supportHidden) gone += 1;
        else kept += 1;
      }
    }
    // La retombée garde son bandeau tant que l'œil n'a pas passé son mur, et part avec lui ensuite.
    expect(kept).toBeGreaterThan(0);
    expect(gone).toBeGreaterThan(0);
  });

  it('aucun élément ne coupe P : il serait masqué en permanence', () => {
    const touching = structure.names.filter((_, i) => {
      for (let p = structure.partStart[i] ?? 0; p < (structure.partStart[i + 1] ?? 0); p += 1) {
        const o = structure.parts.subarray(p * 6, p * 6 + 6);
        const inside = [0, 1, 2].every((k) => (o[k] ?? 0) <= (protect.big.max[k] ?? 0) && (o[3 + k] ?? 0) >= (protect.big.min[k] ?? 0));
        if (inside) return true;
      }
      return false;
    });
    expect(touching).toEqual([]);
  });
});

// Balayage : yeux de l'orbite (72 azimuts × 5 hauteurs × 3 distances, portrait et paysage) et
// cadrages photo. Vérification indépendante de R2 : des rayons tirés de l'œil vers une grille de
// points de la boîte du véhicule (sans marge) ne rencontrent aucune pièce laissée visible.

/** Le segment [a, b] traverse-t-il la boîte (méthode des plaques) ? */
function segmentHits(a: Point, b: Point, o: ArrayLike<number>, offset: number): boolean {
  let lo = 0;
  let hi = 1;
  const from = [a.x, a.y, a.z];
  const to = [b.x, b.y, b.z];
  for (let k = 0; k < 3; k += 1) {
    const start = from[k] ?? 0;
    const d = (to[k] ?? 0) - start;
    const min = o[offset + k] ?? 0;
    const max = o[offset + 3 + k] ?? 0;
    if (Math.abs(d) < 1e-12) {
      if (start < min || start > max) return false;
      continue;
    }
    let t0 = (min - start) / d;
    let t1 = (max - start) / d;
    if (t0 > t1) [t0, t1] = [t1, t0];
    lo = Math.max(lo, t0);
    hi = Math.min(hi, t1);
    if (lo > hi) return false;
  }
  return true;
}

function vehiclePoints(b: Box): Point[] {
  const steps = [7, 4, 5];
  const points: Point[] = [];
  for (let i = 0; i < (steps[0] ?? 1); i += 1) {
    for (let j = 0; j < (steps[1] ?? 1); j += 1) {
      for (let k = 0; k < (steps[2] ?? 1); k += 1) {
        const f = (n: number, of: number) => n / (of - 1);
        points.push({
          x: b.min[0] + (b.max[0] - b.min[0]) * f(i, steps[0] ?? 2),
          y: b.min[1] + (b.max[1] - b.min[1]) * f(j, steps[1] ?? 2),
          z: b.min[2] + (b.max[2] - b.min[2]) * f(k, steps[2] ?? 2),
        });
      }
    }
  }
  return points;
}

/** Éléments visibles dont une pièce coupe un rayon vers le véhicule. */
function blockers(at: Point, state: CutState, points: Point[]): string[] {
  const found: string[] = [];
  for (let i = 0; i < structure.count; i += 1) {
    if (state.hidden[i] === 1) continue;
    let blocked = false;
    for (let p = structure.partStart[i] ?? 0; p < (structure.partStart[i + 1] ?? 0) && !blocked; p += 1) {
      blocked = points.some((point) => segmentHits(at, point, structure.parts, p * 6));
    }
    if (blocked) found.push(structure.names[i] ?? '');
  }
  return found;
}

const SCREENS = [
  { name: 'portrait', width: 390, height: 844 },
  { name: 'paysage', width: 844, height: 390 },
] as const;
const halfLength = GARAGE.vehicle.protect.waiting.max[0];
const { target, minPolar, maxPolar, frameMargin } = GARAGE.orbit;

describe('coupe : balayage autour du véhicule', () => {
  // Preuve par lancer de rayons sur tout le balayage : lente par nature, d'où le délai large.
  it('aucun élément laissé visible ne coupe la vue vers le véhicule (orbite et cadrages photo)', { timeout: 120_000 }, () => {
    const points = vehiclePoints(protect.vehicle);
    const failures: string[] = [];
    let eyes = 0;
    const check = (label: string, at: Point, state: CutState) => {
      const found = blockers(at, state, points);
      if (found.length > 0 && failures.length < 12) failures.push(`${label} : ${found.join(', ')}`);
    };
    for (const screen of SCREENS) {
      const fit = fitCamera(screen.width, screen.height, halfLength * frameMargin);
      for (const distance of [fit.minDistance, fit.distance, fit.maxDistance]) {
        for (let h = 0; h < 5; h += 1) {
          const polar = minPolar + ((maxPolar - minPolar) * h) / 4;
          // Avec l'historique d'un tour continu (hystérésis), et sans (état posé d'un coup).
          const walking = createCutState(structure);
          for (let a = 0; a < 72; a += 1) {
            const azimuth = (a / 72) * Math.PI * 2;
            const [x, y, z] = orbitPosition(target, distance, azimuth, polar);
            const at = eye(x, y, z);
            const label = `${screen.name} d=${distance.toFixed(1)} polaire=${polar.toFixed(2)} azimut=${azimuth.toFixed(2)}`;
            check(`${label} (tour)`, at, decideCut(structure, at, protect, GARAGE.cut.wallBand, walking));
            check(label, at, decideCut(structure, at, protect, GARAGE.cut.wallBand, createCutState(structure)));
            eyes += 1;
          }
        }
      }
      for (const framing of FRAMINGS) {
        const pose = framingPose(framing, { fov: fit.fov, distance: fit.distance, target, halfLength, frontX: frontFromTurn(turn) });
        const at = eye(...pose.position);
        check(`${screen.name} photo ${framing.id}`, at, decideCut(structure, at, protect, GARAGE.cut.wallBand, createCutState(structure)));
        eyes += 1;
      }
    }
    expect(eyes).toBe(2 * (72 * 5 * 3 + FRAMINGS.length));
    expect(failures).toEqual([]);
    // Balayage de 2 170 yeux par lancer de rayons : délai large (120 s, en tête du test), il
    // s'allonge avec le mobilier remodelé.
  });

  it('pas d’excès de zèle : vue de départ, le mur du fond et le mur rouge restent meublés', () => {
    const fit = fitCamera(390, 844, halfLength * frameMargin);
    const [x, y, z] = orbitPosition(target, fit.distance);
    const state = decideCut(structure, eye(x, y, z), protect, GARAGE.cut.wallBand, createCutState(structure));
    const hidden = new Set(hiddenNames(structure, state));
    const kept = [
      'placeholder_meubles_atelier',
      'placeholder_evier',
      'placeholder_moto_en_pieces',
      'placeholder_servante',
      'placeholder_enceintes',
      'placeholder_applique',
      'placeholder_colonne_ecran',
      'placeholder_moto_sportive',
      'placeholder_flipper',
      'placeholder_peluche',
      'placeholder_panneau_cible',
      'placeholder_caisses',
      'retombee_1',
      'retombee_2',
      ...GARAGE.spots.flatMap((spot, index) => (spot.wallHalo ? [`spot_${index + 1}`, `cone_${index + 1}`] : [])),
    ];
    expect(kept.filter((name) => hidden.has(name))).toEqual([]);
    // Et le coin salon du premier plan, devant la voiture, est bien retiré.
    for (const name of ['placeholder_canape_a', 'placeholder_table_basse', 'placeholder_bloc_moteur']) expect(hidden.has(name), name).toBe(true);
  });
});
