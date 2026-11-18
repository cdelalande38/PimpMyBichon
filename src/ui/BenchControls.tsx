// Commandes de personnalisation, dans le dock, un niveau à la fois : les sections (Véhicule, Custom,
// Mécanique, Garage) ; dans une section, ses entrées (Peinture, Stickers… ; « bientôt » estompées en
// fin de rangée) ; dans une entrée, son seul contenu. Une section à une seule entrée ouvre directement
// son contenu (Véhicule) ; Garage montre Ambiance et Sortie. L'arbre vient de
// src/data/dockMenu.ts ; section, niveau du menu, entrée et niveaux vivent dans le store du dock
// (src/state/dock.ts) : ils se posent de l'extérieur. « Mécanique » n'apparaît que si le véhicule à l'écran déclare un moteur. Dock agrandi : les rangées passent à la
// ligne. La poignée et « Retour » vivent dans la ligne de repère (src/ui/Dock.tsx). Sections et entrées
// portent leur icône au-dessus du mot (déclarée dans src/data/dockMenu.ts) ; le nom du bouton reste le mot.

import { useRef, type ReactNode } from 'react';
import { AMBIANCES } from '../data/ambiances.ts';
import { activeEntry, sectionEntries, visibleSections, type EntryId } from '../data/dockMenu.ts';
import { resolveVehicle } from '../data/vehicles.ts';
import { useBench } from '../state/bench.ts';
import { useBuilds } from '../state/builds.ts';
import { useDock } from '../state/dock.ts';
import { EchappementPanel } from './echappement/EchappementPanel.tsx';
import { EnginePanel } from './engine/EnginePanel.tsx';
import { HabitaclePanel } from './habitacle/HabitaclePanel.tsx';
import { MoteurPanel } from './moteur/MoteurPanel.tsx';
import { Icon } from './icons.tsx';
import { PaintControls } from './paint/PaintControls.tsx';
import { PharesPanel } from './phares/PharesPanel.tsx';
import { PictoAmbiance } from './pictos/Pictos.tsx';
import { PiecesGroupe } from './pieces/PiecesGroupe.tsx';
import { PiecesPanel } from './pieces/PiecesPanel.tsx';
import { useLevelScroll, useRevealPressed } from './scroll.ts';
import { SortieEntree } from './drive/SortieEntree.tsx';
import { StickersPanel } from './stickers/StickersPanel.tsx';
import { VehiclePicker } from './vehicles/VehiclePicker.tsx';
import { SuspensionPanel } from './wheels/SuspensionPanel.tsx';
import { WheelsPanel } from './wheels/WheelsPanel.tsx';

function AmbianceChoices() {
  const current = useBench((state) => state.ambiance);
  const choose = useBench((state) => state.choose);
  // La rangée défile : le choix en cours est amené dans le champ s'il en est sorti (relecture).
  const row = useRevealPressed<HTMLDivElement>(current);

  return (
    <div ref={row} className="chips" role="group" aria-label="Ambiance">
      {AMBIANCES.map((choice) => (
        <button key={choice.id} type="button" className="chip chip-picto" aria-pressed={current === choice.id} onClick={() => choose('ambiance', choice.id)}>
          <PictoAmbiance ambiance={choice} />
          <span className="chip-text">
            <b>{choice.label}</b>
            {choice.hint && <small>{choice.hint}</small>}
          </span>
        </button>
      ))}
    </div>
  );
}

/** Ce que dessine chaque entrée disponible de src/data/dockMenu.ts. */
export const ENTRY_BODIES: Partial<Record<EntryId, () => ReactNode>> = {
  vehicule: () => <VehiclePicker />,
  peinture: () => <PaintControls />,
  roues: () => <WheelsPanel />,
  suspension: () => <SuspensionPanel />,
  interieur: () => <HabitaclePanel />,
  stickers: () => <StickersPanel />,
  phares: () => <PharesPanel />,
  carrosserie: () => <PiecesGroupe groupe="carrosserie" />,
  ailerons: () => <PiecesPanel poste="aileron" />,
  preparation: () => <EnginePanel />,
  moteur: () => <MoteurPanel />,
  echappement: () => <EchappementPanel />,
  ambiance: () => <AmbianceChoices />,
  sortie: () => <SortieEntree />,
};

export function BenchControls() {
  const hasEngine = resolveVehicle(useBuilds((state) => state.current)).engine !== undefined;
  const sections = visibleSections(hasEngine);
  const chosen = useDock((state) => state.section);
  const menu = useDock((state) => state.menu);
  const remembered = useDock((state) => state.entries);
  const depth = useDock((state) => state.levels.length);
  const setSection = useDock((state) => state.setSection);
  const setEntry = useDock((state) => state.setEntry);
  // Véhicule sans moteur déclaré : « Mécanique » disparaît, on retombe sur les sections.
  const section = sections.find((item) => item.id === chosen);
  const level = section ? menu : 'sections';
  const entry = section ? activeEntry(section, remembered[section.id]) : undefined;
  const list = section ? sectionEntries(section) : [];
  const body = useRef<HTMLDivElement>(null);
  // Clé du niveau : le niveau du menu compris, pour que le contenu retienne sa position dès qu'il paraît.
  useLevelScroll(body, `${level}/${section?.id}/${entry?.id}/${depth}`);

  // Un seul niveau à l'écran : les sections, les entrées de la section, ou le contenu de l'entrée.
  if (level === 'sections') {
    return (
      <div className="dock-tabs-row">
        <nav className="tabs dock-sections" aria-label="Onglets de l’atelier">
          {sections.map((item) => (
            <button key={item.id} type="button" aria-current={section?.id === item.id ? 'true' : undefined} onClick={() => setSection(item.id)}>
              {item.icon && <Icon name={item.icon} />}
              <span className="dock-label">{item.label}</span>
            </button>
          ))}
        </nav>
      </div>
    );
  }
  if (level === 'entrees' && section) {
    return (
      <nav className="tabs dock-entries" aria-label={`Entrées · ${section.label}`}>
        {list.map((item) =>
          item.available ? (
            <button key={item.id} type="button" aria-current={entry?.id === item.id ? 'true' : undefined} onClick={() => setEntry(item.id)}>
              {item.icon && <Icon name={item.icon} />}
              <span className="dock-label">{item.label}</span>
            </button>
          ) : (
            <button key={item.id} type="button" className="dock-soon" disabled aria-label={`${item.label}, bientôt`}>
              {item.icon && <Icon name={item.icon} />}
              <span className="dock-label">{item.label}</span>
              <small aria-hidden="true">bientôt</small>
            </button>
          ),
        )}
      </nav>
    );
  }
  return entry ? (
    <div ref={body} key={entry.id} className="dock-tab" data-onglet={entry.id}>
      {ENTRY_BODIES[entry.id]?.()}
    </div>
  ) : null;
}
