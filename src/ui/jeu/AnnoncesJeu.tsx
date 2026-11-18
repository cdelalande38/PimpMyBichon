// L'annonce, au garage, des hauts faits gagnés hors course (vague U, 18 novembre 2026) : « Premier achat »
// tombe quand on achète, pas au bout d'une course. Le même composant et le même son que l'écran de fin
// (src/ui/jeu/NotificationsGain.tsx), là où ça tombe : une pile de cartes en haut de l'écran, une à une, qui
// s'efface seule.
//
// - Les annonces viennent de l'état du jeu (`annonces`, src/state/jeu.ts) : `acheter` y pose, un lot par achat,
//   les hauts faits obtenus au passage. Ce composant montre le premier lot, puis le retire de la file.
// - La pile est dans la couche supérieure du navigateur (attribut `popover`) : les panneaux de l'atelier sont
//   des fenêtres modales, une pile ordinaire serait cachée derrière. Elle laisse passer les doigts.
// - Cachée aux lecteurs d'écran : la phrase du bloc d'achat dit déjà « Haut fait : … » (src/ui/jeu/Achat.tsx),
//   et un contenu hors d'une fenêtre modale ouverte est de toute façon inerte pour eux.
// - « Moins de mouvement » : les cartes sont là d'emblée, un seul son, la pile reste le même temps.

import { useEffect, useLayoutEffect, useRef } from 'react';
import { useMediaQuery } from '../../app/useMediaQuery.ts';
import { jouerSonInterface, useSonsInterface } from '../../audio/sfx/interface.ts';
import { useJeu } from '../../state/jeu.ts';
import { CarteNotification, useDefilement } from './NotificationsGain.tsx';
import { MAINTIEN_GARAGE, type NotificationGain } from './notifications.ts';
import './notifications.css';

/** Un lot de cartes : elles arrivent, restent un moment, puis `onFin`. */
function LotAnnonce({ notifications, anime, onFin }: { notifications: readonly NotificationGain[]; anime: boolean; onFin: () => void }) {
  const { revelees, fini } = useDefilement({ notifications, anime, onSon: jouerSonInterface, maintien: MAINTIEN_GARAGE });
  useEffect(() => {
    if (!fini) return;
    // Avec mouvement, `fini` vient après le maintien ; sans mouvement, tout est là d'emblée : on attend ici.
    const fin = setTimeout(onFin, anime ? 0 : MAINTIEN_GARAGE);
    return () => clearTimeout(fin);
  }, [fini, anime, onFin]);
  const visibles = notifications.slice(0, revelees);
  return (
    <ol className="notif-liste notif-liste-garage" aria-hidden="true">
      {visibles.map((notification, i) => (
        <CarteNotification key={notification.id} notification={notification} nouvelle={anime && i === visibles.length - 1} />
      ))}
    </ol>
  );
}

export function AnnoncesJeu() {
  const lot = useJeu((state) => state.annonces[0]);
  const lotAnnonce = useJeu((state) => state.lotAnnonce);
  const reduit = useMediaQuery('(prefers-reduced-motion: reduce)');
  const pile = useRef<HTMLDivElement>(null);
  // Témoins pour les parcours : sons demandés au lecteur et sons partis, depuis l'ouverture de la page.
  const demandes = useSonsInterface((state) => state.demandes);
  const joues = useSonsInterface((state) => state.joues);
  const dernier = useSonsInterface((state) => state.dernier);

  // Dans la couche supérieure tant qu'il y a quelque chose à montrer.
  useLayoutEffect(() => {
    const el = pile.current;
    if (!el?.showPopover) return;
    try {
      if (lot && !el.matches(':popover-open')) el.showPopover();
      else if (!lot && el.matches(':popover-open')) el.hidePopover();
    } catch {
      // Navigateur sans couche supérieure : la pile reste une couche ordinaire.
    }
  }, [lot]);

  return (
    <div ref={pile} className="notif-garage" popover="manual" data-actif={lot ? 'oui' : 'non'} data-sons-demandes={demandes} data-sons-joues={joues} data-son-dernier={dernier ?? undefined}>
      {lot && <LotAnnonce key={lot.map((n) => n.id).join('|')} notifications={lot} anime={!reduit} onFin={lotAnnonce} />}
    </div>
  );
}
