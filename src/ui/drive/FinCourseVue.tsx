// Écran de fin d'une course (demande du 17 novembre 2026 : « à la fin on affiche les résultats, les gains
// et ce qu'on a débloqué ») : la vue seule, sans état, pour qu'un test la rende avec un bilan fabriqué
// (tests/unit/courses-fin.test.ts). Le conteneur (FinCourse.tsx) la branche sur le store.
//
// De haut en bas : la médaille, le temps total et le record (ancien, nouveau, écart), le temps de chaque tour
// (meilleur tour marqué) et les chiffres de la course ; puis, dans la suite, les gains, ligne par ligne, et le
// solde ; les hauts faits obtenus et ce qui vient d'être débloqué ; en carrière, le rendez-vous jugé et le
// suivant. En bas, sous le pouce, UN SEUL jeu de boutons (`boutonsDeFin`, retour du 18 novembre 2026 : deux
// retours au garage à l'écran, et rien pour partir sur la course suivante) : trois au plus, le principal en rouge.
// En paysage (fincourse.css), le résultat et les boutons à gauche, toujours visibles ; la suite à droite, qui
// défile seule : aucune moitié d'écran vide, à aucun moment du défilement.
// Le bilan vient de `cloturerCourse` (src/jeu/bilan.ts) : vide, l'écran le dit en clair.
// Format « Drift » (vague V) : le score à la place du temps, le palier de la médaille d'au-dessus, puis le
// meilleur drift et le plus long à la place du record ; le temps passe dans les chiffres de la course.
//
// Les gains ARRIVENT un par un (vague U, 18 novembre 2026) : tant que le défilé tourne, le bloc « Gains » est une
// liste de notifications (prime, médaille, record, chaque haut fait, chaque objet) qui s'ajoutent toutes les
// 0,75 s avec leur son, le total qui monte ; un appui sur l'écran, ou « Tout afficher », passe tout de suite à
// l'écran complet ci-dessous, où tout se relit. « Moins de mouvement » : l'écran complet d'emblée, un seul son.
// Sans la propriété `anime` (un test qui rend la vue seule), l'écran est complet d'emblée et muet.

import { useMemo } from 'react';
import { formatChrono } from '../../drive/depart.ts';
import type { SonInterface } from '../../data/bruitages.ts';
import type { RendezVous } from '../../data/carriere.ts';
import { formatSpec, indulgence, seuilsMedailles, tempsReference } from '../../data/courses.ts';
import { paliersDrift, scoreReference } from '../../data/drift.ts';
import { verdictDe, type VerdictRendezVous } from '../../jeu/carriereCloture.ts';
import type { Bilan, Medaille } from '../../jeu/contrat.ts';
import { AnnonceVocale, ListeNotifications, useDefilement } from '../jeu/NotificationsGain.tsx';
import { FAMILLES_ARTICLE, notificationsDuBilan } from '../jeu/notifications.ts';
import { DriveIcon, type DriveIconName } from './icones.tsx';
import { resumeRendezVous } from '../carriere/FicheRendezVous.tsx';
import { ProchainRendezVous } from '../carriere/ProchainRendezVous.tsx';
import { boutonsDuel, VerdictDuelFin } from './Duel.tsx';

const MEDAILLE_LABEL: Readonly<Record<Medaille, string>> = { or: 'Médaille d’or', argent: 'Médaille d’argent', bronze: 'Médaille de bronze' };

/** « 1 250 $ » (espaces fines insécables du français). */
export function formatDollars(n: number): string {
  return `${Math.round(Number.isFinite(n) ? n : 0).toLocaleString('fr-FR')} $`;
}

/** Écart en secondes, au dixième : « 1,2 s ». */
export function formatEcart(secondes: number): string {
  return `${Math.abs(secondes).toFixed(1).replace('.', ',')} s`;
}

/** La ligne du record : premier temps, record battu (ancien et écart), ou record gardé (écart). */
export function ligneRecord(temps: number, ancien: number | null): { texte: string; record: boolean } {
  if (ancien === null) return { texte: 'Premier temps posé ici dans ce format : c’est ton record.', record: true };
  if (temps < ancien) return { texte: `Nouveau record, ${formatEcart(ancien - temps)} de mieux ! L’ancien : ${formatChrono(ancien * 1000)}.`, record: true };
  if (temps === ancien) return { texte: `Pile ton record : ${formatChrono(ancien * 1000)}.`, record: false };
  return { texte: `Ton record : ${formatChrono(ancien * 1000)}, ${formatEcart(temps - ancien)} plus vite.`, record: false };
}

/** « 12 450 points ». */
export function formatPoints(n: number): string {
  return `${Math.round(Number.isFinite(n) ? n : 0).toLocaleString('fr-FR')} points`;
}

/** Le temps (ou, en drift, le score) à battre pour la médaille d'au-dessus ; `null` avec l'or ou sans référence. */
export function prochaineMedaille(bilan: Bilan): string | null {
  const r = bilan.resultat;
  const visee = r.medaille === null ? 'bronze' : r.medaille === 'bronze' ? 'argent' : r.medaille === 'argent' ? 'or' : null;
  if (r.format === 'drift') {
    const ref = scoreReference(r.carte, r.depart, r.vehicule);
    return ref === null || !visee ? null : `${POUR[visee]} : ${formatPoints(paliersDrift(ref)[visee])}.`;
  }
  const reference = tempsReference(r.carte, r.depart, r.format, r.vehicule);
  if (reference === null) return null;
  const seuils = seuilsMedailles(reference, indulgence(r.carte, r.meteo));
  if (!visee) return null;
  return `${POUR[visee]} : sous ${formatChrono(seuils[visee] * 1000)}.`;
}

const POUR: Readonly<Record<Medaille, string>> = { or: 'Pour l’or', argent: 'Pour l’argent', bronze: 'Pour le bronze' };

/** Un bouton du bas de l'écran de fin. */
export interface BoutonFin {
  acte: 'suivante' | 'rejouer' | 'retenter' | 'garage';
  label: string;
  /** Petite ligne sous le libellé (le rendez-vous suivant, ou « préparer le véhicule »). */
  detail?: string;
  /** Le bouton principal, en rouge : toujours le premier. */
  principal: boolean;
}

/**
 * Les boutons de l'écran de fin, un seul jeu, trois au plus, le principal d'abord :
 * - course libre (ou rendez-vous rejoué une fois la carrière bouclée) : « Rejouer », « Rentrer au garage » ;
 * - rendez-vous réussi : « Course suivante » (le rendez-vous suivant, dit en petit), « Rejouer » (pour le temps
 *   ou la médaille), « Rentrer au garage » pour préparer le véhicule ;
 * - rendez-vous manqué (ou couru hors de ses conditions) : « Retenter », « Rentrer au garage » pour préparer ;
 * - carrière bouclée par cette course : pas de « Course suivante », « Rejouer » et « Rentrer au garage ».
 * Course libre : pas de « Course suivante » (rien n'y fait suite de façon simple et prévisible).
 */
export function boutonsDeFin(v: VerdictRendezVous | null): BoutonFin[] {
  const garage: BoutonFin = { acte: 'garage', label: 'Rentrer au garage', principal: false };
  const preparer: BoutonFin = { ...garage, detail: 'préparer le véhicule' };
  if (!v) return [{ acte: 'rejouer', label: 'Rejouer', principal: true }, garage];
  if (!v.reussi) return [{ acte: 'retenter', label: 'Retenter', principal: true }, preparer];
  if (v.suivant && !v.bouclee) {
    return [
      { acte: 'suivante', label: 'Course suivante', detail: `${v.suivantSaison !== v.saisonNumero ? `Saison ${v.suivantSaison} · rendez-vous` : 'Rendez-vous'} ${v.suivantNumero} · ${resumeRendezVous(v.suivant)}`, principal: true },
      { acte: 'rejouer', label: 'Rejouer', principal: false },
      preparer,
    ];
  }
  return [{ acte: 'rejouer', label: 'Rejouer', principal: true }, garage];
}

const ICONE_ACTE: Readonly<Record<BoutonFin['acte'], DriveIconName>> = { suivante: 'lecture', rejouer: 'repartir', retenter: 'repartir', garage: 'garage' };

export interface FinCourseVueProps {
  bilan: Bilan;
  /** « Rejouer » et « Retenter » : retour sur la ligne, aux feux. */
  onRejouer: () => void;
  onGarage: () => void;
  /** « Course suivante » (carrière, rendez-vous réussi) : part sur le rendez-vous suivant, tout imposé. */
  onCourseSuivante?: (rdv: RendezVous, numero: number, total: number) => void;
  /** Vrai : les gains arrivent un par un, chacun avec son son. Faux ou absent : l'écran complet d'emblée (« moins de mouvement »). */
  anime?: boolean;
  /** Demande un son d'interface (src/audio/sfx/interface.ts) ; absent : aucun son. */
  onSon?: (son: SonInterface) => void;
}

export function FinCourseVue({ bilan, onRejouer, onGarage, onCourseSuivante, anime = false, onSon }: FinCourseVueProps) {
  const r = bilan.resultat;
  const notifications = useMemo(() => notificationsDuBilan(bilan), [bilan]);
  const defilement = useDefilement({ notifications, anime, onSon });
  const defile = !defilement.fini;
  const drift = r.format === 'drift' ? (r.drift ?? { score: 0, meilleur: 0, plusLong: 0, nombre: 0, multMax: 1 }) : null;
  const record = drift
    ? { texte: drift.nombre > 0 ? `Meilleur drift ${formatPoints(drift.meilleur)}, le plus long ${formatEcart(drift.plusLong)}, ×${drift.multMax} au plus.` : 'Aucun drift compté : un coup de frein, braqué, puis le gaz.', record: false }
    : ligneRecord(r.temps, r.ancienRecord);
  const meilleurTour = r.tours.length > 1 ? Math.min(...r.tours) : -1;
  const prochaine = prochaineMedaille(bilan);
  const stats = r.stats;
  const rien = bilan.hautsFaits.length === 0 && bilan.deblocages.length === 0;
  const verdict = verdictDe(bilan);
  // Duel (src/ui/drive/Duel.tsx) : « Revanche » en principal.
  const boutons = boutonsDuel(boutonsDeFin(verdict), bilan);
  const agir = (acte: BoutonFin['acte']) => {
    if (acte === 'garage') onGarage();
    else if (acte === 'suivante') {
      if (verdict?.suivant) onCourseSuivante?.(verdict.suivant, verdict.suivantNumero, verdict.suivantTotal);
    } else onRejouer();
  };
  return (
    <section className="fin-course" aria-labelledby="fin-course-titre" data-medaille={r.medaille ?? 'aucune'}>
      {/* Un appui sur l'écran pendant le défilé : tout de suite l'écran complet. Les boutons du bas restent à eux.
          En paysage, ce conteneur s'efface (display: contents) : le résultat et la suite deviennent deux colonnes. */}
      <div className="fin-course-defile" data-defilement={defile ? 'en-cours' : 'fini'} onClick={defile ? defilement.passer : undefined}>
        <div className="fin-course-bloc fin-course-resultat">
          <header className="fin-course-tete">
            <h2 id="fin-course-titre">Arrivée</h2>
            <span className="fin-course-format">{formatSpec(r.format).label}</span>
          </header>
          <VerdictDuelFin bilan={bilan} />
          <p className="fin-course-medaille" data-medaille={r.medaille ?? 'aucune'}>
            <i aria-hidden="true" />
            {r.medaille ? MEDAILLE_LABEL[r.medaille] : 'Pas de médaille cette fois'}
          </p>
          <p className="fin-course-temps" role="status" aria-label={drift ? `Score ${formatPoints(drift.score)}` : `Temps total ${formatChrono(r.temps * 1000)}`} data-score={drift?.score}>
            {drift ? formatPoints(drift.score) : formatChrono(r.temps * 1000)}
          </p>
          {prochaine && <p className="fin-course-note">{prochaine}</p>}
          <p className="fin-course-record" data-record={record.record || undefined}>
            {record.texte}
          </p>
          <div className="fin-course-chiffres">
            {r.tours.length > 1 && (
              <ol className="fin-course-tours" aria-label="Temps par tour">
                {r.tours.map((t, i) => (
                  <li key={i} data-meilleur={t === meilleurTour || undefined}>
                    <span>Tour {i + 1}</span>
                    <b>{formatChrono(t * 1000)}</b>
                  </li>
                ))}
              </ol>
            )}
            <p className="fin-course-stats">
              {drift && `${formatChrono(r.temps * 1000)} · `}
              {(stats.distance / 1000).toFixed(1).replace('.', ',')} km · {Math.round(stats.vitesseMax)} km/h au plus · {stats.chocs} choc{stats.chocs > 1 ? 's' : ''} · {Math.round(stats.glisse)} m de glisse · NOS ×{stats.nos}
            </p>
          </div>
        </div>

        {/* La suite : les gains, ce qui est débloqué, le rendez-vous de carrière. */}
        <div className="fin-course-suite">
          {defile ? (
            <div className="fin-course-bloc fin-course-notifs" aria-labelledby="fin-course-notifs-titre">
              <h3 id="fin-course-notifs-titre">Gains</h3>
              <ListeNotifications notifications={notifications} revelees={defilement.revelees} passer={defilement.passer} />
            </div>
          ) : (
            <>
              <div className="fin-course-bloc fin-course-gains" aria-labelledby="fin-course-gains-titre">
                <h3 id="fin-course-gains-titre">Gains</h3>
                {bilan.gains.detail.length === 0 ? (
                  <p className="fin-course-vide">Rien de gagné cette fois.</p>
                ) : (
                  <ul className="fin-course-lignes">
                    {bilan.gains.detail.map((ligne, i) => (
                      <li key={i}>
                        <span>{ligne.motif}</span>
                        <b>+ {formatDollars(ligne.dollars)}</b>
                      </li>
                    ))}
                    <li className="fin-course-total">
                      <span>Total</span>
                      <b>+ {formatDollars(bilan.gains.dollars)}</b>
                    </li>
                  </ul>
                )}
                <p className="fin-course-solde">
                  Solde : <b>{formatDollars(bilan.solde)}</b>
                </p>
              </div>

              <div className="fin-course-bloc fin-course-debloque" aria-labelledby="fin-course-debloque-titre">
                <h3 id="fin-course-debloque-titre">Débloqué</h3>
                {rien ? (
                  <p className="fin-course-vide">Rien de nouveau cette fois.</p>
                ) : (
                  <ul className="fin-course-lignes">
                    {bilan.hautsFaits.map((fait) => (
                      <li key={`h-${fait.id}`} className="fin-course-haut-fait">
                        <span>
                          <b>{fait.label}</b>
                          <small>{fait.description}</small>
                        </span>
                        <em>{fait.recompense.dollars ? `Haut fait · + ${formatDollars(fait.recompense.dollars)}` : 'Haut fait'}</em>
                      </li>
                    ))}
                    {bilan.deblocages.map((article) => (
                      <li key={`a-${article.id}`}>
                        <span>
                          <b>{article.label}</b>
                        </span>
                        <em>{FAMILLES_ARTICLE[article.famille] ?? article.famille}</em>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          {/* Sous les gains, défilé comme écran complet : le rendez-vous de carrière jugé et l'annonce du suivant (src/ui/carriere/). */}
          <ProchainRendezVous bilan={bilan} />
          <AnnonceVocale notifications={notifications} actif={!anime} />
        </div>
      </div>
      <div className="fin-course-actes" data-boutons={boutons.length}>
        {boutons.map((b) => (
          <button
            key={b.acte}
            type="button"
            className={b.principal ? 'btn cta fin-course-acte' : 'btn fin-course-acte'}
            data-acte={b.acte}
            aria-label={b.detail ? `${b.label} ${b.detail}` : undefined}
            onClick={() => agir(b.acte)}
          >
            <DriveIcon name={ICONE_ACTE[b.acte]} />
            {b.detail ? (
              <span className="fin-course-acte-texte">
                <b>{b.label}</b>
                <small>{b.detail}</small>
              </span>
            ) : (
              b.label
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
