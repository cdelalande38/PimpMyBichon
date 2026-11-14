// Panneau bas, construit sur <dialog> : piège du focus, touche Échap et geste retour d'Android
// sont gérés par le navigateur. Le bouton de fermeture reste en bas, sous le pouce.

import { useEffect, useId, useRef, type ReactNode } from 'react';

interface SheetProps {
  open: boolean;
  eyebrow: string;
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Commandes propres au panneau, posées à côté du bouton de fermeture, sous le pouce. */
  actions?: ReactNode;
}

export function Sheet({ open, eyebrow, title, onClose, children, actions }: SheetProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const pressedOnBackdrop = useRef(false);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // Le focus va sur le bouton du bas, sous le pouce, pas sur la zone défilante.
      closeRef.current?.focus({ preventScroll: true });
    } else if (!open && dialog.open) {
      dialog.close();
    }
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
      // Un appui sur le fond assombri ferme le panneau, s'il a commencé sur le fond :
      // relâcher une sélection de texte au-dessus du panneau ne doit pas le fermer.
      onPointerDown={(event) => {
        pressedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressedOnBackdrop.current) onClose();
        pressedOnBackdrop.current = false;
      }}
    >
      {open && (
        <div className="card">
          <div className="card-scroll">
            <p className="eyebrow">{eyebrow}</p>
            <h2 id={titleId}>{title}</h2>
            {children}
          </div>
          <div className="sheet-acts">
            {actions}
            <button ref={closeRef} type="button" className="btn cta" onClick={onClose}>
              Retour à l’atelier
            </button>
          </div>
        </div>
      )}
    </dialog>
  );
}
