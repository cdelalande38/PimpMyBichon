// Le rappel de la carrière au garage (demande du 18 novembre 2026 : le joueur sait TOUJOURS quel est son
// prochain rendez-vous, pour préparer son véhicule avant de partir), discret, jamais un bandeau sur la scène :
// `RappelCarriere`, dans Atelier › Ton compte (une ligne dans src/ui/jeu/JeuPanel.tsx) : le prochain rendez-vous en une
// phrase, et « Voir » qui ouvre le panneau de la carrière (src/ui/carriere/actions.ts). Le bouton rond du garage,
// qui portait la météo et le numéro du prochain rendez-vous, est retiré (vague X, 21 novembre 2026) : la carte
// « Carrière » de l'écran « Jouer » (src/ui/drive/entree/Modes.tsx) les porte.

import { ouvrirCarriere } from './actions.ts';
import { resumeRendezVous } from './FicheRendezVous.tsx';
import { useCarriere } from './useCarriere.ts';
import './carriere.css';

export function RappelCarriere() {
  const carriere = useCarriere();
  if (!carriere.hydrated || carriere.total === 0) return null;
  const { courant, numero, total, bouclee, saisonNumero } = carriere;
  const saison = saisonNumero > 1 ? ` (saison ${saisonNumero})` : '';
  return (
    <section className="carriere-rappel" aria-label="Rappel de la carrière" data-bouclee={bouclee || undefined}>
      <div className="carriere-rappel-tete">
        <div className="carriere-rappel-texte">
          <h3 id="carriere-rappel-titre">Carrière</h3>
          <p>
            {courant
              ? `Prochain rendez-vous : ${numero} sur ${total}${saison}, ${courant.titre}. ${resumeRendezVous(courant)}.`
              : 'Bouclée : toutes les saisons sont réussies. Une suite viendra.'}
          </p>
        </div>
        <button type="button" className="btn carriere-rappel-voir" aria-label="Voir la carrière" onClick={ouvrirCarriere}>
          Voir
        </button>
      </div>
    </section>
  );
}
