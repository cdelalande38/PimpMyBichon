// Le moteur de l'établi posé dans le véhicule (vague U, demande du 18 novembre 2026) : capot ouvert,
// vitré ou déposé, au garage comme en sortie. Même fichier, mêmes traitements et mêmes échanges que
// sur l'établi (src/scene/moteur/habillage.ts) ; posé où le manifeste le dit (engine.pose : position de
// l'origine du fichier, demi-tour, échelle, repère du véhicule posé), dans la caisse (il suit
// l'assiette). Le fichier ne se charge que lorsque le moteur doit se voir.
//
// Coût : sur l'établi, un matériau par morceau (une trentaine d'appels de dessin) ; ici tout le moteur,
// sans son support, tient en un seul maillage et un seul appel : la couleur, le métal, la rugosité, le
// vernis et la part de reflet de chaque morceau sont portés par ses sommets, qu'un matériau physique
// lit à la place de ses réglages (onBeforeCompile). Refait seulement quand un traitement, une couleur ou
// un échange change ; rien par image.

import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { Group, Mesh } from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { moteurPose, signatureMoteurPose, type MoteurFamille } from '../../data/moteurs.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import { useBuilds } from '../../state/builds.ts';
import { loadEngine } from '../moteur/habillage.ts';
import { createMoteurMaterial, fondreMoteur } from './moteurFondu.ts';

/** Rang de dessin des pièces opaques du véhicule (comme VehicleModel.tsx). */
const VEHICLE_RENDER_ORDER = -2;

/** Le fichier du moteur d'une famille, chargé hors de Suspense, seulement quand `wanted` ; `null` tant qu'il n'est pas arrivé. */
function useEngineSource(famille: MoteurFamille | null, wanted: boolean): GLTF | null {
  // Une fois arrivé, le fichier reste (le capot qui se referme ne le relâche pas : cache de habillage.ts).
  const [loaded, setLoaded] = useState<{ id: string; gltf: GLTF } | null>(null);
  const id = famille?.id ?? null;
  useEffect(() => {
    if (!wanted || !id) return undefined;
    let live = true;
    loadEngine(id).then(
      (gltf) => {
        if (live) setLoaded((old) => (old?.id === id && old.gltf === gltf ? old : { id, gltf }));
      },
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [wanted, id]);
  return loaded && loaded.id === id ? loaded.gltf : null;
}

/** Montre ou cache le moteur posé. */
function montrer(holder: Group, visible: boolean): void {
  holder.visible = visible;
}

export interface MoteurPose {
  /** Le moteur est posé et visible. */
  visible: boolean;
  /** Famille posée (pour les parcours) ; `null` : aucun moteur posé à l'écran. */
  famille: string | null;
}

/**
 * Pose dans la caisse (`body`, repère du véhicule posé) le moteur du build, visible quand `wanted` ;
 * repeint quand un traitement, une couleur, un échange ou l'ambiance change.
 */
export function useMoteurPose(body: Group, vehicle: VehicleManifest, wanted: boolean, bodyEnv: number, invalidate: () => void): MoteurPose {
  const posed = useMemo(() => moteurPose(vehicle), [vehicle]);
  const gltf = useEngineSource(posed?.famille ?? null, wanted && posed !== null);
  const signature = useBuilds((state) => signatureMoteurPose(vehicle, state.builds[vehicle.id]));
  const material = useMemo(() => createMoteurMaterial(), []);
  useEffect(() => () => material.dispose(), [material]);
  const holder = useMemo(() => {
    const group = new Group();
    group.name = 'moteur_pose';
    return group;
  }, []);

  // Le support du moteur dans la caisse : posé une fois par véhicule.
  useLayoutEffect(() => {
    if (!posed) return undefined;
    const [x, y, z] = posed.pose.position;
    holder.position.set(x, y, z);
    holder.rotation.set(0, (posed.pose.yaw * Math.PI) / 180, 0);
    holder.scale.setScalar(posed.pose.scale);
    body.add(holder);
    return () => {
      holder.removeFromParent();
    };
  }, [body, holder, posed]);

  // Le maillage du moteur, refait quand le build (ou l'ambiance) change.
  useLayoutEffect(() => {
    if (!gltf || !posed) return undefined;
    const build = useBuilds.getState().builds[vehicle.id];
    const geometry = fondreMoteur(gltf, posed.famille, build, bodyEnv);
    const mesh = new Mesh(geometry, material);
    mesh.name = 'moteur_pose_fondu';
    mesh.renderOrder = VEHICLE_RENDER_ORDER;
    holder.add(mesh);
    invalidate();
    return () => {
      mesh.removeFromParent();
      geometry.dispose();
    };
    // `signature` : traitements, couleurs et échanges du build.
  }, [gltf, posed, vehicle.id, signature, bodyEnv, material, holder, invalidate]);

  const visible = wanted && gltf !== null && posed !== null;
  useLayoutEffect(() => {
    montrer(holder, visible);
    invalidate();
  }, [holder, visible, invalidate]);

  return { visible, famille: visible && posed ? posed.famille.id : null };
}
