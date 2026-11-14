// Branchement de la PWA : service worker, progression du précache, mise à jour, installation.
// Aucune de ces étapes n'est bloquante : l'app s'affiche tout de suite, le cache se remplit derrière.

import { registerSW } from 'virtual:pwa-register';
import { isPrecacheProgress } from './messages.ts';
import { usePwa } from './pwaStore.ts';

/** Événement non standard de Chrome qui permet de proposer l'installation depuis l'app. */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const UPDATE_CHECK_EVERY_MS = 30 * 60 * 1000;
/** Si la version en attente ne prend pas la main dans ce délai, on recharge quand même. */
const RELOAD_FALLBACK_MS = 5000;

let skipWaiting: (() => Promise<void>) | null = null;
let installEvent: BeforeInstallPromptEvent | null = null;
let started = false;
/** Vrai dès que l'utilisateur a demandé la mise à jour : seul cas où la page se recharge. */
let reloadRequested = false;

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
    if (reloadRequested) {
      window.location.reload();
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
    onNeedRefresh: () => usePwa.setState({ updateReady: true }),
    // Pas de rechargement décidé par la bibliothèque : voir `controllerchange` ci-dessus.
    onNeedReload: () => {},
    onRegisteredSW: (_url, registration) => {
      if (!registration) return;
      if (registration.active) usePwa.setState({ offline: 'pret' });
      else usePwa.setState((state) => (state.offline === 'inconnu' ? { offline: 'preparation' } : state));
      watchForUpdates(registration);
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

/** Applique la mise à jour sur un geste : la page se recharge dès que la nouvelle version a pris la main. */
export async function applyUpdate(): Promise<void> {
  reloadRequested = true;
  usePwa.setState({ updateReady: false });
  try {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration?.waiting && skipWaiting) {
      // La version en attente s'active, `controllerchange` recharge la page.
      window.setTimeout(() => window.location.reload(), RELOAD_FALLBACK_MS);
      await skipWaiting();
      return;
    }
  } catch {
    // Pas de service worker joignable : un simple rechargement fera l'affaire.
  }
  // Rien en attente (version déjà activée ailleurs) : il suffit de recharger.
  window.location.reload();
}

/** Ouvre la fenêtre d'installation du navigateur, si elle est disponible. */
export async function promptInstall(): Promise<void> {
  const event = installEvent;
  if (!event) return;
  installEvent = null;
  usePwa.setState({ canInstall: false });
  try {
    await event.prompt();
    await event.userChoice;
  } catch {
    // Fenêtre déjà affichée ou refusée par le navigateur : rien à faire.
  }
}
