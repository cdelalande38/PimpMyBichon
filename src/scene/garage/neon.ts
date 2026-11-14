// Enseignes néon en vrais tubes de verre, d'après l'alphabet filaire (src/data/neonAlphabet.ts).
//
// Le texte est composé en lignes centrales (une par trait), puis chaque ligne devient un tube de
// rayon constant : coudes cintrés en arc de cercle (pas de cassure), angles trop vifs pour être
// cintrés coupés en deux tubes qui se rejoignent bout à bout (comme le joint rond du SVG), bouts
// fermés par des demi-sphères. Tout est dans le plan XY, lu vers +x, centré sur l'origine ; le mur est
// en z = 0 et les tubes en sont décollés de leur rayon plus `wallGap`.
//
// La géométrie est indexée et ne porte que position, normal et uv (u : longueur le long du tube en
// mètres, v : tour du tube de 0 à 1, couture côté mur). Elle a un groupe par couleur de verre, dans
// l'ordre de `tubes` : un tableau de matériaux s'y branche, un matériau seul ignore les groupes.
// Rien n'est branché dans la scène ici.

import { BufferGeometry, Float32BufferAttribute } from 'three';
import {
  NEON_ALPHABET,
  NEON_BOLT,
  NEON_UNKNOWN_WIDTH,
  type NeonAlign,
  type NeonGlyph,
  type NeonLine,
  type NeonOrnament,
  type NeonStroke,
} from '../../data/neonAlphabet.ts';

export interface NeonSignOptions {
  /** Hauteur de capitale en mètres, pour une ligne de taille 1. */
  readonly capHeight?: number;
  /** Rayon du tube en mètres. */
  readonly tubeRadius?: number;
  /** Approche par défaut, en fraction de la hauteur de capitale de la ligne. */
  readonly tracking?: number;
  /** Espace de mot par défaut, en fraction de la hauteur de capitale de la ligne. */
  readonly wordSpacing?: number;
  /** Interligne par défaut : blanc entre la base d'une ligne et le haut de la suivante, en fraction de `capHeight`. */
  readonly lineGap?: number;
  /** Alignement des lignes, le long de l'axe incliné quand il y a une pente. */
  readonly align?: NeonAlign;
  /** Inclinaison en degrés (le haut part à droite). */
  readonly slant?: number;
  /** Nombre de côtés du tube. */
  readonly radialSegments?: number;
  /** Pas angulaire des courbes et des coudes, en degrés. */
  readonly bendStep?: number;
  /** Rayon de cintrage des coudes, en multiple du rayon du tube. */
  readonly bendRadius?: number;
  /** Jour entre le mur et le tube, en mètres. */
  readonly wallGap?: number;
  /** Bandes de chaque demi-sphère de bout. */
  readonly capRings?: number;
  readonly ornaments?: readonly NeonOrnament[];
}

type Vec2 = [number, number];

/** Ligne centrale d'un tube, en mètres, dans le repère de l'enseigne. */
export interface NeonCenterline {
  readonly tube: string;
  readonly color: string;
  readonly points: readonly (readonly [number, number])[];
  readonly closed: boolean;
}

export interface NeonStrokes {
  readonly strokes: readonly NeonCenterline[];
  /** Encombrement de l'enseigne, tubes compris. */
  readonly width: number;
  readonly height: number;
  readonly tubeRadius: number;
}

/** Plage d'index d'une couleur de verre (groupe `materialIndex` de la géométrie). */
export interface NeonTubeGroup {
  readonly color: string;
  readonly tubes: readonly string[];
  readonly start: number;
  readonly count: number;
  readonly materialIndex: number;
}

export interface NeonSign {
  readonly geometry: BufferGeometry;
  readonly width: number;
  readonly height: number;
  readonly triangles: number;
  readonly tubes: readonly NeonTubeGroup[];
}

const DEFAULTS = {
  capHeight: 0.18,
  tubeRadius: 0.008,
  tracking: 0.26,
  wordSpacing: 0.34,
  lineGap: 0.3,
  align: 'center' as NeonAlign,
  slant: 0,
  radialSegments: 8,
  bendStep: 20,
  bendRadius: 1.25,
  wallGap: 0.02,
  capRings: 2,
};

/** Au-delà de ce virage (degrés), un coude n'est plus cintré : deux tubes se rejoignent bout à bout. */
const SPLIT_TURN = 125;
/** Rayon de cintrage minimal, en multiple du rayon du tube : en dessous, l'intérieur du coude se pincerait. */
const MIN_BEND = 1.1;
const DEFAULT_COLOR = '#ffffff';
const DEFAULT_TUBE = 'neon';
const DEG = Math.PI / 180;

type Settings = typeof DEFAULTS & { ornaments: readonly NeonOrnament[] };

function settings(options: NeonSignOptions): Settings {
  const s: Settings = { ...DEFAULTS, ornaments: [] };
  for (const [key, value] of Object.entries(options)) if (value !== undefined) (s as Record<string, unknown>)[key] = value;
  s.radialSegments = Math.max(3, Math.round(s.radialSegments));
  s.capRings = Math.max(1, Math.round(s.capRings));
  s.bendStep = Math.min(45, Math.max(2, s.bendStep));
  return s;
}

// --- Composition : lignes centrales brutes ---------------------------------------------------------

interface RawStroke {
  tube: string;
  color: string;
  points: Vec2[];
  closed: boolean;
}

interface LineBox {
  /** Hauteur de capitale (m). */
  s: number;
  /** Abscisse du bord gauche à la ligne de base. */
  x: number;
  baseline: number;
  /** Largeur du dessin, sans la pente. */
  width: number;
  placed: { glyph: NeonGlyph; pen: number }[];
  tube: string;
  color: string;
}

const angleBetween = (ax: number, ay: number, bx: number, by: number): number =>
  Math.atan2(Math.abs(ax * by - ay * bx), ax * bx + ay * by);

/** Flèche admise entre un arc et sa corde, en fraction du rayon du tube : les grands arcs se découpent plus fin. */
const SAG = 0.08;

/** Pas angulaire d'un arc de rayon `radius` : `step` au plus, et une flèche d'au plus `sag`. */
const arcStep = (radius: number, step: number, sag: number): number =>
  radius <= sag ? step : Math.min(step, 2 * Math.acos(1 - sag / radius));

/**
 * Échantillonne un trait du cadratin : arcs à pas régulier, courbes de Bézier subdivisées selon leur
 * virage ; `sag` est la flèche admise, en unités du cadratin.
 */
function sampleStroke(stroke: NeonStroke, step: number, sag: number): { points: Vec2[]; closed: boolean } {
  let [x, y] = stroke.from;
  const points: Vec2[] = [[x, y]];
  for (const segment of stroke.path) {
    if ('line' in segment) {
      [x, y] = segment.line;
      points.push([x, y]);
    } else if ('arc' in segment) {
      const [cx, cy, r, from, to] = segment.arc;
      const n = Math.max(1, Math.ceil((Math.abs(to - from) * DEG) / arcStep(r, step, sag) - 1e-9));
      for (let i = 1; i <= n; i += 1) {
        const a = (from + ((to - from) * i) / n) * DEG;
        points.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
      }
      [x, y] = points[points.length - 1]!;
    } else {
      const [x1, y1, x2, y2, x3, y3] = segment.cubic;
      const x0 = x;
      const y0 = y;
      const at = (t: number): Vec2 => {
        const m = 1 - t;
        return [
          m * m * m * x0 + 3 * m * m * t * x1 + 3 * m * t * t * x2 + t * t * t * x3,
          m * m * m * y0 + 3 * m * m * t * y1 + 3 * m * t * t * y2 + t * t * t * y3,
        ];
      };
      const tangent = (t: number): Vec2 => {
        const m = 1 - t;
        return [
          3 * m * m * (x1 - x0) + 6 * m * t * (x2 - x1) + 3 * t * t * (x3 - x2),
          3 * m * m * (y1 - y0) + 6 * m * t * (y2 - y1) + 3 * t * t * (y3 - y2),
        ];
      };
      const split = (t0: number, t1: number, depth: number): void => {
        const tm = (t0 + t1) / 2;
        const [ax, ay] = tangent(t0);
        const [mx, my] = tangent(tm);
        const [bx, by] = tangent(t1);
        const turn = angleBetween(ax, ay, mx, my) + angleBetween(mx, my, bx, by);
        const [px, py] = at(t0);
        const [qx, qy] = at(t1);
        const flat = (Math.hypot(qx - px, qy - py) * turn) / 8 <= sag;
        if (depth < 10 && (depth < 2 || turn > step || !flat)) {
          split(t0, tm, depth + 1);
          split(tm, t1, depth + 1);
        } else points.push(at(t1));
      };
      split(0, 1, 0);
      x = x3;
      y = y3;
    }
  }
  return { points, closed: stroke.closed === true };
}

function layOut(lines: readonly (string | NeonLine)[], s: Settings): RawStroke[] {
  const k = Math.tan(s.slant * DEG);
  const step = s.bendStep * DEG;
  const boxes: LineBox[] = [];
  for (const item of lines) {
    const line: NeonLine = typeof item === 'string' ? { text: item } : item;
    const size = s.capHeight * (line.size ?? 1);
    const tracking = (line.tracking ?? s.tracking) * size;
    const word = (line.wordSpacing ?? s.wordSpacing) * size;
    const placed: LineBox['placed'] = [];
    let pen = 0;
    for (const char of line.text.toLocaleUpperCase('fr')) {
      if (char === ' ') {
        pen += word;
        continue;
      }
      const glyph = NEON_ALPHABET[char];
      if (glyph) placed.push({ glyph, pen });
      pen += (glyph ? glyph.width : NEON_UNKNOWN_WIDTH) * size + tracking;
    }
    const width = Math.max(0, pen - tracking);
    const previous = boxes[boxes.length - 1];
    const baseline = previous ? previous.baseline - (line.gapBefore ?? s.lineGap) * s.capHeight - size : 0;
    const shift = s.align === 'left' ? 0 : s.align === 'right' ? width : width / 2;
    boxes.push({ s: size, x: k * baseline - shift, baseline, width, placed, tube: line.tube ?? DEFAULT_TUBE, color: line.color ?? DEFAULT_COLOR });
  }

  const raw: RawStroke[] = [];
  for (const box of boxes) {
    for (const { glyph, pen } of box.placed) {
      for (const stroke of glyph.strokes) {
        const sampled = sampleStroke(stroke, step, (SAG * s.tubeRadius) / box.s);
        raw.push({
          tube: box.tube,
          color: box.color,
          closed: sampled.closed,
          points: sampled.points.map(([gx, gy]): Vec2 => [box.x + pen + gx * box.s + k * gy * box.s, box.baseline + gy * box.s]),
        });
      }
    }
  }

  const widest = boxes.reduce<LineBox | undefined>((best, b) => (!best || b.width > best.width ? b : best), undefined);
  for (const ornament of s.ornaments) {
    const box = boxes[ornament.line];
    if (!box || !widest) continue;
    const tube = ornament.tube ?? box.tube;
    const color = ornament.color ?? box.color;
    if (ornament.kind === 'bolt') {
      // Au milieu de la place libre entre le haut de la ligne et le bord droit de la ligne la plus large.
      const h = ornament.height * box.s;
      const end = box.x + box.width + k * box.s;
      const limit = widest.x + widest.width + k * (box.baseline - widest.baseline);
      const cx = Math.max((end + limit) / 2, end + 0.3 * h) + (ornament.nudge ?? 0) * box.s;
      const cy = box.baseline + ornament.lift * box.s;
      const sampled = sampleStroke(NEON_BOLT, step, (SAG * s.tubeRadius) / h);
      raw.push({ tube, color, closed: sampled.closed, points: sampled.points.map(([bx, by]): Vec2 => [cx + bx * h + k * by * h, cy + by * h]) });
    } else if (ornament.kind === 'underline') {
      const y = box.baseline - ornament.drop * box.s;
      const x0 = box.x + k * (y - box.baseline);
      raw.push({ tube, color, closed: false, points: [[x0, y], [x0 + box.width, y]] });
    } else {
      const gap = (ornament.gap ?? 0) * box.s;
      const cy = box.baseline + box.s / 2;
      const spread = ornament.spread * DEG;
      for (const side of [-1, 1]) {
        const ox = side < 0 ? box.x + (k * box.s) / 2 - gap : box.x + box.width + (k * box.s) / 2 + gap;
        const base = side < 0 ? Math.PI : 0;
        for (const radius of ornament.radii) {
          const r = radius * box.s;
          const n = Math.max(1, Math.ceil((2 * spread) / arcStep(r, step, SAG * s.tubeRadius) - 1e-9));
          const points: Vec2[] = [];
          for (let i = 0; i <= n; i += 1) {
            const a = base - spread + (2 * spread * i) / n;
            points.push([ox + r * Math.cos(a), cy + r * Math.sin(a)]);
          }
          raw.push({ tube, color, closed: false, points });
        }
      }
    }
  }
  return raw;
}

// --- Lignes centrales des tubes : coudes cintrés, angles vifs coupés ------------------------------

interface Centerline {
  tube: string;
  color: string;
  points: Vec2[];
  closed: boolean;
}

/** Virage en un sommet (radians) ; 0 pour un bout de trait ouvert. */
function turnAt(points: readonly Vec2[], closed: boolean, i: number): number {
  const n = points.length;
  if (!closed && (i === 0 || i === n - 1)) return 0;
  const p = points[(i - 1 + n) % n]!;
  const c = points[i]!;
  const q = points[(i + 1) % n]!;
  return angleBetween(c[0] - p[0], c[1] - p[1], q[0] - c[0], q[1] - c[1]);
}

/** Allongement de l'anneau en onglet pour un virage donné (le même que dans la gaine). */
const miterOf = (turn: number): number => 1 / Math.max(0.5, Math.cos(turn / 2));

const distance = (a: Vec2, b: Vec2): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

/** Découpe aux angles vifs, puis cintre les autres coudes. */
function refine(stroke: RawStroke, r: number, s: Settings): Centerline[] {
  const eps = r * 1e-3;
  const smooth = s.bendStep * DEG * 1.05 + 1e-3;
  const bend = r * s.bendRadius;
  const points: Vec2[] = [];
  for (const p of stroke.points) if (!points.length || distance(points[points.length - 1]!, p) > eps) points.push(p);
  let closed = stroke.closed;
  if (closed && points.length > 1 && distance(points[0]!, points[points.length - 1]!) <= eps) points.pop();
  if (points.length < 2) return [];
  if (closed && points.length < 3) closed = false;

  // Rayon de cintrage possible en chaque coude (la moitié d'un côté partagé avec un autre coude).
  const n = points.length;
  const split = new Set<number>();
  const turn = points.map((_, i) => turnAt(points, closed, i));
  turn.forEach((t, i) => {
    if (t > SPLIT_TURN * DEG) split.add(i);
  });
  const isCorner = (i: number): boolean => turn[i]! > smooth && !split.has(i);
  const trimOf = (i: number): number => {
    const t = turn[i]!;
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    // Un côté partagé avec un autre coude se coupe en deux ; sinon on garde un peu de droit.
    const share = (j: number): number => (isCorner(j) ? 0.5 : 0.9);
    const max = Math.min(distance(points[prev]!, points[i]!) * share(prev), distance(points[i]!, points[next]!) * share(next));
    return Math.min(bend * Math.tan(t / 2), max);
  };
  for (let i = 0; i < n; i += 1) if (isCorner(i) && trimOf(i) / Math.tan(turn[i]! / 2) < r * MIN_BEND) split.add(i);

  // Pièces d'un seul tenant entre les coupures.
  const pieces: { points: Vec2[]; closed: boolean; index: number[] }[] = [];
  if (closed && split.size === 0) pieces.push({ points, closed: true, index: points.map((_, i) => i) });
  else {
    const order = closed ? [...Array(n + 1).keys()].map((i) => (i + Math.min(...split)) % n) : [...Array(n).keys()];
    let current: number[] = [];
    order.forEach((i, rank) => {
      current.push(i);
      if (rank > 0 && rank < order.length - 1 && split.has(i)) {
        pieces.push({ points: current.map((j) => points[j]!), closed: false, index: current });
        current = [i];
      }
    });
    if (current.length > 1) pieces.push({ points: current.map((j) => points[j]!), closed: false, index: current });
  }

  return pieces.map((piece) => {
    const m = piece.points.length;
    const out: Vec2[] = [];
    piece.points.forEach((c, local) => {
      const i = piece.index[local]!;
      const interior = piece.closed || (local > 0 && local < m - 1);
      if (!interior || !isCorner(i)) {
        out.push(c);
        return;
      }
      const p = piece.points[(local - 1 + m) % m]!;
      const q = piece.points[(local + 1) % m]!;
      const t = turn[i]!;
      const la = distance(p, c);
      const lb = distance(c, q);
      const a: Vec2 = [(c[0] - p[0]) / la, (c[1] - p[1]) / la];
      const b: Vec2 = [(q[0] - c[0]) / lb, (q[1] - c[1]) / lb];
      const d = trimOf(i);
      const radius = d / Math.tan(t / 2);
      const side = a[0] * b[1] - a[1] * b[0] >= 0 ? 1 : -1;
      const t1: Vec2 = [c[0] - a[0] * d, c[1] - a[1] * d];
      const centre: Vec2 = [t1[0] - side * radius * a[1], t1[1] + side * radius * a[0]];
      const start = Math.atan2(t1[1] - centre[1], t1[0] - centre[0]);
      const steps = Math.max(1, Math.ceil(t / (s.bendStep * DEG) - 1e-9));
      for (let j = 0; j <= steps; j += 1) {
        const angle = start + (side * t * j) / steps;
        out.push([centre[0] + radius * Math.cos(angle), centre[1] + radius * Math.sin(angle)]);
      }
    });
    const clean: Vec2[] = [];
    for (const p of out) if (!clean.length || distance(clean[clean.length - 1]!, p) > eps) clean.push(p);
    if (piece.closed && clean.length > 1 && distance(clean[0]!, clean[clean.length - 1]!) <= eps) clean.pop();
    return { tube: stroke.tube, color: stroke.color, points: clean, closed: piece.closed };
  }).filter((c) => c.points.length >= 2);
}

function centerlines(lines: readonly (string | NeonLine)[], s: Settings): { strokes: Centerline[]; width: number; height: number } {
  const r = s.tubeRadius;
  const strokes = layOut(lines, s).flatMap((raw) => refine(raw, r, s));
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  // Encombrement : le rayon du tube autour de chaque point, allongé de l'onglet dans les courbes.
  for (const stroke of strokes) {
    stroke.points.forEach(([x, y], i) => {
      const e = r * miterOf(turnAt(stroke.points, stroke.closed, i));
      minX = Math.min(minX, x - e);
      maxX = Math.max(maxX, x + e);
      minY = Math.min(minY, y - e);
      maxY = Math.max(maxY, y + e);
    });
  }
  if (!strokes.length) return { strokes, width: 0, height: 0 };
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  // Copies : un point de coupure est partagé par les deux tubes qui s'y rejoignent.
  const centered = strokes.map((stroke) => ({ ...stroke, points: stroke.points.map(([x, y]): Vec2 => [x - cx, y - cy]) }));
  return { strokes: centered, width: maxX - minX, height: maxY - minY };
}

/** Lignes centrales des tubes, en mètres, telles que `neonSign` les gaine (halo, support, vérification). */
export function neonStrokes(lines: readonly (string | NeonLine)[], options: NeonSignOptions = {}): NeonStrokes {
  const s = settings(options);
  const { strokes, width, height } = centerlines(lines, s);
  return { strokes, width, height, tubeRadius: s.tubeRadius };
}

// --- Gaine : tubes, coudes et bouts ronds ----------------------------------------------------------

class Mesher {
  readonly position: number[] = [];
  readonly normal: number[] = [];
  readonly uv: number[] = [];
  readonly index: number[] = [];

  private readonly radius: number;
  private readonly z: number;
  private readonly sides: number;
  private readonly capRings: number;

  constructor(radius: number, z: number, sides: number, capRings: number) {
    this.radius = radius;
    this.z = z;
    this.sides = sides;
    this.capRings = capRings;
  }

  private vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): void {
    this.position.push(x, y, z);
    this.normal.push(nx, ny, nz);
    this.uv.push(u, v);
  }

  /**
   * Anneau autour du point (x, y), perpendiculaire à la tangente t. `miter` allonge l'anneau dans le
   * plan du coude pour garder le rayon constant de part et d'autre ; `lat` et `along` font les
   * anneaux des bouts ronds (latitude, sens vers l'extérieur du bout). Renvoie l'index du premier sommet.
   */
  private ring(x: number, y: number, tx: number, ty: number, u: number, miter = 1, lat = 0, along = 0): number {
    const first = this.position.length / 3;
    const r = this.radius;
    const nx = -ty;
    const ny = tx;
    const cosL = Math.cos(lat);
    const sinL = Math.sin(lat) * along;
    for (let j = 0; j <= this.sides; j += 1) {
      const phi = (2 * Math.PI * j) / this.sides;
      const sp = Math.sin(phi);
      const cp = Math.cos(phi);
      const dx = cosL * sp * nx + sinL * tx;
      const dy = cosL * sp * ny + sinL * ty;
      const dz = -cosL * cp;
      this.vertex(
        x + r * (cosL * sp * miter * nx + sinL * tx),
        y + r * (cosL * sp * miter * ny + sinL * ty),
        this.z + r * dz,
        dx,
        dy,
        dz,
        u + r * Math.sin(lat) * along,
        j / this.sides,
      );
    }
    return first;
  }

  /** Bande entre deux anneaux, le premier en arrière le long du tube : faces tournées vers l'extérieur. */
  private band(a: number, b: number): void {
    for (let j = 0; j < this.sides; j += 1) this.index.push(a + j, a + j + 1, b + j, a + j + 1, b + j + 1, b + j);
  }

  /** Demi-sphère de bout ; `along` = −1 au départ, +1 à l'arrivée. Renvoie les anneaux, du tube vers le pôle. */
  private cap(x: number, y: number, tx: number, ty: number, u: number, along: -1 | 1, equator: number): void {
    const rings = [equator];
    for (let i = 1; i < this.capRings; i += 1) rings.push(this.ring(x, y, tx, ty, u, 1, (i * Math.PI) / 2 / this.capRings, along));
    const pole = this.position.length / 3;
    for (let j = 0; j < this.sides; j += 1) {
      this.vertex(x + this.radius * tx * along, y + this.radius * ty * along, this.z, tx * along, ty * along, 0, u + this.radius * along, (j + 0.5) / this.sides);
    }
    for (let i = 1; i < rings.length; i += 1) {
      if (along > 0) this.band(rings[i - 1]!, rings[i]!);
      else this.band(rings[i]!, rings[i - 1]!);
    }
    const last = rings[rings.length - 1]!;
    for (let j = 0; j < this.sides; j += 1) {
      if (along > 0) this.index.push(last + j, last + j + 1, pole + j);
      else this.index.push(pole + j, last + j + 1, last + j);
    }
  }

  tube(points: readonly Vec2[], closed: boolean): void {
    const n = points.length;
    const rings: number[] = [];
    let u = 0;
    const tangent = (i: number): { tx: number; ty: number; miter: number } => {
      const hasPrev = closed || i > 0;
      const hasNext = closed || i < n - 1;
      const c = points[i]!;
      let ax = 0;
      let ay = 0;
      let bx = 0;
      let by = 0;
      if (hasPrev) {
        const p = points[(i - 1 + n) % n]!;
        const l = distance(p, c);
        ax = (c[0] - p[0]) / l;
        ay = (c[1] - p[1]) / l;
      }
      if (hasNext) {
        const q = points[(i + 1) % n]!;
        const l = distance(c, q);
        bx = (q[0] - c[0]) / l;
        by = (q[1] - c[1]) / l;
      }
      const sx = ax + bx;
      const sy = ay + by;
      const l = Math.hypot(sx, sy) || 1;
      const tx = sx / l;
      const ty = sy / l;
      const miter = hasPrev && hasNext ? miterOf(2 * Math.acos(Math.min(1, tx * ax + ty * ay))) : 1;
      return { tx, ty, miter };
    };
    for (let i = 0; i < n; i += 1) {
      if (i > 0) u += distance(points[i - 1]!, points[i]!);
      const { tx, ty, miter } = tangent(i);
      rings.push(this.ring(points[i]![0], points[i]![1], tx, ty, u, miter));
    }
    if (closed) {
      u += distance(points[n - 1]!, points[0]!);
      const { tx, ty, miter } = tangent(0);
      rings.push(this.ring(points[0]![0], points[0]![1], tx, ty, u, miter));
    }
    for (let i = 1; i < rings.length; i += 1) this.band(rings[i - 1]!, rings[i]!);
    if (!closed) {
      const start = tangent(0);
      const end = tangent(n - 1);
      this.cap(points[0]![0], points[0]![1], start.tx, start.ty, 0, -1, rings[0]!);
      this.cap(points[n - 1]![0], points[n - 1]![1], end.tx, end.ty, u, 1, rings[n - 1]!);
    }
  }
}

/**
 * Enseigne néon en tubes : lignes de texte (capitales, chiffres, quelques signes ; minuscules
 * passées en capitales ; caractère inconnu sauté, sa place gardée), ornements éventuels.
 */
export function neonSign(lines: readonly (string | NeonLine)[], options: NeonSignOptions = {}): NeonSign {
  const s = settings(options);
  const { strokes, width, height } = centerlines(lines, s);
  const colors: string[] = [];
  for (const stroke of strokes) if (!colors.includes(stroke.color)) colors.push(stroke.color);

  const position: number[] = [];
  const normal: number[] = [];
  const uv: number[] = [];
  const index: number[] = [];
  const tubes: NeonTubeGroup[] = [];
  colors.forEach((color, materialIndex) => {
    const mesher = new Mesher(s.tubeRadius, s.wallGap + s.tubeRadius, s.radialSegments, s.capRings);
    const names: string[] = [];
    for (const stroke of strokes) {
      if (stroke.color !== color) continue;
      if (!names.includes(stroke.tube)) names.push(stroke.tube);
      mesher.tube(stroke.points, stroke.closed);
    }
    const offset = position.length / 3;
    tubes.push({ color, tubes: names, start: index.length, count: mesher.index.length, materialIndex });
    for (const i of mesher.index) index.push(i + offset);
    position.push(...mesher.position);
    normal.push(...mesher.normal);
    uv.push(...mesher.uv);
  });

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(position, 3));
  geometry.setAttribute('normal', new Float32BufferAttribute(normal, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(index);
  for (const group of tubes) geometry.addGroup(group.start, group.count, group.materialIndex);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, width, height, triangles: index.length / 3, tubes };
}
