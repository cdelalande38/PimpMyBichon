// Mode photo (§ 5.1, § 8 « Rendu photo ») : cadrage choisi, avancement de l'affinage, image
// enregistrée. Non sauvegardé. L'image ne quitte jamais le téléphone : partage du système ou
// téléchargement, rien n'est envoyé nulle part.

import { create } from 'zustand';
import { FRAMINGS, type FramingId } from '../data/framings.ts';

export type RefineStatus = 'mouvement' | 'affinage' | 'net';
export type SaveStatus = 'repos' | 'rendu' | 'pret' | 'erreur';

export interface PhotoImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface PhotoResult {
  file: File;
  url: string;
  width: number;
  height: number;
}

/** Rendu de l'image enregistrée, fourni par la scène ; avancement de 0 à 1. */
export type PhotoExporter = (onProgress: (progress: number) => void) => Promise<PhotoImage>;

interface PhotoState {
  framing: FramingId;
  /** Change à chaque choix de cadrage, même répété : la caméra y retourne. */
  request: number;
  refine: { status: RefineStatus; done: number; target: number };
  save: { status: SaveStatus; progress: number; result: PhotoResult | null };
  exporter: PhotoExporter | null;
  choose: (id: FramingId) => void;
}

export const usePhoto = create<PhotoState>()((set) => ({
  framing: FRAMINGS[0]?.id ?? 'avant',
  request: 0,
  refine: { status: 'mouvement', done: 0, target: 1 },
  save: { status: 'repos', progress: 0, result: null },
  exporter: null,
  choose: (id) => set((state) => ({ framing: id, request: state.request + 1 })),
}));

function stamp(date: Date): string {
  const two = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}${two(date.getMonth() + 1)}${two(date.getDate())}-${two(date.getHours())}${two(date.getMinutes())}${two(date.getSeconds())}`;
}

/** Le navigateur sait-il proposer ce fichier au partage du système ? */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === 'function' && navigator.canShare?.({ files: [file] }) === true;
  } catch {
    return false;
  }
}

/** Partage du système ; un partage annulé n'est pas une erreur. */
export async function shareFile(file: File): Promise<void> {
  try {
    await navigator.share({ files: [file], title: 'PimpMyBichon' });
  } catch {
    // Annulé, ou geste trop ancien : le bouton « Partager » et le téléchargement restent là.
  }
}

/** Rend l'image en 2160 px, puis la propose au partage si le geste est encore frais. */
export async function savePhoto(): Promise<void> {
  const { exporter, framing, save } = usePhoto.getState();
  if (!exporter || save.status === 'rendu') return;
  usePhoto.setState({ save: { status: 'rendu', progress: 0, result: save.result } });
  try {
    const image = await exporter((progress) =>
      usePhoto.setState((state) => ({ save: { ...state.save, progress } })),
    );
    const previous = usePhoto.getState().save.result;
    if (previous) URL.revokeObjectURL(previous.url);
    const file = new File([image.blob], `pimpmybichon-${framing}-${stamp(new Date())}.jpg`, { type: image.blob.type });
    const result: PhotoResult = { file, url: URL.createObjectURL(file), width: image.width, height: image.height };
    usePhoto.setState({ save: { status: 'pret', progress: 1, result } });
    if (navigator.userActivation?.isActive && canShareFile(file)) await shareFile(file);
  } catch {
    usePhoto.setState((state) => ({ save: { status: 'erreur', progress: 0, result: state.save.result } }));
  }
}

/** En quittant le mode photo : l'image prête est libérée. */
export function leavePhoto(): void {
  const { result } = usePhoto.getState().save;
  if (result) URL.revokeObjectURL(result.url);
  usePhoto.setState({ save: { status: 'repos', progress: 0, result: null } });
}
