// Routage par hash uniquement (§ 7) : GitHub Pages ne sert que des fichiers statiques.
// Ce module est pur (aucun accès au DOM) pour rester testable ; le branchement sur
// l'historique du navigateur vit dans useRoute.ts.

export type Route =
  | { name: 'garage' }
  | { name: 'reglages' }
  | { name: 'capot' }
  | { name: 'commande' }
  /** Lien de build reçu : `#b=<code>` (§ 5.7). */
  | { name: 'build'; code: string }
  /** Lien de défi reçu : `#d=<code>` (§ 5.7). */
  | { name: 'defi'; code: string }
  /** Lien de build ou de défi dont le code ne ressemble à rien de connu. */
  | { name: 'illisible'; kind: 'build' | 'defi' };

export type SheetRouteName = Exclude<Route['name'], 'garage'>;

/**
 * Forme attendue d'un code partagé : préfixe de version, puis base64url.
 * La longueur est bornée : un code est une donnée reçue de l'extérieur, jamais du HTML ni du code.
 */
export const SHARE_CODE = /^PMB2\.[A-Za-z0-9_-]{1,8000}$/;

const GARAGE: Route = { name: 'garage' };

// Une Map, pas un objet : un hash comme « #__proto__ » ne doit rien trouver.
const PAGES = new Map<string, Route>([
  ['/', GARAGE],
  ['/reglages', { name: 'reglages' }],
  ['/capot', { name: 'capot' }],
  ['/commande', { name: 'commande' }],
]);

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function readCode(raw: string): string | null {
  // Les messageries encodent parfois le lien ou lui collent des espaces et de la ponctuation.
  const code = safeDecode(raw).trim().replace(/[\s.,;:!?)\]}>"'»]+$/u, '');
  return SHARE_CODE.test(code) ? code : null;
}

/** Décodage tolérant : tout ce qui n'est pas reconnu retombe sur le garage. */
export function parseHash(hash: string): Route {
  const value = hash.startsWith('#') ? hash.slice(1) : hash;

  if (value.startsWith('b=') || value.startsWith('d=')) {
    const kind = value.startsWith('b=') ? 'build' : 'defi';
    const code = readCode(value.slice(2));
    if (code === null) return { name: 'illisible', kind };
    return { name: kind, code };
  }

  // Un hash du type « /page?x=1 » ou « /page/ » reste lisible.
  const path = (value.split('?')[0] ?? '').replace(/\/+$/, '');
  return PAGES.get(path === '' ? '/' : path) ?? GARAGE;
}

/** Hash canonique d'une route (chaîne vide pour le garage). */
export function routeToHash(route: Route): string {
  switch (route.name) {
    case 'garage':
      return '';
    case 'build':
      return `#b=${route.code}`;
    case 'defi':
      return `#d=${route.code}`;
    case 'illisible':
      return '';
    default:
      return `#/${route.name}`;
  }
}

export function isSheetRoute(route: Route): route is Exclude<Route, { name: 'garage' }> {
  return route.name !== 'garage';
}
