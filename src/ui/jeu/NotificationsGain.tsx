// Les notifications de gain, en composants partagés (vague U, 18 novembre 2026) : la carte d'une notification
// (son dessin, son titre, ce qu'elle rapporte), le défilé qui les fait arriver une à une avec leur son
// (`useDefilement`), la liste que montre l'écran de fin d'une course (src/ui/drive/FinCourseVue.tsx) et la
// pile que montre le garage pour un haut fait gagné hors course (src/ui/jeu/AnnoncesJeu.tsx). La liste des
// notifications et le rythme viennent de ./notifications.ts (pur) ; les sons de src/audio/sfx/interface.ts.
//
// - Avec mouvement : une notification toutes les 0,75 s, le total qui monte ; un appui (ou « Tout afficher »)
//   passe tout de suite à l'écran complet, où tout se relit. Rien n'est perdu si l'on a manqué une carte.
// - « Moins de mouvement » : tout est là d'emblée, sans animation, avec un seul son et une seule phrase
//   dite par la région vocale (`role="status"`, polie).
// - Lecteur d'écran, avec mouvement : la liste est un journal (`role="log"`, poli) : chaque carte ajoutée est
//   annoncée une fois, le total qui bouge est caché (`aria-hidden`) pour ne pas noyer l'annonce.

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SonInterface } from '../../data/bruitages.ts';
import { dollars } from './libelles.ts';
import {
  CADENCE_NOTIFICATIONS,
  DELAI_PREMIERE_NOTIFICATION,
  MAINTIEN_FINAL,
  phraseLot,
  sonDuLot,
  totalApres,
  type GenreNotification,
  type NotificationGain,
} from './notifications.ts';
import './notifications.css';

export interface DefilementOptions {
  notifications: readonly NotificationGain[];
  /** Vrai : les cartes arrivent une à une ; faux (« moins de mouvement ») : tout est là d'emblée, un seul son. */
  anime: boolean;
  /** Demande un son d'interface (src/audio/sfx/interface.ts) ; absent : aucun son. */
  onSon?: (son: SonInterface) => void;
  delaiInitial?: number;
  cadence?: number;
  /** Après la dernière carte, le temps de la lire avant que `fini` passe à vrai. */
  maintien?: number;
}

export interface Defilement {
  /** Nombre de cartes arrivées. */
  revelees: number;
  /** Tout est arrivé et lu : l'écran complet prend la place. */
  fini: boolean;
  /** Passe tout de suite à la fin, sans autre son. */
  passer: () => void;
}

/** Fait arriver les notifications une à une, à leur rythme, avec le son de chacune ; ou d'un coup avec un seul son. */
export function useDefilement({ notifications, anime, onSon, delaiInitial = DELAI_PREMIERE_NOTIFICATION, cadence = CADENCE_NOTIFICATIONS, maintien = MAINTIEN_FINAL }: DefilementOptions): Defilement {
  const total = notifications.length;
  const [etat, setEtat] = useState(() => ({ revelees: anime ? 0 : total, fini: !anime || total === 0 }));
  // Le son demandé ne relance rien : la fonction passée peut changer à chaque rendu.
  const son = useRef(onSon);
  useEffect(() => {
    son.current = onSon;
  });
  const unSeulSon = useRef(false);

  // Moins de mouvement : tout est affiché, un seul son pour le lot (une fois, même si l'effet se rejoue).
  useEffect(() => {
    if (anime || total === 0 || unSeulSon.current) return;
    unSeulSon.current = true;
    const lot = sonDuLot(notifications);
    if (lot) son.current?.(lot);
  }, [anime, notifications, total]);

  // Avec mouvement : la prochaine carte, puis la fin ; chaque carte joue son son en arrivant.
  const { revelees, fini } = etat;
  useEffect(() => {
    if (!anime || fini) return;
    if (revelees >= total) {
      const fin = setTimeout(() => setEtat((e) => ({ ...e, fini: true })), maintien);
      return () => clearTimeout(fin);
    }
    const prochaine = setTimeout(
      () => {
        setEtat((e) => ({ ...e, revelees: Math.min(total, e.revelees + 1) }));
        const carte = notifications[revelees];
        if (carte) son.current?.(carte.son);
      },
      revelees === 0 ? delaiInitial : cadence,
    );
    return () => clearTimeout(prochaine);
  }, [anime, fini, revelees, total, notifications, delaiInitial, cadence, maintien]);

  const passer = useCallback(() => setEtat({ revelees: total, fini: true }), [total]);
  return { revelees, fini, passer };
}

/** Le dessin d'une notification : de l'argent, une médaille, un record (chrono), un haut fait (coupe), un objet (paquet). */
export function IconeNotification({ genre }: { genre: GenreNotification }) {
  const trait = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
  return (
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false">
      {genre === 'dollars' && (
        <g {...trait}>
          <circle cx="12" cy="12" r="9" />
          <path d="M14.6 9.4c-.5-.9-1.5-1.4-2.6-1.4-1.5 0-2.6.8-2.6 2s1 1.7 2.7 2.1c1.8.4 2.9.9 2.9 2.1s-1.2 2-2.8 2c-1.2 0-2.3-.5-2.9-1.5M12 6.4V8M12 16v1.6" />
        </g>
      )}
      {genre === 'medaille' && (
        <g {...trait}>
          <circle cx="12" cy="14.5" r="5.5" />
          <path d="M8.5 9.6 6 3.5h4l2 4M15.5 9.6 18 3.5h-4l-2 4" />
          <path d="m12 12.2.9 1.8 2 .3-1.45 1.4.35 2-1.8-.95-1.8.95.35-2L9.1 14.3l2-.3z" />
        </g>
      )}
      {genre === 'record' && (
        <g {...trait}>
          <circle cx="12" cy="14" r="7" />
          <path d="M12 14V9.8M9.5 3.5h5M12 3.5V7M18.2 6.6l1.3-1.3" />
        </g>
      )}
      {genre === 'haut-fait' && (
        <g {...trait}>
          <path d="M7.5 4h9v5.2a4.5 4.5 0 0 1-9 0zM7.5 6H4.8c0 2.8 1 4.4 3 4.8M16.5 6h2.7c0 2.8-1 4.4-3 4.8M12 13.7V17M8.5 20h7M9.5 17h5v3h-5z" />
        </g>
      )}
      {genre === 'objet' && (
        <g {...trait}>
          <rect x="4" y="9" width="16" height="11" rx="1.2" />
          <path d="M3 9h18v-2.5H3zM12 6.5V20M12 6.5C10.2 6.5 8.2 5.8 8.2 4.4S10 3 12 6.5c2-3.5 3.8-3.6 3.8-2.1S13.8 6.5 12 6.5z" />
        </g>
      )}
    </svg>
  );
}

/** Une notification : son dessin, son titre (et une ligne de plus), ce qu'elle rapporte. */
export function CarteNotification({ notification, nouvelle = false }: { notification: NotificationGain; nouvelle?: boolean }) {
  const { genre, titre, detail, dollars: montant, medaille } = notification;
  return (
    <li className="notif-carte" data-genre={genre} data-medaille={medaille} data-nouvelle={nouvelle || undefined}>
      <span className="notif-dessin">
        <IconeNotification genre={genre} />
      </span>
      <span className="notif-texte">
        <b>{titre}</b>
        {detail && <small>{detail}</small>}
      </span>
      {montant > 0 ? <em className="notif-montant">+ {dollars(montant)}</em> : genre === 'objet' ? <em className="notif-montant notif-objet">Débloqué</em> : null}
    </li>
  );
}

/** La région vocale de « moins de mouvement » : une seule phrase, posée après le premier rendu (sinon rien n'est dit). */
export function AnnonceVocale({ notifications, actif }: { notifications: readonly NotificationGain[]; actif: boolean }) {
  const region = useRef<HTMLParagraphElement>(null);
  // Écrit dans la région après son premier rendu : une région vocale ne lit que ce qui change.
  useEffect(() => {
    if (actif && region.current) region.current.textContent = phraseLot(notifications);
  }, [actif, notifications]);
  return <p ref={region} className="notif-vocal" role="status" aria-live="polite" aria-atomic="true" />;
}

export interface ListeNotificationsProps {
  notifications: readonly NotificationGain[];
  revelees: number;
  passer: () => void;
}

/**
 * La liste des cartes arrivées, le total qui monte et « Tout afficher » : le bloc que l'écran de fin montre
 * pendant le défilé, à la place des gains et de ce qui est débloqué.
 */
export function ListeNotifications({ notifications, revelees, passer }: ListeNotificationsProps) {
  const fin = useRef<HTMLLIElement>(null);
  const total = totalApres(notifications, revelees);
  const visibles = notifications.slice(0, revelees);
  // La dernière carte reste en vue quand la liste dépasse l'écran.
  useEffect(() => {
    fin.current?.scrollIntoView?.({ block: 'nearest' });
  }, [revelees]);
  return (
    <>
      <p className="notif-total" aria-hidden="true">
        <span>Gagné en tout</span>
        <b key={total}>+ {dollars(total)}</b>
      </p>
      <ol className="notif-liste" role="log" aria-label="Gains de la course" aria-relevant="additions">
        {visibles.map((notification, i) => (
          <CarteNotification key={notification.id} notification={notification} nouvelle={i === visibles.length - 1} />
        ))}
        <li ref={fin} className="notif-ancre" aria-hidden="true" />
      </ol>
      <button type="button" className="btn notif-passer" onClick={passer}>
        Tout afficher
      </button>
    </>
  );
}
