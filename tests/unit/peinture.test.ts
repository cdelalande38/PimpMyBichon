// Onglet « Peinture » : conversions du nuancier, zones liées vues par l'interface, réglages
// propres à une zone transmis au rendu (taille de paillette, seconde teinte).
import 'fake-indexeddb/auto';
import { Color } from 'three';
import { beforeEach, describe, expect, it } from 'vitest';
import { finish, FINISHES } from '../../src/data/finishes.ts';
import { PAINT_COLORS } from '../../src/data/paintColors.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { applyPaint, createPaintMaterial, flipColor, paintUniforms } from '../../src/render/paint.ts';
import { DEFAULT_BUILDS, FLAKE_RANGE, resolvePaint, sanitizeBuilds, useBuilds } from '../../src/state/builds.ts';
import {
  canLink,
  color2Value,
  flakeValue,
  formatMillimeters,
  hasColor2,
  hasFlake,
  hexToHsv,
  hsvToHex,
  LOCK_MESSAGE,
  lockLabel,
  lockMessage,
  lockReminder,
  lockState,
  masterPhrase,
  ofPhrase,
  orderedZones,
  paintTarget,
  pickableColors,
  relockLoses,
  relockQuestion,
} from '../../src/ui/paint/paintLogic.ts';

const MANIFEST: VehicleManifest = {
  id: 'essai',
  name: 'Le véhicule d’essai',
  kind: 'car',
  wave: 1,
  order: 1,
  glb: 'body.glb',
  halfLengthHint: 2,
  zones: [
    { id: 'jantes', label: 'Jantes', materials: ['paint_jantes'], group: 'accastillage', paint: { color: '#c0c0c0', finish: 'chrome' } },
    { id: 'caisse', label: 'Carrosserie', materials: ['paint_caisse'], group: 'carrosserie', paint: { color: '#0a3a46', finish: 'paillete' } },
    { id: 'capot', label: 'Capot', materials: ['paint_capot'], group: 'carrosserie', paint: { color: '#111111', finish: 'mat' } },
    { id: 'toit', label: 'Toit', materials: ['paint_toit'], group: 'carrosserie', linked: false, paint: { color: '#e6dcc0', finish: 'satine' } },
  ],
};

describe('nuancier : conversions de couleur', () => {
  it('rend les couleurs franches', () => {
    expect(hsvToHex({ h: 0, s: 1, v: 1 })).toBe('#ff0000');
    expect(hsvToHex({ h: 120, s: 1, v: 1 })).toBe('#00ff00');
    expect(hsvToHex({ h: 240, s: 1, v: 1 })).toBe('#0000ff');
    expect(hsvToHex({ h: 60, s: 1, v: 1 })).toBe('#ffff00');
    expect(hsvToHex({ h: 0, s: 0, v: 1 })).toBe('#ffffff');
    expect(hsvToHex({ h: 200, s: 0.7, v: 0 })).toBe('#000000');
  });

  it('borne ce qui sort des plages au lieu de casser', () => {
    expect(hsvToHex({ h: 360, s: 1, v: 1 })).toBe('#ff0000');
    expect(hsvToHex({ h: -120, s: 2, v: 1.5 })).toBe('#0000ff');
    expect(hsvToHex({ h: Number.NaN, s: Number.NaN, v: 1 })).toBe('#ffffff');
  });

  it('fait l’aller-retour sans perte sur toute la palette', () => {
    for (const color of PAINT_COLORS) {
      const hsv = hexToHsv(color.hex);
      expect(hsv, color.id).not.toBeNull();
      if (hsv) expect(hsvToHex(hsv), color.id).toBe(color.hex);
    }
  });

  it('lit les formes de saisie courantes et refuse le reste', () => {
    expect(hexToHsv('FF6A00')).toEqual(hexToHsv('#ff6a00'));
    expect(hexToHsv('#f00')).toEqual({ h: 0, s: 1, v: 1 });
    expect(hexToHsv('rouge')).toBeNull();
    expect(hexToHsv('#12345')).toBeNull();
  });

  it('garde la teinte en cours sur un gris : le curseur ne saute pas', () => {
    expect(hexToHsv('#7b7b7b', 210)?.h).toBe(210);
    expect(hexToHsv('#000000', 42)).toEqual({ h: 42, s: 0, v: 0 });
  });
});

describe('zones vues par l’interface', () => {
  beforeEach(() => {
    useBuilds.setState({ ...DEFAULT_BUILDS, builds: {}, recents: [] });
  });

  it('met la zone maîtresse en tête des puces, le reste dans l’ordre du manifeste', () => {
    expect(orderedZones(MANIFEST).map((zone) => zone.id)).toEqual(['caisse', 'jantes', 'capot', 'toit']);
  });

  it('ne met un cadenas que sur les zones de carrosserie autres que la maîtresse', () => {
    expect(canLink(MANIFEST, 'caisse')).toBe(false);
    expect(canLink(MANIFEST, 'jantes')).toBe(false);
    expect(canLink(MANIFEST, 'capot')).toBe(true);
    expect(canLink(MANIFEST, 'toit')).toBe(true);
    expect(canLink(MANIFEST, 'inconnue')).toBe(false);
  });

  it('cadenas : aucun sur la maîtresse et l’accastillage, fermé si la zone suit, ouvert sinon', () => {
    expect(lockState(MANIFEST, undefined, 'caisse')).toBe('aucun');
    expect(lockState(MANIFEST, undefined, 'jantes')).toBe('aucun');
    expect(lockState(MANIFEST, undefined, 'capot')).toBe('ferme');
    expect(lockState(MANIFEST, undefined, 'toit')).toBe('ouvert');
    const build = { paints: { capot: { linked: false, color: '#111111', finish: 'mat' as const }, toit: { linked: true } } };
    expect(lockState(MANIFEST, build, 'capot')).toBe('ouvert');
    expect(lockState(MANIFEST, build, 'toit')).toBe('ferme');
  });

  it('cadenas : nom accessible en clair (état, puis geste), message en tutoiement', () => {
    expect(lockLabel('Toit', 'ferme')).toBe('Toit : suit la carrosserie, ouvrir le cadenas');
    expect(lockLabel('Ailes', 'ouvert')).toBe('Ailes : peinture à part, refermer le cadenas');
    expect(LOCK_MESSAGE).toBe('Cette partie suit la carrosserie. Ouvre son cadenas pour lui donner sa propre peinture.');
  });

  it('cadenas d’une moto : la zone maîtresse nommée par le manifeste, article compris', () => {
    const moto = {
      zones: [
        { id: 'reservoir', label: 'Réservoir', phrase: 'le réservoir', materials: ['paint_reservoir'], group: 'carrosserie' as const, paint: { color: '#111111', finish: 'brillant' as const } },
        { id: 'garde_boue', label: 'Garde-boue', materials: ['paint_garde_boue'], group: 'carrosserie' as const, paint: { color: '#111111', finish: 'brillant' as const } },
      ],
    };
    expect(masterPhrase(MANIFEST)).toBe('la carrosserie');
    const phrase = masterPhrase(moto);
    expect(phrase).toBe('le réservoir');
    expect(lockLabel('Garde-boue', 'ferme', phrase)).toBe('Garde-boue : suit le réservoir, ouvrir le cadenas');
    expect(lockReminder('ferme', phrase)).toBe('Suit le réservoir');
    expect(lockReminder('ouvert', phrase)).toBe('Peinture à part');
    expect(lockMessage(phrase)).toBe('Cette partie suit le réservoir. Ouvre son cadenas pour lui donner sa propre peinture.');
    expect(ofPhrase('le réservoir')).toBe('du réservoir');
    expect(ofPhrase('la carrosserie')).toBe('de la carrosserie');
    expect(ofPhrase('l’aile')).toBe('de l’aile');
    expect(relockQuestion('Garde-boue', phrase)).toBe(
      'Refermer le cadenas de « Garde-boue » ? Cette partie reprendra la peinture du réservoir et perdra la sienne.',
    );
    // Une précision vide ne vaut rien : « la carrosserie ».
    expect(masterPhrase({ zones: [{ ...moto.zones[0]!, phrase: '  ' }] })).toBe('la carrosserie');
  });

  it('refermer un cadenas : une question seulement s’il y a quelque chose à perdre', () => {
    // Toit détaché d'origine, sa propre peinture (crème satiné) : la refermer la perdrait.
    expect(relockLoses(MANIFEST, undefined, 'toit')).toBe(true);
    // Même peinture que la carrosserie (paillette d'origine comprise) : rien à perdre.
    const same = { paints: { toit: { color: '#0a3a46', finish: 'paillete' as const } } };
    expect(relockLoses(MANIFEST, same, 'toit')).toBe(false);
    // La même couleur avec une autre taille de paillette : il y a quelque chose à perdre.
    const flake = { paints: { toit: { color: '#0a3a46', finish: 'paillete' as const, flake: 1.4 } } };
    expect(relockLoses(MANIFEST, flake, 'toit')).toBe(true);
    // La carrosserie repeinte en crème satiné : le toit lui ressemble, rien à perdre.
    const repainted = { paints: { caisse: { color: '#e6dcc0', finish: 'satine' as const } } };
    expect(relockLoses(MANIFEST, repainted, 'toit')).toBe(false);
    // Zone fermée, zone maîtresse, accastillage : pas de question.
    expect(relockLoses(MANIFEST, undefined, 'capot')).toBe(false);
    expect(relockLoses(MANIFEST, undefined, 'caisse')).toBe(false);
    expect(relockLoses(MANIFEST, undefined, 'jantes')).toBe(false);
  });

  it('peindre une zone liée repeint la maîtresse ; détachée, la zone seule', () => {
    expect(paintTarget(MANIFEST, undefined, 'capot')).toBe('caisse');
    expect(paintTarget(MANIFEST, undefined, 'toit')).toBe('toit');
    expect(paintTarget(MANIFEST, undefined, 'jantes')).toBe('jantes');
    expect(paintTarget(MANIFEST, undefined, 'caisse')).toBe('caisse');
  });

  it('détacher au cadenas garde la peinture du moment, puis la zone se peint seule', () => {
    const { setLinked, setPaint } = useBuilds.getState();
    const build = () => useBuilds.getState().builds.essai;
    // Le capot suit la carrosserie : on la repeint en orange depuis sa puce.
    setPaint('essai', paintTarget(MANIFEST, build(), 'capot'), { color: '#ff6a00' });
    const before = resolvePaint(MANIFEST, build(), 'capot');
    expect(before?.color).toBe('#ff6a00');

    setLinked('essai', 'capot', false, before);
    expect(resolvePaint(MANIFEST, build(), 'capot')).toEqual(before);
    expect(paintTarget(MANIFEST, build(), 'capot')).toBe('capot');

    setPaint('essai', paintTarget(MANIFEST, build(), 'capot'), { color: '#132a72' });
    expect(resolvePaint(MANIFEST, build(), 'capot')?.color).toBe('#132a72');
    expect(resolvePaint(MANIFEST, build(), 'caisse')?.color).toBe('#ff6a00');

    // Relié : il reprend la carrosserie.
    setLinked('essai', 'capot', true);
    expect(resolvePaint(MANIFEST, build(), 'capot')?.color).toBe('#ff6a00');
  });

  it('la pipette propose les couleurs des autres zones, sans doublon ni la sienne', () => {
    const list = pickableColors(MANIFEST, undefined, 'toit');
    // Le capot suit la carrosserie : une seule pastille pour les deux.
    expect(list).toEqual([
      { zoneId: 'caisse', label: 'Carrosserie', color: '#0a3a46' },
      { zoneId: 'jantes', label: 'Jantes', color: '#c0c0c0' },
    ]);
    expect(pickableColors(MANIFEST, undefined, 'capot').map((item) => item.zoneId)).toEqual(['jantes', 'toit']);
  });
});

describe('réglages propres à la finition', () => {
  it('le curseur de paillette n’apparaît qu’avec des paillettes, la seconde teinte qu’au caméléon', () => {
    expect(hasFlake(finish('paillete'))).toBe(true);
    expect(hasFlake(finish('mat'))).toBe(false);
    expect(FINISHES.filter(hasColor2).map((item) => item.id)).toEqual(['cameleon']);
  });

  it('chaque taille de paillette d’origine tient dans les bornes du curseur', () => {
    for (const item of FINISHES.filter(hasFlake)) {
      expect(item.flakeSize, item.id).toBeGreaterThanOrEqual(FLAKE_RANGE.min);
      expect(item.flakeSize, item.id).toBeLessThanOrEqual(FLAKE_RANGE.max);
      expect(flakeValue(item.id, undefined)).toBe(item.flakeSize);
    }
    expect(flakeValue('paillete', 1.2)).toBe(1.2);
    expect(flakeValue('paillete', 99)).toBe(FLAKE_RANGE.max);
    // Une sauvegarde à grosses paillettes est relue telle quelle.
    const saved = sanitizeBuilds({ builds: { essai: { paints: { caisse: { flake: 3 } } } } });
    expect(saved.builds.essai?.paints.caisse?.flake).toBe(3);
    expect(formatMillimeters(0.6)).toBe('0,6 mm');
  });

  it('la seconde teinte affichée est celle de la zone, sinon celle que déduit la finition', () => {
    expect(color2Value('#ff0000', 'cameleon', '#00ff00')).toBe('#00ff00');
    const auto = color2Value('#ff0000', 'cameleon', undefined);
    expect(auto).toBe(`#${flipColor('#ff0000', finish('cameleon')).getHexString()}`);
    expect(auto).not.toBe('#ff0000');
  });
});

describe('rendu : réglages propres à une zone', () => {
  const flipOf = (material: ReturnType<typeof createPaintMaterial>) =>
    (material.userData.pmbPaint as { pmbFlipColor: { value: Color } }).pmbFlipColor.value;

  it('sans quatrième paramètre, rien ne change', () => {
    const a = createPaintMaterial();
    const b = createPaintMaterial();
    applyPaint(a, '#ff6a00', finish('cameleon'));
    applyPaint(b, '#ff6a00', finish('cameleon'), {});
    expect(paintUniforms(b)).toEqual(paintUniforms(a));
    expect(paintUniforms(a).flakeSize).toBeCloseTo(finish('cameleon').flakeSize / 1000);
    expect(flipOf(b).equals(flipOf(a))).toBe(true);
    expect(flipOf(a).equals(flipColor('#ff6a00', finish('cameleon')))).toBe(true);
  });

  it('pose la taille de paillette et la seconde teinte de la zone', () => {
    const material = createPaintMaterial();
    applyPaint(material, '#ff6a00', finish('cameleon'), { flake: 1.5, color2: '#132a72' });
    expect(paintUniforms(material).flakeSize).toBeCloseTo(0.0015);
    expect(flipOf(material).equals(new Color('#132a72'))).toBe(true);
    // Retour sans réglage : la finition reprend la main.
    applyPaint(material, '#ff6a00', finish('cameleon'));
    expect(paintUniforms(material).flakeSize).toBeCloseTo(finish('cameleon').flakeSize / 1000);
    expect(flipOf(material).equals(flipColor('#ff6a00', finish('cameleon')))).toBe(true);
  });
});
