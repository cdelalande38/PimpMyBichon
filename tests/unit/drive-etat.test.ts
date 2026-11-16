// État de la sortie (src/state/drive.ts) : entrer et sortir, caméras et réalisateur, commandes,
// ralenti et pause, télémétrie ; seules la météo et la caméra préférées sont sauvegardées.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, get, set } from 'idb-keyval';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMERA_IDS } from '../../src/drive/contrat.ts';
import { MAPS } from '../../src/data/maps.ts';
import { AUTO_INPUT, DEFAULT_DRIVE_PREFS, DRIVE_KEY, IDLE_TELEMETRY, nextCameraOf, sanitizeDrivePrefs } from '../../src/state/drive.ts';

type DriveModule = typeof import('../../src/state/drive.ts');

async function launch(): Promise<DriveModule['useDrive']> {
  vi.resetModules();
  const { useDrive } = await import('../../src/state/drive.ts');
  await vi.waitFor(() => expect(useDrive.getState().hydrated).toBe(true));
  return useDrive;
}

const db = () => createStore('pimpmybichon', 'kv');
const first = MAPS[0]!;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('préférences', () => {
  it('lecture tolérante : une valeur inconnue retombe sur l’origine', () => {
    expect(sanitizeDrivePrefs({ weather: 'sec', camera: 'orbite' })).toEqual({ weather: 'sec', camera: 'orbite', commande: 'manche' });
    expect(sanitizeDrivePrefs({ weather: 'neige', camera: 'orbite', commande: 'pedales' })).toEqual({ weather: 'neige', camera: 'orbite', commande: 'pedales' });
    for (const raw of [null, 42, 'pluie', [], {}, { weather: 'grele', camera: 'drone', commande: 'volant' }, { weather: '__proto__' }, { camera: '__proto__' }, { commande: '__proto__' }]) {
      expect(sanitizeDrivePrefs(raw), JSON.stringify(raw)).toEqual(DEFAULT_DRIVE_PREFS);
    }
  });

  it('caméra suivante : dans l’ordre du contrat, et l’on revient au début', () => {
    expect(nextCameraOf('poursuite')).toBe('rasante');
    expect(nextCameraOf('orbite')).toBe(CAMERA_IDS[0]);
  });

  it('garde la météo, la caméra et la commande d’une séance à l’autre, et rien d’autre', async () => {
    const drive = await launch();
    expect(drive.getState().commande).toBe('manche');
    drive.getState().setWeather('sec');
    drive.getState().setCamera('avant');
    drive.getState().setCommande('pedales');
    drive.getState().enter(first.id, null);
    drive.getState().setSlow(true);
    await vi.waitFor(async () => {
      const raw = await get<string>(DRIVE_KEY, db());
      expect(raw ? (JSON.parse(raw) as { state: unknown }).state : null).toEqual({ weather: 'sec', camera: 'avant', commande: 'pedales' });
    });
    const again = await launch();
    const state = again.getState();
    expect({ weather: state.weather, camera: state.camera, commande: state.commande, map: state.map, slow: state.slow }).toEqual({
      weather: 'sec',
      camera: 'avant',
      commande: 'pedales',
      map: null,
      slow: false,
    });
  });

  it('une sauvegarde trafiquée ne bloque pas l’ouverture', async () => {
    await set(DRIVE_KEY, JSON.stringify({ state: { weather: '<script>', camera: 12, commande: { a: 1 } }, version: 1 }), db());
    const drive = await launch();
    expect({ weather: drive.getState().weather, camera: drive.getState().camera, commande: drive.getState().commande }).toEqual(DEFAULT_DRIVE_PREFS);
  });
});

describe('une sortie', () => {
  it('entrer : sur le choix du menu, pilote automatique et réalisateur d’office ; rentrer remet à zéro', async () => {
    const drive = await launch();
    expect(drive.getState().map).toBeNull();
    drive.getState().chooseMap(first.id);
    drive.getState().chooseStart('quelque-part');
    drive.getState().setDirector(false);
    drive.getState().enter();
    let state = drive.getState();
    expect(state.map).toBe(first.id);
    expect(state.start).toBe('quelque-part');
    expect(state.director).toBe(true);
    expect(state.input).toEqual(AUTO_INPUT);
    expect(state.telemetry).toEqual(IDLE_TELEMETRY);
    state.setTelemetry({ ...IDLE_TELEMETRY, ready: true, speedKmh: 72, s: 140, progress: 0.01 });
    expect(drive.getState().telemetry.speedKmh).toBe(72);
    drive.getState().leave();
    state = drive.getState();
    expect(state.map).toBeNull();
    expect(state.telemetry).toEqual(IDLE_TELEMETRY);
    // Le choix du menu reste pour la prochaine fois.
    expect(state.choice).toEqual({ map: first.id, start: 'quelque-part' });
  });

  it('une carte inconnue n’est pas choisie ; sans choix, la première du catalogue', async () => {
    const drive = await launch();
    drive.getState().chooseMap('nulle-part');
    expect(drive.getState().choice.map).toBeNull();
    drive.getState().enter('nulle-part');
    expect(drive.getState().map).toBe(first.id);
  });

  it('caméra choisie à la main : le réalisateur s’arrête', async () => {
    const drive = await launch();
    drive.getState().enter();
    expect(drive.getState().director).toBe(true);
    drive.getState().nextCamera();
    expect(drive.getState().director).toBe(false);
    expect(drive.getState().camera).toBe(nextCameraOf(DEFAULT_DRIVE_PREFS.camera));
    drive.getState().setDirector(true);
    drive.getState().setCamera('orbite');
    expect(drive.getState()).toMatchObject({ camera: 'orbite', director: false });
  });

  it('commandes : ignorées en pilote automatique, bornées à la main, relâchées au changement de mode', async () => {
    const drive = await launch();
    drive.getState().enter();
    drive.getState().setThrottle(1);
    expect(drive.getState().input).toEqual(AUTO_INPUT);
    drive.getState().setAuto(false);
    drive.getState().setThrottle(3);
    drive.getState().setBrake(-1);
    drive.getState().setLane(1);
    expect(drive.getState().input).toEqual({ auto: false, throttle: 1, brake: 0, lane: 1 });
    drive.getState().setThrottle(Number.NaN);
    expect(drive.getState().input.throttle).toBe(0);
    drive.getState().setAuto(true);
    expect(drive.getState().input).toEqual(AUTO_INPUT);
  });

  it('manche : gaz, frein et placement d’un coup, bornés ; sans placement, retour aux bords demandés', async () => {
    const drive = await launch();
    drive.getState().enter();
    drive.getState().setManual({ throttle: 1, brake: 0, steer: 1 });
    expect(drive.getState().input).toEqual(AUTO_INPUT);
    drive.getState().setAuto(false);
    drive.getState().setManual({ throttle: 0.4, brake: -2, steer: -3 });
    expect(drive.getState().input).toEqual({ auto: false, throttle: 0.4, brake: 0, lane: 0, steer: -1 });
    const same = drive.getState().input;
    drive.getState().setManual({ throttle: 0.4, brake: 0, steer: -1 });
    expect(drive.getState().input).toBe(same);
    drive.getState().setManual({ throttle: Number.NaN, brake: 0.5, steer: Number.NaN });
    expect(drive.getState().input).toEqual({ auto: false, throttle: 0, brake: 0.5, lane: 0, steer: 0 });
    drive.getState().setManual({ throttle: 0, brake: 0 });
    expect('steer' in drive.getState().input).toBe(false);
    drive.getState().setAuto(true);
    expect(drive.getState().input).toEqual(AUTO_INPUT);
  });

  it('orbite bornée, ralenti, pause, télémétrie publiée seulement quand elle change', async () => {
    const drive = await launch();
    drive.getState().setOrbit({ pitch: 9, distance: -4 });
    expect(drive.getState().orbit.pitch).toBeLessThan(1.3);
    expect(drive.getState().orbit.distance).toBeGreaterThan(2);
    drive.getState().setSlow(true);
    drive.getState().setPaused(true);
    expect(drive.getState()).toMatchObject({ slow: true, paused: true });
    const before = drive.getState();
    drive.getState().setTelemetry({ ...before.telemetry });
    expect(drive.getState()).toBe(before);
  });

  it('erreur puis « Réessayer » : la scène est remontée, la télémétrie repart de zéro', async () => {
    const drive = await launch();
    drive.getState().enter();
    drive.getState().fail();
    expect(drive.getState().telemetry.failed).toBe(true);
    const attempt = drive.getState().attempt;
    drive.getState().retry();
    expect(drive.getState().attempt).toBe(attempt + 1);
    expect(drive.getState().telemetry).toEqual(IDLE_TELEMETRY);
  });
});
