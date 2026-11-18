// Retour de flammes en sortie (§ 5.5 « le véhicule vit », § 9) : avec une ligne d'échappement qui le
// permet (src/data/echappement.ts, `flammes`), un lever de pied franc juste après un passage à haut
// régime en charge fait cracher les sorties déclarées par le manifeste (`exhaust.outlets`). Les jets
// (un quad par sortie, un seul maillage, forme et éclat en données) sont ceux du garage :
// src/scene/vehicle/flammes.ts. Rien n'est alloué par image : des uniformes changent.
//
// Le compteur des tirs (src/audio/engine/echappement.ts, `retourFlammes`) fait jouer le claquement par
// les bruitages de route ; la scène publie `data-echappement` (ligne montée), `data-flammes` (tirs
// depuis le départ), `data-flamme` (« oui » tant qu'un jet brûle) et `data-sorties` (sorties déclarées)
// pour les parcours. La finition des sorties suit le build ici aussi (src/scene/vehicle/echappement.ts).
// La sortie n'a pas de mode photo : rien d'autre à éteindre.

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import type { Object3D, Scene } from 'three';
import { retourFlammes } from '../../audio/engine/echappement.ts';
import { ligneDe, type RetourFlammes } from '../../data/echappement.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import { useFinitionEchappement } from '../../scene/vehicle/echappement.ts';
import { compileHidden, creerFlammes, forceFlamme, SEUIL_VISIBLE, type FlammesRig } from '../../scene/vehicle/flammes.ts';
import { useBuilds } from '../../state/builds.ts';
import { livePilot, useDrive } from '../../state/drive.ts';
import '../../ui/echappement/suivi.ts';
import { DRIVE_STAGE_CLASS } from '../contrat.ts';

export { creerFlammes, forceFlamme, geometrieFlammes, RAYON_SORTIE, type FlammesRig } from '../../scene/vehicle/flammes.ts';

/** Lever de pied : charge tenue avant (au moins), charge après (au plus), et fenêtre entre les deux (s). */
export const LEVER = { armee: 0.5, levee: 0.15, fenetre: 0.6 } as const;
/** Ce que le déclencheur retient d'une image à l'autre (réécrit sur place). */
export interface SuiviFlammes {
  /** Temps depuis le dernier instant en charge à haut régime (s). */
  depuisCharge: number;
  /** Temps avant qu'un nouveau jet puisse partir (s). */
  attente: number;
  /** Temps restant du jet en cours (s ; 0 : éteint). */
  vie: number;
  /** Jets depuis le départ. */
  tirs: number;
}

export function suiviFlammesRepos(): SuiviFlammes {
  return { depuisCharge: Infinity, attente: 0, vie: 0, tirs: 0 };
}

/**
 * Avance le déclencheur de `dt` secondes de route. `charge` de 0 à 1, `regime` rapporté au rupteur,
 * `passage` : un passage de rapport en cours (sa chute de charge n'est pas un lever de pied). Rend vrai
 * quand un jet part : charge retombée sous `LEVER.levee` moins de `LEVER.fenetre` s après un instant en
 * charge (au moins `LEVER.armee`) à `regle.regimeMin` du rupteur au moins, délai écoulé, et le tirage
 * `alea` (0 à 1) sous `regle.chance`. Un lever de pied ne compte qu'une fois.
 */
export function suivreFlammes(s: SuiviFlammes, charge: number, regime: number, passage: boolean, regle: RetourFlammes, dt: number, alea: number): boolean {
  const pas = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  s.attente = Math.max(0, s.attente - pas);
  s.vie = Math.max(0, s.vie - pas);
  // Un passage de rapport ne mange pas la fenêtre : au lever de pied, la boîte monte souvent plusieurs
  // rapports d'affilée (une sportive : de la 1re à la 5e en une demi-seconde), et le jet partait ou non
  // selon leur nombre.
  if (!passage) s.depuisCharge += pas;
  if (charge >= LEVER.armee && regime >= regle.regimeMin) {
    s.depuisCharge = 0;
    return false;
  }
  if (passage || charge > LEVER.levee || s.depuisCharge > LEVER.fenetre || s.attente > 0) return false;
  s.depuisCharge = Infinity;
  if (!(alea < regle.chance)) return false;
  s.vie = regle.duree;
  s.attente = regle.attente;
  s.tirs += 1;
  return true;
}

/**
 * Échappement du véhicule de la sortie : finition des sorties, jets de flammes posés dans la caisse
 * (ils suivent l'assiette), déclencheur lu sur le pilote à chaque image, attributs de la scène.
 */
export function useEchappementSortie(root: Object3D, vehicle: VehicleManifest, invalidate: () => void): void {
  useFinitionEchappement(root, vehicle, invalidate);
  const gl = useThree((state) => state.gl);
  const camera = useThree((state) => state.camera);
  const scene = useThree((state) => state.scene) as Scene;
  const ligne = useBuilds((state) => ligneDe(state.builds[vehicle.id]));
  const regle = ligne.flammes ?? null;
  const outlets = vehicle.exhaust?.outlets;
  const rig = useMemo(() => (outlets && outlets.length > 0 ? creerFlammes(outlets) : null), [outlets]);
  useEffect(() => () => rig?.dispose(), [rig]);
  // Ce que l'image relit et réécrit : le déclencheur, les jets, la scène (attributs).
  const vivant = useRef<{ suivi: SuiviFlammes; rig: FlammesRig | null; regle: RetourFlammes | null; stage: HTMLElement | null; brule: boolean }>({
    suivi: suiviFlammesRepos(),
    rig: null,
    regle: null,
    stage: null,
    brule: false,
  });
  useLayoutEffect(() => {
    if (!rig) return undefined;
    const caisse = root.getObjectByName('caisse') ?? root;
    caisse.add(rig.mesh);
    compileHidden(rig.mesh, gl, camera, scene);
    const v = vivant.current;
    v.rig = rig;
    return () => {
      caisse.remove(rig.mesh);
      if (v.rig === rig) v.rig = null;
    };
  }, [rig, root, gl, camera, scene]);
  useLayoutEffect(() => {
    vivant.current.regle = regle;
    if (regle) rig?.regler(regle);
  }, [rig, regle]);
  useLayoutEffect(() => {
    const host = gl.domElement.closest<HTMLElement>(`.${DRIVE_STAGE_CLASS}`);
    const v = vivant.current;
    v.stage = host;
    if (host) {
      host.dataset.echappement = ligne.id;
      host.dataset.sorties = String(outlets?.length ?? 0);
      host.dataset.flammes = String(v.suivi.tirs);
      host.dataset.flamme = v.brule ? 'oui' : 'non';
    }
    return () => {
      if (host) {
        delete host.dataset.echappement;
        delete host.dataset.sorties;
        delete host.dataset.flammes;
        delete host.dataset.flamme;
      }
      v.stage = null;
    };
  }, [gl, ligne, outlets]);

  // Après le moteur de la scène (priorité 0), qui avance le pilote ; avant la chaîne de rendu (1).
  useFrame((state, delta) => {
    const v = vivant.current;
    const train = livePilot.current?.train;
    if (!v.regle) v.suivi.vie = 0;
    else if (train && !useDrive.getState().paused) {
      const regime = train.redline > 0 ? train.rpm / train.redline : 0;
      if (suivreFlammes(v.suivi, train.load, regime, train.shifting, v.regle, Math.min(0.1, delta), Math.random())) {
        retourFlammes.tirs += 1;
        if (v.stage) v.stage.dataset.flammes = String(v.suivi.tirs);
      }
    }
    const force = v.regle ? forceFlamme(v.suivi.vie, v.regle) : 0;
    v.rig?.poser(force, state.clock.elapsedTime);
    const allume = force > SEUIL_VISIBLE;
    if (allume !== v.brule) {
      v.brule = allume;
      if (v.stage) v.stage.dataset.flamme = allume ? 'oui' : 'non';
    }
  }, 0.5);
}
