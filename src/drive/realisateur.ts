// Mode réalisateur (§ 5.5) : enchaîne les plans tout seul, selon ce que fait la route.
//
// - Situations : à l'arrêt, au freinage (un virage arrive : le pilote freine d'avance), dans un
//   virage, en ligne droite, sur route ordinaire. Chacune a ses plans préférés (DIRECTOR.shots) :
//   travelling avant un virage, rasante et embarquée en ligne droite, poursuite et avant dans le virage.
// - Un plan dure entre DIRECTOR.minHold et une durée tirée d'une suite déterministe (aucun hasard :
//   même parcours, mêmes plans). Un changement de situation coupe plus tôt, mais jamais moins de
//   DIRECTOR.minHoldOnEvent secondes après la coupe précédente, et jamais plus d'une coupe par seconde.
// - L'orbite n'est jamais choisie : elle appartient au doigt du joueur.

import type { CameraId, Director, DriveMotion, RailPose } from './contrat.ts';

export type Situation = 'arret' | 'freinage' | 'virage' | 'ligne' | 'route';

export const DIRECTOR = {
  /** Écart le plus court entre deux coupes, en secondes (règle absolue). */
  minGap: 1,
  /** Durée la plus courte d'un plan sans événement, puis la plus longue. */
  minHold: 4,
  maxHold: 9,
  /** Un changement de situation coupe au plus tôt après ce délai. */
  minHoldOnEvent: 2.2,
  /** Seuils : courbure d'un virage et d'une ligne droite (1/m), freinage (m/s²), arrêt (m/s). */
  curve: 1 / 90,
  straight: 1 / 450,
  braking: -1.2,
  stopped: 0.8,
  shots: {
    arret: ['avant', 'rasante', 'poursuite'],
    freinage: ['travelling', 'poursuite'],
    virage: ['poursuite', 'avant', 'travelling'],
    ligne: ['rasante', 'poursuite', 'embarquee', 'travelling', 'avant'],
    route: ['poursuite', 'travelling', 'avant', 'rasante'],
  } satisfies Record<Situation, readonly CameraId[]>,
} as const;

export function situationOf(motion: Pick<DriveMotion, 'speed' | 'accel' | 'finished'>, pose: Pick<RailPose, 'curvature'>): Situation {
  if (motion.finished || motion.speed < DIRECTOR.stopped) return 'arret';
  if (motion.accel < DIRECTOR.braking) return 'freinage';
  const k = Math.abs(pose.curvature);
  if (k > DIRECTOR.curve) return 'virage';
  if (k < DIRECTOR.straight) return 'ligne';
  return 'route';
}

/** Suite déterministe dans [0, 1[ (hachage entier). */
function unit(n: number): number {
  let x = Math.imul(n + 1, 0x9e3779b1);
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

export function createDirector(): Director & { readonly cuts: number } {
  let current: CameraId | null = null;
  let since = 0;
  let cuts = 0;
  let hold = DIRECTOR.minHold;
  let situation: Situation = 'route';

  function choose(next: Situation): CameraId {
    const list = DIRECTOR.shots[next];
    const start = Math.floor(unit(cuts * 7 + 3) * list.length);
    for (let k = 0; k < list.length; k += 1) {
      const candidate = list[(start + k) % list.length]!;
      if (candidate !== current) return candidate;
    }
    return list[0]!;
  }

  function cut(time: number, next: Situation): void {
    current = choose(next);
    since = time;
    cuts += 1;
    hold = DIRECTOR.minHold + unit(cuts * 13 + 1) * (DIRECTOR.maxHold - DIRECTOR.minHold);
    situation = next;
  }

  return {
    get cuts() {
      return cuts;
    },
    pick(time, motion, pose) {
      const now = situationOf(motion, pose);
      // Premier plan, ou temps revenu en arrière (nouvelle sortie) : on repart de zéro.
      if (current === null || time < since) {
        cuts = 0;
        cut(time, now);
        return current as CameraId;
      }
      const held = time - since;
      if (held < DIRECTOR.minGap) return current;
      if ((now !== situation && held >= DIRECTOR.minHoldOnEvent && !(DIRECTOR.shots[now] as readonly CameraId[]).includes(current as CameraId)) || held >= hold) {
        cut(time, now);
      } else if (now !== situation) {
        // Le plan en cours convient aussi à la nouvelle situation : on le garde, sa durée court.
        situation = now;
      }
      return current as CameraId;
    },
    reset() {
      current = null;
      since = 0;
      cuts = 0;
      hold = DIRECTOR.minHold;
      situation = 'route';
    },
  };
}
