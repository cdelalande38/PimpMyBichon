// Le rappel de la carrière au garage (demande du 18 novembre 2026 : le joueur sait TOUJOURS quel est son
// prochain rendez-vous, pour préparer son véhicule avant de partir), discret et permanent tant que la
// carrière n'est pas bouclée, jamais un bandeau sur la scène :
// - `RappelCarriere`, dans Atelier › Jeu (une ligne dans src/ui/jeu/JeuPanel.tsx) : le prochain
//   rendez-vous en une phrase, et « Voir » qui ouvre le panneau de la carrière, dans le menu de la sortie
//   (src/ui/carriere/actions.ts) ;
// - `PastilleCarriere`, au garage, un bouton rond de plus dans la colonne des raccourcis, sous « Sortie »
//   (src/ui/Hud.tsx) : l'icône de la météo du prochain rendez-vous et son numéro ; un appui ouvre la
//   carrière. Il se tait une fois la carrière bouclée, et en vue intérieure.

import { useView } from '../../state/view.ts';
import { DriveIcon } from '../drive/icones.tsx';
import { ouvrirCarriere } from './actions.ts';
import { iconeMeteo, resumeRendezVous } from './FicheRendezVous.tsx';
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

export function PastilleCarriere() {
  const { hydrated, courant, numero, total, saisonNumero } = useCarriere();
  // En vue intérieure, la colonne laisse la place aux sièges : la carrière attend le retour à l'atelier.
  const interieur = useView((state) => state.mode === 'interieur');
  if (!hydrated || !courant || interieur) return null;
  return (
    <button
      type="button"
      className="quick-btn carriere-rond"
      aria-label={`Carrière : prochain rendez-vous ${numero} sur ${total}${saisonNumero > 1 ? ` de la saison ${saisonNumero}` : ''}, ${courant.titre}, ${resumeRendezVous(courant)}. Ouvrir la carrière`}
      title={`Carrière : saison ${saisonNumero}, rendez-vous ${numero} sur ${total}, ${resumeRendezVous(courant)}`}
      onClick={ouvrirCarriere}
    >
      <DriveIcon name={iconeMeteo(courant)} />
      <b className="carriere-rond-numero" aria-hidden="true">
        {numero}
      </b>
    </button>
  );
}
