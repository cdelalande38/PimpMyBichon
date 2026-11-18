// Le moteur posé fondu en un seul maillage (vague U, « capot ») : module pur (three seulement), lu par
// le moteur posé dans le véhicule (./moteur.ts) et par les tests. Chaque sommet porte la couleur et les
// réglages de son morceau (src/scene/moteur/habillage.ts) ; un matériau physique les lit à la place des
// siens (onBeforeCompile). Un seul appel de dessin pour tout le moteur, quels que soient les traitements.

import { BufferAttribute, BufferGeometry, Color, Mesh, MeshPhysicalMaterial, ShaderChunk } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { noeudsFamille, type MoteurFamille } from '../../data/moteurs.ts';
import type { Build } from '../../data/vehicleTypes.ts';
import { envOf, lookOf, looksOf, morceauDe, noeudMontre, optionsPosees } from '../moteur/habillage.ts';

/** Matériau du moteur posé : un matériau physique dont les réglages viennent des sommets. */
export function createMoteurMaterial(): MeshPhysicalMaterial {
  // Vernis non nul : le programme garde le vernis, que chaque sommet règle (0 : aucun).
  const material = new MeshPhysicalMaterial({ vertexColors: true, clearcoat: 1, color: 0xffffff });
  material.name = 'moteur_pose';
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 pmbMat;\nattribute float pmbEnv;\nvarying vec4 vPmbMat;\nvarying float vPmbEnv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvPmbMat = pmbMat;\nvPmbEnv = pmbEnv;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vPmbMat;\nvarying float vPmbEnv;')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = vPmbMat.x;')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = vPmbMat.y;')
      .replace(
        '#include <lights_physical_fragment>',
        ShaderChunk.lights_physical_fragment.replace('material.clearcoat = clearcoat;', 'material.clearcoat = vPmbMat.z;').replace('material.clearcoatRoughness = clearcoatRoughness;', 'material.clearcoatRoughness = vPmbMat.w;'),
      )
      .replace('#include <envmap_physical_pars_fragment>', ShaderChunk.envmap_physical_pars_fragment.replaceAll('envMapIntensity', '( envMapIntensity * vPmbEnv )'));
  };
  material.customProgramCacheKey = () => 'pmb-moteur-pose';
  return material;
}

/**
 * Le moteur d'un build en un seul maillage : les morceaux des pièces (sans le support), l'option posée
 * de chaque échange seulement, dans le repère du fichier ; chaque sommet porte la couleur (linéaire) et
 * les réglages de son morceau (métal, rugosité, vernis, rugosité du vernis ; part du reflet).
 */
export function fondreMoteur(gltf: GLTF, famille: MoteurFamille, build: Build | undefined, bodyEnv: number): BufferGeometry {
  const known = noeudsFamille(famille);
  const looks = looksOf(famille, build);
  const posees = optionsPosees(famille, build);
  gltf.scene.updateMatrixWorld(true);
  const kept: Array<{ mesh: Mesh; look: NonNullable<ReturnType<typeof lookOf>> }> = [];
  let vertices = 0;
  let indices = 0;
  gltf.scene.traverse((object) => {
    if (!(object instanceof Mesh)) return;
    const morceau = morceauDe(object);
    if (morceau.node === null || !noeudMontre(known.get(morceau.node), posees)) return;
    const look = lookOf(morceau, known, looks);
    if (!look) return;
    const geometry = object.geometry as BufferGeometry;
    vertices += geometry.getAttribute('position').count;
    indices += geometry.index ? geometry.index.count : geometry.getAttribute('position').count;
    kept.push({ mesh: object, look });
  });
  const position = new Float32Array(vertices * 3);
  const normal = new Float32Array(vertices * 3);
  const color = new Float32Array(vertices * 3);
  const mat = new Float32Array(vertices * 4);
  const env = new Float32Array(vertices);
  const index = new Uint32Array(indices);
  const tint = new Color();
  let v0 = 0;
  let i0 = 0;
  for (const { mesh, look } of kept) {
    const source = (mesh.geometry as BufferGeometry).clone().applyMatrix4(mesh.matrixWorld);
    const p = source.getAttribute('position');
    const n = source.getAttribute('normal');
    tint.set(look.color);
    const reflet = envOf(look, bodyEnv);
    for (let v = 0; v < p.count; v += 1) {
      const k = v0 + v;
      position[k * 3] = p.getX(v);
      position[k * 3 + 1] = p.getY(v);
      position[k * 3 + 2] = p.getZ(v);
      if (n) {
        normal[k * 3] = n.getX(v);
        normal[k * 3 + 1] = n.getY(v);
        normal[k * 3 + 2] = n.getZ(v);
      }
      color[k * 3] = tint.r;
      color[k * 3 + 1] = tint.g;
      color[k * 3 + 2] = tint.b;
      mat[k * 4] = look.metalness;
      mat[k * 4 + 1] = look.roughness;
      mat[k * 4 + 2] = look.clearcoat;
      mat[k * 4 + 3] = look.clearcoatRoughness;
      env[k] = reflet;
    }
    const src = source.index;
    const count = src ? src.count : p.count;
    for (let i = 0; i < count; i += 1) index[i0 + i] = v0 + (src ? src.getX(i) : i);
    v0 += p.count;
    i0 += count;
    source.dispose();
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(position, 3));
  geometry.setAttribute('normal', new BufferAttribute(normal, 3));
  geometry.setAttribute('color', new BufferAttribute(color, 3));
  geometry.setAttribute('pmbMat', new BufferAttribute(mat, 4));
  geometry.setAttribute('pmbEnv', new BufferAttribute(env, 1));
  geometry.setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return geometry;
}
