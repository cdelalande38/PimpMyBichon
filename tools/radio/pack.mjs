#!/usr/bin/env node
// @ts-check
// npm run radio:pack -- <dossier source> <fichier ou dossier de sortie> [--par-station]
//
// Fabrique un pack de musique pour la radio de l'atelier : un ZIP sans compression (les MP3 ne
// se compressent pas, et l'app lit chaque morceau comme une tranche du ZIP, sans copie), noms en
// UTF-8 (drapeau 11). Node seul, aucune dépendance. Les packs ne passent jamais par le dépôt.
//
//   par défaut      un seul ZIP « version 2 » : un dossier par station, pack.json à la racine ;
//   --par-station   un ZIP « version 1 » par sous-dossier, rangés dans le dossier de sortie.
//
// Un sous-dossier du dossier source = une station (son nom donne celui de la station). Des morceaux
// posés directement dans le dossier source forment une station au nom de ce dossier.

import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, statSync, writeSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve, sep } from 'node:path';

const AUDIO = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac', '.webm']);
const CHUNK = 1 << 20;
const MAX32 = 0xffffffff;

const crcTable = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

/** @param {string} path */
function fileCrc(path) {
  const fd = openSync(path, 'r');
  const buf = Buffer.allocUnsafe(CHUNK);
  let crc = MAX32;
  try {
    for (;;) {
      const n = readSync(fd, buf, 0, CHUNK, null);
      if (n === 0) break;
      for (let i = 0; i < n; i += 1) crc = (crcTable[(crc ^ /** @type {number} */ (buf[i])) & 0xff] ?? 0) ^ (crc >>> 8);
    }
  } finally {
    closeSync(fd);
  }
  return (crc ^ MAX32) >>> 0;
}

/** @param {Buffer} data */
function bufferCrc(data) {
  let crc = MAX32;
  for (const byte of data) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ MAX32) >>> 0;
}

/** @param {Date} date */
function dosDateTime(date) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const collator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

/**
 * Morceaux d'un dossier, récursivement, triés.
 * @param {string} dir
 * @returns {string[]}
 */
function audioFiles(dir, deep = true) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const path = join(dir, entry.name);
    if (entry.isDirectory() && deep) out.push(...audioFiles(path));
    else if (entry.isFile() && AUDIO.has(extname(entry.name).toLowerCase())) out.push(path);
  }
  return out.sort((a, b) => collator.compare(a, b));
}

/**
 * @typedef {{ folder: string, root: string, files: string[] }} StationSource
 * @param {string} source
 * @returns {StationSource[]}
 */
function stationsOf(source) {
  /** @type {StationSource[]} */
  const stations = [];
  const dirs = readdirSync(source, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
    .sort((a, b) => collator.compare(a, b));
  for (const folder of dirs) {
    const files = audioFiles(join(source, folder));
    if (files.length > 0) stations.push({ folder, root: join(source, folder), files });
  }
  const loose = audioFiles(source, false);
  if (loose.length > 0) stations.push({ folder: basename(resolve(source)), root: source, files: loose });
  return stations;
}

/**
 * Écrit un ZIP « stocké » : en-têtes locaux, données recopiées par blocs, répertoire central.
 * @param {string} output
 * @param {{ name: string, path?: string, data?: Buffer }[]} items
 */
function writeZip(output, items) {
  mkdirSync(dirname(output), { recursive: true });
  const fd = openSync(output, 'w');
  /** @type {Buffer[]} */
  const central = [];
  let offset = 0;
  const put = (/** @type {Buffer} */ buf) => {
    writeSync(fd, buf, 0, buf.length, offset);
    offset += buf.length;
  };
  try {
    for (const item of items) {
      const name = Buffer.from(item.name.normalize('NFC'), 'utf8');
      const size = item.data ? item.data.length : statSync(/** @type {string} */ (item.path)).size;
      const crc = item.data ? bufferCrc(item.data) : fileCrc(/** @type {string} */ (item.path));
      const when = dosDateTime(item.path ? statSync(item.path).mtime : new Date());
      if (offset + size + 30 + name.length > MAX32) throw new Error('pack de plus de 4 Go : utilise --par-station');
      const local = Buffer.alloc(30);
      local.writeUInt32LE(0x04034b50, 0);
      local.writeUInt16LE(20, 4); // version nécessaire
      local.writeUInt16LE(0x0800, 6); // noms en UTF-8
      local.writeUInt16LE(0, 8); // stocké
      local.writeUInt16LE(when.time, 10);
      local.writeUInt16LE(when.date, 12);
      local.writeUInt32LE(crc, 14);
      local.writeUInt32LE(size, 18);
      local.writeUInt32LE(size, 22);
      local.writeUInt16LE(name.length, 26);
      local.writeUInt16LE(0, 28);
      const headerOffset = offset;
      put(local);
      put(name);
      if (item.data) {
        put(item.data);
      } else {
        const src = openSync(/** @type {string} */ (item.path), 'r');
        const buf = Buffer.allocUnsafe(CHUNK);
        try {
          for (;;) {
            const n = readSync(src, buf, 0, CHUNK, null);
            if (n === 0) break;
            put(buf.subarray(0, n));
          }
        } finally {
          closeSync(src);
        }
      }
      const entry = Buffer.alloc(46);
      entry.writeUInt32LE(0x02014b50, 0);
      entry.writeUInt16LE(0x031e, 4); // fabriqué sous Unix, version 3.0
      entry.writeUInt16LE(20, 6);
      entry.writeUInt16LE(0x0800, 8);
      entry.writeUInt16LE(0, 10);
      entry.writeUInt16LE(when.time, 12);
      entry.writeUInt16LE(when.date, 14);
      entry.writeUInt32LE(crc, 16);
      entry.writeUInt32LE(size, 20);
      entry.writeUInt32LE(size, 24);
      entry.writeUInt16LE(name.length, 28);
      entry.writeUInt32LE((0o100644 << 16) >>> 0, 38);
      entry.writeUInt32LE(headerOffset, 42);
      central.push(entry, name);
    }
    const cdOffset = offset;
    for (const buf of central) put(buf);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(items.length, 8);
    end.writeUInt16LE(items.length, 10);
    end.writeUInt32LE(offset - cdOffset, 12);
    end.writeUInt32LE(cdOffset, 16);
    put(end);
  } finally {
    closeSync(fd);
  }
  return offset;
}

/** @param {StationSource} station */
function entriesOf(station) {
  return station.files.map((path) => ({
    name: `${station.folder}/${relative(station.root, path).split(sep).join('/')}`,
    path,
  }));
}

/** @param {number} bytes */
function mo(bytes) {
  return `${(bytes / 1e6).toFixed(1).replace('.', ',')} Mo`;
}

function main() {
  const args = process.argv.slice(2);
  const perStation = args.includes('--par-station');
  const positional = args.filter((arg) => !arg.startsWith('--'));
  if (args.includes('--help') || positional.length < 2) {
    console.log('Usage : npm run radio:pack -- <dossier source> <fichier ou dossier de sortie> [--par-station]');
    console.log('  par défaut : un ZIP version 2 pour tous les sous-dossiers (une station par sous-dossier)');
    console.log('  --par-station : un ZIP version 1 par sous-dossier, dans le dossier de sortie');
    process.exit(positional.length < 2 && !args.includes('--help') ? 2 : 0);
  }
  const source = resolve(/** @type {string} */ (positional[0]));
  let output = resolve(/** @type {string} */ (positional[1]));
  if (!existsSync(source) || !statSync(source).isDirectory()) {
    console.error(`Dossier source introuvable : ${source}`);
    process.exit(1);
  }
  const stations = stationsOf(source);
  if (stations.length === 0) {
    console.error('Aucun morceau trouvé (mp3, m4a, aac, ogg, opus, wav, flac, webm).');
    process.exit(1);
  }

  if (perStation) {
    if (output.toLowerCase().endsWith('.zip')) output = dirname(output);
    for (const station of stations) {
      const manifest = { format: 'pmb-pack', version: 1, station: station.folder, pistes: station.files.length };
      const file = join(output, `${station.folder}.zip`);
      const bytes = writeZip(file, [
        { name: 'pack.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
        ...entriesOf(station),
      ]);
      console.log(`${file} : « ${station.folder} », ${station.files.length} morceaux, ${mo(bytes)}`);
    }
    return;
  }

  if (!output.toLowerCase().endsWith('.zip')) output = join(output, 'pack-musique.zip');
  if (output.startsWith(source + sep)) {
    console.error('Le pack ne peut pas être écrit dans le dossier source.');
    process.exit(1);
  }
  const manifest = {
    format: 'pmb-pack',
    version: 2,
    stations: stations.map((station) => ({ dossier: station.folder, pistes: station.files.length })),
  };
  const bytes = writeZip(output, [
    { name: 'pack.json', data: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`) },
    ...stations.flatMap(entriesOf),
  ]);
  const count = stations.reduce((sum, station) => sum + station.files.length, 0);
  console.log(`${output} : ${stations.length} stations, ${count} morceaux, ${mo(bytes)}`);
  for (const station of stations) console.log(`  ${station.folder} : ${station.files.length}`);
}

main();
