// Branchement de la PWA : service worker, progression du précache, mise à jour, installation.
// Aucune de ces étapes n'est bloquante : l'app s'affiche tout de suite, le cache se remplit derrière.
// Seule exception, courte et bornée : au lancement, l'écran de chargement vérifie s'il existe une
// nouvelle version (src/pwa/lancement.ts, la règle ; ici le branchement) et, si oui, la télécharge et
// la laisse prendre la main avant que l'app ou la musique ne démarre. Rien d'autre ne recharge la page
// tout seul : une version qui arrive en cours d'usage est proposée (pastille, bandeau).

import { registerSW } from 'virtual:pwa-register';
import { preparerMiseAJour } from './avantMiseAJour.ts';
import { entreeAvecOffre, lancementEnCours } from './lancement.ts';
import { envoyer, lancer, useLancement } from './lancementStore.ts';
import { isPrecacheProgress, SKIP_WAITING } from './messages.ts';
import { usePwa, setInstallLater } from './pwaStore.ts';

/** Événement non standard de Chrome qui permet de proposer l'installation depuis l'app. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const UPDATE_CHECK_EVERY_MS = 30 * 60 * 1000;
/**
 * Mise à jour demandée par un geste : si la version en attente n'a pas pris la main dans ce délai, on
 * repropose la mise à jour, SANS recharger. Elle peut tarder : le navigateur attend que l'ancienne
 * version ait fini de servir les requêtes en cours (un morceau de la radio). Recharger à l'aveugle à
 * ce moment-là fait s'activer la nouvelle version pendant que la page se décharge, et la navigation
 * reste alors bloquée sur un écran vide (constaté le 16 novembre 2026). On ne recharge donc qu'au
 * changement de version effectif (`controllerchange`) ; `reloadRequested` reste vrai, il rechargera
 * quand elle s'activera.
 */
const REOFFER_AFTER_MS = 20_000;

let skipWaiting: (() => Promise<void>) | null = null;
let installEvent: BeforeInstallPromptEvent | null = null;
let started = false;
/** Enregistrement du service worker, dès qu'il est connu (le lancement et l'offre de mise à jour s'en servent). */
let currentRegistration: ServiceWorkerRegistration | null = null;
/** Vrai dès que la mise à jour est demandée par l'utilisateur (pastille, bandeau) : alors la page se recharge au changement de version. */
let reloadRequested = false;
/**
 * Vrai dès qu'un rechargement est parti. Jamais deux : un second `reload()` lancé pendant que la page
 * se décharge (le rechargement de secours, puis `controllerchange` dans la page mourante) croise le
 * premier et laisse la page bloquée sur un écran vide (constaté le 16 novembre 2026, une fois sur huit
 * dans le parcours « sans aucun geste »).
 */
let reloading = false;

function reloadOnce(): void {
  if (reloading) return;
  reloading = true;
  window.location.reload();
}

/** Clé de session : heure du dernier rechargement provoqué par l'écran de lancement dans cet onglet (garde contre une boucle). */
const LAUNCH_RELOAD_KEY = 'pmb-lancement-recharge';

function sinceLaunchReload(): number {
  try {
    const last = Number(window.sessionStorage.getItem(LAUNCH_RELOAD_KEY));
    return Number.isFinite(last) && last > 0 ? Date.now() - last : Number.POSITIVE_INFINITY;
  } catch {
    // Stockage refusé : pas de garde possible contre une boucle, donc pas de rechargement de lancement.
    return 0;
  }
}

/** Une version téléchargée attend : proposée (bandeau, pastille) hors du lancement ; pendant le lancement, c'est l'écran qui la prend en charge. */
function offerUpdate(): void {
  if (lancementEnCours(useLancement.getState())) {
    envoyer({ type: 'prete' });
    applyAtLaunch();
    return;
  }
  usePwa.setState({ updateReady: true });
}

/**
 * Lancement : la version est prête, on lui passe la main. La page se recharge au `controllerchange`
 * (une seule fois), jamais avant : recharger avant que la nouvelle version ait pris la main bloquait
 * la page sur un écran vide (16 novembre 2026).
 */
function applyAtLaunch(): void {
  if (useLancement.getState().phase !== 'application') return;
  const waiting = currentRegistration?.waiting;
  if (!waiting) return;
  try {
    window.sessionStorage.setItem(LAUNCH_RELOAD_KEY, String(Date.now()));
  } catch {
    // Sans garde possible, on ne recharge pas : la version sera proposée.
    envoyer({ type: 'perdue' });
    return;
  }
  // Les flux qui durent sont lâchés d'abord : sans cela l'ancienne version reste occupée.
  preparerMiseAJour();
  waiting.postMessage({ type: SKIP_WAITING });
}

/** Au lancement : une version qui attendait déjà, ou que la vérification vient de trouver. */
async function checkAtLaunch(registration: ServiceWorkerRegistration): Promise<void> {
  const answer = (): 'prete' | 'en-cours' | 'aucune' => {
    if (registration.waiting) return 'prete';
    if (registration.installing) return 'en-cours';
    return 'aucune';
  };
  let found = answer();
  if (found === 'aucune') {
    try {
      await registration.update();
    } catch {
      envoyer({ type: 'verifie', version: 'echec' });
      return;
    }
    found = answer();
  }
  envoyer({ type: 'verifie', version: found });
  if (found === 'prete') applyAtLaunch();
}

/** La phase d'application est entrée par un autre chemin (progrès, version prête) : on passe la main. */
useLancement.subscribe((etat, avant) => {
  if (etat.phase === avant.phase) return;
  if (etat.phase === 'application') applyAtLaunch();
  // Entré sans recharger alors qu'une version attend : elle reste proposée.
  if (entreeAvecOffre(etat) && currentRegistration?.waiting) usePwa.setState({ updateReady: true });
});

function watchNetwork(): void {
  const sync = () => usePwa.setState({ online: navigator.onLine });
  sync();
  window.addEventListener('online', sync);
  window.addEventListener('offline', sync);
}

function watchDisplayMode(): void {
  const query = window.matchMedia('(display-mode: standalone)');
  const sync = () => usePwa.setState({ standalone: query.matches });
  sync();
  query.addEventListener('change', sync);
}

function watchInstallPrompt(): void {
  window.addEventListener('beforeinstallprompt', (event) => {
    // On garde l'événement pour proposer l'installation depuis le dock, au bon moment.
    event.preventDefault();
    installEvent = event as BeforeInstallPromptEvent;
    usePwa.setState({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    usePwa.setState({ canInstall: false });
  });
}

function watchForUpdates(registration: ServiceWorkerRegistration): void {
  // Une app installée peut rester ouverte des jours : on revérifie quand elle revient au premier plan.
  let lastCheck = Date.now();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' || !navigator.onLine) return;
    if (Date.now() - lastCheck < UPDATE_CHECK_EVERY_MS) return;
    lastCheck = Date.now();
    registration.update().catch(() => {
      // Réseau capricieux : on réessaiera au prochain retour.
    });
  });
}

/** Délai avant de retenter une installation ratée, si le réseau ne s'est pas manifesté d'ici là. */
const INSTALL_RETRY_MS = 30_000;

/**
 * Suit chaque installation de service worker, sans s'en remettre aux déductions de la
 * bibliothèque d'enregistrement :
 * - précache interrompu à la première visite (réseau coupé) : on le dit, et on réessaie ;
 * - nouvelle version installée alors qu'une autre est aux commandes : on propose de recharger.
 */
function watchInstalls(swUrl: string, registration: ServiceWorkerRegistration): void {
  const follow = (worker: ServiceWorker | null) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offerUpdate();
      // Installation perdue pendant le lancement : on entre, sans attendre davantage.
      if (worker.state === 'redundant' && registration.active) envoyer({ type: 'perdue' });
      if (worker.state === 'redundant' && !registration.active) {
        usePwa.setState({ offline: 'erreur', done: 0, total: 0 });
        retryInstall(swUrl);
      }
    });
  };
  follow(registration.installing);
  registration.addEventListener('updatefound', () => follow(registration.installing));
}

/** Relance l'installation au retour du réseau, ou au bout d'un moment. */
function retryInstall(swUrl: string): void {
  let timer = 0;
  const retry = () => {
    window.removeEventListener('online', retry);
    window.clearTimeout(timer);
    navigator.serviceWorker
      .register(swUrl, { scope: import.meta.env.BASE_URL })
      .then((registration) => {
        usePwa.setState((state) => (state.offline === 'erreur' ? { offline: 'preparation' } : state));
        watchInstalls(swUrl, registration);
      })
      .catch(() => retryInstall(swUrl));
  };
  window.addEventListener('online', retry);
  timer = window.setTimeout(retry, INSTALL_RETRY_MS);
}

function watchServiceWorker(): void {
  // Le lancement se décide ici, avant la première image : pas de service worker possible, rien à
  // vérifier ; un service worker aux commandes et du réseau, l'écran de chargement vérifie la version.
  const indisponible = import.meta.env.DEV || !('serviceWorker' in navigator);
  lancer({
    indisponible,
    controle: !indisponible && Boolean(navigator.serviceWorker.controller),
    enLigne: navigator.onLine,
    depuisRechargeMs: sinceLaunchReload(),
  });
  if (import.meta.env.DEV) {
    usePwa.setState({ offline: 'dev' });
    return;
  }
  if (!('serviceWorker' in navigator)) {
    usePwa.setState({ offline: 'indisponible' });
    return;
  }

  // Changement de service worker aux commandes. On gère le rechargement nous-mêmes : la
  // bibliothèque d'enregistrement ne recharge pas si la mise à jour arrive pendant la toute
  // première session, et rechargerait sans prévenir une fenêtre restée ouverte à côté.
  let hadController = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    // Pendant le lancement : la nouvelle version a pris la main avant l'entrée dans l'app, on recharge
    // (une seule fois : reloadOnce, et la garde de session contre une boucle).
    if (lancementEnCours(useLancement.getState())) {
      if (envoyer({ type: 'controle' }).recharger) reloadOnce();
      return;
    }
    // Demandée par un geste (pastille, bandeau) : on recharge.
    if (reloadRequested) {
      reloadOnce();
      return;
    }
    // Activée depuis une autre fenêtre, ou tardivement : on propose de recharger, sans l'imposer.
    if (hadController) usePwa.setState({ updateReady: true });
    hadController = true;
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (!isPrecacheProgress(event.data)) return;
    const { done, total } = event.data;
    // Écran de lancement : l'avancement d'une version qui s'installe.
    envoyer({ type: 'progres', done, total });
    usePwa.setState((state) =>
      // Une mise à jour en arrière-plan ne doit pas faire repasser l'indicateur en « préparation ».
      state.offline === 'pret' ? state : { offline: 'preparation', done, total },
    );
  });

  const update = registerSW({
    immediate: true,
    onOfflineReady: () => usePwa.setState({ offline: 'pret' }),
    onNeedRefresh: () => offerUpdate(),
    // Pas de rechargement décidé par la bibliothèque : voir `controllerchange` ci-dessus.
    onNeedReload: () => {},
    onRegisteredSW: (swUrl, registration) => {
      if (!registration) return;
      currentRegistration = registration;
      if (registration.active) usePwa.setState({ offline: 'pret' });
      else usePwa.setState((state) => (state.offline === 'inconnu' ? { offline: 'preparation' } : state));
      watchInstalls(swUrl, registration);
      watchForUpdates(registration);
      // Lancement : une version qui attend déjà ou que la vérification trouve (écran de chargement).
      if (lancementEnCours(useLancement.getState())) void checkAtLaunch(registration);
      // Lancement déjà passé (délai, garde) et une version attend : on la propose.
      else if (registration.waiting && navigator.serviceWorker.controller) usePwa.setState({ updateReady: true });
    },
    onRegisterError: () => usePwa.setState({ offline: 'erreur' }),
  });
  skipWaiting = () => update(true);

  // `ready` ne se résout qu'avec un service worker actif, donc un précache complet.
  void navigator.serviceWorker.ready.then(() => usePwa.setState({ offline: 'pret' }));
}

/** À appeler une fois au démarrage. */
export function startPwa(): void {
  if (started) return;
  started = true;
  watchNetwork();
  watchDisplayMode();
  watchInstallPrompt();
  watchServiceWorker();
}

/** Applique la mise à jour (sur un geste, ou d'office avant le premier geste) : la page se recharge dès que la nouvelle version a pris la main. */
export async function applyUpdate(): Promise<void> {
  reloadRequested = true;
  usePwa.setState({ updateReady: false });
  // Les flux qui durent (la radio) sont lâchés d'abord : sans cela l'ancienne version reste occupée et
  // la nouvelle n'est jamais activée.
  preparerMiseAJour();
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    const waiting = registration?.waiting;
    if (waiting) {
      // La version en attente s'active, `controllerchange` recharge la page.
      window.setTimeout(() => {
        if (!reloading) usePwa.setState({ updateReady: true });
      }, REOFFER_AFTER_MS);
      if (skipWaiting) await skipWaiting();
      // Enregistrement pas encore connu de la bibliothèque : on s'adresse au service worker lui-même.
      else waiting.postMessage({ type: SKIP_WAITING });
      return;
    }
  } catch {
    // Pas de service worker joignable : un simple rechargement fera l'affaire.
  }
  // Rien en attente (version déjà activée ailleurs) : il suffit de recharger.
  reloadOnce();
}

/** Ouvre la fenêtre d'installation du navigateur, si elle est disponible. */
export async function promptInstall(): Promise<void> {
  const event = installEvent;
  if (!event) return;
  installEvent = null;
  usePwa.setState({ canInstall: false });
  try {
    await event.prompt();
    // « Pas maintenant » : on n'insiste pas, le bouton se range dans Atelier › Sous le capot.
    const choice = await event.userChoice;
    if (choice.outcome === 'dismissed') setInstallLater(true);
  } catch {
    // Fenêtre déjà affichée ou refusée par le navigateur : rien à faire.
  }
}
