// Bibliothèque de stickers (§ 5.3, jalon 4, premier lot) : des créations originales en tracés
// vectoriels (src/data/stickers/<id>.svg, une seule teinte en currentColor : l'app donne la couleur),
// reprises de la bibliothèque préparée dans assets-src/stickers/. Aucun nom ni logo de marque, de
// sponsor réel, d'émission ou de jeu : les « sponsors » sont inventés.
//
// Rangement en packs, aux identifiants convenus avec l'économie (src/jeu/) : un motif se pose si
// `possede('pack-<son pack>')` ou `possede('sticker-<son id>')` ; le pack « depart » est offert.
// Les stickers de trophée n'ont pas de pack : ils se gagnent un par un (hauts faits).
// La bibliothèque compte 82 motifs (cahier des charges, § 5.3 : au moins 80) : 45 de la vague S, 37 de la vague U.
//
// Ce fichier ne contient que des données et des fonctions pures (les adresses des dessins sont dans
// src/data/stickersFichiers.ts, qui passe par Vite) : la scène (src/scene/vehicle/
// livree.ts), le panneau (src/ui/stickers/) et les parcours s'en servent.

/** Packs de la bibliothèque ; `null` : sticker de trophée, hors pack. */
export type StickerPack = 'depart' | 'flammes' | 'course' | 'atelier' | 'rue' | 'tapis';

export interface StickerPackSpec {
  id: StickerPack;
  label: string;
  /** Offert à tout le monde, sans rien posséder. */
  gratuit: boolean;
}

export const STICKER_PACKS: readonly StickerPackSpec[] = Object.freeze([
  { id: 'depart', label: 'Départ', gratuit: true },
  { id: 'flammes', label: 'Flammes', gratuit: false },
  { id: 'course', label: 'Course', gratuit: false },
  { id: 'atelier', label: 'Atelier', gratuit: false },
  { id: 'rue', label: 'Rue', gratuit: false },
  { id: 'tapis', label: 'Tapis vert', gratuit: false },
]);

export interface StickerMotif {
  id: string;
  label: string;
  pack: StickerPack | null;
  /** Largeur sur hauteur du dessin (viewBox) : 1, 2 ou 4. */
  ratio: number;
  /** Le motif est son propre miroir : la symétrie ne le retourne pas. */
  symetrique?: boolean;
  /** Le motif porte un lettrage ou un chiffre : en miroir d'un flanc à l'autre, il reste lisible. */
  texte?: boolean;
  /** Taille de pose par défaut : hauteur en mètres. */
  taille: number;
}

type M = Omit<StickerMotif, 'pack'>;
const pack = (id: StickerPack | null, motifs: readonly M[]): StickerMotif[] => motifs.map((motif) => ({ ...motif, pack: id }));

export const STICKER_MOTIFS: readonly StickerMotif[] = Object.freeze([
  ...pack('depart', [
    { id: 'bande-double-capot', label: 'Double bande', ratio: 4, symetrique: true, taille: 0.16 },
    { id: 'bande-triple-filet', label: 'Triple filet', ratio: 4, taille: 0.14 },
    { id: 'bande-chevrons', label: 'Chevrons', ratio: 2, taille: 0.18 },
    { id: 'damier-bandeau', label: 'Bandeau damier', ratio: 4, symetrique: true, taille: 0.12 },
    { id: 'damier-drapeau', label: 'Drapeau à damier', ratio: 1, taille: 0.3 },
    { id: 'numero-rond-7', label: 'Rond n° 7', ratio: 1, texte: true, taille: 0.32 },
    { id: 'numero-rond-13', label: 'Rond n° 13', ratio: 1, texte: true, taille: 0.32 },
    { id: 'eclair-simple', label: 'Éclair', ratio: 1, taille: 0.3 },
    { id: 'etoile-cinq-branches', label: 'Étoile', ratio: 1, symetrique: true, taille: 0.26 },
    { id: 'etoile-filante', label: 'Étoile filante', ratio: 2, taille: 0.22 },
    // Vague U : de quoi varier sans rien payer.
    { id: 'vagues-bandeau', label: 'Bandeau de vagues', ratio: 4, taille: 0.14 },
    { id: 'soleil-retro', label: 'Soleil rétro', ratio: 1, symetrique: true, taille: 0.3 },
    { id: 'soleil-rayons', label: 'Soleil à rayons', ratio: 1, symetrique: true, taille: 0.3 },
    { id: 'tribal-soleil', label: 'Soleil tribal', ratio: 1, taille: 0.28 },
    { id: 'tribal-ornement', label: 'Ornement tribal', ratio: 1, symetrique: true, taille: 0.3 },
  ]),
  ...pack('flammes', [
    { id: 'flammes-classiques-long', label: 'Flammes longues', ratio: 2, taille: 0.4 },
    { id: 'flammes-classiques-court', label: 'Flammes courtes', ratio: 1, taille: 0.4 },
    { id: 'flammes-lisere-long', label: 'Flammes liseré longues', ratio: 2, taille: 0.4 },
    { id: 'flammes-lisere-court', label: 'Flammes liseré courtes', ratio: 1, taille: 0.4 },
    { id: 'flammes-fantomes-long', label: 'Flammes fantômes longues', ratio: 2, taille: 0.4 },
    { id: 'flammes-fantomes-court', label: 'Flammes fantômes courtes', ratio: 1, taille: 0.4 },
    { id: 'tete-de-mort-flammes', label: 'Crâne en flammes', ratio: 1, taille: 0.3 },
  ]),
  ...pack('course', [
    { id: 'damier-coin', label: 'Coin damier', ratio: 1, taille: 0.3 },
    { id: 'damier-dissous', label: 'Damier dissous', ratio: 2, taille: 0.26 },
    { id: 'numero-ovale-27', label: 'Plaque ovale 27', ratio: 1, texte: true, taille: 0.3 },
    { id: 'numero-bouclier-42', label: 'Bouclier 42', ratio: 1, texte: true, taille: 0.3 },
    { id: 'eclair-zigzag-long', label: 'Éclair zigzag', ratio: 2, taille: 0.22 },
    { id: 'sponsor-turbo-mamie', label: 'Turbo Mamie', ratio: 2, texte: true, taille: 0.16 },
    { id: 'sponsor-patin-fumant', label: 'Patin Fumant', ratio: 2, texte: true, taille: 0.16 },
    { id: 'sponsor-pot-perce', label: 'Pot Percé', ratio: 2, texte: true, taille: 0.16 },
    // Vague U : bandes et numéros de plus.
    { id: 'bande-fleche-rallye', label: 'Bande flèche', ratio: 4, taille: 0.14 },
    { id: 'bande-diagonales', label: 'Lames inclinées', ratio: 2, taille: 0.22 },
    { id: 'damier-onde', label: 'Damier ondulé', ratio: 4, taille: 0.14 },
    { id: 'numero-hexagone-36', label: 'Hexagone n° 36', ratio: 1, texte: true, taille: 0.3 },
    { id: 'numero-carre-5', label: 'Carré n° 5', ratio: 1, texte: true, taille: 0.3 },
  ]),
  ...pack('atelier', [
    { id: 'cle-molette-boulon', label: 'Clé à molette', ratio: 1, taille: 0.26 },
    { id: 'cle-plates-croisees', label: 'Clés croisées', ratio: 1, taille: 0.26 },
    { id: 'cle-bougie', label: 'Bougie d’allumage', ratio: 1, taille: 0.26 },
    { id: 'piston-bielle', label: 'Piston et bielle', ratio: 1, symetrique: true, taille: 0.26 },
    { id: 'piston-croises', label: 'Pistons croisés', ratio: 1, taille: 0.26 },
    { id: 'sponsor-huile-de-coude', label: 'Huile de Coude', ratio: 2, texte: true, taille: 0.16 },
    { id: 'sponsor-boulons-perdus', label: 'Boulons Perdus', ratio: 1, texte: true, taille: 0.24 },
    { id: 'sponsor-rouille-royale', label: 'Rouille Royale', ratio: 1, texte: true, taille: 0.24 },
    { id: 'sponsor-la-bielle-coulee', label: 'La Bielle Coulée', ratio: 1, texte: true, taille: 0.24 },
    { id: 'sponsor-bougie-noyee', label: 'Bougie Noyée', ratio: 1, texte: true, taille: 0.24 },
    { id: 'piston-aile', label: 'Piston ailé', ratio: 2, symetrique: true, taille: 0.24 },
    { id: 'tete-de-mort-face', label: 'Crâne de face', ratio: 1, taille: 0.3 },
    // Vague U : l'outillage et cinq enseignes inventées de plus.
    { id: 'engrenage', label: 'Engrenage', ratio: 1, symetrique: true, taille: 0.26 },
    { id: 'volant', label: 'Volant', ratio: 1, symetrique: true, taille: 0.26 },
    { id: 'tournevis-croises', label: 'Tournevis croisés', ratio: 1, taille: 0.26 },
    { id: 'sponsor-joint-claque', label: 'Joint Claqué', ratio: 2, texte: true, taille: 0.16 },
    { id: 'sponsor-courroie-cassee', label: 'Courroie Cassée', ratio: 2, texte: true, taille: 0.16 },
    { id: 'sponsor-ecrou-fou', label: 'Écrou Fou', ratio: 2, texte: true, taille: 0.16 },
    { id: 'sponsor-moteur-mou', label: 'Moteur Mou', ratio: 2, texte: true, taille: 0.16 },
    { id: 'sponsor-cle-perdue', label: 'Clé Perdue', ratio: 2, texte: true, taille: 0.16 },
  ]),
  // Vague U : le pack de la rue (graffitis, peinture, griffes) et celui du tapis vert (dés et cartes).
  ...pack('rue', [
    { id: 'graffiti-vroum', label: 'Graffiti Vroum', ratio: 2, texte: true, taille: 0.2 },
    { id: 'graffiti-rat', label: 'Graffiti Rat', ratio: 1, texte: true, taille: 0.3 },
    { id: 'eclaboussure-coulures', label: 'Coulures de peinture', ratio: 1, taille: 0.3 },
    { id: 'eclaboussure-impact', label: 'Impact de peinture', ratio: 1, taille: 0.3 },
    { id: 'griffure-dechirure', label: 'Déchirure', ratio: 1, taille: 0.3 },
    { id: 'toile-araignee', label: 'Araignée et sa toile', ratio: 1, symetrique: true, taille: 0.28 },
    { id: 'tete-de-mort-pistons', label: 'Crâne et pistons', ratio: 1, symetrique: true, taille: 0.3 },
    { id: 'aile-chauve-souris', label: 'Ailes de chauve-souris', ratio: 2, symetrique: true, taille: 0.2 },
  ]),
  ...pack('tapis', [
    { id: 'de-cinq', label: 'Dé, face cinq', ratio: 1, taille: 0.26 },
    { id: 'des-paire', label: 'Paire de dés', ratio: 2, taille: 0.22 },
    { id: 'carte-as-pique', label: 'As de pique', ratio: 1, taille: 0.3 },
    { id: 'carte-as-coeur', label: 'As de cœur', ratio: 1, taille: 0.3 },
    { id: 'cartes-enseignes', label: 'Les quatre enseignes', ratio: 4, taille: 0.14 },
  ]),
  // Trophées : un par article de haut fait (src/data/hautsFaits.ts, l'économie : `sticker-trophee-…`),
  // aucun pack. Dessins repris de la bibliothèque (assets-src/stickers/), renommés d'après leur haut fait.
  ...pack(null, [
    // Médaille d'or : étoile et lauriers (etoile-laurier).
    { id: 'trophee-or', label: 'Médaille d’or', ratio: 1, symetrique: true, taille: 0.3 },
    // Série de courses : rangée d'étoiles (etoile-rangee-trois).
    { id: 'trophee-series', label: 'Série de courses', ratio: 2, symetrique: true, taille: 0.2 },
    // Course sans choc : roue ailée (aile-roue).
    { id: 'trophee-propre', label: 'Course propre', ratio: 2, symetrique: true, taille: 0.24 },
    // Pointe de vitesse : éclair double (eclair-double).
    { id: 'trophee-vitesse', label: 'Pointe de vitesse', ratio: 1, symetrique: true, taille: 0.3 },
    // Longue glisse : quatre traces de griffes, comme des pneus en travers (griffure-quatre-longues).
    { id: 'trophee-glisse', label: 'Longue glisse', ratio: 2, taille: 0.24 },
    // Neige : un flocon à six branches, dessiné pour le projet (vague U).
    { id: 'trophee-neige', label: 'Neige', ratio: 1, symetrique: true, taille: 0.26 },
    // Kilomètres parcourus : ailes d'aigle (aile-aigle-paire).
    { id: 'trophee-route', label: 'Grande route', ratio: 2, symetrique: true, taille: 0.24 },
    // Toutes les cartes : le crâne baroudeur à bandana (tete-de-mort-bandana).
    { id: 'trophee-cartes', label: 'Toutes les cartes', ratio: 1, taille: 0.3 },
    // Vague U : six récompenses de plus, d'après des hauts faits qui ne rapportaient que des dollars.
    // Pied au plancher (160 km/h) : l'éclair en médaillon.
    { id: 'eclair-triangle', label: 'Éclair en triangle', ratio: 1, taille: 0.28 },
    // Il pleut, on roule : la pluie d'éclairs.
    { id: 'eclair-pluie', label: 'Pluie d’éclairs', ratio: 1, taille: 0.28 },
    // Dix bornes : la grande aile.
    { id: 'aile-seule', label: 'Grande aile', ratio: 1, taille: 0.28 },
    // Vingt poussées de NOS : la lame tribale.
    { id: 'tribal-lame', label: 'Lame tribale', ratio: 2, taille: 0.2 },
    // Carrière bouclée : les drapeaux croisés à l'arrivée.
    { id: 'drapeaux-croises', label: 'Drapeaux croisés', ratio: 1, symetrique: true, taille: 0.3 },
    // Jamais content (cinq records battus) : les étincelles.
    { id: 'etincelles', label: 'Étincelles', ratio: 1, taille: 0.26 },
  ]),
]);

const BY_ID = new Map(STICKER_MOTIFS.map((motif) => [motif.id, motif]));

export function stickerById(id: string): StickerMotif | undefined {
  return BY_ID.get(id);
}

/** Identifiant d'article (src/jeu/contrat.ts) d'un pack. */
export function packArticle(id: StickerPack): string {
  return `pack-${id}`;
}

/** Identifiant d'article d'un motif seul. */
export function stickerArticle(id: string): string {
  return `sticker-${id}`;
}

/**
 * Vrai si le motif se pose : pack offert, pack possédé ou motif possédé. `possede` vient de
 * src/jeu/bilan.ts (passé en paramètre : les tests le remplacent).
 */
export function stickerUnlocked(motif: StickerMotif, possede: (article: string) => boolean): boolean {
  const spec = STICKER_PACKS.find((item) => item.id === motif.pack);
  if (spec?.gratuit) return true;
  if (motif.pack !== null && possede(packArticle(motif.pack))) return true;
  return possede(stickerArticle(motif.id));
}

/** Ce qui manque pour poser un motif verrouillé, en une phrase. */
export function lockHint(motif: StickerMotif): string {
  if (motif.pack === null) return 'sticker de trophée, à gagner avec un haut fait.';
  const spec = STICKER_PACKS.find((item) => item.id === motif.pack);
  return `dans le pack ${spec?.label ?? motif.pack}, à débloquer avec tes dollars.`;
}

/** Motifs d'un pack (`null` : les trophées), dans l'ordre de la bibliothèque. */
export function motifsOf(id: StickerPack | null): StickerMotif[] {
  return STICKER_MOTIFS.filter((motif) => motif.pack === id);
}
