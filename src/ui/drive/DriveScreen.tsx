// Écran de la sortie de nuit (§ 5.5), posé sur la scène de la route (src/drive/DriveCanvas.tsx) :
// - en haut : le nom de la carte en entier et la progression, au milieu le compte-tours (régime,
//   rapport, vitesse ; src/ui/drive/CompteTours.tsx), à droite la radio (bouton rond et mini-lecteur,
//   sans quitter la route) et la pause ;
// - au milieu, la zone des gestes : à la main, le manche virtuel par défaut (src/ui/drive/Manche.tsx :
//   le pouce se pose n'importe où, la base apparaît sous lui ; haut le gaz, bas le frein, côtés la
//   direction (direction libre : on braque ; assistée : on se place), tous progressifs ; une amorce
//   dit où poser le pouce tant qu'on ne roule pas), ou, au choix dans les commandes (gardé), les deux
//   pédales : appui maintenu à droite pour accélérer, à gauche pour freiner, glissé latéral pour
//   tourner (libre, progressif) ou se placer (assistée) ; en pilote automatique, un appui propose de
//   reprendre la main, un appui long met le ralenti (dit à l'écran), et, sur la caméra d'orbite, un
//   glissé tourne autour du véhicule. Chaque doigt a le sien : le manche sous un pouce, le NOS, la
//   pause ou la languette sous un autre, sans que l'un lâche l'autre ;
// - en bas, au pouce : le mode de conduite, toujours visible (« Pilote auto » ou « À la main », un
//   appui pour passer de l'un à l'autre ; à la main : caméra de poursuite et réalisateur coupé), le NOS
//   à la main ; puis la barre des commandes (caméra, réalisateur, ralenti, météo, commande, direction
//   libre ou assistée, moteur, manette, « Rentrer au garage »). À la main, la
//   barre s'abaisse pour laisser la place au pilotage : il en reste une languette qui la rappelle ;
//   elle remonte d'elle-même en pilote automatique, en pause et au bout de la route ;
// - en paysage (téléphone couché, ou « Manette (paysage) » : plein écran et orientation verrouillée,
//   src/ui/drive/manette.ts), la manette : le manche sous le pouce gauche, GAZ, FREIN et NOS sous le
//   pouce droit, le compte-tours en haut au milieu, le bandeau réduit, la barre en languette.
// Tant que la route n'est pas prête, un écran de chargement plein et opaque (même air que celui du
// lancement de l'app) nomme la carte et coche ses étapes, « Rentrer au garage » compris ; il s'efface
// en fondu à la première image de la route. L'erreur garde son message et « Réessayer ».
// La sortie se regarde sans toucher l'écran : pilote automatique et réalisateur sont mis d'office au
// premier lancement ; en passant à la main, la poursuite et plus de réalisateur, jusqu'à ce que tu
// les changes toi-même.
// Le son du moteur est branché sur la sortie tant que l'écran est monté (src/drive/son.ts).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { closeSheet } from '../../app/useRoute.ts';
import { useMediaQuery } from '../../app/useMediaQuery.ts';
import { creditLine, mapById } from '../../data/maps.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { DRIVE_STAGE_CLASS } from '../../drive/contrat.ts';
import { basculerMoteur, brancherSonSortie, useSonSortie, type EtatSonSortie } from '../../drive/son.ts';
import { useBuilds } from '../../state/builds.ts';
import { CAMERA_LABELS, COMMANDES, DIRECTIONS, useDrive, WEATHERS } from '../../state/drive.ts';
import { useEngineSoundPrefs } from '../../state/engineSound.ts';
import { RadioButton } from '../radio/RadioButton.tsx';
import '../tuto/tuto.css';
import { CompteTours, useBoucleImage } from './CompteTours.tsx';
import { MiniCarte } from './MiniCarte.tsx';
import { ArriveePanneau, ChronoSortie, FeuxDepart } from './Depart.tsx';
import { DriveIcon } from './icones.tsx';
import { Mixage } from './Mixage.tsx';
import {
  Amorce,
  appliquerManuel,
  bougerManche,
  BoutonTenu,
  lacherManuel,
  leverManche,
  MANUEL,
  MancheDessin,
  poserManche,
  useAppui,
  useManettePhysique,
  type MancheTenu,
} from './Manche.tsx';
import { axeManche } from './manche.ts';
import { entrerManette, manettePossible, quitterManette, useManette } from './manette.ts';
import './drive.css';

/** Écran plus large que haut, à hauteur de téléphone couché : la disposition manette (drive.css). */
const PAYSAGE = '(orientation: landscape) and (max-height: 540px)';
/** Appui long qui déclenche le ralenti, en millisecondes. */
const LONG_PRESS_MS = 450;
/** Glissé latéral qui change de placement (direction assistée), en pixels CSS. */
const LANE_SWIPE_PX = 44;
/** Pédales en direction libre : glissé qui braque à fond, et zone morte, en pixels CSS. */
const PEDAL_STEER_PX = 90;
const PEDAL_STEER_DEAD = 0.1;
/** Orbite au doigt : radians par pixel. */
const ORBIT_YAW_PER_PX = 0.009;
const ORBIT_PITCH_PER_PX = 0.006;
/** « Reprendre la main ? » reste affiché ce temps-là, en millisecondes. */
const OFFER_MS = 3500;
/** Pédales dessinées : estompées après ce temps à rouler (s, au-dessus de `HINT_MOVING_KMH`), revenues sous `HINT_STOP_KMH`. */
const HINT_FADE_S = 4;
const HINT_MOVING_KMH = 10;
const HINT_STOP_KMH = 3;

function DriveTop() {
  const mapId = useDrive((state) => state.map);
  const progressValue = useDrive((state) => state.telemetry.progress);
  const paused = useDrive((state) => state.paused);
  const setPaused = useDrive((state) => state.setPaused);
  const map = mapById(mapId);
  const progress = Math.round(Math.min(1, Math.max(0, progressValue)) * 100);
  const pause = useAppui(() => setPaused(!useDrive.getState().paused));

  return (
    <header className="drive-top">
      <div className="drive-where">
        <span className="drive-map">{map?.name ?? 'Sortie de nuit'}</span>
        <span className="drive-progress" role="progressbar" aria-label="Progression" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
          <i style={{ width: `${progress}%` }} />
        </span>
      </div>
      <CompteTours />
      <FeuxDepart />
      <ChronoSortie />
      <MiniCarte />
      <div className="drive-top-droite">
        <RadioButton enSortie />
        <button type="button" className="drive-round" aria-label={paused ? 'Reprendre' : 'Pause'} aria-pressed={paused} {...pause}>
          <DriveIcon name={paused ? 'lecture' : 'pause'} />
        </button>
      </div>
    </header>
  );
}

interface Touch {
  side: 'gauche' | 'droite';
  x: number;
  y: number;
  laneX: number;
  /** Abscisse où le doigt s'est posé, et braquage qu'il donne (pédales, direction libre). */
  x0: number;
  steer: number;
  moved: boolean;
  at: number;
}

/** Les pédales dessinées s'estompent après quelques secondes à rouler, et reviennent à l'arrêt. */
function usePedalsFaded(auto: boolean): boolean {
  // L'état vaut pour un mode : en changeant de mode, les pédales reviennent franches.
  const [state, setState] = useState({ auto, faded: false });
  const setFaded = (faded: boolean) => setState((value) => (value.auto === auto && value.faded === faded ? value : { auto, faded }));
  const faded = state.auto === auto && state.faded;
  useEffect(() => {
    let movingSince = -1;
    const check = () => {
      const { telemetry, input } = useDrive.getState();
      if (input.auto) return;
      const now = performance.now();
      if (telemetry.speedKmh <= HINT_STOP_KMH) {
        movingSince = -1;
        setFaded(false);
      } else if (telemetry.speedKmh >= HINT_MOVING_KMH) {
        if (movingSince < 0) movingSince = now;
        else if (now - movingSince >= HINT_FADE_S * 1000) setFaded(true);
      }
    };
    const off = useDrive.subscribe((next, previous) => {
      if (next.telemetry !== previous.telemetry) check();
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setFaded ne change qu'avec `auto`.
  }, [auto]);
  return faded;
}

function DriveGestures({ paysage }: { paysage: boolean }) {
  const auto = useDrive((state) => state.input.auto);
  const throttle = useDrive((state) => state.input.throttle);
  const brake = useDrive((state) => state.input.brake);
  const lane = useDrive((state) => state.input.lane);
  const commande = useDrive((state) => state.commande);
  const libre = useDrive((state) => state.direction === 'libre');
  const slow = useDrive((state) => state.slow);
  const finished = useDrive((state) => state.telemetry.finished);
  const zone = useRef<HTMLDivElement>(null);
  const touches = useRef(new Map<number, Touch>());
  const timer = useRef<number | null>(null);
  const slowByPress = useRef(false);
  const [offer, setOffer] = useState(false);
  const faded = usePedalsFaded(auto);
  // Le manche : en portrait s'il est choisi (par défaut), toujours en paysage (manette).
  const manche = !auto && (paysage || commande === 'manche');
  const mancheEl = useRef<HTMLDivElement>(null);
  const stick = useRef<MancheTenu | null>(null);
  const [tenu, setTenu] = useState(false);
  // Le manche (ou le glissé des pédales) donne `steer` : en direction libre toujours, en assistée au manche.
  const steers = manche || libre;
  // Une manette branchée se lit aussi, à la main (gâchettes, manche gauche, NOS).
  useManettePhysique(!auto && !finished, steers);
  // Pour les parcours : écart à l'axe (m), cap relatif (°, positif à gauche) et glissement (0 à 1) du
  // véhicule, posés sur la zone des gestes à chaque image quand ils changent (sans rendu React).
  const shown = useRef({ ecart: '', cap: '', glisse: '' });
  useBoucleImage((pilot) => {
    const el = zone.current;
    const m = pilot?.motion;
    if (!el || !m) return;
    const ecart = m.offset.toFixed(1);
    const cap = String(Math.round(((m.yaw ?? 0) * 180) / Math.PI));
    const glisse = (m.slip ?? 0).toFixed(1);
    const seen = shown.current;
    if (ecart !== seen.ecart) el.dataset.ecart = seen.ecart = ecart;
    if (cap !== seen.cap) el.dataset.cap = seen.cap = cap;
    if (glisse !== seen.glisse) el.dataset.glisse = seen.glisse = glisse;
  });

  const pedals = () => {
    let right = false;
    let left = false;
    let steer = 0;
    for (const touch of touches.current.values()) {
      if (touch.side === 'droite') right = true;
      else left = true;
      // Direction libre : le doigt qui glisse braque (le dernier qui a glissé l'emporte).
      if (libre && touch.steer !== 0) steer = touch.steer;
    }
    MANUEL.stick.throttle = right ? 1 : 0;
    MANUEL.stick.brake = left ? 1 : 0;
    MANUEL.stick.steer = steer;
    appliquerManuel(libre);
  };

  const stopTimer = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const releaseStick = (event: ReactPointerEvent<HTMLDivElement>): boolean => {
    if (stick.current?.id !== event.pointerId) return false;
    stick.current = null;
    leverManche(mancheEl.current);
    appliquerManuel(true);
    setTenu(false);
    return true;
  };

  const release = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (releaseStick(event)) return;
    const touch = touches.current.get(event.pointerId);
    if (!touch) return;
    touches.current.delete(event.pointerId);
    const short = timer.current !== null;
    stopTimer();
    if (slowByPress.current && touches.current.size === 0) {
      slowByPress.current = false;
      useDrive.getState().setSlow(false);
    }
    const drive = useDrive.getState();
    if (!drive.input.auto) {
      if (!manche) pedals();
    }
    // Pilote automatique : un appui bref (ni glissé, ni appui long) propose de reprendre la main.
    else if (short && !touch.moved && event.type === 'pointerup') setOffer(true);
  };

  // Le doigt reste posé quand on change de mode, ou l'écran se démonte : on lâche tout.
  useEffect(() => {
    const held = touches.current;
    held.clear();
    stick.current = null;
    lacherManuel();
    leverManche(mancheEl.current);
    if (!useDrive.getState().input.auto) appliquerManuel(steers);
    return () => {
      held.clear();
      stick.current = null;
      lacherManuel();
      if (timer.current !== null) window.clearTimeout(timer.current);
      if (slowByPress.current) useDrive.getState().setSlow(false);
      slowByPress.current = false;
    };
  }, [auto, manche, steers]);

  useEffect(() => {
    if (!offer) return;
    const t = window.setTimeout(() => setOffer(false), OFFER_MS);
    return () => window.clearTimeout(t);
  }, [offer]);

  return (
    <div
      ref={zone}
      className="mid drive-mid"
      data-conduite={auto ? 'auto' : 'main'}
      data-commande={auto ? undefined : manche ? 'manche' : 'pedales'}
      onPointerDown={(event) => {
        const box = zone.current?.getBoundingClientRect();
        if (!box) return;
        const drive = useDrive.getState();
        if (!drive.input.auto && manche) {
          // Un seul pouce tient le manche ; un autre doigt dans la zone ne le lui vole pas.
          if (stick.current !== null) return;
          zone.current?.setPointerCapture?.(event.pointerId);
          stick.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
          poserManche(mancheEl.current, event.clientX - box.left, event.clientY - box.top);
          appliquerManuel(true);
          setTenu(true);
          return;
        }
        zone.current?.setPointerCapture?.(event.pointerId);
        const side = event.clientX - box.left > box.width / 2 ? 'droite' : 'gauche';
        touches.current.set(event.pointerId, { side, x: event.clientX, y: event.clientY, laneX: event.clientX, x0: event.clientX, steer: 0, moved: false, at: performance.now() });
        if (!drive.input.auto) {
          pedals();
          return;
        }
        stopTimer();
        timer.current = window.setTimeout(() => {
          timer.current = null;
          slowByPress.current = true;
          setOffer(false);
          useDrive.getState().setSlow(true);
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(event) => {
        const held = stick.current;
        if (held && held.id === event.pointerId) {
          bougerManche(mancheEl.current, event.clientX - held.x, event.clientY - held.y);
          appliquerManuel(true);
          return;
        }
        const touch = touches.current.get(event.pointerId);
        if (!touch) return;
        const drive = useDrive.getState();
        if (!drive.input.auto) {
          if (libre) {
            // Direction libre : le glissé braque, progressif, autant que le doigt s'écarte.
            const steer = axeManche((event.clientX - touch.x0) / PEDAL_STEER_PX, PEDAL_STEER_DEAD);
            if (steer !== touch.steer) {
              touch.steer = steer;
              pedals();
            }
            return;
          }
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
      {slow && (
        <p className="drive-badge" role="status">
          Ralenti
        </p>
      )}
      {auto && offer && !finished && (
        <div className="drive-offer" role="status" onPointerDown={(event) => event.stopPropagation()}>
          <span>Reprendre la main ?</span>
          <button
            type="button"
            className="btn drive-offer-btn"
            onClick={() => {
              setOffer(false);
              useDrive.getState().setAuto(false);
            }}
          >
            <DriveIcon name="main" />
            Prendre le volant
          </button>
        </div>
      )}
      {manche && !finished && !tenu && !faded && <Amorce libre={libre} />}
      {manche && !finished && <MancheDessin el={mancheEl} />}
      {!auto && !manche && !finished && (
        <div className="drive-pedals" aria-hidden="true" data-estompe={faded}>
          <span className="drive-pedal" data-pedale="frein" data-appui={brake > 0}>
            <i className="drive-pedal-plaque" />
            Frein
            <small>maintiens à gauche</small>
          </span>
          <span className="drive-lane">{libre ? '← glisse pour tourner →' : lane === -1 ? '← à gauche' : lane === 1 ? 'à droite →' : 'glisse pour te placer'}</span>
          <span className="drive-pedal" data-pedale="gaz" data-appui={throttle > 0}>
            <i className="drive-pedal-plaque" />
            Gaz
            <small>maintiens à droite</small>
          </span>
        </div>
      )}
      {paysage && !auto && !finished && <PaveManette />}
    </div>
  );
}

/**
 * Manette en paysage, sous le pouce droit : GAZ en grand, FREIN, NOS. Chaque bouton tient à son
 * doigt, en même temps que le manche sous le pouce gauche.
 */
function PaveManette() {
  const tenir = (cle: 'gaz' | 'frein') => (on: boolean) => {
    MANUEL[cle] = on;
    appliquerManuel(true);
  };
  return (
    <div className="drive-pave" onPointerDown={(event) => event.stopPropagation()}>
      <NosButton />
      <BoutonTenu nom="Frein" className="drive-pave-btn" onChange={tenir('frein')}>
        Frein
      </BoutonTenu>
      <BoutonTenu nom="Gaz" className="drive-pave-btn drive-pave-gaz" onChange={tenir('gaz')}>
        Gaz
      </BoutonTenu>
    </div>
  );
}

const MOTEUR_LIBELLES: Record<EtatSonSortie, string> = {
  'sans-son': 'Sans son',
  muet: 'Coupé',
  attente: 'Moteur',
  coupe: 'Moteur',
  demarre: 'Moteur',
  tourne: 'Moteur',
};

/**
 * Coupe et remet le son du moteur ; le choix est gardé d'une sortie à l'autre. Pour les parcours :
 * data-moteur (sans-son, muet, attente d'un geste, coupe, demarre, tourne), data-regime (tr/min du
 * moteur réel), data-rapport et data-niveau (volume d'ensemble du moteur).
 */
function EngineToggle() {
  const { etat, regime, rapport, niveau } = useSonSortie();
  const enSortie = useEngineSoundPrefs((state) => state.enSortie);
  const sansSon = etat === 'sans-son';
  return (
    <button
      type="button"
      className="drive-act drive-engine"
      aria-label={sansSon ? 'Son du moteur : pas encore de son pour ce moteur' : 'Son du moteur'}
      aria-pressed={sansSon ? undefined : enSortie}
      disabled={sansSon}
      data-moteur={etat}
      data-regime={regime}
      data-rapport={rapport}
      data-niveau={niveau.toFixed(2)}
      onClick={basculerMoteur}
    >
      <DriveIcon name={enSortie && !sansSon ? 'moteur' : 'moteurCoupe'} />
      <span>{MOTEUR_LIBELLES[etat]}</span>
    </button>
  );
}

/** Mode de conduite, toujours visible : un interrupteur « Conduite à la main ». */
function ModeToggle() {
  const auto = useDrive((state) => state.input.auto);
  const basculer = useAppui(() => {
    const drive = useDrive.getState();
    drive.setAuto(!drive.input.auto);
  });
  return (
    <button
      type="button"
      role="switch"
      className="drive-mode"
      aria-checked={!auto}
      aria-label="Conduite à la main"
      data-conduite={auto ? 'auto' : 'main'}
      {...basculer}
    >
      <DriveIcon name={auto ? 'auto' : 'main'} />
      <span className="drive-mode-texte">
        <b>{auto ? 'Pilote auto' : 'À la main'}</b>
        <small>{auto ? 'touche pour conduire' : 'touche pour le pilote'}</small>
      </span>
    </button>
  );
}

/**
 * NOS : chaque appui envoie une poussée de quelques secondes si la réserve le permet. La réserve se
 * lit sur l'anneau (mis à jour à chaque image, sans rendu React) ; data-nos : pret, envoye, vide.
 */
function NosButton() {
  const ref = useRef<HTMLButtonElement>(null);
  const shown = useRef({ reserve: -1, state: '' });
  useBoucleImage((pilot) => {
    const el = ref.current;
    const train = pilot?.train;
    if (!el || !train) return;
    const reserve = Math.round(train.nosReserve * 100);
    if (reserve !== shown.current.reserve) {
      shown.current.reserve = reserve;
      el.style.setProperty('--reserve', `${reserve}%`);
      el.dataset.reserve = String(reserve);
    }
    const state = train.nos ? 'envoye' : train.nosReserve >= 0.12 ? 'pret' : 'vide';
    if (state !== shown.current.state) el.dataset.nos = shown.current.state = state;
  });
  const fire = () => useDrive.getState().fireNos();
  return (
    <button
      ref={ref}
      type="button"
      className="drive-nos"
      aria-label="NOS"
      data-nos="pret"
      onPointerDown={(event) => {
        event.stopPropagation();
        fire();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          fire();
        }
      }}
      onContextMenu={(event) => event.preventDefault()}
    >
      <DriveIcon name="nos" />
      <span>NOS</span>
    </button>
  );
}

/** Entrée « Manette (paysage) » : proposée là où le navigateur sait verrouiller l'orientation. */
function ManetteToggle() {
  const active = useManette();
  const [refus, setRefus] = useState(false);
  if (!manettePossible()) return null;
  return (
    <>
      <button
        type="button"
        className="drive-act drive-manette"
        aria-label="Manette (paysage)"
        aria-pressed={active}
        onClick={() => {
          setRefus(false);
          if (active) void quitterManette();
          else void entrerManette().then((ok) => setRefus(!ok));
        }}
      >
        <DriveIcon name="manette" />
        <span>Manette</span>
      </button>
      {refus && (
        <p className="drive-refus" role="status">
          Ton téléphone ne veut pas tourner l’écran : couche-le, la manette suit.
        </p>
      )}
    </>
  );
}

function DriveBar({ paysage }: { paysage: boolean }) {
  const camera = useDrive((state) => state.camera);
  const commande = useDrive((state) => state.commande);
  const direction = useDrive((state) => state.direction);
  const director = useDrive((state) => state.director);
  const auto = useDrive((state) => state.input.auto);
  const slow = useDrive((state) => state.slow);
  const weather = useDrive((state) => state.weather);
  const paused = useDrive((state) => state.paused);
  const finished = useDrive((state) => state.telemetry.finished);
  // L'arrivée a son panneau (src/ui/drive/Depart.tsx) : pas de second « Repartir » dans la barre.
  const arrive = useDrive((state) => state.telemetry.depart === 'arrive');
  // Barre rappelée à la main : vaut pour ce passage à la main (elle s'abaisse de nouveau au suivant).
  const [raisedFor, setRaisedFor] = useState<{ auto: boolean; up: boolean }>({ auto, up: false });
  const raised = raisedFor.auto === auto && raisedFor.up;
  const drive = useDrive.getState;
  // Un appui passe au temps suivant : sec, pluie, neige, puis sec.
  const nextWeather = WEATHERS[(WEATHERS.findIndex((item) => item.id === weather) + 1) % WEATHERS.length]?.id ?? 'sec';
  const weatherLabel = WEATHERS.find((item) => item.id === weather)?.label ?? weather;

  // À la main, la barre s'abaisse d'elle-même ; elle remonte en pilote automatique.
  const folded = !auto && !raised && !paused && !finished;

  const holdSlow = (on: boolean) => () => drive().setSlow(on);
  const tab = useAppui(() => setRaisedFor({ auto, up: folded }));
  const nextCamera = useAppui(() => drive().nextCamera());
  const nextCommande = COMMANDES[(COMMANDES.findIndex((item) => item.id === commande) + 1) % COMMANDES.length]?.id ?? 'manche';
  const commandeLabel = COMMANDES.find((item) => item.id === commande)?.label ?? commande;
  const nextDirection = DIRECTIONS[(DIRECTIONS.findIndex((item) => item.id === direction) + 1) % DIRECTIONS.length]?.id ?? 'libre';
  const directionLabel = DIRECTIONS.find((item) => item.id === direction)?.label ?? direction;

  return (
    <footer className="drive-bar" aria-label="Commandes de la sortie" data-replie={folded}>
      {finished && !arrive && (
        <div className="drive-end">
          <p role="status">Bout de la route. On repart, ou on rentre ?</p>
          <button type="button" className="btn" onClick={() => drive().retry()}>
            Repartir
          </button>
        </div>
      )}
      <div className="drive-pilot">
        <ModeToggle />
        {!auto && !finished && (
          <button
            type="button"
            className="drive-tab"
            aria-expanded={!folded}
            aria-controls="drive-commandes"
            aria-label={folded ? 'Afficher les commandes' : 'Replier les commandes'}
            {...tab}
          >
            <DriveIcon name={folded ? 'monter' : 'descendre'} />
            <span>{folded ? 'Commandes' : 'Replier'}</span>
          </button>
        )}
        {!auto && !finished && !paysage && <NosButton />}
      </div>
      <div className="drive-panel" id="drive-commandes" inert={folded} aria-hidden={folded || undefined}>
        <div className="drive-panel-in">
          <nav className="drive-acts" aria-label="Sortie">
            <button type="button" className="drive-act" aria-label="Caméra suivante" {...nextCamera}>
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
            {/* La commande à la main, en portrait : le manche ou les pédales (en paysage, toujours la manette). */}
            {!paysage && (
              <button type="button" className="drive-act" aria-label={`Commande : ${commandeLabel}`} data-commande={commande} onClick={() => drive().setCommande(nextCommande)}>
                <DriveIcon name={commande === 'manche' ? 'manche' : 'pedales'} />
                <span>{commandeLabel}</span>
              </button>
            )}
            {/* Direction à la main : libre (on braque) ou assistée (l'aide suit la route). Aucune ne freine à ta place. */}
            <button
              type="button"
              className="drive-act"
              aria-label={`Direction : ${directionLabel}`}
              data-direction={direction}
              onClick={() => drive().setDirection(nextDirection)}
            >
              <DriveIcon name={direction === 'libre' ? 'directionLibre' : 'directionAssistee'} />
              <span>{directionLabel}</span>
            </button>
          </nav>
          <div className="drive-foot">
            <EngineToggle />
            <Mixage />
            <ManetteToggle />
            <button type="button" className="btn drive-home" onClick={closeSheet}>
              <DriveIcon name="garage" />
              Rentrer au garage
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}

/** Durée du fondu de l'écran de chargement, en millisecondes. */
const FONDU_MS = 400;

const ETAPES = [
  { nom: 'La carte', enCours: 'La carte se déplie' },
  { nom: 'La route et le décor', enCours: 'La route et le décor se posent' },
  { nom: 'Le véhicule', enCours: 'Le véhicule sort du garage' },
  { nom: 'La nuit tombe', enCours: 'La nuit tombe' },
] as const;

/**
 * Étapes faites, d'après ce que la scène publie sur son élément racine (data-sortie, data-troncons)
 * et la télémétrie : la carte lue (la scène tourne), des tronçons chargés, tous ceux d'autour
 * chargés (le compte ne bouge plus), la première image de la route rendue.
 */
function useEtapes(ready: boolean): number {
  const [faites, setFaites] = useState(0);
  useEffect(() => {
    if (ready) return;
    let last = -1;
    let stableSince = 0;
    const t = window.setInterval(() => {
      const stage = document.querySelector<HTMLElement>(`.${DRIVE_STAGE_CLASS}`);
      const troncons = Number(stage?.dataset.troncons ?? Number.NaN);
      let n = 0;
      if (stage?.dataset.sortie) n = 1;
      if (troncons >= 1) n = 2;
      if (troncons >= 1) {
        if (troncons !== last) {
          last = troncons;
          stableSince = performance.now();
        } else if (performance.now() - stableSince > 1200) n = 3;
      }
      setFaites((value) => Math.max(value, n));
    }, 200);
    return () => window.clearInterval(t);
  }, [ready]);
  return ready ? ETAPES.length : faites;
}

/**
 * Chargement plein écran, du même air que celui du lancement (src/ui/tuto/Chargement.tsx). Monté de
 * nouveau à chaque essai (clé), il revient avec « Réessayer » et « Repartir ».
 */
function DriveLoading() {
  const mapId = useDrive((state) => state.map);
  const ready = useDrive((state) => state.telemetry.ready);
  const failed = useDrive((state) => state.telemetry.failed);
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const map = mapById(mapId);
  const faites = useEtapes(ready);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => setGone(true), reduced ? 0 : FONDU_MS);
    return () => window.clearTimeout(t);
  }, [ready, reduced]);

  if (!map || failed || gone) return null;
  const courante = ETAPES[Math.min(faites, ETAPES.length - 1)] ?? ETAPES[0];
  return (
    <div className="drive-veil drive-chargement" data-etat="chargement" data-fini={ready || undefined} inert={ready}>
      <div className="tuto-chargement-bas">
        <p className="tuto-marque">
          <span>Sortie de nuit</span>
          <b>{map.name}</b>
        </p>
        {map.hint && <p className="drive-chargement-sous">{map.hint}</p>}
        <ol className="tuto-etapes">
          {ETAPES.map((etape, index) => (
            <li key={etape.nom} data-etat={index < faites ? 'fait' : index === faites ? 'encours' : 'attente'}>
              {etape.nom}
            </li>
          ))}
        </ol>
        <div
          className="tuto-barre"
          role="progressbar"
          aria-label={`Chargement de ${map.name}`}
          aria-valuemin={0}
          aria-valuemax={ETAPES.length}
          aria-valuenow={faites}
          aria-valuetext={faites >= ETAPES.length ? 'Tout est prêt' : `${courante.enCours}, étape ${faites + 1} sur ${ETAPES.length}`}
        >
          <i style={{ transform: `scaleX(${Math.max(0.06, faites / ETAPES.length)})` }} />
        </div>
        <p className="tuto-chargement-texte" role="status">
          {faites >= ETAPES.length ? 'C’est parti' : faites === 2 ? `${vehicle.name} sort du garage…` : `${courante.enCours}…`}
        </p>
        <p className="drive-credits">Données de la carte : {map.credits.map(creditLine).join(' ; ')}.</p>
        <button type="button" className="btn drive-home drive-chargement-garage" onClick={closeSheet}>
          <DriveIcon name="garage" />
          Rentrer au garage
        </button>
      </div>
    </div>
  );
}

/** Erreur : par-dessus la scène, sans masquer « Rentrer au garage ». */
function DriveVeil() {
  const mapId = useDrive((state) => state.map);
  const failed = useDrive((state) => state.telemetry.failed);
  const retry = useDrive((state) => state.retry);
  const map = mapById(mapId);

  if (map && !failed) return null;
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

export function DriveScreen() {
  const attempt = useDrive((state) => state.attempt);
  const mapId = useDrive((state) => state.map);
  const paysage = useMediaQuery(PAYSAGE);
  // Le son du moteur suit la sortie tant que l'écran est là ; il se coupe au retour au garage.
  useEffect(() => brancherSonSortie(), []);
  // En rentrant au garage, le mode manette s'arrête : verrou levé, plein écran quitté.
  useEffect(
    () => () => {
      lacherManuel();
      void quitterManette();
    },
    [],
  );

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
      <DriveGestures paysage={paysage} />
      <DriveVeil />
      <DriveBar paysage={paysage} />
      <ArriveePanneau />
      <DriveLoading key={`${mapId ?? ''}-${attempt}`} />
    </>
  );
}
