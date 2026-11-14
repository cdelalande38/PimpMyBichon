// CLI des trois contrôles (arguments, affichage, code de sortie) et socle commun : parcours de
// l'arbre, lecture des fichiers texte, mise en forme du rapport.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, symlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseArgs, UsageError } from '../../../tools/lib/cli.mjs';
import { walkTree } from '../../../tools/lib/fs-walk.mjs';
import { createReport, finding, formatFinding, formatReport, notChecked } from '../../../tools/lib/report.mjs';
import { lineNumberAt, parseJson, readTextFile } from '../../../tools/lib/text.mjs';
import { BINARY, fake, useTempTrees } from './helpers.ts';
import type { TreeSpec } from './helpers.ts';

type Tool = 'guard' | 'assets-check' | 'audio-check';

const TOOLS: Tool[] = ['guard', 'assets-check', 'audio-check'];
const TOOLS_DIR = fileURLToPath(new URL('../../../tools/', import.meta.url));

/** Lance une CLI comme le fait `npm run` : un vrai processus Node, sa sortie et son code. */
function run(tool: Tool, ...args: string[]) {
  const result = spawnSync(process.execPath, [join(TOOLS_DIR, `${tool}.mjs`), ...args], { encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
}

/** Un arbre sans rien à signaler, pour les trois contrôles. */
const CLEAN: TreeSpec = { 'index.html': '<!doctype html>\n<title>Atelier</title>\n', 'src/main.ts': 'export {};\n' };

/** Par contrôle : un arbre qui enfreint une règle, et le début de la ligne attendue. */
const VIOLATIONS: Array<[Tool, TreeSpec, string]> = [
  ['guard', { 'README.md': `Contact : ${fake.email()}\n` }, 'README.md:1  email  adresse e-mail'],
  ['assets-check', { 'sources/decor.blend': BINARY }, 'sources/decor.blend  extension-interdite  fichier « .blend »'],
  ['audio-check', { 'src/audio/engine/voice.ts': 'ctx.createOscillator();\n' }, 'src/audio/engine/voice.ts:1  synthese  « createOscillator »'],
];

describe('cli — code de sortie et affichage', () => {
  const tree = useTempTrees();

  it.each(TOOLS)('%s : code 0 sur un arbre sain, et dit ce qui reste hors contrôle', (tool) => {
    const { code, out } = run(tool, '--root', tree(CLEAN));
    expect(code).toBe(0);
    expect(out).toContain('non contrôlé à ce jalon : ');
    expect(out.trimEnd()).toMatch(/Bilan : 0 erreur, 0 avertissement, \d+ notes — OK$/);
  });

  it.each(VIOLATIONS)('%s : code 1 et une ligne « chemin:ligne  règle  message » dès qu’une règle est enfreinte', (tool, files, expected) => {
    const { code, out } = run(tool, '--root', tree(files));
    expect(code).toBe(1);
    expect(out).toContain('Erreurs (1)');
    expect(out.split('\n').filter((line) => line.startsWith(expected))).toHaveLength(1);
    expect(out.trimEnd()).toMatch(/Bilan : 1 erreur, 0 avertissement, \d+ notes — ÉCHEC$/);
  });

  it('--json : les mêmes constats, en sortie machine', () => {
    const { code, out } = run('guard', '--json', '--root', tree({ 'README.md': `Contact : ${fake.email()}\n` }));
    expect(code).toBe(1);
    const report = JSON.parse(out) as { tool: string; ok: boolean; errors: unknown[]; warnings: unknown[]; notes: Array<{ rule: string }> };
    expect(report.tool).toBe('guard');
    expect(report.ok).toBe(false);
    expect(report.errors).toEqual([{ file: 'README.md', line: 1, rule: 'email', message: 'adresse e-mail « p…@atelier-fictif.fr »' }]);
    expect(report.warnings).toEqual([]);
    expect(report.notes.map((note) => note.rule)).toContain('non-controle');
  });

  it.each(TOOLS)('%s --json : ok vaut vrai et le code 0 sur un arbre sain', (tool) => {
    const { code, out } = run(tool, `--root=${tree(CLEAN)}`, '--json');
    const report = JSON.parse(out) as { tool: string; ok: boolean; errors: unknown[] };
    expect(code).toBe(0);
    expect(report).toMatchObject({ tool, ok: true, errors: [] });
  });

  const misuses: Array<[string, string[], string]> = [
    ['un argument inconnu', ['--inconnu'], 'argument inconnu : --inconnu'],
    ['une option sans sa valeur', ['--root'], "l'option --root attend une valeur"],
    ['une valeur donnée à une option qui n’en prend pas', ['--json=oui'], "l'option --json ne prend pas de valeur"],
    ['une racine introuvable', ['--root', join(TOOLS_DIR, 'dossier-absent')], 'racine introuvable'],
  ];

  it.each(misuses)('code 2 et rappel de l’usage pour %s', (_label, args, expected) => {
    const { code, out, err } = run('assets-check', ...args);
    expect(code).toBe(2);
    expect(out).toBe('');
    expect(err).toContain(`assets-check : ${expected}`);
    expect(err).toContain('Usage : node tools/assets-check.mjs [options]');
  });

  it('--help : affiche l’usage sans rien contrôler', () => {
    const { code, out } = run('guard', '--help');
    expect(code).toBe(0);
    expect(out).toContain('Usage : node tools/guard.mjs [options]');
    expect(out).toContain('--add-brand');
    expect(out).toContain('Codes de sortie : 0 aucune erreur, 1 règle enfreinte, 2 mauvais usage ou erreur inattendue.');
  });
});

describe('cli — guard --add-brand', () => {
  const tree = useTempTrees();
  const shipped = join(TOOLS_DIR, 'guard-brands.sha256');

  it('ajoute l’empreinte d’un terme à la liste donnée, puis le garde le trouve dans l’app', () => {
    const before = readFileSync(shipped, 'utf8');
    const list = join(tree(), 'marques.sha256');

    const added = run('guard', '--brands', list, '--add-brand', 'Xqzorbl', '--add-brand=Vlimpf Krabouille');
    expect(added.code).toBe(0);
    expect(added.out).toContain('empreinte ajoutée');
    expect(added.out).toContain('2 empreintes dans');
    expect(readFileSync(list, 'utf8').toLowerCase()).not.toContain('xqz');

    const again = run('guard', '--brands', list, '--add-brand', 'XQZORBL');
    expect(again.code).toBe(0);
    expect(again.out).toContain('déjà dans la liste');
    expect(again.out).toContain('2 empreintes dans');

    const root = tree({ 'src/data/catalog.ts': "export const wheels = [{ id: 'xqzorbl8' }];\n" });
    const found = run('guard', '--brands', list, '--root', root);
    expect(found.code).toBe(1);
    expect(found.out).toContain('src/data/catalog.ts:1  marque  nom de marque « xqzorbl »');

    // La liste livrée ne connaît pas ce terme inventé, et la commande ne l'a pas touchée.
    expect(run('guard', '--root', root).code).toBe(0);
    expect(readFileSync(shipped, 'utf8')).toBe(before);
  });

  it('refuse une liste introuvable ou un terme inutilisable', () => {
    const missing = run('guard', '--brands', join(tree(), 'absente.sha256'), '--root', tree(CLEAN));
    expect(missing.code).toBe(2);
    expect(missing.err).toContain("liste d'empreintes introuvable");

    const list = join(tree(), 'marques.sha256');
    const rejected = run('guard', '--brands', list, '--add-brand', 'xq');
    expect(rejected.code).toBe(2);
    expect(rejected.err).toContain('terme refusé');
    expect(existsSync(list)).toBe(false);
  });
});

describe('cli — lecture de la ligne de commande', () => {
  const spec = { flags: ['--json'], values: ['--root', '--add-brand'] };

  it('lit les options avec ou sans signe égal, et garde toutes les valeurs', () => {
    const args = parseArgs(['--json', '--root', 'a', '--add-brand=un', '--add-brand', 'deux', '--root=b'], spec);
    expect([...args.flags]).toEqual(['--json']);
    expect(args.values.get('--root')).toEqual(['a', 'b']);
    expect(args.values.get('--add-brand')).toEqual(['un', 'deux']);
  });

  it('refuse ce qu’elle ne connaît pas', () => {
    expect(() => parseArgs(['--nimporte'], spec)).toThrow(UsageError);
    expect(() => parseArgs(['--root'], spec)).toThrow(/attend une valeur/);
    expect(() => parseArgs(['--root='], spec)).toThrow(/attend une valeur/);
    expect(() => parseArgs(['--json=1'], spec)).toThrow(/ne prend pas de valeur/);
  });
});

describe('socle — parcours de l’arbre et lecture des fichiers', () => {
  const tree = useTempTrees();

  it.skipIf(process.platform === 'win32')('ignore les dossiers de dépendances, de build et de test, sans suivre les liens', () => {
    const outside = tree({ 'ailleurs.txt': 'hors de l’arbre\n' });
    const root = tree({
      'README.md': 'x',
      'src/main.ts': 'x',
      'src/captures/vue.ts': 'x',
      'src/node_modules/paquet/index.js': 'x',
      'node_modules/paquet/index.js': 'x',
      '.git/HEAD': 'x',
      '.github/workflows/ci.yml': 'x',
      'dist/index.html': 'x',
      'dev-dist/sw.js': 'x',
      'test-results/trace.txt': 'x',
      'playwright-report/index.html': 'x',
      'captures/garage.txt': 'x',
      'coverage/lcov.info': 'x',
      '.private-assets/notes.txt': 'x',
    });
    const target = join('..', basename(outside));
    symlinkSync(target, join(root, 'lien'));

    const walked = walkTree(root);
    expect(walked.files.map((file) => file.rel)).toEqual(['.github/workflows/ci.yml', 'README.md', 'src/captures/vue.ts', 'src/main.ts']);
    expect(walked.links).toEqual([{ rel: 'lien', target }]);
    // Les règles qui visent le build le lisent explicitement.
    expect(walkTree(root, { start: 'dist', ignore: false }).files.map((file) => file.rel)).toEqual(['dist/index.html']);
    expect(walkTree(root, { start: 'absent' })).toEqual({ files: [], links: [] });
  });

  it('lit le texte et reconnaît un binaire à son octet nul', () => {
    const root = tree({
      'texte.md': 'Été à l’atelier\n',
      'marque-utf8.txt': new Uint8Array([0xef, 0xbb, 0xbf, 0x61]),
      'utf16.txt': new Uint8Array([0xff, 0xfe, 0x61, 0x00, 0x62, 0x00]),
      'modele.glb': BINARY,
      'vide.txt': '',
    });
    expect(readTextFile(join(root, 'texte.md'))).toBe('Été à l’atelier\n');
    expect(readTextFile(join(root, 'marque-utf8.txt'))).toBe('a');
    expect(readTextFile(join(root, 'utf16.txt'))).toBe('ab');
    expect(readTextFile(join(root, 'modele.glb'))).toBeNull();
    expect(readTextFile(join(root, 'vide.txt'))).toBe('');
  });

  it('analyse le JSON et retrouve la ligne de l’erreur quand le moteur la donne', () => {
    expect(parseJson('{ "id": "demo" }')).toEqual({ ok: true, value: { id: 'demo' } });

    const broken = parseJson('{\n  "id": "demo",\n  "name": \n}');
    expect(broken.ok).toBe(false);
    if (!broken.ok) {
      expect(broken.message).not.toBe('');
      expect([0, 4]).toContain(broken.line);
    }
    expect([0, 2, 4].map((index) => lineNumberAt('a\nb\nc', index))).toEqual([1, 2, 3]);
  });
});

describe('socle — mise en forme du rapport', () => {
  it('écrit une ligne par constat, puis le bilan', () => {
    const report = createReport();
    report.errors.push(finding('src/a.ts', 3, 'regle', 'message'));
    report.warnings.push(finding('public/b.svg', 0, 'autre', 'fichier entier'));
    report.notes.push(notChecked('le reste'));

    expect(formatFinding(finding('src/a.ts', 3, 'regle', 'message'))).toBe('src/a.ts:3  regle  message');
    expect(formatReport('titre', report).split('\n')).toEqual([
      'titre',
      '',
      'Erreurs (1)',
      'src/a.ts:3  regle  message',
      '',
      'Avertissements (1)',
      'public/b.svg  autre  fichier entier',
      '',
      'Notes (1)',
      '(dépôt)  non-controle  non contrôlé à ce jalon : le reste',
      '',
      'Bilan : 1 erreur, 1 avertissement, 1 note — ÉCHEC',
    ]);
    expect(formatReport('titre', createReport())).toBe('titre\n\nBilan : 0 erreur, 0 avertissement, 0 note — OK');
  });
});
