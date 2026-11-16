// Bruitages de route en sortie de nuit (§ 5.5 « Son », § 9 « Sur la route ») : qui joue quoi,
// quand, à quel niveau. Données lues par src/audio/sfx/route.ts ; les déclencheurs sont des
// fonctions pures (src/audio/sfx/regles.ts, tests/unit/sons-bruitages.test.ts). Les sons eux-mêmes
// sont des prises fabriquées par `npm run sons:build` (tools/sons/, famille « route ») : un
// emplacement sans fichier reste muet. Rien n'est synthétisé.

/** Météo vue par une boucle : chaussée sèche (neige comprise), mouillée, ou pluie qui tombe. */
export type MeteoBruitage = 'sec' | 'mouille' | 'pluie';

/** Boucle de route : jouée tant que ses conditions tiennent, niveau et hauteur suivant la vitesse. */
export interface BoucleRoute {
  /** Emplacement de la famille « route » (tools/sons/emplacements.mjs). */
  emplacement: string;
  /** Niveau le plus haut, de 0 à 1, avant le curseur « Route ». */
  niveau: number;
  /**
   * Niveau selon la vitesse : nul sous `seuil` km/h, plein à `ref` km/h, en puissance `puissance`
   * de la vitesse (1 : le roulement ; 2 : le vent, qui suit le carré de la vitesse). Absent : fixe.
   */
  vitesse?: { seuil: number; ref: number; puissance: 1 | 2 };
  /** Hauteur (vitesse de lecture) à l'arrêt et à `vitesse.ref`. */
  hauteur?: readonly [number, number];
  /** Météo voulue ; absente : par tous les temps. */
  meteo?: MeteoBruitage;
  /** Sous la neige : étouffé (filtre passe-bas, en Hz) et baissé. */
  neige?: { coupure: number; niveau: number };
  /** Sur chaussée mouillée : plus sourd (filtre passe-bas, en Hz) et baissé (facteur de niveau). */
  mouille?: { coupure: number; niveau: number };
  /** « dehors » : jamais sous un tunnel ; « dessous » : seulement sous la voûte. */
  abri?: 'dehors' | 'dessous';
  /** Seulement pendant la poussée du NOS. */
  nos?: boolean;
  /** Piloté par la glisse des pneus (de 0 à 1) plutôt que par la vitesse : voir `Glisse`. */
  glisse?: Glisse;
}

/**
 * Boucle de glisse des pneus (le crissement long). La glisse brute (0 : les pneus tiennent, 1 : ils
 * glissent franchement ; publiée par le pilote ou estimée, cf. `ESTIMATION_GLISSE`) passe par une
 * hystérésis (elle s'allume au-dessus de `seuil`, ne s'éteint qu'au-dessous de `seuil - hysteresis` :
 * pas de mitraillage quand elle oscille autour du seuil), puis par une attaque et un relâchement doux.
 * Le niveau monte de 0 (à `seuil - hysteresis`) à 1 (glisse pleine) ; la hauteur suit la glisse.
 */
export interface Glisse {
  seuil: number;
  hysteresis: number;
  /** Rien en dessous de cette vitesse (km/h) : le véhicule qui frotte à l'arrêt ne crisse pas. */
  vitesseMin: number;
  /** Constantes de temps de la montée et de la descente du niveau suivi (s). */
  attaque: number;
  relache: number;
  /** Hauteur (vitesse de lecture) à glisse faible et à glisse pleine. */
  hauteur: readonly [number, number];
}

/**
 * Estimation de la glisse quand le pilote ne la publie pas (`DriveMotion.slip` absent) : accélération
 * latérale = vitesse² × courbure suivie (tan du braquage ÷ empattement), rapportée à l'adhérence du
 * véhicule (`performance.grip`). Nulle sous `marge` de l'adhérence, pleine à `marge + plage`.
 * Les empattements reprennent PILOT.steer.wheelbase (src/drive/pilote.ts) : un test les compare.
 */
export const ESTIMATION_GLISSE = {
  marge: 0.9,
  plage: 0.4,
  empattement: { car: 2.6, bike: 1.45 },
  /** Adhérence d'un véhicule qui n'en déclare pas (m/s²). */
  gripDefaut: 4.5,
} as const;

/** Ce qui fait partir un bruitage ponctuel. */
export type Declencheur =
  /** Forte décélération (m/s², positive) au-dessus d'une vitesse (km/h). */
  | { type: 'freinage'; deceleration: number; vitesseMin: number }
  /** Passage de rapport : front montant de `train.shifting`. */
  | { type: 'rapport' }
  /** Coup d'envoi du NOS : front montant de `train.nos`, une fois par poussée. */
  | { type: 'nos' }
  /** Départ arrêté : un feu rouge de plus s'allume (src/drive/depart.ts). */
  | { type: 'feu-rouge' }
  /** Départ arrêté : le feu vert s'allume. */
  | { type: 'feu-vert' }
  /** Lever de pied à haut régime (part du rupteur), au hasard (`chance` par lever). */
  | { type: 'leve-pied'; regimeMin: number; chance: number };

/** Bruitage ponctuel. */
export interface PonctuelRoute {
  emplacement: string;
  /** Famille qui le porte : la route, ou la famille du moteur du véhicule (repli sur la route). */
  famille: 'route' | 'moteur';
  declencheur: Declencheur;
  /** Niveau, de 0 à 1, avant le curseur « Route ». */
  niveau: number;
  /** Délai minimal entre deux départs, en secondes. */
  attente: number;
}

/** Famille de bruitages jouée en sortie (tools/sons/emplacements.mjs, public/assets/audio/sfx/route/). */
export const FAMILLE_ROUTE = 'route';

/** Montée et descente des boucles quand leurs conditions changent, en secondes. */
export const FONDU_BOUCLES = 0.4;

export const BOUCLES_ROUTE: readonly BoucleRoute[] = Object.freeze([
  { emplacement: 'roulement-sec', niveau: 0.85, vitesse: { seuil: 3, ref: 90, puissance: 1 }, hauteur: [0.8, 1.2], meteo: 'sec', neige: { coupure: 700, niveau: 0.7 } },
  { emplacement: 'roulement-mouille', niveau: 0.85, vitesse: { seuil: 3, ref: 90, puissance: 1 }, hauteur: [0.85, 1.15], meteo: 'mouille' },
  { emplacement: 'vent', niveau: 0.75, vitesse: { seuil: 15, ref: 130, puissance: 2 }, hauteur: [0.9, 1.15] },
  { emplacement: 'pluie', niveau: 0.55, meteo: 'pluie', abri: 'dehors' },
  { emplacement: 'tunnel', niveau: 0.6, abri: 'dessous' },
  { emplacement: 'nos', niveau: 0.9, nos: true },
  // Crissement long : les pneus qui glissent. Plus sourd et plus bas sur le mouillé, presque rien
  // sur la neige ; aucune dépendance au tunnel (c'est le véhicule qui crisse, pas le décor).
  {
    emplacement: 'derapage-long',
    niveau: 0.8,
    glisse: { seuil: 0.3, hysteresis: 0.12, vitesseMin: 20, attaque: 0.15, relache: 0.5, hauteur: [0.85, 1.2] },
    mouille: { coupure: 2200, niveau: 0.7 },
    neige: { coupure: 1200, niveau: 0.1 },
  },
] satisfies BoucleRoute[]);

export const PONCTUELS_ROUTE: readonly PonctuelRoute[] = Object.freeze([
  { emplacement: 'freinage', famille: 'route', declencheur: { type: 'freinage', deceleration: 5, vitesseMin: 35 }, niveau: 0.75, attente: 2.5 },
  { emplacement: 'derapage-court', famille: 'route', declencheur: { type: 'freinage', deceleration: 6.5, vitesseMin: 55 }, niveau: 0.7, attente: 3 },
  { emplacement: 'rapport', famille: 'route', declencheur: { type: 'rapport' }, niveau: 0.55, attente: 0.25 },
  // Coup sec à l'instant où le NOS part, en plus de la boucle « nos » qui continue pendant la poussée.
  { emplacement: 'nos-depart', famille: 'route', declencheur: { type: 'nos' }, niveau: 0.85, attente: 0.8 },
  // Départ arrêté : un bip bref à chaque feu rouge, un bip plus long et plus aigu au vert.
  { emplacement: 'depart-feu', famille: 'route', declencheur: { type: 'feu-rouge' }, niveau: 0.8, attente: 0.3 },
  { emplacement: 'depart-vert', famille: 'route', declencheur: { type: 'feu-vert' }, niveau: 0.9, attente: 0.3 },
  { emplacement: 'backfire', famille: 'moteur', declencheur: { type: 'leve-pied', regimeMin: 0.75, chance: 0.3 }, niveau: 0.8, attente: 4 },
] satisfies PonctuelRoute[]);
