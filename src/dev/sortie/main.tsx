// Aperçu de la sortie de nuit : page de développement servie par le serveur de développement
// seulement (jamais importée par l'app, absente du build). Elle monte la scène de la sortie
// (src/drive/DriveCanvas.tsx) sur une carte de public/assets/maps/ avec un véhicule du catalogue,
// peint selon son build enregistré (ou ses teintes d'origine).
//
// Paramètres d'URL :
//   carte=<id>       dossier sous public/assets/maps/ (la première carte trouvée par défaut : obligatoire)
//   vehicule=<id>    véhicule du catalogue (le véhicule de départ par défaut)
//   s=<m>            abscisse de départ (sinon le premier départ de la carte)
//   camera=<id>      poursuite (défaut), rasante, avant, embarquee, travelling, orbite ; realisateur
//   meteo=pluie      pluie ou neige (sec par défaut)
//   qualite=<niveau> eco, standard, max (sinon le réglage de l'app)
//   propre           sans le cartouche d'information
//   peinture=<finition>:<rrggbb>  peinture de la zone maîtresse (finition de src/data/finishes.ts)
// window.pmbSortie : aller({ s, camera, meteo }) (promesse résolue quand les tronçons sont là),
// mesurer() (triangles et appels de dessin de la passe principale), cadence(ms) (images par seconde),
// peindre(finition, couleur), caisse() (luminance de la caisse dans l'image : moyenne, haute, part
// saturée, contour, halo autour du véhicule).
// Captures : node tools/captures/sortie.mjs.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Color, CubeCamera, DataUtils, HalfFloatType, MeshBasicMaterial, Vector3, WebGLCubeRenderTarget, WebGLRenderTarget, type Material, type Mesh, type Object3D, type PerspectiveCamera, type Scene, type WebGLRenderer } from 'three';
import { FINISHES, type FinishId } from '../../data/finishes.ts';
import { paintZoneOf } from '../../data/materialRoles.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import { masterZone, useBuilds } from '../../state/builds.ts';
import { NO_MIRROR_LAYER, PROBE_ONLY_LAYER } from '../../render/layers.ts';
import type { MapManifest } from '../../data/mapTypes.ts';
import { VEHICLES, vehicleById } from '../../data/vehicles.ts';
import { CAMERA_IDS, type CameraId } from '../../drive/contrat.ts';
import DriveCanvas from '../../drive/DriveCanvas.tsx';
import { driveDebug } from '../../drive/scene/debug.ts';
import type { QualitySetting } from '../../state/settings.ts';
import { useDrive } from '../../state/drive.ts';
import { useSettings } from '../../state/store.ts';

const params = new URLSearchParams(location.search);
const info = document.getElementById('info') as HTMLDivElement;
if (params.has('propre')) document.body.dataset.propre = '1';

interface Aller {
  s?: number;
  camera?: string;
  meteo?: string;
}

function appliquer({ camera: brut, meteo }: Aller) {
  // « orbite@1.6 » : caméra d'orbite, angle autour du véhicule en radians (0 derrière lui).
  const [camera, yaw] = (brut ?? '').split('@');
  if (yaw !== undefined) useDrive.setState((state) => ({ orbit: { ...state.orbit, yaw: Number(yaw) } }));
  if (camera === 'realisateur') useDrive.setState({ director: true });
  else if (camera && (CAMERA_IDS as readonly string[]).includes(camera)) useDrive.setState({ director: false, camera: camera as CameraId });
  if (meteo === 'pluie' || meteo === 'sec' || meteo === 'neige') useDrive.setState({ weather: meteo });
}

const frames = (n: number) =>
  new Promise<void>((resolve) => {
    let k = 0;
    const tick = () => {
      k += 1;
      if (k >= n) resolve();
      else requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });

let premier = true;

async function aller(v: Aller): Promise<void> {
  // La pluie monte et descend en deux secondes environ : on attend qu'elle soit posée (et au premier
  // plan, la météo enregistrée du joueur peut encore s'effacer).
  const meteoChange = premier || (v.meteo !== undefined && v.meteo !== useDrive.getState().weather);
  premier = false;
  appliquer(v);
  if (typeof v.s === 'number') driveDebug.seek?.(v.s);
  const limite = performance.now() + 60_000;
  await frames(2);
  while (!(driveDebug.settled?.() ?? false)) {
    if (performance.now() > limite) throw new Error('tronçons non chargés après 60 s');
    await frames(5);
  }
  // Sonde complète et pluie posée : quelques images de plus.
  await frames(meteoChange ? 180 : 24);
}

async function cadence(ms = 3000): Promise<{ fps: number; moyenne: number; mediane: number; p95: number }> {
  const t: number[] = [];
  const fin = performance.now() + ms;
  await new Promise<void>((resolve) => {
    const tick = (now: number) => {
      t.push(now);
      if (now < fin) requestAnimationFrame(tick);
      else resolve();
    };
    requestAnimationFrame(tick);
  });
  const d = t.slice(1).map((x, i) => x - (t[i] ?? x));
  d.sort((a, b) => a - b);
  const moyenne = d.reduce((a, b) => a + b, 0) / Math.max(1, d.length);
  return { fps: 1000 / moyenne, moyenne, mediane: d[d.length >> 1] ?? 0, p95: d[Math.floor(d.length * 0.95)] ?? 0 };
}

/**
 * Scintillement : sur `images` images consécutives, part des pixels dont la luminance change de plus
 * de `seuil` (sur 255) d'une image à l'autre (`change`), et part de ceux qui font l'aller-retour sur
 * trois images (`va_et_vient` : hausse puis baisse, ou l'inverse, toutes deux au-delà du seuil). À
 * l'arrêt (`figer`), tout changement est un défaut ; en roulant, le va-et-vient est le scintillement.
 */
async function scintillement(images = 40, figer = false, seuil = 16, lent = false): Promise<{ change: number; va_et_vient: number; images: number }> {
  driveDebug.figer = figer;
  // Au ralenti (quart de la vitesse), le défilement d'une image à l'autre est faible : ce qui fait
  // l'aller-retour est le scintillement (combats de profondeur, crénelage, lumières qui sautent).
  if (lent) useDrive.setState({ slow: true });
  await frames(4);
  let w = 0;
  let h = 0;
  let pixels = new Uint8Array(0);
  const lumas: Uint8Array[] = [];
  let change = 0;
  let flip = 0;
  let n = 0;
  await new Promise<void>((resolve) => {
    driveDebug.afterFrame = (raw) => {
      const gl = (raw as { getContext: () => WebGL2RenderingContext }).getContext();
      w = gl.drawingBufferWidth;
      h = gl.drawingBufferHeight;
      if (pixels.length !== w * h * 4) pixels = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      const luma = lumas.length >= 3 ? (lumas.shift() as Uint8Array) : new Uint8Array(w * h);
      for (let i = 0; i < w * h; i += 1) luma[i] = ((pixels[i * 4] ?? 0) * 54 + (pixels[i * 4 + 1] ?? 0) * 183 + (pixels[i * 4 + 2] ?? 0) * 19) >> 8;
      lumas.push(luma);
      if (lumas.length >= 2) {
        const a = lumas[lumas.length - 2] as Uint8Array;
        let c = 0;
        for (let i = 0; i < w * h; i += 1) if (Math.abs((luma[i] ?? 0) - (a[i] ?? 0)) > seuil) c += 1;
        change += c / (w * h);
      }
      if (lumas.length >= 3) {
        const a = lumas[0] as Uint8Array;
        const b = lumas[1] as Uint8Array;
        let f = 0;
        for (let i = 0; i < w * h; i += 1) {
          const d1 = (b[i] ?? 0) - (a[i] ?? 0);
          const d2 = (luma[i] ?? 0) - (b[i] ?? 0);
          if ((d1 > seuil && d2 < -seuil) || (d1 < -seuil && d2 > seuil)) f += 1;
        }
        flip += f / (w * h);
        n += 1;
      }
      if (n >= images) {
        delete driveDebug.afterFrame;
        resolve();
      }
    };
  });
  driveDebug.figer = false;
  if (lent) useDrive.setState({ slow: false });
  const pct = (x: number) => Math.round((x / Math.max(1, n)) * 1e5) / 1e3;
  return { change: pct(change), va_et_vient: pct(flip), images: n };
}

/**
 * Temps du processeur graphique par image (EXT_disjoint_timer_query_webgl2), médiane sur `images`
 * images : toute l'image, sonde et reflet compris. Indépendant de la charge du processeur central.
 */
async function gpu(images = 90): Promise<{ mediane: number; moyenne: number; n: number } | null> {
  const canvas = document.querySelector('canvas');
  const gl = canvas?.getContext('webgl2');
  const ext = gl?.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  if (!gl || !ext) return null;
  const pending: WebGLQuery[] = [];
  const times: number[] = [];
  let open: WebGLQuery | null = null;
  await new Promise<void>((resolve) => {
    driveDebug.beforeFrame = () => {
      if (open) return;
      open = gl.createQuery();
      if (open) gl.beginQuery(ext.TIME_ELAPSED_EXT, open);
    };
    driveDebug.afterFrame = () => {
      if (open) {
        gl.endQuery(ext.TIME_ELAPSED_EXT);
        pending.push(open);
        open = null;
      }
      while (pending.length > 0) {
        const q = pending[0] as WebGLQuery;
        if (!gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)) break;
        pending.shift();
        if (!gl.getParameter(ext.GPU_DISJOINT_EXT)) times.push(Number(gl.getQueryParameter(q, gl.QUERY_RESULT)) / 1e6);
        gl.deleteQuery(q);
      }
      if (times.length >= images) {
        delete driveDebug.beforeFrame;
        delete driveDebug.afterFrame;
        resolve();
      }
    };
  });
  times.sort((a, b) => a - b);
  return { mediane: times[times.length >> 1] ?? 0, moyenne: times.reduce((a, b) => a + b, 0) / times.length, n: times.length };
}

/** Peint la zone maîtresse du véhicule (les zones liées suivent), comme l'atelier. */
function peindre(vehicle: VehicleManifest, finish: string, color: string): void {
  const master = masterZone(vehicle);
  const known = FINISHES.find((f) => f.id === finish);
  if (!master || !known) return;
  useBuilds.getState().setPaint(vehicle.id, master.id, { finish: known.id as FinishId, color: color.startsWith('#') ? color : `#${color}` });
}

interface Stats {
  /** Luminance (0 à 255, image finale) : moyenne, 99e centile. */
  moyenne: number;
  haute: number;
  /** Part des pixels dont une composante dépasse 250, en %. */
  saturee: number;
  pixels: number;
}

/** Relevé de la caisse dans l'image : la caisse entière, son contour (2 px), son cœur, le reste du véhicule et le halo autour. */
export interface ReleveCaisse {
  caisse: Stats;
  contour: Stats;
  coeur: Stats;
  reste: Stats;
  /** Luminance moyenne du décor à 1-4 px du véhicule, puis à 16-24 px (le fond) : l'écart est le halo. */
  halo: number;
  fond: number;
}

const MASK_LAYER = 30;
const maskCaisse = new MeshBasicMaterial({ color: 0xff0000, fog: false });
const maskReste = new MeshBasicMaterial({ color: 0x00ff00, fog: false });
let maskTarget: WebGLRenderTarget | null = null;

function stats(values: number[], sat: number): Stats {
  const n = values.length;
  if (n === 0) return { moyenne: 0, haute: 0, saturee: 0, pixels: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const r = (x: number) => Math.round(x * 10) / 10;
  return { moyenne: r(values.reduce((a, b) => a + b, 0) / n), haute: r(sorted[Math.floor(n * 0.99)] ?? 0), saturee: r((sat / n) * 100), pixels: n };
}

/** Masque du véhicule vu par la caméra (1 : caisse peinte, 2 : reste du véhicule), même taille que l'image. */
function masqueVehicule(renderer: WebGLRenderer, vehicle: VehicleManifest, w: number, h: number): Uint8Array {
  const scene = driveDebug.scene as Scene;
  const camera = driveDebug.camera as PerspectiveCamera;
  const swapped: Array<[Mesh, Material | Material[], number]> = [];
  const caisse = (name: string) => {
    const zone = vehicle.zones.find((z) => z.materials.includes(name) || paintZoneOf(name) === z.id);
    return zone?.group === 'carrosserie';
  };
  const visit = (object: Object3D) => {
    if (!object.visible || object.name === 'phares') return;
    const mesh = object as Mesh;
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    if (mesh.isMesh && (material as { isMeshStandardMaterial?: boolean } | undefined)?.isMeshStandardMaterial) {
      swapped.push([mesh, mesh.material, mesh.layers.mask]);
      mesh.material = caisse(material?.name ?? '') ? maskCaisse : maskReste;
      mesh.layers.enable(MASK_LAYER);
    }
    for (const child of object.children) visit(child);
  };
  const root = scene.getObjectByName('sortie_vehicule');
  if (root) visit(root);
  const layers = camera.layers.mask;
  const background = scene.background;
  const clear = renderer.getClearColor(new Color());
  const alpha = renderer.getClearAlpha();
  const previous = renderer.getRenderTarget();
  maskTarget ??= new WebGLRenderTarget(w, h);
  maskTarget.setSize(w, h);
  const out = new Uint8Array(w * h * 4);
  try {
    camera.layers.set(MASK_LAYER);
    scene.background = null;
    renderer.setClearColor(0x000000, 1);
    renderer.setRenderTarget(maskTarget);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.readRenderTargetPixels(maskTarget, 0, 0, w, h, out);
  } finally {
    for (const [mesh, material, mask] of swapped) {
      mesh.material = material;
      mesh.layers.mask = mask;
    }
    camera.layers.mask = layers;
    scene.background = background;
    renderer.setClearColor(clear, alpha);
    renderer.setRenderTarget(previous);
  }
  const kind = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i += 1) kind[i] = (out[i * 4] ?? 0) > 127 ? 1 : (out[i * 4 + 1] ?? 0) > 127 ? 2 : 0;
  return kind;
}

/** Distance (pas de 4-voisins, jusqu'à `max`) de chaque pixel au plus proche pixel où `source` est vrai. */
function distance(w: number, h: number, source: (i: number) => boolean, max: number): Uint8Array {
  const d = new Uint8Array(w * h).fill(255);
  let front: number[] = [];
  for (let i = 0; i < w * h; i += 1) if (source(i)) { d[i] = 0; front.push(i); }
  for (let k = 1; k <= max && front.length > 0; k += 1) {
    const next: number[] = [];
    for (const i of front) {
      const x = i % w;
      for (const j of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w]) {
        if (j < 0 || j >= w * h || (d[j] ?? 0) !== 255) continue;
        d[j] = k;
        next.push(j);
      }
    }
    front = next;
  }
  return d;
}

/** Luminance de la caisse dans l'image, temps arrêté (une image composée, puis son masque). */
async function releveCaisse(vehicle: VehicleManifest): Promise<ReleveCaisse> {
  driveDebug.figer = true;
  await frames(6);
  const result = await new Promise<ReleveCaisse>((resolve) => {
    driveDebug.afterFrame = (raw) => {
      delete driveDebug.afterFrame;
      const renderer = raw as WebGLRenderer;
      const gl = renderer.getContext();
      const w = gl.drawingBufferWidth;
      const h = gl.drawingBufferHeight;
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      const kind = masqueVehicule(renderer, vehicle, w, h);
      const toVehicle = distance(w, h, (i) => (kind[i] ?? 0) !== 0, 24);
      const toOutside = distance(w, h, (i) => (kind[i] ?? 0) === 0, 3);
      const buckets = { caisse: [] as number[], contour: [] as number[], coeur: [] as number[], reste: [] as number[], halo: [] as number[], fond: [] as number[] };
      const sat = { caisse: 0, contour: 0, coeur: 0, reste: 0 };
      for (let i = 0; i < w * h; i += 1) {
        const r = px[i * 4] ?? 0;
        const g = px[i * 4 + 1] ?? 0;
        const b = px[i * 4 + 2] ?? 0;
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const s = Math.max(r, g, b) > 250 ? 1 : 0;
        const k = kind[i] ?? 0;
        const dv = toVehicle[i] ?? 255;
        if (k === 1) {
          buckets.caisse.push(l);
          sat.caisse += s;
          if ((toOutside[i] ?? 255) <= 2) { buckets.contour.push(l); sat.contour += s; }
          else { buckets.coeur.push(l); sat.coeur += s; }
        } else if (k === 2) { buckets.reste.push(l); sat.reste += s; }
        else if (dv >= 1 && dv <= 4) buckets.halo.push(l);
        else if (dv >= 16 && dv <= 24) buckets.fond.push(l);
      }
      const mean = (v: number[]) => Math.round((v.reduce((a, b) => a + b, 0) / Math.max(1, v.length)) * 10) / 10;
      resolve({
        caisse: stats(buckets.caisse, sat.caisse),
        contour: stats(buckets.contour, sat.contour),
        coeur: stats(buckets.coeur, sat.coeur),
        reste: stats(buckets.reste, sat.reste),
        halo: mean(buckets.halo),
        fond: mean(buckets.fond),
      });
    };
  });
  driveDebug.figer = false;
  return result;
}

/**
 * Ce que voit la sonde autour du véhicule (véhicule masqué), en radiance linéaire : moyenne et
 * maximum des quatre faces latérales par bande d'élévation (degrés), et la face du haut.
 */
async function profilSonde(): Promise<Array<{ de: number; a: number; moyenne: number; max: number }>> {
  const size = 64;
  const target = new WebGLCubeRenderTarget(size, { type: HalfFloatType, generateMipmaps: false });
  const cube = new CubeCamera(0.5, 2500, target);
  for (const child of cube.children) {
    child.layers.enable(NO_MIRROR_LAYER);
    child.layers.enable(PROBE_ONLY_LAYER);
  }
  const scene = driveDebug.scene as Scene;
  const vehicle = scene.getObjectByName('sortie_vehicule');
  vehicle?.getWorldPosition(cube.position);
  cube.position.add(new Vector3(0, 1, 0));
  const bands = [-45, -10, -2, 2, 5, 13, 30, 45];
  const sums = bands.slice(1).map(() => ({ s: 0, n: 0, m: 0 }));
  const top = { s: 0, n: 0, m: 0 };
  await new Promise<void>((resolve) => {
    driveDebug.afterFrame = (raw) => {
      delete driveDebug.afterFrame;
      const renderer = raw as WebGLRenderer;
      const previous = renderer.getRenderTarget();
      if (vehicle) vehicle.visible = false;
      cube.update(renderer, scene);
      if (vehicle) vehicle.visible = true;
      const buf = new Uint16Array(size * size * 4);
      for (const face of [0, 1, 2, 4, 5]) {
        renderer.readRenderTargetPixels(target, 0, 0, size, size, buf, face);
        for (let row = 0; row < size; row += 1) {
          const y = (row + 0.5) / (size / 2) - 1;
          for (let col = size / 2 - 8; col < size / 2 + 8; col += 1) {
            const i = (row * size + col) * 4;
            const l = 0.2126 * DataUtils.fromHalfFloat(buf[i] ?? 0) + 0.7152 * DataUtils.fromHalfFloat(buf[i + 1] ?? 0) + 0.0722 * DataUtils.fromHalfFloat(buf[i + 2] ?? 0);
            const acc = face === 2 ? top : sums[bands.findIndex((b, k) => k < bands.length - 1 && Math.atan(y) * (180 / Math.PI) >= b && Math.atan(y) * (180 / Math.PI) < (bands[k + 1] ?? 90))];
            if (!acc) continue;
            acc.s += l;
            acc.n += 1;
            acc.m = Math.max(acc.m, l);
          }
        }
      }
      renderer.setRenderTarget(previous);
      resolve();
    };
  });
  target.dispose();
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return [...sums.map((acc, k) => ({ de: bands[k] ?? 0, a: bands[k + 1] ?? 0, moyenne: r(acc.s / Math.max(1, acc.n)), max: r(acc.m) })), { de: 90, a: 90, moyenne: r(top.s / Math.max(1, top.n)), max: r(top.m) }];
}

/** Coupe ou rétablit des postes de coût (mesure) : { reflet, sonde, gouttes, mouille }. */
function postes(off: NonNullable<typeof driveDebug.off>): void {
  driveDebug.off = { ...off };
}

async function demarrer() {
  const id = params.get('carte') ?? '';
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error('paramètre carte manquant (dossier de public/assets/maps/)');
  const response = await fetch(`${import.meta.env.BASE_URL}assets/maps/${id}/map.json`);
  if (!response.ok) throw new Error(`carte ${id} introuvable`);
  const map = (await response.json()) as MapManifest;
  const vehicle = vehicleById(params.get('vehicule')) ?? VEHICLES[0];
  if (!vehicle) throw new Error('catalogue vide');
  const qualite = params.get('qualite');
  if (qualite === 'eco' || qualite === 'standard' || qualite === 'max') {
    // Le niveau demandé tient, même si les réglages enregistrés arrivent après (lecture asynchrone).
    useSettings.setState({ quality: qualite as QualitySetting });
    useSettings.subscribe((state) => {
      if (state.quality !== qualite) useSettings.setState({ quality: qualite as QualitySetting });
    });
  }
  const peinture = /^([a-z-]+):#?([0-9a-f]{6})$/i.exec(params.get('peinture') ?? '');
  if (peinture) peindre(vehicle, peinture[1] ?? '', peinture[2] ?? '');
  appliquer({ camera: params.get('camera') ?? 'poursuite', meteo: params.get('meteo') ?? 'sec' });
  const s = params.get('s');
  if (s !== null) void ready().then(() => driveDebug.seek?.(Number(s)));
  (window as unknown as { pmbSortie: unknown }).pmbSortie = { aller, mesurer: () => driveDebug.measure?.(), cadence, scintillement, postes, gpu, pret: () => driveDebug.settled?.() ?? false, debug: driveDebug, drive: useDrive, peindre: (finish: string, color: string) => peindre(vehicle, finish, color), caisse: () => releveCaisse(vehicle), sonde: profilSonde };
  createRoot(document.getElementById('racine') as HTMLElement).render(
    <StrictMode>
      <DriveCanvas map={map} vehicle={vehicle} />
    </StrictMode>,
  );
  const stage = () => document.querySelector<HTMLElement>('.drive-stage');
  setInterval(() => {
    const el = stage();
    if (!el) return;
    const d = el.dataset;
    info.textContent = `${map.name} · ${vehicle.name}\ns = ${d.s ?? '?'} m · ${d.vitesse ?? '?'} km/h · ${d.camera ?? ''} · ${d.meteo ?? ''}\n${d.troncons ?? 0} tronçons · ${d.sortie ?? ''} · ${d.qualite ?? ''}`;
    if (d.sortie === 'prete') document.body.dataset.sortiePrete = '1';
    if (d.sortie === 'erreur') document.body.dataset.sortieErreur = '1';
  }, 250);
}

/** Attend que la scène ait posé son pilote (prise seek). */
async function ready(): Promise<void> {
  while (!driveDebug.seek) await frames(5);
}

demarrer().catch((error: unknown) => {
  const msg = error instanceof Error ? error.message : String(error);
  info.textContent = `erreur : ${msg}`;
  document.body.dataset.sortieErreur = msg;
});
