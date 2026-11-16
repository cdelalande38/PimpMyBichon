// Calculs du mélange des boucles d'un moteur (§ 9) : logique pure, testée par
// tests/unit/sons-lecteur.test.ts. Le lecteur (lecteur.ts) applique ces valeurs aux gains et aux
// playbackRate de sources Web Audio qui lisent des enregistrements réels.

/** Écart maximal de playbackRate autour du régime enregistré : ± 25 % (§ 9). */
export const RATE_MIN = 0.75;
export const RATE_MAX = 1.25;

/** Accord d'une boucle : rapport du régime voulu au régime enregistré, borné à ± 25 %. */
export function playbackRateFor(rpm: number, loopRpm: number): number {
  if (!(loopRpm > 0) || !Number.isFinite(rpm)) return 1;
  return Math.min(RATE_MAX, Math.max(RATE_MIN, rpm / loopRpm));
}

export interface LoopLevel {
  /** Rang de la boucle dans la liste reçue. */
  index: number;
  /** Gain linéaire, de 0 à 1 (fondu à puissance constante entre deux voisines). */
  gain: number;
  rate: number;
}

interface LoopLike {
  regime: number;
  couche?: 'on' | 'off';
}

/**
 * Gain et accord de chaque boucle pour un régime et une charge (0 : décélération, 1 : plein gaz).
 * Les boucles d'une même couche sont triées par régime ; on joue les deux voisines qui encadrent le
 * régime, en fondu à puissance constante, chacune accordée vers le régime voulu dans la limite de
 * ± 25 %. Hors de la plage, la boucle la plus proche seule. Les couches « on » et « off », quand il y
 * en a, se mélangent selon la charge ; une boucle sans couche sert aux deux.
 */
export function loopLevels(rpm: number, loops: readonly LoopLike[], load = 0.5): LoopLevel[] {
  const levels: LoopLevel[] = loops.map((_, index) => ({ index, gain: 0, rate: 1 }));
  const charge = Math.min(1, Math.max(0, Number.isFinite(load) ? load : 0.5));
  const layers: { filter: (loop: LoopLike) => boolean; weight: number }[] = [];
  const hasOn = loops.some((loop) => loop.couche === 'on');
  const hasOff = loops.some((loop) => loop.couche === 'off');
  if (hasOn && hasOff) {
    layers.push({ filter: (loop) => loop.couche !== 'off', weight: Math.sin((charge * Math.PI) / 2) });
    layers.push({ filter: (loop) => loop.couche !== 'on', weight: Math.cos((charge * Math.PI) / 2) });
  } else {
    layers.push({ filter: () => true, weight: 1 });
  }
  for (const layer of layers) {
    const members = loops
      .map((loop, index) => ({ loop, index }))
      .filter(({ loop }) => layer.filter(loop))
      .sort((a, b) => a.loop.regime - b.loop.regime);
    if (members.length === 0) continue;
    const first = members[0]!;
    const last = members[members.length - 1]!;
    const put = (member: { loop: LoopLike; index: number }, gain: number) => {
      const level = levels[member.index]!;
      level.gain = Math.min(1, Math.hypot(level.gain, gain * layer.weight));
      level.rate = playbackRateFor(rpm, member.loop.regime);
    };
    if (rpm <= first.loop.regime) {
      put(first, 1);
      continue;
    }
    if (rpm >= last.loop.regime) {
      put(last, 1);
      continue;
    }
    for (let i = 0; i < members.length - 1; i += 1) {
      const low = members[i]!;
      const high = members[i + 1]!;
      if (rpm >= low.loop.regime && rpm <= high.loop.regime) {
        const t = (rpm - low.loop.regime) / (high.loop.regime - low.loop.regime);
        put(low, Math.cos((t * Math.PI) / 2));
        put(high, Math.sin((t * Math.PI) / 2));
        break;
      }
    }
  }
  for (const level of levels) if (level.gain === 0) level.rate = playbackRateFor(rpm, loops[level.index]!.regime);
  return levels;
}

/** Plage de régime jouable avec ces boucles : du ralenti à la plus haute boucle accordée à + 25 %. */
export function rpmRange(loops: readonly LoopLike[], idle: number): { min: number; max: number } {
  const top = loops.reduce((max, loop) => Math.max(max, loop.regime), idle);
  return { min: idle, max: top * RATE_MAX };
}

/** Montée et retombée du régime au coup de gaz du garage, en tr/min par seconde. */
export const RPM_RISE = 4500;
export const RPM_FALL = 3000;

/** Le régime suit sa cible, à vitesse bornée : monte tant qu'on appuie, retombe quand on lâche. */
export function stepRpm(current: number, target: number, dt: number, rise = RPM_RISE, fall = RPM_FALL): number {
  if (!(dt > 0)) return current;
  if (target > current) return Math.min(target, current + rise * dt);
  return Math.max(target, current - fall * dt);
}

/** Gain d'ensemble selon la charge : un moteur en charge sonne plus fort (−4 dB à vide). */
export function loadGain(load: number): number {
  const charge = Math.min(1, Math.max(0, Number.isFinite(load) ? load : 0));
  return 10 ** ((-4 + 4 * charge) / 20);
}

/** Décibels vers gain linéaire. */
export function dbToGain(db: number): number {
  return Number.isFinite(db) ? 10 ** (db / 20) : 1;
}

/**
 * Régime d'après la vitesse, pour la sortie de nuit (§ 9, « Sur la route ») : boîte automatique
 * à `gears` rapports, qui passe le rapport supérieur à `shiftRpm` et rétrograde sous `downRpm`. La
 * vitesse est répartie de façon linéaire : rapport n couvre jusqu'à topSpeed × n / gears. Rend aussi
 * le rapport engagé (la chute de régime au passage vient de là).
 */
export function rpmFromSpeed(
  speed: number,
  options: { idle: number; maxRpm: number; topSpeed: number; gears?: number },
): { rpm: number; gear: number } {
  const gears = Math.max(1, Math.round(options.gears ?? 5));
  const v = Math.max(0, Number.isFinite(speed) ? speed : 0);
  const top = Math.max(1, options.topSpeed);
  const span = top / gears;
  const gear = Math.min(gears, Math.max(1, Math.ceil(v / span)));
  // Dans un rapport, le régime va de ≈ 55 % à 100 % du maximum ; au départ, du ralenti.
  const within = (v - (gear - 1) * span) / span;
  const low = gear === 1 ? options.idle : options.maxRpm * 0.55;
  const rpm = low + (options.maxRpm - low) * Math.min(1, Math.max(0, within));
  return { rpm: Math.max(options.idle, rpm), gear };
}
