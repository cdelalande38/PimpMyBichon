// Petits modules purs : cadrage, qualité, textes, messages du service worker.
import { describe, expect, it } from 'vitest';
import { isPrecacheProgress, PRECACHE_PROGRESS } from '../../src/pwa/messages.ts';
import { precachePercent } from '../../src/pwa/pwaStore.ts';
import { QUALITY_LEVELS, QUALITY_PROFILES, resolveQuality } from '../../src/render/quality.ts';
import { fitCamera, orbitPosition } from '../../src/scene/fit.ts';
import { QUALITY_SETTINGS } from '../../src/state/settings.ts';
import { count, formatBytes, offlineDetail, offlineLabel, typo } from '../../src/ui/labels.ts';

describe('fitCamera', () => {
  it('ouvre le champ et recule en portrait', () => {
    const portrait = fitCamera(390, 844, 1.35);
    const landscape = fitCamera(844, 390, 1.35);
    expect(portrait.fov).toBe(46);
    expect(landscape.fov).toBe(34);
    expect(portrait.distance).toBeGreaterThan(landscape.distance);
  });

  it('fait tenir la demi-longueur dans la largeur de l’écran', () => {
    const { fov, distance } = fitCamera(390, 844, 1.35);
    const horizontalHalf = Math.atan(Math.tan((fov * Math.PI) / 360) * (390 / 844));
    expect(Math.tan(horizontalHalf) * distance).toBeGreaterThanOrEqual(1.35 - 1e-9);
  });

  it('borne le zoom autour de la distance de cadrage', () => {
    const { distance, minDistance, maxDistance } = fitCamera(390, 844, 1.35);
    expect(minDistance).toBeLessThan(distance);
    expect(maxDistance).toBeGreaterThan(distance);
  });

  it('ne casse pas sur une taille nulle', () => {
    const fit = fitCamera(0, 0, 1.35);
    expect(Number.isFinite(fit.distance)).toBe(true);
    expect(fit.distance).toBeGreaterThan(0);
  });
});

describe('orbitPosition', () => {
  it('place la caméra à la bonne distance de sa cible', () => {
    const target = [0, 0.12, 0] as const;
    const [x, y, z] = orbitPosition(target, 7);
    expect(Math.hypot(x - target[0], y - target[1], z - target[2])).toBeCloseTo(7, 9);
    expect(y).toBeGreaterThan(target[1]);
  });
});

describe('qualité', () => {
  it('ne dépasse jamais un pixel ratio de 2 (§ 8)', () => {
    for (const level of QUALITY_LEVELS) {
      expect(QUALITY_PROFILES[level].dprMax).toBeLessThanOrEqual(2);
      expect(QUALITY_PROFILES[level].dprMax).toBeGreaterThanOrEqual(1);
    }
  });

  it('donne un niveau à chaque réglage', () => {
    for (const setting of QUALITY_SETTINGS) {
      expect(QUALITY_LEVELS).toContain(resolveQuality(setting));
    }
    expect(resolveQuality('auto')).toBe('standard');
    expect(resolveQuality('eco')).toBe('eco');
  });
});

describe('messages du service worker', () => {
  it('accepte une progression bien formée', () => {
    expect(isPrecacheProgress({ type: PRECACHE_PROGRESS, done: 3, total: 14 })).toBe(true);
  });

  it('refuse tout le reste', () => {
    const bad: unknown[] = [
      null,
      'pmb:precache',
      { type: 'autre', done: 1, total: 2 },
      { type: PRECACHE_PROGRESS, done: '1', total: 2 },
      { type: PRECACHE_PROGRESS, done: 1, total: 0 },
      { type: PRECACHE_PROGRESS, done: Number.NaN, total: 2 },
    ];
    for (const data of bad) expect(isPrecacheProgress(data)).toBe(false);
  });
});

describe('precachePercent', () => {
  it('reste entre 0 et 100', () => {
    expect(precachePercent({ done: 0, total: 0 })).toBe(0);
    expect(precachePercent({ done: 7, total: 14 })).toBe(50);
    expect(precachePercent({ done: 20, total: 14 })).toBe(100);
    expect(precachePercent({ done: -3, total: 14 })).toBe(0);
  });
});

describe('textes', () => {
  it('nomme l’état hors ligne', () => {
    expect(offlineLabel('pret', true)).toBe('Prêt hors ligne');
    expect(offlineLabel('pret', false)).toBe('Hors ligne · tout est là');
    expect(offlineLabel('preparation', true)).toBe('Préparation du garage…');
    expect(offlineLabel('inconnu', true)).toBe('');
  });

  it('explique l’état hors ligne en toutes lettres', () => {
    expect(offlineDetail('preparation', 42)).toContain('42 %');
    expect(offlineDetail('pret', 100)).toContain('sans réseau');
  });

  it('écrit les poids à la française', () => {
    expect(formatBytes(null)).toBe('inconnu');
    expect(formatBytes(-1)).toBe('inconnu');
    expect(formatBytes(340 * 1024)).toBe('340\u00a0ko');
    expect(formatBytes(1.25 * 1024 * 1024)).toMatch(/^1,[23]\u00a0Mo$/);
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe('3\u00a0Go');
  });

  it('pose les espaces insécables de la typographie française', () => {
    expect(typo('Prêt : tout est là.')).toBe('Prêt\u00a0: tout est là.');
    expect(typo('Le bouton « Installer » est en bas ?')).toBe('Le bouton «\u00a0Installer\u00a0» est en bas\u00a0?');
    expect(typo('42 %')).toBe('42\u00a0%');
    expect(typo('Rien à changer.')).toBe('Rien à changer.');
  });

  it('accorde les quantités', () => {
    expect(count(0, 'moteur')).toBe('0 moteur');
    expect(count(1, 'moteur')).toBe('1 moteur');
    expect(count(3, 'moteur')).toBe('3 moteurs');
  });
});
