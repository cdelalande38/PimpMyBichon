// Défilement stable du dock. Choisir une option ne déplace jamais le menu : une rangée ne se
// recale que si son choix pressé est entièrement hors de vue (relecture d'une sauvegarde, autre
// véhicule), et seulement en largeur, dans la rangée elle-même. L'ancien `scrollIntoView` faisait
// défiler tous les ancêtres, dont la zone verticale du dock agrandi : choisir une finition y
// ramenait la rangée des couleurs à l'écran, c'est-à-dire en haut du menu.
// La position de chaque niveau (zone verticale du dock, rangées qui défilent) est retenue pendant
// la séance et rendue quand on y revient par « Retour ».

import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** Rangée défilante : amène son choix pressé dans le champ s'il en est entièrement sorti. */
export function useRevealPressed<T extends HTMLElement>(key: unknown): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const row = ref.current;
      const pressed = row?.querySelector<HTMLElement>('[aria-pressed="true"]');
      if (!row || !pressed || row.scrollWidth <= row.clientWidth + 1) return;
      const box = row.getBoundingClientRect();
      const item = pressed.getBoundingClientRect();
      const hidden = item.right <= box.left + 1 || item.left >= box.right - 1;
      if (!hidden) return;
      row.scrollLeft += item.left - box.left - (box.width - item.width) / 2;
    });
    return () => cancelAnimationFrame(frame);
  }, [key]);
  return ref;
}

interface SavedScroll {
  top: number;
  rows: Record<string, number>;
}

const memory = new Map<string, SavedScroll>();

const ROWS = '.chips[aria-label], .tabs[aria-label]';

/**
 * Zone de contenu d'un niveau du dock : retient sa position verticale et celle de ses rangées à
 * chaque défilement, et la rend quand on revient sur ce niveau (clé : section, entrée, profondeur).
 */
export function useLevelScroll(ref: RefObject<HTMLElement | null>, key: string): void {
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const saved = memory.get(key);
    element.scrollTop = saved?.top ?? 0;
    if (!saved) return;
    for (const row of element.querySelectorAll<HTMLElement>(ROWS)) {
      const left = saved.rows[row.getAttribute('aria-label') ?? ''];
      if (left !== undefined) row.scrollLeft = left;
    }
  }, [ref, key]);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const save = () => {
      const rows: Record<string, number> = {};
      for (const row of element.querySelectorAll<HTMLElement>(ROWS)) rows[row.getAttribute('aria-label') ?? ''] = row.scrollLeft;
      memory.set(key, { top: element.scrollTop, rows });
    };
    // Les événements de défilement ne remontent pas : on les prend à la descente.
    element.addEventListener('scroll', save, { capture: true, passive: true });
    return () => element.removeEventListener('scroll', save, { capture: true });
  }, [ref, key]);
}
