// Règles des bruitages de route (fonctions pures, testées par tests/unit/sons-bruitages.test.ts) :
// niveau, hauteur et filtre de chaque boucle selon la vitesse, la météo locale et la voûte ; départ
// des bruitages ponctuels sur un front (freinage fort, passage de rapport, lever de pied à haut
// régime). Les données sont dans src/data/bruitages.ts ; le lecteur dans ./route.ts. Aucune
// allocation : tout s'écrit dans des objets donnés par l'appelant.

import type { BoucleRoute, Declencheur, PonctuelRoute } from '../../data/bruitages.ts';

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

/** Niveau visé d'une boucle, de 0 à 1 (avant le curseur « Route »). */
export function niveauBoucle(b: BoucleRoute, e: EtatRoute): number {
  let n = b.niveau;
  if (b.vitesse) n *= partVitesse(b, e.vitesseKmh) ** b.vitesse.puissance;
  if (b.meteo === 'sec') n *= 1 - mouilleRoulement(e);
  else if (b.meteo === 'mouille') n *= mouilleRoulement(e);
  else if (b.meteo === 'pluie') n *= unite(e.pluie);
  if (b.neige) n *= 1 + (b.neige.niveau - 1) * unite(e.neige);
  if (b.abri === 'dehors') n *= 1 - unite(e.abri);
  else if (b.abri === 'dessous') n *= unite(e.abri);
  if (b.nos && !e.nos) n = 0;
  return unite(n);
}

/** Hauteur (vitesse de lecture) d'une boucle : elle monte avec la vitesse. */
export function hauteurBoucle(b: BoucleRoute, e: EtatRoute): number {
  if (!b.hauteur) return 1;
  const [bas, haut] = b.hauteur;
  return bas + (haut - bas) * partVitesse(b, e.vitesseKmh);
}

/** Coupure du filtre passe-bas d'une boucle, en Hz : étouffée sous la neige. */
export function coupureBoucle(b: BoucleRoute, e: EtatRoute): number {
  if (!b.neige) return COUPURE_OUVERTE;
  const k = unite(e.neige);
  // Interpolation géométrique : l'oreille entend les octaves.
  return COUPURE_OUVERTE * (b.neige.coupure / COUPURE_OUVERTE) ** k;
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
}
