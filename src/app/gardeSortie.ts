// Garde de la sortie de nuit : « retour » (geste d'Android, bouton du navigateur) et le bouton
// « Rentrer au garage » demandent d'abord confirmation tant que la route roule, pour éviter les retours
// involontaires (retour du 16 novembre 2026). La sortie se met en pause le temps de la question.
//
// Mécanique : à l'entrée sur #/sortie, une entrée « sentinelle » est posée par-dessus celle de la
// sortie. Le geste retour la dépile et la page reste sur #/sortie : on repose aussitôt la sentinelle
// et on ouvre le dialogue. Un second retour pendant le dialogue le ferme (on reste). On ne quitte que
// par « Rentrer », qui dépile la sentinelle avec l'entrée de la sortie (closeSheet, src/app/useRoute.ts),
// sans laisser d'entrée fantôme : un retour au garage ne rouvre pas la sortie. Pas de confirmation
// quand elle n'a pas de sens (chargement, erreur, bout du parcours) : le retour quitte tout de suite.

import { create } from 'zustand';
import { useDrive } from '../state/drive.ts';
import { parseHash } from './router.ts';
import { closeSheetNow, estSentinelle, etatSentinelle, fermetureEnCours, intercepterFermeture } from './useRoute.ts';

/** La question a un sens : la route est prête, pas en échec, pas arrivée au bout. */
export function confirmationUtile(): boolean {
  const { map, telemetry } = useDrive.getState();
  return map !== null && telemetry.ready && !telemetry.failed && !telemetry.finished;
}

interface QuitterState {
  /** Le dialogue « Rentrer au garage ? » est ouvert. */
  ouvert: boolean;
}

export const useQuitter = create<QuitterState>()(() => ({ ouvert: false }));

/** La pause vient de nous : on ne reprend que dans ce cas (la sortie pouvait déjà être en pause). */
let pauseParNous = false;

export function ouvrirDialogue(): void {
  if (useQuitter.getState().ouvert) return;
  const drive = useDrive.getState();
  pauseParNous = !drive.paused;
  if (pauseParNous) drive.setPaused(true);
  useQuitter.setState({ ouvert: true });
}

/** « Rester sur la route » : le dialogue se ferme, la sortie reprend si c'est nous qui l'avions arrêtée. */
export function resterSurLaRoute(): void {
  if (!useQuitter.getState().ouvert) return;
  useQuitter.setState({ ouvert: false });
  if (pauseParNous) useDrive.getState().setPaused(false);
  pauseParNous = false;
}

/** « Rentrer » : on quitte pour de bon (la sortie est vidée par l'adresse, src/app/App.tsx). */
export function rentrerAuGarage(): void {
  useQuitter.setState({ ouvert: false });
  pauseParNous = false;
  closeSheetNow();
}

function sortieOuverte(): boolean {
  return parseHash(window.location.hash).name === 'sortie';
}

function poserSentinelle(): void {
  window.history.pushState(etatSentinelle(window.history.state), '', window.location.pathname + window.location.search + window.location.hash);
}

function surRetour(): void {
  // Un retour lancé par l'app (« Rentrer ») ou une adresse qui n'est plus la sortie : rien à garder.
  if (fermetureEnCours() || !sortieOuverte()) return;
  // Avance du navigateur sur la sentinelle elle-même : elle est déjà en place.
  if (estSentinelle(window.history.state)) return;
  // La sentinelle vient d'être dépilée : on est de nouveau sur l'entrée de la sortie.
  if (!confirmationUtile()) {
    closeSheetNow();
    return;
  }
  poserSentinelle();
  if (useQuitter.getState().ouvert) resterSurLaRoute();
  else ouvrirDialogue();
}

/** Garde la sortie tant que l'écran est monté ; rend la fonction qui la lève. */
export function garderSortie(): () => void {
  if (!estSentinelle(window.history.state)) poserSentinelle();
  window.addEventListener('popstate', surRetour);
  intercepterFermeture(() => {
    if (!sortieOuverte() || !confirmationUtile()) return false;
    ouvrirDialogue();
    return true;
  });
  return () => {
    window.removeEventListener('popstate', surRetour);
    intercepterFermeture(null);
    useQuitter.setState({ ouvert: false });
    pauseParNous = false;
  };
}
