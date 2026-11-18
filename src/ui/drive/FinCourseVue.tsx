// Écran de fin d'une course (demande du 17 novembre 2026 : « à la fin on affiche les résultats, les gains
// et ce qu'on a débloqué ») : la vue seule, sans état, pour qu'un test la rende avec un bilan fabriqué
// (tests/unit/courses-fin.test.ts). Le conteneur (FinCourse.tsx) la branche sur le store.
//
// De haut en bas : la médaille et le temps total ; le temps de chaque tour (meilleur tour marqué) ; le
// record (ancien, nouveau, écart) ; les gains, ligne par ligne, et le solde ; les hauts faits obtenus et
// ce qui vient d'être débloqué ; « Rejouer » et « Rentrer au garage », collés en bas sous le pouce.
// Le bilan vient de `cloturerCourse` (src/jeu/bilan.ts) : vide, l'écran le dit en clair.

import { formatChrono } from '../../drive/depart.ts';
import { formatSpec, indulgence, seuilsMedailles, tempsReference } from '../../data/courses.ts';
import type { Bilan, FamilleArticle, Medaille } from '../../jeu/contrat.ts';
import { DriveIcon } from './icones.tsx';
import { ProchainRendezVous } from '../carriere/ProchainRendezVous.tsx';

const MEDAILLE_LABEL: Readonly<Record<Medaille, string>> = { or: 'Médaille d’or', argent: 'Médaille d’argent', bronze: 'Médaille de bronze' };

const FAMILLES: Readonly<Record<FamilleArticle, string>> = {
  sticker: 'Sticker',
  pack: 'Pack',
  entree: 'Au menu',
  piece: 'Pièce',
  carte: 'Carte',
};

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

/** Le temps à battre pour la médaille d'au-dessus ; `null` avec l'or ou sans référence. */
export function prochaineMedaille(bilan: Bilan): string | null {
  const r = bilan.resultat;
  const reference = tempsReference(r.carte, r.depart, r.format, r.vehicule);
  if (reference === null) return null;
  const seuils = seuilsMedailles(reference, indulgence(r.carte, r.meteo));
  const visee = r.medaille === null ? 'bronze' : r.medaille === 'bronze' ? 'argent' : r.medaille === 'argent' ? 'or' : null;
  if (!visee) return null;
  return `${POUR[visee]} : sous ${formatChrono(seuils[visee] * 1000)}.`;
}

const POUR: Readonly<Record<Medaille, string>> = { or: 'Pour l’or', argent: 'Pour l’argent', bronze: 'Pour le bronze' };

export interface FinCourseVueProps {
  bilan: Bilan;
  onRejouer: () => void;
  onGarage: () => void;
}

export function FinCourseVue({ bilan, onRejouer, onGarage }: FinCourseVueProps) {
  const r = bilan.resultat;
  const record = ligneRecord(r.temps, r.ancienRecord);
  const meilleurTour = r.tours.length > 1 ? Math.min(...r.tours) : -1;
  const prochaine = prochaineMedaille(bilan);
  const stats = r.stats;
  const rien = bilan.hautsFaits.length === 0 && bilan.deblocages.length === 0;
  return (
    <section className="fin-course" aria-labelledby="fin-course-titre" data-medaille={r.medaille ?? 'aucune'}>
      <div className="fin-course-defile">
        <div className="fin-course-bloc fin-course-resultat">
          <header className="fin-course-tete">
            <h2 id="fin-course-titre">Arrivée</h2>
            <span className="fin-course-format">{formatSpec(r.format).label}</span>
          </header>
          <p className="fin-course-medaille" data-medaille={r.medaille ?? 'aucune'}>
            <i aria-hidden="true" />
            {r.medaille ? MEDAILLE_LABEL[r.medaille] : 'Pas de médaille cette fois'}
          </p>
          <p className="fin-course-temps" role="status" aria-label={`Temps total ${formatChrono(r.temps * 1000)}`}>
            {formatChrono(r.temps * 1000)}
          </p>
          {prochaine && <p className="fin-course-note">{prochaine}</p>}
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
          <p className="fin-course-record" data-record={record.record || undefined}>
            {record.texte}
          </p>
          <p className="fin-course-stats">
            {(stats.distance / 1000).toFixed(1).replace('.', ',')} km · {Math.round(stats.vitesseMax)} km/h au plus · {stats.chocs} choc{stats.chocs > 1 ? 's' : ''} · {Math.round(stats.glisse)} m de glisse · NOS ×{stats.nos}
          </p>
        </div>

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

        <ProchainRendezVous bilan={bilan} />

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
                  <em>{FAMILLES[article.famille] ?? article.famille}</em>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="fin-course-actes">
        <button type="button" className="btn cta" onClick={onRejouer}>
          <DriveIcon name="repartir" />
          Rejouer
        </button>
        <button type="button" className="btn drive-home" onClick={onGarage}>
          <DriveIcon name="garage" />
          Rentrer au garage
        </button>
      </div>
    </section>
  );
}
