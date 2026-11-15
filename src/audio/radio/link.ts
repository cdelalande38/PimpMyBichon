// Lien vers l'app qui porte l'adresse d'un pack : « ?pack=<adresse> » ou « #pack=<adresse> »,
// adresse brute ou encodée. Module pur : aucun accès au DOM, testable tel quel.
// Seule requête externe permise par l'app : le téléchargement de cette adresse, sur un geste.

export type PackUrlCheck =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: 'illisible' | 'protocole' };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Vérifie une adresse saisie, collée ou reçue : https seulement (http admis pour la machine locale). */
export function checkPackUrl(raw: string): PackUrlCheck {
  let value = raw.trim().replace(/[\s.,;:!?)\]}>"'»]+$/u, '');
  // Une adresse encodée (une ou deux fois) se reconnaît à son « %3A » (ou « %253A ») après le protocole.
  for (let i = 0; i < 3 && /^https?%(3A|25)/i.test(value); i += 1) value = safeDecode(value);
  if (!value) return { ok: false, reason: 'illisible' };
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, reason: 'illisible' };
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    return { ok: false, reason: 'protocole' };
  }
  if (!url.hostname) return { ok: false, reason: 'illisible' };
  url.hash = '';
  return { ok: true, url: url.href, host: url.host };
}

const SEARCH_KEY = /(?:^\?|&)pack=/;

/** Valeur brute du paramètre pack : tout ce qui suit « pack= » (une adresse brute garde ses « & »). */
function rawFromSearch(search: string): string | null {
  const match = SEARCH_KEY.exec(search);
  if (!match) return null;
  return search.slice(match.index + match[0].length);
}

function rawFromHash(hash: string): string | null {
  const value = hash.startsWith('#') ? hash.slice(1) : hash;
  return value.startsWith('pack=') ? value.slice(5) : null;
}

/** Lien de pack reçu, ou `null` si l'adresse de l'app n'en porte pas. */
export function readPackLink(search: string, hash: string): PackUrlCheck | null {
  const raw = rawFromSearch(search) ?? rawFromHash(hash);
  if (raw === null) return null;
  return checkPackUrl(raw);
}

/** Adresse de l'app sans le lien de pack, pour qu'un rechargement ne relance rien. */
export function stripPackLink(pathname: string, search: string, hash: string): string {
  let cleanSearch = search;
  const match = SEARCH_KEY.exec(search);
  if (match) {
    cleanSearch = search.slice(0, match.index);
    if (cleanSearch === '?') cleanSearch = '';
  }
  const cleanHash = rawFromHash(hash) !== null || match ? (hash.startsWith('#/') ? hash : '') : hash;
  return pathname + cleanSearch + cleanHash;
}
