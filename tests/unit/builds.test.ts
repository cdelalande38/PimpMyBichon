// Builds : résolution des peintures par zone, liaison à la zone maîtresse, lecture tolérante.
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Build, VehicleManifest } from '../../src/data/vehicleTypes.ts';
import {
  DEFAULT_BUILDS,
  FLAKE_RANGE,
  RECENT_COLORS,
  isLinked,
  masterZone,
  normalizeHex,
  resolvePaint,
  resolvePaints,
  sanitizeBuilds,
  useBuilds,
} from '../../src/state/builds.ts';

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

describe('couleur saisie', () => {
  it('accepte les formes courantes et rend #rrggbb en minuscules', () => {
    expect(normalizeHex('#FF6A00')).toBe('#ff6a00');
    expect(normalizeHex(' ff6a00 ')).toBe('#ff6a00');
    expect(normalizeHex('#f60')).toBe('#ff6600');
  });

  it('refuse le reste', () => {
    for (const value of ['', '#ff6a0', '#ff6a000', 'rouge', '#ggg', 12, null, undefined]) {
      expect(normalizeHex(value)).toBeNull();
    }
  });
});

describe('peinture effective d’une zone', () => {
  it('la zone maîtresse est la première zone de carrosserie, pas la première zone', () => {
    expect(masterZone(MANIFEST)?.id).toBe('caisse');
  });

  it('sans build, une zone liée prend la peinture d’origine de la maîtresse', () => {
    expect(isLinked(MANIFEST, undefined, 'capot')).toBe(true);
    expect(resolvePaint(MANIFEST, undefined, 'capot')).toEqual({ color: '#0a3a46', finish: 'paillete' });
  });

  it('une zone détachée à l’origine garde sa peinture (bi-ton d’usine)', () => {
    expect(isLinked(MANIFEST, undefined, 'toit')).toBe(false);
    expect(resolvePaint(MANIFEST, undefined, 'toit')).toEqual({ color: '#e6dcc0', finish: 'satine' });
  });

  it('ni la maîtresse ni l’accastillage ne sont liés', () => {
    expect(isLinked(MANIFEST, undefined, 'caisse')).toBe(false);
    expect(isLinked(MANIFEST, undefined, 'jantes')).toBe(false);
    expect(isLinked(MANIFEST, { paints: { jantes: { linked: true } } }, 'jantes')).toBe(false);
  });

  it('changer la maîtresse change les zones liées, pas les autres', () => {
    const build: Build = { paints: { caisse: { color: '#b0121c' } } };
    expect(resolvePaints(MANIFEST, build)).toEqual({
      jantes: { color: '#c0c0c0', finish: 'chrome' },
      caisse: { color: '#b0121c', finish: 'paillete' },
      capot: { color: '#b0121c', finish: 'paillete' },
      toit: { color: '#e6dcc0', finish: 'satine' },
    });
  });

  it('une zone détachée par l’utilisateur prend sa propre peinture', () => {
    const build: Build = { paints: { caisse: { color: '#b0121c' }, capot: { linked: false, finish: 'chrome' } } };
    expect(resolvePaint(MANIFEST, build, 'capot')).toEqual({ color: '#111111', finish: 'chrome' });
  });

  it('une zone rattachée par l’utilisateur suit la maîtresse et oublie sa peinture propre', () => {
    const build: Build = { paints: { toit: { linked: true, color: '#ffffff' } } };
    expect(resolvePaint(MANIFEST, build, 'toit')).toEqual({ color: '#0a3a46', finish: 'paillete' });
  });

  it('une zone inconnue du manifeste n’a pas de peinture', () => {
    expect(resolvePaint(MANIFEST, undefined, 'spoiler')).toBeUndefined();
  });
});

describe('lecture tolérante des builds', () => {
  it('rend l’origine pour une sauvegarde illisible', () => {
    for (const raw of [null, undefined, 'x', 3, [], { builds: 'x', recents: 4, current: 7 }]) {
      expect(sanitizeBuilds(raw)).toEqual(DEFAULT_BUILDS);
    }
  });

  it('écarte ce qui est illisible, champ par champ', () => {
    const data = sanitizeBuilds({
      current: 'cox',
      builds: {
        cox: {
          paints: {
            caisse: { color: '#0A3A46', finish: 'paillete', flake: 99, color2: 'nope', linked: 'oui' },
            toit: { finish: 'inconnue' },
            'zone interdite': { color: '#ffffff' },
          },
        },
        '../x': { paints: { caisse: { color: '#ffffff' } } },
      },
      recents: ['#FFFFFF', 'x', '#ffffff', '#000'],
    });
    expect(data).toEqual({
      current: 'cox',
      builds: { cox: { paints: { caisse: { color: '#0a3a46', finish: 'paillete', flake: FLAKE_RANGE.max } } } },
      recents: ['#ffffff', '#000000'],
    });
  });

  it('garde le build d’un véhicule absent du catalogue', () => {
    const data = sanitizeBuilds({ builds: { parti: { paints: { caisse: { color: '#123456' } } } } });
    expect(data.builds.parti?.paints.caisse).toEqual({ color: '#123456' });
  });
});

describe('store des builds', () => {
  beforeEach(() => {
    useBuilds.setState({ ...DEFAULT_BUILDS, builds: {}, recents: [] });
  });

  it('chaque véhicule garde ses peintures quand on change de véhicule', () => {
    const { select, setPaint } = useBuilds.getState();
    select('cox');
    setPaint('cox', 'caisse', { color: '#b0121c' });
    select('combi');
    setPaint('combi', 'caisse', { finish: 'mat' });
    select('cox');
    const state = useBuilds.getState();
    expect(state.current).toBe('cox');
    expect(state.builds.cox?.paints.caisse).toEqual({ color: '#b0121c' });
    expect(state.builds.combi?.paints.caisse).toEqual({ finish: 'mat' });
  });

  it('détacher une zone lui donne la peinture du moment, la rattacher la rend à la maîtresse', () => {
    const { setLinked, setPaint } = useBuilds.getState();
    setPaint('essai', 'caisse', { color: '#b0121c' });
    const seed = resolvePaint(MANIFEST, useBuilds.getState().builds.essai, 'capot');
    setLinked('essai', 'capot', false, seed);
    expect(resolvePaint(MANIFEST, useBuilds.getState().builds.essai, 'capot')).toEqual(seed);
    setPaint('essai', 'caisse', { color: '#132a72' });
    expect(resolvePaint(MANIFEST, useBuilds.getState().builds.essai, 'capot')).toEqual(seed);
    setLinked('essai', 'capot', true);
    expect(resolvePaint(MANIFEST, useBuilds.getState().builds.essai, 'capot')?.color).toBe('#132a72');
  });

  it('retient les dernières couleurs sans doublon, la plus récente d’abord', () => {
    const { rememberColor } = useBuilds.getState();
    for (let index = 0; index < RECENT_COLORS + 3; index += 1) {
      rememberColor(`#0000${index.toString(16).padStart(2, '0')}`);
    }
    rememberColor('#000005');
    rememberColor('pas une couleur');
    const { recents } = useBuilds.getState();
    expect(recents).toHaveLength(RECENT_COLORS);
    expect(recents[0]).toBe('#000005');
    expect(new Set(recents).size).toBe(RECENT_COLORS);
  });

  it('monte et démonte une option sans toucher aux peintures', () => {
    const { setPaint, setPart } = useBuilds.getState();
    setPaint('van', 'caisse', { color: '#f0efe9' });
    setPart('van', 'gestion', 'stage-2');
    setPart('van', 'nitro', 'kit-50');
    expect(useBuilds.getState().builds.van).toEqual({
      paints: { caisse: { color: '#f0efe9' } },
      parts: { gestion: 'stage-2', nitro: 'kit-50' },
    });
    setPart('van', 'gestion', null);
    setPart('van', 'nitro', null);
    expect(useBuilds.getState().builds.van).toEqual({ paints: { caisse: { color: '#f0efe9' } } });
  });

  it('relit les pièces d’un build et écarte celles qui sont illisibles', () => {
    const data = sanitizeBuilds({
      builds: { van: { parts: { gestion: 'stage-2', 'poste interdit': 'x', nitro: 7 } } },
    });
    expect(data.builds.van).toEqual({ paints: {}, parts: { gestion: 'stage-2' } });
  });

  it('rendre ses peintures d’origine à un véhicule ne touche pas les autres', () => {
    const { resetVehicle, setPaint } = useBuilds.getState();
    setPaint('cox', 'caisse', { color: '#b0121c' });
    setPaint('combi', 'caisse', { color: '#132a72' });
    resetVehicle('cox');
    expect(useBuilds.getState().builds).toEqual({ combi: { paints: { caisse: { color: '#132a72' } } } });
  });
});
