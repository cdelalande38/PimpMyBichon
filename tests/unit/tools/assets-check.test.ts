// assets-check : sources lourdes, licence déclarée dans CREDITS.md, budgets de poids et structure
// des dossiers de véhicules (§ 8, § 11 et § 15 du cahier des charges). La lecture de CREDITS.md
// elle-même (tableau, motifs, licences) est testée dans credits.test.ts.
import { symlinkSync } from 'node:fs';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { DEFAULT_LIMITS, FORBIDDEN_EXTENSIONS, formatBytes, runAssetsCheck } from '../../../tools/lib/assets.mjs';
import { NOT_CHECKED_RULE } from '../../../tools/lib/report.mjs';
import { TINY_GLB } from './glb-fixture.ts';
import { BINARY, creditsFile, located, messagesOf, useTempTrees } from './helpers.ts';
import type { FileSpec, TreeSpec } from './helpers.ts';

const SVG = '<svg viewBox="0 0 8 8"><path d="M0 0h8v8z"/></svg>';

/** Une ligne de CREDITS.md qui couvre tout public/assets/ : pour les tests qui visent une autre règle. */
const ALL_ASSETS_CREDITED: TreeSpec = { 'CREDITS.md': creditsFile(['public/assets/**', 'création projet']) };

function sizeOf(spec: FileSpec): number {
  if (typeof spec === 'string') return Buffer.byteLength(spec);
  return spec instanceof Uint8Array ? spec.length : spec.size;
}

/** Un dossier de véhicule complet. */
function vehicle(id: string): TreeSpec {
  const dir = `public/assets/vehicles/${id}`;
  return {
    [`${dir}/vehicle.json`]: JSON.stringify({ id, name: 'Véhicule de démonstration' }),
    [`${dir}/body.glb`]: TINY_GLB,
    [`${dir}/thumb.webp`]: BINARY,
  };
}

/** Le même, complété par un fichier creux pour que le dossier pèse exactement `totalBytes`. */
function vehicleOfSize(id: string, totalBytes: number): TreeSpec {
  const files = vehicle(id);
  const used = Object.values(files).reduce((sum, spec) => sum + sizeOf(spec), 0);
  return { ...files, [`public/assets/vehicles/${id}/variants/paint.ktx2`]: { size: totalBytes - used } };
}

describe('assets-check — sources lourdes et masters', () => {
  const tree = useTempTrees();

  it('interdit exactement les extensions prévues', () => {
    expect([...FORBIDDEN_EXTENSIONS]).toEqual(['.blend', '.blend1', '.wav', '.flac', '.aif', '.aiff', '.psd', '.kra', '.xcf']);
  });

  it.each([...FORBIDDEN_EXTENSIONS])('refuse un fichier %s', (extension) => {
    const root = tree({ [`sources/decor${extension}`]: BINARY });
    const report = runAssetsCheck({ root });
    expect(located(report.errors)).toEqual([`sources/decor${extension}:0 extension-interdite`]);
    expect(report.errors[0]?.message).toContain(`« ${extension} »`);
  });

  it('refuse l’extension quelle que soit sa casse, où que soit le fichier', () => {
    const root = tree({ 'docs/prises/Ralenti.WAV': BINARY, 'src/scene/essai.Blend': BINARY });
    expect(located(runAssetsCheck({ root }).errors)).toEqual([
      'docs/prises/Ralenti.WAV:0 extension-interdite',
      'src/scene/essai.Blend:0 extension-interdite',
    ]);
  });

  it('laisse passer les formats livrables, et ne lit pas les dossiers ignorés', () => {
    const root = tree({
      ...ALL_ASSETS_CREDITED,
      'public/assets/garage/sol.glb': TINY_GLB,
      'public/assets/stickers/flamme.svg': SVG,
      'docs/blend.md': 'notes\n',
      'docs/wav/notes.txt': 'notes\n',
      '.private-assets/sources/decor.blend': BINARY,
      'node_modules/paquet/essai.wav': BINARY,
      'captures/essai.psd': BINARY,
    });
    const report = runAssetsCheck({ root });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
  });
});

describe('assets-check — licence déclarée dans CREDITS.md', () => {
  const tree = useTempTrees();

  it('accepte des fichiers couverts par une licence admise', () => {
    const root = tree({
      'CREDITS.md': creditsFile(
        ['public/assets/stickers/**', 'CC0-1.0'],
        ['public/assets/fonts/titre.woff2', 'OFL-1.1'],
        ['public/assets/garage/', 'CC-BY-4.0'],
        ['public/assets/ui/*.{png,webp}', 'création projet'],
      ),
      'public/assets/stickers/flammes/flamme-01.svg': SVG,
      'public/assets/fonts/titre.woff2': BINARY,
      'public/assets/garage/sol.glb': TINY_GLB,
      'public/assets/ui/bouton.png': BINARY,
      'public/assets/ui/fond.webp': BINARY,
      'public/assets/vehicles/.gitkeep': '',
    });
    const report = runAssetsCheck({ root });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(messagesOf(report.notes)).toContain('5 fichiers sous public/assets/, 4 lignes de licence lues dans CREDITS.md');
  });

  it('refuse un fichier qu’aucune ligne ne couvre', () => {
    const root = tree({
      'CREDITS.md': creditsFile(['public/assets/garage/**', 'CC0-1.0']),
      'public/assets/garage/sol.glb': TINY_GLB,
      'public/assets/stickers/etoile.svg': SVG,
    });
    const report = runAssetsCheck({ root });
    expect(located(report.errors)).toEqual(['public/assets/stickers/etoile.svg:0 licence']);
    expect(report.errors[0]?.message).toContain('aucune ligne de CREDITS.md ne couvre ce fichier');
    expect(report.errors[0]?.message).toContain('CC0-1.0, CC-BY-4.0, OFL-1.1, création projet');
  });

  it.each(['CC-BY-NC-4.0', 'CC-BY-SA-4.0', 'licence commerciale', 'tous droits réservés', ''])(
    'refuse la licence « %s », à la ligne de CREDITS.md qui la déclare',
    (license) => {
      const root = tree({
        'CREDITS.md': creditsFile(['public/assets/garage/**', 'CC0-1.0'], ['public/assets/music/**', license]),
        'public/assets/garage/sol.glb': TINY_GLB,
        'public/assets/music/titre-01.opus': BINARY,
        'public/assets/music/titre-02.opus': BINARY,
      });
      const report = runAssetsCheck({ root });
      expect(located(report.errors)).toEqual(['CREDITS.md:6 licence']);
      expect(report.errors[0]?.message).toContain(`licence « ${license || 'vide'} » hors de la liste admise`);
      expect(report.errors[0]?.message).toContain('2 fichiers, par exemple public/assets/music/titre-01.opus');
    },
  );

  it('ne laisse pas un motif plus large rattraper une licence refusée', () => {
    const root = tree({
      'CREDITS.md': creditsFile(['public/assets/**', 'CC0-1.0'], ['public/assets/music/titre.opus', 'licence commerciale']),
      'public/assets/music/titre.opus': BINARY,
    });
    expect(located(runAssetsCheck({ root }).errors)).toEqual(['CREDITS.md:6 licence']);
  });

  it('refuse tout fichier quand CREDITS.md est absent', () => {
    const report = runAssetsCheck({ root: tree({ 'public/assets/stickers/etoile.svg': SVG }) });
    expect(located(report.errors)).toEqual(['public/assets/stickers/etoile.svg:0 licence']);
    expect(report.errors[0]?.message).toContain('CREDITS.md est absent');
  });

  it('se contente d’une note quand CREDITS.md est absent et qu’il n’y a rien à couvrir', () => {
    const report = runAssetsCheck({ root: tree({ 'public/assets/vehicles/.gitkeep': '', 'public/icons/pwa-192.png': BINARY }) });
    expect(report.errors).toEqual([]);
    expect(report.warnings).toEqual([]);
    expect(messagesOf(report.notes)).toContain('CREDITS.md absent et aucun fichier sous public/assets/ : rien à couvrir');
  });

  it('signale une ligne sans chemin entre accents graves : elle ne couvre rien', () => {
    const root = tree({
      'CREDITS.md': ['| Fichier(s) | Licence |', '|---|---|', '| public/assets/stickers/** | CC0-1.0 |'].join('\n'),
      'public/assets/stickers/etoile.svg': SVG,
    });
    const report = runAssetsCheck({ root });
    expect(located(report.errors)).toEqual(['public/assets/stickers/etoile.svg:0 licence']);
    expect(located(report.warnings)).toEqual(['CREDITS.md:3 licence']);
  });
});

describe('assets-check — budgets de poids', () => {
  const tree = useTempTrees();

  it('applique les budgets du cahier des charges, en mégaoctets décimaux', () => {
    expect(DEFAULT_LIMITS).toEqual({
      vehicleBytes: 15_000_000,
      garageBytes: 10_000_000,
      cityBytes: 12_000_000,
      fileBytes: 25_000_000,
      siteBytes: 1_000_000_000,
    });
  });

  it('accepte des dossiers et un fichier au budget exact', () => {
    const root = tree({
      ...ALL_ASSETS_CREDITED,
      ...vehicleOfSize('demo', 15_000_000),
      'public/assets/garage/decor.bin': { size: 10_000_000 },
      'public/assets/city/route.bin': { size: 12_000_000 },
      'docs/maquette.bin': { size: 25_000_000 },
    });
    const report = runAssetsCheck({ root });
    expect(report.errors).toEqual([]);
    expect(messagesOf(report.notes)).toContain('10 Mo sur un budget de 10 Mo');
    expect(messagesOf(report.notes)).toContain('12 Mo sur un budget de 12 Mo');
  });

  const overweight: Array<[string, TreeSpec, string]> = [
    ['un véhicule', vehicleOfSize('gros', 15_000_001), 'public/assets/vehicles/gros:0 poids-vehicule'],
    ['le garage', { 'public/assets/garage/decor.bin': { size: 10_000_001 } }, 'public/assets/garage:0 poids-decor'],
    [
      'la ville',
      { 'public/assets/city/route.bin': { size: 6_000_000 }, 'public/assets/city/immeubles/tours.bin': { size: 6_000_001 } },
      'public/assets/city:0 poids-decor',
    ],
    ['un fichier isolé', { 'docs/maquette.bin': { size: 25_000_001 } }, 'docs/maquette.bin:0 poids-fichier'],
  ];

  it.each(overweight)('refuse %s au-dessus de son budget, à un octet près', (_label, files, expected) => {
    const root = tree({ ...ALL_ASSETS_CREDITED, ...vehicle('demo'), ...files });
    const report = runAssetsCheck({ root });
    expect(located(report.errors)).toEqual([expected]);
    expect(report.errors[0]?.message).toContain('dépassement de 1 octet');
  });

  it('note l’absence des décors et du site construit au lieu de se taire', () => {
    const notes = messagesOf(runAssetsCheck({ root: tree() }).notes);
    expect(notes).toContain('public/assets/garage/ absent');
    expect(notes).toContain('public/assets/city/ absent');
    expect(notes).toContain('dist/ absent : poids du site non contrôlé');
  });

  it('affiche le poids du site construit et ses cinq plus gros fichiers', () => {
    const root = tree({
      'dist/index.html': { size: 1_000 },
      'dist/assets/a.js': { size: 700_000 },
      'dist/assets/b.js': { size: 300_000 },
      'dist/assets/c.css': { size: 20_000 },
      'dist/icons/i.png': { size: 40_000 },
      'dist/sw.js': { size: 8_500 },
      'dist/manifest.webmanifest': { size: 500 },
    });
    const report = runAssetsCheck({ root });
    expect(report.errors).toEqual([]);
    const site = report.notes.filter((note) => note.rule === 'poids-site');
    expect(site.map((note) => note.file)).toEqual([
      'dist',
      'dist/assets/a.js',
      'dist/assets/b.js',
      'dist/icons/i.png',
      'dist/assets/c.css',
      'dist/sw.js',
    ]);
    expect(site[0]?.message).toContain('dist/ pèse 1,07 Mo en 7 fichiers');
    expect(site[1]?.message).toContain('700 ko');
  });

  it('refuse un site construit plus lourd que la limite de l’hébergeur', () => {
    const root = tree({ 'dist/index.html': { size: 400_000 }, 'dist/assets/app.js': { size: 600_001 } });
    const report = runAssetsCheck({ root, limits: { siteBytes: 1_000_000 } });
    expect(located(report.errors)).toEqual(['dist:0 poids-site']);
    expect(report.errors[0]?.message).toContain("la limite de l'hébergeur est de 1 Mo");
    expect(report.errors[0]?.message).toContain('dépassement de 1 octet');
    // Avec la limite réelle (1 Go), le même site passe.
    expect(runAssetsCheck({ root }).errors).toEqual([]);
  });

  it('écrit les tailles à la française', () => {
    const sizes = [0, 1, 999, 1_000, 743_210, 1_000_000, 1_500_000, 15_200_000, 250_000_000, 1_000_000_000, 1_040_000_000];
    expect(sizes.map((bytes) => formatBytes(bytes))).toEqual([
      '0 octet',
      '1 octet',
      '999 octets',
      '1 ko',
      '743 ko',
      '1 Mo',
      '1,5 Mo',
      '15,2 Mo',
      '250 Mo',
      '1 Go',
      '1,04 Go',
    ]);
  });

  it.skipIf(process.platform === 'win32')('signale un lien symbolique sous public/ sans le suivre', () => {
    const outside = tree({ 'decor.blend': BINARY, 'gros.glb': { size: 30_000_000 } });
    const root = tree({ ...ALL_ASSETS_CREDITED, 'public/assets/vehicles/.gitkeep': '' });
    symlinkSync(join('..', '..', '..', basename(outside)), join(root, 'public/assets/garage'));

    const report = runAssetsCheck({ root });
    expect(report.errors).toEqual([]);
    expect(located(report.warnings)).toEqual(['public/assets/garage:0 lien-symbolique']);
  });
});

describe('assets-check — structure d’un dossier de véhicule', () => {
  const tree = useTempTrees();
  const dir = 'public/assets/vehicles/demo';
  const complete = vehicle('demo');
  const without = (name: string): TreeSpec =>
    Object.fromEntries(Object.entries(complete).filter(([rel]) => !rel.endsWith(`/${name}`)));

  it('accepte des véhicules complets et les nomme', () => {
    const report = runAssetsCheck({ root: tree({ ...ALL_ASSETS_CREDITED, ...complete, ...vehicle('combi-02') }) });
    expect(report.errors).toEqual([]);
    expect(messagesOf(report.notes)).toContain('2 véhicules contrôlés : combi-02, demo');
  });

  it('note l’absence de véhicule', () => {
    const report = runAssetsCheck({ root: tree({ 'public/assets/vehicles/.gitkeep': '' }) });
    expect(report.errors).toEqual([]);
    expect(messagesOf(report.notes)).toContain('aucun véhicule sous public/assets/vehicles/');
  });

  it('accepte un véhicule sans vignette, et le note', () => {
    const report = runAssetsCheck({ root: tree({ ...ALL_ASSETS_CREDITED, ...without('thumb.webp') }) });
    expect(report.errors).toEqual([]);
    expect(messagesOf(report.notes)).toContain('vignette absente (facultative)');
  });

  it('accepte un substitut dont le modèle n’est pas encore produit, et le note', () => {
    const files = { ...without('body.glb'), [`${dir}/vehicle.json`]: '{ "id": "demo", "placeholder": "placeholder_demo" }' };
    const report = runAssetsCheck({ root: tree({ ...ALL_ASSETS_CREDITED, ...files }) });
    expect(report.errors).toEqual([]);
    expect(messagesOf(report.notes)).toContain('modèle du substitut absent : à produire par npm run vehicles:build');
  });

  const broken: Array<[string, TreeSpec, string, string]> = [
    ['sans vehicle.json', without('vehicle.json'), `${dir}/vehicle.json`, 'manifeste manquant'],
    ['sans body.glb', without('body.glb'), `${dir}/body.glb`, 'fichier manquant'],
    ['dont le body.glb est vide', { ...complete, [`${dir}/body.glb`]: '' }, `${dir}/body.glb`, 'fichier vide'],
    ['dont le manifeste n’est pas du JSON', { ...complete, [`${dir}/vehicle.json`]: '{ "id": "demo", }' }, `${dir}/vehicle.json`, 'JSON invalide'],
    [
      'dont l’id diffère du nom du dossier',
      { ...complete, [`${dir}/vehicle.json`]: '{ "id": "autre" }' },
      `${dir}/vehicle.json`,
      'il doit être égal au nom du dossier, « demo »',
    ],
    ['sans id', { ...complete, [`${dir}/vehicle.json`]: '{ "name": "Démo" }' }, `${dir}/vehicle.json`, 'champ « id » absent'],
    ['dont le manifeste est un tableau', { ...complete, [`${dir}/vehicle.json`]: '["demo"]' }, `${dir}/vehicle.json`, 'champ « id » absent'],
  ];

  it.each(broken)('refuse un véhicule %s', (_label, files, file, expected) => {
    const report = runAssetsCheck({ root: tree({ ...ALL_ASSETS_CREDITED, ...files }) });
    expect(report.errors.map((error) => [error.file, error.rule])).toEqual([[file, 'vehicule']]);
    expect(report.errors[0]?.message).toContain(expected);
  });
});

describe('assets-check — ce qui reste hors contrôle', () => {
  const tree = useTempTrees();

  it('dit ce qui n’est pas contrôlé à ce jalon', () => {
    const notes = runAssetsCheck({ root: tree() }).notes.filter((note) => note.rule === NOT_CHECKED_RULE);
    expect(notes.map((note) => note.message)).toEqual([
      'non contrôlé à ce jalon : budgets de triangles et de draw calls des décors (garage, route), ' +
        "textures de 1024 px hors caisse et atlas, appels de dessin réels à l'exécution (instances, fusion)",
    ]);
  });
});
