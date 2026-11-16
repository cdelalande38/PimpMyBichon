import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { GARAGE } from '../../src/data/garage.ts';
import { interiorViewsOf, validateManifest } from '../../src/data/vehicles.ts';
import { starLayout } from '../../src/scene/cabin.ts';
import { useView } from '../../src/state/view.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import {
  clampLook,
  dockShiftFrom,
  dragLook,
  FRAME_SHARE,
  fitVehicle,
  INTERIOR,
  interiorFov,
  interiorPose,
  lookFrom,
  lookPoint,
  orbitPosition,
  presentPose,
  projectBox,
  START_AZIMUTH,
  vehicleToRoom,
} from '../../src/scene/fit.ts';

const DIR = new URL('../../public/assets/vehicles/', import.meta.url);
const MANIFESTS: VehicleManifest[] = readdirSync(DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && existsSync(new URL(`${entry.name}/vehicle.json`, DIR)))
  .map((entry) => validateManifest(JSON.parse(readFileSync(new URL(`${entry.name}/vehicle.json`, DIR), 'utf8')), entry.name));
const byId = (id: string) => MANIFESTS.find((manifest) => manifest.id === id);

describe('repère du véhicule → repère de la pièce', () => {
  it('nez à gauche (π) : l’avant va vers −X, la droite du véhicule vers −Z', () => {
    const [x, y, z] = vehicleToRoom([1, 0.5, 0], Math.PI);
    expect(x).toBeCloseTo(-1, 9);
    expect(y).toBe(0.5);
    expect(z).toBeCloseTo(0, 9);
    const right = vehicleToRoom([0, 0, 1], Math.PI);
    expect(right[0]).toBeCloseTo(0, 9);
    expect(right[2]).toBeCloseTo(-1, 9);
  });

  it('nez à droite (tour nul) : rien ne bouge', () => {
    expect(vehicleToRoom([0.3, 1, -0.4], 0)).toEqual([0.3, 1, -0.4]);
  });

  it('l’œil intérieur suit la pose du véhicule, comme le groupe tourné de la scène', () => {
    const view = { eye: [-0.15, 1.08, -0.32] as const, target: [0.6, 0.88, -0.2] as const };
    const pose = interiorPose(view, Math.PI);
    expect(pose.eye[0]).toBeCloseTo(0.15, 9);
    expect(pose.eye[1]).toBe(1.08);
    expect(pose.eye[2]).toBeCloseTo(0.32, 9);
    expect(pose.target[0]).toBeCloseTo(-0.6, 9);
  });
});

describe('côté de présentation', () => {
  it('sans champ : nez à gauche, caméra de départ d’aujourd’hui', () => {
    expect(presentPose(undefined)).toEqual({ turn: Math.PI, azimuth: START_AZIMUTH });
    expect(presentPose('gauche')).toEqual({ turn: GARAGE.vehicle.turn, azimuth: START_AZIMUTH });
  });

  it('droite : nez à droite, la caméra du même côté de la pièce montre le flanc droit', () => {
    const { turn, azimuth } = presentPose('droite');
    expect(turn).toBe(0);
    const eye = orbitPosition([0, 0.5, 0], 6, azimuth);
    // Caméra du côté +Z de la pièce (devant le mur du fond) ; la droite du véhicule y regarde.
    expect(eye[2]).toBeGreaterThan(0);
    expect(vehicleToRoom([0, 0, 1], turn)[2]).toBeGreaterThan(0);
  });

  it('le bobber se présente côté droit ; un champ inconnu est refusé', () => {
    expect(byId('bobber')?.presentSide).toBe('droite');
    const raw = JSON.parse(readFileSync(new URL('bobber/vehicle.json', DIR), 'utf8')) as Record<string, unknown>;
    expect(() => validateManifest({ ...raw, presentSide: 'dessus' }, 'bobber')).toThrow(/presentSide/);
  });
});

describe('bornes du regard', () => {
  const base = { yaw: 1, pitch: -0.2 };

  it('lacet ±110°, tangage 40° vers le bas et 75° vers le haut (le ciel étoilé) autour de l’axe de la place', () => {
    expect((INTERIOR.yaw * 180) / Math.PI).toBeCloseTo(110, 9);
    expect((INTERIOR.pitch * 180) / Math.PI).toBeCloseTo(40, 9);
    expect((INTERIOR.pitchUp * 180) / Math.PI).toBeCloseTo(75, 9);
    const far = clampLook(base, { yaw: base.yaw + 3, pitch: base.pitch + 2 });
    expect(far.yaw - base.yaw).toBeCloseTo(INTERIOR.yaw, 9);
    expect(far.pitch - base.pitch).toBeCloseTo(INTERIOR.pitchUp, 9);
    // Depuis un regard vers la route, on lève les yeux au-dessus de l'horizontale, vers le pavillon.
    expect(far.pitch).toBeGreaterThan(1);
    const low = clampLook(base, { yaw: base.yaw - 3, pitch: base.pitch - 2 });
    expect(low.yaw - base.yaw).toBeCloseTo(-INTERIOR.yaw, 9);
    expect(low.pitch - base.pitch).toBeCloseTo(-INTERIOR.pitch, 9);
  });

  it('le lacet ne saute pas au passage de ±π', () => {
    const edge = { yaw: Math.PI - 0.1, pitch: 0 };
    const look = clampLook(edge, { yaw: -Math.PI + 0.1, pitch: 0 });
    expect(look.yaw - edge.yaw).toBeCloseTo(0.2, 9);
  });

  it('glisser vers la droite fait regarder à gauche, vers le bas fait lever les yeux', () => {
    const look = dragLook({ yaw: 0, pitch: 0 }, 100, 50, 390, 844, 90);
    expect(look.yaw).toBeGreaterThan(0);
    expect(look.pitch).toBeGreaterThan(0);
  });

  it('lookFrom et lookPoint se répondent', () => {
    const eye = [0.2, 1, -0.3] as const;
    const look = lookFrom(eye, [1.4, 0.7, 0.1]);
    const point = lookPoint(eye, look, Math.hypot(1.2, -0.3, 0.4));
    expect(point[0]).toBeCloseTo(1.4, 6);
    expect(point[1]).toBeCloseTo(0.7, 6);
    expect(point[2]).toBeCloseTo(0.1, 6);
  });

  it('champ plus large qu’en atelier, en portrait comme en paysage', () => {
    expect(interiorFov(390, 844)).toBeGreaterThan(46);
    expect(interiorFov(844, 390)).toBeGreaterThan(34);
  });

  it('un point de vue peut élargir son champ ; en paysage, il garde la même proportion', () => {
    expect(interiorFov(390, 844, 100)).toBe(100);
    expect(interiorFov(844, 390, 100)).toBeCloseTo((INTERIOR.fovLandscape * 100) / INTERIOR.fovPortrait, 9);
    expect(interiorFov(390, 844, undefined)).toBe(INTERIOR.fovPortrait);
  });
});

describe('bouton rond de la vue intérieure', () => {
  it('entre à la place gardée du véhicule (le conducteur la première fois), et ressort ; plus de tour des places', () => {
    useView.setState({ mode: 'atelier', place: 'conducteur', places: {} });
    useView.getState().enterOrLeave('cox');
    expect(useView.getState()).toMatchObject({ mode: 'interieur', place: 'conducteur' });
    useView.getState().enterOrLeave('cox');
    expect(useView.getState()).toMatchObject({ mode: 'atelier', place: 'conducteur' });
  });

  it('sortir par un autre chemin (photo, autre véhicule) garde la place choisie pour la prochaine entrée', () => {
    useView.setState({ mode: 'atelier', place: 'conducteur', places: {} });
    useView.getState().sit('cox', 'passager');
    useView.getState().setMode('atelier');
    expect(useView.getState().mode).toBe('atelier');
    useView.getState().enterOrLeave('cox');
    expect(useView.getState()).toMatchObject({ mode: 'interieur', place: 'passager' });
  });
});

describe('vue intérieure dans les manifestes', () => {
  // On ne juge que les véhicules nommés ici et les motos : un autre fichier de tests dépose un
  // véhicule d'essai dans le même dossier pendant qu'il tourne (tests/unit/vehicules.test.ts).
  it('la Cox, le concept et le van la déclarent, par places nommées ; pas les motos', () => {
    for (const id of ['cox', 'concept', 'van']) expect(byId(id)?.interiorView, id).toBeDefined();
    expect(interiorViewsOf(byId('cox')!).map((view) => view.label)).toEqual(['Conducteur', 'Passager', 'Arrière']);
    // Le van : l'arrière est la cabine sous le ciel étoilé.
    expect(interiorViewsOf(byId('van')!).map((view) => view.label)).toEqual(['Conducteur', 'Passager', 'Arrière']);
    expect(interiorViewsOf(byId('concept')!).map((view) => view.label)).toEqual(['Conducteur', 'Passager']);
    for (const manifest of MANIFESTS) {
      if (manifest.kind === 'bike') expect(interiorViewsOf(manifest), manifest.id).toHaveLength(0);
    }
  });

  it('chaque place pose son œil (sur ses sièges, ou mesuré dans la boîte du véhicule) et regarde vers l’avant', () => {
    // L'œil posé sur les sièges est vérifié sur le modèle chargé : tests/unit/places.test.ts.
    for (const manifest of MANIFESTS) {
      for (const view of interiorViewsOf(manifest)) {
        expect(view.seat !== undefined || view.eye !== undefined, manifest.id).toBe(true);
        if (view.eye) {
          expect(Math.abs(view.eye[0]), manifest.id).toBeLessThan(manifest.halfLengthHint);
          expect(view.eye[1], manifest.id).toBeGreaterThan(0.6);
        }
        if (view.target && view.eye) expect(view.target[0], manifest.id).toBeGreaterThan(view.eye[0]);
        if (view.look) expect(Math.abs(view.look.yaw), manifest.id).toBeLessThan(30);
        expect(view.look !== undefined || view.target !== undefined, manifest.id).toBe(true);
      }
    }
  });

  it('des points de vue suivants sans premier point de vue, ou un champ hors bornes, sont refusés', () => {
    const base = JSON.parse(readFileSync(new URL('cox/vehicle.json', DIR), 'utf8')) as Record<string, unknown>;
    const { interiorView, ...rest } = base;
    expect(interiorView).toBeDefined();
    expect(() => validateManifest(rest, 'cox')).toThrow(/interiorViews demande/);
    expect(() => validateManifest({ ...base, interiorView: { eye: [0, 1, 0], target: [1, 1, 0], fov: 150 } }, 'cox')).toThrow(/fov/);
    expect(() => validateManifest({ ...base, cabin: { sky: { center: [0, 1, 0], size: [1, 1], count: 10, color: 'rouge' } } }, 'cox')).toThrow(/cabin.sky/);
  });
});

describe('ciel étoilé', () => {
  const sky = byId('van')?.cabin?.sky;

  it('le van déclare un ciel rouge par défaut, un médaillon à motif à nous, une lumière et ses cadrans', () => {
    expect(sky).toBeDefined();
    expect(sky!.color).toMatch(/^#[0-9a-f]{6}$/);
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(sky!.color.slice(i, i + 2), 16));
    expect(r!).toBeGreaterThan(200);
    expect(g! + b!).toBeLessThan(120);
    expect(['eclair', 'flamme']).toContain(sky!.medallion?.motif);
    const cabin = byId('van')!.cabin!;
    expect(cabin.light?.intensity).toBeGreaterThan(0);
    expect(cabin.light?.color).toBeUndefined(); // de la couleur du plafond
    expect(cabin.panels?.filter((panel) => panel.shape === 'disque')).toHaveLength(2);
    expect(cabin.panels?.filter((panel) => panel.shape === 'rectangle')).toHaveLength(1);
  });

  it('même manifeste, même ciel ; les points restent sur le plafond, plus serrés au centre', () => {
    const stars = starLayout(sky!);
    expect(starLayout(sky!)).toEqual(stars);
    expect(stars.length).toBeGreaterThan(sky!.count);
    const [cx, , cz] = sky!.center;
    const [length, width] = sky!.size;
    for (const star of stars.slice(0, sky!.count)) {
      expect(Math.abs(star.x - cx)).toBeLessThanOrEqual(length / 2);
      expect(Math.abs(star.z - cz)).toBeLessThanOrEqual(width / 2);
    }
    // Densité, mesurée sans médaillon (il vide le milieu) : le carré du milieu couvre un quart du
    // plafond, il reçoit plus d'un quart des points.
    let inner = 0;
    let outer = 0;
    for (const star of starLayout({ ...sky!, medallion: undefined, count: 2000 })) {
      const u = Math.abs(star.x - cx) / (length / 2);
      const v = Math.abs(star.z - cz) / (width / 2);
      expect(u).toBeLessThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(1);
      expect(star.radius).toBeGreaterThan(0.001);
      expect(star.radius).toBeLessThan(0.01);
      if (Math.max(u, v) < 0.5) inner += 1;
      else outer += 1;
    }
    expect(inner / (inner + outer)).toBeGreaterThan(0.28);
    // Le médaillon : des points sur son cercle, aucun point du semis dedans.
    const r = sky!.medallion!.radius;
    for (const star of stars.slice(0, sky!.count)) expect(Math.hypot(star.x - cx, star.z - cz)).toBeGreaterThan(r);
    expect(stars.slice(sky!.count).some((star) => Math.abs(Math.hypot(star.x - cx, star.z - cz) - r) < 1e-9)).toBe(true);
  });
});

describe('cadrage par véhicule', () => {
  const sizes = {
    voiture: { halfLength: 2.18, halfWidth: 1.0, height: 1.15 },
    van: { halfLength: 2.4, halfWidth: 1.0, height: 2.0 },
    moto: { halfLength: 1.1, halfWidth: 0.42, height: 1.15 },
  };
  const screens = [
    { width: 390, height: 844, dock: 648 },
    { width: 360, height: 780, dock: 598 },
  ];

  for (const screen of screens) {
    for (const [name, size] of Object.entries(sizes)) {
      for (const side of [undefined, 'droite'] as const) {
        it(`${name}, ${screen.width} × ${screen.height}, côté ${side ?? 'gauche'} : 80 % de la largeur, centré dans la partie libre`, () => {
          const { turn, azimuth } = presentPose(side);
          const band = { top: screen.height * 0.1, bottom: screen.dock };
          const fit = fitVehicle({ width: screen.width, height: screen.height, size, turn, azimuth, band });
          const eye = orbitPosition(fit.target, fit.distance, fit.azimuth);
          const frame = projectBox(size, turn, { eye, target: fit.target, fov: fit.fov, width: screen.width, height: screen.height });
          const share = (frame.right - frame.left) / screen.width;
          expect(share).toBeLessThanOrEqual(FRAME_SHARE + 0.005);
          // Le van, haut, peut céder un peu de largeur pour tenir en hauteur.
          expect(share).toBeGreaterThan(0.7);
          expect(Math.abs((frame.left + frame.right) / 2 - screen.width / 2)).toBeLessThan(screen.width * 0.05);
          expect(Math.abs((frame.top + frame.bottom) / 2 - (band.top + band.bottom) / 2)).toBeLessThan(2);
          expect(frame.top).toBeGreaterThanOrEqual(band.top);
          expect(frame.bottom).toBeLessThanOrEqual(band.bottom);
          // Dock agrandi (41 % de l'écran) : la vue monte, le véhicule reste centré dans la partie libre.
          const expandedTop = Math.round(screen.height * 0.41);
          const shift = dockShiftFrom(screen.dock, expandedTop);
          expect(Math.abs((frame.top + frame.bottom) / 2 - shift - (band.top + expandedTop) / 2)).toBeLessThan(2);
          expect(dockShiftFrom(screen.dock, null)).toBe(0);
          expect(fit.minDistance).toBeLessThan(fit.distance);
          expect(fit.maxDistance).toBeGreaterThan(fit.distance);
        });
      }
    }
  }

  it('la moto du décor s’efface quand le véhicule du moment est une moto', () => {
    expect(GARAGE.hideFor.bike).toContain('placeholder_moto_sportive');
    expect(GARAGE.hideFor.car ?? []).toHaveLength(0);
  });
});
