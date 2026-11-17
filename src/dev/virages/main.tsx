// Aperçu des virages : la page d'aperçu de la sortie (src/dev/sortie/, mêmes paramètres d'URL et mêmes
// prises window.pmbSortie) avec, en plus, la mini-carte de l'écran de la sortie (src/ui/drive/MiniCarte.tsx)
// posée en haut à gauche. Servi par le serveur de développement seulement, jamais importé par l'app.
// Captures : node tools/captures/virages.mjs.

import { createRoot } from 'react-dom/client';
import { MiniCarte } from '../../ui/drive/MiniCarte.tsx';
import '../sortie/main.tsx';

const hote = document.getElementById('minicarte-hote');
if (hote) createRoot(hote).render(<MiniCarte />);
