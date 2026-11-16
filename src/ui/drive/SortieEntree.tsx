// Entrée « Sortie de nuit » du menu (section Garage) : la carte (liste lue dans le catalogue), le
// départ parmi ceux de la carte, les crédits des données (obligation de licence ; redits à l'écran
// de chargement de la sortie), la météo et « Sortir », collé en bas sous le pouce.
// Rien n'est choisi à l'ouverture : on ne voit que les cartes. Les départs, les crédits, la météo
// et « Sortir » n'apparaissent qu'une fois la carte touchée (retour du 16 novembre 2026 : pas de
// troisième niveau tant que la région n'est pas choisie).
// Chaque carte montre la miniature de son tracé (src/ui/pictos/carte.ts, fabriquée avec la carte).
// Les départs vivent dans la route de la carte (route.json) : elle se charge ici une fois, et sert
// encore à la scène. Sans réseau à la première fois, on part du premier départ.

import { useEffect, useState } from 'react';
import { openSheet } from '../../app/useRoute.ts';
import { creditLine, loadRoute, MAPS, resolveMap } from '../../data/maps.ts';
import type { MapManifest, MapStart } from '../../data/mapTypes.ts';
import { useDrive, WEATHERS } from '../../state/drive.ts';
import { PictoCarte } from '../pictos/Pictos.tsx';
import { useRevealPressed } from '../scroll.ts';
import { DriveIcon } from './icones.tsx';
import './drive.css';

type Starts = { map: string; status: 'chargement' | 'pret' | 'erreur'; list: readonly MapStart[] };

function useStarts(map: MapManifest | undefined): Starts | null {
  const [starts, setStarts] = useState<Starts | null>(null);
  useEffect(() => {
    if (!map) return;
    let alive = true;
    loadRoute(map).then(
      (route) => alive && setStarts({ map: map.id, status: 'pret', list: route.starts }),
      () => alive && setStarts({ map: map.id, status: 'erreur', list: [] }),
    );
    return () => {
      alive = false;
    };
  }, [map]);
  if (!map) return null;
  return starts?.map === map.id ? starts : { map: map.id, status: 'chargement', list: [] };
}

export function SortieEntree() {
  const choice = useDrive((state) => state.choice);
  const weather = useDrive((state) => state.weather);
  const chooseMap = useDrive((state) => state.chooseMap);
  const chooseStart = useDrive((state) => state.chooseStart);
  const setWeather = useDrive((state) => state.setWeather);
  // La carte touchée dans ce panneau ; `null` tant qu'on n'a rien touché (le choix gardé ne compte pas ici).
  const [picked, setPicked] = useState<string | null>(null);
  const map = picked ? resolveMap(picked) : undefined;
  const starts = useStarts(map);
  const start = starts?.list.find((item) => item.id === choice.start) ?? starts?.list[0];
  const mapRow = useRevealPressed<HTMLDivElement>(map?.id ?? '');
  const startRow = useRevealPressed<HTMLDivElement>(start?.id ?? '');

  if (MAPS.length === 0) {
    return <p className="drive-empty">Aucune carte de sortie dans cette version. Elles arrivent avec la prochaine.</p>;
  }

  const pick = (id: string) => {
    chooseMap(id);
    setPicked(id);
  };

  const mapChips = (
    <div ref={mapRow} className="chips" role="group" aria-label="Carte">
      {MAPS.map((item) => (
        <button key={item.id} type="button" className="chip chip-picto" aria-pressed={item.id === map?.id} onClick={() => pick(item.id)}>
          <PictoCarte id={item.id} />
          <span className="chip-text">
            <b>{item.name}</b>
            {item.hint && <small>{item.hint}</small>}
          </span>
        </button>
      ))}
    </div>
  );

  if (!map) {
    return (
      <div className="drive-entry" data-etape="carte">
        {mapChips}
        <p className="drive-note drive-pick">Touche une carte : ses départs s’affichent ensuite.</p>
      </div>
    );
  }

  const go = () => {
    chooseMap(map.id);
    chooseStart(start?.id ?? null);
    openSheet({ name: 'sortie' });
  };

  return (
    <div className="drive-entry" data-etape="depart">
      {mapChips}
      <div ref={startRow} className="chips" role="group" aria-label="Départ">
        {starts?.status === 'chargement' && <span className="drive-note">Départs en route…</span>}
        {starts?.status === 'erreur' && <span className="drive-note">Départs indisponibles hors ligne : tu pars du début.</span>}
        {starts?.list.map((item) => (
          <button key={item.id} type="button" className="chip" aria-pressed={item.id === start?.id} onClick={() => chooseStart(item.id)}>
            <b>{item.label}</b>
            <small>km {(item.at / 1000).toFixed(1).replace('.', ',')}</small>
          </button>
        ))}
      </div>
      <p className="drive-credits" data-credits={map.id}>
        Données de la carte : {map.credits.map(creditLine).join(' ; ')}.
      </p>
      <div className="drive-go-row">
        <div className="drive-weather" role="group" aria-label="Météo">
          {WEATHERS.map((item) => (
            <button key={item.id} type="button" className="btn drive-weather-btn" aria-pressed={weather === item.id} aria-label={item.label} onClick={() => setWeather(item.id)}>
              <DriveIcon name={item.id} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>
        <button type="button" className="btn cta drive-go" onClick={go}>
          Sortir
        </button>
      </div>
    </div>
  );
}
