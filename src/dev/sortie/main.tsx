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
//   meteo=pluie      pluie (sec par défaut)
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
  if (meteo === 'pluie' || meteo === 'sec') useDrive.setState({ weather: meteo });
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

async function cadence(ms = 3000): Promise<{ fps: number; moyenne: number; p95: number }> {
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
  return { fps: 1000 / moyenne, moyenne, p95: d[Math.floor(d.length * 0.95)] ?? 0 };
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
  if (qualite === 'eco' || qualite === 'standard' || qualite === 'max') useSettings.setState({ quality: qualite as QualitySetting });
  appliquer({ camera: params.get('camera') ?? 'poursuite', meteo: params.get('meteo') ?? 'sec' });
  const s = params.get('s');
  if (s !== null) void ready().then(() => driveDebug.seek?.(Number(s)));
  (window as unknown as { pmbSortie: unknown }).pmbSortie = { aller, mesurer: () => driveDebug.measure?.(), cadence, pret: () => driveDebug.settled?.() ?? false, debug: driveDebug, drive: useDrive };
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
