// Entrée « Sortie » du menu (section Garage) : une étape à la fois, chacune remplace la précédente
// (vague U, retour du 18 novembre 2026, demandé deux fois : « bien dissocier la sélection de la zone de
// la sélection du circuit » ; « en vue paysage le bouton sortir est difficilement visible ») :
// 1. le mode : Libre, ou Carrière (le panneau du mode carrière, src/ui/carriere/) ;
// 2. le lieu (lu dans les manifestes des cartes, champ `zone`) ; un lieu à un seul circuit passe à la suite ;
// 3. le circuit du lieu, avec sa miniature ; la liste des lieux n'est plus à l'écran ;
// 4. le départ, quand la carte en a plusieurs (lus dans sa route) ;
// 5. les réglages : moment, météo, format (chacun dit ce qu'il rapporte), crédits des données, et
//    « Sortir », entier, sur toute la largeur du menu, collé en bas, qui redit le format. En portrait, le
//    dock monte de lui-même à cette étape (dock agrandi, `data-agrandir="d-office"`, src/ui/Dock.tsx) :
//    tout se lit sans défiler, et la scène recadre le véhicule au-dessus.
// Les étapes sont des niveaux du dock (src/state/dock.ts) : « Retour » remonte d'une étape, le fil dit
// où l'on est (Garage › Sortie › Libre › Monaco › Le circuit), et chaque étape relit en une ligne ce qui
// est déjà choisi. Rouvrir l'entrée ramène aux réglages de la dernière sortie (gardée, src/state/drive.ts),
// avec « Changer de circuit ». Logique des étapes : src/ui/drive/entree/etapes.ts.

import { useLayoutEffect } from 'react';
import { mapById, MAPS } from '../../data/maps.ts';
import { useDock } from '../../state/dock.ts';
import { useDrive } from '../../state/drive.ts';
import { CarrierePanneau } from '../carriere/CarrierePanneau.tsx';
import { etapeDe, pileReprise } from './entree/etapes.ts';
import { EtapeReglages } from './entree/EtapeReglages.tsx';
import { EtapeCircuit, EtapeDepart, EtapeLieu, EtapeMode } from './entree/Etapes.tsx';
import './drive.css';

/**
 * Reprise : l'entrée s'ouvre (aucune étape dans la pile) et une sortie a déjà été choisie (dans la séance)
 * ou faite (gardée) : on va droit à ses réglages, la pile complète sous eux. Une fois, quand la sauvegarde
 * est relue ; jamais par-dessus une étape où l'on est déjà.
 */
function useReprise(): void {
  const hydrated = useDrive((state) => state.hydrated);
  useLayoutEffect(() => {
    if (!hydrated) return;
    const dock = useDock.getState();
    if (dock.levels.length > 0) return;
    const drive = useDrive.getState();
    const memo = drive.choice.map !== null ? drive.choice : drive.derniere;
    const map = mapById(memo?.map);
    if (!map || !memo) return;
    if (drive.choice.map !== map.id) drive.chooseMap(map.id);
    drive.chooseStart(memo.start);
    dock.setLevels(pileReprise(map, null));
    // Une seule fois par ouverture de l'entrée : « Retour » jusqu'au mode n'y ramène pas.
  }, [hydrated]);
}

export function SortieEntree() {
  const levels = useDock((state) => state.levels);
  const etape = etapeDe(levels);
  const top = levels.at(-1);
  useReprise();

  if (MAPS.length === 0) {
    return <p className="drive-empty">Aucune carte de sortie dans cette version. Elles arrivent avec la prochaine.</p>;
  }

  return (
    <div className="drive-entry" data-etape={etape} data-agrandir={etape === 'reglages' || etape === 'carriere' ? 'd-office' : undefined}>
      {etape === 'mode' && <EtapeMode />}
      {/* La carrière : la fiche défile dans le panneau, « Sortir » reste dessous, hors de ce qui défile
          (retour du 18 novembre 2026 : la fiche passait derrière le bouton, et le menu était trop bas). */}
      {etape === 'carriere' && (
        <div className="entree-carriere">
          <CarrierePanneau />
        </div>
      )}
      {etape === 'zone' && <EtapeLieu />}
      {etape === 'circuit' && top?.kind === 'sortie' && <EtapeCircuit lieu={top.lieu ?? ''} />}
      {etape === 'depart' && <EtapeDepart />}
      {etape === 'reglages' && <EtapeReglages />}
    </div>
  );
}
