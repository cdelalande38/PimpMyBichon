// La cible de fléchettes dans son panneau de bois à bords étagés.
// Unités du viewBox : le millimètre. Le panneau reprend les deux boîtes de `placeholder_panneau_cible`
// (1,2 × 0,8 m et 0,8 × 1,0 m, centrées) ; la cible fait 456 mm (0,46 m).

import { M, PALETTE as P, f, svg, texte } from '../traces.mjs';
import { secteur } from '../motifs.mjs';

/** Tons de bois (panneau de la cible, caisse du flipper). */
export const BOIS = Object.freeze({
  clair: '#c9955a',
  moyen: '#b98349',
  dore: '#c18c50',
  veine: '#94683a',
  sombre: '#7a4f2a',
  noeud: '#5d3b1e',
});

/** Ordre des secteurs, dans le sens horaire à partir du haut. */
const ORDRE = [20, 1, 18, 4, 13, 6, 10, 15, 2, 17, 3, 19, 7, 16, 8, 11, 14, 9, 12, 5];

/** Tirage stable entre 0 et 1 (le fichier doit sortir identique à chaque passage). */
const alea = (i) => {
  const v = Math.sin(i * 127.1 + 311.7) * 43758.5453;
  return v - Math.floor(v);
};

function cible() {
  const L = 1200;
  const H = 1000;
  const cx = 600;
  const cy = 500;
  const T = P.nuit;
  const fil = '#b9b5cc'; // fil d'acier de l'araignée
  const contour = 'M200 0H1000V100H1200V900H1000V1000H200V900H0V100H200Z';

  // Panneau : huit planches verticales, veines, nœuds, joints, chant sombre.
  const tons = [BOIS.clair, BOIS.moyen, BOIS.dore, BOIS.clair, BOIS.dore, BOIS.moyen, BOIS.clair, BOIS.dore];
  const planches = tons.map((t, i) => `<rect x="${i * 150}" width="150" height="${H}" fill="${t}"/>`).join('');
  let veines = '';
  for (let i = 0; i < 8; i++) {
    for (let j = 0; j < 3; j++) {
      const x = i * 150 + 28 + j * 44 + alea(i * 3 + j) * 18;
      const a = (alea(i * 7 + j) - 0.5) * 30;
      veines += `M${f(x)} 0C${f(x + a)} 330 ${f(x - a)} 660 ${f(x + a * 0.4)} ${H}`;
    }
  }
  const joints = Array.from({ length: 7 }, (_, i) => `M${(i + 1) * 150} 0V${H}`).join('');
  const noeuds = [
    [96, 250],
    [410, 838],
    [705, 150],
    [1010, 610],
    [240, 660],
    [865, 880],
  ]
    .map(([x, y], i) => {
      const rx = 12 + (i % 3) * 3;
      const ry = 19 + (i % 2) * 6;
      return `<ellipse cx="${x}" cy="${y}" rx="${rx + 10}" ry="${ry + 13}" fill="none" stroke="${BOIS.veine}" stroke-width="3"/><ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="${BOIS.noeud}"/>`;
    })
    .join('');
  // Les fléchettes ratées ont laissé des trous autour de la cible.
  const trous = Array.from({ length: 18 }, (_, i) => {
    const a = alea(i + 40) * Math.PI * 2;
    const r = 240 + alea(i + 80) * 80;
    return `<circle cx="${f(cx + r * Math.cos(a))}" cy="${f(cy + r * Math.sin(a))}" r="3.6"/>`;
  }).join('');
  const vis = [
    [38, 140],
    [1162, 140],
    [38, 860],
    [1162, 860],
  ]
    .map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="12" fill="${P.chrome}" stroke="${BOIS.noeud}" stroke-width="3"/><path d="M${x - 7} ${y}H${x + 7}" stroke="${T}" stroke-width="3" transform="rotate(${25 + i * 40} ${x} ${y})"/>`)
    .join('');

  // Cible : secteurs clairs, anneaux du triple et du double, araignée, chiffres.
  let clairs = '';
  let rouges = '';
  let verts = '';
  let rayons = '';
  for (let i = 0; i < 20; i++) {
    const a0 = i * 18 - 9;
    const a1 = a0 + 18;
    if (i % 2) clairs += secteur(20, 170, a0, a1);
    const anneaux = secteur(96, 110, a0, a1) + secteur(154, 170, a0, a1);
    if (i % 2) verts += anneaux;
    else rouges += anneaux;
    const t = ((a0 - 90) * Math.PI) / 180;
    rayons += `M${f(20 * Math.cos(t), 2)} ${f(20 * Math.sin(t), 2)}L${f(173 * Math.cos(t), 2)} ${f(173 * Math.sin(t), 2)}`;
  }
  const chiffres = ORDRE.map((n, i) => texte(String(n), { y: 15, h: 30, esp: 20, ancre: 'milieu', apres: M.x(M.r(i * 18), M.t(0, -199)) }).d).join('');

  const corps = `
<defs><clipPath id="bords"><path d="${contour}"/></clipPath></defs>
<g id="panneau" clip-path="url(#bords)">
${planches}
<path d="${veines}" fill="none" stroke="${BOIS.veine}" stroke-width="3" opacity="0.6"/>
${noeuds}
<path d="${joints}" fill="none" stroke="${BOIS.sombre}" stroke-width="5"/>
<path d="${contour}" fill="none" stroke="${BOIS.sombre}" stroke-width="24"/>
<g fill="${BOIS.noeud}">${trous}</g>
${vis}
</g>
<g id="cible" transform="translate(${cx} ${cy})">
<circle cx="9" cy="14" r="236" fill="${T}" opacity="0.4"/>
<circle r="228" fill="${T}"/>
<circle r="225" fill="none" stroke="#2c2940" stroke-width="6"/>
<path d="${clairs}" fill="${P.chrome}"/>
<path d="${rouges}" fill="${P.rouge}"/>
<path d="${verts}" fill="${P.turquoise}"/>
<circle r="20" fill="${P.turquoise}"/>
<circle r="9" fill="${P.rouge}"/>
<g fill="none" stroke="${fil}" stroke-width="2">
<path d="${rayons}"/>
<circle r="9"/><circle r="20"/><circle r="96"/><circle r="110"/><circle r="154"/><circle r="170"/>
</g>
<path d="${chiffres}" fill="none" stroke="${P.chrome}" stroke-width="4.6" stroke-linecap="round" stroke-linejoin="round"/>
</g>`;

  return svg({
    largeur: L,
    hauteur: H,
    titre: 'cible de fléchettes dans son panneau de bois',
    notes: [
      'Unités : le millimètre. Panneau 1200 × 1000 à bords étagés, cible de 456 au centre (600, 500).',
      'Groupes : panneau, cible. Pour la cible seule, cadrer le carré 372 à 828 en x, 272 à 728 en y.',
      "Hors du panneau le fond est transparent ; le liseré lumineux bleu-violet vient de l'app.",
    ],
    corps,
  });
}

export default [{ fichier: 'cible.svg', ordre: 4, dessin: cible }];
