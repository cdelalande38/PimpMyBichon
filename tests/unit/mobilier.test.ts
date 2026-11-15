// Mobilier du garage, famille par famille (src/data/garageProps/) : noms, matériaux, œuvres
// posées, place dans la pièce et budgets de triangles (cahier de remodelage, § 4.1 et § 5).
// Les modeleurs le lancent sans le modifier :
//   npx vitest run tests/unit/mobilier.test.ts
// Les pièces sont mesurées sur la géométrie réellement construite (propGeometries de
// src/scene/garage/build.ts : forme, rotation, pose, turn de l'objet).
import { Box3, type BufferGeometry } from 'three';
import { afterAll, describe, expect, it } from 'vitest';
import { GARAGE, GARAGE_MATERIALS, type Prop } from '../../src/data/garage.ts';
import { artRect, GARAGE_ART } from '../../src/data/garageArt.ts';
import { PROPS_ATELIER } from '../../src/data/garageProps/atelier.ts';
import { PROPS_ENGINS } from '../../src/data/garageProps/engins.ts';
import { PROPS_LOISIRS } from '../../src/data/garageProps/loisirs.ts';
import { PROPS_SALON } from '../../src/data/garageProps/salon.ts';
import { propGeometries } from '../../src/scene/garage/build.ts';
import { protectedBoxes } from '../../src/scene/garage/cut.ts';
import { triangleCount } from '../../src/scene/garage/shapes.ts';

/** Plafonds de triangles par famille (§ 4.1 du cahier). */
const FAMILIES: Record<string, { props: readonly Prop[]; budget: number }> = {
  salon: { props: PROPS_SALON, budget: 16_400 },
  atelier: { props: PROPS_ATELIER, budget: 14_200 },
  engins: { props: PROPS_ENGINS, budget: 17_400 },
  loisirs: { props: PROPS_LOISIRS, budget: 14_450 },
};
/** Plafond du mobilier entier. */
const TOTAL_BUDGET = 62_500;
/** Marge admise au-delà des murs, du sol et du plafond, en mètres. */
const ROOM_TOLERANCE = 0.01;

/**
 * Objets qui sortent aujourd'hui de la pièce, à vider par le finisseur. Le test échoue aussi
 * quand une exception n'est plus nécessaire : la retirer alors de cette liste.
 */
const OUT_OF_ROOM_EXCEPTIONS: Record<string, string> = {};


interface Measure {
  name: string;
  triangles: number;
  box: Box3;
  /** Pièces qui sortent de la pièce : rang et boîte. */
  outside: string[];
}

const fmt = (n: number) => n.toFixed(3);
const boxText = (box: Box3) =>
  `[${fmt(box.min.x)}, ${fmt(box.min.y)}, ${fmt(box.min.z)}] → [${fmt(box.max.x)}, ${fmt(box.max.y)}, ${fmt(box.max.z)}]`;

const { width, depth, height } = GARAGE.room;
const room = new Box3().set(
  { x: -width / 2 - ROOM_TOLERANCE, y: -ROOM_TOLERANCE, z: -depth / 2 - ROOM_TOLERANCE } as never,
  { x: width / 2 + ROOM_TOLERANCE, y: height + ROOM_TOLERANCE, z: depth / 2 + ROOM_TOLERANCE } as never,
);

const disposable: BufferGeometry[] = [];
function measure(prop: Prop): Measure {
  const geometries = propGeometries(prop);
  disposable.push(...geometries);
  const box = new Box3();
  const outside: string[] = [];
  let triangles = 0;
  geometries.forEach((geometry, index) => {
    triangles += triangleCount(geometry);
    geometry.computeBoundingBox();
    const part = geometry.boundingBox ?? new Box3();
    box.union(part);
    if (!room.containsBox(part)) outside.push(`pièce ${index} (${prop.parts[index]?.material}) ${boxText(part)}`);
  });
  return { name: prop.name, triangles, box, outside };
}

const MEASURES = new Map<string, Measure[]>(Object.entries(FAMILIES).map(([family, { props }]) => [family, props.map(measure)]));

afterAll(() => {
  for (const geometry of disposable) geometry.dispose();
});

const detail = (measures: readonly Measure[]) =>
  measures
    .slice()
    .sort((a, b) => b.triangles - a.triangles)
    .map((m) => `  ${m.name} : ${m.triangles} triangles, boîte ${boxText(m.box)}`)
    .join('\n');

describe('mobilier : assemblage', () => {
  it('GARAGE.props est exactement la réunion des quatre familles, sans nom en double', () => {
    const all = Object.values(FAMILIES).flatMap(({ props }) => props.map((prop) => prop.name));
    const duplicates = all.filter((name, index) => all.indexOf(name) !== index);
    expect(duplicates, `noms en double entre familles : ${duplicates.join(', ')}`).toEqual([]);
    expect(GARAGE.props.map((prop) => prop.name).sort()).toEqual([...all].sort());
  });

  it(`total du mobilier sous ${TOTAL_BUDGET} triangles`, () => {
    const all = [...MEASURES.values()].flat();
    const total = all.reduce((sum, m) => sum + m.triangles, 0);
    const families = [...MEASURES].map(([family, measures]) => `${family} ${measures.reduce((sum, m) => sum + m.triangles, 0)}`).join(', ');
    expect(total, `mobilier : ${total} triangles (${families})\n${detail(all)}`).toBeLessThanOrEqual(TOTAL_BUDGET);
  });

  // Le grand volume protégé (hystérésis comprise) : un objet qui y entre reste masqué par la coupe
  // caméra dès qu'il l'a été une fois. Même règle dans tests/unit/coupe.test.ts, par élément.
  it('aucun objet n’entre dans le volume protégé du véhicule (gabarit du banc d’essai)', () => {
    const { big } = protectedBoxes(null, GARAGE.vehicle.turn, GARAGE.vehicle.protect);
    const inside = GARAGE.props.filter((prop) =>
      propGeometries(prop).some((geometry) => {
        geometry.computeBoundingBox();
        const box = geometry.boundingBox ?? new Box3();
        geometry.dispose();
        return [0, 1, 2].every((k) => box.min.getComponent(k) < (big.max[k] ?? 0) && box.max.getComponent(k) > (big.min[k] ?? 0));
      }),
    );
    expect(inside.map((prop) => prop.name)).toEqual([]);
  });

  it('les exceptions de place désignent un objet qui sort encore de la pièce', () => {
    const all = new Map([...MEASURES.values()].flat().map((m) => [m.name, m]));
    for (const name of Object.keys(OUT_OF_ROOM_EXCEPTIONS)) {
      const m = all.get(name);
      expect(m, `exception « ${name} » : objet introuvable, la retirer de OUT_OF_ROOM_EXCEPTIONS`).toBeDefined();
      expect(m?.outside.length ?? 0, `exception « ${name} » plus nécessaire : il tient dans la pièce, la retirer de OUT_OF_ROOM_EXCEPTIONS`).toBeGreaterThan(0);
    }
  });
});

for (const [family, { props, budget }] of Object.entries(FAMILIES)) {
  const measures = MEASURES.get(family) ?? [];
  describe(`famille ${family}`, () => {
    it('noms uniques, en placeholder_*', () => {
      const names = props.map((prop) => prop.name);
      for (const name of names) expect(name).toMatch(/^placeholder_[a-z0-9_]+$/);
      expect(new Set(names).size, `noms en double : ${names.filter((n, i) => names.indexOf(n) !== i).join(', ')}`).toBe(names.length);
    });

    it('matériaux existants', () => {
      const unknown = props.flatMap((prop) =>
        prop.parts.flatMap((part, index) => (part.material in GARAGE_MATERIALS ? [] : [`${prop.name}, pièce ${index} : ${part.material}`])),
      );
      expect(unknown, `matériaux absents de GARAGE_MATERIALS :\n  ${unknown.join('\n  ')}`).toEqual([]);
    });

    it('chaque œuvre posée désigne une œuvre et une case qui existent, d’une largeur positive', () => {
      const problems: string[] = [];
      for (const prop of props) {
        for (const slot of prop.art ?? []) {
          const item = GARAGE_ART.find((entry) => entry.id === slot.art);
          if (!item) {
            problems.push(`${prop.name} : œuvre « ${slot.art} » inconnue`);
            continue;
          }
          try {
            artRect(item, slot.region);
          } catch {
            problems.push(`${prop.name} : case « ${slot.region} » absente de l’œuvre ${slot.art}`);
          }
          if (!(slot.width > 0)) problems.push(`${prop.name} : largeur ${slot.width} pour ${slot.art}`);
        }
      }
      expect(problems).toEqual([]);
    });

    it('aucun objet ne sort de la pièce (murs, sol, plafond, à 1 cm près)', () => {
      const offenders = measures.filter((m) => m.outside.length > 0 && !(m.name in OUT_OF_ROOM_EXCEPTIONS));
      const text = offenders.map((m) => `  ${m.name} (boîte ${boxText(m.box)}) :\n    ${m.outside.join('\n    ')}`).join('\n');
      expect(offenders.map((m) => m.name), `pièce de ${fmt(width)} × ${fmt(depth)} × ${fmt(height)} m :\n${text}`).toEqual([]);
    });

    it(`triangles sous le plafond de la famille (${budget})`, () => {
      const total = measures.reduce((sum, m) => sum + m.triangles, 0);
      expect(total, `famille ${family} : ${total} triangles pour ${budget}\n${detail(measures)}`).toBeLessThanOrEqual(budget);
    });
  });
}
