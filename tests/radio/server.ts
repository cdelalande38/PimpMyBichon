// Petit hébergement d'essai pour les parcours de la radio, sur une autre origine que l'app.
// /cors/… envoie l'en-tête CORS (et accepte HEAD et Range), /nocors/… ne l'envoie pas,
// /coupe/… coupe la connexion à mi-chemin d'une requête sans Range (la reprise passe),
// /sansfin/… envoie un début de ZIP puis des octets sans fin, sans Content-Length (épreuve du plafond).
// Les packs viennent d'un tampon en mémoire ou d'un fichier sur le disque (épreuve de taille).

import { createReadStream, statSync } from 'node:fs';
import { createServer, type Server, type ServerResponse } from 'node:http';
import { buildZip, type FixtureEntry } from './fixtures.ts';

export type PackSource = { buffer: Uint8Array } | { file: string };

export function startPackServer(port: number, packs: Map<string, PackSource>, log: string[] = []): Promise<Server> {
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const [, mode, name] = url.pathname.split('/');
    const source = name ? packs.get(name) : undefined;
    log.push(`${req.method} ${url.pathname}${req.headers.range ? ` ${req.headers.range}` : ''}`);
    if (mode === 'cors' || mode === 'coupe') {
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Headers', 'Range');
      res.setHeader('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges');
    }
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }
    if (mode === 'sansfin') {
      endless(res, log);
      return;
    }
    if (!source || (mode !== 'cors' && mode !== 'nocors' && mode !== 'coupe')) {
      res.writeHead(404).end();
      return;
    }
    const size = 'buffer' in source ? source.buffer.length : statSync(source.file).size;
    const range = /bytes=(\d+)-/.exec(req.headers.range ?? '');
    const start = range ? Number(range[1]) : 0;
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Length', String(size - start));
    if (range) res.setHeader('Content-Range', `bytes ${start}-${size - 1}/${size}`);
    res.writeHead(range ? 206 : 200);
    if (req.method === 'HEAD') {
      res.end();
      return;
    }
    if (mode === 'coupe' && !range && 'buffer' in source) {
      const half = Buffer.from(source.buffer.subarray(0, Math.floor(size / 2)));
      res.write(half, () => setTimeout(() => res.socket?.destroy(), 150));
      return;
    }
    if ('buffer' in source) res.end(Buffer.from(source.buffer.subarray(start)));
    else createReadStream(source.file, { start }).pipe(res);
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve(server)));
}

/** Flux sans fin : en-tête local de ZIP, puis 256 Kio après 256 Kio jusqu'à ce que le client coupe. */
function endless(res: ServerResponse, log: string[]): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.writeHead(200, { 'Content-Type': 'application/zip' });
  const chunk = Buffer.alloc(256 * 1024, 0x55);
  const first = Buffer.from(chunk);
  first.writeUInt32LE(0x04034b50, 0);
  let sent = 0;
  res.on('close', () => log.push(`sansfin coupé après ${sent} octets`));
  const pump = () => {
    while (!res.destroyed && sent < 4 * 1024 ** 3) {
      const ok = res.write(sent === 0 ? first : chunk);
      sent += chunk.length;
      if (!ok) {
        res.once('drain', pump);
        return;
      }
    }
  };
  pump();
}

/** Morceau WAV d'essai : bruit faible produit par le test (8 kHz, mono, 8 bits). Jamais livré. */
export function noiseWav(seconds: number, seed: number): Uint8Array {
  const rate = 8000;
  const samples = rate * seconds;
  const out = Buffer.alloc(44 + samples);
  out.write('RIFF', 0, 'latin1');
  out.writeUInt32LE(36 + samples, 4);
  out.write('WAVEfmt ', 8, 'latin1');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20);
  out.writeUInt16LE(1, 22);
  out.writeUInt32LE(rate, 24);
  out.writeUInt32LE(rate, 28);
  out.writeUInt16LE(1, 32);
  out.writeUInt16LE(8, 34);
  out.write('data', 36, 'latin1');
  out.writeUInt32LE(samples, 40);
  let x = seed;
  for (let i = 0; i < samples; i += 1) {
    x = (x * 1103515245 + 12345) & 0x7fffffff;
    out[44 + i] = 128 + ((x >> 16) % 9) - 4;
  }
  return new Uint8Array(out);
}

/** Petit pack version 2 : par défaut deux stations de deux morceaux WAV (20 s chacun). */
export function smallPack(stations: string[] = ['electro', 'rock'], count = 2, seconds = 20): Uint8Array {
  const entries: FixtureEntry[] = [
    {
      name: 'pack.json',
      data: new Uint8Array(
        Buffer.from(JSON.stringify({ format: 'pmb-pack', version: 2, stations: stations.map((dossier) => ({ dossier, pistes: count })) })),
      ),
    },
  ];
  stations.forEach((folder, s) => {
    for (let i = 0; i < count; i += 1) {
      const letter = 'abcdefgh'[i] ?? String(i);
      // Le second morceau de la seconde station est compressé (deflate) : décompressé une fois à l'import.
      entries.push({ name: `${folder}/0${i + 1} - Bruit d’essai ${s + 1}${letter}.wav`, data: noiseWav(seconds, 11 + 12 * i + s), deflate: s === 1 && i === 1 });
    }
  });
  return buildZip(entries);
}
