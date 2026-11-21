// L'écran « Jouer » (vague X, 21 novembre 2026), première étape : les modes en grandes cartes, chacune son
// pictogramme et une ligne qui dit ce qu'on y gagne (src/data/modes.ts). En tête, « Continuer » quand une
// carrière est entamée ou qu'une sortie précédente existe : un appui y reprend. Choisir un mode règle le
// format et le duel (le choix est gardé), puis l'étape du lieu s'ouvre ; la carrière a son panneau, avec la
// fiche du prochain rendez-vous (ce que portait son bouton rond du garage : sa météo et son numéro).

import { formatSpec } from '../../../data/courses.ts';
import { mapById } from '../../../data/maps.ts';
import { formatDuMode, MODES_JEU, modeDe, type ModeJeu } from '../../../data/modes.ts';
import { ADVERSAIRES } from '../../../data/adversaires.ts';
import { useDuel } from '../../../drive/adversaire/choix.ts';
import { useDock } from '../../../state/dock.ts';
import { useDrive } from '../../../state/drive.ts';
import { DriveIcon } from '../icones.tsx';
import { iconeMeteo } from '../../carriere/FicheRendezVous.tsx';
import { useCarriere } from '../../carriere/useCarriere.ts';
import { niveauCarriere, niveauLieu, pileReprise, rappel } from './etapes.ts';
import { PictoMode } from './PictosModes.tsx';

/** Où « Continuer » reprend : le prochain rendez-vous de la carrière, ou la dernière sortie libre. */
function reprise(carriereEntamee: boolean, rendezVousPret: boolean, derniere: ReturnType<typeof useDrive.getState>['derniere'], libre: boolean): 'carriere' | 'libre' | null {
  if (rendezVousPret && derniere?.carriere) return 'carriere';
  if (libre) return 'libre';
  return rendezVousPret && carriereEntamee ? 'carriere' : null;
}

export function EtapeMode() {
  const carriere = useCarriere();
  const derniere = useDrive((state) => state.derniere);
  const choix = useDrive((state) => state.choice);
  const format = useDrive((state) => state.format);
  const duelActif = useDuel((state) => state.actif);
  const push = useDock((state) => state.push);
  const setLevels = useDock((state) => state.setLevels);
  const { courant, numero, total, saisonNumero, reussis } = carriere;
  const aCarriere = carriere.hydrated && carriere.total > 0;
  const entamee = reussis > 0 || saisonNumero > 1;
  // La sortie libre à reprendre : le choix fait dans la séance, sinon la dernière sortie gardée.
  const memo = choix.map !== null ? choix : derniere;
  const carteReprise = mapById(memo?.map);
  const suite = reprise(entamee, aCarriere && courant !== null, derniere, carteReprise !== undefined);
  const dernierMode = modeDe(format, duelActif && ADVERSAIRES.length > 0);
  const rendezVous = courant ? `Rendez-vous ${numero} sur ${total}${saisonNumero > 1 ? ` (saison ${saisonNumero})` : ''} · ${courant.titre}` : null;

  const choisir = (mode: ModeJeu) => {
    if (mode.id === 'carriere') {
      push(niveauCarriere());
      return;
    }
    if (mode.id === 'rodeo') return;
    const drive = useDrive.getState();
    drive.setFormat(formatDuMode(mode.id, drive.format));
    useDuel.getState().setActif(mode.id === 'duel');
    push(niveauLieu(mode.label));
  };
  const continuer = () => {
    if (suite === 'carriere') {
      push(niveauCarriere());
      return;
    }
    if (!carteReprise || !memo) return;
    const drive = useDrive.getState();
    drive.chooseMap(carteReprise.id);
    drive.chooseStart(memo.start);
    setLevels(pileReprise(carteReprise, MODES_JEU.find((mode) => mode.id === dernierMode)?.label ?? ''));
  };

  return (
    <div className="entree-corps jouer-modes" role="group" aria-label="Mode">
      {suite && (
        <button type="button" className="jouer-carte jouer-continuer" data-mode="continuer" onClick={continuer}>
          <PictoMode id="continuer" />
          <span className="jouer-texte">
            <b>Continuer</b>
            <small>
              {suite === 'carriere' && rendezVous
                ? `Carrière · ${rendezVous}`
                : suite === 'libre' && carteReprise
                  ? `${rappel(carteReprise, null)} · ${duelActif && dernierMode === 'duel' ? 'Duel' : formatSpec(format).label}`
                  : ''}
            </small>
          </span>
        </button>
      )}
      {MODES_JEU.filter((mode) => mode.disponible && (mode.id !== 'carriere' || aCarriere) && (mode.id !== 'duel' || ADVERSAIRES.length > 0)).map((mode) => (
        <button key={mode.id} type="button" className="jouer-carte" data-mode={mode.id} onClick={() => choisir(mode)}>
          <PictoMode id={mode.id} />
          <span className="jouer-texte">
            <b>{mode.label}</b>
            <small>{mode.aide}</small>
            {mode.id === 'carriere' && (
              <em className="jouer-etat">
                {courant ? (
                  <>
                    <DriveIcon name={iconeMeteo(courant)} />
                    {rendezVous}
                  </>
                ) : (
                  'Bouclée : toutes les saisons sont réussies'
                )}
              </em>
            )}
          </span>
        </button>
      ))}
    </div>
  );
}
