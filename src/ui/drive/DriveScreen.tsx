// Écran de la sortie de nuit (§ 5.5), posé sur la scène de la route (src/drive/DriveCanvas.tsx).
// Déroulé (demande du 17 novembre 2026) :
// - l'aperçu : une fois la carte chargée, la route en pilote automatique avec le réalisateur, comme une
//   vitrine. À l'écran, presque rien : le nom de la carte, la radio, la petite icône des réglages dans
//   le coin, et en bas, en léger, « Touche l'écran pour commencer » ;
// - un appui sur la route lance la course : le véhicule revient sur la ligne du départ choisi, les
//   feux (rouge, rouge, vert), la conduite à la main, la caméra de poursuite ; pendant les feux, en
//   portrait, une offre discrète « Mode manette » (plein écran et paysage), effacée au vert ;
// - la course : en haut le nom de la carte et la progression, le compte-tours (régime, rapport, vitesse ;
//   src/ui/drive/CompteTours.tsx), les feux puis le chrono, à droite les réglages, la radio et la
//   pause ; sous le nom de la carte, un carré de 130 px réservé à la mini-carte ; au milieu, la zone
//   des gestes : le manche virtuel par défaut (src/ui/drive/Manche.tsx : le pouce se pose n'importe
//   où, la base apparaît sous lui ; haut le gaz, bas le frein, côtés la direction (libre : on braque ;
//   assistée : on se place), tous progressifs ; une amorce dit où poser le pouce tant qu'on ne roule
//   pas), ou les deux pédales (au choix dans les réglages, gardé) ; le NOS en bas à droite. Chaque
//   doigt a le sien : le manche sous un pouce, le NOS ou la pause sous un autre ;
// - en paysage (téléphone couché, ou « Manette (paysage) » : plein écran et orientation verrouillée,
//   src/ui/drive/manette.ts), la manette : le manche sous le pouce gauche, GAZ, FREIN et NOS sous le
//   pouce droit, le compte-tours en haut au milieu, le bandeau réduit ;
// - les réglages (src/ui/drive/Reglages.tsx) rangent tout le reste : caméra, réalisateur, ralenti,
//   météo, commande, direction, manette, son, pilote automatique, « Repartir », « Rentrer au garage ».
//   « Pilote automatique » rend le volant au pilote sans rien perdre du parcours (position, chrono) ;
//   l'écran redevient épuré, et un appui sur la route reprend la main. Dans l'aperçu et sous le pilote,
//   un appui long met le ralenti, et, sur la caméra d'orbite, un glissé tourne autour du véhicule.
// Tant que la route n'est pas prête, un écran de chargement plein et opaque (même air que celui du
// lancement de l'app) nomme la carte et coche ses étapes ; il s'efface en fondu à la première image de la
// route. Plus de bouton « Rentrer au garage » (retour du 18 novembre 2026 : il prenait de la place et cachait
// les titres en paysage) : Précédent (le téléphone) et Échap (le clavier) y ramènent au garage, sans question
// (src/app/gardeSortie.ts). L'erreur garde son message, « Réessayer » et « Rentrer au garage ».
// Le son du moteur est branché sur la sortie tant que l'écran est monté (src/drive/son.ts).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { closeSheet } from '../../app/useRoute.ts';
import { useMediaQuery } from '../../app/useMediaQuery.ts';
import { creditLine, mapById } from '../../data/maps.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { DRIVE_STAGE_CLASS } from '../../drive/contrat.ts';
import { brancherSonSortie } from '../../drive/son.ts';
import { useBuilds } from '../../state/builds.ts';
import { directionDe, useDrive } from '../../state/drive.ts';
import { RadioButton } from '../radio/RadioButton.tsx';
import '../tuto/tuto.css';
import { CompteTours, useBoucleImage } from './CompteTours.tsx';
import { MiniCarte } from './MiniCarte.tsx';
import { AnnonceBalade } from './Balade.tsx';
import { DriftCompteur } from './DriftCompteur.tsx';
import { EtiquetteRendezVous } from '../carriere/EnSortie.tsx';
import { ArriveePanneau, ChronoSortie, FeuxDepart } from './Depart.tsx';
import { NosEffet } from './NosEffet.tsx';
import { FinCourse } from './FinCourse.tsx';
import { DriveIcon } from './icones.tsx';
import { SonEtat } from './Mixage.tsx';
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
  useBoutonManette,
  useClavier,
  useManettePhysique,
  useToucheLancement,
  type MancheTenu,
} from './Manche.tsx';
import { axeManche } from './manche.ts';
import { entrerManette, quitterManette, useManette, useManetteBranchee } from './manette.ts';
import { ReglagesPanneau, useReglages } from './Reglages.tsx';
import './drive.css';
import { PositionDuel } from './Duel.tsx';

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
/** Pédales dessinées : estompées après ce temps à rouler (s, au-dessus de `HINT_MOVING_KMH`), revenues sous `HINT_STOP_KMH`. */
const HINT_FADE_S = 4;
const HINT_MOVING_KMH = 10;
const HINT_STOP_KMH = 3;

function DriveTop({ apercu, reglages, ouvrirReglages }: { apercu: boolean; reglages: boolean; ouvrirReglages: () => void }) {
  const mapId = useDrive((state) => state.map);
  const progressValue = useDrive((state) => state.telemetry.progress);
  const paused = useDrive((state) => state.paused);
  const setPaused = useDrive((state) => state.setPaused);
  const map = mapById(mapId);
  const progress = Math.round(Math.min(1, Math.max(0, progressValue)) * 100);
  const pause = useAppui(() => setPaused(!useDrive.getState().paused));
  const ouvrir = useAppui(ouvrirReglages);

  return (
    <header className="drive-top" data-apercu={apercu || undefined}>
      <div className="drive-where">
        <span className="drive-map">{map?.name ?? 'Sortie'}</span>
        <EtiquetteRendezVous />
        {!apercu && (
          <span className="drive-progress" role="progressbar" aria-label="Progression" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <i style={{ width: `${progress}%` }} />
          </span>
        )}
      </div>
      {!apercu && <CompteTours />}
      {!apercu && <FeuxDepart />}
      {!apercu && <ChronoSortie />}
      {!apercu && <PositionDuel />}
      <div className="drive-top-droite">
        <button type="button" className="drive-round drive-reglages-btn" aria-label="Réglages de la sortie" aria-haspopup="dialog" aria-expanded={reglages} {...ouvrir}>
          <DriveIcon name="reglages" />
        </button>
        <RadioButton enSortie />
        {!apercu && (
          <button type="button" className="drive-round drive-pause" aria-label={paused ? 'Reprendre' : 'Pause'} aria-pressed={paused} {...pause}>
            <DriveIcon name={paused ? 'lecture' : 'pause'} />
          </button>
        )}
      </div>
      {/* Place de la mini-carte (130 px), en course seulement : la monter ici, dans ce carré. */}
      {!apercu && (
        <div className="drive-minicarte-place" data-place="minicarte">
          <MiniCarte />
        </div>
      )}
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
  // Au format Drift, libre d'office (src/state/drive.ts, `directionDe`).
  const libre = useDrive((state) => directionDe(state) === 'libre');
  const slow = useDrive((state) => state.slow);
  const finished = useDrive((state) => state.telemetry.finished);
  const zone = useRef<HTMLDivElement>(null);
  const touches = useRef(new Map<number, Touch>());
  const timer = useRef<number | null>(null);
  const slowByPress = useRef(false);
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
  // Sur un ordinateur, le clavier aussi : flèches ou Z Q S D, Espace pour le NOS.
  useClavier(!auto && !finished, steers);
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

  // Diagnostic lisible sur téléphone (data-coupures, data-reprises sur l'élément du manche) : coupures
  // subies (pointercancel du navigateur : geste système, défilement pris par la page) et captures du
  // pointeur reprises (perdues sans que le doigt se lève).
  const compteurs = useRef({ coupures: 0, reprises: 0 });
  const noter = (cle: 'coupures' | 'reprises') => {
    compteurs.current[cle] += 1;
    if (mancheEl.current) mancheEl.current.dataset[cle] = String(compteurs.current[cle]);
  };
  useEffect(() => {
    const el = mancheEl.current;
    if (!el) return;
    el.dataset.coupures = String(compteurs.current.coupures);
    el.dataset.reprises = String(compteurs.current.reprises);
  }, [manche, finished]);

  // Le manche ne lâche que sur la fin du doigt (levé), ou sur le pointercancel du navigateur, compté.
  // Une capture perdue sans l'un ni l'autre est reprise : le doigt continue de mener le manche.
  const releaseStick = (event: { pointerId: number; type: string }): boolean => {
    if (stick.current?.id !== event.pointerId) return false;
    if (event.type === 'lostpointercapture') {
      try {
        zone.current?.setPointerCapture(event.pointerId);
        noter('reprises');
        return true;
      } catch {
        // Le doigt est déjà levé : on lâche.
      }
    }
    stick.current = null;
    if (event.type === 'pointercancel') noter('coupures');
    leverManche(mancheEl.current);
    appliquerManuel(true);
    setTenu(false);
    return true;
  };

  /** Le doigt du manche a bougé (par la zone, ou par la fenêtre si la capture est perdue). */
  const suivreManche = (event: { pointerId: number; clientX: number; clientY: number }): boolean => {
    const held = stick.current;
    if (!held || held.id !== event.pointerId) return false;
    bougerManche(mancheEl.current, event.clientX - held.x, event.clientY - held.y);
    appliquerManuel(true);
    return true;
  };

  // Filet : si le navigateur ne livre plus les événements du doigt à la zone (capture perdue, doigt passé
  // sur un bouton), la fenêtre les reçoit encore. Les gestionnaires sont idempotents.
  const dernier = useRef({ suivre: suivreManche, lacher: releaseStick });
  useEffect(() => {
    dernier.current = { suivre: suivreManche, lacher: releaseStick };
  });
  useEffect(() => {
    const bouger = (event: PointerEvent) => void dernier.current.suivre(event);
    const finir = (event: PointerEvent) => void dernier.current.lacher(event);
    window.addEventListener('pointermove', bouger);
    window.addEventListener('pointerup', finir);
    window.addEventListener('pointercancel', finir);
    return () => {
      window.removeEventListener('pointermove', bouger);
      window.removeEventListener('pointerup', finir);
      window.removeEventListener('pointercancel', finir);
    };
  }, []);

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
    // Aperçu : un appui bref (ni glissé, ni appui long) lance la course ; sous le pilote, il reprend la main.
    else if (short && !touch.moved && event.type === 'pointerup' && !drive.telemetry.finished) {
      if (drive.apercu) drive.commencer();
      else drive.setAuto(false);
    }
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
          // Un seul pouce tient le manche ; un autre doigt dans la zone ne le lui vole pas. Un nouveau premier
          // doigt (le navigateur n'en voit plus d'autre posé) prend la place d'un doigt perdu en route.
          if (stick.current !== null) {
            if (!event.isPrimary) return;
            leverManche(mancheEl.current);
          }
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
          useDrive.getState().setSlow(true);
        }, LONG_PRESS_MS);
      }}
      onPointerMove={(event) => {
        if (suivreManche(event)) return;
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
      onContextMenu={(event) => event.preventDefault()}
    >
      {slow && (
        <p className="drive-badge" role="status">
          Ralenti
        </p>
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
      {!paysage && !auto && !finished && (
        <div className="drive-nos-coin" onPointerDown={(event) => event.stopPropagation()}>
          <NosButton />
        </div>
      )}
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

/**
 * Le bas de l'écran, en léger : « Touche l'écran pour commencer » dans l'aperçu, « pour reprendre la
 * main » sous le pilote automatique ; pendant les feux, en portrait, l'offre « Mode manette » ; au bout
 * d'une route sans arrivée, « Repartir ».
 */
function DriveBas({ apercu, paysage }: { apercu: boolean; paysage: boolean }) {
  const auto = useDrive((state) => state.input.auto);
  const ready = useDrive((state) => state.telemetry.ready);
  const failed = useDrive((state) => state.telemetry.failed);
  const finished = useDrive((state) => state.telemetry.finished);
  const phase = useDrive((state) => state.telemetry.depart);
  const paused = useDrive((state) => state.paused);
  const manette = useManette();
  const padBranche = useManetteBranchee();
  const [refus, setRefus] = useState(false);
  // Fin de course : l'écran de fin prend tout le bas (src/ui/drive/FinCourse.tsx).
  const fin = useDrive((state) => state.fin !== null);
  if (!ready || failed || fin) return null;
  if (finished && phase !== 'arrive' && !apercu) {
    return (
      <div className="drive-bas">
        <div className="drive-end">
          <p role="status">Bout de la route. On repart, ou on rentre ?</p>
          <button type="button" className="btn" onClick={() => useDrive.getState().commencer()}>
            Repartir
          </button>
        </div>
      </div>
    );
  }
  // Proposée à tout téléphone en portrait : là où le navigateur ne sait pas tourner l'écran, l'appui
  // dit de le coucher (la manette suit l'orientation).
  const offreManette = !apercu && !auto && !paysage && !manette && (phase === 'attente' || phase === 'feux');
  return (
    <div className="drive-bas">
      {offreManette && (
        <button
          type="button"
          className="drive-offre-manette"
          onPointerDown={(event) => event.stopPropagation()}
          onClick={() => {
            setRefus(false);
            void entrerManette().then((ok) => setRefus(!ok));
          }}
        >
          <DriveIcon name="manette" />
          <span>
            <b>Mode manette</b>
            <small>plein écran, téléphone couché</small>
          </span>
        </button>
      )}
      {refus && !paysage && (
        <p className="drive-refus" role="status">
          Ton téléphone ne veut pas tourner l’écran : couche-le, la manette suit.
        </p>
      )}
      {auto && !paused && !finished && (
        <p className="drive-invite" role="status" data-manette={padBranche || undefined}>
          {padBranche ? (apercu ? 'Touche l’écran ou un bouton de la manette pour commencer' : 'Touche l’écran ou un bouton de la manette pour reprendre la main') : apercu ? 'Touche l’écran pour commencer' : 'Touche l’écran pour reprendre la main'}
        </p>
      )}
    </div>
  );
}

/** Durée du fondu de l'écran de chargement, en millisecondes. */
const FONDU_MS = 400;

const ETAPES = [
  { nom: 'La carte', enCours: 'La carte se déplie' },
  { nom: 'La route et le décor', enCours: 'La route et le décor se posent' },
  { nom: 'Le véhicule', enCours: 'Le véhicule sort du garage' },
  { nom: 'Le ciel', enCours: 'Le ciel se pose' },
] as const;

/** Dernière étape du chargement : le ciel du moment choisi (nuit ou jour). */
const ETAPE_CIEL = {
  nuit: { nom: 'La nuit tombe', enCours: 'La nuit tombe' },
  jour: { nom: 'Le jour se lève', enCours: 'Le jour se lève' },
} as const;

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
 * nouveau à chaque essai (clé), il revient avec « Réessayer », « Repartir » et « Course suivante ». Sans
 * bouton : on en sort par Précédent ou par Échap.
 */
function DriveLoading() {
  const mapId = useDrive((state) => state.map);
  const ready = useDrive((state) => state.telemetry.ready);
  const failed = useDrive((state) => state.telemetry.failed);
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const reduced = useMediaQuery('(prefers-reduced-motion: reduce)');
  const moment = useDrive((state) => state.moment);
  const map = mapById(mapId);
  const faites = useEtapes(ready);
  const [gone, setGone] = useState(false);

  useEffect(() => {
    if (!ready) return;
    const t = window.setTimeout(() => setGone(true), reduced ? 0 : FONDU_MS);
    return () => window.clearTimeout(t);
  }, [ready, reduced]);

  // Échap, tant que la route charge : retour au garage (Précédent le fait déjà, par la garde de la sortie).
  useEffect(() => {
    if (ready) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      event.preventDefault();
      closeSheet();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [ready]);

  if (!map || failed || gone) return null;
  const etapes: readonly { nom: string; enCours: string }[] = [...ETAPES.slice(0, ETAPES.length - 1), ETAPE_CIEL[moment] ?? ETAPE_CIEL.nuit];
  const courante = etapes[Math.min(faites, etapes.length - 1)] ?? ETAPES[0];
  return (
    <div className="drive-veil drive-chargement" data-etat="chargement" data-fini={ready || undefined} inert={ready}>
      <div className="tuto-chargement-bas">
        <p className="tuto-marque">
          <span>Sortie</span>
          <b>{map.name}</b>
        </p>
        {map.hint && <p className="drive-chargement-sous">{map.hint}</p>}
        <ol className="tuto-etapes">
          {etapes.map((etape, index) => (
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
      </div>
    </div>
  );
}

/** Erreur : par-dessus la scène, avec « Réessayer » et « Rentrer au garage ». */
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
      <button type="button" className="btn drive-home" onClick={closeSheet}>
        <DriveIcon name="garage" />
        Rentrer au garage
      </button>
    </div>
  );
}

/**
 * Fondu au noir de l'aperçu au bout d'un parcours ouvert : la scène (src/drive/scene/moteur.ts) lève
 * `fondu` en fin de route, attend que l'écran dise qu'il est noir pour remettre le véhicule au départ, puis le
 * baisse. Sous l'interface (nom de la carte, réglages), jamais sur un appui. Sans mouvement, la scène ne
 * le lève pas : coupe franche.
 */
function FonduNoir() {
  const fondu = useDrive((state) => state.fondu);
  return (
    <div
      className="drive-fondu"
      data-noir={fondu !== 'non' || undefined}
      aria-hidden="true"
      // La scène attend cette confirmation : le noir est atteint pour de bon, même quand les images sont rares.
      onTransitionEnd={(event) => {
        if (event.propertyName === 'opacity' && useDrive.getState().fondu === 'sortie') useDrive.getState().setFondu('noir');
      }}
    />
  );
}

export function DriveScreen() {
  const attempt = useDrive((state) => state.attempt);
  const mapId = useDrive((state) => state.map);
  const apercu = useDrive((state) => state.apercu);
  const paysage = useMediaQuery(PAYSAGE);
  const reglages = useReglages();
  const auto = useDrive((state) => state.input.auto);
  const prete = useDrive((state) => state.telemetry.ready && !state.telemetry.failed && !state.telemetry.finished);
  // Une manette physique fait comme l'appui sur la route : un bouton de face ou Start lance la course
  // depuis l'aperçu, ou rend le volant sous le pilote automatique.
  const reprendre = () => {
    const drive = useDrive.getState();
    if (drive.apercu) drive.commencer();
    else drive.setAuto(false);
  };
  useBoutonManette(auto && prete && !reglages.ouvert, reprendre);
  // Au clavier : Entrée, Espace ou la touche des gaz.
  useToucheLancement(auto && prete && !reglages.ouvert, reprendre);
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
      <DriveTop apercu={apercu} reglages={reglages.ouvert} ouvrirReglages={reglages.ouvrir} />
      {!apercu && <NosEffet />}
      <FonduNoir />
      <DriveGestures paysage={paysage} />
      <DriveBas apercu={apercu} paysage={paysage} />
      <DriveVeil />
      <SonEtat />
      <ArriveePanneau />
      {!apercu && <AnnonceBalade />}
      {!apercu && <DriftCompteur />}
      <FinCourse />
      {reglages.ouvert && <ReglagesPanneau paysage={paysage} fermer={reglages.fermer} />}
      <DriveLoading key={`${mapId ?? ''}-${attempt}`} />
    </>
  );
}
