// La carrière pendant la sortie :
// - `EtiquetteRendezVous`, sous le nom de la carte (une ligne dans src/ui/drive/DriveScreen.tsx) : c'est un
//   rendez-vous, son numéro, son objectif (le temps du bronze pour ce véhicule) ;
// - `RouteImposee`, dans les réglages (src/ui/drive/Reglages.tsx) à la place des choix du moment et de la
//   météo : ils se lisent, grisés, sans se changer ; ça se prépare au garage, avant de partir.

import { METEO_LABEL, MOMENT_LABEL, rendezVousParId } from '../../data/carriere.ts';
import { MOMENTS } from '../../data/moments.ts';
import { formatChrono } from '../../drive/depart.ts';
import { seuilBronze } from '../../jeu/carriereCloture.ts';
import { useDrive, WEATHERS } from '../../state/drive.ts';
import { useVehiculeCourant } from './useCarriere.ts';
import './carriere.css';

export function EtiquetteRendezVous() {
  const enCours = useDrive((state) => state.rendezVous);
  const vehicule = useVehiculeCourant();
  const rdv = rendezVousParId(enCours?.id);
  if (!enCours || !rdv) return null;
  const seuil = rdv.objectif === 'bronze' ? seuilBronze({ ...rdv, vehicule }) : null;
  return (
    <span className="drive-rendez-vous" data-objectif={rdv.objectif}>
      <b>
        Rendez-vous {enCours.numero} sur {enCours.total}
      </b>
      <small>{rdv.objectif === 'finir' ? 'Objectif : finir' : seuil !== null ? `Objectif : bronze, sous ${formatChrono(seuil * 1000)}` : 'Objectif : bronze'}</small>
    </span>
  );
}

/** Une rangée de puces grisées, celle imposée allumée. */
function Impose({ nom, options, valeur }: { nom: string; options: readonly { id: string; label: string }[]; valeur: string }) {
  return (
    <div className="drive-choix" role="group" aria-label={nom}>
      <span className="drive-choix-nom" aria-hidden="true">
        {nom}
      </span>
      <div className="drive-choix-puces">
        {options.map((option) => (
          <button key={option.id} type="button" className="drive-puce" aria-pressed={option.id === valeur} disabled>
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function RouteImposee() {
  const enCours = useDrive((state) => state.rendezVous);
  const moment = useDrive((state) => state.moment);
  const weather = useDrive((state) => state.weather);
  if (!enCours) return null;
  return (
    <>
      <Impose nom="Moment" options={MOMENTS} valeur={moment} />
      <Impose nom="Météo" options={WEATHERS} valeur={weather} />
      <p className="drive-impose">
        {MOMENT_LABEL[moment]}, {METEO_LABEL[weather].toLowerCase()} : imposé par le rendez-vous {enCours.numero}. Ça se prépare au garage, avant de partir.
      </p>
    </>
  );
}
