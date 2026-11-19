// Contrat du jeu (ouvert le 17 novembre 2026 à la demande du commanditaire, cahier des charges § 5.5) :
// les types que partagent la course (src/drive/, src/ui/drive/), l'économie (src/jeu/) et ce qui se
// débloque (stickers, pièces, entrées du menu). Aucune logique ici.
//
// Le déroulé : une course se termine → la course fabrique un `ResultatCourse` → `cloturerCourse`
// (src/jeu/bilan.ts) rend le `Bilan` (gains, hauts faits, déblocages) et l'enregistre → l'écran de fin
// l'affiche. Ce qui se possède s'interroge par `possede` (src/jeu/bilan.ts).

/** Balade : la conduite libre d'aujourd'hui, sans gain. Course : un tour, ou trois sur une carte en boucle. Drift : un tour, au score. */
export type FormatCourse = 'balade' | 'tour1' | 'tours3' | 'drift';

export interface FormatSpec {
  id: FormatCourse;
  label: string;
  /** Nombre de tours ; `null` pour la balade. Sur une route ouverte, un « tour » est un passage du départ à l'arrivée. */
  tours: number | null;
  /** Vrai : ne se court que sur une carte en boucle (`MapRoute.loop`). */
  boucleSeulement: boolean;
}

export type MeteoCourse = 'sec' | 'pluie' | 'neige';
export type MomentCourse = 'nuit' | 'jour';
export type Medaille = 'or' | 'argent' | 'bronze';

/** Ce que la course a mesuré, pour les gains et les hauts faits. Tout est en unités SI, sauf la vitesse. */
export interface StatsCourse {
  /** Distance parcourue, en mètres. */
  distance: number;
  /** Vitesse la plus haute atteinte, en km/h. */
  vitesseMax: number;
  /** Distance passée en dérapage, en mètres. */
  glisse: number;
  /** Nombre de chocs contre le bord de la route. */
  chocs: number;
  /** Nombre de poussées de NOS. */
  nos: number;
}

export interface ResultatCourse {
  carte: string;
  depart: string;
  vehicule: string;
  format: Exclude<FormatCourse, 'balade'>;
  meteo: MeteoCourse;
  moment: MomentCourse;
  /** Temps total, en secondes, du vert à la ligne d'arrivée. */
  temps: number;
  /** Temps de chaque tour, en secondes (un seul élément pour un tour). */
  tours: readonly number[];
  /** Meilleur temps personnel d'avant cette course pour la même carte, le même départ et le même format ; `null` s'il n'y en avait pas. */
  ancienRecord: number | null;
  /** Médaille obtenue d'après les temps de référence de la carte ; `null` si aucune. */
  medaille: Medaille | null;
  stats: StatsCourse;
  /** Format « Drift » : le score (la médaille se prend sur lui) ; absent dans les autres formats. */
  drift?: StatsDrift;
}

/** Ce que les drifts d'une course ont rapporté (src/jeu/drift.ts). */
export interface StatsDrift {
  /** Score total, en points. */
  score: number;
  /** Le meilleur drift (multiplicateur compris), en points. */
  meilleur: number;
  /** Le plus long drift, en secondes. */
  plusLong: number;
  /** Drifts comptés. */
  nombre: number;
  /** Multiplicateur le plus haut atteint. */
  multMax: number;
}

export interface LigneGain {
  /** Ce qui rapporte, en clair (« Course finie », « Médaille d'or », « Record battu »…). */
  motif: string;
  dollars: number;
}

export interface Gains {
  dollars: number;
  detail: readonly LigneGain[];
}

/** Ce qui se gagne ou s'achète : identifiant stable, rangé par famille. */
export type FamilleArticle = 'sticker' | 'pack' | 'entree' | 'piece' | 'carte';

export interface Article {
  id: string;
  famille: FamilleArticle;
  label: string;
  /** Prix en dollars ; `null` : ne s'achète pas, se gagne par un haut fait. */
  prix: number | null;
}

export interface Recompense {
  dollars?: number;
  /** Identifiants d'articles offerts. */
  articles?: readonly string[];
}

export interface HautFait {
  id: string;
  label: string;
  /** Ce qu'il faut faire, en une phrase tutoyée. */
  description: string;
  recompense: Recompense;
}

/** Ce que l'écran de fin affiche : le résultat, les gains, ce qui vient d'être obtenu. */
export interface Bilan {
  resultat: ResultatCourse;
  gains: Gains;
  /** Solde après la course, en dollars. */
  solde: number;
  /** Hauts faits obtenus par cette course. */
  hautsFaits: readonly HautFait[];
  /** Articles débloqués par cette course (par les hauts faits). */
  deblocages: readonly Article[];
}
