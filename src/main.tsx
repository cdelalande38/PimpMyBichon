import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
// Polices embarquées (licence OFL, voir CREDITS.md) : rien ne vient d'un serveur tiers.
import '@fontsource/russo-one/latin-400.css';
import '@fontsource/chakra-petch/latin-400.css';
import '@fontsource/chakra-petch/latin-600.css';
import '@fontsource/chakra-petch/latin-700.css';
import './app/styles.css';
import { App } from './app/App.tsx';
import { startPwa } from './pwa/register.ts';
import { askPersistentStorage } from './state/persistence.ts';

const root = document.getElementById('root');
if (!root) throw new Error('Élément #root introuvable dans index.html');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

startPwa();
void askPersistentStorage();
