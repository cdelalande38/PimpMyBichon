// Affiche d'atelier inventée : « GRANDE SOIRÉE VIDANGE », clés croisées et piston sur un soleil rouge.

import { PALETTE as P, PENTE, svg, texte } from '../traces.mjs';
import { etoile, piston, rayons } from '../motifs.mjs';

const T = P.nuit;

/**
 * Clé mixte (fourche en haut, œil en bas), 76 × 342, de y = -38 à y = 304. Sens horaire partout,
 * l'œil en sens inverse : la règle « nonzero » le laisse vide.
 */
export const CLE =
  'M14 -35.3A38 38 0 1 1 -14 -35.3L-14 4L14 4Z' +
  'M-14 20H14V250H-14Z' +
  'M0 236A34 34 0 1 1 0 304A34 34 0 1 1 0 236Z' +
  'M0 254A16 16 0 1 0 0 286A16 16 0 1 0 0 254Z';

/** Une clé détourée de nuit, centrée, tournée de `angle` degrés. */
function cle(x, y, angle, echelle, ep = 9) {
  return [
    `<g transform="translate(${x} ${y}) rotate(${angle}) scale(${echelle}) translate(0 -133)">`,
    `<path d="${CLE}" fill="${T}" stroke="${T}" stroke-width="${ep * 2}" stroke-linejoin="round"/>`,
    `<path d="${CLE}" fill="${P.chrome}"/>`,
    `<path d="M6 34V232" stroke="#b3aecb" stroke-width="9" stroke-linecap="round"/>`,
    '</g>',
  ].join('');
}

const trait = (d, couleur, ep, plus = '') =>
  `<path d="${d}" fill="none" stroke="${couleur}" stroke-width="${ep}" stroke-linecap="round" stroke-linejoin="round"${plus}/>`;
const astre = (x, y, r, couleur) => `<path d="${etoile(r)}" fill="${couleur}" transform="translate(${x} ${y})"/>`;

function afficheAtelier() {
  const L = 640;
  const H = 960;
  const cx = L / 2;
  const sy = 548; // centre du soleil
  const R = 200;

  const grande = texte('GRANDE SOIRÉE', { x: cx, y: 118, h: 42, esp: 30, ancre: 'milieu' });
  const vidange = texte('VIDANGE', { x: cx, y: 270, h: 100, esp: 22, pencher: PENTE, ancre: 'milieu' });

  // Ligne « HUILE ★ CHROME ★ ROCK » : trois mots posés à la main pour glisser une étoile entre eux.
  const mots = ['HUILE', 'CHROME', 'ROCK'];
  const hm = 34;
  const ecart = 64;
  const larg = mots.map((m) => texte(m, { h: hm, esp: 30 }).largeur);
  let xm = cx - (larg.reduce((a, b) => a + b, 0) + ecart * 2) / 2;
  const ligne = [];
  const etoiles = [];
  mots.forEach((m, i) => {
    ligne.push(texte(m, { x: xm, y: 824, h: hm, esp: 30 }).d);
    xm += larg[i];
    if (i < mots.length - 1) etoiles.push(astre(xm + ecart / 2, 824 - hm / 2, 12, P.ambre));
    xm += ecart;
  });

  const finit = texte('ON FINIT TARD', { x: cx, y: 909, h: 36, esp: 30, ancre: 'milieu' });

  const corps = [
    '<defs>',
    `<clipPath id="soleil"><circle cx="${cx}" cy="${sy}" r="${R}"/></clipPath>`,
    '</defs>',
    `<rect width="${L}" height="${H}" fill="${T}"/>`,
    `<rect x="14" y="14" width="${L - 28}" height="${H - 28}" rx="18" fill="none" stroke="${P.chrome}" stroke-width="6"/>`,
    `<rect x="29" y="29" width="${L - 58}" height="${H - 58}" rx="10" fill="none" stroke="${P.rouge}" stroke-width="3"/>`,
    // En-tête
    trait(grande.d, P.chrome, 7),
    astre(70, 97, 13, P.turquoise),
    astre(L - 70, 97, 13, P.turquoise),
    trait(vidange.d, P.rouge, 18, ' transform="translate(6 7)"'),
    trait(vidange.d, P.ambre, 18),
    // Soleil rouge et ses rayons
    `<circle cx="${cx}" cy="${sy}" r="${R}" fill="${P.rouge}"/>`,
    `<g clip-path="url(#soleil)"><path d="${rayons(cx, sy, 24, R + 20, -90)}" fill="#c81e2f"/></g>`,
    `<circle cx="${cx}" cy="${sy}" r="${R + 6}" fill="none" stroke="${P.ambre}" stroke-width="10"/>`,
    // Clés croisées, piston devant
    cle(cx, sy + 6, -42, 1.12),
    cle(cx, sy + 6, 42, 1.12),
    `<g transform="translate(${cx + 12} ${sy + 22}) scale(0.92)">${piston({ id: 'affiche-piston-ombre', clair: T, ombre: T, trait: T, fond: T, ep: 8 })}</g>`,
    `<g transform="translate(${cx} ${sy + 10}) scale(0.92)">${piston({ id: 'affiche-piston', clair: P.chrome, ombre: P.bleu, trait: T, fond: P.rouge, ep: 8 })}</g>`,
    // Pied d'affiche
    trait(ligne.join(''), P.chrome, 6.5),
    ...etoiles,
    `<path d="M31 852H${L - 31}V922Q${L - 31} 929 ${L - 38} 929H38Q31 929 31 922Z" fill="${P.rouge}"/>`,
    trait(finit.d, P.chrome, 7),
  ].join('\n');

  return svg({
    largeur: L,
    hauteur: H,
    titre: "affiche d'atelier",
    notes: [
      'Affiche inventée, format 2:3 : GRANDE SOIRÉE VIDANGE, clés croisées et piston sur un soleil rouge,',
      'pied HUILE, CHROME, ROCK et bandeau ON FINIT TARD. Palette de l’app seulement.',
    ],
    corps,
  });
}

export default [{ fichier: 'affiche-atelier.svg', ordre: 8, dessin: afficheAtelier }];
