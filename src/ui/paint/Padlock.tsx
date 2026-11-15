// Cadenas de l'onglet « Peinture », dessiné pour l'atelier : fermé, la zone suit la carrosserie ;
// ouvert, elle a sa propre peinture. Trait seul (couleur du texte), environ 18 px à l'écran.

export function Padlock({ open, className = 'paint-padlock' }: { open: boolean; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false" data-cadenas={open ? 'ouvert' : 'ferme'}>
      {/* Anse : refermée dans le corps, ou levée et pivotée vers la droite. */}
      <path d={open ? 'M8 11V7.5a4 4 0 0 1 7.6-1.75' : 'M8 11V7.5a4 4 0 0 1 8 0V11'} />
      <rect x="5" y="11" width="14" height="10" rx="2.5" />
      <path d="M12 15v2.5" />
    </svg>
  );
}
