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
// window.pmbSortie : aller({ s, camera, meteo }) (promesse résolue quand les tronçons sont là),
// mesurer() (triangles et appels de dessin de la passe principale), cadence(ms) (images par seconde).
// Captures : node tools/captures/sortie.mjs.

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
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
  appliquer({ camera: params.get('camera') ?? 'poursuite', meteo: params.get('meteo') ?? 'sec' });
  const s = params.get('s');
  if (s !== null) void ready().then(() => driveDebug.seek?.(Number(s)));
  (window as unknown as { pmbSortie: unknown }).pmbSortie = { aller, mesurer: () => driveDebug.measure?.(), cadence, scintillement, postes, gpu, pret: () => driveDebug.settled?.() ?? false, debug: driveDebug, drive: useDrive };
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
