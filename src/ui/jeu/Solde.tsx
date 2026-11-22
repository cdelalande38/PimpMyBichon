// Le solde en dollars, au garage : une petite pastille à côté de la marque (src/ui/Hud.tsx). Un appui
// ouvre Atelier › Ton compte. Le bouton fait 48 px ; la pastille dessinée, plus petite, est son étiquette. Elle se
// tait tant que la sauvegarde n'est pas lue, pour ne pas afficher « 0 $ » à tort.

import { openSheet } from '../../app/useRoute.ts';
import { useJeu } from '../../state/jeu.ts';
import { dollars } from './libelles.ts';
import './jeu.css';

export function Solde({ covered = false }: { covered?: boolean }) {
  const hydrated = useJeu((state) => state.hydrated);
  const solde = useJeu((state) => state.solde);
  if (!hydrated) return null;
  return (
    <button
      type="button"
      className="solde-pill"
      aria-label={`Ton solde : ${solde} dollars. Ouvrir ton compte`}
      title="Ton solde : la boutique et les hauts faits"
      inert={covered}
      onClick={() => openSheet({ name: 'jeu' })}
    >
      <span className="solde-pill-dessin" aria-hidden="true">{dollars(solde)}</span>
    </button>
  );
}
