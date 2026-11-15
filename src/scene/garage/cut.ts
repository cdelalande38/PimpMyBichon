// Coupe caméra du décor (§ 5.1, § 8) : quand on tourne autour du véhicule, ce qui passerait
// entre l'œil et lui (murs vus de dos, meubles, retombées, sources) quitte l'image. Module pur,
// sans three : la décision se prend ici, élément par élément, côté processeur ; le rendu
// (src/render/cut.ts) l'applique dans les nuanceurs par un identifiant porté par les sommets.
//
// Trois règles, et une hystérésis pour qu'un élément au bord ne clignote pas :
// - R1, adossement : un élément adossé à un mur (ou suspendu au plafond) disparaît dès que l'œil
//   passe derrière le plan de ce support, comme le mur lui-même, qui n'a qu'une face.
// - R2, dégagement : un élément disparaît s'il coupe le volume balayé entre l'œil E et le volume
//   protégé P (véhicule et reflet), l'enveloppe convexe de {E} ∪ P : la réunion, pour t de 0 à 1,
//   des boîtes E + t·(P − E). Test exact, six inégalités linéaires en t par boîte.
// - R3, support : un élément posé sur un autre, ou pendu dessous, disparaît avec lui.
// Repère de la pièce (src/data/garage.ts) : origine au centre du sol, x vers le mur droit,
// z vers le mur avant, y vers le haut.

export type Vec3 = readonly [number, number, number];

export interface Box {
  min: Vec3;
  max: Vec3;
}

/** Point de l'espace (un Vector3 de three convient). */
export interface Point {
  x: number;
  y: number;
  z: number;
}

export interface CutElement {
  /** Nom lisible (objet du mobilier, retombée, spot…), unique. */
  name: string;
  /** Boîtes englobantes de ses pièces, repère de la pièce. Une boîte vide (min > max) est ignorée. */
  parts: readonly Box[];
  /** Supports déclarés (noms d'autres éléments), quand la déduction par les boîtes ne suffit pas. */
  on?: readonly string[];
  /**
   * Lumière (cône sous un spot) : elle ne porte rien, et ses supports ne sont pas déduits des
   * boîtes (elle traverse le mobilier) : seulement les plans et `on`.
   */
  light?: boolean;
}

export interface CutRoom {
  width: number;
  depth: number;
  height: number;
}

export interface CutTolerances {
  /** Écart au plan d'un mur, du plafond ou du sol en deçà duquel un élément y est adossé. */
  wall: number;
  /** Écart entre deux éléments en deçà duquel l'un touche l'autre (support, R3). */
  contact: number;
}

/** Plans de la pièce gérés par R1 (bits) ; le sol tient, il ne cache jamais. */
export const PLANE = {
  left: 1,
  right: 2,
  back: 4,
  front: 8,
  ceiling: 16,
  floor: 32,
} as const;

/** Ordre des plans de R1 dans l'état (le sol n'y est pas). */
const R1_PLANES = [PLANE.left, PLANE.right, PLANE.back, PLANE.front, PLANE.ceiling] as const;

export interface CutStructure {
  readonly room: CutRoom;
  readonly names: readonly string[];
  readonly count: number;
  /** Boîtes des pièces, à plat (min x, y, z, max x, y, z), et début de chaque élément. */
  readonly parts: Float64Array;
  readonly partStart: Uint32Array;
  /** Plans touchés (bits de PLANE), et ceux qui font disparaître l'élément (R1). */
  readonly contacts: Uint8Array;
  readonly r1Planes: Uint8Array;
  /** Supports (R3) : indices d'éléments, à plat, et début de chaque élément. */
  readonly supportList: Uint32Array;
  readonly supportStart: Uint32Array;
  /** Éléments que rien ne tient (ni sol, ni mur, ni plafond, ni autre élément). */
  readonly floating: readonly string[];
}

/** Écart en deçà duquel deux cotes sont confondues (les géométries sont en flottants 32 bits). */
const EMPTY = 1e-4;

function unionOf(parts: readonly Box[]): Box | null {
  let result: [number, number, number, number, number, number] | null = null;
  for (const part of parts) {
    if (isEmpty(part)) continue;
    if (!result) {
      result = [part.min[0], part.min[1], part.min[2], part.max[0], part.max[1], part.max[2]];
      continue;
    }
    for (let k = 0; k < 3; k += 1) {
      result[k] = Math.min(result[k] ?? 0, part.min[k] ?? 0);
      result[3 + k] = Math.max(result[3 + k] ?? 0, part.max[k] ?? 0);
    }
  }
  return result ? { min: [result[0], result[1], result[2]], max: [result[3], result[4], result[5]] } : null;
}

export function isEmpty(box: Box): boolean {
  return box.min[0] > box.max[0] || box.min[1] > box.max[1] || box.min[2] > box.max[2];
}

/** Recouvrement strictement positif de deux intervalles. */
function overlaps(aMin: number, aMax: number, bMin: number, bMax: number): boolean {
  return Math.min(aMax, bMax) - Math.max(aMin, bMin) > EMPTY;
}

/** Recouvrement au sol (x et z) de deux boîtes. */
function footprintOverlap(a: Box, b: Box): boolean {
  return overlaps(a.min[0], a.max[0], b.min[0], b.max[0]) && overlaps(a.min[2], a.max[2], b.min[2], b.max[2]);
}

/** A posé sur la pièce B : son dessous dans le dessus de B ou juste au-dessus, A dépasse au-dessus. */
function restsOn(a: Box, b: Box, tolerance: number): boolean {
  return a.min[1] <= b.max[1] + tolerance && a.min[1] > b.min[1] + EMPTY && a.max[1] > b.max[1] + EMPTY && footprintOverlap(a, b);
}

/** A pendu sous la pièce B : son dessus contre le dessous de B, B dépasse au-dessus, A en dessous. */
function hangsFrom(a: Box, b: Box, tolerance: number): boolean {
  return Math.abs(a.max[1] - b.min[1]) <= tolerance && a.min[1] < b.min[1] - EMPTY && b.max[1] > a.max[1] + EMPTY && footprintOverlap(a, b);
}

/** A touche B (face contre face, ou mêlé), à la tolérance près. */
function touches(a: Box, b: Box, tolerance: number): boolean {
  for (let k = 0; k < 3; k += 1) {
    if ((a.min[k] ?? 0) > (b.max[k] ?? 0) + tolerance || (a.max[k] ?? 0) < (b.min[k] ?? 0) - tolerance) return false;
  }
  return true;
}

/**
 * Murs contre lesquels une pièce est adossée : elle les touche et s'étale le long de leur plan
 * plus qu'elle ne s'en éloigne. Une retombée qui court le long du mur du fond et bute sur le mur
 * gauche est adossée au premier, pas au second.
 */
function wallsAlong(part: Box, room: CutRoom, tolerance: number): number {
  const touched = planesTouched(part, room, tolerance);
  const size = [part.max[0] - part.min[0], part.max[1] - part.min[1], part.max[2] - part.min[2]] as const;
  const along = (depth: number, a: number, b: number) => depth <= Math.max(a, b) + EMPTY;
  let bits = 0;
  if (touched & (PLANE.left | PLANE.right) && along(size[0], size[1], size[2])) bits |= touched & (PLANE.left | PLANE.right);
  if (touched & (PLANE.back | PLANE.front) && along(size[2], size[0], size[1])) bits |= touched & (PLANE.back | PLANE.front);
  return bits;
}

/** Plans de la pièce touchés par une boîte (bits de PLANE). */
function planesTouched(box: Box, room: CutRoom, tolerance: number): number {
  const halfW = room.width / 2;
  const halfD = room.depth / 2;
  let bits = 0;
  if (box.min[0] <= -halfW + tolerance) bits |= PLANE.left;
  if (box.max[0] >= halfW - tolerance) bits |= PLANE.right;
  if (box.min[2] <= -halfD + tolerance) bits |= PLANE.back;
  if (box.max[2] >= halfD - tolerance) bits |= PLANE.front;
  if (box.max[1] >= room.height - tolerance) bits |= PLANE.ceiling;
  if (box.min[1] <= tolerance) bits |= PLANE.floor;
  return bits;
}

/**
 * Prépare la coupe d'une liste d'éléments : adossements (R1) et supports (R3), déduits des boîtes.
 * Calcul fait une fois, à la construction du garage. Lève une erreur sur un nom en double ou un
 * support déclaré inconnu ; les éléments que rien ne tient sont listés dans `floating`.
 */
export function analyzeCut(room: CutRoom, elements: readonly CutElement[], tolerances: CutTolerances): CutStructure {
  const count = elements.length;
  const names = elements.map((element) => element.name);
  const index = new Map<string, number>();
  names.forEach((name, i) => {
    if (index.has(name)) throw new Error(`Coupe : élément en double (${name})`);
    index.set(name, i);
  });

  const solid = elements.map((element) => element.parts.filter((part) => !isEmpty(part)));
  const boxes = solid.map(unionOf);
  const partStart = new Uint32Array(count + 1);
  const flat: number[] = [];
  solid.forEach((parts, i) => {
    partStart[i] = flat.length / 6;
    for (const part of parts) flat.push(...part.min, ...part.max);
  });
  partStart[count] = flat.length / 6;

  const contacts = new Uint8Array(count);
  const r1Planes = new Uint8Array(count);
  boxes.forEach((box, i) => {
    if (!box) return;
    const bits = planesTouched(box, room, tolerances.wall);
    contacts[i] = bits;
    let walls = 0;
    for (const part of solid[i] ?? []) walls |= wallsAlong(part, room, tolerances.wall);
    // Le plafond ne compte que pour ce qui n'a que lui : ce qui monte du sol jusqu'à lui (la
    // colonne) se voit d'en haut comme un mur se voit par sa tranche, et ce qui court le long
    // d'un mur (une retombée, avec ses spots) reste avec ce mur tant que l'œil ne l'a pas passé.
    const ceiling = bits & PLANE.floor || walls !== 0 ? 0 : bits & PLANE.ceiling;
    r1Planes[i] = walls | ceiling;
  });

  // Supports déclarés.
  const supports: Array<Set<number>> = elements.map(() => new Set<number>());
  elements.forEach((element, a) => {
    for (const name of element.on ?? []) {
      const b = index.get(name);
      if (b === undefined) throw new Error(`Coupe : support inconnu « ${name} » pour ${element.name}`);
      if (b !== a) supports[a]?.add(b);
    }
  });

  // Contacts verticaux : le dessous de l'un contre le dessus de l'autre. Reste à savoir qui porte
  // qui (posé dessus ou pendu dessous) : ce qui tient déjà (sol, mur, plafond, support tenu) porte
  // l'autre ; à égalité, ce qui tient au plafond porte ce qui pend dessous, sinon on pose.
  const pairs: Array<readonly [upper: number, lower: number]> = [];
  const known = new Set<string>();
  const pair = (upper: number, lower: number) => {
    if (known.has(`${upper}:${lower}`) || known.has(`${lower}:${upper}`)) return;
    known.add(`${upper}:${lower}`);
    pairs.push([upper, lower]);
  };
  // Le dessous d'un élément : ses pièces les plus basses ; son dessus : les plus hautes.
  const bottoms = solid.map((parts, i) => parts.filter((part) => part.min[1] <= (boxes[i]?.min[1] ?? 0) + tolerances.contact));
  const tops = solid.map((parts, i) => parts.filter((part) => part.max[1] >= (boxes[i]?.max[1] ?? 0) - tolerances.contact));
  // Rejet rapide par les boîtes d'objet : poser ou pendre demande que les deux boîtes se touchent
  // (à la tolérance près) et se recouvrent au sol ; seules les pièces de B proches de A sont
  // comparées. Mêmes décisions que la comparaison complète, pièce à pièce.
  elements.forEach((element, a) => {
    const boxA = boxes[a];
    if (element.light === true || !boxA) return;
    elements.forEach((other, b) => {
      const boxB = boxes[b];
      if (b === a || other.light === true || !boxB) return;
      if (!footprintOverlap(boxA, boxB) || !touches(boxA, boxB, tolerances.contact)) return;
      const parts = (solid[b] ?? []).filter((part) => touches(boxA, part, tolerances.contact));
      if (parts.length === 0) return;
      const on = bottoms[a]?.some((low) => parts.some((part) => restsOn(low, part, tolerances.contact)));
      if (on) pair(a, b);
      const under = tops[a]?.some((high) => parts.some((part) => hangsFrom(high, part, tolerances.contact)));
      if (under) pair(b, a);
    });
  });
  const held = Uint8Array.from(contacts, (bits) => (bits !== 0 ? 1 : 0));
  const open = pairs.map(() => true);
  let spread = true;
  while (spread) {
    spread = false;
    for (let a = 0; a < count; a += 1) {
      if (!held[a] && [...(supports[a] ?? [])].some((b) => held[b] === 1)) {
        held[a] = 1;
        spread = true;
      }
    }
    pairs.forEach(([upper, lower], p) => {
      if (!open[p] || held[upper] === held[lower]) return;
      const [carried, carrier] = held[upper] ? [lower, upper] : [upper, lower];
      supports[carried]?.add(carrier);
      held[carried] = 1;
      open[p] = false;
      spread = true;
    });
  }
  pairs.forEach(([upper, lower], p) => {
    if (!open[p]) return;
    const fromCeiling = ((contacts[upper] ?? 0) & PLANE.ceiling) !== 0 && ((contacts[upper] ?? 0) & PLANE.floor) === 0;
    const onFloor = ((contacts[lower] ?? 0) & PLANE.floor) !== 0;
    if (fromCeiling && onFloor && held[upper] && held[lower]) return;
    if (fromCeiling) supports[lower]?.add(upper);
    else supports[upper]?.add(lower);
  });

  // Tenue : par un plan, ou par un support tenu. Un élément encore libre se raccroche à ce qu'il
  // touche de côté (contact latéral).
  const anchored = new Uint8Array(count);
  let changed = true;
  while (changed) {
    changed = false;
    for (let a = 0; a < count; a += 1) {
      if (anchored[a]) continue;
      const held = (contacts[a] ?? 0) !== 0 || [...(supports[a] ?? [])].some((b) => anchored[b] === 1);
      if (held) {
        anchored[a] = 1;
        changed = true;
        continue;
      }
      const box = boxes[a];
      if (!box || elements[a]?.light === true) continue;
      for (let b = 0; b < count; b += 1) {
        const boxB = boxes[b];
        if (b === a || !anchored[b] || !boxB || elements[b]?.light === true || !touches(box, boxB, tolerances.contact)) continue;
        if (solid[b]?.some((part) => touches(box, part, tolerances.contact))) {
          supports[a]?.add(b);
          anchored[a] = 1;
          changed = true;
          break;
        }
      }
    }
  }

  const supportStart = new Uint32Array(count + 1);
  const list: number[] = [];
  supports.forEach((set, a) => {
    supportStart[a] = list.length;
    list.push(...[...set].sort((x, y) => x - y));
  });
  supportStart[count] = list.length;

  return {
    room: { ...room },
    names,
    count,
    parts: Float64Array.from(flat),
    partStart,
    contacts,
    r1Planes,
    supportList: Uint32Array.from(list),
    supportStart,
    floating: names.filter((_, i) => anchored[i] !== 1),
  };
}

/** Noms des supports d'un élément (diagnostic, tests). */
export function supportsOf(structure: CutStructure, name: string): string[] {
  const a = structure.names.indexOf(name);
  if (a < 0) throw new Error(`Coupe : élément inconnu (${name})`);
  const result: string[] = [];
  for (let i = structure.supportStart[a] ?? 0; i < (structure.supportStart[a + 1] ?? 0); i += 1) {
    result.push(structure.names[structure.supportList[i] ?? 0] ?? '');
  }
  return result;
}

/**
 * R2, le test exact : la boîte O (à plat dans `o`, à partir de `offset`) coupe-t-elle l'enveloppe
 * convexe de l'œil et de P ? Pour chaque axe k, la boîte E + t·(P − E) recoupe O si
 * E_k + t·(Pmax_k − E_k) ≥ Omin_k et E_k + t·(Pmin_k − E_k) ≤ Omax_k : six contraintes linéaires
 * en t, à croiser avec [0, 1]. Aucune allocation.
 */
export function hullHits(eye: Point, protect: Box, o: ArrayLike<number>, offset = 0): boolean {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 3; k += 1) {
    const e = k === 0 ? eye.x : k === 1 ? eye.y : eye.z;
    const oMin = o[offset + k] ?? 0;
    const oMax = o[offset + 3 + k] ?? 0;
    const pMin = protect.min[k] ?? 0;
    const pMax = protect.max[k] ?? 0;
    if (oMin > oMax || pMin > pMax) return false;
    // E + t (Pmax − E) ≥ Omin
    const a = pMax - e;
    const ra = oMin - e;
    if (a > 0) lo = Math.max(lo, ra / a);
    else if (a < 0) hi = Math.min(hi, ra / a);
    else if (ra > 0) return false;
    // E + t (Pmin − E) ≤ Omax
    const c = pMin - e;
    const rc = oMax - e;
    if (c > 0) hi = Math.min(hi, rc / c);
    else if (c < 0) lo = Math.max(lo, rc / c);
    else if (rc < 0) return false;
    if (lo > hi) return false;
  }
  return true;
}

/** Même test pour une boîte décrite par ses coins. */
export function boxInHull(eye: Point, protect: Box, box: Box): boolean {
  return hullHits(eye, protect, [...box.min, ...box.max]);
}

/** Mesure du véhicule posé (src/scene/bench/BenchCar.tsx) : demi-longueur (x local), demi-largeur, hauteur. */
export interface VehicleMeasure {
  halfLength: number;
  halfWidth: number;
  height: number;
}

export interface ProtectSettings {
  /** Boîte d'attente, repère de la pièce, tant que le véhicule n'est pas mesuré (ou s'il manque). */
  waiting: Box;
  /** Marge autour du véhicule sur les côtés et au-dessus, en mètres. */
  side: number;
  top: number;
  /**
   * Part du reflet du véhicule dans le carrelage qui est protégée, de 0 à 1 : le volume descend
   * sous le sol de cette fraction de la hauteur du véhicule (1 : son image entière, toit compris).
   */
  reflection: number;
  /** Gonflement supplémentaire du grand volume (hystérésis de R2). */
  hysteresis: number;
}

export interface ProtectBoxes {
  /** Boîte du véhicule, sans marge (repère de la pièce). */
  vehicle: Box;
  /** On masque ce qui coupe le volume balayé vers `small`… */
  small: Box;
  /** … et on ne le remontre qu'une fois sorti de celui vers `big`. */
  big: Box;
}

function inflate(box: Box, side: number, top: number, bottom: number): Box {
  return {
    min: [box.min[0] - side, box.min[1] - bottom, box.min[2] - side],
    max: [box.max[0] + side, box.max[1] + top, box.max[2] + side],
  };
}

/**
 * Volume protégé P : la boîte du véhicule mesuré dans le repère de la pièce (son groupe est
 * tourné de `turn` autour de la verticale), gonflée sur les côtés et au-dessus, prolongée sous le
 * sol. Sans mesure : la boîte d'attente.
 */
export function protectedBoxes(measure: VehicleMeasure | null, turn: number, settings: ProtectSettings): ProtectBoxes {
  let vehicle: Box = settings.waiting;
  if (measure) {
    const cos = Math.abs(Math.cos(turn));
    const sin = Math.abs(Math.sin(turn));
    const hx = cos * measure.halfLength + sin * measure.halfWidth;
    const hz = sin * measure.halfLength + cos * measure.halfWidth;
    vehicle = { min: [-hx, 0, -hz], max: [hx, measure.height, hz] };
  }
  const small = inflate(vehicle, settings.side, settings.top, 0);
  const below = settings.reflection * vehicle.max[1];
  const prolonged: Box = { min: [small.min[0], Math.min(small.min[1], -below), small.min[2]], max: small.max };
  const h = settings.hysteresis;
  return { vehicle, small: prolonged, big: inflate(prolonged, h, h, h) };
}

export interface CutState {
  /** Une décision a déjà été prise (sinon : pas d'hystérésis, état posé d'un coup). */
  ready: boolean;
  /** Œil derrière chaque plan de R1 (gauche, droite, fond, avant, plafond), avec hystérésis. */
  readonly planes: Uint8Array;
  /** R2 par élément, avec hystérésis. */
  readonly r2: Uint8Array;
  /** Décision finale par élément (1 : masqué). */
  readonly hidden: Uint8Array;
  /** Décision d'avant (tampon de travail). */
  readonly previous: Uint8Array;
  /** Nombre d'éléments masqués. */
  count: number;
  /** Augmente à chaque changement de la décision. */
  version: number;
}

export function createCutState(structure: CutStructure): CutState {
  return {
    ready: false,
    planes: new Uint8Array(R1_PLANES.length),
    r2: new Uint8Array(structure.count),
    hidden: new Uint8Array(structure.count),
    previous: new Uint8Array(structure.count),
    count: 0,
    version: 0,
  };
}

/** Distance (positive) de l'œil derrière le plan p de R1. */
function behind(plane: number, eye: Point, room: CutRoom): number {
  switch (plane) {
    case PLANE.left:
      return -room.width / 2 - eye.x;
    case PLANE.right:
      return eye.x - room.width / 2;
    case PLANE.back:
      return -room.depth / 2 - eye.z;
    case PLANE.front:
      return eye.z - room.depth / 2;
    default:
      return eye.y - room.height;
  }
}

function anyPartHits(structure: CutStructure, element: number, eye: Point, protect: Box): boolean {
  const end = structure.partStart[element + 1] ?? 0;
  for (let p = structure.partStart[element] ?? 0; p < end; p += 1) {
    if (hullHits(eye, protect, structure.parts, p * 6)) return true;
  }
  return false;
}

/**
 * Décide la coupe pour la position de l'œil : écrit dans `state` (aucune allocation), qui porte
 * aussi l'état précédent pour l'hystérésis. `band` : demi-largeur de la bande de R1, en mètres.
 * La décision ne dépend que de l'œil, de P et de l'état précédent : une projection décalée
 * (tuiles de l'export photo, sous-pixel) ne la change pas.
 */
export function decideCut(structure: CutStructure, eye: Point, protect: ProtectBoxes, band: number, state: CutState): CutState {
  const { count, room } = structure;
  const first = !state.ready;
  let behindMask = 0;
  for (let p = 0; p < R1_PLANES.length; p += 1) {
    const plane = R1_PLANES[p] ?? 0;
    const s = behind(plane, eye, room);
    let on = state.planes[p] === 1;
    if (first) on = s > 0;
    else if (s > band) on = true;
    else if (s < -band) on = false;
    state.planes[p] = on ? 1 : 0;
    if (on) behindMask |= plane;
  }

  const { hidden, r2, previous } = state;
  for (let i = 0; i < count; i += 1) {
    previous[i] = hidden[i] ?? 0;
    let hit: boolean;
    if (!anyPartHits(structure, i, eye, protect.big)) hit = false;
    else if (anyPartHits(structure, i, eye, protect.small)) hit = true;
    else hit = first ? false : r2[i] === 1;
    r2[i] = hit ? 1 : 0;
    const base = hit || ((structure.r1Planes[i] ?? 0) & behindMask) !== 0 ? 1 : 0;
    hidden[i] = base;
  }
  // R3 : un élément disparaît avec ce qui le porte (point fixe ; peu de niveaux en pratique).
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 0; i < count; i += 1) {
      if (hidden[i] === 1) continue;
      const end = structure.supportStart[i + 1] ?? 0;
      for (let s = structure.supportStart[i] ?? 0; s < end; s += 1) {
        if (hidden[structure.supportList[s] ?? 0] === 1) {
          hidden[i] = 1;
          changed = true;
          break;
        }
      }
    }
  }
  let masked = 0;
  let flips = 0;
  for (let i = 0; i < count; i += 1) {
    masked += hidden[i] ?? 0;
    if (hidden[i] !== previous[i]) flips += 1;
  }
  if (first || flips > 0) state.version += 1;
  state.count = masked;
  state.ready = true;
  return state;
}

/**
 * Fondu : rapproche la valeur de chaque élément (1 visible, 0 masqué) de sa cible, d'au plus
 * `step` (1 ou plus : d'un coup). `fades[0]` est l'identifiant 0, jamais masqué ; l'élément i est
 * à `fades[i + 1]`. Rend vrai tant qu'un fondu est en cours.
 */
export function stepFades(fades: Float32Array, hidden: Uint8Array, step: number): boolean {
  let moving = false;
  fades[0] = 1;
  for (let i = 0; i < hidden.length; i += 1) {
    const target = hidden[i] === 1 ? 0 : 1;
    const current = fades[i + 1] ?? 1;
    if (current === target) continue;
    const next = current < target ? Math.min(target, current + step) : Math.max(target, current - step);
    fades[i + 1] = next;
    if (next !== target) moving = true;
  }
  return moving;
}

/**
 * Porteurs de la trame : les matériaux opaques du décor, chacun avec les éléments qu'il dessine.
 * Identifiants de coupe (élément i : i + 1), à plat, triés, sans doublon ni 0 (jamais masqué), et
 * début de chaque porteur dans la liste.
 */
export interface DitherOwners {
  readonly count: number;
  readonly ids: Uint16Array;
  readonly start: Uint32Array;
}

/** Prépare les porteurs à partir des identifiants que chacun dessine (dans n'importe quel ordre). */
export function ditherOwners(lists: ReadonlyArray<Iterable<number>>): DitherOwners {
  const start = new Uint32Array(lists.length + 1);
  const flat: number[] = [];
  lists.forEach((list, i) => {
    start[i] = flat.length;
    const ids = [...new Set(list)].filter((id) => Number.isInteger(id) && id > 0).sort((a, b) => a - b);
    flat.push(...ids);
  });
  start[lists.length] = flat.length;
  return { count: lists.length, ids: Uint16Array.from(flat), start };
}

/**
 * Un élément est en fondu quand sa valeur est strictement entre 0 (masqué : ses sommets quittent le
 * volume de vue) et 1 (visible) : c'est seulement là que la trame rejette des fragments.
 */
export function inFade(value: number): boolean {
  return value > 0 && value < 1;
}

/**
 * Quel porteur doit porter la trame : celui dont au moins un élément est en fondu. Les autres
 * dessinent sans aucun rejet de fragments (variante sans `discard`). `fades` : valeur par
 * identifiant (`stepFades`). Écrit 1 ou 0 par porteur dans `out` et rend le nombre de porteurs en
 * trame. Aucune allocation.
 */
export function ditherNeeds(fades: ArrayLike<number>, owners: DitherOwners, out: Uint8Array): number {
  let active = 0;
  for (let m = 0; m < owners.count; m += 1) {
    let need = 0;
    const end = owners.start[m + 1] ?? 0;
    for (let k = owners.start[m] ?? 0; k < end; k += 1) {
      if (inFade(fades[owners.ids[k] ?? 0] ?? 1)) {
        need = 1;
        break;
      }
    }
    out[m] = need;
    active += need;
  }
  return active;
}
