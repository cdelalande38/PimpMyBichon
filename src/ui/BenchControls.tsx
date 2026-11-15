// Commandes de personnalisation, dans le dock : une rangée de sections (Véhicule, Custom, Mécanique,
// Garage) et, au bout, la poignée qui agrandit le dock ; dessous, les entrées de la section
// (sous-onglets : Peinture, Stickers… ; « bientôt » estompées en fin de rangée) ; puis le contenu de
// l'entrée. L'arbre vient de src/data/dockMenu.ts ; section, entrée et niveaux vivent dans le store
// du dock (src/state/dock.ts) : ils se posent de l'extérieur. « Mécanique » n'apparaît que si le
// véhicule à l'écran déclare un moteur. Dock agrandi : les rangées passent à la ligne.

import { useRef, type ReactNode } from 'react';
import { AMBIANCES } from '../data/ambiances.ts';
import { activeEntry, sectionEntries, visibleSections, type EntryId } from '../data/dockMenu.ts';
import { resolveVehicle } from '../data/vehicles.ts';
import { useBench } from '../state/bench.ts';
import { useBuilds } from '../state/builds.ts';
import { useDock } from '../state/dock.ts';
import { EnginePanel } from './engine/EnginePanel.tsx';
import { PaintControls } from './paint/PaintControls.tsx';
import { useLevelScroll, useRevealPressed } from './scroll.ts';
import { VehiclePicker } from './vehicles/VehiclePicker.tsx';

function AmbianceChoices() {
  const current = useBench((state) => state.ambiance);
  const choose = useBench((state) => state.choose);
  // La rangée défile : le choix en cours est amené dans le champ s'il en est sorti (relecture).
  const row = useRevealPressed<HTMLDivElement>(current);

  return (
    <div ref={row} className="chips" role="group" aria-label="Ambiance">
      {AMBIANCES.map((choice) => (
        <button key={choice.id} type="button" className="chip" aria-pressed={current === choice.id} onClick={() => choose('ambiance', choice.id)}>
          <b>{choice.label}</b>
          {choice.hint && <small>{choice.hint}</small>}
        </button>
      ))}
    </div>
  );
}

/** Ce que dessine chaque entrée disponible de src/data/dockMenu.ts. */
export const ENTRY_BODIES: Partial<Record<EntryId, () => ReactNode>> = {
  vehicule: () => <VehiclePicker />,
  peinture: () => <PaintControls />,
  preparation: () => <EnginePanel />,
  ambiance: () => <AmbianceChoices />,
};

interface BenchControlsProps {
  /** Poignée du dock, au bout de la rangée des sections : dans la ligne, elle n'ajoute aucune hauteur. */
  handle?: ReactNode;
}

export function BenchControls({ handle }: BenchControlsProps) {
  const hasEngine = resolveVehicle(useBuilds((state) => state.current)).engine !== undefined;
  const sections = visibleSections(hasEngine);
  const chosen = useDock((state) => state.section);
  const remembered = useDock((state) => state.entries);
  const depth = useDock((state) => state.levels.length);
  const setSection = useDock((state) => state.setSection);
  const setEntry = useDock((state) => state.setEntry);
  // Véhicule sans moteur déclaré : « Mécanique » disparaît, on retombe sur « Véhicule ».
  const section = sections.find((item) => item.id === chosen) ?? sections[0];
  const entry = section ? activeEntry(section, remembered[section.id]) : undefined;
  const list = section ? sectionEntries(section) : [];
  const body = useRef<HTMLDivElement>(null);
  useLevelScroll(body, `${section?.id}/${entry?.id}/${depth}`);

  return (
    <>
      <div className="dock-tabs-row">
        <nav className="tabs" aria-label="Onglets de l’atelier">
          {sections.map((item) => (
            <button key={item.id} type="button" aria-current={section?.id === item.id ? 'true' : undefined} onClick={() => setSection(item.id)}>
              {item.label}
            </button>
          ))}
        </nav>
        {handle}
      </div>
      {/* Une seule entrée (Véhicule, Garage) : pas de rangée, elle s'affiche dès qu'une autre arrive. */}
      {section && list.length > 1 && (
        <nav className="tabs dock-entries" aria-label={`Entrées · ${section.label}`}>
          {list.map((item) =>
            item.available ? (
              <button key={item.id} type="button" aria-current={entry?.id === item.id ? 'true' : undefined} onClick={() => setEntry(item.id)}>
                {item.label}
              </button>
            ) : (
              <button key={item.id} type="button" className="dock-soon" disabled aria-label={`${item.label}, bientôt`}>
                {item.label}
                <small aria-hidden="true">bientôt</small>
              </button>
            ),
          )}
        </nav>
      )}
      {entry && (
        <div ref={body} key={entry.id} className="dock-tab" data-onglet={entry.id}>
          {ENTRY_BODIES[entry.id]?.()}
        </div>
      )}
    </>
  );
}
