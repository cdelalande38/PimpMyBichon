// Lecteur des hauts faits : évalue les conditions déclaratives de src/data/hautsFaits.ts. Pur.

import { HAUTS_FAITS, type Champ, type HautFaitDef, type Test } from '../data/hautsFaits.ts';
import type { HautFait, Medaille, ResultatCourse } from './contrat.ts';
import type { Cumuls } from './etat.ts';

const RANG_MEDAILLE: Readonly<Record<Medaille, number>> = { bronze: 1, argent: 2, or: 3 };

/** Ce que les tests peuvent lire : la course, ses suites sur les cumuls (déjà mis à jour), le catalogue. */
export interface ContexteHautFait {
  /** Absent : on regarde seulement les cumuls (après un achat) ; un test sur la course ne tient pas. */
  resultat?: ResultatCourse;
  record: boolean;
  cumuls: Cumuls;
  /** Nombre de cartes du catalogue (`toutesLesCartes`). */
  nbCartes: number;
}

function lireCourse(champ: Champ, r: ResultatCourse, record: boolean): number | string | undefined {
  switch (champ) {
    case 'course.temps':
      return r.temps;
    case 'course.distance':
      return r.stats.distance;
    case 'course.vitesseMax':
      return r.stats.vitesseMax;
    case 'course.glisse':
      return r.stats.glisse;
    case 'course.chocs':
      return r.stats.chocs;
    case 'course.nos':
      return r.stats.nos;
    case 'course.tours':
      return r.tours.length;
    case 'course.format':
      return r.format;
    case 'course.meteo':
      return r.meteo;
    case 'course.moment':
      return r.moment;
    case 'course.rangMedaille':
      return r.medaille ? RANG_MEDAILLE[r.medaille] : 0;
    case 'course.record':
      return record ? 1 : 0;
    default:
      return undefined;
  }
}

function lireCumul(champ: Champ, c: Cumuls): number {
  switch (champ) {
    case 'cumul.courses':
      return c.courses;
    case 'cumul.coursesTrois':
      return c.coursesTrois;
    case 'cumul.distance':
      return c.distance;
    case 'cumul.glisse':
      return c.glisse;
    case 'cumul.nos':
      return c.nos;
    case 'cumul.bronze':
      return c.bronze;
    case 'cumul.argent':
      return c.argent;
    case 'cumul.or':
      return c.or;
    case 'cumul.medailles':
      return c.bronze + c.argent + c.or;
    case 'cumul.records':
      return c.records;
    case 'cumul.sansChoc':
      return c.sansChoc;
    case 'cumul.pluie':
      return c.pluie;
    case 'cumul.neige':
      return c.neige;
    case 'cumul.jour':
      return c.jour;
    case 'cumul.cartes':
      return Object.keys(c.cartes).length;
    case 'cumul.vehicules':
      return Object.keys(c.vehicules).length;
    case 'cumul.vitesseMax':
      return c.vitesseMax;
    case 'cumul.gains':
      return c.gains;
    case 'cumul.achats':
      return c.achats;
    default:
      return Number.NaN;
  }
}

/** Valeur d'un champ : un nombre, ou un texte (format, météo, moment) ; `undefined` : la course manque. */
export function lireChamp(champ: Champ, ctx: ContexteHautFait): number | string | undefined {
  if (champ.startsWith('course.')) return ctx.resultat ? lireCourse(champ, ctx.resultat, ctx.record) : undefined;
  return lireCumul(champ, ctx.cumuls);
}

export function testTient(test: Test, ctx: ContexteHautFait): boolean {
  const lu = lireChamp(test.champ, ctx);
  if (lu === undefined) return false;
  const attendu = test.valeur === 'toutesLesCartes' ? ctx.nbCartes : test.valeur;
  if (typeof lu === 'string' || typeof attendu === 'string') {
    // Un texte ne se compare qu'à un texte, par égalité.
    if (test.op === '=') return lu === attendu;
    if (test.op === '!=') return lu !== attendu;
    return false;
  }
  switch (test.op) {
    case '>=':
      return lu >= attendu;
    case '>':
      return lu > attendu;
    case '<=':
      return lu <= attendu;
    case '<':
      return lu < attendu;
    case '=':
      return lu === attendu;
    case '!=':
      return lu !== attendu;
  }
}

/** Un haut fait sans condition ne s'obtient jamais (garde contre une donnée vide). */
export function fait(def: HautFaitDef, ctx: ContexteHautFait): boolean {
  return def.quand.length > 0 && def.quand.every((test) => testTient(test, ctx));
}

/** Ce que l'écran de fin affiche : le haut fait sans ses conditions. */
export function visible(def: HautFaitDef): HautFait {
  return { id: def.id, label: def.label, description: def.description, recompense: def.recompense };
}

/** Hauts faits que ce contexte fait obtenir et que `deja` ne contient pas, dans l'ordre des données. */
export function nouveauxHautsFaits(ctx: ContexteHautFait, deja: Readonly<Record<string, true>>, defs: readonly HautFaitDef[] = HAUTS_FAITS): HautFaitDef[] {
  return defs.filter((def) => !deja[def.id] && fait(def, ctx));
}

/** Avancement vers un haut fait de cumul à un seul test (« 4 courses sur 10 ») ; `null` : pas mesurable ainsi. */
export function progression(def: HautFaitDef, cumuls: Cumuls, nbCartes: number): { champ: Champ; actuel: number; cible: number } | null {
  const [test, ...reste] = def.quand;
  if (!test || reste.length > 0 || test.op !== '>=' || !test.champ.startsWith('cumul.')) return null;
  const cible = test.valeur === 'toutesLesCartes' ? nbCartes : test.valeur;
  if (typeof cible !== 'number') return null;
  const actuel = lireCumul(test.champ, cumuls);
  return { champ: test.champ, actuel: Math.min(actuel, cible), cible };
}
