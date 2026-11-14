// Mode photo (§ 5.1) : l'interface s'efface ; sous le pouce, les 5 cadrages (src/data/framings.ts),
// « Enregistrer » et « Retour ». L'état de l'affinage est dit à l'écran.

import { useEffect } from 'react';
import { closeSheet } from '../app/useRoute.ts';
import { FRAMINGS } from '../data/framings.ts';
import { canShareFile, leavePhoto, savePhoto, shareFile, usePhoto } from '../state/photo.ts';

const percent = (value: number) => `${Math.round(value * 100)}\u00a0%`;

function useStatusLine(): string {
  const refine = usePhoto((state) => state.refine);
  const save = usePhoto((state) => state.save);
  if (save.status === 'rendu') return `Enregistrement en grand format… ${percent(save.progress)}`;
  if (save.status === 'erreur') return 'L’enregistrement a raté. Réessaie, ou baisse la qualité dans les réglages.';
  if (refine.status === 'mouvement') return 'Cadre ta photo : l’image s’affine dès que tu lâches.';
  if (refine.status === 'affinage') return `L’image s’affine… ${percent(refine.done / refine.target)}`;
  return 'Image nette. Tu peux l’enregistrer.';
}

export function PhotoBar() {
  const framing = usePhoto((state) => state.framing);
  const choose = usePhoto((state) => state.choose);
  const refine = usePhoto((state) => state.refine.status);
  const save = usePhoto((state) => state.save);
  const ready = usePhoto((state) => state.exporter !== null);
  const status = useStatusLine();
  const busy = save.status === 'rendu';
  const result = save.status === 'pret' ? save.result : null;

  useEffect(() => leavePhoto, []);

  return (
    <footer className="dock photo-bar" aria-label="Mode photo">
      <p className="photo-status" role="status" data-refine={refine} data-save={save.status}>
        {status}
      </p>

      {result && (
        <div className="strip" data-photo-size={`${result.width}x${result.height}`}>
          <span>
            Image prête · {result.width} × {result.height}&nbsp;px
          </span>
          {canShareFile(result.file) && (
            <button type="button" className="btn" onClick={() => void shareFile(result.file)}>
              Partager
            </button>
          )}
          <a className="btn" href={result.url} download={result.file.name}>
            Télécharger
          </a>
        </div>
      )}

      <div className="framings" role="group" aria-label="Cadrages">
        {FRAMINGS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="btn chip"
            aria-label={item.label}
            aria-pressed={item.id === framing}
            disabled={busy}
            onClick={() => choose(item.id)}
          >
            {item.short}
          </button>
        ))}
      </div>

      <nav className="acts" aria-label="Photo">
        <button type="button" className="btn" disabled={busy} onClick={closeSheet}>
          Retour
        </button>
        <button type="button" className="btn cta" disabled={busy || !ready} onClick={() => void savePhoto()}>
          Enregistrer
        </button>
      </nav>
    </footer>
  );
}
