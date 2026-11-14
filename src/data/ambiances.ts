// Ambiances lumineuses du garage (§ 4) : « Bichon » par défaut, « Néon », « Atelier ».
// Elles pilotent les sources du garage (spots, bandeaux, tubes, halos), les quatre vraies
// lumières, la sonde de réflexion (refaite à chaque changement) et l'étalonnage de l'image.
// Côté gauche et côté droit s'entendent vus depuis le canapé (caméra de départ).

export interface Ambiance {
  id: string;
  label: string;
  hint: string;
  /** Lumière du côté gauche : projecteur, bandeau, halos. */
  left: string;
  /** Lumière du côté droit. */
  right: string;
  /** Milieu de la pièce, là où gauche et droite se mêlent (passage magenta). */
  center: string;
  /** Passage entre la gauche et le centre (nappe violette du mur et du sol). */
  violet: string;
  /** Petits spots chauds de la retombée et du rail. */
  accent: string;
  /** Spots encastrés de la retombée du mur du fond, de gauche à droite. */
  spots: readonly [string, string, string];
  /** Cœur de leurs halos sur le mur : la teinte qui « brûle » au centre (cyan, blanc, orange). */
  spotCores: readonly [string, string, string];
  /** Force de leurs halos, de gauche à droite : un bleu pur paraît plus sombre qu'un blanc. */
  spotHaloGain: readonly [number, number, number];
  /** Multiplicateur des sources émissives (au-delà de 1, elles déclenchent le bloom). */
  spotGain: number;
  /** Bandeaux LED en haut des murs (0 : éteints). */
  stripGain: number;
  /** Tubes LED verticaux sur pied, couleurs en alternance (liste vide : pas de tubes). */
  standTubes: readonly string[];
  tubeGain: number;
  /** Force des halos additifs sur les murs et le sol. */
  haloGain: number;
  /** Lumière principale, au-dessus et devant le véhicule. */
  key: string;
  keyIntensity: number;
  /** Intensité des deux projecteurs colorés. */
  sideIntensity: number;
  /** Lumière d'ambiance : ciel, sol, intensité. */
  sky: string;
  ground: string;
  ambient: number;
  /** Fond, hors de la pièce. */
  night: string;
  /** Étalonnage : dominante des ombres et des hautes lumières, et sa force (0 : neutre). */
  grade: { shadows: string; highlights: string; amount: number };
  /** Force du bloom. */
  bloom: number;
}

export const AMBIANCES = [
  {
    id: 'bichon',
    label: 'Bichon',
    hint: 'Bleu à gauche, rouge à droite',
    left: '#3d34ff',
    right: '#ff1408',
    center: '#c030c0',
    violet: '#7e00e0',
    accent: '#ffb46a',
    spots: ['#2850ff', '#f7f5f1', '#ff1408'],
    spotCores: ['#50c8ff', '#ffffff', '#ffb020'],
    spotHaloGain: [2.4, 1, 1.5],
    spotGain: 9,
    stripGain: 5,
    standTubes: [],
    tubeGain: 6,
    haloGain: 1,
    key: '#f4eef0',
    keyIntensity: 9,
    sideIntensity: 7,
    sky: '#4a2fb0',
    ground: '#2a0618',
    ambient: 0.12,
    night: '#06040b',
    grade: { shadows: '#3a2cff', highlights: '#ff4fb0', amount: 0.22 },
    bloom: 0.85,
  },
  {
    id: 'neon',
    label: 'Néon',
    hint: 'Magenta et cyan, tubes sur pied',
    left: '#ff2bd6',
    right: '#12dcff',
    center: '#8a4dff',
    violet: '#6a2cff',
    accent: '#e9e4ff',
    spots: ['#ff2bd6', '#e9e4ff', '#12dcff'],
    spotCores: ['#ffb0f0', '#ffffff', '#b8f6ff'],
    spotHaloGain: [1.6, 1, 1.6],
    spotGain: 6,
    stripGain: 2.5,
    standTubes: ['#12dcff', '#ff2bd6'],
    tubeGain: 8,
    haloGain: 0.7,
    key: '#e9dcff',
    keyIntensity: 7,
    sideIntensity: 6,
    sky: '#3a2a90',
    ground: '#120a26',
    ambient: 0.1,
    night: '#05030c',
    grade: { shadows: '#2a3cff', highlights: '#ff3fd0', amount: 0.25 },
    bloom: 1,
  },
  {
    id: 'atelier',
    label: 'Atelier',
    hint: 'Blanc neutre, pour juger',
    left: '#f4f1ea',
    right: '#f4f1ea',
    center: '#f4f1ea',
    violet: '#f4f1ea',
    accent: '#fff6ec',
    spots: ['#fff6ec', '#ffffff', '#fff6ec'],
    spotCores: ['#ffffff', '#ffffff', '#ffffff'],
    spotHaloGain: [1, 1, 1],
    spotGain: 6,
    stripGain: 3,
    standTubes: [],
    tubeGain: 5,
    haloGain: 0.35,
    key: '#ffffff',
    keyIntensity: 16,
    sideIntensity: 9,
    sky: '#d6d4dc',
    ground: '#3a3832',
    ambient: 0.35,
    night: '#0b0b0f',
    grade: { shadows: '#808080', highlights: '#808080', amount: 0 },
    bloom: 0.6,
  },
] as const satisfies readonly Ambiance[];

export type AmbianceId = (typeof AMBIANCES)[number]['id'];

export const DEFAULT_AMBIANCE: AmbianceId = 'bichon';

export function ambiance(id: AmbianceId): Ambiance {
  return AMBIANCES.find((item) => item.id === id) ?? AMBIANCES[0];
}
