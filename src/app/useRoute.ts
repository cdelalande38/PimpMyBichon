import { useMemo, useSyncExternalStore } from 'react';
import { parseHash, routeToHash, type Route } from './router.ts';

// Marqueur posé dans l'état d'historique des entrées que l'app a empilées elle-même :
// fermer un panneau revient alors à faire « retour », comme le geste retour d'Android.
const PUSHED = 'pmbSheet';

const ROUTE_EVENT = 'pmb:route';

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

function basePath(): string {
  return window.location.pathname + window.location.search;
}

/** Ouvre un panneau en empilant une entrée d'historique. */
export function openSheet(route: Exclude<Route, { name: 'garage' }>): void {
  const target = routeToHash(route);
  if (target === window.location.hash) return;
  window.history.pushState({ [PUSHED]: true }, '', basePath() + target);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

/** Revient au garage, sans laisser le panneau derrière soi dans l'historique. */
export function closeSheet(): void {
  if (parseHash(window.location.hash).name === 'garage') return;
  const state: unknown = window.history.state;
  if (typeof state === 'object' && state !== null && PUSHED in state) {
    window.history.back();
    return;
  }
  // Panneau ouvert par un lien direct (build, défi, favori) : on remplace l'entrée.
  window.history.replaceState(null, '', basePath());
  window.dispatchEvent(new Event(ROUTE_EVENT));
}
