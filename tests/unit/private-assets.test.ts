// Le build doit passer avec et sans le dépôt privé d'assets (jalon 0, § 11).
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { detectPrivateAssets } from '../../tools/private-assets.mjs';

let root: string;

function put(path: string): void {
  const file = join(root, path);
  mkdirSync(join(file, '..'), { recursive: true });
  writeFileSync(file, '');
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'pmb-assets-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('detectPrivateAssets', () => {
  it('signale l’absence du dépôt privé sans échouer', () => {
    expect(detectPrivateAssets({ root, env: {} })).toEqual({
      present: false,
      engines: 0,
      sfx: 0,
      stations: 0,
    });
  });

  it('compte ce que le dépôt privé fournit', () => {
    put('.private-assets/engines/flat4/idle.opus');
    put('.private-assets/engines/flat4/low.opus');
    put('.private-assets/engines/vtwin/idle.opus');
    put('.private-assets/sfx/atelier/cliquet.opus');
    put('.private-assets/sfx/porte.opus');
    put('.private-assets/radio/rock/01.opus');
    expect(detectPrivateAssets({ root, env: {} })).toEqual({
      present: true,
      engines: 2,
      sfx: 2,
      stations: 1,
    });
  });

  it('ne compte ni les dossiers vides ni les fichiers cachés', () => {
    mkdirSync(join(root, '.private-assets/radio/electro'), { recursive: true });
    put('.private-assets/radio/hiphop/.gitkeep');
    put('.private-assets/engines/v8/.DS_Store');
    expect(detectPrivateAssets({ root, env: {} })).toEqual({
      present: true,
      engines: 0,
      sfx: 0,
      stations: 0,
    });
  });

  it('suit la variable PMB_ASSETS_DIR', () => {
    put('ailleurs/radio/rock/01.opus');
    expect(detectPrivateAssets({ root, env: { PMB_ASSETS_DIR: 'ailleurs' } }).stations).toBe(1);
    expect(detectPrivateAssets({ root, env: { PMB_ASSETS_DIR: 'nulle-part' } }).present).toBe(false);
  });
});
