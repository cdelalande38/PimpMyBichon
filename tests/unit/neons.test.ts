// Néons du véhicule (Custom › Néons, vague V) : catalogue des zones, sections `neons` des cinq manifestes,
// lecture tolérante du build (rien d'écrit quand tout est éteint, valeur inconnue = éteint), articles de
// la boutique, géométrie (tubes, arceaux, nappes), niveau du dock, LED d'habitacle et lumière d'habitacle.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARTICLES_NEONS } from '../../src/data/articles/neons.ts';
import { PIECES } from '../../src/data/boutique.ts';
import { cabinFor, interiorTints, ledHabitacle } from '../../src/data/habitacle.ts';
import {
  arceaux,
  articleNeon,
  checkNeons,
  etatNeon,
  etatsDeSignature,
  forceLueur,
  intensiteNeon,
  NEON_INTENSITE,
  NEON_TEINTES,
  NEON_ZONES,
  neonKeys,
  neonSignature,
  neonZonesOf,
  porteeLueur,
  resolveNeons,
  zoneInfo,
} from '../../src/data/neons.ts';
import { validateManifest } from '../../src/data/vehicles.ts';
import type { Build, VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { buildNeonGeometry } from '../../src/scene/vehicle/neons.ts';
import { sanitizeLevels } from '../../src/state/dock.ts';

const read = (id: string) => validateManifest(JSON.parse(readFileSync(new URL(`../../public/assets/vehicles/${id}/vehicle.json`, import.meta.url), 'utf8')), id);
const VOITURES = ['concept', 'cox', 'van'].map(read);
const MOTOS = ['sportive', 'bobber'].map(read);
const concept = VOITURES[0] as VehicleManifest;
const bobber = MOTOS[1] as VehicleManifest;
const HEX = /^#[0-9a-f]{6}$/;

describe('catalogue des zones', () => {
  it('identifiants uniques, couleurs d’origine, une zone libre par genre, l’habitacle à part', () => {
    const ids = NEON_ZONES.map((zone) => zone.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const zone of NEON_ZONES) expect(zone.couleur, zone.id).toMatch(HEX);
    expect(NEON_ZONES.filter((zone) => zone.libre).map((zone) => zone.id)).toEqual(['avant', 'cadre']);
    expect(NEON_ZONES.filter((zone) => zone.habitacle).map((zone) => zone.id)).toEqual(['habitacle']);
    for (const teinte of NEON_TEINTES) expect(teinte.color).toMatch(HEX);
  });

  it('chaque zone payante a son article, de 60 à 400 $, rangé dans la boutique ; les libres n’en ont pas', () => {
    for (const zone of NEON_ZONES) {
      const id = articleNeon(zone.id);
      if (zone.libre) {
        expect(id, zone.id).toBeNull();
        continue;
      }
      expect(id).toBe(`piece-neon-${zone.id}`);
      const article = ARTICLES_NEONS.find((item) => item.id === id);
      expect(article, zone.id).toBeDefined();
      expect(article?.famille).toBe('piece');
      expect(article?.prix).toBeGreaterThanOrEqual(60);
      expect(article?.prix).toBeLessThanOrEqual(400);
      expect(PIECES.some((item) => item.id === id), zone.id).toBe(true);
    }
    expect(new Set(ARTICLES_NEONS.map((item) => item.id)).size).toBe(ARTICLES_NEONS.length);
  });
});

describe('manifestes', () => {
  it('les trois voitures : avant, flancs, arrière, roues et habitacle ; les deux motos : cadre et roues', () => {
    for (const voiture of VOITURES) expect(neonZonesOf(voiture).map((zone) => zone.id), voiture.id).toEqual(['avant', 'flancs', 'arriere', 'roues', 'habitacle']);
    for (const moto of MOTOS) expect(neonZonesOf(moto).map((zone) => zone.id), moto.id).toEqual(['cadre', 'roues']);
  });

  it('les tubes passent sous la caisse (au-dessus du sol, sous le plancher de l’habitacle) et dans son gabarit', () => {
    for (const vehicle of [...VOITURES, ...MOTOS]) {
      for (const zone of neonZonesOf(vehicle)) {
        for (const line of zone.spec.tubes ?? []) {
          for (const [x, y, z] of line) {
            expect(y, `${vehicle.id}.${zone.id}`).toBeGreaterThan(0.03);
            expect(Math.abs(x), `${vehicle.id}.${zone.id}`).toBeLessThan(2.6);
            expect(Math.abs(z), `${vehicle.id}.${zone.id}`).toBeLessThan(1.2);
            if (!zone.habitacle) expect(y, `${vehicle.id}.${zone.id} : sous la caisse`).toBeLessThan(0.35);
          }
        }
      }
    }
  });

  it('refuse une zone inconnue, des tubes mal formés, des nappes hors de l’habitacle, un habitacle de moto', () => {
    const problems = (raw: unknown, kind = 'car') => {
      const list: string[] = [];
      checkNeons(raw, kind, list);
      return list;
    };
    expect(problems(undefined)).toEqual([]);
    expect(problems({ avant: { tubes: [[[0, 0.1, 0], [1, 0.1, 0]]] } })).toEqual([]);
    expect(problems({ toit: { tubes: [[[0, 0.1, 0], [1, 0.1, 0]]] } }).join()).toMatch(/zone inconnue/);
    expect(problems({ avant: { tubes: [[[0, 0.1, 0]]] } }).join()).toMatch(/tubes/);
    expect(problems({ avant: {} }).join()).toMatch(/des tubes, ou des arceaux/);
    expect(problems({ avant: { arceaux: true } }).join()).toMatch(/seulement pour la zone roues/);
    expect(problems({ flancs: { tubes: [[[0, 0.1, 0], [1, 0.1, 0]]], pools: [] } }).join()).toMatch(/seulement pour l’habitacle/);
    expect(problems({ habitacle: { tubes: [[[0, 0.5, 0], [1, 0.5, 0]]] } }, 'bike').join()).toMatch(/moto/);
    expect(problems({ roues: { arceaux: true, radius: 0.5 } }).join()).toMatch(/radius/);
  });
});

describe('sauvegarde', () => {
  const avant = zoneInfo('avant')!;

  it('rien d’écrit : éteinte, couleur et intensité d’origine ; un mode inconnu retombe sur éteint', () => {
    expect(etatNeon(avant, undefined)).toMatchObject({ on: false, mode: 'fixe', color: avant.couleur, intensity: NEON_INTENSITE.origine });
    expect(etatNeon(avant, { parts: { neon_avant: 'stroboscope' } }).on).toBe(false);
    expect(etatNeon(avant, { parts: { neon_avant: 'respiration' }, partPaints: { neon_avant: { color: 'rouge' } } })).toMatchObject({ on: true, mode: 'respiration', color: avant.couleur });
    expect(intensiteNeon(5)).toBe(NEON_INTENSITE.max);
    expect(intensiteNeon(-1)).toBe(NEON_INTENSITE.min);
    expect(intensiteNeon('fort')).toBe(NEON_INTENSITE.origine);
  });

  it('la clé ne dit que les zones allumées, et se relit telle quelle ; vide quand tout est éteint', () => {
    const build: Build = { paints: {}, parts: { neon_avant: 'fixe', neon_flancs: 'respiration' }, partPaints: { neon_flancs: { color: '#ff2bd6' } }, tune: { neon_avant: 0.5 } };
    expect(neonSignature(concept, {})).toBe('');
    const signature = neonSignature(concept, build);
    expect(signature).toBe('avant:fixe:#18e4ff:0.50|flancs:respiration:#ff2bd6:0.80');
    const relus = etatsDeSignature(signature);
    expect(relus.map((etat) => [etat.zone.id, etat.mode, etat.color, etat.intensity])).toEqual(
      resolveNeons(concept, build)
        .filter((etat) => etat.on)
        .map((etat) => [etat.zone.id, etat.mode, etat.color, etat.intensity]),
    );
    expect(etatsDeSignature('toit:fixe:#ffffff:1|avant:fixe:pas-une-couleur:1')).toEqual([]);
  });

  it('« Tout éteindre » retire les trois postes de chaque zone', () => {
    const keys = neonKeys(bobber);
    expect(keys.parts).toEqual(['neon_cadre', 'neon_roues']);
    expect(keys.partPaints).toEqual(keys.parts);
    expect(keys.tune).toEqual(keys.parts);
  });
});

describe('géométrie', () => {
  const roue = (x: number, z: number) => ({ centre: [x, 0.33, z] as const, rayon: 0.33, jante: 0.22, demiLargeur: 0.11 });

  it('voiture : un arc au-dessus de chaque roue, côté flanc ; moto : deux cercles par roue', () => {
    const arcs = arceaux('car', [roue(1.3, 0.75), roue(-1.3, -0.75)]);
    expect(arcs).toHaveLength(2);
    for (const line of arcs) for (const p of line) expect(p[1]).toBeGreaterThan(0.33);
    expect(arcs[0]?.[0]?.[2]).toBeGreaterThan(0.75);
    expect(arcs[1]?.[0]?.[2]).toBeLessThan(-0.75);
    const cercles = arceaux('bike', [roue(0.7, 0)]);
    expect(cercles).toHaveLength(2);
    expect(cercles[0]?.[0]?.[2]).toBeLessThan(0);
    expect(cercles[1]?.[0]?.[2]).toBeGreaterThan(0);
  });

  it('la lueur s’élargit et faiblit quand le tube monte', () => {
    expect(porteeLueur(0.1)).toBeLessThan(porteeLueur(0.6));
    expect(forceLueur(0.1)).toBeGreaterThan(forceLueur(0.6));
    expect(porteeLueur(5)).toBeLessThanOrEqual(1.05);
  });

  it('un maillage de tubes, un de nappes au sol, un de nappes dans l’habitacle ; un tube par ligne', () => {
    const geometry = buildNeonGeometry(concept, [roue(1.25, 0.98), roue(1.25, -0.98), roue(-1.55, 0.98), roue(-1.55, -0.98)], { y: 0, pitch: 0 });
    const lignes = neonZonesOf(concept).reduce((sum, zone) => sum + (zone.spec.tubes?.length ?? 0), 0) + 4;
    expect(geometry.compte.tubes).toBe(lignes);
    expect(geometry.tubes.getAttribute('aZone').count).toBe(geometry.tubes.getAttribute('position').count);
    expect(geometry.sol.index?.count ?? 0).toBeGreaterThan(0);
    expect(geometry.cabine?.index?.count ?? 0).toBeGreaterThan(0);
    // Les nappes au sol sont à plat, au ras du sol ; celles de l'habitacle, sur son plancher.
    const sol = geometry.sol.getAttribute('position');
    for (let i = 0; i < sol.count; i += 1) expect(sol.getY(i)).toBeLessThan(0.01);
    const cabine = geometry.cabine!.getAttribute('position');
    for (let i = 0; i < cabine.count; i += 1) expect(cabine.getY(i)).toBeGreaterThan(0.1);
    // Une moto : pas d'habitacle.
    expect(buildNeonGeometry(bobber, [], { y: 0, pitch: 0 }).cabine).toBeNull();
  });
});

describe('dock et habitacle', () => {
  it('Néons : un seul niveau sous l’entrée, la zone choisie et son nom (comme Moteur et Carrosserie) ; tout le reste est écarté', () => {
    expect(sanitizeLevels('neons', [{ kind: 'element', element: 'flancs', libelle: 'Flancs' }])).toEqual([{ kind: 'element', element: 'flancs', libelle: 'Flancs' }]);
    expect(sanitizeLevels('neons', [{ kind: 'zone', zone: 'flancs', step: 'couleur' }])).toEqual([]);
    expect(sanitizeLevels('peinture', [{ kind: 'element', element: 'flancs', libelle: 'Flancs' }])).toEqual([]);
  });

  it('LED d’habitacle : la lumière d’habitacle du van prend leur couleur ; éteintes, rien ne change', () => {
    const van = VOITURES[2] as VehicleManifest;
    expect(ledHabitacle(van, undefined)).toBeNull();
    expect(cabinFor(van, undefined)?.light?.color).toBe(cabinFor(van, { paints: {} })?.light?.color);
    const build: Build = { paints: {}, parts: { neon_habitacle: 'fixe' }, partPaints: { neon_habitacle: { color: '#3dff7a' } } };
    expect(ledHabitacle(van, build)).toEqual({ color: '#3dff7a', intensity: NEON_INTENSITE.origine });
    expect(cabinFor(van, build)?.light?.color).toBe('#3dff7a');
  });

  it('le concept : ses teintes d’habitacle sont des zones de peinture, son ciel étoilé est éteint d’origine', () => {
    expect(interiorTints(concept).map((zone) => zone.id)).toEqual(['sellerie', 'planche', 'sieges_ton', 'tapis']);
    expect(concept.cabin?.sky?.on).toBe(false);
    expect(cabinFor(concept, undefined)?.sky).toBeUndefined();
    expect(cabinFor(concept, { paints: {}, parts: { ciel: 'allume' } })?.sky?.count).toBeGreaterThan(0);
  });
});
