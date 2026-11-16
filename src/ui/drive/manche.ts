// Le manche virtuel de la sortie de nuit (§ 5.5), en calcul pur : du déplacement du pouce depuis la
// base du manche (pixels CSS, y vers le bas) aux commandes du pilote. Vers le haut, le gaz ; vers le
// bas, le frein ; sur les côtés, la direction (braquage, ou placement en direction assistée) ; chacun progressif de 0 à 1 au-delà d'une zone morte
// centrale, à fond au bord du rayon. Le bouton dessiné suit le doigt sans sortir du rayon. Une
// manette physique (API Gamepad, disposition standard) se lit de la même façon (`lireManettePhysique`).

/** Rayon du manche (px CSS) et zone morte centrale (part du rayon, sur chaque axe). */
export const MANCHE = { rayon: 56, morte: 0.16 } as const;

export interface LectureManche {
  /** Gaz, de 0 à 1. */
  throttle: number;
  /** Frein, de 0 à 1. */
  brake: number;
  /** Direction, de −1 (à gauche) à 1 (à droite) : braquage, ou placement en direction assistée. */
  steer: number;
}

/** Un axe, de −1 à 1, avec sa zone morte : 0 dedans, puis progressif jusqu'à 1 au bord. */
export function axeManche(value: number, morte: number = MANCHE.morte): number {
  if (!Number.isFinite(value)) return 0;
  const v = Math.max(-1, Math.min(1, value));
  const m = Math.max(0, Math.min(0.9, morte));
  const a = Math.abs(v);
  if (a <= m) return 0;
  return Math.sign(v) * Math.min(1, (a - m) / (1 - m));
}

/** Le bouton, ramené dans le rayon : [x, y] en px depuis la base. */
export function boutonManche(dx: number, dy: number, rayon: number = MANCHE.rayon, out: [number, number] = [0, 0]): [number, number] {
  const x = Number.isFinite(dx) ? dx : 0;
  const y = Number.isFinite(dy) ? dy : 0;
  const d = Math.hypot(x, y);
  const k = d > rayon && d > 0 ? rayon / d : 1;
  out[0] = x * k;
  out[1] = y * k;
  return out;
}

/** Commandes lues sur le manche : déplacement (px, y vers le bas) depuis la base. */
export function lireManche(dx: number, dy: number, rayon: number = MANCHE.rayon, morte: number = MANCHE.morte, out?: LectureManche): LectureManche {
  const r = rayon > 0 ? rayon : MANCHE.rayon;
  const [x, y] = boutonManche(dx, dy, r);
  const vertical = axeManche(-y / r, morte);
  const result = out ?? { throttle: 0, brake: 0, steer: 0 };
  result.throttle = Math.max(0, vertical);
  result.brake = Math.max(0, -vertical);
  result.steer = axeManche(x / r, morte);
  return result;
}

/** Ce qu'une manette physique (API Gamepad, disposition standard) donne à lire. */
export interface ManettePhysique {
  readonly axes: readonly number[];
  readonly buttons: readonly { readonly value: number; readonly pressed: boolean }[];
}

/** Zone morte du manche gauche d'une manette physique, et des gâchettes. */
export const MANETTE_PHYSIQUE = { morte: 0.15, gachette: 0.05 } as const;

/**
 * Manette physique, disposition standard : manche gauche horizontal (axe 0) le placement, gâchette
 * droite (bouton 7) le gaz, gâchette gauche (bouton 6) le frein, bouton du bas (0) le NOS.
 */
export function lireManettePhysique(pad: ManettePhysique, out: LectureManche & { nos: boolean }): LectureManche & { nos: boolean } {
  out.steer = axeManche(pad.axes[0] ?? 0, MANETTE_PHYSIQUE.morte);
  out.throttle = gachette(pad, 7);
  out.brake = gachette(pad, 6);
  out.nos = pad.buttons[0]?.pressed ?? false;
  return out;
}

function gachette(pad: ManettePhysique, index: number): number {
  const b = pad.buttons[index];
  const v = b ? (Number.isFinite(b.value) ? b.value : b.pressed ? 1 : 0) : 0;
  return v < MANETTE_PHYSIQUE.gachette ? 0 : Math.min(1, v);
}
