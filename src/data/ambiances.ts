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
  /**
   * Brume du fond : la couleur où se perdent le sol et le plafond prolongés hors de la pièce,
   * et celle du brouillard. Violet très sombre, jamais noir.
   */
  night: string;
  /** Rampes lumineuses douces au-dessus du véhicule : couleur et force (longs reflets sur la caisse). */
  bar: string;
  barGain: number;
  /** Part du reflet de l'environnement propre à la carrosserie (multiplie celle de la finition). */
  bodyEnv: number;
  /** Exposition de l'image, avant le tone mapping. */
  exposure: number;
  /** Atmosphère : force des cônes de lumière sous les spots et des nappes au ras du sol. */
  beamGain: number;
  mistGain: number;
  /**
   * Étalonnage, fabriqué en table de correspondance (src/render/lut.ts) : dominante des ombres
   * et des hautes lumières, sa force (0 : neutre), saturation et contraste (1 : inchangés).
   */
  grade: { shadows: string; highlights: string; amount: number; saturation: number; contrast: number };
  /** Force du bloom. */
  bloom: number;
}

export const AMBIANCES = [
  {
    id: 'bichon',
    label: 'Bichon',
    hint: 'Bleu à gauche, rouge à droite',
    left: '#3424ff',
    right: '#ff1408',
    center: '#c030c0',
    violet: '#6a10ff',
    accent: '#ffb46a',
    spots: ['#2850ff', '#f7f5f1', '#ff1408'],
    spotCores: ['#50c8ff', '#ffffff', '#ffb020'],
    spotHaloGain: [1.0, 0.85, 1.3],
    spotGain: 9,
    stripGain: 5,
    standTubes: [],
    tubeGain: 6,
    haloGain: 1,
    key: '#f2f2ee',
    keyIntensity: 5,
    sideIntensity: 5,
    sky: '#4a2fb0',
    ground: '#2a0618',
    ambient: 0.06,
    night: '#170a28',
    bar: '#fdfcff',
    barGain: 12,
    bodyEnv: 2.7,
    exposure: 0.85,
    beamGain: 0.45,
    mistGain: 0.25,
    grade: { shadows: '#5a50c8', highlights: '#b860e0', amount: 0.15, saturation: 1.35, contrast: 1.08 },
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
    spotHaloGain: [1.1, 0.8, 1.1],
    spotGain: 6,
    stripGain: 2.5,
    standTubes: ['#12dcff', '#ff2bd6'],
    tubeGain: 8,
    haloGain: 0.6,
    key: '#e9dcff',
    keyIntensity: 5,
    sideIntensity: 5,
    sky: '#3a2a90',
    ground: '#120a26',
    ambient: 0.07,
    night: '#130a2a',
    bar: '#f8f4ff',
    barGain: 9,
    bodyEnv: 2,
    exposure: 0.9,
    beamGain: 0.45,
    mistGain: 0.3,
    grade: { shadows: '#5060d0', highlights: '#b070e0', amount: 0.2, saturation: 1.1, contrast: 1.04 },
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
    night: '#1d1a26',
    bar: '#ffffff',
    barGain: 7,
    bodyEnv: 1.7,
    exposure: 1,
    beamGain: 0.12,
    mistGain: 0.08,
    grade: { shadows: '#808080', highlights: '#808080', amount: 0, saturation: 1, contrast: 1 },
    bloom: 0.6,
  },
] as const satisfies readonly Ambiance[];

export type AmbianceId = (typeof AMBIANCES)[number]['id'];

export const DEFAULT_AMBIANCE: AmbianceId = 'bichon';

export function ambiance(id: AmbianceId): Ambiance {
  return AMBIANCES.find((item) => item.id === id) ?? AMBIANCES[0];
}
