// Fonds des écrans de chargement (tools/fonds/, vague W) : le champ « fond » des cartes est validé, et
// chaque fond livré (cartes et garage) a la taille de son cadrage et pèse 250 Kio au plus.
import { existsSync, statSync } from 'node:fs';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { MAPS, validateMapManifest } from '../../src/data/maps.ts';

const GOOD = {
  id: 'essai',
  name: 'Route d’essai',
  kind: 'route',
  order: 5,
  route: 'route.json',
  credits: [{ source: 'IGN, BD TOPO', licence: 'Licence Ouverte 2.0', date: '2026-11' }],
};
const FORMATS = { paysage: [1920, 1080], portrait: [1080, 1920] } as const;
const MAX = 250 * 1024;

async function verifier(file: string, [width, height]: readonly [number, number]): Promise<void> {
  expect(existsSync(file), file).toBe(true);
  expect(statSync(file).size, file).toBeLessThanOrEqual(MAX);
  const meta = await sharp(file).metadata();
  expect([meta.format, meta.width, meta.height], file).toEqual(['webp', width, height]);
}

describe('fond d’une carte', () => {
  it('optionnel ; deux images du dossier de la carte, sinon une erreur claire', () => {
    expect(validateMapManifest(GOOD, 'essai').fond).toBeUndefined();
    const fond = { paysage: 'fond-paysage-0a1b2c3d.webp', portrait: 'fond-portrait-0a1b2c3d.webp' };
    expect(validateMapManifest({ ...GOOD, fond }, 'essai').fond).toEqual(fond);
    for (const faux of [
      'fond.webp',
      { paysage: 'fond.webp' },
      { ...fond, portrait: '../../autre/fond.webp' },
      { ...fond, paysage: 'https://ailleurs/fond.webp' },
      { ...fond, paysage: 'fond.png' },
    ]) {
      expect(() => validateMapManifest({ ...GOOD, fond: faux }, 'essai')).toThrow(/essai\/map\.json.*fond/);
    }
  });

  it.each(MAPS.filter((map) => map.fond).map((map) => [map.id, map] as const))('%s : ses fonds livrés tiennent leur cadrage et leur poids', async (id, map) => {
    for (const [nom, size] of Object.entries(FORMATS)) await verifier(`public/assets/maps/${id}/${map.fond?.[nom as keyof typeof FORMATS]}`, size);
  });
});

describe('fond du lancement', () => {
  it('le garage, en paysage et en portrait', async () => {
    for (const [nom, size] of Object.entries(FORMATS)) await verifier(`public/assets/fonds/garage-${nom}.webp`, size);
  });
});
