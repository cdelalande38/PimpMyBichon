// Station d'accueil (musique embarquée, servie par l'app) : lecture du manifeste, place dans l'index,
// règle de bascule vers le pack, gestes de l'utilisateur, contrôle audio:check et indexation.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  BUILTIN_STATIONS,
  noteStationChoice,
  noteWelcomeGesture,
  packStations,
  readBuiltins,
  readStationManifest,
  resetWelcomeGestures,
  shouldStartPack,
  shouldStartWelcome,
  welcomeStation,
  welcomeTouched,
  withBuiltins,
} from '../../src/audio/radio/accueil.ts';
import { sanitizeCatalog, withoutStations, withPack, type Catalog, type Pack, type Station } from '../../src/audio/radio/catalog.ts';
import { pickStart } from '../../src/audio/radio/pack.ts';
import { runAudioCheck, stationProblems } from '../../tools/lib/audio.mjs';
import { formatStation, id3Title, indexStation } from '../../tools/radio/accueil.mjs';
import { id3Tagged } from '../radio/fixtures.ts';
import { BINARY, creditsFile, located, messagesOf, useTempTrees } from './tools/helpers.ts';

const ROOT = join(import.meta.dirname, '..', '..');

const manifest = (morceaux: unknown[], extra: Record<string, unknown> = {}) => ({ format: 'pmb-station', version: 1, nom: 'Essai', morceaux, ...extra });

function packStation(id: string, packId: string, count: number): Station {
  return {
    id,
    packId,
    folder: id,
    name: id,
    tracks: Array.from({ length: count }, (_, i) => ({ id: `${id}-${i}`, path: `${id}/${i}.mp3`, file: `${packId}.zip`, title: `${i}`, mime: 'audio/mpeg' })),
  };
}

const pack = (id: string): Pack => ({ id, origin: 'adresse', label: 'essai', files: [`${id}.zip`], sourceBytes: 10, bytes: 10, importedAt: 1 });

describe('station d’accueil : le manifeste embarqué', () => {
  it('donne une station de base, servie par l’app, dont chaque morceau existe sous public/', () => {
    expect(BUILTIN_STATIONS).toHaveLength(1);
    const [station] = BUILTIN_STATIONS;
    expect(station).toMatchObject({ id: 'accueil', packId: 'app-accueil', folder: 'accueil', name: 'Atelier FM', builtin: true });
    expect(station!.tracks.map((track) => track.title)).toEqual(['Midnight Cruise', 'Midnight Glide', 'Midnight Lanes', 'Midnight Runway']);
    for (const track of station!.tracks) {
      // Lu en flux depuis le site (base de l'app + dossier de la station), jamais depuis le stockage privé.
      expect(track.src).toBe(`/assets/audio/radio/accueil/${track.file}`);
      expect(track.id).toBe(`accueil/${track.file}`);
      expect(track.mime).toBe('audio/mpeg');
      expect(track.duration).toBeGreaterThan(140);
      expect(existsSync(join(ROOT, 'public', track.src!)), track.src).toBe(true);
    }
  });

  it('suit la base de l’app et l’ordre alphabétique des dossiers', () => {
    const stations = readBuiltins(
      {
        '../../../public/assets/audio/radio/zeta/station.json': manifest([{ fichier: 'z.mp3', titre: 'Z' }]),
        '../../../public/assets/audio/radio/alpha/station.json': manifest([{ fichier: 'a b.mp3', titre: 'A' }]),
      },
      '/PimpMyBichon/',
    );
    expect(stations.map((station) => station.id)).toEqual(['alpha', 'zeta']);
    expect(stations[0]!.tracks[0]!.src).toBe('/PimpMyBichon/assets/audio/radio/alpha/a%20b.mp3');
  });

  it('écarte un morceau mal décrit, sans perdre la station', () => {
    const station = readStationManifest(
      manifest([
        { fichier: 'bon.mp3', titre: ' Bon ', artiste: 'Atelier', duree: 12.5 },
        { fichier: '../ailleurs.mp3', titre: 'Remontée' },
        { fichier: 'sous/dossier.mp3', titre: 'Chemin' },
        { fichier: 'notes.txt', titre: 'Pas un son' },
        { fichier: 'bon.mp3', titre: 'Doublon' },
        { fichier: 'sans-titre.ogg', duree: -3 },
        'pas un objet',
      ]),
      'essai',
      '/',
    );
    expect(station?.tracks.map((track) => [track.file, track.title, track.artist, track.duration, track.mime])).toEqual([
      ['bon.mp3', 'Bon', 'Atelier', 12.5, 'audio/mpeg'],
      ['sans-titre.ogg', 'sans-titre', undefined, undefined, 'audio/ogg'],
    ]);
  });

  it('refuse un manifeste d’un autre format, sans morceau, ou un dossier au nom refusé', () => {
    expect(readStationManifest({ ...manifest([{ fichier: 'a.mp3' }]), format: 'pmb-pack' }, 'essai', '/')).toBeNull();
    expect(readStationManifest({ ...manifest([{ fichier: 'a.mp3' }]), version: 2 }, 'essai', '/')).toBeNull();
    expect(readStationManifest(manifest([]), 'essai', '/')).toBeNull();
    expect(readStationManifest(manifest([{ fichier: 'a.mp3' }]), 'Mon Dossier', '/')).toBeNull();
    expect(readStationManifest(null, 'essai', '/')).toBeNull();
    expect(readStationManifest(manifest([{ fichier: 'a.mp3' }], { nom: '' }), 'essai', '/')?.name).toBe('essai');
  });
});

describe('station d’accueil : place dans l’index', () => {
  const disk: Catalog = { packs: [pack('pack-aa')], stations: [packStation('rock', 'pack-aa', 2)] };

  it('vient après les stations des packs, une seule fois, et n’est jamais enregistrée', () => {
    const memory = withBuiltins(disk);
    expect(memory.stations.map((station) => station.id)).toEqual(['rock', 'accueil']);
    expect(withBuiltins(memory).stations.map((station) => station.id)).toEqual(['rock', 'accueil']);
    expect(packStations(memory).map((station) => station.id)).toEqual(['rock']);
    expect(welcomeStation(memory)?.name).toBe('Atelier FM');
    // Relu depuis le disque, l'index n'a jamais de station sans pack connu : l'accueil n'y entre pas.
    expect(sanitizeCatalog(JSON.parse(JSON.stringify(memory)))).toEqual(disk);
    expect(withBuiltins({ packs: [], stations: [] }).stations.map((station) => station.id)).toEqual(['accueil']);
  });

  it('ne se supprime pas : seules les stations rangées sur le disque peuvent partir', () => {
    // library.deleteStation travaille sur l'index du disque, où la station d'accueil n'est pas.
    expect(withoutStations(disk, (station) => station.id === 'accueil' && !station.builtin).removed).toEqual([]);
    expect(withoutStations(withBuiltins(disk), (station) => station.id === 'accueil' && !station.builtin).removed).toEqual([]);
  });

  it('n’est jamais choisie à l’arrivée d’un pack : la station la plus fournie du pack l’emporte', () => {
    const fresh = [packStation('electro', 'pack-bb', 2), packStation('jazz', 'pack-bb', 3)];
    const next = withPack(disk, pack('pack-bb'), fresh).catalog;
    const candidates = packStations(withBuiltins(next)).filter((station) => station.packId === 'pack-bb');
    expect(candidates[pickStart(candidates.map((station) => ({ folder: station.folder, count: station.tracks.length })))]!.id).toBe('jazz');
  });
});

describe('station d’accueil : règle de bascule', () => {
  const welcomeOn = (playing: boolean) => ({ now: { stationId: 'accueil', playing }, onWelcome: true });

  it('part toute seule seulement sans pack, rien de chargé, réglage permis, sans geste contraire', () => {
    const base = { autoPlay: true, now: null, touched: false, hasWelcome: true, hasPacks: false };
    expect(shouldStartWelcome(base)).toBe(true);
    expect(shouldStartWelcome({ ...base, hasPacks: true })).toBe(false);
    expect(shouldStartWelcome({ ...base, autoPlay: false })).toBe(false);
    expect(shouldStartWelcome({ ...base, touched: true })).toBe(false);
    expect(shouldStartWelcome({ ...base, hasWelcome: false })).toBe(false);
    expect(shouldStartWelcome({ ...base, now: { stationId: 'accueil', playing: false } })).toBe(false);
  });

  it('pack prêt : bascule depuis l’accueil, qu’il joue ou attende le premier appui', () => {
    expect(shouldStartPack({ autoPlay: true, touched: false, ...welcomeOn(true) })).toBe(true);
    expect(shouldStartPack({ autoPlay: true, touched: false, ...welcomeOn(false) })).toBe(true);
  });

  it('pack prêt : rien ne bouge après un geste sur l’accueil, ni réglage coupé', () => {
    expect(shouldStartPack({ autoPlay: true, touched: true, ...welcomeOn(true) })).toBe(false);
    expect(shouldStartPack({ autoPlay: true, touched: true, ...welcomeOn(false) })).toBe(false);
    expect(shouldStartPack({ autoPlay: false, touched: false, ...welcomeOn(true) })).toBe(false);
  });

  it('hors de l’accueil, la règle d’avant : le pack part seulement si rien ne joue', () => {
    expect(shouldStartPack({ autoPlay: true, touched: false, now: null, onWelcome: false })).toBe(true);
    expect(shouldStartPack({ autoPlay: true, touched: false, now: { stationId: 'rock', playing: false }, onWelcome: false })).toBe(true);
    expect(shouldStartPack({ autoPlay: true, touched: true, now: { stationId: 'rock', playing: true }, onWelcome: false })).toBe(false);
  });
});

describe('station d’accueil : gestes de l’utilisateur', () => {
  beforeEach(() => resetWelcomeGestures());

  it('pause, suivant ou précédent sur l’accueil : la bascule s’efface ; ailleurs, rien ne change', () => {
    noteWelcomeGesture(false);
    expect(welcomeTouched()).toBe(false);
    noteWelcomeGesture(true);
    expect(welcomeTouched()).toBe(true);
  });

  it('choisir l’accueil la retient ; choisir une station de pack remet la règle à zéro', () => {
    noteStationChoice(true);
    expect(welcomeTouched()).toBe(true);
    noteStationChoice(false);
    expect(welcomeTouched()).toBe(false);
  });
});

describe('audio:check — stations de base', () => {
  const tree = useTempTrees();
  const DIR = 'public/assets/audio/radio/accueil';
  const credits = creditsFile([`${DIR}/*.mp3`, 'droits du commanditaire'], [`${DIR}/station.json`, 'création projet']);

  it('accepte une station dont le manifeste liste exactement les morceaux du dossier', () => {
    const root = tree({
      'CREDITS.md': credits,
      [`${DIR}/a.mp3`]: BINARY,
      [`${DIR}/b.mp3`]: BINARY,
      [`${DIR}/station.json`]: JSON.stringify(manifest([{ fichier: 'a.mp3', titre: 'A', duree: 3 }, { fichier: 'b.mp3', titre: 'B' }])),
    });
    const report = runAudioCheck({ root });
    expect(report.errors).toEqual([]);
    expect(messagesOf(report.notes)).toContain('1 station de base contrôlée sous public/assets/audio/radio/ (2 morceaux)');
  });

  it('signale un morceau absent du manifeste, un morceau listé mais absent, et un manifeste manquant', () => {
    const root = tree({
      'CREDITS.md': credits,
      [`${DIR}/a.mp3`]: BINARY,
      [`${DIR}/oublie.mp3`]: BINARY,
      [`${DIR}/station.json`]: JSON.stringify(manifest([{ fichier: 'a.mp3', titre: 'A' }, { fichier: 'parti.mp3', titre: 'Parti' }])),
      'public/assets/audio/radio/sans-manifeste/c.mp3': BINARY,
    });
    const report = runAudioCheck({ root });
    expect(located(report.errors)).toEqual([
      `${DIR}/station.json:0 station-de-base`,
      `${DIR}/station.json:0 station-de-base`,
      'public/assets/audio/radio/sans-manifeste:0 station-de-base',
      // Hors du dossier de l'accueil, la licence « droits du commanditaire » ne couvre rien.
      'public/assets/audio/radio/sans-manifeste/c.mp3:0 licence',
    ]);
    expect(messagesOf(report.errors)).toMatch(/« parti\.mp3 » n’est pas dans le dossier[\s\S]*« oublie\.mp3 » est dans le dossier mais pas dans « morceaux »/);
  });

  it('détaille les erreurs d’un manifeste mal écrit', () => {
    expect(stationProblems({ format: 'autre', morceaux: [{ fichier: 'x/y.mp3' }, { fichier: 'a.mp3', duree: 0 }] }, new Set(['a.mp3'])).problems).toEqual([
      '« format » doit valoir « pmb-station » et « version » 1',
      '« nom » manque : c’est le nom de la station dans la radio',
      'morceau n° 1 : « fichier » doit être le nom d’un fichier audio du dossier (.mp3, .ogg, .opus, .m4a, .aac, .weba)',
      'morceau n° 2 : « titre » manque',
      'morceau n° 2 : « duree » doit être un nombre de secondes positif',
    ]);
    const root = tree({ [`${DIR}/station.json`]: '{ "morceaux": [ }' });
    expect(messagesOf(runAudioCheck({ root }).errors)).toContain('JSON invalide');
  });

  it('refuse un dossier au nom illisible par l’app et un morceau rangé hors d’un dossier de station', () => {
    const root = tree({
      'CREDITS.md': creditsFile(['public/assets/audio/radio/**', 'création projet']),
      'public/assets/audio/radio/Mon Dossier/a.mp3': BINARY,
      'public/assets/audio/radio/perdu.mp3': BINARY,
    });
    expect(located(runAudioCheck({ root }).errors)).toEqual([
      'public/assets/audio/radio/Mon Dossier:0 station-de-base',
      'public/assets/audio/radio/perdu.mp3:0 station-de-base',
    ]);
  });
});

describe('npm run radio:accueil — indexation', () => {
  it('lit le titre ID3 d’un morceau', () => {
    expect(id3Title(id3Tagged('Midnight Essai', 'Atelier'))).toBe('Midnight Essai');
    expect(id3Title(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]))).toBeNull();
  });

  it('garde nom, ordre, titres et durées ; ajoute les nouveaux ; retire les absents', () => {
    const { station, added, removed } = indexStation({
      folder: 'accueil',
      files: ['b.mp3', 'nouveau-son.mp3', 'a.mp3'],
      previous: manifest([{ fichier: 'b.mp3', titre: 'Bé', duree: 10 }, { fichier: 'parti.mp3', titre: 'Parti' }, { fichier: 'a.mp3', titre: 'A' }], { nom: 'Radio Essai' }),
      describe: (file) => (file === 'nouveau-son.mp3' ? { titre: null, duree: 61.237 } : {}),
    });
    expect(station).toEqual({
      format: 'pmb-station',
      version: 1,
      nom: 'Radio Essai',
      morceaux: [
        { fichier: 'b.mp3', titre: 'Bé', duree: 10 },
        { fichier: 'a.mp3', titre: 'A' },
        { fichier: 'nouveau-son.mp3', titre: 'Nouveau Son', duree: 61.24 },
      ],
    });
    expect(added).toEqual(['nouveau-son.mp3']);
    expect(removed).toEqual(['parti.mp3']);
    // Le manifeste réécrit se relit comme un station.json valide.
    expect(stationProblems(JSON.parse(formatStation(station)), new Set(['a.mp3', 'b.mp3', 'nouveau-son.mp3'])).problems).toEqual([]);
  });
});
