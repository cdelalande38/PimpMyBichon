// Le flipper ancien : fronton (la glace éclairée) et plateau, vus de face et de dessus.
// Thème inventé pour le projet : « PISTONS D'ENFER ». Aucun nom, décor ou règle repris d'une machine réelle.

import { PALETTE as P, PENTE, f, svg, texte } from '../traces.mjs';
import { ECLAIR, crane, etoile, flammes, langue, piston, rayons } from '../motifs.mjs';
import { BOIS } from './cible.mjs';

const T = P.nuit;
const PALE = '#ffe2a0'; // cœur des flammes : l'ambre éclairci

const trait = (d, couleur, ep, plus = '') =>
  `<path d="${d}" fill="none" stroke="${couleur}" stroke-width="${ep}" stroke-linecap="round" stroke-linejoin="round"${plus}/>`;
const astre = (x, y, r, couleur, ep = 3) =>
  `<path d="${etoile(r)}" fill="${couleur}" stroke="${T}" stroke-width="${ep}" stroke-linejoin="round" transform="translate(${x} ${y})"/>`;

// --- Fronton (720 × 620, soit 0,72 × 0,62 m) ---------------------------------------------------

function fronton() {
  const L = 720;
  const H = 620;
  const l1 = texte('PISTONS', { x: 372, y: 122, h: 84, esp: 22, pencher: PENTE, ancre: 'milieu' });
  const l2 = texte("D'ENFER", { x: 356, y: 228, h: 84, esp: 22, pencher: PENTE, ancre: 'milieu' });
  const compteur = (x, y, n) => {
    const t = texte(n, { x: x + 66, y: y + 38, h: 26, esp: 34, ancre: 'milieu' });
    return `<rect x="${x}" y="${y}" width="132" height="50" rx="9" fill="${T}" stroke="${P.ambre}" stroke-width="4"/>${trait(t.d, P.chrome, 5)}`;
  };
  const voyants = (x, y) =>
    [P.rouge, P.ambre, P.turquoise].map((c, i) => `<circle cx="${x + i * 40}" cy="${y}" r="11" fill="${c}" stroke="${T}" stroke-width="3"/>`).join('');
  const metal = { clair: P.chrome, ombre: P.bleu, trait: T, fond: T };
  const feu = flammes({
    langues: [
      [-322, 48, -346, -205],
      [-252, 54, -226, -150],
      [-176, 50, -192, -118],
      [-102, 46, -86, -92],
      [-32, 42, -42, -74],
      [40, 42, 54, -80],
      [110, 46, 94, -98],
      [182, 50, 202, -124],
      [252, 54, 232, -158],
      [322, 48, 348, -212],
    ],
    couleurs: [P.rouge, P.ambre, PALE],
    trait: T,
    ep: 5,
  });
  const corps = `
<defs><clipPath id="glace"><rect x="22" y="22" width="676" height="576" rx="14"/></clipPath></defs>
<rect width="${L}" height="${H}" rx="20" fill="#1d1a2a"/>
<g clip-path="url(#glace)">
<rect x="22" y="22" width="676" height="576" fill="${T}"/>
<path d="${rayons(360, 400, 28, 640, 3)}" fill="${P.rouge}" opacity="0.3"/>
<g transform="translate(360 608)">${feu}</g>
<g transform="translate(360 402)">
<g transform="rotate(38) scale(0.78) translate(0 9)">${piston({ id: 'fronton-piston-a', ...metal, ep: 9 })}</g>
<g transform="rotate(-38) scale(0.78) translate(0 9)">${piston({ id: 'fronton-piston-b', ...metal, ep: 9 })}</g>
<g transform="translate(0 2) scale(0.66)">${crane({ id: 'fronton-crane', clair: P.chrome, ombre: P.bleu, trait: T, ep: 11, pupille: P.rouge })}</g>
</g>
<path d="M72 30H688L653 252H37Z" fill="${T}" stroke="${P.chrome}" stroke-width="5" stroke-linejoin="round"/>
${trait(l1.d, P.ambre, 17)}${trait(l1.d, PALE, 4)}
${trait(l2.d, P.rouge, 17)}${trait(l2.d, '#ffb9bf', 4)}
${astre(118, 80, 19, P.turquoise)}${astre(628, 80, 19, P.turquoise)}${astre(100, 188, 19, P.turquoise)}${astre(612, 188, 19, P.turquoise)}
${compteur(44, 300, '1350')}${compteur(544, 300, '0720')}
${voyants(70, 382)}${voyants(570, 382)}
</g>
<rect x="22" y="22" width="676" height="576" rx="14" fill="none" stroke="${P.chrome}" stroke-width="5"/>`;
  return svg({
    largeur: L,
    hauteur: H,
    titre: "fronton du flipper « PISTONS D'ENFER »",
    notes: [
      'La glace éclairée du fronton : 720 × 620, le rapport de la boîte du fronton (0,72 × 0,62 m).',
      "Titre, tête de mort sur pistons croisés, flammes, deux compteurs de points. Matière émissive dans l'app.",
    ],
    corps,
  });
}

// --- Plateau (700 × 1250, soit 0,70 × 1,25 m, vu de dessus, le joueur en bas) -------------------

function plateau() {
  const L = 700;
  const H = 1250;
  const axe = 323; // axe du jeu, couloir de lancement exclu
  const champ = 'M26 1224V360A324 324 0 0 1 674 360V1224Z';
  const nuit2 = '#17132e';

  const bumper = (x, y, c) =>
    `<g transform="translate(${x} ${y})"><circle r="54" fill="${P.chrome}" stroke="${T}" stroke-width="6"/><circle r="42" fill="${c}" stroke="${T}" stroke-width="4"/><path d="${etoile(27)}" fill="${P.chrome}" stroke="${T}" stroke-width="3" stroke-linejoin="round"/><circle r="6" fill="${T}"/></g>`;
  const pastille = (x, y, r, c, dedans = '') =>
    `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" stroke="${T}" stroke-width="4"/>${dedans}`;
  const chiffre = (n, x, y) => trait(texte(n, { x, y: y + 11, h: 22, ancre: 'milieu' }).d, T, 5);
  const batteur = (px, py, tx, ty) => {
    const len = Math.hypot(tx - px, ty - py);
    const nx = -(ty - py) / len;
    const ny = (tx - px) / len;
    const forme = (r1, r2) =>
      `M${f(px + nx * r1)} ${f(py + ny * r1)}L${f(tx + nx * r2)} ${f(ty + ny * r2)}A${r2} ${r2} 0 0 0 ${f(tx - nx * r2)} ${f(ty - ny * r2)}L${f(px - nx * r1)} ${f(py - ny * r1)}A${r1} ${r1} 0 0 0 ${f(px + nx * r1)} ${f(py + ny * r1)}Z`;
    return `<path d="${forme(22, 13)}" fill="${T}"/><path d="${forme(17.5, 9)}" fill="${P.rouge}"/><path d="${forme(10.5, 4.5)}" fill="${P.chrome}"/><circle cx="${px}" cy="${py}" r="4" fill="${T}"/>`;
  };
  const fronde = (pts) =>
    `<path d="${pts}" fill="${T}" stroke="${T}" stroke-width="15" stroke-linejoin="round"/><path d="${pts}" fill="${P.rouge}" stroke="${P.chrome}" stroke-width="7" stroke-linejoin="round"/>`;
  const plot = (x, y) => `<circle cx="${x}" cy="${y}" r="9" fill="${P.chrome}" stroke="${T}" stroke-width="3"/>`;
  const couronne = (n, r, hw, h, plus) =>
    `<g ${plus}>${Array.from({ length: n }, (_, k) => `<path d="${langue(0, hw, hw * 0.55, -h)}" transform="rotate(${f((k * 360) / n)}) translate(0 ${-r})"/>`).join('')}</g>`;
  const titre = texte("PISTONS D'ENFER", { x: axe, y: 900, h: 36, esp: 22, ancre: 'milieu' });
  const carte = (x, y, angle) =>
    `<g transform="translate(${x} ${y}) rotate(${angle})"><rect x="-58" y="-17" width="116" height="34" rx="4" fill="${P.chrome}" stroke="${T}" stroke-width="3"/><path d="M-44 -6H44M-44 5H20" stroke="${T}" stroke-width="3" stroke-linecap="round"/></g>`;

  const corps = `
<defs><clipPath id="champ"><path d="${champ}"/></clipPath></defs>
<rect width="${L}" height="${H}" rx="10" fill="${BOIS.sombre}"/>
<rect x="10" y="10" width="680" height="1230" rx="6" fill="${BOIS.clair}"/>
<path d="${champ}" fill="${nuit2}"/>
<g clip-path="url(#champ)">
<path d="${rayons(axe, 722, 24, 1100, 7.5)}" fill="${P.bleu}" opacity="0.2"/>
<rect x="627" y="380" width="60" height="860" fill="#0f0c20"/>
<g id="couloirs-du-haut">
<path d="M173 132V222M273 132V222M373 132V222M473 132V222" fill="none" stroke="${T}" stroke-width="20" stroke-linecap="round"/>
<path d="M173 132V222M273 132V222M373 132V222M473 132V222" fill="none" stroke="${P.chrome}" stroke-width="12" stroke-linecap="round"/>
${pastille(223, 178, 25, P.ambre, astre(223, 178, 13, P.chrome, 2))}${pastille(323, 178, 25, P.turquoise, astre(323, 178, 13, P.chrome, 2))}${pastille(423, 178, 25, P.rouge, astre(423, 178, 13, P.chrome, 2))}
<path d="M223 244L241 276H205ZM323 244L341 276H305ZM423 244L441 276H405Z" fill="${P.turquoise}" stroke="${T}" stroke-width="3" stroke-linejoin="round"/>
</g>
<g id="bumpers">
${bumper(213, 410, P.rouge)}${bumper(433, 410, P.ambre)}${bumper(323, 530, P.turquoise)}
<path d="${ECLAIR}" fill="${P.ambre}" stroke="${T}" stroke-width="7" stroke-linejoin="round" transform="translate(96 440) scale(0.5)"/>
<path d="${ECLAIR}" fill="${P.ambre}" stroke="${T}" stroke-width="7" stroke-linejoin="round" transform="translate(550 440) scale(-0.5 0.5)"/>
</g>
<g id="medaillon" transform="translate(${axe} 722)">
${couronne(12, 80, 30, 52, `fill="${T}" stroke="${T}" stroke-width="9" stroke-linejoin="round"`)}
${couronne(12, 80, 30, 52, `fill="${P.rouge}"`)}
${couronne(12, 78, 18, 30, `fill="${P.ambre}"`)}
<circle r="90" fill="${T}" stroke="${P.chrome}" stroke-width="7"/>
<g transform="translate(0 2) scale(0.5)">${crane({ id: 'plateau-crane', clair: P.chrome, ombre: P.bleu, trait: T, ep: 12, pupille: P.rouge })}</g>
</g>
${trait(titre.d, T, 15)}${trait(titre.d, P.ambre, 7)}
<g id="cibles-de-cote" stroke="${T}" stroke-width="3">
<path d="M30 560h17v46h-17zM30 620h17v46h-17zM30 680h17v46h-17z" fill="${P.ambre}"/>
<path d="M599 560h17v46h-17zM599 620h17v46h-17zM599 680h17v46h-17z" fill="${P.turquoise}"/>
</g>
${astre(120, 310, 15, P.ambre)}${astre(526, 310, 15, P.ambre)}${astre(96, 760, 12, P.ambre)}${astre(550, 760, 12, P.ambre)}${astre(168, 640, 10, P.chrome)}${astre(478, 640, 10, P.chrome)}
<g id="bas-de-plateau">
${pastille(axe, 950, 22, P.ambre, chiffre('1', axe, 950))}${pastille(axe, 1006, 22, P.turquoise, chiffre('2', axe, 1006))}${pastille(axe, 1062, 22, P.rouge, chiffre('3', axe, 1062))}
${pastille(47, 1012, 14, P.rouge)}${pastille(599, 1012, 14, P.rouge)}
${fronde('M112 915V1040L214 1082Z')}${fronde('M534 915V1040L432 1082Z')}
${astre(144, 1014, 15, P.chrome)}${astre(502, 1014, 15, P.chrome)}
${trait('M68 900V1050L186 1106', T, 15)}${trait('M68 900V1050L186 1106', P.chrome, 8)}
${trait('M578 900V1050L460 1106', T, 15)}${trait('M578 900V1050L460 1106', P.chrome, 8)}
${plot(112, 915)}${plot(534, 915)}${plot(68, 900)}${plot(578, 900)}
${batteur(205, 1120, 289, 1164)}${batteur(441, 1120, 357, 1164)}
<path d="M26 1152L${axe} 1214L620 1152V1240H26Z" fill="${T}" stroke="${P.chrome}" stroke-width="5" stroke-linejoin="round"/>
${carte(150, 1203, 11.8)}${carte(496, 1203, -11.8)}
</g>
<g id="couloir-de-lancement">
<path d="M623 1240V452" fill="none" stroke="${T}" stroke-width="13" stroke-linecap="round"/>
<path d="M623 1240V452" fill="none" stroke="${BOIS.clair}" stroke-width="7" stroke-linecap="round"/>
<rect x="645" y="1150" width="11" height="90" fill="${P.chrome}" stroke="${T}" stroke-width="3"/>
<circle cx="650.5" cy="1132" r="14" fill="${P.chrome}" stroke="${T}" stroke-width="4"/>
<circle cx="646" cy="1127" r="4" fill="#ffffff"/>
</g>
</g>
<path d="${champ}" fill="none" stroke="${T}" stroke-width="6"/>
<path d="M26 360A324 324 0 0 1 674 360" fill="none" stroke="${P.chrome}" stroke-width="4"/>`;
  return svg({
    largeur: L,
    hauteur: H,
    titre: "plateau du flipper « PISTONS D'ENFER »",
    notes: [
      'Le plateau vu de dessus, le joueur en bas : 700 × 1250, le rapport de la caisse (0,70 × 1,25 m).',
      'Groupes : couloirs-du-haut, bumpers, medaillon, cibles-de-cote, bas-de-plateau, couloir-de-lancement.',
    ],
    corps,
  });
}

export default [
  { fichier: 'flipper-fronton.svg', ordre: 5, dessin: fronton },
  { fichier: 'flipper-plateau.svg', ordre: 6, dessin: plateau },
];
