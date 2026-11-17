// Règles des bruitages de route (fonctions pures, testées par tests/unit/sons-bruitages.test.ts) :
// niveau, hauteur et filtre de chaque boucle selon la vitesse, la météo locale et la voûte (ou la glisse
// des pneus, ou le patinage des roues motrices : `glisseBrute`) ; départ
// des bruitages ponctuels sur un front (freinage fort, passage de rapport, lever de pied à haut
// régime). Les données sont dans src/data/bruitages.ts ; le lecteur dans ./route.ts. Aucune
// allocation : tout s'écrit dans des objets donnés par l'appelant.

import { ESTIMATION_GLISSE, type BoucleRoute, type Declencheur, type Glisse, type PonctuelRoute } from '../../data/bruitages.ts';

/** Ce que les boucles écoutent, relu dix fois par seconde. */
export interface EtatRoute {
  vitesseKmh: number;
  /** Pluie qui tombe là où roule le véhicule, de 0 à 1 (0 sous la voûte). */
  pluie: number;
  /** Neige qui tombe là où roule le véhicule, de 0 à 1. */
  neige: number;
  /** Chaussée mouillée, de 0 à 1 (elle sèche sous un tunnel). */
  mouille: number;
  /** Sous la voûte d'un tunnel, de 0 à 1. */
  abri: number;
  /** Poussée du NOS en cours. */
  nos: boolean;
  /**
   * Glisse brute des pneus, de 0 (ils tiennent) à 1 (ils glissent franchement) : `DriveMotion.slip`
   * du pilote, ou `glisseMesuree` à défaut. Absente : 0. Le lecteur la fait passer par `suivreGlisse`.
   */
  glisse?: number;
  /**
   * Patinage des roues motrices, de 0 à 1 : `DriveMotion.spin` du pilote. Absent : 0. Pilote les boucles
   * de glisse dont la source est « patinage » (`burnout`).
   */
  patinage?: number;
}

/** Un instant du moteur et du véhicule, pour les déclencheurs (deux instants : avant, maintenant). */
export interface InstantRoute {
  vitesseKmh: number;
  /** Accélération, en m/s² ; négative au freinage. */
  accel: number;
  /** Passage de rapport en cours. */
  shifting: boolean;
  /** Charge du moteur, de 0 à 1. */
  charge: number;
  /** Régime rapporté au rupteur, de 0 à 1. */
  regime: number;
  /** Poussée du NOS en cours (le lecteur la tire de `EtatRoute.nos`). */
  nos?: boolean;
  /** Feux rouges allumés du départ arrêté (le lecteur les tire de src/audio/sfx/feux.ts). */
  feuxRouges?: number;
  /** Feu vert du départ allumé. */
  vert?: boolean;
}

/** Au-dessus de cette coupure (Hz), le filtre d'une boucle est grand ouvert. */
export const COUPURE_OUVERTE = 20000;
/** Lever de pied : charge d'avant au moins, charge de maintenant au plus. */
export const LEVE_PIED = { avant: 0.5, apres: 0.15 } as const;

const unite = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/** Part de la vitesse jusqu'à la référence de la boucle (0 sous le seuil, 1 à la référence et au-delà). */
function partVitesse(b: BoucleRoute, vitesseKmh: number): number {
  if (!b.vitesse) return 1;
  const { seuil, ref } = b.vitesse;
  return unite((vitesseKmh - seuil) / Math.max(1, ref - seuil));
}

/** Chaussée mouillée qui compte pour le roulement : sous la neige, on roule « sec », étouffé. */
function mouilleRoulement(e: EtatRoute): number {
  return unite(e.mouille) * (1 - unite(e.neige));
}

/** Grandeur brute qui pilote une boucle de glisse : la glisse des pneus, ou le patinage (`Glisse.source`). */
export function glisseBrute(b: BoucleRoute, e: EtatRoute): number {
  return (b.glisse?.source === 'patinage' ? e.patinage : e.glisse) ?? 0;
}

/**
 * Niveau visé d'une boucle, de 0 à 1 (avant le curseur « Route »). `glisse` : la glisse déjà suivie
 * (hystérésis et rampes de `suivreGlisse`) pour une boucle de glisse ; par défaut, la grandeur brute.
 */
export function niveauBoucle(b: BoucleRoute, e: EtatRoute, glisse: number = glisseBrute(b, e)): number {
  let n = b.niveau;
  if (b.glisse) n *= unite(glisse);
  if (b.vitesse) n *= partVitesse(b, e.vitesseKmh) ** b.vitesse.puissance;
  if (b.meteo === 'sec') n *= 1 - mouilleRoulement(e);
  else if (b.meteo === 'mouille') n *= mouilleRoulement(e);
  else if (b.meteo === 'pluie') n *= unite(e.pluie);
  if (b.neige) n *= 1 + (b.neige.niveau - 1) * unite(e.neige);
  if (b.mouille) n *= 1 + (b.mouille.niveau - 1) * mouilleRoulement(e);
  if (b.abri === 'dehors') n *= 1 - unite(e.abri);
  else if (b.abri === 'dessous') n *= unite(e.abri);
  if (b.nos && !e.nos) n = 0;
  return unite(n);
}

/** Hauteur (vitesse de lecture) d'une boucle : elle monte avec la vitesse (ou, si elle glisse, avec la glisse). */
export function hauteurBoucle(b: BoucleRoute, e: EtatRoute, glisse: number = glisseBrute(b, e)): number {
  if (b.glisse) {
    const [bas, haut] = b.glisse.hauteur;
    return bas + (haut - bas) * unite(glisse);
  }
  if (!b.hauteur) return 1;
  const [bas, haut] = b.hauteur;
  return bas + (haut - bas) * partVitesse(b, e.vitesseKmh);
}

/** Coupure du filtre passe-bas d'une boucle, en Hz : étouffée sous la neige, sourde sur le mouillé. */
export function coupureBoucle(b: BoucleRoute, e: EtatRoute): number {
  // Interpolation géométrique : l'oreille entend les octaves.
  let coupure = COUPURE_OUVERTE;
  if (b.neige) coupure = Math.min(coupure, COUPURE_OUVERTE * (b.neige.coupure / COUPURE_OUVERTE) ** unite(e.neige));
  if (b.mouille) coupure = Math.min(coupure, COUPURE_OUVERTE * (b.mouille.coupure / COUPURE_OUVERTE) ** mouilleRoulement(e));
  return coupure;
}

/** Ce que la boucle de glisse retient d'un instant à l'autre (une par voix, réécrit sur place). */
export interface SuiviGlisse {
  /** Allumée (au-dessus du seuil, jusqu'à retomber sous `seuil - hysteresis`). */
  actif: boolean;
  /** Niveau suivi, de 0 à 1 : ce qui règle le niveau et la hauteur de la boucle. */
  valeur: number;
}

/** Un suivi au repos : éteint, muet. */
export function suiviGlisseRepos(): SuiviGlisse {
  return { actif: false, valeur: 0 };
}

/**
 * Avance le suivi de la glisse de `dt` secondes d'après la glisse brute et la vitesse, et rend le
 * niveau suivi (de 0 à 1). Hystérésis : allumé au-dessus de `seuil`, éteint au-dessous de
 * `seuil - hysteresis` ; sous `vitesseMin`, éteint. Le niveau cible monte de 0 à 1 entre `seuil -
 * hysteresis` et la glisse pleine, puis suit en attaque (montée) et relâchement (descente) doux.
 */
export function suivreGlisse(suivi: SuiviGlisse, brute: number, vitesseKmh: number, dt: number, g: Glisse): number {
  const glisse = unite(brute);
  const bas = Math.max(0, g.seuil - g.hysteresis);
  if (!(vitesseKmh >= g.vitesseMin)) suivi.actif = false;
  else if (suivi.actif) suivi.actif = glisse >= bas;
  else suivi.actif = glisse >= g.seuil;
  const cible = suivi.actif ? unite((glisse - bas) / Math.max(0.01, 1 - bas)) : 0;
  const tau = cible > suivi.valeur ? g.attaque : g.relache;
  const pas = Number.isFinite(dt) && dt > 0 ? 1 - Math.exp(-dt / Math.max(0.001, tau)) : 0;
  suivi.valeur = unite(suivi.valeur + (cible - suivi.valeur) * pas);
  return suivi.valeur;
}

/** Ce que le pilote dit des pneus, pour `glisseMesuree` (rien d'autre n'est lu du pilote). */
export interface MesureGlisse {
  /** `DriveMotion.slip`, s'il est publié. */
  slip?: number;
  /** Vitesse, en m/s. */
  vitesse: number;
  /** Braquage des roues avant, en radians (`DriveMotion.steer`). */
  braquage?: number;
  /** Adhérence du véhicule, en m/s² (`performance.grip`). */
  grip?: number;
  /** Genre du véhicule (choisit l'empattement). */
  genre: 'car' | 'bike';
}

/**
 * Glisse brute, de 0 à 1 : celle que le pilote publie (`slip`) ; à défaut, estimée : accélération
 * latérale (vitesse² × tan(braquage) ÷ empattement) rapportée à l'adhérence, nulle sous une marge.
 */
export function glisseMesuree(m: MesureGlisse): number {
  if (typeof m.slip === 'number' && Number.isFinite(m.slip)) return unite(m.slip);
  if (typeof m.braquage !== 'number' || !Number.isFinite(m.braquage) || !Number.isFinite(m.vitesse)) return 0;
  const E = ESTIMATION_GLISSE;
  const lateral = (m.vitesse * m.vitesse * Math.abs(Math.tan(m.braquage))) / E.empattement[m.genre];
  const grip = typeof m.grip === 'number' && Number.isFinite(m.grip) ? Math.max(1, m.grip) : E.gripDefaut;
  return unite((lateral / grip - E.marge) / E.plage);
}

/**
 * Un déclencheur part-il entre `avant` et `maintenant` ? Un front seulement (on ne rejoue pas tant
 * que la condition tient). `alea` : tirage uniforme de 0 à 1 (le retour de flamme est rare).
 */
export function declenche(d: Declencheur, avant: InstantRoute, maintenant: InstantRoute, alea: number): boolean {
  switch (d.type) {
    case 'freinage': {
      const fort = (i: InstantRoute) => -i.accel >= d.deceleration && i.vitesseKmh >= d.vitesseMin;
      return fort(maintenant) && !fort(avant);
    }
    case 'rapport':
      return maintenant.shifting && !avant.shifting;
    case 'nos':
      return maintenant.nos === true && avant.nos !== true;
    case 'feu-rouge':
      return (maintenant.feuxRouges ?? 0) > (avant.feuxRouges ?? 0) && maintenant.vert !== true;
    case 'feu-vert':
      return maintenant.vert === true && avant.vert !== true;
    case 'leve-pied':
      return avant.charge >= LEVE_PIED.avant && maintenant.charge <= LEVE_PIED.apres && avant.regime >= d.regimeMin && alea < d.chance;
  }
}

/** Un ponctuel part-il : déclencheur franchi et délai minimal écoulé depuis son dernier départ (s). */
export function ponctuelPart(p: PonctuelRoute, avant: InstantRoute, maintenant: InstantRoute, depuis: number, alea: number): boolean {
  return depuis >= p.attente && declenche(p.declencheur, avant, maintenant, alea);
}

/** Copie un instant dans un autre (sans allocation). */
export function copierInstant(de: InstantRoute, vers: InstantRoute): void {
  vers.vitesseKmh = de.vitesseKmh;
  vers.accel = de.accel;
  vers.shifting = de.shifting;
  vers.charge = de.charge;
  vers.regime = de.regime;
  vers.nos = de.nos;
  vers.feuxRouges = de.feuxRouges;
  vers.vert = de.vert;
}
