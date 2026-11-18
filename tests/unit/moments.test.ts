// Moments de la sortie (vague S, mode jour) : données complètes pour chaque moment et chaque météo
// (src/data/moments.ts), nuit identique à celle d'avant, mélange sans arrondi aux bornes
// (src/drive/scene/moment.ts), réglage sauvegardé avec la météo (src/state/drive.ts).
import { Color } from 'three';
import { describe, expect, it } from 'vitest';
import { LOOKS, MATIERES_DU_JOUR, MOMENT_PAR_DEFAUT, MOMENTS, lookOf, momentOf, type Look } from '../../src/data/moments.ts';
import { MomentMelange, resoudre } from '../../src/drive/scene/moment.ts';
import { HEADLIGHT, MIST, MOON, ROLE_LOOKS } from '../../src/drive/scene/materiaux.ts';
import { SKY } from '../../src/drive/scene/ciel.ts';
import { DEFAULT_DRIVE_PREFS, sanitizeDrivePrefs, WEATHERS } from '../../src/state/drive.ts';

const HEX = /^#[0-9a-f]{6}$/;

/** Luminance relative d'une teinte sRGB (composantes linéaires). */
const lum = (hex: string) => {
  const c = new Color(hex);
  return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
};

/** Toutes les feuilles d'un look : couleurs « #rrggbb », nombres finis. */
function feuilles(value: unknown, path: string, out: Array<[string, unknown]>): Array<[string, unknown]> {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) for (const [k, v] of Object.entries(value)) feuilles(v, `${path}.${k}`, out);
  else if (Array.isArray(value)) value.forEach((v, i) => feuilles(v, `${path}[${i}]`, out));
  else out.push([path, value]);
  return out;
}

const NUIT_MATIERES = Object.fromEntries(MATIERES_DU_JOUR.map((m) => [m, m === 'arbre' ? '#16241a' : m === 'lointain' ? '#0a0f1e' : ROLE_LOOKS[m].color])) as Record<(typeof MATIERES_DU_JOUR)[number], string>;

describe('données des moments', () => {
  it('deux moments, nuit par défaut, lecture tolérante', () => {
    expect(MOMENTS.map((m) => m.id)).toEqual(['nuit', 'jour']);
    expect(MOMENTS.map((m) => m.label)).toEqual(['Nuit', 'Jour']);
    expect(MOMENT_PAR_DEFAUT).toBe('nuit');
    expect(momentOf('jour')).toBe('jour');
    expect(momentOf('midi')).toBe('nuit');
    expect(momentOf(undefined)).toBe('nuit');
  });

  for (const { id: moment } of MOMENTS)
    for (const { id: meteo } of WEATHERS)
      it(`${moment} × ${meteo} : look complet (couleurs, nombres, directions)`, () => {
        const look = LOOKS[moment][meteo];
        expect(look).toBeDefined();
        const reference = feuilles(LOOKS.nuit.sec, 'look', []).map(([p]) => p.replace(/\.matieres\..*/, '.matieres'));
        const ici = feuilles(look, 'look', []);
        // Mêmes champs que la nuit (les teintes de matières sont facultatives).
        expect(new Set(ici.map(([p]) => p).filter((p) => !p.includes('.matieres.')))).toEqual(new Set(reference.filter((p) => !p.endsWith('.matieres'))));
        for (const [path, v] of ici) {
          if (typeof v === 'string') expect(v, path).toMatch(HEX);
          else expect(Number.isFinite(v), path).toBe(true);
        }
        for (const k of ['phares', 'lampadaires', 'neons', 'fenetres', 'ombre', 'bandeSonde'] as const) expect(look[k]).toBeGreaterThanOrEqual(0);
        expect(look.astre.direction[1]).toBeGreaterThan(0);
        // Le brouillard noie toujours la fin des tronçons chargés.
        expect(look.brouillard.densite).toBeGreaterThanOrEqual(1);
        for (const k of Object.keys(look.matieres)) expect(MATIERES_DU_JOUR).toContain(k);
        expect(lookOf(moment, meteo)).toBe(look);
      });
});

describe('la nuit ne change pas', () => {
  it('reprend les valeurs d’avant la vague S', () => {
    for (const { id: meteo } of WEATHERS) {
      const n: Look = LOOKS.nuit[meteo];
      expect(n.ciel).toMatchObject({ zenith: SKY.zenith, milieu: SKY.middle, horizon: SKY.horizon, lueur: SKY.glow, jour: 0 });
      expect([...n.ciel.lueurDirection]).toEqual([...SKY.glowDirection]);
      expect([...n.astre.direction]).toEqual([...MOON.direction]);
      expect(n.astre).toMatchObject({ couleur: '#a9bcf0', intensite: 0.8, teinteCiel: MOON.color });
      expect(n.ambiance).toEqual({ ciel: '#2a3a6c', sol: '#07070a', intensite: 0.6 });
      expect(n.reflet).toEqual({ horizon: MOON.horizon, zenith: MOON.zenith });
      expect(n.brouillard).toEqual({ couleur: SKY.fog, densite: 1 });
      expect(n.brume).toEqual({ couleur: MIST.color, densite: MIST.density });
      expect(n.lointain).toEqual({ voile: SKY.horizon, voileForce: 0.55, voileMin: 0 });
      expect(n.image).toEqual({ exposition: 1.25, bloom: 0.95, etalonnage: { shadows: '#2c3c9a', highlights: '#ffd2a0', amount: 0.1, saturation: 1.1, contrast: 1.1 } });
      expect([n.phares, n.lampadaires, n.neons, n.fenetres, n.carrosserie, n.bandeSonde, n.ombre]).toEqual([1, 1, 1, 1, 5.5, 0.5, 0]);
      expect(n.matieres).toEqual({});
    }
    // Étoiles et voiles : les formules d'avant (1 - 0,9 × mouillé ; 1 + 0,6 × mouillé + 0,3 × neige), aux bornes.
    expect([LOOKS.nuit.sec.ciel.etoiles, LOOKS.nuit.pluie.ciel.etoiles, LOOKS.nuit.neige.ciel.etoiles]).toEqual([1, 0.1, 0.1]);
    expect([LOOKS.nuit.sec.ciel.nuages, LOOKS.nuit.pluie.ciel.nuages, LOOKS.nuit.neige.ciel.nuages]).toEqual([1, 1.6, 1.9]);
    expect(HEADLIGHT.power).toBeGreaterThan(0);
  });

  it('le mélange redonne exactement la nuit, et exactement le jour', () => {
    const melange = new MomentMelange(NUIT_MATIERES);
    for (const [meteo, pluie, neige] of [['sec', 0, 0], ['pluie', 1, 0], ['neige', 0, 1]] as const) {
      for (const [moment, jour] of [['nuit', 0], ['jour', 1]] as const) {
        expect(melange.melanger(jour, pluie, neige)).toBe(true);
        expect(melange.melanger(jour, pluie, neige)).toBe(false);
        const attendu = resoudre(LOOKS[moment][meteo], NUIT_MATIERES);
        const e = melange.etat;
        expect(e.zenith.equals(attendu.zenith), `${moment} ${meteo} zénith`).toBe(true);
        expect(e.brouillard.equals(attendu.brouillard)).toBe(true);
        expect(e.astreDirection.distanceTo(attendu.astreDirection)).toBeLessThan(1e-12);
        expect([e.phares, e.lampadaires, e.etoiles, e.nuages, e.brumeDensite, e.ombre]).toEqual([attendu.phares, attendu.lampadaires, attendu.etoiles, attendu.nuages, attendu.brumeDensite, attendu.ombre]);
        for (const m of MATIERES_DU_JOUR) expect(e.matieres[m].equals(attendu.matieres[m]), m).toBe(true);
      }
    }
    // Nuit : les matières gardent leur teinte de nuit.
    melange.melanger(0, 0, 0);
    expect(melange.etat.matieres.chaussee.equals(new Color(ROLE_LOOKS.chaussee.color))).toBe(true);
    // À mi-chemin : entre les deux.
    melange.melanger(0.5, 0, 0);
    expect(melange.etat.phares).toBeCloseTo(0.5, 12);
    expect(melange.etat.astreIntensite).toBeCloseTo((LOOKS.nuit.sec.astre.intensite + LOOKS.jour.sec.astre.intensite) / 2, 12);
  });
});

describe('le jour', () => {
  it('phares, lampadaires, néons et fenêtres éteints ; soleil franc au sec, couvert sous la pluie, laiteux sous la neige', () => {
    for (const { id: meteo } of WEATHERS) {
      const j = LOOKS.jour[meteo];
      expect([j.phares, j.lampadaires, j.neons, j.fenetres, j.ciel.etoiles, j.ciel.jour]).toEqual([0, 0, 0, 0, 0, 1]);
      expect(j.carrosserie).toBeLessThan(LOOKS.nuit[meteo].carrosserie);
      expect(j.image.exposition).toBeLessThanOrEqual(LOOKS.nuit[meteo].image.exposition);
      expect(j.image.bloom).toBeLessThan(LOOKS.nuit[meteo].image.bloom);
      // Matières de plein jour : toutes données, plus claires que la nuit (sauf l'eau, sombre et qui reflète le ciel).
      for (const m of MATIERES_DU_JOUR) {
        expect(j.matieres[m], m).toMatch(HEX);
        if (m !== 'eau') expect(lum(j.matieres[m] ?? ''), m).toBeGreaterThan(lum(NUIT_MATIERES[m]));
      }
    }
    const { sec, pluie, neige } = LOOKS.jour;
    expect(sec.astre.intensite).toBeGreaterThan(2 * pluie.astre.intensite);
    expect(sec.astre.disque).toBe(1);
    expect([pluie.astre.disque, neige.astre.disque]).toEqual([0, 0]);
    expect(sec.ombre).toBeGreaterThan(Math.max(pluie.ombre, neige.ombre));
    expect(lum(neige.ciel.horizon)).toBeGreaterThan(lum(pluie.ciel.horizon));
  });
});

describe('réglage sauvegardé', () => {
  it('nuit par défaut, jour gardé, valeur inconnue ramenée à la nuit', () => {
    expect(DEFAULT_DRIVE_PREFS.moment).toBe('nuit');
    expect(sanitizeDrivePrefs({}).moment).toBe('nuit');
    expect(sanitizeDrivePrefs({ moment: 'jour', weather: 'neige' })).toMatchObject({ moment: 'jour', weather: 'neige' });
    expect(sanitizeDrivePrefs({ moment: 'aube' }).moment).toBe('nuit');
  });
});
