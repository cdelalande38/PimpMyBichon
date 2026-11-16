// Prises de diagnostic de la scène de sortie : remplies par la scène montée, lues par la page
// d'aperçu (src/dev/sortie/) et les captures. L'app ne s'en sert pas.

export interface DriveMeasure {
  /** Image vue par la caméra, véhicule masqué : le décor seul. */
  decor: { calls: number; triangles: number };
  /** Image entière (décor, véhicule, pluie, faisceaux), passe principale seule. */
  total: { calls: number; triangles: number };
  /** Tronçons chargés, et leurs triangles déclarés par la carte. */
  chunks: number;
  chunkTriangles: number;
  /** Lampadaires des tronçons chargés, et ceux qui éclairent la chaussée en ce moment. */
  lamps: number;
  lampLights: number;
  wheels: number;
  level: string;
  /** Tampons de la sortie : cible du reflet planaire (pixels, 0 s'il n'est pas rendu), face de la sonde. */
  buffers?: { reflection: [number, number]; probe: number };
}

export interface DriveDebug {
  /** Repart de l'abscisse `s` (pilote remis à zéro, puis lancé à `speedKmh`). */
  seek?: (s: number, speedKmh?: number) => void;
  measure?: () => DriveMeasure;
  /** Vrai quand la fenêtre de tronçons autour du véhicule est entièrement chargée. */
  settled?: () => boolean;
  /** La scène three et les uniformes de nuit, pour un diagnostic à la main (page d'aperçu). */
  scene?: unknown;
  uniforms?: unknown;
  /** La caméra de la scène et la sonde de terrain (garde au sol), pour un diagnostic. */
  camera?: unknown;
  relief?: unknown;
  /**
   * Postes de coût coupés pour la mesure (page d'aperçu) : « reflet » (reflet planaire), « sonde »
   * (sonde de réflexion), « gouttes » (pluie ou neige qui tombe), « mouille » (matières mouillées),
   * « garde » (garde de cadence de la météo : pour mesurer le coût entier de la pluie).
   */
  off?: Partial<Record<'reflet' | 'sonde' | 'gouttes' | 'mouille' | 'garde', boolean>>;
  /** Temps arrêté (le véhicule ne bouge plus, l'image continue d'être rendue) : mesure du scintillement. */
  figer?: boolean;
  /** Appelé après chaque image composée (lecture des pixels de l'image, page d'aperçu). */
  afterFrame?: (gl: unknown) => void;
  /** Appelé avant chaque image, avant la boucle de la scène (chronomètre du processeur graphique). */
  beforeFrame?: (gl: unknown) => void;
}

export const driveDebug: DriveDebug = {};
