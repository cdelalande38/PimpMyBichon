// Bouton rond « Radio » de la colonne du haut de l'écran. Radio vide : il ouvre le panneau Radio.
// Radio garnie : il déploie ou replie le mini-lecteur à sa gauche (titre qui ouvre le panneau, fine
// barre de progression, lecture ou pause, suivant) ; le choix est retenu d'une ouverture à l'autre,
// replié par défaut. « Touche pour lancer la musique » reste visible, même replié, tant que le
// navigateur attend un geste. Monté en permanence hors mode photo : c'est aussi lui qui démarre la
// radio et lit le lien de pack. Panneau Radio ouvert, un appui à l'emplacement du bouton tombe sur
// le fond du panneau (dialogue modal) et le referme.

import { useEffect, type CSSProperties } from 'react';
import { openSheet } from '../../app/useRoute.ts';
import { next, resume, togglePlay } from '../../audio/radio/player.ts';
import { setPrefs, useRadio } from '../../state/radio.ts';
import { Icon } from '../icons.tsx';
import { bootRadio } from './boot.ts';
import { IconNext, IconPause, IconPlay, percent } from './bits.tsx';
import './radio.css';

function MiniPlayer() {
  const now = useRadio((state) => state.now);
  const waitingTap = useRadio((state) => state.waitingTap);
  const progress = useRadio((state) => state.progress);
  const stations = useRadio((state) => state.catalog.stations);
  const lastStationId = useRadio((state) => state.lastStationId);
  const last = stations.find((station) => station.id === lastStationId) ?? stations[0];
  const fill = now && progress.duration ? Math.min(100, (progress.time / progress.duration) * 100) : 0;

  return (
    <div id="radio-mini" className="radio-mini" role="group" aria-label="Radio en cours">
      <button
        type="button"
        className="radio-mini-title"
        aria-label={`${now ? now.title : (last?.name ?? 'Radio')} : ouvrir le panneau Radio`}
        onClick={() => openSheet({ name: 'radio' })}
      >
        <span className="radio-mini-song">{now ? now.title : (last?.name ?? 'Radio')}</span>
        {waitingTap ? (
          <span className="radio-mini-artist radio-tap">Touche pour lancer la musique</span>
        ) : (
          <span className="radio-mini-artist">{now ? (now.artist ?? last?.name ?? '') : 'En pause'}</span>
        )}
        <span className="radio-mini-progress" aria-hidden="true" style={{ '--radio-fill': `${fill}%` } as CSSProperties} />
      </button>
      <button
        type="button"
        className="btn radio-icon"
        aria-label={now?.playing ? 'Pause' : 'Lecture'}
        onClick={() => void (now ? togglePlay() : resume())}
      >
        {now?.playing ? <IconPause /> : <IconPlay />}
      </button>
      <button type="button" className="btn radio-icon" aria-label="Morceau suivant" disabled={!now} onClick={() => void next()}>
        <IconNext />
      </button>
    </div>
  );
}

export function RadioButton() {
  useEffect(() => bootRadio(), []);
  const now = useRadio((state) => state.now);
  const waitingTap = useRadio((state) => state.waitingTap);
  const job = useRadio((state) => state.job);
  const miniOpen = useRadio((state) => state.miniOpen);
  const hasStations = useRadio((state) => state.catalog.stations.length > 0);
  const running = job?.phase === 'telechargement' || job?.phase === 'copie' || job?.phase === 'lecture';
  const progress = running && job.phase !== 'lecture' ? percent(job.done, job.total) : null;
  const playing = now?.playing === true;
  const expanded = hasStations && miniOpen;

  let label = 'Radio';
  if (running) label = `Radio, import en cours${progress ? ` (${progress})` : ''}`;
  else if (playing) label = 'Radio, en lecture';

  const onClick = () => {
    // Radio vide : rien à déployer, on ouvre le panneau pour faire entrer de la musique.
    if (!hasStations) openSheet({ name: 'radio' });
    else setPrefs({ miniOpen: !miniOpen });
  };

  return (
    <div className="radio-quick">
      {expanded && <MiniPlayer />}
      {!expanded && waitingTap && (
        // Une information, pas un menu : le premier appui n'importe où lance la musique.
        <p className="radio-tap-pill" role="status">
          Touche pour lancer la musique
        </p>
      )}
      <button
        type="button"
        className="quick-btn"
        data-on={playing || undefined}
        aria-label={label}
        aria-expanded={hasStations ? expanded : undefined}
        aria-controls={expanded ? 'radio-mini' : undefined}
        title={hasStations ? (expanded ? 'Radio : replier le lecteur' : 'Radio : afficher le lecteur') : 'Radio'}
        onClick={onClick}
      >
        <Icon name="radio" playing={playing} />
        {running && <span className="quick-badge">{progress ?? '…'}</span>}
      </button>
    </div>
  );
}
