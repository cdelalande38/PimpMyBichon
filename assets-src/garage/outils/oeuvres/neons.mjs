// Les deux enseignes néon. Chaque `<path>` est l'axe d'un tube : pas de remplissage, épaisseur
// constante, bouts ronds, aucune transformation à appliquer, aucun flou. La lueur est l'affaire de l'app.

import { M, PALETTE as P, PENTE, chemin, svg, texte } from '../traces.mjs';
import { ECLAIR } from '../motifs.mjs';

/** Diamètre du tube, en unités du viewBox (le même pour les deux enseignes). */
export const TUBE = 16;

const racine = ` fill="none" stroke-width="${TUBE}" stroke-linecap="round" stroke-linejoin="round" data-tube="${TUBE}"`;
const tubes = (id, couleur, chemins) =>
  `<g id="${id}" stroke="${couleur}">\n${chemins.map((d) => `<path d="${d}"/>`).join('\n')}\n</g>`;

function neonPimpMyBichon() {
  const L = 1024;
  const H = 500;
  const k = Math.tan((PENTE * Math.PI) / 180);
  const y1 = 170;
  const y2 = 398;
  const bas = texte('BICHON', { x: L / 2, y: y2, h: 184, esp: 27, pencher: PENTE, ancre: 'milieu' });
  // La première ligne part du même bord incliné que la seconde.
  const haut = texte('PIMP MY', { x: bas.x0 + k * (y2 - y1), y: y1, h: 120, esp: 26, mot: 30, pencher: PENTE });
  // L'éclair occupe la place libre à droite de la première ligne.
  const droite = bas.x1 - k * (184 - (y2 - y1));
  const ex = (haut.x1 + droite) / 2 + 6;
  const eclair = chemin(ECLAIR, M.x(M.t(ex, y1 - 62), M.k(-PENTE), M.s(0.74)));
  const ys = 454;
  const trait = `M${(bas.x0 - k * (ys - y2)).toFixed(1)},${ys}L${(bas.x0 + bas.largeur - k * (ys - y2)).toFixed(1)},${ys}`;
  return svg({
    largeur: L,
    hauteur: H,
    titre: "enseigne néon « PIMP MY BICHON »",
    notes: [
      `Deux lignes en tubes de ${TUBE} unités, inclinaison de la maison (${PENTE} degrés) cuite dans les tracés.`,
      'Groupes : ligne-1 (bleu), ligne-2 (rouge), eclair et soulignement (ambre). Fond transparent, sans lueur.',
    ],
    attributs: racine,
    corps: [
      tubes('ligne-1', P.bleu, haut.lettres.map((l) => l.d)),
      tubes('eclair', P.ambre, [eclair]),
      tubes('ligne-2', P.rouge, bas.lettres.map((l) => l.d)),
      tubes('soulignement', P.ambre, [trait]),
    ].join('\n'),
  });
}

function neonGoodVibesOnly() {
  const L = 1024;
  const H = 700;
  const cx = L / 2;
  const good = texte('GOOD', { x: cx, y: 186, h: 140, esp: 28, ancre: 'milieu' });
  const vibes = texte('VIBES', { x: cx, y: 446, h: 204, esp: 28, ancre: 'milieu' });
  const only = texte('ONLY', { x: cx, y: 652, h: 140, esp: 28, ancre: 'milieu' });
  // Deux ondes de chaque côté du mot central.
  const cy = 446 - 102;
  const onde = (r, cote) => {
    const ox = cote < 0 ? vibes.x0 - 4 : vibes.x1 + 4;
    const a = (36 * Math.PI) / 180;
    const x = ox + cote * r * Math.cos(a);
    return chemin(`M${x} ${cy - r * Math.sin(a)}A${r} ${r} 0 0 ${cote < 0 ? 0 : 1} ${x} ${cy + r * Math.sin(a)}`);
  };
  return svg({
    largeur: L,
    hauteur: H,
    titre: "enseigne néon « GOOD VIBES ONLY »",
    notes: [
      `Trois lignes en tubes de ${TUBE} unités, droites, centrées.`,
      'Groupes : ligne-1 et ligne-3 (turquoise), ligne-2 et ondes (ambre). Fond transparent, sans lueur.',
    ],
    attributs: racine,
    corps: [
      tubes('ligne-1', P.turquoise, good.lettres.map((l) => l.d)),
      tubes('ligne-2', P.ambre, vibes.lettres.map((l) => l.d)),
      tubes('ondes', P.ambre, [onde(64, -1), onde(108, -1), onde(64, 1), onde(108, 1)]),
      tubes('ligne-3', P.turquoise, only.lettres.map((l) => l.d)),
    ].join('\n'),
  });
}

export default [
  { fichier: 'neon-pimp-my-bichon.svg', ordre: 2, lueur: true, dessin: neonPimpMyBichon },
  { fichier: 'neon-good-vibes-only.svg', ordre: 3, lueur: true, dessin: neonGoodVibesOnly },
];
