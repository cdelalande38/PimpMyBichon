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
// - `useClavier`, `useToucheLancement` : sur un ordinateur, les flèches ou le pavé Z Q S D conduisent,
//   Espace ou Maj tire le NOS, Entrée lance la course (./clavier.ts ; demande du 19 novembre 2026).

import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode, type RefObject } from 'react';
import { useDrive } from '../../state/drive.ts';
import { appuyer, avancerClavier, etatClavierVide, relacher, TOUCHES_LANCEMENT, toutRelacher } from './clavier.ts';
import { useBoucleImage } from './CompteTours.tsx';
import { boutonDeLancement, boutonManche, lireManche, lireManettePhysique, MANCHE, type LectureManche } from './manche.ts';
import { premiereManette } from './manette.ts';

/** Ce que tiennent les doigts, à la main. */
export const MANUEL: { stick: LectureManche; pad: LectureManche & { nos: boolean }; clavier: LectureManche & { tenu: boolean }; gaz: boolean; frein: boolean } = {
  stick: { throttle: 0, brake: 0, steer: 0 },
  pad: { throttle: 0, brake: 0, steer: 0, nos: false },
  clavier: { throttle: 0, brake: 0, steer: 0, tenu: false },
  gaz: false,
  frein: false,
};

/**
 * Écrit dans le store ce que tiennent les doigts ; `steer` absent quand rien ne braque (pédales en
 * direction assistée : le placement passe par `lane`).
 */
export function appliquerManuel(manche: boolean): void {
  const m = MANUEL;
  // Le clavier braque aussi aux pédales en direction assistée, tant qu'il tient quelque chose.
  const steer = m.stick.steer !== 0 ? m.stick.steer : m.pad.steer !== 0 ? m.pad.steer : m.clavier.steer;
  useDrive.getState().setManual({
    throttle: Math.max(m.stick.throttle, m.pad.throttle, m.clavier.throttle, m.gaz ? 1 : 0),
    brake: Math.max(m.stick.brake, m.pad.brake, m.clavier.brake, m.frein ? 1 : 0),
    steer: manche || m.clavier.tenu ? steer : undefined,
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
  MANUEL.clavier.throttle = 0;
  MANUEL.clavier.brake = 0;
  MANUEL.clavier.steer = 0;
  MANUEL.clavier.tenu = false;
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
    if (!e.branchee) return;
    if (!main) {
      // Pas à la main : le bouton qui rend le volant (ou lance la course) ne tire pas le NOS en passant.
      e.nos = premiereManette()?.buttons[0]?.pressed ?? false;
      return;
    }
    const pad = premiereManette();
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

/** Vrai si la touche s'adresse à un champ, à un bouton (Espace, Entrée) ou à une fenêtre ouverte : le clavier ne conduit pas. */
function toucheAilleurs(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.altKey || event.metaKey) return true;
  if (document.querySelector('dialog[open]')) return true;
  const cible = event.target instanceof HTMLElement ? event.target : null;
  if (!cible) return false;
  if (cible.isContentEditable || cible.closest('input, textarea, select, [role="slider"]')) return true;
  // Espace et Entrée gardent leur rôle sur un bouton qui a le focus ; les flèches et les lettres conduisent.
  return (event.code === 'Space' || event.code === 'Enter' || event.code === 'NumpadEnter') && cible.closest('button, a[href], [role="button"]') !== null;
}

/**
 * Le clavier, à la main : les flèches ou le pavé de gauche (Z Q S D sur un clavier français) pour le
 * gaz, le frein et la direction, Espace ou Maj pour le NOS (./clavier.ts). Le braquage monte et revient
 * dans la boucle d'image ; rien n'est écrit tant que le clavier ne donne rien.
 */
export function useClavier(main: boolean, manche: boolean): void {
  const etat = useRef(etatClavierVide());
  const suivi = useRef({ vide: true, avant: 0 });
  const aLaMain = useRef(main);
  useEffect(() => {
    aLaMain.current = main;
  });
  useEffect(() => {
    const e = etat.current;
    const enfoncee = (event: KeyboardEvent) => {
      if (toucheAilleurs(event)) return;
      const action = appuyer(e, event.code);
      if (action === null) {
        // Répétition d'une touche tenue : elle ne fait pas défiler la page.
        if (e.tenues.has(event.code)) event.preventDefault();
        return;
      }
      event.preventDefault();
      if (action === 'nos' && aLaMain.current && !event.repeat) useDrive.getState().fireNos();
    };
    const relachee = (event: KeyboardEvent) => relacher(e, event.code);
    const lacher = () => toutRelacher(e);
    const cachee = () => {
      if (document.hidden) lacher();
    };
    window.addEventListener('keydown', enfoncee);
    window.addEventListener('keyup', relachee);
    window.addEventListener('blur', lacher);
    document.addEventListener('visibilitychange', cachee);
    // La boucle d'image s'arrête en pause : une touche lâchée entre-temps ne resterait pas « tenue ».
    const off = useDrive.subscribe((state, previous) => {
      if (state.paused && !previous.paused) lacher();
    });
    return () => {
      window.removeEventListener('keydown', enfoncee);
      window.removeEventListener('keyup', relachee);
      window.removeEventListener('blur', lacher);
      document.removeEventListener('visibilitychange', cachee);
      off();
      lacher();
      MANUEL.clavier.throttle = 0;
      MANUEL.clavier.brake = 0;
      MANUEL.clavier.steer = 0;
      MANUEL.clavier.tenu = false;
    };
  }, []);
  useBoucleImage(() => {
    const s = suivi.current;
    const maintenant = performance.now();
    const dt = s.avant === 0 ? 0 : (maintenant - s.avant) / 1000;
    s.avant = maintenant;
    if (!main) {
      // Pas à la main (aperçu, pilote automatique, arrivée) : le braquage ne s'accumule pas.
      etat.current.steer = 0;
      return;
    }
    const tenu = avancerClavier(etat.current, dt, MANUEL.clavier);
    MANUEL.clavier.tenu = tenu;
    // Écrit tant qu'il donne quelque chose, et une fois encore quand tout est revenu à zéro.
    if (tenu || !s.vide) appliquerManuel(manche);
    s.vide = !tenu;
  });
}

/**
 * Le clavier, hors conduite : Entrée, Espace ou la touche des gaz font comme l'appui sur la route
 * pendant que `actif` est vrai (lancer la course depuis l'aperçu, rendre le volant).
 */
export function useToucheLancement(actif: boolean, quandTouche: () => void): void {
  const rappel = useRef(quandTouche);
  useEffect(() => {
    rappel.current = quandTouche;
  });
  useEffect(() => {
    if (!actif) return;
    const enfoncee = (event: KeyboardEvent) => {
      if (event.repeat || !TOUCHES_LANCEMENT.includes(event.code) || toucheAilleurs(event)) return;
      event.preventDefault();
      rappel.current();
    };
    window.addEventListener('keydown', enfoncee);
    return () => window.removeEventListener('keydown', enfoncee);
  }, [actif]);
}

/**
 * Manette physique, hors conduite : un bouton de face ou Start (front montant, lu à chaque image tant
 * qu'une manette est branchée) appelle `quandBouton` pendant que `actif` est vrai : lancer la course depuis
 * l'aperçu, rendre le volant sous le pilote automatique. Un bouton déjà tenu ne compte pas.
 */
export function useBoutonManette(actif: boolean, quandBouton: () => void): void {
  const etat = useRef({ branchee: false, tenu: false, reprise: true });
  const rappel = useRef(quandBouton);
  useEffect(() => {
    rappel.current = quandBouton;
  });
  useEffect(() => {
    const suivre = () => {
      const branchee = premiereManette() !== null;
      // Chrome ne montre une manette qu'après un appui sur l'un de ses boutons : cet appui-là ne lance rien.
      if (branchee && !etat.current.branchee) etat.current.reprise = true;
      etat.current.branchee = branchee;
    };
    // La boucle s'arrête en pause et page cachée : à la reprise, un bouton déjà tenu ne compte pas.
    const arreter = () => {
      etat.current.reprise = true;
    };
    suivre();
    window.addEventListener('gamepadconnected', suivre);
    window.addEventListener('gamepaddisconnected', suivre);
    document.addEventListener('visibilitychange', arreter);
    const off = useDrive.subscribe((state, previous) => {
      if (state.paused !== previous.paused) arreter();
    });
    return () => {
      window.removeEventListener('gamepadconnected', suivre);
      window.removeEventListener('gamepaddisconnected', suivre);
      document.removeEventListener('visibilitychange', arreter);
      off();
    };
  }, []);
  useBoucleImage(() => {
    const e = etat.current;
    if (!e.branchee) return;
    const pad = premiereManette();
    const presse = pad !== null && boutonDeLancement(pad);
    const front = presse && !e.tenu && !e.reprise;
    e.reprise = false;
    e.tenu = presse;
    if (front && actif && !document.querySelector('dialog[open]')) rappel.current();
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
    <div ref={el} className="drive-manche" aria-hidden="true" data-actif="false" data-gaz="0.00" data-frein="0.00" data-placement="0.00" data-coupures="0" data-reprises="0" style={{ ['--rayon' as string]: `${MANCHE.rayon}px` }}>
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
      <small className="drive-amorce-clavier">au clavier : les flèches ou Z Q S D · Espace : NOS</small>
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
