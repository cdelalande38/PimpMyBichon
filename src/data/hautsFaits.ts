// Les hauts faits, en données (§ 5.5, jeu). Chacun a des conditions déclaratives : une liste de tests
// (tous doivent tenir) sur la course qui vient de finir (`course.*`) ou sur les cumuls de toutes les
// courses, celle-ci comprise (`cumul.*`). Le lecteur est src/jeu/hautsFaits.ts ; ici, aucune logique.
// Un haut fait s'obtient une seule fois. Sa récompense : des dollars, des articles (stickers de trophée
// de src/data/boutique.ts). Textes courts, tutoiement. Aucun identifiant de carte ni de véhicule : « chaque
// carte » se dit `toutesLesCartes`, d'après le catalogue.

import type { HautFait } from '../jeu/contrat.ts';

/** Ce qu'un test peut lire. Les durées en secondes, les distances en mètres, la vitesse en km/h. */
export const CHAMPS = [
  // La course qui vient de finir.
  'course.temps',
  'course.distance',
  'course.vitesseMax',
  'course.glisse',
  'course.chocs',
  'course.nos',
  'course.tours',
  'course.format',
  'course.meteo',
  'course.moment',
  /** 0 : aucune médaille ; 1 : bronze ; 2 : argent ; 3 : or. */
  'course.rangMedaille',
  /** 1 si un record personnel vient d'être battu, sinon 0. */
  'course.record',
  // Les cumuls.
  'cumul.courses',
  'cumul.coursesTrois',
  'cumul.distance',
  'cumul.glisse',
  'cumul.nos',
  'cumul.bronze',
  'cumul.argent',
  'cumul.or',
  'cumul.medailles',
  'cumul.records',
  'cumul.sansChoc',
  'cumul.pluie',
  'cumul.neige',
  'cumul.jour',
  'cumul.cartes',
  'cumul.vehicules',
  'cumul.vitesseMax',
  'cumul.gains',
  'cumul.achats',
] as const;
export type Champ = (typeof CHAMPS)[number];

export type Operateur = '>=' | '>' | '<=' | '<' | '=' | '!=';

export interface Test {
  champ: Champ;
  op: Operateur;
  /** Un nombre, un texte (`'neige'`, `'tours3'`), ou `'toutesLesCartes'` : le nombre de cartes du catalogue. */
  valeur: number | string;
}

export interface HautFaitDef extends HautFait {
  quand: readonly Test[];
}

const plus = (champ: Champ, valeur: number): Test => ({ champ, op: '>=', valeur });
const egal = (champ: Champ, valeur: number | string): Test => ({ champ, op: '=', valeur });

export const HAUTS_FAITS: readonly HautFaitDef[] = [
  // Les débuts.
  { id: 'premiere-course', label: 'Premier tour de piste', description: 'Termine ta première course.', recompense: { dollars: 50 }, quand: [plus('cumul.courses', 1)] },
  { id: 'premiere-medaille', label: 'Sur le podium', description: 'Décroche une première médaille, de n’importe quelle couleur.', recompense: { dollars: 30 }, quand: [plus('cumul.medailles', 1)] },
  { id: 'premier-argent', label: 'Un peu mieux', description: 'Finis une course avec une médaille d’argent ou mieux.', recompense: { dollars: 40 }, quand: [plus('course.rangMedaille', 2)] },
  { id: 'premier-or', label: 'L’or au cou', description: 'Décroche ta première médaille d’or.', recompense: { dollars: 80, articles: ['sticker-trophee-or'] }, quand: [plus('cumul.or', 1)] },
  { id: 'premier-record', label: 'Meilleur que toi-même', description: 'Bats ton propre record sur une carte.', recompense: { dollars: 40 }, quand: [egal('course.record', 1)] },
  { id: 'premier-achat', label: 'Premier achat', description: 'Fais ton premier achat : un pack de stickers ou une pièce.', recompense: { dollars: 25 }, quand: [plus('cumul.achats', 1)] },
  // La régularité.
  { id: 'dix-courses', label: 'Habitué de la route', description: 'Termine dix courses.', recompense: { dollars: 100 }, quand: [plus('cumul.courses', 10)] },
  { id: 'vingt-cinq-courses', label: 'Pilote de l’atelier', description: 'Termine vingt-cinq courses.', recompense: { dollars: 200, articles: ['sticker-trophee-series'] }, quand: [plus('cumul.courses', 25)] },
  { id: 'cinquante-courses', label: 'Une vraie saison', description: 'Termine cinquante courses.', recompense: { dollars: 400 }, quand: [plus('cumul.courses', 50)] },
  { id: 'cinq-or', label: 'Collectionneur d’or', description: 'Décroche cinq médailles d’or.', recompense: { dollars: 150 }, quand: [plus('cumul.or', 5)] },
  { id: 'cinq-records', label: 'Jamais content', description: 'Bats cinq fois tes records.', recompense: { dollars: 100 }, quand: [plus('cumul.records', 5)] },
  // La conduite.
  { id: 'tour-propre', label: 'Tour propre', description: 'Finis une course d’un tour sans toucher le bord.', recompense: { dollars: 20 }, quand: [egal('course.format', 'tour1'), egal('course.chocs', 0)] },
  { id: 'trois-tours-propres', label: 'Trois tours sans une rayure', description: 'Finis une course de trois tours sans toucher le bord.', recompense: { dollars: 80, articles: ['sticker-trophee-propre'] }, quand: [egal('course.format', 'tours3'), egal('course.chocs', 0)] },
  { id: 'dix-courses-propres', label: 'Carrosserie intacte', description: 'Finis dix courses sans le moindre choc.', recompense: { dollars: 120 }, quand: [plus('cumul.sansChoc', 10)] },
  { id: 'glisse', label: 'Ça chasse', description: 'Glisse sur 100 m dans une même course.', recompense: { dollars: 30 }, quand: [plus('course.glisse', 100)] },
  { id: 'longue-glisse', label: 'Une longue glisse', description: 'Glisse sur 300 m dans une même course.', recompense: { dollars: 80, articles: ['sticker-trophee-glisse'] }, quand: [plus('course.glisse', 300)] },
  { id: 'vitesse-120', label: 'Ça commence à filer', description: 'Passe 120 km/h en course.', recompense: { dollars: 20 }, quand: [plus('course.vitesseMax', 120)] },
  { id: 'vitesse-160', label: 'Pied au plancher', description: 'Passe 160 km/h en course.', recompense: { dollars: 50 }, quand: [plus('course.vitesseMax', 160)] },
  { id: 'vitesse-200', label: 'Deux cents', description: 'Passe 200 km/h en course.', recompense: { dollars: 100, articles: ['sticker-trophee-vitesse'] }, quand: [plus('course.vitesseMax', 200)] },
  { id: 'nos-vingt', label: 'Un coup de NOS', description: 'Lance vingt poussées de NOS en tout.', recompense: { dollars: 30 }, quand: [plus('cumul.nos', 20)] },
  // La météo, les cartes, les véhicules, la distance.
  { id: 'sous-la-pluie', label: 'Il pleut, on roule', description: 'Finis une course sous la pluie.', recompense: { dollars: 30 }, quand: [egal('course.meteo', 'pluie')] },
  { id: 'sous-la-neige', label: 'Pneus d’hiver', description: 'Finis une course sous la neige.', recompense: { dollars: 60, articles: ['sticker-trophee-neige'] }, quand: [egal('course.meteo', 'neige')] },
  { id: 'trois-tours', label: 'Trois tours d’horloge', description: 'Finis une première course de trois tours.', recompense: { dollars: 60 }, quand: [plus('cumul.coursesTrois', 1)] },
  { id: 'deux-cartes', label: 'Changement de décor', description: 'Cours sur deux cartes différentes.', recompense: { dollars: 40 }, quand: [plus('cumul.cartes', 2)] },
  { id: 'toutes-les-cartes', label: 'Tour du propriétaire', description: 'Cours sur toutes les cartes.', recompense: { dollars: 150, articles: ['sticker-trophee-cartes'] }, quand: [{ champ: 'cumul.cartes', op: '>=', valeur: 'toutesLesCartes' }] },
  { id: 'deux-vehicules', label: 'Un autre au volant', description: 'Cours avec deux véhicules différents.', recompense: { dollars: 40 }, quand: [plus('cumul.vehicules', 2)] },
  { id: 'dix-kilometres', label: 'Dix bornes', description: 'Roule dix kilomètres en tout.', recompense: { dollars: 40 }, quand: [plus('cumul.distance', 10_000)] },
  { id: 'cent-kilometres', label: 'Le grand voyage', description: 'Roule cent kilomètres en tout.', recompense: { dollars: 200, articles: ['sticker-trophee-route'] }, quand: [plus('cumul.distance', 100_000)] },
  { id: 'premier-jour', label: 'Au grand jour', description: 'Finis une course de jour.', recompense: { dollars: 20 }, quand: [plus('cumul.jour', 1)] },
  { id: 'mille-dollars', label: 'Les poches pleines', description: 'Gagne mille dollars en course.', recompense: { dollars: 100 }, quand: [plus('cumul.gains', 1000)] },
];
