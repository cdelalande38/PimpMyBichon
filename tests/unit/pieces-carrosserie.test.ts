// Kit carrosserie (Custom · Carrosserie) : postes `lame`, `jupes` et `diffuseur` posés sur rail
// (src/data/pieces.ts) : catalogue et groupe, validation de la section `rail` d'un manifeste, sens du
// rail, pose d'un sommet (abscisse, écart dehors, tassement contre la face et au-dessus du bas de caisse),
// miroir d'une paire ; puis, sur les trois voitures, chaque option posée comme dans l'app : jamais sous
// le bas de caisse d'origine (la garde au sol tient à l'assiette la plus basse), et le rail sur la face
// de la caisse (rayons horizontaux sur le modèle posé comme dans l'app).

import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { Box3, DoubleSide, Mesh, Raycaster, Vector3, type Group } from 'three';
import { ARTICLES_CARROSSERIE, PRIX_CARROSSERIE } from '../../src/data/articles/carrosserie.ts';
import { articleParId } from '../../src/data/boutique.ts';
import {
  checkPieces,
  fitPositions,
  flipWinding,
  groupeById,
  isFree,
  mirrorZ,
  optionsFor,
  originOf,
  posteById,
  postesDuGroupe,
  postesOf,
  RAIL_CLEARANCE,
  railAbscissa,
  railAt,
  railPath,
  railPoints,
  railZone,
  resolvePiece,
  type PiecePoste,
} from '../../src/data/pieces.ts';
import { validateManifest, vehicleById } from '../../src/data/vehicles.ts';
import type { PieceRailMount, VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { buildPiece } from '../../tools/vehicles/pieces.mjs';
import { builtModel, storedModel } from './places-modeles.ts';

const KIT = ['lame', 'jupes', 'diffuseur'] as const;
const CARS = ['cox', 'van', 'concept'] as const;

function poste(id: string): PiecePoste {
  const found = posteById(id);
  if (!found) throw new Error(`poste ${id} absent du catalogue`);
  return found;
}

function car(id: string): VehicleManifest {
  const found = vehicleById(id);
  if (!found) throw new Error(`${id} absent du catalogue`);
  return found;
}

function railOf(vehicle: VehicleManifest, id: string): PieceRailMount {
  const mount = vehicle.pieces?.[id];
  if (!mount || !('rail' in mount)) throw new Error(`${vehicle.id} : ${id} n'est pas sur rail`);
  return mount;
}

const problems = (pieces: unknown): string[] => {
  const out: string[] = [];
  checkPieces({ pieces }, out);
  return out;
};

const STRAIGHT: PieceRailMount = {
  rail: [
    [2, 0.3, 0],
    [2, 0.3, 0.2],
    [2, 0.3, 0.4],
    [2, 0.3, 0.6],
  ],
  rise: 0.1,
};

describe('kit carrosserie : catalogue et boutique', () => {
  it('le groupe « carrosserie » réunit lame avant, jupes et diffuseur, chacun avec son origine et deux ou trois options sur rail', () => {
    expect(groupeById('carrosserie')?.label).toBe('Kit carrosserie');
    // Le capot moteur (vague U, « capot ») rejoint le groupe : ses options ne sont pas sur rail (tests/unit/capot.test.ts).
    expect(postesDuGroupe('carrosserie').map((item) => item.id)).toEqual([...KIT, 'capot']);
    const counts = KIT.map((id) => poste(id).options.length);
    expect(counts).toEqual([3, 3, 2]);
    for (const id of KIT) {
      const item = poste(id);
      expect(item.options.every((option) => option.mount === 'rail' && option.rise !== undefined && option.depth !== undefined), id).toBe(true);
      expect(new Set(item.options.map((option) => option.style)).size, id).toBe(item.options.length);
    }
    expect(poste('jupes').mirror).toBe(true);
    expect(poste('lame').mirror).toBeUndefined();
    expect(postesDuGroupe('carrosserie').some((item) => item.id === 'aileron')).toBe(false);
  });

  it('chaque option est un article piece-<poste>-<option>, de 60 à 400 $ ; l’absence de pièce est libre', () => {
    for (const id of KIT) {
      const prix = PRIX_CARROSSERIE[id] ?? {};
      expect(Object.keys(prix).sort(), id).toEqual(poste(id).options.map((option) => option.id).sort());
      for (const option of poste(id).options) {
        const article = articleParId(`piece-${id}-${option.id}`);
        expect(article, `${id} ${option.id}`).toBeDefined();
        expect(article?.famille).toBe('piece');
        expect(article?.prix).toBeGreaterThanOrEqual(60);
        expect(article?.prix).toBeLessThanOrEqual(400);
      }
    }
    expect(ARTICLES_CARROSSERIE).toHaveLength(10);
    const cox = car('cox');
    expect(isFree(cox, 'jupes', 'aucunes')).toBe(true);
    expect(isFree(cox, 'jupes', 'larges')).toBe(false);
    expect(originOf(cox, 'lame')).toBe('aucune');
  });

  it('les voitures déclarent les trois postes ; les motos aucun', () => {
    for (const id of CARS) {
      const vehicle = car(id);
      expect(postesOf(vehicle).map((item) => item.id), id).toEqual(['aileron', ...KIT, ...(id === 'cox' ? ['capot'] : [])]);
      for (const item of KIT) expect(optionsFor(vehicle, item).length, `${id} ${item}`).toBe(poste(item).options.length);
    }
    for (const id of ['bobber', 'sportive']) expect(postesOf(car(id)).filter((item) => item.groupe === 'carrosserie'), id).toEqual([]);
  });

  it('une option inconnue retombe sur l’origine ; la couleur propre se lit par poste', () => {
    const cox = car('cox');
    const build = { paints: {}, parts: { jupes: 'larges', lame: 'pas-une-lame' }, partPaints: { jupes: { color: '#ff6a00' } } };
    expect(resolvePiece(cox, build, 'jupes')?.option?.id).toBe('larges');
    expect(resolvePiece(cox, build, 'jupes')?.own).toEqual({ color: '#ff6a00' });
    expect(resolvePiece(cox, build, 'lame')?.id).toBe('aucune');
    expect(resolvePiece(car('bobber'), build, 'jupes')).toBeNull();
  });
});

describe('kit carrosserie : validation de la section rail', () => {
  it('les manifestes des trois voitures sont valides', () => {
    for (const id of CARS) {
      const raw = JSON.parse(readFileSync(new URL(`../../public/assets/vehicles/${id}/vehicle.json`, import.meta.url), 'utf8')) as Record<string, unknown>;
      expect(() => validateManifest(raw, id), id).not.toThrow();
    }
  });

  it('refuse un rail faux, avec un message clair', () => {
    expect(problems({ lame: STRAIGHT })).toEqual([]);
    expect(problems({ lame: { rail: [[2, 0.3, 0], [2, 0.3, 0.2]], rise: 0.1 } })).toEqual([expect.stringMatching(/au moins trois points/)]);
    expect(problems({ lame: { ...STRAIGHT, rail: [[2, 0.3, 0.1], [2, 0.3, 0.3], [2, 0.3, 0.5]] } })).toEqual([expect.stringMatching(/z = 0/)]);
    expect(problems({ lame: { ...STRAIGHT, rail: [[2, 0.3, 0], [2, 0.3, 0.5], [2, 0.3, 0.6]] } })).toEqual([expect.stringMatching(/30 cm au plus/)]);
    expect(problems({ lame: { ...STRAIGHT, rail: [[2, 0.3, 0], [2, 0.3, 0.05], [2, 0.3, 0.1]] } })).toEqual([expect.stringMatching(/trop court/)]);
    expect(problems({ lame: { ...STRAIGHT, rise: 0.6 } })).toEqual([expect.stringMatching(/rise/)]);
    expect(problems({ lame: { ...STRAIGHT, anchor: [2, 0.3, 0] } })).toEqual([expect.stringMatching(/n'a que rail et rise/)]);
    expect(problems({ jupes: { rail: [[1, 0.3, 0.9], [0, 0.3, 0.9], [-1, 0.3, -0.9]], rise: 0.1 } })).toEqual(expect.arrayContaining([expect.stringMatching(/flanc droit/)]));
    expect(problems({ aileron: { anchor: [-2, 1, 0], normal: [0, 1, 0], width: 1, rail: STRAIGHT.rail } })).toEqual([expect.stringMatching(/se pose sur une surface/)]);
    expect(problems({ diffuseur: { ...STRAIGHT, options: ['tunnel'] } })).toEqual([expect.stringMatching(/options doit citer/)]);
  });
});

describe('kit carrosserie : pose sur rail', () => {
  it('le rail se range pour que la normale sortante regarde dehors : avant, flanc droit, arrière', () => {
    const facing = (mount: Pick<PieceRailMount, 'rail'>, mirror: boolean) => {
      const at = { x: 0, y: 0, z: 0, nx: 0, nz: 0 };
      const path = railPath(railPoints(mount, mirror));
      railAt(path, path.length / 2, at);
      return [Math.round(at.nx) + 0, Math.round(at.nz) + 0];
    };
    expect(facing(STRAIGHT, false)).toEqual([1, 0]);
    expect(facing({ rail: STRAIGHT.rail.map(([x, y, z]) => [-x, y, z] as const) }, false)).toEqual([-1, 0]);
    const side = { rail: [[1, 0.3, 0.9], [0.5, 0.3, 0.9], [0, 0.3, 0.9], [-0.5, 0.3, 0.9]] as const };
    expect(facing(side, true)).toEqual([0, 1]);
    // Donné de l'arrière vers l'avant, le rail est remis dans le bon sens : le bout −Z de la jupe reste devant.
    const reversed = railPoints({ rail: [...side.rail].reverse() }, true);
    expect(reversed[0]?.[0]).toBe(1);
    expect(railZone(STRAIGHT, false).face).toBe('+x');
    expect(railZone(side, true).face).toBe('+z');
    expect(railZone({ rail: STRAIGHT.rail.map(([x, y, z]) => [-x, y, z] as const) }, false).face).toBe('-x');
  });

  it('les bouts gardent leur longueur, le milieu s’étire à la longueur du rail', () => {
    const reference = { width: 1.2, ends: 0.1 };
    expect(railAbscissa(-0.6, reference, 2)).toBeCloseTo(0);
    expect(railAbscissa(-0.55, reference, 2)).toBeCloseTo(0.05);
    expect(railAbscissa(0, reference, 2)).toBeCloseTo(1);
    expect(railAbscissa(0.58, reference, 2)).toBeCloseTo(1.98);
    expect(railAbscissa(0.65, reference, 2)).toBeCloseTo(2.05);
  });

  it('un sommet va sur le rail, écarté dehors, tassé contre une face moins haute et au-dessus du bas de caisse', () => {
    const lame = poste('lame');
    // Rail droit de 1,2 m (z de −0,6 à 0,6), à la hauteur 0,3 ; option : 5 cm au-dessus, 10 cm dessous.
    const option = { rise: 0.05, depth: 0.1 };
    const out = fitPositions([0.04, 0.05, 0, 0.1, -0.1, 0.6, 0, -0.1, -0.6], 'rail', STRAIGHT, lame, option, 0.25);
    const r = [...out].map((v) => Number(v.toFixed(4)) + 0);
    // Dehors de 4 cm (vers +X), en haut de face : 5 cm (la face en a 10).
    expect(r.slice(0, 3)).toEqual([2.04, 0.35, 0]);
    // Dessous : 10 cm demandés, 4,4 cm de place (0,3 − 0,25 − 6 mm).
    expect(r.slice(3, 6)).toEqual([2.1, Number((0.3 - (0.3 - 0.25 - RAIL_CLEARANCE)).toFixed(4)), 0.6]);
    expect(r[7]).toBeCloseTo(0.25 + RAIL_CLEARANCE);
    expect(r[8]).toBeCloseTo(-0.6);
    // Face basse : la partie haute se tasse.
    const low = fitPositions([0, 0.05, 0], 'rail', { ...STRAIGHT, rise: 0.01 }, lame, option);
    expect(low[1]).toBeCloseTo(0.31);
  });

  it('le miroir d’une paire : z opposé, triangles retournés', () => {
    expect([...mirrorZ([1, 2, 3, 4, 5, -6])]).toEqual([1, 2, -3, 4, 5, 6]);
    expect(flipWinding([0, 1, 2, 3, 4, 5])).toEqual([0, 2, 1, 3, 5, 4]);
  });
});

/**
 * Pose du modèle comme l'app (src/scene/vehicle/VehicleModel.tsx, prepare) : la boîte compte aussi les
 * ancres de roue sans maillage, à leur rayon autour de leur centre ; centrée en x et z, posée au sol.
 * (Le modèle des tests des places est centré sur sa seule boîte : la Cox y est décalée de 2,75 cm en z.)
 */
function poseCommeLApp(model: Group, vehicle: VehicleManifest): void {
  model.updateMatrixWorld(true);
  const box = new Box3().setFromObject(model, true);
  const nodes = new Set(vehicle.wheels?.nodes ?? []);
  model.traverse((object) => {
    if (!(/^roue_/i.test(object.name) || nodes.has(object.name)) || !new Box3().setFromObject(object, true).isEmpty()) return;
    const at = object.getWorldPosition(new Vector3());
    const r = Math.max(0.05, at.y);
    box.expandByPoint(at.clone().addScalar(r));
    box.expandByPoint(at.clone().subScalar(r));
  });
  const center = box.getCenter(new Vector3());
  model.position.x -= center.x;
  model.position.y -= box.min.y;
  model.position.z -= center.z;
  model.updateMatrixWorld(true);
}

/** Distance d'un point à la caisse le long d'une direction horizontale (rayon), ou Infinity. */
function hit(model: Group, from: Vector3, direction: Vector3, raycaster: Raycaster): number {
  raycaster.set(from, direction);
  raycaster.far = 1;
  const found = raycaster.intersectObject(model, true).find((item) => !/glass|vitre/i.test(((item.object as Mesh).material as { name?: string }).name ?? ''));
  return found?.distance ?? Infinity;
}

describe('kit carrosserie posé sur les trois voitures', () => {
  const models = new Map<string, Group>();
  beforeAll(async () => {
    for (const id of CARS) {
      const vehicle = car(id);
      const model = vehicle.placeholder === 'placeholder_banc' ? await storedModel(id) : await builtModel(id);
      model.traverse((object) => {
        if (object instanceof Mesh) for (const material of [object.material].flat()) material.side = DoubleSide;
      });
      poseCommeLApp(model, vehicle);
      models.set(id, model);
    }
  }, 180_000);

  for (const id of CARS) {
    it(`${id} : aucune pièce ne passe sous le bas de caisse d’origine (garde au sol tenue à l’assiette la plus basse)`, () => {
      const vehicle = car(id);
      const floor = vehicle.wheels?.floor;
      expect(floor).toBeDefined();
      for (const item of KIT) {
        const mount = railOf(vehicle, item);
        for (const option of optionsFor(vehicle, item)) {
          const { parts } = buildPiece(option);
          let low = Infinity;
          for (const part of parts) {
            const posed = fitPositions(part.geometry.getAttribute('position').array, 'rail', mount, poste(item), option, floor);
            for (let i = 1; i < posed.length; i += 3) low = Math.min(low, posed[i] as number);
          }
          expect(low, `${id} ${item} ${option.id}`).toBeGreaterThanOrEqual((floor ?? 0) + RAIL_CLEARANCE - 1e-4);
        }
      }
    });

    it(`${id} : le rail est sur la face de la caisse, d’aplomb jusqu’à sa hauteur déclarée`, () => {
      const vehicle = car(id);
      const model = models.get(id);
      if (!model) throw new Error(`${id} : modèle absent`);
      const raycaster = new Raycaster();
      const lines: string[] = [];
      for (const item of KIT) {
        const mount = railOf(vehicle, item);
        const path = railPath(railPoints(mount, poste(item).mirror === true));
        const at = { x: 0, y: 0, z: 0, nx: 0, nz: 0 };
        const steps = Math.max(8, Math.round(path.length / 0.05));
        // Écart au rail : positif, la face est derrière (la pièce flotterait) ; négatif, devant (la pièce y entre).
        let gap = 0;
        let buried = 0;
        let recess = 0;
        // Les deux bouts (2 cm) sont laissés : la face y tourne.
        for (let k = 0; k <= steps; k += 1) {
          const s = 0.02 + ((path.length - 0.04) * k) / steps;
          railAt(path, s, at);
          const inward = new Vector3(-at.nx, 0, -at.nz);
          for (const up of [0, mount.rise / 2, mount.rise]) {
            const from = new Vector3(at.x + at.nx * 0.2, at.y + up, at.z + at.nz * 0.2);
            const d = hit(model, from, inward, raycaster) - 0.2;
            if (process.env.PMB_POSE && Math.abs(d) > 0.008) lines.push(`  ${item} s=${s.toFixed(2)} (${at.x.toFixed(3)}, ${(at.y + up).toFixed(3)}, ${at.z.toFixed(3)}) écart ${(d * 1000).toFixed(1)} mm`);
            if (up === 0) [gap, buried] = [Math.max(gap, d), Math.min(buried, d)];
            else recess = Math.max(recess, d);
          }
        }
        lines.push(`${item} : jour au rail ${(gap * 1000).toFixed(1)} mm, pièce rentrée de ${(-buried * 1000).toFixed(1)} mm, recul de la face ${(recess * 1000).toFixed(1)} mm`);
      }
      if (process.env.PMB_POSE) process.stderr.write(`${id}\n  ${lines.join("\n  ")}\n`);
      // Jour de 8 mm au plus entre la face et la pièce ; la face peut avancer dans la pièce de 3 cm au plus.
      for (const line of lines.filter((item) => / : jour au rail /.test(item))) {
        const [gap, buried, recess] = (line.match(/-?[\d.]+ mm/g) ?? []).map((item) => Number.parseFloat(item));
        expect(gap, `${id} ${line}`).toBeLessThanOrEqual(8);
        expect(buried, `${id} ${line}`).toBeLessThanOrEqual(30);
        expect(recess, `${id} ${line}`).toBeLessThanOrEqual(8);
      }
    });
  }
});
