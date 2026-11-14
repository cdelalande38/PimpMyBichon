// Ambiances lumineuses du garage (§ 4) : « Bichon » par défaut, « Néon », « Atelier ».
// Au jalon 1, elles pilotent les tubes, les lumières et les reflets du décor de substitut.
// Côté gauche et côté droit s'entendent vus depuis le canapé (caméra de départ).

export interface Ambiance {
  id: string;
  label: string;
  hint: string;
  /** Lumière du côté gauche : tube, projecteur, panneau de reflet. */
  left: string;
  /** Lumière du côté droit. */
  right: string;
  /** Lumière principale, au-dessus et devant le véhicule. */
  key: string;
  keyIntensity: number;
  /** Intensité des deux projecteurs colorés. */
  sideIntensity: number;
  /** Multiplicateur des tubes émissifs (au-delà de 1, ils déclenchent le bloom). */
  tubeGain: number;
  /** Lumière d'ambiance : ciel, sol, intensité. */
  sky: string;
  ground: string;
  ambient: number;
  /** Fond et brouillard. */
  night: string;
}

export const AMBIANCES = [
  {
    id: 'bichon',
    label: 'Bichon',
    hint: 'Bleu à gauche, rouge à droite',
    left: '#3a4dff',
    right: '#ff1f2e',
    key: '#ffd9e8',
    keyIntensity: 220,
    sideIntensity: 110,
    tubeGain: 4,
    sky: '#8a6fb0',
    ground: '#15101c',
    ambient: 0.5,
    night: '#07050c',
  },
  {
    id: 'neon',
    label: 'Néon',
    hint: 'Magenta et cyan',
    left: '#ff2bd6',
    right: '#16e2ff',
    key: '#e9dcff',
    keyIntensity: 170,
    sideIntensity: 130,
    tubeGain: 7,
    sky: '#7d55b8',
    ground: '#0c0a18',
    ambient: 0.45,
    night: '#06040d',
  },
  {
    id: 'atelier',
    label: 'Atelier',
    hint: 'Blanc neutre, pour juger',
    left: '#f4f1ea',
    right: '#f4f1ea',
    key: '#ffffff',
    keyIntensity: 300,
    sideIntensity: 90,
    tubeGain: 4,
    sky: '#c9c8cf',
    ground: '#2a2830',
    ambient: 0.85,
    night: '#0b0b0f',
  },
] as const satisfies readonly Ambiance[];

export type AmbianceId = (typeof AMBIANCES)[number]['id'];

export const DEFAULT_AMBIANCE: AmbianceId = 'bichon';

export function ambiance(id: AmbianceId): Ambiance {
  return AMBIANCES.find((item) => item.id === id) ?? AMBIANCES[0];
}
