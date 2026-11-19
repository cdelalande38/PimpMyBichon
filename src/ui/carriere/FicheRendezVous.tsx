// Fiche d'un rendez-vous de carrière : tout ce qu'il faut savoir pour préparer le véhicule AVANT de partir
// (demande du 18 novembre 2026 : « on lui annonce le prochain […] zone, circuit et météo »). Son numéro et
// son nom ; la météo, le moment et le format imposés (en premier : en paysage, la place est comptée) ; la
// zone et la carte, avec la miniature du tracé, et le départ ; l'objectif (le temps du bronze pour le
// véhicule à l'écran) et la prime ; une ligne de conseil de préparation tirée des données
// (src/data/carriere.ts). Rien ne s'y touche.
// Vague V : la saison (à partir de la deuxième), l'objectif d'argent ou d'or avec son temps, les
// contraintes en puces cerclées d'ambre juste sous les conditions, et un avertissement quand le véhicule à
// l'écran n'est pas de la famille imposée.

import { useMemo } from 'react';
import { conseilDe, CONSEILS, CONTRAINTE_LABEL, METEO_LABEL, MOMENT_LABEL, OBJECTIF_LABEL, placeDe, type RendezVous } from '../../data/carriere.ts';
import { formatSpec } from '../../data/courses.ts';
import { mapById } from '../../data/maps.ts';
import { resolveVehicle, vehicleById } from '../../data/vehicles.ts';
import { formatChrono } from '../../drive/depart.ts';
import { possedeDans } from '../../jeu/achats.ts';
import { seuilObjectif } from '../../jeu/carriereCloture.ts';
import { conseilPreparation } from '../../jeu/preparation.ts';
import { useBuilds } from '../../state/builds.ts';
import { useJeu } from '../../state/jeu.ts';
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

/**
 * La ligne « À préparer » : ce que la conduite dit du véhicule à l'écran sous la météo imposée (pneus,
 * assiette, puissance : src/jeu/preparation.ts), puis la nuit et les trois tours. Sans phrase : le conseil
 * général de la météo (src/data/carriere.ts).
 */
function useConseil(rdv: RendezVous): string {
  const current = useBuilds((state) => state.current);
  const builds = useBuilds((state) => state.builds);
  const articles = useJeu((state) => state.articles);
  return useMemo(() => {
    const vehicule = resolveVehicle(current);
    const phrases = conseilPreparation(builds[vehicule.id], vehicule, rdv.meteo, { possede: (id) => possedeDans({ articles }, id) });
    if (phrases.length === 0) return conseilDe(rdv);
    if (rdv.moment === 'nuit') phrases.push(CONSEILS.nuit);
    if (rdv.format === 'tours3') phrases.push(CONSEILS.tours3);
    return phrases.join(' ');
  }, [current, builds, articles, rdv]);
}

/** « Rendez-vous 3 sur 12 », la saison devant à partir de la deuxième. */
export function numeroRendezVous(id: string, numero: number, total: number): string {
  const saison = (placeDe(id)?.indexSaison ?? 0) + 1;
  return saison > 1 ? `Saison ${saison} · rendez-vous ${numero} sur ${total}` : `Rendez-vous ${numero} sur ${total}`;
}

/** La phrase d'avertissement quand le véhicule à l'écran n'est pas de la famille imposée ; `null` sinon. */
export function avertissementFamille(rdv: Pick<RendezVous, 'contraintes'>, vehicule: string): string | null {
  const kind = vehicleById(vehicule)?.kind;
  if (rdv.contraintes.includes('moto') && kind !== 'bike') return 'Il faut une moto : choisis-en une au garage avant de partir.';
  if (rdv.contraintes.includes('voiture') && kind !== 'car') return 'Il faut une voiture : choisis-en une au garage avant de partir.';
  return null;
}

export function FicheRendezVous({ rdv, numero, total }: { rdv: RendezVous; numero: number; total: number }) {
  const conseil = useConseil(rdv);
  const map = mapById(rdv.carte);
  const zone = zoneDe(map);
  const depart = useLibelleDepart(rdv.carte, rdv.depart);
  const vehicule = useVehiculeCourant();
  const seuil = seuilObjectif(rdv.objectif, { ...rdv, vehicule });
  const famille = avertissementFamille(rdv, vehicule);
  return (
    <div className="carriere-fiche" data-rendez-vous={rdv.id}>
      <p className="carriere-fiche-numero">{numeroRendezVous(rdv.id, numero, total)}</p>
      <h3 className="carriere-fiche-titre">{rdv.titre}</h3>
      <ul className="carriere-fiche-conditions" aria-label="Imposé par le rendez-vous">
        <li data-meteo={rdv.meteo}>
          <DriveIcon name={iconeMeteo(rdv)} />
          {METEO_LABEL[rdv.meteo]}
        </li>
        <li data-moment={rdv.moment}>{MOMENT_LABEL[rdv.moment]}</li>
        <li data-format={rdv.format}>{formatSpec(rdv.format).label}</li>
        {rdv.contraintes.map((c) => (
          <li key={c} data-contrainte={c}>
            {CONTRAINTE_LABEL[c].court}
          </li>
        ))}
      </ul>
      {famille && (
        <p className="carriere-fiche-alerte" role="note">
          {famille}
        </p>
      )}
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
        <b>À préparer</b> {conseil}
      </p>
    </div>
  );
}
