/// <reference lib="webworker" />
// Service worker de PimpMyBichon.
// Rôle au jalon 0 : mettre toute la coque de l'app en cache dès la première visite, pour qu'elle
// s'ouvre ensuite sans réseau, et dire à la page où en est ce précache.

import { clientsClaim } from 'workbox-core';
import {
  addPlugins,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { PRECACHE_PROGRESS, SKIP_WAITING, type PrecacheProgressMessage } from './messages.ts';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

const manifest = self.__WB_MANIFEST;
const total = manifest.length;
let done = 0;

async function tellPages(message: PrecacheProgressMessage): Promise<void> {
  // includeUncontrolled : à la toute première visite, la page n'est pas encore sous contrôle.
  const pages = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  for (const page of pages) page.postMessage(message);
}

addPlugins([
  {
    // Appelé une fois par fichier pendant l'installation, qu'il vienne du réseau
    // ou qu'il soit déjà en cache (mise à jour : seuls les fichiers changés sont retéléchargés).
    handlerDidComplete: async ({ event, error }) => {
      if (event.type !== 'install' || error) return;
      done += 1;
      await tellPages({ type: PRECACHE_PROGRESS, done, total });
    },
  },
]);

cleanupOutdatedCaches();
precacheAndRoute(manifest);

// Une seule page : toute navigation dans le périmètre de l'app retombe sur index.html,
// y compris les liens partagés auxquels une messagerie a collé des paramètres.
registerRoute(new NavigationRoute(createHandlerBoundToURL('index.html')));

// Mise à jour : la nouvelle version attend que la page le demande (geste de l'utilisateur)
// ou que l'app soit fermée puis rouverte. Jamais de rechargement surprise.
self.addEventListener('message', (event) => {
  const data: unknown = event.data;
  if (typeof data === 'object' && data !== null && (data as { type?: unknown }).type === SKIP_WAITING) {
    void self.skipWaiting();
  }
});

// Première installation : prendre la page en charge tout de suite, sans attendre un rechargement.
clientsClaim();
