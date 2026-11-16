// Sortie de nuit : ce que chaque niveau de qualité garde (§ 8, budgets), et les petits calculs
// purs de la scène (fenêtre de tronçons, lampadaires les plus proches, cadence de la télémétrie).
// Module pur : testé dans tests/unit/drive-scene-profil.test.ts.

import type { QualityLevel } from '../../render/quality.ts';

export interface DriveProfile {
  /** Tronçons gardés derrière et devant celui du véhicule. */
  behind: number;
  ahead: number;
  /** Un arbre sur `treeEvery` est posé (1 : tous). */
  treeEvery: number;
  /** Réflexion planaire de la chaussée : fraction de la taille de l'image (0 : aucune). */
  reflection: number;
  /** Côté d'une face de la sonde de réflexion mobile, en pixels. */
  probeSize: number;
  /** Une face de la sonde rendue toutes les `probeEvery` images (la sonde entière en 6 × probeEvery). */
  probeEvery: number;
  /** Distance, en mètres, où la brume a tout mangé (densité de FogExp2 calculée d'après elle). */
  fogFar: number;
  /** Cônes de lumière des phares, visibles dans l'air. */
  beams: boolean;
  /** Gouttes de pluie affichées. */
  rainDrops: number;
  /** Lampadaires dont la flaque de lumière et le reflet sont calculés au sol, au plus (deux de plus sont de vraies lumières). */
  lampLights: number;
}

export const DRIVE_PROFILES: Readonly<Record<QualityLevel, DriveProfile>> = Object.freeze({
  // Économie : pas de reflet planaire (§ 8), moins de tronçons et d'arbres, sonde petite et lente.
  // La brume reste : à la nuit, c'est elle qui ferme l'horizon et cache le chargement.
  eco: { behind: 1, ahead: 1, treeEvery: 3, reflection: 0, probeSize: 128, probeEvery: 3, fogFar: 520, beams: false, rainDrops: 900, lampLights: 6 },
  standard: { behind: 1, ahead: 2, treeEvery: 1, reflection: 0.5, probeSize: 256, probeEvery: 1, fogFar: 820, beams: true, rainDrops: 2400, lampLights: 12 },
  max: { behind: 1, ahead: 3, treeEvery: 1, reflection: 1, probeSize: 256, probeEvery: 1, fogFar: 1150, beams: true, rainDrops: 4000, lampLights: 14 },
});

/** Densité de FogExp2 pour qu'il ne reste que 2 % de la scène à `far` mètres. */
export function fogDensity(far: number): number {
  return Math.sqrt(-Math.log(0.02)) / Math.max(1, far);
}

/** Rang du tronçon qui couvre l'abscisse `s` (le premier ou le dernier hors du parcours). */
export function chunkAt(chunks: ReadonlyArray<{ from: number; to: number }>, s: number): number {
  let lo = 0;
  let hi = chunks.length - 1;
  if (hi < 0) return -1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((chunks[mid] as { to: number }).to < s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Rangs des tronçons à garder autour de l'abscisse `s` : `behind` derrière, `ahead` devant. Sur un
 * parcours en boucle, la fenêtre fait le tour. Remplit `out` (aucune allocation) et le rend.
 */
export function chunkWindow(chunks: ReadonlyArray<{ from: number; to: number }>, s: number, behind: number, ahead: number, loop: boolean, out: number[]): number[] {
  out.length = 0;
  const n = chunks.length;
  const at = chunkAt(chunks, s);
  if (at < 0) return out;
  for (let k = -behind; k <= ahead; k += 1) {
    let i = at + k;
    if (loop) i = ((i % n) + n) % n;
    else if (i < 0 || i >= n) continue;
    if (!out.includes(i)) out.push(i);
  }
  return out;
}

/**
 * Les `max` lampadaires les plus proches du point (x, z), parmi `count` rangés par trois nombres
 * (x, y, z) dans `lamps`. Écrit leurs coordonnées dans `out` (3 × max nombres, le reste à zéro) et
 * rend leur nombre. Tri par insertion dans `order` et `dist` (tableaux de travail de taille `max`) :
 * aucune allocation.
 */
export function nearestLamps(lamps: Float32Array, count: number, x: number, z: number, max: number, out: Float32Array, order: Int32Array, dist: Float32Array): number {
  let n = 0;
  for (let i = 0; i < count; i += 1) {
    const dx = (lamps[i * 3] ?? 0) - x;
    const dz = (lamps[i * 3 + 2] ?? 0) - z;
    const d = dx * dx + dz * dz;
    if (n < max) {
      let j = n;
      n += 1;
      while (j > 0 && (dist[j - 1] ?? 0) > d) {
        dist[j] = dist[j - 1] ?? 0;
        order[j] = order[j - 1] ?? 0;
        j -= 1;
      }
      dist[j] = d;
      order[j] = i;
    } else if (d < (dist[max - 1] ?? 0)) {
      let j = max - 1;
      while (j > 0 && (dist[j - 1] ?? 0) > d) {
        dist[j] = dist[j - 1] ?? 0;
        order[j] = order[j - 1] ?? 0;
        j -= 1;
      }
      dist[j] = d;
      order[j] = i;
    }
  }
  out.fill(0);
  for (let k = 0; k < n; k += 1) {
    const i = order[k] ?? 0;
    out[k * 3] = lamps[i * 3] ?? 0;
    out[k * 3 + 1] = lamps[i * 3 + 1] ?? 0;
    out[k * 3 + 2] = lamps[i * 3 + 2] ?? 0;
  }
  return n;
}

/** Télémétrie : quatre publications par seconde au plus. */
export const TELEMETRY_INTERVAL_MS = 250;

/** Vrai s'il est temps de publier (une publication tous les `interval` ms au plus). */
export function due(now: number, last: number, interval = TELEMETRY_INTERVAL_MS): boolean {
  return now - last >= interval;
}

/** Pas de temps de la boucle : borné à 0,1 s (contrat), nul en pause, ralenti au quart. */
export function stepOf(delta: number, paused: boolean, slow: boolean): number {
  if (paused) return 0;
  const dt = Math.min(0.1, Math.max(0, delta));
  return slow ? dt * 0.25 : dt;
}
