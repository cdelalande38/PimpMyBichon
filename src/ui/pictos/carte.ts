// Miniatures du tracé des cartes de sortie (public/assets/maps/<id>/apercu.json), écrites par
// npm run maps:build (tools/maps/apercu.mjs) et lues ici à la construction : rien ne se télécharge
// pour les dessiner. Une carte sans miniature (pas encore fabriquée) garde son nom seul.

export interface Apercu {
  /** Côté du carré du dessin. */
  taille: number;
  /** Chemin SVG du tracé, nord en haut. */
  d: string;
  depart: [number, number];
  /** Bout du parcours ; null pour une boucle. */
  arrivee: [number, number] | null;
}

const CHEMIN = /^[MLZ0-9 .-]+$/;

const point = (v: unknown): v is [number, number] => Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Miniature lue dans apercu.json, ou null si elle n'a pas la forme attendue. */
export function lireApercu(raw: unknown): Apercu | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const a = raw as Record<string, unknown>;
  if (a.format !== 'pmb-apercu' || typeof a.taille !== 'number' || !(a.taille > 0)) return null;
  if (typeof a.d !== 'string' || a.d.length > 4000 || !CHEMIN.test(a.d) || !point(a.depart)) return null;
  if (a.arrivee !== null && !point(a.arrivee)) return null;
  return { taille: a.taille, d: a.d, depart: a.depart, arrivee: a.arrivee };
}

const FOUND = import.meta.glob<unknown>('../../../public/assets/maps/*/apercu.json', { eager: true, import: 'default' });

/** Miniatures, par identifiant de carte (le nom de son dossier). */
const APERCUS: ReadonlyMap<string, Apercu> = new Map(
  Object.entries(FOUND).flatMap(([path, raw]) => {
    const apercu = lireApercu(raw);
    const parts = path.split('/');
    const id = parts[parts.length - 2];
    return apercu && id ? [[id, apercu] as const] : [];
  }),
);

export function apercuDe(id: string): Apercu | undefined {
  return APERCUS.get(id);
}
