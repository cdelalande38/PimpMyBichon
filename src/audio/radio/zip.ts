// Lecture d'une archive ZIP par tranches d'un Blob (fichier du stockage privé ou fichier choisi) :
// fin du répertoire central, répertoire central, puis en-têtes locaux à la demande.
// L'archive n'est jamais chargée en mémoire : un pack de 400 Mo se lit avec quelques ko.

export type ZipErrorCode = 'abime' | 'zip64' | 'chiffre' | 'methode';

export class ZipError extends Error {
  readonly code: ZipErrorCode;
  constructor(code: ZipErrorCode, message: string) {
    super(message);
    this.name = 'ZipError';
    this.code = code;
  }
}

export interface ZipEntry {
  /** Chemin complet dans l'archive, barres obliques. */
  name: string;
  /** 0 : stocké sans compression ; 8 : deflate. */
  method: number;
  compressedSize: number;
  size: number;
  localOffset: number;
  crc: number;
  encrypted: boolean;
  directory: boolean;
}

const SIG_EOCD = 0x06054b50;
const SIG_EOCD64 = 0x06064b50;
const SIG_EOCD64_LOCATOR = 0x07064b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;
const FOUR_GB = 0x1_0000_0000;
const MAX32 = 0xffffffff;

async function readBytes(blob: Blob, start: number, end: number): Promise<Uint8Array> {
  if (start < 0 || end > blob.size || end < start) throw new ZipError('abime', 'tranche hors du fichier');
  return new Uint8Array(await blob.slice(start, end).arrayBuffer());
}

function u64(view: DataView, offset: number): number {
  return view.getUint32(offset, true) + view.getUint32(offset + 4, true) * FOUR_GB;
}

let crcTable: Uint32Array | null = null;

/** CRC-32 du format ZIP (polynôme 0xEDB88320). */
export function crc32(bytes: Uint8Array, seed = 0): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = (seed ^ MAX32) >>> 0;
  for (const byte of bytes) crc = (crcTable[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ MAX32) >>> 0;
}

// Page de code 437 (noms des vieux ZIP sans drapeau UTF-8), octets 128 à 255.
const CP437 =
  'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';

const utf8 = new TextDecoder('utf-8');
const utf8Strict = new TextDecoder('utf-8', { fatal: true });

function decodeLegacyName(raw: Uint8Array): string {
  // Beaucoup d'outils écrivent de l'UTF-8 sans lever le drapeau : on l'essaie d'abord.
  try {
    return utf8Strict.decode(raw);
  } catch {
    let out = '';
    for (const byte of raw) out += byte < 128 ? String.fromCharCode(byte) : (CP437[byte - 128] ?? '?');
    return out;
  }
}

/** Champ « chemin Unicode » d'Info-ZIP (0x7075) : version 1, CRC du nom d'origine, nom en UTF-8. */
function unicodePathField(extra: Uint8Array, rawName: Uint8Array): string | null {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = view.getUint16(at, true);
    const len = view.getUint16(at + 2, true);
    const body = at + 4;
    if (body + len > extra.length) break;
    if (id === 0x7075 && len >= 5 && extra[body] === 1) {
      if (view.getUint32(body + 1, true) === crc32(rawName)) {
        try {
          return utf8Strict.decode(extra.subarray(body + 5, body + len));
        } catch {
          return null;
        }
      }
    }
    at = body + len;
  }
  return null;
}

interface Zip64Values {
  size: number;
  compressedSize: number;
  localOffset: number;
}

function zip64Extra(extra: Uint8Array, wanted: Zip64Values): Zip64Values {
  const view = new DataView(extra.buffer, extra.byteOffset, extra.byteLength);
  let at = 0;
  while (at + 4 <= extra.length) {
    const id = view.getUint16(at, true);
    const len = view.getUint16(at + 2, true);
    let p = at + 4;
    if (id === 0x0001) {
      const out = { ...wanted };
      const end = p + len;
      if (out.size === MAX32 && p + 8 <= end) {
        out.size = u64(view, p);
        p += 8;
      }
      if (out.compressedSize === MAX32 && p + 8 <= end) {
        out.compressedSize = u64(view, p);
        p += 8;
      }
      if (out.localOffset === MAX32 && p + 8 <= end) out.localOffset = u64(view, p);
      return out;
    }
    at = p + len;
  }
  return wanted;
}

/** Lit la liste des entrées d'une archive. Refuse clairement une archive abîmée ou trop grosse. */
export async function readZipEntries(blob: Blob): Promise<ZipEntry[]> {
  if (blob.size > FOUR_GB) throw new ZipError('zip64', 'archive de plus de 4 Go');
  if (blob.size < 22) throw new ZipError('abime', 'fichier trop court pour un ZIP');

  const tailStart = Math.max(0, blob.size - (22 + 0xffff));
  const tail = await readBytes(blob, tailStart, blob.size);
  const tv = new DataView(tail.buffer, tail.byteOffset, tail.byteLength);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i -= 1) {
    if (tv.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('abime', 'fin du répertoire central introuvable');

  let count = tv.getUint16(eocd + 10, true);
  let cdSize = tv.getUint32(eocd + 12, true);
  let cdOffset = tv.getUint32(eocd + 16, true);

  if (count === 0xffff || cdSize === MAX32 || cdOffset === MAX32) {
    // ZIP64 : le localisateur précède la fin du répertoire central.
    const loc = eocd - 20;
    if (loc < 0 || tv.getUint32(loc, true) !== SIG_EOCD64_LOCATOR) {
      throw new ZipError('abime', 'localisateur ZIP64 introuvable');
    }
    const recordOffset = u64(tv, loc + 8);
    const record = await readBytes(blob, recordOffset, recordOffset + 56);
    const rv = new DataView(record.buffer, record.byteOffset, record.byteLength);
    if (rv.getUint32(0, true) !== SIG_EOCD64) throw new ZipError('abime', 'fin ZIP64 illisible');
    count = u64(rv, 32);
    cdSize = u64(rv, 40);
    cdOffset = u64(rv, 48);
  }

  if (cdOffset + cdSize > blob.size) throw new ZipError('abime', 'répertoire central hors du fichier');
  const cd = await readBytes(blob, cdOffset, cdOffset + cdSize);
  const view = new DataView(cd.buffer, cd.byteOffset, cd.byteLength);
  const entries: ZipEntry[] = [];
  let at = 0;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > cd.length || view.getUint32(at, true) !== SIG_CENTRAL) {
      throw new ZipError('abime', 'entrée du répertoire central illisible');
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    const crc = view.getUint32(at + 16, true);
    const nameLen = view.getUint16(at + 28, true);
    const extraLen = view.getUint16(at + 30, true);
    const commentLen = view.getUint16(at + 32, true);
    const rawName = cd.subarray(at + 46, at + 46 + nameLen);
    const extra = cd.subarray(at + 46 + nameLen, at + 46 + nameLen + extraLen);
    if (at + 46 + nameLen + extraLen > cd.length) throw new ZipError('abime', 'nom tronqué');

    const sizes = zip64Extra(extra, {
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      localOffset: view.getUint32(at + 42, true),
    });
    const name =
      flags & 0x0800 ? utf8.decode(rawName) : (unicodePathField(extra, rawName) ?? decodeLegacyName(rawName));
    const clean = name.replace(/\\/g, '/');
    entries.push({
      name: clean,
      method,
      crc,
      ...sizes,
      encrypted: (flags & 0x0001) !== 0,
      directory: clean.endsWith('/'),
    });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

/** Position des données d'une entrée dans l'archive, lue dans son en-tête local. */
export async function entryRange(blob: Blob, entry: ZipEntry): Promise<{ start: number; end: number }> {
  const head = await readBytes(blob, entry.localOffset, Math.min(blob.size, entry.localOffset + 30));
  const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
  if (head.length < 30 || view.getUint32(0, true) !== SIG_LOCAL) {
    throw new ZipError('abime', `en-tête local illisible (${entry.name})`);
  }
  const start = entry.localOffset + 30 + view.getUint16(26, true) + view.getUint16(28, true);
  const end = start + entry.compressedSize;
  if (end > blob.size) throw new ZipError('abime', `données tronquées (${entry.name})`);
  return { start, end };
}

/** Flux des données décompressées d'une entrée (stockée ou deflate). */
export async function entryStream(blob: Blob, entry: ZipEntry): Promise<ReadableStream<Uint8Array>> {
  if (entry.encrypted) throw new ZipError('chiffre', `entrée chiffrée (${entry.name})`);
  const { start, end } = await entryRange(blob, entry);
  const raw = blob.slice(start, end).stream();
  if (entry.method === 0) return raw;
  if (entry.method === 8) {
    return raw.pipeThrough(new DecompressionStream('deflate-raw') as unknown as TransformStream<Uint8Array, Uint8Array>);
  }
  throw new ZipError('methode', `compression non prise en charge (${entry.name})`);
}

/** Contenu complet d'une petite entrée (pack.json, début d'un morceau). */
export async function entryBytes(blob: Blob, entry: ZipEntry, limit = 1 << 20): Promise<Uint8Array> {
  if (entry.method === 0) {
    const { start, end } = await entryRange(blob, entry);
    if (entry.encrypted) throw new ZipError('chiffre', `entrée chiffrée (${entry.name})`);
    return readBytes(blob, start, Math.min(end, start + limit));
  }
  const reader = (await entryStream(blob, entry)).getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    while (total < limit) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      total += value.length;
    }
  } catch {
    throw new ZipError('abime', `décompression impossible (${entry.name})`);
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  const out = new Uint8Array(Math.min(total, limit));
  let at = 0;
  for (const part of parts) {
    const take = Math.min(part.length, out.length - at);
    out.set(part.subarray(0, take), at);
    at += take;
    if (at >= out.length) break;
  }
  return out;
}
