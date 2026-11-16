// Sonde de terrain de la sortie : la hauteur du sol (chaussée, terrain, eau, ouvrages ; deux niveaux
// sous un pont ou une voûte) et celle du bâti (toits) autour du véhicule, d'après la géométrie des tronçons chargés. Chaque tronçon est
// tramé une fois, à son arrivée, dans une grille clairsemée (tuiles de 32 × 32 cases de 2 m, créées
// seulement là où il y a de la géométrie) ; la grille part avec lui. La garde des caméras
// (src/drive/cameras.ts, guardShot) l'interroge à chaque image : quelques lectures de tableau.
// Module pur, sans three : testé avec les vrais tronçons de la carte (tests/unit/drive-camera-sol.test.ts).

import type { GroundSampler } from '../cameras.ts';

/** Côté d'une case, en mètres. */
export const RELIEF_CELL = 2;
const TILE = 32;
const OFFSET = 1 << 15;
/** Écart entre deux niveaux d'une case au-delà duquel ce sont deux sols (pont, voûte). */
export const LAYER_GAP = 2.5;

/** Rôles de tronçon qui portent le sol (la caméra reste au-dessus) et le bâti (elle n'y entre pas). */
export const GROUND_ROLES: ReadonlySet<string> = new Set(['chaussee', 'voie', 'marquage', 'accotement', 'terrain', 'eau', 'ouvrage']);
export const BUILT_ROLES: ReadonlySet<string> = new Set(['toit']);

/** Le sol pour qui est à la hauteur `y`, entre le niveau haut `hi` et le niveau bas `lo` d'un point. */
function pickLayer(hi: number, lo: number, y: number): number {
  if (!(y < hi - 0.3)) return hi;
  return hi - lo > LAYER_GAP ? lo : hi;
}

/**
 * Grille de hauteurs clairsemée : le plus haut et le plus bas point posés dans chaque case. Deux
 * niveaux écartés de plus de `LAYER_GAP` m (pont au-dessus d'une route, voûte, terrain au-dessus d'une
 * tranchée couverte) : sous le niveau haut, c'est le niveau bas qui porte.
 */
export class HeightGrid {
  readonly cell: number;
  private readonly tiles = new Map<number, Float32Array>();
  private readonly lows = new Map<number, Float32Array>();

  constructor(cell = RELIEF_CELL) {
    this.cell = cell;
  }

  /** Nombre de tuiles créées (mémoire : 8 Kio chacune, niveaux haut et bas). */
  get tileCount(): number {
    return this.tiles.size;
  }

  private tile(ix: number, iz: number, create: boolean, low = false): Float32Array | undefined {
    const key = (Math.floor(ix / TILE) + OFFSET) * 65536 + (Math.floor(iz / TILE) + OFFSET);
    const map = low ? this.lows : this.tiles;
    let t = map.get(key);
    if (!t && create) {
      t = new Float32Array(TILE * TILE).fill(Number.NaN);
      map.set(key, t);
    }
    return t;
  }

  private slot(ix: number, iz: number): number {
    return (((iz % TILE) + TILE) % TILE) * TILE + (((ix % TILE) + TILE) % TILE);
  }

  /** Hauteur de la case (ix, iz) : son niveau haut, ou son niveau bas si `low` ; NaN si rien n'y est posé. */
  at(ix: number, iz: number, low = false): number {
    const t = this.tile(ix, iz, false, low);
    return t ? (t[this.slot(ix, iz)] as number) : Number.NaN;
  }

  put(ix: number, iz: number, y: number): void {
    const k = this.slot(ix, iz);
    const t = this.tile(ix, iz, true) as Float32Array;
    const old = t[k] as number;
    if (!(old >= y)) t[k] = y;
    const l = this.tile(ix, iz, true, true) as Float32Array;
    const oldLow = l[k] as number;
    if (!(oldLow <= y)) l[k] = y;
  }

  /** Pose un triangle : chaque case dont le centre tombe dedans, et les cases de ses trois sommets. */
  triangle(ax: number, ay: number, az: number, bx: number, by: number, bz: number, cx: number, cy: number, cz: number): void {
    const c = this.cell;
    this.put(Math.floor(ax / c), Math.floor(az / c), ay);
    this.put(Math.floor(bx / c), Math.floor(bz / c), by);
    this.put(Math.floor(cx / c), Math.floor(cz / c), cy);
    const det = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(det) < 1e-6) return;
    const x0 = Math.floor(Math.min(ax, bx, cx) / c);
    const x1 = Math.floor(Math.max(ax, bx, cx) / c);
    const z0 = Math.floor(Math.min(az, bz, cz) / c);
    const z1 = Math.floor(Math.max(az, bz, cz) / c);
    const eps = -1e-4;
    for (let iz = z0; iz <= z1; iz += 1) {
      const pz = (iz + 0.5) * c;
      for (let ix = x0; ix <= x1; ix += 1) {
        const px = (ix + 0.5) * c;
        const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / det;
        const l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / det;
        const l3 = 1 - l1 - l2;
        if (l1 < eps || l2 < eps || l3 < eps) continue;
        this.put(ix, iz, l1 * ay + l2 * by + l3 * cy);
      }
    }
  }

  /**
   * Pose un maillage : positions (x, y, z par sommet), indices (ou triangles à la suite), décalés de
   * (ox, oy, oz) dans le repère de la carte.
   */
  mesh(positions: ArrayLike<number>, index: ArrayLike<number> | null, ox: number, oy: number, oz: number): void {
    const n = index ? index.length : positions.length / 3;
    const p = positions;
    for (let i = 0; i + 2 < n; i += 3) {
      const a = (index ? (index[i] as number) : i) * 3;
      const b = (index ? (index[i + 1] as number) : i + 1) * 3;
      const d = (index ? (index[i + 2] as number) : i + 2) * 3;
      this.triangle(
        (p[a] as number) + ox, (p[a + 1] as number) + oy, (p[a + 2] as number) + oz,
        (p[b] as number) + ox, (p[b + 1] as number) + oy, (p[b + 2] as number) + oz,
        (p[d] as number) + ox, (p[d + 1] as number) + oy, (p[d + 2] as number) + oz,
      );
    }
  }

  /**
   * Hauteur du sol au point (x, z) pour qui s'y trouve à la hauteur `y` : le niveau haut, sauf s'il y a
   * deux niveaux et que `y` est sous le haut (sous un pont, on roule sur le bas). Sans `y` : le haut.
   */
  sample(x: number, z: number, y = Infinity): number {
    return pickLayer(this.level(x, z, false), this.level(x, z, true), y);
  }

  /**
   * Un niveau au point (x, z) : interpolé entre les quatre cases voisines si toutes sont connues, sinon
   * le plus haut de celles qui le sont (prudent pour une caméra) ; NaN si aucune.
   */
  level(x: number, z: number, low: boolean): number {
    const fx = x / this.cell - 0.5;
    const fz = z / this.cell - 0.5;
    const ix = Math.floor(fx);
    const iz = Math.floor(fz);
    const tx = fx - ix;
    const tz = fz - iz;
    const h00 = this.at(ix, iz, low);
    const h10 = this.at(ix + 1, iz, low);
    const h01 = this.at(ix, iz + 1, low);
    const h11 = this.at(ix + 1, iz + 1, low);
    if (h00 === h00 && h10 === h10 && h01 === h01 && h11 === h11) {
      return (h00 * (1 - tx) + h10 * tx) * (1 - tz) + (h01 * (1 - tx) + h11 * tx) * tz;
    }
    let best = Number.NaN;
    for (const h of [h00, h10, h01, h11]) if (h === h && !(best >= h)) best = h;
    return best;
  }
}

/** Le sol et le bâti d'un tronçon. */
export interface ChunkRelief {
  ground: HeightGrid;
  built: HeightGrid;
  /** Hauteur moyenne des plans d'eau du tronçon (NaN s'il n'en a pas). */
  water: number;
}

export function createChunkRelief(): ChunkRelief {
  return { ground: new HeightGrid(), built: new HeightGrid(), water: Number.NaN };
}

/** Pose un maillage d'un rôle de tronçon dans le relief (rôles hors sol et bâti : ignorés). */
export function addRoleMesh(relief: ChunkRelief, role: string, positions: ArrayLike<number>, index: ArrayLike<number> | null, ox: number, oy: number, oz: number): void {
  if (GROUND_ROLES.has(role)) relief.ground.mesh(positions, index, ox, oy, oz);
  if (BUILT_ROLES.has(role)) relief.built.mesh(positions, index, ox, oy, oz);
  if (role === 'eau' && positions.length >= 3) {
    let sum = 0;
    const n = positions.length / 3;
    for (let i = 0; i < n; i += 1) sum += positions[i * 3 + 1] as number;
    relief.water = sum / n + oy;
  }
}

/** Le relief de tous les tronçons chargés : ce que la garde des caméras interroge. */
export class Relief implements GroundSampler {
  private readonly chunks = new Map<number, ChunkRelief>();

  set(index: number, relief: ChunkRelief): void {
    this.chunks.set(index, relief);
  }

  delete(index: number): void {
    this.chunks.delete(index);
  }

  get size(): number {
    return this.chunks.size;
  }

  ground(x: number, z: number, y = Infinity): number {
    // Niveaux haut et bas de tous les tronçons qui couvrent le point (ils se chevauchent), puis le choix.
    let hi = Number.NaN;
    let lo = Number.NaN;
    for (const c of this.chunks.values()) {
      const h = c.ground.level(x, z, false);
      if (h === h && !(hi >= h)) hi = h;
      const l = c.ground.level(x, z, true);
      if (l === l && !(lo <= l)) lo = l;
    }
    return pickLayer(hi, lo, y);
  }

  built(x: number, z: number): number {
    let best = Number.NaN;
    for (const c of this.chunks.values()) {
      const h = c.built.sample(x, z);
      if (h === h && !(best >= h)) best = h;
    }
    return best;
  }

  /** Plan d'eau le plus proche en hauteur de `y` parmi les tronçons chargés (NaN si aucun). */
  waterNear(y: number): number {
    let best = Number.NaN;
    for (const c of this.chunks.values()) {
      if (c.water === c.water && !(Math.abs(best - y) <= Math.abs(c.water - y))) best = c.water;
    }
    return best;
  }
}
