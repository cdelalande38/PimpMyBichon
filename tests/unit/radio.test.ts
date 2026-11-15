// Radio : lecteur de ZIP, stations d'un pack, étiquettes ID3, ordre de lecture, index tolérant,
// lien de pack. Les packs sont fabriqués par le test (tests/radio/fixtures.ts).

import { describe, expect, it } from 'vitest';
import {
  fileOwner,
  ORPHAN_GRACE_MS,
  pickOrphans,
  sanitizeCatalog,
  withDurations,
  withoutStations,
  withPack,
  withSongs,
  type Catalog,
  type Pack,
  type Station,
} from '../../src/audio/radio/catalog.ts';
import { id3Size, parseId3, tagsFromFilename } from '../../src/audio/radio/id3.ts';
import { checkPackUrl, isPrivateHost, readPackLink, stripPackLink } from '../../src/audio/radio/link.ts';
import { makeOrder, PlayQueue } from '../../src/audio/radio/order.ts';
import { parseManifest, pickStart, planStations, prettyStationName } from '../../src/audio/radio/pack.ts';
import { clampPosition, spokenTime } from '../../src/audio/radio/position.ts';
import { declaredSizes, entryBytes, entryRange, entryStream, PACK_MAX_BYTES, readZipEntries, ZipError, type ZipEntry } from '../../src/audio/radio/zip.ts';
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

async function drain(stream: ReadableStream<Uint8Array>): Promise<number> {
  const reader = stream.getReader();
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return total;
    total += value.length;
  }
}

describe('garde-fous du ZIP', () => {
  const MIO = 1024 * 1024;
  const declared = (size: number, compressedSize: number, method = 8): ZipEntry => ({ ...entry('electro/a.mp3'), method, size, compressedSize });

  it('plafond : le vrai pack (423 Mo, 70 morceaux stockés) passe largement, au-delà de 2 Gio non', () => {
    const real = Array.from({ length: 70 }, () => declared(Math.round(423e6 / 70), Math.round(423e6 / 70), 0));
    expect(declaredSizes(real)).toMatchObject({ tooBig: false, inflated: 0 });
    expect(declaredSizes(real).total).toBeLessThan(PACK_MAX_BYTES / 4);
    const huge = Array.from({ length: 3 }, () => declared(800 * MIO, 800 * MIO, 0));
    expect(declaredSizes(huge).tooBig).toBe(true);
    // Plafond abaissé (essais) : appliqué aussi.
    expect(declaredSizes([declared(10 * MIO, 10 * MIO)], 8 * MIO).tooBig).toBe(true);
  });

  it('bombe : une entrée qui gonfle anormalement est refusée avant toute écriture', () => {
    expect(declaredSizes([declared(256 * MIO, 255 * 1024)]).tooBig).toBe(true);
    // Un MP3 compressé en deflate gagne quelques pour cent : il passe, et sa place est comptée.
    expect(declaredSizes([declared(6 * MIO, 5.8 * MIO)])).toEqual({ total: 6 * MIO, inflated: 6 * MIO, tooBig: false });
    // Un petit fichier très compressible (pack.json, texte) n'est pas une bombe.
    expect(declaredSizes([declared(200 * 1024, 2 * 1024)]).tooBig).toBe(false);
  });

  it('CRC et taille contrôlés en flux : un pack abîmé ou menteur est refusé', async () => {
    const song = bytes('la '.repeat(4000));
    const good = blobOf(buildZip([{ name: 'rock/b.mp3', data: song, deflate: true }]));
    const [ok] = await readZipEntries(good);
    expect(await drain(await entryStream(good, ok!))).toBe(song.length);

    const badCrc = blobOf(buildZip([{ name: 'rock/b.mp3', data: song, deflate: true, declaredCrc: 1234 }]));
    const [crcEntry] = await readZipEntries(badCrc);
    await expect(drain(await entryStream(badCrc, crcEntry!))).rejects.toMatchObject({ code: 'abime' });

    // Déclare 100 octets, en produit 12 000 : coupé dès le dépassement.
    const liar = blobOf(buildZip([{ name: 'rock/b.mp3', data: song, deflate: true, declaredSize: 100 }]));
    const [liarEntry] = await readZipEntries(liar);
    await expect(drain(await entryStream(liar, liarEntry!))).rejects.toMatchObject({ code: 'abime' });

    // Entrée stockée au CRC faux : refusée aussi par entryStream.
    const stored = blobOf(buildZip([{ name: 'rock/c.mp3', data: song, declaredCrc: 1 }]));
    const [storedEntry] = await readZipEntries(stored);
    await expect(drain(await entryStream(stored, storedEntry!))).rejects.toBeInstanceOf(ZipError);
  });
});

describe('lien reçu : ni la machine locale ni le réseau privé', () => {
  it('refuse les hôtes locaux et privés, accepte un hébergement public', () => {
    for (const host of ['localhost', 'app.localhost', '127.0.0.1', '10.0.0.2', '172.20.1.1', '192.168.1.10', '169.254.1.1', '100.64.0.1', '0.0.0.0', '[::1]', '[fd00::1]', '[fe80::1]', '[::ffff:7f00:1]', 'nas', 'nas.local', 'box.lan', 'imprimante.home.arpa']) {
      expect(isPrivateHost(host), host).toBe(true);
    }
    for (const host of ['hebergement.example', '8.8.8.8', '172.32.0.1', '[2001:db8::1]', 'packs.example']) {
      expect(isPrivateHost(host), host).toBe(false);
    }
    expect(readPackLink('?pack=http://localhost:4521/p.zip', '')).toEqual({ ok: false, reason: 'local' });
    expect(readPackLink('?pack=https://192.168.1.10/p.zip', '')).toEqual({ ok: false, reason: 'local' });
    expect(readPackLink('', '#pack=https://2130706433/p.zip')).toEqual({ ok: false, reason: 'local' });
    expect(readPackLink('?pack=https://[::ffff:127.0.0.1]/p.zip', '')).toEqual({ ok: false, reason: 'local' });
    expect(readPackLink('?pack=https://hebergement.example/p.zip', '')).toMatchObject({ ok: true });
    // Le champ d'adresse du panneau les accepte toujours.
    expect(checkPackUrl('http://localhost:4521/p.zip')).toMatchObject({ ok: true });
    expect(checkPackUrl('https://192.168.1.10/p.zip')).toMatchObject({ ok: true });
  });
});

describe('index à plusieurs onglets : chaque écriture part de l’index relu sur le disque', () => {
  const track = (id: string, file: string) => ({ id, path: `${id}.mp3`, title: id, file, mime: 'audio/mpeg' });
  const pack = (id: string, files: string[] = [`${id}.zip`]): Pack => ({ id, origin: 'fichier', label: id, files, sourceBytes: 10, bytes: 10, importedAt: 0 });
  const station = (id: string, packId: string, folder: string): Station => ({ id, packId, folder, name: folder, tracks: [track(`t-${id}`, `${packId}.zip`)] });
  const empty: Catalog = { packs: [], stations: [] };

  it('deux stations dans A, une troisième dans B : les trois restent', () => {
    // A écrit deux fois ; B, ouvert avant, écrit ensuite : il part du disque, pas de sa copie vide.
    let disk = withPack(empty, pack('pack-a1'), [station('s1', 'pack-a1', 'electro')]).catalog;
    disk = withPack(disk, pack('pack-a2'), [station('s2', 'pack-a2', 'rock')]).catalog;
    const fromB = withPack(disk, pack('pack-b1'), [station('s3', 'pack-b1', 'jazz')]);
    expect(fromB.catalog.stations.map((s) => s.folder)).toEqual(['electro', 'rock', 'jazz']);
    expect(fromB.orphans).toEqual([]);
    // Réimport du même dossier : la station est remplacée, son ancien pack part.
    const again = withPack(fromB.catalog, pack('pack-a3'), [station('s4', 'pack-a3', 'electro')]);
    expect(again.replaced.map((s) => s.id)).toEqual(['s1']);
    expect(again.orphans.map((p) => p.id)).toEqual(['pack-a1']);
    expect(again.catalog.packs.map((p) => p.id)).toEqual(['pack-a2', 'pack-b1', 'pack-a3']);
  });

  it('durées, suppression, Ma playlist : seul le changement voulu est appliqué', () => {
    let disk = withPack(empty, pack('pack-a1'), [station('s1', 'pack-a1', 'electro')]).catalog;
    disk = withPack(disk, pack('pack-b1'), [station('s2', 'pack-b1', 'rock')]).catalog;
    // Durée retenue par un onglet qui ne connaissait que s1 : s2 survit.
    const timed = withDurations(disk, new Map([['t-s1', 42]]));
    expect(timed.stations).toHaveLength(2);
    expect(timed.stations[0]?.tracks[0]?.duration).toBe(42);
    expect(withDurations(timed, new Map([['inconnu', 3]]))).toBe(timed);
    // Suppression : seule la station visée part, avec son pack.
    const dropped = withoutStations(timed, (s) => s.id === 's1');
    expect(dropped.catalog.stations.map((s) => s.id)).toEqual(['s2']);
    expect(dropped.orphans.map((p) => p.id)).toEqual(['pack-a1']);
    expect(withoutStations(timed, (s) => s.id === 'absente').catalog).toBe(timed);
    // Ma playlist : un morceau ajouté entre-temps par l'autre onglet n'est pas doublé.
    const first = withSongs(disk, [{ track: track('t-x', 'piste-t-x.mp3'), bytes: 5 }], 1);
    const second = withSongs(first.catalog, [
      { track: track('t-x', 'piste-t-x2.mp3'), bytes: 5 },
      { track: track('t-y', 'piste-t-y.mp3'), bytes: 7 },
    ]);
    expect(second.dropped).toEqual(['piste-t-x2.mp3']);
    expect(second.station?.tracks.map((t) => t.file)).toEqual(['piste-t-x.mp3', 'piste-t-y.mp3']);
    expect(second.catalog.packs.find((p) => p.id === 'ma-playlist')).toMatchObject({ files: ['piste-t-x.mp3', 'piste-t-y.mp3'], bytes: 12 });
    expect(second.catalog.stations).toHaveLength(3);
  });

  it('ménage : jamais un fichier d’un import en cours ni un fichier récent', () => {
    const now = 10 * ORPHAN_GRACE_MS;
    const old = now - ORPHAN_GRACE_MS - 1;
    const disk = withPack(empty, pack('pack-aaaaaaaaaaaa'), [station('s1', 'pack-aaaaaaaaaaaa', 'electro')]).catalog;
    const files = [
      { name: 'pack-aaaaaaaaaaaa.zip', lastModified: old },
      { name: 'pack-bbbbbbbbbbbb.zip', lastModified: old },
      { name: 'pack-bbbbbbbbbbbb-t-0123456789ab.mp3', lastModified: old },
      { name: 'pack-cccccccccccc-t-0123456789ab.mp3', lastModified: now - 1000 },
      { name: 'pack-dddddddddddd.zip', lastModified: old },
      { name: 'piste-t-0123456789ab.mp3', lastModified: old },
    ];
    expect(fileOwner('pack-bbbbbbbbbbbb-t-0123456789ab.mp3')).toBe('pack-bbbbbbbbbbbb');
    expect(fileOwner('piste-t-0123456789ab.mp3')).toBe('piste');
    expect(pickOrphans(files, disk, new Set(['pack-bbbbbbbbbbbb']), now)).toEqual(['pack-dddddddddddd.zip', 'piste-t-0123456789ab.mp3']);
    expect(pickOrphans(files, disk, new Set(['piste']), now)).toEqual(['pack-bbbbbbbbbbbb.zip', 'pack-bbbbbbbbbbbb-t-0123456789ab.mp3', 'pack-dddddddddddd.zip']);
  });
});
