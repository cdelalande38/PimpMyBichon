// Cadrage d'une zone de livrée pendant la pose d'un sticker (Custom › Stickers) : une zone → une vue
// (de profil, de face ou en plongée depuis l'arrière, dans la partie libre au-dessus du panneau, dans
// le sens du plan à plat), transitions sur l'orbite, retour à la vue d'avant ; la demande du panneau ;
// ce que la bibliothèque dit d'un pack à acheter et d'un trophée à gagner.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ZONE_FRAMING_LIMITS, ZONE_FRAMINGS, zoneFramingFor } from '../../src/data/framings.ts';
import { GARAGE } from '../../src/data/garage.ts';
import { HAUTS_FAITS } from '../../src/data/hautsFaits.ts';
import { motifsOf, stickerArticle } from '../../src/data/stickers.ts';
import { zoneFrame, type LiveryZone } from '../../src/data/stickersCalques.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { COVER_TOLERANCE, useZoneFocus } from '../../src/scene/cadrageZone.ts';
import {
  blendOrbit,
  createZoneRig,
  dropZone,
  fitVehicle,
  fitZone,
  orbitAngles,
  orbitPosition,
  presentPose,
  projectPoints,
  requestZone,
  stepZone,
  vehicleToRoom,
  zoneCorners,
  type OrbitPose,
  type ScreenFrame,
} from '../../src/scene/fit.ts';
import { packForSale, trophyAchievement, trophyHint } from '../../src/ui/stickers/verrous.ts';

const DIR = new URL('../../public/assets/vehicles/', import.meta.url);
const MANIFESTS: VehicleManifest[] = readdirSync(DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => JSON.parse(readFileSync(new URL(`${entry.name}/vehicle.json`, DIR), 'utf8')) as VehicleManifest);

const POLAR = { min: GARAGE.orbit.minPolar, max: GARAGE.orbit.maxPolar };
/** Portrait de référence : la partie libre sous la marque (10 %) et au-dessus du panneau des stickers. */
const PORTRAIT = { width: 390, height: 844, free: { left: 0, right: 390, top: 84, bottom: 440 } };
/** Paysage : entre les boutons ronds et le menu en colonne, sous la bande de la marque. */
const PAYSAGE = { width: 844, height: 390, free: { left: 84, right: 528, top: 78, bottom: 390 } };

function screenOf(fit: ReturnType<typeof fitZone>, width: number, height: number, point: readonly [number, number, number]): [number, number] {
  const frame = projectPoints([point], { eye: fit.position, target: fit.target, fov: fit.fov, width, height });
  return [frame.left - fit.shiftX, frame.top - fit.shiftY];
}

function inside(frame: ScreenFrame, free: ScreenFrame, slack = 1): boolean {
  return frame.left >= free.left - slack && frame.right <= free.right + slack && frame.top >= free.top - slack && frame.bottom <= free.bottom + slack;
}

describe('cadrages de pose, en données', () => {
  it('chaque cadrage reste dans ses bornes, et dans l’orbite du garage', () => {
    for (const framing of ZONE_FRAMINGS) {
      expect(framing.elevation).toBeGreaterThanOrEqual(ZONE_FRAMING_LIMITS.elevation.min);
      expect(framing.elevation).toBeLessThanOrEqual(ZONE_FRAMING_LIMITS.elevation.max);
      expect(Math.PI / 2 - framing.elevation).toBeGreaterThanOrEqual(GARAGE.orbit.minPolar);
      expect(Math.PI / 2 - framing.elevation).toBeLessThanOrEqual(GARAGE.orbit.maxPolar);
      expect(framing.margin).toBeGreaterThanOrEqual(ZONE_FRAMING_LIMITS.margin.min);
      expect(framing.margin).toBeLessThanOrEqual(ZONE_FRAMING_LIMITS.margin.max);
      expect(framing.marginShare).toBeGreaterThanOrEqual(ZONE_FRAMING_LIMITS.marginShare.min);
      expect(framing.marginShare).toBeLessThanOrEqual(ZONE_FRAMING_LIMITS.marginShare.max);
      for (const share of [framing.share, framing.shareHeight]) {
        expect(share).toBeGreaterThanOrEqual(ZONE_FRAMING_LIMITS.share.min);
        expect(share).toBeLessThanOrEqual(ZONE_FRAMING_LIMITS.share.max);
      }
    }
  });

  it('chaque face a son cadrage, une seule fois : profil pour un flanc, face pour l’avant ou l’arrière, dessus pour un capot', () => {
    const faces = ZONE_FRAMINGS.flatMap((framing) => framing.faces);
    expect(new Set(faces).size).toBe(faces.length);
    expect(zoneFramingFor('-z').id).toBe('profil');
    expect(zoneFramingFor('+z').id).toBe('profil');
    expect(zoneFramingFor('+x').id).toBe('face');
    expect(zoneFramingFor('-x').id).toBe('face');
    expect(zoneFramingFor('+y').id).toBe('dessus');
  });
});

describe('une zone → une vue, sur chaque zone de chaque véhicule', () => {
  for (const manifest of MANIFESTS) {
    const { turn } = presentPose(manifest.presentSide);
    for (const zone of manifest.livery ?? []) {
      for (const [name, screen] of [
        ['portrait', PORTRAIT],
        ['paysage', PAYSAGE],
      ] as const) {
        it(`${manifest.id} › ${zone.id} (${name}) : la zone, dans le sens du plan, en grand dans la partie libre`, () => {
          const framing = zoneFramingFor(zone.face);
          const fit = fitZone({ width: screen.width, height: screen.height, zone, framing, turn, free: screen.free, polar: POLAR });
          // La cible est le centre de la zone ; la caméra, du côté qu'elle regarde, dans l'orbite du garage.
          const center = vehicleToRoom(zone.center, turn);
          fit.target.forEach((value, i) => expect(value).toBeCloseTo(center[i]!, 6));
          expect(fit.polar).toBeGreaterThanOrEqual(POLAR.min - 1e-9);
          expect(fit.polar).toBeLessThanOrEqual(POLAR.max + 1e-9);
          const normal = vehicleToRoom(zoneFrame(zone.face).normal, turn);
          const away = [0, 1, 2].reduce((sum, i) => sum + (fit.position[i]! - fit.target[i]!) * normal[i]!, 0);
          expect(away, 'caméra du côté de la face').toBeGreaterThan(0);
          // Toute la zone (et sa marge) dans la partie libre, qu'elle remplit au moins dans un sens.
          expect(inside(fit.frame, screen.free), JSON.stringify(fit.frame)).toBe(true);
          expect(inside(fit.zoneFrame, fit.frame)).toBe(true);
          // La zone seule, en grand : 38 % de la partie libre au moins dans un sens (un petit garde-boue compris).
          const zoneFill = Math.max((fit.zoneFrame.right - fit.zoneFrame.left) / (screen.free.right - screen.free.left), (fit.zoneFrame.bottom - fit.zoneFrame.top) / (screen.free.bottom - screen.free.top));
          expect(zoneFill, `${Math.round(zoneFill * 100)} %`).toBeGreaterThan(0.38);
          const fillWidth = (fit.frame.right - fit.frame.left) / (screen.free.right - screen.free.left);
          const fillHeight = (fit.frame.bottom - fit.frame.top) / (screen.free.bottom - screen.free.top);
          // La cible au centre, la perspective rend le bord proche plus grand que le bord lointain : le cadre
          // tient dans la part prévue de part et d'autre de la cible, et la remplit à 85 % au moins.
          expect(Math.max(fillWidth / framing.share, fillHeight / framing.shareHeight)).toBeGreaterThan(0.85);
          // Centrée dans la partie libre.
          const freeX = (screen.free.left + screen.free.right) / 2;
          const freeY = (screen.free.top + screen.free.bottom) / 2;
          expect(Math.abs((fit.frame.left + fit.frame.right) / 2 - freeX)).toBeLessThan((screen.free.right - screen.free.left) * 0.06);
          expect(Math.abs((fit.frame.top + fit.frame.bottom) / 2 - freeY)).toBeLessThan((screen.free.bottom - screen.free.top) * 0.08);
          // Dans le sens du plan : sa droite à droite de l'écran, son haut vers le haut.
          const { right, up } = zoneFrame(zone.face);
          const local = (axis: readonly number[], length: number) => vehicleToRoom([zone.center[0] + axis[0]! * length, zone.center[1] + axis[1]! * length, zone.center[2] + axis[2]! * length], turn);
          const [cx, cy] = screenOf(fit, screen.width, screen.height, center);
          const [rx] = screenOf(fit, screen.width, screen.height, local(right, zone.size[0] / 2));
          const [, uy] = screenOf(fit, screen.width, screen.height, local(up, zone.size[1] / 2));
          expect(rx, 'la droite du plan à droite de l’écran').toBeGreaterThan(cx);
          expect(uy, 'le haut du plan vers le haut de l’écran').toBeLessThan(cy);
        });
      }
    }
  }

  it('chaque zone se voit nettement plus grande que dans la vue de départ (portrait)', () => {
    for (const manifest of MANIFESTS) {
    // Boîte d'attente du garage (src/scene/GarageCanvas.tsx, WAITING_BOX), demi-longueur du manifeste.
    const box = manifest.kind === 'bike' ? { halfWidth: 0.4, height: 1.1 } : { halfWidth: 0.9, height: 1.35 };
    const { turn, azimuth } = presentPose(manifest.presentSide);
    const start = fitVehicle({ width: 390, height: 844, size: { halfLength: manifest.halfLengthHint, ...box }, turn, azimuth, band: { top: 84, bottom: 650 } });
    const eye = orbitPosition(start.target, start.distance, start.azimuth);
    for (const zone of manifest.livery ?? []) {
      const before = projectPoints(zoneCorners(zone, turn), { eye, target: start.target, fov: start.fov, width: 390, height: 844 });
      const fit = fitZone({ width: 390, height: 844, zone, framing: zoneFramingFor(zone.face), turn, free: PORTRAIT.free, polar: POLAR });
      const area = (frame: ScreenFrame) => (frame.right - frame.left) * (frame.bottom - frame.top);
      const gain = area(fit.zoneFrame) / area(before);
      expect(gain, `${manifest.id} › ${zone.id} : ${gain.toFixed(2)} fois la surface de départ`).toBeGreaterThan(zone.face === '-z' || zone.face === '+z' ? 1.15 : 2);
    }
    }
  });

  it('flanc gauche et flanc droit : chacun vu de son côté (symétrie coupée)', () => {
    for (const manifest of MANIFESTS) {
      const { turn } = presentPose(manifest.presentSide);
      const pair = (manifest.livery ?? []).filter((zone): zone is LiveryZone => zone.face === '-z' || zone.face === '+z');
      if (pair.length < 2) continue;
      const sides = pair.map((zone) => Math.sign(fitZone({ ...PORTRAIT, zone, framing: zoneFramingFor(zone.face), turn, polar: POLAR }).position[2] - vehicleToRoom(zone.center, turn)[2]));
      expect(new Set(sides).size, manifest.id).toBe(2);
    }
  });
});

describe('transitions sur l’orbite', () => {
  const from: OrbitPose = { position: [0, 2, 8], target: [0, 0.5, 0] };
  const to: OrbitPose = { position: [-3, 1, -1], target: [1, 0.8, 0.4] };

  it('part de la pose de départ, arrive à la pose visée', () => {
    const out: OrbitPose = { position: [0, 0, 0], target: [0, 0, 0] };
    blendOrbit(from, to, 0, out);
    out.position.forEach((value, i) => expect(value).toBeCloseTo(from.position[i]!, 9));
    blendOrbit(from, to, 1, out);
    out.position.forEach((value, i) => expect(value).toBeCloseTo(to.position[i]!, 9));
    out.target.forEach((value, i) => expect(value).toBeCloseTo(to.target[i]!, 9));
  });

  it('tourne par le plus court chemin, à distance proportionnelle, sans traverser la cible', () => {
    const a: OrbitPose = { position: orbitPosition([0, 0, 0], 4, 3, 1.2), target: [0, 0, 0] };
    const b: OrbitPose = { position: orbitPosition([0, 0, 0], 1, -3, 1.2), target: [0, 0, 0] };
    const out: OrbitPose = { position: [0, 0, 0], target: [0, 0, 0] };
    blendOrbit(a, b, 0.5, out);
    const mid = orbitAngles(out.position, out.target);
    // De 3 rad à −3 rad, le plus court passe par π (≈ 0,28 rad de chemin), pas par 0.
    expect(Math.abs(Math.abs(mid.azimuth) - Math.PI)).toBeLessThan(0.01);
    expect(mid.distance).toBeCloseTo(2, 6);
  });
});

describe('cadrage de zone : entrer, changer de zone, revenir à la vue d’avant', () => {
  const home: OrbitPose = { position: [3, 2, 7], target: [0, 0.6, 0] };
  const capot: OrbitPose = { position: [1, 3, 0.5], target: [-1.3, 0.85, 0] };
  const toit: OrbitPose = { position: [1.5, 3.2, 0.2], target: [0.5, 1.25, 0] };
  const out: OrbitPose = { position: [0, 0, 0], target: [0, 0, 0] };

  it('entre en douceur, l’horloge partant de la première image, puis tient la zone', () => {
    const rig = createZoneRig();
    requestZone(rig, { key: 'cox|capot', goal: capot }, home, home, 1000, 480);
    expect(rig.phase).toBe('entering');
    // Première image tardive (téléphone occupé) : la transition part de là, elle n'est pas sautée.
    expect(stepZone(rig, 1700, out)).toBe(false);
    out.position.forEach((value, i) => expect(value).toBeCloseTo(home.position[i]!, 9));
    expect(stepZone(rig, 1940, out)).toBe(false);
    expect(out.position).not.toEqual(capot.position);
    expect(stepZone(rig, 2180, out)).toBe(true);
    expect(rig.phase).toBe('in');
    expect(out).toEqual(capot);
  });

  it('d’une zone à l’autre, la vue d’avant reste celle d’avant les stickers ; en sortant, la caméra y revient', () => {
    const rig = createZoneRig();
    requestZone(rig, { key: 'cox|capot', goal: capot }, home, home, 0, 480);
    stepZone(rig, 0, out);
    stepZone(rig, 480, out);
    // Le doigt tourne un peu autour du capot, puis on passe au toit : la vue d'avant ne bouge pas.
    const touched: OrbitPose = { position: [1.2, 2.9, 0.9], target: capot.target };
    requestZone(rig, { key: 'cox|toit', goal: toit }, touched, touched, 1000, 480);
    expect(rig.from).toEqual(touched);
    expect(rig.saved).toEqual(home);
    stepZone(rig, 1000, out);
    stepZone(rig, 1480, out);
    expect(out).toEqual(toit);
    // Même demande (le panneau se remesure) : rien ne bouge.
    requestZone(rig, { key: 'cox|toit', goal: toit }, toit, toit, 2000, 480);
    expect(rig.phase).toBe('in');
    // Panneau fermé : retour à la vue d'avant, en douceur.
    requestZone(rig, null, toit, touched, 3000, 480);
    expect(rig.phase).toBe('leaving');
    expect(stepZone(rig, 3000, out)).toBe(false);
    expect(stepZone(rig, 3200, out)).toBe(false);
    expect(stepZone(rig, 3480, out)).toBe(true);
    expect(rig.phase).toBe('out');
    expect(out).toEqual(home);
    expect(rig.saved).toBeNull();
  });

  it('rouvert pendant le retour : la vue d’avant reste la même ; sans mouvement : tout de suite', () => {
    const rig = createZoneRig();
    requestZone(rig, { key: 'a', goal: capot }, home, home, 0, 0);
    expect(stepZone(rig, 0, out)).toBe(true);
    requestZone(rig, null, capot, capot, 10, 480);
    requestZone(rig, { key: 'a', goal: capot }, toit, toit, 20, 480);
    expect(rig.phase).toBe('entering');
    expect(rig.saved).toEqual(home);
    // Mode photo ou vue intérieure : le cadrage s'efface sans bouger la caméra.
    dropZone(rig);
    expect(rig.phase).toBe('out');
    expect(rig.saved).toBeNull();
  });
});

describe('demande du panneau des stickers', () => {
  it('une même zone ne se redemande pas ; un panneau qui bouge de quelques pixels ne recadre pas', () => {
    const store = useZoneFocus.getState();
    store.setFocus({ vehicle: 'cox', zone: 'capot' });
    const first = useZoneFocus.getState().focus;
    store.setFocus({ vehicle: 'cox', zone: 'capot' });
    expect(useZoneFocus.getState().focus).toBe(first);
    store.setCoverTop(440);
    store.setCoverTop(440 + COVER_TOLERANCE - 1);
    expect(useZoneFocus.getState().coverTop).toBe(440);
    store.setCoverTop(380);
    expect(useZoneFocus.getState().coverTop).toBe(380);
    store.setFocus(null);
    store.setCoverTop(null);
    expect(useZoneFocus.getState()).toMatchObject({ focus: null, coverTop: null });
  });
});

describe('bibliothèque : pack à acheter, trophée à gagner', () => {
  it('un pack payant se vend, le pack de départ non', () => {
    expect(packForSale('depart')).toBeUndefined();
    expect(packForSale(null)).toBeUndefined();
    for (const pack of ['flammes', 'course', 'atelier'] as const) {
      const article = packForSale(pack);
      expect(article?.id).toBe(`pack-${pack}`);
      expect(article?.prix).toBeGreaterThan(0);
    }
  });

  it('chaque trophée dit en une phrase comment le gagner, d’après le haut fait qui l’offre', () => {
    const trophies = motifsOf(null);
    expect(trophies.length).toBeGreaterThan(0);
    for (const motif of trophies) {
      const def = trophyAchievement(motif);
      expect(def, motif.id).toBeDefined();
      expect(def?.recompense.articles).toContain(stickerArticle(motif.id));
      const hint = trophyHint(motif);
      expect(hint).toMatch(/^Pour le gagner : [a-zà-ÿ]/);
      expect(hint.endsWith('.')).toBe(true);
      expect(hint.split(/[.!?](\s|$)/).filter((part) => part.trim().length > 1)).toHaveLength(1);
    }
    expect(trophyHint(motifsOf(null).find((motif) => motif.id === 'trophee-or')!)).toBe(`Pour le gagner : ${HAUTS_FAITS.find((def) => def.id === 'premier-or')!.description.replace(/^D/, 'd')}`);
  });
});
