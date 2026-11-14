// Textures du garage, dessinées au canvas au premier usage : aucune image importée (§ 8,
// « textures créées »). Motifs originaux ; rien n'est copié d'une photo.

import { CanvasTexture, LinearFilter, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import type { GarageTextureId } from '../../data/garage.ts';

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

// OSB : copeaux allongés orientés, tons de paille et de miel. Un panneau par texture.
const osb: Draw = (c, s) => {
  const rand = random(11);
  c.fillStyle = '#c49a62';
  c.fillRect(0, 0, s, s);
  for (let k = 0; k < 1400; k += 1) {
    const x = rand() * s;
    const y = rand() * s;
    const w = 10 + rand() * 38;
    const h = 3 + rand() * 9;
    const tone = rand();
    c.save();
    c.translate(x, y);
    c.rotate((rand() - 0.5) * 1.2);
    c.fillStyle = tone < 0.33 ? '#a87a45' : tone < 0.66 ? '#d8b07a' : '#8f6436';
    c.globalAlpha = 0.55 + rand() * 0.4;
    c.fillRect(-w / 2, -h / 2, w, h);
    c.restore();
  }
  c.globalAlpha = 1;
  c.fillStyle = 'rgba(60,40,20,0.7)';
  c.fillRect(0, 0, s, 3);
  c.fillRect(0, 0, 3, s);
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

// Crédence noire légèrement brillante, ses deux bouts en escalier de carreaux blancs de 10 cm
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

// Toile pop art : quatre cases de couleurs franches, trame de points, éclair.
const popart: Draw = (c, s) => {
  const colors = ['#ffd400', '#00b7ff', '#ff2d8a', '#7cff3a'];
  const half = s / 2;
  colors.forEach((color, index) => {
    const x = (index % 2) * half;
    const y = Math.floor(index / 2) * half;
    c.fillStyle = color;
    c.fillRect(x, y, half, half);
    c.fillStyle = 'rgba(0,0,0,0.18)';
    for (let i = 6; i < half; i += 14) {
      for (let j = 6; j < half; j += 14) {
        c.beginPath();
        c.arc(x + i, y + j, 3, 0, Math.PI * 2);
        c.fill();
      }
    }
    c.fillStyle = '#111';
    c.beginPath();
    c.moveTo(x + half * 0.55, y + half * 0.12);
    c.lineTo(x + half * 0.3, y + half * 0.55);
    c.lineTo(x + half * 0.48, y + half * 0.55);
    c.lineTo(x + half * 0.4, y + half * 0.88);
    c.lineTo(x + half * 0.72, y + half * 0.42);
    c.lineTo(x + half * 0.54, y + half * 0.42);
    c.closePath();
    c.fill();
  });
};

// Cible de fléchettes : secteurs alternés, anneaux rouges et verts.
const cible: Draw = (c, s) => {
  const r = s / 2;
  c.fillStyle = '#111';
  c.fillRect(0, 0, s, s);
  for (let k = 0; k < 20; k += 1) {
    c.beginPath();
    c.moveTo(r, r);
    c.arc(r, r, r * 0.92, (k * Math.PI) / 10, ((k + 1) * Math.PI) / 10);
    c.closePath();
    c.fillStyle = k % 2 ? '#efe4c8' : '#1a1a1a';
    c.fill();
  }
  for (const [radius, width] of [
    [0.9, 0.06],
    [0.56, 0.05],
  ] as const) {
    c.lineWidth = r * width;
    c.strokeStyle = '#c4161c';
    c.beginPath();
    c.arc(r, r, r * radius, 0, Math.PI * 2);
    c.stroke();
  }
  c.fillStyle = '#1e8a3a';
  c.beginPath();
  c.arc(r, r, r * 0.09, 0, Math.PI * 2);
  c.fill();
  c.fillStyle = '#c4161c';
  c.beginPath();
  c.arc(r, r, r * 0.04, 0, Math.PI * 2);
  c.fill();
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
  ecran: [512, ecran],
  popart: [512, popart],
  cible: [256, cible],
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

/** Enseigne néon : lettres blanches sur fond noir (la couleur vient du matériau). */
export function signTexture(text: string): { texture: Texture; aspect: number } {
  const key = `enseigne:${text}`;
  const height = 128;
  const font = `${Math.round(height * 0.72)}px "Russo One", "Chakra Petch", sans-serif`;
  const measure = document.createElement('canvas').getContext('2d');
  if (measure) measure.font = font;
  const width = Math.ceil((measure?.measureText(text).width ?? text.length * 70) + height * 0.6);
  const cached = cache.get(key);
  if (cached) return { texture: cached, aspect: width / height };
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const c = canvas.getContext('2d');
  if (c) {
    c.fillStyle = '#000';
    c.fillRect(0, 0, width, height);
    c.font = font;
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.shadowColor = '#fff';
    c.shadowBlur = 18;
    c.strokeStyle = 'rgba(255,255,255,0.5)';
    c.lineWidth = 10;
    c.strokeText(text, width / 2, height / 2);
    c.shadowBlur = 0;
    c.fillStyle = '#fff';
    c.fillText(text, width / 2, height / 2);
  }
  const result = new CanvasTexture(canvas);
  cache.set(key, result);
  return { texture: result, aspect: width / height };
}
