import { describe, expect, it } from 'vitest';
import { PAYSAGE } from '../../src/app/paysage.ts';
import { carryOrbit, defaultZone, fitVehicle, FRAME_SHARE, MENU_SHARE, orbitAngles, orbitPosition, presentPose, projectBox, RAIL_SHARE, START_POLAR, zoneShift, type VehicleFrameInput } from '../../src/scene/fit.ts';

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

// Tourner le téléphone : la vue choisie au doigt est reportée sur le cadrage de la nouvelle orientation.

const PORTRAIT = { width: 390, height: 844 };
const PORTRAIT_BAND = { top: 84, bottom: 650 };

function input(screen: { width: number; height: number }, size: (typeof SIZES)[keyof typeof SIZES], landscape: boolean, side?: 'droite'): VehicleFrameInput {
  const { turn, azimuth } = presentPose(side);
  if (!landscape) return { ...screen, size, turn, azimuth, band: PORTRAIT_BAND };
  const zone = defaultZone(screen.width);
  return { ...screen, size, turn, azimuth, band: { top: screen.height * 0.2, bottom: screen.height }, zoneWidth: zone.right - zone.left };
}

const deg = (rad: number) => (rad * 180) / Math.PI;

describe('orbite lue et reportée', () => {
  it('orbitAngles est l’inverse de orbitPosition', () => {
    for (const azimuth of [-2.4, -0.5, 0, 1.1, 3]) {
      for (const polar of [0.9, START_POLAR, 1.9]) {
        const target: [number, number, number] = [0, 0.6, 0];
        const angles = orbitAngles(orbitPosition(target, 5.5, azimuth, polar), target);
        expect(angles.azimuth).toBeCloseTo(azimuth, 6);
        expect(angles.polar).toBeCloseTo(polar, 6);
        expect(angles.distance).toBeCloseTo(5.5, 6);
      }
    }
  });

  it('fitVehicle à l’élévation de départ est celui d’avant ; une autre élévation change la distance', () => {
    const base = input(PORTRAIT, SIZES.voiture, false);
    expect(fitVehicle({ ...base, polar: START_POLAR })).toEqual(fitVehicle(base));
    expect(fitVehicle({ ...base, polar: 0.5 }).distance).not.toBeCloseTo(fitVehicle(base).distance, 2);
  });

  for (const [name, size] of Object.entries(SIZES)) {
    for (const screen of SCREENS) {
      for (const side of [undefined, 'droite'] as const) {
        it(`${name} ${side ?? 'gauche'} : portrait → ${screen.width} × ${screen.height} → portrait garde azimut et élévation, et rend la vue de départ à l’identique`, () => {
          const portrait = input(PORTRAIT, size, false, side);
          const landscape = input(screen, size, true, side);
          const home = fitVehicle(portrait);
          const start = orbitPosition(home.target, home.distance, home.azimuth);
          // Une vue choisie au doigt : tournée de 40° vers la droite, relevée, un peu rapprochée.
          const azimuth = home.azimuth + 0.7;
          const polar = 1.1;
          const target = home.target;
          const picked = orbitPosition(target, home.distance * 0.9, azimuth, polar);

          const there = carryOrbit(portrait, landscape, picked, target);
          const angles = orbitAngles(there.position, there.target);
          expect(deg(angles.azimuth)).toBeCloseTo(deg(azimuth), 3);
          expect(deg(angles.polar)).toBeCloseTo(deg(polar), 3);
          const fit = fitVehicle(landscape);
          // Zoom 0,9 du cadrage de départ : bien dans la plage du nouveau cadrage, sans rognage.
          expect(angles.distance).toBeGreaterThanOrEqual(fit.minDistance - 1e-9);
          expect(angles.distance).toBeLessThanOrEqual(fit.maxDistance + 1e-9);

          const back = carryOrbit(landscape, portrait, there.position, there.target);
          const returned = orbitAngles(back.position, back.target);
          expect(deg(returned.azimuth)).toBeCloseTo(deg(azimuth), 3);
          expect(deg(returned.polar)).toBeCloseTo(deg(polar), 3);
          // Aller-retour : la distance revient à moins de 2 % (la plage du zoom n'a pas rogné la vue).
          expect(Math.abs(returned.distance / (home.distance * 0.9) - 1)).toBeLessThan(0.02);

          // La vue de départ, intacte, retombe sur la vue de départ de la nouvelle orientation.
          const fresh = carryOrbit(portrait, landscape, start, target);
          const wanted = orbitPosition(fit.target, fit.distance, fit.azimuth);
          for (let i = 0; i < 3; i += 1) expect(fresh.position[i]).toBeCloseTo(wanted[i] ?? 0, 2);
          expect(fresh.target).toEqual(fit.target);
        });
      }
    }
  }

  it('un passage par un cadrage extrême ne coûte pas le zoom au retour (écran paysage annoncé avant sa taille)', () => {
    const size = SIZES.voiture;
    const portrait = input(PORTRAIT, size, false);
    const home = fitVehicle(portrait);
    const picked = orbitPosition(home.target, home.distance * 0.8, home.azimuth + 0.4, 1.2);
    // Étape de passage : la requête paysage est vraie, mais la scène a encore la taille du portrait.
    const odd = input(PORTRAIT, size, true);
    const landscape = input({ width: 844, height: 390 }, size, true);
    const a = carryOrbit(portrait, odd, picked, home.target);
    const b = carryOrbit(odd, landscape, a.position, a.target);
    const c = carryOrbit(landscape, portrait, b.position, b.target);
    const direct = carryOrbit(portrait, landscape, picked, home.target);
    for (let i = 0; i < 3; i += 1) {
      expect(b.position[i]).toBeCloseTo(direct.position[i] ?? 0, 6);
      expect(c.position[i]).toBeCloseTo(picked[i] ?? 0, 6);
    }
  });

  it('le véhicule garde sa part de la zone libre, entier, après la rotation', () => {
    const size = SIZES.van;
    const portrait = input(PORTRAIT, size, false);
    const screen = { width: 844, height: 390 };
    const landscape = input(screen, size, true);
    const home = fitVehicle(portrait);
    const target = home.target;
    for (const azimuth of [-1.2, -0.5, 0.4, 1.4, 2.6]) {
      const picked = orbitPosition(target, home.distance, azimuth, 1.3);
      const there = carryOrbit(portrait, landscape, picked, target);
      const fit = fitVehicle(landscape);
      const after = projectBox(size, landscape.turn, { eye: there.position, target: there.target, fov: fit.fov, ...screen });
      const before = projectBox(size, portrait.turn, { eye: picked, target, fov: home.fov, ...PORTRAIT });
      const zone = defaultZone(screen.width);
      const shareBefore = (before.right - before.left) / PORTRAIT.width;
      const shareAfter = (after.right - after.left) / (zone.right - zone.left);
      // Même part de l'espace libre à quelques points près ; l'écart ne vient que de la hauteur disponible.
      expect(Math.abs(shareAfter - shareBefore)).toBeLessThan(0.2);
      expect(after.top).toBeGreaterThanOrEqual(0);
      expect(after.bottom).toBeLessThanOrEqual(screen.height + 1);
    }
  });
});
