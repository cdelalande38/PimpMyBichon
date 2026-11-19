// Le bruit du moteur de l'adversaire du duel (§ 5.5, jeu) : les boucles par régime de SON véhicule
// (src/audio/engine/, la famille de son manifeste), jouées par un second lecteur, invité du moteur du joueur
// (même contexte, même limiteur, src/audio/engine/lecteur.ts `hote`), au régime et à la charge que tient son
// pilote. Plus faible que le moteur du joueur et placé selon sa distance et son côté (`placerSon`) : le volume
// baisse avec la distance, il passe à gauche ou à droite, et les aigus s'éteignent quand il est derrière.
// Coupé hors du duel, dans l'aperçu (il n'est pas encore là), quand son modèle manque, en pause, moteur coupé
// ou au bout de la course (src/drive/son.ts, `actif`). Rien de synthétisé : un véhicule sans sons reste muet.
// Coût : les boucles de sa famille décodées une seconde fois (même véhicule que le joueur compris) et autant
// de voix que de boucles, plus trois nœuds (gain, coupure, placement).

import { EngineSoundPlayer } from '../../audio/engine/lecteur.ts';
import { SON_ADVERSAIRE, type ReglageSon } from '../../data/adversaires.ts';
import { livePilot } from '../../state/drive.ts';
import { soundFamilyOf, useEngineSound } from '../../state/engineSound.ts';
import { regimeJoue } from '../boite.ts';
import { devant } from './contact.ts';
import { liveDuel } from './course.ts';

export interface PlaceSon {
  /** Volume, de 0 à `niveau`. */
  gain: number;
  /** Placement, de −1 (à gauche) à 1 (à droite). */
  pan: number;
  /** Coupure des aigus, Hz (20 000 : rien de coupé). */
  coupure: number;
}

const OUVERT = 20000;

/**
 * Où l'on entend l'adversaire : `d` m devant le joueur (négatif derrière), `l` m à sa gauche (négatif à droite).
 * Volume en 1/distance au-delà de `proche`, éteint à `portee` ; placement selon le côté ; aigus coupés derrière.
 */
export function placerSon(d: number, l: number, r: ReglageSon, out: PlaceSon): PlaceSon {
  const dist = Math.hypot(Number.isFinite(d) ? d : 0, Number.isFinite(l) ? l : 0);
  out.gain = dist >= r.portee ? 0 : r.niveau * Math.min(1, r.proche / Math.max(dist, 1e-6)) * (1 - dist / r.portee);
  out.pan = dist > 1e-6 ? (-0.8 * l) / Math.max(dist, 1) : 0;
  // De face (1) à juste derrière (−1) : la coupure glisse d'ouvert à `derriere`, en proportion des octaves.
  const face = dist > 1e-6 ? d / dist : 1;
  out.coupure = face >= 0 ? OUVERT : OUVERT * (r.derriere / OUVERT) ** -face;
  return out;
}

/** Branche le moteur de l'adversaire ; `maj` est relu dix fois par seconde avec le son de la sortie (src/drive/son.ts). */
export function brancherSonAdversaire(audio: () => { ctx: AudioContext; sortie: AudioNode } | null = () => useEngineSound.getState().audio(), reglage: ReglageSon = SON_ADVERSAIRE) {
  let lecteur: EngineSoundPlayer | null = null;
  let famille: string | null = null;
  let tente = false;
  const place: PlaceSon = { gain: 0, pan: 0, coupure: OUVERT };
  const couper = () => {
    lecteur?.dispose();
    lecteur = null;
    famille = null;
    tente = false;
  };
  return {
    /** `actif` : le moteur du joueur tourne en course ; `niveau` : son volume (curseur « Moteur »). */
    maj(actif: boolean, niveau: number): void {
      const duel = liveDuel.current;
      const joueur = livePilot.current;
      const fam = actif && duel && duel.enPiste && duel.modele === 'pret' && joueur ? soundFamilyOf(duel.vehicule) : null;
      if (!fam || !duel || !joueur) {
        if (lecteur) couper();
        return;
      }
      if (fam !== famille) couper();
      famille = fam;
      lecteur ??= new EngineSoundPlayer(() => undefined, undefined, audio);
      if (lecteur.engineState === 'coupe') {
        // Une seule tentative par départ : des sons absents le laissent muet.
        if (!tente) void lecteur.start(fam, { demarreur: false });
        tente = true;
        return;
      }
      const pilot = duel.pilote.pilot;
      const plage = lecteur.range;
      if (plage) lecteur.drive(regimeJoue(pilot.train.rpm, pilot.train.idle, pilot.train.redline, plage), pilot.train.load, 0.1);
      placerSon(devant(joueur.motion.s, pilot.motion.s, pilot.rail.length, pilot.rail.loop), duel.offset - joueur.motion.offset, reglage, place);
      lecteur.setLevel(place.gain * Math.max(0, niveau), 0.1);
      lecteur.placer(place.pan, place.coupure, 0.1);
    },
    couper,
  };
}
