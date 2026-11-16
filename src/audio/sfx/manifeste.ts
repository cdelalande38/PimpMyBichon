// Index d'une famille de bruitages (public/assets/audio/sfx/<famille>/sfx.json), écrit par
// `npm run sons:build` (tools/sons/build.mjs) : un fichier par prise retenue, ses points de
// bouclage, son gain. Tout est fait de prises réelles ou générées hors de l'app : rien n'est
// synthétisé ici. Une entrée illisible est écartée (son emplacement reste muet), pas le reste.

/** Une boucle (roulement, vent, pluie, tunnel, NOS…). */
export interface SfxBoucle {
  emplacement: string;
  fichier: string;
  empreinte?: string;
  duree: number;
  /** Points de bouclage, en secondes dans le fichier. */
  boucle: readonly [number, number];
  /** Gain de lecture, en dB. */
  gain: number;
}

/** Un bruitage joué une fois (freinage, rapport, retour de flamme…). */
export interface SfxPonctuel {
  emplacement: string;
  fichier: string;
  empreinte?: string;
  duree: number;
  gain: number;
}

export interface SfxManifest {
  famille: string;
  boucles: readonly SfxBoucle[];
  ponctuels: readonly SfxPonctuel[];
}

/** Dossier des bruitages, relatif à la base de l'app. */
export const SFX_DIR = 'assets/audio/sfx/';

/** Adresse d'un fichier d'une famille de bruitages (avec l'empreinte du son, s'il en a une). */
export function sfxFileUrl(base: string, famille: string, fichier: string, empreinte?: string): string {
  return `${base}${SFX_DIR}${famille}/${fichier}${empreinte ? `?v=${empreinte}` : ''}`;
}

const FICHIER = /^[a-z0-9_-]+\.ogg$/;
const EMPLACEMENT = /^[a-z0-9_-]+$/;

function num(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function entree(raw: unknown): { emplacement: string; fichier: string; empreinte?: string; duree: number; gain: number } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const item = raw as Record<string, unknown>;
  if (typeof item.emplacement !== 'string' || !EMPLACEMENT.test(item.emplacement)) return null;
  if (typeof item.fichier !== 'string' || !FICHIER.test(item.fichier)) return null;
  if (!num(item.duree) || item.duree <= 0) return null;
  const empreinte = typeof item.empreinte === 'string' && /^[0-9a-f]{4,64}$/.test(item.empreinte) ? item.empreinte : undefined;
  return { emplacement: item.emplacement, fichier: item.fichier, ...(empreinte ? { empreinte } : {}), duree: item.duree, gain: num(item.gain) ? item.gain : 0 };
}

/**
 * Lit un sfx.json. Rend le manifeste (entrées illisibles écartées et comptées), ou null si le
 * fichier n'est pas un index de bruitages.
 */
export function parseSfxManifest(raw: unknown): { manifest: SfxManifest; ecartees: number } | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const data = raw as Record<string, unknown>;
  if (data.format !== 'pmb-sfx-sons' || data.version !== 1 || typeof data.famille !== 'string') return null;
  let ecartees = 0;
  const boucles: SfxBoucle[] = [];
  for (const raw of Array.isArray(data.boucles) ? data.boucles : []) {
    const base = entree(raw);
    const points = (raw as Record<string, unknown> | null)?.boucle;
    if (!base || !Array.isArray(points) || !num(points[0]) || !num(points[1]) || !(points[1] > points[0]) || points[0] < 0) {
      ecartees += 1;
      continue;
    }
    boucles.push({ ...base, boucle: [points[0], points[1]] });
  }
  const ponctuels: SfxPonctuel[] = [];
  for (const raw of Array.isArray(data.ponctuels) ? data.ponctuels : []) {
    const base = entree(raw);
    if (!base) ecartees += 1;
    else ponctuels.push(base);
  }
  return { manifest: { famille: data.famille, boucles, ponctuels }, ecartees };
}
