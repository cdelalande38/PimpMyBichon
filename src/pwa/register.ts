// Branchement de la PWA : service worker, progression du précache, mise à jour, installation.
// Aucune de ces étapes n'est bloquante : l'app s'affiche tout de suite, le cache se remplit derrière.

import { registerSW } from 'virtual:pwa-register';
import { preparerMiseAJour } from './avantMiseAJour.ts';
import { MAJ_AUTO, peutAppliquerDoffice } from './majAuto.ts';
import { isPrecacheProgress, SKIP_WAITING } from './messages.ts';
import { usePwa, setInstallLater } from './pwaStore.ts';

/** Événement non standard de Chrome qui permet de proposer l'installation depuis l'app. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const UPDATE_CHECK_EVERY_MS = 30 * 60 * 1000;
/**
 * Si la version en attente n'a pas pris la main dans ce délai, on repropose la mise à jour, SANS
 * recharger. Elle peut tarder : le navigateur attend que l'ancienne version ait fini de servir les
 * requêtes en cours (les modèles du garage au lancement, un morceau de la radio). Recharger à
 * l'aveugle à ce moment-là fait s'activer la nouvelle version pendant que la page se décharge, et la
 * navigation reste alors bloquée sur un écran vide (constaté le 16 novembre 2026, une fois sur quatre
 * dans le parcours « sans aucun geste »). On ne recharge donc qu'au changement de version effectif
 * (`controllerchange`) ; `reloadRequested` reste vrai, il rechargera quand elle s'activera.
 */
const REOFFER_AFTER_MS = 20_000;

let skipWaiting: (() => Promise<void>) | null = null;
let installEvent: BeforeInstallPromptEvent | null = null;
let started = false;
/** Vrai dès que la mise à jour est demandée (par l'utilisateur, ou d'office avant son premier geste) : seul cas où la page se recharge. */
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
/** Vrai dès le premier geste dans la page : au-delà, plus de rechargement sans accord. */
let interacted = false;
const bootAt = Date.now();
/** Clé de session : heure de la dernière mise à jour appliquée d'office dans cet onglet. */
const AUTO_UPDATE_KEY = 'pmb-maj-auto';

function watchInteraction(): void {
  const mark = () => {
    interacted = true;
  };
  for (const type of ['pointerdown', 'keydown', 'touchstart'] as const) {
    window.addEventListener(type, mark, { once: true, capture: true, passive: true });
  }
}

/** Une mise à jour d'office vient d'être demandée dans cet onglet, et l'utilisateur n'a encore rien touché. */
function autoUpdatePending(): boolean {
  if (interacted) return false;
  try {
    const last = Number(window.sessionStorage.getItem(AUTO_UPDATE_KEY));
    return Number.isFinite(last) && last > 0 && Date.now() - last < MAJ_AUTO.gardeMs;
  } catch {
    return false;
  }
}

/**
 * Une version déjà téléchargée attend. Tant que l'utilisateur n'a rien touché, on l'applique d'office
 * (règle : src/pwa/majAuto.ts) ; sinon on la propose (bandeau du menu), sans rien imposer.
 */
function offerOrApplyUpdate(): void {
  let sinceLast = Number.POSITIVE_INFINITY;
  let storage: Storage | null;
  try {
    storage = window.sessionStorage;
    const last = Number(storage.getItem(AUTO_UPDATE_KEY));
    if (Number.isFinite(last) && last > 0) sinceLast = Date.now() - last;
  } catch {
    // Stockage refusé : pas de garde possible contre une boucle, donc pas de rechargement d'office.
    storage = null;
  }
  const auto =
    storage !== null &&
    peutAppliquerDoffice({
      geste: interacted,
      enSortie: window.location.hash.startsWith('#/sortie'),
      depuisLancementMs: Date.now() - bootAt,
      depuisDerniereMs: sinceLast,
    });
  if (!auto) {
    usePwa.setState({ updateReady: true });
    return;
  }
  try {
    storage?.setItem(AUTO_UPDATE_KEY, String(Date.now()));
  } catch {
    usePwa.setState({ updateReady: true });
    return;
  }
  void applyUpdate();
}

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
      if (worker.state === 'installed' && navigator.serviceWorker.controller) offerOrApplyUpdate();
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
    // Demandée ici, ou d'office juste avant un rechargement parti trop tôt (la page a été rechargée
    // avant que la nouvelle version ait pris la main) : on recharge.
    if (reloadRequested || autoUpdatePending()) {
      reloadOnce();
      return;
    }
    // Mise à jour activée depuis une autre fenêtre : on propose de recharger, sans l'imposer.
    if (hadController) usePwa.setState({ updateReady: true });
    hadController = true;
  });

  navigator.serviceWorker.addEventListener('message', (event) => {
    if (!isPrecacheProgress(event.data)) return;
    const { done, total } = event.data;
    usePwa.setState((state) =>
      // Une mise à jour en arrière-plan ne doit pas faire repasser l'indicateur en « préparation ».
      state.offline === 'pret' ? state : { offline: 'preparation', done, total },
    );
  });

  const update = registerSW({
    immediate: true,
    onOfflineReady: () => usePwa.setState({ offline: 'pret' }),
    onNeedRefresh: () => offerOrApplyUpdate(),
    // Pas de rechargement décidé par la bibliothèque : voir `controllerchange` ci-dessus.
    onNeedReload: () => {},
    onRegisteredSW: (swUrl, registration) => {
      if (!registration) return;
      if (registration.active) usePwa.setState({ offline: 'pret' });
      else usePwa.setState((state) => (state.offline === 'inconnu' ? { offline: 'preparation' } : state));
      watchInstalls(swUrl, registration);
      watchForUpdates(registration);
      // Une version téléchargée lors d'une visite précédente attend déjà : c'est le moment de l'appliquer.
      if (registration.waiting && navigator.serviceWorker.controller) offerOrApplyUpdate();
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
  watchInteraction();
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
