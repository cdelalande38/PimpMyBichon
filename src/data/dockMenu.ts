// Arbre du dock de personnalisation : quatre sections, chacune ses entrées (sous-onglets en haut de
// la section). Ajouter une entrée, c'est une ligne ici ; le composant qui la dessine se branche
// dans src/ui/BenchControls.tsx. Une entrée pas encore disponible s'affiche en fin de rangée,
// estompée, avec la mention « bientôt », sans action ; SHOW_UPCOMING les masque toutes d'un coup.
// Chaque section et chaque entrée nomme son icône (dessinée dans src/ui/icons.tsx), posée avec le mot ;
// sans icône, le mot seul.

export type SectionId = 'vehicule' | 'custom' | 'mecanique' | 'garage';

export type EntryId =
  | 'vehicule'
  | 'peinture'
  | 'roues'
  | 'stickers'
  | 'carrosserie'
  | 'phares'
  | 'ailerons'
  | 'suspension'
  | 'interieur'
  | 'preparation'
  | 'moteur'
  | 'echappement'
  | 'neons'
  | 'ambiance'
  | 'sortie';

/** Icônes de src/ui/icons.tsx (IconName) que portent les sections et les entrées du menu. */
export type MenuIcon =
  | 'voiture'
  | 'pistolet'
  | 'outils'
  | 'garage'
  | 'bombe'
  | 'jante'
  | 'ressort'
  | 'siege'
  | 'sticker'
  | 'portiere'
  | 'phare'
  | 'aileron'
  | 'compteur'
  | 'moteur'
  | 'echappement'
  | 'neon'
  | 'neons'
  | 'route';

export interface DockEntry {
  id: EntryId;
  label: string;
  /** Icône posée au-dessus du mot ; absente, le mot seul. */
  icon?: MenuIcon;
  /** Faux : affichée « bientôt », estompée, sans action. */
  available: boolean;
}

export interface DockSection {
  id: SectionId;
  label: string;
  /** Icône posée au-dessus du mot ; absente, le mot seul. */
  icon?: MenuIcon;
  /** « engine » : section absente si le véhicule à l'écran ne déclare pas de moteur. */
  requires?: 'engine';
  entries: readonly DockEntry[];
}

/** Faux : les entrées « bientôt » disparaissent de toutes les rangées. */
export const SHOW_UPCOMING = true;

export const DOCK_MENU: readonly DockSection[] = [
  {
    id: 'vehicule',
    label: 'Véhicule',
    icon: 'voiture',
    entries: [{ id: 'vehicule', label: 'Véhicule', icon: 'voiture', available: true }],
  },
  {
    id: 'custom',
    label: 'Custom',
    icon: 'pistolet',
    entries: [
      { id: 'peinture', label: 'Peinture', icon: 'bombe', available: true },
      // Jantes, pneus et leurs cotes ; l'assiette (§ 5.4), dans Suspension.
      { id: 'roues', label: 'Roues', icon: 'jante', available: true },
      { id: 'suspension', label: 'Suspension', icon: 'ressort', available: true },
      // Volant, pommeau, sièges et ciel étoilé (§ 5.4) ; l'ouvrir fait entrer dans la vue intérieure.
      { id: 'interieur', label: 'Intérieur', icon: 'siege', available: true },
      // Poser des stickers sur les zones de livrée du véhicule (§ 5.3, premier lot).
      { id: 'stickers', label: 'Stickers', icon: 'sticker', available: true },
      { id: 'carrosserie', label: 'Carrosserie', icon: 'portiere', available: true },
      { id: 'phares', label: 'Phares', icon: 'phare', available: true },
      { id: 'ailerons', label: 'Ailerons', icon: 'aileron', available: true },
      // Néons du véhicule, zone par zone, et LED de l'habitacle (§ 5.4) : la zone, puis ses réglages.
      { id: 'neons', label: 'Néons', icon: 'neons', available: true },
    ],
  },
  {
    id: 'mecanique',
    label: 'Mécanique',
    icon: 'outils',
    requires: 'engine',
    entries: [
      { id: 'preparation', label: 'Préparation', icon: 'compteur', available: true },
      // L'établi (§ 5.11, premier lot) : le moteur sorti sur son support, vue éclatée, traitements par pièce.
      { id: 'moteur', label: 'Moteur', icon: 'moteur', available: true },
      { id: 'echappement', label: 'Échappement', icon: 'echappement', available: true },
    ],
  },
  {
    id: 'garage',
    label: 'Garage',
    icon: 'garage',
    entries: [
      { id: 'ambiance', label: 'Ambiance', icon: 'neon', available: true },
      // La sortie de nuit (§ 5.5) : la carte, le départ, la météo et « Sortir ».
      { id: 'sortie', label: 'Sortie', icon: 'route', available: true },
    ],
  },
];

/** Sections à l'écran pour ce véhicule. */
export function visibleSections(hasEngine: boolean, menu: readonly DockSection[] = DOCK_MENU): DockSection[] {
  return menu.filter((section) => section.requires !== 'engine' || hasEngine);
}

/** Entrées d'une section dans l'ordre d'affichage : disponibles d'abord, « bientôt » en fin de rangée. */
export function sectionEntries(section: DockSection, showUpcoming = SHOW_UPCOMING): DockEntry[] {
  const ready = section.entries.filter((entry) => entry.available);
  return showUpcoming ? [...ready, ...section.entries.filter((entry) => !entry.available)] : ready;
}

/** Entrée ouverte : la dernière utilisée si elle est disponible, sinon la première disponible. */
export function activeEntry(section: DockSection, last: EntryId | undefined): DockEntry | undefined {
  const ready = section.entries.filter((entry) => entry.available);
  return ready.find((entry) => entry.id === last) ?? ready[0];
}

/**
 * Entrée qu'une section ouvre directement : la seule disponible, quand la section n'en annonce
 * aucune autre (« bientôt » comprises). Véhicule n'a pas d'écran intermédiaire à un seul
 * choix ; Custom, Mécanique et Garage (Ambiance, Sortie) montrent d'abord leurs entrées.
 */
export function directEntry(section: DockSection, showUpcoming = SHOW_UPCOMING): DockEntry | undefined {
  const list = sectionEntries(section, showUpcoming);
  return list.length === 1 && list[0]?.available ? list[0] : undefined;
}

export function sectionOf(entry: EntryId, menu: readonly DockSection[] = DOCK_MENU): DockSection | undefined {
  return menu.find((section) => section.entries.some((item) => item.id === entry));
}
