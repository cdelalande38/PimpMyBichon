// Les notifications de gain (vague U, 18 novembre 2026) : à la fin d'une course, chaque ligne de gain (prime,
// médaille, record, chaque haut fait, chaque objet débloqué) arrive à son tour, avec son effet sonore ; un
// haut fait obtenu hors course (le premier achat) s'annonce de la même façon, au garage. Ce fichier est pur :
// il fabrique la liste à partir d'un bilan (src/jeu/contrat.ts) et dit le rythme. L'affichage est dans
// src/ui/jeu/NotificationsGain.tsx, le son dans src/audio/sfx/interface.ts. Aucun montant ici : tout vient
// du bilan (src/data/economie.ts, src/data/hautsFaits.ts).

import type { SonInterface } from '../../data/bruitages.ts';
import { MOTIFS_GAIN } from '../../data/economie.ts';
import type { Article, Bilan, FamilleArticle, HautFait, Medaille } from '../../jeu/contrat.ts';

/** Ce que la notification raconte : de l'argent seul, une médaille, un record, un haut fait, un objet. */
export type GenreNotification = 'dollars' | 'medaille' | 'record' | 'haut-fait' | 'objet';

export interface NotificationGain {
  /** Stable et unique dans une liste (clé d'affichage). */
  id: string;
  genre: GenreNotification;
  /** Le titre, en clair : « Course d'un tour finie », « Premier tour de piste », « Flammes bleues ». */
  titre: string;
  /** Une ligne de plus : ce qu'il fallait faire pour un haut fait, la famille d'un objet. */
  detail?: string;
  /** Ce que la notification rapporte, en dollars ; 0 pour un objet. */
  dollars: number;
  /** Pour une médaille : sa couleur (le dessin). */
  medaille?: Medaille;
  /** Le son qui l'accompagne. */
  son: SonInterface;
}

/** Rythme du défilé, en millisecondes : le premier gain, puis un toutes les 0,75 s (0,6 à 0,9 s demandées). */
export const DELAI_PREMIERE_NOTIFICATION = 600;
export const CADENCE_NOTIFICATIONS = 750;
/** Après la dernière notification, le temps de la lire avant de passer à l'écran complet. */
export const MAINTIEN_FINAL = 1400;
/** Au garage : la pile reste à l'écran ce temps après la dernière notification. */
export const MAINTIEN_GARAGE = 3500;

export const FAMILLES_ARTICLE: Readonly<Record<FamilleArticle, string>> = {
  sticker: 'Sticker',
  pack: 'Pack',
  entree: 'Au menu',
  piece: 'Pièce',
  carte: 'Carte',
};

const MEDAILLES = Object.entries(MOTIFS_GAIN.medaille) as [Medaille, string][];

/** Son d'une notification : `dollars` pour de l'argent seul, `gain` pour tout le reste. */
export function sonDe(genre: GenreNotification): SonInterface {
  return genre === 'dollars' ? 'dollars' : 'gain';
}

/** Les hauts faits obtenus (et les objets qu'ils offrent), en notifications. */
export function notificationsDeHautsFaits(hautsFaits: readonly HautFait[], deblocages: readonly Article[] = []): NotificationGain[] {
  const liste: NotificationGain[] = [];
  for (const fait of hautsFaits) {
    liste.push({ id: `haut-fait-${fait.id}`, genre: 'haut-fait', titre: fait.label, detail: fait.description, dollars: Math.max(0, Math.floor(fait.recompense.dollars ?? 0)), son: sonDe('haut-fait') });
  }
  for (const article of deblocages) {
    liste.push({ id: `objet-${article.id}`, genre: 'objet', titre: article.label, detail: FAMILLES_ARTICLE[article.famille] ?? article.famille, dollars: 0, son: sonDe('objet') });
  }
  return liste;
}

/**
 * Les notifications d'une course finie, dans l'ordre de l'écran de fin : chaque ligne de gain (la prime de
 * la course, la médaille, le record, le tour propre, la météo), puis chaque haut fait, puis chaque objet.
 * Un bilan sans gain ni haut fait (économie en erreur) n'en donne aucune.
 */
export function notificationsDuBilan(bilan: Bilan): NotificationGain[] {
  const liste: NotificationGain[] = bilan.gains.detail.map((ligne, i): NotificationGain => {
    const medaille = MEDAILLES.find(([, motif]) => motif === ligne.motif)?.[0];
    const genre: GenreNotification = medaille ? 'medaille' : ligne.motif === MOTIFS_GAIN.record ? 'record' : 'dollars';
    return { id: `gain-${i}`, genre, titre: ligne.motif, dollars: ligne.dollars, ...(medaille ? { medaille } : {}), son: sonDe(genre) };
  });
  return [...liste, ...notificationsDeHautsFaits(bilan.hautsFaits, bilan.deblocages)];
}

/** Ce que les `n` premières notifications ont rapporté, en dollars : le total qui monte à mesure. */
export function totalApres(notifications: readonly NotificationGain[], n: number): number {
  let total = 0;
  for (let i = 0; i < Math.min(n, notifications.length); i += 1) total += (notifications[i] as NotificationGain).dollars;
  return total;
}

/** Le son d'un lot entier quand il n'y en a qu'un (« moins de mouvement ») : `gain` s'il y a plus que de l'argent. */
export function sonDuLot(notifications: readonly NotificationGain[]): SonInterface | null {
  if (notifications.length === 0) return null;
  return notifications.some((n) => n.son === 'gain') ? 'gain' : 'dollars';
}

const dollars = (n: number) => `${Math.round(n).toLocaleString('fr-FR')} dollars`;

/** Une notification, dite en une phrase pour un lecteur d'écran. */
export function phraseNotification(n: NotificationGain): string {
  if (n.genre === 'objet') return `Objet débloqué : ${n.titre}.`;
  const prefixe = n.genre === 'haut-fait' ? 'Haut fait : ' : '';
  return n.dollars > 0 ? `${prefixe}${n.titre}, plus ${dollars(n.dollars)}.` : `${prefixe}${n.titre}.`;
}

/** Le lot entier en une phrase, pour la région vocale de « moins de mouvement » (rien n'y est animé). */
export function phraseLot(notifications: readonly NotificationGain[]): string {
  if (notifications.length === 0) return '';
  const total = totalApres(notifications, notifications.length);
  const tete = `${notifications.length} gain${notifications.length > 1 ? 's' : ''}${total > 0 ? `, plus ${dollars(total)} en tout` : ''}.`;
  return [tete, ...notifications.map(phraseNotification)].join(' ');
}
