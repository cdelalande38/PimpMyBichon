// Tutoriels de l'atelier : un par écran. Le premier passage sur un écran propose le sien, une seule
// fois ; le bouton « ? » (Aide) le rouvre et donne la liste de tous (src/ui/tuto/).
// Ajouter un tutoriel, c'est ajouter une entrée ici : l'écran qu'il couvre (clé d'écran, voir
// EcranKey), un titre, le but de l'écran en une phrase, puis trois à cinq étapes courtes.
// Une étape peut viser un élément de l'interface (sélecteur CSS ; plusieurs, séparés par des
// virgules, sont entourés ensemble) : s'il n'est pas à l'écran, l'étape s'affiche sans le viser.

import type { EntryId } from './dockMenu.ts';

/**
 * Écran de l'app, tel que le tutoriel le reconnaît :
 * - `accueil` : le garage à l'ouverture (dock sur « Véhicule » sans en être sorti, ou dock fermé) ;
 * - `entree:<id>` : une entrée du dock (src/data/dockMenu.ts) ;
 * - `panneau:<nom>` : un panneau bas ouvert par l'adresse (src/app/router.ts) ;
 * - `photo` : le mode photo ; `vue:interieur` : la vue intérieure (src/state/view.ts).
 */
export type EcranKey =
  | 'accueil'
  | 'photo'
  | 'vue:interieur'
  | `entree:${EntryId}`
  | 'panneau:radio'
  | 'panneau:reglages'
  | 'panneau:capot';

export interface TutoEtape {
  texte: string;
  /** Élément à mettre en valeur (sélecteur CSS). */
  cible?: string;
}

export interface Tuto {
  id: string;
  /** Écrans où ce tutoriel se propose au premier passage, et que « ? » rouvre. */
  ecrans: readonly EcranKey[];
  titre: string;
  /** Le but de l'écran, en une phrase. */
  but: string;
  etapes: readonly TutoEtape[];
}

export const TUTOS: readonly Tuto[] = [
  {
    id: 'accueil',
    ecrans: ['accueil'],
    titre: 'Bienvenue au garage',
    but: 'Ici, tu customises ton véhicule comme tu veux, et tu le regardes sous tous les angles.',
    etapes: [
      { texte: 'Glisse un doigt sur l’image pour tourner autour du véhicule. Pince à deux doigts pour zoomer.' },
      {
        texte: 'En bas, le menu : Véhicule, Custom, Mécanique et Garage. Touche une section pour l’ouvrir.',
        cible: 'footer.dock nav[aria-label="Onglets de l’atelier"]',
      },
      {
        // La poignée n'est pas aux sections (elle ne paraît que là où agrandir montre plus) : la
        // croix seule est visée ici.
        texte: 'La croix range le menu ; il revient d’une touche sur « Personnaliser ». Dans une entrée, la flèche l’agrandit s’il a plus à montrer.',
        cible: 'footer.dock .dock-close',
      },
      { texte: 'En haut à droite, les boutons ronds : atelier, photo, radio, parfois l’intérieur. Touche aussi les objets du garage : ils ouvrent des menus.', cible: 'nav.quick' },
      { texte: 'Perdu ? Le bouton « ? » réexplique l’écran où tu es, et garde tous les tutos.', cible: '.tuto-aide' },
    ],
  },
  {
    id: 'vehicule',
    ecrans: ['entree:vehicule'],
    titre: 'Choisir ton véhicule',
    but: 'Ici, tu choisis la machine que tu vas customiser.',
    etapes: [
      { texte: 'Chaque puce est un véhicule du catalogue. Fais défiler la rangée pour tous les voir.', cible: 'footer.dock [aria-label="Véhicule"][role="group"]' },
      { texte: 'Touche un véhicule : il entre au garage.' },
      { texte: 'Chacun garde ses réglages. Tu peux passer de l’un à l’autre sans rien perdre.' },
      { texte: '« Substitut » veut dire maquette : le vrai modèle arrive plus tard.' },
    ],
  },
  {
    id: 'peinture',
    ecrans: ['entree:peinture'],
    titre: 'La peinture',
    but: 'Ici, tu donnes à chaque partie du véhicule sa couleur et sa finition.',
    etapes: [
      { texte: 'Choisis d’abord une zone : la carrosserie, le toit, les jantes…', cible: 'footer.dock [aria-label="Zones"]' },
      { texte: 'Touche une couleur pour l’appliquer, puis passe à la finition : brillant, mat, métallisé, nacré…' },
      { texte: 'Le nuancier ouvre toutes les teintes. La pipette reprend la couleur d’une autre zone.' },
      // La zone maîtresse change d'un véhicule à l'autre (carrosserie, réservoir… : champ « phrase »
      // du manifeste) ; elle ouvre toujours la liste des zones (src/ui/paint/paintLogic.ts).
      { texte: 'Le cadenas fermé, la partie suit la première zone de la liste. Ouvre-le pour lui donner sa propre peinture.', cible: 'footer.dock [data-cadenas]' },
    ],
  },
  {
    id: 'preparation',
    ecrans: ['entree:preparation'],
    titre: 'La préparation moteur',
    but: 'Ici, tu gonfles le moteur et tu vois tout de suite ce que ça donne.',
    etapes: [
      { texte: 'En haut, le moteur d’origine et trois chiffres : l’origine, le gain et le résultat préparé.' },
      { texte: 'Chaque poste a sa rangée de puces : reprogrammation, carburation, nitro… selon le moteur.' },
      { texte: 'Touche une puce pour l’essayer : les chiffres suivent aussitôt.' },
      { texte: 'Tes choix restent avec le véhicule, même après avoir fermé l’app.' },
    ],
  },
  {
    id: 'ambiance',
    ecrans: ['entree:ambiance'],
    titre: 'L’ambiance du garage',
    but: 'Ici, tu changes la lumière et l’humeur du garage.',
    etapes: [
      { texte: 'Chaque puce est une ambiance. Touche-la pour rallumer le garage autrement.', cible: 'footer.dock [aria-label="Ambiance"]' },
      { texte: 'Les néons se reflètent dans la carrosserie : tourne autour du véhicule pour en profiter.' },
      { texte: 'Ton ambiance est gardée pour la prochaine fois.' },
    ],
  },
  {
    id: 'radio',
    ecrans: ['panneau:radio'],
    titre: 'La radio',
    but: 'Ici, tu mets ta musique dans le garage.',
    etapes: [
      { texte: 'L’app ne fournit aucune musique : c’est toi qui fais entrer un pack.' },
      { texte: 'Un pack entre par un fichier ZIP de ton téléphone, par son adresse, ou par un lien qu’un pote t’envoie.' },
      { texte: 'La lecture automatique lance la radio dès l’ouverture. Tu la coupes dans Atelier, rubrique Réglages.' },
      { texte: 'Radio garnie, le bouton rond Radio déploie le mini-lecteur : le titre, pause et suivant.' },
    ],
  },
  {
    id: 'atelier',
    ecrans: ['panneau:reglages', 'panneau:capot'],
    titre: 'L’atelier',
    but: 'Ici, tu règles l’app à ta main et tu vois comment tourne ton téléphone.',
    etapes: [
      { texte: 'Deux rubriques, en bas : Réglages et Sous le capot.', cible: '[aria-label="Rubriques de l’atelier"]' },
      { texte: 'Réglages : la qualité de l’image, la rotation au repos, la taille du texte, la lecture automatique.' },
      { texte: 'Sous le capot : la version qui tourne, le hors-ligne et la sauvegarde.' },
      { texte: '« Mesurer » et « Comparer » disent si ton téléphone suit, et où part le temps.' },
    ],
  },
  {
    id: 'photo',
    ecrans: ['photo'],
    titre: 'Le mode photo',
    but: 'Ici, tu fais une belle photo de ton véhicule, sans les menus.',
    etapes: [
      { texte: 'Les menus s’effacent : il ne reste que ton véhicule.' },
      { texte: 'En bas, les cadrages : trois-quarts avant, profil, plongée… Touche pour changer d’angle.', cible: '[aria-label="Cadrages"]' },
      { texte: '« Enregistrer » range la photo sur ton téléphone.' },
      { texte: '« Retour » te ramène à l’atelier.' },
    ],
  },
  {
    id: 'interieur',
    ecrans: ['vue:interieur'],
    titre: 'La vue intérieure',
    but: 'Ici, tu prends place au volant et tu regardes l’habitacle.',
    etapes: [
      { texte: 'Tu vois le véhicule avec les yeux du conducteur.' },
      { texte: 'Glisse un doigt pour regarder autour de toi.' },
      { texte: 'Pour ressortir, touche de nouveau le bouton rond au volant : il s’appelle « Sortir ».', cible: 'nav.quick' },
    ],
  },
];

/** Tutoriel de l'accueil : le premier proposé, et celui que « ? » rouvre quand l'écran n'en a pas. */
export const TUTO_ACCUEIL = 'accueil';

export function tutoById(id: string): Tuto | undefined {
  return TUTOS.find((tuto) => tuto.id === id);
}

/** Tutoriel d'un écran ; `undefined` si l'écran n'en a pas. */
export function tutoForEcran(ecran: EcranKey | null): Tuto | undefined {
  return ecran === null ? undefined : TUTOS.find((tuto) => tuto.ecrans.includes(ecran));
}
