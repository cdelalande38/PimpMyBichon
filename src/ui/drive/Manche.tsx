// Commandes au doigt de la sortie de nuit (§ 5.5), à la main : le manche virtuel et les boutons tenus
// de la manette en paysage. Chaque doigt a son identifiant (événements pointeur) : le manche sous un
// pouce, un bouton sous l'autre, et un doigt levé ne relâche que ce qu'il tenait.
//
// - `MANUEL` mêle ce que tiennent les doigts (manche, GAZ, FREIN) et l'écrit d'un coup dans le store
//   (`setManual`) : gaz et frein, le plus fort des deux sources ; placement, celui du manche.
// - `MancheDessin` : la base apparaît sous le pouce posé, le bouton suit le doigt dans le rayon ; repères
//   « GAZ » en haut, « FREIN » en bas ; il s'efface quand le doigt se lève. Mis à jour par référence à
//   chaque mouvement, sans rendu React.
// - `Amorce` : tant qu'on ne roule pas, dit où poser le pouce.
// - `BoutonTenu` : un bouton maintenu (GAZ, FREIN), à son doigt.
// - `useAppui` : un bouton qui répond aussi sous un second doigt (le navigateur n'envoie de « click »
//   qu'au premier doigt posé).
// - `useManettePhysique` : une manette branchée (API Gamepad) est lue à chaque image, à la main, dans
//   la même boucle que le compte-tours : gâchettes gaz et frein, manche gauche la direction, NOS.

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { useDrive } from '../../state/drive.ts';
import { useBoucleImage } from './CompteTours.tsx';
import { boutonManche, lireManche, lireManettePhysique, MANCHE, type LectureManche } from './manche.ts';

/** Ce que tiennent les doigts, à la main. */
export const MANUEL: { stick: LectureManche; pad: LectureManche & { nos: boolean }; gaz: boolean; frein: boolean } = {
  stick: { throttle: 0, brake: 0, steer: 0 },
  pad: { throttle: 0, brake: 0, steer: 0, nos: false },
  gaz: false,
  frein: false,
};

/**
 * Écrit dans le store ce que tiennent les doigts ; `steer` absent quand rien ne braque (pédales en
 * direction assistée : le placement passe par `lane`).
 */
export function appliquerManuel(manche: boolean): void {
  const m = MANUEL;
  useDrive.getState().setManual({
    throttle: Math.max(m.stick.throttle, m.pad.throttle, m.gaz ? 1 : 0),
    brake: Math.max(m.stick.brake, m.pad.brake, m.frein ? 1 : 0),
    steer: manche ? (m.stick.steer !== 0 ? m.stick.steer : m.pad.steer) : undefined,
  });
}

/** Tout lâché (changement de mode, écran démonté). */
export function lacherManuel(): void {
  MANUEL.stick.throttle = 0;
  MANUEL.stick.brake = 0;
  MANUEL.stick.steer = 0;
  MANUEL.pad.throttle = 0;
  MANUEL.pad.brake = 0;
  MANUEL.pad.steer = 0;
  MANUEL.pad.nos = false;
  MANUEL.gaz = false;
  MANUEL.frein = false;
}

/**
 * Manette physique (API Gamepad) : lue à chaque image tant qu'une est branchée et qu'on conduit à la
 * main ; rien n'est écrit tant qu'elle ne donne rien. Aucune marque n'est nommée.
 */
export function useManettePhysique(main: boolean, manche: boolean): void {
  const etat = useRef({ branchee: false, vide: true, nos: false });
  useEffect(() => {
    const suivre = () => {
      const pads = typeof navigator.getGamepads === 'function' ? navigator.getGamepads() : [];
      etat.current.branchee = pads.some((pad) => pad?.connected);
    };
    suivre();
    window.addEventListener('gamepadconnected', suivre);
    window.addEventListener('gamepaddisconnected', suivre);
    return () => {
      window.removeEventListener('gamepadconnected', suivre);
      window.removeEventListener('gamepaddisconnected', suivre);
    };
  }, []);
  useBoucleImage(() => {
    const e = etat.current;
    if (!main || !e.branchee) return;
    let pad: Gamepad | null = null;
    for (const item of navigator.getGamepads()) {
      if (item?.connected) {
        pad = item;
        break;
      }
    }
    if (!pad) return;
    const lu = lireManettePhysique(pad, MANUEL.pad);
    const vide = lu.throttle === 0 && lu.brake === 0 && lu.steer === 0;
    // Écrit tant qu'elle donne quelque chose, et une fois encore quand elle retombe à zéro.
    if (!vide || !e.vide) appliquerManuel(manche);
    e.vide = vide;
    if (lu.nos && !e.nos) useDrive.getState().fireNos();
    e.nos = lu.nos;
  });
}

const POS: [number, number] = [0, 0];

/** Le manche tenu par un doigt : base sous le pouce, bouton dans le rayon. */
export interface MancheTenu {
  id: number;
  /** Base, dans la zone des gestes (px). */
  x: number;
  y: number;
}

/** Pose le dessin du manche à sa base (coordonnées dans la zone). */
export function poserManche(el: HTMLElement | null, x: number, y: number): void {
  if (!el) return;
  el.style.left = `${x}px`;
  el.style.top = `${y}px`;
  el.dataset.actif = 'true';
  bougerManche(el, 0, 0);
}

/** Le bouton suit le doigt (dx, dy depuis la base) ; les commandes lues vont dans `MANUEL.stick`. */
export function bougerManche(el: HTMLElement | null, dx: number, dy: number): void {
  lireManche(dx, dy, MANCHE.rayon, MANCHE.morte, MANUEL.stick);
  if (!el) return;
  const [bx, by] = boutonManche(dx, dy, MANCHE.rayon, POS);
  el.style.setProperty('--bx', `${bx.toFixed(1)}px`);
  el.style.setProperty('--by', `${by.toFixed(1)}px`);
  el.dataset.gaz = MANUEL.stick.throttle.toFixed(2);
  el.dataset.frein = MANUEL.stick.brake.toFixed(2);
  el.dataset.placement = MANUEL.stick.steer.toFixed(2);
}

/** Le manche levé : il s'efface, les commandes retombent. */
export function leverManche(el: HTMLElement | null): void {
  MANUEL.stick.throttle = 0;
  MANUEL.stick.brake = 0;
  MANUEL.stick.steer = 0;
  if (!el) return;
  el.dataset.actif = 'false';
  el.dataset.gaz = el.dataset.frein = el.dataset.placement = '0.00';
}

/** Le dessin du manche : anneau, bouton, repères. */
export function MancheDessin({ el }: { el: RefObject<HTMLDivElement | null> }) {
  return (
    <div ref={el} className="drive-manche" aria-hidden="true" data-actif="false" data-gaz="0.00" data-frein="0.00" data-placement="0.00" style={{ ['--rayon' as string]: `${MANCHE.rayon}px` }}>
      <span className="drive-manche-repere" data-repere="gaz">
        Gaz
      </span>
      <i className="drive-manche-anneau" />
      <i className="drive-manche-bouton" />
      <span className="drive-manche-repere" data-repere="frein">
        Frein
      </span>
    </div>
  );
}

/** Tant qu'on ne roule pas : où poser le pouce ; les côtés braquent (direction libre) ou placent (assistée). */
export function Amorce({ libre = true }: { libre?: boolean }) {
  return (
    <div className="drive-amorce" aria-hidden="true">
      <i className="drive-amorce-rond" />
      <b>Pose ton pouce</b>
      <small>haut : gaz · bas : frein · côtés : {libre ? 'tourner' : 'placement'}</small>
    </div>
  );
}

/**
 * Un bouton qui répond au premier doigt (click, clavier) comme à un second doigt posé pendant que le
 * premier tient le manche (relâché sur le bouton) ; jamais deux fois pour un même appui.
 */
export function useAppui(action: () => void) {
  const held = useRef<number | null>(null);
  const firedAt = useRef(-1e9);
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>) => {
      event.stopPropagation();
      if (event.pointerType === 'touch' && !event.isPrimary) held.current = event.pointerId;
    },
    onPointerUp: (event: ReactPointerEvent<HTMLElement>) => {
      if (held.current !== event.pointerId) return;
      held.current = null;
      firedAt.current = performance.now();
      action();
    },
    onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => {
      if (held.current === event.pointerId) held.current = null;
    },
    onClick: () => {
      if (performance.now() - firedAt.current < 700) return;
      action();
    },
  };
}

/** Un bouton maintenu (GAZ, FREIN) : tenu tant que son doigt reste posé ; data-appui pour les parcours. */
export function BoutonTenu({ nom, className, onChange, children }: { nom: string; className: string; onChange: (on: boolean) => void; children: ReactNode }) {
  const [doigt, setDoigt] = useState<number | null>(null);
  const lacher = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (doigt !== event.pointerId) return;
    setDoigt(null);
    onChange(false);
  };
  return (
    <button
      type="button"
      className={className}
      aria-label={nom}
      aria-pressed={doigt !== null}
      data-appui={doigt !== null}
      onPointerDown={(event) => {
        event.stopPropagation();
        if (doigt !== null) return;
        event.currentTarget.setPointerCapture?.(event.pointerId);
        setDoigt(event.pointerId);
        onChange(true);
      }}
      onPointerUp={lacher}
      onPointerCancel={lacher}
      onLostPointerCapture={lacher}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        if ((event.key === ' ' || event.key === 'Enter') && !event.repeat) onChange(true);
      }}
      onKeyUp={(event) => {
        if (event.key === ' ' || event.key === 'Enter') onChange(false);
      }}
    >
      {children}
    </button>
  );
}
