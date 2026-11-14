// Un seul panneau bas, dont le contenu suit la route. Les textes vivent ici, en données.

import type { ReactNode } from 'react';
import type { Route, SheetRouteName } from '../app/router.ts';
import { closeSheet } from '../app/useRoute.ts';
import { SettingsPanel } from './SettingsPanel.tsx';
import { Sheet } from './Sheet.tsx';
import { UnderHoodPanel } from './UnderHoodPanel.tsx';

interface SheetContent {
  eyebrow: string;
  title: string;
  body: ReactNode;
}

const CONTENT: Record<SheetRouteName, SheetContent> = {
  reglages: {
    eyebrow: 'Atelier',
    title: 'Réglages',
    body: <SettingsPanel />,
  },
  capot: {
    eyebrow: 'État du socle',
    title: 'Sous le capot',
    body: <UnderHoodPanel />,
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
        Cette version de l’atelier ne sait pas encore l’ouvrir : la lecture des builds arrive avec le
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
  const content = route.name === 'garage' ? null : CONTENT[route.name];
  return (
    <Sheet
      open={content !== null}
      eyebrow={content?.eyebrow ?? ''}
      title={content?.title ?? ''}
      onClose={closeSheet}
    >
      {content?.body}
    </Sheet>
  );
}
