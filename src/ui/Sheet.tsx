// Panneau bas, construit sur <dialog> : piège du focus, touche Échap et geste retour d'Android
// sont gérés par le navigateur. Le bouton de fermeture reste en bas, sous le pouce.

import { useEffect, useId, useRef, type ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  closeLabel?: string;
}

export function Sheet({
  open,
  eyebrow,
  title,
  onClose,
  children,
  closeLabel = 'Retour à l’atelier',
}: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    else if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="sheet"
      aria-labelledby={titleId}
      // Fermeture par Échap ou par le geste retour : on remet l'adresse d'accord avec l'écran.
      onClose={() => {
        if (open) onClose();
      }}
      // Un appui sur le fond assombri ferme le panneau.
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open && (
        <div className="card">
          <div className="card-scroll">
            <p className="eyebrow">{eyebrow}</p>
            <h2 id={titleId}>{title}</h2>
            {children}
          </div>
          <button type="button" className="btn cta" onClick={onClose}>
            {closeLabel}
          </button>
        </div>
      )}
    </dialog>
  );
}
