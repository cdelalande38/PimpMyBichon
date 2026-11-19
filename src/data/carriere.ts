/// <reference types="vite/client" />
// Le mode carrière (§ 5.5, demande du commanditaire du 18 novembre 2026 : « dans le mode carrière […] on
// fait faire des circuits aux joueurs et au fur et à mesure des circuits on lui annonce le prochain […]
// afin que le joueur puisse préparer son véhicule ») : une suite ordonnée de rendez-vous imposés. Chacun
// fixe la carte, le départ, le format, la météo et le moment ; l'objectif pour passer au suivant (finir,
// ou décrocher au moins le bronze) ; la prime, payée une fois, en plus des gains de la course.
//
// Vague V (demande du 18 novembre 2026, 22 h 10 : « J'ai déjà terminé le mode carrière avec les 12 courses.
// Il faut ajouter du challenge […] Il faudra une suite ») : la carrière passe à une liste de SAISONS (titre,
// sous-titre, rendez-vous). La première reprend les douze rendez-vous d'origine, sans rien y changer
// (identifiants, primes, objectifs) : la progression, rangée par identifiant de rendez-vous, se relit
// telle quelle. Une saison s'ouvre quand la précédente est bouclée. Les objectifs montent à l'argent et à
// l'or ; un rendez-vous peut poser une ou deux CONTRAINTES vérifiables à l'arrivée (`CONTRAINTES`).
//
// La suite vit en données, dans public/assets/carriere/carriere.json (aucun identifiant de carte dans
// src/), lue au build et validée ici contre le catalogue des cartes (src/data/maps.ts) et leurs temps de
// référence (courses.json, src/data/courses.ts) : une carte, un départ ou un format inconnus, et c'est
// toute la carrière qui est refusée (`PROBLEMES_CARRIERE`, relu par tests/unit/carriere.test.ts), plutôt
// qu'une suite trouée. Les règles de la progression sont dans src/jeu/carriere.ts.

import type { MeteoCourse, MomentCourse } from '../jeu/contrat.ts';
import { REFERENCES, type FichierCourses } from './courses.ts';
import { MAPS } from './maps.ts';
import type { MapManifest } from './mapTypes.ts';

/** Ce qu'il faut pour passer au rendez-vous suivant : finir la course, ou finir avec cette médaille au moins. */
export type ObjectifRendezVous = 'finir' | 'bronze' | 'argent' | 'or';

/**
 * Contraintes d'un rendez-vous, vérifiées à l'arrivée sur ce que la course a mesuré (src/jeu/contrat.ts,
 * `ResultatCourse`) : aucune poussée de NOS (`stats.nos`), aucun choc contre le bord (`stats.chocs`), un
 * véhicule de la famille dite (`kind` du manifeste). Écartées faute de pouvoir les vérifier honnêtement
 * sans réécrire la conduite : la direction sans assistance (un réglage qui se change en route, absent du
 * résultat), la glisse (mesure en chantier pour le format Drift).
 */
export type ContrainteRendezVous = 'sans-nos' | 'sans-choc' | 'moto' | 'voiture';

export interface RendezVous {
  id: string;
  /** Petit nom du rendez-vous, affiché sous son numéro. */
  titre: string;
  /** Carte (dossier de public/assets/maps/). */
  carte: string;
  /** Départ de la carte (MapStart.id). */
  depart: string;
  format: 'tour1' | 'tours3';
  meteo: MeteoCourse;
  moment: MomentCourse;
  objectif: ObjectifRendezVous;
  /** Prime du rendez-vous réussi, en dollars, payée une seule fois. */
  prime: number;
  /** Contraintes (deux au plus) ; vide : aucune. */
  contraintes: readonly ContrainteRendezVous[];
}

/** Une saison : une suite de rendez-vous, ouverte quand la précédente est bouclée. */
export interface Saison {
  id: string;
  /** « L'échauffement », affiché après « Saison 1 ». */
  titre: string;
  /** Une ligne sous le titre. */
  sousTitre: string;
  rendezVous: readonly RendezVous[];
  /** Haut fait accordé quand la saison est bouclée (src/data/hautsFaits.ts) ; absent : aucun. */
  hautFait?: string;
  /** Haut fait accordé quand tous ses rendez-vous ont l'or ; absent : aucun. */
  hautFaitOr?: string;
}

/** Bornes de la prime d'un rendez-vous (consigne du 18 novembre 2026 : de 40 $ à 150 $ ; vague V, saison 2 plus dure : jusqu'à 250 $). */
export const PRIME_MIN = 40;
export const PRIME_MAX = 250;
/** Rendez-vous au plus, toutes saisons comprises (taille de la sauvegarde). */
export const RENDEZ_VOUS_MAX = 60;
/** Saisons au plus. */
export const SAISONS_MAX = 5;

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const FORMATS = ['tour1', 'tours3'] as const;
const METEOS: readonly MeteoCourse[] = ['sec', 'pluie', 'neige'];
const MOMENTS_COURSE: readonly MomentCourse[] = ['jour', 'nuit'];
const OBJECTIFS: readonly ObjectifRendezVous[] = ['finir', 'bronze', 'argent', 'or'];
export const CONTRAINTES: readonly ContrainteRendezVous[] = ['sans-nos', 'sans-choc', 'moto', 'voiture'];

export interface ContexteCarriere {
  cartes: readonly Pick<MapManifest, 'id'>[];
  /** Temps de référence par carte : ils disent les départs connus et les formats qui s'y courent. */
  references: Readonly<Record<string, FichierCourses>>;
}

export interface LectureCarriere {
  saisons: readonly Saison[];
  /** Tous les rendez-vous, saison après saison. */
  rendezVous: readonly RendezVous[];
  /** Problèmes trouvés ; non vide : la carrière est refusée en entier (`saisons` et `rendezVous` vides). */
  problemes: readonly string[];
}

const texte = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim() !== '' && value.length <= max;

/**
 * Valide le fichier de la carrière. Refuse une carte absente du catalogue, un départ que ses temps de
 * référence ne connaissent pas, un format qui ne s'y court pas (trois tours : sur une boucle seulement),
 * une météo, un moment, un objectif ou une contrainte inconnus, une prime hors bornes, un identifiant de
 * rendez-vous ou de saison en double, une saison vide.
 */
export function lireCarriere(raw: unknown, contexte: ContexteCarriere): LectureCarriere {
  const problemes: string[] = [];
  const where = 'public/assets/carriere/carriere.json';
  const refus = (motif: string): LectureCarriere => ({ saisons: [], rendezVous: [], problemes: [`${where} : ${motif}`] });
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return refus('ce n’est pas un objet');
  const source = raw as Record<string, unknown>;
  if (source.format !== 'pmb-carriere' || source.version !== 2) problemes.push(`${where} : format ou version inconnus (attendu : pmb-carriere, 2)`);
  const listeSaisons = Array.isArray(source.saisons) ? (source.saisons as unknown[]) : null;
  if (!listeSaisons || listeSaisons.length === 0) problemes.push(`${where} : saisons doit être une liste non vide`);
  else if (listeSaisons.length > SAISONS_MAX) problemes.push(`${where} : ${listeSaisons.length} saisons, ${SAISONS_MAX} au plus`);
  const vus = new Set<string>();
  const saisonsVues = new Set<string>();
  const saisons: Saison[] = [];
  let numero = 0;
  (listeSaisons ?? []).slice(0, SAISONS_MAX).forEach((brut, s) => {
    const laSaison = `saison n° ${s + 1}`;
    if (typeof brut !== 'object' || brut === null || Array.isArray(brut)) {
      problemes.push(`${laSaison} : ce n’est pas un objet`);
      return;
    }
    const sa = brut as Record<string, unknown>;
    if (typeof sa.id !== 'string' || !ID.test(sa.id)) problemes.push(`${laSaison} : id invalide (minuscules, chiffres et « - »)`);
    else if (saisonsVues.has(sa.id)) problemes.push(`${laSaison} : id « ${sa.id} » en double`);
    else saisonsVues.add(sa.id);
    if (!texte(sa.titre, 40)) problemes.push(`${laSaison} : titre manquant (40 signes au plus)`);
    if (!texte(sa.sousTitre, 90)) problemes.push(`${laSaison} : sousTitre manquant (90 signes au plus)`);
    for (const cle of ['hautFait', 'hautFaitOr'] as const) {
      if (sa[cle] !== undefined && (typeof sa[cle] !== 'string' || !ID.test(sa[cle]))) problemes.push(`${laSaison} : ${cle} invalide`);
    }
    const liste = Array.isArray(sa.rendezVous) ? (sa.rendezVous as unknown[]) : null;
    if (!liste || liste.length === 0) problemes.push(`${laSaison} : rendezVous doit être une liste non vide`);
    const rendezVous: RendezVous[] = [];
    for (const item of liste ?? []) {
      numero += 1;
      if (numero > RENDEZ_VOUS_MAX) {
        problemes.push(`${where} : plus de ${RENDEZ_VOUS_MAX} rendez-vous`);
        break;
      }
      const lu = lireRendezVous(item, `${laSaison}, rendez-vous n° ${rendezVous.length + 1}`, contexte, vus, problemes);
      if (lu) rendezVous.push(lu);
    }
    saisons.push({
      id: String(sa.id),
      titre: typeof sa.titre === 'string' ? sa.titre.trim() : '',
      sousTitre: typeof sa.sousTitre === 'string' ? sa.sousTitre.trim() : '',
      rendezVous,
      ...(typeof sa.hautFait === 'string' ? { hautFait: sa.hautFait } : {}),
      ...(typeof sa.hautFaitOr === 'string' ? { hautFaitOr: sa.hautFaitOr } : {}),
    });
  });
  if (problemes.length > 0) return { saisons: [], rendezVous: [], problemes };
  return { saisons, rendezVous: saisons.flatMap((saison) => saison.rendezVous), problemes };
}

function lireRendezVous(item: unknown, ici: string, contexte: ContexteCarriere, vus: Set<string>, problemes: string[]): RendezVous | null {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    problemes.push(`${ici} : ce n’est pas un objet`);
    return null;
  }
  const r = item as Record<string, unknown>;
  const avant = problemes.length;
  if (typeof r.id !== 'string' || !ID.test(r.id)) problemes.push(`${ici} : id invalide (minuscules, chiffres et « - »)`);
  else if (vus.has(r.id)) problemes.push(`${ici} : id « ${r.id} » en double`);
  else vus.add(r.id);
  if (!texte(r.titre, 60)) problemes.push(`${ici} : titre manquant (60 signes au plus)`);
  const carte = typeof r.carte === 'string' ? r.carte : '';
  const references = contexte.references[carte];
  if (!contexte.cartes.some((map) => map.id === carte)) problemes.push(`${ici} : carte « ${String(r.carte)} » inconnue du catalogue`);
  else if (!references) problemes.push(`${ici} : la carte « ${carte} » n’a pas de temps de référence (npm run courses:temps)`);
  else if (typeof r.depart !== 'string' || !references.departs[r.depart]) problemes.push(`${ici} : départ « ${String(r.depart)} » inconnu sur « ${carte} »`);
  if (!FORMATS.includes(r.format as (typeof FORMATS)[number])) problemes.push(`${ici} : format « ${String(r.format)} » inconnu (tour1 ou tours3)`);
  else if (references && typeof r.depart === 'string' && references.departs[r.depart] && !references.departs[r.depart]?.[r.format as (typeof FORMATS)[number]]) {
    problemes.push(`${ici} : le format « ${String(r.format)} » ne se court pas depuis « ${r.depart} » sur « ${carte} »`);
  }
  if (!METEOS.includes(r.meteo as MeteoCourse)) problemes.push(`${ici} : météo « ${String(r.meteo)} » inconnue`);
  if (!MOMENTS_COURSE.includes(r.moment as MomentCourse)) problemes.push(`${ici} : moment « ${String(r.moment)} » inconnu`);
  if (!OBJECTIFS.includes(r.objectif as ObjectifRendezVous)) problemes.push(`${ici} : objectif « ${String(r.objectif)} » inconnu (${OBJECTIFS.join(', ')})`);
  if (typeof r.prime !== 'number' || !Number.isInteger(r.prime) || r.prime < PRIME_MIN || r.prime > PRIME_MAX) problemes.push(`${ici} : prime entre ${PRIME_MIN} et ${PRIME_MAX} $ attendue`);
  const contraintes = r.contraintes === undefined ? [] : Array.isArray(r.contraintes) ? (r.contraintes as unknown[]) : null;
  if (!contraintes || contraintes.length > 2) problemes.push(`${ici} : contraintes : une liste de deux au plus`);
  else {
    for (const c of contraintes) if (!CONTRAINTES.includes(c as ContrainteRendezVous)) problemes.push(`${ici} : contrainte « ${String(c)} » inconnue (${CONTRAINTES.join(', ')})`);
    if (new Set(contraintes).size !== contraintes.length || (contraintes.includes('moto') && contraintes.includes('voiture'))) problemes.push(`${ici} : contraintes en double ou contradictoires`);
  }
  if (problemes.length !== avant) return null;
  return {
    id: r.id as string,
    titre: (r.titre as string).trim(),
    carte,
    depart: r.depart as string,
    format: r.format as RendezVous['format'],
    meteo: r.meteo as MeteoCourse,
    moment: r.moment as MomentCourse,
    objectif: r.objectif as ObjectifRendezVous,
    prime: r.prime as number,
    contraintes: (contraintes ?? []) as ContrainteRendezVous[],
  };
}

const FICHIERS = import.meta.glob<unknown>('../../public/assets/carriere/carriere.json', { eager: true, import: 'default' });
const LECTURE = lireCarriere(Object.values(FICHIERS)[0] ?? null, { cartes: MAPS, references: REFERENCES });

/** Les saisons, dans l'ordre ; vide si le fichier manque ou s'il est refusé. */
export const SAISONS: readonly Saison[] = LECTURE.saisons;
/** Tous les rendez-vous, saison après saison (la progression les suit dans cet ordre). */
export const CARRIERE: readonly RendezVous[] = LECTURE.rendezVous;
/** Ce qui fait refuser le fichier de la carrière (vide quand tout va bien). */
export const PROBLEMES_CARRIERE: readonly string[] = LECTURE.problemes;

export function rendezVousParId(id: string | null | undefined, carriere: readonly RendezVous[] = CARRIERE): RendezVous | undefined {
  return id ? carriere.find((rdv) => rdv.id === id) : undefined;
}

/** Place d'un rendez-vous : sa saison (rang 0 pour la première) et son rang dans la saison (0 pour le premier). */
export interface PlaceRendezVous {
  saison: Saison;
  indexSaison: number;
  rang: number;
}

export function placeDe(id: string | null | undefined, saisons: readonly Saison[] = SAISONS): PlaceRendezVous | null {
  if (!id) return null;
  for (let s = 0; s < saisons.length; s += 1) {
    const saison = saisons[s]!;
    const rang = saison.rendezVous.findIndex((rdv) => rdv.id === id);
    if (rang >= 0) return { saison, indexSaison: s, rang };
  }
  return null;
}

/** Ce que dit l'objectif, en clair. */
export const OBJECTIF_LABEL: Readonly<Record<ObjectifRendezVous, string>> = {
  finir: 'Finir la course',
  bronze: 'Le bronze au moins',
  argent: 'L’argent au moins',
  or: 'L’or',
};

/** Contraintes, en clair : le libellé court (fiche, étiquette en course) et ce qui la fait manquer (écran de fin). */
export const CONTRAINTE_LABEL: Readonly<Record<ContrainteRendezVous, { court: string; manque: string }>> = {
  'sans-nos': { court: 'Sans NOS', manque: 'tu as poussé le NOS' },
  'sans-choc': { court: 'Sans toucher le bord', manque: 'tu as touché le bord' },
  moto: { court: 'À moto', manque: 'il fallait une moto' },
  voiture: { court: 'En voiture', manque: 'il fallait une voiture' },
};

export const METEO_LABEL: Readonly<Record<MeteoCourse, string>> = { sec: 'Au sec', pluie: 'Sous la pluie', neige: 'Sous la neige' };
export const MOMENT_LABEL: Readonly<Record<MomentCourse, string>> = { jour: 'De jour', nuit: 'De nuit' };

/**
 * Conseils de préparation, une ligne, tirés de la météo, du moment et du format. Sans promesse chiffrée :
 * l'effet réel des pneus, de la suspension et de la puissance selon la météo est l'affaire du lot
 * « preparation » (src/data/adherence.ts), dont le conseil chiffré viendra remplacer celui-ci.
 */
export const CONSEILS = {
  meteo: {
    sec: 'Route sèche : la puissance passe au sol, c’est le moment de la sortir.',
    pluie: 'Pluie : pense aux pneus et à l’assiette, la route glisse.',
    neige: 'Neige : des pneus qui mordent, une assiette relevée, et doux sur la pédale.',
  },
  nuit: 'De nuit, des phares qui portent loin.',
  tours3: 'Trois tours : garde du NOS pour la fin.',
} as const satisfies { meteo: Readonly<Record<MeteoCourse, string>>; nuit: string; tours3: string };

/** La ligne de conseil d'un rendez-vous. */
export function conseilDe(rdv: Pick<RendezVous, 'meteo' | 'moment' | 'format'>): string {
  const parts: string[] = [CONSEILS.meteo[rdv.meteo]];
  if (rdv.moment === 'nuit') parts.push(CONSEILS.nuit);
  if (rdv.format === 'tours3') parts.push(CONSEILS.tours3);
  return parts.join(' ');
}
