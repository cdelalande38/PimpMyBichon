// Constructeur des formes du décor (vocabulaire : src/data/garageShapes.ts). Module pur : three
// seul, sans navigateur, utilisable sous Vitest. Déterministe : aucun hasard, mêmes paramètres,
// mêmes sommets.
//
// Ce que rend shapeGeometry : une BufferGeometry indexée qui porte exactement position, normal
// et uv (aucun groupe), prête à fusionner avec les autres formes et avec l'existant
// (mergeGeometries). Coordonnées de texture en mètres (1 unité = 1 m le long de la surface) :
// les matériaux répètent leurs textures par mètre. Normales lisses sur les parties courbes et
// les arrondis, arêtes franches là où la forme en a. Triangles tournés vers l'extérieur ; surface
// fermée pour toutes les formes, sauf un profil tourné qui ne rejoint pas l'axe (abat-jour).
//
// Repères (axe y par défaut, x et z sur demande ; la rotation envoie +y sur +x ou sur +z, le bout
// « haut » d'un cône ou d'un profil suit donc l'axe positif ; seul le cylindre d'origine garde la
// rotation de partGeometry, sans effet sur sa forme) :
//   box       centré ; largeur x, hauteur y, profondeur z.
//             { box: [1.2, 0.9, 0.6], bevel: 0.01 }  meuble bas, arêtes de 1 cm
//   cylinder  centré ; rayon du bas, hauteur ; top : rayon du haut (bout positif de l'axe).
//             { cylinder: [0.2, 0.05], top: 0.18, bevel: 0.008 }  tabouret
//   sphere    centrée ; scale étire les trois axes (ellipsoïde).
//             { sphere: 0.13, scale: [1, 1.1, 1.2] }  coque de casque
//   capsule   centrée ; rayon, longueur totale (calottes comprises), au moins deux rayons.
//             { capsule: [0.02, 0.4], axis: 'x' }  poignée
//   torus     centré ; rayon du cercle médian, rayon du tube ; arc : tore ouvert de 0 à arc,
//             compté depuis +z vers +x autour de l'axe (comme les profils tournés), bouts fermés.
//             { torus: [0.3, 0.1], axis: 'x' }  pneu
//   cushion   centré ; comme box, les deux grandes faces (perpendiculaires à la plus petite
//             cote) bombent de puff : la boîte englobante gagne puff de chaque côté sur cet axe.
//             { cushion: [0.6, 0.16, 0.6], bevel: 0.05, puff: 0.025 }  assise
//   lathe     points (rayon, hauteur) dans le repère de la pièce, tournés autour de l'axe ; le
//             profil se lit de bas en haut sur sa face extérieure (il est retourné s'il est donné
//             à l'envers). Un profil qui part de l'axe et y revient donne un solide fermé ; sinon
//             une surface ouverte vue de l'extérieur. Un profil bouclé (dernier point égal au
//             premier) est une section fermée tournée : bague, visière épaisse. arc : secteur de
//             0 à arc, compté depuis +z vers +x ; un solide en secteur est fermé par ses flancs.
//             { lathe: [[0, 0], [0.12, 0], [0.12, 0.01], [0.03, 0.05], [0.03, 0.4]] }  pied de lampe
//   extrude   contour fermé, vu depuis le bout positif de l'axe : u vers la droite, v vers le
//             haut, sens trigonométrique (retourné s'il est donné à l'envers ; les trous, en sens
//             inverse, le sont aussi). Plan du contour : axe z → (u, v) = (x, y) ; axe x →
//             (u, v) = (−z, y) ; axe y → (u, v) = (x, −z). Épaisseur depth centrée sur le plan.
//             bevel arrondit les deux bords (le contour garde ses cotes, l'arrondi rentre dedans).
//             { extrude: roundedRectContour(1.2, 0.7, 0.04), depth: 0.04, bevel: 0.01 }  écran
//   tube      points dans le repère de la pièce ; rayon constant ; smooth remplace chaque coude
//             par un arc de rayon 3 × radius (moins si les segments sont courts) ; closed relie le
//             dernier point au premier. Bouts d'un tube ouvert fermés à plat.
//             { tube: [[0, 0, 0], [0, 0.8, 0], [0.4, 0.8, 0]], radius: 0.015, smooth: true }  cadre
//
// Arêtes et normales : un sommet de contour (extrude) ou de profil (lathe) dont l'angle dépasse
// 40° est une arête franche ; en dessous, la surface est lissée. Un arc donné à la main doit donc
// avancer par pas de moins de 40° (roundedRectContour avance par 30° au plus).
//
// Budgets par défaut (detail = 1 ; n = côtés d'une forme de révolution, 12 + 40 × rayon ramené au
// multiple de 4, de 12 à 40 : 16 à 5 cm, 20 à 20 cm, 24 à 30 cm ; detail multiplie n et les pas
// d'arrondi ; un pas d'arrondi vaut 45° jusqu'à 15 mm de rayon, 30° jusqu'à 5 cm, 22,5° au-delà) :
//   box          12 triangles ; arrondi ≤ 15 mm : 108 ; plus grand : 300
//   cylinder     80 (forme d’origine, 20 côtés) ; top seul : 4n ; arrondi ≤ 15 mm, coin droit : 12n (192 à
//                5 cm de rayon) ; plus grand : 16n à 20n
//   sphere       396 (forme d'origine, 18 × 12) ; avec scale ou detail : 352 (16 × 12)
//   capsule      4n × pas d'une calotte (2 à 4) : 192 pour une poignée de 2 cm
//   torus        2 × 12 × n (12 côtés de tube ; n pris sur le rayon extérieur) : 672 pour un pneu
//                de 40 cm, 384 pour un anneau de 10 cm ; en chrome, detail 2 (voir le studio)
//   cushion      576 (arrondi de 2 à 5 cm), 288 pour un arrondi ≤ 15 mm
//   lathe        2n × segments du profil (une arête franche ne coûte rien)
//   extrude      2 × (sommets − 2 + 2 × trous) pour les faces, plus 2 × sommets × (1 + 2 × pas
//                de l'arrondi) pour les flancs
//   tube         2m par segment de la ligne (m = 8 + 40 × rayon ramené au multiple de 4, de 8 à
//                24), arcs des coudes compris (2 à 4 segments par coude)
// Le décor entier doit tenir sous 80 000 triangles (§ 8).
//
// Paramètres dégénérés : un arrondi plus grand que la demi-arête est ramené à la demi-arête ;
// une capsule plus courte que deux rayons devient une sphère ; un contour ou un profil donné à
// l'envers est retourné ; un point répété est ignoré. Un pavé sans épaisseur, un profil collé à
// l'axe, un contour de moins de trois points, un tube qui fait demi-tour, un tore dont le tube
// dépasse le cercle sont refusés par une erreur qui nomme la forme et le paramètre.

import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  Float32BufferAttribute,
  Matrix4,
  Quaternion,
  ShapeUtils,
  SphereGeometry,
  Vector2,
  Vector3,
} from 'three';
import type { Axis, GarageShape, Vec2, Vec3 } from '../../data/garageShapes.ts';

const TAU = Math.PI * 2;
/** Au-delà de cet angle entre deux segments d'un contour ou d'un profil, l'arête est franche. */
const CREASE = (40 * Math.PI) / 180;
/** Rayon sous lequel un point de profil est sur l'axe (pôle). */
const POLE = 1e-7;
/** Distance sous laquelle deux points donnés sont confondus. */
const SAME = 1e-7;
/** Double de l'aire sous lequel un triangle est dégénéré (pôles, plats de longueur nulle). */
const DEGENERATE = 1e-12;

// ————————————————————————————————————————————————————————————————————————————————
// Outils communs

function fail(kind: string, message: string): never {
  throw new Error(`Forme « ${kind} » : ${message}`);
}

function positive(kind: string, name: string, value: number): number {
  if (!Number.isFinite(value) || value <= 0) fail(kind, `${name} doit être un nombre positif (reçu ${value})`);
  return value;
}

function nonNegative(kind: string, name: string, value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) fail(kind, `${name} doit être un nombre positif ou nul (reçu ${value})`);
  return value;
}

function detailOf(kind: string, detail: number | undefined): number {
  if (detail === undefined) return 1;
  return Math.min(4, Math.max(0.25, positive(kind, 'detail', detail)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Multiple de 4 le plus proche (au moins 8) : les quatre points cardinaux tombent sur un sommet. */
function quarters(count: number): number {
  return Math.max(8, 4 * Math.round(count / 4));
}

/** Côtés d'une forme de révolution : 12 pour un petit rayon, 40 au-delà de 70 cm. */
function radialSegments(radius: number, detail: number): number {
  return quarters(clamp(12 + 40 * radius, 12, 40) * detail);
}

/** Côtés d'un tube : 8 pour un fil, 24 au plus. */
function tubeSegments(radius: number, detail: number): number {
  return quarters(clamp(8 + 40 * radius, 8, 24) * detail);
}

/** Pas angulaire d'un arrondi : grossier sur un rayon de quelques millimètres, fin au-delà de 5 cm. */
function arcStep(radius: number, detail: number): number {
  const base = radius <= 0.015 ? Math.PI / 4 : radius <= 0.05 ? Math.PI / 6 : Math.PI / 8;
  return base / detail;
}

function arcSteps(angle: number, radius: number, detail: number): number {
  return Math.max(1, Math.ceil(angle / arcStep(radius, detail) - 1e-6));
}

/** Rotation qui envoie +y sur l'axe demandé (formes de révolution). */
function fromY(axis: Axis | undefined): Matrix4 | null {
  if (axis === 'x') return new Matrix4().makeRotationZ(-Math.PI / 2);
  if (axis === 'z') return new Matrix4().makeRotationX(Math.PI / 2);
  return null;
}

/** Rotation qui envoie +z sur l'axe demandé (extrusions). */
function fromZ(axis: Axis | undefined): Matrix4 | null {
  if (axis === 'x') return new Matrix4().makeRotationY(Math.PI / 2);
  if (axis === 'y') return new Matrix4().makeRotationX(-Math.PI / 2);
  return null;
}

function oriented(geometry: BufferGeometry, matrix: Matrix4 | null): BufferGeometry {
  return matrix ? geometry.applyMatrix4(matrix) : geometry;
}

/** Accumule sommets et triangles ; rend une géométrie indexée position / normal / uv. */
class Builder {
  private readonly position: number[] = [];
  private readonly normal: number[] = [];
  private readonly uv: number[] = [];
  private readonly index: number[] = [];
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly c = new Vector3();

  vertex(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number): number {
    const length = Math.hypot(nx, ny, nz) || 1;
    this.position.push(x, y, z);
    this.normal.push(nx / length, ny / length, nz / length);
    this.uv.push(u, v);
    return this.position.length / 3 - 1;
  }

  private cross(i: number, j: number, k: number): Vector3 {
    const p = this.position;
    this.a.set(p[i * 3]!, p[i * 3 + 1]!, p[i * 3 + 2]!);
    this.b.set(p[j * 3]! - this.a.x, p[j * 3 + 1]! - this.a.y, p[j * 3 + 2]! - this.a.z);
    this.c.set(p[k * 3]! - this.a.x, p[k * 3 + 1]! - this.a.y, p[k * 3 + 2]! - this.a.z);
    return this.b.cross(this.c);
  }

  /** Triangle i j k, sens trigonométrique vu de l'extérieur ; ignoré s'il est d'aire nulle. */
  triangle(i: number, j: number, k: number): void {
    if (this.cross(i, j, k).length() > DEGENERATE) this.index.push(i, j, k);
  }

  /** Quadrilatère i j k l (sens trigonométrique vu de l'extérieur). */
  quad(i: number, j: number, k: number, l: number): void {
    this.triangle(i, j, k);
    this.triangle(i, k, l);
  }

  /** Triangle retourné au besoin pour que sa face regarde `toward` (faces planes : bouchons, flancs). */
  facing(i: number, j: number, k: number, toward: Vector3): void {
    const normal = this.cross(i, j, k);
    if (normal.length() <= DEGENERATE) return;
    if (normal.dot(toward) >= 0) this.index.push(i, j, k);
    else this.index.push(i, k, j);
  }

  geometry(): BufferGeometry {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(this.position, 3));
    geometry.setAttribute('normal', new Float32BufferAttribute(this.normal, 3));
    geometry.setAttribute('uv', new Float32BufferAttribute(this.uv, 2));
    geometry.setIndex(this.index);
    return geometry;
  }
}

/** Nombre de triangles d'une géométrie indexée ou non. */
export function triangleCount(geometry: BufferGeometry): number {
  const index = geometry.getIndex();
  return (index ? index.count : geometry.getAttribute('position').count) / 3;
}

// ————————————————————————————————————————————————————————————————————————————————
// Formes de révolution : un profil (rayon, hauteur, normale) tourné autour de y.

interface ProfilePoint {
  r: number;
  y: number;
  nr: number;
  ny: number;
}

/** Deux points de profil consécutifs au même endroit marquent une arête franche. */
function samePlace(a: ProfilePoint, b: ProfilePoint): boolean {
  return Math.abs(a.r - b.r) < SAME && Math.abs(a.y - b.y) < SAME;
}

/**
 * Tourne le profil de 0 à `arc` autour de y, en partant de +z vers +x. Coordonnées de texture :
 * - bande plate perpendiculaire à l'axe (fond, dessus) : projection plane (x, z), en mètres ;
 * - ailleurs : v = longueur parcourue le long du profil, u = angle × rayon moyen de la portion
 *   courbe (entre deux arêtes franches ou deux fonds plats). Des mètres en moyenne, sans
 *   cisaillement : un rayon propre à chaque anneau tordrait la texture en spirale. Un pôle (point
 *   sur l'axe) prend le milieu de chaque secteur, pour que la texture ne s'y écrase pas.
 * `loop` : le profil est une boucle fermée (tore).
 */
function revolve(builder: Builder, profile: readonly ProfilePoint[], segments: number, arc: number, loop: boolean): void {
  const lengths = [0];
  for (let i = 1; i < profile.length; i += 1) {
    const a = profile[i - 1]!;
    const b = profile[i]!;
    lengths.push(lengths[i - 1]! + Math.hypot(b.r - a.r, b.y - a.y));
  }
  const bands = profile.length - 1;
  const kinds = Array.from({ length: bands }, (_, i) => {
    const a = profile[i]!;
    const b = profile[i + 1]!;
    if (samePlace(a, b)) return 'vide';
    return Math.abs(a.ny) > 0.999 && Math.abs(b.ny) > 0.999 && Math.abs(a.y - b.y) < SAME ? 'plate' : 'courbe';
  });
  // Rayon moyen (pondéré par la longueur) de chaque suite de bandes courbes.
  const mean: number[] = new Array<number>(bands).fill(0);
  for (let start = 0; start < bands; ) {
    if (kinds[start] !== 'courbe') {
      start += 1;
      continue;
    }
    let end = start;
    while (end + 1 < bands && kinds[end + 1] === 'courbe') end += 1;
    let length = 0;
    let weighted = 0;
    for (let i = start; i <= end; i += 1) {
      const segment = lengths[i + 1]! - lengths[i]!;
      length += segment;
      weighted += (segment * (profile[i]!.r + profile[i + 1]!.r)) / 2;
    }
    mean.fill(weighted / length, start, end + 1);
    start = end + 1;
  }

  /** Anneau du point k pour la bande i ; `offset` : décalage d'un demi-secteur des u d'un pôle. */
  const ring = (k: number, band: number, offset: number) => {
    const point = profile[k]!;
    const flat = kinds[band] === 'plate';
    const ids: number[] = [];
    for (let j = 0; j <= segments; j += 1) {
      const theta = (j / segments) * arc;
      const s = Math.sin(theta);
      const c = Math.cos(theta);
      const x = point.r * s;
      const z = point.r * c;
      const u = flat ? x : (((j + offset) / segments) * arc) * mean[band]!;
      const v = flat ? z : lengths[k]!;
      ids.push(builder.vertex(x, point.y, z, point.nr * s, point.ny, point.nr * c, u, v));
    }
    return ids;
  };

  let shared: number[] | null = null;
  for (let i = 0; i < bands; i += 1) {
    if (kinds[i] === 'vide') {
      shared = null;
      continue;
    }
    const pole = (k: number) => profile[k]!.r < POLE;
    // Deux bandes courbes de la même suite partagent leur anneau commun (hors pôle).
    const low = shared && kinds[i - 1] === 'courbe' && kinds[i] === 'courbe' && !pole(i) ? shared : ring(i, i, pole(i) ? 0.5 : 0);
    const high = ring(i + 1, i, pole(i + 1) ? -0.5 : 0);
    for (let j = 0; j < segments; j += 1) builder.quad(low[j]!, low[j + 1]!, high[j + 1]!, high[j]!);
    shared = high;
  }

  // Secteur : flancs plans si le profil enferme un volume (boucle, ou départ et arrivée sur l'axe).
  if (arc >= TAU - 1e-6) return;
  const first = profile[0]!;
  const last = profile[profile.length - 1]!;
  const closedByAxis = first.r < POLE && last.r < POLE;
  if (!loop && !closedByAxis) return;
  const outline: Vector2[] = [];
  for (const point of loop ? profile.slice(0, -1) : profile) {
    const previous = outline[outline.length - 1];
    if (!previous || Math.abs(previous.x - point.r) > SAME || Math.abs(previous.y - point.y) > SAME) outline.push(new Vector2(point.r, point.y));
  }
  const head = outline[0];
  const tail = outline[outline.length - 1];
  if (head && tail && outline.length > 1 && head.distanceTo(tail) < SAME) outline.pop();
  if (outline.length < 3 || Math.abs(ShapeUtils.area(outline)) < 1e-12) return;
  const triangles = ShapeUtils.triangulateShape(outline.map((p) => p.clone()), []);
  for (const theta of [0, arc]) {
    const s = Math.sin(theta);
    const c = Math.cos(theta);
    // Normale du flanc : contre le sens de rotation au départ, dans le sens à l'arrivée.
    const toward = theta === 0 ? new Vector3(-1, 0, 0) : new Vector3(c, 0, -s);
    const ids = outline.map((p) => builder.vertex(p.x * s, p.y, p.x * c, toward.x, toward.y, toward.z, p.x, p.y));
    for (const [a, b, d] of triangles) builder.facing(ids[a!]!, ids[b!]!, ids[d!]!, toward);
  }
}

/** Normale extérieure d'un segment de profil parcouru de bas en haut : (dy, −dr). */
function outward(a: Vec2, b: Vec2): Vector2 {
  return new Vector2(b[1] - a[1], -(b[0] - a[0])).normalize();
}

/**
 * Profil en ligne brisée dont certains coins sont arrondis (rayon dans `radii`, 0 = arête franche).
 * L'arrondi est ramené à la moitié des segments voisins s'il ne tient pas.
 */
function roundedProfile(points: readonly Vec2[], radii: readonly number[], detail: number): ProfilePoint[] {
  const out: ProfilePoint[] = [];
  const push = (r: number, y: number, n: Vector2) => out.push({ r: Math.max(0, r), y, nr: n.x, ny: n.y });
  const last = points.length - 1;
  push(points[0]![0], points[0]![1], outward(points[0]!, points[1]!));
  for (let i = 1; i < last; i += 1) {
    const prev = points[i - 1]!;
    const p = points[i]!;
    const next = points[i + 1]!;
    const d1 = new Vector2(p[0] - prev[0], p[1] - prev[1]);
    const d2 = new Vector2(next[0] - p[0], next[1] - p[1]);
    const len1 = d1.length();
    const len2 = d2.length();
    d1.normalize();
    d2.normalize();
    const n1 = outward(prev, p);
    const n2 = outward(p, next);
    const turn = Math.acos(clamp(d1.dot(d2), -1, 1));
    const radius = radii[i] ?? 0;
    if (turn < 1e-4) {
      push(p[0], p[1], n1.clone().add(n2).normalize());
    } else if (radius > 0) {
      const half = Math.tan(turn / 2);
      const t = Math.min(radius * half, len1 / 2, len2 / 2);
      const rho = t / half;
      const convex = d1.x * d2.y - d1.y * d2.x > 0;
      const t1 = new Vector2(p[0] - d1.x * t, p[1] - d1.y * t);
      const center = t1.clone().addScaledVector(n1, convex ? -rho : rho);
      const start = t1.clone().sub(center);
      const steps = arcSteps(turn, rho, detail);
      for (let s = 0; s <= steps; s += 1) {
        const angle = ((convex ? 1 : -1) * turn * s) / steps;
        const dir = start.clone().rotateAround(new Vector2(), angle);
        const point = center.clone().add(dir);
        push(point.x, point.y, dir.clone().multiplyScalar(convex ? 1 : -1).normalize());
      }
    } else {
      push(p[0], p[1], n1);
      push(p[0], p[1], n2);
    }
  }
  push(points[last]![0], points[last]![1], outward(points[last - 1]!, points[last]!));
  return out;
}

function sectorOf(kind: string, arc: number | undefined): number {
  if (arc === undefined) return TAU;
  return Math.min(TAU, positive(kind, 'arc', arc));
}

function sectorSegments(full: number, arc: number): number {
  return arc >= TAU - 1e-6 ? full : Math.max(3, Math.ceil((full * arc) / TAU));
}

// ————————————————————————————————————————————————————————————————————————————————
// Pavé arrondi et coussin : une BoxGeometry subdivisée dont la grille est resserrée vers les
// arêtes, puis projetée sur la boîte intérieure gonflée du rayon d'arrondi.

interface AxisGrid {
  /** Coordonnées des lignes de la grille, de −demi-cote à +demi-cote. */
  coords: number[];
  /** Longueur de surface depuis le premier point, pour les coordonnées de texture. */
  arcs: number[];
}

function axisGrid(half: number, bevel: number, steps: number, flatSegments: number): AxisGrid {
  const inner = half - bevel;
  const lower: number[] = [];
  // De l'arête (angle de 45° avec la face) au début du plat, à pas d'angle égaux.
  for (let j = 0; j <= steps; j += 1) lower.push(-(inner + bevel * Math.tan((Math.PI / 4) * ((steps - j) / steps))));
  const coords = [...lower];
  if (inner > SAME) {
    for (let k = 1; k < flatSegments; k += 1) coords.push(-inner + (2 * inner * k) / flatSegments);
    coords.push(...lower.map((c) => -c).reverse());
  } else {
    coords.push(...lower.slice(0, -1).map((c) => -c).reverse());
  }
  // Longueur de surface : linéaire sur le plat, rayon × angle sur l'arrondi.
  const surface = (c: number) => {
    const a = Math.abs(c);
    const s = a <= inner ? a : inner + bevel * Math.atan((a - inner) / bevel);
    return Math.sign(c) * s;
  };
  const origin = surface(coords[0]!);
  return { coords, arcs: coords.map((c) => surface(c) - origin) };
}

/** Axes (u, v) des coordonnées de texture de chaque face de BoxGeometry : +x, −x, +y, −y, +z, −z. */
const FACE_AXES: ReadonlyArray<readonly [0 | 1 | 2, 0 | 1 | 2]> = [
  [2, 1],
  [2, 1],
  [0, 2],
  [0, 2],
  [0, 1],
  [0, 1],
];

function roundedBox(size: Vec3, bevel: number, steps: number, flat: readonly [number, number, number]): BufferGeometry {
  const halves = size.map((s) => s / 2) as [number, number, number];
  const grids = halves.map((half, a) => axisGrid(half, bevel, steps, flat[a]!));
  const counts = grids.map((g) => g.coords.length - 1) as [number, number, number];
  const box = new BoxGeometry(size[0], size[1], size[2], counts[0], counts[1], counts[2]);
  const position = box.getAttribute('position');
  const normal = box.getAttribute('normal');
  const uv = box.getAttribute('uv');
  const faceSizes = [
    (counts[2] + 1) * (counts[1] + 1),
    (counts[2] + 1) * (counts[1] + 1),
    (counts[0] + 1) * (counts[2] + 1),
    (counts[0] + 1) * (counts[2] + 1),
    (counts[0] + 1) * (counts[1] + 1),
    (counts[0] + 1) * (counts[1] + 1),
  ];
  const c = new Vector3();
  const q = new Vector3();
  let face = 0;
  let faceEnd = faceSizes[0]!;
  for (let i = 0; i < position.count; i += 1) {
    while (i >= faceEnd) faceEnd += faceSizes[++face]!;
    for (let a = 0; a < 3; a += 1) {
      const grid = grids[a]!;
      const index = Math.round(((position.getComponent(i, a) + halves[a]!) / size[a]!) * counts[a]!);
      const value = grid.coords[index]!;
      c.setComponent(a, value);
      q.setComponent(a, clamp(value, -(halves[a]! - bevel), halves[a]! - bevel));
    }
    const diff = c.clone().sub(q);
    const length = diff.length();
    if (length > 0) {
      diff.divideScalar(length);
      position.setXYZ(i, q.x + diff.x * bevel, q.y + diff.y * bevel, q.z + diff.z * bevel);
      normal.setXYZ(i, diff.x, diff.y, diff.z);
    }
    const [ua, va] = FACE_AXES[face]!;
    const u = grids[ua]!.arcs[Math.round(uv.getX(i) * counts[ua])]!;
    const v = grids[va]!.arcs[Math.round(uv.getY(i) * counts[va])]!;
    uv.setXY(i, u, v);
  }
  box.clearGroups();
  return box;
}

/** Normales lisses, moyennées entre les sommets confondus (coutures de la grille comprises). */
function smoothNormals(geometry: BufferGeometry): void {
  const position = geometry.getAttribute('position');
  const normal = geometry.getAttribute('normal');
  const index = geometry.getIndex()!;
  const key = (i: number) => `${Math.round(position.getX(i) * 1e6)},${Math.round(position.getY(i) * 1e6)},${Math.round(position.getZ(i) * 1e6)}`;
  const sums = new Map<string, Vector3>();
  const a = new Vector3();
  const b = new Vector3();
  const c = new Vector3();
  for (let t = 0; t < index.count; t += 3) {
    const ids = [index.getX(t), index.getX(t + 1), index.getX(t + 2)] as const;
    a.fromBufferAttribute(position, ids[0]);
    b.fromBufferAttribute(position, ids[1]).sub(a);
    c.fromBufferAttribute(position, ids[2]).sub(a);
    const faceNormal = b.cross(c);
    for (const id of ids) {
      const k = key(id);
      const sum = sums.get(k) ?? new Vector3();
      sums.set(k, sum.add(faceNormal));
    }
  }
  for (let i = 0; i < position.count; i += 1) {
    const sum = sums.get(key(i));
    if (sum && sum.lengthSq() > 0) {
      const n = sum.clone().normalize();
      normal.setXYZ(i, n.x, n.y, n.z);
    }
  }
}

// ————————————————————————————————————————————————————————————————————————————————
// Formes

function boxShape(shape: { box: Vec3; bevel?: number; detail?: number }): BufferGeometry {
  const [w, h, d] = shape.box.map((s, i) => positive('box', ['largeur', 'hauteur', 'profondeur'][i]!, s)) as [number, number, number];
  const bevel = Math.min(nonNegative('box', 'bevel', shape.bevel, 0), w / 2, h / 2, d / 2);
  if (bevel <= 0) {
    // Forme d'origine, à l'identique de partGeometry : faces dans l'ordre +x, −x, +y, −y, +z, −z.
    const geometry = new BoxGeometry(w, h, d);
    const uv = geometry.getAttribute('uv');
    const faces: Array<[number, number]> = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    faces.forEach(([su, sv], face) => {
      for (let i = face * 4; i < face * 4 + 4; i += 1) uv.setXY(i, uv.getX(i) * su, uv.getY(i) * sv);
    });
    geometry.clearGroups();
    return geometry;
  }
  const detail = detailOf('box', shape.detail);
  return roundedBox([w, h, d], bevel, arcSteps(Math.PI / 4, bevel, detail), [1, 1, 1]);
}

function cushionShape(shape: { cushion: Vec3; bevel?: number; puff?: number; detail?: number }): BufferGeometry {
  const size = shape.cushion.map((s, i) => positive('cushion', ['largeur', 'hauteur', 'profondeur'][i]!, s)) as [number, number, number];
  const thin = size.indexOf(Math.min(...size)) as 0 | 1 | 2;
  const smallest = size[thin];
  const bevel = Math.min(nonNegative('cushion', 'bevel', shape.bevel, 0.3 * smallest), ...size.map((s) => s / 2));
  const puff = nonNegative('cushion', 'puff', shape.puff, 0.12 * smallest);
  const detail = detailOf('cushion', shape.detail);
  const flatSegments = Math.max(2, 2 * Math.round(2 * detail));
  const flat = [0, 1, 2].map((a) => (a === thin ? 1 : flatSegments)) as [number, number, number];
  const geometry = roundedBox(size, Math.max(bevel, 1e-4), arcSteps(Math.PI / 4, bevel, detail), flat);
  if (puff > 0) {
    const position = geometry.getAttribute('position');
    const [ua, va] = [0, 1, 2].filter((a) => a !== thin) as [number, number];
    const innerU = Math.max(size[ua]! / 2 - bevel, 1e-6);
    const innerV = Math.max(size[va]! / 2 - bevel, 1e-6);
    const half = size[thin] / 2;
    for (let i = 0; i < position.count; i += 1) {
      const s = clamp(position.getComponent(i, ua) / innerU, -1, 1);
      const t = clamp(position.getComponent(i, va) / innerV, -1, 1);
      const along = position.getComponent(i, thin);
      const weight = (Math.abs(along) / half) ** 2;
      position.setComponent(i, thin, along + Math.sign(along) * puff * (1 - s * s) * (1 - t * t) * weight);
    }
    smoothNormals(geometry);
  }
  return geometry;
}

function cylinderShape(shape: { cylinder: readonly [number, number]; axis?: Axis; top?: number; bevel?: number; detail?: number }): BufferGeometry {
  const radius = nonNegative('cylinder', 'rayon', shape.cylinder[0], 0);
  const height = positive('cylinder', 'hauteur', shape.cylinder[1]);
  if (shape.top === undefined && shape.bevel === undefined && shape.detail === undefined) {
    // Forme d'origine, à l'identique de partGeometry (20 côtés) ; coordonnées de texture en mètres.
    positive('cylinder', 'rayon', radius);
    const geometry = new CylinderGeometry(radius, radius, height, 20);
    const normal = geometry.getAttribute('normal');
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i += 1) {
      if (Math.abs(normal.getY(i)) > 0.5) uv.setXY(i, (uv.getX(i) - 0.5) * 2 * radius, (uv.getY(i) - 0.5) * 2 * radius);
      else uv.setXY(i, uv.getX(i) * TAU * radius, uv.getY(i) * height);
    }
    if (shape.axis === 'x') geometry.rotateZ(Math.PI / 2);
    if (shape.axis === 'z') geometry.rotateX(Math.PI / 2);
    geometry.clearGroups();
    return geometry;
  }
  const top = nonNegative('cylinder', 'top', shape.top, radius);
  if (Math.max(radius, top) <= 0) fail('cylinder', 'le rayon du bas ou celui du haut doit être positif');
  const bevel = nonNegative('cylinder', 'bevel', shape.bevel, 0);
  const detail = detailOf('cylinder', shape.detail);
  const raw: Vec2[] = [
    [0, -height / 2],
    [radius, -height / 2],
    [top, height / 2],
    [0, height / 2],
  ];
  const radii = [0, bevel, bevel, 0];
  // Pointe d'un cône : le coin sur l'axe disparaît.
  const points: Vec2[] = [];
  const pointRadii: number[] = [];
  raw.forEach((p, i) => {
    const prev = points[points.length - 1];
    if (prev && Math.abs(prev[0] - p[0]) < SAME && Math.abs(prev[1] - p[1]) < SAME) return;
    points.push(p);
    pointRadii.push(radii[i]!);
  });
  const builder = new Builder();
  revolve(builder, roundedProfile(points, pointRadii, detail), radialSegments(Math.max(radius, top), detail), TAU, false);
  return oriented(builder.geometry(), fromY(shape.axis));
}

function sphereShape(shape: { sphere: number; scale?: Vec3; detail?: number }): BufferGeometry {
  const radius = positive('sphere', 'rayon', shape.sphere);
  if (shape.scale === undefined && shape.detail === undefined) {
    // Forme d'origine, à l'identique de partGeometry (18 × 12) ; coordonnées de texture en mètres.
    const geometry = new SphereGeometry(radius, 18, 12);
    // u = angle × rayon moyen d'un méridien (2r/π) : des mètres en moyenne, sans cisaillement.
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * TAU * ((2 * radius) / Math.PI), uv.getY(i) * Math.PI * radius);
    return geometry;
  }
  const detail = detailOf('sphere', shape.detail);
  const scale = (shape.scale ?? [1, 1, 1]).map((s, i) => positive('sphere', `scale[${i}]`, s)) as [number, number, number];
  const rings = Math.max(4, 2 * Math.round(6 * detail));
  const profile: ProfilePoint[] = [];
  for (let i = 0; i <= rings; i += 1) {
    const t = -Math.PI / 2 + (i / rings) * Math.PI;
    const pole = i === 0 || i === rings;
    profile.push({ r: pole ? 0 : radius * Math.cos(t), y: radius * Math.sin(t), nr: pole ? 0 : Math.cos(t), ny: Math.sin(t) });
  }
  const builder = new Builder();
  revolve(builder, profile, quarters(16 * detail), TAU, false);
  const geometry = builder.geometry();
  if (scale.some((s) => s !== 1)) {
    geometry.applyMatrix4(new Matrix4().makeScale(scale[0], scale[1], scale[2]));
    const across = (scale[0] + scale[2]) / 2;
    const uv = geometry.getAttribute('uv');
    for (let i = 0; i < uv.count; i += 1) uv.setXY(i, uv.getX(i) * across, (uv.getY(i) * (across + scale[1])) / 2);
  }
  return geometry;
}

function capsuleShape(shape: { capsule: readonly [number, number]; axis?: Axis; detail?: number }): BufferGeometry {
  const radius = positive('capsule', 'rayon', shape.capsule[0]);
  const length = Math.max(positive('capsule', 'longueur', shape.capsule[1]), 2 * radius);
  const detail = detailOf('capsule', shape.detail);
  const half = length / 2 - radius;
  const steps = arcSteps(Math.PI / 2, radius, detail);
  const profile: ProfilePoint[] = [{ r: 0, y: -length / 2, nr: 0, ny: -1 }];
  for (let s = 1; s <= steps; s += 1) {
    const t = -Math.PI / 2 + (s / steps) * (Math.PI / 2);
    profile.push({ r: radius * Math.cos(t), y: -half + radius * Math.sin(t), nr: Math.cos(t), ny: Math.sin(t) });
  }
  if (half > SAME) profile.push({ r: radius, y: half, nr: 1, ny: 0 });
  for (let s = 1; s <= steps; s += 1) {
    const t = (s / steps) * (Math.PI / 2);
    const pole = s === steps;
    profile.push({ r: pole ? 0 : radius * Math.cos(t), y: half + radius * Math.sin(t), nr: pole ? 0 : Math.cos(t), ny: Math.sin(t) });
  }
  const builder = new Builder();
  revolve(builder, profile, radialSegments(radius, detail), TAU, false);
  return oriented(builder.geometry(), fromY(shape.axis));
}

function torusShape(shape: { torus: readonly [number, number]; axis?: Axis; arc?: number; detail?: number }): BufferGeometry {
  const ring = positive('torus', 'rayon du cercle', shape.torus[0]);
  const tube = positive('torus', 'rayon du tube', shape.torus[1]);
  if (tube >= ring) fail('torus', `le rayon du tube (${tube}) doit rester sous le rayon du cercle (${ring})`);
  const detail = detailOf('torus', shape.detail);
  const arc = sectorOf('torus', shape.arc);
  const tubeSteps = quarters(12 * detail);
  const profile: ProfilePoint[] = [];
  for (let i = 0; i <= tubeSteps; i += 1) {
    // Départ côté axe, en descendant : sens qui garde les normales vers l'extérieur.
    const t = -Math.PI + (i / tubeSteps) * TAU;
    profile.push({ r: ring + tube * Math.cos(t), y: tube * Math.sin(t), nr: Math.cos(t), ny: Math.sin(t) });
  }
  const builder = new Builder();
  revolve(builder, profile, sectorSegments(radialSegments(ring + tube, detail), arc), arc, true);
  return oriented(builder.geometry(), fromY(shape.axis));
}

function latheShape(shape: { lathe: readonly Vec2[]; axis?: Axis; arc?: number; detail?: number }): BufferGeometry {
  const detail = detailOf('lathe', shape.detail);
  const arc = sectorOf('lathe', shape.arc);
  const points: Vec2[] = [];
  for (const [r, y] of shape.lathe) {
    if (!Number.isFinite(r) || !Number.isFinite(y) || r < 0) fail('lathe', `point (${r}, ${y}) invalide : rayon positif ou nul, hauteur finie`);
    const prev = points[points.length - 1];
    if (!prev || Math.hypot(prev[0] - r, prev[1] - y) > SAME) points.push([r, y]);
  }
  if (points.length < 2) fail('lathe', 'il faut au moins deux points distincts');
  if (points.every(([r]) => r < POLE)) fail('lathe', 'le profil ne décrit aucune surface (collé à l’axe)');
  // Profil bouclé (dernier point sur le premier) : section fermée tournée, comme un tore à
  // section quelconque (bague, visière épaisse).
  const head = points[0]!;
  const tail = points[points.length - 1]!;
  const loop = points.length >= 4 && Math.hypot(head[0] - tail[0], head[1] - tail[1]) <= 1e-6;
  if (loop) points.pop();
  // Sens : la boucle, ou le polygone fermé par l'axe, doit tourner dans le sens trigonométrique.
  // Un profil sans aire (disque, anneau plat) garde l'ordre donné : de l'axe vers le bord, il
  // regarde vers le bas.
  const polygon: Vec2[] = loop ? points : [...points, [0, tail[1]], [0, head[1]]];
  if (ShapeUtils.area(polygon.map(([r, y]) => new Vector2(r, y))) < -1e-12) points.reverse();
  const count = points.length;
  const entries = points.map((p, i) => {
    const prev = loop ? points[(i + count - 1) % count] : points[i - 1];
    const next = loop ? points[(i + 1) % count] : points[i + 1];
    const before = prev ? outward(prev, p) : null;
    const after = next ? outward(p, next) : null;
    if (before && after && Math.acos(clamp(before.dot(after), -1, 1)) > CREASE) {
      return [
        { r: p[0], y: p[1], nr: before.x, ny: before.y },
        { r: p[0], y: p[1], nr: after.x, ny: after.y },
      ];
    }
    const n = (before ?? new Vector2()).clone().add(after ?? new Vector2()).normalize();
    return [{ r: p[0], y: p[1], nr: n.x, ny: n.y }];
  });
  if (loop) {
    // La boucle repart et revient au premier point : côté arrivée en tête, côté départ en queue.
    const first = entries[0]!;
    entries.push([first[0]!]);
    entries[0] = [first[first.length - 1]!];
  }
  const profile: ProfilePoint[] = entries.flat();
  const reach = Math.max(...points.map(([r]) => r));
  const builder = new Builder();
  revolve(builder, profile, sectorSegments(radialSegments(reach, detail), arc), arc, loop);
  return oriented(builder.geometry(), fromY(shape.axis));
}

// ————————————————————————————————————————————————————————————————————————————————
// Extrusion

interface Loop {
  points: Vector2[];
  /** Direction de chaque côté (du sommet k au sommet k + 1). */
  dirs: Vector2[];
  /** Normale extérieure de chaque côté (vers l'air, trous compris). */
  edges: Vector2[];
  /** Décalage d'onglet de chaque sommet pour un retrait de 1 m vers la matière. */
  miters: Vector2[];
  /** Arête franche au sommet k. */
  sharp: boolean[];
  /** Longueur de contour cumulée au sommet k (k = longueur totale en bout). */
  along: number[];
}

function cleanContour(kind: string, raw: readonly Vec2[], what: string): Vector2[] {
  const points: Vector2[] = [];
  for (const [x, y] of raw) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) fail(kind, `${what} : point (${x}, ${y}) non fini`);
    const prev = points[points.length - 1];
    if (!prev || Math.hypot(prev.x - x, prev.y - y) > SAME) points.push(new Vector2(x, y));
  }
  const first = points[0];
  const last = points[points.length - 1];
  if (first && last && points.length > 1 && first.distanceTo(last) <= SAME) points.pop();
  if (points.length < 3) fail(kind, `${what} : il faut au moins trois points distincts`);
  if (Math.abs(ShapeUtils.area(points)) < 1e-10) fail(kind, `${what} : contour sans surface`);
  return points;
}

function makeLoop(kind: string, points: Vector2[]): Loop {
  const n = points.length;
  const dirs = points.map((p, k) => points[(k + 1) % n]!.clone().sub(p).normalize());
  const edges = dirs.map((d) => new Vector2(d.y, -d.x));
  const miters: Vector2[] = [];
  const sharp: boolean[] = [];
  points.forEach((p, k) => {
    const before = edges[(k + n - 1) % n]!;
    const after = edges[k]!;
    const dot = before.dot(after);
    if (dot < -0.999) fail(kind, `pointe en épingle au point (${p.x}, ${p.y})`);
    miters.push(before.clone().add(after).divideScalar(1 + dot));
    sharp.push(Math.acos(clamp(dirs[(k + n - 1) % n]!.dot(dirs[k]!), -1, 1)) > CREASE);
  });
  const along = [0];
  for (let k = 0; k < n; k += 1) along.push(along[k]! + points[(k + 1) % n]!.distanceTo(points[k]!));
  return { points, dirs, edges, miters, sharp, along };
}

function inset(loop: Loop, depth: number): Vector2[] {
  return loop.points.map((p, k) => p.clone().addScaledVector(loop.miters[k]!, -depth));
}

/** Le retrait garde-t-il chaque côté dans son sens, et le contour dans le sien ? */
function insetValid(loop: Loop, depth: number): boolean {
  const moved = inset(loop, depth);
  const n = moved.length;
  for (let k = 0; k < n; k += 1) {
    if (moved[(k + 1) % n]!.clone().sub(moved[k]!).dot(loop.dirs[k]!) <= 1e-9) return false;
  }
  return Math.sign(ShapeUtils.area(moved)) === Math.sign(ShapeUtils.area(loop.points));
}

function extrudeShape(shape: { extrude: readonly Vec2[]; depth: number; axis?: Axis; bevel?: number; holes?: ReadonlyArray<readonly Vec2[]>; detail?: number }): BufferGeometry {
  const depth = positive('extrude', 'depth', shape.depth);
  const detail = detailOf('extrude', shape.detail);
  const outer = cleanContour('extrude', shape.extrude, 'contour');
  if (ShapeUtils.isClockWise(outer)) outer.reverse();
  const holes = (shape.holes ?? []).map((hole, i) => {
    const points = cleanContour('extrude', hole, `trou ${i + 1}`);
    if (!ShapeUtils.isClockWise(points)) points.reverse();
    return points;
  });
  const loops = [outer, ...holes].map((points) => makeLoop('extrude', points));
  // Arrondi ramené à la demi-épaisseur, puis réduit de moitié tant que le retrait retourne un côté.
  let bevel = Math.min(nonNegative('extrude', 'bevel', shape.bevel, 0), depth / 2);
  for (let tries = 0; bevel > 0 && !loops.every((loop) => insetValid(loop, bevel)); tries += 1) bevel = tries < 8 ? bevel / 2 : 0;

  interface Layer {
    z: number;
    inset: number;
    cos: number;
    sin: number;
    v: number;
  }
  const half = depth / 2;
  const layers: Layer[] = [];
  if (bevel > 0) {
    const steps = arcSteps(Math.PI / 2, bevel, detail);
    const side = depth - 2 * bevel;
    for (let s = 0; s <= steps; s += 1) {
      const phi = -Math.PI / 2 + (s / steps) * (Math.PI / 2);
      layers.push({ z: -(half - bevel) + bevel * Math.sin(phi), inset: bevel * (1 - Math.cos(phi)), cos: Math.cos(phi), sin: Math.sin(phi), v: bevel * (phi + Math.PI / 2) });
    }
    for (let s = side > SAME ? 0 : 1; s <= steps; s += 1) {
      const phi = (s / steps) * (Math.PI / 2);
      layers.push({ z: half - bevel + bevel * Math.sin(phi), inset: bevel * (1 - Math.cos(phi)), cos: Math.cos(phi), sin: Math.sin(phi), v: (bevel * Math.PI) / 2 + side + bevel * phi });
    }
  } else {
    layers.push({ z: -half, inset: 0, cos: 1, sin: 0, v: 0 }, { z: half, inset: 0, cos: 1, sin: 0, v: depth });
  }

  const builder = new Builder();
  // Flancs : une bande par côté du contour, ses deux bords portent la normale du côté (arête
  // franche) ou la moyenne avec le côté voisin (contour lisse).
  for (const loop of loops) {
    const n = loop.points.length;
    const vertexNormal = (k: number, edge: number) => {
      const i = ((k % n) + n) % n;
      if (loop.sharp[i]) return loop.edges[edge]!;
      return loop.edges[(i + n - 1) % n]!.clone().add(loop.edges[i]!).normalize();
    };
    for (let k = 0; k < n; k += 1) {
      const ends = [k, k + 1].map((j) => ({ point: loop.points[j % n]!, miter: loop.miters[j % n]!, normal: vertexNormal(j, k), u: loop.along[j]! }));
      const columns = ends.map((end) =>
        layers.map((layer) => {
          const x = end.point.x - end.miter.x * layer.inset;
          const y = end.point.y - end.miter.y * layer.inset;
          return builder.vertex(x, y, layer.z, end.normal.x * layer.cos, end.normal.y * layer.cos, layer.sin, end.u, layer.v);
        }),
      );
      const [a, b] = columns as [number[], number[]];
      for (let l = 0; l < layers.length - 1; l += 1) builder.quad(a[l]!, b[l]!, b[l + 1]!, a[l + 1]!);
    }
  }
  // Faces avant et arrière : le contour retiré de l'arrondi, triangulé avec ses trous.
  const capOuter = inset(loops[0]!, bevel);
  const capHoles = loops.slice(1).map((loop) => inset(loop, bevel));
  const triangles = ShapeUtils.triangulateShape(
    capOuter.map((p) => p.clone()),
    capHoles.map((hole) => hole.map((p) => p.clone())),
  );
  const flat = [...capOuter, ...capHoles.flat()];
  for (const side of [1, -1]) {
    const toward = new Vector3(0, 0, side);
    const ids = flat.map((p) => builder.vertex(p.x, p.y, side * half, 0, 0, side, side * p.x, p.y));
    for (const [a, b, c] of triangles) builder.facing(ids[a!]!, ids[b!]!, ids[c!]!, toward);
  }
  return oriented(builder.geometry(), fromZ(shape.axis));
}

/**
 * Contour de rectangle à coins ronds, centré, sens trigonométrique, pour extrude. Coins par pas de
 * 30° au plus, pour rester lisses sous l'angle d'arête franche.
 */
export function roundedRectContour(width: number, height: number, radius: number, detail = 1): Vec2[] {
  positive('roundedRectContour', 'largeur', width);
  positive('roundedRectContour', 'hauteur', height);
  const r = Math.min(nonNegative('roundedRectContour', 'rayon', radius, 0), width / 2, height / 2);
  const hw = width / 2;
  const hh = height / 2;
  if (r <= 0) {
    return [
      [-hw, -hh],
      [hw, -hh],
      [hw, hh],
      [-hw, hh],
    ];
  }
  const steps = Math.max(3, arcSteps(Math.PI / 2, r, detailOf('roundedRectContour', detail)));
  const corners: Array<[number, number, number]> = [
    [hw - r, -hh + r, -Math.PI / 2],
    [hw - r, hh - r, 0],
    [-hw + r, hh - r, Math.PI / 2],
    [-hw + r, -hh + r, Math.PI],
  ];
  const points: Vec2[] = [];
  for (const [cx, cy, start] of corners) {
    for (let s = 0; s <= steps; s += 1) {
      const a = start + (s / steps) * (Math.PI / 2);
      const p: Vec2 = [cx + r * Math.cos(a), cy + r * Math.sin(a)];
      const prev = points[points.length - 1];
      if (!prev || Math.hypot(prev[0] - p[0], prev[1] - p[1]) > SAME) points.push(p);
    }
  }
  const first = points[0]!;
  const last = points[points.length - 1]!;
  if (Math.hypot(first[0] - last[0], first[1] - last[1]) <= SAME) points.pop();
  return points;
}

// ————————————————————————————————————————————————————————————————————————————————
// Tube

function tubeShape(shape: { tube: readonly Vec3[]; radius: number; smooth?: boolean; closed?: boolean; detail?: number }): BufferGeometry {
  const radius = positive('tube', 'radius', shape.radius);
  const detail = detailOf('tube', shape.detail);
  const closed = shape.closed === true;
  let points: Vector3[] = [];
  for (const [x, y, z] of shape.tube) {
    if (![x, y, z].every(Number.isFinite)) fail('tube', `point (${x}, ${y}, ${z}) non fini`);
    const p = new Vector3(x, y, z);
    const prev = points[points.length - 1];
    if (!prev || prev.distanceTo(p) > SAME) points.push(p);
  }
  if (closed && points.length > 1 && points[0]!.distanceTo(points[points.length - 1]!) <= SAME) points.pop();
  if (points.length < (closed ? 3 : 2)) fail('tube', `il faut au moins ${closed ? 3 : 2} points distincts`);

  // Coudes : demi-tour refusé ; arrondis en arcs (lisses) si smooth.
  const count = points.length;
  const corners = closed ? [...points.keys()] : [...points.keys()].slice(1, -1);
  for (const i of corners) {
    const p = points[i]!;
    const d1 = p.clone().sub(points[(i + count - 1) % count]!).normalize();
    const d2 = points[(i + 1) % count]!.clone().sub(p).normalize();
    if (d1.dot(d2) < -0.9999) fail('tube', `demi-tour au point (${p.x}, ${p.y}, ${p.z})`);
  }
  let smoothJoint = points.map(() => false);
  if (shape.smooth === true) {
    const out: Vector3[] = [];
    const flags: boolean[] = [];
    points.forEach((p, i) => {
      const isCorner = closed || (i > 0 && i < count - 1);
      if (!isCorner) {
        out.push(p);
        flags.push(false);
        return;
      }
      const prev = points[(i + count - 1) % count]!;
      const next = points[(i + 1) % count]!;
      const d1 = p.clone().sub(prev);
      const d2 = next.clone().sub(p);
      const len1 = d1.length();
      const len2 = d2.length();
      d1.normalize();
      d2.normalize();
      const turn = Math.acos(clamp(d1.dot(d2), -1, 1));
      if (turn < 1e-4) {
        out.push(p);
        flags.push(true);
        return;
      }
      const half = Math.tan(turn / 2);
      const t = Math.min(3 * radius * half, len1 / 2, len2 / 2);
      const rho = t / half;
      const inward = d2.clone().addScaledVector(d1, -d1.dot(d2)).normalize();
      const t1 = p.clone().addScaledVector(d1, -t);
      const center = t1.clone().addScaledVector(inward, rho);
      const steps = Math.max(2, arcSteps(turn, rho, detail));
      for (let s = 0; s <= steps; s += 1) {
        const a = (s / steps) * turn;
        out.push(center.clone().addScaledVector(inward, -rho * Math.cos(a)).addScaledVector(d1, rho * Math.sin(a)));
        flags.push(true);
      }
    });
    // Les arcs de deux coins voisins peuvent se toucher : points confondus retirés.
    points = [];
    smoothJoint = [];
    out.forEach((p, i) => {
      const prev = points[points.length - 1];
      if (prev && prev.distanceTo(p) <= SAME) return;
      points.push(p);
      smoothJoint.push(flags[i]!);
    });
    if (closed && points.length > 1 && points[0]!.distanceTo(points[points.length - 1]!) <= SAME) {
      points.pop();
      smoothJoint.pop();
    }
  }

  const n = points.length;
  const segmentCount = closed ? n : n - 1;
  const dirs: Vector3[] = [];
  const lengths: number[] = [];
  for (let i = 0; i < segmentCount; i += 1) {
    const d = points[(i + 1) % n]!.clone().sub(points[i]!);
    lengths.push(d.length());
    dirs.push(d.normalize());
  }
  const along = [0];
  for (let i = 0; i < segmentCount; i += 1) along.push(along[i]! + lengths[i]!);
  const total = along[segmentCount]!;

  // Repère transporté le long de la ligne ; couture des anneaux vers le bas (moins visible).
  const transport = (v: Vector3, from: Vector3, to: Vector3) => v.clone().applyQuaternion(new Quaternion().setFromUnitVectors(from, to));
  const d0 = dirs[0]!;
  const reference = Math.abs(d0.y) < 0.9 ? new Vector3(0, -1, 0) : new Vector3(1, 0, 0);
  const frames: Vector3[] = [reference.addScaledVector(d0, -reference.dot(d0)).normalize()];
  for (let i = 1; i < segmentCount; i += 1) frames.push(transport(frames[i - 1]!, dirs[i - 1]!, dirs[i]!));
  // Ligne fermée : la torsion accumulée sur le tour est répartie le long de la ligne.
  let twist = 0;
  let frameBefore = frames[0]!;
  if (closed) {
    const around = transport(frames[segmentCount - 1]!, dirs[segmentCount - 1]!, d0);
    twist = Math.atan2(frames[0]!.clone().cross(around).dot(d0), frames[0]!.dot(around));
    frameBefore = transport(frames[0]!, d0, dirs[segmentCount - 1]!);
  }

  const sides = tubeSegments(radius, detail);
  const builder = new Builder();
  const offsets = (frame: Vector3, dir: Vector3, angle: number) => {
    const binormal = dir.clone().cross(frame);
    const list: Vector3[] = [];
    for (let k = 0; k <= sides; k += 1) {
      const phi = (k / sides) * TAU + angle;
      list.push(frame.clone().multiplyScalar(Math.cos(phi) * radius).addScaledVector(binormal, Math.sin(phi) * radius));
    }
    return list;
  };

  /** Anneau du joint j : positions, normales côté arrivée et côté départ. */
  const joint = (j: number) => {
    const point = points[j % n]!;
    const angle = closed ? (-twist * along[j]!) / total : 0;
    const inIndex = closed ? (j - 1 + segmentCount) % segmentCount : Math.max(0, j - 1);
    const outIndex = closed ? j % segmentCount : Math.min(segmentCount - 1, j);
    const dIn = dirs[inIndex]!;
    const dOut = dirs[outIndex]!;
    const frameIn = closed && j === 0 ? frameBefore : frames[inIndex]!;
    // Côté départ : le repère d'arrivée transporté par le coude (égal au repère du segment
    // suivant, y compris au joint qui referme une ligne fermée).
    const frameOut = transport(frameIn, dIn, dOut);
    const end = !closed && (j === 0 || j === n - 1);
    const oIn = offsets(frameIn, dIn, angle);
    const oOut = end ? oIn : offsets(frameOut, dOut, angle);
    const plane = end ? dIn : dIn.clone().add(dOut).normalize();
    const positions = oIn.map((o) => point.clone().add(o).addScaledVector(dIn, -o.dot(plane) / dIn.dot(plane)));
    const smooth = smoothJoint[j % n] === true;
    const normalsIn = oIn.map((o, k) => (smooth ? o.clone().add(oOut[k]!) : o.clone()).normalize());
    const normalsOut = oOut.map((o, k) => (smooth ? o.clone().add(oIn[k]!) : o.clone()).normalize());
    return { positions, normalsIn, normalsOut };
  };

  const rings = Array.from({ length: segmentCount + 1 }, (_, j) => joint(j));
  for (let i = 0; i < segmentCount; i += 1) {
    const ring = (j: number, normals: Vector3[]) =>
      rings[j]!.positions.map((p, k) => builder.vertex(p.x, p.y, p.z, normals[k]!.x, normals[k]!.y, normals[k]!.z, (k / sides) * TAU * radius, along[j]!));
    const a = ring(i, rings[i]!.normalsOut);
    const b = ring(i + 1, rings[i + 1]!.normalsIn);
    for (let k = 0; k < sides; k += 1) builder.quad(a[k]!, a[k + 1]!, b[k + 1]!, b[k]!);
  }
  if (!closed) {
    // Bouts fermés à plat.
    for (const [j, toward] of [
      [0, dirs[0]!.clone().negate()],
      [n - 1, dirs[segmentCount - 1]!.clone()],
    ] as const) {
      const center = points[j]!;
      const ring = rings[j]!.positions;
      const centerId = builder.vertex(center.x, center.y, center.z, toward.x, toward.y, toward.z, 0, 0);
      const ids = ring.map((p, k) => builder.vertex(p.x, p.y, p.z, toward.x, toward.y, toward.z, Math.cos((k / sides) * TAU) * radius, Math.sin((k / sides) * TAU) * radius));
      for (let k = 0; k < sides; k += 1) builder.facing(centerId, ids[k]!, ids[k + 1]!, toward);
    }
  }
  return builder.geometry();
}

// ————————————————————————————————————————————————————————————————————————————————

/** Géométrie d'une forme du décor, centrée sur l'origine de sa pièce (voir les repères en tête). */
export function shapeGeometry(shape: GarageShape): BufferGeometry {
  if ('box' in shape) return boxShape(shape);
  if ('cylinder' in shape) return cylinderShape(shape);
  if ('sphere' in shape) return sphereShape(shape);
  if ('capsule' in shape) return capsuleShape(shape);
  if ('torus' in shape) return torusShape(shape);
  if ('cushion' in shape) return cushionShape(shape);
  if ('lathe' in shape) return latheShape(shape);
  if ('extrude' in shape) return extrudeShape(shape);
  if ('tube' in shape) return tubeShape(shape);
  return fail('inconnue', `aucune forme reconnue dans ${JSON.stringify(shape)}`);
}
