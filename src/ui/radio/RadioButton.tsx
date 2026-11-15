// Bouton rond « Radio » de la colonne du haut de l'écran et, quand une station est chargée, une ligne
// fine à sa gauche : titre (ou « Touche pour lancer la musique »), lecture ou pause, suivant. Monté en
// permanence hors mode photo : c'est aussi lui qui démarre la radio et lit le lien de pack.

import { useEffect } from 'react';
import { openSheet } from '../../app/useRoute.ts';
import { next, togglePlay } from '../../audio/radio/player.ts';
import { useRadio } from '../../state/radio.ts';
import { Icon } from '../icons.tsx';
import { bootRadio } from './boot.ts';
import { IconNext, IconPause, IconPlay, percent } from './bits.tsx';
import './radio.css';

export function RadioButton() {
  useEffect(() => bootRadio(), []);
  const now = useRadio((state) => state.now);
  const waitingTap = useRadio((state) => state.waitingTap);
  const job = useRadio((state) => state.job);
  const running = job?.phase === 'telechargement' || job?.phase === 'copie' || job?.phase === 'lecture';
  const progress = running && job.phase !== 'lecture' ? percent(job.done, job.total) : null;
  const playing = now?.playing === true;

  let label = 'Radio';
  if (running) label = `Radio, import en cours${progress ? ` (${progress})` : ''}`;
  else if (playing) label = 'Radio, en lecture';

  return (
    <div className="radio-quick">
      {now && (
        <div className="radio-mini" role="group" aria-label="Radio en cours">
          <span className="radio-mini-title">
            <span className="radio-mini-song">{now.title}</span>
            {waitingTap ? (
              <span className="radio-mini-artist radio-tap">Touche pour lancer la musique</span>
            ) : (
              now.artist && <span className="radio-mini-artist">{now.artist}</span>
            )}
          </span>
          <button
            type="button"
            className="btn radio-icon"
            aria-label={now.playing ? 'Pause' : 'Lecture'}
            onClick={() => void togglePlay()}
          >
            {now.playing ? <IconPause /> : <IconPlay />}
          </button>
          <button type="button" className="btn radio-icon" aria-label="Morceau suivant" onClick={() => void next()}>
            <IconNext />
          </button>
        </div>
      )}
      <button
        type="button"
        className="quick-btn"
        data-on={playing || undefined}
        aria-label={label}
        title="Radio"
        onClick={() => openSheet({ name: 'radio' })}
      >
        <Icon name="radio" playing={playing} />
        {running && <span className="quick-badge">{progress ?? '…'}</span>}
      </button>
    </div>
  );
}
