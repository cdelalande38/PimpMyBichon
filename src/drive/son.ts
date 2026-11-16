// Son du moteur en sortie de nuit (§ 5.5 « Son », § 9 « Sur la route ») : le lecteur des sons
// moteur (src/state/engineSound.ts, src/audio/engine/) branché sur l'état de la sortie
// (src/state/drive.ts). Rien ne touche à la boucle de rendu : dix fois par seconde (et à chaque
// télémétrie), on lit le régime, le rapport et la charge que le pilote tient (src/drive/pilote.ts,
// `train`, avancé à chaque image : la même vérité que le compte-tours), et le lecteur glisse d'une
// mesure à l'autre en rampes Web Audio. Sans pilote posé (scène pas encore prête), on retombe sur la
// boîte du véhicule (src/data/boites.ts) d'après la télémétrie et la charge (src/drive/mixage.ts).
//
// - Démarrage enregistré au départ (scène prête), ralenti à l'arrêt, régime qui suit la vitesse avec
//   des rapports, charge qui suit l'accélérateur (en pilote automatique : l'accélération), relâchée
//   au frein.
// - Coupure nette à la fin du parcours, en pause, au retour au garage ; remis en marche sans le
//   démarreur si le véhicule roule déjà (reprise après la pause, bouton « Moteur »).
// - Mélange (src/drive/mixage.ts, réglages du panneau « Son » : src/state/mixage.ts) : tant que la
//   sortie roule moteur voulu, le moteur et la route sont devant et la radio baisse (rampe de 0,4 s) ;
//   elle reprend son volume en pause, au bout du parcours et au garage. Au ralenti d'image, moteur et
//   route baissent, la hauteur ne bouge pas.
// - Bruitages de route (src/audio/sfx/route.ts, qui joue quoi : src/data/bruitages.ts ; la glisse des
//   pneus vient de `DriveMotion.slip` ou, à défaut, du braquage et de l’adhérence), relus dix
//   fois par seconde avec le pilote : coupés en pause, au garage et moteur coupé.
// - Aucun son avant un geste dans la page (ouverture directe de #/sortie comprise) : le moteur
//   attend le premier appui.
// - Une famille sans sons reste muette, sans erreur.

import { create } from 'zustand';
import { baisserRadio } from '../audio/radio/player.ts';
import { meteoSon } from '../audio/sfx/meteo.ts';
import { glisseMesuree, type EtatRoute } from '../audio/sfx/regles.ts';
import { instantRepos, LecteurBruitages } from '../audio/sfx/route.ts';
import { boiteDuVehicule } from '../data/boites.ts';
import { resolveVehicle } from '../data/vehicles.ts';
import { useBuilds } from '../state/builds.ts';
import { livePilot, useDrive } from '../state/drive.ts';
import { soundFamilyOf, useEngineSound, useEngineSoundPrefs } from '../state/engineSound.ts';
import { useMixage } from '../state/mixage.ts';
import { etatInitial, pasBoite, regimeJoue, type EtatBoite } from './boite.ts';
import { chargeDe, etatAffiche, lisserAccel, melangeSortie, moteurVoulu, RAMPE_RADIO, type ConditionsSon, type EtatSonSortie } from './mixage.ts';

export type { EtatSonSortie };

export interface SonSortie {
  etat: EtatSonSortie;
  /** Régime du moteur réel (tr/min arrondis), tel que la boîte le calcule ; 0 moteur coupé. */
  regime: number;
  /** Rapport engagé ; 0 moteur coupé. */
  rapport: number;
  /** Volume d'ensemble donné au moteur, de 0 à 1 (curseur « Moteur », ralenti d'image). */
  niveau: number;
  /** Facteur appliqué au volume de la radio, de 0 à 1 (1 : la radio à son volume). */
  radio: number;
  /** Volume d'ensemble des bruitages de route, de 0 à 1 (curseur « Route », ralenti d'image). */
  route: number;
  /** Dernier bruitage ponctuel parti (emplacement), et leur nombre depuis le départ. */
  bruitage: string;
  bruitages: number;
}

const REPOS: Readonly<SonSortie> = Object.freeze({ etat: 'coupe', regime: 0, rapport: 0, niveau: 1, radio: 1, route: 0, bruitage: '', bruitages: 0 });

/** Ce que l'écran de sortie montre du moteur ; mis à jour au rythme de la télémétrie. */
export const useSonSortie = create<SonSortie>(() => ({ ...REPOS }));

/** Glissé du régime entre deux mesures : l'intervalle de la télémétrie (quatre par seconde), en s. */
const GLISSE = 0.25;
/** Mesures lues sur le pilote : intervalle (ms) et glissé (s), assez courts pour entendre les passages. */
const PAS_PILOTE = 100;
const GLISSE_PILOTE = 0.1;
/** Au-dessus de cette vitesse (km/h), on remet le moteur en marche sans le démarreur. */
const VITESSE_LANCEE = 2;
/** Un appui sur « Moteur » dans cette fenêtre après le premier geste de la page ne compte pas (ms). */
const FENETRE_REVEIL = 1000;

/** Un geste a-t-il déjà eu lieu dans la page ? (Le navigateur ne laisse pas jouer avant.) */
function gesteDejaFait(): boolean {
  return typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === true;
}

/** Moment du geste qui a réveillé le son, si la page s'est ouverte sans geste (performance.now()). */
let reveil = -Infinity;

/** Lecteur des bruitages de route : un pour l'app, son index n'est lu qu'une fois par session. */
let bruitages: LecteurBruitages | null = null;

/**
 * Bouton « Moteur » : coupe ou remet le moteur, choix gardé d'une sortie à l'autre. L'appui qui
 * réveille le son d'une sortie ouverte sans geste ne coupe pas ce qu'il vient de lancer.
 */
export function basculerMoteur(): void {
  const prefs = useEngineSoundPrefs.getState();
  if (prefs.enSortie && performance.now() - reveil < FENETRE_REVEIL) return;
  prefs.setEnSortie(!prefs.enSortie);
}

/** Branche le son du moteur sur la sortie ; rend la fonction qui le débranche (retour au garage). */
export function brancherSonSortie(): () => void {
  let geste = gesteDejaFait();
  let tentative = false;
  let boite: EtatBoite | null = null;
  let dernier = 0;
  let vitesseAvant = 0;
  let accel = 0;
  let niveau = -1;
  let route = 1;
  let roule = false;

  const famille = () => soundFamilyOf(resolveVehicle(useBuilds.getState().current));
  let familleCourante = famille();
  // Genre et adhérence du véhicule, pour estimer la glisse des pneus quand le pilote ne la publie pas.
  let genre: 'car' | 'bike' = 'car';
  let grip: number | undefined;
  const lireVehicule = () => {
    const vehicule = resolveVehicle(useBuilds.getState().current);
    genre = vehicule.kind;
    grip = vehicule.performance?.grip;
  };
  lireVehicule();
  bruitages ??= new LecteurBruitages((emplacement) => useSonSortie.setState((state) => ({ bruitage: emplacement, bruitages: state.bruitages + 1 })));
  const lecteur = bruitages;
  // Ce que les bruitages écoutent, réécrit sur place à chaque relecture.
  const etatRoute: EtatRoute = { vitesseKmh: 0, pluie: 0, neige: 0, mouille: 0, abri: 0, nos: false };
  const instant = instantRepos();

  const conditions = (): ConditionsSon => {
    const drive = useDrive.getState();
    return {
      enSortie: drive.map !== null,
      prete: drive.telemetry.ready,
      echec: drive.telemetry.failed,
      finie: drive.telemetry.finished,
      pause: drive.paused,
      voulu: useEngineSoundPrefs.getState().enSortie,
      geste,
      sons: famille() !== null,
    };
  };

  /** Démarre ou coupe selon les conditions, règle le mélange, publie l'état. */
  const evaluer = () => {
    familleCourante = famille();
    lireVehicule();
    const c = conditions();
    roule = moteurVoulu(c);
    const moteur = useEngineSound.getState();
    if (!moteurVoulu(c)) {
      tentative = false;
      boite = null;
      dernier = 0;
      if (moteur.state !== 'coupe') {
        moteur.piloter(null);
        moteur.couperNet();
      }
    } else if (moteur.state === 'coupe' && !tentative) {
      // Une seule tentative par départ : un échec (hors ligne, sons absents) laisse le moteur muet.
      tentative = true;
      if (useDrive.getState().telemetry.speedKmh >= VITESSE_LANCEE) moteur.reprendre();
      else moteur.demarrer();
    }
    const drive = useDrive.getState();
    const melange = melangeSortie({ roule, ralentiImage: drive.slow, reglages: useMixage.getState() });
    if (melange.moteur !== niveau) {
      niveau = melange.moteur;
      useEngineSound.getState().niveau(melange.moteur);
      useSonSortie.setState({ niveau: melange.moteur });
    }
    route = melange.route;
    baisserRadio(melange.radio, RAMPE_RADIO);
    const publie = useSonSortie.getState();
    if (publie.radio !== melange.radio || publie.route !== melange.route) useSonSortie.setState({ radio: melange.radio, route: melange.route });
    majBruitages();
    const etat = etatAffiche(c, useEngineSound.getState().state);
    if (etat !== useSonSortie.getState().etat) useSonSortie.setState(etat === 'tourne' || etat === 'demarre' ? { etat } : { etat, regime: 0, rapport: 0 });
  };

  /** Relecture des bruitages de route : météo locale, vitesse, moteur ; coupés hors de la route. */
  function majBruitages(): void {
    const moteur = useEngineSound.getState();
    const pilote = livePilot.current;
    const tourne = moteur.state === 'demarrage' || moteur.state === 'ralenti' || moteur.state === 'charge';
    const actif = roule && tourne && pilote !== null;
    if (pilote) {
      const motion = pilote.motion;
      const train = pilote.train;
      etatRoute.vitesseKmh = motion.speed * 3.6;
      etatRoute.nos = train?.nos === true;
      // `slip` : glisse publiée par le pilote (facultative) ; à défaut, estimée d'après le braquage et l'adhérence.
      const pneus = motion as { slip?: number };
      etatRoute.glisse = glisseMesuree({ slip: pneus.slip, vitesse: motion.speed, braquage: motion.steer, grip, genre });
      instant.vitesseKmh = etatRoute.vitesseKmh;
      instant.accel = motion.accel;
      instant.shifting = train?.shifting === true;
      instant.charge = train ? train.load : 0;
      instant.regime = train && train.redline > 0 ? train.rpm / train.redline : 0;
    }
    if (meteoSon.posee) {
      etatRoute.pluie = meteoSon.pluie;
      etatRoute.neige = meteoSon.neige;
      etatRoute.mouille = meteoSon.mouille;
      etatRoute.abri = meteoSon.abri;
    } else {
      // Sans la météo locale de la scène : celle qui est choisie, sans tunnel.
      const weather = useDrive.getState().weather;
      etatRoute.pluie = weather === 'pluie' ? 1 : 0;
      etatRoute.neige = weather === 'neige' ? 1 : 0;
      etatRoute.mouille = weather === 'sec' ? 0 : 1;
      etatRoute.abri = 0;
    }
    lecteur.mettreAJour(moteur.audio(), actif, route, etatRoute, instant, familleCourante);
  }

  /** Une mesure : la boîte avance, le lecteur glisse vers le nouveau régime. */
  const mesurer = () => {
    const moteur = useEngineSound.getState();
    const plage = moteur.plage();
    if (!plage || (moteur.state !== 'demarrage' && moteur.state !== 'ralenti' && moteur.state !== 'charge')) return;
    const train = livePilot.current?.train;
    if (train) {
      // Une seule vérité : le régime et le rapport du pilote, comme au compte-tours.
      moteur.piloter(regimeJoue(train.rpm, train.idle, train.redline, plage), train.load, GLISSE_PILOTE);
      const regime = Math.round(train.rpm);
      const etat = useSonSortie.getState();
      if (etat.regime !== regime || etat.rapport !== train.gear) useSonSortie.setState({ regime, rapport: train.gear });
      return;
    }
    const drive = useDrive.getState();
    const now = performance.now();
    const dt = dernier > 0 ? Math.min(0.5, (now - dernier) / 1000) : 0;
    dernier = now;
    const vitesse = drive.telemetry.speedKmh;
    accel = lisserAccel(accel, vitesseAvant, vitesse, dt);
    vitesseAvant = vitesse;
    const spec = boiteDuVehicule(resolveVehicle(useBuilds.getState().current));
    const { charge, frein } = chargeDe(drive.input, accel);
    const sortie = pasBoite(boite ?? etatInitial(plage.min), { vitesseKmh: vitesse, charge, frein }, spec, plage.min, dt);
    boite = { rapport: sortie.rapport, regime: sortie.regime, passage: sortie.passage };
    moteur.piloter(regimeJoue(sortie.regime, plage.min, spec.rupteur, plage), sortie.charge, GLISSE);
    useSonSortie.setState({ regime: Math.round(sortie.regime), rapport: sortie.rapport });
  };

  const offDrive = useDrive.subscribe((state, previous) => {
    if (state.telemetry !== previous.telemetry || state.input !== previous.input) mesurer();
    if (
      state.map !== previous.map ||
      state.paused !== previous.paused ||
      state.slow !== previous.slow ||
      state.attempt !== previous.attempt ||
      state.telemetry.ready !== previous.telemetry.ready ||
      state.telemetry.failed !== previous.telemetry.failed ||
      state.telemetry.finished !== previous.telemetry.finished
    ) {
      evaluer();
    }
  });
  const offMoteur = useEngineSound.subscribe((state, previous) => {
    if (state.state === previous.state) return;
    // Le moteur vient de tourner : la première mesure part de l'état présent de la sortie.
    if (state.state === 'demarrage' || state.state === 'ralenti') mesurer();
    evaluer();
  });
  const offPrefs = useEngineSoundPrefs.subscribe((state, previous) => {
    if (state.enSortie !== previous.enSortie) evaluer();
  });
  const offMixage = useMixage.subscribe((state, previous) => {
    if (state.radio !== previous.radio || state.moteur !== previous.moteur || state.route !== previous.route) evaluer();
  });
  // Entre deux télémétries, le pilote est relu : les passages de rapport s'entendent, les bruitages suivent.
  const minuterie = window.setInterval(() => {
    if (livePilot.current?.train && !useDrive.getState().paused) mesurer();
    majBruitages();
  }, PAS_PILOTE);

  // Ouverture sans geste : le premier appui ou la première touche réveille le son. Le contexte
  // audio naît dans ce geste (le navigateur l'exige).
  const surGeste = () => {
    if (geste) return;
    geste = true;
    reveil = performance.now();
    retirerGeste();
    evaluer();
  };
  const retirerGeste = () => {
    document.removeEventListener('pointerdown', surGeste, true);
    document.removeEventListener('keydown', surGeste, true);
  };
  if (!geste) {
    document.addEventListener('pointerdown', surGeste, true);
    document.addEventListener('keydown', surGeste, true);
  }

  evaluer();

  return () => {
    window.clearInterval(minuterie);
    offDrive();
    offMoteur();
    offPrefs();
    offMixage();
    retirerGeste();
    lecteur.couper();
    meteoSon.posee = false;
    // Au garage, la radio reprend son volume.
    baisserRadio(1, RAMPE_RADIO);
    const moteur = useEngineSound.getState();
    moteur.piloter(null);
    moteur.couperNet();
    moteur.niveau(1);
    useSonSortie.setState({ ...REPOS });
  };
}
