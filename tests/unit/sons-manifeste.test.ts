// Jeux de sons fabriqués (public/assets/audio/engines/<famille>/) : manifestes conformes, fichiers
// présents et intacts, points de bouclage dans les fichiers, noms neutres, licences admises et
// couvertes par CREDITS.md, famille de chaque véhicule fabriquée, choix versionné lisible.

import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import index from '../../src/audio/engine/familles.json';
import { hasEngineSounds, parseEngineManifest } from '../../src/audio/engine/manifeste.ts';
import { ALLOWED_LICENSES, checkLicenseCoverage, loadCredits } from '../../tools/lib/credits.mjs';
import { problemesChoix } from '../../tools/sons/catalogue.mjs';
import { FAMILLES } from '../../tools/sons/emplacements.mjs';

const ROOT = process.cwd();
const ENGINES = join(ROOT, 'public', 'assets', 'audio', 'engines');
const families = existsSync(ENGINES) ? readdirSync(ENGINES).filter((name) => statSync(join(ENGINES, name)).isDirectory()) : [];

/** Durée d'un fichier Ogg Opus, lue dans la position du dernier paquet (48 kHz, moins le pré-roulement). */
function oggOpusDuration(bytes: Buffer): number {
  const preSkip = bytes.readUInt16LE(bytes.indexOf('OpusHead') + 10);
  let last = bytes.lastIndexOf('OggS');
  while (last > 0 && (bytes[last + 5]! & 0x04) === 0) last = bytes.lastIndexOf('OggS', last - 1);
  const granule = Number(bytes.readBigUInt64LE(last + 6));
  return (granule - preSkip) / 48000;
}

describe('jeux de sons de moteur', () => {
  it('les cinq familles des véhicules sont fabriquées', () => {
    expect(families.sort()).toEqual(['bicylindre-v', 'diesel-turbo', 'quatre-a-plat', 'quatre-en-ligne-moto', 'v8']);
    expect(Object.keys(index.familles).sort()).toEqual(families);
  });

  it('famille inconnue ou absente : muette', () => {
    expect(hasEngineSounds('v8')).toBe(true);
    expect(hasEngineSounds('inconnue')).toBe(false);
    expect(hasEngineSounds(undefined)).toBe(false);
    expect(hasEngineSounds('route')).toBe(false);
  });

  it('manifeste sans ralenti, ou mal formé : refusé (le moteur reste muet)', () => {
    expect('problems' in parseEngineManifest({ format: 'pmb-engine-sons', version: 1, famille: 'x', boucles: [], ponctuels: [], credits: [] })).toBe(true);
    expect('problems' in parseEngineManifest(null)).toBe(true);
    const bad = parseEngineManifest({
      format: 'pmb-engine-sons',
      version: 1,
      famille: 'x',
      credits: [{ auteur: 'a', licence: 'CC0-1.0', source: 'Freesound 1' }],
      boucles: [{ emplacement: 'idle', fichier: '../idle.ogg', regime: 900, boucle: [0, 5], gain: 0, credit: 0 }],
      ponctuels: [],
    });
    expect('problems' in bad && bad.problems.join()).toMatch(/fichier illisible/);
  });

  it('chaque véhicule du catalogue déclare une famille fabriquée', () => {
    const dir = join(ROOT, 'public', 'assets', 'vehicles');
    for (const id of readdirSync(dir)) {
      // tests/unit/vehicules.test.ts pose un véhicule d'essai (zz-essai-<pid>) le temps de son passage :
      // ce n'est pas un véhicule du catalogue.
      if (id.startsWith('zz-essai-')) continue;
      const file = join(dir, id, 'vehicle.json');
      if (!existsSync(file)) continue;
      const vehicle = JSON.parse(readFileSync(file, 'utf8')) as { engine?: { sound?: string } };
      expect(vehicle.engine?.sound, id).toBeTruthy();
      expect(families, id).toContain(vehicle.engine?.sound);
    }
  });

  for (const family of families) {
    describe(family, () => {
      const dir = join(ENGINES, family);
      const raw = JSON.parse(readFileSync(join(dir, 'engine.json'), 'utf8')) as Record<string, unknown>;
      const parsed = parseEngineManifest(raw);

      it('manifeste conforme', () => {
        expect('problems' in parsed ? parsed.problems : []).toEqual([]);
      });

      if ('problems' in parsed) return;
      const manifest = parsed.manifest;
      const files = [...manifest.boucles, ...manifest.ponctuels] as { fichier: string; empreinte?: string; duree?: number }[];

      it('chaque son est là, intact (empreinte), léger, et rien d’autre dans le dossier', () => {
        const present = readdirSync(dir).filter((name) => name !== 'engine.json').sort();
        expect(present).toEqual(files.map((item) => item.fichier).sort());
        for (const item of files) {
          const bytes = readFileSync(join(dir, item.fichier));
          expect(bytes.subarray(0, 4).toString('latin1'), item.fichier).toBe('OggS');
          expect(bytes.includes('OpusHead'), item.fichier).toBe(true);
          expect(createHash('sha256').update(bytes).digest('hex').slice(0, 10), item.fichier).toBe(item.empreinte);
          expect(bytes.byteLength, `${item.fichier} : quelques centaines de Ko au plus`).toBeLessThan(400 * 1024);
        }
      });

      it('noms neutres : l’emplacement seul', () => {
        for (const item of files) expect(item.fichier).toMatch(/^(start|idle|rev|stop|low|mid|high|sweep_up|sweep_down|backfire)(_on|_off)?(-\d)?\.ogg$/);
      });

      it('boucles : ralenti présent, régimes croissants, points de bouclage dans le fichier', () => {
        expect(manifest.boucles.some((loop) => loop.emplacement === 'idle')).toBe(true);
        for (const loop of manifest.boucles) {
          const length = oggOpusDuration(readFileSync(join(dir, loop.fichier)));
          expect(loop.boucle[0]).toBeGreaterThanOrEqual(0);
          expect(loop.boucle[1]).toBeLessThanOrEqual(length + 0.002);
          expect(loop.boucle[1] - loop.boucle[0], loop.fichier).toBeGreaterThan(2);
          expect(loop.regime).toBeGreaterThanOrEqual(manifest.ralenti);
        }
      });

      it('crédits : auteur, source et licence admise pour chaque prise', () => {
        expect(manifest.credits.length).toBeGreaterThan(0);
        for (const credit of manifest.credits) {
          if (credit.licence === 'son généré par le commanditaire') {
            // Son fabriqué par le commanditaire avec un outil de génération sonore (docs/SOURCING_AUDIO.md,
            // « Sons générés ») : ni auteur tiers, ni source en ligne, ni citation dans l'app.
            expect(credit.auteur).toBe('le commanditaire');
            expect(credit.source).toBe('son généré par le commanditaire');
            expect(credit.citer).toBe(false);
            continue;
          }
          expect(ALLOWED_LICENSES).toContain(credit.licence);
          expect(credit.auteur.trim()).not.toBe('');
          expect(credit.source).toMatch(/^(Freesound \d+|Wikimedia Commons)$/);
          expect(credit.citer).toBe(credit.licence !== 'CC0-1.0');
        }
        expect(JSON.stringify(raw)).not.toMatch(/https?:|www\./);
      });
    });
  }

  it('CREDITS.md couvre chaque son et chaque manifeste par une licence admise', () => {
    const files: string[] = ['src/audio/engine/familles.json'];
    for (const family of families) {
      for (const name of readdirSync(join(ENGINES, family))) files.push(`public/assets/audio/engines/${family}/${name}`);
    }
    const { errors } = checkLicenseCoverage({ files, credits: loadCredits(ROOT), rule: 'licence' });
    expect(errors.map((error) => `${error.file} : ${error.message}`)).toEqual([]);
  });

  it('les crédits à citer de familles.json sont ceux des manifestes', () => {
    const fromManifests = families.flatMap((family) => {
      const manifest = JSON.parse(readFileSync(join(ENGINES, family, 'engine.json'), 'utf8')) as { credits: { auteur: string; citer: boolean }[] };
      return manifest.credits.filter((credit) => credit.citer).map((credit) => `${family}:${credit.auteur}`);
    });
    expect(index.attributions.map((item) => `${item.famille}:${item.auteur}`).sort()).toEqual(fromManifests.sort());
  });
});

describe('choix des prises (assets-src/sons/choix.json)', () => {
  const choix = JSON.parse(readFileSync(join(ROOT, 'assets-src', 'sons', 'choix.json'), 'utf8'));

  it('lisible, sans prise qui attend l’accord du commanditaire', () => {
    expect(problemesChoix(choix)).toEqual([]);
    expect(choix.accordRequis.length).toBeGreaterThan(0);
    const retenues = Object.values(choix.familles as Record<string, { emplacements: Record<string, { prise: string }[]> }>).flatMap((famille) =>
      Object.values(famille.emplacements).flat(),
    );
    for (const retenue of retenues) expect(choix.accordRequis).not.toContain(retenue.prise);
  });

  it('identifiants neutres : aucun titre ni nom de fichier de prise', () => {
    const text = JSON.stringify(choix);
    expect(text).not.toMatch(/\.(flac|wav|mp3|m4a|ogg|aiff)/);
    expect(text).not.toMatch(/__/);
  });

  it('le choix provisoire est déclaré comme tel', () => {
    expect(choix.note).toMatch(/provisoire/i);
    for (const family of FAMILLES.filter((item) => item.genre === 'moteur')) expect(Object.keys(choix.familles)).toContain(family.id);
  });

  it('refuse une prise qui attend l’accord, un emplacement inconnu, trop de variantes', () => {
    const base = { prise: 'freesound-1', debut: 0, fin: 2 };
    const problems = problemesChoix({
      format: 'pmb-sons-choix',
      version: 1,
      accordRequis: ['prise-abc'],
      familles: {
        v8: { emplacements: { idle: [{ ...base, prise: 'prise-abc' }], inconnu: [base], rev: [base, base, base, base] } },
      },
    });
    expect(problems.some((p: string) => p.includes('accord'))).toBe(true);
    expect(problems.some((p: string) => p.includes('emplacement inconnu'))).toBe(true);
    expect(problems.some((p: string) => p.includes('4 prises pour 3'))).toBe(true);
  });
});
