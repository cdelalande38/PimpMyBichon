// Jalon 1, rendu cible : peinture multicouche, garage décrit en données, ambiances.
import { readFileSync } from 'node:fs';
import { ShaderLib } from 'three';
import { describe, expect, it } from 'vitest';
import { AMBIANCES } from '../../src/data/ambiances.ts';
import { FINISHES } from '../../src/data/finishes.ts';
import { colorOf, GARAGE, GARAGE_MATERIALS, type ColorKey } from '../../src/data/garage.ts';
import { applyPaint, createPaintMaterial, paintUniforms, patchPaintShader } from '../../src/render/paint.ts';

const HEX = /^#[0-9a-f]{6}$/i;

describe('peinture multicouche', () => {
  it('les repères du shader existent dans la version de three.js installée', () => {
    const shader = { vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader };
    expect(() => patchPaintShader(shader)).not.toThrow();
    expect(shader.fragmentShader).toContain('pmbFlake');
    expect(shader.fragmentShader).toContain('pmbCandyColor');
    expect(shader.vertexShader).toContain('vPmbWorld');
  });

  it('chaque finition passe par le même matériau, réglée par les données', () => {
    const material = createPaintMaterial();
    for (const item of FINISHES) {
      applyPaint(material, '#0a3a46', item);
      const uniforms = paintUniforms(material);
      expect(uniforms.flake, item.id).toBe(item.flake);
      expect(uniforms.candy, item.id).toBe(item.candy);
      expect(uniforms.flip, item.id).toBe(item.flip);
      expect(material.customProgramCacheKey(), item.id).toBe('pmb-peinture-1');
    }
  });

  it('candy, nacré et caméléon ont leur effet d’angle ; pailleté a des paillettes réglables', () => {
    const byId = Object.fromEntries(FINISHES.map((item) => [item.id, item]));
    expect(byId.candy?.candy).toBeGreaterThan(0);
    expect(byId.nacre?.iridescence).toBeGreaterThan(0);
    expect(byId.cameleon?.flip).toBeGreaterThan(0);
    expect(byId.paillete?.flake).toBeGreaterThan(0);
    expect(byId.paillete?.flakeSize).toBeGreaterThan(byId.metallise?.flakeSize ?? 0);
    expect(byId.mat?.clearcoat).toBe(0);
  });
});

describe('garage du § 4', () => {
  it('chaque source prend une couleur de chaque ambiance', () => {
    const keys = new Set<ColorKey>([
      ...GARAGE.spots.map((item) => item.color),
      ...GARAGE.strips.map((item) => item.color),
      ...GARAGE.halos.map((item) => item.color),
      ...GARAGE.signs.map((item) => item.color),
    ]);
    for (const ambiance of AMBIANCES) {
      for (const key of keys) expect(colorOf(ambiance, key), `${ambiance.id}.${key}`).toMatch(HEX);
    }
  });

  it('spots de la retombée par paires : bleu à gauche, blanc au centre, rouge à droite', () => {
    const wall = GARAGE.spots.filter((spot) => spot.wallHalo);
    expect(wall.map((spot) => spot.color)).toEqual(['spotLeft', 'spotLeft', 'spotCenter', 'spotCenter', 'spotRight', 'spotRight']);
    for (let i = 0; i < wall.length; i += 2) {
      expect(Math.abs((wall[i + 1]?.at[0] ?? 0) - (wall[i]?.at[0] ?? 0))).toBeCloseTo(0.4, 5);
    }
  });

  it('les volumes de substitut sont nommés placeholder_* et listés dans TODO_ASSETS.md', () => {
    const todo = readFileSync('TODO_ASSETS.md', 'utf8');
    const names = [...GARAGE.props.map((prop) => prop.name), ...GARAGE.panels.map((panel) => panel.name)];
    for (const name of names) {
      expect(name).toMatch(/^placeholder_[a-z0-9_]+$/);
      expect(todo, name).toContain(`\`${name}\``);
    }
  });

  it('les matériaux cités existent, les objets tiennent dans la pièce', () => {
    const { width, depth, height } = GARAGE.room;
    for (const prop of GARAGE.props) {
      for (const part of prop.parts) expect(GARAGE_MATERIALS, `${prop.name}.${part.material}`).toHaveProperty(part.material);
      expect(Math.abs(prop.at[0]), prop.name).toBeLessThanOrEqual(width / 2);
      expect(Math.abs(prop.at[2]), prop.name).toBeLessThanOrEqual(depth / 2);
      expect(prop.at[1], prop.name).toBeLessThan(height);
    }
  });
});
