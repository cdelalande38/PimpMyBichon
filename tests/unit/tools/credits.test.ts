// Lecture de CREDITS.md : tableau Markdown, motifs de chemins, licences admises. Elle sert à
// assets-check (tout public/assets/) et à audio-check (tout fichier audio sous public/).
import { describe, expect, it } from 'vitest';
import {
  ALLOWED_LICENSES,
  checkLicenseCoverage,
  isAllowedLicense,
  loadCredits,
  parseCredits,
  splitTableRow,
} from '../../../tools/lib/credits.mjs';
import { matchesPath } from '../../../tools/lib/glob.mjs';
import { creditsFile, located, useTempTrees } from './helpers.ts';

describe('CREDITS.md — licences admises', () => {
  it('reconnaît les quatre licences admises, quelle que soit leur écriture', () => {
    expect(ALLOWED_LICENSES).toEqual(['CC0-1.0', 'CC-BY-4.0', 'OFL-1.1', 'création projet']);
    const allowed = ['CC0-1.0', 'cc0 1.0', 'CC-BY-4.0', 'CC BY 4.0', 'OFL-1.1', 'création projet', 'Création projet', 'creation projet'];
    for (const license of allowed) expect(isAllowedLicense(license), license).toBe(true);
  });

  it('refuse tout le reste, y compris une licence admise accompagnée d’autre chose', () => {
    const refused = ['', 'CC0', 'CC-BY', 'CC-BY-NC-4.0', 'CC-BY-SA-4.0', 'CC-BY-4.0 ou plus', 'MIT', 'libre de droits'];
    for (const license of refused) expect(isAllowedLicense(license), license).toBe(false);
  });
});

describe('CREDITS.md — lecture du tableau', () => {
  const tree = useTempTrees();

  it('découpe une ligne de tableau en cellules', () => {
    expect(splitTableRow('| a | b |')).toEqual(['a', 'b']);
    expect(splitTableRow('a | b')).toEqual(['a', 'b']);
    expect(splitTableRow('| a \\| b | c |')).toEqual(['a | b', 'c']);
    expect(splitTableRow('| a | |')).toEqual(['a', '']);
    expect(splitTableRow('pas un tableau')).toBeNull();
  });

  it('lit le format du projet : ligne, motifs, licence', () => {
    const { rows, problems } = parseCredits(
      creditsFile(['public/icons/**', 'création projet'], ['@police/titre', 'OFL-1.1'], ['public/assets/music/**', 'CC-BY-NC-4.0']),
    );
    expect(problems).toEqual([]);
    expect(rows.map((row) => [row.line, row.patterns, row.license, row.allowed])).toEqual([
      [5, ['public/icons/**'], 'création projet', true],
      [6, ['@police/titre'], 'OFL-1.1', true],
      [7, ['public/assets/music/**'], 'CC-BY-NC-4.0', false],
    ]);
    expect(rows[0]?.covers('public/icons/pwa-192.png')).toBe(true);
    expect(rows[0]?.covers('public/assets/garage/sol.glb')).toBe(false);
  });

  it('lit de façon tolérante : ordre des colonnes libre, repérage par l’en-tête', () => {
    const markdown = [
      '# Crédits',
      '',
      'Licence | Auteur | Chemin',
      ':--- | :---: | ---:',
      '**CC0-1.0** | atelier | `public/assets/stickers/**`',
      '[CC BY 4.0](LICENCES/CC-BY-4.0.txt) | atelier | `public/assets/garage/sol.glb`, `public/assets/garage/mur.glb`',
      '',
      '## Polices',
      '',
      '| Motif | Note | License |',
      '|---|---|---|',
      '| `public/assets/fonts/*.woff2` | une barre \\| dans la note | ofl 1.1 |',
      '| `./public/assets/ui/` | | Création projet |',
      '',
      '```md',
      '| Fichier(s) | Licence |',
      '|---|---|',
      '| `public/assets/exemple/**` | CC0-1.0 |',
      '```',
      '<!-- | `public/assets/exemple/**` | CC0-1.0 | -->',
    ].join('\n');
    const credits = { present: true, ...parseCredits(markdown) };
    expect(credits.problems).toEqual([]);
    expect(credits.rows.map((row) => [row.line, row.license, row.allowed])).toEqual([
      [5, '**CC0-1.0**', true],
      [6, 'CC BY 4.0', true],
      [12, 'ofl 1.1', true],
      [13, 'Création projet', true],
    ]);

    const files = [
      'public/assets/stickers/flammes/flamme-01.svg',
      'public/assets/garage/sol.glb',
      'public/assets/garage/mur.glb',
      'public/assets/fonts/titre.woff2',
      'public/assets/ui/bouton.png',
      // Cité seulement dans un bloc de code et dans un commentaire : un exemple ne déclare rien.
      'public/assets/exemple/modele.glb',
    ];
    expect(located(checkLicenseCoverage({ files, credits, rule: 'licence' }).errors)).toEqual([
      'public/assets/exemple/modele.glb:0 licence',
    ]);
  });

  it('ignore un tableau sans colonne « Licence »', () => {
    const { rows, problems } = parseCredits(['| Bibliothèque | Version |', '|---|---|', '| `three` | 0.187.0 |'].join('\n'));
    expect(rows).toEqual([]);
    expect(problems).toEqual([]);
  });

  it('distingue un CREDITS.md absent d’un CREDITS.md sans tableau', () => {
    expect(loadCredits(tree())).toEqual({ present: false, rows: [], problems: [] });

    const empty = loadCredits(tree({ 'CREDITS.md': '# Crédits\n\nRien pour l’instant.\n' }));
    expect(empty).toEqual({ present: true, rows: [], problems: [] });
    expect(located(checkLicenseCoverage({ files: ['public/assets/a.svg'], credits: empty, rule: 'licence' }).errors)).toEqual([
      'public/assets/a.svg:0 licence',
    ]);
  });
});

describe('CREDITS.md — motifs de chemins', () => {
  it.each([
    ['public/assets/stickers/**', 'public/assets/stickers/flamme.svg', true],
    ['public/assets/stickers/**', 'public/assets/stickers/flammes/flamme-01.svg', true],
    ['public/assets/stickers/**', 'public/assets/stickers-pro/flamme.svg', false],
    ['public/assets/stickers', 'public/assets/stickers/flamme.svg', true],
    ['public/assets/stickers/', 'public/assets/stickers/flammes/flamme-01.svg', true],
    ['public/assets/stickers', 'public/assets/stickers-pro/flamme.svg', false],
    ['public/assets/garage/sol.glb', 'public/assets/garage/sol.glb', true],
    ['public/assets/garage/sol.glb', 'public/assets/garage/sol.glb.bak', false],
    ['public/assets/garage/Sol.glb', 'public/assets/garage/sol.glb', false],
    ['public/assets/*.svg', 'public/assets/logo.svg', true],
    ['public/assets/*.svg', 'public/assets/stickers/logo.svg', false],
    ['**/*.opus', 'public/assets/vehicles/demo/audio/idle.opus', true],
    ['**/*.opus', 'idle.opus', true],
    ['public/assets/vehicles/*/thumb.webp', 'public/assets/vehicles/demo/thumb.webp', true],
    ['public/assets/vehicles/*/thumb.webp', 'public/assets/vehicles/demo/variants/thumb.webp', false],
    ['public/assets/**/thumb.webp', 'public/assets/vehicles/demo/thumb.webp', true],
    ['public/assets/**/thumb.webp', 'public/assets/thumb.webp', true],
    ['public/assets/ui/icone-?.png', 'public/assets/ui/icone-a.png', true],
    ['public/assets/ui/icone-?.png', 'public/assets/ui/icone-ab.png', false],
    ['public/assets/ui/*.{png,webp}', 'public/assets/ui/fond.webp', true],
    ['public/assets/ui/*.{png,webp}', 'public/assets/ui/fond.avif', false],
    ['public/assets/*.v1.svg', 'public/assets/logo.v1.svg', true],
    ['public/assets/*.v1.svg', 'public/assets/logoXv1.svg', false],
    ['./public/assets/logo.svg', 'public/assets/logo.svg', true],
    ['/public\\assets\\logo.svg', 'public/assets/logo.svg', true],
    ['', 'public/assets/logo.svg', false],
  ])('motif « %s », chemin « %s » : %s', (pattern, rel, expected) => {
    expect(matchesPath(pattern, rel)).toBe(expected);
  });
});
