// Son de la sortie de nuit (§ 5.5 « Son ») : trois curseurs « Radio », « Moteur », « Route », de 0 à
// 100 %, gardés d'une sortie à l'autre (src/state/mixage.ts), effet immédiat (src/drive/son.ts). Ils
// vivent dans les réglages de la sortie (src/ui/drive/Reglages.tsx), rubrique « Son ».
// Pour les parcours, un témoin caché, toujours monté, porte le mélange appliqué et l'état du moteur :
// data-radio (facteur de la radio), data-moteur-niveau, data-route (niveaux), data-bruitage et
// data-bruitages (dernier bruitage ponctuel parti, et leur nombre), data-moteur (sans-son, muet,
// attente d'un geste, coupe, demarre, tourne), data-regime (tr/min), data-rapport, data-niveau.

import { useId, type CSSProperties } from 'react';
import { useSonSortie } from '../../drive/son.ts';
import { useMixage, VOIES_MIXAGE } from '../../state/mixage.ts';
import './mixage.css';

const AIDE: Record<string, string> = {
  radio: 'Ce qui reste de la radio quand le moteur tourne.',
  moteur: 'Le moteur, du ralenti au rupteur.',
  route: 'Pneus, vent, pluie, freinage, rapports, et les sons de gain.',
};

/** Les trois curseurs et « Valeurs d'origine ». */
export function MixageCurseurs() {
  const id = useId();
  const reglages = useMixage();
  return (
    <div className="mixage" role="group" aria-label="Son de la sortie">
      {VOIES_MIXAGE.map((voie) => {
        const valeur = reglages[voie.id];
        return (
          <label key={voie.id} className="mixage-voie" data-voie={voie.id}>
            <span className="mixage-nom">{voie.label}</span>
            <span className="mixage-valeur" aria-hidden="true">
              {valeur} %
            </span>
            <input
              type="range"
              aria-label={voie.label}
              aria-describedby={`${id}-${voie.id}`}
              min={0}
              max={100}
              step={5}
              value={valeur}
              aria-valuetext={`${valeur} %`}
              style={{ '--part': `${valeur}%` } as CSSProperties}
              onChange={(event) => reglages.regler(voie.id, Number(event.currentTarget.value))}
            />
            <span className="mixage-aide" id={`${id}-${voie.id}`}>
              {AIDE[voie.id]}
            </span>
          </label>
        );
      })}
      <button type="button" className="btn mixage-origine" onClick={reglages.origine}>
        Valeurs d’origine
      </button>
    </div>
  );
}

/** Témoin caché du son de la sortie, pour les parcours (voir l'en-tête). */
export function SonEtat() {
  const { etat, regime, rapport, niveau, radio, route, bruitage, bruitages } = useSonSortie();
  return (
    <span
      className="drive-son-etat"
      hidden
      data-moteur={etat}
      data-regime={regime}
      data-rapport={rapport}
      data-niveau={niveau.toFixed(2)}
      data-radio={radio.toFixed(2)}
      data-moteur-niveau={niveau.toFixed(2)}
      data-route={route.toFixed(2)}
      data-bruitage={bruitage}
      data-bruitages={bruitages}
    />
  );
}
