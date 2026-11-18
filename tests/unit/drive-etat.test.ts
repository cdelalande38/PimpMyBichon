// État de la sortie (src/state/drive.ts) : entrer et sortir, caméras et réalisateur, commandes,
// ralenti et pause, télémétrie ; seules la météo et la caméra préférées sont sauvegardées.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, get, set } from 'idb-keyval';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CAMERA_IDS } from '../../src/drive/contrat.ts';
import { MAPS } from '../../src/data/maps.ts';
import { BOUTONS_LANCEMENT, boutonDeLancement } from '../../src/ui/drive/manche.ts';
import { AUTO_INPUT, DEFAULT_DRIVE_PREFS, etapeFondu, FONDU_MS, FONDU_SECOURS_MS, DRIVE_KEY, IDLE_TELEMETRY, nextCameraOf, sanitizeDrivePrefs } from '../../src/state/drive.ts';

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
    expect(sanitizeDrivePrefs({ weather: 'sec', camera: 'orbite' })).toEqual({ moment: 'nuit', weather: 'sec', camera: 'orbite', commande: 'manche', direction: 'libre', format: 'balade' });
    expect(sanitizeDrivePrefs({ moment: 'jour', weather: 'neige', camera: 'orbite', commande: 'pedales', direction: 'assistee', format: 'tours3' })).toEqual({
      moment: 'jour',
      weather: 'neige',
      camera: 'orbite',
      commande: 'pedales',
      direction: 'assistee',
      format: 'tours3',
    });
    for (const raw of [
      null,
      42,
      'pluie',
      [],
      {},
      { moment: 'aube', weather: 'grele', camera: 'drone', commande: 'volant', direction: 'auto' },
      { moment: '__proto__' },
      { weather: '__proto__' },
      { camera: '__proto__' },
      { commande: '__proto__' },
      { direction: '__proto__' },
    ]) {
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
    drive.getState().setDirection('assistee');
    drive.getState().setFormat('tour1');
    drive.getState().setMoment('jour');
    drive.getState().enter(first.id, null);
    drive.getState().setSlow(true);
    await vi.waitFor(async () => {
      const raw = await get<string>(DRIVE_KEY, db());
      expect(raw ? (JSON.parse(raw) as { state: unknown }).state : null).toEqual({ moment: 'jour', weather: 'sec', camera: 'avant', commande: 'pedales', direction: 'assistee', format: 'tour1' });
    });
    const again = await launch();
    const state = again.getState();
    expect({ moment: state.moment, weather: state.weather, camera: state.camera, commande: state.commande, direction: state.direction, format: state.format, map: state.map, slow: state.slow }).toEqual({
      moment: 'jour',
      weather: 'sec',
      camera: 'avant',
      commande: 'pedales',
      direction: 'assistee',
      format: 'tour1',
      map: null,
      slow: false,
    });
  });

  it('une sauvegarde trafiquée ne bloque pas l’ouverture', async () => {
    await set(DRIVE_KEY, JSON.stringify({ state: { moment: ['jour'], weather: '<script>', camera: 12, commande: { a: 1 }, direction: 7, format: 'tours9' }, version: 1 }), db());
    const drive = await launch();
    const { moment, weather, camera, commande, direction, format } = drive.getState();
    expect({ moment, weather, camera, commande, direction, format }).toEqual(DEFAULT_DRIVE_PREFS);
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

  it('aperçu, commencer, pilote automatique, repartir', async () => {
    const drive = await launch();
    drive.getState().setDirection('assistee');
    drive.getState().enter();
    expect(drive.getState()).toMatchObject({ apercu: true, director: true, input: AUTO_INPUT });
    const course = drive.getState().course;
    drive.getState().setCamera('orbite');
    drive.getState().setPaused(true);
    // Un appui sur la route : la course, à la main, poursuite, réalisateur coupé, pause levée.
    drive.getState().commencer();
    expect(drive.getState()).toMatchObject({ apercu: false, course: course + 1, camera: 'poursuite', director: false, paused: false });
    expect(drive.getState().input).toMatchObject({ auto: false, throttle: 0, brake: 0, assist: true });
    // « Pilote automatique » : le pilote reprend, le réalisateur revient, la course reste (pas d'aperçu, pas de nouveau départ).
    drive.getState().fireNos();
    drive.getState().laisserConduire();
    expect(drive.getState()).toMatchObject({ apercu: false, course: course + 1, director: true });
    expect(drive.getState().input).toMatchObject({ auto: true, nos: 1 });
    // « Repartir » : un nouveau départ à la main.
    drive.getState().commencer();
    expect(drive.getState()).toMatchObject({ apercu: false, course: course + 2 });
    expect(drive.getState().input.auto).toBe(false);
    // Rentrer puis ressortir : de nouveau l'aperçu ; « Réessayer » aussi.
    drive.getState().leave();
    drive.getState().enter();
    expect(drive.getState().apercu).toBe(true);
    drive.getState().commencer();
    drive.getState().retry();
    expect(drive.getState()).toMatchObject({ apercu: true, input: AUTO_INPUT });
  });

  it('fondu de fin d’aperçu : levé, confirmé noir, baissé par la scène ; remis à zéro par chaque départ', async () => {
    const drive = await launch();
    drive.getState().enter();
    expect(drive.getState().fondu).toBe('non');
    drive.getState().setFondu('sortie');
    drive.getState().setFondu('noir');
    expect(drive.getState().fondu).toBe('noir');
    // Un appui sur la route pendant le fondu : la course part, l'écran n'est pas laissé noir.
    drive.getState().commencer();
    expect(drive.getState().fondu).toBe('non');
    drive.getState().setFondu('sortie');
    drive.getState().retry();
    expect(drive.getState().fondu).toBe('non');
    drive.getState().setFondu('noir');
    drive.getState().leave();
    expect(drive.getState().fondu).toBe('non');
    drive.getState().enter();
    drive.getState().setFondu('sortie');
    const same = drive.getState();
    drive.getState().setFondu('sortie');
    expect(drive.getState()).toBe(same);
  });

  it('fin de route en aperçu : lever le fondu, attendre que l’écran confirme le noir, reprendre ; coupe franche sans mouvement', () => {
    const t0 = 5_000;
    expect(etapeFondu(-1, t0, false, false)).toBe('lever');
    // Tant que l'écran n'a pas dit « noir », on attend, quelle que soit la lenteur des images.
    expect(etapeFondu(t0, t0 + 1, false, false)).toBe('attendre');
    expect(etapeFondu(t0, t0 + FONDU_MS * 2, false, false)).toBe('attendre');
    expect(etapeFondu(t0, t0 + 1, false, true)).toBe('reprendre');
    // Rendu figé : l'horloge sert de secours.
    expect(etapeFondu(t0, t0 + FONDU_SECOURS_MS - 1, false, false)).toBe('attendre');
    expect(etapeFondu(t0, t0 + FONDU_SECOURS_MS, false, false)).toBe('reprendre');
    // Mouvement réduit : jamais de fondu, la scène reprend aussitôt.
    expect(etapeFondu(-1, t0, true, false)).toBe('reprendre');
    expect(etapeFondu(t0, t0 + 1, true, false)).toBe('reprendre');
    expect(FONDU_MS).toBe(400);
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

  it('à la main : poursuite et réalisateur coupé ; rien ne les remet tout seul ; direction assistée passée au pilote', async () => {
    const drive = await launch();
    drive.getState().enter();
    expect(drive.getState().director).toBe(true);
    drive.getState().setCamera('avant');
    drive.getState().setDirector(true);
    drive.getState().setAuto(false);
    expect(drive.getState().camera).toBe('poursuite');
    expect(drive.getState().director).toBe(false);
    expect('assist' in drive.getState().input).toBe(false);
    // Le joueur choisit une autre caméra : un second passage à la main (déjà à la main) n'y touche pas.
    drive.getState().setCamera('embarquee');
    drive.getState().setAuto(false);
    expect(drive.getState().camera).toBe('embarquee');
    // Retour au pilote automatique, pause, bout du parcours : rien ne change de caméra ni ne rallume le réalisateur.
    drive.getState().setAuto(true);
    drive.getState().setPaused(true);
    drive.getState().setPaused(false);
    drive.getState().setTelemetry({ ready: true, failed: false, speedKmh: 0, s: 100, progress: 1, finished: true });
    drive.getState().retry();
    expect(drive.getState().camera).toBe('embarquee');
    expect(drive.getState().director).toBe(false);
    // Direction assistée : passée au pilote tout de suite, et à chaque prise du volant.
    drive.getState().setAuto(false);
    drive.getState().setDirection('assistee');
    expect(drive.getState().input.assist).toBe(true);
    drive.getState().setManual({ throttle: 0.5, brake: 0, steer: 0.2 });
    expect(drive.getState().input).toEqual({ auto: false, throttle: 0.5, brake: 0, lane: 0, steer: 0.2, assist: true });
    drive.getState().setAuto(true);
    drive.getState().setAuto(false);
    expect(drive.getState().input.assist).toBe(true);
    drive.getState().setDirection('libre');
    expect('assist' in drive.getState().input).toBe(false);
    drive.getState().setDirection('volant' as never);
    expect(drive.getState().direction).toBe('libre');
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

describe('manette physique : le bouton qui lance la course', () => {
  const pad = (...presses: number[]) => ({
    axes: [0, 0],
    buttons: Array.from({ length: 17 }, (_, i) => ({ value: presses.includes(i) ? 1 : 0, pressed: presses.includes(i) })),
  });

  it('un bouton de face ou Start compte, ni les gâchettes ni la croix', () => {
    expect(BOUTONS_LANCEMENT).toEqual([0, 1, 2, 3, 9]);
    for (const index of BOUTONS_LANCEMENT) expect(boutonDeLancement(pad(index))).toBe(true);
    for (const index of [4, 5, 6, 7, 8, 10, 11, 12, 13, 14, 15, 16]) expect(boutonDeLancement(pad(index))).toBe(false);
    expect(boutonDeLancement(pad())).toBe(false);
    expect(boutonDeLancement({ axes: [], buttons: [] })).toBe(false);
  });
});
