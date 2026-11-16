// Écran de la sortie de nuit (§ 5.5), posé sur la scène de la route (src/drive/DriveCanvas.tsx) :
// - en haut, un bandeau discret : vitesse, nom de la carte, progression, pause ;
// - au milieu, la zone des gestes : à la main, appui maintenu à droite pour accélérer, à gauche pour
//   freiner, glissé latéral pour se placer dans sa voie ; en pilote automatique, appui long pour le
//   ralenti, et, sur la caméra d'orbite, glissé pour tourner autour du véhicule ;
// - en bas, au pouce : caméra suivante, réalisateur, pilote automatique ou conduite à la main,
//   ralenti (maintenu), météo, et « Rentrer au garage » en un geste.
// Chargement et erreur viennent de la télémétrie de la scène (ready, failed). La sortie se regarde
// sans toucher l'écran : pilote automatique et réalisateur sont mis d'office.

import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { closeSheet } from '../../app/useRoute.ts';
import { creditLine, mapById } from '../../data/maps.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { useBuilds } from '../../state/builds.ts';
import { CAMERA_LABELS, useDrive, WEATHERS } from '../../state/drive.ts';
import { DriveIcon } from './icones.tsx';
import './drive.css';

/** Appui long qui déclenche le ralenti, en millisecondes. */
const LONG_PRESS_MS = 450;
/** Glissé latéral qui change de placement, en pixels CSS. */
const LANE_SWIPE_PX = 44;
/** Orbite au doigt : radians par pixel. */
const ORBIT_YAW_PER_PX = 0.009;
const ORBIT_PITCH_PER_PX = 0.006;

const kmhText = (value: number) => String(Math.max(0, Math.round(value)));

function DriveTop() {
  const mapId = useDrive((state) => state.map);
  const telemetry = useDrive((state) => state.telemetry);
  const paused = useDrive((state) => state.paused);
  const setPaused = useDrive((state) => state.setPaused);
  const map = mapById(mapId);
  const progress = Math.round(Math.min(1, Math.max(0, telemetry.progress)) * 100);

  return (
    <header className="drive-top">
      {/* Pas de zone annoncée : la vitesse change quatre fois par seconde. */}
      <div className="drive-band" role="group" aria-label="Tableau de bord">
        <p className="drive-speed">
          <b data-vitesse-affichee={kmhText(telemetry.speedKmh)}>{kmhText(telemetry.speedKmh)}</b>
          <small>km/h</small>
        </p>
        <div className="drive-where">
          <span className="drive-map">{map?.name ?? 'Sortie de nuit'}</span>
          <span className="drive-progress" role="progressbar" aria-label="Progression" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <i style={{ width: `${progress}%` }} />
          </span>
        </div>
      </div>
      <button type="button" className="drive-round" aria-label={paused ? 'Reprendre' : 'Pause'} aria-pressed={paused} onClick={() => setPaused(!paused)}>
        <DriveIcon name={paused ? 'lecture' : 'pause'} />
      </button>
    </header>
  );
}

interface Touch {
  side: 'gauche' | 'droite';
  x: number;
  y: number;
  laneX: number;
  moved: boolean;
}

function DriveGestures() {
  const auto = useDrive((state) => state.input.auto);
  const throttle = useDrive((state) => state.input.throttle);
  const brake = useDrive((state) => state.input.brake);
  const lane = useDrive((state) => state.input.lane);
  const finished = useDrive((state) => state.telemetry.finished);
  const zone = useRef<HTMLDivElement>(null);
  const touches = useRef(new Map<number, Touch>());
  const timer = useRef<number | null>(null);
  const slowByPress = useRef(false);

  const pedals = () => {
    const drive = useDrive.getState();
    let right = false;
    let left = false;
    for (const touch of touches.current.values()) {
      if (touch.side === 'droite') right = true;
      else left = true;
    }
    drive.setThrottle(right ? 1 : 0);
    drive.setBrake(left ? 1 : 0);
  };

  const stopTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!touches.current.delete(event.pointerId)) return;
    stopTimer();
    if (slowByPress.current && touches.current.size === 0) {
      slowByPress.current = false;
      useDrive.getState().setSlow(false);
    }
    if (!useDrive.getState().input.auto) pedals();
  };

  // Le doigt reste posé quand on repasse en pilote automatique, ou l'écran se démonte : on lâche tout.
  useEffect(() => {
    const held = touches.current;
    held.clear();
    return () => {
      held.clear();
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (slowByPress.current) useDrive.getState().setSlow(false);
      slowByPress.current = false;
    };
  }, [auto]);

  return (
    <div
      ref={zone}
      className="mid drive-mid"
      data-conduite={auto ? 'auto' : 'main'}
      onPointerDown={(event) => {
        const box = zone.current?.getBoundingClientRect();
        if (!box) return;
        zone.current?.setPointerCapture?.(event.pointerId);
        const side = event.clientX - box.left > box.width / 2 ? 'droite' : 'gauche';
        touches.current.set(event.pointerId, { side, x: event.clientX, y: event.clientY, laneX: event.clientX, moved: false });
        if (!useDrive.getState().input.auto) {
          pedals();
          return;
        }
        stopTimer();
        timer.current = window.setTimeout(() => {
          timer.current = null;
          slowByPress.current = true;
          useDrive.getState().setSlow(true);
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(event) => {
        const touch = touches.current.get(event.pointerId);
        if (!touch) return;
        const drive = useDrive.getState();
        if (!drive.input.auto) {
          const dx = event.clientX - touch.laneX;
          if (Math.abs(dx) >= LANE_SWIPE_PX) {
            const next = Math.max(-1, Math.min(1, drive.input.lane + Math.sign(dx))) as -1 | 0 | 1;
            drive.setLane(next);
            touch.laneX = event.clientX;
          }
          return;
        }
        const dx = event.clientX - touch.x;
        const dy = event.clientY - touch.y;
        if (!touch.moved && Math.hypot(dx, dy) > 10) {
          touch.moved = true;
          stopTimer();
        }
        if (touch.moved && !drive.director && drive.camera === 'orbite') {
          drive.setOrbit({ yaw: drive.orbit.yaw - dx * ORBIT_YAW_PER_PX, pitch: drive.orbit.pitch + dy * ORBIT_PITCH_PER_PX });
        }
        touch.x = event.clientX;
        touch.y = event.clientY;
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      {!auto && !finished && (
        <div className="drive-pedals" aria-hidden="true">
          <span className="drive-pedal" data-pedale="frein" data-appui={brake > 0}>
            Frein
            <small>maintiens à gauche</small>
          </span>
          <span className="drive-lane">
            {lane === -1 ? '← gauche de ta voie' : lane === 1 ? 'droite de ta voie →' : 'glisse pour te placer'}
          </span>
          <span className="drive-pedal" data-pedale="gaz" data-appui={throttle > 0}>
            Gaz
            <small>maintiens à droite</small>
          </span>
        </div>
      )}
    </div>
  );
}

function DriveBar() {
  const camera = useDrive((state) => state.camera);
  const director = useDrive((state) => state.director);
  const auto = useDrive((state) => state.input.auto);
  const slow = useDrive((state) => state.slow);
  const weather = useDrive((state) => state.weather);
  const finished = useDrive((state) => state.telemetry.finished);
  const drive = useDrive.getState;
  const nextWeather = weather === 'pluie' ? 'sec' : 'pluie';
  const weatherLabel = WEATHERS.find((item) => item.id === weather)?.label ?? weather;

  const holdSlow = (on: boolean) => () => drive().setSlow(on);

  return (
    <footer className="drive-bar" aria-label="Commandes de la sortie">
      {finished && (
        <div className="drive-end">
          <p role="status">Bout de la route. On repart, ou on rentre ?</p>
          <button type="button" className="btn" onClick={() => drive().retry()}>
            Repartir
          </button>
        </div>
      )}
      <nav className="drive-acts" aria-label="Sortie">
        <button type="button" className="drive-act" aria-label="Caméra suivante" onClick={() => drive().nextCamera()}>
          <DriveIcon name="camera" />
          <span>{director ? 'Caméra' : CAMERA_LABELS[camera]}</span>
        </button>
        <button type="button" className="drive-act" aria-label="Réalisateur" aria-pressed={director} onClick={() => drive().setDirector(!director)}>
          <DriveIcon name="realisateur" />
          <span>Réalisateur</span>
        </button>
        <button
          type="button"
          className="drive-act"
          aria-label={auto ? 'Conduite à la main' : 'Pilote automatique'}
          data-conduite={auto ? 'auto' : 'main'}
          onClick={() => drive().setAuto(!auto)}
        >
          <DriveIcon name={auto ? 'main' : 'auto'} />
          <span>{auto ? 'À la main' : 'Auto'}</span>
        </button>
        <button
          type="button"
          className="drive-act"
          aria-label="Ralenti"
          aria-pressed={slow}
          onPointerDown={holdSlow(true)}
          onPointerUp={holdSlow(false)}
          onPointerCancel={holdSlow(false)}
          onPointerLeave={holdSlow(false)}
          onContextMenu={(event) => event.preventDefault()}
          onKeyDown={(event) => (event.key === ' ' || event.key === 'Enter') && drive().setSlow(!slow)}
        >
          <DriveIcon name="ralenti" />
          <span>Ralenti</span>
        </button>
        <button type="button" className="drive-act" aria-label={`Météo : ${weatherLabel}`} data-meteo={weather} onClick={() => drive().setWeather(nextWeather)}>
          <DriveIcon name={weather} />
          <span>{weatherLabel}</span>
        </button>
      </nav>
      <button type="button" className="btn drive-home" onClick={closeSheet}>
        <DriveIcon name="garage" />
        Rentrer au garage
      </button>
    </footer>
  );
}

/** Chargement, ou erreur : par-dessus la scène, sans masquer « Rentrer au garage ». */
function DriveVeil() {
  const mapId = useDrive((state) => state.map);
  const ready = useDrive((state) => state.telemetry.ready);
  const failed = useDrive((state) => state.telemetry.failed);
  const retry = useDrive((state) => state.retry);
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const map = mapById(mapId);

  if (!map || failed) {
    return (
      <div className="drive-veil" data-etat="erreur">
        <p className="alert" role="alert">
          <b>La route ne veut pas s’ouvrir.</b>{' '}
          {map
            ? 'Si c’est ta première sortie sur cette carte, il faut du réseau pour la charger. Sinon, réessaie.'
            : 'Aucune carte de sortie dans cette version.'}
        </p>
        {map && (
          <button type="button" className="btn" onClick={retry}>
            Réessayer
          </button>
        )}
      </div>
    );
  }
  if (ready) return null;
  return (
    <div className="drive-veil" data-etat="chargement">
      <p className="drive-loading" role="status">
        <b>{vehicle.name} sort du garage…</b>
        <small>{map.name}</small>
        <small className="drive-credits">Données de la carte : {map.credits.map(creditLine).join(' ; ')}.</small>
      </p>
    </div>
  );
}

export function DriveScreen() {
  // Page cachée (appel, écran éteint) : la sortie se met en pause, et reprend au retour si c'est
  // nous qui l'avions arrêtée.
  useEffect(() => {
    let byUs = false;
    const onVisibility = () => {
      const drive = useDrive.getState();
      if (document.hidden && !drive.paused) {
        byUs = true;
        drive.setPaused(true);
      } else if (!document.hidden && byUs) {
        byUs = false;
        drive.setPaused(false);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  return (
    <>
      <DriveTop />
      <DriveGestures />
      <DriveVeil />
      <DriveBar />
    </>
  );
}
