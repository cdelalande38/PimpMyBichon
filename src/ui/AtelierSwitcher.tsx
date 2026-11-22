// Panneau « Atelier » (roue dentée du haut de l'écran) : la configuration de l'app et le jeu, en trois
// rubriques du même panneau, « Réglages », « Sous le capot » et « Ton compte ». Chaque rubrique garde sa route (#/reglages,
// #/capot, #/jeu) : les liens directs marchent, et passer de l'une à l'autre ne s'empile pas dans
// l'historique (un seul « Retour » ferme le panneau).

import { useEffect } from 'react';
import type { SheetRouteName } from '../app/router.ts';
import { openSheet, switchSheet } from '../app/useRoute.ts';

export const ATELIER_TABS = [
  { route: 'reglages', label: 'Réglages' },
  { route: 'capot', label: 'Sous le capot' },
  { route: 'jeu', label: 'Ton compte' },
] as const satisfies ReadonlyArray<{ route: SheetRouteName; label: string }>;

export type AtelierRoute = (typeof ATELIER_TABS)[number]['route'];

export function isAtelierRoute(name: string): name is AtelierRoute {
  return ATELIER_TABS.some((tab) => tab.route === name);
}

// La roue dentée rouvre la dernière rubrique vue pendant la séance.
let lastTab: AtelierRoute = 'reglages';

export function openAtelier(): void {
  openSheet({ name: lastTab });
}

/** Rubriques du panneau, posées juste au-dessus de « Retour à l'atelier », sous le pouce. */
export function AtelierSwitcher({ current }: { current: AtelierRoute }) {
  useEffect(() => {
    lastTab = current;
  }, [current]);
  return (
    <nav className="tabs atelier-tabs" aria-label="Rubriques de l’atelier">
      {ATELIER_TABS.map((tab) => (
        <button
          key={tab.route}
          type="button"
          aria-current={tab.route === current ? 'true' : undefined}
          onClick={() => switchSheet({ name: tab.route })}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
