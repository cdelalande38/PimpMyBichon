// Pièces montées sur la caisse du véhicule à l'écran (aileron…, src/data/pieces.ts) : l'option du build,
// chargée du catalogue partagé (public/assets/shared/pieces/), posée sur la caisse (elle suit l'assiette)
// d'après la section `pieces` du manifeste : chaque sommet est mis à la largeur, à la pente et au bombé
// de la surface de pose (fitPositions). La pièce prend la peinture de la carrosserie, ou sa couleur
// propre (partPaints, mêmes finitions), dans un matériau à elle : la livrée (stickers) n'y glisse pas.
// Elle reçoit les reflets de l'environnement comme la caisse. Partagé par le garage (VehicleModel.tsx)
// et la sortie de nuit (src/drive/scene/vehicule.tsx). Aucun identifiant de véhicule ni d'option ici.
//
// Les fichiers se chargent hors de Suspense (cache de promesses) : au changement d'option, l'ancienne
// pièce reste posée jusqu'à l'arrivée de la nouvelle.

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { BufferAttribute, Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Material, type MeshPhysicalMaterial, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { finish as findFinish } from '../../data/finishes.ts';
import { MATERIAL_ROLES } from '../../data/materialRoles.ts';
import { fitPositions, optionsFor, PIECE_NODES, PIECES_DIR, pieceFile, piecePaint, postesOf, resolvePiece, type PieceOption } from '../../data/pieces.ts';
import type { Build, Paint, VehicleManifest } from '../../data/vehicleTypes.ts';
import { applyPaint, createPaintMaterial } from '../../render/paint.ts';
import { masterZone, resolvePaint, useBuilds } from '../../state/builds.ts';
import type { Prepared } from './VehicleModel.tsx';

const BASE = import.meta.env.BASE_URL;
const loader = new GLTFLoader();
const sources = new Map<string, Promise<GLTF>>();

/** Rang de dessin des pièces opaques du véhicule (comme VehicleModel.tsx). */
const VEHICLE_RENDER_ORDER = -2;

/** Charge (une fois par séance) un fichier de pièce. Un échec s'oublie : le prochain appel réessaie. */
export function loadPieceSource(file: string): Promise<GLTF> {
  const url = `${BASE}${PIECES_DIR}${file}`;
  let promise = sources.get(url);
  if (!promise) {
    promise = loader.loadAsync(url);
    promise.catch(() => sources.delete(url));
    sources.set(url, promise);
  }
  return promise;
}

/** Les options qu'un véhicule accepte, chargées en tâche de fond : changer d'aileron ne fait plus attendre. */
export function preloadPieces(vehicle: Pick<VehicleManifest, 'pieces'>): void {
  for (const poste of postesOf(vehicle)) {
    for (const option of optionsFor(vehicle, poste.id)) void loadPieceSource(pieceFile(poste.id, option.id)).catch(() => undefined);
  }
}

/** Matériaux des rôles (chrome, alu, noir…), un par rôle pour toutes les pièces montées. */
const roleMaterials = new Map<string, MeshStandardMaterial>();
function roleMaterial(name: string): MeshStandardMaterial {
  const id = MATERIAL_ROLES.some((role) => role.id === name) ? name : 'black';
  let material = roleMaterials.get(id);
  if (!material) {
    const role = MATERIAL_ROLES.find((item) => item.id === id);
    material = new MeshStandardMaterial({ color: role?.color ?? '#121214', metalness: role?.metalness ?? 0, roughness: role?.roughness ?? 0.6 });
    material.envMapIntensity = role?.envMapIntensity ?? 1;
    material.name = id;
    roleMaterials.set(id, material);
  }
  return material;
}

/** Nœud de la pièce qui porte ce maillage : « surface » ou « niveau » (noms de tools/vehicles/pieces.mjs). */
function nodeOf(mesh: Object3D): string {
  for (let node: Object3D | null = mesh; node; node = node.parent) {
    if (node.name.startsWith(PIECE_NODES.level)) return PIECE_NODES.level;
    if (node.name.startsWith(PIECE_NODES.surface)) return PIECE_NODES.surface;
  }
  return PIECE_NODES.surface;
}

/** Pour chaque poste : l'option choisie (`null` : aucune pièce). Une clé stable, sans les couleurs. */
function choiceSignature(vehicle: VehicleManifest, build: Build | undefined): string {
  return JSON.stringify(postesOf(vehicle).map((poste) => [poste.id, resolvePiece(vehicle, build, poste.id)?.option?.id ?? null]));
}

/** Peinture effective de chaque poste : celle de la carrosserie, ou la couleur propre. Une clé stable. */
function paintSignature(vehicle: VehicleManifest, build: Build | undefined): string {
  const master = masterZone(vehicle);
  const body = master ? resolvePaint(vehicle, build, master.id) : undefined;
  return JSON.stringify(postesOf(vehicle).map((poste) => (body ? piecePaint(body, resolvePiece(vehicle, build, poste.id)?.own) : null)));
}

type Loaded = Readonly<Record<string /* poste */, { option: PieceOption; gltf: GLTF }>>;

/** Fichiers chargés, hors de Suspense : pendant le chargement d'une nouvelle option, la précédente reste. */
function usePieceSources(vehicle: VehicleManifest, choice: string): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({});
  useEffect(() => {
    let live = true;
    for (const [poste, id] of JSON.parse(choice) as Array<[string, string | null]>) {
      const option = optionsFor(vehicle, poste).find((item) => item.id === id);
      if (!option) continue;
      loadPieceSource(pieceFile(poste, option.id)).then(
        (gltf) => {
          if (live) setLoaded((old) => (old[poste]?.gltf === gltf ? old : { ...old, [poste]: { option, gltf } }));
        },
        () => undefined,
      );
    }
    return () => {
      live = false;
    };
  }, [vehicle, choice]);
  return loaded;
}

/**
 * Pose sur la caisse du véhicule préparé les pièces montées du build (aileron…) et tient leur peinture
 * à jour (couleur de la caisse ou couleur propre, part du reflet selon l'ambiance).
 */
export function usePieces(prepared: Prepared, vehicle: VehicleManifest, invalidate: () => void, bodyEnv: number, options: { preload?: boolean } = {}): void {
  const choice = useBuilds((state) => choiceSignature(vehicle, state.builds[vehicle.id]));
  const painted = useBuilds((state) => paintSignature(vehicle, state.builds[vehicle.id]));
  const loaded = usePieceSources(vehicle, choice);
  const postes = useMemo(() => postesOf(vehicle), [vehicle]);
  // Un matériau de peinture par poste, à la pièce seule.
  const paints = useMemo(() => new Map<string, MeshPhysicalMaterial>(postes.map((poste) => [poste.id, createPaintMaterial()])), [postes]);
  useEffect(
    () => () => {
      for (const material of paints.values()) material.dispose();
    },
    [paints],
  );
  useEffect(() => {
    if (options.preload && postes.length > 0) preloadPieces(vehicle);
  }, [options.preload, postes, vehicle]);

  useLayoutEffect(() => {
    const wanted = new Map(JSON.parse(choice) as Array<[string, string | null]>);
    const added: Group[] = [];
    const geometries: BufferGeometry[] = [];
    for (const poste of postes) {
      // Aucune pièce : retirée tout de suite ; une autre option : la précédente reste jusqu'à l'arrivée de la nouvelle.
      if (!wanted.get(poste.id)) continue;
      const source = loaded[poste.id];
      const mount = vehicle.pieces?.[poste.id];
      if (!source || !mount) continue;
      const group = new Group();
      group.name = `piece_${poste.id}`;
      source.gltf.scene.updateMatrixWorld(true);
      source.gltf.scene.traverse((object) => {
        if (!(object instanceof Mesh)) return;
        const geometry = (object.geometry as BufferGeometry).clone().applyMatrix4(object.matrixWorld);
        const fitted = fitPositions(geometry.getAttribute('position').array, nodeOf(object), mount, poste, source.option);
        geometry.setAttribute('position', new BufferAttribute(fitted, 3));
        geometry.computeVertexNormals();
        geometry.computeBoundingBox();
        geometry.computeBoundingSphere();
        geometries.push(geometry);
        const name = (object.material as Material).name;
        const material: Material = name.startsWith('paint_') ? (paints.get(poste.id) ?? roleMaterial('black')) : roleMaterial(name);
        const mesh = new Mesh(geometry, material);
        mesh.name = `${group.name}_${name}`;
        mesh.renderOrder = VEHICLE_RENDER_ORDER;
        group.add(mesh);
      });
      prepared.wheels.body.add(group);
      added.push(group);
    }
    prepared.root.updateMatrixWorld(true);
    invalidate();
    return () => {
      for (const group of added) group.removeFromParent();
      for (const geometry of geometries) geometry.dispose();
    };
  }, [prepared, vehicle, postes, loaded, choice, paints, invalidate]);

  // Peinture : repeinte sans reposer les pièces.
  useLayoutEffect(() => {
    const list = JSON.parse(painted) as Array<Paint | null>;
    postes.forEach((poste, rank) => {
      const paint = list[rank];
      const material = paints.get(poste.id);
      if (!paint || !material) return;
      const finish = findFinish(paint.finish);
      applyPaint(material, paint.color, finish, { flake: paint.flake, color2: paint.color2 });
      material.envMapIntensity = finish.envMapIntensity * bodyEnv;
    });
    invalidate();
  }, [painted, postes, paints, bodyEnv, invalidate]);
}
