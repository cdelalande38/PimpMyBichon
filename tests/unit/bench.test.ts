// Atelier : listes de données, ambiance (lecture tolérante, sauvegarde, reprise de la peinture du
// banc d'essai par les builds), peinture.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, get, set } from 'idb-keyval';
import { MeshPhysicalMaterial } from 'three';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AMBIANCES, DEFAULT_AMBIANCE } from '../../src/data/ambiances.ts';
import { BASIS_TRANSCODER_DIR } from '../../src/data/bench.ts';
import { DEFAULT_FINISH, finish, FINISHES } from '../../src/data/finishes.ts';
import { DEFAULT_PAINT_COLOR, PAINT_COLORS } from '../../src/data/paintColors.ts';
import { applyPaint, createPaintMaterial, paintBaseColor } from '../../src/render/paint.ts';
import { modelUrl, VEHICLES } from '../../src/data/vehicles.ts';
import { DEFAULT_BENCH, legacyPaint, sanitizeBench } from '../../src/state/bench.ts';

const HEX = /^#[0-9a-f]{6}$/i;

function unique(ids: readonly string[]): boolean {
  return new Set(ids).size === ids.length;
}

describe('données du banc d’essai', () => {
  it('la palette « Bichon » compte ses 9 teintes (§ 5.2)', () => {
    expect(PAINT_COLORS.map((color) => color.label)).toEqual([
      'Vert Bichon',
      'Noir',
      'Rouge sang',
      'Orange piste',
      'Crème 2006',
      'Gris pick-up',
      'Bleu nuit',
      'Violet',
      'Blanc',
    ]);
    expect(unique(PAINT_COLORS.map((color) => color.id))).toBe(true);
    for (const color of PAINT_COLORS) expect(color.hex, color.label).toMatch(HEX);
    expect(PAINT_COLORS.some((color) => color.id === DEFAULT_PAINT_COLOR)).toBe(true);
  });

  it('les finitions de départ sont des réglages physiques bornés', () => {
    expect(FINISHES.map((item) => item.id)).toEqual([
      'brillant',
      'satine',
      'mat',
      'metallise',
      'paillete',
      'candy',
      'nacre',
      'cameleon',
      'chrome',
      'chrome-colore',
    ]);
    expect(unique(FINISHES.map((item) => item.label))).toBe(true);
    for (const item of FINISHES) {
      for (const key of ['metalness', 'roughness', 'clearcoat', 'clearcoatRoughness', 'iridescence', 'tint'] as const) {
        expect(item[key], `${item.id}.${key}`).toBeGreaterThanOrEqual(0);
        expect(item[key], `${item.id}.${key}`).toBeLessThanOrEqual(1);
      }
      expect(item.hint.length, item.id).toBeGreaterThan(0);
    }
    // Chrome et chrome coloré : métal pur, rugosité de 0,03 à 0,08 (§ 8), teinte libre.
    for (const id of ['chrome', 'chrome-colore'] as const) {
      expect(finish(id).metalness).toBe(1);
      expect(finish(id).roughness).toBeGreaterThanOrEqual(0.03);
      expect(finish(id).roughness).toBeLessThanOrEqual(0.08);
    }
    expect(finish('chrome-colore').tint).toBe(1);
    expect(FINISHES.some((item) => item.id === DEFAULT_FINISH)).toBe(true);
  });

  it('trois ambiances, « Bichon » par défaut', () => {
    expect(AMBIANCES.map((item) => item.id)).toEqual(['bichon', 'neon', 'atelier']);
    expect(DEFAULT_AMBIANCE).toBe('bichon');
    for (const item of AMBIANCES) {
      for (const hex of [item.left, item.right, item.key, item.sky, item.ground, item.night]) {
        expect(hex, item.id).toMatch(HEX);
      }
    }
  });

  it('les modèles sont servis par l’app, sous le socle', () => {
    expect(BASIS_TRANSCODER_DIR).not.toMatch(/^(\/|[a-z]+:)/i);
    for (const vehicle of VEHICLES) {
      expect(modelUrl(vehicle)).toBe(`${import.meta.env.BASE_URL}assets/vehicles/${vehicle.id}/${vehicle.glb}`);
    }
    const concept = VEHICLES.find((vehicle) => vehicle.wave === 0);
    expect(concept?.zones.filter((zone) => zone.group === 'carrosserie').every((zone) => zone.materials.length > 0)).toBe(true);
    expect(concept?.adapt?.plainMaterials).toContain('License');
  });
});

describe('lecture tolérante du banc', () => {
  it('une sauvegarde absente ou abîmée retombe sur l’origine', () => {
    for (const raw of [undefined, null, 42, 'texte', [], {}]) {
      expect(sanitizeBench(raw)).toEqual(DEFAULT_BENCH);
    }
  });

  it('ne garde que l’ambiance, et une ambiance inconnue retombe sur l’origine', () => {
    expect(sanitizeBench({ color: 'violet', finish: 'chrome', ambiance: 7 })).toEqual(DEFAULT_BENCH);
    expect(sanitizeBench({ ambiance: 'neon', extra: true })).toEqual({ ambiance: 'neon' });
  });

  it('lit la teinte et la finition de la version 1 quand elles sont connues', () => {
    expect(legacyPaint({ color: 'orange', finish: 'candy' })).toEqual({ color: '#ff6a00', finish: 'candy' });
    expect(legacyPaint({ color: 'fuchsia', finish: 'candy' })).toBeNull();
    expect(legacyPaint(null)).toBeNull();
  });
});

describe('sauvegarde du banc', () => {
  type BenchModule = typeof import('../../src/state/bench.ts');

  async function launch(): Promise<BenchModule['useBench']> {
    vi.resetModules();
    const { useBench } = await import('../../src/state/bench.ts');
    await vi.waitFor(() => expect(useBench.getState().hydrated).toBe(true));
    return useBench;
  }

  const db = () => createStore('pimpmybichon', 'kv');

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('retrouve l’ambiance au lancement suivant, sans l’état du modèle', async () => {
    const first = await launch();
    first.getState().choose('ambiance', 'atelier');
    first.getState().setStatus('pret');
    await vi.waitFor(async () => {
      const raw = await get<string>('pmb-banc', db());
      expect(raw ? (JSON.parse(raw) as { state: unknown }).state : null).toEqual({ ambiance: 'atelier' });
    });

    const second = await launch();
    const { ambiance, status } = second.getState();
    expect({ ambiance, status }).toEqual({ ambiance: 'atelier', status: 'chargement' });
  });

  it('la teinte et la finition de la version 1 deviennent la peinture de départ du concept', async () => {
    await set('pmb-banc', JSON.stringify({ state: { color: 'orange', finish: 'candy', ambiance: 'neon' }, version: 1 }), db());
    const useBench = await launch();
    expect(useBench.getState().ambiance).toBe('neon');
    const { useBuilds } = await import('../../src/state/builds.ts');
    const concept = VEHICLES.find((vehicle) => vehicle.wave === 0);
    await vi.waitFor(() => expect(useBuilds.getState().builds[concept?.id ?? '']?.paints.carrosserie).toEqual({ color: '#ff6a00', finish: 'candy' }));
  });

  it('une sauvegarde trafiquée ne bloque pas l’ouverture', async () => {
    await set('pmb-banc', JSON.stringify({ state: { color: '<script>', finish: null }, version: 1 }), db());
    const useBench = await launch();
    expect({ ambiance: useBench.getState().ambiance }).toEqual(DEFAULT_BENCH);
  });
});

describe('peinture', () => {
  it('applique teinte et finition au matériau', () => {
    const material = createPaintMaterial();
    applyPaint(material, '#ff6a00', finish('candy'));
    expect(material).toBeInstanceOf(MeshPhysicalMaterial);
    expect(material.color.getHexString()).toBe(paintBaseColor('#ff6a00', finish('candy')).getHexString());
    expect(material.metalness).toBe(finish('candy').metalness);
    expect(material.roughness).toBe(finish('candy').roughness);
    expect(material.clearcoat).toBe(1);
    expect(material.iridescence).toBe(finish('candy').iridescence);

    applyPaint(material, '#ff6a00', finish('mat'));
    expect(material.clearcoat).toBe(0);
    expect(material.iridescence).toBe(0);
  });

  it('un chrome reste un miroir à peine teinté ; une laque prend toute la teinte', () => {
    const lacquer = paintBaseColor('#b0121c', finish('brillant'));
    expect(lacquer.getHexString()).toBe('b0121c');
    const chrome = paintBaseColor('#b0121c', finish('chrome'));
    expect(chrome.g).toBeGreaterThan(0.5);
    expect(chrome.r).toBeGreaterThan(chrome.g);
  });

  it('garde le nom et le relief du matériau d’origine, pas sa couleur', () => {
    const source = new MeshPhysicalMaterial({ name: 'Paint 1 Carmine', color: '#aa0000' });
    const paint = createPaintMaterial(source);
    expect(paint.name).toBe('Paint 1 Carmine');
    expect(paint.map).toBeNull();
  });
});
