// Le capot moteur dans la scène (vague U, demande du 18 novembre 2026) : il s'ouvre et se referme au
// garage (pastille, src/ui/overlay/CapotPastille.tsx ; action `ouvrirCapot`, ./capotEtat.ts), il se
// pose vitré ou se dépose (poste du capot, src/data/pieces.ts) au garage comme en sortie, et le moteur
// de l'établi se voit alors dans son compartiment (./moteur.ts). Le manifeste nomme les nœuds du
// modèle (pieces.capot : le capot et son pivot, sa variante vitrée, le compartiment), l'axe et
// l'angle d'ouverture, la pastille et le cadre de la caméra. Aucun identifiant de véhicule ici.
//
// Même image et même coût capot d'origine fermé : `prepare` (VehicleModel.tsx) fond tout par matière ;
// le compartiment (peint comme la caisse) se range en tête des maillages fondus, les pièces du capot qui s'y fondent
// (fentes, plaque, éclaireur) en queue, et une plage de dessin (setDrawRange) laisse dehors le
// compartiment tant que le capot est fermé. Capot ouvert, vitré ou déposé : la plage laisse dehors le
// capot fondu, dont une copie (mêmes géométries, mêmes matériaux) tourne avec son nœud ; le
// compartiment entre. La variante vitrée n'est jamais fondue. La tôle du capot (sa zone de peinture,
// seule) n'est jamais fondue non plus : elle tourne avec son nœud, ses deux faces dessinées tant qu'on
// peut voir dessous ; la livrée (stickers) la suit. Rien n'est alloué par image.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Vector3, type Camera, type Matrix4, type Object3D } from 'three';
import { capotDuBuild, type CapotStyle } from '../../data/pieces.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import { useBuilds } from '../../state/builds.ts';
import { useZoneFocus } from '../cadrageZone.ts';
import { useCapot } from './capotEtat.ts';
import { CAPOT_CADRE, CAPOT_DUREE_S, porterPieces, poserCapot, type CapotRig } from './capotRig.ts';
import { useMoteurPose } from './moteur.ts';
import type { Prepared } from './VehicleModel.tsx';

/** La livrée de la tôle du capot suit son ouverture : la matrice de son repère, tournée comme lui. */
function livreeCapot(prepared: Prepared, rig: CapotRig): { matrix: Matrix4; rest: Matrix4 } | null {
  const entry = prepared.livery?.materials.find((item) => item.material === rig.paint);
  return entry ? { matrix: entry.meshToVehicle, rest: entry.meshToVehicle.clone() } : null;
}

/** Courbe de l'ouverture : départ et arrivée en douceur. */
const ease = (t: number) => t * t * (3 - 2 * t);

/** Pose l'ouverture `t` (0 à 1) ; la livrée de la tôle tourne avec elle. */
function appliquer(rig: CapotRig, livery: { matrix: Matrix4; rest: Matrix4 } | null, style: CapotStyle | null, t: number, wantOpen: boolean): void {
  poserCapot(rig, { style, angle: (ease(t) * rig.mount.angle * Math.PI) / 180, ouvert: wantOpen || t > 0 });
  if (livery) livery.matrix.copy(livery.rest).multiply(rig.turnMatrix.makeRotationFromQuaternion(rig.turn));
}

// Calculs de la pastille, une fois pour toutes (une seule scène de garage).
const PIN = { local: new Vector3(), world: new Vector3(), eye: new Vector3(), normal: new Vector3() };

/** La pastille du capot à l'écran : son point projeté, `null` si elle est hors champ ou vue de l'autre côté du véhicule. */
function pinOnScreen(rig: CapotRig, body: Object3D, camera: Camera, rect: DOMRect, dock: DOMRect | null): { x: number; y: number } | null {
  // Véhicule caché (établi moteur ouvert) : pas de pastille.
  for (let node: Object3D | null = body; node; node = node.parent) if (!node.visible) return null;
  const [x, y, z] = rig.mount.pin.at;
  PIN.world.set(x, y, z);
  body.localToWorld(PIN.world);
  // Vu de l'autre côté du capot (sa normale au point de la pastille), elle se cache.
  camera.getWorldPosition(PIN.eye);
  body.worldToLocal(PIN.eye);
  const [nx, ny, nz] = rig.mount.pin.normal;
  PIN.normal.set(nx, ny, nz);
  PIN.local.set(x, y, z);
  if (PIN.eye.sub(PIN.local).dot(PIN.normal) <= 0) return null;
  PIN.world.project(camera);
  if (PIN.world.z < -1 || PIN.world.z > 1) return null;
  const px = Math.round(rect.left + ((PIN.world.x + 1) / 2) * rect.width);
  const py = Math.round(rect.top + ((1 - PIN.world.y) / 2) * rect.height);
  const inside = px > rect.left + 24 && px < rect.right - 24 && py > rect.top + 24 && py < rect.bottom - 24;
  // Sous le menu (en bas en portrait, sur le côté en paysage) : cachée.
  const covered = dock !== null && px + 24 > dock.left && px - 24 < dock.right && py + 24 > dock.top;
  return inside && !covered ? { x: px, y: py } : null;
}

export interface CapotScene {
  /** Signature de ce que montre le capot : les ombres s'y abonnent pour se refaire. */
  signature: string;
}

export interface CapotOptions {
  /** Au garage : la pastille, l'action ouvrirCapot, le cadrage de la caméra. En sortie : le capot reste fermé. */
  garage: boolean;
  /** Classe de l'élément de la scène où l'état se lit (parcours). */
  stageClass: string;
  /** Signature des pièces montées (./pieces.ts, usePieces) : celles posées sur le capot le suivent. */
  pieces: string;
}

const reducedMotion = () => typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Retire de la scène l'état du capot (parcours). */
function clearStage(stage: HTMLElement): void {
  delete stage.dataset.capot;
  delete stage.dataset.capotOption;
  delete stage.dataset.moteurPose;
}

/**
 * Le capot du véhicule préparé : ce que le build y pose (vitré, déposé), son ouverture au garage
 * (animée, coupée en « moins de mouvement »), le moteur posé quand il doit se voir.
 */
export function useCapotScene(prepared: Prepared, vehicle: VehicleManifest, invalidate: () => void, bodyEnv: number, options: CapotOptions): CapotScene {
  const { garage, stageClass, pieces } = options;
  const rig = prepared.capot ?? null;
  const gl = useThree((state) => state.gl);
  const style = useBuilds((state) => (rig ? capotDuBuild(vehicle, state.builds[vehicle.id]) : null));
  const wantOpen = useCapot((state) => garage && rig !== null && state.vehicule === vehicle.id && state.ouvert === vehicle.id);
  // Ouverture de 0 (fermé) à 1 (ouvert), menée image par image vers la demande ; `shut` : fermé, au repos.
  const motion = useRef(0);
  const [shut, setShut] = useState(true);
  const livery = useMemo(() => (rig ? livreeCapot(prepared, rig) : null), [prepared, rig]);

  // Au garage, le véhicule à l'écran dit s'il a un capot qui s'ouvre (la pastille, l'action).
  useEffect(() => {
    if (!garage) return undefined;
    useCapot.getState().setVehicule(rig ? vehicle.id : null);
    return () => {
      if (useCapot.getState().vehicule === vehicle.id) useCapot.getState().setVehicule(null);
    };
  }, [garage, rig, vehicle.id]);

  // Le moteur : visible dès que le capot quitte sa place d'origine fermée.
  const engineWanted = rig !== null && (style !== null || wantOpen || !shut);
  const moteur = useMoteurPose(prepared.wheels.body, vehicle, engineWanted, bodyEnv, invalidate);

  // Changement d'option (vitré, déposé) ou demande d'ouverture : posé tout de suite ; l'animation suit.
  useLayoutEffect(() => {
    if (!rig) return;
    if (reducedMotion()) motion.current = wantOpen ? 1 : 0;
    appliquer(rig, livery, style, motion.current, wantOpen);
    invalidate();
  }, [rig, style, wantOpen, invalidate, livery]);

  // Les pièces posées sur le capot le suivent (repères refaits quand une pièce change).
  useLayoutEffect(() => {
    if (!rig) return;
    porterPieces(rig, prepared.wheels.body, style);
    invalidate();
  }, [rig, prepared, style, pieces, invalidate]);

  useFrame((_, delta) => {
    if (!rig) return;
    const target = wantOpen ? 1 : 0;
    const t = motion.current;
    if (t !== target) {
      const step = Math.min(delta, 0.1) / CAPOT_DUREE_S;
      motion.current = target > t ? Math.min(target, t + step) : Math.max(target, t - step);
      appliquer(rig, livery, style, motion.current, wantOpen);
      invalidate();
    }
    const atRest = motion.current === 0;
    if (atRest !== shut) setShut(atRest);
  });

  // Cadrage du compartiment, capot ouvert ; la vue d'avant revient quand il se referme.
  useEffect(() => {
    if (!garage || !rig) return;
    const focus = useZoneFocus.getState();
    if (wantOpen) {
      const { face, center, size } = rig.mount.frame;
      focus.setFocus({ vehicle: vehicle.id, zone: CAPOT_CADRE, box: { face, center, size } });
    } else if (focus.focus?.zone === CAPOT_CADRE) focus.setFocus(null);
  }, [garage, rig, wantOpen, vehicle.id]);
  useEffect(
    () => () => {
      if (useZoneFocus.getState().focus?.zone === CAPOT_CADRE) useZoneFocus.getState().setFocus(null);
    },
    [],
  );

  // La pastille du capot : son point (repère du véhicule posé) à l'écran, à chaque image rendue.
  useFrame((state) => {
    if (!garage || !rig) return;
    const dock = document.querySelector('footer.dock')?.getBoundingClientRect() ?? null;
    useCapot.getState().setPin(pinOnScreen(rig, prepared.wheels.body, state.camera, gl.domElement.getBoundingClientRect(), dock));
  });
  useEffect(
    () => () => {
      if (garage) useCapot.getState().setPin(null);
    },
    [garage],
  );

  // Ce que la scène montre, pour les parcours : option, ouverture, moteur posé.
  useEffect(() => {
    const stage = gl.domElement.closest<HTMLElement>(`.${stageClass}`);
    if (!stage) return undefined;
    if (!rig) {
      clearStage(stage);
      return undefined;
    }
    stage.dataset.capot = wantOpen ? 'ouvert' : 'ferme';
    stage.dataset.capotOption = style ?? 'origine';
    stage.dataset.moteurPose = moteur.famille ?? 'aucun';
    return () => clearStage(stage);
  }, [gl, stageClass, rig, wantOpen, style, moteur.famille]);

  return { signature: rig ? `${style ?? 'origine'}:${wantOpen ? 'ouvert' : 'ferme'}:${shut ? 'repos' : 'leve'}:${moteur.visible ? 'moteur' : ''}` : '' };
}
