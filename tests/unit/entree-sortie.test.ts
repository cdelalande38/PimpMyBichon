// Menu de la sortie par étapes (vague U, retour du 18 novembre 2026) : le lieu des cartes (champ `zone`
// des manifestes), les étapes et leur pile dans le dock, la reprise sur la dernière sortie, le format par
// défaut (course d'un tour) et la migration d'une sauvegarde d'avant.

import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, set } from 'idb-keyval';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AIDES_FORMAT, FORMAT_PAR_DEFAUT } from '../../src/data/courses.ts';
import { buildMapCatalog, circuitLabel, MAPS, validateMapManifest, zoneOf, zonesOf } from '../../src/data/maps.ts';
import type { MapManifest } from '../../src/data/mapTypes.ts';
import { sanitizeLevels, type DockLevel } from '../../src/state/dock.ts';
import { DEFAULT_DRIVE_PREFS, DRIVE_KEY, DRIVE_VERSION, migrerDrivePrefs, sanitizeDerniere } from '../../src/state/drive.ts';
import { apresCircuit, apresDepart, apresLieu, etapeDe, LIBELLE_DEBUT, niveauCarriere, niveauLieu, pileReprise, rappel, sansEtapeDepart } from '../../src/ui/drive/entree/etapes.ts';

const BASE = {
  name: 'Route d’essai',
  kind: 'route',
  route: 'route.json',
  credits: [{ source: 'IGN, BD TOPO', licence: 'Licence Ouverte 2.0', date: '2026-11' }],
};

function carte(id: string, order: number, zone?: MapManifest['zone']): MapManifest {
  return validateMapManifest({ ...BASE, id, name: `Carte ${id}`, order, ...(zone ? { zone } : {}) }, id);
}

const SEULE = carte('lacs', 1, { id: 'plateau', label: 'Plateau', circuit: 'Les lacs' });
const VILLE = carte('ville', 2, { id: 'port', label: 'Le port', circuit: 'La ville' });
const CIRCUIT = carte('circuit', 3, { id: 'port', label: 'Le port', circuit: 'Le circuit' });
const LIBRE = carte('libre', 4);
const CATALOGUE = [SEULE, VILLE, CIRCUIT, LIBRE];

const sortie = (levels: DockLevel[]) => levels.map((level) => (level.kind === 'sortie' ? level.etape : level.kind));

describe('lieu des cartes (champ zone des manifestes)', () => {
  it('les quatre cartes livrées déclarent leur lieu, et chaque lieu un seul nom', () => {
    for (const map of MAPS) {
      expect(map.zone, map.id).toBeDefined();
      expect(map.zone?.label.trim().length, map.id).toBeGreaterThan(0);
      expect(map.zone?.circuit?.trim().length, map.id).toBeGreaterThan(0);
    }
    const zones = zonesOf();
    expect(zones.reduce((n, zone) => n + zone.maps.length, 0)).toBe(MAPS.length);
    expect(new Set(zones.map((zone) => zone.id)).size).toBe(zones.length);
    // Un lieu au moins porte plusieurs circuits : l'étape du circuit sert.
    expect(zones.some((zone) => zone.maps.length > 1)).toBe(true);
  });

  it('validation : forme du lieu, et un même nom pour un même lieu', () => {
    expect(() => validateMapManifest({ ...BASE, id: 'a', order: 1, zone: 'port' }, 'a')).toThrow(/zone doit être un objet/);
    expect(() => validateMapManifest({ ...BASE, id: 'a', order: 1, zone: { id: 'Le Port', label: 'Le port' } }, 'a')).toThrow(/zone\.id/);
    expect(() => validateMapManifest({ ...BASE, id: 'a', order: 1, zone: { id: 'port', label: ' ' } }, 'a')).toThrow(/zone\.label/);
    expect(() => validateMapManifest({ ...BASE, id: 'a', order: 1, zone: { id: 'port', label: 'Le port', circuit: 3 } }, 'a')).toThrow(/zone\.circuit/);
    expect(() =>
      buildMapCatalog({
        '/x/maps/a/map.json': { ...BASE, id: 'a', order: 1, zone: { id: 'port', label: 'Le port' } },
        '/x/maps/b/map.json': { ...BASE, id: 'b', order: 2, zone: { id: 'port', label: 'Le vieux port' } },
      }),
    ).toThrow(/zone « port »/);
  });

  it('lieux dans l’ordre de leur première carte ; une carte sans lieu en fait un à elle seule', () => {
    const zones = zonesOf(CATALOGUE);
    expect(zones.map((zone) => [zone.id, zone.maps.map((map) => map.id)])).toEqual([
      ['plateau', ['lacs']],
      ['port', ['ville', 'circuit']],
      ['carte-libre', ['libre']],
    ]);
    expect(zoneOf(LIBRE).label).toBe('Carte libre');
    expect(circuitLabel(CIRCUIT)).toBe('Le circuit');
    expect(circuitLabel(LIBRE)).toBe('Carte libre');
  });
});

describe('étapes du menu', () => {
  it('un lieu à un seul circuit va droit aux départs ; plusieurs : l’étape du circuit', () => {
    const [plateau, port] = zonesOf(CATALOGUE);
    expect(apresLieu(plateau!)).toEqual({ niveau: { kind: 'sortie', etape: 'depart', libelle: 'Plateau' }, carte: SEULE });
    expect(apresLieu(port!)).toEqual({ niveau: { kind: 'sortie', etape: 'circuit', libelle: 'Le port', lieu: 'port' }, carte: null });
    expect(apresCircuit(CIRCUIT)).toEqual({ kind: 'sortie', etape: 'depart', libelle: 'Le circuit' });
  });

  it('étape à l’écran : le mode sans niveau, puis le haut de la pile', () => {
    expect(etapeDe([])).toBe('mode');
    expect(etapeDe([niveauLieu()])).toBe('zone');
    expect(etapeDe([niveauCarriere()])).toBe('carriere');
    expect(etapeDe([{ kind: 'zone', zone: 'toit', step: 'couleur' }])).toBe('mode');
  });

  it('pile de reprise : droit aux réglages, « Retour » remonte étape par étape', () => {
    expect(sortie(pileReprise(CIRCUIT, 'Le casino', CATALOGUE))).toEqual(['zone', 'circuit', 'depart', 'reglages']);
    expect(sortie(pileReprise(SEULE, null, CATALOGUE))).toEqual(['zone', 'depart', 'reglages']);
    expect(pileReprise(CIRCUIT, 'Le casino', CATALOGUE).map((level) => (level.kind === 'sortie' ? level.libelle : ''))).toEqual(['Libre', 'Le port', 'Le circuit', 'Le casino']);
    // La pile passe la validation du dock telle quelle.
    expect(sanitizeLevels('sortie', pileReprise(CIRCUIT, 'Le casino', CATALOGUE))).toEqual(pileReprise(CIRCUIT, 'Le casino', CATALOGUE));
  });

  it('une carte à un seul départ n’a pas d’étape des départs', () => {
    const depart = [niveauLieu(), apresLieu(zonesOf(CATALOGUE)[0]!).niveau];
    const un = [{ id: 'a', label: 'Le col', at: 0 }];
    const deux = [...un, { id: 'b', label: 'La gare', at: 900 }];
    expect(sansEtapeDepart(depart, deux)).toBeNull();
    expect(sortie(sansEtapeDepart(depart, un) ?? [])).toEqual(['zone', 'reglages']);
    expect(sansEtapeDepart(depart, un)?.at(-1)).toEqual(apresDepart('Le col'));
    expect(sansEtapeDepart(depart, [])?.at(-1)).toEqual(apresDepart(LIBELLE_DEBUT));
    expect(sortie(sansEtapeDepart([...depart, apresDepart('Le col')], un) ?? [])).toEqual(['zone', 'reglages']);
  });

  it('le dock ne garde une pile de la sortie que dans l’ordre des étapes', () => {
    const lieu = niveauLieu();
    const circuit = apresLieu(zonesOf(CATALOGUE)[1]!).niveau;
    expect(sanitizeLevels('sortie', [lieu, circuit])).toEqual([lieu, circuit]);
    expect(sanitizeLevels('sortie', [circuit])).toEqual([]);
    expect(sanitizeLevels('sortie', [lieu, apresDepart('x'), circuit])).toEqual([lieu, apresDepart('x')]);
    expect(sanitizeLevels('sortie', [niveauCarriere(), lieu])).toEqual([niveauCarriere()]);
    expect(sanitizeLevels('sortie', [lieu, { kind: 'sortie', etape: 'circuit', libelle: 'x', lieu: '<b>' }])).toEqual([lieu]);
    expect(sanitizeLevels('peinture', [lieu])).toEqual([]);
    expect(sanitizeLevels('sortie', [{ kind: 'zone', zone: 'toit', step: 'couleur' }])).toEqual([]);
  });

  it('le rappel relit lieu, circuit et départ en une ligne', () => {
    expect(rappel(CIRCUIT, 'Le casino', CATALOGUE)).toBe('Le port › Le circuit › Le casino');
    expect(rappel(SEULE, null, CATALOGUE)).toBe('Plateau › Les lacs');
  });
});

describe('format par défaut et dernière sortie', () => {
  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('une sauvegarde neuve court un tour ; chaque format dit ce qu’il rapporte', () => {
    expect(FORMAT_PAR_DEFAUT).toBe('tour1');
    expect(DEFAULT_DRIVE_PREFS.format).toBe('tour1');
    expect(AIDES_FORMAT.balade).toMatch(/sans gain/);
    expect(AIDES_FORMAT.tour1).toMatch(/dollars/);
    expect(AIDES_FORMAT.tours3).toMatch(/dollars/);
  });

  it('migration : une balade d’avant repart une fois sur la course d’un tour ; un autre choix reste', () => {
    expect(DRIVE_VERSION).toBe(2);
    expect(migrerDrivePrefs({ format: 'balade' }, 1).format).toBe('tour1');
    expect(migrerDrivePrefs({}, 0).format).toBe('tour1');
    expect(migrerDrivePrefs({ format: 'tours3' }, 1).format).toBe('tours3');
    expect(migrerDrivePrefs({ format: 'balade' }, 2).format).toBe('balade');
  });

  it('dernière sortie relue de façon tolérante', () => {
    expect(sanitizeDerniere({ map: 'monaco-circuit', start: 'casino' })).toEqual({ map: 'monaco-circuit', start: 'casino' });
    expect(sanitizeDerniere({ map: 'monaco-circuit', start: 4 })).toEqual({ map: 'monaco-circuit', start: null });
    for (const raw of [null, 'x', { map: '../x' }, { map: '' }, { start: 'a' }]) expect(sanitizeDerniere(raw), JSON.stringify(raw)).toBeNull();
  });

  it('au lancement : une sauvegarde de version 1 en balade passe à la course d’un tour, une de version 2 garde la balade', async () => {
    const db = createStore('pimpmybichon', 'kv');
    const launch = async () => {
      vi.resetModules();
      const { useDrive } = await import('../../src/state/drive.ts');
      await vi.waitFor(() => expect(useDrive.getState().hydrated).toBe(true));
      return useDrive.getState();
    };
    await set(DRIVE_KEY, JSON.stringify({ state: { weather: 'sec', format: 'balade' }, version: 1 }), db);
    expect((await launch()).format).toBe('tour1');
    globalThis.indexedDB = new IDBFactory();
    await set(DRIVE_KEY, JSON.stringify({ state: { weather: 'sec', format: 'balade', derniere: { map: MAPS[0]!.id, start: null } }, version: 2 }), createStore('pimpmybichon', 'kv'));
    const relu = await launch();
    expect(relu.format).toBe('balade');
    expect(relu.derniere).toEqual({ map: MAPS[0]!.id, start: null });
  });
});
