// Le drift en cours, à l'écran (format « Drift », vague V ; demande du 18 novembre 2026 : « Les drift donnent
// des points ») : pendant la glisse, les points du drift en cours et le multiplicateur, en gros ; dessous, le
// score. Le drift fini s'affiche « + 1 240 » un instant ; perdu (bord, tête-à-queue), « Perdu » ; sous
// `POINTS_DRIFT.affichage` points, rien (un drift de 2 points clignotait). Jusqu'au premier drift compté, une
// ligne dit le geste (`AIDE_DRIFT`), à la main seulement. Au milieu,
// sous le compte-tours en portrait et sous le chrono en paysage : la route et le véhicule restent dégagés.
// Écrit à chaque image par la boucle commune (aucun rendu React par image), d'après le score que tient le
// suivi de la course (src/drive/course.ts, `driftEnDirect`). « Moins de mouvement » : les chiffres seulement.

import { useRef } from 'react';
import { driftEnDirect } from '../../drive/course.ts';
import { AIDE_DRIFT, POINTS_DRIFT } from '../../data/drift.ts';
import { pointsEnCours } from '../../jeu/drift.ts';
import { useDrive } from '../../state/drive.ts';
import { useBoucleImage } from './CompteTours.tsx';
import './drift.css';

/** Durée de l'annonce d'un drift fini ou perdu (ms) ; « Perdu » se lit au moins `PERDU_MS`, même si un drift repart. */
const ANNONCE_MS = 1400;
const PERDU_MS = 700;

const nombre = (n: number) => Math.round(n).toLocaleString('fr-FR');

function Compteur() {
  const root = useRef<HTMLDivElement>(null);
  const points = useRef<HTMLElement>(null);
  const mult = useRef<HTMLElement>(null);
  const total = useRef<HTMLElement>(null);
  const vu = useRef({ etat: '', points: -1, mult: -1, total: -1, fins: 0, depuis: 0, aide: '', changements: 0 });

  useBoucleImage(() => {
    const e = driftEnDirect.current;
    const el = root.current;
    if (!e || !el || !points.current || !mult.current || !total.current) return;
    const v = vu.current;
    const now = performance.now();
    if (e.fins !== v.fins) {
      v.fins = e.fins;
      v.depuis = now;
    }
    const seuil = POINTS_DRIFT.affichage;
    const annonce = e.fins > 0 && now - v.depuis < ANNONCE_MS && Math.abs(e.dernier) >= seuil;
    const perduLu = annonce && e.dernier < 0 && now - v.depuis < PERDU_MS;
    const etat = e.cote !== 0 && pointsEnCours(e) >= seuil && !perduLu ? 'glisse' : annonce ? (e.dernier < 0 ? 'perdu' : 'compte') : 'non';
    const drive = useDrive.getState();
    const aide = e.nombre === 0 && !drive.input.auto && !drive.telemetry.finished ? 'oui' : 'non';
    if (aide !== v.aide) v.aide = el.dataset.aide = aide;
    const pts = etat === 'glisse' ? pointsEnCours(e) : etat === 'compte' ? e.dernier : 0;
    // Le multiplicateur reste affiché tant que l'enchaînement est possible.
    const m = e.cote !== 0 || e.depuis <= POINTS_DRIFT.enchainement ? e.mult : 1;
    if (etat !== v.etat) {
      v.etat = el.dataset.etat = etat;
      v.points = -1;
      // Pour les parcours : le compteur ne doit pas clignoter.
      el.dataset.changements = String((v.changements += 1));
    }
    if (pts !== v.points) {
      v.points = pts;
      el.dataset.points = String(pts);
      points.current.textContent = etat === 'perdu' ? 'Perdu' : etat === 'compte' ? `+ ${nombre(pts)}` : nombre(pts);
    }
    if (m !== v.mult) {
      v.mult = m;
      mult.current.textContent = m > 1 ? `×${m}` : '';
    }
    if (e.total !== v.total) {
      v.total = e.total;
      el.dataset.score = String(e.total);
      total.current.textContent = nombre(e.total);
    }
  });

  return (
    <div ref={root} className="drive-drift" data-etat="non" data-points="0" data-score="0" data-aide="non" data-changements="0" aria-hidden="true">
      <p className="drive-drift-en-cours">
        <b ref={points} className="drive-drift-points" />
        <span ref={mult} className="drive-drift-mult" />
      </p>
      <p className="drive-drift-score">
        Score <b ref={total}>0</b>
      </p>
      <p className="drive-drift-aide">{AIDE_DRIFT}</p>
    </div>
  );
}

/** Le compteur, dans le format « Drift » seulement. */
export function DriftCompteur() {
  const drift = useDrive((state) => state.format === 'drift');
  return drift ? <Compteur /> : null;
}
