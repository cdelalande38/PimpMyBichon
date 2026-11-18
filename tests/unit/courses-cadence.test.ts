// Constat de la vague R (captures/notes-agents/vague-r-ci.md) : « en course à la main, sur une machine
// bridée à une image par seconde, la scène n'avance que d'environ 0,028 s de route par image, contre 0,1 s
// dans l'aperçu ». Établi ici : le pas de temps de la course à la main n'est pas plafonné plus bas que
// celui de l'aperçu. Les deux passent par la même chaîne : `stepOf` (src/drive/scene/profil.ts, 0,1 s au
// plus), le pas du pilote (src/drive/pilote.ts, 0,1 s au plus, en sous-pas de 1/120 s) et `pasDepart`.
// De 20 à 60 images par seconde (et jusqu'à 10), chaque seconde d'horloge fait une seconde de route, dans
// l'aperçu comme en course : un téléphone à 30 images par seconde ne court pas au ralenti.
// Le plafond de 0,1 s par image ne coûte du temps que sur les images de plus de 0,1 s, dans les deux modes
// pareil : 1 s de route pour 10 images à 1 image par seconde, 0,03 s par image si une longue image de
// plusieurs secondes alterne avec cinq courtes (ce que donne un rendu logiciel qui décroche par à-coups) ;
// voir le rendu de la vague S (agent « courses ») pour la mesure en navigateur.

import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import type { DriveInput } from '../../src/drive/contrat.ts';
import { armerDepart, createDepart, pasDepart } from '../../src/drive/depart.ts';
import { createPilot } from '../../src/drive/pilote.ts';
import { createRail } from '../../src/drive/rail.ts';
import { stepOf } from '../../src/drive/scene/profil.ts';

const FILE = 'public/assets/maps/monaco-circuit/route.json';
const AUTO: DriveInput = { auto: true, throttle: 0, brake: 0, lane: 0 };
const GAZ: DriveInput = { auto: false, throttle: 1, brake: 0, lane: 0, assist: true };

type Mode = 'apercu' | 'course';

/**
 * La chaîne d'une image de la scène (src/drive/scene/moteur.ts, frame) rejouée sans rendu : `durees`
 * (s d'horloge de chaque image, répétées) pendant `horloge` s. Rend le temps de route (chrono) écoulé
 * après le départ, par seconde d'horloge, et par image.
 */
function chaine(mode: Mode, durees: readonly number[], horloge: number): { parSeconde: number; parImage: number; metres: number } {
  const route = JSON.parse(readFileSync(FILE, 'utf8')) as MapRoute;
  const rail = createRail(route);
  const pilot = createPilot(rail);
  pilot.setWeather('sec');
  pilot.reset(0);
  const etat = armerDepart(createDepart(), 0, rail.loop, mode === 'apercu', mode === 'course' ? 3 : 0);
  const input = mode === 'apercu' ? AUTO : GAZ;
  let t = 0;
  let i = 0;
  let debut = -1;
  let chrono0 = 0;
  let s0 = 0;
  let images = 0;
  while (t < horloge) {
    const delta = durees[i % durees.length] ?? 0;
    i += 1;
    t += delta;
    const dt = stepOf(delta, false, false);
    pilot.setHold(etat.phase === 'attente' || etat.phase === 'feux');
    const motion = pilot.step(dt, input, 'car');
    pasDepart(etat, dt, true, motion.s, rail, motion.finished);
    if (debut < 0 && etat.phase === 'parti') {
      debut = t;
      chrono0 = etat.chrono;
      s0 = motion.s;
      images = 0;
    } else if (debut >= 0) images += 1;
  }
  const route1 = (etat.chrono - chrono0) / 1000;
  return { parSeconde: route1 / (t - debut), parImage: route1 / Math.max(1, images), metres: pilot.motion.s - s0 };
}

describe.skipIf(!existsSync(FILE))('cadence : temps de route par seconde d’horloge, aperçu et course', () => {
  it('de 10 à 60 images par seconde, une seconde d’horloge fait une seconde de route, dans les deux modes', () => {
    for (const fps of [10, 20, 24, 30, 45, 60]) {
      for (const mode of ['apercu', 'course'] as const) {
        const { parSeconde } = chaine(mode, [1 / fps], 20);
        expect(parSeconde, `${mode} à ${fps} i/s`).toBeCloseTo(1, 2);
      }
    }
  });

  it('cadence irrégulière d’un téléphone (de 16 à 90 ms) : rien de perdu', () => {
    const durees = [0.016, 0.033, 0.016, 0.09, 0.016, 0.05, 0.033];
    for (const mode of ['apercu', 'course'] as const) expect(chaine(mode, durees, 20).parSeconde, mode).toBeCloseTo(1, 2);
  });

  it('au-delà de 0,1 s par image, les deux modes perdent pareil : le plafond est le même', () => {
    // Une image par seconde, régulière : 0,1 s de route par image, aperçu comme course.
    const lent = { apercu: chaine('apercu', [1], 60), course: chaine('course', [1], 60) };
    expect(lent.apercu.parImage).toBeCloseTo(0.1, 3);
    expect(lent.course.parImage).toBeCloseTo(0.1, 3);
    // Une longue image de 5 s puis cinq courtes : ≈ 0,03 s de route par image, dans les deux modes.
    const motif = [5, 0.016, 0.016, 0.016, 0.016, 0.016];
    const hache = { apercu: chaine('apercu', motif, 400), course: chaine('course', motif, 400) };
    expect(hache.apercu.parImage).toBeCloseTo(0.03, 2);
    expect(hache.course.parImage).toBeCloseTo(hache.apercu.parImage, 3);
  });
});
