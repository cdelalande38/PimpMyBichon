/// <reference types="vite/client" />
// (Référence explicite : tests/unit/oeuvres.test.ts importe ce module sous tsconfig.node.json.)
// Textures des œuvres du garage (src/data/garageArt.ts) : SVG servi par l'app → image → canvas à
// la résolution demandée → CanvasTexture sRGB avec mipmaps. Le canvas a sa taille finale dès le
// départ : il porte d'abord une teinte unie d'attente, puis le dessin, sans réallouer la texture
// sur le GPU. Le rendu étant à la demande, chaque appelant passe un rappel pour redemander une
// image quand le dessin arrive. Aucune requête vers un tiers : le fichier vient de la base de
// l'app, le dessin passe par une URL blob locale.

import { CanvasTexture, Color, MeshBasicMaterial, MeshStandardMaterial, SRGBColorSpace, type Texture } from 'three';
import { type ArtRect, artPixels, artRect, garageArt, type GarageArt, type GarageArtId } from '../../data/garageArt.ts';

/** Écart entre une œuvre et la surface qui la porte, ajouté au millimètre de son `at` (ArtSlot). */
export const ART_GAP = 0.001;

/**
 * Matière d'une œuvre posée, la même dans le garage (build.ts) et dans le studio des formes :
 * émissive (glace du flipper) ou éclairée par la pièce. Une œuvre transparente est découpée par
 * alphaTest, sans mélange : elle reste opaque pour le tri et la profondeur.
 */
export function artworkMaterial(item: GarageArt, texture: Texture): MeshBasicMaterial | MeshStandardMaterial {
  const alphaTest = item.transparent ? 0.5 : 0;
  return item.lighting === 'emissive'
    ? new MeshBasicMaterial({ map: texture, color: new Color(1, 1, 1).multiplyScalar(item.glow ?? 1), alphaTest })
    : new MeshStandardMaterial({ map: texture, roughness: 0.6, metalness: 0, envMapIntensity: 0.2, alphaTest });
}

export interface ArtworkOptions {
  /** Case d'une planche (plaques, casques, cible seule). */
  region?: string;
  /** Côté le plus long du viewBox entier, en pixels ; défaut : celui du registre (1024 au plus). */
  resolution?: number;
  /** Appelé une fois le dessin posé dans la texture (rendu à la demande : redemander une image). */
  onReady?: () => void;
}

export interface ArtworkTexture {
  /** Texture utilisable tout de suite : teinte d'attente, puis le dessin. */
  texture: CanvasTexture;
  /** `true` quand le dessin est posé, `false` en cas d'échec ou de libération avant la fin. */
  ready: Promise<boolean>;
  /** Rend la texture ; la dernière libération l'efface du GPU et coupe un chargement en cours. */
  release: () => void;
}

/** Adresse du fichier d'une œuvre, sous la base de l'app (« /PimpMyBichon/ » ou « ./ »). */
export function artworkUrl(item: GarageArt, base: string = import.meta.env.BASE_URL): string {
  return `${base.endsWith('/') ? base : `${base}/`}${item.file}`;
}

/**
 * Réécrit la balise racine d'un SVG pour qu'il se dessine net à la taille voulue : viewBox recadré
 * sur la case, largeur et hauteur en pixels, sans conserver les proportions (l'arrondi au pixel près
 * ne doit pas laisser de bande vide).
 */
export function prepareSvg(text: string, rect: ArtRect, width: number, height: number): string {
  const match = /<svg\b[^>]*>/.exec(text);
  if (!match) throw new Error('balise <svg> absente');
  let tag = match[0]
    .replace(/\s(viewBox|width|height|preserveAspectRatio)="[^"]*"/g, '')
    .replace(/\s*\/?>$/, '');
  tag += ` viewBox="${rect.join(' ')}" width="${width}" height="${height}" preserveAspectRatio="none">`;
  return text.slice(0, match.index) + tag + text.slice(match.index + match[0].length);
}

interface Entry {
  texture: CanvasTexture;
  ready: Promise<boolean>;
  refs: number;
  listeners: Set<() => void>;
  controller: AbortController;
}

const entries = new Map<string, Entry>();
/** Fichiers dont l'échec a déjà été signalé : une seule ligne dans la console par œuvre. */
const reported = new Set<string>();

function report(item: GarageArt, reason: unknown): void {
  if (reported.has(item.file)) return;
  reported.add(item.file);
  const detail = reason instanceof Error ? reason.message : String(reason);
  console.warn(`Œuvre du garage « ${item.id} » non chargée (${artworkUrl(item)} : ${detail}) : la teinte d’attente reste.`);
}

function paintWaiting(context: CanvasRenderingContext2D | null, item: GarageArt, width: number, height: number): void {
  if (!context) return;
  context.clearRect(0, 0, width, height);
  if (item.waiting === null) return;
  context.fillStyle = item.waiting;
  context.fillRect(0, 0, width, height);
}

async function draw(
  item: GarageArt,
  rect: ArtRect,
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch(artworkUrl(item), { signal });
  if (!response.ok) throw new Error(`réponse ${response.status}`);
  const svg = prepareSvg(await response.text(), rect, canvas.width, canvas.height);
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    const image = new Image(canvas.width, canvas.height);
    image.decoding = 'async';
    image.src = url;
    await image.decode();
    signal.throwIfAborted();
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas 2D indisponible');
    // Sous une œuvre opaque, la teinte d'attente reste en fond : les coins arrondis et les bords
    // lissés se fondent dans le dessin au lieu de virer au noir. Une œuvre transparente part d'un
    // canvas vide : hors du dessin, l'alpha reste nul et l'alphaTest de la matière découpe sa
    // silhouette (la cible et son panneau étagé).
    if (item.transparent) context.clearRect(0, 0, canvas.width, canvas.height);
    else paintWaiting(context, item, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * Texture d'une œuvre, partagée entre les appelants qui demandent la même case à la même
 * résolution. Chaque appel doit être suivi d'un `release()`.
 */
export function acquireArtwork(id: GarageArtId, options: ArtworkOptions = {}): ArtworkTexture {
  const item = garageArt(id);
  const rect = artRect(item, options.region);
  const [width, height] = artPixels(item, options.region, options.resolution);
  const key = `${id}#${options.region ?? ''}@${width}x${height}`;

  let entry = entries.get(key);
  if (!entry) {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    paintWaiting(canvas.getContext('2d'), item, width, height);
    const texture = new CanvasTexture(canvas);
    texture.name = `oeuvre:${key}`;
    texture.colorSpace = SRGBColorSpace;
    texture.anisotropy = 4;
    const controller = new AbortController();
    const listeners = new Set<() => void>();
    const ready = draw(item, rect, canvas, controller.signal).then(
      () => {
        texture.needsUpdate = true;
        for (const listener of listeners) listener();
        return true;
      },
      (reason: unknown) => {
        if (!controller.signal.aborted) report(item, reason);
        return false;
      },
    );
    entry = { texture, ready, refs: 0, listeners, controller };
    entries.set(key, entry);
  }

  const current = entry;
  current.refs += 1;
  // Une enveloppe par appel : deux appelants qui passent la même fonction restent distincts.
  const onReady = options.onReady;
  const listener = onReady ? () => onReady() : undefined;
  if (listener) current.listeners.add(listener);
  let released = false;
  return {
    texture: current.texture,
    ready: current.ready,
    release: () => {
      if (released) return;
      released = true;
      if (listener) current.listeners.delete(listener);
      current.refs -= 1;
      if (current.refs > 0) return;
      current.controller.abort();
      current.texture.dispose();
      entries.delete(key);
    },
  };
}
