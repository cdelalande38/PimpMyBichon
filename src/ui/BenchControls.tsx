// Commandes de l'atelier, dans le dock : une rangée d'onglets (Véhicule, Peinture, Ambiance) et, au
// bout, la poignée qui agrandit le dock ; puis le contenu de l'onglet. Le motif des réglages ; les
// listes viennent de src/data/ et des manifestes. Dock agrandi : les rangées passent à la ligne.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AMBIANCES } from '../data/ambiances.ts';
import { useBench } from '../state/bench.ts';
import { PaintControls } from './paint/PaintControls.tsx';
import { VehiclePicker } from './vehicles/VehiclePicker.tsx';

function AmbianceChoices() {
  const current = useBench((state) => state.ambiance);
  const choose = useBench((state) => state.choose);
  // La rangée défile : le choix en cours est amené dans le champ (après relecture de la sauvegarde aussi).
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      row.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [current]);

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

type TabKey = 'vehicule' | 'peinture' | 'ambiance';

const TABS: ReadonlyArray<{ key: TabKey; label: string; body: () => ReactNode }> = [
  { key: 'vehicule', label: 'Véhicule', body: () => <VehiclePicker /> },
  { key: 'peinture', label: 'Peinture', body: () => <PaintControls /> },
  { key: 'ambiance', label: 'Ambiance', body: () => <AmbianceChoices /> },
];

interface BenchControlsProps {
  /** Poignée du dock, au bout de la rangée d'onglets : dans la ligne, elle n'ajoute aucune hauteur. */
  handle?: ReactNode;
}

export function BenchControls({ handle }: BenchControlsProps) {
  const [active, setActive] = useState<TabKey>('vehicule');
  const tab = TABS.find((item) => item.key === active) ?? TABS[0];

  return (
    <>
      <div className="dock-tabs-row">
        <nav className="tabs" aria-label="Onglets de l’atelier">
          {TABS.map((item) => (
            <button key={item.key} type="button" aria-current={active === item.key ? 'true' : undefined} onClick={() => setActive(item.key)}>
              {item.label}
            </button>
          ))}
        </nav>
        {handle}
      </div>
      {tab && <div key={tab.key} className="dock-tab">{tab.body()}</div>}
    </>
  );
}
