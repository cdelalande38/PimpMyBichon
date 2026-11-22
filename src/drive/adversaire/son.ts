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
  /** Taux de lecture d'ensemble : au-dessus de 1 en approche, au-dessous en éloignement (1 : à vitesse égale). */
  hauteur: number;
}

const OUVERT = 20000;

/**
 * Où l'on entend l'adversaire : `d` m devant le joueur (négatif derrière), `l` m à sa gauche (négatif à droite),
 * `fermeture` la vitesse (m/s) à laquelle la distance diminue (positive : il arrive ; négative : il s'éloigne).
 * Volume : plein (`niveau`) jusqu'à `proche`, puis (proche ÷ distance) à la puissance `chute`, éteint à `portee` ;
 * il monte en approche et redescend en éloignement (`approche`), sans dépasser `niveau`. La hauteur suit la vitesse
 * relative (`hauteur`). Placement selon le côté ; aigus coupés derrière.
 */
export function placerSon(d: number, l: number, r: ReglageSon, out: PlaceSon, fermeture = 0): PlaceSon {
  const dist = Math.hypot(Number.isFinite(d) ? d : 0, Number.isFinite(l) ? l : 0);
  const rel = Number.isFinite(fermeture) ? Math.min(1, Math.max(-1, fermeture / r.vitesseRef)) : 0;
  const base = dist >= r.portee ? 0 : r.niveau * Math.min(1, (r.proche / Math.max(dist, 1e-6)) ** r.chute) * (1 - Math.max(0, dist - r.proche) / (r.portee - r.proche));
  out.gain = Math.min(r.niveau, base * (1 + r.approche * rel));
  out.hauteur = 1 + r.hauteur * rel;
  out.pan = dist > 1e-6 ? (-0.8 * l) / Math.max(dist, 1) : 0;
  // De face (1) à juste derrière (−1) : la coupure glisse d'ouvert à `derriere`, en proportion des octaves.
  const face = dist > 1e-6 ? d / dist : 1;
  out.coupure = face >= 0 ? OUVERT : OUVERT * (r.derriere / OUVERT) ** -face;
  return out;
}

/** Suivi de la distance au joueur, pour en tirer la vitesse relative sans à-coup (un seul objet, jamais réalloué). */
export interface SuiviApproche {
  dist: number;
  /** Vitesse de fermeture lissée, m/s. */
  vitesse: number;
}

/**
 * Met à jour le suivi avec la distance `dist` mesurée `dt` secondes après la précédente, et rend la vitesse de
 * fermeture lissée (filtre du premier ordre, constante `lissage`). Un trou de mesure (premier appel, pause, `dt`
 * nul ou de plus d'une demi-seconde) repart de zéro plutôt que de produire un saut.
 */
export function suivreApproche(suivi: SuiviApproche, dist: number, dt: number, lissage: number): number {
  if (!(dt > 0 && dt <= 0.5) || !Number.isFinite(suivi.dist) || !Number.isFinite(dist)) {
    suivi.dist = dist;
    suivi.vitesse = 0;
    return 0;
  }
  suivi.vitesse += ((suivi.dist - dist) / dt - suivi.vitesse) * (1 - Math.exp(-dt / Math.max(lissage, 1e-3)));
  suivi.dist = dist;
  return suivi.vitesse;
}

/** Branche le moteur de l'adversaire ; `maj` est relu dix fois par seconde avec le son de la sortie (src/drive/son.ts). */
export function brancherSonAdversaire(audio: () => { ctx: AudioContext; sortie: AudioNode } | null = () => useEngineSound.getState().audio(), reglage: ReglageSon = SON_ADVERSAIRE) {
  let lecteur: EngineSoundPlayer | null = null;
  let famille: string | null = null;
  let tente = false;
  const place: PlaceSon = { gain: 0, pan: 0, coupure: OUVERT, hauteur: 1 };
  const suivi: SuiviApproche = { dist: Number.NaN, vitesse: 0 };
  let dernier = 0;
  const couper = () => {
    lecteur?.dispose();
    lecteur = null;
    famille = null;
    tente = false;
    suivi.dist = Number.NaN;
    suivi.vitesse = 0;
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
      const d = devant(joueur.motion.s, pilot.motion.s, pilot.rail.length, pilot.rail.loop);
      const l = duel.offset - joueur.motion.offset;
      const maintenant = performance.now() / 1000;
      const fermeture = suivreApproche(suivi, Math.hypot(d, l), maintenant - dernier, reglage.lissage);
      dernier = maintenant;
      placerSon(d, l, reglage, place, fermeture);
      lecteur.setLevel(place.gain * Math.max(0, niveau), 0.1);
      lecteur.placer(place.pan, place.coupure, 0.1);
      lecteur.setPitch(place.hauteur);
    },
    couper,
  };
}
