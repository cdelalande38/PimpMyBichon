// Étapes de choix du menu de la sortie : le mode, le lieu, le circuit du lieu, le départ. Une seule à
// l'écran ; chacune remplace la précédente (src/ui/drive/entree/etapes.ts). En tête de chaque étape, une
// ligne relit ce qui est déjà choisi et dit ce qu'on attend ; dessous, une rangée de choix (elle défile
// en dock compact, passe à la ligne en dock agrandi et en paysage).

import { useEffect } from 'react';
import { circuitLabel, mapById, zoneById, zoneOf, zonesOf } from '../../../data/maps.ts';
import { useDock } from '../../../state/dock.ts';
import { useDrive } from '../../../state/drive.ts';
import { PictoCarte } from '../../pictos/Pictos.tsx';
import { useRevealPressed } from '../../scroll.ts';
import { apresCircuit, apresDepart, apresLieu, LIBELLE_DEBUT, LIBELLE_LIBRE, lieuDe, MODES, niveauCarriere, niveauLieu, sansEtapeDepart } from './etapes.ts';
import { useDeparts } from './useDeparts.ts';

/** Ligne de tête d'une étape : ce qui est déjà choisi (en clair), puis ce qu'on attend. */
function Rappel({ choisi, consigne }: { choisi?: string; consigne: string }) {
  return (
    <p className="entree-rappel">
      {choisi && <b>{choisi}</b>}
      {choisi && ' · '}
      {consigne}
    </p>
  );
}

/** Étape d'ouverture : Libre (on choisit tout) ou Carrière (le panneau du mode carrière). */
export function EtapeMode() {
  const push = useDock((state) => state.push);
  return (
    <div className="entree-corps">
      <Rappel consigne="Libre ou carrière ?" />
      <div className="chips entree-liste" role="group" aria-label="Mode">
        {MODES.map((mode) => (
          <button key={mode.id} type="button" className="chip" data-mode={mode.id} onClick={() => push(mode.id === 'libre' ? niveauLieu() : niveauCarriere())}>
            <b>{mode.label}</b>
            <small>{mode.aide}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Le lieu (plateau matheysin, Monaco, Miami…) : un lieu à un seul circuit mène droit à ses départs. */
export function EtapeLieu() {
  const zones = zonesOf();
  const chosen = useDrive((state) => state.choice.map);
  const chooseMap = useDrive((state) => state.chooseMap);
  const push = useDock((state) => state.push);
  const current = mapById(chosen);
  const pressed = current ? zoneOf(current).id : null;
  const row = useRevealPressed<HTMLDivElement>(pressed ?? '');
  return (
    <div className="entree-corps">
      <Rappel choisi={LIBELLE_LIBRE} consigne="choisis le lieu" />
      <div ref={row} className="chips entree-liste" role="group" aria-label="Lieu">
        {zones.map((zone) => {
          const first = zone.maps[0];
          return (
            <button
              key={zone.id}
              type="button"
              className="chip chip-picto"
              data-zone={zone.id}
              aria-pressed={zone.id === pressed}
              onClick={() => {
                const { niveau, carte } = apresLieu(zone);
                if (carte) chooseMap(carte.id);
                push(niveau);
              }}
            >
              {first && <PictoCarte id={first.id} />}
              <span className="chip-text">
                <b>{zone.label}</b>
                <small>{zone.maps.length > 1 ? `${zone.maps.length} circuits` : (first?.hint ?? first?.name)}</small>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Les circuits du lieu choisi, et seulement eux, avec leur miniature. */
export function EtapeCircuit({ lieu }: { lieu: string }) {
  const zone = zoneById(lieu);
  const chosen = useDrive((state) => state.choice.map);
  const chooseMap = useDrive((state) => state.chooseMap);
  const push = useDock((state) => state.push);
  const row = useRevealPressed<HTMLDivElement>(chosen ?? '');
  if (!zone) return <p className="drive-note">Ce lieu n’est plus au catalogue : reviens d’une étape.</p>;
  return (
    <div className="entree-corps">
      <Rappel choisi={zone.label} consigne="choisis le circuit" />
      <div ref={row} className="chips entree-liste" role="group" aria-label="Circuit">
        {zone.maps.map((map) => (
          <button
            key={map.id}
            type="button"
            className="chip chip-picto"
            data-carte={map.id}
            aria-pressed={map.id === chosen}
            onClick={() => {
              chooseMap(map.id);
              push(apresCircuit(map));
            }}
          >
            <PictoCarte id={map.id} />
            <span className="chip-text">
              <b>{circuitLabel(map)}</b>
              {map.hint && <small>{map.hint}</small>}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Les départs du circuit choisi (lus dans sa route) ; un seul départ : l'étape s'efface d'elle-même. */
export function EtapeDepart() {
  const map = mapById(useDrive((state) => state.choice.map));
  const chosen = useDrive((state) => state.choice.start);
  const chooseStart = useDrive((state) => state.chooseStart);
  const push = useDock((state) => state.push);
  const setLevels = useDock((state) => state.setLevels);
  const starts = useDeparts(map);
  const start = starts?.list.find((item) => item.id === chosen) ?? starts?.list[0];
  const row = useRevealPressed<HTMLDivElement>(start?.id ?? '');
  const ready = starts?.status === 'pret' ? starts.list : null;

  useEffect(() => {
    if (!ready) return;
    const next = sansEtapeDepart(useDock.getState().levels, ready);
    if (next) setLevels(next);
  }, [ready, setLevels]);

  if (!map) return <p className="drive-note">Choisis d’abord un circuit : reviens d’une étape.</p>;
  const zone = lieuDe(map);
  return (
    <div className="entree-corps">
      <Rappel choisi={`${zone.label} › ${circuitLabel(map)}`} consigne="d’où tu pars ?" />
      <div ref={row} className="chips entree-liste" role="group" aria-label="Départ">
        {starts?.status === 'chargement' && <span className="drive-note">Départs en route…</span>}
        {starts?.list.map((item) => (
          <button
            key={item.id}
            type="button"
            className="chip"
            data-depart={item.id}
            aria-pressed={item.id === start?.id}
            onClick={() => {
              chooseStart(item.id);
              push(apresDepart(item.label));
            }}
          >
            <b>{item.label}</b>
            <small>km {(item.at / 1000).toFixed(1).replace('.', ',')}</small>
          </button>
        ))}
        {starts?.status === 'erreur' && (
          <button
            type="button"
            className="chip"
            onClick={() => {
              chooseStart(null);
              push(apresDepart(LIBELLE_DEBUT));
            }}
          >
            <b>Partir du début</b>
            <small>Départs indisponibles hors ligne</small>
          </button>
        )}
      </div>
    </div>
  );
}
