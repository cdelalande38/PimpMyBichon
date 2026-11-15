// Titre et artiste : étiquettes ID3v2 (2.2, 2.3, 2.4) au début du morceau, sinon le nom du fichier.

export interface TrackTags {
  title?: string;
  artist?: string;
}

/** Taille totale de l'étiquette ID3v2 (en-tête compris), 0 s'il n'y en a pas. */
export function id3Size(head: Uint8Array): number {
  if (head.length < 10 || head[0] !== 0x49 || head[1] !== 0x44 || head[2] !== 0x33) return 0;
  const s = [head[6] ?? 0, head[7] ?? 0, head[8] ?? 0, head[9] ?? 0];
  if (s.some((b) => b & 0x80)) return 0;
  const footer = (head[5] ?? 0) & 0x10 ? 10 : 0;
  return 10 + ((s[0]! << 21) | (s[1]! << 14) | (s[2]! << 7) | s[3]!) + footer;
}

function synchsafe(bytes: Uint8Array, at: number): number {
  return ((bytes[at]! & 0x7f) << 21) | ((bytes[at + 1]! & 0x7f) << 14) | ((bytes[at + 2]! & 0x7f) << 7) | (bytes[at + 3]! & 0x7f);
}

function plain32(bytes: Uint8Array, at: number): number {
  return ((bytes[at]! << 24) >>> 0) + (bytes[at + 1]! << 16) + (bytes[at + 2]! << 8) + bytes[at + 3]!;
}

function unsync(bytes: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const b = bytes[i]!;
    out.push(b);
    if (b === 0xff && bytes[i + 1] === 0x00) i += 1;
  }
  return Uint8Array.from(out);
}

function decodeText(frame: Uint8Array): string {
  if (frame.length < 2) return '';
  const encoding = frame[0];
  const body = frame.subarray(1);
  let text: string;
  if (encoding === 1 || encoding === 2) {
    let label = encoding === 2 ? 'utf-16be' : 'utf-16le';
    let data = body;
    if (encoding === 1 && body.length >= 2) {
      if (body[0] === 0xfe && body[1] === 0xff) label = 'utf-16be';
      if ((body[0] === 0xfe && body[1] === 0xff) || (body[0] === 0xff && body[1] === 0xfe)) data = body.subarray(2);
    }
    text = new TextDecoder(label).decode(data);
  } else if (encoding === 3) {
    text = new TextDecoder('utf-8').decode(body);
  } else {
    text = new TextDecoder('latin1').decode(body);
  }
  // Plusieurs valeurs (2.4) séparées par un caractère nul : on les joint.
  return text
    .split('\u0000')
    .map((part) => part.replace(/^\uFEFF/, '').trim())
    .filter(Boolean)
    .join(', ');
}

/** Lit TIT2/TPE1 (TT2/TP1 en 2.2). Une étiquette illisible rend un objet vide, jamais une erreur. */
export function parseId3(bytes: Uint8Array): TrackTags {
  const tags: TrackTags = {};
  if (id3Size(bytes) === 0) return tags;
  const major = bytes[3] ?? 0;
  const flags = bytes[5] ?? 0;
  if (major < 2 || major > 4) return tags;
  const total = Math.min(bytes.length, id3Size(bytes) - (flags & 0x10 ? 10 : 0));
  let data = bytes.subarray(10, total);
  if (major < 4 && flags & 0x80) data = unsync(data);

  let at = 0;
  if (flags & 0x40 && major >= 3) {
    if (data.length < 4) return tags;
    at = major === 4 ? synchsafe(data, 0) : plain32(data, 0) + 4;
  }

  const idLen = major === 2 ? 3 : 4;
  const headLen = major === 2 ? 6 : 10;
  const wanted: Record<string, keyof TrackTags> =
    major === 2 ? { TT2: 'title', TP1: 'artist' } : { TIT2: 'title', TPE1: 'artist' };

  while (at + headLen <= data.length) {
    const id = String.fromCharCode(...data.subarray(at, at + idLen));
    if (!/^[A-Z0-9]+$/.test(id)) break;
    const size =
      major === 2
        ? (data[at + 3]! << 16) | (data[at + 4]! << 8) | data[at + 5]!
        : major === 4
          ? synchsafe(data, at + 4)
          : plain32(data, at + 4);
    const start = at + headLen;
    const end = start + size;
    if (size <= 0 || end > data.length) break;
    const key = wanted[id];
    if (key && !tags[key]) {
      let frame = data.subarray(start, end);
      // 2.4 : désynchronisation par trame (drapeau 0x02 du second octet de drapeaux).
      if (major === 4 && (data[at + 9]! & 0x02) !== 0) frame = unsync(frame);
      const text = decodeText(frame).slice(0, 200);
      if (text) tags[key] = text;
    }
    if (tags.title && tags.artist) break;
    at = end;
  }
  return tags;
}

/** Titre et artiste tirés du nom de fichier : « 03 - Artiste - Titre.mp3 ». */
export function tagsFromFilename(path: string): Required<Pick<TrackTags, 'title'>> & TrackTags {
  let base = path.slice(path.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  if (dot > 0) base = base.slice(0, dot);
  base = base.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  const withoutNumber = base.replace(/^\d{1,3}\s*[-–.)]\s*/u, '').replace(/^\d{1,3}\s+(?=\D)/u, '');
  const text = withoutNumber || base;
  const parts = text.split(/\s+[-–]\s+/u);
  if (parts.length >= 2 && parts[0] && parts.slice(1).join(' - ')) {
    return { artist: parts[0].trim(), title: parts.slice(1).join(' - ').trim() };
  }
  return { title: text || base || 'Sans titre' };
}
