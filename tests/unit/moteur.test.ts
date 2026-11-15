import { describe, expect, it } from 'vitest';
import {
  ENGINE_SLOTS,
  chosenOption,
  computePrep,
  resultLabelFor,
  slotsFor,
} from '../../src/data/enginePrep.ts';
import type { EngineSpec, VehicleManifest } from '../../src/data/vehicleTypes.ts';

type Prepable = Pick<VehicleManifest, 'engine' | 'kind'>;

const turboDiesel: EngineSpec = {
  label: '4 cylindres turbo diesel',
  fuel: 'diesel',
  feed: 'injection',
  boost: 'turbo',
  power: 102,
};
const flatCarbu: EngineSpec = {
  label: '4 cylindres à plat refroidi par air',
  fuel: 'essence',
  feed: 'carburateur',
  boost: 'atmo',
  power: 50,
};
const atmoInjection: EngineSpec = { label: 'V8 central', fuel: 'essence', feed: 'injection', boost: 'atmo', power: 480 };

const van: Prepable = { kind: 'car', engine: turboDiesel };
const cox: Prepable = { kind: 'car', engine: flatCarbu };
const bobber: Prepable = {
  kind: 'bike',
  engine: { label: 'bicylindre en V refroidi par air', fuel: 'essence', feed: 'carburateur', boost: 'atmo', power: 67 },
};

describe('règle de calcul', () => {
  it('redonne l’exemple du van : 102 ch, + 73 ch, 175 ch au stage le plus poussé', () => {
    expect(computePrep(van, { parts: { reprog: 'stage3' } })).toEqual({
      origin: 102,
      gain: 73,
      prepared: 175,
      nitro: 0,
      withNitro: 175,
    });
  });

  it('sans préparation, le gain est nul', () => {
    expect(computePrep(van, undefined)).toMatchObject({ origin: 102, gain: 0, prepared: 102 });
    expect(computePrep(van, { parts: {} })).toMatchObject({ gain: 0 });
  });

  it('chaque stage pousse plus que le précédent, et bien plus sur un turbo que sur un atmo', () => {
    const v8: Prepable = { kind: 'car', engine: atmoInjection };
    const gains = (vehicle: Prepable) =>
      ['stage1', 'stage2', 'stage3'].map(
        (stage) => computePrep(vehicle, { parts: { reprog: stage } })!.prepared / vehicle.engine!.power - 1,
      );
    const turbo = gains(van);
    const atmo = gains(v8);
    expect(turbo[0]).toBeLessThan(turbo[1]!);
    expect(turbo[1]).toBeLessThan(turbo[2]!);
    expect(atmo[0]).toBeLessThan(atmo[2]!);
    turbo.forEach((gain, index) => expect(gain).toBeGreaterThan(2 * atmo[index]!));
    expect(atmo[2]).toBeLessThan(0.2);
  });

  it('arrondit au cheval', () => {
    const prep = computePrep(cox, { parts: { carbu: 'gicleurs' } })!;
    expect(Number.isInteger(prep.prepared)).toBe(true);
    expect(prep.prepared).toBe(53);
    expect(computePrep(cox, { parts: { carbu: 'double-carbu' } })!.prepared).toBe(60);
  });

  it('compte le nitro à part, en chevaux selon voiture ou moto', () => {
    const car = computePrep(van, { parts: { reprog: 'stage3', nitro: 'nitro-moyen' } })!;
    expect(car).toMatchObject({ prepared: 175, gain: 73, nitro: 100, withNitro: 275 });
    const bike = computePrep(bobber, { parts: { nitro: 'nitro-petit' } })!;
    expect(bike).toMatchObject({ prepared: 67, gain: 0, nitro: 15, withNitro: 82 });
  });

  it('pas de moteur déclaré : pas de fiche', () => {
    expect(computePrep({ kind: 'car' }, { parts: { reprog: 'stage3' } })).toBeNull();
    expect(computePrep({ kind: 'car', engine: { ...turboDiesel, power: Number.NaN } }, undefined)).toBeNull();
  });
});

describe('postes proposés selon le moteur', () => {
  it('injection : reprogrammation et nitro', () => {
    expect(slotsFor(turboDiesel).map((slot) => slot.id)).toEqual(['reprog', 'nitro']);
    expect(resultLabelFor(turboDiesel)).toBe('Reprogrammé');
  });

  it('carburateur : carburation et nitro', () => {
    expect(slotsFor(flatCarbu).map((slot) => slot.id)).toEqual(['carbu', 'nitro']);
    expect(resultLabelFor(flatCarbu)).toBe('Préparé');
  });

  it('aucun moteur : aucun poste', () => {
    expect(slotsFor(undefined)).toEqual([]);
  });

  it('trois options par poste, identifiants lisibles par le store', () => {
    for (const slot of ENGINE_SLOTS) {
      expect(slot.options).toHaveLength(3);
      for (const option of slot.options) expect(option.id).toMatch(/^[a-z0-9][a-z0-9_-]{0,63}$/i);
    }
  });
});

describe('lecture tolérante', () => {
  it('une option inconnue vaut l’origine', () => {
    const build = { parts: { reprog: 'stage9' } };
    expect(chosenOption(turboDiesel, build, 'reprog')).toBeUndefined();
    expect(computePrep(van, build)).toMatchObject({ gain: 0, prepared: 102 });
  });

  it('un poste qui ne va pas à ce moteur est ignoré', () => {
    const build = { parts: { carbu: 'double-carbu', reprog: 'stage3', nitro: 'nitro-petit' } };
    expect(chosenOption(turboDiesel, build, 'carbu')).toBeUndefined();
    expect(computePrep(van, build)).toMatchObject({ prepared: 175, nitro: 50 });
    expect(computePrep(cox, build)).toMatchObject({ prepared: 60, nitro: 50 });
  });
});
