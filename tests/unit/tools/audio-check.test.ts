// audio-check : aucune synthèse dans la chaîne moteur ni dans la radio, manifestes engine.json
// valides, aucun fichier audio sans licence admise (§ 9 et § 15 du cahier des charges).
import { symlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { AUDIO_EXTENSIONS, findSynthesis, runAudioCheck, STRICT_DIRS, SYNTHESIS_NAMES } from '../../../tools/lib/audio.mjs';
import { NOT_CHECKED_RULE } from '../../../tools/lib/report.mjs';
import { BINARY, creditsFile, located, messagesOf, useTempTrees } from './helpers.ts';
import type { TreeSpec } from './helpers.ts';

/** Une ligne de code par point d'entrée de la synthèse dans l'API Web Audio. */
const SYNTHESIS_LINES: Array<[name: string, line: string]> = [
  ['createOscillator', 'const osc = ctx.createOscillator();'],
  ['OscillatorNode', 'const osc = new OscillatorNode(ctx, { frequency: 80 });'],
  ['createPeriodicWave', 'const wave = ctx.createPeriodicWave(real, imag);'],
  ['PeriodicWave', 'const wave = new PeriodicWave(ctx, { real, imag });'],
  ['createConstantSource', 'const offset = ctx.createConstantSource();'],
  ['ConstantSourceNode', 'const offset = new ConstantSourceNode(ctx);'],
];

/** Lecture d'échantillons réels : ce que la chaîne moteur a le droit de faire. */
const SAMPLE_PLAYBACK = [
  'export function playLoop(ctx: AudioContext, buffer: AudioBuffer, rate: number): AudioBufferSourceNode {',
  '  const source = new AudioBufferSourceNode(ctx, { buffer, loop: true, playbackRate: rate });',
  '  const gain = ctx.createGain();',
  '  const filter = ctx.createBiquadFilter();',
  '  source.connect(filter).connect(gain).connect(ctx.destination);',
  '  source.start();',
  '  return source;',
  '}',
  '',
].join('\n');

describe('audio-check — aucune synthèse dans la chaîne moteur ni dans la radio', () => {
  const tree = useTempTrees();

  it('surveille les deux dossiers et les points d’entrée de la synthèse', () => {
    expect([...STRICT_DIRS]).toEqual(['src/audio/engine/', 'src/audio/radio/']);
    expect([...SYNTHESIS_NAMES]).toEqual(SYNTHESIS_LINES.map(([name]) => name));
    expect(SYNTHESIS_NAMES).toEqual(
      expect.arrayContaining(['createOscillator', 'OscillatorNode', 'createPeriodicWave', 'PeriodicWave', 'createConstantSource']),
    );
  });

  it('laisse passer la lecture d’échantillons réels', () => {
    const root = tree({
      'src/audio/engine/player.ts': SAMPLE_PLAYBACK,
      'src/audio/radio/stations.ts': "export const STATIONS = [{ id: 'nuit', label: 'Radio Nuit' }];\n",
      'src/audio/engine/impulsion.bin': BINARY,
    });
    const report = runAudioCheck({ root });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(messagesOf(report.notes)).toContain('src/audio/radio/) : 2 fichiers contrôlés');
  });

  it.each(SYNTHESIS_LINES.flatMap(([name, line]) => STRICT_DIRS.map((dir): [string, string, string] => [name, dir, line])))(
    'refuse %s dans %s',
    (name, dir, line) => {
      const file = `${dir}voice.ts`;
      const report = runAudioCheck({ root: tree({ [file]: `// chaîne audio\n${line}\n` }) });
      expect(located(report.errors)).toEqual([`${file}:2 synthese`]);
      expect(report.errors[0]?.message).toContain(`« ${name} »`);
      expect(report.warnings).toEqual([]);
    },
  );

  it.each([
    ['des crochets et des guillemets simples', "const osc = ctx['createOscillator']();"],
    ['des crochets et des guillemets doubles', 'const osc = ctx["createOscillator"]();'],
    ['des crochets et un gabarit', 'const osc = ctx[`createOscillator`]();'],
    ['un échappement Unicode', "const osc = ctx['create\\u004fscillator']();"],
    ['un échappement entre accolades', "const osc = ctx['create\\u{4f}scillator']();"],
    ['un échappement hexadécimal', "const Node = globalThis['Oscillator\\x4eode'];"],
    ['une déstructuration', 'const { createOscillator: make } = AudioContext.prototype;'],
  ])('refuse un accès par %s', (_label, line) => {
    const root = tree({ 'src/audio/engine/voice.ts': `${line}\n` });
    expect(located(runAudioCheck({ root }).errors)).toEqual(['src/audio/engine/voice.ts:1 synthese']);
  });

  it('signale chaque occurrence, commentaires compris : la recherche est textuelle', () => {
    const root = tree({
      'src/audio/radio/jingle.ts': ['// pas de createOscillator ici', 'ctx.createOscillator(); ctx.createOscillator();'].join('\n'),
    });
    expect(located(runAudioCheck({ root }).errors)).toEqual([
      'src/audio/radio/jingle.ts:1 synthese',
      'src/audio/radio/jingle.ts:2 synthese',
      'src/audio/radio/jingle.ts:2 synthese',
    ]);
  });

  it('avertit sans échouer ailleurs dans src/', () => {
    const root = tree({
      'src/audio/sfx/bip.ts': 'export const bip = (ctx: AudioContext) => ctx.createOscillator();\n',
      'src/audio/mixer.ts': 'const offset = new ConstantSourceNode(ctx);\n',
      'src/ui/Bouton.tsx': '// retour sonore\nconst osc = ctx.createOscillator();\n',
    });
    const report = runAudioCheck({ root });
    expect(report.errors).toEqual([]);
    expect(located(report.warnings)).toEqual([
      'src/audio/mixer.ts:1 synthese',
      'src/audio/sfx/bip.ts:1 synthese',
      'src/ui/Bouton.tsx:2 synthese',
    ]);
    expect(report.warnings[0]?.message).toContain('ni un moteur ni une musique');
  });

  it('ne lit que src/ : le prototype, les outils, les tests et la documentation peuvent citer la synthèse', () => {
    const line = 'const osc = ctx.createOscillator();\n';
    const root = tree({
      'proto/index.html': `<script>${line}</script>`,
      'tools/lib/audio.mjs': line,
      'tests/unit/audio.test.ts': line,
      'docs/notes.md': line,
      'audio/engine/voice.ts': line,
    });
    const report = runAudioCheck({ root });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('note « 0 fichier contrôlé » quand les dossiers n’existent pas', () => {
    const trees: TreeSpec[] = [{}, { 'src/main.ts': 'export {};\n' }];
    for (const files of trees) {
      const report = runAudioCheck({ root: tree(files) });
      expect(report.errors).toEqual([]);
      expect(report.warnings).toEqual([]);
      expect(messagesOf(report.notes)).toContain('src/audio/radio/) : 0 fichier contrôlé');
    }
  });

  it('trouve les noms dans une ligne, casse comprise', () => {
    expect(findSynthesis('const o = new OscillatorNode(ctx), w = ctx.createPeriodicWave(r, i);')).toEqual([
      'OscillatorNode',
      'createPeriodicWave',
    ]);
    expect(findSynthesis('const oscillator = bank.oscillators[0]; // periodicWave')).toEqual([]);
    expect(findSynthesis('ctx.createBufferSource(); ctx.createGain();')).toEqual([]);
  });

  it.skipIf(process.platform === 'win32')('signale un lien symbolique sans le suivre', () => {
    const outside = tree({ 'voice.ts': 'ctx.createOscillator();\n' });
    const root = tree({ 'src/audio/index.ts': 'export {};\n' });
    symlinkSync(join('..', '..', '..', basename(outside)), join(root, 'src/audio/engine'));

    const report = runAudioCheck({ root });
    expect(report.errors).toEqual([]);
    expect(located(report.warnings)).toEqual(['src/audio/engine:0 lien-symbolique']);
  });
});

describe('audio-check — manifestes engine.json', () => {
  const tree = useTempTrees();

  it('accepte des manifestes valides et dit combien il en a lu', () => {
    const root = tree({
      'public/assets/vehicles/demo/audio/engine.json': JSON.stringify({ loops: [{ file: 'idle', rpm: 900, loopStart: 0.12, loopEnd: 2.4 }] }),
      'public/assets/vehicles/combi/engine.json': '{}',
    });
    const report = runAudioCheck({ root });
    expect(report.errors).toEqual([]);
    expect(messagesOf(report.notes)).toContain('2 manifestes engine.json contrôlés sous public/assets/');
  });

  it('refuse un manifeste qui n’est pas du JSON', () => {
    const root = tree({
      'public/assets/vehicles/demo/engine.json': '{ "loops": [ }',
      'public/assets/vehicles/combi/engine.json': '',
    });
    const report = runAudioCheck({ root });
    expect(report.errors.map((error) => [error.file, error.rule])).toEqual([
      ['public/assets/vehicles/combi/engine.json', 'manifeste-moteur'],
      ['public/assets/vehicles/demo/engine.json', 'manifeste-moteur'],
    ]);
    expect(report.errors[0]?.message).toContain('JSON invalide');
  });

  it('ne lit que les manifestes rangés sous public/assets/', () => {
    const root = tree({
      'public/engine.json': '{',
      'src/data/engine.json': '{',
      'docs/engine.json': '{',
      'public/assets/vehicles/demo/moteur.json': '{',
    });
    expect(runAudioCheck({ root }).errors).toEqual([]);
  });
});

describe('audio-check — fichiers audio sous licence', () => {
  const tree = useTempTrees();

  it('couvre exactement les formats livrables', () => {
    expect([...AUDIO_EXTENSIONS]).toEqual(['.mp3', '.ogg', '.opus', '.m4a', '.aac', '.weba']);
  });

  it.each([...AUDIO_EXTENSIONS])('refuse un fichier %s sans ligne de licence', (extension) => {
    const file = `public/assets/vehicles/demo/audio/idle${extension}`;
    const root = tree({ 'CREDITS.md': creditsFile(['public/icons/**', 'création projet']), [file]: BINARY });
    const report = runAudioCheck({ root });
    expect(located(report.errors)).toEqual([`${file}:0 licence`]);
    expect(report.errors[0]?.message).toContain('aucune ligne de CREDITS.md ne couvre ce fichier');
  });

  it('refuse un fichier audio partout sous public/, quelle que soit la casse de l’extension', () => {
    const root = tree({ 'public/sons/Clic.MP3': BINARY, 'public/radio/titre-01.opus': BINARY });
    const report = runAudioCheck({ root });
    expect(located(report.errors)).toEqual(['public/radio/titre-01.opus:0 licence', 'public/sons/Clic.MP3:0 licence']);
    expect(report.errors[0]?.message).toContain('CREDITS.md est absent');
  });

  it('refuse une licence hors de la liste admise', () => {
    const root = tree({
      'CREDITS.md': creditsFile(['public/assets/music/**', 'abonnement à une banque de sons']),
      'public/assets/music/titre-01.opus': BINARY,
    });
    const report = runAudioCheck({ root });
    expect(located(report.errors)).toEqual(['CREDITS.md:5 licence']);
    expect(report.errors[0]?.message).toContain('hors de la liste admise');
  });

  it('accepte un fichier audio couvert par une licence admise', () => {
    const root = tree({
      'CREDITS.md': creditsFile(['public/assets/sfx/*.opus', 'CC0-1.0'], ['public/assets/vehicles/demo/audio/', 'création projet']),
      'public/assets/sfx/clic.opus': BINARY,
      'public/assets/vehicles/demo/audio/idle.ogg': BINARY,
      'public/assets/vehicles/demo/audio/engine.json': '{}',
    });
    const report = runAudioCheck({ root });
    expect(report.errors).toEqual([]);
    expect(messagesOf(report.notes)).toContain('2 fichiers audio sous public/ : licence vérifiée dans CREDITS.md');
  });

  it('ne concerne ni les autres fichiers de public/, ni l’audio rangé ailleurs', () => {
    const root = tree({
      'public/icons/pwa-192.png': BINARY,
      'public/assets/vehicles/demo/body.glb': BINARY,
      'docs/extraits/ralenti.opus': BINARY,
      'tests/fixtures/bip.mp3': BINARY,
    });
    const report = runAudioCheck({ root });
    expect(report.errors).toEqual([]);
    expect(messagesOf(report.notes)).toContain('0 fichier audio sous public/');
  });
});

describe('audio-check — ce qui reste hors contrôle', () => {
  const tree = useTempTrees();

  it('dit ce qui n’est pas contrôlé à ce jalon', () => {
    const notes = runAudioCheck({ root: tree() }).notes.filter((note) => note.rule === NOT_CHECKED_RULE);
    expect(notes.map((note) => note.message)).toEqual([
      'non contrôlé à ce jalon : niveaux (LUFS, crête vraie), formats et points de bouclage, complétude des jeux de sons moteur (jalon 9)',
    ]);
  });
});
