// Garde, règle a : aucune requête vers un tiers à l'exécution (§ 7 et § 15 du cahier des charges).
import { describe, expect, it } from 'vitest';
import { runGuard } from '../../../tools/lib/guard.mjs';
import { findUrls, isXmlNamespace, runtimeCdnCategory, scanLineForUrls } from '../../../tools/lib/third-party.mjs';
import { BINARY, fake, hashesOf, located, useTempTrees } from './helpers.ts';

const brandHashes = hashesOf('Xqzorbl');

describe('guard — URL absolues dans le code de l’app', () => {
  const tree = useTempTrees();

  it('laisse passer les chemins relatifs, les espaces de noms XML et les faux amis', () => {
    const root = tree({
      'index.html': [
        '<!doctype html>',
        '<html lang="fr">',
        '  <head><link rel="icon" href="%BASE_URL%icons/favicon.svg" type="image/svg+xml" /></head>',
        '  <body><script type="module" src="/src/main.tsx"></script></body>',
        '</html>',
      ].join('\n'),
      'src/livery/svg.ts': [
        "const SVG_NS = 'http://www.w3.org/2000/svg';",
        "const XLINK_NS = 'http://www.w3.org/1999/xlink';",
        "export const path = document.createElementNS(SVG_NS, 'path');",
        "export const model = new URL('./assets/vehicles/demo/body.glb', import.meta.url);",
        "export const isWeb = (value: string) => value.startsWith('https://') || value.startsWith('http://');",
        'export const pattern = /^https?:\\/\\//;',
        '// lien de build : https://…/#b=<code>',
        '//console.log(path.namespaceURI)',
        'export const share = `${location.origin}${location.pathname}#b=${encodeURIComponent(XLINK_NS)}`;',
      ].join('\n'),
      'src/app/styles.css': [
        '.logo { background: url("./logo.svg"); }',
        ".mask { mask: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E%3C/svg%3E\"); }",
        '.mask2 { mask: url("data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22%3E%3C/svg%3E"); }',
      ].join('\n'),
      'public/assets/stickers/flamme.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 8 8"><path d="M0 0h8v8z"/></svg>',
      'public/icons/icone.png': BINARY,
    });
    const report = runGuard({ root, brandHashes });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it.each([
    ['une URL https', "fetch('https://api.example.test/v1/builds');"],
    ['une URL http', 'const cdn = "http://cdn.example.test/three.min.js";'],
    ['un WebSocket', "new WebSocket('wss://direct.example.test/socket');"],
    ['une URL sans schéma dans une chaîne', "const script = '//cdn.example.test/lib.js';"],
    ['une URL sans schéma dans du CSS', '@font-face { src: url(//polices.example.test/x.woff2); }'],
    ['un hôte calculé', 'const url = `https://${host}/api`;'],
    ['des barres échappées', 'const json = \'{"u":"https:\\/\\/cdn.example.test\\/x.js"}\';'],
    ['un espace de noms prolongé en adresse', "fetch('http://www.w3.org/2000/svg/sprite.svg');"],
    ['une image externe dans une URI de données', '.a { mask: url("data:image/svg+xml,%3Cimage href=%22https://images.example.test/a.png%22/%3E"); }'],
  ])('refuse %s dans src/', (_label, line) => {
    const root = tree({ 'src/app/reseau.ts': `// en-tête\n${line}\n` });
    const report = runGuard({ root, brandHashes });
    expect(located(report.errors)).toEqual(['src/app/reseau.ts:2 url-tierce']);
    expect(report.errors[0]?.message).toContain('URL absolue');
  });

  it('contrôle aussi index.html et les fichiers texte de public/', () => {
    const root = tree({
      'index.html': '<link rel="preconnect" href="https://polices.example.test" />\n<script src=//stats.example.test/t.js></script>',
      'public/assets/vehicles/demo/vehicle.json': '{\n  "id": "demo",\n  "glb": "https://modeles.example.test/demo.glb"\n}',
      'public/assets/stickers/logo.svg':
        '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://images.example.test/logo.png"/></svg>',
    });
    expect(located(runGuard({ root, brandHashes }).errors)).toEqual([
      'index.html:1 url-tierce',
      'index.html:2 url-tierce',
      'public/assets/stickers/logo.svg:1 url-tierce',
      'public/assets/vehicles/demo/vehicle.json:3 url-tierce',
    ]);
  });

  it('ne s’applique pas hors de l’app : documentation, prototype, outils et tests citent des URL', () => {
    const line = "fetch('https://api.example.test/v1');";
    const root = tree({
      'README.md': `Voir https://docs.example.test/guide\n`,
      'docs/notes.md': line,
      'proto/index.html': `<script src="https://cdn.example.test/three.min.js"></script>`,
      'tools/outil.mjs': line,
      'tests/unit/reseau.test.ts': line,
      'vite.config.ts': line,
    });
    expect(runGuard({ root, brandHashes }).errors).toEqual([]);
  });

  it('accepte une exception motivée sur la ligne précédente, et la rend visible', () => {
    const root = tree({
      'src/ui/Credits.tsx': [
        fake.ignore('url-tierce', 'texte de la licence affiché, jamais appelé'),
        "export const LICENCE = 'https://licences.example.test/by/4.0/';",
      ].join('\n'),
    });
    const report = runGuard({ root, brandHashes });
    expect(report.errors).toEqual([]);
    expect(located(report.notes)).toContain('src/ui/Credits.tsx:1 exception');
  });
});

describe('guard — lecture des URL', () => {
  it('extrait l’hôte, sans les identifiants de connexion ni le port', () => {
    expect(findUrls('a "https://Compte:secret@CDN.Example.test:8443/x.js" b')).toEqual([
      { index: 3, url: 'https://Compte:secret@CDN.Example.test:8443/x.js', host: 'cdn.example.test' },
    ]);
    expect(findUrls("url('//polices.example.test/a.woff2')")[0]?.host).toBe('polices.example.test');
    expect(findUrls('`https://${hote}/api`')[0]?.host).toBeNull();
  });

  it('ne prend pas un commentaire ni un préfixe nu pour une adresse', () => {
    expect(findUrls('//console.log(a.b)')).toEqual([]);
    expect(findUrls('foo() // voir docs.example.test')).toEqual([]);
    expect(findUrls("startsWith('https://')")).toEqual([]);
    expect(findUrls('lien : https://…/#b=<code>')).toEqual([]);
    expect(scanLineForUrls('const a = 1; // rien')).toEqual([]);
  });

  it('reconnaît les espaces de noms XML, et eux seuls', () => {
    expect(isXmlNamespace('http://www.w3.org/2000/svg')).toBe(true);
    expect(isXmlNamespace('http://www.w3.org/2000/svg%22%3E')).toBe(true);
    expect(isXmlNamespace('http://www.w3.org/2000/xmlns/')).toBe(true);
    expect(isXmlNamespace('http://www.w3.org/2000/svg/sprite.svg')).toBe(false);
    expect(isXmlNamespace('https://www.w3.org/TR/SVG2/')).toBe(false);
  });

  it('classe les hôtes de CDN par suffixe', () => {
    expect(runtimeCdnCategory('fonts.googleapis.com')).toBe('polices');
    expect(runtimeCdnCategory('www.gstatic.com')).toBe('décodeurs de géométrie et de textures');
    expect(runtimeCdnCategory('cdn.jsdelivr.net')).toBe('miroir de paquets npm');
    expect(runtimeCdnCategory('raw.githack.com')).toContain('HDR');
    expect(runtimeCdnCategory('react.dev')).toBeNull();
    expect(runtimeCdnCategory('pasgstatic.com')).toBeNull();
  });
});

describe('guard — hôtes externes dans le build', () => {
  const tree = useTempTrees();

  it('note l’absence de dist/ au lieu de se taire', () => {
    const report = runGuard({ root: tree({ 'src/main.ts': 'export {};\n' }), brandHashes });
    expect(report.errors).toEqual([]);
    expect(report.notes.map((note) => note.message).join('\n')).toContain('dist/ absent');
  });

  it('échoue sur les hôtes de CDN que les bibliothèques appellent d’elles-mêmes', () => {
    const root = tree({
      'dist/index.html': '<link href="https://fonts.googleapis.com/css2?family=X" rel="stylesheet">',
      'dist/assets/index-abc123.js': [
        'const draco="https://www.gstatic.com/draco/versioned/decoders/1.5.5/";',
        'const hdri="https://raw.githack.com/depot/assets/hdri/";const esm="https://cdn.jsdelivr.net/npm/x@1/+esm";',
      ].join('\n'),
    });
    const report = runGuard({ root, brandHashes });
    expect(located(report.errors)).toEqual([
      'dist/assets/index-abc123.js:1 hote-cdn',
      'dist/assets/index-abc123.js:2 hote-cdn',
      'dist/assets/index-abc123.js:2 hote-cdn',
      'dist/index.html:1 hote-cdn',
    ]);
    const messages = report.errors.map((error) => error.message).join('\n');
    expect(messages).toContain('« www.gstatic.com » (décodeurs de géométrie et de textures)');
    expect(messages).toContain('« fonts.googleapis.com » (polices)');
    expect(messages).toContain('« cdn.jsdelivr.net » (miroir de paquets npm)');
    expect(messages).toContain('« raw.githack.com »');
  });

  it('donne un avertissement par autre hôte, avec un fichier d’exemple', () => {
    const root = tree({
      'dist/assets/a.js': 'throw Error("voir https://docs.example.test/erreurs/1 et https://docs.example.test/erreurs/2")',
      'dist/assets/b.js': '/* https://docs.example.test/licence */ const ns="http://www.w3.org/2000/svg";',
      'dist/sw.js': 'console.warn("https://aide.example.test/precache")',
      'dist/assets/a.js.map': '{"sourcesContent":["https://cdn.jsdelivr.net/npm/elimine-par-le-build"]}',
      'dist/assets/police.woff2': BINARY,
    });
    const report = runGuard({ root, brandHashes });
    expect(report.errors).toEqual([]);
    expect(located(report.warnings)).toEqual(['dist/assets/a.js:1 hote-externe', 'dist/sw.js:1 hote-externe']);
    expect(report.warnings[0]?.message).toContain('« docs.example.test »');
    expect(report.warnings[0]?.message).toContain('3 occurrences dans 2 fichiers');
    expect(report.notes.map((note) => note.message).join('\n')).toContain('1 carte de sources ignorée');
  });

  it('ne lit dist/ pour aucune autre règle', () => {
    const root = tree({ 'dist/assets/a.js': `const contact = "${fake.email()}"; // Xqzorbl` });
    expect(runGuard({ root, brandHashes }).errors).toEqual([]);
  });
});
