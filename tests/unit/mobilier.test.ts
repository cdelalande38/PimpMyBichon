// Mobilier du garage, famille par famille (src/data/garageProps/) : noms, matériaux, œuvres
// posées, place dans la pièce et budgets de triangles (cahier de remodelage, § 4.1 et § 5).
// Les modeleurs le lancent sans le modifier :
//   npx vitest run tests/unit/mobilier.test.ts
// Les pièces sont mesurées sur la géométrie réellement construite (propGeometries de
// src/scene/garage/build.ts : forme, rotation, pose, turn de l'objet) ; les pieds des tubes LED,
// sur le garage construit (éléments pied_tube_* de la coupe caméra).
import { Box3, Texture, Vector3, type BufferGeometry } from 'three';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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

/**
 * Marge tenue autour du grand volume protégé du véhicule (hystérésis comprise), en mètres : un
 * véhicule un peu plus large que le banc d'essai ne doit pas y faire entrer un objet, qui
 * resterait alors masqué par la coupe caméra.
 */
const PROTECT_MARGIN = 0.05;

/** Seuil de recoupement de deux boîtes de pièces, sur chacun des trois axes, en mètres. */
const OVERLAP = 0.005;

/**
 * Recoupements voulus entre deux objets (boîtes de pièces), clé « a | b » dans l'ordre de
 * GARAGE.props. Le test échoue aussi quand un recoupement nommé ici a disparu : le retirer alors.
 */
const OVERLAP_EXCEPTIONS: Record<string, string> = {
  'placeholder_meubles_atelier | placeholder_evier': 'cuve encastrée dans le plan de travail',
  'placeholder_colonne_ecran | placeholder_solives': 'solives qui entrent dans le haut de la colonne, jusqu’au plafond',
  'placeholder_casiers_casques | placeholder_casques': 'casques enfoncés de 1 cm dans le fond de leur case',
  'placeholder_flipper | placeholder_peluche': 'peluche assise sur la vitre en pente du plateau',
};

interface Measure {
  name: string;
  triangles: number;
  box: Box3;
  /** Boîte de chaque pièce, dans l'ordre de prop.parts. */
  parts: Box3[];
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
  const parts: Box3[] = [];
  const outside: string[] = [];
  let triangles = 0;
  geometries.forEach((geometry, index) => {
    triangles += triangleCount(geometry);
    geometry.computeBoundingBox();
    const part = (geometry.boundingBox ?? new Box3()).clone();
    parts.push(part);
    box.union(part);
    if (!room.containsBox(part)) outside.push(`pièce ${index} (${prop.parts[index]?.material}) ${boxText(part)}`);
  });
  return { name: prop.name, triangles, box, parts, outside };
}

const MEASURES = new Map<string, Measure[]>(Object.entries(FAMILIES).map(([family, { props }]) => [family, props.map(measure)]));
const BY_NAME = new Map([...MEASURES.values()].flat().map((m) => [m.name, m]));

/** Recouvrement de deux boîtes sur chaque axe (négatif : écart). */
const overlapOf = (a: Box3, b: Box3) => [0, 1, 2].map((k) => Math.min(a.max.getComponent(k), b.max.getComponent(k)) - Math.max(a.min.getComponent(k), b.min.getComponent(k)));

/** Grand volume protégé du véhicule (gabarit du banc d'essai), gonflé de `margin` sur les trois axes. */
function protectedBox(margin: number): Box3 {
  const { big } = protectedBoxes(null, GARAGE.vehicle.turn, GARAGE.vehicle.protect);
  return new Box3(new Vector3(big.min[0], big.min[1], big.min[2]), new Vector3(big.max[0], big.max[1], big.max[2])).expandByScalar(margin);
}

/** Les textures du garage se dessinent au canvas : sans DOM, elles restent vides. Rend de quoi revenir. */
function stubDocument(): () => void {
  const scope = globalThis as unknown as { document?: unknown };
  if (scope.document !== undefined) return () => {};
  scope.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
  return () => {
    delete scope.document;
  };
}

/** Pieds des tubes LED tels que le garage construit les déclare à la coupe caméra : boîtes de leurs pièces. */
const STANDS = new Map<string, Box3[]>();
let unstub = () => {};
beforeAll(async () => {
  unstub = stubDocument();
  const { createGarage } = await import('../../src/scene/garage/build.ts');
  const garage = createGarage(GARAGE, { artwork: () => ({ texture: new Texture(), release: () => {} }) });
  const { names, parts, partStart } = garage.cut.structure;
  names.forEach((name, index) => {
    if (!name.startsWith('pied_tube_')) return;
    const boxes: Box3[] = [];
    for (let j = partStart[index] ?? 0; j < (partStart[index + 1] ?? 0); j += 1) {
      const o = j * 6;
      const at = (k: number) => parts[o + k] ?? 0;
      boxes.push(new Box3(new Vector3(at(0), at(1), at(2)), new Vector3(at(3), at(4), at(5))));
    }
    STANDS.set(name, boxes);
  });
  garage.dispose();
});

afterAll(() => {
  for (const geometry of disposable) geometry.dispose();
  unstub();
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
  // caméra dès qu'il l'a été une fois. Même règle dans tests/unit/coupe.test.ts, par élément, sans
  // la marge.
  it(`aucun objet ne s’approche à moins de ${PROTECT_MARGIN * 100} cm du volume protégé du véhicule (gabarit du banc d’essai)`, () => {
    const big = protectedBox(0);
    const guarded = protectedBox(PROTECT_MARGIN);
    const near = GARAGE.props.flatMap((prop) => {
      const m = BY_NAME.get(prop.name);
      if (!m || !m.parts.some((part) => part.intersectsBox(guarded))) return [];
      const gap = Math.min(...m.parts.map((part) => Math.max(...overlapOf(part, big).map((o) => -o))));
      return [`${prop.name} : ${gap < 0 ? 'dedans' : `à ${(gap * 100).toFixed(1)} cm`}`];
    });
    expect(near, `grand volume ${boxText(big)}, marge ${PROTECT_MARGIN} m`).toEqual([]);
  });

  // Pieds des tubes LED (ambiance Néon) : construits par build.ts aux places de GARAGE.standTubes,
  // ils ne connaissent pas le mobilier ; un objet déplacé peut tomber sur l'un d'eux.
  it(`pieds des tubes LED : aucun ne recoupe une pièce du mobilier, chacun à ${PROTECT_MARGIN * 100} cm au moins du volume protégé`, () => {
    expect(STANDS.size).toBe(GARAGE.standTubes.at.length);
    const guarded = protectedBox(PROTECT_MARGIN);
    const problems: string[] = [];
    for (const [stand, boxes] of STANDS) {
      if (boxes.some((box) => box.intersectsBox(guarded))) problems.push(`${stand} : dans la marge du volume protégé`);
      for (const m of BY_NAME.values()) {
        m.parts.forEach((part, index) => {
          boxes.forEach((box, k) => {
            const o = overlapOf(box, part);
            if (o.every((v) => v > 0)) problems.push(`${stand} (pièce ${k}) × ${m.name} pièce ${index} : recouvrement ${o.map(fmt).join(' / ')}`);
          });
        });
      }
    }
    expect(problems).toEqual([]);
  });

  // Boîtes des pièces, deux objets à la fois : un recoupement de plus de 5 mm sur les trois axes
  // est soit voulu (OVERLAP_EXCEPTIONS), soit une pièce qui en traverse une autre.
  it('aucun recoupement entre objets hors de ceux nommés', () => {
    const all = GARAGE.props.map((prop) => BY_NAME.get(prop.name)).filter((m): m is Measure => m !== undefined);
    const found = new Map<string, string>();
    for (let a = 0; a < all.length; a += 1) {
      for (let b = a + 1; b < all.length; b += 1) {
        const ma = all[a] as Measure;
        const mb = all[b] as Measure;
        if (overlapOf(ma.box, mb.box).some((v) => v <= OVERLAP)) continue;
        for (let i = 0; i < ma.parts.length && !found.has(`${ma.name} | ${mb.name}`); i += 1) {
          for (let j = 0; j < mb.parts.length; j += 1) {
            const o = overlapOf(ma.parts[i] as Box3, mb.parts[j] as Box3);
            if (o.every((v) => v > OVERLAP)) {
              found.set(`${ma.name} | ${mb.name}`, `pièces ${i} × ${j}, recouvrement ${o.map(fmt).join(' / ')}`);
              break;
            }
          }
        }
      }
    }
    const unexpected = [...found].filter(([key]) => !(key in OVERLAP_EXCEPTIONS)).map(([key, text]) => `${key} : ${text}`);
    const stale = Object.keys(OVERLAP_EXCEPTIONS).filter((key) => !found.has(key));
    expect(unexpected, 'recoupements nouveaux').toEqual([]);
    expect(stale, 'exceptions plus nécessaires : les retirer de OVERLAP_EXCEPTIONS').toEqual([]);
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
