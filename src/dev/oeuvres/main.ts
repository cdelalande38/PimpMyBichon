// Contrôle des œuvres du garage (page de développement, hors de l'app livrée) : chaque œuvre ou
// case du registre, chargée par acquireArtwork comme dans la scène, posée sur un plan à sa taille
// réelle sous une lumière ambiante blanche d'intensité π, sans tonalité : la diffusion de three
// divise par π, une surface éclairée rend donc exactement les couleurs du dessin ; une glace
// émissive rend dessin × intensité conseillée.
// Mode d'emploi en tête de index.html.

import {
  AmbientLight,
  Color,
  Mesh,
  MeshStandardMaterial,
  NoToneMapping,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { artPixels, artSize, GARAGE_ART, type GarageArt } from '../../data/garageArt.ts';
import { acquireArtwork } from '../../scene/garage/artwork.ts';

interface Tile {
  key: string;
  item: GarageArt;
  region?: string;
  size: readonly [number, number];
  pixels: readonly [number, number];
  /** Centre du plan, en mètres. */
  x: number;
  y: number;
}

const GAP = 0.14;
const ROW_WIDTH = 4.4;
const LABEL_SPACE = 0.24;

const params = new URLSearchParams(location.search);
const scaleParam = Number(params.get('echelle'));
const focus = params.get('centre');
const background = `#${params.get('fond') ?? '5a5a60'}`;

/** Une tuile par œuvre entière qui a sa place, plus une par case. */
function tiles(): Tile[] {
  const list: Omit<Tile, 'x' | 'y'>[] = [];
  for (const item of GARAGE_ART) {
    if (item.place) list.push({ key: item.id, item, size: item.size, pixels: artPixels(item) });
    for (const region of item.regions ?? []) {
      list.push({
        key: `${item.id}#${region.id}`,
        item,
        region: region.id,
        size: artSize(item, region.id),
        pixels: artPixels(item, region.id),
      });
    }
  }
  // Rangement en étagères, de la plus haute à la plus basse.
  list.sort((a, b) => b.size[1] - a.size[1]);
  const placed: Tile[] = [];
  let x = 0;
  let top = 0;
  let rowHeight = 0;
  for (const tile of list) {
    if (x > 0 && x + tile.size[0] > ROW_WIDTH) {
      x = 0;
      top -= rowHeight + GAP + LABEL_SPACE;
      rowHeight = 0;
    }
    placed.push({ ...tile, x: x + tile.size[0] / 2, y: top - tile.size[1] / 2 });
    x += tile.size[0] + GAP;
    rowHeight = Math.max(rowHeight, tile.size[1]);
  }
  return placed;
}

const layout = tiles();
const bounds = {
  minX: Math.min(...layout.map((t) => t.x - t.size[0] / 2)) - GAP,
  maxX: Math.max(...layout.map((t) => t.x + t.size[0] / 2)) + GAP,
  minY: Math.min(...layout.map((t) => t.y - t.size[1] / 2)) - GAP - LABEL_SPACE,
  maxY: Math.max(...layout.map((t) => t.y + t.size[1] / 2)) + GAP,
};

const renderer = new WebGLRenderer({ antialias: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = SRGBColorSpace;
renderer.toneMapping = NoToneMapping;
document.body.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(background);
scene.add(new AmbientLight(0xffffff, Math.PI));
const camera = new OrthographicCamera();
camera.position.z = 5;

const handles = layout.map((tile) => {
  const handle = acquireArtwork(tile.item.id, { region: tile.region, onReady: render });
  const emissive = tile.item.lighting === 'emissive';
  const material = new MeshStandardMaterial({
    map: emissive ? null : handle.texture,
    color: emissive ? 0x000000 : 0xffffff,
    emissive: emissive ? 0xffffff : 0x000000,
    emissiveMap: emissive ? handle.texture : null,
    emissiveIntensity: tile.item.glow ?? 1,
    roughness: 1,
    metalness: 0,
    alphaTest: tile.item.transparent ? 0.5 : 0,
  });
  const mesh = new Mesh(new PlaneGeometry(tile.size[0], tile.size[1]), material);
  mesh.position.set(tile.x, tile.y, 0);
  scene.add(mesh);
  return { tile, handle, mesh };
});

const labels = layout.map((tile) => {
  const label = document.createElement('div');
  label.className = 'etiquette';
  const density = Math.round(tile.pixels[0] / tile.size[0]);
  label.innerHTML =
    `<b>${tile.region ?? tile.key}</b><br><small>${tile.size.map((v) => v.toFixed(2)).join(' × ')} m` +
    `${tile.item.lighting === 'emissive' ? ' · émissive' : ''}<br>${tile.pixels.join(' × ')} px · ${density} px/m</small>`;
  document.body.appendChild(label);
  return { tile, label };
});

const summary = document.getElementById('bilan');

function frame(): number {
  const width = window.innerWidth;
  const height = window.innerHeight;
  renderer.setSize(width, height);
  const target = focus ? layout.find((tile) => tile.key === focus) : undefined;
  const fit = Math.min(width / (bounds.maxX - bounds.minX), height / (bounds.maxY - bounds.minY));
  const scale = scaleParam > 0 ? scaleParam : fit;
  const cx = target ? target.x : (bounds.minX + bounds.maxX) / 2;
  const cy = target ? target.y : (bounds.minY + bounds.maxY) / 2;
  camera.left = cx - width / 2 / scale;
  camera.right = cx + width / 2 / scale;
  camera.top = cy + height / 2 / scale;
  camera.bottom = cy - height / 2 / scale;
  camera.updateProjectionMatrix();
  for (const { tile, label } of labels) {
    label.style.left = `${(tile.x - camera.left) * scale}px`;
    label.style.top = `${(camera.top - (tile.y - tile.size[1] / 2)) * scale + 3}px`;
  }
  return scale;
}

function render(): void {
  const scale = frame();
  renderer.render(scene, camera);
  if (summary) summary.textContent = `${layout.length} plans · ${Math.round(scale)} px par mètre · fond ${background}`;
}

window.addEventListener('resize', render);
render();

// Repère pour la capture automatique : toutes les œuvres ont fini (chargées ou en échec).
void Promise.all(handles.map(({ handle }) => handle.ready)).then((results) => {
  render();
  const failed = results.filter((ok) => !ok).length;
  document.body.dataset.pret = failed ? `echec:${failed}` : 'oui';
});
