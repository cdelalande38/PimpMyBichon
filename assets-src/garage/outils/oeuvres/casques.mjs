// Quatre décors de casque intégral, vus de profil (écran à droite), en planche 2 × 2.
// Chaque casque est un groupe (`casque-flammes`, `casque-bandes`, `casque-crane`, `casque-damier`) :
// le décor est découpé par la coque, l'habillage commun (écran, pivot, joint, aérations) passe dessus.

import { M, PALETTE as P, chemin, f, svg } from '../traces.mjs';
import { ECLAIR, crane, etoile, flammes, trame } from '../motifs.mjs';

const T = P.nuit;

/** Coque, environ 396 × 347, centrée sur l'origine. */
const COQUE =
  'M-172 120C-200 20 -180 -120 -70 -170C10 -205 120 -175 165 -80L178 -30C192 20 196 80 182 128C150 140 60 142 -10 138C-80 134 -140 132 -172 120Z';
const ECRAN = 'M30 -84C84 -98 150 -88 176 -50L190 4C134 14 66 12 22 2C10 -32 12 -64 30 -84Z';
const JOINT = 'M-172 120C-140 132 -80 134 -10 138C60 142 150 140 182 128';

const CASE_L = 480;
const CASE_H = 420;

/** Ombre propre : tout, sauf la coque décalée vers le haut à gauche (découpé ensuite par la coque). */
const OMBRE = `M-260 -260H260V260H-260Z${chemin(COQUE, M.t(-18, -14))}`;

function habillage() {
  return [
    `<path d="${OMBRE}" fill="${T}" fill-opacity="0.3" fill-rule="evenodd"/>`,
    `<path d="M-128 -104C-92 -146 -34 -168 24 -166" fill="none" stroke="${P.chrome}" stroke-opacity="0.55" stroke-width="14" stroke-linecap="round"/>`,
    `<path d="${ECRAN}" fill="${T}"/>`,
    `<path d="M62 -70C98 -80 136 -74 158 -54" fill="none" stroke="${P.bleu}" stroke-opacity="0.75" stroke-width="9" stroke-linecap="round"/>`,
  ].join('');
}

function finitions() {
  return [
    `<path d="${COQUE}" fill="none" stroke="${T}" stroke-width="10" stroke-linejoin="round"/>`,
    `<path d="${ECRAN}" fill="none" stroke="${T}" stroke-width="6" stroke-linejoin="round"/>`,
    `<path d="${JOINT}" fill="none" stroke="${T}" stroke-width="18" stroke-linecap="round"/>`,
    `<path d="M148 50L172 45M148 72L174 67M150 94L176 89" fill="none" stroke="${T}" stroke-width="7" stroke-linecap="round"/>`,
    `<circle cx="12" cy="-38" r="14" fill="${P.chrome}" stroke="${T}" stroke-width="5"/>`,
  ].join('');
}

function casque(id, col, lig, decor) {
  const x = col * CASE_L + CASE_L / 2;
  const y = lig * CASE_H + CASE_H / 2 + 22;
  return [
    `<g id="${id}" transform="translate(${x} ${y})">`,
    `<g clip-path="url(#coque)">`,
    decor,
    habillage(),
    '</g>',
    finitions(),
    '</g>',
  ].join('\n');
}

function damier(x0, y0, n, c) {
  let d = '';
  for (let i = 0; i < n; i++) for (let j = 0; j < 2; j++) if ((i + j) % 2) d += `M${f(x0 + i * c)} ${f(y0 + j * c)}h${c}v${c}h-${c}Z`;
  return d;
}

function casqueMotifs() {
  const L = CASE_L * 2;
  const H = CASE_H * 2;
  const fond = (c) => `<path d="${COQUE}" fill="${c}"/>`;

  const aFlammes = [
    fond('#1b1826'),
    `<g transform="translate(190 26) rotate(-90)">${flammes({
      langues: [
        [-112, 40, -104, -250],
        [-52, 50, -62, -340],
        [8, 54, 0, -390],
        [68, 50, 78, -310],
        [118, 38, 128, -220],
      ],
      couleurs: [P.rouge, P.ambre, '#ffe9a8'],
      trait: T,
      ep: 6,
    })}</g>`,
  ].join('');

  const aBandes = [
    fond(P.chrome),
    `<path d="M-240 40C-196 -104 30 -178 240 -66" fill="none" stroke="${P.bleu}" stroke-width="44"/>`,
    `<path d="M-240 98C-190 -46 40 -112 240 -6" fill="none" stroke="${P.rouge}" stroke-width="20"/>`,
    `<path d="${etoile(34)}" fill="${P.ambre}" stroke="${T}" stroke-width="6" stroke-linejoin="round" transform="translate(-62 66)"/>`,
  ].join('');

  const aCrane = [
    fond(P.rouge),
    `<path d="M-158 -36C-112 -140 22 -186 138 -126M-150 -14C-104 -118 26 -162 146 -104" fill="none" stroke="${P.ambre}" stroke-width="6" stroke-linecap="round"/>`,
    `<g transform="translate(-44 30) scale(0.56)">${crane({ id: 'casque-crane-ombre', clair: P.chrome, ombre: '#b3aecb', trait: T, ep: 11, pupille: P.ambre })}</g>`,
  ].join('');

  const aDamier = [
    fond(P.turquoise),
    `<path d="${COQUE}" fill="url(#paillettes)"/>`,
    `<g transform="translate(0 -6) rotate(-14)">`,
    `<rect x="-260" y="-26" width="520" height="52" fill="${P.chrome}"/>`,
    `<path d="${damier(-260, -26, 20, 26)}" fill="${T}"/>`,
    `<path d="M-260 -30H260M-260 30H260" stroke="${T}" stroke-width="8"/>`,
    '</g>',
    `<path d="${ECLAIR}" fill="${P.ambre}" stroke="${T}" stroke-width="9" stroke-linejoin="round" transform="translate(-84 58) rotate(18) scale(0.62)"/>`,
  ].join('');

  const corps = [
    '<defs>',
    `<clipPath id="coque"><path d="${COQUE}"/></clipPath>`,
    trame('paillettes', 13, 2.3, '#c9fbf1', 30),
    '</defs>',
    casque('casque-flammes', 0, 0, aFlammes),
    casque('casque-bandes', 1, 0, aBandes),
    casque('casque-crane', 0, 1, aCrane),
    casque('casque-damier', 1, 1, aDamier),
  ].join('\n');

  return svg({
    largeur: L,
    hauteur: H,
    titre: 'quatre décors de casque',
    notes: [
      `Planche 2 × 2 de cases ${CASE_L} × ${CASE_H}, fond transparent. Casques intégraux de profil, écran à droite.`,
      'Groupes : casque-flammes (noir mat), casque-bandes (blanc, bandes bleue et rouge),',
      'casque-crane (rouge, tête de mort), casque-damier (sarcelle pailleté, damier, éclair).',
    ],
    corps,
  });
}

export default [{ fichier: 'casque-motifs.svg', ordre: 9, dessin: casqueMotifs }];
