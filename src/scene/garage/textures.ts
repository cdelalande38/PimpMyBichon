// Textures du garage, dessinées au canvas au premier usage : aucune image importée (§ 8,
// « textures créées »). Motifs originaux ; rien n'est copié d'une photo.

import { CanvasTexture, LinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { GARAGE_MATERIALS, type GarageTextureId } from '../../data/garageBase.ts';

type Draw = (context: CanvasRenderingContext2D, size: number) => void;

/** Générateur pseudo-aléatoire stable : le garage est le même à chaque visite. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function texture(size: number, draw: Draw, srgb = true, height = size): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (context) draw(context, size);
  const result = new CanvasTexture(canvas);
  if (srgb) result.colorSpace = SRGBColorSpace;
  result.anisotropy = 4;
  return result;
}

// Carrelage clair grand format : 2 × 2 carreaux de 45 cm, beige-gris (#cfc6b8), voile marbré
// très léger, joints fins gris chaud.
const carrelage: Draw = (c, s) => {
  const rand = random(7);
  const tile = s / 2;
  for (let i = 0; i < 2; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      const l = Math.round((rand() - 0.5) * 8);
      c.fillStyle = `rgb(${207 + l},${198 + l},${184 + l})`;
      c.fillRect(i * tile, j * tile, tile, tile);
      for (let k = 0; k < 160; k += 1) {
        const g = 196 + Math.round(rand() * 24);
        c.fillStyle = `rgba(${g},${g - 8},${g - 20},0.18)`;
        c.beginPath();
        c.ellipse(i * tile + rand() * tile, j * tile + rand() * tile, 4 + rand() * 18, 2 + rand() * 6, rand() * 3, 0, Math.PI * 2);
        c.fill();
      }
    }
  }
  c.fillStyle = '#8a8078';
  for (let k = 0; k <= 2; k += 1) {
    c.fillRect(k * tile - 2, 0, 4, s);
    c.fillRect(0, k * tile - 2, s, 4);
  }
};

// Rugosité du carrelage (canal vert, linéaire), alignée sur le dessin du carrelage : carreaux
// satinés (≈ 0,3, voile marbré), joints mats (≈ 0,85) un peu plus larges que leur trait.
const carrelageRugosite: Draw = (c, s) => {
  const rand = random(7);
  const tile = s / 2;
  const level = (value: number) => Math.round(value * 255);
  for (let i = 0; i < 2; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      const v = level(0.28 + rand() * 0.04);
      c.fillStyle = `rgb(${v},${v},${v})`;
      c.fillRect(i * tile, j * tile, tile, tile);
      for (let k = 0; k < 60; k += 1) {
        const w = level(0.3 + rand() * 0.12);
        c.fillStyle = `rgba(${w},${w},${w},0.35)`;
        c.beginPath();
        c.ellipse(i * tile + rand() * tile, j * tile + rand() * tile, 6 + rand() * 24, 3 + rand() * 8, rand() * 3, 0, Math.PI * 2);
        c.fill();
      }
    }
  }
  const joint = level(0.85);
  c.fillStyle = `rgb(${joint},${joint},${joint})`;
  for (let k = 0; k <= 2; k += 1) {
    c.fillRect(k * tile - 3, 0, 6, s);
    c.fillRect(0, k * tile - 3, s, 6);
  }
};

/** Panneau d'OSB dessiné par la texture, en mètres (u, v) : l'inverse des répétitions du matériau. */
const OSB_SHEET = { u: 1 / GARAGE_MATERIALS.osb.repeat[0], v: 1 / GARAGE_MATERIALS.osb.repeat[1] } as const;

// OSB : copeaux de 6 à 16 cm sur 2 à 4,5 cm, couchés dans le sens de la grande longueur à ± 40°
// près, tons de paille clairs et proches (sous les ambiances colorées, l'ancien contraste se
// lisait en camouflage : luminance moyenne 146 → 183, écart type 22 → 14). Dessin en mètres,
// raccordé sur ses bords (le panneau de l'établi en montre plus d'une largeur), sans joint.
const osb: Draw = (c, s) => {
  const rand = random(11);
  c.fillStyle = '#d3b27f';
  c.fillRect(0, 0, s, s);
  const sx = s / OSB_SHEET.u;
  const sy = s / OSB_SHEET.v;
  const tones = ['#dfc192', '#c7a26b', '#e8cfa3', '#d4ad76', '#b8905a'] as const;
  for (let k = 0; k < 2200; k += 1) {
    const u = rand() * OSB_SHEET.u;
    const v = rand() * OSB_SHEET.v;
    const length = 0.06 + rand() * 0.1;
    const width = 0.02 + rand() * 0.025;
    const angle = Math.PI / 2 + (rand() - 0.5) * 1.4;
    const pick = rand();
    const tone = tones[pick < 0.3 ? 0 : pick < 0.55 ? 1 : pick < 0.75 ? 2 : pick < 0.92 ? 3 : 4];
    const alpha = 0.55 + rand() * 0.35;
    const edge = rand() < 0.4;
    const reach = length / 2;
    // Copie décalée d'un panneau près des bords : la texture se raccorde en répétition.
    for (const du of u < reach ? [0, OSB_SHEET.u] : u > OSB_SHEET.u - reach ? [0, -OSB_SHEET.u] : [0]) {
      for (const dv of v < reach ? [0, OSB_SHEET.v] : v > OSB_SHEET.v - reach ? [0, -OSB_SHEET.v] : [0]) {
        c.setTransform(sx, 0, 0, sy, (u + du) * sx, (v + dv) * sy);
        c.rotate(angle);
        c.globalAlpha = alpha;
        c.fillStyle = tone;
        c.fillRect(-length / 2, -width / 2, length, width);
        if (edge) {
          // Une arête un peu plus sombre : le copeau se lit posé sur les autres.
          c.globalAlpha = 0.25;
          c.fillStyle = '#8a6a40';
          c.fillRect(-length / 2, width / 2 - 0.003, length, 0.003);
        }
      }
    }
  }
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalAlpha = 1;
};

// Lambris de pin vertical des murs gauche et avant : 8 lames de 15 cm sur 1,2 m, veinées,
// rainures sombres, quelques nœuds.
const pin: Draw = (c, s) => {
  const rand = random(37);
  const planks = 8;
  const w = s / planks;
  for (let p = 0; p < planks; p += 1) {
    const r = 206 + Math.round((rand() - 0.5) * 26);
    c.fillStyle = `rgb(${r},${Math.round(r * 0.84)},${Math.round(r * 0.62)})`;
    c.fillRect(p * w, 0, w, s);
    c.strokeStyle = 'rgba(150,100,55,0.28)';
    c.lineWidth = 1;
    for (let v = 0; v < 7; v += 1) {
      const x = p * w + 4 + rand() * (w - 8);
      c.beginPath();
      c.moveTo(x, 0);
      for (let y = 0; y <= s; y += 24) c.lineTo(x + Math.sin(y / 50 + v + p) * 2.5, y);
      c.stroke();
    }
    for (let k = 0; k < 2; k += 1) {
      if (rand() < 0.4) continue;
      const x = p * w + 10 + rand() * (w - 20);
      const y = rand() * s;
      c.fillStyle = 'rgba(120,70,30,0.75)';
      c.beginPath();
      c.ellipse(x, y, 3 + rand() * 3, 5 + rand() * 4, 0, 0, Math.PI * 2);
      c.fill();
    }
    c.fillStyle = 'rgba(70,40,18,0.85)';
    c.fillRect(p * w, 0, 2, s);
  }
};

// Lambris du plafond : lames de bois chaud, veinées.
const lambris: Draw = (c, s) => {
  const rand = random(23);
  const planks = 8;
  const h = s / planks;
  for (let p = 0; p < planks; p += 1) {
    const base = 150 + Math.round(rand() * 30);
    c.fillStyle = `rgb(${base},${Math.round(base * 0.66)},${Math.round(base * 0.4)})`;
    c.fillRect(0, p * h, s, h);
    c.strokeStyle = `rgba(80,45,20,0.35)`;
    for (let v = 0; v < 6; v += 1) {
      c.beginPath();
      const y = p * h + rand() * h;
      c.moveTo(0, y);
      for (let x = 0; x <= s; x += 32) c.lineTo(x, y + Math.sin(x / 40 + v) * 2);
      c.stroke();
    }
    c.fillStyle = 'rgba(40,20,8,0.8)';
    c.fillRect(0, p * h, s, 2);
  }
};

// Façade de meuble blanc : trois tiroirs, joints et poignées sombres.
const tiroirs: Draw = (c, s) => {
  c.fillStyle = '#f4f2ee';
  c.fillRect(0, 0, s, s);
  c.fillStyle = '#8d8a86';
  c.fillRect(0, 0, 4, s);
  c.fillRect(s - 4, 0, 4, s);
  const rows = [0.06, 0.36, 0.66];
  for (const r of rows) {
    c.fillStyle = '#8d8a86';
    c.fillRect(0, r * s - 3, s, 3);
  }
  c.fillStyle = '#2a292d';
  c.fillRect(0, s * 0.95, s, s * 0.05);
};

// Crédence noire mate, ses deux bouts en escalier de carreaux blancs de 10 cm
// (quatre marches, bord pixelisé contre le mur blanc). Le dessin couvre 2,95 × 0,55 m.
const CREDENCE = { width: 2.95, height: 0.55, tile: 0.1, steps: [4, 3, 2, 1, 0, 0] } as const;
const credence: Draw = (c, s) => {
  const h = s * (CREDENCE.height / CREDENCE.width);
  const px = s / CREDENCE.width;
  const t = CREDENCE.tile * px;
  c.fillStyle = '#ece9e2';
  c.fillRect(0, 0, s, h);
  c.fillStyle = '#121114';
  const rows = Math.ceil(CREDENCE.height / CREDENCE.tile);
  for (let r = 0; r < rows; r += 1) {
    // Rang compté depuis le bas : les marches montent vers l'extérieur.
    const inset = (CREDENCE.steps[r] ?? 0) * t;
    const y = h - (r + 1) * t;
    c.fillRect(inset, y, s - 2 * inset, t + 1);
  }
  // Joints des carreaux blancs (visibles seulement hors du noir).
  c.globalCompositeOperation = 'darken';
  c.fillStyle = '#b9b4ab';
  for (let x = 0; x <= s; x += t) c.fillRect(x - 1, 0, 2, h);
  for (let y = h; y >= 0; y -= t) c.fillRect(0, y - 1, s, 2);
  c.globalCompositeOperation = 'source-over';
};

// Écran : en attendant la photo du dernier build livré, un dégradé de coucher de soleil.
const ecran: Draw = (c, s) => {
  const sky = c.createLinearGradient(0, 0, 0, s);
  sky.addColorStop(0, '#1b1446');
  sky.addColorStop(0.55, '#c2307a');
  sky.addColorStop(0.62, '#ffb347');
  sky.addColorStop(0.63, '#1a0f2a');
  sky.addColorStop(1, '#0a0614');
  c.fillStyle = sky;
  c.fillRect(0, 0, s, s);
  c.fillStyle = '#ffd36b';
  c.beginPath();
  c.arc(s / 2, s * 0.6, s * 0.17, Math.PI, 0);
  c.fill();
  c.strokeStyle = 'rgba(255,80,190,0.7)';
  c.lineWidth = 2;
  for (let k = 1; k < 9; k += 1) {
    const y = s * 0.63 + (s * 0.37 * k * k) / 64;
    c.beginPath();
    c.moveTo(0, y);
    c.lineTo(s, y);
    c.stroke();
  }
  for (let k = -8; k <= 8; k += 1) {
    c.beginPath();
    c.moveTo(s / 2 + k * s * 0.02, s * 0.63);
    c.lineTo(s / 2 + k * s * 0.16, s);
    c.stroke();
  }
};

// Veines de bois (bois, bois clair, caisses, solives) : fond blanc, la couleur vient du matériau.
// Stries sinueuses le long de u, d'une période entière sur la largeur (raccord exact), et quelques
// nœuds en ellipses concentriques ; tout ce qui passe un bord est redessiné de l'autre côté.
const veines: Draw = (c, s) => {
  const rand = random(41);
  c.fillStyle = '#ffffff';
  c.fillRect(0, 0, s, s);
  const tone = (t: number) => {
    const r = Math.round(216 - 32 * t);
    return `rgb(${r},${Math.round(207 - 38 * t)},${Math.round(196 - 44 * t)})`;
  };
  // Bandes larges et pâles : la luminance moyenne descend vers 0,85.
  for (let k = 0; k < 14; k += 1) {
    const y0 = rand() * s;
    const width = 10 + rand() * 18;
    c.globalAlpha = 0.28 + rand() * 0.2;
    c.fillStyle = tone(rand() * 0.4);
    for (const dy of [-s, 0, s]) c.fillRect(0, y0 + dy - width / 2, s, width);
  }
  c.globalAlpha = 1;
  for (let k = 0; k < 56; k += 1) {
    const y0 = rand() * s;
    const waves = [1 + Math.floor(rand() * 3), 2 + Math.floor(rand() * 4)] as const;
    const phases = [rand() * Math.PI * 2, rand() * Math.PI * 2] as const;
    const amplitude = 2 + rand() * 4;
    c.strokeStyle = tone(rand());
    c.lineWidth = 1 + rand() * 2;
    for (const dy of [-s, 0, s]) {
      c.beginPath();
      for (let x = 0; x <= s; x += 8) {
        const t = (x / s) * Math.PI * 2;
        const y = y0 + dy + amplitude * Math.sin(waves[0] * t + phases[0]) + 2 * Math.sin(waves[1] * t + phases[1]);
        if (x === 0) c.moveTo(x, y);
        else c.lineTo(x, y);
      }
      c.stroke();
    }
  }
  const knots = 3 + Math.floor(rand() * 2);
  for (let k = 0; k < knots; k += 1) {
    const x = rand() * s;
    const y = rand() * s;
    const rings = 3 + Math.floor(rand() * 3);
    const size = 12 + rand() * 18;
    for (let r = rings; r >= 1; r -= 1) {
      c.strokeStyle = tone(0.5 + (0.5 * r) / rings);
      c.lineWidth = 1.5;
      for (const dx of [-s, 0, s]) {
        for (const dy of [-s, 0, s]) {
          c.beginPath();
          c.ellipse(x + dx, y + dy, (size * 1.6 * r) / rings, (size * 0.5 * r) / rings, 0, 0, Math.PI * 2);
          c.stroke();
        }
      }
    }
    c.fillStyle = tone(1);
    for (const dx of [-s, 0, s]) for (const dy of [-s, 0, s]) {
      c.beginPath();
      c.ellipse(x + dx, y + dy, size * 0.3, size * 0.12, 0, 0, Math.PI * 2);
      c.fill();
    }
  }
};

/** Écrit une valeur de 0 à 1 par pixel (gris), en donnée linéaire. */
function fillData(c: CanvasRenderingContext2D, width: number, height: number, value: (x: number, y: number) => number): void {
  const image = c.createImageData(width, height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const v = Math.round(Math.min(1, Math.max(0, value(x, y))) * 255);
      const i = (y * width + x) * 4;
      image.data[i] = v;
      image.data[i + 1] = v;
      image.data[i + 2] = v;
      image.data[i + 3] = 255;
    }
  }
  c.putImageData(image, 0, 0);
}

// Rugosité du cuir des canapés (canal vert) : grain fin de 2 à 4 px entre 0,28 et 0,42, et trois
// ou quatre plis larges plus mats (0,5). Grain sur une grille qui divise la taille : raccord exact.
const cuir: Draw = (c, s) => {
  const rand = random(53);
  const fine = Array.from({ length: (s / 2) ** 2 }, () => rand());
  const coarse = Array.from({ length: (s / 4) ** 2 }, () => rand());
  const folds = Array.from({ length: 4 }, () => ({
    y: rand() * s,
    amplitude: 8 + rand() * 18,
    wave: 1 + Math.floor(rand() * 2),
    phase: rand() * Math.PI * 2,
    width: 4 + rand() * 5,
  }));
  fillData(c, s, s, (x, y) => {
    const grain = 0.6 * (fine[(y >> 1) * (s / 2) + (x >> 1)] ?? 0) + 0.4 * (coarse[(y >> 2) * (s / 4) + (x >> 2)] ?? 0);
    let v = 0.28 + 0.14 * grain;
    for (const fold of folds) {
      const centre = fold.y + fold.amplitude * Math.sin((x / s) * Math.PI * 2 * fold.wave + fold.phase);
      const d = Math.abs((((y - centre) % s) + s * 1.5) % s - s / 2);
      v += (0.5 - v) * Math.exp(-((d / fold.width) ** 2));
    }
    return v;
  });
};

// Crampons des pneus : blocs de 20 × 28 px en quinconce, au pas de 32 px (raccord exact), blancs
// sur des rainures grises ; la couleur vient du matériau.
const crampons: Draw = (c, s) => {
  c.fillStyle = '#8c8c8c';
  c.fillRect(0, 0, s, s);
  c.fillStyle = '#ffffff';
  const pitch = 32;
  for (let row = 0; row < s / pitch; row += 1) {
    const offset = (row % 2) * (pitch / 2);
    for (let col = 0; col < s / pitch; col += 1) {
      const x = col * pitch + offset + 6;
      const y = row * pitch + 2;
      for (const dx of [0, -s]) c.fillRect(x + dx, y, 20, 28);
    }
  }
};

// Capiton du pouf : alvéoles hexagonales de 32 px, centre clair, bord #6a6a6a. Huit rangées sur la
// hauteur (rapport √3 / 2 du canvas) : raccord exact dans les deux sens.
const nidAbeille: Draw = (c, s) => {
  const h = c.canvas.height;
  c.fillStyle = '#6a6a6a';
  c.fillRect(0, 0, s, h);
  const rows = 8;
  const px = s / 8;
  const py = h / rows;
  const radius = py / 1.5 - 1.6;
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      const cx = col * px + (row % 2) * (px / 2);
      const cy = row * py;
      for (const dx of [-s, 0, s]) {
        for (const dy of [-h, 0, h]) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < -px || x > s + px || y < -py || y > h + py) continue;
          const g = c.createRadialGradient(x, y, 0, x, y, radius);
          g.addColorStop(0, '#ffffff');
          g.addColorStop(0.7, '#d6d6d6');
          g.addColorStop(1, '#8a8a8a');
          c.fillStyle = g;
          c.beginPath();
          for (let k = 0; k < 6; k += 1) {
            const a = Math.PI / 6 + (k * Math.PI) / 3;
            if (k === 0) c.moveTo(x + radius * Math.cos(a), y + radius * Math.sin(a));
            else c.lineTo(x + radius * Math.cos(a), y + radius * Math.sin(a));
          }
          c.closePath();
          c.fill();
        }
      }
    }
  }
};

// Rugosité de la crédence (canal vert), alignée sur son dessin : carreaux mats (0,85), joints plus
// mats encore (0,95) au pas de 10 cm, comptés depuis le bas comme les carreaux. La vraie crédence est
// noire mate : brillante, elle renvoyait les néons en reflets qui n'existent pas dans le garage.
const credenceRugosite: Draw = (c, s) => {
  const h = c.canvas.height;
  const t = CREDENCE.tile * (s / CREDENCE.width);
  const level = (value: number) => Math.round(value * 255);
  const tile = level(0.85);
  c.fillStyle = `rgb(${tile},${tile},${tile})`;
  c.fillRect(0, 0, s, h);
  const joint = level(0.95);
  c.fillStyle = `rgb(${joint},${joint},${joint})`;
  for (let x = 0; x <= s; x += t) c.fillRect(x - 1, 0, 2, h);
  for (let y = h; y >= 0; y -= t) c.fillRect(0, y - 1, s, 2);
};

// Tache de contact (canal vert, linéaire) : pleine au centre, nulle sur le bord, coins arrondis.
// Posée en neuf cases (build.ts) : le centre de la texture couvre l'emprise de l'objet, ses bords
// la marge où l'ombre s'éteint.
const contact: Draw = (c, s) => {
  fillData(c, s, s, (x, y) => {
    const dx = Math.abs(((x + 0.5) / s) * 2 - 1);
    const dy = Math.abs(((y + 0.5) / s) * 2 - 1);
    const r = Math.min(1, Math.hypot(dx, dy));
    const t = 1 - r;
    return t * t * (3 - 2 * t);
  });
};

/**
 * Dessins : largeur du canvas, fonction, rapport hauteur / largeur quand il n'est pas carré, et
 * `true` pour une donnée (rugosité) qui n'est pas une couleur sRGB.
 */
const DRAWINGS: Record<GarageTextureId, [size: number, draw: Draw, ratio?: number, data?: boolean]> = {
  carrelage: [512, carrelage],
  carrelageRugosite: [512, carrelageRugosite, 1, true],
  osb: [512, osb],
  lambris: [512, lambris],
  pin: [512, pin],
  tiroirs: [256, tiroirs],
  credence: [1024, credence, CREDENCE.height / CREDENCE.width],
  credenceRugosite: [512, credenceRugosite, CREDENCE.height / CREDENCE.width, true],
  ecran: [512, ecran],
  veines: [512, veines],
  cuir: [256, cuir, 1, true],
  crampons: [256, crampons],
  nidAbeille: [256, nidAbeille, 222 / 256],
  contact: [128, contact, 1, true],
};

const cache = new Map<string, Texture>();

/** Texture du garage, dessinée une fois par page et partagée. */
export function garageTexture(id: GarageTextureId, repeat?: readonly [number, number]): Texture {
  const key = `${id}:${repeat?.join('x') ?? ''}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const [size, draw, ratio = 1, data = false] = DRAWINGS[id];
  const base = cache.get(`${id}:`) ?? texture(size, draw, !data, Math.round(size * ratio));
  cache.set(`${id}:`, base);
  let result: Texture = base;
  if (repeat) {
    result = base.clone();
    result.wrapS = RepeatWrapping;
    result.wrapT = RepeatWrapping;
    result.repeat.set(repeat[0], repeat[1]);
    result.needsUpdate = true;
  }
  cache.set(key, result);
  return result;
}

export type HaloKind = 'rond' | 'goutte' | 'cone' | 'nappe';

/** Cône de lumière dans la brume : étroit en haut, large et fondu en bas. */
function drawCone(c: CanvasRenderingContext2D, s: number): void {
  for (let y = 0; y < s; y += 1) {
    const t = y / (s - 1);
    const half = s * (0.05 + 0.45 * t);
    const alpha = Math.pow(1 - t, 1.3) * (0.35 + 0.65 * Math.min(1, t * 6));
    const g = c.createLinearGradient(s / 2 - half, 0, s / 2 + half, 0);
    g.addColorStop(0, 'rgba(255,255,255,0)');
    g.addColorStop(0.5, `rgba(255,255,255,${alpha.toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(s / 2 - half, y, half * 2, 1);
  }
}

/** Nappe de brume au ras du sol : dense en bas, fondue vers le haut et aux deux bouts, en volutes. */
function drawMist(c: CanvasRenderingContext2D, s: number): void {
  const rand = random(23);
  c.filter = 'blur(6px)';
  for (let k = 0; k < 90; k += 1) {
    const x = rand() * s;
    const y = s * (0.55 + rand() * 0.45);
    const r = s * (0.06 + rand() * 0.12);
    const edge = Math.min(1, Math.min(x, s - x) / (s * 0.22));
    const g = c.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,255,${(0.16 * edge).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.ellipse(x, y, r * 1.8, r * 0.7, 0, 0, Math.PI * 2);
    c.fill();
  }
  c.filter = 'none';
  // Fondu vers le haut : on retire la lumière progressivement.
  c.globalCompositeOperation = 'multiply';
  const fade = c.createLinearGradient(0, 0, 0, s);
  fade.addColorStop(0, 'rgb(0,0,0)');
  fade.addColorStop(0.45, 'rgb(40,40,40)');
  fade.addColorStop(1, 'rgb(255,255,255)');
  c.fillStyle = fade;
  c.fillRect(0, 0, s, s);
}

/**
 * Halo : `rond` (nappe douce) ou `goutte` (halo d'un spot sur un mur : haut arrondi et net juste
 * sous la retombée, cœur au premier tiers, fondu en pointe vers le bas). Deux gouttes voisines
 * dessinent un cœur, deux bosses en haut, pointe en bas. `cone` et `nappe` : brume (atmosphère).
 */
export function haloTexture(kind: HaloKind): Texture {
  const key = `halo:${kind}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = texture(
    256,
    (c, s) => {
      c.fillStyle = '#000';
      c.fillRect(0, 0, s, s);
      c.globalCompositeOperation = 'lighter';
      if (kind === 'cone') {
        drawCone(c, s);
        return;
      }
      if (kind === 'nappe') {
        drawMist(c, s);
        return;
      }
      if (kind === 'rond') {
        const g = c.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g;
        c.fillRect(0, 0, s, s);
        return;
      }
      c.filter = 'blur(3px)';
      c.beginPath();
      c.moveTo(s * 0.5, s * 0.97);
      c.bezierCurveTo(s * 0.36, s * 0.7, s * 0.06, s * 0.38, s * 0.1, s * 0.16);
      c.bezierCurveTo(s * 0.14, s * 0.02, s * 0.86, s * 0.02, s * 0.9, s * 0.16);
      c.bezierCurveTo(s * 0.94, s * 0.38, s * 0.64, s * 0.7, s * 0.5, s * 0.97);
      c.closePath();
      c.save();
      c.clip();
      c.translate(s * 0.5, s * 0.26);
      c.scale(1, 2.1);
      const g = c.createRadialGradient(0, 0, 0, 0, 0, s * 0.42);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.22)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g;
      c.fillRect(-s, -s, 2 * s, 2 * s);
      c.restore();
    },
    false,
  );
  result.minFilter = LinearFilter;
  result.generateMipmaps = false;
  cache.set(key, result);
  return result;
}
