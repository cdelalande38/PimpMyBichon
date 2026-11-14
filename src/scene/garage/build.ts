// Construction du garage à partir de sa description (src/data/garage.ts). Rien n'y est propre
// à un objet : tout se lit dans les listes. Le décor est immobile ; ses volumes sont fusionnés
// par matériau dans chaque objet pour tenir le budget de draw calls (§ 8).
// L'enveloppe est faite de faces simples tournées vers l'intérieur : la caméra, qui orbite
// hors de la pièce, voit à travers les murs proches.

import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  Color,
  CylinderGeometry,
  Euler,
  Float32BufferAttribute,
  FrontSide,
  Group,
  HemisphereLight,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  PointLight,
  Quaternion,
  SphereGeometry,
  SpotLight,
  Vector3,
  type Material,
} from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Ambiance } from '../../data/ambiances.ts';
import {
  colorOf,
  GARAGE_MATERIALS,
  type ColorKey,
  type Facing,
  type GarageLayout,
  type GarageMaterial,
  type GarageMaterialId,
  type Part,
  type Vec3,
} from '../../data/garage.ts';
import { garageTexture, haloTexture, signTexture } from './textures.ts';

/** Spots de la retombée, de gauche à droite : leur rang dans les listes de l'ambiance. */
const SPOT_SLOTS: readonly ColorKey[] = ['spotLeft', 'spotCenter', 'spotRight'];

const FACING: Record<Facing, Euler> = {
  '+z': new Euler(0, 0, 0),
  '-z': new Euler(0, Math.PI, 0),
  '+x': new Euler(0, Math.PI / 2, 0),
  '-x': new Euler(0, -Math.PI / 2, 0),
  '+y': new Euler(-Math.PI / 2, 0, 0),
  '-y': new Euler(Math.PI / 2, 0, 0),
};

/** Coordonnées de texture en mètres : la répétition des matériaux se règle par mètre. */
function scaleUv(geometry: BufferGeometry, from: number, count: number, su: number, sv: number): void {
  const uv = geometry.getAttribute('uv');
  for (let i = from; i < from + count; i += 1) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
}

/** Face plane ; `meters` : coordonnées de texture en mètres, sinon de 0 à 1 (dessin entier). */
function plane(width: number, height: number, at: Vec3, facing: Facing, meters = true): BufferGeometry {
  const geometry = new PlaneGeometry(width, height);
  if (meters) scaleUv(geometry, 0, 4, width, height);
  const matrix = new Matrix4().compose(new Vector3(...at), new Quaternion().setFromEuler(FACING[facing]), new Vector3(1, 1, 1));
  return geometry.applyMatrix4(matrix);
}

function partGeometry(part: Part): BufferGeometry {
  let geometry: BufferGeometry;
  if ('box' in part) {
    const [w, h, d] = part.box;
    geometry = new BoxGeometry(w, h, d);
    // Faces dans l'ordre +x, -x, +y, -y, +z, -z ; quatre sommets chacune.
    const faces: Array<[number, number]> = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    faces.forEach(([su, sv], index) => scaleUv(geometry, index * 4, 4, su, sv));
  } else if ('cylinder' in part) {
    const [radius, height] = part.cylinder;
    geometry = new CylinderGeometry(radius, radius, height, 20);
    if (part.axis === 'x') geometry.rotateZ(Math.PI / 2);
    if (part.axis === 'z') geometry.rotateX(Math.PI / 2);
  } else {
    geometry = new SphereGeometry(part.sphere, 18, 12);
  }
  const rotation = new Quaternion().setFromEuler(new Euler(...(part.rot ?? [0, 0, 0])));
  return geometry.applyMatrix4(new Matrix4().compose(new Vector3(...part.at), rotation, new Vector3(1, 1, 1)));
}

function merge(geometries: BufferGeometry[]): BufferGeometry {
  const merged = mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  if (!merged) throw new Error('Garage : volumes impossibles à fusionner');
  return merged;
}

function createMaterial(id: GarageMaterialId): MeshStandardMaterial {
  const spec: GarageMaterial = GARAGE_MATERIALS[id];
  const material = new MeshStandardMaterial({
    name: `garage_${id}`,
    color: spec.color,
    roughness: spec.roughness,
    metalness: spec.metalness,
    side: FrontSide,
    envMapIntensity: spec.env ?? 0.2,
  });
  if (spec.map) material.map = garageTexture(spec.map, spec.repeat);
  if (spec.emissive) {
    material.emissive = new Color(spec.emissive);
    material.emissiveIntensity = spec.emissiveIntensity ?? 1;
  }
  return material;
}

/** Une couleur d'ambiance, multipliée (au-delà de 1, elle déclenche le bloom). */
function hdr(ambiance: Ambiance, key: ColorKey, gain: number): Color {
  return new Color(colorOf(ambiance, key)).multiplyScalar(gain);
}

/** Peint une géométrie d'une couleur unie, par sommet (pour fusionner des sources de couleurs différentes). */
function paint(geometry: BufferGeometry, color: Color): BufferGeometry {
  const count = geometry.getAttribute('position').count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) colors.set([color.r, color.g, color.b], i * 3);
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
  return geometry;
}

export interface GarageScene {
  root: Group;
  /** Applique une ambiance : couleurs des sources, halos, tubes, lumières. */
  update: (ambiance: Ambiance) => void;
  dispose: () => void;
}

export function createGarage(layout: GarageLayout): GarageScene {
  const root = new Group();
  root.name = 'garage';
  const materials = new Map<GarageMaterialId, MeshStandardMaterial>();
  const material = (id: GarageMaterialId) => {
    let found = materials.get(id);
    if (!found) {
      found = createMaterial(id);
      materials.set(id, found);
    }
    return found;
  };
  const owned: Array<{ dispose: () => void }> = [];
  const add = (parent: Group, geometry: BufferGeometry, mat: Material, name: string) => {
    const mesh = new Mesh(geometry, mat);
    mesh.name = name;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    parent.add(mesh);
    owned.push(geometry);
    return mesh;
  };

  // 1. Enveloppe.
  const { width: W, depth: D, height: H } = layout.room;
  const { surfaces } = layout;
  const shell = new Group();
  shell.name = 'garage_enveloppe';
  add(shell, plane(W, D, [0, -0.002, 0], '+y'), material(surfaces.floor), 'sol');
  add(shell, plane(W, D, [0, H, 0], '-y'), material(surfaces.ceiling), 'plafond');
  add(shell, plane(W, H, [0, H / 2, -D / 2], '+z'), material(surfaces.back), 'mur_fond');
  add(shell, plane(W, H, [0, H / 2, D / 2], '-z'), material(surfaces.front), 'mur_avant');
  add(shell, plane(D, H, [-W / 2, H / 2, 0], '+x'), material(surfaces.left), 'mur_gauche');
  add(shell, plane(D, H, [W / 2, H / 2, 0], '-x'), material(surfaces.right), 'mur_droit');
  add(
    shell,
    merge(layout.soffits.map(({ size, at }) => partGeometry({ box: size, at, material: surfaces.back }))),
    material(surfaces.back),
    'retombees',
  );
  root.add(shell);

  // 2. Mobilier : un groupe nommé par objet, ses volumes fusionnés par matériau.
  for (const prop of layout.props) {
    const group = new Group();
    group.name = prop.name;
    group.position.set(...prop.at);
    group.rotation.y = prop.turn ?? 0;
    const byMaterial = new Map<GarageMaterialId, BufferGeometry[]>();
    for (const part of prop.parts) byMaterial.set(part.material, [...(byMaterial.get(part.material) ?? []), partGeometry(part)]);
    for (const [id, geometries] of byMaterial) add(group, merge(geometries), material(id), `${prop.name}_${id}`);
    group.updateMatrix();
    group.matrixAutoUpdate = false;
    root.add(group);
  }

  // 3. Panneaux à texture : crédence, écran, toile, cible.
  for (const panel of layout.panels) {
    const map = garageTexture(panel.texture, panel.repeat ? [panel.repeat[0] / panel.size[0], panel.repeat[1] / panel.size[1]] : [1 / panel.size[0], 1 / panel.size[1]]);
    const mat =
      panel.glow === undefined
        ? new MeshStandardMaterial({ map, roughness: 0.55, metalness: 0 })
        : new MeshBasicMaterial({ map, color: new Color(1, 1, 1).multiplyScalar(panel.glow) });
    owned.push(mat);
    add(root, plane(panel.size[0], panel.size[1], panel.at, panel.facing), mat, panel.name);
  }

  // 4. Sources pilotées par l'ambiance : refaites à chaque changement.
  const dynamic = new Group();
  dynamic.name = 'garage_sources';
  root.add(dynamic);
  const signMaterials = layout.signs.map((sign) => {
    const { texture, aspect } = signTexture(sign.text);
    const mat = new MeshBasicMaterial({ map: texture, transparent: true, blending: AdditiveBlending, depthWrite: false });
    owned.push(mat);
    add(root, plane(sign.height * aspect, sign.height, sign.at, sign.facing, false), mat, sign.name);
    return mat;
  });
  const emissive = new MeshBasicMaterial({ vertexColors: true });
  const halo = (kind: 'rond' | 'goutte') =>
    new MeshBasicMaterial({
      map: haloTexture(kind),
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
  const haloMaterials = { rond: halo('rond'), goutte: halo('goutte') } as const;
  const stands = material('noir');
  owned.push(emissive, haloMaterials.rond, haloMaterials.goutte);

  const lights = {
    ambient: new HemisphereLight(),
    left: new PointLight(),
    right: new PointLight(),
    key: new SpotLight(),
  };
  lights.left.position.set(...layout.lights.left);
  lights.right.position.set(...layout.lights.right);
  lights.key.position.set(...layout.lights.key);
  lights.key.target.position.set(...layout.lights.keyTarget);
  lights.key.angle = 0.75;
  lights.key.penumbra = 0.85;
  for (const light of [lights.left, lights.right, lights.key]) light.decay = 2;
  root.add(lights.ambient, lights.left, lights.right, lights.key, lights.key.target);

  let dynamicGeometries: BufferGeometry[] = [];

  function update(ambiance: Ambiance): void {
    for (const geometry of dynamicGeometries) geometry.dispose();
    dynamicGeometries = [];
    dynamic.clear();
    const put = (geometry: BufferGeometry, mat: Material, name: string) => {
      dynamicGeometries.push(geometry);
      const mesh = new Mesh(geometry, mat);
      mesh.name = name;
      mesh.renderOrder = mat === emissive || mat === stands ? 0 : -1;
      dynamic.add(mesh);
    };

    // Spots, bandeaux et tubes : une seule géométrie colorée par sommet.
    const sources: BufferGeometry[] = [];
    for (const spot of layout.spots) {
      const disc = new CylinderGeometry(spot.radius, spot.radius, 0.012, 16).translate(...spot.at);
      sources.push(paint(disc, hdr(ambiance, spot.color, ambiance.spotGain)));
    }
    if (ambiance.stripGain > 0) {
      for (const strip of layout.strips) {
        const length = new Vector3(...strip.from).distanceTo(new Vector3(...strip.to));
        const middle: Vec3 = [
          (strip.from[0] + strip.to[0]) / 2,
          (strip.from[1] + strip.to[1]) / 2,
          (strip.from[2] + strip.to[2]) / 2,
        ];
        sources.push(paint(plane(length, 0.03, middle, strip.facing, false), hdr(ambiance, strip.color, ambiance.stripGain)));
      }
    }
    const tubes = ambiance.standTubes;
    const standGeometries: BufferGeometry[] = [];
    const { height } = layout.standTubes;
    layout.standTubes.at.forEach(([x, z], index) => {
      const hex = tubes[index % Math.max(1, tubes.length)];
      if (!hex) return;
      const tube = new CylinderGeometry(0.024, 0.024, height, 12).translate(x, 0.14 + height / 2, z);
      sources.push(paint(tube, new Color(hex).multiplyScalar(ambiance.tubeGain)));
      standGeometries.push(new CylinderGeometry(0.16, 0.18, 0.04, 20).translate(x, 0.02, z));
      standGeometries.push(new CylinderGeometry(0.03, 0.03, 0.14, 10).translate(x, 0.09, z));
    });
    put(merge(sources), emissive, 'garage_sources_emissives');
    if (standGeometries.length > 0) put(merge(standGeometries), stands, 'placeholder_pieds_tubes');

    // Halos additifs : flaques au sol et sur les murs, halos doubles sous les spots.
    const halos: Record<'rond' | 'goutte', BufferGeometry[]> = { rond: [], goutte: [] };
    for (const item of layout.halos) {
      const geometry = plane(item.size[0], item.size[1], item.at, item.facing, false);
      halos[item.kind].push(paint(geometry, hdr(ambiance, item.color, item.gain * ambiance.haloGain)));
    }
    const [hw, hh] = layout.spotHalo.size;
    for (const spot of layout.spots) {
      if (!spot.wallHalo) continue;
      // Haut du halo juste sous la retombée, pointe fondue vers le bas.
      const at: Vec3 = [spot.at[0], spot.at[1] - hh / 2, -D / 2 + 0.009];
      const slot = SPOT_SLOTS.indexOf(spot.color);
      const gain = layout.spotHalo.gain * ambiance.haloGain * (ambiance.spotHaloGain[slot] ?? 1);
      halos.goutte.push(paint(plane(hw, hh, at, '+z', false), hdr(ambiance, spot.color, gain)));
      // Cœur du halo, plus petit et d'une teinte plus claire (cyan sous le bleu, orange sous le rouge).
      const core = ambiance.spotCores[slot] ?? colorOf(ambiance, spot.color);
      const coreAt: Vec3 = [at[0], spot.at[1] - hh * 0.22, at[2] + 0.001];
      halos.goutte.push(paint(plane(hw * 0.5, hh * 0.44, coreAt, '+z', false), new Color(core).multiplyScalar(gain * 0.45)));
    }
    for (const kind of ['rond', 'goutte'] as const) {
      const parts = halos[kind];
      if (parts.length === 0) continue;
      put(merge(parts), haloMaterials[kind], `garage_halos_${kind}`);
    }

    layout.signs.forEach((sign, index) => {
      signMaterials[index]?.color.copy(hdr(ambiance, sign.color, sign.gain * ambiance.tubeGain));
    });

    lights.ambient.color.set(ambiance.sky);
    lights.ambient.groundColor.set(ambiance.ground);
    lights.ambient.intensity = ambiance.ambient;
    lights.left.color.set(ambiance.left);
    lights.right.color.set(ambiance.right);
    lights.left.intensity = ambiance.sideIntensity;
    lights.right.intensity = ambiance.sideIntensity;
    lights.key.color.set(ambiance.key);
    lights.key.intensity = ambiance.keyIntensity;
  }

  function dispose(): void {
    for (const geometry of dynamicGeometries) geometry.dispose();
    for (const item of owned) item.dispose();
    for (const mat of materials.values()) mat.dispose();
  }

  return { root, update, dispose };
}
