// Formats de la sortie et temps de référence des courses (cahier des charges § 5.5, jeu ; demande du
// 17 novembre 2026 : « des courses en 1 tour et en 3 tours ; à la fin, les résultats, les gains et ce
// qu'on a débloqué »).
//
// - La balade : la conduite d'avant, inchangée (feux, chrono, arrivée au bout d'une route ouverte, tours
//   sans fin sur une boucle), sans gain.
// - La course en 1 tour : sur une boucle, un tour depuis la ligne du départ choisi ; sur une route
//   ouverte, un passage du départ à l'arrivée (le bout de la route).
// - La course en 3 tours : sur une boucle seulement (`MapRoute.loop`) ; ailleurs, grisée, avec une phrase.
//
// Temps de référence : simulés par `npm run courses:temps` (tools/courses/temps-reference.mjs,
// src/drive/simulationCourse.ts), au sec, depuis l'arrêt sur la ligne, sur chaque départ de chaque carte,
// pour chaque véhicule du catalogue, par deux conduites : le pilote automatique, et une conduite à la main
// appliquée (direction assistée, plein gaz, freinage au dernier moment avant chaque virage, sans NOS).
// Résultat versionné dans public/assets/maps/<id>/courses.json, lu ici au build. Sans ce fichier (carte
// nouvelle, outil pas relancé), la course se court, sans médaille.
//
// Médailles : le pilote automatique est un conducteur de balade (src/drive/pilote.ts, PILOT : 50 km/h en
// agglomération, 80 à 90 km/h ailleurs, 60 % du moteur, 3,2 m/s² en courbe, 2 m/s² au freinage prévu,
// jamais de NOS). Mesuré le 18 novembre 2026 : la conduite à la main appliquée met de 0,5 à 0,7 fois son
// temps. Un seul coefficient sur le pilote automatique rendrait l'or facile avec un véhicule et
// introuvable avec un autre : les seuils se prennent donc sur la conduite qui leur ressemble.
// - Bronze : le temps du pilote automatique (× 1,00). Il roule sans jamais toucher un bord ni glisser :
//   le battre, c'est finir proprement, sans s'arrêter dans les murs.
// - Argent : la conduite à la main appliquée × 1,25 : rouler franchement, avec quelques fautes.
// - Or : la conduite à la main appliquée × 1,08 : freiner tard, passer les virages au bord de
//   l'adhérence, presque sans faute ; le NOS rattrape une petite erreur. En direction libre (le réglage
//   d'origine), il faut en plus tenir sa trajectoire au manche.
// Météo : l'adhérence baisse sous la pluie et sur la neige (src/data/adherence.ts) ; les seuils
// s'allongent de l'écart que l'outil mesure sur la carte (`ecartsMeteo` de courses.json : le plus grand
// des deux conduites), sinon de `INDULGENCE_METEO`.

import type { FormatCourse, FormatSpec, Medaille, MeteoCourse } from '../jeu/contrat.ts';

export const FORMATS: readonly FormatSpec[] = [
  { id: 'balade', label: 'Balade', tours: null, boucleSeulement: false },
  { id: 'tour1', label: 'Course 1 tour', tours: 1, boucleSeulement: false },
  { id: 'tours3', label: 'Course 3 tours', tours: 3, boucleSeulement: true },
];

/** Petite ligne sous chaque format, au menu. */
export const AIDES_FORMAT: Readonly<Record<FormatCourse, string>> = {
  balade: 'Sans chrono à battre',
  tour1: 'Contre la montre',
  tours3: 'Trois tours de circuit',
};

/** Phrase du format grisé sur une route ouverte. */
export const PHRASE_SANS_BOUCLE = 'Trois tours, c’est sur un circuit : cette route a un début et une fin.';

export const FORMAT_PAR_DEFAUT: FormatCourse = 'balade';

/** Tours au plus d'une course (taille des relevés de tours, sans allocation pendant la course). */
export const TOURS_MAX = 8;

export function formatSpec(id: FormatCourse): FormatSpec {
  return FORMATS.find((item) => item.id === id) ?? (FORMATS[0] as FormatSpec);
}

export function estFormat(value: unknown): value is FormatCourse {
  return FORMATS.some((item) => item.id === value);
}

/** Le format se court-il sur ce parcours ? (3 tours : boucle seulement.) */
export function formatPossible(id: FormatCourse, boucle: boolean): boolean {
  return boucle || !formatSpec(id).boucleSeulement;
}

/**
 * Format couru pour le choix gardé sur ce parcours : le choix lui-même s'il s'y court, sinon la course
 * en 1 tour (le choix gardé ne change pas : il revient sur un circuit).
 */
export function formatCouru(id: FormatCourse, boucle: boolean): FormatCourse {
  if (formatPossible(id, boucle)) return id;
  return FORMATS.find((item) => item.tours !== null && !item.boucleSeulement)?.id ?? FORMAT_PAR_DEFAUT;
}

/** Tours à courir : 0 pour la balade (pas de fin de course). */
export function toursDuFormat(id: FormatCourse): number {
  return Math.min(TOURS_MAX, Math.max(0, formatSpec(id).tours ?? 0));
}

/** Base et coefficient de chaque médaille, de la plus haute à la plus basse. */
export const MEDAILLES: readonly { id: Medaille; label: string; base: 'auto' | 'main'; coefficient: number }[] = [
  { id: 'or', label: 'Or', base: 'main', coefficient: 1.08 },
  { id: 'argent', label: 'Argent', base: 'main', coefficient: 1.25 },
  { id: 'bronze', label: 'Bronze', base: 'auto', coefficient: 1 },
];

/** Écart d'une médaille à la suivante, au moins (le bronze reste au-dessus de l'argent). */
const ECART_MIN = 1.05;

/** Seuils allongés selon la météo quand la carte n'a pas d'écart mesuré ; au sec, rien. */
export const INDULGENCE_METEO: Readonly<Record<MeteoCourse, number>> = { sec: 1, pluie: 1.2, neige: 1.6 };

/** Temps d'un départ, d'un format et d'un véhicule, en secondes, au sec. */
export interface Temps {
  /** Pilote automatique. */
  auto: number;
  /** Conduite à la main appliquée, simulée. */
  main: number;
}

/** Temps d'un départ et d'un format dans courses.json : la médiane du catalogue, et par véhicule. */
export interface TempsReference extends Temps {
  vehicules: Readonly<Record<string, Temps>>;
}

/** public/assets/maps/<id>/courses.json, écrit par l'outil. */
export interface FichierCourses {
  format: 'pmb-courses';
  version: 1;
  meteo: 'sec';
  /** Par départ (MapStart.id), puis par format couru. */
  departs: Readonly<Record<string, Partial<Record<Exclude<FormatCourse, 'balade'>, TempsReference>>>>;
  /** Écart mesuré selon la météo (le plus grand des deux conduites, temps ÷ temps au sec). */
  ecartsMeteo?: Partial<Record<MeteoCourse, number>>;
}

const positif = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

function lireTemps(raw: unknown): Temps | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const t = raw as Record<string, unknown>;
  return positif(t.auto) && positif(t.main) ? { auto: t.auto, main: t.main } : null;
}

/** Lecture tolérante d'un courses.json : ce qui est mal formé est écarté (pas de médaille, la course se court). */
export function lireFichierCourses(raw: unknown): FichierCourses | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  if (source.format !== 'pmb-courses' || source.version !== 1) return null;
  const departs: Record<string, Partial<Record<Exclude<FormatCourse, 'balade'>, TempsReference>>> = {};
  const brut = typeof source.departs === 'object' && source.departs !== null ? (source.departs as Record<string, unknown>) : {};
  for (const [depart, parFormat] of Object.entries(brut)) {
    if (typeof parFormat !== 'object' || parFormat === null) continue;
    const out: Partial<Record<Exclude<FormatCourse, 'balade'>, TempsReference>> = {};
    for (const format of ['tour1', 'tours3'] as const) {
      const raw = (parFormat as Record<string, unknown>)[format];
      const t = lireTemps(raw);
      if (!t) continue;
      const vehicules: Record<string, Temps> = {};
      const v = (raw as Record<string, unknown>).vehicules;
      if (typeof v === 'object' && v !== null) {
        for (const [id, value] of Object.entries(v as Record<string, unknown>)) {
          const tv = lireTemps(value);
          if (tv) vehicules[id] = tv;
        }
      }
      out[format] = { ...t, vehicules };
    }
    departs[depart] = out;
  }
  const ecarts: Partial<Record<MeteoCourse, number>> = {};
  if (typeof source.ecartsMeteo === 'object' && source.ecartsMeteo !== null) {
    for (const [meteo, value] of Object.entries(source.ecartsMeteo as Record<string, unknown>)) {
      if ((meteo === 'pluie' || meteo === 'neige') && positif(value) && value >= 1 && value < 4) ecarts[meteo] = value;
    }
  }
  return { format: 'pmb-courses', version: 1, meteo: 'sec', departs, ...(Object.keys(ecarts).length > 0 ? { ecartsMeteo: ecarts } : {}) };
}

const FICHIERS = import.meta.glob<unknown>('../../public/assets/maps/*/courses.json', { eager: true, import: 'default' });

/** Temps de référence par carte (dossier de la carte), lus au build. */
export const REFERENCES: Readonly<Record<string, FichierCourses>> = Object.fromEntries(
  Object.entries(FICHIERS)
    .map(([path, raw]) => [path.split('/').slice(-2)[0] ?? '', lireFichierCourses(raw)] as const)
    .filter((entry): entry is readonly [string, FichierCourses] => entry[0] !== '' && entry[1] !== null),
);

/**
 * Temps de référence (s, au sec) d'un départ et d'un format : ceux du véhicule s'il a été simulé, sinon
 * la médiane du catalogue ; `null` sans référence (pas de médaille).
 */
export function tempsReference(carte: string, depart: string, format: FormatCourse, vehicule?: string, references: Readonly<Record<string, FichierCourses>> = REFERENCES): Temps | null {
  if (format === 'balade') return null;
  const t = references[carte]?.departs[depart]?.[format];
  if (!t) return null;
  const v = vehicule ? t.vehicules[vehicule] : undefined;
  return v ?? { auto: t.auto, main: t.main };
}

/** Allongement des seuils pour la météo sur cette carte. */
export function indulgence(carte: string, meteo: MeteoCourse, references: Readonly<Record<string, FichierCourses>> = REFERENCES): number {
  if (meteo === 'sec') return 1;
  return references[carte]?.ecartsMeteo?.[meteo] ?? INDULGENCE_METEO[meteo] ?? 1;
}

export type SeuilsMedailles = Readonly<Record<Medaille, number>>;

/** Seuils des médailles (s), de l'or au bronze, chacun au moins `ECART_MIN` fois le précédent. */
export function seuilsMedailles(reference: Temps, allongement = 1): SeuilsMedailles {
  const k = Number.isFinite(allongement) && allongement >= 1 ? allongement : 1;
  const out: Record<Medaille, number> = { or: 0, argent: 0, bronze: 0 };
  let avant = 0;
  for (const item of MEDAILLES) {
    const seuil = Math.max(reference[item.base] * item.coefficient * k, avant * ECART_MIN);
    out[item.id] = seuil;
    avant = seuil;
  }
  return out;
}

/** Médaille d'un temps (s) ; `null` au-delà du bronze ou sans seuils. */
export function medailleDe(temps: number, seuils: SeuilsMedailles | null): Medaille | null {
  if (!seuils || !(Number.isFinite(temps) && temps > 0)) return null;
  for (const item of MEDAILLES) if (temps <= seuils[item.id]) return item.id;
  return null;
}

/** Clé d'un record : carte, départ et format (tous véhicules confondus, comme le dit le contrat du jeu). */
export function cleRecord(carte: string, depart: string, format: FormatCourse): string {
  return `course|${carte}|${depart}|${format}`;
}
