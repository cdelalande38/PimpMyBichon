// Règles du son du moteur en sortie de nuit (§ 5.5, § 9) : quand il tourne, quelle charge on lui
// donne, à quel volume il passe sous la radio. Fonctions pures, testées par
// tests/unit/drive-son-mixage.test.ts ; le branchement est dans src/drive/son.ts.

import type { DriveInput } from './contrat.ts';
import { PILOT } from './pilote.ts';

/** Ce que l'écran de sortie montre du moteur (attribut data-moteur du bouton « Moteur »). */
export type EtatSonSortie = 'sans-son' | 'muet' | 'attente' | 'coupe' | 'demarre' | 'tourne';

export interface ConditionsSon {
  /** Une sortie est en cours (carte posée). */
  enSortie: boolean;
  /** La scène est prête (première image rendue). */
  prete: boolean;
  echec: boolean;
  /** Bout du parcours atteint. */
  finie: boolean;
  pause: boolean;
  /** Le joueur veut entendre le moteur (bouton « Moteur », gardé d'une sortie à l'autre). */
  voulu: boolean;
  /** Un geste a eu lieu dans la page : le navigateur laisse jouer le son. */
  geste: boolean;
  /** Le véhicule a des sons (sa famille a été fabriquée). */
  sons: boolean;
}

/** Le moteur doit-il tourner ? Coupé net à la fin du parcours, en pause, au retour au garage. */
export function moteurVoulu(c: ConditionsSon): boolean {
  return c.enSortie && c.prete && !c.echec && !c.finie && !c.pause && c.voulu && c.geste && c.sons;
}

/** État affiché, d'après les conditions et l'état du lecteur (src/audio/engine/lecteur.ts). */
export function etatAffiche(c: ConditionsSon, lecteur: 'coupe' | 'demarrage' | 'ralenti' | 'charge' | 'coupure'): EtatSonSortie {
  if (!c.sons) return 'sans-son';
  if (!c.voulu) return 'muet';
  if (!c.geste) return 'attente';
  if (lecteur === 'demarrage') return 'demarre';
  if (lecteur === 'ralenti' || lecteur === 'charge') return 'tourne';
  return 'coupe';
}

const unite = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/** En pilote automatique, une décélération plus forte que celle-ci (m/s²) se joue pied levé, au frein. */
export const DECELERATION_FREIN = -0.6;
/** Charge d'une croisière stable, en pilote automatique. */
export const CHARGE_CROISIERE = 0.3;
/** Charge d'une reprise franche du pilote automatique (il conduit en souplesse, jamais à fond). */
export const CHARGE_PILOTE_MAX = 0.8;

/**
 * Charge du moteur : à la main, l'accélérateur (relâché au frein) ; en pilote automatique,
 * d'après l'accélération mesurée (croisière : charge légère ; reprise franche : forte charge, pas
 * pleine : le pilote conduit en souplesse).
 */
export function chargeDe(input: Pick<DriveInput, 'auto' | 'throttle' | 'brake'>, accel: number): { charge: number; frein: boolean } {
  if (!input.auto) return input.brake > 0 ? { charge: 0, frein: true } : { charge: unite(input.throttle), frein: false };
  const a = Number.isFinite(accel) ? accel : 0;
  if (a <= DECELERATION_FREIN) return { charge: 0, frein: true };
  if (a < 0) return { charge: CHARGE_CROISIERE * (1 - a / DECELERATION_FREIN), frein: false };
  return { charge: Math.min(CHARGE_PILOTE_MAX, CHARGE_CROISIERE + ((CHARGE_PILOTE_MAX - CHARGE_CROISIERE) * a) / PILOT.accel), frein: false };
}

/** Constante de temps du lissage de l'accélération mesurée, en secondes. */
const TAU_ACCEL = 0.4;

/**
 * Accélération lissée, en m/s², d'après deux vitesses publiées (km/h entiers, quatre fois par
 * seconde) : la mesure brute saute d'un kilomètre-heure à l'autre, on la lisse.
 */
export function lisserAccel(precedente: number, vitesseAvantKmh: number, vitesseKmh: number, dt: number): number {
  if (!(dt > 0)) return precedente;
  const mesure = (vitesseKmh - vitesseAvantKmh) / 3.6 / dt;
  const k = 1 - Math.exp(-dt / TAU_ACCEL);
  return precedente + (mesure - precedente) * k;
}

/** Réglages du joueur (panneau « Son », src/state/mixage.ts), en pour cent de 0 à 100. */
export interface ReglagesMixage {
  /** Part du volume de l'autoradio gardée quand la sortie roule moteur voulu. */
  radio: number;
  /** Niveau du moteur. */
  moteur: number;
  /** Niveau des bruitages de route (roulement, vent, pluie, freinage, rapports…). */
  route: number;
}

/** Valeurs d'origine : la radio derrière (45 %), le moteur à plein, la route devant la radio. */
export const MIXAGE_ORIGINE: Readonly<ReglagesMixage> = Object.freeze({ radio: 45, moteur: 100, route: 70 });

/** Rampe de la baisse de la radio, à l'aller comme au retour, en secondes. */
export const RAMPE_RADIO = 0.4;
/** Au ralenti d'image : le moteur et la route baissent (sans changer de hauteur). */
export const NIVEAU_RALENTI_IMAGE = 0.35;

/** Le mélange appliqué, de 0 à 1 pour chacun. */
export interface Melange {
  /** Facteur multiplié au volume de l'autoradio (1 : la radio à son volume). */
  radio: number;
  /** Volume d'ensemble du moteur. */
  moteur: number;
  /** Volume d'ensemble des bruitages de route. */
  route: number;
}

const pourCent = (value: number) => unite(value / 100);

/**
 * Mélange de la sortie (§ 5.5 « Son ») : quand elle roule moteur voulu (`roule`, voir
 * `moteurVoulu`), le moteur et la route sont devant, la radio derrière, baissée au réglage
 * « Radio » ; en pause, au bout du parcours et au garage, la radio reprend son volume. Le curseur
 * de l'autoradio n'est pas touché : la baisse s'y multiplie. Au ralenti d'image, moteur et route
 * baissent.
 */
export function melangeSortie(o: { roule: boolean; ralentiImage: boolean; reglages: ReglagesMixage }): Melange {
  const ralenti = o.ralentiImage ? NIVEAU_RALENTI_IMAGE : 1;
  return {
    radio: o.roule ? pourCent(o.reglages.radio) : 1,
    moteur: pourCent(o.reglages.moteur) * ralenti,
    route: pourCent(o.reglages.route) * ralenti,
  };
}
