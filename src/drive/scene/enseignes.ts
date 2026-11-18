// Enseignes au néon de la sortie de nuit (§ 5.5 : enseignes fictives en ville). Aucune marque, aucun
// nom propre : des mots d'atelier en français, des flèches et des formes, dessinés une fois en code
// dans un atlas (tubes nets dans le rouge, leur lueur floutée dans le vert ; rien de téléchargé). Les
// enseignes sont posées par tronçon d'agglomération sur les façades qui bordent la route (sondées
// par un rayon depuis l'axe), en instances : un appel de dessin par tronçon. Elles se reflètent
// dans la chaussée mouillée et dans la caisse (reflet planaire et sonde). Quand la carte connaît les
// commerces du bord de la route (OpenStreetMap, MapChunk.shops), chacun a son enseigne, du côté où
// il est, au mot de sa nature (BAR, CAFÉ, PHARMACIE…) : jamais son nom.

import type { MapShopKind } from '../../data/mapTypes.ts';
import {
  AdditiveBlending,
  Color,
  DataTexture,
  DoubleSide,
  InstancedBufferAttribute,
  InstancedMesh,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix4,
  Mesh,
  PlaneGeometry,
  Quaternion,
  Raycaster,
  RGBAFormat,
  ShaderMaterial,
  Vector3,
  type BufferGeometry,
} from 'three';

/** Ce que portent les enseignes : mots d'atelier et formes (cases de l'atlas, dans l'ordre). */
export const SIGN_ITEMS: readonly string[] = [
  'ATELIER', 'GARAGE', 'PNEUS', 'OUVERT', 'CAFÉ', 'BAR', 'HÔTEL', 'CHROME',
  'VIDANGE', 'LAVAGE', 'PIÈCES', 'NUIT', '→', '←', '>>>', '★',
  'RESTO', 'GLACES', 'CLUB', 'PHARMACIE', 'STATION', 'PAIN', 'CINÉMA', 'BOUTIQUE',
];

/** Enseignes posées au jugé (cartes sans commerces connus) : les seize premières cases. */
const RANDOM_CELLS = 16;

/** Mot de l'enseigne d'un commerce, selon sa nature. */
export const SHOP_SIGNS: Readonly<Record<MapShopKind, string>> = {
  bar: 'BAR', cafe: 'CAFÉ', resto: 'RESTO', glaces: 'GLACES', club: 'CLUB', pharmacie: 'PHARMACIE', station: 'STATION', hotel: 'HÔTEL',
  garage: 'GARAGE', lavage: 'LAVAGE', pneus: 'PNEUS', pieces: 'PIÈCES', pain: 'PAIN', cinema: 'CINÉMA', boutique: 'BOUTIQUE',
};

/** Case de l'atlas d'un commerce. */
export function shopSignCell(kind: MapShopKind): number {
  return Math.max(0, SIGN_ITEMS.indexOf(SHOP_SIGNS[kind]));
}

/** Cases des enseignes d'ambiance quand les commerces sont connus : rien qui se fasse passer pour un commerce. */
export const DECOR_SIGN_CELLS: readonly number[] = ['OUVERT', 'NUIT', 'CHROME', 'ATELIER', '→', '←', '>>>', '★'].map((w) => SIGN_ITEMS.indexOf(w));

/** Teintes des tubes (sRGB). */
export const SIGN_COLORS: readonly string[] = ['#ff2bd6', '#22e4ff', '#ff3340', '#3b6dff', '#ffb02e', '#7dff4a', '#b04bff'];

const COLS = 4;
const ROWS = 6;
/** Cases de l'atlas (colonnes, rangées) : les caissons de jour y lisent leurs tubes (src/drive/scene/decor.ts). */
export const SIGN_ATLAS = { cols: COLS, rows: ROWS } as const;
const CW = 256;
const CH = 128;

/** Taille d'une enseigne, en mètres (le rapport de la case de l'atlas). */
export const SIGN_SIZE = { width: 3.2, height: 1.6 } as const;

function drawItem(ctx: CanvasRenderingContext2D, item: string, cx: number, cy: number, framed: boolean): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  if (item === '→' || item === '←') {
    const dir = item === '→' ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(cx - dir * 90, cy - 14);
    ctx.lineTo(cx + dir * 30, cy - 14);
    ctx.lineTo(cx + dir * 30, cy - 40);
    ctx.lineTo(cx + dir * 95, cy);
    ctx.lineTo(cx + dir * 30, cy + 40);
    ctx.lineTo(cx + dir * 30, cy + 14);
    ctx.lineTo(cx - dir * 90, cy + 14);
    ctx.closePath();
    ctx.stroke();
    return;
  }
  if (item === '>>>') {
    for (let k = -1; k <= 1; k += 1) {
      ctx.beginPath();
      ctx.moveTo(cx + k * 60 - 22, cy - 38);
      ctx.lineTo(cx + k * 60 + 18, cy);
      ctx.lineTo(cx + k * 60 - 22, cy + 38);
      ctx.stroke();
    }
    return;
  }
  if (item === '★') {
    ctx.beginPath();
    for (let k = 0; k < 10; k += 1) {
      const r = k % 2 === 0 ? 50 : 21;
      const a = -Math.PI / 2 + (k * Math.PI) / 5;
      ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    ctx.closePath();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, 58, 0, Math.PI * 2);
    ctx.stroke();
    return;
  }
  const size = item.length > 6 ? 40 : item.length > 4 ? 50 : 62;
  ctx.font = `bold ${size}px 'Russo One', 'Arial Black', Impact, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.strokeText(item, cx, cy + 2, CW - 36);
  if (framed) {
    ctx.beginPath();
    ctx.roundRect(cx - CW / 2 + 9, cy - CH / 2 + 12, CW - 18, CH - 24, 16);
    ctx.stroke();
  }
}

/**
 * Atlas des enseignes : 4 × 6 cases de 256 × 128 px. Rouge : les tubes ; vert : leur lueur. Fabriqué
 * par le navigateur (canvas 2D), une fois par sortie.
 */
export function createSignAtlas(): DataTexture {
  const w = CW * COLS;
  const h = CH * ROWS;
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
  const pass = (lineWidth: number, blur: number): Uint8ClampedArray => {
    ctx.clearRect(0, 0, w, h);
    ctx.filter = blur > 0 ? `blur(${blur}px)` : 'none';
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = lineWidth;
    SIGN_ITEMS.forEach((item, i) => {
      const cx = (i % COLS) * CW + CW / 2;
      const cy = Math.floor(i / COLS) * CH + CH / 2;
      drawItem(ctx, item, cx, cy, i % 3 === 1);
    });
    return ctx.getImageData(0, 0, w, h).data;
  };
  const tubes = pass(4.5, 0);
  const glow = pass(13, 9);
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i += 1) {
    data[i * 4] = tubes[i * 4 + 3] ?? 0;
    data[i * 4 + 1] = glow[i * 4 + 3] ?? 0;
    data[i * 4 + 3] = 255;
  }
  const texture = new DataTexture(data, w, h, RGBAFormat);
  texture.flipY = false;
  texture.generateMipmaps = true;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.magFilter = LinearFilter;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

const SIGN_VERTEX = /* glsl */ `
attribute float aCell;
uniform float uFogFar;
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
varying float vSeed;
void main() {
  float col = mod( aCell, ${COLS}.0 );
  float row = floor( aCell / ${COLS}.0 );
  vUv = vec2( ( col + uv.x ) / ${COLS}.0, ( row + 1.0 - uv.y ) / ${ROWS}.0 );
  vColor = instanceColor;
  vSeed = fract( instanceMatrix[ 3 ].x * 0.137 + instanceMatrix[ 3 ].z * 0.071 );
  vec4 mv = modelViewMatrix * instanceMatrix * vec4( position, 1.0 );
  vFade = 1.0 - smoothstep( uFogFar * 0.3, uFogFar * 0.85, -mv.z );
  gl_Position = projectionMatrix * mv;
}`;

const SIGN_FRAGMENT = /* glsl */ `
uniform sampler2D uAtlas;
uniform float uTime;
// Néons allumés (1 la nuit) ou éteints (0 le jour) : src/data/moments.ts.
uniform float uOn;
varying vec2 vUv;
varying vec3 vColor;
varying float vFade;
varying float vSeed;
void main() {
  vec2 a = texture2D( uAtlas, vUv ).rg;
  // Une enseigne sur sept grésille.
  float flicker = vSeed > 0.86 ? step( 0.25, fract( sin( floor( uTime * 9.0 + vSeed * 50.0 ) * 12.9898 ) * 43758.5453 ) ) * 0.85 + 0.15 : 1.0;
  vec3 c = vColor * ( a.r * 7.0 + a.g * a.g * 1.1 ) + vec3( 1.0 ) * a.r * a.r * 1.5;
  gl_FragColor = vec4( c * flicker * vFade * uOn, 1.0 );
}`;

/** Matière des enseignes : additive, double face, fondue dans la brume au loin. */
export function createSignMaterial(atlas: DataTexture, time: { value: number }, fogFar: number): ShaderMaterial {
  const material = new ShaderMaterial({
    vertexShader: SIGN_VERTEX,
    fragmentShader: SIGN_FRAGMENT,
    uniforms: { uAtlas: { value: atlas }, uTime: time, uFogFar: { value: fogFar }, uOn: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    fog: false,
  });
  material.name = 'nuit_enseignes';
  return material;
}

/** Hachage déterministe d'un nombre (même tirage à chaque sortie). */
function hash(x: number): number {
  const v = Math.sin(x * 12.9898 + 78.233) * 43758.5453;
  return v - Math.floor(v);
}

export interface SignSpot {
  /** Point de l'axe de la route, sa tangente (horizontale), son abscisse et la largeur de la chaussée. */
  point: Vector3;
  tangent: Vector3;
  s: number;
  width: number;
  /** Case de l'atlas imposée (commerce connu, ou mot d'ambiance) ; sinon tirée au sort. */
  cell?: number;
  /** Côté imposé : 1 à gauche de la marche, −1 à droite ; sinon tiré au sort. */
  side?: 1 | -1;
  /** Toujours posée (commerce connu) : ni tirage, ni abandon faute de façade. */
  always?: boolean;
}

/** Enseignes posées d'un tronçon : leur instance, et les mâts des enseignes sur pied (matrices d'une boîte unité). */
export interface PlacedSigns {
  signs: InstancedMesh | null;
  poles: Matrix4[];
  /** Centre de chaque enseigne dans le repère de la carte, et sa teinte linéaire (3 + 3 nombres). */
  lights: number[];
}

const ray = new Raycaster();
const work = { dir: new Vector3(), origin: new Vector3(), n: new Vector3(), q: new Quaternion(), q2: new Quaternion(), m: new Matrix4(), s: new Vector3(1, 1, 1), z: new Vector3(0, 0, 1), color: new Color() };

/**
 * Pose les enseignes sur les façades (`walls`, maillages de murs du tronçon, matrices du monde à
 * jour) le long de `spots`, posées dans le repère du tronçon (`origin`) : un rayon par point et par côté tiré au sort, jusqu'à 42 m de l'axe.
 * Sans façade à portée, une fois sur deux, une enseigne sur pied au bord de la chaussée, tournée
 * vers ceux qui arrivent. Rend l'instance (à ajouter au groupe du tronçon ; sa géométrie est à elle,
 * à libérer avec elle) et les mâts.
 */
export function placeSigns(walls: Mesh[], spots: readonly SignSpot[], origin: Vector3, material: ShaderMaterial): PlacedSigns {
  const poles: Matrix4[] = [];
  const lights: number[] = [];
  if (spots.length === 0) return { signs: null, poles, lights };
  const mats: Matrix4[] = [];
  const cells: number[] = [];
  const colors: Color[] = [];
  for (const spot of spots) {
    const h = hash(spot.s);
    if (!spot.always && h > 0.85) continue;
    const side = spot.side ?? (hash(spot.s + 0.5) > 0.5 ? 1 : -1);
    const cell = spot.cell ?? Math.floor(hash(spot.s + 3.1) * RANDOM_CELLS) % RANDOM_CELLS;
    // Gauche de la marche : Y × tangente = (tz, 0, −tx).
    work.dir.set(spot.tangent.z * side, 0, -spot.tangent.x * side).normalize();
    const lift = 2.4 + hash(spot.s + 1.7) * 1.8;
    work.origin.copy(spot.point).setY(spot.point.y + lift);
    ray.set(work.origin, work.dir);
    ray.far = 42;
    const hit = walls.length > 0 ? ray.intersectObjects(walls, false)[0] : undefined;
    if (!hit || !hit.face || hit.distance < 4) {
      if (!spot.always && hash(spot.s + 5.3) > 0.5) continue;
      // Enseigne sur pied : au bord de la chaussée, de biais vers ceux qui arrivent.
      const edge = spot.width / 2 + 2.4;
      const p = spot.point.clone().addScaledVector(work.dir, edge).sub(origin);
      const top = 3.3 + hash(spot.s + 6.1) * 1.2;
      p.y += top;
      work.n.copy(work.dir).multiplyScalar(-0.55).addScaledVector(spot.tangent, -0.85).normalize();
      work.q.setFromUnitVectors(work.z, work.n);
      mats.push(new Matrix4().compose(p, work.q.clone(), work.s));
      cells.push(cell);
      colors.push(new Color(SIGN_COLORS[Math.floor(hash(spot.s + 4.9) * SIGN_COLORS.length) % SIGN_COLORS.length]));
      const foot = p.clone().setY(p.y - top);
      const height = top - SIGN_SIZE.height / 2;
      poles.push(new Matrix4().compose(foot.setY(foot.y + height / 2), work.q.clone(), new Vector3(0.14, height, 0.14)));
      continue;
    }
    work.n.copy(hit.face.normal).setY(0);
    if (work.n.lengthSq() < 0.25) continue;
    work.n.normalize();
    if (work.n.dot(work.dir) > 0) work.n.negate();
    work.q.setFromUnitVectors(work.z, work.n);
    // Une enseigne sur trois se lit de bas en haut (enseigne verticale).
    if (hash(spot.s + 2.3) < 0.33) work.q.multiply(work.q2.setFromAxisAngle(work.z, Math.PI / 2));
    const p = hit.point.clone().addScaledVector(work.n, 0.14).sub(origin);
    mats.push(new Matrix4().compose(p, work.q.clone(), work.s));
    cells.push(cell);
    colors.push(new Color(SIGN_COLORS[Math.floor(hash(spot.s + 4.9) * SIGN_COLORS.length) % SIGN_COLORS.length]));
  }
  if (mats.length === 0) return { signs: null, poles, lights };
  mats.forEach((m, i) => {
    const c = colors[i] as Color;
    // Un peu devant l'enseigne : la lumière part de ses tubes, pas du mur.
    work.n.set(0, 0, 0.6).transformDirection(m);
    lights.push(m.elements[12] + origin.x + work.n.x * 0.6, m.elements[13] + origin.y, m.elements[14] + origin.z + work.n.z * 0.6, c.r, c.g, c.b);
  });
  const geometry: BufferGeometry = new PlaneGeometry(SIGN_SIZE.width, SIGN_SIZE.height);
  const mesh = new InstancedMesh(geometry, material, mats.length);
  mats.forEach((m, i) => {
    mesh.setMatrixAt(i, m);
    mesh.setColorAt(i, colors[i] as Color);
  });
  geometry.setAttribute('aCell', new InstancedBufferAttribute(new Float32Array(cells), 1));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = 'enseignes';
  return { signs: mesh, poles, lights };
}
