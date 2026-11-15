// Lien vers l'app qui porte l'adresse d'un pack : « ?pack=<adresse> » ou « #pack=<adresse> »,
// adresse brute ou encodée. Module pur : aucun accès au DOM, testable tel quel.
// Seule requête externe permise par l'app : le téléchargement de cette adresse, sur un geste.
// Un lien reçu part sans appui : il ne peut donc viser ni le téléphone lui-même ni le réseau local
// (box, NAS, imprimante…). Le champ d'adresse du panneau, lui, les accepte : c'est un geste voulu.

export type PackUrlCheck =
  | { ok: true; url: string; host: string }
  | { ok: false; reason: 'illisible' | 'protocole' | 'local' };

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

function privateIpv4(host: string): boolean {
  const parts = host.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = parts as [number, number, number, number];
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
}

/**
 * Hôte local ou privé : la machine elle-même, une adresse IP privée (v4 ou v6), un nom du réseau
 * local (.local, .lan, .home.arpa, .internal) ou un nom sans point (machine de l'intranet).
 */
export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, '');
  if (host.startsWith('[')) {
    const ip = host.slice(1, -1);
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(ip);
    if (mapped) return privateIpv4(mapped[1]!);
    if (/^::ffff:[0-9a-f]{1,4}:[0-9a-f]{1,4}$/.test(ip)) {
      // Forme normalisée par l'analyseur d'adresses : ::ffff:7f00:1 pour 127.0.0.1.
      const [hi, lo] = ip.slice(7).split(':').map((part) => parseInt(part, 16)) as [number, number];
      return privateIpv4(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip);
  }
  if (privateIpv4(host)) return true;
  if (!host.includes('.')) return true;
  return /(^|\.)(localhost|local|lan|internal|home\.arpa)$/.test(host);
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

/** Lien de pack reçu, ou `null` si l'adresse de l'app n'en porte pas. Hôte local ou privé : refusé. */
export function readPackLink(search: string, hash: string): PackUrlCheck | null {
  const raw = rawFromSearch(search) ?? rawFromHash(hash);
  if (raw === null) return null;
  const check = checkPackUrl(raw);
  if (check.ok && isPrivateHost(new URL(check.url).hostname)) return { ok: false, reason: 'local' };
  return check;
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
