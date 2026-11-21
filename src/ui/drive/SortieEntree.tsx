// L'écran « Jouer » (vague X, 21 novembre 2026 ; il remplace le menu « Sortie » de la section Garage), ouvert
// par le bouton « Jouer » du garage (src/ui/Dock.tsx), toujours visible. Il vit dans le dock, en entrée de la
// section cachée « Jouer » (src/data/dockMenu.ts), une étape à la fois, chacune remplace la précédente :
// 1. les modes, en grandes cartes (src/ui/drive/entree/Modes.tsx) : Continuer, Carrière, Course, Duel, Drift,
//    Balade ; la carrière a son panneau (src/ui/carriere/), les autres suivent ;
// 2. le lieu (lu dans les manifestes des cartes, champ `zone`) ; un lieu à un seul circuit passe à la suite ;
// 3. le circuit du lieu, avec sa miniature ;
// 4. les réglages de ce mode : format, adversaire, départ, moment et météo (repliés), crédits (repliés), puis
//    « Jouer », entier, sur toute la largeur du menu, collé en bas. En portrait, le dock monte de lui-même à
//    cette étape (dock agrandi, `data-agrandir="d-office"`, src/ui/Dock.tsx) : tout se lit sans défiler, et la
//    scène recadre le véhicule au-dessus.
// Les étapes sont des niveaux du dock (src/state/dock.ts) : « Retour » et Échap remontent d'une étape ; l'en-tête
// du dock dit le titre de l'étape (src/ui/drive/entree/etapes.ts). Aucun lieu ni aucune carte n'est écrit ici.

import { useEffect } from 'react';
import { MAPS } from '../../data/maps.ts';
import { useDock } from '../../state/dock.ts';
import { CarrierePanneau } from '../carriere/CarrierePanneau.tsx';
import { etapeDe } from './entree/etapes.ts';
import { EtapeReglages } from './entree/EtapeReglages.tsx';
import { EtapeCircuit, EtapeLieu } from './entree/Etapes.tsx';
import { EtapeMode } from './entree/Modes.tsx';
import './drive.css';

/**
 * « Entrée » lance (vague X) : « Continuer » aux modes, « Jouer » aux réglages et sur la fiche de la carrière.
 * Seulement quand Entrée n'a rien d'autre à faire : sur un bouton, il l'active (un choix déjà allumé met à
 * part : Entrée y lance, il n'y aurait rien à changer).
 */
function useEntreeLance(): void {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Enter' || event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey || document.querySelector('dialog[open]')) return;
      const cible = event.target instanceof HTMLElement ? event.target : null;
      const actif = cible?.closest('button, a, summary, input, select, textarea');
      if (actif && actif.getAttribute('aria-pressed') !== 'true') return;
      const lancer = document.querySelector<HTMLButtonElement>('footer.dock .drive-entry .drive-go, footer.dock .drive-entry .carriere-sortir, footer.dock .drive-entry .jouer-continuer');
      if (!lancer || lancer.disabled) return;
      event.preventDefault();
      lancer.click();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}

export function SortieEntree() {
  const levels = useDock((state) => state.levels);
  const etape = etapeDe(levels);
  const top = levels.at(-1);
  useEntreeLance();

  if (MAPS.length === 0) {
    return <p className="drive-empty">Aucune carte de sortie dans cette version. Elles arrivent avec la prochaine.</p>;
  }

  return (
    <div className="drive-entry" data-etape={etape} data-agrandir={etape === 'mode' || etape === 'reglages' || etape === 'carriere' ? 'd-office' : undefined}>
      {etape === 'mode' && <EtapeMode />}
      {/* La carrière : la fiche défile dans le panneau, « Jouer » reste dessous, hors de ce qui défile
          (retour du 18 novembre 2026 : la fiche passait derrière le bouton, et le menu était trop bas). */}
      {etape === 'carriere' && (
        <div className="entree-carriere">
          <CarrierePanneau />
        </div>
      )}
      {etape === 'zone' && <EtapeLieu />}
      {etape === 'circuit' && top?.kind === 'sortie' && <EtapeCircuit lieu={top.lieu ?? ''} />}
      {etape === 'reglages' && <EtapeReglages />}
    </div>
  );
}
