// Commandes du banc d'essai, dans le dock : une rangée d'onglets (Teinte, Finition, Ambiance),
// une rangée de choix. Le motif des réglages ; les listes viennent de src/data/.

import { useEffect, useRef, useState } from 'react';
import { AMBIANCES } from '../data/ambiances.ts';
import { FINISHES } from '../data/finishes.ts';
import { PAINT_COLORS } from '../data/paintColors.ts';
import { useBench, type BenchChoices } from '../state/bench.ts';

interface Choice {
  id: string;
  label: string;
  hint?: string;
  /** Pastille de couleur devant le nom. */
  swatch?: string;
}

interface BenchTab {
  key: keyof BenchChoices;
  label: string;
  choices: readonly Choice[];
}

const TABS: readonly BenchTab[] = [
  {
    key: 'color',
    label: 'Teinte',
    choices: PAINT_COLORS.map(({ id, label, hex }) => ({ id, label, swatch: hex })),
  },
  {
    key: 'finish',
    label: 'Finition',
    choices: FINISHES.map(({ id, label, hint }) => ({ id, label, hint })),
  },
  {
    key: 'ambiance',
    label: 'Ambiance',
    choices: AMBIANCES.map(({ id, label, hint }) => ({ id, label, hint })),
  },
];

function Choices({ tab }: { tab: BenchTab }) {
  const current = useBench((state) => state[tab.key]);
  const choose = useBench((state) => state.choose);
  // La rangée défile : le choix en cours est amené dans le champ (après relecture de la sauvegarde aussi).
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      row.current
        ?.querySelector('[aria-pressed="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [tab.key, current]);

  return (
    <div ref={row} className="chips" role="group" aria-label={tab.label}>
      {tab.choices.map((choice) => (
        <button
          key={choice.id}
          type="button"
          className={choice.swatch ? 'chip chip-swatch' : 'chip'}
          aria-pressed={current === choice.id}
          onClick={() => choose(tab.key, choice.id as BenchChoices[typeof tab.key])}
        >
          {choice.swatch && (
            <span className="swatch" aria-hidden="true" style={{ background: choice.swatch }} />
          )}
          <b>{choice.label}</b>
          {choice.hint && <small>{choice.hint}</small>}
        </button>
      ))}
    </div>
  );
}

export function BenchControls() {
  const [active, setActive] = useState<keyof BenchChoices>('color');
  const tab = TABS.find((item) => item.key === active) ?? TABS[0];

  return (
    <>
      <nav className="tabs" aria-label="Banc d’essai">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            aria-current={active === item.key ? 'true' : undefined}
            onClick={() => setActive(item.key)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      {tab && <Choices key={tab.key} tab={tab} />}
    </>
  );
}
