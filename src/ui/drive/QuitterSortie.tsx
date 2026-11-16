// Dialogue « Rentrer au garage ? » de la sortie de nuit (garde : src/app/gardeSortie.ts) et offre de
// mise à jour de l'écran de pause. « Rester sur la route » est l'action par défaut, sous le pouce ;
// Échap, un appui à côté ou un second « retour » restent aussi sur la route.

import { useEffect, useRef } from 'react';
import { garderSortie, rentrerAuGarage, resterSurLaRoute, useQuitter } from '../../app/gardeSortie.ts';
import { applyUpdate } from '../../pwa/register.ts';
import { usePwa } from '../../pwa/pwaStore.ts';
import { useDrive } from '../../state/drive.ts';
import './quitter.css';

function Dialogue() {
  const rester = useRef<HTMLButtonElement>(null);
  const carte = useRef<HTMLDivElement>(null);

  // Le focus va sur l'action par défaut ; il revient où il était à la fermeture. Échap = rester ;
  // Tab tourne entre les deux boutons (le reste de l'écran est derrière).
  useEffect(() => {
    const avant = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    rester.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        resterSurLaRoute();
        return;
      }
      if (event.key !== 'Tab') return;
      const boutons = Array.from(carte.current?.querySelectorAll('button') ?? []);
      const premier = boutons[0];
      const dernier = boutons[boutons.length - 1];
      if (!premier || !dernier) return;
      if (event.shiftKey && document.activeElement === premier) {
        event.preventDefault();
        dernier.focus();
      } else if (!event.shiftKey && document.activeElement === dernier) {
        event.preventDefault();
        premier.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      if (avant?.isConnected) avant.focus({ preventScroll: true });
    };
  }, []);

  return (
    <div className="quitter" onPointerDown={(event) => event.target === event.currentTarget && resterSurLaRoute()}>
      <div ref={carte} className="quitter-carte" role="dialog" aria-modal="true" aria-labelledby="quitter-titre" aria-describedby="quitter-texte">
        <h2 id="quitter-titre">Rentrer au garage ?</h2>
        <p id="quitter-texte">La route est en pause. Si tu rentres, tu quittes la sortie en cours.</p>
        <div className="quitter-actes">
          <button type="button" className="btn quitter-rentrer" onClick={rentrerAuGarage}>
            Rentrer
          </button>
          <button ref={rester} type="button" className="btn cta quitter-rester" onClick={resterSurLaRoute}>
            Rester sur la route
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Offre de mise à jour de la sortie : jamais pendant qu'on roule, seulement à l'arrêt (pause) et au
 * bout du parcours, quand un rechargement ne coûte rien.
 */
function OffreMiseAJour() {
  const prete = usePwa((state) => state.updateReady);
  const pause = useDrive((state) => state.paused);
  const fini = useDrive((state) => state.telemetry.finished);
  const question = useQuitter((state) => state.ouvert);
  if (!prete || question || !(pause || fini)) return null;
  return (
    <div className="maj-sortie">
      <button type="button" className="btn maj-sortie-btn" aria-label="Nouvelle version prête : recharger l’atelier" onClick={() => void applyUpdate()}>
        <span>Nouvelle version</span>
        <b>Recharger</b>
      </button>
    </div>
  );
}

/** À monter une fois, avec l'écran de la sortie : pose la garde d'historique, le dialogue et l'offre de mise à jour. */
export function QuitterSortie() {
  const ouvert = useQuitter((state) => state.ouvert);
  useEffect(() => garderSortie(), []);
  return (
    <>
      <OffreMiseAJour />
      {ouvert && <Dialogue />}
    </>
  );
}
