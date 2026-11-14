// Garde, règle c : données personnelles et identifiants, dans tous les fichiers texte du dépôt.
// Toutes les valeurs sensibles sont inventées et fabriquées à l'exécution (voir helpers.ts) :
// écrites en clair ici, le garde les signalerait dans ce dépôt.
import { symlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { walkTree } from '../../../tools/lib/fs-walk.mjs';
import { LINE_RULES, parseDirective, runGuard } from '../../../tools/lib/guard.mjs';
import { findHomePaths, scanLineForSecrets, SECRET_RULES } from '../../../tools/lib/secrets.mjs';
import { readTextFile, splitLines } from '../../../tools/lib/text.mjs';
import { BINARY, fake, hashesOf, located, useTempTrees } from './helpers.ts';

const brandHashes = hashesOf('Xqzorbl');
const rulesIn = (line: string, skip?: ReadonlySet<string>) => scanLineForSecrets(line, skip).map((hit) => hit.rule);

const BLOCK = 'a1B2c3D4e5';
const DASHES = '-'.repeat(5);

/** Clés d'API inventées, fabriquées à l'exécution comme les données de helpers.ts. */
const fakeKey = {
  cloud: () => ['AI', 'za'].join('') + BLOCK.repeat(3) + 'fGhIj',
  chat: () => `${['xo', 'xb'].join('')}-${BLOCK.repeat(2)}`,
  payment: () => ['sk', 'live', ''].join('_') + BLOCK.repeat(2),
  prefixed: () => ['sk', BLOCK.repeat(4)].join('-'),
  registry: () => ['npm', ''].join('_') + BLOCK.repeat(3) + 'f6G7h8',
  signed: () => [['ey', 'JhbGciOiJIUzI1NiJ9'].join(''), ['ey', 'JzdWIiOiJiaWNob24ifQ'].join(''), 'c2lnbmF0dXJl'].join('.'),
  registryLine: (value = `${BLOCK}f6`) => `//registre.example.test/:${['_auth', 'Token'].join('')}=${value}`,
};

describe('guard — données personnelles et identifiants, ligne par ligne', () => {
  it('connaît sept règles, toutes ouvertes aux exceptions', () => {
    expect([...SECRET_RULES]).toEqual(['email', 'telephone', 'plaque', 'chemin-perso', 'cle-privee', 'jeton-forge', 'cle-api']);
    expect([...LINE_RULES]).toEqual(['url-tierce', 'marque', ...SECRET_RULES]);
  });

  it.each([
    ['email', 'une adresse e-mail', `Contact : ${fake.email()}`],
    ['email', 'une adresse dans un lien', `<a href="mailto:${fake.email('bichon', 'garage-fictif.org')}">écrire</a>`],
    ['telephone', 'un numéro en paires espacées', `Tél. ${fake.phone()}`],
    ['telephone', 'un numéro en paires pointées', `tel: "${fake.phone('.')}"`],
    ['telephone', 'un numéro en paires à tirets', fake.phone('-')],
    ['telephone', 'un numéro d’un seul tenant', `const tel = '${fake.phone('')}';`],
    ['telephone', 'un numéro au format international', `(${fake.internationalPhone()})`],
    ['plaque', 'une plaque au format en vigueur', `immatriculation ${fake.plate()}`],
    ['plaque', 'une plaque à l’ancien format', `plaque : ${fake.formerPlate()}.`],
    ['chemin-perso', 'un dossier personnel sous Linux', `cd ${fake.homePath()}`],
    ['chemin-perso', 'un dossier personnel sous macOS', `"cwd": "${fake.homePath('Users')}"`],
    ['chemin-perso', 'un dossier personnel sous Windows', fake.windowsHomePath()],
    ['cle-privee', 'une clé privée RSA', fake.pemHeader()],
    ['cle-privee', 'une clé privée sans algorithme', fake.pemHeader('PRIVATE')],
    ['cle-privee', 'une clé privée OpenSSH', fake.pemHeader('OPENSSH PRIVATE')],
    ['jeton-forge', 'un jeton d’accès classique', `token: ${fake.githubToken()}`],
    ['jeton-forge', 'un jeton d’accès à portée fine', fake.fineGrainedGithubToken()],
    ['jeton-forge', 'un jeton d’une autre forge', `export TOKEN=${fake.gitlabToken()}`],
    ['cle-api', 'une clé d’accès d’hébergeur', `"${fake.awsKey()}"`],
    ['cle-api', 'une clé d’API à préfixe connu', `key=${fakeKey.cloud()}`],
    ['cle-api', 'un jeton de messagerie', fakeKey.chat()],
    ['cle-api', 'une clé secrète de paiement', fakeKey.payment()],
    ['cle-api', 'une clé à préfixe court', `Bearer ${fakeKey.prefixed()}`],
    ['cle-api', 'un jeton de registre de paquets', fakeKey.registry()],
    ['cle-api', 'un jeton signé', `Authorization: Bearer ${fakeKey.signed()}`],
    ['cle-api', 'un jeton écrit dans un fichier de registre', fakeKey.registryLine()],
    ['cle-api', 'une valeur aléatoire affectée à une clé', fake.assignedSecret()],
    ['cle-api', 'une valeur aléatoire affectée à un mot de passe', fake.assignedSecret('password')],
  ])('%s : refuse %s', (rule, _label, line) => {
    expect(rulesIn(line)).toEqual([rule]);
  });

  it.each([
    ['une adresse d’exemple', fake.email('contact', 'example.com')],
    ['un sous-domaine d’exemple', fake.email('a.b', 'sous.example.org')],
    ['une extension réservée aux essais', `${fake.email('essai', 'atelier.test')} ${fake.email('personne', 'nulle-part.invalid')}`],
    ['un expéditeur automatique', `From: Atelier <${fake.email('noreply', 'atelier-fictif.fr')}>`],
    ['un compte technique de forge', `${fake.email('git', 'forge-fictive.fr')}:compte/depot.git`],
    ['un nom de fichier à double densité', 'background: url("./icone@2x.png");'],
    ['un paquet et sa version', '"three@0.187.0", "@react-three/fiber@9.8.2"'],
    ['une annotation', '/** @param {string} nom @returns {void} */ @media (min-width: 600px) {}'],
    ['un nombre décimal ou un long identifiant', 'const ratio = 0.612345678; const id = 20261114093000;'],
    ['l’alphabet des chiffres', "const DIGITS = '0123456789';"],
    ['une suite de paires plus longue qu’un numéro', 'M 01 02 03 04 05 06 07'],
    ['une référence qui ressemble à une plaque', 'AB-123-CDE XAB-123-CD ab-123-cd AB-1234-CD'],
    ['une suite qui ressemble à une ancienne plaque', '12345 AB 67, 1234 ab 56, 1234 ABCD 56'],
    ['le gabarit d’un dossier personnel', 'chemins /home/<nom>/ et /Users/<nom>/, ou ~/projets'],
    ['un compte générique', '/home/runner/work /Users/Shared/modeles C:\\Users\\Public\\Documents'],
    ['un chemin d’URL', 'voir site.example.test/home/page et ./home/bichon'],
    ['une clé publique ou un certificat', `${fake.pemHeader('PUBLIC')} ${DASHES}BEGIN CERTIFICATE${DASHES}`],
    ['un préfixe de jeton sans jeton', 'ghp_court glpat-court github_pat_court AKIACOURT sk-court npm_court'],
    ['une valeur lisible affectée à un nom sensible', 'const apiKey = "reglages-atelier-v1-defaut"; const secret = process.env.SECRET;'],
    ['une variable d’environnement dans un fichier de registre', fakeKey.registryLine('${NPM_TOKEN}')],
    ['une ligne vide', ''],
  ])('laisse passer %s', (_label, line) => {
    expect(rulesIn(line)).toEqual([]);
  });

  it('signale chaque occurrence, dans l’ordre des règles', () => {
    expect(rulesIn(`${fake.email()} ; ${fake.email('autre', 'garage-fictif.org')}`)).toEqual(['email', 'email']);
    expect(rulesIn(`${fake.email()} ${fake.phone()} ${fake.plate()}`)).toEqual(['email', 'telephone', 'plaque']);
  });

  it('n’applique pas une règle écartée pour un fichier', () => {
    const line = `${fake.email()} ${fake.phone()}`;
    expect(rulesIn(line)).toEqual(['email', 'telephone']);
    expect(rulesIn(line, new Set(['email']))).toEqual(['telephone']);
  });

  it('ne recopie jamais la valeur trouvée en entier dans le message', () => {
    const values = [fake.email(), fake.phone(), fake.plate(), fake.formerPlate(), fake.homePath(), fake.githubToken(), fake.awsKey()];
    for (const value of values) {
      const hits = scanLineForSecrets(`valeur : ${value}`);
      expect(hits).toHaveLength(1);
      expect(hits[0]?.message).not.toContain(value);
    }
    expect(scanLineForSecrets(fake.email())[0]?.message).toBe('adresse e-mail « p…@atelier-fictif.fr »');
    expect(findHomePaths(fake.homePath())).toEqual(['chemin de dossier personnel « /home/b… »']);
    expect(findHomePaths('../modeles/garage')).toEqual([]);
  });
});

describe('guard — données personnelles et identifiants dans le dépôt', () => {
  const tree = useTempTrees();

  it('contrôle tous les fichiers texte du dépôt, pas seulement l’app', () => {
    const root = tree({
      'README.md': `Contact : ${fake.email()}\n`,
      'docs/notes.md': `Atelier\nAppelle le ${fake.phone()}\n`,
      'proto/index.html': `<p>${fake.plate()}</p>\n`,
      'tools/outil.mjs': `const cache = '${fake.homePath()}';\n`,
      'tests/unit/cle.test.ts': `// rien\n// rien\n${fake.pemHeader()}\n`,
      '.github/workflows/deploy.yml': `env:\n  TOKEN: ${fake.githubToken()}\n`,
      'src/app/config.ts': `${fake.assignedSecret()}\n`,
    });
    expect(located(runGuard({ root, brandHashes }).errors)).toEqual([
      '.github/workflows/deploy.yml:2 jeton-forge',
      'README.md:1 email',
      'docs/notes.md:2 telephone',
      'proto/index.html:1 plaque',
      'src/app/config.ts:1 cle-api',
      'tests/unit/cle.test.ts:3 cle-privee',
      'tools/outil.mjs:1 chemin-perso',
    ]);
  });

  it('ne lit ni les dossiers ignorés ni les fichiers binaires', () => {
    const line = `${fake.email()} ${fake.phone()}\n`;
    const root = tree({
      'node_modules/paquet/index.js': line,
      'src/node_modules/paquet/index.js': line,
      '.git/config': line,
      'dist/assets/a.js': line,
      'dev-dist/sw.js': line,
      'test-results/trace.txt': line,
      'playwright-report/index.html': line,
      'captures/notes.txt': line,
      'coverage/lcov.info': line,
      '.private-assets/LISEZMOI.md': line,
      'public/assets/vehicles/demo/body.glb': new Uint8Array([...BINARY, ...Buffer.from(line)]),
      // Un dossier du même nom rangé plus bas dans l'arbre reste contrôlé.
      'docs/captures/notes.md': line,
    });
    expect(located(runGuard({ root, brandHashes }).errors)).toEqual([
      'docs/captures/notes.md:1 email',
      'docs/captures/notes.md:1 telephone',
    ]);
  });

  it('n’applique pas la règle « email » aux fichiers de verrouillage, mais y cherche les identifiants', () => {
    const root = tree({
      'package-lock.json': `{\n  "deprecated": "écrire à ${fake.email()}",\n  "token": "${fake.githubToken()}"\n}\n`,
    });
    const report = runGuard({ root, brandHashes });
    expect(located(report.errors)).toEqual(['package-lock.json:3 jeton-forge']);
    expect(located(report.notes)).toContain('package-lock.json:0 perimetre');
  });

  it.skipIf(process.platform === 'win32')('ne suit pas les liens symboliques, mais contrôle leur cible', () => {
    const outside = tree({ 'contact.md': `${fake.email()}\n` });
    const root = tree({ 'README.md': 'Atelier\n' });
    symlinkSync(join('..', basename(outside)), join(root, 'voisin'));
    symlinkSync(fake.homePath(), join(root, 'modeles'));

    const report = runGuard({ root, brandHashes });
    expect(located(report.errors)).toEqual(['modeles:0 chemin-perso']);
    expect(report.errors[0]?.message).toContain('cible du lien symbolique');
    expect(located(report.notes)).toEqual(expect.arrayContaining(['modeles:0 perimetre', 'voisin:0 perimetre']));
  });
});

describe('guard — exceptions', () => {
  const tree = useTempTrees();

  it.each([
    ['email', 'src/ui/Contact.tsx', fake.ignore('email', 'adresse de contact publique du projet'), `export const CONTACT = '${fake.email()}';`],
    ['telephone', '.github/workflows/ci.yml', `  ${fake.ignore('telephone', 'numéro fictif d’un jeu d’essai', '#')}`, `  numero: "${fake.phone()}"`],
    ['plaque', 'docs/notes.md', `${fake.ignore('plaque', 'référence de pièce, pas une immatriculation', '<!--')} -->`, `Pièce ${fake.plate()}`],
    ['chemin-perso', 'src/app/styles.css', `${fake.ignore('chemin-perso', 'exemple de la documentation', '/*')} */`, `/* ${fake.homePath()} */`],
    ['cle-api', 'tools/outil.mjs', ` ${fake.ignore('cle-api', 'valeur de démonstration, sans effet', '*')}`, fake.assignedSecret()],
  ])('accepte une exception motivée pour la règle %s, et la rend visible', (rule, file, directive, line) => {
    const root = tree({ [file]: `${directive}\n${line}\n` });
    const report = runGuard({ root, brandHashes });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(located(report.notes)).toContain(`${file}:1 exception`);
    expect(report.notes.find((note) => note.rule === 'exception')?.message).toContain(`« ${rule} »`);
  });

  it.each([
    ['sans raison', fake.ignore('email', ''), 'la raison est obligatoire'],
    ['dont la raison ne dit rien', fake.ignore('email', '…'), 'la raison est obligatoire'],
    ['sans deux-points', fake.ignore('email', '').replace(/\s*:\s*$/, ''), 'mal formée'],
    ['pour une règle inconnue', fake.ignore('secret', 'parce que'), 'règle « secret » inconnue'],
  ])('refuse une exception %s : le constat reste une erreur', (_label, directive, expected) => {
    const root = tree({ 'README.md': `${directive}\nContact : ${fake.email()}\n` });
    const report = runGuard({ root, brandHashes });
    expect(located(report.errors)).toEqual(['README.md:1 exception', 'README.md:2 email']);
    expect(report.errors[0]?.message).toContain(expected);
  });

  it('ne couvre que la règle nommée, et que la ligne suivante', () => {
    const root = tree({
      'README.md': [
        fake.ignore('telephone', 'numéro du standard, déjà public'),
        `Contact : ${fake.email()}`,
        '',
        fake.ignore('email', 'adresse de contact publique'),
        `Contact : ${fake.email()}`,
        `Autre contact : ${fake.email('autre')}`,
        fake.ignore('email', 'adresse de contact publique'),
        '',
        `Dernier contact : ${fake.email('dernier')}`,
      ].join('\n'),
    });
    const report = runGuard({ root, brandHashes });
    expect(located(report.errors)).toEqual(['README.md:2 email', 'README.md:6 email', 'README.md:9 email']);
    expect(located(report.warnings)).toEqual(['README.md:1 exception-inutile', 'README.md:7 exception-inutile']);
    expect(located(report.notes)).toContain('README.md:4 exception');
  });

  it('empile plusieurs exceptions pour une même ligne', () => {
    const root = tree({
      'docs/contact.md': [
        `${fake.ignore('email', 'adresse de contact publique', '<!--')} -->`,
        `${fake.ignore('telephone', 'numéro du standard, déjà public', '<!--')} -->`,
        `${fake.email()} — ${fake.phone()}`,
      ].join('\n'),
    });
    const report = runGuard({ root, brandHashes });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(located(report.notes).filter((item) => item.endsWith(' exception'))).toEqual([
      'docs/contact.md:1 exception',
      'docs/contact.md:2 exception',
    ]);
  });

  it('contrôle aussi la ligne de l’exception, et ignore une directive citée dans une phrase', () => {
    const root = tree({
      'README.md': [
        fake.ignore('email', `écrire à ${fake.email()}`),
        `Contact : ${fake.email()}`,
        `Pose ${fake.ignore('email', 'raison')} avant la ligne.`,
        `Contact : ${fake.email()}`,
      ].join('\n'),
    });
    expect(located(runGuard({ root, brandHashes }).errors)).toEqual(['README.md:1 email', 'README.md:4 email']);
  });

  it('lit la règle et la raison, quel que soit le style de commentaire', () => {
    const styles = [
      ['//', ''],
      ['#', ''],
      ['/*', ' */'],
      ['*', ''],
      ['<!--', ' -->'],
      ['{/*', ' */}'],
    ] as const;
    for (const [open, close] of styles) {
      const line = `  ${fake.ignore('plaque', 'référence de pièce', open)}${close}`;
      expect(parseDirective(line), line).toEqual({ rule: 'plaque', reason: 'référence de pièce' });
    }
    expect(parseDirective('const a = 1; // rien')).toBeNull();
    expect(parseDirective(`texte ${fake.ignore('plaque', 'raison')}`)).toBeNull();
    // Le gabarit des modes d'emploi n'est ni une exception ni une erreur.
    expect(parseDirective(fake.ignore('<règle>', '<raison>'))).toBeNull();
  });
});

describe('guard — le garde ne se reconnaît pas lui-même', () => {
  it('ne trouve aucune donnée sensible dans ses sources, ses tests ni son mode d’emploi', () => {
    const repo = fileURLToPath(new URL('../../../', import.meta.url));
    const scripts = ['tools/guard.mjs', 'tools/assets-check.mjs', 'tools/audio-check.mjs', 'tools/README.md'];
    const own = (rel: string) => rel.startsWith('tools/lib/') || rel.startsWith('tests/unit/tools/') || scripts.includes(rel);
    const files = [...walkTree(repo, { start: 'tools' }).files, ...walkTree(repo, { start: 'tests/unit/tools' }).files].filter(
      (file) => own(file.rel),
    );

    const hits = files.flatMap((file) =>
      splitLines(readTextFile(file.abs) ?? '').flatMap((line, index) =>
        scanLineForSecrets(line).map((hit) => `${file.rel}:${index + 1} ${hit.rule}`),
      ),
    );
    expect(hits).toEqual([]);
    expect(files.length).toBeGreaterThanOrEqual(20);
  });
});
