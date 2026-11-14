// La toile pop art au-dessus de l'écran : quatre cases, quatre motifs de l'atelier.

import { PALETTE as P, svg } from '../traces.mjs';
import { CRANE, ECLAIR, crane, eclat, flammes, piston, rayons, trame } from '../motifs.mjs';

/** Tons francs ajoutés à la palette de l'app, pour la toile seulement. */
export const FRANCS = Object.freeze({ jaune: '#ffd60a', rose: '#ff3d9a', orange: '#ff7a1a' });

function toilePopArt() {
  const L = 768;
  const H = 1024;
  const g = 14; // filet de nuit entre les cases
  const cw = (L - 3 * g) / 2;
  const ch = (H - 3 * g) / 2;
  const cx = cw / 2;
  const cy = ch / 2;
  const T = P.nuit;
  const F = FRANCS;
  const place = (col, lig, corps) =>
    `<g transform="translate(${g + col * (cw + g)} ${g + lig * (ch + g)})" clip-path="url(#case)">\n${corps}\n</g>`;
  const noir = { clair: T, ombre: T, trait: T, fond: T };

  const tete = [
    `<rect width="${cw}" height="${ch}" fill="${F.rose}"/>`,
    `<path d="M${cw} 0V${ch}H0Z" fill="url(#points-rouges)"/>`,
    `<path d="${CRANE}" fill="${T}" transform="translate(${cx + 14} ${cy + 16}) scale(1.22)"/>`,
    `<g transform="translate(${cx} ${cy}) scale(1.22)">${crane({ id: 'ombre-tete', clair: P.chrome, ombre: P.turquoise, trait: T, ep: 9, pupille: P.rouge })}</g>`,
  ].join('\n');

  const bielle = [
    `<rect width="${cw}" height="${ch}" fill="${F.jaune}"/>`,
    `<path d="${rayons(cx, cy, 18, 420, 10)}" fill="${F.orange}"/>`,
    `<g transform="translate(${cx + 13} ${cy + 26}) rotate(-18) scale(1.24)">${piston({ id: 'ombre-piston-a', ...noir, ep: 8 })}</g>`,
    `<g transform="translate(${cx} ${cy + 11}) rotate(-18) scale(1.24)">${piston({ id: 'ombre-piston-b', clair: P.chrome, ombre: P.bleu, trait: T, fond: F.jaune, ep: 8 })}</g>`,
  ].join('\n');

  const foudre = [
    `<rect width="${cw}" height="${ch}" fill="${P.bleu}"/>`,
    `<path d="M0 0H${cw}L0 ${ch}Z" fill="url(#points-turquoise)"/>`,
    `<g transform="translate(${cx} ${cy})">`,
    `<path d="${eclat(14, 170, 112, -90, 0.12)}" fill="${T}" transform="translate(13 15)"/>`,
    `<path d="${eclat(14, 170, 112, -90, 0.12)}" fill="${P.chrome}" stroke="${T}" stroke-width="9" stroke-linejoin="round"/>`,
    `<path d="${ECLAIR}" fill="${P.rouge}" stroke="${T}" stroke-width="4.6" stroke-linejoin="round" transform="translate(13 13) scale(1.95)"/>`,
    `<path d="${ECLAIR}" fill="${F.jaune}" stroke="${T}" stroke-width="4.6" stroke-linejoin="round" transform="scale(1.95)"/>`,
    '</g>',
  ].join('\n');

  const feu = [
    `<rect width="${cw}" height="${ch}" fill="${P.turquoise}"/>`,
    `<path d="M0 0V${ch}H${cw}Z" fill="url(#points-bleus)"/>`,
    `<g transform="translate(${cx} ${ch + 14})">${flammes({
      langues: [
        [-122, 50, -150, -230],
        [-42, 74, -6, -440],
        [56, 62, 104, -310],
        [128, 44, 160, -190],
      ],
      couleurs: [P.rouge, F.orange, F.jaune],
      trait: T,
      ep: 9,
    })}</g>`,
  ].join('\n');

  const corps = [
    '<defs>',
    `<clipPath id="case"><rect width="${cw}" height="${ch}"/></clipPath>`,
    trame('points-rouges', 20, 5.6, P.rouge),
    trame('points-turquoise', 20, 5.6, P.turquoise),
    trame('points-bleus', 20, 5.6, P.bleu),
    '</defs>',
    `<rect width="${L}" height="${H}" fill="${T}"/>`,
    place(0, 0, tete),
    place(1, 0, bielle),
    place(0, 1, foudre),
    place(1, 1, feu),
  ].join('\n');

  return svg({
    largeur: L,
    hauteur: H,
    titre: 'toile pop art',
    notes: [
      'Quatre cases : tête de mort, piston, éclair, flammes. Format portrait 3:4.',
      `Couleurs : palette de l'app, plus jaune ${F.jaune}, rose ${F.rose} et orange ${F.orange}.`,
    ],
    corps,
  });
}

export default [{ fichier: 'toile-pop-art.svg', ordre: 1, dessin: toilePopArt }];
