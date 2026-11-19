// Néons du véhicule en sortie (Custom › Néons ; tubes, nappes et réglages : src/scene/vehicle/neons.ts).
// Les tubes et l'habitacle vivent dans la caisse, comme au garage. La lueur au sol est posée hors du
// véhicule, à la scène, et recopie à chaque image la pose du véhicule sur le rail (cap, pente, sans le
// roulis : elle reste à plat sur la chaussée, comme l'ombre de contact) : la sonde de réflexion, qui masque
// le véhicule, la voit ainsi, et la caisse reflète sa propre lueur par en dessous.
// De nuit, la lueur colore la chaussée sous la caisse et autour, plus large et moins forte qu'au garage, et
// s'éteint en fondu avant le bord de la chaussée ; sur le mouillé, elle file vers la caméra ;
// de jour, elle s'efface et le tube seul reste, discret, sous le seuil du halo. Moment et météo suivent ceux
// de la sortie (src/state/drive.ts), en fondu. Sans allocation par image.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo } from 'react';
import { Group, Matrix4, type Object3D, type Vector3 } from 'three';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import { NEON_RENDU, useNeons, type NeonsRig } from '../../scene/vehicle/neons.ts';
import type { Prepared } from '../../scene/vehicle/VehicleModel.tsx';
import { livePilot, useDrive } from '../../state/drive.ts';
import { DRIVE_STAGE_CLASS } from '../contrat.ts';
import { createPose } from '../rail.ts';
import { liveVirages } from '../virages.ts';
import type { DriveRig } from './vehicule.tsx';

/** Part de la chaussée mouillée selon la météo choisie (la neige tient la lueur plus près). */
const MOUILLE: Readonly<Record<string, number>> = Object.freeze({ sec: 0, pluie: 1, neige: 0.35 });
/** Fondu du moment et de la météo : part franchie par seconde. */
const FONDU = 0.8;
/**
 * Hauteur de la lueur au-dessus du rail (m) : la chaussée est bombée (son axe passe 6 cm au-dessus de ses
 * bords, tools/maps/build.mjs) et le rail suit ses bords ; posée plus bas, la lueur passait sous l'enrobé et
 * n'en sortait que par morceaux. Sous la caisse (garde au sol de 9 cm et plus), elle reste invisible de côté.
 */
const AU_DESSUS_DU_RAIL = 0.075;

/** La lueur au sol suivie image par image : son support à la scène, le moment et le sol en fondu. */
class LueurSortie {
  readonly holder = new Group();
  private readonly lift = new Matrix4().makeTranslation(0, AU_DESSUS_DU_RAIL, 0);
  private day = -1;
  private wet = -1;
  private published = -1;
  private stage: HTMLElement | null = null;
  private readonly neons: NeonsRig;
  private readonly route = createPose();

  constructor(neons: NeonsRig) {
    this.neons = neons;
    this.holder.name = 'neons_sortie';
    this.holder.matrixAutoUpdate = false;
    neons.poserSol(NEON_RENDU.largeurSortie, NEON_RENDU.avanceSortie);
  }

  /**
   * Bords de la chaussée de part et d'autre du véhicule, lus sur le rail publié par la scène (les virages)
   * et la place du pilote : la lueur s'éteint en fondu avant eux (trottoir, accotement), au lieu de s'y
   * couper net. Sans rail publié, rien ne la coupe.
   * shortcut: le cap propre du véhicule (changement de place) est ignoré, quelques degrés au plus.
   */
  private bords(): void {
    const rail = liveVirages.current?.rail;
    const motion = livePilot.current?.motion;
    if (!rail || !motion) {
      this.neons.poserSol(NEON_RENDU.largeurSortie, NEON_RENDU.avanceSortie);
      return;
    }
    const demi = rail.poseAt(motion.s, this.route).width / 2;
    // Gauche de la marche : −Z du véhicule ; l'écart latéral est positif vers la gauche.
    this.neons.poserSol(NEON_RENDU.largeurSortie, NEON_RENDU.avanceSortie, demi - motion.offset, demi + motion.offset);
  }

  attach(scene: Object3D): void {
    this.holder.add(this.neons.sol);
    scene.add(this.holder);
  }

  detach(scene: Object3D): void {
    this.holder.remove(this.neons.sol);
    scene.remove(this.holder);
  }

  /** L'élément de la scène, où la force de la lueur est publiée pour les parcours. */
  bind(stage: HTMLElement | null): void {
    this.stage = stage;
  }

  release(): void {
    if (this.stage) delete this.stage.dataset.neonsLueur;
    this.stage = null;
    this.published = -1;
  }

  frame(vehicle: Object3D, camera: Vector3, delta: number, moment: string, weather: string): void {
    const dayGoal = moment === 'jour' ? 1 : 0;
    const wetGoal = MOUILLE[weather] ?? 0;
    const k = Math.min(1, Math.max(0, delta) * FONDU);
    this.day = this.day < 0 ? dayGoal : this.day + (dayGoal - this.day) * k;
    this.wet = this.wet < 0 ? wetGoal : this.wet + (wetGoal - this.wet) * k;
    const halo = 1 - this.day;
    this.neons.regler(halo * NEON_RENDU.forceSortie, NEON_RENDU.tube + (NEON_RENDU.tubeJour - NEON_RENDU.tube) * this.day, NEON_RENDU.etirementSec + (NEON_RENDU.etirementMouille - NEON_RENDU.etirementSec) * this.wet);
    this.holder.visible = halo > 0.01;
    if (this.neons.sol.visible && this.holder.visible) {
      this.holder.matrix.multiplyMatrices(vehicle.matrixWorld, this.lift);
      this.holder.matrixWorldNeedsUpdate = true;
      this.holder.updateMatrixWorld(true);
      this.neons.aim(this.holder, camera);
      this.bords();
    }
    // Pour les parcours : la force de la lueur au sol, en pour cent (0 de jour ou tout éteint).
    const lueur = this.neons.sol.visible ? Math.round(halo * 100) : 0;
    if (this.stage && lueur !== this.published && (lueur === 0 || lueur === 100 || Math.abs(lueur - this.published) >= 10)) {
      this.published = lueur;
      this.stage.dataset.neonsLueur = String(lueur);
    }
  }
}

export function useNeonsSortie(prepared: Prepared, vehicle: VehicleManifest, rig: DriveRig, invalidate: () => void): void {
  const scene = useThree((state) => state.scene);
  const gl = useThree((state) => state.gl);
  const neons = useNeons(prepared, vehicle, invalidate, { stageClass: DRIVE_STAGE_CLASS, aim: false });
  const lueur = useMemo(() => new LueurSortie(neons), [neons]);
  useLayoutEffect(() => {
    lueur.attach(scene);
    return () => lueur.detach(scene);
  }, [lueur, scene]);
  useEffect(() => {
    lueur.bind(gl.domElement.closest<HTMLElement>(`.${DRIVE_STAGE_CLASS}`));
    return () => lueur.release();
  }, [lueur, gl]);
  // Après le moteur de la scène (priorité 0), qui pose le véhicule ; avant la chaîne d'image (priorité 1).
  useFrame(({ camera }, delta) => {
    const drive = useDrive.getState();
    lueur.frame(rig.group, camera.position, delta, drive.moment, drive.weather);
  }, 0.5);
}
