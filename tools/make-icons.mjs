// @ts-check
// Régénère les icônes PNG de l'app à partir des sources SVG de tools/icons/.
//
//   npm run icons             contrôle puis écrit les PNG dans public/icons/
//   npm run icons -- --check  n'écrit rien : échoue si un PNG du dépôt n'est plus à jour
//
// Le rendu est déterministe : mêmes sources et même version de sharp, mêmes octets.
// Rien n'est écrit si un contrôle échoue (dimensions, alpha, poids, dessin identique).
// Le favicon (public/icons/favicon.svg) est écrit à la main, il n'est pas produit ici.

import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES_DIR = resolve(ROOT, 'tools/icons');
const OUTPUT_DIR = resolve(ROOT, 'public/icons');

/** Nuit violette de l'interface : fond des icônes sans transparence. */
const NIGHT = '#0a0911';
/** Côté du viewBox des sources. */
const SOURCE_SIZE = 512;
/** Le SVG est tracé quatre fois trop grand puis réduit : bords et halos plus propres. */
const OVERSAMPLING = 4;
/** Plafond de poids d'un PNG, en octets : il doit peser moins de 60 ko (1 ko = 1000 octets, la lecture la plus stricte). */
const MAX_BYTES = 60 * 1000;
/** Découpe arrondie de icon.svg, retirée pour l'icône iOS (le système arrondit lui-même). */
const TILE_CLIP = ' clip-path="url(#tile-clip)"';
/** Premiers octets de tout fichier PNG. */
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/**
 * @typedef {object} Target
 * @property {string} file          nom du PNG dans public/icons/
 * @property {string} source        nom du SVG dans tools/icons/
 * @property {number} size          côté en pixels
 * @property {boolean} opaque       true : aplati sur la nuit, aucun canal alpha dans le fichier
 * @property {boolean} [fullBleed]  true : retire la découpe arrondie de la tuile avant le rendu
 * @property {boolean} [monochrome] true : blanc pur, seule la transparence porte le dessin
 */

/** @type {readonly Target[]} */
const TARGETS = [
  { file: 'pwa-192.png', source: 'icon.svg', size: 192, opaque: false },
  { file: 'pwa-512.png', source: 'icon.svg', size: 512, opaque: false },
  { file: 'maskable-512.png', source: 'icon-maskable.svg', size: 512, opaque: true },
  { file: 'apple-touch-icon-180.png', source: 'icon.svg', size: 180, opaque: true, fullBleed: true },
  { file: 'monochrome-512.png', source: 'icon-monochrome.svg', size: 512, opaque: false, monochrome: true },
];

/**
 * Trace un SVG en pixels RGBA bruts, au côté demandé.
 * Deux étapes explicites (tracé suréchantillonné, puis réduction) pour ne dépendre
 * d'aucun raccourci interne de la bibliothèque.
 * @param {string} svg
 * @param {number} size
 * @returns {Promise<Buffer>} pixels RGBA, size x size
 */
async function rasterize(svg, size) {
  const side = size * OVERSAMPLING;
  const traced = await sharp(Buffer.from(svg), { density: (72 * side) / SOURCE_SIZE })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = traced.info;
  if (width !== side || height !== side || channels !== 4) {
    throw new Error(`tracé inattendu : ${width} x ${height}, ${channels} canaux (attendu ${side} x ${side}, 4 canaux)`);
  }
  return sharp(traced.data, { raw: { width, height, channels } })
    .resize(size, size, { kernel: 'lanczos3' })
    .raw()
    .toBuffer();
}

/**
 * Force le blanc pur sur tous les pixels : la silhouette ne vit que dans le canal alpha.
 * @param {Buffer} rgba
 */
function whiten(rgba) {
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba.writeUInt8(255, offset);
    rgba.writeUInt8(255, offset + 1);
    rgba.writeUInt8(255, offset + 2);
  }
}

/**
 * Produit le PNG d'une cible : palette de 256 couleurs tramée, compression maximale.
 * @param {Target} target
 * @param {string} svg
 * @returns {Promise<Buffer>}
 */
async function renderTarget(target, svg) {
  let source = svg;
  if (target.fullBleed) {
    if (!source.includes(TILE_CLIP)) {
      throw new Error(`${target.source} : découpe de tuile introuvable (${TILE_CLIP.trim()})`);
    }
    source = source.replace(TILE_CLIP, '');
  }

  const pixels = await rasterize(source, target.size);
  if (target.monochrome) whiten(pixels);

  let image = sharp(pixels, { raw: { width: target.size, height: target.size, channels: 4 } });
  if (target.opaque) image = image.flatten({ background: NIGHT }).removeAlpha();

  return image
    .png({ palette: true, colours: 256, dither: 1, quality: 100, effort: 10, compressionLevel: 9 })
    .toBuffer();
}

/**
 * Lit la structure d'un PNG sans le décoder : dimensions, et présence d'un canal alpha
 * (type de couleur 4 ou 6, ou bloc tRNS d'une palette).
 * @param {Buffer} png
 */
function inspectPng(png) {
  if (!png.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) throw new Error('signature PNG absente');
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  const colorType = png.readUInt8(25);
  let hasAlpha = colorType === 4 || colorType === 6;
  // Chaque bloc : longueur (4 octets), type (4), données, contrôle (4). Le tRNS précède toujours les IDAT.
  let offset = PNG_SIGNATURE.length;
  while (offset + 12 <= png.length) {
    const type = png.toString('latin1', offset + 4, offset + 8);
    if (type === 'tRNS') hasAlpha = true;
    if (type === 'IDAT' || type === 'IEND') break;
    offset += 12 + png.readUInt32BE(offset);
  }
  return { width, height, hasAlpha };
}

/**
 * Contrôle un PNG produit : dimensions, alpha attendu, poids, et blanc pur pour la silhouette.
 * @param {Target} target
 * @param {Buffer} png
 * @returns {Promise<string[]>} défauts constatés (vide si tout va bien)
 */
async function verify(target, png) {
  /** @type {string[]} */
  const problems = [];
  const header = inspectPng(png);
  if (header.width !== target.size || header.height !== target.size) {
    problems.push(`dimensions ${header.width} x ${header.height}, attendu ${target.size} x ${target.size}`);
  }
  if (target.opaque && header.hasAlpha) problems.push('canal alpha présent alors que le fichier doit être opaque');
  if (!target.opaque && !header.hasAlpha) problems.push('canal alpha absent alors que le fichier doit être transparent');
  if (png.length >= MAX_BYTES) problems.push(`${png.length} octets, il en faut moins de ${MAX_BYTES}`);

  const decoded = await sharp(png).ensureAlpha().raw().toBuffer();
  if (!target.opaque && decoded.readUInt8(3) !== 0) problems.push('le coin haut gauche devrait être transparent');
  if (target.monochrome) {
    for (let offset = 0; offset < decoded.length; offset += 4) {
      const visible = decoded.readUInt8(offset + 3) > 0;
      const white = decoded.readUInt32BE(offset) >>> 8 === 0xffffff;
      if (visible && !white) {
        problems.push('pixel visible qui n’est pas blanc');
        break;
      }
    }
  }
  return problems;
}

/**
 * Extrait le dessin d'une source (bloc entre « dessin:debut » et « dessin:fin »), sans son indentation.
 * Il doit être le même dans l'icône principale et dans l'icône maskable : sinon l'écran d'accueil
 * et l'écran de lancement ne montrent plus la même chose.
 * @param {string} svg
 * @param {string} name
 */
function artBlock(svg, name) {
  const match = /<!-- dessin:debut[^>]*-->([\s\S]*?)<!-- dessin:fin -->/.exec(svg);
  const block = match?.[1];
  if (block === undefined) throw new Error(`${name} : bloc « dessin » introuvable`);
  return block
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '')
    .join('\n');
}

/** @param {Buffer} data */
function shortHash(data) {
  return createHash('sha256').update(data).digest('hex').slice(0, 12);
}

async function main() {
  const checkOnly = process.argv.includes('--check');
  /** @type {string[]} */
  const failures = [];

  /** @type {Map<string, string>} */
  const sources = new Map();
  for (const name of new Set(TARGETS.map((target) => target.source))) {
    sources.set(name, await readFile(resolve(SOURCES_DIR, name), 'utf8'));
  }

  const icon = sources.get('icon.svg');
  const maskable = sources.get('icon-maskable.svg');
  if (icon === undefined || maskable === undefined) throw new Error('icon.svg et icon-maskable.svg sont requis');
  if (artBlock(icon, 'icon.svg') !== artBlock(maskable, 'icon-maskable.svg')) {
    failures.push('le bloc « dessin » diffère entre icon.svg et icon-maskable.svg : reporte la retouche dans les deux');
  }

  /** @type {{ path: string, png: Buffer }[]} */
  const outputs = [];
  for (const target of TARGETS) {
    const svg = sources.get(target.source);
    if (svg === undefined) throw new Error(`source manquante : ${target.source}`);
    const png = await renderTarget(target, svg);
    const path = resolve(OUTPUT_DIR, target.file);
    for (const problem of await verify(target, png)) failures.push(`${target.file} : ${problem}`);
    outputs.push({ path, png });

    console.log(
      [
        relative(ROOT, path).padEnd(40),
        `${target.size} x ${target.size}`.padEnd(9),
        (target.opaque ? 'opaque' : 'alpha').padEnd(6),
        `${(png.length / 1000).toFixed(1)} ko`.padStart(7),
        shortHash(png),
      ].join('  '),
    );
  }

  if (checkOnly) {
    for (const { path, png } of outputs) {
      const current = await readFile(path).catch(() => null);
      if (current === null) failures.push(`${relative(ROOT, path)} : fichier absent, lance « npm run icons »`);
      else if (!current.equals(png)) failures.push(`${relative(ROOT, path)} : plus à jour, lance « npm run icons »`);
    }
  }

  if (failures.length > 0) {
    for (const failure of failures) console.error(`Erreur : ${failure}`);
    console.error(checkOnly ? 'Icônes à revoir.' : 'Rien n’a été écrit.');
    process.exitCode = 1;
    return;
  }

  if (checkOnly) {
    console.log('Icônes à jour.');
    return;
  }
  await mkdir(OUTPUT_DIR, { recursive: true });
  for (const { path, png } of outputs) await writeFile(path, png);
  console.log(`Icônes écrites dans ${relative(ROOT, OUTPUT_DIR)}/.`);
}

try {
  await main();
} catch (error) {
  // Source illisible, repère absent du SVG, tracé impossible : un message, pas une pile d'appels.
  console.error(`Erreur : ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
