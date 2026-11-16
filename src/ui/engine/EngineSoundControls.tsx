// Commandes du son du moteur, en tête de Mécanique · Préparation : « Démarrer », « Coup de gaz »
// (appui maintenu : le régime monte tant qu'on appuie) et « Couper ». Hauteur fixe : l'état change,
// le menu ne bouge pas. L'état se lit à l'écran et dans data-moteur (coupe, demarrage, ralenti,
// charge, coupure), pour les parcours ; data-sons dit si le moteur a des sons.

import { useEffect, useRef, type KeyboardEvent } from 'react';
import { FAMILLES_SONORES } from '../../audio/engine/manifeste.ts';
import { resolveVehicle } from '../../data/vehicles.ts';
import { useBuilds } from '../../state/builds.ts';
import { soundFamilyOf, useEngineSound, type EngineState } from '../../state/engineSound.ts';

const STATE_LABEL: Record<EngineState, string> = {
  coupe: 'coupé',
  demarrage: 'démarrage…',
  ralenti: 'ralenti',
  charge: 'en charge',
  coupure: 'coupure…',
};

export function EngineSoundControls() {
  const current = useBuilds((state) => state.current);
  const state = useEngineSound((store) => store.state);
  const echec = useEngineSound((store) => store.echec);
  const demarrer = useEngineSound((store) => store.demarrer);
  const gaz = useEngineSound((store) => store.gaz);
  const couper = useEngineSound((store) => store.couper);
  const holding = useRef(false);
  const famille = soundFamilyOf(resolveVehicle(current));
  const running = state === 'ralenti' || state === 'charge';

  // Le panneau se ferme pendant l'appui : on relâche l'accélérateur.
  useEffect(
    () => () => {
      if (holding.current) gaz(false);
    },
    [gaz],
  );

  const press = (on: boolean) => {
    if (holding.current === on) return;
    holding.current = on;
    gaz(on);
  };
  const onKey = (event: KeyboardEvent<HTMLButtonElement>, on: boolean) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    event.preventDefault();
    press(on);
  };

  let line: string;
  if (!famille) line = 'Pas encore de son pour ce moteur : il reste muet.';
  else if (echec && state === 'coupe') line = 'Son pas encore sur le téléphone : il faut du réseau la première fois.';
  else line = `Moteur ${STATE_LABEL[state]}${FAMILLES_SONORES[famille]?.provisoire ? ' · prises provisoires' : ''}`;

  return (
    <section className="engine-sound" aria-label="Son du moteur" data-moteur={state} data-sons={famille ? 'oui' : 'non'}>
      <div className="engine-sound-buttons">
        <button type="button" className="btn" disabled={!famille || state !== 'coupe'} onClick={demarrer}>
          Démarrer
        </button>
        <button
          type="button"
          className="btn cta engine-throttle"
          disabled={!famille || !running}
          onPointerDown={(event) => {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            press(true);
          }}
          onPointerUp={() => press(false)}
          onPointerCancel={() => press(false)}
          onLostPointerCapture={() => press(false)}
          onKeyDown={(event) => onKey(event, true)}
          onKeyUp={(event) => onKey(event, false)}
          onBlur={() => press(false)}
          onContextMenu={(event) => event.preventDefault()}
        >
          Coup de gaz
        </button>
        <button type="button" className="btn" disabled={!famille || state === 'coupe' || state === 'coupure'} onClick={couper}>
          Couper
        </button>
      </div>
      <p className="engine-sound-state" role="status">
        {line}
      </p>
    </section>
  );
}
