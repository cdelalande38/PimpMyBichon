// Sortie de nuit, scène : règles du projet vérifiées sur les sources (src/drive/DriveCanvas.tsx,
// src/drive/scene/) : aucune carte ni aucun véhicule codé en dur, la conduite lue seulement par le
// contrat et ses fichiers, aucune adresse externe, une matière de nuit pour chaque rôle de tronçon,
// et le service worker qui garde les cartes à la demande.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ROLE_LOOKS } from '../../src/drive/scene/materiaux.ts';

const ROOT = join(__dirname, '..', '..');
const SCENE = join(ROOT, 'src', 'drive', 'scene');
const files = [join(ROOT, 'src', 'drive', 'DriveCanvas.tsx'), ...readdirSync(SCENE).map((f) => join(SCENE, f))];
const sources = files.map((f) => ({ file: f, text: readFileSync(f, 'utf8') }));
const ids = (dir: string) => readdirSync(join(ROOT, 'public', 'assets', dir), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

describe('scène de la sortie : règles', () => {
  it('ne cite aucune carte ni aucun véhicule du dépôt', () => {
    for (const id of [...ids('maps'), ...ids('vehicles')]) {
      for (const { file, text } of sources) expect(text.includes(`'${id}'`) || text.includes(`"${id}"`) || text.includes(`/${id}/`), `${id} dans ${file}`).toBe(false);
    }
  });

  it('ne lit la conduite que par le contrat et ses fichiers', () => {
    const allowed = new Set(['../contrat.ts', '../rail.ts', '../pilote.ts', '../cameras.ts', '../realisateur.ts', '../../state/drive.ts', './contrat.ts', '../state/drive.ts']);
    for (const { file, text } of sources) {
      for (const match of text.matchAll(/from '(\.\.?\/[^']*(?:drive|contrat|rail|pilote|cameras|realisateur)[^']*)'/g)) {
        const spec = match[1] ?? '';
        if (spec.startsWith('./scene/')) continue;
        expect(allowed.has(spec), `${spec} dans ${file}`).toBe(true);
      }
    }
  });

  it('n’écrit aucune adresse externe et ne synthétise aucun son', () => {
    for (const { file, text } of sources) {
      expect(/https?:\/\//.test(text), file).toBe(false);
      expect(text.includes('createOscillator'), file).toBe(false);
    }
  });

  it('a une matière de nuit pour chaque rôle de tronçon', () => {
    const types = readFileSync(join(ROOT, 'src', 'data', 'mapTypes.ts'), 'utf8');
    const block = /export type MapMaterialRole =([^;]+);/.exec(types)?.[1] ?? '';
    const roles = [...block.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    expect(roles.length).toBeGreaterThan(5);
    for (const role of roles) expect(ROLE_LOOKS, role).toHaveProperty(role as string);
  });

  it('le service worker garde les cartes à la demande, hors du précache', () => {
    const sw = readFileSync(join(ROOT, 'src', 'pwa', 'sw.ts'), 'utf8');
    expect(sw).toContain("new URL('assets/maps/', self.registration.scope)");
    expect(sw).toContain('registerRoute(');
    const vite = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
    expect(vite).toContain("'assets/maps/**'");
  });
});
