// L'état du jeu qui se sauvegarde (src/state/jeu.ts) : solde, articles acquis, hauts faits obtenus et
// compteurs cumulés. Pur : aucun accès au navigateur, tout se teste sans lui. Les ensembles sont des
// objets `{ id: true }` : la fusion entre onglets (src/state/persistence.ts) les fusionne clé par clé,
// deux pages qui obtiennent chacune un haut fait différent gardent donc les deux.

import { articleParId } from '../data/boutique.ts';
import { HAUTS_FAITS } from '../data/hautsFaits.ts';

export interface Cumuls {
  courses: number;
  coursesTrois: number;
  /** Mètres. */
  distance: number;
  /** Mètres. */
  glisse: number;
  chocs: number;
  nos: number;
  bronze: number;
  argent: number;
  or: number;
  records: number;
  /** Courses finies sans aucun choc. */
  sansChoc: number;
  pluie: number;
  neige: number;
  jour: number;
  /** Plus haute pointe de vitesse jamais atteinte, en km/h. */
  vitesseMax: number;
  /** Dollars gagnés en course (hors récompenses de hauts faits). */
  gains: number;
  achats: number;
  cartes: Record<string, true>;
  vehicules: Record<string, true>;
}

export interface EtatJeu {
  solde: number;
  /** Articles acquis (achetés ou gagnés). Les articles offerts d'office n'y figurent pas : `possedeDans`. */
  articles: Record<string, true>;
  hautsFaits: Record<string, true>;
  cumuls: Cumuls;
}

export function cumulsVides(): Cumuls {
  return {
    courses: 0,
    coursesTrois: 0,
    distance: 0,
    glisse: 0,
    chocs: 0,
    nos: 0,
    bronze: 0,
    argent: 0,
    or: 0,
    records: 0,
    sansChoc: 0,
    pluie: 0,
    neige: 0,
    jour: 0,
    vitesseMax: 0,
    gains: 0,
    achats: 0,
    cartes: {},
    vehicules: {},
  };
}

export function etatVide(): EtatJeu {
  return { solde: 0, articles: {}, hautsFaits: {}, cumuls: cumulsVides() };
}

const NOMBRE_MAX = 1_000_000_000;
const ENSEMBLE_MAX = 200;
const IDENTIFIANT = /^[A-Za-z0-9_.-]{1,64}$/;

function nombre(valeur: unknown): number {
  return typeof valeur === 'number' && Number.isFinite(valeur) && valeur > 0 ? Math.min(NOMBRE_MAX, valeur) : 0;
}

function entier(valeur: unknown): number {
  return Math.floor(nombre(valeur));
}

function dictionnaire(valeur: unknown): Record<string, unknown> {
  return typeof valeur === 'object' && valeur !== null && !Array.isArray(valeur) ? (valeur as Record<string, unknown>) : {};
}

/** Un ensemble d'identifiants : seuls ceux qu'un « vrai » explicite retient, bornés en nombre et en forme. */
function ensemble(valeur: unknown, connu: (id: string) => boolean = () => true): Record<string, true> {
  const source = dictionnaire(valeur);
  const sortie: Record<string, true> = {};
  let n = 0;
  for (const id of Object.keys(source)) {
    if (n >= ENSEMBLE_MAX) break;
    if (source[id] === true && IDENTIFIANT.test(id) && connu(id) && Object.prototype.hasOwnProperty.call(source, id)) {
      sortie[id] = true;
      n += 1;
    }
  }
  return sortie;
}

/**
 * Lecture tolérante d'une sauvegarde : un nombre abîmé retombe à zéro, un article ou un haut fait retiré
 * des données s'oublie, une sauvegarde illisible donne un état vide. Les cartes et les véhicules courus
 * gardent tout identifiant de forme valide (le catalogue peut changer sans effacer l'histoire).
 */
export function nettoyerEtat(brut: unknown): EtatJeu {
  const source = dictionnaire(brut);
  const c = dictionnaire(source.cumuls);
  const cumuls: Cumuls = {
    courses: entier(c.courses),
    coursesTrois: entier(c.coursesTrois),
    distance: nombre(c.distance),
    glisse: nombre(c.glisse),
    chocs: entier(c.chocs),
    nos: entier(c.nos),
    bronze: entier(c.bronze),
    argent: entier(c.argent),
    or: entier(c.or),
    records: entier(c.records),
    sansChoc: entier(c.sansChoc),
    pluie: entier(c.pluie),
    neige: entier(c.neige),
    jour: entier(c.jour),
    vitesseMax: nombre(c.vitesseMax),
    gains: entier(c.gains),
    achats: entier(c.achats),
    cartes: ensemble(c.cartes),
    vehicules: ensemble(c.vehicules),
  };
  return {
    solde: entier(source.solde),
    articles: ensemble(source.articles, (id) => articleParId(id) !== undefined),
    hautsFaits: ensemble(source.hautsFaits, (id) => HAUTS_FAITS.some((fait) => fait.id === id)),
    cumuls,
  };
}
