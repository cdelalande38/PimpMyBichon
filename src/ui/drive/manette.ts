// Mode manette de la sortie de nuit (§ 5.5) : plein écran, puis écran verrouillé en paysage, là où le
// navigateur le permet (PWA installée, Chrome sur Android). On en sort de la même façon (verrou levé,
// plein écran quitté), et toujours en rentrant au garage. Là où le verrou n'existe pas, l'entrée n'est
// pas proposée ; la disposition paysage de l'écran s'applique d'elle-même dès que l'écran est en
// paysage (src/ui/drive/drive.css). L'orientation « portrait » du manifeste ne change pas.

import { useSyncExternalStore } from 'react';

type Verrou = ScreenOrientation & { lock?: (orientation: string) => Promise<void>; unlock?: () => void };

function orientation(): Verrou | null {
  return typeof screen !== 'undefined' && screen.orientation ? (screen.orientation as Verrou) : null;
}

/** Le navigateur sait passer en plein écran et verrouiller l'orientation, sur un écran tactile. */
export function manettePossible(): boolean {
  if (typeof document === 'undefined' || typeof window === 'undefined') return false;
  const o = orientation();
  return (
    typeof o?.lock === 'function' &&
    typeof document.documentElement.requestFullscreen === 'function' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

let actif = false;
const abonnes = new Set<() => void>();
const prevenir = () => abonnes.forEach((fn) => fn());

function surPleinEcran(): void {
  // Plein écran quitté d'un geste du téléphone (retour) : le mode manette s'arrête avec lui.
  if (actif && !document.fullscreenElement) {
    actif = false;
    orientation()?.unlock?.();
  }
  prevenir();
}

/** Le mode manette est-il en cours ? Suit le plein écran. */
export function useManette(): boolean {
  return useSyncExternalStore(
    (fn) => {
      abonnes.add(fn);
      if (abonnes.size === 1) document.addEventListener('fullscreenchange', surPleinEcran);
      return () => {
        abonnes.delete(fn);
        if (abonnes.size === 0) document.removeEventListener('fullscreenchange', surPleinEcran);
      };
    },
    () => actif,
    () => false,
  );
}

/** Plein écran puis paysage verrouillé ; faux (et tout défait) si le navigateur refuse. */
export async function entrerManette(): Promise<boolean> {
  try {
    if (!document.fullscreenElement) await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    const o = orientation();
    if (typeof o?.lock !== 'function') throw new Error('verrou absent');
    await o.lock('landscape');
    actif = true;
    prevenir();
    return true;
  } catch {
    await quitterManette(true);
    return false;
  }
}

/** Verrou levé, plein écran quitté (s'il était à nous, ou `force`). */
export async function quitterManette(force = false): Promise<void> {
  if (!actif && !force) return;
  actif = false;
  try {
    orientation()?.unlock?.();
  } catch {
    // Rien à lever.
  }
  try {
    if (document.fullscreenElement) await document.exitFullscreen();
  } catch {
    // Déjà sorti.
  }
  prevenir();
}
