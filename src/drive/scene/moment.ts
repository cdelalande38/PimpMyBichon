// Le moment de la sortie (nuit ou jour, src/data/moments.ts) mis en nombres : chaque réglage des six
// looks (deux moments × trois météos) est converti une fois en couleurs linéaires et en vecteurs, puis
// mêlé à chaque image selon la météo du ciel (parts de sec, de pluie et de neige) et le passage d'un
// moment à l'autre, dans un état réécrit sur place (aucune allocation par image). La nuit seule
// (passage à 0, une seule météo) redonne exactement ses valeurs : poids 1 et 0, sans arrondi.

import { Color, Vector3 } from 'three';
import { LOOKS, MATIERES_DU_JOUR, type Look, type MatiereDuJour } from '../../data/moments.ts';
import type { Weather } from '../contrat.ts';

const METEOS: readonly Weather[] = ['sec', 'pluie', 'neige'];

/** Un look en nombres (couleurs linéaires, directions unitaires). */
export interface MomentEtat {
  zenith: Color;
  milieu: Color;
  horizon: Color;
  lueur: Color;
  lueurDirection: Vector3;
  etoiles: number;
  nuages: number;
  teinteNuages: Color;
  jour: number;
  astreDirection: Vector3;
  astre: Color;
  astreIntensite: number;
  astreCiel: Color;
  disque: number;
  ambianceCiel: Color;
  ambianceSol: Color;
  ambianceIntensite: number;
  refletHorizon: Color;
  refletZenith: Color;
  brouillard: Color;
  brouillardDensite: number;
  brume: Color;
  brumeDensite: number;
  voile: Color;
  voileMin: number;
  phares: number;
  lampadaires: number;
  neons: number;
  fenetres: number;
  bandeSonde: number;
  ombre: number;
  ombreNette: number;
  matieres: Record<MatiereDuJour, Color>;
}

type Champ = Exclude<keyof MomentEtat, 'matieres'>;
const COULEURS = ['zenith', 'milieu', 'horizon', 'lueur', 'teinteNuages', 'astre', 'astreCiel', 'ambianceCiel', 'ambianceSol', 'refletHorizon', 'refletZenith', 'brouillard', 'brume', 'voile'] as const satisfies readonly Champ[];
const DIRECTIONS = ['lueurDirection', 'astreDirection'] as const satisfies readonly Champ[];
const NOMBRES = ['etoiles', 'nuages', 'jour', 'astreIntensite', 'disque', 'ambianceIntensite', 'brouillardDensite', 'brumeDensite', 'voileMin', 'phares', 'lampadaires', 'neons', 'fenetres', 'bandeSonde', 'ombre', 'ombreNette'] as const satisfies readonly Champ[];

function vide(): MomentEtat {
  const matieres = {} as Record<MatiereDuJour, Color>;
  for (const m of MATIERES_DU_JOUR) matieres[m] = new Color();
  const etat = { matieres } as MomentEtat;
  for (const k of COULEURS) etat[k] = new Color();
  for (const k of DIRECTIONS) etat[k] = new Vector3();
  for (const k of NOMBRES) etat[k] = 0;
  return etat;
}

/** Un look en nombres ; `nuit` donne la teinte des matières absentes du look (celle de nuit). */
export function resoudre(look: Look, nuit: Readonly<Record<MatiereDuJour, Color | string>>): MomentEtat {
  const e = vide();
  e.zenith.set(look.ciel.zenith);
  e.milieu.set(look.ciel.milieu);
  e.horizon.set(look.ciel.horizon);
  e.lueur.set(look.ciel.lueur);
  e.lueurDirection.set(...look.ciel.lueurDirection).normalize();
  e.etoiles = look.ciel.etoiles;
  e.nuages = look.ciel.nuages;
  e.teinteNuages.set(look.ciel.teinteNuages);
  e.jour = look.ciel.jour;
  e.astreDirection.set(...look.astre.direction).normalize();
  e.astre.set(look.astre.couleur);
  e.astreIntensite = look.astre.intensite;
  e.astreCiel.set(look.astre.teinteCiel);
  e.disque = look.astre.disque;
  e.ambianceCiel.set(look.ambiance.ciel);
  e.ambianceSol.set(look.ambiance.sol);
  e.ambianceIntensite = look.ambiance.intensite;
  e.refletHorizon.set(look.reflet.horizon);
  e.refletZenith.set(look.reflet.zenith);
  e.brouillard.set(look.brouillard.couleur);
  e.brouillardDensite = look.brouillard.densite;
  e.brume.set(look.brume.couleur);
  e.brumeDensite = look.brume.densite;
  e.voile.set(look.lointain.voile).multiplyScalar(look.lointain.voileForce);
  e.voileMin = look.lointain.voileMin;
  e.phares = look.phares;
  e.lampadaires = look.lampadaires;
  e.neons = look.neons;
  e.fenetres = look.fenetres;
  e.bandeSonde = look.bandeSonde;
  e.ombre = look.ombre;
  e.ombreNette = look.ombreNette;
  for (const m of MATIERES_DU_JOUR) e.matieres[m].set(look.matieres[m] ?? nuit[m]);
  return e;
}

/**
 * Les six looks en nombres et l'état mêlé. `melanger(jour, pluie, neige)` : `jour` de 0 (nuit) à 1,
 * parts de pluie et de neige du ciel (le reste est du sec).
 */
export class MomentMelange {
  readonly etat = vide();
  private readonly looks: MomentEtat[] = [];
  private readonly poids = new Float32Array(6);
  private cle = [Number.NaN, Number.NaN, Number.NaN];

  constructor(nuit: Readonly<Record<MatiereDuJour, Color | string>>) {
    for (const moment of ['nuit', 'jour'] as const) for (const meteo of METEOS) this.looks.push(resoudre(LOOKS[moment][meteo], nuit));
  }

  /** Vrai si l'état a changé (rien n'est recalculé quand le moment et la météo sont posés). */
  melanger(jour: number, pluie: number, neige: number): boolean {
    const c = this.cle;
    if (c[0] === jour && c[1] === pluie && c[2] === neige) return false;
    c[0] = jour;
    c[1] = pluie;
    c[2] = neige;
    const sec = Math.max(0, 1 - pluie - neige);
    const w = this.poids;
    w[0] = (1 - jour) * sec;
    w[1] = (1 - jour) * pluie;
    w[2] = (1 - jour) * neige;
    w[3] = jour * sec;
    w[4] = jour * pluie;
    w[5] = jour * neige;
    const e = this.etat;
    for (const k of COULEURS) e[k].setRGB(0, 0, 0);
    for (const k of DIRECTIONS) e[k].set(0, 0, 0);
    for (const k of NOMBRES) e[k] = 0;
    for (const m of MATIERES_DU_JOUR) e.matieres[m].setRGB(0, 0, 0);
    for (let i = 0; i < 6; i += 1) {
      const p = w[i] ?? 0;
      if (p === 0) continue;
      const l = this.looks[i] as MomentEtat;
      for (const k of COULEURS) {
        const from = l[k];
        e[k].r += from.r * p;
        e[k].g += from.g * p;
        e[k].b += from.b * p;
      }
      for (const k of DIRECTIONS) e[k].addScaledVector(l[k], p);
      for (const k of NOMBRES) e[k] += l[k] * p;
      for (const m of MATIERES_DU_JOUR) {
        const from = l.matieres[m];
        const to = e.matieres[m];
        to.r += from.r * p;
        to.g += from.g * p;
        to.b += from.b * p;
      }
    }
    for (const k of DIRECTIONS) e[k].normalize();
    return true;
  }
}
