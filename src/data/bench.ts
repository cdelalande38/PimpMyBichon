// Modèle de banc d'essai du jalon 1 (placeholder_banc, déclaré dans TODO_ASSETS.md) : il tient
// la place des véhicules du catalogue pour régler le rendu. Licence CC-BY 4.0, crédit dans
// CREDITS.md. Tout ce qui lui est propre vit ici, jamais dans le composant qui l'affiche.

export interface BenchModel {
  id: string;
  /** Chemin du fichier sous le socle de l'app (servi par l'app, présent dans le précache). */
  file: string;
  /** Zones de carrosserie : noms exacts des matériaux du GLB, liées par défaut (§ 5.2). */
  paintZones: ReadonlyArray<{ id: string; materials: readonly string[] }>;
  /** Matériaux qui portent des logos (exclus de la licence) : remplacés par une plaque unie. */
  plainMaterials: readonly string[];
  /** Teinte de la plaque unie. */
  plainColor: string;
  /**
   * Textures qui portent des logos : matériau du GLB et emplacements three.js (`map`,
   * `normalMap`…). Toute texture qui partage l'une de ces images est retirée de tout le modèle :
   * le logo de la plaque est aussi posé en émissif sur l'emblème du volant, les étriers et les
   * centres de roue ; celui des flancs de pneus est imprimé et en relief. `color` remplace la
   * couleur que donnait la texture retirée.
   */
  logoTextures: ReadonlyArray<{ material: string; maps: readonly string[]; color?: string }>;
  /**
   * Vitrages : la transmission du glTF (réfraction) coûte une seconde passe de rendu complète à
   * chaque image, soit une centaine d'appels de dessin de plus. Ils deviennent transparents et
   * teintés (un verre clair paraît laiteux sous les reflets du garage).
   */
  glass: { materials: readonly string[]; color: string; opacity: number };
  /** Demi-longueur attendue avant chargement (cadrage d'attente), en mètres. */
  halfLengthHint: number;
  /** Quart de tour à ajouter après la mise à plat, pour présenter l'avant à la caméra de départ. */
  yawQuarterTurns: number;
}

export const BENCH_MODEL: BenchModel = {
  id: 'carconcept',
  file: 'assets/bench/carconcept/CarConcept.glb',
  paintZones: [
    { id: 'principale', materials: ['Paint 1 Carmine'] },
    { id: 'secondaire', materials: ['Paint 2 Carmine'] },
  ],
  plainMaterials: ['License'],
  plainColor: '#d8d6cf',
  logoTextures: [
    { material: 'License', maps: ['map'] },
    { material: 'Tireside', maps: ['map', 'normalMap'], color: '#1a1a1c' },
  ],
  glass: { materials: ['Glass'], color: '#0c0e14', opacity: 0.55 },
  halfLengthHint: 2.3,
  yawQuarterTurns: 0,
};

/** Transcodeur des textures KTX2, servi par l'app sous ce dossier (plugin de vite.config.ts). */
export const BASIS_TRANSCODER_DIR = 'libs/basis/';
