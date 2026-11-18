// Un seul panneau bas, dont le contenu suit la route. Les textes vivent ici, en données.

import type { ReactNode } from 'react';
import { isSheetRoute, type Route, type SheetRouteName } from '../app/router.ts';
import { closeSheet } from '../app/useRoute.ts';
import { AtelierSwitcher, isAtelierRoute } from './AtelierSwitcher.tsx';
import { JeuPanel } from './jeu/JeuPanel.tsx';
import { RadioPanel } from './radio/RadioPanel.tsx';
import { SettingsPanel } from './SettingsPanel.tsx';
import { Sheet } from './Sheet.tsx';
import { MeterButton, UnderHoodPanel } from './UnderHoodPanel.tsx';

interface SheetContent {
  eyebrow: string;
  title: string;
  body: ReactNode;
  /** Commandes propres au panneau, à côté de « Retour à l'atelier ». */
  actions?: ReactNode;
}

const CONTENT: Record<SheetRouteName, SheetContent> = {
  reglages: {
    eyebrow: 'Atelier · configuration',
    title: 'Réglages',
    body: <SettingsPanel />,
  },
  capot: {
    eyebrow: 'Atelier · état du socle',
    title: 'Sous le capot',
    body: <UnderHoodPanel />,
    actions: <MeterButton />,
  },
  jeu: {
    eyebrow: 'Atelier · jeu',
    title: 'Ton compte',
    body: <JeuPanel />,
  },
  radio: {
    eyebrow: 'Au garage',
    title: 'La radio',
    body: <RadioPanel />,
  },
  commande: {
    eyebrow: 'Passer commande à Bichon',
    title: 'Le carnet de commandes n’est pas encore ouvert',
    body: (
      <p>
        Bientôt, tu choisiras ici un véhicule, un budget et tes exigences, puis tu enverras le lien à
        Bichon. Ça arrive avec le jalon 10.
      </p>
    ),
  },
  build: {
    eyebrow: 'Lien de build',
    title: 'Tu as reçu un build',
    body: (
      <p>
        Cette version de l’atelier ne sait pas encore l’ouvrir&nbsp;: la lecture des builds arrive avec le
        jalon 10. Garde le lien sous le coude.
      </p>
    ),
  },
  defi: {
    eyebrow: 'Lien de défi',
    title: 'Tu as reçu une commande',
    body: (
      <p>
        Le carnet de commandes arrive avec le jalon 10. Garde le lien sous le coude, il sera rangé à
        ce moment-là.
      </p>
    ),
  },
  illisible: {
    eyebrow: 'Lien reçu',
    title: 'Lien illisible',
    body: (
      <p>Il manque un morceau du lien. Vérifie le copier-coller, ou redemande-le à ton pote.</p>
    ),
  },
};

export function Sheets({ route }: { route: Route }) {
  const content = isSheetRoute(route) ? CONTENT[route.name] : null;
  return (
    <Sheet
      open={content !== null}
      eyebrow={content?.eyebrow ?? ''}
      title={content?.title ?? ''}
      onClose={closeSheet}
      actions={content?.actions}
      switcher={isSheetRoute(route) && isAtelierRoute(route.name) ? <AtelierSwitcher current={route.name} /> : undefined}
    >
      {content?.body}
    </Sheet>
  );
}
