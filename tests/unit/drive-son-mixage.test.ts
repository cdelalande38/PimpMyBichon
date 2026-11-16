// Règles du son du moteur en sortie (src/drive/mixage.ts) : quand il tourne, sa charge, son volume
// sous la radio ; et aucune synthèse dans le branchement.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PILOT } from '../../src/drive/pilote.ts';
import {
  CHARGE_CROISIERE,
  CHARGE_PILOTE_MAX,
  chargeDe,
  etatAffiche,
  lisserAccel,
  melangeSortie,
  MIXAGE_ORIGINE,
  moteurVoulu,
  NIVEAU_RALENTI_IMAGE,
  RAMPE_RADIO,
  type ConditionsSon,
} from '../../src/drive/mixage.ts';

const EN_ROUTE: ConditionsSon = { enSortie: true, prete: true, echec: false, finie: false, pause: false, voulu: true, geste: true, sons: true };

describe('le moteur tourne-t-il ?', () => {
  it('en route, scène prête, après un geste, véhicule sonore, son voulu : oui', () => {
    expect(moteurVoulu(EN_ROUTE)).toBe(true);
  });

  it('coupé à la fin du parcours, en pause, au garage, avant la scène prête, en erreur', () => {
    expect(moteurVoulu({ ...EN_ROUTE, finie: true })).toBe(false);
    expect(moteurVoulu({ ...EN_ROUTE, pause: true })).toBe(false);
    expect(moteurVoulu({ ...EN_ROUTE, enSortie: false })).toBe(false);
    expect(moteurVoulu({ ...EN_ROUTE, prete: false })).toBe(false);
    expect(moteurVoulu({ ...EN_ROUTE, echec: true })).toBe(false);
  });

  it('muet sans geste (ouverture directe), sans sons, ou coupé au bouton', () => {
    expect(moteurVoulu({ ...EN_ROUTE, geste: false })).toBe(false);
    expect(moteurVoulu({ ...EN_ROUTE, sons: false })).toBe(false);
    expect(moteurVoulu({ ...EN_ROUTE, voulu: false })).toBe(false);
  });

  it('état affiché', () => {
    expect(etatAffiche({ ...EN_ROUTE, sons: false }, 'coupe')).toBe('sans-son');
    expect(etatAffiche({ ...EN_ROUTE, voulu: false }, 'coupe')).toBe('muet');
    expect(etatAffiche({ ...EN_ROUTE, geste: false }, 'coupe')).toBe('attente');
    expect(etatAffiche(EN_ROUTE, 'demarrage')).toBe('demarre');
    expect(etatAffiche(EN_ROUTE, 'ralenti')).toBe('tourne');
    expect(etatAffiche(EN_ROUTE, 'charge')).toBe('tourne');
    expect(etatAffiche(EN_ROUTE, 'coupe')).toBe('coupe');
    expect(etatAffiche({ ...EN_ROUTE, pause: true }, 'coupe')).toBe('coupe');
  });
});

describe('charge', () => {
  it('à la main : l’accélérateur, relâché au frein', () => {
    expect(chargeDe({ auto: false, throttle: 1, brake: 0 }, 0)).toEqual({ charge: 1, frein: false });
    expect(chargeDe({ auto: false, throttle: 0, brake: 0 }, 0)).toEqual({ charge: 0, frein: false });
    expect(chargeDe({ auto: false, throttle: 1, brake: 1 }, 5)).toEqual({ charge: 0, frein: true });
  });

  it('en pilote automatique : d’après l’accélération', () => {
    expect(chargeDe({ auto: true, throttle: 0, brake: 0 }, 0).charge).toBeCloseTo(CHARGE_CROISIERE);
    expect(chargeDe({ auto: true, throttle: 0, brake: 0 }, PILOT.accel).charge).toBeCloseTo(CHARGE_PILOTE_MAX);
    expect(chargeDe({ auto: true, throttle: 0, brake: 0 }, 10).charge).toBe(CHARGE_PILOTE_MAX);
    const leve = chargeDe({ auto: true, throttle: 0, brake: 0 }, -0.3);
    expect(leve.charge).toBeLessThan(CHARGE_CROISIERE);
    expect(leve.frein).toBe(false);
    expect(chargeDe({ auto: true, throttle: 0, brake: 0 }, -2)).toEqual({ charge: 0, frein: true });
    expect(chargeDe({ auto: true, throttle: 0, brake: 0 }, Number.NaN).charge).toBeCloseTo(CHARGE_CROISIERE);
  });

  it('accélération lissée d’après des vitesses entières publiées quatre fois par seconde', () => {
    let accel = 0;
    let v = 0;
    // 2,5 m/s² tenus : 9 km/h par seconde, publiés arrondis.
    for (let i = 1; i <= 16; i += 1) {
      const suivante = Math.round(i * 0.25 * 2.5 * 3.6);
      accel = lisserAccel(accel, v, suivante, 0.25);
      v = suivante;
    }
    expect(accel).toBeGreaterThan(2);
    expect(accel).toBeLessThan(3);
    expect(lisserAccel(1.5, 50, 60, 0)).toBe(1.5);
  });
});

describe('mélange de la sortie', () => {
  it('en route, moteur voulu : la radio baisse au réglage « Radio », le moteur joue à plein', () => {
    const m = melangeSortie({ roule: true, ralentiImage: false, reglages: MIXAGE_ORIGINE });
    expect(m.radio).toBeCloseTo(0.45, 5);
    expect(m.moteur).toBe(1);
    expect(m.route).toBeCloseTo(0.7, 5);
    expect(RAMPE_RADIO).toBeCloseTo(0.4, 5);
  });

  it('en pause, au bout du parcours, au garage ou moteur coupé : la radio reprend son volume', () => {
    expect(moteurVoulu({ ...EN_ROUTE, pause: true })).toBe(false);
    expect(moteurVoulu({ ...EN_ROUTE, finie: true })).toBe(false);
    expect(moteurVoulu({ ...EN_ROUTE, enSortie: false })).toBe(false);
    expect(moteurVoulu({ ...EN_ROUTE, voulu: false })).toBe(false);
    expect(melangeSortie({ roule: false, ralentiImage: false, reglages: MIXAGE_ORIGINE }).radio).toBe(1);
  });

  it('les trois curseurs agissent, bornés de 0 à 100 %', () => {
    const m = melangeSortie({ roule: true, ralentiImage: false, reglages: { radio: 10, moteur: 60, route: 0 } });
    expect(m).toEqual({ radio: 0.1, moteur: 0.6, route: 0 });
    const hors = melangeSortie({ roule: true, ralentiImage: false, reglages: { radio: 150, moteur: -20, route: Number.NaN } });
    expect(hors).toEqual({ radio: 1, moteur: 0, route: 0 });
  });

  it('au ralenti d’image : moteur et route baissent, pas la radio', () => {
    const normal = melangeSortie({ roule: true, ralentiImage: false, reglages: MIXAGE_ORIGINE });
    const ralenti = melangeSortie({ roule: true, ralentiImage: true, reglages: MIXAGE_ORIGINE });
    expect(ralenti.moteur).toBeCloseTo(normal.moteur * NIVEAU_RALENTI_IMAGE, 5);
    expect(ralenti.route).toBeCloseTo(normal.route * NIVEAU_RALENTI_IMAGE, 5);
    expect(ralenti.radio).toBe(normal.radio);
  });
});

describe('aucune synthèse dans le son de la sortie', () => {
  for (const file of [
    'src/drive/son.ts',
    'src/drive/boite.ts',
    'src/drive/mixage.ts',
    'src/data/boites.ts',
    'src/data/bruitages.ts',
    'src/audio/sfx/route.ts',
    'src/audio/sfx/regles.ts',
    'src/audio/sfx/manifeste.ts',
    'src/audio/sfx/meteo.ts',
  ]) {
    it(`${file} : ni oscillateur, ni onde, ni tampon fabriqué`, () => {
      const text = readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8');
      expect(text).not.toMatch(/createOscillator|createPeriodicWave|createConstantSource|createBuffer\s*\(|OscillatorNode/);
    });
  }
});
