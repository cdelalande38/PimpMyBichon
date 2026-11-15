// Radio : lecteur de ZIP, stations d'un pack, étiquettes ID3, ordre de lecture, index tolérant,
// lien de pack. Les packs sont fabriqués par le test (tests/radio/fixtures.ts).

import { describe, expect, it } from 'vitest';
import { sanitizeCatalog } from '../../src/audio/radio/catalog.ts';
import { id3Size, parseId3, tagsFromFilename } from '../../src/audio/radio/id3.ts';
import { checkPackUrl, readPackLink, stripPackLink } from '../../src/audio/radio/link.ts';
import { makeOrder, PlayQueue } from '../../src/audio/radio/order.ts';
import { parseManifest, pickStart, planStations, prettyStationName } from '../../src/audio/radio/pack.ts';
import { clampPosition, spokenTime } from '../../src/audio/radio/position.ts';
import { entryBytes, entryRange, readZipEntries, ZipError, type ZipEntry } from '../../src/audio/radio/zip.ts';
import { findPackByUrl, findSamePack } from '../../src/audio/radio/library.ts';
import { sanitizePrefs, useRadio } from '../../src/state/radio.ts';
import { buildZip, id3Tagged, packJson, type FixtureEntry } from '../radio/fixtures.ts';

const bytes = (text: string) => new Uint8Array(Buffer.from(text));
const blobOf = (data: Uint8Array) => new Blob([data as Uint8Array<ArrayBuffer>]);

async function names(entries: FixtureEntry[]): Promise<string[]> {
  return (await readZipEntries(blobOf(buildZip(entries)))).map((entry) => entry.name);
}

describe('lecteur de ZIP', () => {
  it('lit une entrée stockée comme une tranche exacte du fichier', async () => {
    const song = bytes('morceau-stocke-0123456789');
    const blob = blobOf(buildZip([{ name: 'electro/a.mp3', data: song }]));
    const [entry] = await readZipEntries(blob);
    expect(entry).toMatchObject({ name: 'electro/a.mp3', method: 0, size: song.length, encrypted: false });
    const { start, end } = await entryRange(blob, entry!);
    expect(new Uint8Array(await blob.slice(start, end).arrayBuffer())).toEqual(song);
  });

  it('décompresse une entrée deflate', async () => {
    const song = bytes('la '.repeat(500));
    const blob = blobOf(buildZip([{ name: 'rock/b.mp3', data: song, deflate: true }]));
    const [entry] = await readZipEntries(blob);
    expect(entry?.method).toBe(8);
    expect(await entryBytes(blob, entry!)).toEqual(song);
  });

  it('lit les noms accentués : drapeau UTF-8, champ 0x7075, repli en page 437', async () => {
    expect(await names([{ name: 'électro/Été à l’atelier.mp3', data: bytes('x') }])).toEqual(['électro/Été à l’atelier.mp3']);
    expect(
      await names([{ name: 'rock/Noël.mp3', data: bytes('x'), naming: 'unicode-extra', cp437Bytes: Uint8Array.from(Buffer.from('rock/No?l.mp3')) }]),
    ).toEqual(['rock/Noël.mp3']);
    // « é » en page 437 vaut 0x82 ; ce n'est pas de l'UTF-8 valable : repli sur la page 437.
    expect(
      await names([{ name: 'x', data: bytes('x'), naming: 'cp437', cp437Bytes: Uint8Array.from([0x63, 0x61, 0x66, 0x82, 0x2e, 0x6d, 0x70, 0x33]) }]),
    ).toEqual(['café.mp3']);
  });

  it('refuse clairement une archive abîmée ou chiffrée', async () => {
    const zip = buildZip([{ name: 'a.mp3', data: bytes('abc') }]);
    await expect(readZipEntries(blobOf(zip.slice(0, zip.length - 30)))).rejects.toBeInstanceOf(ZipError);
    await expect(readZipEntries(blobOf(bytes('pas un zip du tout, vraiment pas')))).rejects.toMatchObject({ code: 'abime' });
    const broken = zip.slice();
    broken[0] = 0; // en-tête local effacé
    const [entry] = await readZipEntries(blobOf(broken));
    await expect(entryRange(blobOf(broken), entry!)).rejects.toMatchObject({ code: 'abime' });
    const locked = blobOf(buildZip([{ name: 'a.mp3', data: bytes('abc'), encrypted: true }]));
    const [secret] = await readZipEntries(locked);
    expect(secret?.encrypted).toBe(true);
    await expect(entryBytes(locked, secret!)).rejects.toMatchObject({ code: 'chiffre' });
  });
});

function entry(name: string): ZipEntry {
  return { name, method: 0, compressedSize: 1, size: 1, localOffset: 0, crc: 0, encrypted: false, directory: name.endsWith('/') };
}

describe('stations d’un pack', () => {
  const files = ['electro/02 b.mp3', 'electro/01 a.mp3', 'hiphop-rnb/c.mp3', 'rock/d.m4a', 'rock/notes.txt', '__MACOSX/rock/._d.m4a'].map(entry);

  it('version 2 : une station par dossier déclaré, dans l’ordre du manifeste', () => {
    const manifest = JSON.stringify({ format: 'pmb-pack', version: 2, stations: [{ dossier: 'hiphop-rnb', pistes: 1 }, { dossier: 'electro', pistes: 2 }] });
    const plans = planStations(files, manifest, 'pack');
    expect(plans.map((p) => [p.name, p.entries.map((e) => e.name)])).toEqual([
      ['Hip-hop & R&B', ['hiphop-rnb/c.mp3']],
      ['Électro', ['electro/01 a.mp3', 'electro/02 b.mp3']],
    ]);
  });

  it('version 1 : une station', () => {
    const manifest = JSON.stringify({ format: 'pmb-pack', version: 1, station: 'rock', pistes: 1 });
    expect(planStations(files, manifest, 'pack').map((p) => [p.folder, p.entries.length])).toEqual([['rock', 1]]);
  });

  it('sans pack.json : chaque dossier de premier niveau, et la racine au nom du fichier', () => {
    const plans = planStations([...files, entry('solo.mp3')], null, 'mon-pack');
    expect(plans.map((p) => p.name)).toEqual(['Électro', 'Hip-hop & R&B', 'Mon-pack', 'Rock']);
    expect(planStations([entry('notes.txt')], null, 'x')).toEqual([]);
  });

  it('un manifeste illisible vaut « pas de manifeste », un dossier parent zippé est descendu', () => {
    expect(planStations(files, '{oups', 'p').length).toBe(3);
    const nested = ['ma-playlist/electro/a.mp3', 'ma-playlist/rock/b.mp3'].map(entry);
    expect(planStations(nested, null, 'p').map((p) => p.folder)).toEqual(['electro', 'rock']);
  });

  it('station de départ : le champ « depart », sinon la plus fournie, à égalité la première', () => {
    expect(parseManifest(JSON.stringify({ format: 'pmb-pack', version: 2, stations: [{ dossier: 'rock' }], depart: 'rock/' }))).toEqual({
      version: 2,
      stations: ['rock'],
      depart: 'rock',
    });
    expect(parseManifest(JSON.stringify({ format: 'pmb-pack', version: 1, station: 'rock', depart: 4 }))).toEqual({ version: 1, station: 'rock' });
    const stations = [
      { folder: 'electro', count: 3 },
      { folder: 'rock', count: 5 },
      { folder: 'chill', count: 5 },
    ];
    expect(pickStart(stations, 'chill')).toBe(2);
    expect(pickStart(stations, 'absente')).toBe(1);
    expect(pickStart(stations)).toBe(1);
    expect(pickStart([])).toBe(-1);
  });

  it('nomme joliment les stations', () => {
    expect(prettyStationName('hiphop-rnb')).toBe('Hip-hop & R&B');
    expect(prettyStationName('electro')).toBe('Électro');
    expect(prettyStationName('rock')).toBe('Rock');
    expect(prettyStationName('chill-out')).toBe('Chill-out');
  });
});

describe('étiquettes ID3', () => {
  it('lit titre et artiste en 2.3 (UTF-16) et en 2.4 (UTF-8)', () => {
    for (const version of [3, 4] as const) {
      const tag = id3Tagged('Bruit rose d’essai', 'Atelier Pétarade', version);
      expect(id3Size(tag)).toBeGreaterThan(10);
      expect(parseId3(tag)).toEqual({ title: 'Bruit rose d’essai', artist: 'Atelier Pétarade' });
    }
  });

  it('se rabat sur le nom du fichier', () => {
    expect(parseId3(bytes('pas une étiquette'))).toEqual({});
    expect(tagsFromFilename('electro/03 - Groupe Essai - Morceau Test.mp3')).toEqual({ artist: 'Groupe Essai', title: 'Morceau Test' });
    expect(tagsFromFilename('rock/07_Seul_titre.mp3')).toEqual({ title: 'Seul titre' });
  });
});

describe('ordre de lecture', () => {
  it('peekNext annonce exactement le morceau que next() rendra, y compris d’un tour à l’autre', () => {
    let seed = 3;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (const shuffle of [false, true]) {
      const queue = new PlayQueue(3, shuffle, 0, random);
      for (let i = 0; i < 20; i += 1) {
        const announced = queue.peekNext();
        expect(queue.next()).toBe(announced);
      }
    }
  });

  it('dans l’ordre, puis on boucle', () => {
    const queue = new PlayQueue(3, false, 1);
    expect([queue.current, queue.next(), queue.next(), queue.previous()]).toEqual([1, 2, 0, 2]);
  });

  it('aléatoire sans redite : chaque morceau une fois par tour, jamais deux fois de suite', () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const queue = new PlayQueue(5, true, 3, random);
    const played = [queue.current];
    for (let i = 0; i < 49; i += 1) played.push(queue.next());
    expect(played[0]).toBe(3);
    for (let tour = 0; tour < 10; tour += 1) {
      expect([...played.slice(tour * 5, tour * 5 + 5)].sort()).toEqual([0, 1, 2, 3, 4]);
    }
    for (let i = 1; i < played.length; i += 1) expect(played[i]).not.toBe(played[i - 1]);
    expect(makeOrder(4, false)).toEqual([0, 1, 2, 3]);
  });
});

describe('position dans le morceau', () => {
  it('bornes : jamais négative, jamais au-delà de la fin, durée inconnue tolérée', () => {
    expect(clampPosition(-3, 200)).toBe(0);
    expect(clampPosition(72, 200)).toBe(72);
    expect(clampPosition(500, 200)).toBe(199.75);
    expect(clampPosition(Number.NaN, 200)).toBe(0);
    expect(clampPosition(42, null)).toBe(42);
    expect(clampPosition(-1, Number.NaN)).toBe(0);
    expect(clampPosition(0.1, 0.2)).toBe(0);
  });

  it('valeur en clair pour les lecteurs d’écran', () => {
    expect(`${spokenTime(72)} sur ${spokenTime(220)}`).toBe('1 min 12 sur 3 min 40');
    expect(spokenTime(45.9)).toBe('45 s');
    expect(spokenTime(180)).toBe('3 min');
    expect(spokenTime(Number.NaN)).toBe('0 s');
  });
});

describe('index des stations', () => {
  it('lecture tolérante : écarte ce qui est abîmé, garde le reste', () => {
    const catalog = sanitizeCatalog({
      packs: [{ id: 'p1', origin: 'adresse', label: 'hote', files: ['p1.zip', 3], sourceBytes: 10, bytes: 10, url: 'x', depart: 'rock' }, null, { nope: 1 }],
      stations: [
        { id: 's1', packId: 'p1', folder: 'rock', name: 'Rock', tracks: [{ id: 't1', path: 'rock/a.mp3', file: 'p1.zip', start: 5, end: 9, title: 'A' }, { id: 7 }] },
        { id: 's2', packId: 'inconnu', tracks: [{ id: 't', path: 'p', file: 'f' }] },
        { id: 's3', packId: 'p1', tracks: [] },
      ],
    });
    expect(catalog.packs).toHaveLength(1);
    expect(catalog.packs[0]?.files).toEqual(['p1.zip']);
    expect(catalog.packs[0]?.depart).toBe('rock');
    expect(catalog.stations.map((s) => s.id)).toEqual(['s1']);
    expect(catalog.stations[0]?.tracks).toEqual([{ id: 't1', path: 'rock/a.mp3', file: 'p1.zip', start: 5, end: 9, title: 'A', mime: 'audio/mpeg' }]);
    expect(sanitizeCatalog('nimporte quoi')).toEqual({ packs: [], stations: [] });
    expect(sanitizePrefs({ volume: 7, shuffle: 'oui', miniOpen: 'oui' })).toEqual({ volume: 1, shuffle: false, lastStationId: null, lastTrackId: null, miniOpen: false });
    expect(sanitizePrefs({ miniOpen: true }).miniOpen).toBe(true);
  });
});

describe('lien de pack', () => {
  const target = 'https://hebergement.example/musique/pack.zip';

  it('lit ?pack= et #pack=, adresse brute ou encodée', () => {
    expect(readPackLink(`?pack=${target}`, '')).toEqual({ ok: true, url: target, host: 'hebergement.example' });
    expect(readPackLink(`?pack=${encodeURIComponent(target)}`, '')).toMatchObject({ ok: true, url: target });
    expect(readPackLink('', `#pack=${target}`)).toMatchObject({ ok: true, url: target });
    expect(readPackLink('', `#pack=${encodeURIComponent(encodeURIComponent(target))}`)).toMatchObject({ ok: true, url: target });
    // Adresse brute qui porte ses propres paramètres.
    expect(readPackLink(`?x=1&pack=${target}?cle=a&b=2`, '')).toMatchObject({ ok: true, url: `${target}?cle=a&b=2` });
    expect(readPackLink('?autre=1', '#/radio')).toBeNull();
  });

  it('refuse ce qui n’est pas https (sauf la machine locale)', () => {
    expect(readPackLink('?pack=http://hebergement.example/p.zip', '')).toEqual({ ok: false, reason: 'protocole' });
    expect(readPackLink('?pack=javascript:alert(1)', '')).toEqual({ ok: false, reason: 'protocole' });
    expect(readPackLink('?pack=pas%20une%20adresse', '')).toEqual({ ok: false, reason: 'illisible' });
    expect(checkPackUrl('http://localhost:4521/p.zip')).toMatchObject({ ok: true, host: 'localhost:4521' });
    expect(checkPackUrl(`  ${target}.  `)).toMatchObject({ ok: true, url: target });
  });

  it('nettoie l’adresse de l’app', () => {
    expect(stripPackLink('/PimpMyBichon/', `?pack=${target}`, '')).toBe('/PimpMyBichon/');
    expect(stripPackLink('/PimpMyBichon/', '?a=1&pack=x', '#/radio')).toBe('/PimpMyBichon/?a=1#/radio');
    expect(stripPackLink('/PimpMyBichon/', '', `#pack=${target}`)).toBe('/PimpMyBichon/');
  });
});

describe('pack déjà importé', () => {
  it('avant l’appui, l’adresse seule ; une fois la réponse reçue, l’adresse et le poids', () => {
    const url = 'https://hebergement.example/pack.zip';
    useRadio.setState({
      catalog: { packs: [{ id: 'p', origin: 'adresse', url, label: 'h', files: [], sourceBytes: 1000, bytes: 1000, importedAt: 0 }], stations: [] },
    });
    expect(findPackByUrl(url)?.id).toBe('p');
    expect(findPackByUrl(`${url}?v=2`)).toBeUndefined();
    expect(findSamePack(url, 1000)?.id).toBe('p');
    expect(findSamePack(url, 999)).toBeUndefined();
    expect(findSamePack(url, null)).toBeUndefined();
  });
});

describe('pack d’essai complet', () => {
  it('pack.json version 2 lu dans le ZIP, morceaux stockés', async () => {
    const zip = buildZip([
      packJson({ format: 'pmb-pack', version: 2, stations: [{ dossier: 'electro', pistes: 1 }] }),
      { name: 'electro/a.mp3', data: id3Tagged('T', 'A') },
    ]);
    const blob = blobOf(zip);
    const entries = await readZipEntries(blob);
    const manifest = new TextDecoder().decode(await entryBytes(blob, entries[0]!));
    expect(planStations(entries, manifest, 'x').map((p) => p.name)).toEqual(['Électro']);
  });
});
