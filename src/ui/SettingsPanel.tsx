// Réglages (§ 5.9), sur le motif du dock du prototype : une rangée d'onglets, une rangée de choix.
// Tout tient dans le tiers bas et se règle d'un pouce. La liste est décrite par des données.

import { useEffect, useRef, useState } from 'react';
import { useMediaQuery } from '../app/useMediaQuery.ts';
import type { Settings } from '../state/settings.ts';
import { useSettings } from '../state/store.ts';

interface Choice<V> {
  value: V;
  label: string;
  hint: string;
}

interface SettingTab<K extends keyof Settings> {
  key: K;
  label: string;
  choices: ReadonlyArray<Choice<Settings[K]>>;
}

const QUALITY: SettingTab<'quality'> = {
  key: 'quality',
  label: 'Qualité',
  choices: [
    { value: 'auto', label: 'Auto', hint: 'L’atelier choisit' },
    { value: 'eco', label: 'Économie', hint: 'La batterie d’abord' },
    { value: 'standard', label: 'Standard', hint: 'Le bon compromis' },
    { value: 'max', label: 'Max', hint: 'Tout à fond' },
  ],
};

const ROTATION: SettingTab<'autoRotate'> = {
  key: 'autoRotate',
  label: 'Rotation',
  choices: [
    { value: true, label: 'Activée', hint: 'Tourne au repos' },
    { value: false, label: 'Coupée', hint: 'Bouge sous ton pouce' },
  ],
};

const TEXT: SettingTab<'textSize'> = {
  key: 'textSize',
  label: 'Texte',
  choices: [
    { value: 'normal', label: 'Normal', hint: 'Taille d’origine' },
    { value: 'grand', label: 'Grand', hint: 'Plus lisible' },
    { value: 'tres-grand', label: 'Très grand', hint: 'Sans lunettes' },
  ],
};

const AUTOPLAY: SettingTab<'autoPlay'> = {
  key: 'autoPlay',
  label: 'Lecture automatique',
  choices: [
    { value: true, label: 'Activée', hint: 'La radio part toute seule' },
    { value: false, label: 'Coupée', hint: 'Elle attend ton signal' },
  ],
};

const TABS = [QUALITY, ROTATION, TEXT, AUTOPLAY] as const;
type TabKey = (typeof TABS)[number]['key'];

function Choices<K extends keyof Settings>({ tab }: { tab: SettingTab<K> }) {
  const current = useSettings((state) => state[tab.key]);
  const change = useSettings((state) => state.change);
  // La rangée défile : on amène le choix en cours dans le champ, sinon rien ne paraît sélectionné.
  // À l'image suivante seulement : un changement de taille du texte élargit d'abord la rangée.
  const row = useRef<HTMLDivElement>(null);
  const textSize = useSettings((state) => state.textSize);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      row.current
        ?.querySelector('[aria-pressed="true"]')
        ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [tab.key, current, textSize]);
  return (
    <div ref={row} className="chips" role="group" aria-label={tab.label}>
      {tab.choices.map((choice) => (
        <button
          key={String(choice.value)}
          type="button"
          className="chip"
          aria-pressed={current === choice.value}
          onClick={() => change(tab.key, choice.value)}
        >
          <b>{choice.label}</b>
          <small>{choice.hint}</small>
        </button>
      ))}
    </div>
  );
}

export function SettingsPanel() {
  const [active, setActive] = useState<TabKey>('quality');
  const reducedMotion = useMediaQuery('(prefers-reduced-motion: reduce)');

  return (
    <>
      {/* La note passe au-dessus : les commandes restent les éléments les plus bas du panneau. */}
      <p className="note">
        {active === 'autoRotate' && reducedMotion
          ? 'Ton téléphone demande moins de mouvement\u00a0: la rotation reste coupée, quel que soit ce réglage.'
          : 'Le volume de la musique se règle dans l’autoradio\u00a0; le pilote automatique et le son du moteur, sur la route, en sortie de nuit.'}
      </p>

      <nav className="tabs" aria-label="Réglages">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            aria-current={active === tab.key ? 'true' : undefined}
            onClick={() => setActive(tab.key)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {active === 'quality' && <Choices tab={QUALITY} />}
      {active === 'autoRotate' && <Choices tab={ROTATION} />}
      {active === 'textSize' && <Choices tab={TEXT} />}
      {active === 'autoPlay' && <Choices tab={AUTOPLAY} />}
    </>
  );
}
