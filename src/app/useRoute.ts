import { useMemo, useSyncExternalStore } from 'react';
import { parseHash, routeToHash, type Route } from './router.ts';

// Marqueur posé dans l'état d'historique des entrées que l'app a empilées elle-même :
// fermer un panneau revient alors à faire « retour », comme le geste retour d'Android.
const PUSHED = 'pmbSheet';

const ROUTE_EVENT = 'pmb:route';
const SETTLE_EVENT = 'pmb:settle';
/** Durée pendant laquelle le dock ignore les appuis après la fermeture d'un panneau. */
const GHOST_TAP_MS = 350;

/** Un retour d'historique est en route : une seconde fermeture ne doit pas en lancer un autre. */
let closing = false;
/** Le panneau vient de se fermer : le second appui d'un double appui tomberait sur le dock. */
let settling = false;

function subscribe(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  window.addEventListener('popstate', onChange);
  window.addEventListener(ROUTE_EVENT, onChange);
  return () => {
    window.removeEventListener('hashchange', onChange);
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(ROUTE_EVENT, onChange);
  };
}

function readHash(): string {
  return window.location.hash;
}

/** Route courante, tenue à jour avec l'adresse. */
export function useRoute(): Route {
  const hash = useSyncExternalStore(subscribe, readHash);
  return useMemo(() => parseHash(hash), [hash]);
}

function subscribeSettling(onChange: () => void): () => void {
  window.addEventListener(SETTLE_EVENT, onChange);
  return () => window.removeEventListener(SETTLE_EVENT, onChange);
}

/** Vrai pendant un court instant après la fermeture d'un panneau : le dock ignore alors les appuis. */
export function useSettling(): boolean {
  return useSyncExternalStore(subscribeSettling, () => settling);
}

function markClosed(): void {
  settling = true;
  window.dispatchEvent(new Event(SETTLE_EVENT));
  window.setTimeout(() => {
    settling = false;
    window.dispatchEvent(new Event(SETTLE_EVENT));
  }, GHOST_TAP_MS);
}

function basePath(): string {
  return window.location.pathname + window.location.search;
}

/** Ouvre un panneau en empilant une entrée d'historique. */
export function openSheet(route: Exclude<Route, { name: 'garage' }>): void {
  if (closing) return;
  const target = routeToHash(route);
  if (target === window.location.hash) return;
  window.history.pushState({ [PUSHED]: true }, '', basePath() + target);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

/** Revient au garage, sans laisser le panneau derrière soi dans l'historique. */
export function closeSheet(): void {
  // Double appui ou double clic : le premier suffit. Un second retour d'historique
  // reculerait d'une entrée de trop et ferait sortir de l'app.
  if (closing) return;
  if (parseHash(window.location.hash).name === 'garage') return;
  markClosed();

  const state: unknown = window.history.state;
  if (typeof state === 'object' && state !== null && PUSHED in state) {
    closing = true;
    const settle = () => {
      closing = false;
    };
    window.addEventListener('popstate', settle, { once: true });
    // Filet : si le navigateur n'émet pas l'événement, on ne reste pas bloqué.
    window.setTimeout(settle, 1000);
    window.history.back();
    return;
  }
  // Panneau ouvert par un lien direct (build, défi, favori) : on remplace l'entrée.
  window.history.replaceState(null, '', basePath());
  window.dispatchEvent(new Event(ROUTE_EVENT));
}
