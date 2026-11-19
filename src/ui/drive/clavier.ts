// Pilotage au clavier de la sortie (demande du 19 novembre 2026 : « pouvoir utiliser des touches clavier
// pour piloter » sur un ordinateur). Logique pure, sans DOM : la table des touches, ce qui est tenu, et le
// braquage qui monte et revient en douceur (une touche est tout ou rien, un volant non).
//
// Les touches sont reconnues par leur PLACE sur le clavier (`KeyboardEvent.code`), pas par leur lettre :
// les flèches, et le pavé de la main gauche, qui se lit Z Q S D sur un clavier français et W A S D sur un
// clavier anglais : ce sont les mêmes touches. Espace ou Maj : le NOS.

import type { LectureManche } from './manche.ts';

export type ActionClavier = 'gaz' | 'frein' | 'gauche' | 'droite' | 'nos';

/** Place de la touche (`event.code`) → ce qu'elle commande. */
export const TOUCHES: Readonly<Record<string, ActionClavier>> = {
  ArrowUp: 'gaz',
  KeyW: 'gaz',
  ArrowDown: 'frein',
  KeyS: 'frein',
  ArrowLeft: 'gauche',
  KeyA: 'gauche',
  ArrowRight: 'droite',
  KeyD: 'droite',
  Space: 'nos',
  ShiftLeft: 'nos',
  ShiftRight: 'nos',
};

/** Touches qui lancent la course depuis l'aperçu, ou rendent le volant sous le pilote automatique. */
export const TOUCHES_LANCEMENT: readonly string[] = ['Enter', 'NumpadEnter', 'Space', 'ArrowUp', 'KeyW'];

/** Vitesses du braquage au clavier, en course du volant par seconde (1 = de l'axe à la butée). */
export const CLAVIER = { braquage: 3.5, retour: 6 } as const;

/** Ce que le clavier tient ; plusieurs touches peuvent commander la même chose (flèche et lettre). */
export interface EtatClavier {
  /** Places des touches tenues. */
  tenues: Set<string>;
  /** Braquage courant, de −1 (à gauche) à 1 (à droite). */
  steer: number;
}

export function etatClavierVide(): EtatClavier {
  return { tenues: new Set(), steer: 0 };
}

export function actionDe(code: string): ActionClavier | null {
  return Object.prototype.hasOwnProperty.call(TOUCHES, code) ? (TOUCHES[code] ?? null) : null;
}

/** Une touche enfoncée ; rend son action si c'est une touche de conduite qui n'était pas déjà tenue. */
export function appuyer(etat: EtatClavier, code: string): ActionClavier | null {
  const action = actionDe(code);
  if (!action || etat.tenues.has(code)) return null;
  etat.tenues.add(code);
  return action;
}

/** Une touche relâchée. */
export function relacher(etat: EtatClavier, code: string): void {
  etat.tenues.delete(code);
}

/** Tout lâché d'un coup (fenêtre qui perd la main, pause, réglages ouverts) ; le braquage revient à l'axe. */
export function toutRelacher(etat: EtatClavier): void {
  etat.tenues.clear();
  etat.steer = 0;
}

/** Vrai si une touche tenue commande `action`. */
export function tient(etat: EtatClavier, action: ActionClavier): boolean {
  for (const code of etat.tenues) if (TOUCHES[code] === action) return true;
  return false;
}

/**
 * Avance le braquage de `dt` secondes vers ce que tiennent les touches et écrit la lecture dans `out`
 * (gaz et frein : tout ou rien). Rend vrai tant que le clavier donne quelque chose (une touche de
 * conduite tenue, ou un braquage pas encore revenu à l'axe).
 */
export function avancerClavier(etat: EtatClavier, dt: number, out: LectureManche): boolean {
  const gaz = tient(etat, 'gaz');
  const frein = tient(etat, 'frein');
  const cible = (tient(etat, 'droite') ? 1 : 0) - (tient(etat, 'gauche') ? 1 : 0);
  const pas = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;
  // On revient vite (touche lâchée, ou braquage inversé), on braque un peu moins vite.
  const revient = cible === 0 || Math.sign(cible) !== Math.sign(etat.steer);
  const vitesse = revient && etat.steer !== 0 ? CLAVIER.retour : CLAVIER.braquage;
  const ecart = cible - etat.steer;
  const avance = Math.min(Math.abs(ecart), vitesse * pas);
  etat.steer = Math.abs(ecart) <= avance ? cible : etat.steer + Math.sign(ecart) * avance;
  out.throttle = gaz ? 1 : 0;
  out.brake = frein ? 1 : 0;
  out.steer = etat.steer;
  return gaz || frein || cible !== 0 || etat.steer !== 0;
}
