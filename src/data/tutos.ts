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
 * - `photo` : le mode photo ; `vue:interieur` : la vue intérieure (src/state/view.ts) ;
 * - `sortie` : l'écran de la sortie de nuit, sur la route (§ 5.5).
 */
export type EcranKey =
  | 'accueil'
  | 'photo'
  | 'sortie'
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
      { texte: 'En haut à droite : atelier, photo, radio, intérieur. Perdu ? Le bouton « ? » réexplique l’écran où tu es.', cible: 'nav.quick' },
      // Vague X (G2 de l'audit des menus) : l'accueil dit où rouler. « Jouer » est toujours au bas de l'écran.
      { texte: 'Prêt à rouler ? Touche « Jouer », en rouge, toujours en bas de l’écran : course, duel, drift, balade ou carrière.', cible: 'footer.dock .dock-jouer-tete, footer.dock .dock-jouer' },
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
      { texte: '« Maquette » : un modèle provisoire, en attendant le vrai.' },
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
    id: 'stickers',
    ecrans: ['entree:stickers'],
    titre: 'Les stickers',
    but: 'Ici, tu colles des stickers sur ton véhicule et tu les places au doigt.',
    etapes: [
      { texte: 'Choisis une zone : les flancs, le capot, le toit… Sur une moto, le réservoir.', cible: 'footer.dock [aria-label="Zones de stickers"]' },
      { texte: '« Ajouter un sticker » ouvre la bibliothèque. Un cadenas : le motif se gagne avec tes dollars ou un haut fait.' },
      { texte: 'Sur le plan, glisse le sticker pour le placer. La poignée ronde le tourne et l’agrandit ; « Curseurs » pour le réglage fin.' },
      { texte: 'Symétrie mise, le flanc droit reprend le gauche en miroir et les lettrages restent lisibles. Coupe-la pour deux côtés différents.' },
    ],
  },
  {
    id: 'ailerons',
    ecrans: ['entree:ailerons'],
    titre: 'Les ailerons',
    but: 'Ici, tu poses un aileron sur ta voiture, du becquet discret à l’aileron démesuré.',
    etapes: [
      { texte: 'Fais défiler les ailerons et touche celui qui te plaît : il se pose tout de suite sur la caisse.', cible: 'footer.dock [data-testid="pieces"] .chips' },
      { texte: 'Un cadenas et un prix : touche, puis « Acheter » avec les dollars de tes courses, et c’est posé.' },
      { texte: 'L’aileron prend la peinture de la caisse. « Couleur propre » lui donne sa teinte et sa finition à lui.' },
      { texte: '« D’origine » l’enlève. Sur une moto, pas d’aileron : c’est toi qui fends l’air.' },
    ],
  },
  {
    id: 'carrosserie',
    ecrans: ['entree:carrosserie'],
    titre: 'Le kit carrosserie',
    but: 'Ici, tu habilles le bas de caisse : lame avant, jupes et diffuseur.',
    etapes: [
      { texte: 'Choisis d’abord un élément : la lame avant, les jupes ou le diffuseur. La caméra va le voir de près.', cible: 'footer.dock [data-testid="pieces-groupe"] .pieces-postes' },
      { texte: 'Touche une pièce, elle se pose tout de suite. Un cadenas et un prix : « Acheter » avec les dollars de tes courses.', cible: 'footer.dock [data-testid="pieces"] .chips' },
      { texte: 'La pièce prend la peinture de la caisse. « Couleur propre » lui donne sa teinte et sa finition à elle.' },
      { texte: '« D’origine » enlève la pièce, « Retour » rend la liste des éléments. Sur une moto, pas de kit : pas de bas de caisse.' },
    ],
  },
  {
    id: 'roues',
    ecrans: ['entree:roues'],
    titre: 'Les roues',
    but: 'Ici, tu choisis tes jantes, tes pneus et leurs cotes, et tu les vois aussitôt sur le véhicule.',
    etapes: [
      { texte: 'Trois volets : Jantes pour le dessin, Pneus pour le type et sa couleur, Cotes pour les tailles.', cible: 'footer.dock .wheels-volets' },
      { texte: 'Touche un dessin de jante pour le monter. La couleur et la finition des jantes se règlent dans Peinture.' },
      { texte: 'Dans Pneus : route, flanc blanc, lettrage ou tout-terrain. Les pastilles colorent le liseré, le flanc ou les lettres.' },
      { texte: 'Dans Cotes : diamètre de jante, largeur et flanc. Le pneu ne dépasse jamais du passage de roue, la caisse suit.' },
    ],
  },
  {
    id: 'suspension',
    ecrans: ['entree:suspension'],
    titre: 'La suspension',
    but: 'Ici, tu règles l’assiette : la hauteur de caisse, de l’origine jusqu’au ras du sol.',
    etapes: [
      { texte: 'Trois réglages tout prêts : origine, rabaissée, posée au sol.', cible: 'footer.dock [aria-label="Assiette"]' },
      { texte: 'Le curseur Hauteur règle au centimètre entre les deux. Les roues restent au sol, c’est la caisse qui descend.' },
      { texte: 'Plus les roues sont grandes, moins il reste de place sous les ailes : le curseur s’arrête avant que ça frotte.' },
    ],
  },
  {
    id: 'phares',
    ecrans: ['entree:phares'],
    titre: 'Les phares',
    but: 'Ici, tu choisis la couleur de tes phares, la teinte des optiques et tes feux arrière.',
    etapes: [
      { texte: 'Trois volets : Lumière pour la couleur de l’éclairage, Optiques pour la teinte des glaces, Feux pour l’arrière.', cible: 'footer.dock .phares-volets' },
      { texte: 'Le blanc chaud d’origine est offert. Un cadenas et un prix : touche, puis « Acheter » avec tes dollars, et c’est posé.' },
      { texte: 'Optiques : de claires à fumées, au curseur. Feux : rouges ou fumés, ils restent rouges une fois allumés.' },
      { texte: 'En sortie de nuit, ta couleur se voit dans les optiques, dans le faisceau et sur la route éclairée.' },
    ],
  },
  {
    id: 'neons',
    ecrans: ['entree:neons'],
    titre: 'Les néons',
    but: 'Ici, tu allumes les néons de ton véhicule, zone par zone : dessous, dans les roues, dans l’habitacle.',
    etapes: [
      { texte: 'Touche une zone pour la régler : allumée ou éteinte, fixe ou en respiration lente, sa couleur, son intensité.', cible: 'footer.dock .neons-zones' },
      { texte: 'L’avant d’une voiture et le cadre d’une moto sont offerts. Un cadenas et un prix : touche, puis « Acheter ».' },
      { texte: '« Tout en » met toutes les zones allumées à la même couleur ; « Tout éteindre » les coupe d’un coup.', cible: 'footer.dock .neons-tout' },
      { texte: 'La lueur se voit sur le sol du garage et sur la route, la nuit ; sous la pluie, elle file sur la chaussée.' },
    ],
  },
  {
    id: 'habitacle',
    ecrans: ['entree:interieur'],
    titre: 'L’intérieur',
    but: 'Ici, tu garnis l’habitacle : volant, pommeau, sièges et ciel étoilé, et tu les vois de l’intérieur.',
    etapes: [
      { texte: 'Volant, Pommeau, Sièges, Ciel, LED : chaque volet t’assoit à la place d’où il se voit le mieux.', cible: 'footer.dock .habitacle-volets' },
      { texte: 'Tu préfères une autre place ? Touche Conducteur, Passager ou Arrière, juste au-dessus du menu.', cible: '.places' },
      { texte: 'Les pastilles colorent la jante du volant, le pommeau ou les étoiles. Le « + » ouvre toutes les couleurs.' },
      { texte: 'Dans Ciel, allume ou éteins les étoiles et choisis leur densité. Glisse un doigt sur l’image pour lever les yeux.' },
      { texte: '« D’origine » remet l’habitacle comme avant. Quitte l’entrée et tu ressors dans l’atelier.' },
    ],
  },
  {
    id: 'preparation',
    ecrans: ['entree:preparation'],
    titre: 'La préparation moteur',
    but: 'Ici, tu gonfles le moteur et tu vois tout de suite ce que ça donne.',
    etapes: [
      { texte: 'En haut, « Démarrer » lance le moteur au ralenti. Garde le doigt sur « Coup de gaz » pour le faire monter, « Couper » l’arrête.', cible: 'footer.dock .engine-sound' },
      { texte: 'Juste dessous, le moteur d’origine et trois chiffres : l’origine, le gain et le résultat préparé.' },
      { texte: 'Chaque poste a sa rangée de puces : reprogrammation, carburation, nitro… selon le moteur.' },
      { texte: 'Touche une puce pour l’essayer : les chiffres suivent aussitôt.' },
      { texte: 'Tes choix restent avec le véhicule, même après avoir fermé l’app.' },
    ],
  },
  {
    id: 'moteur',
    ecrans: ['entree:moteur'],
    titre: 'L’établi moteur',
    but: 'Ici, le moteur sort du véhicule : tu choisis une pièce, puis tu la traites ou tu l’optimises.',
    etapes: [
      { texte: 'Le curseur « Vue éclatée » écarte les pièces. Tourne autour du moteur au doigt, pince pour zoomer.', cible: 'footer.dock .moteur-eclate' },
      { texte: 'Touche une pièce dans la liste : elle s’allume en ambre et la caméra va la voir de près.', cible: 'footer.dock .moteur-pieces' },
      { texte: 'Finition : brut et peinture sont offerts ; le reste s’achète une fois, pour tous tes moteurs. Le filtre à air s’échange.', cible: 'footer.dock .moteur-volets' },
      { texte: 'Optimisation : chaque niveau dit ce qu’il gagne avant l’achat. Le total s’ajoute à ta Préparation.' },
      { texte: '« Retour » rend la liste et le total du moteur. Ferme l’entrée : le moteur retourne dans le véhicule.' },
    ],
  },
  {
    id: 'echappement',
    ecrans: ['entree:echappement'],
    titre: 'L’échappement',
    but: 'Ici, tu choisis la ligne d’échappement : elle change le son du moteur, et la plus libre crache des flammes.',
    etapes: [
      { texte: 'Quatre lignes ; l’origine est offerte. Un cadenas et un prix : touche, puis « Acheter », et elle est montée.', cible: 'footer.dock .echappement' },
      { texte: 'Écoute-la tout de suite : « Démarrer », puis garde le doigt sur « Coup de gaz ».' },
      { texte: 'Avec la ligne libre, en sortie, lâche le gaz après avoir bien fait monter le moteur : les sorties crachent.' },
      { texte: 'Sur les modèles dont les sorties sont des pièces à part, choisis aussi leur finition : chrome, noir ou bleui.' },
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
      { texte: 'Sans pack, la station de l’atelier tourne : quelques morceaux livrés avec l’app. Dès que ton pack est là, la radio passe dessus.' },
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
    but: 'Ici, tu t’assois dans le véhicule et tu regardes l’habitacle.',
    etapes: [
      { texte: 'Choisis ta place au pouce : Conducteur, Passager ou Arrière. L’atelier la garde pour ce véhicule.', cible: '.places' },
      { texte: 'Glisse un doigt pour regarder autour de toi, et lève les yeux vers le ciel de toit.' },
      { texte: 'Pour ressortir, touche « Atelier », ou le bouton rond au volant.', cible: '.places .place-sortir' },
    ],
  },
  {
    id: 'sortie-menu',
    ecrans: ['entree:sortie'],
    titre: 'Jouer',
    but: 'Ici, tu choisis comment rouler : une course, un duel, du drift, une balade, ou ta carrière, sur une vraie route.',
    etapes: [
      { texte: 'Une carte par mode. « Carrière » : des épreuves par saisons, avec des primes. « Continuer » reprend là où tu t’es arrêté.', cible: 'footer.dock [aria-label="Mode"][role="group"]' },
      { texte: 'Les autres modes : le lieu, puis le circuit. « Retour » ou Échap remonte d’une étape.', cible: 'footer.dock .dock-back' },
      { texte: 'Dernière étape : le départ, le format, et le moment et la météo d’une touche. La balade ne rapporte rien ; la course, oui.' },
      { texte: '« Drift » : en virage, un coup sec sur FREIN puis plein gaz, ça glisse et ça marque. « Duel » : un adversaire part avec toi aux feux.', cible: 'footer.dock [data-mode="drift"]' },
      { texte: 'Touche « Jouer » : tu pars droit sur la grille, feux au rouge. En balade, la route défile d’abord : touche l’écran pour commencer.' },
    ],
  },
  {
    id: 'sortie',
    ecrans: ['sortie'],
    titre: 'Sur la route',
    but: 'Ici, tu conduis. En balade, un aperçu d’abord : ton véhicule roule tout seul, puis tu prends le volant quand tu veux.',
    etapes: [
      { texte: 'Course, duel, drift : tu pars aux feux. En balade, touche la route pour commencer : retour sur la ligne, puis les feux.', cible: '.drive-invite' },
      { texte: 'Pose ton pouce : en haut les gaz, en bas le frein, sur les côtés tu tournes. Téléphone couché, la manette ; au clavier, les flèches.', cible: '.drive-mid' },
      { texte: 'Au vert, le chrono part. Cadran : vert ça tire, orange passe la vitesse, rouge zone rouge. « NOS » envoie une poussée.' },
      { texte: 'La petite icône du coin range tout : caméras, météo, son, pédales, pilote automatique, « Repartir », « Rentrer au garage ».', cible: '.drive-reglages-btn' },
      { texte: 'À l’arrivée, tes gains tombent un à un. « Rejouer » repart aux feux ; en carrière, « Course suivante » file à l’épreuve d’après.' },
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
