// Le rappel de la carrière au garage (demande du 18 novembre 2026 : le joueur sait TOUJOURS quel est son
// prochain rendez-vous, pour préparer son véhicule avant de partir), discret et permanent tant que la
// carrière n'est pas bouclée, jamais un bandeau sur la scène :
// - `RappelCarriere`, dans Atelier › Jeu (une ligne dans src/ui/jeu/JeuPanel.tsx) : le prochain
//   rendez-vous en une phrase, et « Voir » qui déplie le panneau de la carrière (PROVISOIRE : en attendant
//   l'étape « Mode » du menu de la sortie, c'est là qu'il vit ; src/ui/carriere/actions.ts) ;
// - `PastilleCarriere`, au garage, un bouton rond de plus dans la colonne des raccourcis, sous « Sortie »
//   (src/ui/Hud.tsx) : l'icône de la météo du prochain rendez-vous et son numéro ; un appui ouvre la
//   carrière. Il se tait une fois la carrière bouclée, et en vue intérieure.

import { useEffect, useRef } from 'react';
import { useView } from '../../state/view.ts';
import { DriveIcon } from '../drive/icones.tsx';
import { ouvrirCarriere, useCarriereOuverte } from './actions.ts';
import { CarrierePanneau } from './CarrierePanneau.tsx';
import { iconeMeteo, resumeRendezVous } from './FicheRendezVous.tsx';
import { useCarriere } from './useCarriere.ts';
import './carriere.css';

export function RappelCarriere() {
  const carriere = useCarriere();
  const ouverte = useCarriereOuverte((state) => state.ouverte);
  const setOuverte = useCarriereOuverte((state) => state.setOuverte);
  const rappel = useRef<HTMLElement>(null);
  // Déplié, le rappel vient en haut de la zone qui défile : la fiche à l'écran, « Sortir » entier en bas.
  useEffect(() => {
    if (ouverte) rappel.current?.scrollIntoView({ block: 'start' });
  }, [ouverte]);
  if (!carriere.hydrated || carriere.total === 0) return null;
  const { courant, numero, total, bouclee } = carriere;
  return (
    <section ref={rappel} className="carriere-rappel" aria-label="Rappel de la carrière" data-ouverte={ouverte || undefined} data-bouclee={bouclee || undefined}>
      <div className="carriere-rappel-tete">
        <div className="carriere-rappel-texte">
          <h3 id="carriere-rappel-titre">Carrière</h3>
          {/* Déplié, la fiche du panneau dit tout : la phrase se tait. */}
          {!ouverte && (
            <p>
              {courant
                ? `Prochain rendez-vous : ${numero} sur ${total}, ${courant.titre}. ${resumeRendezVous(courant)}.`
                : `Bouclée : les ${total} rendez-vous sont réussis.`}
            </p>
          )}
        </div>
        <button type="button" className="btn carriere-rappel-voir" aria-expanded={ouverte} aria-controls="carriere-rappel-panneau" onClick={() => setOuverte(!ouverte)}>
          {ouverte ? 'Replier' : 'Voir'}
        </button>
      </div>
      {ouverte && (
        <div id="carriere-rappel-panneau" className="carriere-rappel-panneau">
          <CarrierePanneau />
        </div>
      )}
    </section>
  );
}

export function PastilleCarriere() {
  const { hydrated, courant, numero, total } = useCarriere();
  // En vue intérieure, la colonne laisse la place aux sièges : la carrière attend le retour à l'atelier.
  const interieur = useView((state) => state.mode === 'interieur');
  if (!hydrated || !courant || interieur) return null;
  return (
    <button
      type="button"
      className="quick-btn carriere-rond"
      aria-label={`Carrière : prochain rendez-vous ${numero} sur ${total}, ${courant.titre}, ${resumeRendezVous(courant)}. Ouvrir la carrière`}
      title={`Carrière : rendez-vous ${numero} sur ${total}, ${resumeRendezVous(courant)}`}
      onClick={ouvrirCarriere}
    >
      <DriveIcon name={iconeMeteo(courant)} />
      <b className="carriere-rond-numero" aria-hidden="true">
        {numero}
      </b>
    </button>
  );
}
