// Dernière étape du menu de la sortie : le rappel des choix (lieu › circuit › départ) et « Changer de
// circuit », le moment (nuit, jour), la météo (au choix en mode libre), le format (chacun dit ce qu'il
// rapporte ; 3 tours grisés avec leur phrase sur une route ouverte), les crédits des données de la
// carte (obligation de licence), puis « Sortir ». « Sortir » n'est jamais dans ce qui défile : il est
// sous le corps de l'étape, entier, sur toute la largeur du menu, sous le pouce, et redit le format.

import { useEffect } from 'react';
import { openSheet } from '../../../app/useRoute.ts';
import { AIDES_FORMAT, FORMATS, formatCouru, formatPossible, formatSpec, PHRASE_SANS_BOUCLE } from '../../../data/courses.ts';
import { creditLine, mapById } from '../../../data/maps.ts';
import { MOMENTS } from '../../../data/moments.ts';
import { useDock } from '../../../state/dock.ts';
import { useDrive, WEATHERS } from '../../../state/drive.ts';
import { useRevealPressed } from '../../scroll.ts';
import { DriveIcon } from '../icones.tsx';
import { apresDepart, LIBELLE_DEBUT, LIBELLE_LIBRE, niveauLieu, rappel, sansEtapeDepart } from './etapes.ts';
import { useDeparts } from './useDeparts.ts';
import { useDuel } from '../../../drive/adversaire/choix.ts';
import { ChoixAdversaire, PuceDuel, reditDuel, useDuelChoisi } from '../Duel.tsx';

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
  const replace = useDock((state) => state.replace);
  const starts = useDeparts(map);
  const start = starts?.list.find((item) => item.id === chosen) ?? starts?.list[0];
  const boucle = starts?.loop === true;
  const couru = formatCouru(format, boucle);
  const formatRow = useRevealPressed<HTMLDivElement>(couru);
  const ready = starts?.status === 'pret' ? starts.list : null;
  const libelle = starts?.status === 'erreur' ? LIBELLE_DEBUT : start?.label;
  // Duel (src/ui/drive/Duel.tsx) : une puce de plus dans la rangée des formats, puis le choix de l'adversaire.
  const duel = useDuelChoisi();
  useDuel((state) => state.adversaire);
  useDuel((state) => state.niveau);

  // Menu rouvert sur la dernière sortie : le fil finit sur le nom du départ dès que la route l'a dit, et
  // une carte à un seul départ n'a pas d'étape des départs où « Retour » s'arrêterait.
  useEffect(() => {
    if (!libelle) return;
    const levels = useDock.getState().levels;
    const top = levels.at(-1);
    if (top?.kind === 'sortie' && top.etape === 'reglages' && top.libelle !== libelle) replace(apresDepart(libelle));
  }, [libelle, replace]);
  useEffect(() => {
    if (!ready) return;
    const next = sansEtapeDepart(useDock.getState().levels, ready);
    if (next) setLevels(next);
  }, [ready, setLevels]);

  if (!map) return <p className="drive-note">Choisis d’abord un circuit : reviens d’une étape.</p>;

  const go = () => {
    chooseMap(map.id);
    chooseStart(start?.id ?? null);
    openSheet({ name: 'sortie' });
  };
  // « Sortir » redit le format et ce qu'il rapporte : « Course 1 tour : chrono, dollars et hauts faits ».
  const aide = AIDES_FORMAT[couru];
  const redit = (duel ? reditDuel() : null) ?? `${formatSpec(couru).label} : ${aide.charAt(0).toLowerCase()}${aide.slice(1)}`;

  return (
    <>
      <div className="entree-corps">
        <div className="entree-rappel entree-rappel-reglages">
          <p>
            <b>{LIBELLE_LIBRE}</b> · {rappel(map, starts?.status === 'chargement' ? null : (libelle ?? null))}
          </p>
          <button type="button" className="btn entree-changer" aria-label="Changer de circuit" onClick={() => setLevels([niveauLieu()])}>
            Changer
          </button>
        </div>
        <div className="entree-ciel">
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
        <div ref={formatRow} className="chips drive-formats" role="group" aria-label="Format" data-boucle={boucle ? 'oui' : 'non'}>
          {FORMATS.map((item) => {
            const possible = formatPossible(item.id, boucle);
            return (
              <button
                key={item.id}
                type="button"
                className="chip"
                data-format={item.id}
                aria-pressed={item.id === couru && !duel}
                disabled={!possible}
                aria-describedby={possible ? undefined : 'sortie-format-phrase'}
                onClick={() => {
                  setFormat(item.id);
                  useDuel.getState().setActif(false);
                }}
              >
                <b>{item.label}</b>
                <small>{AIDES_FORMAT[item.id]}</small>
              </button>
            );
          })}
          <PuceDuel />
        </div>
        <ChoixAdversaire />
        {!boucle && starts?.status !== 'chargement' && FORMATS.some((item) => !formatPossible(item.id, false)) && (
          <p id="sortie-format-phrase" className="drive-note drive-format-phrase">
            {PHRASE_SANS_BOUCLE}
          </p>
        )}
        <p className="drive-credits" data-credits={map.id}>
          Données de la carte : {map.credits.map(creditLine).join(' ; ')}.
        </p>
      </div>
      <button type="button" className="btn cta drive-go" aria-label="Sortir" aria-describedby="sortie-go-format" data-format={duel ? 'duel' : couru} onClick={go}>
        <span>Sortir</span>
        <small id="sortie-go-format" className="drive-go-format">
          {redit}
        </small>
      </button>
    </>
  );
}
