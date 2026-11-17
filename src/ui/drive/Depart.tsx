// Départ arrêté de la sortie de nuit (src/drive/depart.ts) à l'écran :
// - les feux : trois lampes sous le compte-tours, rouge, rouge, puis toutes au vert ; elles s'effacent
//   une seconde après le départ ;
// - le chrono : minutes, secondes, dixièmes, à la même place sous le compte-tours, une fois les feux
//   effacés (le cadre du nom de la carte ne grandit pas) ; sur une boucle, le tour et le meilleur tour ;
// - l'arrivée (parcours ouvert) : le temps, le meilleur temps gardé pour ce parcours, ce départ et ce
//   véhicule, « Repartir » et « Rentrer au garage ».
// Les lampes et le chrono sont écrits à chaque image par une boucle (aucun rendu React par image).

import { useRef } from 'react';
import { closeSheet } from '../../app/useRoute.ts';
import { chronoDuTour, DEPART, feuxVisibles, formatChrono, type EtatDepart } from '../../drive/depart.ts';
import { liveDepart, useDrive } from '../../state/drive.ts';
import { useBoucleImage } from './CompteTours.tsx';
import { DriveIcon } from './icones.tsx';
import './depart.css';

function putData(element: HTMLElement | null | undefined, key: string, value: string): void {
  if (element && element.dataset[key] !== value) element.dataset[key] = value;
}

const NOMS_FEUX = ['Feux de départ éteints', 'Feux de départ : un rouge', 'Feux de départ : deux rouges'];

/** Trois lampes, posées sous le compte-tours (dans le bandeau du haut, sans le pousser). */
export function FeuxDepart() {
  const phase = useDrive((state) => state.telemetry.depart ?? 'attente');
  const root = useRef<HTMLDivElement>(null);
  const lamps = useRef<(HTMLElement | null)[]>([]);
  const shown = phase === 'feux' || phase === 'parti';

  useBoucleImage(() => {
    const etat: EtatDepart | null = liveDepart.current;
    const el = root.current;
    if (!etat || !el) return;
    putData(el, 'visible', feuxVisibles(etat) ? 'oui' : 'non');
    for (let i = 0; i < 3; i += 1) putData(lamps.current[i], 'feu', etat.vert ? 'vert' : i < etat.rouges ? 'rouge' : 'eteint');
    const label = etat.vert ? 'Feux de départ : vert, c’est parti' : (NOMS_FEUX[Math.min(etat.rouges, DEPART.rouges)] ?? '');
    if (el.getAttribute('aria-label') !== label) el.setAttribute('aria-label', label);
  });

  if (!shown) return null;
  return (
    <div className="drive-feux-place">
      <div ref={root} className="drive-feux" role="img" aria-label="Feux de départ éteints" data-visible="oui">
        {[0, 1, 2].map((i) => (
          <i
            key={i}
            data-feu="eteint"
            ref={(node) => {
              lamps.current[i] = node;
            }}
          />
        ))}
      </div>
    </div>
  );
}

/** Le chrono, sous le compte-tours une fois les feux effacés : discret, mis à jour au dixième. */
export function ChronoSortie() {
  const phase = useDrive((state) => state.telemetry.depart ?? 'attente');
  const root = useRef<HTMLSpanElement>(null);
  const main = useRef<HTMLElement>(null);
  const sub = useRef<HTMLElement>(null);
  const shown = useRef({ main: -1, tours: -1, meilleur: -2 });

  useBoucleImage(() => {
    const etat = liveDepart.current;
    if (!etat || !main.current) return;
    putData(root.current, 'visible', etat.phase !== 'attente' && etat.phase !== 'feux' && !feuxVisibles(etat) ? 'oui' : 'non');
    const tour = Math.floor((etat.boucle ? chronoDuTour(etat) : etat.chrono) / 100);
    const seen = shown.current;
    if (tour !== seen.main) {
      seen.main = tour;
      main.current.textContent = formatChrono(tour * 100);
    }
    if (etat.boucle && sub.current && (etat.tours !== seen.tours || etat.meilleurTour !== seen.meilleur)) {
      seen.tours = etat.tours;
      seen.meilleur = etat.meilleurTour;
      sub.current.textContent = `Tour ${etat.tours + 1}${etat.meilleurTour >= 0 ? ` · meilleur ${formatChrono(etat.meilleurTour)}` : ''}`;
    }
  });

  if (phase === 'attente') return null;
  return (
    <div className="drive-feux-place">
      <span ref={root} className="drive-chrono" aria-label="Chrono" data-visible="non">
        <b ref={main}>0:00.0</b>
        <small ref={sub} />
      </span>
    </div>
  );
}

/** Panneau « Arrivée » : le bout d'un parcours ouvert est passé. */
export function ArriveePanneau() {
  const phase = useDrive((state) => state.telemetry.depart);
  const arrivee = useDrive((state) => state.arrivee);
  // « Repartir » : de nouveau sur la ligne, les feux, à la main.
  const commencer = useDrive((state) => state.commencer);
  if (phase !== 'arrive' || !arrivee) return null;
  const { temps, meilleur, precedent } = arrivee;
  const record = precedent > 0 && temps < precedent;
  const ligne =
    precedent < 0
      ? 'Premier temps posé ici avec ce véhicule.'
      : record
        ? `Nouveau meilleur temps ! L’ancien : ${formatChrono(precedent)}.`
        : `Ton meilleur ici : ${formatChrono(meilleur)}.`;
  return (
    <div className="drive-veil drive-arrivee-voile">
      <section className="drive-arrivee" aria-labelledby="drive-arrivee-titre" data-record={record || undefined}>
        <h2 id="drive-arrivee-titre">Arrivée</h2>
        <p className="drive-arrivee-temps" role="status">
          {formatChrono(temps)}
        </p>
        <p className="drive-arrivee-meilleur">{ligne}</p>
        <div className="drive-arrivee-actes">
          <button type="button" className="btn" onClick={commencer}>
            Repartir
          </button>
          <button type="button" className="btn drive-home" onClick={closeSheet}>
            <DriveIcon name="garage" />
            Rentrer au garage
          </button>
        </div>
      </section>
    </div>
  );
}
