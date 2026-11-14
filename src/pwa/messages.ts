// Messages échangés entre le service worker et la page.
// Fichier partagé par les deux mondes : aucun accès au DOM ni au worker ici.

/** Progression du précache pendant l'installation du service worker. */
export interface PrecacheProgressMessage {
  type: 'pmb:precache';
  done: number;
  total: number;
}

export const PRECACHE_PROGRESS = 'pmb:precache' satisfies PrecacheProgressMessage['type'];

/** Demande standard de workbox-window pour activer tout de suite la version en attente. */
export const SKIP_WAITING = 'SKIP_WAITING';

export function isPrecacheProgress(data: unknown): data is PrecacheProgressMessage {
  if (typeof data !== 'object' || data === null) return false;
  const message = data as Partial<PrecacheProgressMessage>;
  return (
    message.type === PRECACHE_PROGRESS &&
    typeof message.done === 'number' &&
    typeof message.total === 'number' &&
    Number.isFinite(message.done) &&
    Number.isFinite(message.total) &&
    message.total > 0
  );
}
