// Lecteur des sons de moteur (src/audio/engine/) : choix des boucles selon le régime, gains de
// fondu, bornes de playbackRate, montée du régime, régime d'après la vitesse ; et contrôle statique :
// aucune source synthétique dans la chaîne moteur (§ 9).

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RATE_MAX,
  RATE_MIN,
  loadGain,
  loopLevels,
  playbackRateFor,
  rpmFromSpeed,
  rpmRange,
  stepRpm,
} from '../../src/audio/engine/mix.ts';
import { soundCreditsText } from '../../src/audio/engine/manifeste.ts';
import { findSynthesis } from '../../tools/lib/audio.mjs';

const LOOPS = [{ regime: 1000 }, { regime: 2500 }, { regime: 4000 }, { regime: 5500 }];

describe('accord des boucles', () => {
  it('borne playbackRate à ± 25 % autour du régime enregistré', () => {
    expect(playbackRateFor(2000, 2000)).toBe(1);
    expect(playbackRateFor(2200, 2000)).toBeCloseTo(1.1);
    expect(playbackRateFor(9000, 2000)).toBe(RATE_MAX);
    expect(playbackRateFor(100, 2000)).toBe(RATE_MIN);
    expect(RATE_MIN).toBe(0.75);
    expect(RATE_MAX).toBe(1.25);
  });

  it('joue les deux boucles voisines qui encadrent le régime, à puissance constante', () => {
    for (const rpm of [1000, 1300, 2000, 2500, 3100, 4700, 5500]) {
      const levels = loopLevels(rpm, LOOPS);
      const audible = levels.filter((level) => level.gain > 1e-6);
      expect(audible.length).toBeGreaterThanOrEqual(1);
      expect(audible.length).toBeLessThanOrEqual(2);
      const power = levels.reduce((sum, level) => sum + level.gain ** 2, 0);
      expect(power).toBeCloseTo(1, 6);
      if (audible.length === 2) {
        const [a, b] = audible;
        expect(Math.abs(a!.index - b!.index)).toBe(1);
        expect(LOOPS[a!.index]!.regime).toBeLessThanOrEqual(rpm);
        expect(LOOPS[b!.index]!.regime).toBeGreaterThanOrEqual(rpm);
      }
      for (const level of levels) {
        expect(level.rate).toBeGreaterThanOrEqual(RATE_MIN);
        expect(level.rate).toBeLessThanOrEqual(RATE_MAX);
      }
    }
  });

  it('au régime d’une boucle, elle seule sonne, sans accord', () => {
    const levels = loopLevels(2500, LOOPS);
    expect(levels[1]!.gain).toBeCloseTo(1, 6);
    expect(levels[1]!.rate).toBeCloseTo(1, 6);
    expect(levels[0]!.gain + levels[2]!.gain + levels[3]!.gain).toBeCloseTo(0, 6);
  });

  it('au milieu de deux voisines, gains égaux (cos et sin de 45°)', () => {
    const levels = loopLevels(3250, LOOPS);
    expect(levels[1]!.gain).toBeCloseTo(Math.SQRT1_2, 6);
    expect(levels[2]!.gain).toBeCloseTo(Math.SQRT1_2, 6);
  });

  it('hors de la plage : la boucle la plus proche, accordée dans ses bornes', () => {
    const below = loopLevels(500, LOOPS);
    expect(below[0]!.gain).toBe(1);
    expect(below[0]!.rate).toBe(RATE_MIN);
    const above = loopLevels(9000, LOOPS);
    expect(above[3]!.gain).toBe(1);
    expect(above[3]!.rate).toBe(RATE_MAX);
  });

  it('mélange les couches en charge et en décélération selon la charge', () => {
    const loops = [
      { regime: 2000, couche: 'on' as const },
      { regime: 2000, couche: 'off' as const },
      { regime: 1000 },
    ];
    const full = loopLevels(2000, loops, 1);
    expect(full[0]!.gain).toBeCloseTo(1, 6);
    expect(full[1]!.gain).toBeCloseTo(0, 6);
    const lift = loopLevels(2000, loops, 0);
    expect(lift[0]!.gain).toBeCloseTo(0, 6);
    expect(lift[1]!.gain).toBeCloseTo(1, 6);
  });

  it('plage jouable : du ralenti à la plus haute boucle + 25 %', () => {
    expect(rpmRange(LOOPS, 1000)).toEqual({ min: 1000, max: 5500 * 1.25 });
    expect(rpmRange([{ regime: 850 }], 850)).toEqual({ min: 850, max: 850 * 1.25 });
  });
});

describe('régime', () => {
  it('monte tant qu’on appuie, retombe quand on lâche, à vitesse bornée', () => {
    let rpm = 1000;
    for (let i = 0; i < 10; i += 1) rpm = stepRpm(rpm, 6000, 0.04);
    expect(rpm).toBeCloseTo(1000 + 4500 * 0.4, 6);
    for (let i = 0; i < 100; i += 1) rpm = stepRpm(rpm, 6000, 0.04);
    expect(rpm).toBe(6000);
    rpm = stepRpm(rpm, 1000, 0.5);
    expect(rpm).toBe(6000 - 3000 * 0.5);
    for (let i = 0; i < 100; i += 1) rpm = stepRpm(rpm, 1000, 0.04);
    expect(rpm).toBe(1000);
  });

  it('gain de charge : −4 dB à vide, 0 dB à fond', () => {
    expect(loadGain(1)).toBeCloseTo(1, 6);
    expect(loadGain(0)).toBeCloseTo(10 ** (-4 / 20), 6);
  });

  it('d’après la vitesse : boîte automatique, régime borné, rapport qui monte', () => {
    const options = { idle: 900, maxRpm: 6000, topSpeed: 50, gears: 5 };
    expect(rpmFromSpeed(0, options)).toEqual({ rpm: 900, gear: 1 });
    const gears = [5, 15, 25, 35, 45].map((v) => rpmFromSpeed(v, options).gear);
    expect(gears).toEqual([1, 2, 3, 4, 5]);
    for (let v = 0; v <= 60; v += 2.5) {
      const { rpm } = rpmFromSpeed(v, options);
      expect(rpm).toBeGreaterThanOrEqual(900);
      expect(rpm).toBeLessThanOrEqual(6000);
    }
    // Passage de rapport : le régime chute.
    expect(rpmFromSpeed(10.5, options).rpm).toBeLessThan(rpmFromSpeed(9.5, options).rpm);
  });
});

describe('crédits des sons', () => {
  it('cite auteur, source et licence, sans adresse', () => {
    const text = soundCreditsText([{ famille: 'x', nom: 'Le moteur', auteur: 'Quelqu’un', licence: 'CC-BY-4.0', source: 'Freesound 1', emplacements: ['start', 'rev-1', 'rev-2'] }]);
    expect(text).toContain('Le moteur, démarrage et coups de gaz : prise de Quelqu’un (Freesound 1), CC BY 4.0.');
    expect(text).not.toMatch(/https?:|www\./);
    expect(soundCreditsText([])).toBe('');
  });
});

describe('aucune source synthétique dans src/audio/engine/', () => {
  const dir = join(process.cwd(), 'src', 'audio', 'engine');
  const files = readdirSync(dir).filter((name) => /\.(ts|tsx|js|mjs)$/.test(name));
  // Au-delà des oscillateurs (tools/lib/audio.mjs) : pas de tampon écrit à la main, pas de
  // traitement échantillon par échantillon, pas de bruit fabriqué.
  const HANDMADE = /createBuffer\s*\(|new\s+AudioBuffer\b|getChannelData|copyToChannel|createScriptProcessor|AudioWorklet|Math\.random\(\)\s*\*\s*2\s*-\s*1/;

  it('a des fichiers à contrôler', () => {
    expect(files).toContain('lecteur.ts');
  });

  for (const name of files) {
    it(`${name} : ni oscillateur, ni onde périodique, ni source constante, ni tampon fabriqué`, () => {
      const text = readFileSync(join(dir, name), 'utf8');
      for (const line of text.split('\n')) {
        expect(findSynthesis(line), line).toEqual([]);
        expect(HANDMADE.test(line), line).toBe(false);
      }
    });
  }
});
