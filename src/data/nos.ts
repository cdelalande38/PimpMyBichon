// Ce que le NOS montre pendant sa poussée (§ 5.5) : dard bleu à chaque sortie d'échappement, lueur bleue
// sur la chaussée, champ de la caméra qui s'ouvre d'un coup doux, caméra qui recule, léger tremblement au
// début, traits de vitesse et bords teintés à l'écran. La poussée elle-même (force, durée, réserve) est au
// pilote (src/drive/pilote.ts, `PILOT.nos`) : rien ici ne la change. Tout part de `motion.boost` (0 à 1,
// monté et descendu par le pilote en 0,25 s) et du temps depuis l'envoi.
// Le moteur de la scène avance `liveNos` une fois par image (src/drive/scene/moteur.ts) ; la caméra
// (src/drive/cameras.ts), les dards (src/drive/scene/nos.ts) et l'écran (src/ui/drive/NosEffet.tsx) le
// lisent. « Moins de mouvement » : ni champ, ni recul, ni tremblement, ni traits ; dards, lueur et une
// teinte discrète seulement. Sans allocation.

import type { Moment } from './moments.ts';

export const NOS_RENDU = {
  /**
   * Dard à chaque sortie : longueur et demi-largeur au plus fort (m, serré à la bouche), longueur apparente
   * gardée vu dans l'axe (en largeurs ; le dard s'allonge le long de son axe, trois fois au plus), éclat du corps bleu, éclat du cœur blanc, voile sur le fond.
   */
  dard: { longueur: 2.2, largeur: 0.12, etire: 6, eclat: 2.4, coeur: 2, voile: 1.4 },
  /** Lueur sur la chaussée derrière les sorties : longueur et largeur (m), recul de son centre (m), force. */
  lueur: { longueur: 3.2, largeur: 2, recul: 1.1, force: 0.6 },
  /** Caméra : champ ajouté à l'envoi (°) et sa retombée (s), recul (m), tremblement (m) et sa retombée (s). */
  camera: { coup: 6, coupTau: 0.45, recul: 0.9, tremble: 0.05, trembleTau: 0.35 },
  /**
   * Écran : teinte des bords au plus fort (0 à 1), la même en « moins de mouvement » ; traits de vitesse
   * selon le moment (couleur du trait, liseré qui le détache du fond, épaisseur en px) : clairs de nuit,
   * bleu soutenu cerné de sombre de jour, sur un ciel et une route clairs.
   */
  ecran: {
    teinte: 0.85,
    teinteReduite: 0.35,
    traits: {
      nuit: { couleur: 'rgba(225, 238, 255, 0.9)', ombre: 'rgba(10, 20, 60, 0.35)', epaisseur: 3 },
      jour: { couleur: 'rgba(28, 72, 240, 0.95)', ombre: 'rgba(4, 10, 48, 0.6)', epaisseur: 5 },
    } satisfies Record<Moment, { couleur: string; ombre: string; epaisseur: number }>,
  },
} as const;

/** Sous cette poussée, rien n'est dessiné ni calculé. */
export const NOS_SEUIL = 0.005;

export interface EffetNos {
  /** Poussée en cours (le pilote pousse). */
  actif: boolean;
  /** Temps depuis l'envoi (s ; Infinity sans poussée). */
  depuis: number;
  /** Force des dards et de la lueur (0 à 1). */
  force: number;
  /** Champ ajouté à la caméra (°), recul (m) et tremblement (m). */
  fov: number;
  recul: number;
  tremble: number;
  /** Teinte des bords et traits de vitesse à l'écran (0 à 1). */
  teinte: number;
  traits: number;
}

export function effetNosRepos(): EffetNos {
  return { actif: false, depuis: Infinity, force: 0, fov: 0, recul: 0, tremble: 0, teinte: 0, traits: 0 };
}

/** L'effet de la sortie en cours, avancé par le moteur de la scène, lu par la caméra, la scène et l'écran. */
export const liveNos: EffetNos = effetNosRepos();

/**
 * Avance l'effet de `dt` secondes : `pousse` (le pilote pousse), `boost` (0 à 1, `motion.boost`),
 * `reduit` (moins de mouvement). Réécrit `e` sur place.
 */
export function suivreNos(e: EffetNos, pousse: boolean, boost: number, dt: number, reduit: boolean): EffetNos {
  const pas = Number.isFinite(dt) ? Math.max(0, dt) : 0;
  if (pousse && !e.actif) e.depuis = 0;
  else if (pousse) e.depuis += pas;
  e.actif = pousse;
  const b = Number.isFinite(boost) ? Math.min(1, Math.max(0, boost)) : 0;
  if (b < NOS_SEUIL) {
    if (!pousse) e.depuis = Infinity;
    e.force = e.fov = e.recul = e.tremble = e.teinte = e.traits = 0;
    return e;
  }
  const C = NOS_RENDU.camera;
  e.force = b;
  e.teinte = b * (reduit ? NOS_RENDU.ecran.teinteReduite : NOS_RENDU.ecran.teinte);
  if (reduit) {
    e.fov = e.recul = e.tremble = e.traits = 0;
    return e;
  }
  // Le coup de champ et le tremblement retombent après l'envoi ; le recul tient toute la poussée.
  const depuis = Number.isFinite(e.depuis) ? e.depuis : Infinity;
  e.fov = C.coup * b * Math.exp(-depuis / C.coupTau);
  e.tremble = C.tremble * b * Math.exp(-depuis / C.trembleTau);
  e.recul = C.recul * b;
  e.traits = b;
  return e;
}
