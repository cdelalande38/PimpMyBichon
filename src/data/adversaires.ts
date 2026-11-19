// Les adversaires du duel (§ 5.5, jeu : le duel contre un véhicule piloté par l'app, demandé le 18 novembre
// 2026). Ils vivent en données, dans public/assets/adversaires/adversaires.json : aucun identifiant de
// véhicule ici. Chacun a un nom d'atelier inventé (aucun nom de marque, de pilote réel ni de personnage),
// un véhicule du catalogue, une couleur de carrosserie et un niveau calé sur une médaille (bronze, argent,
// or) : son allure est réglée pour finir au temps de cette médaille sur la carte, le départ et le véhicule
// du joueur (src/drive/adversaire/allure.ts). Un fichier mal formé est refusé en entier
// (`PROBLEMES_ADVERSAIRES`, relu par tests/unit/adversaire.test.ts) : plutôt pas de duel qu'un duel faux.

import type { Medaille } from '../jeu/contrat.ts';
import type { VehicleManifest } from './vehicleTypes.ts';
import { VEHICLES } from './vehicles.ts';

export interface Adversaire {
  id: string;
  /** Nom d'atelier inventé, 24 signes au plus. */
  nom: string;
  /** Une phrase tutoyée ou à la troisième personne, 60 signes au plus, sous son nom au menu. */
  phrase: string;
  niveau: Medaille;
  /** Identifiant d'un véhicule du catalogue. */
  vehicule: string;
  /** Couleur de la carrosserie (#rrggbb). */
  couleur: string;
}

export interface ReglagePilotage {
  /** Part dont l'allure varie d'une section de route à l'autre (il soigne ou rate un peu un virage), 0 à 0,1. */
  irregularite: number;
  /** Longueur d'une section de route, en mètres. */
  section: number;
  /** Allure (part du temps de la conduite appliquée) quand la carte n'a pas de temps de référence. */
  sansReference: Readonly<Record<Medaille, number>>;
}

export interface ReglageContact {
  /** Écart latéral gardé entre les flancs, en mètres. */
  garde: number;
  /** L'adversaire choisit son côté quand le joueur arrive à moins de cette distance (m, pare-chocs à pare-chocs)… */
  approche: number;
  /** … et le garde tant qu'il n'est pas à plus de celle-ci. */
  relache: number;
  /** Vitesse latérale la plus forte du décalage d'évitement, m/s. */
  ecartParSeconde: number;
}

export interface FichierAdversaires {
  adversaires: readonly Adversaire[];
  pilotage: ReglagePilotage;
  contact: ReglageContact;
}

export const NIVEAUX: readonly Medaille[] = ['bronze', 'argent', 'or'];
export const NIVEAU_LABEL: Readonly<Record<Medaille, string>> = { bronze: 'Bronze', argent: 'Argent', or: 'Or' };

const ID = /^[a-z0-9-]{2,24}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const texte = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim() !== '' && value.length <= max;
const nombre = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

const PILOTAGE_DEFAUT: ReglagePilotage = { irregularite: 0.04, section: 140, sansReference: { bronze: 0.55, argent: 0.8, or: 0.92 } };
const CONTACT_DEFAUT: ReglageContact = { garde: 0.3, approche: 6, relache: 12, ecartParSeconde: 3 };

/** Valide le fichier des adversaires d'après le catalogue des véhicules. */
export function lireAdversaires(raw: unknown, vehicules: readonly Pick<VehicleManifest, 'id'>[]): FichierAdversaires & { problemes: string[] } {
  const where = 'public/assets/adversaires/adversaires.json';
  const vide = { adversaires: [], pilotage: PILOTAGE_DEFAUT, contact: CONTACT_DEFAUT };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...vide, problemes: [`${where} : ce n’est pas un objet`] };
  const source = raw as Record<string, unknown>;
  const problemes: string[] = [];
  if (source.format !== 'pmb-adversaires' || source.version !== 1) problemes.push(`${where} : format ou version inconnus (attendu : pmb-adversaires, 1)`);
  const liste = Array.isArray(source.adversaires) ? (source.adversaires as unknown[]) : [];
  if (liste.length === 0 || liste.length > 12) problemes.push(`${where} : de 1 à 12 adversaires attendus`);
  const vus = new Set<string>();
  const adversaires: Adversaire[] = [];
  liste.slice(0, 12).forEach((item, index) => {
    const ici = `adversaire n° ${index + 1}`;
    const a = (typeof item === 'object' && item !== null ? item : {}) as Record<string, unknown>;
    const avant = problemes.length;
    if (typeof a.id !== 'string' || !ID.test(a.id) || vus.has(a.id)) problemes.push(`${ici} : id invalide ou en double`);
    else vus.add(a.id);
    if (!texte(a.nom, 24)) problemes.push(`${ici} : nom manquant (24 signes au plus)`);
    if (!texte(a.phrase, 60)) problemes.push(`${ici} : phrase manquante (60 signes au plus)`);
    if (!NIVEAUX.includes(a.niveau as Medaille)) problemes.push(`${ici} : niveau « ${String(a.niveau)} » inconnu (bronze, argent ou or)`);
    if (!vehicules.some((v) => v.id === a.vehicule)) problemes.push(`${ici} : véhicule « ${String(a.vehicule)} » absent du catalogue`);
    if (typeof a.couleur !== 'string' || !HEX.test(a.couleur)) problemes.push(`${ici} : couleur #rrggbb attendue`);
    if (problemes.length === avant) {
      adversaires.push({ id: a.id as string, nom: (a.nom as string).trim(), phrase: (a.phrase as string).trim(), niveau: a.niveau as Medaille, vehicule: a.vehicule as string, couleur: (a.couleur as string).toLowerCase() });
    }
  });
  const p = (typeof source.pilotage === 'object' && source.pilotage !== null ? source.pilotage : {}) as Record<string, unknown>;
  const sans = (typeof p.sansReference === 'object' && p.sansReference !== null ? p.sansReference : {}) as Record<string, unknown>;
  if (!nombre(p.irregularite, 0, 0.1)) problemes.push(`${where} : pilotage.irregularite entre 0 et 0,1`);
  if (!nombre(p.section, 30, 1000)) problemes.push(`${where} : pilotage.section entre 30 et 1 000 m`);
  for (const n of NIVEAUX) if (!nombre(sans[n], 0.3, 1)) problemes.push(`${where} : pilotage.sansReference.${n} entre 0,3 et 1`);
  const c = (typeof source.contact === 'object' && source.contact !== null ? source.contact : {}) as Record<string, unknown>;
  if (!nombre(c.garde, 0, 1.5)) problemes.push(`${where} : contact.garde entre 0 et 1,5 m`);
  if (!nombre(c.approche, 0, 40) || !nombre(c.relache, 0, 60) || (c.relache as number) < (c.approche as number)) problemes.push(`${where} : contact.approche et contact.relache (relache ≥ approche)`);
  if (!nombre(c.ecartParSeconde, 0.5, 10)) problemes.push(`${where} : contact.ecartParSeconde entre 0,5 et 10 m/s`);
  if (problemes.length > 0) return { ...vide, problemes };
  return {
    adversaires,
    pilotage: { irregularite: p.irregularite as number, section: p.section as number, sansReference: { bronze: sans.bronze as number, argent: sans.argent as number, or: sans.or as number } },
    contact: { garde: c.garde as number, approche: c.approche as number, relache: c.relache as number, ecartParSeconde: c.ecartParSeconde as number },
    problemes,
  };
}

const FICHIERS = import.meta.glob<unknown>('../../public/assets/adversaires/adversaires.json', { eager: true, import: 'default' });
const LECTURE = lireAdversaires(Object.values(FICHIERS)[0] ?? null, VEHICLES);

/** Les adversaires, dans l'ordre du fichier ; vide si le fichier manque ou s'il est refusé (pas de duel). */
export const ADVERSAIRES: readonly Adversaire[] = LECTURE.adversaires;
export const PILOTAGE_ADVERSAIRE: ReglagePilotage = LECTURE.pilotage;
export const CONTACT_ADVERSAIRE: ReglageContact = LECTURE.contact;
/** Ce qui fait refuser le fichier (vide quand tout va bien). */
export const PROBLEMES_ADVERSAIRES: readonly string[] = LECTURE.problemes;

export function adversaireParId(id: string | null | undefined, liste: readonly Adversaire[] = ADVERSAIRES): Adversaire | undefined {
  return id ? liste.find((a) => a.id === id) : undefined;
}
