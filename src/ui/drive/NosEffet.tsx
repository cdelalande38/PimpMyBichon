// NOS à l'écran (src/data/nos.ts) : pendant la poussée, les bords de l'image se teintent de bleu et
// s'assombrissent, et des traits de vitesse fins filent du point de fuite vers les bords. Sous la
// scène et l'interface rien n'est dessiné hors poussée (`hidden` : les animations s'arrêtent). Lu à
// chaque image sur `liveNos`, sans rendu React ; réécrit seulement quand la valeur change d'un cran.
// « Moins de mouvement » : la teinte discrète seulement (drive.css coupe aussi les traits).
// L'élément publie `data-nos-effet` (« oui » tant que l'effet est posé) pour les parcours.

import { useRef, type CSSProperties } from 'react';
import { liveNos, NOS_SEUIL } from '../../data/nos.ts';
import { useBoucleImage } from './CompteTours.tsx';

/** Angles des traits (°) autour du point de fuite et leur décalage (s) : fixes, pas de hasard. */
const TRAITS: readonly (readonly [number, number])[] = [
  [-172, 0],
  [-150, 0.21],
  [-128, 0.09],
  [-104, 0.3],
  [-58, 0.15],
  [-34, 0.03],
  [-12, 0.25],
  [8, 0.12],
  [30, 0.33],
  [52, 0.06],
  [128, 0.18],
  [150, 0.27],
  [170, 0.08],
];

/** Crans de réécriture : 1/40 de la teinte ou des traits. */
const CRAN = 40;

export function NosEffet() {
  const ref = useRef<HTMLDivElement>(null);
  const shown = useRef({ teinte: -1, traits: -1, pose: false });
  useBoucleImage(() => {
    const el = ref.current;
    if (!el) return;
    const s = shown.current;
    const pose = liveNos.teinte > NOS_SEUIL;
    if (pose !== s.pose) {
      s.pose = pose;
      el.hidden = !pose;
      el.dataset.nosEffet = pose ? 'oui' : 'non';
    }
    if (!pose) return;
    const teinte = Math.round(liveNos.teinte * CRAN);
    if (teinte !== s.teinte) el.style.setProperty('--nos-teinte', String((s.teinte = teinte) / CRAN));
    const traits = Math.round(liveNos.traits * CRAN);
    if (traits !== s.traits) el.style.setProperty('--nos-traits', String((s.traits = traits) / CRAN));
  });
  return (
    <div ref={ref} className="drive-nos-effet" aria-hidden="true" data-nos-effet="non" hidden>
      <i className="drive-nos-teinte" />
      <span className="drive-nos-traits">
        {TRAITS.map(([angle, decalage]) => (
          <i key={angle} style={{ '--a': `${angle}deg`, animationDelay: `-${decalage}s` } as CSSProperties} />
        ))}
      </span>
    </div>
  );
}
