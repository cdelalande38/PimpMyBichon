// Météo locale et attributs posés au chargement d'un tronçon (module pur, testé dans
// tests/unit/drive-scene-abri.test.ts) :
// - sous un tunnel (sections `ground: 'tunnel'` de la route), il ne pleut ni ne neige : la chaussée y
//   sèche sur quelques dizaines de mètres après l'entrée et se remouille aux abords de la sortie ;
// - chaque sommet de la chaussée reçoit son abscisse, son écart à l'axe, sa part « au sec » et la
//   demi-largeur de la route (attribut `pmbRoad`, lu par src/drive/scene/materiaux.ts) ;
// - chaque sommet des murs reçoit le pied, le sommet et une graine de son bâtiment (attribut
//   `pmbFacade` : façades dessinées par la matière) ;
// - les tunnels reçoivent des lampes de voûte (réglettes qui éclairent la chaussée et la caisse).
// Aucune carte n'est connue ici : tout vient de route.json.

import type { RailSection } from '../../data/mapTypes.ts';

/** Portée d'un tunnel, d'une tête à l'autre (sections contiguës fusionnées). */
export interface Span {
  from: number;
  to: number;
  /** Demi-largeur de la chaussée sous la voûte (m). */
  halfWidth: number;
}

/** Séchage de la chaussée sous un tunnel : sèche à `dryIn` m de l'entrée, remouillée dans les `wetOut` derniers mètres. */
export const SHELTER = { dryIn: 40, wetOut: 18, lampEvery: 12, lampHeight: 5.7 } as const;

/** Tunnels de la route, sections contiguës fusionnées, dans l'ordre des abscisses. */
export function tunnelSpans(sections: readonly RailSection[]): Span[] {
  const out: Span[] = [];
  for (const s of sections) {
    if (s.ground !== 'tunnel') continue;
    const last = out[out.length - 1];
    if (last && s.from - last.to < 1) {
      last.to = s.to;
      last.halfWidth = Math.max(last.halfWidth, s.width / 2);
    } else out.push({ from: s.from, to: s.to, halfWidth: s.width / 2 });
  }
  return out;
}

function smooth(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Part « au sec » de la chaussée à l'abscisse `s` (0 dehors, 1 au cœur d'un tunnel). */
export function dryAt(spans: readonly Span[], s: number): number {
  for (const t of spans) {
    if (s < t.from || s > t.to) continue;
    const len = t.to - t.from;
    const dryIn = Math.min(SHELTER.dryIn, len * 0.45);
    const wetOut = Math.min(SHELTER.wetOut, len * 0.3);
    return smooth(t.from + 2, t.from + dryIn, s) * (1 - smooth(t.to - wetOut, t.to - 1, s));
  }
  return 0;
}

/** Vrai abri (sous la voûte) à l'abscisse `s` : 1 entre les têtes, 0 dehors. */
export function shelteredAt(spans: readonly Span[], s: number): number {
  for (const t of spans) if (s >= t.from && s <= t.to) return 1;
  return 0;
}

/** Le tunnel le plus proche de `s` (pour les gouttes autour de la caméra), ou null. */
export function nearestSpan(spans: readonly Span[], s: number): Span | null {
  let best: Span | null = null;
  let d = Infinity;
  for (const t of spans) {
    const e = s < t.from ? t.from - s : s > t.to ? s - t.to : 0;
    if (e < d) {
      d = e;
      best = t;
    }
  }
  return best;
}

export interface WeatherAmounts {
  wet: number;
  rain: number;
  snow: number;
}

/**
 * Météo vue à l'abscisse `s` : celle du ciel, nulle sous un tunnel (chaussée sèche, ni gouttes ni
 * flocons). Écrit dans `out` et le rend.
 */
export function localWeather(sky: WeatherAmounts, spans: readonly Span[], s: number, out: WeatherAmounts): WeatherAmounts {
  const keep = 1 - dryAt(spans, s);
  const under = shelteredAt(spans, s);
  out.wet = sky.wet * keep;
  out.rain = sky.rain * (1 - under);
  out.snow = sky.snow * (1 - under);
  return out;
}

/** Section qui couvre l'abscisse `s` (la dernière avant elle sinon). */
function sectionAt(sections: readonly RailSection[], s: number): RailSection | undefined {
  let lo = 0;
  let hi = sections.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((sections[mid] as RailSection).from <= s) lo = mid;
    else hi = mid - 1;
  }
  return sections[lo];
}

/**
 * Attribut `pmbRoad` des sommets d'un maillage de chaussée (positions relatives à `origin`) : pour
 * chacun, le point du rail le plus proche entre les abscisses `from` et `to` (élargies de 20 m) donne
 * l'abscisse, l'écart à l'axe (positif à gauche de la marche), la part au sec (plus 2 en
 * agglomération) et la demi-largeur (négative sous la voûte d'un tunnel).
 */
export function roadAttribute(
  positions: ArrayLike<number>,
  origin: readonly number[],
  rail: ArrayLike<number>,
  step: number,
  from: number,
  to: number,
  sections: readonly RailSection[],
  spans: readonly Span[],
): Float32Array {
  const n = Math.floor(positions.length / 3);
  const out = new Float32Array(n * 4);
  const count = Math.floor(rail.length / 3);
  const i0 = Math.max(0, Math.floor((from - 20) / step));
  const i1 = Math.min(count - 1, Math.ceil((to + 20) / step));
  const ox = origin[0] ?? 0;
  const oz = origin[2] ?? 0;
  for (let v = 0; v < n; v += 1) {
    const x = (positions[v * 3] ?? 0) + ox;
    const z = (positions[v * 3 + 2] ?? 0) + oz;
    let best = i0;
    let bd = Infinity;
    for (let i = i0; i <= i1; i += 1) {
      const dx = (rail[i * 3] ?? 0) - x;
      const dz = (rail[i * 3 + 2] ?? 0) - z;
      const d = dx * dx + dz * dz;
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    const a = Math.max(0, Math.min(count - 2, best));
    const tx = (rail[(a + 1) * 3] ?? 0) - (rail[a * 3] ?? 0);
    const tz = (rail[(a + 1) * 3 + 2] ?? 0) - (rail[a * 3 + 2] ?? 0);
    const tl = Math.hypot(tx, tz) || 1;
    const dx = x - (rail[best * 3] ?? 0);
    const dz = z - (rail[best * 3 + 2] ?? 0);
    // Projection sur la tangente : abscisse fine ; gauche de la marche : (tz, −tx).
    const s = best * step + (dx * tx + dz * tz) / tl;
    out[v * 4] = s;
    out[v * 4 + 1] = (dx * tz - dz * tx) / tl;
    // Part au sec, plus 2 en agglomération (trottoirs plutôt qu'accotements herbeux).
    out[v * 4 + 2] = dryAt(spans, s) + (sectionAt(sections, s)?.urban ? 2 : 0);
    // Demi-largeur, négative sous la voûte d'un tunnel (ni lune ni ciel n'y éclairent).
    out[v * 4 + 3] = ((sectionAt(sections, s)?.width ?? 7) / 2) * (shelteredAt(spans, s) > 0 && Math.abs(out[v * 4 + 1] ?? 0) < (sectionAt(sections, s)?.width ?? 7) / 2 + 6 ? -1 : 1);
  }
  return out;
}

/**
 * Genre d'un bâtiment (0 ordinaire, 1 annexe, 2 hangar, 3 muret, 4 édifice), porté par la hauteur du
 * pied de ses murs sans un octet de plus dans la carte : tools/maps/build.mjs (piedCode) pose le pied
 * sur une grille de 10 cm, le relève de 10 cm, puis l'abaisse d'autant de centimètres que le genre
 * (le pied est sous le sol : rien ne se voit). Hors de 0 à 4 (carte d'avant ce codage), ordinaire.
 */
export function genreDuPied(y: number): number {
  const g = ((Math.round(-y * 100) % 10) + 10) % 10;
  return g <= 4 ? g : 0;
}

/**
 * Attribut `pmbFacade` d'un maillage de murs sans index (trois sommets par triangle) : pour chaque
 * triangle, pied (y le plus bas), sommet (y le plus haut) et, dans le troisième nombre, le genre du
 * bâtiment (partie entière, genreDuPied) plus une graine tirée de ces deux hauteurs (la même pour
 * les murs d'un bâtiment, à peu près).
 */
export function facadeAttribute(positions: ArrayLike<number>, origin: readonly number[]): Float32Array {
  const n = Math.floor(positions.length / 9);
  const out = new Float32Array(n * 9);
  const oy = origin[1] ?? 0;
  for (let t = 0; t < n; t += 1) {
    let lo = Infinity;
    let hi = -Infinity;
    for (let k = 0; k < 3; k += 1) {
      const y = (positions[t * 9 + k * 3 + 1] ?? 0) + oy;
      lo = Math.min(lo, y);
      hi = Math.max(hi, y);
    }
    const v = Math.sin(lo * 12.9898 + hi * 78.233) * 43758.5453;
    // Graine bornée sous 0,999 : la partie entière (le genre) ne déborde jamais en 32 bits.
    const seed = Math.min(0.999, v - Math.floor(v)) + genreDuPied(lo);
    for (let k = 0; k < 3; k += 1) {
      out[t * 9 + k * 3] = lo;
      out[t * 9 + k * 3 + 1] = hi;
      out[t * 9 + k * 3 + 2] = seed;
    }
  }
  return out;
}

/**
 * Lampes de voûte des tunnels couverts par l'intervalle d'abscisses [from, to] : une tous les
 * `SHELTER.lampEvery` m, à `SHELTER.lampHeight` m au-dessus de la chaussée (3 nombres chacune,
 * repère de la carte).
 */
export function tunnelLamps(spans: readonly Span[], from: number, to: number, rail: ArrayLike<number>, step: number): number[] {
  const out: number[] = [];
  const count = Math.floor(rail.length / 3);
  for (const t of spans) {
    const a = Math.max(t.from, from);
    const b = Math.min(t.to, to);
    for (let s = Math.ceil(a / SHELTER.lampEvery) * SHELTER.lampEvery; s <= b; s += SHELTER.lampEvery) {
      const i = Math.max(0, Math.min(count - 1, Math.round(s / step)));
      out.push(rail[i * 3] ?? 0, (rail[i * 3 + 1] ?? 0) + SHELTER.lampHeight, rail[i * 3 + 2] ?? 0);
    }
  }
  return out;
}
