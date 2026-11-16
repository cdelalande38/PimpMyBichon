// Manifeste d'un jeu de sons de moteur (public/assets/audio/engines/<famille>/engine.json), écrit
// par `npm run sons:build` (tools/sons/build.mjs) : régime réel de chaque boucle, points de
// bouclage, gains, auteur et licence de chaque prise. Tout est fait d'enregistrements réels.

import index from './familles.json';

/** Une boucle : un régime tenu (ou le ralenti), jouée en boucle et accordée par playbackRate. */
export interface EngineLoop {
  emplacement: string;
  fichier: string;
  /** Empreinte du fichier : ajoutée à son adresse, un son refait n'est jamais servi d'un vieux cache. */
  empreinte?: string;
  /** Régime réel de l'enregistrement, en tr/min. */
  regime: number;
  /** Points de bouclage, en secondes dans le fichier. */
  boucle: readonly [number, number];
  /** Gain de lecture, en dB (le niveau est déjà égalisé à la fabrication). */
  gain: number;
  /** Couche « en charge » ou « en décélération » ; absente : les deux. */
  couche?: 'on' | 'off';
  credit: number;
}

/** Un son joué une fois : démarrage, coupure, coup de gaz, retour de flamme, montée. */
export interface EngineOneShot {
  emplacement: string;
  fichier: string;
  empreinte?: string;
  duree: number;
  gain: number;
  credit: number;
}

export interface EngineCredit {
  auteur: string;
  /** Forme de CREDITS.md : « CC0-1.0 », « CC-BY-3.0 », « CC-BY-4.0 ». */
  licence: string;
  source: string;
  /** La licence demande de citer l'auteur. */
  citer: boolean;
}

export interface EngineSoundManifest {
  famille: string;
  nom: string;
  provisoire: boolean;
  /** Régime de ralenti, en tr/min. */
  ralenti: number;
  /**
   * Coup de gaz au garage : « boucles » (le régime monte tant qu'on appuie, fondu entre boucles
   * voisines) ou « prises » (un coup de gaz enregistré, quand il n'y a qu'une boucle de ralenti).
   */
  gaz: 'boucles' | 'prises';
  boucles: readonly EngineLoop[];
  ponctuels: readonly EngineOneShot[];
  credits: readonly EngineCredit[];
}

/** Dossier des jeux de sons, relatif à la base de l'app. */
export const ENGINES_DIR = 'assets/audio/engines/';

/** Familles qui ont des sons fabriqués (src/audio/engine/familles.json, écrit par sons:build). */
export const FAMILLES_SONORES: Readonly<Record<string, { nom: string; provisoire: boolean; boucles: number; ponctuels: number }>> = index.familles;

/** Crédits à citer (licences CC BY), tous jeux confondus, pour « Sous le capot ». */
export const ATTRIBUTIONS_SONS: readonly { famille: string; nom: string; auteur: string; licence: string; source: string; emplacements: readonly string[] }[] =
  index.attributions;

/** La famille a des sons fabriqués. */
export function hasEngineSounds(famille: string | undefined | null): famille is string {
  return typeof famille === 'string' && Object.hasOwn(FAMILLES_SONORES, famille);
}

/** Adresse d'un fichier d'un jeu, relative à la base de l'app (avec l'empreinte du son, s'il en a une). */
export function engineFileUrl(base: string, famille: string, fichier: string, empreinte?: string): string {
  return `${base}${ENGINES_DIR}${famille}/${fichier}${empreinte ? `?v=${empreinte}` : ''}`;
}

function num(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function text(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Nom de fichier simple d'un son du jeu : pas de dossier, Opus dans Ogg. */
const FICHIER = /^[a-z0-9_-]+\.ogg$/;

/**
 * Lit un engine.json. Rend le manifeste, ou la liste des problèmes (le jeu reste alors muet).
 */
export function parseEngineManifest(raw: unknown): { manifest: EngineSoundManifest } | { problems: string[] } {
  const problems: string[] = [];
  if (typeof raw !== 'object' || raw === null) return { problems: ['le manifeste doit être un objet'] };
  const data = raw as Record<string, unknown>;
  if (data.format !== 'pmb-engine-sons' || data.version !== 1) problems.push('format « pmb-engine-sons », version 1 attendus');
  if (!text(data.famille)) problems.push('famille manquante');
  const credits = Array.isArray(data.credits) ? data.credits : [];
  credits.forEach((credit: Record<string, unknown>, index) => {
    if (!text(credit?.auteur) || !text(credit?.licence) || !text(credit?.source)) problems.push(`crédit n° ${index + 1} incomplet`);
  });
  const creditOk = (value: unknown) => num(value) && Number.isInteger(value) && value >= 0 && value < credits.length;
  const boucles = Array.isArray(data.boucles) ? data.boucles : [];
  boucles.forEach((loop: Record<string, unknown>, index) => {
    const where = `boucle n° ${index + 1}`;
    if (!text(loop?.fichier) || !FICHIER.test(loop.fichier)) problems.push(`${where} : fichier illisible`);
    if (!num(loop?.regime) || loop.regime < 200 || loop.regime > 20000) problems.push(`${where} : régime illisible`);
    const points = loop?.boucle;
    if (!Array.isArray(points) || points.length !== 2 || !num(points[0]) || !num(points[1]) || !(points[1] > points[0]) || points[0] < 0) {
      problems.push(`${where} : points de bouclage illisibles`);
    }
    if (!num(loop?.gain)) problems.push(`${where} : gain illisible`);
    if (!creditOk(loop?.credit)) problems.push(`${where} : crédit introuvable`);
    if (loop?.couche !== undefined && loop.couche !== 'on' && loop.couche !== 'off') problems.push(`${where} : couche « on » ou « off »`);
  });
  const ponctuels = Array.isArray(data.ponctuels) ? data.ponctuels : [];
  ponctuels.forEach((shot: Record<string, unknown>, index) => {
    const where = `son ponctuel n° ${index + 1}`;
    if (!text(shot?.fichier) || !FICHIER.test(shot.fichier)) problems.push(`${where} : fichier illisible`);
    if (!text(shot?.emplacement)) problems.push(`${where} : emplacement manquant`);
    if (!num(shot?.duree) || shot.duree <= 0) problems.push(`${where} : durée illisible`);
    if (!num(shot?.gain)) problems.push(`${where} : gain illisible`);
    if (!creditOk(shot?.credit)) problems.push(`${where} : crédit introuvable`);
  });
  const idle = boucles.find((loop: Record<string, unknown>) => loop?.emplacement === 'idle');
  if (!idle) problems.push('pas de boucle de ralenti (« idle ») : le moteur ne peut pas tourner');
  const ralenti = num(data.ralenti) ? data.ralenti : num(idle?.regime) ? idle.regime : NaN;
  if (!num(ralenti)) problems.push('régime de ralenti illisible');
  const gaz = data.gaz === 'prises' || data.gaz === 'boucles' ? data.gaz : boucles.length >= 2 ? 'boucles' : 'prises';
  if (problems.length > 0) return { problems };
  return {
    manifest: {
      famille: data.famille as string,
      nom: text(data.nom) ? data.nom : (data.famille as string),
      provisoire: data.provisoire === true,
      ralenti,
      gaz,
      boucles: [...(boucles as EngineLoop[])].sort((a, b) => a.regime - b.regime),
      ponctuels: ponctuels as EngineOneShot[],
      credits: credits as EngineCredit[],
    },
  };
}

/** Nom en clair d'un emplacement, pour les crédits. */
const EMPLACEMENT_LABEL: Record<string, string> = {
  start: 'démarrage',
  idle: 'ralenti',
  rev: 'coups de gaz',
  stop: 'coupure',
  low: 'régime bas',
  mid: 'régime moyen',
  high: 'régime haut',
  sweep_up: 'montée',
  sweep_down: 'descente',
  backfire: 'retours de flamme',
};

/** « CC-BY-3.0 » → « CC BY 3.0 », insécable avant la version. */
function licenceLabel(code: string): string {
  return code.replace(/^CC-BY-/, 'CC\u00a0BY\u00a0').replace(/^CC0-1\.0$/, 'CC0');
}

/**
 * Crédits des sons dont la licence demande de citer l'auteur, en texte, sans adresse : une phrase
 * par prise (« 4 cylindres turbo diesel (le van), démarrage et coupure : prise de X (Freesound n),
 * CC BY 3.0. »). Vide si aucune prise ne le demande.
 */
export function soundCreditsText(attributions = ATTRIBUTIONS_SONS): string {
  if (attributions.length === 0) return '';
  const lines = attributions.map((item) => {
    const slots = [...new Set(item.emplacements.map((slot) => EMPLACEMENT_LABEL[slot.replace(/-\d+$/, '')] ?? slot))];
    return `${item.nom}, ${slots.join(' et ')} : prise de ${item.auteur} (${item.source}), ${licenceLabel(item.licence)}.`;
  });
  return `Sons de moteur enregistrés, cités comme leur licence le demande : ${lines.join(' ')} Les autres prises sont dans le domaine public (CC0) ; détail dans CREDITS.md.`;
}
