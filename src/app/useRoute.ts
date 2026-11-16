import { useMemo, useSyncExternalStore } from 'react';
import { parseHash, routeToHash, type Route } from './router.ts';

// Marqueur posé dans l'état d'historique des entrées que l'app a empilées elle-même :
// fermer un panneau revient alors à faire « retour », comme le geste retour d'Android.
const PUSHED = 'pmbSheet';
/**
 * Sentinelle de la sortie de nuit (src/app/gardeSortie.ts) : une entrée d'historique posée par-dessus
 * celle de la sortie. Le geste retour la dépile (la page reste sur #/sortie) : c'est ce qui laisse le
 * temps de demander confirmation. `pmbSous` : l'entrée de dessous a été empilée par l'app (fermer
 * revient alors à reculer de deux pas) ; sinon c'est un lien direct, qu'on remplace par le garage.
 */
const GARDE = 'pmbGarde';
const SOUS = 'pmbSous';

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

/** L'état d'historique est celui d'une sentinelle de la sortie. */
export function estSentinelle(state: unknown): state is Record<string, unknown> {
  return typeof state === 'object' && state !== null && GARDE in state;
}

/** L'état d'historique d'une entrée empilée par l'app (panneau, mode photo, sortie). */
function estEmpilee(state: unknown): boolean {
  return typeof state === 'object' && state !== null && PUSHED in state;
}

/** État de la sentinelle à poser par-dessus l'entrée courante (`state` : son état actuel). */
export function etatSentinelle(state: unknown): Record<string, boolean> {
  return { [GARDE]: true, [SOUS]: estEmpilee(state) };
}

/** Un retour d'historique lancé par l'app est en cours : les gardes d'historique se taisent. */
export function fermetureEnCours(): boolean {
  return closing;
}

let interception: (() => boolean) | null = null;

/**
 * Un écran peut intercepter la fermeture demandée par un bouton (la sortie de nuit demande d'abord
 * confirmation) : la fonction rend vrai quand elle s'en charge. `closeSheetNow()` passe outre.
 */
export function intercepterFermeture(fn: (() => boolean) | null): void {
  interception = fn;
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

/**
 * Passe d'un panneau à un autre sans empiler d'entrée (rubriques d'un même panneau) : l'entrée
 * courante est remplacée, son marqueur gardé, et « Retour » ferme toujours en un seul pas.
 */
export function switchSheet(route: Exclude<Route, { name: 'garage' }>): void {
  if (closing) return;
  const target = routeToHash(route);
  if (target === window.location.hash) return;
  window.history.replaceState(window.history.state, '', basePath() + target);
  window.dispatchEvent(new Event(ROUTE_EVENT));
}

/** Revient au garage (panneau ou mode photo), sans laisser l'entrée derrière soi dans l'historique. */
export function closeSheet(): void {
  fermer(false);
}

/** Comme `closeSheet`, sans l'interception de la sortie de nuit (« Rentrer » l'a déjà confirmé). */
export function closeSheetNow(): void {
  fermer(true);
}

function fermer(force: boolean): void {
  // Double appui ou double clic : le premier suffit. Un second retour d'historique
  // reculerait d'une entrée de trop et ferait sortir de l'app.
  if (closing) return;
  if (parseHash(window.location.hash).name === 'garage') return;
  if (!force && interception?.()) return;
  markClosed();

  const state: unknown = window.history.state;
  if (estSentinelle(state)) {
    // Sortie de nuit gardée : on dépile la sentinelle avec l'entrée de la sortie, sans rien laisser derrière.
    closing = true;
    const settle = () => {
      closing = false;
    };
    window.setTimeout(settle, 1000);
    if (state[SOUS] === true) {
      window.addEventListener('popstate', settle, { once: true });
      window.history.go(-2);
      return;
    }
    // Lien direct : on dépile la sentinelle, puis l'entrée de la sortie devient le garage.
    window.addEventListener(
      'popstate',
      () => {
        window.history.replaceState(null, '', basePath());
        window.dispatchEvent(new Event(ROUTE_EVENT));
        settle();
      },
      { once: true },
    );
    window.history.back();
    return;
  }
  if (estEmpilee(state)) {
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
