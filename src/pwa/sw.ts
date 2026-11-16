/// <reference lib="webworker" />
// Service worker de PimpMyBichon.
// Rôle au jalon 0 : mettre toute la coque de l'app en cache dès la première visite, pour qu'elle
// s'ouvre ensuite sans réseau, et dire à la page où en est ce précache. Depuis le 15 novembre 2026,
// garder aussi la musique d'accueil de la radio, morceau par morceau, à sa première écoute.

import { clientsClaim } from 'workbox-core';
import {
  addPlugins,
  cleanupOutdatedCaches,
  createHandlerBoundToURL,
  precacheAndRoute,
} from 'workbox-precaching';
import { CacheableResponsePlugin } from 'workbox-cacheable-response';
import { ExpirationPlugin } from 'workbox-expiration';
import { RangeRequestsPlugin } from 'workbox-range-requests';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst } from 'workbox-strategies';
import { PRECACHE_PROGRESS, SKIP_WAITING, type PrecacheProgressMessage } from './messages.ts';

declare const self: ServiceWorkerGlobalScope & {
  __WB_MANIFEST: Array<string | { url: string; revision: string | null }>;
};

const manifest = self.__WB_MANIFEST;
// On compte les fichiers, pas les lignes : une adresse listée deux fois ne s'installe qu'une fois.
const total = new Set(manifest.map((entry) => (typeof entry === 'string' ? entry : entry.url))).size;
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

// Musique d'accueil de la radio (assets/audio/radio/<station>/, ≈ 3,5 Mo par morceau) : jamais dans
// le précache (globIgnores de vite.config.ts), gardée à la première écoute, un morceau à la fois.
// L'élément audio demande des tranches (Range) : le morceau est demandé une fois en entier (réponse
// 200, mise en cache), puis les tranches sont découpées dans la copie du cache. Hors ligne, un morceau
// déjà entendu rejoue ; un morceau jamais entendu échoue, et la radio passe au suivant.
const WELCOME_CACHE = 'pmb-radio-accueil';
registerRoute(
  ({ url, request }) => url.origin === self.location.origin && request.destination === 'audio' && url.pathname.includes('/assets/audio/radio/'),
  new CacheFirst({
    cacheName: WELCOME_CACHE,
    matchOptions: { ignoreVary: true },
    plugins: [
      // Sans l'en-tête Range : le morceau entier, seule réponse que l'on peut garder.
      { requestWillFetch: async ({ request }) => new Request(request.url, { credentials: 'same-origin' }) },
      new CacheableResponsePlugin({ statuses: [200] }),
      new RangeRequestsPlugin(),
      // Quelques stations au plus : un plafond large, pour qu'un ancien morceau retiré finisse par partir.
      new ExpirationPlugin({ maxEntries: 24 }),
    ],
  }),
);

// Cartes de sortie (assets/maps/<id>/, hors du précache) : mises en cache à la demande, au fil de
// la route, pour qu'une carte déjà roulée se recharge en mode avion. Les tronçons et le relief
// (GLB) se servent du cache d'abord ; les fichiers JSON (manifeste, route) du réseau d'abord, le
// cache en secours. Si la route a changé (carte refaite dans un nouveau déploiement), les fichiers
// déjà gardés de cette carte sont oubliés : jamais une route neuve sur des tronçons anciens. Ce cache
// survit aux mises à jour de l'app (cleanupOutdatedCaches ne touche que le précache).
const MAP_CACHE = 'pmb-cartes-v1';
const MAPS_PATH = new URL('assets/maps/', self.registration.scope).pathname;

function isMapFile(url: URL, request: Request): boolean {
  return request.method === 'GET' && url.origin === self.location.origin && url.pathname.startsWith(MAPS_PATH);
}

/** Oublie les fichiers gardés d'une carte (dossier `dir`), sauf ses fichiers JSON. */
async function forgetMapFiles(cache: Cache, dir: string): Promise<void> {
  for (const key of await cache.keys()) {
    const path = new URL(key.url).pathname;
    if (path.startsWith(dir) && !path.endsWith('.json')) await cache.delete(key);
  }
}

/** Réponse entière, de notre origine, bonne à garder (jamais une réponse partielle ou opaque). */
function keepable(response: Response): boolean {
  return response.ok && response.status === 200 && response.type === 'basic';
}

async function mapFile(request: Request, url: URL): Promise<Response> {
  const cache = await caches.open(MAP_CACHE);
  if (!url.pathname.endsWith('.json')) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    const response = await fetch(request);
    if (keepable(response)) await cache.put(request, response.clone());
    return response;
  }
  try {
    const response = await fetch(request);
    if (keepable(response)) {
      const previous = await cache.match(request, { ignoreSearch: true });
      if (previous && url.pathname.endsWith('/route.json')) {
        const [before, now] = await Promise.all([previous.text(), response.clone().text()]);
        if (before !== now) await forgetMapFiles(cache, url.pathname.slice(0, url.pathname.lastIndexOf('/') + 1));
      }
      await cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const hit = await cache.match(request, { ignoreSearch: true });
    if (hit) return hit;
    throw error;
  }
}

registerRoute(
  ({ url, request }) => isMapFile(url, request),
  ({ url, request }) => mapFile(request, url),
);

// Sons des moteurs et bruitages (assets/audio/engines/<famille>/, assets/audio/sfx/<famille>/, hors
// du précache) : demandés au premier démarrage du moteur, gardés pour rejouer hors ligne. Le
// manifeste du réseau d'abord (un nouveau choix de prises arrive au déploiement suivant), le cache
// en secours ; les sons du cache d'abord : leur adresse porte l'empreinte du fichier (?v=…), un son
// refait a donc une autre adresse.
const SOUNDS_CACHE = 'pmb-sons-v1';
const SOUNDS_PATHS = ['assets/audio/engines/', 'assets/audio/sfx/'].map((dir) => new URL(dir, self.registration.scope).pathname);

function isSoundFile(url: URL, request: Request): boolean {
  return request.method === 'GET' && url.origin === self.location.origin && SOUNDS_PATHS.some((path) => url.pathname.startsWith(path));
}

registerRoute(
  ({ url, request }) => isSoundFile(url, request) && url.pathname.endsWith('.json'),
  new NetworkFirst({ cacheName: SOUNDS_CACHE, plugins: [new CacheableResponsePlugin({ statuses: [200] })] }),
);
registerRoute(
  ({ url, request }) => isSoundFile(url, request) && !url.pathname.endsWith('.json'),
  new CacheFirst({
    cacheName: SOUNDS_CACHE,
    plugins: [
      new CacheableResponsePlugin({ statuses: [200] }),
      // Cinq moteurs d'une douzaine de sons, et leurs versions passées qui finissent par partir.
      new ExpirationPlugin({ maxEntries: 120 }),
    ],
  }),
);

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
