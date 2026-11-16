#!/usr/bin/env node
// @ts-check
// npm run radio:accueil [-- <dossier>]
//
// Indexe les stations de base (musique d'accueil, servie par l'app) : pour chaque dossier de
// public/assets/audio/radio/ (ou le seul <dossier> donné), réécrit station.json d'après les morceaux
// présents. Le nom de la station, l'ordre, les titres et les durées déjà écrits sont gardés ; un
// morceau nouveau prend son titre dans son étiquette ID3 (sinon son nom de fichier) et sa durée par
// ffprobe s'il est installé (sinon l'app la lit à la première écoute) ; un morceau retiré du dossier
// quitte le manifeste. Contrôle : npm run audio:check. Licence de chaque morceau : CREDITS.md.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const RADIO_DIR = 'public/assets/audio/radio';
const AUDIO = new Set(['.mp3', '.ogg', '.opus', '.m4a', '.aac', '.weba']);

/**
 * Titre (TIT2) d'une étiquette ID3v2.3 ou 2.4 en tête de fichier, ou null.
 * @param {Uint8Array} bytes  début du fichier
 * @returns {string | null}
 */
export function id3Title(bytes) {
  if (bytes.length < 10 || bytes[0] !== 0x49 || bytes[1] !== 0x44 || bytes[2] !== 0x33) return null;
  const version = bytes[3] ?? 0;
  if (version !== 3 && version !== 4) return null;
  const syncsafe = (/** @type {number} */ at) =>
    (((bytes[at] ?? 0) & 0x7f) << 21) | (((bytes[at + 1] ?? 0) & 0x7f) << 14) | (((bytes[at + 2] ?? 0) & 0x7f) << 7) | ((bytes[at + 3] ?? 0) & 0x7f);
  const end = Math.min(bytes.length, 10 + syncsafe(6));
  let at = 10;
  while (at + 10 <= end) {
    const id = String.fromCharCode(bytes[at] ?? 0, bytes[at + 1] ?? 0, bytes[at + 2] ?? 0, bytes[at + 3] ?? 0);
    if (!/^[A-Z0-9]{4}$/.test(id)) break;
    const size =
      version === 4
        ? syncsafe(at + 4)
        : (((bytes[at + 4] ?? 0) << 24) | ((bytes[at + 5] ?? 0) << 16) | ((bytes[at + 6] ?? 0) << 8) | (bytes[at + 7] ?? 0)) >>> 0;
    const body = bytes.subarray(at + 10, Math.min(end, at + 10 + size));
    if (id === 'TIT2' && body.length > 1) {
      const encoding = body[0];
      const raw = body.subarray(1);
      const text =
        encoding === 1 || encoding === 2
          ? new TextDecoder(encoding === 2 ? 'utf-16be' : 'utf-16').decode(raw)
          : new TextDecoder(encoding === 3 ? 'utf-8' : 'latin1').decode(raw);
      const title = text.replace(/\0+$/g, '').replace(/^\uFEFF/, '').trim();
      return title || null;
    }
    at += 10 + size;
  }
  return null;
}

/** @param {string} file */
function titleFromName(file) {
  return file
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/(^|\s)\p{Ll}/gu, (letter) => letter.toUpperCase());
}

/**
 * @typedef {{ fichier: string, titre: string, artiste?: string, duree?: number }} Morceau
 * @typedef {{ format: 'pmb-station', version: 1, nom: string, morceaux: Morceau[] }} StationJson
 */

/**
 * Manifeste d'un dossier : garde ce qui est déjà écrit pour les morceaux présents, ajoute les
 * nouveaux (par ordre alphabétique) avec ce que `describe` en dit.
 * @param {object} options
 * @param {string} options.folder
 * @param {string[]} options.files  noms des fichiers audio du dossier
 * @param {unknown} options.previous  station.json déjà là (lu), ou null
 * @param {(file: string) => { titre?: string | null, duree?: number | null }} options.describe
 * @returns {{ station: StationJson, added: string[], removed: string[] }}
 */
export function indexStation({ folder, files, previous, describe }) {
  const old = typeof previous === 'object' && previous !== null ? /** @type {Record<string, unknown>} */ (previous) : {};
  const present = new Set(files);
  /** @type {Morceau[]} */
  const morceaux = [];
  /** @type {string[]} */
  const removed = [];
  for (const item of Array.isArray(old.morceaux) ? old.morceaux : []) {
    const m = /** @type {Record<string, unknown>} */ (typeof item === 'object' && item !== null ? item : {});
    if (typeof m.fichier !== 'string') continue;
    if (!present.has(m.fichier)) {
      removed.push(m.fichier);
      continue;
    }
    if (morceaux.some((known) => known.fichier === m.fichier)) continue;
    /** @type {Morceau} */
    const kept = { fichier: m.fichier, titre: typeof m.titre === 'string' && m.titre.trim() ? m.titre.trim() : titleFromName(m.fichier) };
    if (typeof m.artiste === 'string' && m.artiste.trim()) kept.artiste = m.artiste.trim();
    if (typeof m.duree === 'number' && m.duree > 0) kept.duree = m.duree;
    morceaux.push(kept);
  }
  const added = [...files].filter((file) => !morceaux.some((known) => known.fichier === file)).sort();
  for (const file of added) {
    const info = describe(file);
    /** @type {Morceau} */
    const fresh = { fichier: file, titre: info.titre?.trim() || titleFromName(file) };
    if (typeof info.duree === 'number' && info.duree > 0) fresh.duree = Math.round(info.duree * 100) / 100;
    morceaux.push(fresh);
  }
  const nom = typeof old.nom === 'string' && old.nom.trim() ? old.nom.trim() : titleFromName(folder);
  return { station: { format: 'pmb-station', version: 1, nom, morceaux }, added, removed };
}

/** Une ligne par morceau : le manifeste reste lisible et ses changements se relisent d'un coup d'œil. */
export function formatStation(/** @type {StationJson} */ station) {
  const lines = station.morceaux.map((morceau) => `    ${JSON.stringify(morceau).replace(/":/g, '": ').replace(/,"/g, ', "').replace(/^\{/, '{ ').replace(/\}$/, ' }')}`);
  return [
    '{',
    `  "format": ${JSON.stringify(station.format)},`,
    `  "version": ${station.version},`,
    `  "nom": ${JSON.stringify(station.nom)},`,
    '  "morceaux": [',
    lines.join(',\n'),
    '  ]',
    '}',
    '',
  ].join('\n');
}

/** @param {string} path */
function probeDuration(path) {
  try {
    const out = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path], { encoding: 'utf8' });
    const seconds = Number(out.trim());
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  } catch {
    return null;
  }
}

function main() {
  const root = resolve(RADIO_DIR);
  const wanted = process.argv[2];
  if (!existsSync(root)) {
    console.log(`${RADIO_DIR} absent : aucune station de base.`);
    return;
  }
  const folders = wanted ? [wanted] : readdirSync(root).filter((name) => statSync(join(root, name)).isDirectory());
  for (const folder of folders) {
    const dir = join(root, folder);
    if (!existsSync(dir)) {
      console.error(`${RADIO_DIR}/${folder} : dossier introuvable.`);
      process.exitCode = 1;
      continue;
    }
    const files = readdirSync(dir).filter((name) => AUDIO.has(extname(name).toLowerCase()));
    const manifestPath = join(dir, 'station.json');
    let previous = null;
    if (existsSync(manifestPath)) {
      try {
        previous = JSON.parse(readFileSync(manifestPath, 'utf8'));
      } catch {
        console.error(`${RADIO_DIR}/${folder}/station.json illisible : corrige-le à la main, rien n'est réécrit.`);
        process.exitCode = 1;
        continue;
      }
    }
    if (files.length === 0) {
      console.log(`${RADIO_DIR}/${folder} : aucun morceau, station.json laissé tel quel.`);
      continue;
    }
    const { station, added, removed } = indexStation({
      folder,
      files,
      previous,
      describe: (file) => ({ titre: id3Title(new Uint8Array(readFileSync(join(dir, file)).subarray(0, 256 * 1024))), duree: probeDuration(join(dir, file)) }),
    });
    writeFileSync(manifestPath, formatStation(station));
    console.log(
      `${RADIO_DIR}/${folder}/station.json : « ${station.nom} », ${station.morceaux.length} morceaux` +
        (added.length ? ` ; ajoutés : ${added.join(', ')}` : '') +
        (removed.length ? ` ; retirés : ${removed.join(', ')}` : ''),
    );
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
