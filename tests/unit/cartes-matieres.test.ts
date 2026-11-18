// Textures des matières du sol et du bâti (tools/maps/matieres.mjs) et leur lecture par la sortie
// (src/drive/scene/sol.ts) : déterminisme, raccord sans couture, tailles, moyennes, manifeste.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { imageSize } from '../../tools/lib/glb.mjs';
import { verifierMatieres } from '../../tools/maps/check.mjs';
import { echantillon, ecrireMatieres, genererMatiere, MATIERES, rapportDeBord, TAILLE } from '../../tools/maps/matieres.mjs';
import { ROLE_LOOKS } from '../../src/drive/scene/materiaux.ts';
import { readSolManifest, SOL_FACADE, SOL_HEAD, SOL_NORMAL, SOL_ROLES, SOL_SURFACE, SOL_TOIT, solDefines } from '../../src/drive/scene/sol.ts';

const N = 64;
const tmp = mkdtempSync(join(tmpdir(), 'pmb-matieres-'));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

describe('textures des matières', () => {
  it('sont déterministes : mêmes octets à chaque fabrication', () => {
    for (const m of MATIERES) expect(Buffer.from(genererMatiere(m.id, N)).equals(Buffer.from(genererMatiere(m.id, N)))).toBe(true);
  });

  it('se raccordent sans couture : la recette est périodique sur la tuile, en x et en y', () => {
    let pire = 0;
    for (const m of MATIERES) {
      for (let k = 0; k < 60; k += 1) {
        const x = ((k * 37) % 101) / 101;
        const y = ((k * 53) % 97) / 97;
        const a = echantillon(m.id, x, y);
        for (const b of [echantillon(m.id, x + 1, y), echantillon(m.id, x, y + 1), echantillon(m.id, x - 1, y - 1)]) {
          pire = Math.max(pire, Math.abs(a.h - b.h), Math.abs(a.alb - b.alb), Math.abs(a.rough - b.rough), Math.abs((a.alb2 ?? 0) - (b.alb2 ?? 0)));
        }
      }
    }
    expect(pire).toBeLessThan(1e-9);
  });

  it('ne marquent pas plus leur bord que leur milieu (écart de voisins comparable)', () => {
    for (const m of MATIERES) {
      const r = rapportDeBord(genererMatiere(m.id, 128), 128);
      expect(r, m.id).toBeGreaterThan(0.75);
      expect(r, m.id).toBeLessThan(1.3);
    }
  });

  it('ont la taille demandée, un canal A jamais nul et des moyennes neutres (× 1 en moyenne)', () => {
    for (const m of MATIERES) {
      const px = genererMatiere(m.id, N);
      expect(px.length).toBe(N * N * 4);
      const moy = [0, 0, 0, 0];
      let minA = 255;
      for (let k = 0; k < px.length; k += 4) {
        for (let c = 0; c < 4; c += 1) moy[c] = (moy[c] ?? 0) + (px[k + c] ?? 0);
        minA = Math.min(minA, px[k + 3] ?? 0);
      }
      const n = N * N;
      // Normale : penchée en moyenne de moins de 4 % ; albédo et rugosité recentrés sur 0,5.
      expect(Math.abs((moy[0] ?? 0) / n - 127.5), m.id).toBeLessThan(10);
      expect(Math.abs((moy[1] ?? 0) / n - 127.5), m.id).toBeLessThan(10);
      expect(Math.abs((moy[2] ?? 0) / n - 127.5), m.id).toBeLessThan(4);
      expect(Math.abs((moy[3] ?? 0) / n - 127.5), m.id).toBeLessThan(4);
      expect(minA).toBeGreaterThan(0);
    }
  });

  it('sont écrites en WebP carrés, avec un manifeste que la sortie sait lire', async () => {
    const r = await ecrireMatieres(tmp, N);
    expect(r.fichiers).toBe(MATIERES.length);
    const manifeste = readSolManifest(JSON.parse(readFileSync(join(tmp, 'matieres.json'), 'utf8')));
    expect(manifeste).not.toBeNull();
    for (const m of manifeste?.matieres ?? []) {
      const size = imageSize(new Uint8Array(readFileSync(join(tmp, m.fichier))));
      expect(size).toMatchObject({ format: 'WebP', width: N, height: N });
      expect(m.tuile).toBeGreaterThan(0);
    }
    expect(TAILLE).toBeLessThanOrEqual(1024);
  }, 60_000);

  it('passent le contrôle des cartes (maps:check) sur un dossier fabriqué, et le budget de poids', async () => {
    const root = join(tmp, 'racine');
    const r = await ecrireMatieres(join(root, 'public', 'assets', 'maps', '_matieres'));
    expect(verifierMatieres(root).erreurs).toEqual([]);
    expect(r.poids).toBeLessThan(1.5e6);
    expect(verifierMatieres(join(tmp, 'vide')).erreurs).toHaveLength(1);
  }, 120_000);
});

describe('lecture des matières par la sortie', () => {
  it('refuse un manifeste mal formé', () => {
    expect(readSolManifest(null)).toBeNull();
    expect(readSolManifest({ format: 'pmb-matieres', version: 2, matieres: [] })).toBeNull();
    expect(readSolManifest({ format: 'pmb-matieres', version: 1, matieres: [{ id: 'enrobe', fichier: '../x.webp', taille: 4, tuile: 1, repere: 'monde' }] })).toBeNull();
    expect(readSolManifest({ format: 'pmb-matieres', version: 1, matieres: [{ id: 'enrobe', fichier: 'enrobe.webp', taille: 4, tuile: 1, repere: 'monde' }] })).not.toBeNull();
  });

  it('sans manifeste, ne pose aucune définition (dessin d’avant, aucune lecture de texture)', () => {
    expect(solDefines('route', null)).toEqual({});
    const m = readSolManifest({ format: 'pmb-matieres', version: 1, matieres: [] });
    expect(solDefines('terrain', m)).toEqual({ PMB_SOL: '', PMB_SOL_TERRAIN: '' });
  });

  it('ne vise que des rôles de tronçon connus', () => {
    for (const role of Object.keys(SOL_ROLES)) expect(ROLE_LOOKS).toHaveProperty(role);
  });

  it('a des nuanceurs aux blocs équilibrés', () => {
    for (const glsl of [SOL_HEAD, SOL_SURFACE, SOL_FACADE, SOL_TOIT, SOL_NORMAL]) {
      const ouverts = (glsl.match(/#if(def|ndef)?\b/g) ?? []).length;
      expect((glsl.match(/#endif\b/g) ?? []).length).toBe(ouverts);
      expect((glsl.match(/{/g) ?? []).length).toBe((glsl.match(/}/g) ?? []).length);
    }
  });
});
