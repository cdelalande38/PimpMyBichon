// Places de la vue intérieure (demande du 16 novembre 2026 : « se placer à la place conducteur,
// passager ou arrière ») : chaque véhicule à habitacle déclare ses places ; l'œil de chacune, résolu
// comme dans la scène sur le modèle fabriqué et chaque siège du catalogue, est dans la caisse,
// au-dessus de son siège, à hauteur de tête assise, loin de tout maillage (dossier, montant,
// pavillon) ; le conducteur est à gauche ; une place inconnue retombe sur le conducteur.

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Group } from 'three';
import { INTERIOR_CATALOGUE } from '../../src/data/habitacle.ts';
import { placeForVolet, placeOf, placesOf, validateManifest } from '../../src/data/vehicles.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { DEFAULT_SEAT, lookFrom, placeEye, seatMetrics } from '../../src/scene/fit.ts';
import { PLACES_KEY, readPlaces, useView } from '../../src/state/view.ts';
import { builtModel, clearance, poseSeats, resolveEye, roofAbove, storedModel } from './places-modeles.ts';

const DIR = new URL('../../public/assets/vehicles/', import.meta.url);
const read = (id: string) => validateManifest(JSON.parse(readFileSync(new URL(`${id}/vehicle.json`, DIR), 'utf8')), id);
const cox = read('cox');
const van = read('van');
const concept = read('concept');
const SEATS = INTERIOR_CATALOGUE.seats.map((seat) => seat.id);
const [LEFT, RIGHT] = INTERIOR_CATALOGUE.anchors.seats;

/** Écart gardé entre l'œil et toute face : le plan proche de la vue intérieure (2 cm) et la tête. */
const MARGIN = 0.06;

describe('places déclarées', () => {
  it('la Cox et le van : conducteur, passager, arrière ; le concept : conducteur et passager ; les motos rien', () => {
    expect(placesOf(cox).map((place) => [place.id, place.label])).toEqual([
      ['conducteur', 'Conducteur'],
      ['passager', 'Passager'],
      ['arriere', 'Arrière'],
    ]);
    expect(placesOf(van).map((place) => place.id)).toEqual(['conducteur', 'passager', 'arriere']);
    expect(placesOf(concept).map((place) => place.id)).toEqual(['conducteur', 'passager']);
    for (const entry of readdirSync(DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || !existsSync(new URL(`${entry.name}/vehicle.json`, DIR))) continue;
      const raw = JSON.parse(readFileSync(new URL(`${entry.name}/vehicle.json`, DIR), 'utf8')) as VehicleManifest;
      if (raw.kind === 'bike') expect(placesOf(raw), raw.id).toHaveLength(0);
    }
  });

  it('les places des modèles fabriqués sont posées sur les ancres des sièges, pas en coordonnées', () => {
    for (const manifest of [cox, van]) {
      for (const { id, view } of placesOf(manifest)) {
        expect(view.seat, `${manifest.id} ${id}`).toBeDefined();
        expect(view.eye, `${manifest.id} ${id}`).toBeUndefined();
        for (const name of view.seat!.anchors) expect(INTERIOR_CATALOGUE.anchors.seats).toContain(name);
        expect(view.seat!.up).toBeGreaterThanOrEqual(0.7);
        expect(view.seat!.up).toBeLessThanOrEqual(0.9);
      }
      const seat = (id: string) => placeOf(manifest, id)!.view.seat!;
      expect(seat('conducteur').anchors).toEqual([LEFT]);
      expect(seat('passager').anchors).toEqual([RIGHT]);
      expect([...seat('arriere').anchors].sort()).toEqual([LEFT, RIGHT].sort());
      expect(seat('arriere').behind).toBeGreaterThan(0);
    }
  });

  it('une place inconnue, ou que le véhicule n’a pas, retombe sur le conducteur', () => {
    expect(placeOf(cox, 'coffre')?.id).toBe('conducteur');
    expect(placeOf(cox, undefined)?.id).toBe('conducteur');
    expect(placeOf(concept, 'arriere')?.id).toBe('conducteur');
    expect(placeOf(cox, 'arriere')?.id).toBe('arriere');
    expect(placeOf({ interiorView: undefined }, 'conducteur')).toBeNull();
  });

  it('les volets de Custom › Intérieur : volant et pommeau du conducteur, sièges et ciel de l’arrière', () => {
    for (const manifest of [cox, van]) {
      const places = placesOf(manifest);
      expect(['volant', 'pommeau'].map((volet) => placeForVolet(places, volet))).toEqual(['conducteur', 'conducteur']);
      expect(['sieges', 'ciel'].map((volet) => placeForVolet(places, volet))).toEqual(['arriere', 'arriere']);
    }
    // Sans arrière, les sièges se voient du passager.
    expect(placeForVolet(placesOf(concept), 'sieges')).toBe('passager');
  });

  it('le manifeste refuse une place en double, une place inconnue, un siège sans recul ni avance', () => {
    const raw = JSON.parse(readFileSync(new URL('cox/vehicle.json', DIR), 'utf8')) as Record<string, unknown> & { interiorViews: Array<Record<string, unknown>> };
    expect(() => validateManifest({ ...raw, interiorViews: [{ ...raw.interiorViews[0], place: 'conducteur' }] }, 'cox')).toThrow(/chaque place une fois/);
    expect(() => validateManifest({ ...raw, interiorViews: [{ ...raw.interiorViews[0], place: 'coffre' }] }, 'cox')).toThrow(/place doit valoir/);
    expect(() => validateManifest({ ...raw, interiorViews: [{ place: 'passager', seat: { anchors: [RIGHT], up: 0.85 }, look: { yaw: 0, pitch: 0 } }] }, 'cox')).toThrow(/seat doit porter/);
    expect(() => validateManifest({ ...raw, interiorViews: [{ place: 'passager', look: { yaw: 0, pitch: 0 } }] }, 'cox')).toThrow(/seat .* ou eye/);
  });
});

describe('mesure d’un siège et œil d’une place (fonctions pures)', () => {
  it('sans siège mesuré, un siège moyen ; l’œil au-dessus de l’assise, en avant du dossier, sous le pavillon', () => {
    const seat = { anchor: [0, 0.1, -0.3] as [number, number, number], metrics: DEFAULT_SEAT };
    const eye = placeEye({ up: 0.85, ahead: 0.15 }, [seat])!;
    expect(eye[1]).toBeCloseTo(0.1 + DEFAULT_SEAT.cushion + 0.85, 9);
    expect(eye[0]).toBeCloseTo(DEFAULT_SEAT.backFront + 0.15, 9);
    expect(eye[2]).toBe(-0.3);
    // Pavillon bas : l'œil descend, gardé à 12 cm dessous, jamais sous l'assise + 30 cm.
    expect(placeEye({ up: 0.85, ahead: 0.15 }, [seat], () => 1.2)![1]).toBeCloseTo(1.08, 9);
    expect(placeEye({ up: 0.85, ahead: 0.15 }, [seat], () => 0.5)![1]).toBeCloseTo(0.1 + DEFAULT_SEAT.cushion + 0.3, 9);
    expect(placeEye({ up: 0.85, ahead: 0.15 }, [])).toBeNull();
    // Rien à toucher : la mesure retombe sur le siège moyen.
    expect(seatMetrics(() => null, { min: [-0.4, 0, -0.2], max: [0.3, 1, 0.2] }).cushion).toBe(DEFAULT_SEAT.cushion);
  });
});

/** Places de chaque véhicule fabriqué, résolues pour chaque siège du catalogue. */
describe.each([
  ['cox', cox],
  ['van', van],
] as const)('places de %s, sur chaque siège du catalogue', (id, manifest) => {
  let model: Group;
  beforeAll(async () => {
    model = await builtModel(id);
  }, 60_000);

  it.each(SEATS)('siège « %s » : chaque œil dans la caisse, au-dessus de son siège, loin de toute face', (seat) => {
    const remove = poseSeats(model, INTERIOR_CATALOGUE.anchors.seats, seat, manifest.interior?.seats?.scale ?? 1);
    try {
      const eyes = new Map<string, [number, number, number]>();
      for (const { id: place, view } of placesOf(manifest)) {
        const { eye, target, seats } = resolveEye(model, view);
        const where = `${id} ${seat} ${place} (${eye.map((v) => v.toFixed(2)).join(', ')})`;
        eyes.set(place, eye);
        // Dans la caisse : sous un toit, entre les flancs, au-dessus du plancher.
        expect(Math.abs(eye[0]), where).toBeLessThan(manifest.halfLengthHint);
        const roof = roofAbove(model, eye);
        expect(roof, `${where} : rien au-dessus`).not.toBeNull();
        expect(roof! - eye[1], `${where} : sous le pavillon`).toBeGreaterThanOrEqual(0.1);
        // Au-dessus de son siège : à hauteur de tête assise (au moins 70 cm au-dessus de l'assise).
        const cushion = Math.max(...seats.map((s) => s.anchor[1] + s.metrics.cushion));
        expect(eye[1] - cushion, where).toBeGreaterThan(0.7);
        expect(eye[1] - cushion, where).toBeLessThanOrEqual(0.9 + 1e-9);
        // Siège avant : au-dessus de son assise, devant son dossier ; arrière : derrière les dossiers avant.
        if (view.seat?.behind === undefined) {
          const s = seats[0]!;
          expect(Math.abs(eye[2] - s.anchor[2]), where).toBeLessThan(0.15);
          expect(eye[0], where).toBeGreaterThan(s.anchor[0] + s.metrics.backFront + 0.05);
        } else {
          expect(eye[0], where).toBeLessThan(Math.min(...seats.map((s) => s.anchor[0] + s.metrics.back)) - 0.1);
        }
        // Hors de tout maillage : ni dans un dossier, ni dans un montant, ni dans le pavillon.
        const near = clearance(model, eye);
        expect(near.distance, `${where} : à ${near.distance.toFixed(3)} m de ${near.name}`).toBeGreaterThan(MARGIN);
        // Regard vers l'avant.
        expect(target[0], where).toBeGreaterThan(eye[0]);
        expect(Math.abs(lookFrom(eye, target).pitch), where).toBeLessThan(0.5);
      }
      // Le conducteur à gauche (conduite à gauche), le passager à droite.
      expect(eyes.get('conducteur')![2]).toBeLessThan(-0.15);
      expect(eyes.get('passager')![2]).toBeGreaterThan(0.15);
    } finally {
      remove();
    }
  });
});

describe('places du concept, mesurées dans son GLB', () => {
  let model: Group;
  beforeAll(async () => {
    model = await storedModel('concept');
  }, 60_000);
  afterAll(() => model.clear());

  it('chaque œil est dans l’habitacle, sous le pare-brise, loin de toute face ; le conducteur à gauche du passager', () => {
    const eyes = new Map<string, [number, number, number]>();
    for (const { id: place, view } of placesOf(concept)) {
      const { eye, target } = resolveEye(model, view);
      const where = `concept ${place}`;
      eyes.set(place, eye);
      const roof = roofAbove(model, eye);
      expect(roof, `${where} : rien au-dessus`).not.toBeNull();
      expect(roof! - eye[1], where).toBeGreaterThanOrEqual(0.1);
      const near = clearance(model, eye);
      expect(near.distance, `${where} : à ${near.distance.toFixed(3)} m de ${near.name}`).toBeGreaterThan(MARGIN);
      expect(target[0]).toBeGreaterThan(eye[0]);
    }
    // Poste de conduite central sur ce modèle (volant au milieu) ; le passager sur le siège de droite.
    expect(eyes.get('conducteur')![2]).toBeLessThan(eyes.get('passager')![2]);
  });
});

describe('place choisie, gardée par véhicule', () => {
  beforeEach(() => {
    useView.setState({ mode: 'atelier', place: 'conducteur', places: {}, focus: null });
  });

  it('le bouton rond entre à la place gardée (le conducteur la première fois), et ressort', () => {
    const { enterOrLeave, sit } = useView.getState();
    enterOrLeave('cox');
    expect(useView.getState()).toMatchObject({ mode: 'interieur', place: 'conducteur' });
    sit('cox', 'arriere');
    expect(useView.getState()).toMatchObject({ mode: 'interieur', place: 'arriere', places: { cox: 'arriere' } });
    enterOrLeave('cox');
    expect(useView.getState().mode).toBe('atelier');
    enterOrLeave('van');
    expect(useView.getState().place).toBe('conducteur');
    useView.getState().setMode('atelier');
    enterOrLeave('cox');
    expect(useView.getState().place).toBe('arriere');
  });

  it('une place posée par l’app (Custom › Intérieur) n’est pas gardée ; son regard visé s’efface au choix à la main', () => {
    useView.getState().sit('van', 'passager');
    useView.getState().sit('van', 'arriere', false);
    expect(useView.getState()).toMatchObject({ place: 'arriere', places: { van: 'passager' }, focus: null });
    useView.getState().sit('van', 'conducteur', false, INTERIOR_CATALOGUE.anchors.knob);
    expect(useView.getState()).toMatchObject({ place: 'conducteur', focus: INTERIOR_CATALOGUE.anchors.knob, places: { van: 'passager' } });
    useView.getState().sit('van', 'conducteur');
    expect(useView.getState()).toMatchObject({ place: 'conducteur', focus: null, places: { van: 'conducteur' } });
  });

  it('la sauvegarde abîmée se relit sans casser : seules les places connues comptent', () => {
    expect(PLACES_KEY).toBe('pmb-places');
    expect(readPlaces(null)).toEqual({});
    expect(readPlaces('pas du json')).toEqual({});
    expect(readPlaces('[1,2]')).toEqual({});
    expect(readPlaces(JSON.stringify({ cox: 'arriere', van: 'toit', 'Mauvais Nom': 'passager', concept: 'passager' }))).toEqual({ cox: 'arriere', concept: 'passager' });
  });
});
