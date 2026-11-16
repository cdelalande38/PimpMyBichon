// Liste de courses des sons (tools/sons/manque.mjs) et prises générées par le commanditaire
// (tools/sons/catalogue.mjs) : un dossier d'essai tient lieu de dépôt, rien n'est lu du dossier privé.

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrandMatcher, loadBrandHashes } from '../../tools/lib/brands.mjs';
import { LICENCE_GENEREE_CREDITS, licence, ligneCredit } from '../../tools/sons/catalogue.mjs';
import { FAMILLES, famille } from '../../tools/sons/emplacements.mjs';
import { emplacementsBranches, listeManques, MOTEURS } from '../../tools/sons/manque.mjs';

const dossiers: string[] = [];
afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** Dépôt d'essai : un moteur dont le ralenti et le démarrage existent, la route vide. */
function depotEssai(): string {
  const racine = mkdtempSync(join(tmpdir(), 'pmb-sons-manque-'));
  dossiers.push(racine);
  const v8 = join(racine, 'public', 'assets', 'audio', 'engines', 'v8');
  mkdirSync(v8, { recursive: true });
  writeFileSync(
    join(v8, 'engine.json'),
    JSON.stringify({ format: 'pmb-engine-sons', version: 1, boucles: [{ emplacement: 'idle' }], ponctuels: [{ emplacement: 'start' }, { emplacement: 'rev' }, { emplacement: 'rev' }] }),
  );
  mkdirSync(join(racine, 'src', 'data'), { recursive: true });
  writeFileSync(join(racine, 'src', 'data', 'bruitages.ts'), "const a = [{ emplacement: 'vent' }, { emplacement: 'rapport' }];\n");
  return racine;
}

describe('sons:manque', () => {
  it('liste, pour chaque moteur et la route, les emplacements sans fichier', () => {
    const liste = listeManques({ racine: depotEssai() });
    expect(liste.familles.map((f) => f.famille)).toEqual(['quatre-a-plat', 'diesel-turbo', 'bicylindre-v', 'quatre-en-ligne-moto', 'v8', 'route']);
    const v8 = liste.familles.find((f) => f.famille === 'v8')!;
    expect(v8.remplis.sort()).toEqual(['idle', 'rev', 'start']);
    expect(v8.vides.map((v) => v.emplacement)).not.toContain('idle');
    expect(v8.vides.map((v) => v.emplacement)).toContain('high');
    // Sans manifeste : tout manque.
    const cox = liste.familles.find((f) => f.famille === 'quatre-a-plat')!;
    expect(cox.vides).toHaveLength(FAMILLES.find((f) => f.id === 'quatre-a-plat')!.emplacements.length);
    const route = liste.familles.find((f) => f.famille === 'route')!;
    expect(route.vides.find((v) => v.emplacement === 'vent')?.joue).toBe(true);
    expect(route.vides.find((v) => v.emplacement === 'klaxon-1')?.joue).toBe(false);
    expect(route.vides.find((v) => v.emplacement === 'nos')).toMatchObject({ genre: 'boucle' });
  });

  it('chaque entrée dit le genre, la durée, le niveau, et décrit le son en français et en anglais, sans marque', () => {
    const liste = listeManques({ racine: depotEssai() });
    for (const fam of liste.familles) {
      for (const vide of fam.vides) {
        expect(['boucle', 'ponctuel']).toContain(vide.genre);
        expect(vide.dureeVisee).toBeGreaterThan(0);
        expect(vide.dureeVisee).toBeLessThanOrEqual(10);
        expect(vide.niveauViseDb).toBeLessThan(0);
        expect(vide.fr).toMatch(/sans musique ni voix\.$/);
        expect(vide.en).toMatch(/no music, no voice\.$/);
        expect(vide.fr).not.toMatch(/\{|\}|undefined/);
        expect(vide.en).not.toMatch(/\{|\}|undefined/);
        if (vide.genre === 'boucle') expect(vide.fr).toMatch(/bouclable/);
      }
    }
    // Aucune marque : la liste d'empreintes du garde-fou (tools/guard-brands.sha256), mot à mot.
    const marques = createBrandMatcher(loadBrandHashes(fileURLToPath(new URL('../../tools/guard-brands.sha256', import.meta.url))));
    for (const fam of liste.familles) {
      for (const vide of fam.vides) expect([...marques(vide.fr), ...marques(vide.en)].map((hit) => hit.term), `${fam.famille} · ${vide.emplacement}`).toEqual([]);
    }
    expect(Object.keys(MOTEURS).sort()).toEqual(FAMILLES.filter((f) => f.genre === 'moteur').map((f) => f.id).sort());
  });

  it('le crissement long et le coup d’envoi du NOS sont déclarés, décrits et joués par l’app', () => {
    // Dépôt d'essai (route vide) : la description existe ; ce que l'app joue se lit dans les vraies données.
    const route = listeManques({ racine: depotEssai() }).familles.find((f) => f.famille === 'route')!;
    const joues = emplacementsBranches(readFileSync(new URL('../../src/data/bruitages.ts', import.meta.url), 'utf8'));
    expect(joues.has('derapage-long')).toBe(true);
    expect(joues.has('nos-depart')).toBe(true);
    const long = route.vides.find((v) => v.emplacement === 'derapage-long')!;
    expect(long).toMatchObject({ genre: 'boucle' });
    const depart = route.vides.find((v) => v.emplacement === 'nos-depart')!;
    expect(depart).toMatchObject({ genre: 'ponctuel' });
    expect(depart.dureeVisee).toBeGreaterThanOrEqual(0.5);
    expect(depart.dureeVisee).toBeLessThanOrEqual(1);
    expect(depart.fr).toMatch(/gaz sous pression/);
    expect(depart.en).toMatch(/pressurised gas/);
    expect(famille('route')?.emplacements.find((e) => e.id === 'nos-depart')?.genre).toBe('ponctuel');
  });

  it('lit les emplacements joués dans src/data/bruitages.ts', () => {
    expect([...emplacementsBranches("{ emplacement: 'vent' }, { emplacement: 'derapage-court', x: 1 }")]).toEqual(['vent', 'derapage-court']);
  });
});

describe('prises générées par le commanditaire', () => {
  it('« genere-commanditaire » est lisible, sans auteur tiers à citer', () => {
    for (const cellule of ['genere-commanditaire', 'Généré par le commanditaire', 'genere commanditaire (outil de génération sonore)']) {
      expect(licence(cellule)).toMatchObject({ code: LICENCE_GENEREE_CREDITS, citer: false, generee: true });
    }
    expect(licence('CC BY-NC 4.0').code).toBe('inconnue');
    expect(licence('CC0').code).toBe('CC0-1.0');
  });

  it('une prise générée du dossier privé (ici un dossier d’essai) se lit et peut être retenue', async () => {
    const prive = mkdtempSync(join(tmpdir(), 'pmb-sons-prive-'));
    dossiers.push(prive);
    writeFileSync(join(prive, 'sources.csv'), 'fichier;source;auteur;licence;remarques\nsfx/route/vent-genere.wav;généré;commanditaire;genere-commanditaire;vent à 110 km/h\n');
    writeFileSync(join(prive, 'decoupes.csv'), 'source;sortie;debut;fin;contenu\nsfx/route/vent-genere.wav;sfx/route/vent__genere.flac;0;8;vent tenu\n');
    vi.stubEnv('SONS_PRIVE', prive);
    vi.resetModules();
    try {
      const cat = await import('../../tools/sons/catalogue.mjs');
      expect(cat.privePresent()).toBe(true);
      const { prises, decoupes } = cat.lireCatalogue();
      expect(prises).toHaveLength(1);
      expect(cat.licence(prises[0]!.licence)).toMatchObject({ code: LICENCE_GENEREE_CREDITS, citer: false });
      expect(decoupes[0]).toMatchObject({ emplacement: 'vent', famille: 'route' });
      const choix = { format: 'pmb-sons-choix', version: 1, familles: { route: { emplacements: { vent: [{ prise: prises[0]!.id, debut: 0, fin: 8 }] } } } };
      expect(cat.problemesChoix(choix)).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
  });

  it('se crédite par une ligne honnête dans CREDITS.md', () => {
    const ligne = ligneCredit({
      fichiers: ['public/assets/audio/sfx/route/vent.ogg'],
      credit: { auteur: 'quelqu’un', licence: LICENCE_GENEREE_CREDITS, source: 'outil', generee: true },
      moteur: false,
      date: '2026-11-16',
      note: 'Route (sortie de nuit)',
    });
    expect(ligne).toBe(
      "| `public/assets/audio/sfx/route/vent.ogg` | son généré par le commanditaire avec un outil de génération sonore, dont il a les droits d'usage ; découpé, adouci et mis à niveau par `npm run sons:build` (Opus) | le commanditaire | son généré par le commanditaire | 2026-11-16 | Route (sortie de nuit) |",
    );
    const libre = ligneCredit({ fichiers: ['a.ogg'], credit: { auteur: 'X', licence: 'CC0-1.0', source: 'Freesound 1' }, moteur: true, date: 'd', note: 'n' });
    expect(libre).toContain('| Freesound 1, découpé, bouclé ou adouci');
    expect(libre).toContain('| X | CC0-1.0 |');
  });
});
