import { describe, expect, it } from 'vitest';
import { PAYSAGE } from '../../src/app/paysage.ts';
import { defaultZone, fitVehicle, FRAME_SHARE, MENU_SHARE, orbitPosition, presentPose, projectBox, RAIL_SHARE, zoneShift } from '../../src/scene/fit.ts';

// Le garage en paysage : le véhicule se cadre dans la zone libre entre les boutons ronds et le
// menu en colonne ; la vue glisse (vers la gauche) pour l'y centrer ; menu fermé, rien ne glisse.

const SIZES = {
  voiture: { halfLength: 2.18, halfWidth: 1.0, height: 1.15 },
  van: { halfLength: 2.4, halfWidth: 1.0, height: 2.0 },
  moto: { halfLength: 1.1, halfWidth: 0.42, height: 1.15 },
};
const SCREENS = [
  { width: 844, height: 390 },
  { width: 780, height: 360 },
  { width: 915, height: 412 },
];

describe('requête du paysage', () => {
  it('est la même que celle de la sortie de nuit (une seule définition du paysage)', () => {
    expect(PAYSAGE).toBe('(orientation: landscape) and (max-height: 540px)');
  });
});

describe('zone libre du garage en paysage', () => {
  it('par défaut : entre un petit rail à gauche et le menu à droite', () => {
    const zone = defaultZone(844);
    expect(zone.left).toBe(Math.round(844 * RAIL_SHARE));
    expect(zone.right).toBe(Math.round(844 * (1 - MENU_SHARE)));
    expect(zone.right).toBeGreaterThan(zone.left);
  });

  it('le décalage amène le milieu de l’image au milieu de la zone, jamais dans l’autre sens', () => {
    expect(zoneShift(800, { left: 100, right: 500 })).toBe(100);
    expect(zoneShift(800, { left: 0, right: 800 })).toBe(0);
    // Zone décalée à droite du centre : rien ne bouge (le décalage ne va que vers la gauche).
    expect(zoneShift(800, { left: 300, right: 800 })).toBe(0);
    expect(zoneShift(800, null)).toBe(0);
    expect(zoneShift(0, { left: 0, right: 10 })).toBe(0);
    expect(zoneShift(800, { left: Number.NaN, right: 500 })).toBe(0);
  });
});

describe('cadrage en paysage', () => {
  for (const screen of SCREENS) {
    for (const [name, size] of Object.entries(SIZES)) {
      for (const side of [undefined, 'droite'] as const) {
        it(`${name}, ${screen.width} × ${screen.height}, côté ${side ?? 'gauche'} : cadré dans la zone libre, sans être coupé`, () => {
          const { turn, azimuth } = presentPose(side);
          const zone = defaultZone(screen.width);
          const band = { top: screen.height * 0.2, bottom: screen.height };
          const fit = fitVehicle({ ...screen, size, turn, azimuth, band, zoneWidth: zone.right - zone.left });
          const eye = orbitPosition(fit.target, fit.distance, fit.azimuth);
          const frame = projectBox(size, turn, { eye, target: fit.target, fov: fit.fov, ...screen });
          const shift = zoneShift(screen.width, zone);
          // La vue glisse vers la gauche de `shift` : le cadre vu à l'écran.
          const left = frame.left - shift;
          const right = frame.right - shift;
          expect(shift).toBeGreaterThan(0);
          const share = (right - left) / (zone.right - zone.left);
          expect(share).toBeLessThanOrEqual(FRAME_SHARE + 0.005);
          expect(share).toBeGreaterThan(0.65);
          expect(left).toBeGreaterThanOrEqual(zone.left);
          expect(right).toBeLessThanOrEqual(zone.right);
          expect(Math.abs((left + right) / 2 - (zone.left + zone.right) / 2)).toBeLessThan(screen.width * 0.05);
          expect(frame.top).toBeGreaterThanOrEqual(band.top);
          expect(frame.bottom).toBeLessThanOrEqual(band.bottom);
          expect(Math.abs((frame.top + frame.bottom) / 2 - (band.top + band.bottom) / 2)).toBeLessThan(2);
        });
      }
    }
  }

  it('sans zone, le cadrage est celui d’avant (toute la largeur)', () => {
    const { turn, azimuth } = presentPose(undefined);
    const screen = { width: 390, height: 844 };
    const band = { top: 84, bottom: 648 };
    const size = SIZES.voiture;
    expect(fitVehicle({ ...screen, size, turn, azimuth, band })).toEqual(fitVehicle({ ...screen, size, turn, azimuth, band, zoneWidth: 390 }));
  });
});
