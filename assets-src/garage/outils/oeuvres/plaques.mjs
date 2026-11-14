// Trois plaques décoratives de fantaisie, empilées : chacune se découpe par son groupe ou son cadre.
// Aucun texte n'a la forme d'une immatriculation : ce sont des mots, écrits en tracés.

import { PALETTE as P, svg, texte } from '../traces.mjs';
import { ECLAIR, etoile } from '../motifs.mjs';

const T = P.nuit;
const X0 = 20;
const LARGEUR = 600;
const HAUTEUR = 300;
const PAS = 330;

const trait = (d, couleur, ep, plus = '') =>
  `<path d="${d}" fill="none" stroke="${couleur}" stroke-width="${ep}" stroke-linecap="round" stroke-linejoin="round"${plus}/>`;
/** Lettres embouties : un relief décalé sous le trait. */
const embouti = (d, couleur, relief, ep, dx = 3, dy = 4) => trait(d, relief, ep, ` transform="translate(${dx} ${dy})"`) + trait(d, couleur, ep);
const astre = (x, y, r, couleur) => `<path d="${etoile(r)}" fill="${couleur}" transform="translate(${x} ${y})"/>`;

/** Tôle, jonc embouti et deux trous de fixation. */
function tole(y, fond, jonc, relief) {
  const trous = [X0 + 46, X0 + LARGEUR - 46]
    .map((x) => `<circle cx="${x}" cy="${y + 52}" r="11" fill="${relief}"/><circle cx="${x}" cy="${y + 52}" r="7.5" fill="${T}"/>`)
    .join('');
  return [
    `<rect x="${X0}" y="${y}" width="${LARGEUR}" height="${HAUTEUR}" rx="28" fill="${fond}"/>`,
    `<rect x="${X0 + 2}" y="${y + 2}" width="${LARGEUR - 4}" height="${HAUTEUR - 4}" rx="26" fill="none" stroke="${relief}" stroke-width="4"/>`,
    `<rect x="${X0 + 17}" y="${y + 19}" width="${LARGEUR - 30}" height="${HAUTEUR - 34}" rx="17" fill="none" stroke="${relief}" stroke-width="7"/>`,
    `<rect x="${X0 + 15}" y="${y + 16}" width="${LARGEUR - 30}" height="${HAUTEUR - 32}" rx="17" fill="none" stroke="${jonc}" stroke-width="7"/>`,
    trous,
  ].join('');
}

function plaques() {
  const L = 640;
  const H = 1000;
  const cx = X0 + LARGEUR / 2;
  const y1 = 5;
  const y2 = y1 + PAS;
  const y3 = y2 + PAS;

  // 1. Tôle chrome, bandeau rouge, « BICHON » en bleu.
  const atelier = texte('ATELIER', { x: cx, y: y1 + 67, h: 30, esp: 30, ancre: 'milieu' });
  const bichon = texte('BICHON', { x: cx, y: y1 + 240, h: 112, esp: 26, ancre: 'milieu' });
  const une = [
    tole(y1, P.chrome, P.bleu, '#b3aecb'),
    `<rect x="${X0 + 76}" y="${y1 + 30}" width="${LARGEUR - 152}" height="44" rx="8" fill="${P.rouge}"/>`,
    trait(atelier.d, P.chrome, 6),
    astre(X0 + 112, y1 + 52, 13, P.chrome),
    astre(X0 + LARGEUR - 112, y1 + 52, 13, P.chrome),
    embouti(bichon.d, P.bleu, '#1c3f96', 21),
  ].join('\n');

  // 2. Tôle ambre, « TOUJOURS PLEIN GAZ » en noir, filet rouge.
  const toujours = texte('TOUJOURS', { x: cx, y: y2 + 80, h: 30, esp: 30, ancre: 'milieu' });
  const pleinGaz = texte('PLEIN GAZ', { x: cx, y: y2 + 208, h: 76, esp: 34, mot: 44, ancre: 'milieu' });
  const deux = [
    tole(y2, P.ambre, T, '#b97a08'),
    trait(toujours.d, T, 6.5),
    embouti(pleinGaz.d, T, '#ffdf9a', 15, -2.5, -3),
    `<path d="M${X0 + 70} ${y2 + 250}H${X0 + LARGEUR - 70}" stroke="${P.rouge}" stroke-width="9" stroke-linecap="round"/>`,
  ].join('\n');

  // 3. Tôle noire, « TURBO » en chrome entre deux éclairs.
  const turbo = texte('TURBO', { x: cx, y: y3 + 200, h: 88, esp: 24, ancre: 'milieu' });
  const foudre = (x, sens) =>
    `<path d="${ECLAIR}" fill="${P.ambre}" stroke="${T}" stroke-width="5" stroke-linejoin="round" transform="translate(${x} ${y3 + 156}) scale(${0.6 * sens} 0.6)"/>`;
  const trois = [
    tole(y3, '#191624', P.turquoise, '#000000'),
    embouti(turbo.d, P.chrome, '#000000', 17),
    foudre(X0 + 62, 1),
    foudre(X0 + LARGEUR - 62, -1),
    `<path d="M${X0 + 120} ${y3 + 246}H${X0 + LARGEUR - 120}" stroke="${P.rouge}" stroke-width="7" stroke-linecap="round"/>`,
  ].join('\n');

  return svg({
    largeur: L,
    hauteur: H,
    titre: 'trois plaques décoratives de fantaisie',
    notes: [
      `Trois tôles de ${LARGEUR} × ${HAUTEUR} empilées (2:1), en x = ${X0}, y = ${y1}, ${y2} et ${y3}. Groupes : plaque-1, plaque-2, plaque-3.`,
      'Mots écrits : BICHON, TOUJOURS PLEIN GAZ, TURBO. Aucun texte au format d’une immatriculation.',
    ],
    corps: `<g id="plaque-1">\n${une}\n</g>\n<g id="plaque-2">\n${deux}\n</g>\n<g id="plaque-3">\n${trois}\n</g>`,
  });
}

export default [{ fichier: 'plaques-deco.svg', ordre: 7, dessin: plaques }];
