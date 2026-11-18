// Établi moteur (src/data/moteurs.ts, tools/vehicles/moteurs.mjs) : le catalogue et sa validation, les
// modèles fabriqués (nœuds nommés, budget du § 8, matières), les manifestes qui nomment un modèle, les
// traitements portés par une finition de peinture que la sauvegarde garde, et les articles de la boutique.

import { describe, expect, it } from 'vitest';
import { A_VENDRE, articleParId, PIECES } from '../../src/data/boutique.ts';
import { ARTICLES_MOTEUR, PRIX_TRAITEMENTS } from '../../src/data/articles/moteur.ts';
import { FINISHES } from '../../src/data/finishes.ts';
import { MATERIAL_ROLES } from '../../src/data/materialRoles.ts';
import {
  articleEchange,
  articleTraitement,
  checkEngineModel,
  familleOf,
  MOTEURS_CATALOGUE,
  sansModele,
  TRAITEMENTS,
  validateMoteursCatalogue,
} from '../../src/data/moteurs.ts';
import { validateManifest, VEHICLES } from '../../src/data/vehicles.ts';
import { sanitizeBuilds } from '../../src/state/builds.ts';
import { summarize } from '../../tools/vehicles/build.mjs';
import { catalogueNodes, engineModel, MODELED, PART_PREFIX, readCatalogue, SUPPORT_NODE } from '../../tools/vehicles/moteurs.mjs';

const brut = () => JSON.parse(JSON.stringify(readCatalogue())) as Record<string, unknown> & { familles: Array<Record<string, unknown> & { pieces: Array<Record<string, unknown>> }> };

describe('catalogue des moteurs', () => {
  it('le catalogue versionné passe sa validation ; l’outil et l’app lisent le même', () => {
    expect(() => validateMoteursCatalogue(readCatalogue())).not.toThrow();
    expect(MOTEURS_CATALOGUE.familles.map((famille) => famille.id)).toEqual(readCatalogue().familles.map((famille) => famille.id));
  });

  it('refuse un catalogue abîmé, avec un message clair', () => {
    const doubleNode = brut();
    const pieces = doubleNode.familles[0]?.pieces ?? [];
    (pieces[1] as { noeuds: Record<string, unknown> }).noeuds = { carters: [0, 0, 0] };
    expect(() => validateMoteursCatalogue(doubleNode)).toThrow(/déjà pris/);

    const inconnu = brut();
    (inconnu.familles[0]?.pieces[0] as Record<string, unknown>).traitements = ['brut', 'dorure'];
    expect(() => validateMoteursCatalogue(inconnu)).toThrow(/traitements/);

    const origine = brut();
    const filtres = origine.familles[0]?.pieces.find((piece) => piece.id === 'filtres') as { echange: { origine: string } };
    filtres.echange.origine = 'turbo';
    expect(() => validateMoteursCatalogue(origine)).toThrow(/origine/);

    const vecteur = brut();
    (vecteur.familles[0]?.pieces[0] as { noeuds: Record<string, unknown> }).noeuds = { carters: [0, 9, 0] };
    expect(() => validateMoteursCatalogue(vecteur)).toThrow(/éclatement/);

    const tour = brut();
    (tour.familles[0] as Record<string, unknown>).orientation = 90;
    expect(() => validateMoteursCatalogue(tour)).toThrow(/orientation/);

    const lesDeux = brut();
    (lesDeux.familles[0]?.pieces[0] as Record<string, unknown>).echange = { label: 'x', origine: 'a', options: [] };
    expect(() => validateMoteursCatalogue(lesDeux)).toThrow(/l'un des deux/);
  });

  it('chaque famille du catalogue est modelée, substitut déclaré ; chaque pièce a une phrase et des nœuds', () => {
    for (const famille of MOTEURS_CATALOGUE.familles) {
      expect(MODELED, famille.id).toContain(famille.id);
      expect(famille.placeholder, famille.id).toBe(true);
      for (const piece of famille.pieces) {
        expect(piece.phrase.trim().length, piece.id).toBeGreaterThan(0);
        expect(Object.keys(piece.noeuds ?? {}).length + (piece.echange?.options.length ?? 0), piece.id).toBeGreaterThan(0);
      }
    }
  });
});

describe('modèles fabriqués', () => {
  const traitables = new Set(MOTEURS_CATALOGUE.matieres.filter((matiere) => matiere.traitable).map((matiere) => matiere.id));
  const connues = new Set([...MOTEURS_CATALOGUE.matieres.map((matiere) => matiere.id), ...MATERIAL_ROLES.map((role) => role.id)]);

  for (const famille of readCatalogue().familles) {
    it(`${famille.id} : nœuds part_<nom> du catalogue et support, budget du § 8, matières connues, chaque pièce traitable`, () => {
      const model = engineModel(famille);
      const { bytes } = model.toGlb();
      const summary = summarize(bytes);
      expect(summary.nodes.slice(1).sort()).toEqual([SUPPORT_NODE, ...catalogueNodes(famille).map((node) => `${PART_PREFIX}${node}`)].sort());
      expect(summary.triangles).toBeLessThanOrEqual(readCatalogue().budget.triangles);
      expect(summary.triangles).toBeGreaterThan(20_000);
      for (const name of summary.materials) expect(connues.has(name), name).toBe(true);
      // Le moteur tient debout sur son support (rien sous le sol) ; le cadre de la caméra le serre sans le
      // perdre : chaque cote entre 70 % et 110 % de celle du moteur assemblé (même règle que vehicles:build).
      expect(summary.min[1]).toBeGreaterThanOrEqual(-0.001);
      const real = [Math.max(-summary.min[0], summary.max[0]), Math.max(-summary.min[2], summary.max[2]), summary.max[1]];
      [famille.cadre.halfLength, famille.cadre.halfWidth, famille.cadre.height].forEach((value, i) => {
        expect(value / (real[i] ?? 1), `cadre ${i}`).toBeGreaterThanOrEqual(0.7);
        expect(value / (real[i] ?? 1), `cadre ${i}`).toBeLessThanOrEqual(1.1);
      });
      // Chaque nœud de pièce porte au moins une matière traitable : un traitement s'y voit toujours.
      for (const node of catalogueNodes(famille)) {
        const parts = model.nodes.get(`${PART_PREFIX}${node}`)?.parts ?? [];
        expect(parts.length, node).toBeGreaterThan(0);
        expect(
          parts.some((part: { material: string }) => traitables.has(part.material)),
          node,
        ).toBe(true);
      }
    });
  }
});

describe('manifestes', () => {
  it('chaque engine.model nomme une famille du catalogue ; un moteur sans modèle le dit en une phrase', () => {
    for (const vehicle of VEHICLES) {
      if (vehicle.engine?.model) expect(familleOf(vehicle), vehicle.id).toBeDefined();
    }
    const cox = VEHICLES.find((vehicle) => vehicle.engine?.model === 'quatre-a-plat');
    expect(cox?.engine?.label).toMatch(/à plat/);
    const sans = VEHICLES.find((vehicle) => vehicle.engine && !vehicle.engine.model);
    if (sans) {
      const phrase = sansModele(sans);
      expect(phrase).toContain(sans.name);
      expect(phrase.split(/[.!?]\s/).length).toBe(1);
    }
  });

  it('valide engine.model : une famille inconnue est refusée', () => {
    const problems: string[] = [];
    checkEngineModel('v12-imaginaire', problems);
    checkEngineModel(42, problems);
    checkEngineModel(undefined, problems);
    expect(problems).toHaveLength(2);
    const cox = VEHICLES.find((vehicle) => vehicle.engine?.model);
    const raw = JSON.parse(JSON.stringify(cox)) as Record<string, unknown> & { engine: Record<string, unknown> };
    raw.engine.model = 'v12-imaginaire';
    expect(() => validateManifest(raw, String(raw.id))).toThrow(/engine\.model/);
  });
});

describe('traitements et sauvegarde', () => {
  it('chaque traitement écrit est porté par une finition de peinture à lui, que la sauvegarde garde', () => {
    const portes = TRAITEMENTS.map((item) => item.porte).filter((porte) => porte !== null);
    expect(new Set(portes).size).toBe(portes.length);
    expect(TRAITEMENTS.find((item) => item.porte === null)?.id).toBe('brut');
    for (const porte of portes) expect(FINISHES.map((finish) => finish.id)).toContain(porte);
    const partPaints = Object.fromEntries(TRAITEMENTS.filter((item) => item.porte).map((item, i) => [`moteur_piece${i}`, { finish: item.porte, ...(item.teinte ? { color: '#12AB34' } : {}) }]));
    const relu = sanitizeBuilds({ current: 'cox', builds: { cox: { paints: {}, partPaints } }, recents: [] });
    for (const [key, value] of Object.entries(partPaints)) {
      expect(relu.builds.cox?.partPaints?.[key]?.finish, key).toBe(value.finish);
      if ('color' in value) expect(relu.builds.cox?.partPaints?.[key]?.color, key).toBe('#12ab34');
    }
  });
});

describe('articles de la boutique', () => {
  it('chaque traitement payant et chaque option d’échange qui n’est pas d’origine est un article, de 60 à 400 $', () => {
    const ids = ARTICLES_MOTEUR.map((article) => article.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const traitement of TRAITEMENTS) {
      const article = articleParId(articleTraitement(traitement.id));
      if (traitement.libre) expect(article, traitement.id).toBeUndefined();
      else {
        expect(article, traitement.id).toBeDefined();
        expect(PRIX_TRAITEMENTS[traitement.id], traitement.id).toBe(article?.prix);
      }
    }
    for (const famille of MOTEURS_CATALOGUE.familles) {
      for (const piece of famille.pieces) {
        for (const option of piece.echange?.options ?? []) {
          const article = articleParId(articleEchange(piece.id, option.id));
          if (option.id === piece.echange?.origine) continue;
          expect(article, `${famille.id} ${piece.id} ${option.id}`).toBeDefined();
        }
      }
    }
    for (const article of ARTICLES_MOTEUR) {
      expect(article.famille).toBe('piece');
      expect(article.prix).toBeGreaterThanOrEqual(60);
      expect(article.prix).toBeLessThanOrEqual(400);
      expect(article.description.trim().length).toBeGreaterThan(0);
      expect(PIECES).toContain(article);
      expect(A_VENDRE).toContain(article);
    }
  });
});
