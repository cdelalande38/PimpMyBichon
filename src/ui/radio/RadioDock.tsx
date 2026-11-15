// Bouton « Radio » du dock et, quand une station joue, une ligne compacte : titre, lecture ou
// pause, suivant. Monté en permanence : c'est aussi lui qui démarre la radio et lit le lien de pack.

import { useEffect } from 'react';
import { openSheet } from '../../app/useRoute.ts';
import { next, togglePlay } from '../../audio/radio/player.ts';
import { useRadio } from '../../state/radio.ts';
import { bootRadio } from './boot.ts';
import { IconNext, IconPause, IconPlay, percent } from './bits.tsx';
import './radio.css';

export function RadioDock() {
  useEffect(() => bootRadio(), []);
  const now = useRadio((state) => state.now);
  const job = useRadio((state) => state.job);
  const running = job?.phase === 'telechargement' || job?.phase === 'copie' || job?.phase === 'lecture';
  const progress = running && job.phase !== 'lecture' ? percent(job.done, job.total) : null;

  return (
    <div className="radio-dock">
      <button
        type="button"
        className="btn radio-dock-open"
        onClick={() => openSheet({ name: 'radio' })}
        aria-label={running ? `Radio, import en cours${progress ? ` (${progress})` : ''}` : 'Radio'}
      >
        Radio{running ? <span className="radio-dock-badge">{progress ?? '…'}</span> : null}
      </button>
      {now && (
        <div className="radio-mini" role="group" aria-label="Radio en cours">
          <span className="radio-mini-title">
            <span className="radio-mini-song">{now.title}</span>
            {now.artist && <span className="radio-mini-artist">{now.artist}</span>}
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
    </div>
  );
}
