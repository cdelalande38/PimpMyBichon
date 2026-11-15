// Crédits visibles et libellés des zones.
//   - Le modèle sous CC-BY 4.0 du concept est crédité dans « Sous le capot » (titre, auteur,
//     licence, modifications), d'après sa ligne de CREDITS.md, sans adresse externe.
//   - Aucune zone de peinture ne porte le nom d'une option de la peinture (finition, étape,
//     seconde teinte du caméléon) : le fil « Custom · Peinture · … » doit rester lisible.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FINISHES } from '../../src/data/finishes.ts';

const ROOT = new URL('../../', import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), 'utf8');

describe('crédits du modèle sous licence', () => {
  const credits = read('CREDITS.md');
  const row = credits.split('\n').find((line) => line.startsWith('| `public/assets/vehicles/concept/body.glb`')) ?? '';
  const cells = row.split('|').map((cell) => cell.trim());
  const panel = read('src/ui/UnderHoodPanel.tsx');
  const line = /const MODEL_CREDITS =([\s\S]*?);\n/.exec(panel)?.[1] ?? '';

  it('CREDITS.md donne le titre, l’auteur et la licence du concept', () => {
    expect(cells[2]).toContain('« Car Concept »');
    expect(cells[3]).toBe('Eric Chadwick, Darmstadt Graphics Group GmbH, 2024');
    expect(cells[4]).toBe('CC-BY-4.0');
  });

  it('« Sous le capot » reprend titre, auteur, licence et modifications, en texte seul', () => {
    expect(line).not.toBe('');
    expect(line).toContain('« Car Concept »');
    for (const author of (cells[3] ?? '').split(', ').slice(0, 2)) expect(line).toContain(author);
    expect(line).toContain('2024');
    // Liant de mots après le tiret, espace insécable avant la version : « CC-BY 4.0 » ne se coupe pas.
    expect(line).toContain('CC-\\u2060BY\\u00a04.0');
    expect(line).toContain('logos retirés');
    expect(line).not.toMatch(/https?:|www\.|\.org|\.com/);
    expect(panel).toContain('{typo(MODEL_CREDITS)}');
  });
});

describe('libellés des zones de peinture', () => {
  const reserved = new Set(['Seconde teinte', 'Couleur', 'Finition', ...FINISHES.map((finish) => finish.label)]);
  const vehicles = readdirSync(new URL('public/assets/vehicles/', ROOT));

  it.each(vehicles)('%s : aucune zone ne porte le nom d’une option de la peinture', (id) => {
    const manifest = JSON.parse(read(`public/assets/vehicles/${id}/vehicle.json`)) as { zones: Array<{ label: string }> };
    const clashes = manifest.zones.map((zone) => zone.label).filter((label) => reserved.has(label));
    expect(clashes).toEqual([]);
  });

  it('le concept garde l’identifiant « secondaire » : les builds enregistrés ne perdent pas leur peinture', () => {
    const manifest = JSON.parse(read('public/assets/vehicles/concept/vehicle.json')) as { zones: Array<{ id: string; label: string }> };
    expect(manifest.zones.find((zone) => zone.id === 'secondaire')?.label).toBe('Toit et rétros');
  });
});
