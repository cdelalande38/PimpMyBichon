// Fabrique de packs d'essai pour les tests de la radio : ZIP stocké ou deflate, noms en UTF-8
// (drapeau 11), en champ Unicode 0x7075 ou en page 437, étiquettes ID3v2. Aucun vrai titre.

import { deflateRawSync } from 'node:zlib';

const table = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

export function crc(data: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of data) c = (table[(c ^ b) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export interface FixtureEntry {
  name: string;
  data: Uint8Array;
  deflate?: boolean;
  /** Nom écrit : UTF-8 avec drapeau (défaut), champ 0x7075, ou octets bruts en page 437. */
  naming?: 'utf8' | 'unicode-extra' | 'cp437';
  cp437Bytes?: Uint8Array;
  encrypted?: boolean;
}

export function buildZip(entries: FixtureEntry[]): Uint8Array {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const naming = entry.naming ?? 'utf8';
    const utf8 = Buffer.from(entry.name, 'utf8');
    const raw = naming === 'utf8' ? utf8 : Buffer.from(entry.cp437Bytes ?? Buffer.from(entry.name, 'latin1'));
    let extra = Buffer.alloc(0);
    if (naming === 'unicode-extra') {
      extra = Buffer.alloc(4 + 5 + utf8.length);
      extra.writeUInt16LE(0x7075, 0);
      extra.writeUInt16LE(5 + utf8.length, 2);
      extra.writeUInt8(1, 4);
      extra.writeUInt32LE(crc(raw), 5);
      utf8.copy(extra, 9);
    }
    const body = entry.deflate ? deflateRawSync(Buffer.from(entry.data)) : Buffer.from(entry.data);
    const flags = (naming === 'utf8' ? 0x0800 : 0) | (entry.encrypted ? 1 : 0);
    const sum = crc(entry.data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(entry.deflate ? 8 : 0, 8);
    local.writeUInt32LE(sum, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(entry.data.length, 22);
    local.writeUInt16LE(raw.length, 26);
    local.writeUInt16LE(extra.length, 28);
    parts.push(local, raw, extra, body);
    const head = Buffer.alloc(46);
    head.writeUInt32LE(0x02014b50, 0);
    head.writeUInt16LE(20, 4);
    head.writeUInt16LE(20, 6);
    head.writeUInt16LE(flags, 8);
    head.writeUInt16LE(entry.deflate ? 8 : 0, 10);
    head.writeUInt32LE(sum, 16);
    head.writeUInt32LE(body.length, 20);
    head.writeUInt32LE(entry.data.length, 24);
    head.writeUInt16LE(raw.length, 28);
    head.writeUInt16LE(extra.length, 30);
    head.writeUInt32LE(offset, 42);
    central.push(head, raw, extra);
    offset += 30 + raw.length + extra.length + body.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...parts, cd, end]));
}

function synchsafe(n: number): Buffer {
  return Buffer.from([(n >> 21) & 0x7f, (n >> 14) & 0x7f, (n >> 7) & 0x7f, n & 0x7f]);
}

/** Étiquette ID3v2.3 (ou 2.4) avec titre et artiste, suivie de quelques octets « audio ». */
export function id3Tagged(title: string, artist: string, version: 3 | 4 = 3, audio = 64): Uint8Array {
  const frame = (id: string, text: string, encoding: number) => {
    const body =
      encoding === 1
        ? Buffer.concat([Buffer.from([1, 0xff, 0xfe]), Buffer.from(text, 'utf16le')])
        : Buffer.concat([Buffer.from([3]), Buffer.from(text, 'utf8')]);
    const size = version === 4 ? synchsafe(body.length) : Buffer.from([0, 0, (body.length >> 8) & 0xff, body.length & 0xff]);
    return Buffer.concat([Buffer.from(id, 'latin1'), size, Buffer.from([0, 0]), body]);
  };
  const frames = Buffer.concat([frame('TIT2', title, version === 3 ? 1 : 3), frame('TPE1', artist, version === 3 ? 1 : 3)]);
  const padding = Buffer.alloc(16);
  const header = Buffer.concat([Buffer.from('ID3', 'latin1'), Buffer.from([version, 0, 0]), synchsafe(frames.length + padding.length)]);
  return new Uint8Array(Buffer.concat([header, frames, padding, Buffer.alloc(audio, 0x55)]));
}

export function packJson(value: unknown): FixtureEntry {
  return { name: 'pack.json', data: new Uint8Array(Buffer.from(JSON.stringify(value))) };
}
