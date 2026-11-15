// Corps du panneau Radio : offre reçue par lien, import en cours, lecteur, stations et morceaux,
// ajout d'un pack (fichier ou adresse) ou de morceaux, place occupée sur le téléphone.

import { useEffect, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent } from 'react';
import type { Station } from '../../audio/radio/catalog.ts';
import { cancelDownload, deletePack, deleteStation, dismissJob, downloadPack, importFiles } from '../../audio/radio/library.ts';
import { next, playStation, previous, seekTo, setShuffle, setVolume, togglePlay } from '../../audio/radio/player.ts';
import { spokenTime } from '../../audio/radio/position.ts';
import { useRadio, type Job } from '../../state/radio.ts';
import {
  formatBytes,
  formatDuration,
  IconNext,
  IconPause,
  IconPlay,
  IconPrevious,
  IconShuffle,
  percent,
  plural,
} from './bits.tsx';
import './radio.css';
import './seek.css';

function OfferCard() {
  const offer = useRadio((state) => state.offer);
  const job = useRadio((state) => state.job);
  if (!offer) return null;
  const close = () => useRadio.setState({ offer: null });
  const start = () => {
    useRadio.setState({ offer: null });
    void downloadPack(offer.url);
  };
  const running = job?.phase === 'telechargement' || job?.phase === 'copie' || job?.phase === 'lecture';
  return (
    <section className="radio-card radio-offer" aria-labelledby="radio-offer-title">
      <h3 id="radio-offer-title">Un pack de musique t’attend</h3>
      <p>
        Hébergé chez <strong>{offer.host}</strong>. Ton téléphone demande d’économiser les données : le
        téléchargement attend ton feu vert.
      </p>
      <p className="radio-note">Un pack pèse souvent plusieurs centaines de Mo : passe en Wi-Fi si tu peux, et garde l’atelier ouvert pendant le téléchargement.</p>
      <div className="radio-row">
        <button type="button" className="btn cta" onClick={start} disabled={running}>
          Télécharger
        </button>
        <button type="button" className="btn" onClick={close}>
          Pas maintenant
        </button>
      </div>
    </section>
  );
}

const PHASE_TEXT: Record<Job['phase'], string> = {
  telechargement: 'Téléchargement',
  copie: 'Copie sur le téléphone',
  lecture: 'Rangement des morceaux',
  coupure: 'Téléchargement en pause',
  erreur: 'Ça n’a pas marché',
  fini: 'C’est rangé',
};

function JobCard() {
  const job = useRadio((state) => state.job);
  if (!job) return null;
  const running = job.phase === 'telechargement' || job.phase === 'copie' || job.phase === 'lecture';
  const unit = job.phase === 'lecture';
  return (
    <section className={`radio-card radio-job radio-job-${job.phase}`} aria-live="polite" data-phase={job.phase}>
      <h3>
        {PHASE_TEXT[job.phase]}
        {job.label ? <span className="radio-job-label"> · {job.label}</span> : null}
      </h3>
      {running && (
        <>
          <progress max={job.total ?? undefined} value={job.total ? job.done : undefined} aria-label={PHASE_TEXT[job.phase]} />
          <p className="radio-job-count">
            {unit
              ? `${job.done} morceau${job.done > 1 ? 'x' : ''} sur ${job.total ?? '?'}`
              : `${formatBytes(job.done)} sur ${formatBytes(job.total)}${job.total ? ` · ${percent(job.done, job.total)}` : ''}`}
          </p>
          {job.kind === 'adresse' && job.phase === 'telechargement' && (
            <p className="radio-note">Tu peux fermer le panneau, mais garde l’atelier ouvert jusqu’au bout.</p>
          )}
          {job.phase === 'telechargement' && (
            <div className="radio-row">
              <button type="button" className="btn" onClick={cancelDownload}>
                Annuler
              </button>
            </div>
          )}
        </>
      )}
      {job.fail && (
        <div className="radio-fail" role="alert">
          <p className="radio-fail-title">{job.fail.title}</p>
          <p>{job.fail.hint}</p>
        </div>
      )}
      {job.phase === 'fini' && job.message && <p>{job.message}</p>}
      {!running && (
        <div className="radio-row">
          {job.phase === 'coupure' && job.url && job.fail?.code === 'coupure' && (
            <button type="button" className="btn cta" onClick={() => void downloadPack(job.url!, 'reprise')}>
              Reprendre
            </button>
          )}
          {(job.phase === 'coupure' || job.phase === 'erreur') && job.url && job.fail?.code !== 'adresse' && (
            <button type="button" className={job.phase === 'erreur' || job.fail?.code === 'reprise' ? 'btn cta' : 'btn'} onClick={() => void downloadPack(job.url!)}>
              {job.phase === 'coupure' ? 'Recommencer' : 'Réessayer'}
            </button>
          )}
          <button type="button" className="btn" onClick={dismissJob}>
            {job.phase === 'fini' ? 'OK' : job.phase === 'coupure' ? 'Laisser tomber' : 'Fermer'}
          </button>
        </div>
      )}
    </section>
  );
}

/** Pas des flèches du clavier sur la barre de progression, en secondes. */
const SEEK_KEY_STEP_S = 5;

/**
 * Barre de progression : elle suit le doigt pendant le glissement (le temps affiché aussi), le
 * lecteur se place au relâchement. Flèches : ± 5 s. Inactive tant que la durée n'est pas connue.
 */
function SeekBar() {
  const progress = useRadio((state) => state.progress);
  const [drag, setDrag] = useState<number | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const duration = progress.duration && progress.duration > 0 ? progress.duration : null;
  const value = Math.min(drag ?? progress.time, duration ?? 0);

  // « change » natif : relâchement du doigt ou de la souris (React n'expose que « input »).
  useEffect(() => {
    const el = input.current;
    if (!el) return;
    const commit = () => {
      setDrag(null);
      seekTo(Number(el.value));
    };
    el.addEventListener('change', commit);
    return () => el.removeEventListener('change', commit);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
    if (!step || !duration) return;
    event.preventDefault();
    setDrag(null);
    seekTo(progress.time + step * SEEK_KEY_STEP_S);
  };

  return (
    <div className="radio-seek">
      <input
        ref={input}
        type="range"
        min={0}
        max={duration ?? 1}
        step={0.1}
        value={value}
        disabled={!duration}
        aria-label="Position dans le morceau"
        aria-valuetext={duration ? `${spokenTime(value)} sur ${spokenTime(duration)}` : 'Durée pas encore connue'}
        onChange={(event) => setDrag(Number(event.currentTarget.value))}
        onKeyDown={onKeyDown}
        style={{ '--seek-fill': duration ? `${(value / duration) * 100}%` : '0%' } as CSSProperties}
      />
      <p className="radio-clock" data-testid="radio-temps">
        {formatDuration(value) || '0:00'}
        {duration ? ` / ${formatDuration(duration)}` : ''}
      </p>
    </div>
  );
}

function Player() {
  const now = useRadio((state) => state.now);
  const shuffle = useRadio((state) => state.shuffle);
  const volume = useRadio((state) => state.volume);
  const stations = useRadio((state) => state.catalog.stations);
  const lastStationId = useRadio((state) => state.lastStationId);
  const waitingTap = useRadio((state) => state.waitingTap);
  if (stations.length === 0) return null;
  const station = stations.find((item) => item.id === (now?.stationId ?? lastStationId));
  return (
    <section className="radio-card radio-player" aria-label="Lecteur">
      <div className="radio-now">
        <p className="radio-now-station">{station ? station.name : 'Radio'}</p>
        <p className="radio-now-title" data-testid="radio-titre">
          {now ? now.title : station ? 'En pause. Appuie sur lecture pour reprendre.' : 'Choisis une station.'}
        </p>
        {now?.artist && <p className="radio-now-artist">{now.artist}</p>}
        {now && <SeekBar />}
        {waitingTap && <p className="radio-tap">Touche pour lancer la musique</p>}
      </div>
      <div className="radio-controls">
        <button type="button" className="btn radio-icon" aria-label="Morceau précédent" onClick={() => void previous()} disabled={!now}>
          <IconPrevious />
        </button>
        <button
          type="button"
          className="btn cta radio-icon radio-play"
          aria-label={now?.playing ? 'Pause' : 'Lecture'}
          onClick={() => void togglePlay()}
        >
          {now?.playing ? <IconPause /> : <IconPlay />}
        </button>
        <button type="button" className="btn radio-icon" aria-label="Morceau suivant" onClick={() => void next()} disabled={!now}>
          <IconNext />
        </button>
        <button
          type="button"
          className="btn radio-icon"
          aria-label="Lecture aléatoire"
          aria-pressed={shuffle}
          onClick={() => setShuffle(!shuffle)}
        >
          <IconShuffle />
        </button>
      </div>
      <label className="radio-volume">
        <span>Volume</span>
        <input
          type="range"
          min={0}
          max={100}
          step={1}
          value={Math.round(volume * 100)}
          onChange={(event) => setVolume(Number(event.currentTarget.value) / 100)}
        />
      </label>
    </section>
  );
}

function StationItem({ station, packStations }: { station: Station; packStations: number }) {
  const now = useRadio((state) => state.now);
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState<'station' | 'pack' | null>(null);
  const playingHere = now?.stationId === station.id;
  return (
    <li className="radio-station" data-station={station.folder}>
      <div className="radio-station-head">
        <button type="button" className="radio-station-name" aria-expanded={open} onClick={() => setOpen(!open)}>
          <span className="radio-station-title">{station.name}</span>
          <span className="radio-station-count">{plural(station.tracks.length, 'morceau', 'morceaux')}</span>
        </button>
        <button
          type="button"
          className="btn radio-icon"
          aria-label={`Écouter ${station.name}`}
          aria-current={playingHere || undefined}
          onClick={() => void playStation(station.id)}
        >
          <IconPlay />
        </button>
      </div>
      {open && (
        <>
          <ol className="radio-tracks">
            {station.tracks.map((track) => (
              <li key={track.id}>
                <button
                  type="button"
                  aria-current={now?.trackId === track.id || undefined}
                  onClick={() => void playStation(station.id, track.id)}
                >
                  <span className="radio-track-title">{track.title}</span>
                  <span className="radio-track-meta">
                    {[track.artist, formatDuration(track.duration)].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            ))}
          </ol>
          {confirm === null ? (
            <div className="radio-row">
              <button type="button" className="btn" onClick={() => setConfirm('station')}>
                Supprimer la station
              </button>
              {packStations > 1 && (
                <button type="button" className="btn" onClick={() => setConfirm('pack')}>
                  Supprimer le pack
                </button>
              )}
            </div>
          ) : (
            <div className="radio-confirm" role="alertdialog" aria-label="Confirmer la suppression">
              <p>
                {confirm === 'pack'
                  ? `Supprimer tout le pack (${packStations} stations) ? Les morceaux quittent le téléphone.`
                  : `Supprimer « ${station.name} » ? Ses morceaux quittent le téléphone.`}
              </p>
              <div className="radio-row">
                <button
                  type="button"
                  className="btn radio-danger"
                  onClick={() => void (confirm === 'pack' ? deletePack(station.packId) : deleteStation(station.id))}
                >
                  Supprimer
                </button>
                <button type="button" className="btn" onClick={() => setConfirm(null)}>
                  Garder
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </li>
  );
}

function AddMusic({ empty }: { empty: boolean }) {
  const packInput = useRef<HTMLInputElement>(null);
  const songsInput = useRef<HTMLInputElement>(null);
  const [address, setAddress] = useState('');
  const [showAddress, setShowAddress] = useState(false);
  const job = useRadio((state) => state.job);
  const running = job?.phase === 'telechargement' || job?.phase === 'copie' || job?.phase === 'lecture';

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!address.trim()) return;
    void downloadPack(address.trim());
    setAddress('');
    setShowAddress(false);
  };

  return (
    <section className="radio-card radio-add" aria-labelledby="radio-add-title">
      <h3 id="radio-add-title">Ajouter un pack</h3>
      {empty && (
        <p className="radio-empty">
          Ta radio est vide. Fabrique un pack sur ton ordi avec <code>npm run radio:pack</code>, puis ajoute-le ici
          depuis un fichier ou une adresse ; tu peux aussi prendre des morceaux déjà sur ton téléphone.
        </p>
      )}
      <div className="radio-row">
        <button type="button" className="btn" disabled={running} onClick={() => packInput.current?.click()}>
          Depuis un fichier
        </button>
        <button type="button" className="btn" disabled={running} aria-expanded={showAddress} onClick={() => setShowAddress(!showAddress)}>
          Depuis une adresse
        </button>
      </div>
      {showAddress && (
        <form className="radio-address" onSubmit={submit}>
          <label htmlFor="radio-adresse">Adresse du pack (ZIP)</label>
          <input
            id="radio-adresse"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Colle l’adresse du ZIP"
            value={address}
            onChange={(event) => setAddress(event.currentTarget.value)}
          />
          <button type="submit" className="btn cta" disabled={running || !address.trim()}>
            Télécharger
          </button>
        </form>
      )}
      <button type="button" className="btn radio-songs" disabled={running} onClick={() => songsInput.current?.click()}>
        Ajouter mes morceaux
      </button>
      <input
        ref={packInput}
        type="file"
        hidden
        accept=".zip,application/zip,application/x-zip-compressed,audio/*"
        multiple
        data-testid="radio-fichier-pack"
        onChange={(event) => {
          const files = event.currentTarget.files;
          if (files?.length) void importFiles(Array.from(files));
          event.currentTarget.value = '';
        }}
      />
      <input
        ref={songsInput}
        type="file"
        hidden
        accept="audio/*"
        multiple
        data-testid="radio-fichier-morceaux"
        onChange={(event) => {
          const files = event.currentTarget.files;
          if (files?.length) void importFiles(Array.from(files));
          event.currentTarget.value = '';
        }}
      />
    </section>
  );
}

function StorageLine() {
  const packs = useRadio((state) => state.catalog.packs);
  const storage = useRadio((state) => state.storage);
  const radio = packs.reduce((sum, pack) => sum + pack.bytes, 0);
  const free = storage.quota !== null && storage.usage !== null ? storage.quota - storage.usage : null;
  return (
    <p className="radio-storage" data-testid="radio-place">
      {radio > 0 ? `La radio occupe ${formatBytes(radio)} sur le téléphone` : 'La radio n’occupe encore rien sur le téléphone'}
      {free !== null ? ` · encore ${formatBytes(free)} de libre pour l’atelier` : ''}.
    </p>
  );
}

export function RadioPanel() {
  const status = useRadio((state) => state.status);
  const stations = useRadio((state) => state.catalog.stations);

  if (status === 'indisponible') {
    return (
      <div className="radio-panel">
        <OfferCard />
        <p className="radio-empty">
          Le stockage privé n’est pas disponible dans ce navigateur, donc la radio ne peut rien garder. Ouvre
          l’atelier dans Chrome, hors navigation privée, pour écouter ta musique.
        </p>
      </div>
    );
  }
  if (status === 'chargement') {
    return (
      <div className="radio-panel">
        <OfferCard />
        <p className="radio-note">On allume la radio…</p>
      </div>
    );
  }

  const perPack = new Map<string, number>();
  for (const station of stations) perPack.set(station.packId, (perPack.get(station.packId) ?? 0) + 1);

  return (
    <div className="radio-panel">
      <OfferCard />
      <JobCard />
      <Player />
      {stations.length > 0 && (
        <section aria-labelledby="radio-stations-title">
          <h3 id="radio-stations-title" className="radio-section-title">
            Stations
          </h3>
          <ul className="radio-stations">
            {stations.map((station) => (
              <StationItem key={station.id} station={station} packStations={perPack.get(station.packId) ?? 1} />
            ))}
          </ul>
        </section>
      )}
      <AddMusic empty={stations.length === 0} />
      <StorageLine />
    </div>
  );
}
