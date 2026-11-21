// Dernière étape de l'écran « Jouer » : le rappel des choix (mode, lieu › circuit › départ) et « Changer »,
// puis, selon le mode, ce qui sert à ce mode et rien de plus : le format (la course : 1 ou 3 tours ; 3 tours
// dit sur la case pourquoi il est grisé sur une route ouverte), l'adversaire et la difficulté (le duel), le
// départ (quand la route en a plusieurs), « Nuit · Pluie » (le moment et la météo, repliés, un appui les
// ouvre) et les crédits des données de la carte (obligation de licence, repliés). « Jouer » n'est jamais dans
// ce qui défile : il est sous le corps de l'étape, entier, sur toute la largeur du menu, sous le pouce, et
// redit le mode.

import { useState } from 'react';
import { openSheet } from '../../../app/useRoute.ts';
import { AIDES_FORMAT, FORMATS, formatCouru, formatPossible, formatSpec } from '../../../data/courses.ts';
import { creditLine, mapById } from '../../../data/maps.ts';
import { MODES_JEU, modeDe } from '../../../data/modes.ts';
import { MOMENTS } from '../../../data/moments.ts';
import { useDock } from '../../../state/dock.ts';
import { useDrive, WEATHERS } from '../../../state/drive.ts';
import { kilometres } from '../../jeu/libelles.ts';
import { useRevealPressed } from '../../scroll.ts';
import { DriveIcon } from '../icones.tsx';
import { LIBELLE_DEBUT, niveauLieu, rappel } from './etapes.ts';
import { useDeparts } from './useDeparts.ts';
import { useDuel } from '../../../drive/adversaire/choix.ts';
import { ChoixAdversaire, reditDuel, useDuelChoisi } from '../Duel.tsx';

/** Phrase de la case « 3 tours » grisée : la raison est sur la case, pas en petit plus bas. */
const RAISON_SANS_BOUCLE = 'Sur un circuit fermé seulement';

export function EtapeReglages() {
  const map = mapById(useDrive((state) => state.choice.map));
  const chosen = useDrive((state) => state.choice.start);
  const chooseMap = useDrive((state) => state.chooseMap);
  const chooseStart = useDrive((state) => state.chooseStart);
  const weather = useDrive((state) => state.weather);
  const setWeather = useDrive((state) => state.setWeather);
  const format = useDrive((state) => state.format);
  const setFormat = useDrive((state) => state.setFormat);
  const moment = useDrive((state) => state.moment);
  const setMoment = useDrive((state) => state.setMoment);
  const setLevels = useDock((state) => state.setLevels);
  const starts = useDeparts(map);
  const start = starts?.list.find((item) => item.id === chosen) ?? starts?.list[0];
  const boucle = starts?.loop === true;
  const couru = formatCouru(format, boucle);
  const formatRow = useRevealPressed<HTMLDivElement>(couru);
  const departRow = useRevealPressed<HTMLDivElement>(start?.id ?? '');
  const [cielOuvert, setCielOuvert] = useState(false);
  const duel = useDuelChoisi();
  useDuel((state) => state.adversaire);
  useDuel((state) => state.niveau);
  const mode = modeDe(couru, duel);
  const nomMode = MODES_JEU.find((item) => item.id === mode)?.label ?? '';
  const libelle = starts?.status === 'erreur' ? LIBELLE_DEBUT : start?.label;

  if (!map) return <p className="drive-note">Choisis d’abord un circuit : reviens d’une étape.</p>;

  const go = () => {
    chooseMap(map.id);
    chooseStart(start?.id ?? null);
    openSheet({ name: 'sortie' });
  };
  // « Jouer » redit le mode et ce qu'il rapporte : « Course 1 tour : chrono, dollars et hauts faits ».
  const aide = AIDES_FORMAT[couru];
  const redit = (duel ? reditDuel() : null) ?? `${formatSpec(couru).label} : ${aide.charAt(0).toLowerCase()}${aide.slice(1)}`;
  const departs = starts?.status === 'pret' && starts.list.length > 1 ? starts.list : [];
  const meteo = WEATHERS.find((item) => item.id === weather)?.label ?? '';
  const momentLabel = MOMENTS.find((item) => item.id === moment)?.label ?? '';

  return (
    <>
      <div className="entree-corps">
        <div className="entree-rappel entree-rappel-reglages">
          <p>
            <b>{nomMode}</b> · {rappel(map, starts?.status === 'chargement' ? null : (libelle ?? null))}
          </p>
          <button type="button" className="btn entree-changer" aria-label="Changer de circuit" onClick={() => setLevels([niveauLieu(nomMode)])}>
            Changer
          </button>
        </div>
        {mode === 'course' && (
          <div ref={formatRow} className="chips drive-formats" role="group" aria-label="Format" data-boucle={boucle ? 'oui' : 'non'}>
            {FORMATS.filter((item) => item.tours !== null && item.id !== 'drift').map((item) => {
              const possible = formatPossible(item.id, boucle);
              return (
                <button key={item.id} type="button" className="chip" data-format={item.id} aria-pressed={item.id === couru} disabled={!possible} onClick={() => setFormat(item.id)}>
                  <b>{item.label}</b>
                  <small>{possible || starts?.status === 'chargement' ? AIDES_FORMAT[item.id] : RAISON_SANS_BOUCLE}</small>
                </button>
              );
            })}
          </div>
        )}
        <ChoixAdversaire />
        {departs.length > 0 && (
          <div ref={departRow} className="chips entree-liste entree-departs" role="group" aria-label="Départ">
            {departs.map((item) => (
              <button key={item.id} type="button" className="chip" data-depart={item.id} aria-pressed={item.id === start?.id} onClick={() => chooseStart(item.id)}>
                <b>{item.label}</b>
                {/* Longueur de course, pas la borne du départ : « km 0,0 » se lisait « 0 km ». */}
                <small>{starts?.loop ? `${kilometres(starts.length)} le tour` : `${kilometres((starts?.length ?? 0) - item.at)} jusqu’à l’arrivée`}</small>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="chip entree-ciel-resume" aria-expanded={cielOuvert} aria-controls="entree-ciel" onClick={() => setCielOuvert(!cielOuvert)}>
          <b>
            {momentLabel} · {meteo}
          </b>
          <small>{cielOuvert ? 'Replier' : 'Moment et météo'}</small>
        </button>
        <div id="entree-ciel" className="entree-ciel" hidden={!cielOuvert}>
          <div className="drive-weather" role="group" aria-label="Moment">
            {MOMENTS.map((item) => (
              <button key={item.id} type="button" className="btn drive-weather-btn" aria-pressed={moment === item.id} onClick={() => setMoment(item.id)}>
                <span>{item.label}</span>
              </button>
            ))}
          </div>
          <div className="drive-weather" role="group" aria-label="Météo">
            {WEATHERS.map((item) => (
              <button key={item.id} type="button" className="btn drive-weather-btn" aria-pressed={weather === item.id} aria-label={item.label} onClick={() => setWeather(item.id)}>
                <DriveIcon name={item.id === 'sec' && moment === 'jour' ? 'soleil' : item.id} />
                <span>{item.label}</span>
              </button>
            ))}
          </div>
        </div>
        <details className="drive-credits" data-credits={map.id}>
          <summary>Données de la carte</summary>
          <p>{map.credits.map(creditLine).join(' ; ')}.</p>
        </details>
      </div>
      <button type="button" className="btn cta drive-go" aria-label="Jouer" aria-describedby="sortie-go-format" data-format={duel ? 'duel' : couru} onClick={go}>
        <span>Jouer</span>
        <small id="sortie-go-format" className="drive-go-format">
          {redit}
        </small>
      </button>
    </>
  );
}
