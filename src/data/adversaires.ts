// Les adversaires du duel (§ 5.5, jeu : le duel contre un véhicule piloté par l'app, demandé le 18 novembre
// 2026, refait le 19 après le premier essai). Ils vivent en données, dans public/assets/adversaires/adversaires.json :
// aucun identifiant de véhicule ici. Chacun a un nom d'atelier inventé (aucun nom de marque, de pilote réel ni
// de personnage), un véhicule du catalogue et une couleur de carrosserie. La difficulté est à part, choisie au
// menu : chaque niveau dit comment il court (src/drive/adversaire/pilotage.ts) — la part de ce que son véhicule
// tient (virages et pointe), le freinage sur lequel il compte, son irrégularité — et le palier de ses gains
// (bronze, argent, or : src/data/economie.ts, ECONOMIE_DUEL, et les trois hauts faits). Un fichier mal formé est
// refusé en entier (`PROBLEMES_ADVERSAIRES`, relu par tests/unit/adversaire.test.ts) : plutôt pas de duel qu'un
// duel faux.

import type { Medaille } from '../jeu/contrat.ts';
import type { VehicleManifest } from './vehicleTypes.ts';
import { VEHICLES } from './vehicles.ts';

export interface Adversaire {
  id: string;
  /** Nom d'atelier inventé, 24 signes au plus. */
  nom: string;
  /** Une phrase tutoyée ou à la troisième personne, 60 signes au plus. */
  phrase: string;
  /** Identifiant d'un véhicule du catalogue. */
  vehicule: string;
  /** Couleur de la carrosserie (#rrggbb). */
  couleur: string;
}

/** Un niveau de difficulté : comment l'adversaire court, et ce que la victoire rapporte. */
export interface NiveauDuel {
  id: string;
  /** 12 signes au plus. */
  label: string;
  /** Ce qu'il fait, 32 signes au plus, sous le libellé au menu. */
  phrase: string;
  /** Palier des gains et du haut fait de la première victoire (un par palier). */
  gains: Medaille;
  /** Part de la vitesse que son véhicule tient en virage, et de sa vitesse de pointe, 0,6 à 1. */
  allure: number;
  /** Part du freinage le plus fort sur laquelle il compte pour arriver au virage, 0,4 à 0,9 (bas : il freine tôt). */
  freinage: number;
  /** Part dont son allure baisse par endroits (il rate un peu un virage, jamais le même partout), 0 à 0,1. */
  irregularite: number;
  /** NOS : il l'envoie en sortie de virage, au début de chaque ligne droite d'au moins tant de mètres ; 0 : jamais. */
  nos: number;
  /**
   * Combien il s'appuie sur le bord en virage, 1 à 100 : il vise √audace fois la vitesse que tiennent ses pneus, et
   * le bord frotté fait le reste, comme le joueur qui ne freine pas (src/drive/pilote.ts). 1 : il freine pour ses
   * pneus ; 100 : il ne freine pour aucun virage.
   */
  audace: number;
}

export interface ReglagePilotage {
  /** Longueur d'une section de route (irrégularité), en mètres. */
  section: number;
  /** NOS : rayon (m) au-delà duquel la route compte comme une ligne droite, et chemin fait (m) avant le premier envoi (jamais au départ arrêté). */
  nosRayon: number;
  nosDepart: number;
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
  /** Vitesse perdue par chacun, flanc contre flanc, m/s². */
  frottement: number;
  /** Là où la chaussée est trop étroite pour deux : vitesse (m/s) à laquelle celui de derrière recule sur l'autre. */
  cedeParSeconde: number;
}

/**
 * Le bruit de son moteur (src/drive/adversaire/son.ts) : volume tout près, distance où il commence à baisser,
 * raideur de la baisse, portée, coupure des aigus quand il est juste derrière, et l'effet d'approche et d'éloignement
 * (retour du 22 novembre 2026 : plus fort de près, qui monte quand il arrive et redescend quand il s'éloigne).
 */
export interface ReglageSon {
  /** Volume tout près, de 0 à 1 (fois le volume du moteur du joueur : 1, à sa hauteur, il s'entend autant que lui). */
  niveau: number;
  /** En deçà (m), le volume ne monte plus. */
  proche: number;
  /** Au-delà (m), on ne l'entend plus. */
  portee: number;
  /** Fréquence de coupure (Hz) quand il est juste derrière (devant : rien n'est coupé). */
  derriere: number;
  /** Raideur de la baisse avec la distance au-delà de `proche` : le volume suit (proche ÷ distance) à cette puissance (1 : en 1/distance). */
  chute: number;
  /** Part du volume gagnée en approche (perdue en éloignement) à `vitesseRef` de vitesse relative, de 0 à 0,6. */
  approche: number;
  /** Écart de hauteur (taux de lecture, 0,05 : ± 5 %) à `vitesseRef` : plus aigu en approche, plus grave en éloignement. */
  hauteur: number;
  /** Vitesse relative (m/s) à laquelle l'effet d'approche est plein. */
  vitesseRef: number;
  /** Lissage de la vitesse relative (s) : plus c'est long, plus l'effet est doux, sans à-coup. */
  lissage: number;
}

/** Son pilote (src/drive/scene/adversaire.tsx) : le conducteur du joueur, une passe de sa tenue teintée de sa couleur. */
export interface ReglagePilote {
  /** Passe du conducteur (catalogue, public/assets/shared/conducteur/catalogue.json) teintée ; `null` : aucune. */
  passe: string | null;
}

export interface FichierAdversaires {
  adversaires: readonly Adversaire[];
  niveaux: readonly NiveauDuel[];
  niveauParDefaut: string;
  pilotage: ReglagePilotage;
  contact: ReglageContact;
  son: ReglageSon;
  pilote: ReglagePilote;
}

const MEDAILLES: readonly Medaille[] = ['bronze', 'argent', 'or'];
const ID = /^[a-z0-9-]{2,24}$/;
const HEX = /^#[0-9a-f]{6}$/i;
const texte = (value: unknown, max: number): value is string => typeof value === 'string' && value.trim() !== '' && value.length <= max;
const nombre = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

const PILOTAGE_DEFAUT: ReglagePilotage = { section: 140, nosRayon: 250, nosDepart: 150 };
const CONTACT_DEFAUT: ReglageContact = { garde: 0.3, approche: 6, relache: 12, ecartParSeconde: 3, frottement: 2, cedeParSeconde: 6 };
type ReglageApproche = Pick<ReglageSon, 'chute' | 'approche' | 'hauteur' | 'vitesseRef' | 'lissage'>;
const SON_DEFAUT: ReglageSon = { niveau: 1, proche: 6, portee: 120, derriere: 1800, chute: 1.6, approche: 0.3, hauteur: 0.04, vitesseRef: 30, lissage: 0.4 };
const PILOTE_DEFAUT: ReglagePilote = { passe: null };
const objet = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

/** Valide le fichier des adversaires d'après le catalogue des véhicules. */
export function lireAdversaires(raw: unknown, vehicules: readonly Pick<VehicleManifest, 'id'>[]): FichierAdversaires & { problemes: string[] } {
  const where = 'public/assets/adversaires/adversaires.json';
  const vide = { adversaires: [], niveaux: [], niveauParDefaut: '', pilotage: PILOTAGE_DEFAUT, contact: CONTACT_DEFAUT, son: SON_DEFAUT, pilote: PILOTE_DEFAUT };
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ...vide, problemes: [`${where} : ce n’est pas un objet`] };
  const source = raw as Record<string, unknown>;
  const problemes: string[] = [];
  if (source.format !== 'pmb-adversaires' || source.version !== 2) problemes.push(`${where} : format ou version inconnus (attendu : pmb-adversaires, 2)`);
  const liste = Array.isArray(source.adversaires) ? (source.adversaires as unknown[]) : [];
  if (liste.length === 0 || liste.length > 12) problemes.push(`${where} : de 1 à 12 adversaires attendus`);
  const vus = new Set<string>();
  const adversaires: Adversaire[] = [];
  liste.slice(0, 12).forEach((item, index) => {
    const ici = `adversaire n° ${index + 1}`;
    const a = objet(item);
    const avant = problemes.length;
    if (typeof a.id !== 'string' || !ID.test(a.id) || vus.has(a.id)) problemes.push(`${ici} : id invalide ou en double`);
    else vus.add(a.id);
    if (!texte(a.nom, 24)) problemes.push(`${ici} : nom manquant (24 signes au plus)`);
    if (!texte(a.phrase, 60)) problemes.push(`${ici} : phrase manquante (60 signes au plus)`);
    if (!vehicules.some((v) => v.id === a.vehicule)) problemes.push(`${ici} : véhicule « ${String(a.vehicule)} » absent du catalogue`);
    if (typeof a.couleur !== 'string' || !HEX.test(a.couleur)) problemes.push(`${ici} : couleur #rrggbb attendue`);
    if (problemes.length === avant) {
      adversaires.push({ id: a.id as string, nom: (a.nom as string).trim(), phrase: (a.phrase as string).trim(), vehicule: a.vehicule as string, couleur: (a.couleur as string).toLowerCase() });
    }
  });
  const brutNiveaux = Array.isArray(source.niveaux) ? (source.niveaux as unknown[]) : [];
  if (brutNiveaux.length < 2 || brutNiveaux.length > 4) problemes.push(`${where} : de 2 à 4 niveaux attendus`);
  const niveaux: NiveauDuel[] = [];
  const paliers = new Set<string>();
  brutNiveaux.slice(0, 4).forEach((item, index) => {
    const ici = `niveau n° ${index + 1}`;
    const n = objet(item);
    const avant = problemes.length;
    if (typeof n.id !== 'string' || !ID.test(n.id) || niveaux.some((x) => x.id === n.id)) problemes.push(`${ici} : id invalide ou en double`);
    if (!texte(n.label, 12)) problemes.push(`${ici} : libellé manquant (12 signes au plus)`);
    if (!texte(n.phrase, 32)) problemes.push(`${ici} : phrase manquante (32 signes au plus)`);
    if (!MEDAILLES.includes(n.gains as Medaille) || paliers.has(n.gains as string)) problemes.push(`${ici} : gains bronze, argent ou or, un niveau par palier`);
    else paliers.add(n.gains as string);
    if (!nombre(n.allure, 0.6, 1)) problemes.push(`${ici} : allure entre 0,6 et 1`);
    if (!nombre(n.freinage, 0.4, 0.9)) problemes.push(`${ici} : freinage entre 0,4 et 0,9`);
    if (!nombre(n.irregularite, 0, 0.1)) problemes.push(`${ici} : irregularite entre 0 et 0,1`);
    if (n.nos !== 0 && !nombre(n.nos, 50, 3000)) problemes.push(`${ici} : nos 0 (jamais) ou entre 50 et 3 000 m`);
    if (!nombre(n.audace, 0, 100)) problemes.push(`${ici} : audace entre 0 et 100`);
    if (problemes.length === avant) {
      niveaux.push({ id: n.id as string, label: (n.label as string).trim(), phrase: (n.phrase as string).trim(), gains: n.gains as Medaille, allure: n.allure as number, freinage: n.freinage as number, irregularite: n.irregularite as number, nos: n.nos as number, audace: n.audace as number });
    }
  });
  if (!niveaux.some((n) => n.id === source.niveauParDefaut)) problemes.push(`${where} : niveauParDefaut doit nommer un niveau`);
  const p = objet(source.pilotage);
  if (!nombre(p.section, 30, 1000)) problemes.push(`${where} : pilotage.section entre 30 et 1 000 m`);
  if (!nombre(p.nosRayon, 50, 5000) || !nombre(p.nosDepart, 0, 2000)) problemes.push(`${where} : pilotage.nosRayon (50 à 5 000 m) et pilotage.nosDepart (0 à 2 000 m)`);
  const c = objet(source.contact);
  if (!nombre(c.garde, 0, 1.5)) problemes.push(`${where} : contact.garde entre 0 et 1,5 m`);
  if (!nombre(c.approche, 0, 40) || !nombre(c.relache, 0, 60) || (c.relache as number) < (c.approche as number)) problemes.push(`${where} : contact.approche et contact.relache (relache ≥ approche)`);
  if (!nombre(c.ecartParSeconde, 0.5, 10)) problemes.push(`${where} : contact.ecartParSeconde entre 0,5 et 10 m/s`);
  if (!nombre(c.frottement, 0, 10) || !nombre(c.cedeParSeconde, 0.5, 20)) problemes.push(`${where} : contact.frottement (0 à 10 m/s²) et contact.cedeParSeconde (0,5 à 20 m/s)`);
  const son = objet(source.son);
  if (!nombre(son.niveau, 0, 1) || !nombre(son.proche, 1, 50) || !nombre(son.portee, 20, 1000) || (son.portee as number) <= (son.proche as number) || !nombre(son.derriere, 300, 20000)) problemes.push(`${where} : son.niveau (0 à 1), son.proche (1 à 50 m), son.portee (20 à 1 000 m, au-delà de proche), son.derriere (300 à 20 000 Hz)`);
  // Les réglages d'approche, absents d'un ancien fichier, prennent leur valeur par défaut.
  const approche = { chute: son.chute ?? SON_DEFAUT.chute, approche: son.approche ?? SON_DEFAUT.approche, hauteur: son.hauteur ?? SON_DEFAUT.hauteur, vitesseRef: son.vitesseRef ?? SON_DEFAUT.vitesseRef, lissage: son.lissage ?? SON_DEFAUT.lissage };
  if (!nombre(approche.chute, 1, 3) || !nombre(approche.approche, 0, 0.6) || !nombre(approche.hauteur, 0, 0.1) || !nombre(approche.vitesseRef, 5, 100) || !nombre(approche.lissage, 0.05, 2)) problemes.push(`${where} : son.chute (1 à 3), son.approche (0 à 0,6), son.hauteur (0 à 0,1), son.vitesseRef (5 à 100 m/s), son.lissage (0,05 à 2 s)`);
  const pilote = objet(source.pilote);
  if (pilote.passe !== undefined && (typeof pilote.passe !== 'string' || !/^[a-z]{2,24}$/.test(pilote.passe))) problemes.push(`${where} : pilote.passe, l'id d'une passe du conducteur`);
  if (problemes.length > 0) return { ...vide, problemes };
  return {
    adversaires,
    niveaux,
    niveauParDefaut: source.niveauParDefaut as string,
    pilotage: { section: p.section as number, nosRayon: p.nosRayon as number, nosDepart: p.nosDepart as number },
    contact: { garde: c.garde as number, approche: c.approche as number, relache: c.relache as number, ecartParSeconde: c.ecartParSeconde as number, frottement: c.frottement as number, cedeParSeconde: c.cedeParSeconde as number },
    son: { niveau: son.niveau as number, proche: son.proche as number, portee: son.portee as number, derriere: son.derriere as number, ...(approche as ReglageApproche) },
    pilote: { passe: typeof pilote.passe === 'string' ? pilote.passe : null },
    problemes,
  };
}

const FICHIERS = import.meta.glob<unknown>('../../public/assets/adversaires/adversaires.json', { eager: true, import: 'default' });
const LECTURE = lireAdversaires(Object.values(FICHIERS)[0] ?? null, VEHICLES);

/** Les adversaires, dans l'ordre du fichier ; vide si le fichier manque ou s'il est refusé (pas de duel). */
export const ADVERSAIRES: readonly Adversaire[] = LECTURE.adversaires;
/** Les niveaux de difficulté, du plus facile au plus dur. */
export const NIVEAUX_DUEL: readonly NiveauDuel[] = LECTURE.niveaux;
export const PILOTAGE_ADVERSAIRE: ReglagePilotage = LECTURE.pilotage;
export const CONTACT_ADVERSAIRE: ReglageContact = LECTURE.contact;
export const SON_ADVERSAIRE: ReglageSon = LECTURE.son;
export const PILOTE_ADVERSAIRE: ReglagePilote = LECTURE.pilote;
/** Ce qui fait refuser le fichier (vide quand tout va bien). */
export const PROBLEMES_ADVERSAIRES: readonly string[] = LECTURE.problemes;

export function adversaireParId(id: string | null | undefined, liste: readonly Adversaire[] = ADVERSAIRES): Adversaire | undefined {
  return id ? liste.find((a) => a.id === id) : undefined;
}

/** Le niveau `id`, sinon celui par défaut du fichier ; `undefined` si le fichier est refusé. */
export function niveauDuel(id: string | null | undefined, liste: readonly NiveauDuel[] = NIVEAUX_DUEL, defaut: string = LECTURE.niveauParDefaut): NiveauDuel | undefined {
  return liste.find((n) => n.id === id) ?? liste.find((n) => n.id === defaut);
}

/**
 * Relit une sauvegarde du choix du duel (`pmb-duel`, src/drive/adversaire/choix.ts), quelle que soit sa forme.
 * Celle d'avant les niveaux (19 novembre 2026 : l'adversaire y portait sa médaille, et son id y était écrit même
 * sans choix) se relit sans erreur : le duel garde son état, l'adversaire repart « à ta mesure » (`null`), le
 * niveau par défaut (`null`). Un adversaire ou un niveau inconnus : `null`.
 */
export function relireChoixDuel(persisted: unknown, adversaires: readonly Adversaire[] = ADVERSAIRES, niveaux: readonly NiveauDuel[] = NIVEAUX_DUEL): { actif: boolean; adversaire: string | null; niveau: string | null } {
  const p = objet(persisted);
  const avantNiveaux = !('niveau' in p);
  return {
    actif: p.actif === true && adversaires.length > 0,
    adversaire: avantNiveaux ? null : (adversaireParId(typeof p.adversaire === 'string' ? p.adversaire : null, adversaires)?.id ?? null),
    niveau: niveaux.find((n) => n.id === p.niveau)?.id ?? null,
  };
}
