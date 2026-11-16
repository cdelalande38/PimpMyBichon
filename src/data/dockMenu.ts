// Arbre du dock de personnalisation : quatre sections, chacune ses entrées (sous-onglets en haut de
// la section). Ajouter une entrée, c'est une ligne ici ; le composant qui la dessine se branche
// dans src/ui/BenchControls.tsx. Une entrée pas encore disponible s'affiche en fin de rangée,
// estompée, avec la mention « bientôt », sans action ; SHOW_UPCOMING les masque toutes d'un coup.

export type SectionId = 'vehicule' | 'custom' | 'mecanique' | 'garage';

export type EntryId =
  | 'vehicule'
  | 'peinture'
  | 'stickers'
  | 'carrosserie'
  | 'phares'
  | 'ailerons'
  | 'suspension'
  | 'preparation'
  | 'moteur'
  | 'echappement'
  | 'ambiance'
  | 'sortie';

export interface DockEntry {
  id: EntryId;
  label: string;
  /** Faux : affichée « bientôt », estompée, sans action. */
  available: boolean;
}

export interface DockSection {
  id: SectionId;
  label: string;
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
    entries: [{ id: 'vehicule', label: 'Véhicule', available: true }],
  },
  {
    id: 'custom',
    label: 'Custom',
    entries: [
      { id: 'peinture', label: 'Peinture', available: true },
      { id: 'stickers', label: 'Stickers', available: false },
      { id: 'carrosserie', label: 'Carrosserie', available: false },
      { id: 'phares', label: 'Phares', available: false },
      { id: 'ailerons', label: 'Ailerons', available: false },
      { id: 'suspension', label: 'Suspension', available: false },
    ],
  },
  {
    id: 'mecanique',
    label: 'Mécanique',
    requires: 'engine',
    entries: [
      { id: 'preparation', label: 'Préparation', available: true },
      { id: 'moteur', label: 'Moteur', available: false },
      { id: 'echappement', label: 'Échappement', available: false },
    ],
  },
  {
    id: 'garage',
    label: 'Garage',
    entries: [
      { id: 'ambiance', label: 'Ambiance', available: true },
      // La sortie de nuit (§ 5.5) : la carte, le départ, la météo et « Sortir ».
      { id: 'sortie', label: 'Sortie de nuit', available: true },
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
 * choix ; Custom, Mécanique et Garage (Ambiance, Sortie de nuit) montrent d'abord leurs entrées.
 */
export function directEntry(section: DockSection, showUpcoming = SHOW_UPCOMING): DockEntry | undefined {
  const list = sectionEntries(section, showUpcoming);
  return list.length === 1 && list[0]?.available ? list[0] : undefined;
}

export function sectionOf(entry: EntryId, menu: readonly DockSection[] = DOCK_MENU): DockSection | undefined {
  return menu.find((section) => section.entries.some((item) => item.id === entry));
}
