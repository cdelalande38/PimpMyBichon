// Le duel à l'écran (§ 5.5, jeu) : au menu de la sortie, le format « Duel » à côté des courses puis le choix
// de l'adversaire ; en course, la position (1er ou 2e) et l'écart en secondes ; à l'arrivée, le verdict et
// « Revanche » à la place de « Rejouer ». Les règles sont dans src/drive/adversaire/.
//
// La position vit hors de React, comme le chrono : relue à chaque image (`useBoucleImage`), le texte n'est
// réécrit que s'il change. « Moins de mouvement » : rien n'y bouge, aucune animation.

import { useRef } from 'react';
import { ADVERSAIRES, adversaireParId, NIVEAU_LABEL } from '../../data/adversaires.ts';
import { vehicleById } from '../../data/vehicles.ts';
import { useDuel } from '../../drive/adversaire/choix.ts';
import { verdictDuelDe } from '../../drive/adversaire/cloture.ts';
import { liveDuel } from '../../drive/adversaire/course.ts';
import { enCourse } from '../../drive/depart.ts';
import type { Bilan } from '../../jeu/contrat.ts';
import { liveDepart, useDrive } from '../../state/drive.ts';
import { useBoucleImage } from './CompteTours.tsx';
import type { BoutonFin } from './FinCourseVue.tsx';
import './duel.css';

/** La petite ligne du format au menu, et ce que redit « Sortir ». */
export const AIDE_DUEL = 'Un tour contre un adversaire, dollars en plus';

/** « 1,2 s » au dixième. */
function ecartTexte(s: number): string {
  return `${Math.max(0, s).toFixed(1).replace('.', ',')} s`;
}

/** Le duel est-il choisi au menu (et possible : des adversaires, pas en carrière) ? */
export function useDuelChoisi(): boolean {
  const actif = useDuel((state) => state.actif);
  const carriere = useDrive((state) => state.rendezVous !== null);
  return actif && !carriere && ADVERSAIRES.length > 0;
}

/** La puce « Duel » de la rangée des formats ; un appui choisit le duel en un tour. */
export function PuceDuel() {
  const choisi = useDuelChoisi();
  const setFormat = useDrive((state) => state.setFormat);
  if (ADVERSAIRES.length === 0) return null;
  return (
    <button
      type="button"
      className="chip"
      data-format="duel"
      aria-pressed={choisi}
      onClick={() => {
        setFormat('tour1');
        useDuel.getState().setActif(true);
      }}
    >
      <b>Duel</b>
      <small>{AIDE_DUEL}</small>
    </button>
  );
}

/** Une fois « Duel » choisi : l'adversaire, un par niveau (son nom, son niveau, son véhicule, sa phrase). */
export function ChoixAdversaire() {
  const choisi = useDuelChoisi();
  const adversaire = useDuel((state) => state.adversaire);
  const choisir = useDuel((state) => state.choisir);
  if (!choisi) return null;
  return (
    <div className="chips duel-adversaires" role="group" aria-label="Adversaire">
      {ADVERSAIRES.map((a) => (
        <button key={a.id} type="button" className="chip duel-adversaire" data-adversaire={a.id} data-niveau={a.niveau} aria-pressed={a.id === adversaire} onClick={() => choisir(a.id)}>
          <i aria-hidden="true" style={{ background: a.couleur }} />
          <b>{a.nom}</b>
          <small>
            {NIVEAU_LABEL[a.niveau]} · {vehicleById(a.vehicule)?.name ?? a.vehicule}
          </small>
          <small className="duel-phrase">{a.phrase}</small>
        </button>
      ))}
    </div>
  );
}

/** Ce que « Sortir » redit en duel. */
export function reditDuel(): string | null {
  const choix = useDuel.getState();
  const a = adversaireParId(choix.adversaire);
  return choix.actif && a ? `Duel contre ${a.nom} : un tour, dollars en plus` : null;
}

/** En course : la position et l'écart, sous le chrono. */
export function PositionDuel() {
  const root = useRef<HTMLDivElement>(null);
  const place = useRef<HTMLElement>(null);
  const ecart = useRef<HTMLSpanElement>(null);
  const vu = useRef({ visible: '', position: 0, ecart: '' });
  useBoucleImage(() => {
    const el = root.current;
    const duel = liveDuel.current;
    const depart = liveDepart.current;
    if (!el) return;
    const montre = duel !== null && duel.enPiste && depart !== null && enCourse(depart) && (depart.phase === 'parti' || depart.phase === 'arrive') && duel.duel.lance;
    const visible = montre ? 'oui' : 'non';
    if (vu.current.visible !== visible) {
      vu.current.visible = visible;
      el.dataset.visible = visible;
    }
    if (!montre || !duel) return;
    const d = duel.duel;
    if (d.position !== vu.current.position && place.current) {
      vu.current.position = d.position;
      place.current.textContent = d.position === 1 ? '1er' : '2e';
      el.dataset.position = String(d.position);
    }
    const texte = `${ecartTexte(d.ecart)} ${d.position === 1 ? 'd’avance' : 'de retard'}`;
    if (texte !== vu.current.ecart && ecart.current) {
      vu.current.ecart = texte;
      ecart.current.textContent = texte;
    }
  });
  const a = liveDuel.current?.adversaire;
  return (
    <div className="drive-feux-place duel-place">
      <div ref={root} className="duel-position" data-visible="non" role="status" aria-live="off" aria-label="Position dans le duel">
        <b ref={place}>1er</b>
        <span ref={ecart} />
        {a && <small>contre {a.nom}</small>}
      </div>
    </div>
  );
}

/** À l'écran de fin d'un duel : gagné ou perdu, de combien, contre qui. */
export function VerdictDuelFin({ bilan }: { bilan: Bilan }) {
  const v = verdictDuelDe(bilan);
  if (!v) return null;
  const texte = v.gagne ? `Tu bats ${v.adversaire.nom} de ${ecartTexte(v.ecart)}.` : `${v.adversaire.nom} passe la ligne ${ecartTexte(v.ecart)} avant toi.`;
  return (
    <p className="duel-verdict" data-duel={v.gagne ? 'gagne' : 'perdu'} role="status">
      <b>{v.gagne ? 'Duel gagné' : 'Duel perdu'}</b>
      <span>{texte}</span>
    </p>
  );
}

/** Les boutons de fin d'un duel : « Revanche » à la place de « Rejouer », toujours en principal. */
export function boutonsDuel(boutons: BoutonFin[], bilan: Bilan): BoutonFin[] {
  if (!verdictDuelDe(bilan)) return boutons;
  const autres = boutons.filter((b) => b.acte !== 'rejouer' && b.acte !== 'retenter' && b.acte !== 'suivante');
  return [{ acte: 'rejouer', label: 'Revanche', principal: true }, ...autres.map((b) => ({ ...b, principal: false }))];
}
