/// <reference types="vite/client" />
// Le mode carrière (§ 5.5, demande du commanditaire du 18 novembre 2026 : « dans le mode carrière […] on
// fait faire des circuits aux joueurs et au fur et à mesure des circuits on lui annonce le prochain […]
// afin que le joueur puisse préparer son véhicule ») : une suite ordonnée de rendez-vous imposés. Chacun
// fixe la carte, le départ, le format, la météo et le moment ; l'objectif pour passer au suivant (finir,
// ou décrocher au moins le bronze) ; la prime, payée une fois, en plus des gains de la course.
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

/** Ce qu'il faut pour passer au rendez-vous suivant : finir la course, ou finir avec une médaille de bronze au moins. */
export type ObjectifRendezVous = 'finir' | 'bronze';

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
}

/** Bornes de la prime d'un rendez-vous (consigne du 18 novembre 2026 : de 40 $ à 150 $). */
export const PRIME_MIN = 40;
export const PRIME_MAX = 150;
/** Rendez-vous au plus (taille de la sauvegarde). */
export const RENDEZ_VOUS_MAX = 60;

const ID = /^[a-z0-9][a-z0-9-]{0,47}$/;
const FORMATS = ['tour1', 'tours3'] as const;
const METEOS: readonly MeteoCourse[] = ['sec', 'pluie', 'neige'];
const MOMENTS_COURSE: readonly MomentCourse[] = ['jour', 'nuit'];
const OBJECTIFS: readonly ObjectifRendezVous[] = ['finir', 'bronze'];

export interface ContexteCarriere {
  cartes: readonly Pick<MapManifest, 'id'>[];
  /** Temps de référence par carte : ils disent les départs connus et les formats qui s'y courent. */
  references: Readonly<Record<string, FichierCourses>>;
}

export interface LectureCarriere {
  rendezVous: readonly RendezVous[];
  /** Problèmes trouvés ; non vide : la carrière est refusée en entier (`rendezVous` vide). */
  problemes: readonly string[];
}

const texte = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim() !== '' && value.length <= max;

/**
 * Valide le fichier de la carrière. Refuse une carte absente du catalogue, un départ que ses temps de
 * référence ne connaissent pas, un format qui ne s'y court pas (trois tours : sur une boucle seulement),
 * une météo, un moment ou un objectif inconnus, une prime hors bornes, un identifiant en double.
 */
export function lireCarriere(raw: unknown, contexte: ContexteCarriere): LectureCarriere {
  const problemes: string[] = [];
  const where = 'public/assets/carriere/carriere.json';
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { rendezVous: [], problemes: [`${where} : ce n’est pas un objet`] };
  const source = raw as Record<string, unknown>;
  if (source.format !== 'pmb-carriere' || source.version !== 1) problemes.push(`${where} : format ou version inconnus (attendu : pmb-carriere, 1)`);
  const liste = Array.isArray(source.rendezVous) ? (source.rendezVous as unknown[]) : null;
  if (!liste || liste.length === 0) problemes.push(`${where} : rendezVous doit être une liste non vide`);
  else if (liste.length > RENDEZ_VOUS_MAX) problemes.push(`${where} : ${liste.length} rendez-vous, ${RENDEZ_VOUS_MAX} au plus`);
  const vus = new Set<string>();
  const rendezVous: RendezVous[] = [];
  (liste ?? []).slice(0, RENDEZ_VOUS_MAX).forEach((item, index) => {
    const ici = `rendez-vous n° ${index + 1}`;
    if (typeof item !== 'object' || item === null || Array.isArray(item)) {
      problemes.push(`${ici} : ce n’est pas un objet`);
      return;
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
    if (!OBJECTIFS.includes(r.objectif as ObjectifRendezVous)) problemes.push(`${ici} : objectif « ${String(r.objectif)} » inconnu (finir ou bronze)`);
    if (typeof r.prime !== 'number' || !Number.isInteger(r.prime) || r.prime < PRIME_MIN || r.prime > PRIME_MAX) problemes.push(`${ici} : prime entre ${PRIME_MIN} et ${PRIME_MAX} $ attendue`);
    if (problemes.length === avant) {
      rendezVous.push({
        id: r.id as string,
        titre: (r.titre as string).trim(),
        carte,
        depart: r.depart as string,
        format: r.format as RendezVous['format'],
        meteo: r.meteo as MeteoCourse,
        moment: r.moment as MomentCourse,
        objectif: r.objectif as ObjectifRendezVous,
        prime: r.prime as number,
      });
    }
  });
  return problemes.length > 0 ? { rendezVous: [], problemes } : { rendezVous, problemes };
}

const FICHIERS = import.meta.glob<unknown>('../../public/assets/carriere/carriere.json', { eager: true, import: 'default' });
const LECTURE = lireCarriere(Object.values(FICHIERS)[0] ?? null, { cartes: MAPS, references: REFERENCES });

/** La carrière, dans l'ordre ; vide si le fichier manque ou s'il est refusé. */
export const CARRIERE: readonly RendezVous[] = LECTURE.rendezVous;
/** Ce qui fait refuser le fichier de la carrière (vide quand tout va bien). */
export const PROBLEMES_CARRIERE: readonly string[] = LECTURE.problemes;

export function rendezVousParId(id: string | null | undefined, carriere: readonly RendezVous[] = CARRIERE): RendezVous | undefined {
  return id ? carriere.find((rdv) => rdv.id === id) : undefined;
}

/** Ce que dit l'objectif, en clair. */
export const OBJECTIF_LABEL: Readonly<Record<ObjectifRendezVous, string>> = {
  finir: 'Finir la course',
  bronze: 'Le bronze au moins',
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

/** Haut fait de la carrière bouclée (src/data/hautsFaits.ts) : accordé par la carrière, pas par le lecteur des courses. */
export const HAUT_FAIT_CARRIERE = 'carriere-bouclee';
