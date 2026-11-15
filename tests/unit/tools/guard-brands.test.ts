// Garde, règle b : aucun nom de marque dans l'app. Les tests n'utilisent que des termes
// inventés, ajoutés à une liste temporaire : aucune vraie marque n'est écrite ici.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  addBrandTerm,
  brandForms,
  createBrandMatcher,
  hashForm,
  loadBrandHashes,
  parseHashList,
  rejectionReason,
  tokenize,
} from '../../../tools/lib/brands.mjs';
import { runGuard } from '../../../tools/lib/guard.mjs';
import { makeGlb } from './glb-fixture.ts';
import { BINARY, fake, hashesOf, located, messagesOf, useTempTrees } from './helpers.ts';

// Un mot, deux mots, trois mots, et un nom à majuscule interne.
const brandHashes = hashesOf('Xqzorbl', 'Vlimpf Krabouille', 'Trophée des Blorps', 'McZwörg');
const terms = (text: string) => createBrandMatcher(brandHashes)(text).map((hit) => hit.term);

describe('guard — découpage et normalisation des mots', () => {
  it('retire les accents, passe en minuscules et coupe aux frontières d’un identifiant', () => {
    expect(tokenize('Été à l’Atelier')).toEqual(['ete', 'a', 'l', 'atelier']);
    expect(tokenize('jantesXqzorbl8')).toEqual(['jantes', 'xqzorbl', '8']);
    expect(tokenize('XQZLogo vlimpf_krabouille')).toEqual(['xqz', 'logo', 'vlimpf', 'krabouille']);
    expect(tokenize('slot__option-2')).toEqual(['slot', 'option', '2']);
  });

  it('donne à un nom à majuscule interne ses deux écritures', () => {
    expect(brandForms('McZwörg')).toEqual(['mc zworg', 'mczworg']);
    expect(brandForms('Vlimpf-Krabouille')).toEqual(['vlimpf krabouille']);
    expect(brandForms('  XQZORBL  ')).toEqual(['xqzorbl']);
    expect(brandForms('?!')).toEqual([]);
  });

  it('ne découpe pas un bloc encodé en mots', () => {
    const blob = `QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVowMTIzNDU2Nzg5Xqzorbl0aGVxdWlja2Jyb3duZm94anVtcHNvdmVy`;
    expect(tokenize(`const data = "${blob}";`)).toEqual(['const', 'data']);
    // Un long chemin en minuscules n'est pas un bloc encodé : il reste contrôlé.
    expect(tokenize('public/assets/vehicles/demo/textures/carrosserie/xqzorbl_base_color_2048')).toContain('xqzorbl');
  });
});

describe('guard — recherche des termes interdits', () => {
  it.each([
    ['le mot seul', 'Jantes Xqzorbl en 17 pouces', ['xqzorbl']],
    ['en capitales', 'XQZORBL', ['xqzorbl']],
    ['avec des accents', 'un kit Xqzôrbl', ['xqzorbl']],
    ['après une élision', "l'Xqzorbl de Bichon", ['xqzorbl']],
    ['dans un identifiant', 'const xqzorblLogo = load();', ['xqzorbl']],
    ['suivi d’un chiffre', "{ id: 'xqzorbl8' }", ['xqzorbl']],
    ['deux mots', 'préparé par Vlimpf Krabouille', ['vlimpf krabouille']],
    ['deux mots avec un trait d’union', 'vlimpf-krabouille.svg', ['vlimpf krabouille']],
    ['deux mots collés en camelCase', 'vlimpfKrabouilleKit', ['vlimpf krabouille']],
    ['trois mots', 'vainqueur du TROPHÉE DES BLORPS 2004', ['trophee des blorps']],
    ['majuscule interne', 'un échappement McZwörg', ['mc zworg']],
    ['majuscule interne, tout en minuscules', 'mczworg', ['mczworg']],
    ['plusieurs termes sur une ligne', 'Xqzorbl contre Vlimpf Krabouille', ['xqzorbl', 'vlimpf krabouille']],
  ])('trouve %s', (_label, text, expected) => {
    expect(terms(text)).toEqual(expected);
  });

  it.each([
    ['un mot plus long', 'xqzorblade'],
    ['un mot qui le contient', 'superxqzorbl'],
    ['deux mots séparés par un autre', 'Vlimpf et Krabouille'],
    ['deux mots dans le désordre', 'Krabouille Vlimpf'],
    ['un texte sans rapport', 'Vert Bichon pailleté, jantes 8 branches, néons sous caisse'],
    ['une ligne vide', ''],
  ])('ne se déclenche pas sur %s', (_label, text) => {
    expect(terms(text)).toEqual([]);
  });

  it('ne signale qu’une fois un terme répété, et pas le mot contenu dans un terme plus long', () => {
    const hashes = hashesOf('Blorps', 'Trophée des Blorps');
    const match = createBrandMatcher(hashes);
    expect(match('Blorps, Blorps et encore Blorps').map((hit) => hit.term)).toEqual(['blorps']);
    expect(match('le Trophée des Blorps').map((hit) => hit.term)).toEqual(['trophee des blorps']);
    expect(match('le Trophée des Blorps')[0]?.hash).toBe(hashForm('trophee des blorps'));
  });
});

describe('guard — marques dans l’app', () => {
  const tree = useTempTrees();

  it('laisse passer une app sans marque', () => {
    const root = tree({
      'index.html': '<title>PimpMyBichon</title>',
      'src/data/catalog.ts': "export const wheels = [{ id: 'spoke8', label: '8 branches alu' }];\n",
      'public/assets/stickers/flammes-01.svg': '<svg xmlns="http://www.w3.org/2000/svg"><title>Flammes</title></svg>',
    });
    const report = runGuard({ root, brandHashes });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('refuse un terme interdit dans le code, les textes et les données de l’app', () => {
    const root = tree({
      'index.html': '<meta name="description" content="Mieux que le Trophée des Blorps" />',
      'src/data/catalog.ts': "// jantes\nexport const wheels = [{ id: 'xqzorbl8', label: 'Jantes Xqzorbl' }];\n",
      'src/ui/labels.ts': "export const SPONSOR = 'Vlimpf-Krabouille';\n",
      'public/assets/vehicles/demo/vehicle.json': '{\n  "id": "demo",\n  "name": "La McZwörg"\n}\n',
    });
    const report = runGuard({ root, brandHashes });
    expect(located(report.errors)).toEqual([
      'index.html:1 marque',
      'public/assets/vehicles/demo/vehicle.json:3 marque',
      'src/data/catalog.ts:2 marque',
      'src/ui/labels.ts:1 marque',
    ]);
    const message = report.errors[2]?.message ?? '';
    expect(message).toContain('« xqzorbl »');
    expect(message).toContain(hashForm('xqzorbl').slice(0, 12));
  });

  it('refuse un terme interdit dans un nom de fichier ou de dossier, une fois par nom', () => {
    const root = tree({
      'public/assets/stickers/xqzorbl.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'public/assets/vehicles/vlimpf-krabouille/vehicle.json': '{ "id": "demo" }',
      'public/assets/vehicles/vlimpf-krabouille/body.glb': BINARY,
      'src/scene/McZworgRig.tsx': 'export {};\n',
    });
    expect(located(runGuard({ root, brandHashes }).errors)).toEqual([
      'public/assets/stickers/xqzorbl.svg:0 marque',
      'public/assets/vehicles/vlimpf-krabouille:0 marque',
      'src/scene/McZworgRig.tsx:0 marque',
    ]);
  });

  it('contrôle aussi les dessins en attente (assets-src/), contenu et noms de fichiers', () => {
    const root = tree({
      'assets-src/stickers/index.json': '{\n  "label": "Huile Vlimpf-Krabouille"\n}\n',
      'assets-src/stickers/sponsors/xqzorbl.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
    });
    expect(located(runGuard({ root, brandHashes }).errors)).toEqual([
      'assets-src/stickers/index.json:2 marque',
      'assets-src/stickers/sponsors/xqzorbl.svg:0 marque',
    ]);
  });

  it('contrôle aussi les tests, les outils et la documentation, contenu et noms de fichiers', () => {
    const line = 'Une ligne propre, puis le Trophée des Blorps\n';
    const root = tree({
      'tests/unit/peinture.test.ts': `// rien\n// ${line}`,
      'tests/e2e/xqzorbl.spec.ts': 'export {};\n',
      'tools/vehicles/kit.mjs': `// ${line}`,
      'docs/DEPLOIEMENT.md': line,
    });
    expect(located(runGuard({ root, brandHashes }).errors)).toEqual([
      'docs/DEPLOIEMENT.md:1 marque',
      'tests/e2e/xqzorbl.spec.ts:0 marque',
      'tests/unit/peinture.test.ts:2 marque',
      'tools/vehicles/kit.mjs:1 marque',
    ]);
  });

  it('laisse hors de la règle le prototype, les documents de la racine et l’exception nommée', () => {
    const line = 'Xqzorbl, Vlimpf Krabouille et le Trophée des Blorps\n';
    const root = tree({
      'README.md': line,
      'docs/SOURCING_AUDIO.md': line,
      'proto/index.html': line,
      'CAHIER_DES_CHARGES.md': line,
    });
    const report = runGuard({ root, brandHashes });
    expect(report.errors).toEqual([]);
    expect(located(report.notes)).toContain('docs/SOURCING_AUDIO.md:0 exception');
  });

  it('lit les noms des nœuds, des matériaux et des maillages d’un GLB', () => {
    const clean = makeGlb({ meshes: [[{ indices: 3 }]], nodeNames: ['caisse'], materialNames: ['paint_carrosserie'] });
    const node = makeGlb({ meshes: [[{ indices: 3 }]], nodes: [0, 0], nodeNames: ['caisse', 'logo_xqzorbl'] });
    const material = makeGlb({ meshes: [[{ indices: 3 }]], materialNames: ['Chrome Vlimpf Krabouille'] });
    const root = tree({
      'public/assets/vehicles/propre/body.glb': clean,
      'public/assets/vehicles/demo/body.glb': node,
      'tests/fixtures/essai.glb': material,
      'proto/ancien.glb': node,
    });
    const report = runGuard({ root, brandHashes });
    expect(located(report.errors)).toEqual(['public/assets/vehicles/demo/body.glb:0 marque', 'tests/fixtures/essai.glb:0 marque']);
    expect(report.errors[0]?.message).toContain('« xqzorbl » dans le nom du nœud 1 du GLB');
    expect(report.errors[1]?.message).toContain('dans le nom du matériau 0 du GLB');
    expect(messagesOf(report.notes)).toContain('3 GLB dont les noms sont contrôlés');
  });

  it('passe sur un GLB illisible sans planter : assets-check le refuse', () => {
    const root = tree({ 'public/assets/vehicles/demo/body.glb': BINARY });
    expect(runGuard({ root, brandHashes }).errors).toEqual([]);
  });

  it('accepte une exception motivée, visible dans le rapport', () => {
    const root = tree({
      'src/ui/Credits.tsx': [
        fake.ignore('marque', 'nom de famille de l’auteur d’un sticker sous CC-BY, à créditer', '{/*') + ' */}',
        '<li>Flammes : A. Xqzorbl</li>',
        '<li>Volutes : B. Xqzorbl</li>',
      ].join('\n'),
    });
    const report = runGuard({ root, brandHashes });
    expect(located(report.errors)).toEqual(['src/ui/Credits.tsx:3 marque']);
    expect(located(report.notes)).toContain('src/ui/Credits.tsx:1 exception');
  });

  it('prévient quand la liste est vide : la règle ne contrôlerait rien', () => {
    const report = runGuard({ root: tree({ 'src/main.ts': 'export {};\n' }), brandHashes: new Set() });
    expect(located(report.warnings)).toEqual([':0 marque']);
  });
});

describe('guard — liste d’empreintes', () => {
  const tree = useTempTrees();

  it('ajoute les empreintes d’un terme sans jamais écrire le terme', () => {
    const file = join(tree(), 'marques.sha256');
    const result = addBrandTerm(file, 'McZwörg');
    expect(result.forms.map((item) => [item.form, item.status])).toEqual([
      ['mc zworg', 'added'],
      ['mczworg', 'added'],
    ]);
    expect(result.total).toBe(2);

    const content = readFileSync(file, 'utf8');
    expect(content.toLowerCase()).not.toContain('zw');
    expect(content.startsWith('#')).toBe(true);
    expect([...loadBrandHashes(file)].sort()).toEqual([hashForm('mc zworg'), hashForm('mczworg')].sort());
  });

  it('garde la liste triée, sans doublon, et conserve son en-tête', () => {
    const file = join(tree(), 'marques.sha256');
    for (const term of ['Xqzorbl', 'Vlimpf Krabouille', 'xqzorbl', 'XQZORBL', 'Trophée des Blorps']) addBrandTerm(file, term);
    expect(addBrandTerm(file, 'Xqzôrbl').forms).toEqual([
      { form: 'xqzorbl', hash: hashForm('xqzorbl'), status: 'present' },
    ]);

    const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
    const hashes = lines.filter((line) => !line.startsWith('#'));
    expect(lines[0]?.startsWith('# ')).toBe(true);
    expect(hashes).toEqual([...new Set(hashes)].sort());
    expect(hashes).toHaveLength(3);
  });

  it('refuse un terme que le scan ne pourrait pas trouver, ou trop ambigu', () => {
    const file = join(tree(), 'marques.sha256');
    expect(addBrandTerm(file, 'Grand Prix des Blorps Masqués').forms[0]?.status).toBe('rejected');
    expect(addBrandTerm(file, 'xq').forms[0]?.status).toBe('rejected');
    expect(addBrandTerm(file, '4040').forms[0]?.status).toBe('rejected');
    expect(existsSync(file)).toBe(false);

    expect(rejectionReason('a b c d')).toContain('4 mots');
    expect(rejectionReason('xq')).toContain('caractères');
    expect(rejectionReason('x 40')).toContain('deux lettres');
    expect(rejectionReason('xqz')).toBeNull();
    expect(rejectionReason('trophee des blorps')).toBeNull();
  });

  it('refuse un fichier d’empreintes abîmé plutôt que de l’ignorer', () => {
    expect([...parseHashList(`# commentaire\n\n${hashForm('xqzorbl')}\n`)]).toEqual([hashForm('xqzorbl')]);
    expect(() => parseHashList('xqzorbl\n')).toThrow(/ligne 1/);
    expect(() => parseHashList(`${hashForm('xqzorbl').toUpperCase()}\n`)).toThrow(/ligne 1/);

    const file = join(tree(), 'marques.sha256');
    writeFileSync(file, `${hashForm('xqzorbl')}\npas une empreinte\n`);
    expect(() => loadBrandHashes(file)).toThrow(/ligne 2/);
  });
});

describe('guard — liste livrée avec l’outil', () => {
  const file = fileURLToPath(new URL('../../../tools/guard-brands.sha256', import.meta.url));

  it('contient au moins 150 empreintes valides, triées et sans doublon', () => {
    const lines = readFileSync(file, 'utf8')
      .split('\n')
      .filter((line) => line !== '' && !line.startsWith('#'));
    expect(lines.length).toBeGreaterThanOrEqual(150);
    expect(lines.every((line) => /^[0-9a-f]{64}$/.test(line))).toBe(true);
    expect(lines).toEqual([...new Set(lines)].sort());
    expect(loadBrandHashes(file).size).toBe(lines.length);
  });

  it('ne contient aucun mot de l’app ni terme inventé pour les tests', () => {
    const match = createBrandMatcher(loadBrandHashes(file));
    const harmless = [
      'PimpMyBichon : l’atelier de Bichon, la Cox, le combi, le bobber, le fastback et la sportive',
      'Pimp my garage, sortie de nuit, néons sous caisse, flammes, chrome coloré, rat look',
      'const topGear = gears.length - 1; playStation(stationId); bounds.xMax = tMax * vMax;',
      'Xqzorbl, Vlimpf Krabouille, Trophée des Blorps, McZwörg',
    ];
    for (const text of harmless) expect(match(text)).toEqual([]);
  });
});
