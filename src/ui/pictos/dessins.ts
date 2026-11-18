// Dessins des choix du menu (jantes, pneus, volants, pommeaux, sièges, assiette, étoiles, finitions),
// tirés des paramètres de chaque choix (catalogues de public/assets/shared/, src/data/finishes.ts),
// jamais de son identifiant : une nouvelle jante d'un style connu a son dessin sans toucher au code ;
// un style inconnu n'en a pas (null), et sa puce garde son mot seul. Géométrie pure, dans un carré de
// 24 unités centré en (12, 12) : src/ui/pictos/Pictos.tsx en fait du SVG au trait, couleur du texte.

/** Un trait du dessin : chemin SVG, épaisseur (0 : sans contour), remplissage et opacité du trait. */
export interface Trait {
  d: string;
  /** Épaisseur du trait ; 0 : pas de contour. */
  w: number;
  /** Remplissage à la couleur du texte, en opacité (0 à 1) ; absent : aucun. */
  fill?: number;
  /** Opacité du trait. */
  o?: number;
  dash?: string;
  /** Bouts carrés (bâtons, pavés) ; ronds par défaut. */
  butt?: boolean;
}

const f1 = (v: number): string => (Math.round(v * 100) / 100).toString();
const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));

/** Point à `r` du centre (12, 12), angle en degrés : 0 à droite, 90 en bas. */
function pol(r: number, deg: number, cx = 12, cy = 12): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

const pt = ([x, y]: [number, number]): string => `${f1(x)} ${f1(y)}`;

/** Cercle en chemin. */
export function cercle(r: number, cx = 12, cy = 12): string {
  return `M${f1(cx - r)} ${f1(cy)}a${f1(r)} ${f1(r)} 0 1 0 ${f1(2 * r)} 0a${f1(r)} ${f1(r)} 0 1 0 ${f1(-2 * r)} 0`;
}

/** Rectangle aux coins arrondis en chemin. */
function rrect(x: number, y: number, w: number, h: number, r: number): string {
  return `M${f1(x + r)} ${f1(y)}h${f1(w - 2 * r)}a${f1(r)} ${f1(r)} 0 0 1 ${f1(r)} ${f1(r)}v${f1(h - 2 * r)}a${f1(r)} ${f1(r)} 0 0 1 ${f1(-r)} ${f1(r)}h${f1(-(w - 2 * r))}a${f1(r)} ${f1(r)} 0 0 1 ${f1(-r)} ${f1(-r)}v${f1(-(h - 2 * r))}a${f1(r)} ${f1(r)} 0 0 1 ${f1(r)} ${f1(-r)}z`;
}

/** `n` rayons de `r1` à `r2`, le premier en haut. */
function rayons(n: number, r1: number, r2: number, depart = -90): string {
  let d = '';
  for (let i = 0; i < n; i += 1) {
    const a = depart + (i * 360) / n;
    d += `M${pt(pol(r1, a))}L${pt(pol(r2, a))}`;
  }
  return d;
}

/** Deux traits parallèles le long d'un rayon (une branche évidée), écartés de 2 × `e`. */
function branche(deg: number, r1: number, r2: number, e: number): string {
  const n = deg + 90;
  const [ox, oy] = pol(e, n, 0, 0);
  const [a, b] = [pol(r1, deg), pol(r2, deg)];
  return `M${pt([a[0] + ox, a[1] + oy])}L${pt([b[0] + ox, b[1] + oy])}M${pt([a[0] - ox, a[1] - oy])}L${pt([b[0] - ox, b[1] - oy])}`;
}

/** Arc de cercle de `a1` à `a2` degrés. */
function arc(r: number, a1: number, a2: number): string {
  return `M${pt(pol(r, a1))}A${f1(r)} ${f1(r)} 0 ${Math.abs(a2 - a1) > 180 ? 1 : 0} 1 ${pt(pol(r, a2))}`;
}

const entier = (v: unknown, defaut: number, min: number, max: number): number => (typeof v === 'number' && Number.isFinite(v) ? clamp(Math.round(v), min, max) : defaut);

/** Jante : son style (famille de modelage), ses branches ou ses rayons, ses trous. */
export function dessinJante(rim: { style: string; spokes?: unknown; holes?: unknown }): Trait[] | null {
  const levre: Trait[] = [
    { d: cercle(10), w: 1.4 },
    { d: cercle(8.6), w: 0.7 },
  ];
  switch (rim.style) {
    case 'tole': {
      const n = entier(rim.holes, 8, 3, 16);
      const trous = Array.from({ length: n }, (_, i): Trait => ({ d: cercle(0.9, ...pol(5.7, -90 + (i * 360) / n)), w: 0.9 }));
      return [{ d: cercle(10), w: 1.4 }, { d: cercle(7.9), w: 0.7 }, ...trous, { d: cercle(3), w: 1.2 }, { d: cercle(1.2), w: 0, fill: 0.9 }];
    }
    case 'branches_plates':
      return [...levre, { d: rayons(entier(rim.spokes, 8, 3, 12), 2.4, 8.6), w: 1.3 }, { d: cercle(2.4), w: 1.1 }];
    case 'batons':
      return [...levre, { d: cercle(6), w: 0.6, dash: '1 1.1' }, { d: rayons(entier(rim.spokes, 5, 3, 10), 2.7, 8.6), w: 2.4, butt: true }, { d: cercle(2.7), w: 1.1 }];
    case 'rayons': {
      // Rayons fils croisés : un sur trois environ, sinon le dessin se bouche à la taille d'une puce.
      const k = clamp(Math.round(entier(rim.spokes, 36, 6, 120) / 3), 8, 20);
      let d = '';
      for (let i = 0; i < k; i += 1) {
        const a = (i * 360) / k;
        d += `M${pt(pol(2.2, a))}L${pt(pol(8.6, a + 32))}M${pt(pol(2.2, a))}L${pt(pol(8.6, a - 32))}`;
      }
      return [...levre, { d, w: 0.45 }, { d: cercle(2.2), w: 1 }, { d: cercle(1), w: 0, fill: 0.9 }];
    }
    case 'deport':
      return [
        { d: cercle(10), w: 1.4 },
        { d: cercle(8.5), w: 3, o: 0.3 },
        { d: cercle(7), w: 1 },
        { d: rayons(entier(rim.spokes, 10, 3, 12), 1.9, 7), w: 0.9 },
        { d: cercle(1.9), w: 1 },
      ];
    case 'flasque':
    case 'pleine':
      return [{ d: cercle(10), w: 1.4 }, { d: cercle(8.6), w: 0.7, fill: 0.14 }, { d: arc(6.4, 200, 250), w: 0.9 }, { d: cercle(1.6), w: 1 }];
    default:
      return null;
  }
}

/** Pneu de profil : ce que porte son flanc (liseré, flanc blanc, lettres) et ses pavés. */
export function dessinPneu(tire: { mark: string; tread?: unknown }): Trait[] | null {
  const traits: Trait[] = [
    { d: cercle(9.6), w: 1.4 },
    { d: cercle(5.2), w: 1.1 },
    { d: cercle(1.6), w: 0.9 },
  ];
  if (typeof tire.tread === 'string' && tire.tread !== '') traits.push({ d: rayons(18, 9.6, 11.4), w: 1.8, butt: true });
  if (tire.mark === 'lisere') traits.push({ d: cercle(7.5), w: 0.6 });
  else if (tire.mark === 'flanc') traits.push({ d: cercle(7.4), w: 2.6, o: 0.85 });
  else if (tire.mark === 'lettres') {
    let d = '';
    for (const a of [-150, -130, -110, -70, -50, -30, 30, 50, 70, 110, 130, 150]) d += arc(7.5, a - 6, a + 6);
    traits.push({ d, w: 1.1 });
  } else return null;
  return traits;
}

/** Volant : son style (branches, moyeu, jante). */
export function dessinVolant(style: string): Trait[] | null {
  switch (style) {
    case 'deux_branches':
      return [
        { d: cercle(9.5), w: 0.9 },
        { d: cercle(2.2), w: 1 },
        { d: `M${pt(pol(2.2, 165))}L${pt(pol(9.5, 165))}M${pt(pol(2.2, 15))}L${pt(pol(9.5, 15))}`, w: 0.9 },
      ];
    case 'trois_branches': {
      const trous = [180, 0, 90].flatMap((a): Trait[] => [
        { d: cercle(0.55, ...pol(4.5, a)), w: 0.7 },
        { d: cercle(0.55, ...pol(6.3, a)), w: 0.7 },
      ]);
      return [{ d: cercle(9), w: 2.4 }, { d: cercle(2.4), w: 1.2 }, { d: [180, 0, 90].map((a) => branche(a, 2.6, 7.8, 1.15)).join(''), w: 0.9 }, ...trous];
    }
    case 'tulipe':
      return [
        { d: cercle(9.2), w: 1.6 },
        { d: cercle(3.4), w: 1 },
        { d: cercle(1.5), w: 0.9 },
        { d: [165, 15, 90].map((a) => branche(a, 3.4, 8.4, 0.8)).join(''), w: 0.8 },
      ];
    case 'bois': {
      const rivets = Array.from({ length: 12 }, (_, i): Trait => ({ d: cercle(0.4, ...pol(8.55, i * 30)), w: 0, fill: 1 }));
      return [
        { d: cercle(9.5), w: 1 },
        { d: cercle(7.6), w: 1 },
        ...rivets,
        { d: [180, 0, 90].map((a) => `M${pt(pol(1.8, a))}L${pt(pol(7.6, a))}`).join(''), w: 0.8 },
        { d: cercle(1.8), w: 1 },
      ];
    }
    case 'moyeu_large':
      return [
        { d: cercle(9.2), w: 1.8 },
        { d: [180, 0, 90].map((a) => `M${pt(pol(4.6, a))}L${pt(pol(9, a))}`).join(''), w: 2.6, butt: true },
        { d: cercle(4.6), w: 1.2 },
        { d: cercle(2.4), w: 0.9 },
      ];
    default:
      return null;
  }
}

/** Levier et soufflet sous un pommeau dont le bas est à `bas`. */
const levier = (bas: number): Trait => ({ d: `M12 ${f1(bas)}V20.6M8.2 21.3h7.6`, w: 1.2 });

/** Pommeau de levier : sa forme. */
export function dessinPommeau(style: string): Trait[] | null {
  switch (style) {
    case 'boule':
      return [{ d: cercle(4.6, 12, 7.6), w: 1.3 }, { d: 'M9.8 12.9h4.4', w: 1.6 }, levier(12.9)];
    case 'poire':
      return [{ d: 'M12 3c2.8 0 4.8 2.2 4.8 4.8 0 2.9-2.2 4.5-4.8 6.6-2.6-2.1-4.8-3.7-4.8-6.6C7.2 5.2 9.2 3 12 3z', w: 1.3 }, levier(14.4)];
    case 'cylindre':
      return [{ d: rrect(9.6, 2.4, 4.8, 10.6, 2.4), w: 1.3 }, { d: 'M9.3 14.2h5.4', w: 1.6 }, levier(14.2)];
    case 'motif':
      return [{ d: cercle(4.6, 12, 7.6), w: 1.3 }, { d: 'M12.9 4.6 10.8 8.1h2.5l-1.6 3', w: 1 }, { d: 'M9.8 12.9h4.4', w: 1.6 }, levier(12.9)];
    case 'tete_de_mort':
      return [
        { d: 'M7.3 7.8a4.7 4.7 0 1 1 9.4 0c0 1.7-.8 2.8-1.7 3.4V13H9v-1.8c-.9-.6-1.7-1.7-1.7-3.4z', w: 1.2 },
        { d: `${cercle(1.05, 10.2, 8)}${cercle(1.05, 13.8, 8)}`, w: 0, fill: 1 },
        { d: 'M11 13v-1.3M13 13v-1.3', w: 0.8 },
        levier(13),
      ];
    default:
      return null;
  }
}

/** Pieds et glissière sous un siège. */
const PIEDS: Trait = { d: 'M9.6 18v2.6M16.4 18v2.6M7.4 21h11', w: 1 };

/** Siège avant de profil (dossier à gauche, assise à droite) : sa forme. */
export function dessinSiege(style: string): Trait[] | null {
  switch (style) {
    case 'bas':
      return [{ d: 'M7.4 9.2c0-1.6 1-2.7 2.3-2.7s2.1 1 2 2.4l-.5 4.9h5.6a1.7 1.7 0 0 1 1.7 1.7v.7a1.7 1.7 0 0 1-1.7 1.7H8.9a1.7 1.7 0 0 1-1.7-1.8z', w: 1.3 }, PIEDS];
    case 'confort':
      return [
        { d: rrect(6.9, 1.8, 5, 3, 1.3), w: 1.2 },
        { d: 'M8.5 4.8v1.6M10.3 4.8v1.6', w: 0.9 },
        { d: 'M7.3 6.4h4.4c.7 0 1.2.6 1.1 1.3l-.8 5.5h5.2a1.8 1.8 0 0 1 1.8 1.8v.8a1.8 1.8 0 0 1-1.8 1.8H8.7a1.8 1.8 0 0 1-1.8-1.9z', w: 1.3 },
        { d: 'M9 8.3l-.5 6.5M11.2 15.4h6', w: 0.7 },
        PIEDS,
      ];
    case 'baquet':
      return [
        { d: 'M7.6 2h3.3c.8 0 1.4.7 1.3 1.5l-1.3 9.7h5.9a1.8 1.8 0 0 1 1.8 1.8v.8a1.8 1.8 0 0 1-1.8 1.8H8.6a1.8 1.8 0 0 1-1.8-1.9z', w: 1.3 },
        { d: rrect(8.4, 4.4, 2, 1.1, 0.5), w: 0.8 },
        { d: 'M7 12.2c1.5-.5 3.2-.5 4.6 0', w: 0.8 },
        PIEDS,
      ];
    case 'capitonne':
      return [
        { d: rrect(6.9, 2, 5, 2.8, 1.2), w: 1.2 },
        { d: 'M7.6 6.4h3.9c.7 0 1.2.6 1.1 1.3l-.8 5.5h5.4a1.8 1.8 0 0 1 1.8 1.8v.8a1.8 1.8 0 0 1-1.8 1.8H8.6a1.8 1.8 0 0 1-1.8-1.9z', w: 1.3 },
        { d: 'M8.3 7.9l1.4 1.6 1.4-1.6M8 11.1l1.5-1.6 1.4 1.6M12 14.6l1.3 1.3 1.3-1.3 1.3 1.3 1.3-1.3', w: 0.7 },
        PIEDS,
      ];
    default:
      return null;
  }
}

/**
 * Assiette : la caisse descend vers les roues, qui restent au sol (`part` : 0 origine, 1 posée). Les
 * passages de roue suivent la caisse : le jour entre le pneu et l'aile se referme.
 */
export function dessinAssiette(part: number): Trait[] {
  // De −1 (rehaussée : la caisse monte de 2 unités) à 1 (posée au sol).
  const yb = 15.8 + (part < 0 ? 2 : 3.2) * clamp(part, -1, 1);
  const y = f1(yb);
  return [
    { d: 'M1.2 21.6h21.6', w: 0.8, o: 0.6 },
    {
      d: `M2.4 ${y}V${f1(yb - 2.4)}c0-.7.4-1.2 1-1.4l2.6-.8 2.3-3.1c.4-.5.9-.7 1.5-.7h5.2c.6 0 1.1.3 1.5.7l2.6 3.1 2.2.6c.6.2 1 .7 1 1.4V${y}H20.8A3.4 3.4 0 0 0 14 ${y}H9.9A3.4 3.4 0 0 0 3.1 ${y}z`,
      w: 1.2,
    },
    { d: `${cercle(2.9, 6.5, 18.6)}${cercle(2.9, 17.4, 18.6)}`, w: 1.3 },
  ];
}

/** Étoiles du ciel : plus la densité est forte, plus il y en a (une à sept). */
export function dessinEtoiles(facteur: number): Trait[] {
  const places: ReadonlyArray<[number, number, number]> = [
    [12, 12, 3.4],
    [5.8, 6.6, 1.8],
    [18.4, 17.6, 1.9],
    [18.2, 6, 1.5],
    [5.6, 17.4, 1.5],
    [12, 3.4, 1.1],
    [12, 20.6, 1.1],
  ];
  const n = clamp(Math.round(1 + facteur * 3), 1, places.length);
  const d = places
    .slice(0, n)
    .map(([x, y, s]) => `M${f1(x)} ${f1(y - s)}L${f1(x + s * 0.28)} ${f1(y - s * 0.28)}L${f1(x + s)} ${f1(y)}L${f1(x + s * 0.28)} ${f1(y + s * 0.28)}L${f1(x)} ${f1(y + s)}L${f1(x - s * 0.28)} ${f1(y + s * 0.28)}L${f1(x - s)} ${f1(y)}L${f1(x - s * 0.28)} ${f1(y - s * 0.28)}Z`)
    .join('');
  return [{ d, w: 0.9, fill: 0.85 }];
}

// ───────────── Finitions : une petite sphère peinte ─────────────

type Rgb = [number, number, number];

function rgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? Number.parseInt(m[1] as string, 16) : 0x808080;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((v) => Math.round(clamp(v, 0, 255)).toString(16).padStart(2, '0')).join('')}`;
}

/** Mélange de deux teintes : `t` = 0, la première ; 1, la seconde. */
export function melange(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return hex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** Teinte tournée de `deg` degrés sur la roue des couleurs (la seconde teinte d'un caméléon). */
export function tourneTeinte(color: string, deg: number): string {
  const [r, g, b] = rgb(color).map((v) => v / 255) as Rgb;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  let h = 0;
  if (max !== min) h = max === r ? (g - b) / (max - min) + (g < b ? 6 : 0) : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4;
  h = (((h * 60 + deg) % 360) + 360) % 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const canal = (t0: number): number => {
    const t = ((t0 % 1) + 1) % 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return hex([canal(h / 360 + 1 / 3) * 255, canal(h / 360) * 255, canal(h / 360 - 1 / 3) * 255]);
}

/** Ce qu'une sphère doit montrer d'une finition (src/data/finishes.ts). */
export interface FinitionLike {
  metalness: number;
  roughness: number;
  clearcoat: number;
  clearcoatRoughness: number;
  iridescence: number;
  tint: number;
  flake: number;
  flakeSize: number;
  candy: number;
  flip: number;
  flipHue: number;
}

export interface Sphere {
  /** Dégradé du corps : lumière, teinte, ombre. */
  clair: string;
  base: string;
  ombre: string;
  /** Reflet d'horizon des métaux (ciel au-dessus, sol sombre dessous), 0 à 1. */
  horizon: number;
  /** Reflet de la lumière : rayon, force, netteté (0 flou, 1 franc). */
  reflet: { r: number; o: number; net: number };
  /** Point de vernis, net, au cœur du reflet (0 : sans vernis tendu). */
  vernis: number;
  /** Paillettes : x, y, rayon. */
  paillettes: ReadonlyArray<[number, number, number]>;
  /** Irisation des bords (nacré), 0 à 1. */
  irise: number;
  /** Seconde teinte des bords (caméléon) et sa force. */
  bord: { couleur: string; o: number } | null;
  /** Profondeur du vernis teinté (candy) : les bords foncent. */
  profondeur: { couleur: string; o: number } | null;
}

const ALU = '#c4c6cf';

/** Sphère d'une finition, peinte de `couleur` : tout se lit dans les réglages de la finition. */
export function sphere(f: FinitionLike, couleur: string): Sphere {
  const base = melange(ALU, couleur, clamp(f.tint, 0, 1));
  const metal = clamp(f.metalness, 0, 1);
  const rugosite = clamp(f.roughness, 0, 1);
  const n = Math.round(clamp(f.flake, 0, 1) * 10);
  const rp = 0.3 + clamp(f.flakeSize, 0, 5) * 0.09;
  const paillettes = Array.from({ length: n }, (_, i): [number, number, number] => {
    const [x, y] = pol(7.4 * Math.sqrt((i + 0.5) / n), i * 137.5 + 20);
    return [Math.round(x * 100) / 100, Math.round(y * 100) / 100, Math.round(rp * 100) / 100];
  });
  return {
    clair: melange(base, '#ffffff', 0.45 * (1 - metal * 0.5)),
    base,
    ombre: melange(base, '#000000', 0.55 + 0.3 * metal),
    horizon: metal >= 0.5 ? Math.round(metal * (1 - rugosite) * 90) / 100 : 0,
    // Un mat ne garde qu'une lueur large et faible ; un miroir, un éclat franc.
    reflet: { r: 1.3 + rugosite * 5, o: 0.15 + 0.75 * (1 - rugosite) ** 1.5, net: 1 - rugosite },
    vernis: clamp(f.clearcoat * (1 - f.clearcoatRoughness * 2), 0, 1),
    paillettes,
    irise: clamp(f.iridescence, 0, 1),
    bord: f.flip > 0 ? { couleur: tourneTeinte(couleur, f.flipHue), o: 0.85 * clamp(f.flip, 0, 1) } : null,
    profondeur: f.candy > 0 ? { couleur: melange(couleur, '#000000', 0.55), o: 0.75 * clamp(f.candy, 0, 1) } : null,
  };
}
