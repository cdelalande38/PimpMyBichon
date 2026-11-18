// Fiche d'un rendez-vous de carrière : tout ce qu'il faut savoir pour préparer le véhicule AVANT de partir
// (demande du 18 novembre 2026 : « on lui annonce le prochain […] zone, circuit et météo »). Son numéro et
// son nom ; la météo, le moment et le format imposés (en premier : en paysage, la place est comptée) ; la
// zone et la carte, avec la miniature du tracé, et le départ ; l'objectif (le temps du bronze pour le
// véhicule à l'écran) et la prime ; une ligne de conseil de préparation tirée des données
// (src/data/carriere.ts). Rien ne s'y touche.

import { conseilDe, METEO_LABEL, MOMENT_LABEL, OBJECTIF_LABEL, type RendezVous } from '../../data/carriere.ts';
import { formatSpec } from '../../data/courses.ts';
import { mapById } from '../../data/maps.ts';
import { formatChrono } from '../../drive/depart.ts';
import { seuilBronze } from '../../jeu/carriereCloture.ts';
import { DriveIcon, type DriveIconName } from '../drive/icones.tsx';
import { dollars } from '../jeu/libelles.ts';
import { PictoCarte } from '../pictos/Pictos.tsx';
import { useLibelleDepart, useVehiculeCourant, zoneDe } from './useCarriere.ts';

/** Icône de la météo : le soleil au sec de jour, la lune au sec de nuit (comme au menu de la sortie). */
export function iconeMeteo(rdv: Pick<RendezVous, 'meteo' | 'moment'>): DriveIconName {
  return rdv.meteo === 'sec' && rdv.moment === 'jour' ? 'soleil' : rdv.meteo;
}

/** « Miami Beach, le front de mer · au sec · de jour » : la zone (ou la carte), la météo, le moment. */
export function resumeRendezVous(rdv: RendezVous): string {
  const map = mapById(rdv.carte);
  return [zoneDe(map) ?? map?.name ?? rdv.carte, METEO_LABEL[rdv.meteo].toLowerCase(), MOMENT_LABEL[rdv.moment].toLowerCase()].join(' · ');
}

export function FicheRendezVous({ rdv, numero, total }: { rdv: RendezVous; numero: number; total: number }) {
  const map = mapById(rdv.carte);
  const zone = zoneDe(map);
  const depart = useLibelleDepart(rdv.carte, rdv.depart);
  const vehicule = useVehiculeCourant();
  const seuil = rdv.objectif === 'bronze' ? seuilBronze({ ...rdv, vehicule }) : null;
  return (
    <div className="carriere-fiche" data-rendez-vous={rdv.id}>
      <p className="carriere-fiche-numero">
        Rendez-vous {numero} sur {total}
      </p>
      <h3 className="carriere-fiche-titre">{rdv.titre}</h3>
      <ul className="carriere-fiche-conditions" aria-label="Imposé par le rendez-vous">
        <li data-meteo={rdv.meteo}>
          <DriveIcon name={iconeMeteo(rdv)} />
          {METEO_LABEL[rdv.meteo]}
        </li>
        <li data-moment={rdv.moment}>{MOMENT_LABEL[rdv.moment]}</li>
        <li data-format={rdv.format}>{formatSpec(rdv.format).label}</li>
      </ul>
      <div className="carriere-fiche-lieu">
        <PictoCarte id={rdv.carte} />
        <span className="carriere-fiche-lieu-texte">
          <b>{zone ?? map?.name ?? rdv.carte}</b>
          {zone && map && <small>{map.name}</small>}
          <small className="carriere-fiche-depart">Départ : {depart === null ? '…' : depart === false ? 'indisponible hors ligne' : depart}</small>
        </span>
      </div>
      <dl className="carriere-fiche-enjeu">
        <div>
          <dt>Objectif</dt>
          <dd data-objectif={rdv.objectif}>
            {OBJECTIF_LABEL[rdv.objectif]}
            {seuil !== null && <small> : sous {formatChrono(seuil * 1000)}</small>}
          </dd>
        </div>
        <div>
          <dt>Prime</dt>
          <dd>{dollars(rdv.prime)}</dd>
        </div>
      </dl>
      <p className="carriere-fiche-conseil">
        <b>À préparer</b> {conseilDe(rdv)}
      </p>
    </div>
  );
}
