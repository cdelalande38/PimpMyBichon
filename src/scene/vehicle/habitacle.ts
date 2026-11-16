// Habitacle du véhicule à l'écran (§ 5.4) : le volant, le pommeau et les sièges avant choisis
// (catalogue partagé, src/data/habitacle.ts), posés sur les ancres du modèle (`volant`, `pommeau`,
// `siege_avant_*`), qui suivent la caisse (assiette). La jante du volant et le pommeau prennent leur
// couleur libre ; le pommeau et la sellerie prennent la peinture de leur zone quand le véhicule en
// déclare une. Partagé par le garage (VehicleModel.tsx) et la sortie de nuit.
//
// Les fichiers se chargent hors de Suspense (cache de promesses) : au changement de pièce,
// l'ancienne reste posée jusqu'à l'arrivée de la nouvelle.

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Group, Mesh, MeshStandardMaterial, type Material, type Object3D } from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MATERIAL_ROLES } from '../../data/materialRoles.ts';
import {
  INTERIOR_CATALOGUE,
  INTERIOR_DIR,
  INTERIOR_SLOTS,
  interiorFiles,
  knobFile,
  resolveInterior,
  seatFile,
  steeringFile,
} from '../../data/habitacle.ts';
import type { Build, VehicleManifest } from '../../data/vehicleTypes.ts';
import { useBuilds } from '../../state/builds.ts';
import type { Prepared } from './VehicleModel.tsx';

const BASE = import.meta.env.BASE_URL;
const loader = new GLTFLoader();
const sources = new Map<string, Promise<GLTF>>();

/** Rang de dessin des pièces opaques du véhicule (comme VehicleModel.tsx). */
const VEHICLE_RENDER_ORDER = -2;

/** Charge (une fois par séance) une pièce d'habitacle. Un échec s'oublie : le prochain appel réessaie. */
export function loadInteriorSource(file: string): Promise<GLTF> {
  const url = `${BASE}${INTERIOR_DIR}${file}`;
  let promise = sources.get(url);
  if (!promise) {
    promise = loader.loadAsync(url);
    promise.catch(() => sources.delete(url));
    sources.set(url, promise);
  }
  return promise;
}

/** Toutes les pièces du catalogue, chargées en tâche de fond : changer de volant ne fait plus attendre. */
export function preloadInterior(): void {
  const files = [
    ...INTERIOR_CATALOGUE.steering.map((item) => steeringFile(item.id)),
    ...INTERIOR_CATALOGUE.knobs.map((item) => knobFile(item.id)),
    ...INTERIOR_CATALOGUE.seats.map((item) => seatFile(item.id)),
  ];
  for (const file of files) void loadInteriorSource(file).catch(() => undefined);
}

/** Matériaux des rôles (chrome, alu, noir, cuir…), un par rôle pour toutes les pièces d'habitacle. */
const roleMaterials = new Map<string, MeshStandardMaterial>();
function roleMaterial(name: string): MeshStandardMaterial {
  const id = MATERIAL_ROLES.some((role) => role.id === name) ? name : 'black';
  let material = roleMaterials.get(id);
  if (!material) {
    const role = MATERIAL_ROLES.find((item) => item.id === id);
    material = new MeshStandardMaterial({ color: role?.color ?? '#121214', metalness: role?.metalness ?? 0, roughness: role?.roughness ?? 0.6 });
    // Dans l'habitacle, à l'abri du toit, les métaux renvoient moins les néons du garage qu'au dehors.
    material.envMapIntensity = (role?.envMapIntensity ?? 1) * (role && role.metalness > 0.5 ? 0.45 : 1);
    if (role?.emissive) {
      material.emissive.set(role.emissive.color);
      material.emissiveIntensity = role.emissive.intensity;
    }
    material.name = id;
    roleMaterials.set(id, material);
  }
  return material;
}

type Slot = 'steering' | 'knob' | 'seat';

type Loaded = Partial<Record<Slot, GLTF>>;

/** Pièces chargées, hors de Suspense : pendant le chargement d'un nouveau choix, le précédent reste. */
function useInteriorSources(files: Partial<Record<Slot, string | null>> | null): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({});
  const steering = files?.steering ?? null;
  const knob = files?.knob ?? null;
  const seat = files?.seat ?? null;
  useEffect(() => {
    let live = true;
    const wanted: Array<[Slot, string]> = [];
    if (steering) wanted.push(['steering', steering]);
    if (knob) wanted.push(['knob', knob]);
    if (seat) wanted.push(['seat', seat]);
    for (const [slot, file] of wanted) {
      loadInteriorSource(file).then(
        (gltf) => {
          if (live) setLoaded((old) => (old[slot] === gltf ? old : { ...old, [slot]: gltf }));
        },
        () => undefined,
      );
    }
    return () => {
      live = false;
    };
  }, [steering, knob, seat]);
  return loaded;
}

function meshesOf(gltf: GLTF): Mesh[] {
  const found: Mesh[] = [];
  gltf.scene.traverse((object) => {
    if (object instanceof Mesh) found.push(object);
  });
  return found;
}

/** Ce qui, dans un build, choisit les pièces posées (les couleurs à part) : une clé stable. */
function pieceSignature(build: Build | undefined): string {
  const { steering, knob, seats } = INTERIOR_SLOTS;
  return JSON.stringify({ parts: { [steering]: build?.parts?.[steering], [knob]: build?.parts?.[knob], [seats]: build?.parts?.[seats] } });
}

/** Ancre d'habitacle du modèle préparé (nœud nommé, sous la caisse). */
function anchorOf(prepared: Prepared, name: string): Object3D | undefined {
  return prepared.root.getObjectByName(name);
}

/**
 * Pose dans l'habitacle du véhicule préparé le volant, le pommeau et les sièges du build, et tient
 * leurs couleurs à jour.
 */
export function useHabitacle(prepared: Prepared, vehicle: VehicleManifest, invalidate: () => void, options: { preload: boolean } = { preload: false }): void {
  const signature = useBuilds((state) => pieceSignature(state.builds[vehicle.id]));
  const steeringColor = useBuilds((state) => state.builds[vehicle.id]?.partPaints?.[INTERIOR_SLOTS.steering]?.color);
  const knobColor = useBuilds((state) => state.builds[vehicle.id]?.partPaints?.[INTERIOR_SLOTS.knob]?.color);
  const resolved = useMemo(() => {
    const build = JSON.parse(signature) as Build;
    return resolveInterior(vehicle, { ...build, paints: {}, partPaints: { ...(steeringColor ? { [INTERIOR_SLOTS.steering]: { color: steeringColor } } : {}), ...(knobColor ? { [INTERIOR_SLOTS.knob]: { color: knobColor } } : {}) } });
  }, [vehicle, signature, steeringColor, knobColor]);
  const files = interiorFiles(resolved);
  const loaded = useInteriorSources(files);

  // Matériaux propres : la jante du volant et le pommeau sans zone de peinture.
  const own = useMemo(() => {
    const rim = new MeshStandardMaterial({ color: '#141416', roughness: 0.55, metalness: 0 });
    rim.name = 'paint_volant';
    rim.envMapIntensity = 0.4;
    const knob = new MeshStandardMaterial({ color: '#141416', roughness: 0.35, metalness: 0 });
    knob.name = 'paint_pommeau';
    knob.envMapIntensity = 0.8;
    return { rim, knob };
  }, []);
  useEffect(
    () => () => {
      own.rim.dispose();
      own.knob.dispose();
    },
    [own],
  );
  useEffect(() => {
    if (options.preload && resolved) preloadInterior();
  }, [options.preload, resolved]);

  const steeringId = resolved?.steering?.id;
  const knobId = resolved?.knob?.id;
  const seatId = resolved?.seats?.id;
  const knobZone = resolved?.knobZone ?? null;
  const seatZone = resolved?.seatZone ?? null;
  const seatScale = resolved?.seatScale ?? 1;
  useLayoutEffect(() => {
    const added: Object3D[] = [];
    const material = (name: string): Material => {
      const base = name.split('.')[0] ?? name;
      if (base === 'paint_volant') return own.rim;
      if (base === 'paint_pommeau') return (knobZone ? prepared.zones.get(knobZone) : undefined) ?? own.knob;
      if (base === 'paint_sellerie') return (seatZone ? prepared.zones.get(seatZone) : undefined) ?? roleMaterial('leather');
      return roleMaterial(base);
    };
    // Pendant le chargement d'un nouveau choix, la pièce précédente reste posée.
    const pose = (gltf: GLTF | undefined, id: string | undefined, anchors: readonly string[], scale = 1) => {
      if (!gltf || !id) return;
      for (const name of anchors) {
        const anchor = anchorOf(prepared, name);
        if (!anchor) continue;
        const group = new Group();
        group.name = 'habitacle_pose';
        group.scale.setScalar(scale);
        for (const mesh of meshesOf(gltf)) {
          const copy = new Mesh(mesh.geometry, material((mesh.material as Material).name));
          copy.renderOrder = VEHICLE_RENDER_ORDER;
          copy.position.copy(mesh.position);
          copy.quaternion.copy(mesh.quaternion);
          group.add(copy);
        }
        anchor.add(group);
        added.push(group);
      }
    };
    const { anchors } = INTERIOR_CATALOGUE;
    pose(loaded.steering, steeringId, [anchors.steering]);
    pose(loaded.knob, knobId, [anchors.knob]);
    pose(loaded.seat, seatId, anchors.seats, seatScale);
    prepared.root.updateMatrixWorld(true);
    invalidate();
    return () => {
      for (const object of added) object.removeFromParent();
    };
  }, [prepared, loaded, steeringId, knobId, seatId, knobZone, seatZone, seatScale, own, invalidate]);

  // Couleurs libres : repeintes sans reposer les pièces.
  const rimColor = resolved?.steeringColor;
  const rimRoughness = resolved?.steering?.roughness ?? 0.55;
  const ownKnob = resolved?.knobColor;
  useLayoutEffect(() => {
    if (rimColor) own.rim.color.set(rimColor);
    own.rim.setValues({ roughness: rimRoughness });
    if (ownKnob) own.knob.color.set(ownKnob);
    invalidate();
  }, [own, rimColor, rimRoughness, ownKnob, invalidate]);
}
