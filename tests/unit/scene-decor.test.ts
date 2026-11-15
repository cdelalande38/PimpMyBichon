// Construction du décor du garage (src/scene/garage/build.ts, artwork.ts) : appui des objets
// posés (déclaré dans leurs données, Prop.rest, et vérifié sur la géométrie), ombres de contact et
// assombrissement de pied, tache bornée au dessus du porteur, transparence des œuvres au dessin
// (canvas simulé), matière des œuvres, recoloration des tubes néon, chemin commun avec
// propGeometries, triangles du décor entier, et libération des géométries (après la fusion, à la
// mise à jour, au dispose).
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import {
  BufferGeometry,
  DoubleSide,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Raycaster,
  Texture,
  Vector3,
  type BufferAttribute,
  type Material,
} from 'three';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AMBIANCES } from '../../src/data/ambiances.ts';
import { GARAGE } from '../../src/data/garage.ts';
import { garageArt, type GarageArtId } from '../../src/data/garageArt.ts';
import { CUT_ATTRIBUTE } from '../../src/render/cut.ts';
import { acquireArtwork, artworkMaterial } from '../../src/scene/garage/artwork.ts';
import type { GarageScene } from '../../src/scene/garage/build.ts';
import { CONTACT, propGeometries } from '../../src/scene/garage/build.ts';
import { supportsOf, type Box } from '../../src/scene/garage/cut.ts';
import { triangleCount } from '../../src/scene/garage/shapes.ts';

/** Les objets posés sur un meuble (tests/unit/coupe.test.ts, « supports attendus ») : ils déclarent leur appui (Prop.rest). */
const CARRIED = ['placeholder_peluche', 'placeholder_bloc_moteur', 'placeholder_moto_en_pieces', 'placeholder_evier'] as const;

/** Écart admis entre un objet posé et le dessus de son porteur, en mètres. */
const SEAT_GAP = 0.003;

/** Plafond de triangles du décor entier, sources et atmosphère comprises (§ 8, src/scene/garage/shapes.ts). */
const DECOR_BUDGET = 80_000;

/** Octets d'attributs que le garage peut retenir hors de ses maillages après la fusion. */
const RETAINED_BYTES = 16 * 1024;

const propOf = (name: string) => {
  const prop = GARAGE.props.find((p) => p.name === name);
  if (!prop) throw new Error(`objet introuvable : ${name}`);
  return prop;
};
const restOf = (name: string) => {
  const rest = propOf(name).rest;
  if (!rest) throw new Error(`${name} : appui non déclaré (Prop.rest)`);
  return rest;
};

/** Les textures du garage se dessinent au canvas : sans DOM, elles restent vides. Rend de quoi revenir. */
function stubDocument(): () => void {
  const scope = globalThis as unknown as { document?: unknown };
  if (scope.document !== undefined) return () => {};
  scope.document = { createElement: () => ({ width: 0, height: 0, getContext: () => null }) };
  return () => {
    delete scope.document;
  };
}

function meshes(scene: GarageScene): Mesh[] {
  const found: Mesh[] = [];
  scene.root.updateMatrixWorld(true);
  scene.root.traverse((object) => {
    if (object instanceof Mesh) found.push(object);
  });
  return found;
}

function boxOf(geometry: BufferGeometry): Box {
  geometry.computeBoundingBox();
  const b = geometry.boundingBox;
  if (!b) throw new Error('boîte absente');
  return { min: [b.min.x, b.min.y, b.min.z], max: [b.max.x, b.max.y, b.max.z] };
}

function unionOf(boxes: readonly Box[]): Box {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const b of boxes) {
    for (let k = 0; k < 3; k += 1) {
      min[k] = Math.min(min[k] ?? Infinity, b.min[k] ?? Infinity);
      max[k] = Math.max(max[k] ?? -Infinity, b.max[k] ?? -Infinity);
    }
  }
  return { min: [min[0] ?? 0, min[1] ?? 0, min[2] ?? 0], max: [max[0] ?? 0, max[1] ?? 0, max[2] ?? 0] };
}

/** Opacité de la texture de contact (textures.ts, `contact`) en un point de ses coordonnées. */
function contactAlpha(u: number, v: number): number {
  const r = Math.min(1, Math.hypot(Math.abs(u * 2 - 1), Math.abs(v * 2 - 1)));
  const t = 1 - r;
  return t * t * (3 - 2 * t);
}

/** Points de la tache d'un objet (élément de coupe `id`) dont l'opacité dépasse `threshold`. */
function visiblePatchPoints(contact: Mesh, id: number, threshold = 0.02): Vector3[] {
  const geometry = contact.geometry as BufferGeometry;
  const position = geometry.getAttribute('position');
  const uv = geometry.getAttribute('uv');
  const color = geometry.getAttribute('color');
  const cut = geometry.getAttribute(CUT_ATTRIBUTE);
  const index = geometry.getIndex();
  if (!index) throw new Error('taches sans index');
  const points: Vector3[] = [];
  const steps = 8;
  for (let t = 0; t < index.count; t += 3) {
    const corners = [index.getX(t), index.getX(t + 1), index.getX(t + 2)];
    if (corners.some((i) => cut.getX(i) !== id)) continue;
    for (let a = 0; a <= steps; a += 1) {
      for (let b = 0; a + b <= steps; b += 1) {
        const w = [a / steps, b / steps, 1 - (a + b) / steps];
        const p = new Vector3();
        let pu = 0;
        let pv = 0;
        let alpha = 0;
        corners.forEach((i, k) => {
          const weight = w[k] ?? 0;
          p.addScaledVector(new Vector3().fromBufferAttribute(position, i), weight);
          pu += uv.getX(i) * weight;
          pv += uv.getY(i) * weight;
          alpha += color.getW(i) * weight;
        });
        if (alpha * contactAlpha(pu, pv) > threshold) points.push(p);
      }
    }
  }
  return points;
}

let garage: GarageScene;
let unstub = () => {};
const acquired: Array<{ id: GarageArtId; onReady?: () => void }> = [];
let released = 0;
const onChange = () => {};

beforeAll(async () => {
  unstub = stubDocument();
  const { createGarage } = await import('../../src/scene/garage/build.ts');
  garage = createGarage(GARAGE, {
    artwork: (id, options) => {
      acquired.push({ id, ...(options.onReady ? { onReady: options.onReady } : {}) });
      return { texture: new Texture(), release: () => (released += 1) };
    },
    onChange,
  });
});
afterAll(() => {
  garage.dispose();
  unstub();
});

/** Sommets d'un objet dans le mobilier fusionné : position, normale, couleur de pied. */
function propVertices(id: number): Array<{ p: Vector3; n: Vector3; shade: number }> {
  const out: Array<{ p: Vector3; n: Vector3; shade: number }> = [];
  for (const mesh of meshes(garage)) {
    if (!mesh.name.startsWith('garage_mobilier_')) continue;
    const geometry = mesh.geometry as BufferGeometry;
    const cut = geometry.getAttribute(CUT_ATTRIBUTE);
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const color = geometry.getAttribute('color');
    for (let i = 0; i < position.count; i += 1) {
      if (cut.getX(i) !== id) continue;
      out.push({ p: new Vector3().fromBufferAttribute(position, i), n: new Vector3().fromBufferAttribute(normal, i), shade: color.getX(i) });
    }
  }
  return out;
}

const idOf = (name: string) => garage.cut.structure.names.indexOf(name) + 1;
const contactMesh = () => {
  const found = meshes(garage).find((mesh) => mesh.name === 'garage_contact');
  if (!found) throw new Error('taches de contact absentes');
  return found;
};
/** Sommets de la tache d'un objet. */
function patchVertices(id: number): Vector3[] {
  const geometry = contactMesh().geometry as BufferGeometry;
  const position = geometry.getAttribute('position');
  const cut = geometry.getAttribute(CUT_ATTRIBUTE);
  const out: Vector3[] = [];
  for (let i = 0; i < position.count; i += 1) if (cut.getX(i) === id) out.push(new Vector3().fromBufferAttribute(position, i));
  return out;
}

/**
 * Dessus du porteur déclaré : pièces du porteur dont le dessus est à 5 mm de la hauteur d'appui et
 * qui recouvrent l'objet en x et en z.
 */
function seatOf(name: string): { top: number; footprint: Box | null } {
  const { on, top, slope = 0 } = restOf(name);
  const own = unionOf(propGeometries(propOf(name)).map(boxOf));
  const over = (part: Box, k: number) => Math.min(part.max[k] ?? 0, own.max[k] ?? 0) > Math.max(part.min[k] ?? 0, own.min[k] ?? 0);
  // En pente, la boîte de la pièce porteuse monte plus haut que l'aplomb de l'objet : elle contient la hauteur d'appui.
  const level = (part: Box) => (slope === 0 ? Math.abs(part.max[1] - top) <= 0.005 : part.min[1] <= top && top <= part.max[1] + 0.005);
  const seats = propGeometries(propOf(on))
    .map(boxOf)
    .filter((part) => level(part) && over(part, 0) && over(part, 2));
  return { top, footprint: seats.length > 0 ? unionOf(seats) : null };
}

/** Hauteur du dessus déclaré à l'aplomb d'un point (pente comprise, comptée depuis l'origine de l'objet). */
function surfaceAt(name: string, z: number): number {
  const { top, slope = 0 } = restOf(name);
  return top + (propOf(name).at[2] - z) * Math.tan(slope);
}

/**
 * Points d'appui d'un objet posé : sommets de l'objet à 3 mm de la hauteur déclarée sous lesquels
 * le porteur a sa surface, à 3 mm près (rayon vers le bas sur la vraie géométrie du porteur).
 * Rend aussi la hauteur de la surface touchée.
 */
function contactsOf(name: string): Array<{ vertex: Vector3; surface: number }> {
  const { on } = restOf(name);
  const material = new MeshBasicMaterial({ side: DoubleSide });
  const carrier = propGeometries(propOf(on)).map((geometry) => new Mesh(geometry, material));
  const raycaster = new Raycaster();
  const down = new Vector3(0, -1, 0);
  const found: Array<{ vertex: Vector3; surface: number }> = [];
  for (const geometry of propGeometries(propOf(name))) {
    const position = geometry.getAttribute('position');
    for (let i = 0; i < position.count; i += 1) {
      const vertex = new Vector3().fromBufferAttribute(position, i);
      if (Math.abs(vertex.y - surfaceAt(name, vertex.z)) > SEAT_GAP) continue;
      raycaster.set(new Vector3(vertex.x, vertex.y + 2 * SEAT_GAP, vertex.z), down);
      raycaster.far = 4 * SEAT_GAP;
      const hit = raycaster.intersectObjects(carrier, false)[0];
      if (hit && Math.abs(hit.point.y - vertex.y) <= SEAT_GAP + 1e-6) found.push({ vertex, surface: hit.point.y });
    }
    geometry.dispose();
  }
  for (const mesh of carrier) mesh.geometry.dispose();
  material.dispose();
  return found;
}

describe('décor : objets posés sur un meuble', () => {
  it('les objets posés déclarent leur appui (Prop.rest), sur un porteur que la coupe caméra leur donne aussi', () => {
    const declared = GARAGE.props.filter((prop) => prop.rest !== undefined).map((prop) => prop.name);
    expect(declared.sort()).toEqual([...CARRIED].sort());
    for (const name of CARRIED) expect(supportsOf(garage.cut.structure, name), name).toContain(restOf(name).on);
  });

  // Les données disent où l'objet repose ; la géométrie doit le confirmer : un objet enfoncé, levé,
  // déplacé ou un porteur modifié fait échouer ce test (et non la règle de build.ts recopiée).
  it.each(CARRIED)('%s : repose sur son porteur à la hauteur déclarée, à 3 mm près (au moins 3 points d’appui)', (name) => {
    const { top } = restOf(name);
    const contacts = contactsOf(name);
    expect(contacts.length, `${name} : points d'appui sur ${restOf(name).on} à ${top} m`).toBeGreaterThanOrEqual(3);
    for (const { vertex, surface } of contacts) {
      expect(Math.abs(surface - surfaceAt(name, vertex.z)), `${name} : surface touchée à ${surface.toFixed(4)} m`).toBeLessThanOrEqual(SEAT_GAP + 1e-6);
    }
  });

  it.each(CARRIED)('%s : tache dans le plan du dessus qui le porte, à la hauteur d’appui, sans en déborder', (name) => {
    const id = idOf(name);
    expect(id, name).toBeGreaterThan(0);
    const vertices = patchVertices(id);
    const { top, footprint } = seatOf(name);
    expect(footprint, `${name} : aucun dessus plat à ${top} m sur son porteur`).not.toBeNull();
    if (!footprint) return;
    expect(vertices.length, `${name} : aucune tache`).toBeGreaterThan(0);
    for (const v of vertices) expect(v.y, `${name} : tache dans le plan du dessus, à la hauteur d'appui`).toBeCloseTo(surfaceAt(name, v.z) + CONTACT.rest.lift, 6);
    const points = visiblePatchPoints(contactMesh(), id);
    expect(points.length).toBeGreaterThan(20);
    const outside = points.filter(
      (p) => p.x < footprint.min[0] - 0.002 || p.x > footprint.max[0] + 0.002 || p.z < footprint.min[2] - 0.002 || p.z > footprint.max[2] + 0.002,
    );
    expect(outside.length, `${name} : ${outside.length} point(s) visibles de la tache hors du dessus du porteur`).toBe(0);
  });

  it.each(CARRIED)('%s : pied assombri à son appui (tout ce qui est à 5 cm de la hauteur d’appui), éclairé en haut', (name) => {
    const { top } = restOf(name);
    const vertices = propVertices(idOf(name));
    expect(vertices.length).toBeGreaterThan(0);
    const highest = Math.max(...vertices.map((v) => v.p.y));
    // Faces qui ne regardent pas le bas : seul l'appui (et un mur tout proche) les assombrit.
    const facing = vertices.filter((v) => v.n.y > -0.5);
    const low = facing.filter((v) => Math.abs(v.p.y - surfaceAt(name, v.p.z)) <= 0.05);
    const high = facing.filter((v) => v.p.y > highest - 0.02);
    expect(low.length, `${name} : aucun sommet à 5 cm de son appui (${top} m)`).toBeGreaterThan(0);
    // 0,75 : assombrissement de pied à 5 cm au-dessus de l'appui (0,71), avec un peu de jeu ; un
    // pied compté depuis un appui 15 cm plus bas (l'évier sur son caisson) donnerait 0,86.
    expect(Math.max(...low.map((v) => v.shade)), `${name} : pied`).toBeLessThan(0.75);
    expect(Math.max(...high.map((v) => v.shade)), `${name} : haut`).toBeGreaterThan(0.95);
  });

  // Garde-fou : un objet nouveau posé sur un meuble sans appui déclaré serait traité comme accroché
  // (ni tache sur le meuble, ni pied assombri).
  it('aucun objet hors du sol ne repose sur le dessus d’un porteur sans le déclarer', () => {
    const undeclared: string[] = [];
    for (const prop of GARAGE.props) {
      if (prop.rest) continue;
      const own = unionOf(propGeometries(prop).map(boxOf));
      if (own.min[1] < CONTACT.ground || Math.min(own.max[0] - own.min[0], own.max[2] - own.min[2]) < CONTACT.flat) continue;
      const over = (part: Box, k: number) => Math.min(part.max[k] ?? 0, own.max[k] ?? 0) > Math.max(part.min[k] ?? 0, own.min[k] ?? 0);
      for (const carrierName of supportsOf(garage.cut.structure, prop.name)) {
        const carrier = GARAGE.props.find((p) => p.name === carrierName);
        if (!carrier) continue;
        const seat = propGeometries(carrier)
          .map(boxOf)
          .find((part) => Math.abs(part.max[1] - own.min[1]) <= 0.05 && over(part, 0) && over(part, 2));
        if (seat) undeclared.push(`${prop.name} sur ${carrierName} (dessus à ${seat.max[1].toFixed(3)} m, bas de l'objet à ${own.min[1].toFixed(3)} m)`);
      }
    }
    expect(undeclared).toEqual([]);
  });

  it('un plat collé au mur au-dessus du plan (crédence) n’est pas « posé » : ni tache, ni pied assombri par la hauteur', () => {
    const id = idOf('placeholder_credence');
    expect(id).toBeGreaterThan(0);
    expect(patchVertices(id)).toEqual([]);
    const facing = propVertices(id).filter((v) => v.n.y > -0.5 && Math.abs(v.n.z) < 0.5);
    expect(facing.length).toBeGreaterThan(0);
    expect(Math.min(...facing.map((v) => v.shade))).toBeGreaterThan(0.99);
  });
});

describe('décor : chemin commun et libération', () => {
  it('le mobilier fusionné est fait des géométries de propGeometries (mêmes sommets, mêmes boîtes)', () => {
    for (const prop of GARAGE.props) {
      const id = idOf(prop.name);
      const parts = propGeometries(prop);
      const count = parts.reduce((sum, geometry) => sum + geometry.getAttribute('position').count, 0);
      const vertices = propVertices(id);
      expect(vertices.length, prop.name).toBe(count);
      const expected = unionOf(parts.map(boxOf));
      const got = unionOf(vertices.map(({ p }) => ({ min: [p.x, p.y, p.z], max: [p.x, p.y, p.z] })));
      for (let k = 0; k < 3; k += 1) {
        expect(got.min[k], prop.name).toBeCloseTo(expected.min[k] ?? 0, 9);
        expect(got.max[k], prop.name).toBeCloseTo(expected.max[k] ?? 0, 9);
      }
      for (const geometry of parts) geometry.dispose();
    }
  });

  it('œuvres : une texture par emplacement, rendu redemandé à l’arrivée (onChange), toutes rendues au dispose', async () => {
    const slots = GARAGE.props.reduce((sum, prop) => sum + (prop.art?.length ?? 0), 0);
    expect(acquired.length).toBe(slots);
    for (const { onReady } of acquired) expect(onReady).toBe(onChange);
    const { createGarage } = await import('../../src/scene/garage/build.ts');
    let taken = 0;
    let given = 0;
    const scene = createGarage(GARAGE, {
      artwork: () => {
        taken += 1;
        return { texture: new Texture(), release: () => (given += 1) };
      },
    });
    expect(given).toBe(0);
    scene.dispose();
    expect(given).toBe(taken);
    expect(released).toBe(0);
  });

  it('géométries : celles des pièces sont libérées à la fusion, les sources à chaque ambiance, toutes au dispose', async () => {
    const { createGarage } = await import('../../src/scene/garage/build.ts');
    const created = new Set<BufferGeometry>();
    const disposed = new Set<BufferGeometry>();
    const setAttribute = BufferGeometry.prototype.setAttribute;
    const dispose = BufferGeometry.prototype.dispose;
    BufferGeometry.prototype.setAttribute = function (this: BufferGeometry, ...args: Parameters<BufferGeometry['setAttribute']>) {
      created.add(this);
      return setAttribute.apply(this, args);
    } as BufferGeometry['setAttribute'];
    BufferGeometry.prototype.dispose = function (this: BufferGeometry) {
      disposed.add(this);
      dispose.call(this);
    };
    try {
      const scene = createGarage(GARAGE, { artwork: () => ({ texture: new Texture(), release: () => {} }) });
      const live = () => new Set(meshes(scene).map((mesh) => mesh.geometry as BufferGeometry));
      const leftovers = (alive: Set<BufferGeometry>) => [...created].filter((geometry) => !alive.has(geometry) && !disposed.has(geometry));
      expect(leftovers(live()).length, 'géométries jetées sans dispose après la construction').toBe(0);
      const [first, second] = AMBIANCES;
      if (!first || !second) throw new Error('deux ambiances attendues');
      scene.update(first);
      const firstSources = live();
      scene.update(second);
      expect(leftovers(live()).length, 'sources de l’ambiance précédente').toBe(0);
      expect([...firstSources].filter((geometry) => !live().has(geometry)).every((geometry) => disposed.has(geometry))).toBe(true);
      scene.dispose();
      expect([...live()].filter((geometry) => !disposed.has(geometry)).map((geometry) => geometry.name)).toEqual([]);
    } finally {
      BufferGeometry.prototype.setAttribute = setAttribute;
      BufferGeometry.prototype.dispose = dispose;
    }
  });

  it('un garage vivant ne retient pas les géométries des pièces d’avant la fusion', async () => {
    setFlagsFromString('--expose-gc');
    const gc = runInNewContext('gc') as () => void;
    const { createGarage } = await import('../../src/scene/garage/build.ts');
    const refs: Array<WeakRef<BufferGeometry>> = [];
    const setAttribute = BufferGeometry.prototype.setAttribute;
    const tracked = new WeakSet<BufferGeometry>();
    BufferGeometry.prototype.setAttribute = function (this: BufferGeometry, ...args: Parameters<BufferGeometry['setAttribute']>) {
      if (!tracked.has(this)) {
        tracked.add(this);
        refs.push(new WeakRef(this));
      }
      return setAttribute.apply(this, args);
    } as BufferGeometry['setAttribute'];
    let scene: GarageScene;
    try {
      scene = createGarage(GARAGE, { artwork: () => ({ texture: new Texture(), release: () => {} }) });
    } finally {
      BufferGeometry.prototype.setAttribute = setAttribute;
    }
    const ambiance = AMBIANCES[0];
    if (!ambiance) throw new Error('ambiance absente');
    scene.update(ambiance);
    // Une cible de WeakRef reste vivante jusqu'à la fin de la tâche en cours : on en sort avant de collecter.
    await new Promise((done) => setTimeout(done, 0));
    gc();
    gc();
    const alive = new Set(meshes(scene).map((mesh) => mesh.geometry as BufferGeometry));
    const retained = refs.map((ref) => ref.deref()).filter((geometry): geometry is BufferGeometry => geometry !== undefined && !alive.has(geometry));
    // Ce qui compte est la mémoire : quelques grosses géométries (les tubes néon, 318 Kio) pèsent
    // plus que cent petites. Les pièces fusionnées ne doivent plus être tenues par le garage.
    const bytesOf = (geometry: BufferGeometry) =>
      Object.values(geometry.attributes).reduce((sum, attribute) => sum + (attribute.array as Float32Array).byteLength, geometry.index ? geometry.index.array.byteLength : 0);
    const bytes = retained.reduce((sum, geometry) => sum + bytesOf(geometry), 0);
    const heaviest = retained
      .map((geometry) => ({ geometry, bytes: bytesOf(geometry) }))
      .sort((a, b) => b.bytes - a.bytes)
      .slice(0, 5)
      .map(({ geometry, bytes: b }) => `${geometry.name || geometry.type} ${(b / 1024).toFixed(1)} Kio (${geometry.getAttribute('position').count} sommets)`);
    expect(bytes, `${retained.length} géométries retenues hors des maillages, ${(bytes / 1024).toFixed(1)} Kio : ${heaviest.join(', ')}`).toBeLessThanOrEqual(RETAINED_BYTES);
    scene.dispose();
  });
});

describe('décor : tubes néon', () => {
  it('recolorés à chaque ambiance : même teinte, proportionnelle à la force des tubes', () => {
    const neon = () => {
      const mesh = meshes(garage).find((m) => m.name === 'garage_neons');
      if (!mesh) throw new Error('tubes néon absents');
      return Float32Array.from(((mesh.geometry as BufferGeometry).getAttribute('color') as BufferAttribute).array);
    };
    const [a, b] = AMBIANCES.filter((ambiance, i, all) => all.findIndex((other) => other.tubeGain === ambiance.tubeGain) === i);
    if (!a || !b) throw new Error('deux forces de tubes différentes attendues');
    garage.update(a);
    const colorsA = neon();
    garage.update(b);
    const colorsB = neon();
    expect(colorsA.length).toBeGreaterThan(0);
    let lit = 0;
    for (let i = 0; i < colorsA.length; i += 1) {
      const ca = colorsA[i] ?? 0;
      const cb = colorsB[i] ?? 0;
      expect(Number.isFinite(ca) && ca >= 0).toBe(true);
      expect(cb * a.tubeGain).toBeCloseTo(ca * b.tubeGain, 5);
      if (ca > 0) lit += 1;
    }
    expect(lit / colorsA.length).toBeGreaterThan(0.9);
  });
});

describe('décor : cônes de lumière', () => {
  // Un plan additif qui traverse un objet s'y lit comme une vitre à bord net (revue D, constat D6) :
  // les cônes s'arrêtent au-dessus de tout ce qui est dessous.
  it('aucun plan des cônes ne traverse une pièce du mobilier', () => {
    const { names, parts, partStart } = garage.cut.structure;
    const crossings: string[] = [];
    const furniture = GARAGE.props.flatMap((prop) => propGeometries(prop).map((geometry, index) => ({ name: `${prop.name}#${index}`, box: boxOf(geometry) })));
    let planes = 0;
    names.forEach((name, element) => {
      if (!name.startsWith('cone_')) return;
      for (let j = partStart[element] ?? 0; j < (partStart[element + 1] ?? 0); j += 1) {
        planes += 1;
        // Boîte du plan, épaissie de 2 mm : un plan n'a pas d'épaisseur, il traverse une pièce qui l'entoure.
        const at = (k: number) => parts[j * 6 + k] ?? 0;
        const plane: Box = { min: [at(0) - 0.002, at(1) - 0.002, at(2) - 0.002], max: [at(3) + 0.002, at(4) + 0.002, at(5) + 0.002] };
        for (const { name: part, box } of furniture) {
          const o = [0, 1, 2].map((k) => Math.min(plane.max[k] ?? 0, box.max[k] ?? 0) - Math.max(plane.min[k] ?? 0, box.min[k] ?? 0));
          if (o.every((v) => v > 0.003)) crossings.push(`${name} (plan ${j - (partStart[element] ?? 0)}, bas à ${(plane.min[1] + 0.002).toFixed(3)} m) × ${part}`);
        }
      }
    });
    expect(planes, 'plans des cônes').toBe(2 * GARAGE.spots.filter((spot) => spot.beam).length);
    expect(crossings).toEqual([]);
  });
});

describe('décor : triangles', () => {
  it(`le décor entier, sources et atmosphère comprises, sous ${DECOR_BUDGET} triangles`, () => {
    const ambiance = AMBIANCES[0];
    if (!ambiance) throw new Error('ambiance absente');
    garage.update(ambiance);
    const rows = meshes(garage).map((mesh) => ({ name: mesh.name, triangles: triangleCount(mesh.geometry as BufferGeometry) }));
    const total = rows.reduce((sum, row) => sum + row.triangles, 0);
    const detail = rows
      .sort((a, b) => b.triangles - a.triangles)
      .slice(0, 8)
      .map((row) => `${row.name} ${row.triangles}`)
      .join(', ');
    expect(total, `décor : ${total} triangles (${detail})`).toBeLessThanOrEqual(DECOR_BUDGET);
  });
});

// ---------------------------------------------------------------------------------------------
// Dessin des œuvres sur un canvas simulé.

type Rect = [number, number, number, number];
type Op = { kind: 'clear'; rect: Rect } | { kind: 'fill'; rect: Rect; style: string } | { kind: 'image'; image: FakeImage; rect: Rect };

/** Image simulée : le dessin ne couvre qu'un disque central (coins transparents). */
class FakeImage {
  src = '';
  decoding = '';
  width: number;
  height: number;
  constructor(width = 0, height = 0) {
    this.width = width;
    this.height = height;
  }
  decode(): Promise<void> {
    return Promise.resolve();
  }
  alphaAt(x: number, y: number): number {
    return Math.hypot(x - 0.5, y - 0.5) < 0.35 ? 1 : 0;
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  ops: Op[] = [];
  private readonly context = {
    fillStyle: '',
    clearRect: (x: number, y: number, w: number, h: number) => this.ops.push({ kind: 'clear', rect: [x, y, w, h] }),
    fillRect: (x: number, y: number, w: number, h: number) => this.ops.push({ kind: 'fill', rect: [x, y, w, h], style: this.context.fillStyle }),
    drawImage: (image: FakeImage, x: number, y: number, w: number, h: number) => this.ops.push({ kind: 'image', image, rect: [x, y, w, h] }),
  };
  getContext(kind: string) {
    return kind === '2d' ? this.context : null;
  }
  /** Pixel (fractions de la largeur et de la hauteur) : teinte de fond et alpha, ops rejouées. */
  pixel(fx: number, fy: number): { style: string | null; alpha: number } {
    const x = fx * this.width;
    const y = fy * this.height;
    let style: string | null = null;
    let alpha = 0;
    for (const op of this.ops) {
      const [rx, ry, rw, rh] = op.rect;
      if (x < rx || x >= rx + rw || y < ry || y >= ry + rh) continue;
      if (op.kind === 'clear') {
        style = null;
        alpha = 0;
      } else if (op.kind === 'fill') {
        style = op.style;
        alpha = 1;
      } else {
        const a = op.image.alphaAt((x - rx) / rw, (y - ry) / rh);
        if (a > 0) style = 'dessin';
        alpha = a + alpha * (1 - a);
      }
    }
    return { style, alpha };
  }
}

describe('œuvres : teinte d’attente et transparence au dessin', () => {
  const scope = globalThis as unknown as Record<string, unknown>;
  const saved = { document: scope.document, fetch: scope.fetch, Image: scope.Image };
  const canvases: FakeCanvas[] = [];
  beforeAll(() => {
    scope.document = {
      createElement: () => {
        const canvas = new FakeCanvas();
        canvases.push(canvas);
        return canvas;
      },
    };
    scope.fetch = () => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>') });
    scope.Image = FakeImage;
  });
  afterEach(() => {
    canvases.length = 0;
  });
  afterAll(() => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete scope[key];
      else scope[key] = value;
    }
  });

  async function drawn(id: GarageArtId): Promise<{ canvas: FakeCanvas; waiting: { style: string | null; alpha: number } }> {
    const handle = acquireArtwork(id);
    const canvas = canvases.at(-1);
    if (!canvas) throw new Error('canvas absent');
    const waiting = canvas.pixel(0.02, 0.02);
    expect(await handle.ready).toBe(true);
    handle.release();
    return { canvas, waiting };
  }

  // Une teinte d'attente couvrirait tout le plan, coins compris, tant que le dessin n'est pas
  // arrivé (ou s'il manque) : le panneau en volume, dessous, doit rester visible.
  it('œuvre transparente (cible) : rien avant le dessin, puis alpha nul hors du dessin', async () => {
    const item = garageArt('cible');
    expect(item.transparent).toBe(true);
    expect(item.waiting).toBeNull();
    const { canvas, waiting } = await drawn('cible');
    expect(waiting.alpha).toBe(0);
    for (const [fx, fy] of [
      [0.02, 0.02],
      [0.98, 0.02],
      [0.02, 0.98],
      [0.98, 0.98],
    ] as const) {
      expect(canvas.pixel(fx, fy).alpha, `coin ${fx} ${fy}`).toBe(0);
    }
    expect(canvas.pixel(0.5, 0.5)).toEqual({ style: 'dessin', alpha: 1 });
  });

  it('œuvre opaque (toile) : la teinte d’attente reste sous le dessin', async () => {
    const item = garageArt('toile-pop-art');
    expect(item.transparent).toBe(false);
    const { canvas } = await drawn('toile-pop-art');
    expect(canvas.pixel(0.02, 0.02)).toEqual({ style: item.waiting, alpha: 1 });
    expect(canvas.pixel(0.5, 0.5)).toEqual({ style: 'dessin', alpha: 1 });
  });

  it('attente transparente (plaques) : rien avant le dessin, rien hors du dessin', async () => {
    const item = garageArt('plaques-deco');
    expect(item.waiting).toBeNull();
    const { canvas, waiting } = await drawn('plaques-deco');
    expect(waiting.alpha).toBe(0);
    expect(canvas.pixel(0.02, 0.02).alpha).toBe(0);
  });

  it('matière : alphaTest 0,5 sans mélange pour une œuvre transparente ; émissive ou éclairée selon le registre', () => {
    const texture = new Texture();
    const cible: Material = artworkMaterial(garageArt('cible'), texture);
    expect(cible).toBeInstanceOf(MeshStandardMaterial);
    expect(cible.alphaTest).toBe(0.5);
    expect(cible.transparent).toBe(false);
    const toile = artworkMaterial(garageArt('toile-pop-art'), texture);
    expect(toile.alphaTest).toBe(0);
    const fronton = artworkMaterial(garageArt('flipper-fronton'), texture);
    expect(fronton).toBeInstanceOf(MeshBasicMaterial);
    expect((fronton as MeshBasicMaterial).color.r).toBeCloseTo(garageArt('flipper-fronton').glow ?? 1, 6);
    // Dans le garage, chaque œuvre porte cette matière.
    for (const mesh of meshes(garage).filter((m) => m.name.startsWith('oeuvre_'))) {
      const material = mesh.material as Material;
      const id = material.name.replace(/^oeuvre_/, '') as GarageArtId;
      expect(material.alphaTest, mesh.name).toBe(garageArt(id).transparent ? 0.5 : 0);
      expect(material.transparent, mesh.name).toBe(false);
    }
  });
});
