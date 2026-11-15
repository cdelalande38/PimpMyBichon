// Réglages de l'app (§ 5.9). Module pur : types, valeurs d'origine et lecture tolérante.
// Les volumes et le pilote automatique arriveront avec le son et la sortie de nuit.

export const QUALITY_SETTINGS = ['auto', 'eco', 'standard', 'max'] as const;
export type QualitySetting = (typeof QUALITY_SETTINGS)[number];

export const TEXT_SIZES = ['normal', 'grand', 'tres-grand'] as const;
export type TextSize = (typeof TEXT_SIZES)[number];

export interface Settings {
  /** Qualité graphique : « auto » laisse l'app choisir entre les trois niveaux. */
  quality: QualitySetting;
  /** Rotation lente du véhicule au repos (toujours coupée si le système demande moins de mouvement). */
  autoRotate: boolean;
  /** La radio démarre toute seule (ouverture de l'app, fin d'un import, lien de pack). */
  autoPlay: boolean;
  /** Taille du texte de l'interface. */
  textSize: TextSize;
}

export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  quality: 'auto',
  autoRotate: true,
  autoPlay: true,
  textSize: 'normal',
});

function oneOf<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Lecture tolérante d'une sauvegarde : toute valeur inconnue ou abîmée retombe sur l'origine.
 * Une sauvegarde d'une version plus récente ou trafiquée ne doit jamais empêcher l'app de s'ouvrir.
 */
export function sanitizeSettings(raw: unknown): Settings {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    quality: oneOf(QUALITY_SETTINGS, source.quality, DEFAULT_SETTINGS.quality),
    autoRotate:
      typeof source.autoRotate === 'boolean' ? source.autoRotate : DEFAULT_SETTINGS.autoRotate,
    autoPlay: typeof source.autoPlay === 'boolean' ? source.autoPlay : DEFAULT_SETTINGS.autoPlay,
    textSize: oneOf(TEXT_SIZES, source.textSize, DEFAULT_SETTINGS.textSize),
  };
}
