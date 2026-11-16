// Stockage privé de l'app (OPFS) : les packs et les morceaux y restent, rien n'est envoyé.

const DIR = 'radio';

export function opfsSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.storage?.getDirectory === 'function' &&
    typeof FileSystemFileHandle !== 'undefined' &&
    'createWritable' in FileSystemFileHandle.prototype
  );
}

let dir: Promise<FileSystemDirectoryHandle> | null = null;

export function radioDir(): Promise<FileSystemDirectoryHandle> {
  dir ??= navigator.storage.getDirectory().then((root) => root.getDirectoryHandle(DIR, { create: true }));
  dir.catch(() => {
    dir = null;
  });
  return dir;
}

export async function openFile(name: string): Promise<File> {
  const handle = await (await radioDir()).getFileHandle(name);
  return handle.getFile();
}

export async function fileHandle(name: string): Promise<FileSystemFileHandle> {
  return (await radioDir()).getFileHandle(name, { create: true });
}

export async function fileSize(name: string): Promise<number> {
  try {
    return (await openFile(name)).size;
  } catch {
    return 0;
  }
}

export async function removeFile(name: string): Promise<void> {
  try {
    await (await radioDir()).removeEntry(name);
  } catch {
    // Déjà parti.
  }
}

export async function listFiles(): Promise<string[]> {
  const names: string[] = [];
  const handle = (await radioDir()) as FileSystemDirectoryHandle & { keys(): AsyncIterable<string> };
  for await (const name of handle.keys()) names.push(name);
  return names;
}

/** Écrit un flux dans un fichier du stockage privé, morceau par morceau. */
export async function writeStream(
  name: string,
  stream: ReadableStream<Uint8Array>,
  onBytes?: (written: number) => void,
): Promise<number> {
  const writable = await (await fileHandle(name)).createWritable();
  const reader = stream.getReader();
  let written = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writable.write(value as Uint8Array<ArrayBuffer>);
      written += value.length;
      onBytes?.(written);
    }
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    await reader.cancel().catch(() => undefined);
    throw error;
  }
  return written;
}

export function isQuotaError(error: unknown): boolean {
  return error instanceof DOMException && (error.name === 'QuotaExceededError' || error.code === 22);
}

/** Morceau prêt à lire : tranche du ZIP (sans copie) ou fichier entier, avec son type. */
export async function trackBlob(track: { file: string; start?: number; end?: number; mime: string }): Promise<Blob> {
  const file = await openFile(track.file);
  return track.start !== undefined && track.end !== undefined
    ? file.slice(track.start, track.end, track.mime)
    : file.slice(0, file.size, track.mime);
}

/**
 * Adresse à poser sur l'élément audio : celle d'un morceau servi par l'app (lu en flux), sinon une
 * adresse d'objet du stockage privé (à libérer ; libérer l'adresse d'un morceau servi ne fait rien).
 */
export async function trackUrl(track: { src?: string; file: string; start?: number; end?: number; mime: string }): Promise<string> {
  if (track.src) return track.src;
  return URL.createObjectURL(await trackBlob(track));
}
