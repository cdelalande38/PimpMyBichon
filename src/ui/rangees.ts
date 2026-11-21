// Rangées qui défilent de côté (.chips, .tabs ; audit des menus, B2) : sur un ordinateur, la molette les
// fait défiler et, à la souris, deux flèches paraissent aux bords de la rangée survolée. Rien au toucher.
// Le fondu qui dit « il y a de la suite » est du CSS pur (src/app/styles.css, B1).
//
// Une seule paire de flèches, posée par-dessus la rangée survolée : un panneau (<dialog> modal) vit dans la
// couche supérieure du navigateur, la paire s'y loge quand la rangée y est, sinon dans la page.

const RANGEE = '.chips, .tabs';
const SOURIS = '(hover: hover) and (pointer: fine)';
const CHEVRON = { gauche: 'M15 6l-6 6 6 6', droite: 'M9 6l6 6-6 6' } as const;

/** Vrai si la rangée déborde de sa boîte (une rangée qui passe à la ligne ou qui tient n'a rien à faire défiler). */
function defile(rangee: HTMLElement): boolean {
  return rangee.scrollWidth > rangee.clientWidth + 1;
}

/** Place restante de chaque côté, en pixels. */
export function resteDeChaqueCote(rangee: Pick<HTMLElement, 'scrollLeft' | 'scrollWidth' | 'clientWidth'>): { gauche: number; droite: number } {
  return { gauche: rangee.scrollLeft, droite: rangee.scrollWidth - rangee.clientWidth - rangee.scrollLeft };
}

/** Migre le défilement vertical de la molette vers l'horizontal ; faux quand la rangée est au bout dans ce sens (la page reprend la main). */
export function pasHorizontal(rangee: Pick<HTMLElement, 'scrollLeft' | 'scrollWidth' | 'clientWidth'>, deltaX: number, deltaY: number): number {
  if (Math.abs(deltaX) >= Math.abs(deltaY)) return 0;
  const reste = resteDeChaqueCote(rangee);
  return deltaY < 0 ? (reste.gauche > 1 ? deltaY : 0) : reste.droite > 1 ? deltaY : 0;
}

function fleche(sens: keyof typeof CHEVRON): HTMLButtonElement {
  const bouton = document.createElement('button');
  bouton.type = 'button';
  bouton.className = 'rangee-fleche';
  bouton.dataset.sens = sens;
  bouton.tabIndex = -1;
  bouton.setAttribute('aria-hidden', 'true');
  bouton.hidden = true;
  bouton.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${CHEVRON[sens]}"/></svg>`;
  return bouton;
}

/** Branche la molette et les flèches sur toute la page ; rend de quoi les débrancher. */
export function brancherRangees(): () => void {
  const souris = window.matchMedia(SOURIS);
  const reduit = window.matchMedia('(prefers-reduced-motion: reduce)');
  const conteneur = document.createElement('div');
  conteneur.className = 'rangee-fleches';
  const gauche = fleche('gauche');
  const droite = fleche('droite');
  conteneur.append(gauche, droite);
  let rangee: HTMLElement | null = null;

  const cacher = () => {
    rangee = null;
    gauche.hidden = true;
    droite.hidden = true;
  };

  const placer = () => {
    if (!rangee?.isConnected || !defile(rangee)) {
      cacher();
      return;
    }
    const boite = rangee.getBoundingClientRect();
    const reste = resteDeChaqueCote(rangee);
    // Dans le panneau si la rangée y est (couche supérieure), sinon dans la page.
    const hote = rangee.closest('dialog') ?? document.body;
    if (conteneur.parentElement !== hote) hote.append(conteneur);
    const cote = (bouton: HTMLButtonElement, visible: boolean, gauchePx: number) => {
      bouton.hidden = !visible;
      bouton.style.left = `${Math.round(gauchePx)}px`;
      bouton.style.top = `${Math.round(boite.top)}px`;
      bouton.style.height = `${Math.round(boite.height)}px`;
    };
    cote(gauche, reste.gauche > 1, Math.max(boite.left, 0));
    cote(droite, reste.droite > 1, Math.min(boite.right, window.innerWidth) - gauche.offsetWidth);
  };

  const sur = (event: Event): HTMLElement | null => (event.target instanceof Element ? event.target.closest<HTMLElement>(RANGEE) : null);

  const onWheel = (event: WheelEvent) => {
    if (event.ctrlKey) return;
    const cible = sur(event);
    if (!cible || !defile(cible)) return;
    const unite = event.deltaMode === 1 ? 40 : event.deltaMode === 2 ? cible.clientWidth : 1;
    const pas = pasHorizontal(cible, event.deltaX, event.deltaY) * unite;
    if (pas === 0) return;
    event.preventDefault();
    cible.scrollLeft += pas;
    if (cible === rangee) placer();
  };

  const onMove = (event: PointerEvent) => {
    if (event.pointerType !== 'mouse' || !souris.matches) {
      if (rangee) cacher();
      return;
    }
    if (event.target instanceof Element && event.target.closest('.rangee-fleches')) return;
    const cible = sur(event);
    // Même rangée : on replace quand même, son contenu a pu changer sous la souris.
    rangee = cible;
    placer();
  };

  const onClick = (event: MouseEvent) => {
    const bouton = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.rangee-fleche') : null;
    if (!bouton || !rangee) return;
    const sens = bouton.dataset.sens === 'gauche' ? -1 : 1;
    rangee.scrollBy({ left: sens * rangee.clientWidth * 0.8, behavior: reduit.matches ? 'auto' : 'smooth' });
  };

  // Les flèches suivent le défilement, que ce soit la molette, un glissé ou un clic sur une flèche.
  const onScroll = (event: Event) => {
    if (event.target === rangee) placer();
  };

  document.addEventListener('wheel', onWheel, { passive: false });
  document.addEventListener('pointermove', onMove);
  document.addEventListener('click', onClick);
  document.addEventListener('scroll', onScroll, true);
  window.addEventListener('resize', placer);
  document.documentElement.addEventListener('mouseleave', cacher);
  return () => {
    document.removeEventListener('wheel', onWheel);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('click', onClick);
    document.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('resize', placer);
    document.documentElement.removeEventListener('mouseleave', cacher);
    conteneur.remove();
  };
}
