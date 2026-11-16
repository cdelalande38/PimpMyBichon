// Miniature du tracé d'une carte, pour le choix de la carte dans le menu « Sortie de nuit » : l'axe
// du parcours (le rail de route.json) vu de dessus, nord en haut, ramené dans un carré de 24 unités
// et simplifié à quelques dizaines de points. npm run maps:build l'écrit à côté de route.json
// (public/assets/maps/<id>/apercu.json, moins d'un kilo-octet) ; l'app la lit à la construction
// (src/ui/pictos/carte.ts) : rien n'est téléchargé pour la dessiner.

import { simplifier } from './geom2d.mjs';

/** Côté du carré de la miniature, et marge laissée pour l'épaisseur du trait. */
export const APERCU_TAILLE = 24;
const MARGE = 2.5;

/** @param {number} v */
const r1 = (v) => Math.round(v * 10) / 10;

/**
 * Miniature d'une route fabriquée : chemin SVG (`d`) dans le carré 0–24, point de départ et
 * d'arrivée. X vers l'est, Z vers le sud (repère des cartes) : Z se lit tel quel vers le bas.
 * @param {{ rail: number[]; loop: boolean }} route
 */
export function apercu(route) {
  /** @type {number[][]} */
  const pts = [];
  for (let i = 0; i + 2 < route.rail.length; i += 3) pts.push([route.rail[i] ?? 0, route.rail[i + 2] ?? 0]);
  if (pts.length < 2) throw new Error('aperçu : il faut au moins deux points de rail');
  let [x0, z0, x1, z1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x = 0, z = 0] of pts) {
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    z0 = Math.min(z0, z);
    z1 = Math.max(z1, z);
  }
  const utile = APERCU_TAILLE - 2 * MARGE;
  const echelle = utile / Math.max(x1 - x0, z1 - z0, 1);
  // Tracé centré dans le carré.
  const dx = MARGE + (utile - (x1 - x0) * echelle) / 2;
  const dz = MARGE + (utile - (z1 - z0) * echelle) / 2;
  const plan = pts.map(([x = 0, z = 0]) => [dx + (x - x0) * echelle, dz + (z - z0) * echelle]);
  // Un dixième d'unité : bien sous l'épaisseur du trait à la taille d'une puce.
  const simple = simplifier(plan, 0.1);
  const d = simple.map(([x = 0, y = 0], i) => `${i === 0 ? 'M' : 'L'}${r1(x)} ${r1(y)}`).join('') + (route.loop ? 'Z' : '');
  const [depart = [0, 0], arrivee = [0, 0]] = [plan[0], plan[plan.length - 1]];
  return {
    format: 'pmb-apercu',
    version: 1,
    taille: APERCU_TAILLE,
    d,
    depart: [r1(depart[0] ?? 0), r1(depart[1] ?? 0)],
    arrivee: route.loop ? null : [r1(arrivee[0] ?? 0), r1(arrivee[1] ?? 0)],
  };
}
