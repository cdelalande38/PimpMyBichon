// Panneau de la carrière (vague U, contrat entre lots : export nommé, sans propriété obligatoire). Le menu
// de la sortie l'affiche quand le joueur choisit « Carrière » (lot « entree », étape « Mode ») ; en
// attendant, il se déplie dans Atelier › Jeu (src/ui/carriere/RappelCarriere.tsx, provisoire).
//
// De haut en bas : « Carrière » et les rendez-vous réussis (une case par rendez-vous) ; la fiche du
// rendez-vous courant (src/ui/carriere/FicheRendezVous.tsx) ; « Sortir », collé en bas sous le pouce et
// toujours entier (dans le panneau du bas en portrait comme dans la colonne étroite du paysage) : il
// part avec TOUT imposé, sans choix de météo, de moment ni de format. Carrière bouclée : une fin sobre.

import { CARRIERE } from '../../data/carriere.ts';
import { useJeu } from '../../state/jeu.ts';
import { sortirSurRendezVous } from './actions.ts';
import { FicheRendezVous } from './FicheRendezVous.tsx';
import { useCarriere } from './useCarriere.ts';
import './carriere.css';

/** Une case par rendez-vous : réussi, courant, à venir. */
function Jalons({ numero, reussis, total }: { numero: number; reussis: number; total: number }) {
  const progression = useJeu((state) => state.carriere);
  return (
    <ol className="carriere-jalons" role="progressbar" aria-label="Rendez-vous réussis" aria-valuemin={0} aria-valuemax={total} aria-valuenow={reussis} aria-valuetext={`${reussis} sur ${total}`}>
      {CARRIERE.map((rdv, i) => (
        <li key={rdv.id} data-etat={progression.resultats[rdv.id]?.reussi ? 'reussi' : i + 1 === numero ? 'courant' : 'a-venir'} />
      ))}
    </ol>
  );
}

export function CarrierePanneau() {
  const carriere = useCarriere();
  if (!carriere.hydrated) return <p className="carriere-note">Ta carrière se relit…</p>;
  if (carriere.total === 0) return <p className="carriere-note">Pas de carrière dans cette version : les courses libres t’attendent.</p>;
  const { courant, numero, total, reussis } = carriere;
  return (
    <section className="carriere" aria-label="Carrière" data-etat={courant ? 'en-cours' : 'bouclee'}>
      <div className="carriere-corps">
        <header className="carriere-tete">
          <span className="carriere-surtitre">Carrière</span>
          <span className="carriere-compte">
            {reussis} sur {total} réussi{reussis > 1 ? 's' : ''}
          </span>
        </header>
        <Jalons numero={numero} reussis={reussis} total={total} />
        {courant ? (
          <FicheRendezVous rdv={courant} numero={numero} total={total} />
        ) : (
          <div className="carriere-bouclee">
            <h3>Carrière bouclée</h3>
            <p>
              Les {total} rendez-vous sont réussis. Chapeau. Les courses libres t’attendent, et tes records aussi.
            </p>
          </div>
        )}
      </div>
      {courant && (
        <div className="carriere-go">
          <button type="button" className="btn cta carriere-sortir" aria-label="Sortir" aria-describedby="carriere-sortir-aide" onClick={() => sortirSurRendezVous(courant, numero, total)}>
            <span>Sortir</span>
            <small id="carriere-sortir-aide">Rendez-vous {numero} · tout est imposé</small>
          </button>
        </div>
      )}
    </section>
  );
}
