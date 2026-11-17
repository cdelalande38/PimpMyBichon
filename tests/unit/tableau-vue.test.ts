import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CabinPanel } from '../../src/data/vehicleTypes.ts';
import { dimensionsToile, zoneUtile } from '../../src/scene/vehicle/tableau.ts';
import { cameraEmbarquee, cameraGarage, charger, manifesteDe, mesurer, type Camera, type MesureInstrument, type Vehicule } from './outils/vueConducteur.ts';

// Lisibilité de la vitesse derrière le volant (vague R, lot « cadrans », demande du 17 novembre 2026 :
// « le compteur de vitesse … en vue intérieure, le volant tourner » ; la vitesse doit se lire en entier).
// Sans navigateur : le modèle et le volant du catalogue sont lus dans public/assets, l'œil est celui de
// l'app (placeEye sur les sièges du modèle), et un rayon part de l'œil vers chaque point de la zone utile
// de chaque instrument (tests/unit/outils/vueConducteur.ts). Un point que le volant (jante, branches,
// moyeu), la planche ou le bord de l'image cache est perdu.
//
// Mesure d'origine (avant la vague R), volant droit, part de la zone de vitesse perdue, vue du garage en
// 390 × 844, volant d'origine du véhicule : concept 0 % (chiffres à droite de l'écran), Cox 56 %, van 71 %
// (cadran) ; avec les autres volants du catalogue : Cox de 37 % (deux branches) à 92 % (moyeu large), van
// de 1 % à 71 %. Volant braqué de 0,6 rad (butée du conducteur, `steerMax`) : Cox 62 %, van 50 %.
// Après : voir CIBLE et BRAQUE ci-dessous (la mesure du jour : PMB_MESURE=<fichier.json>).

/** Part de la zone de vitesse qu'on accepte de perdre, volant droit. */
const CIBLE = 0.15;
/** Part acceptée volant braqué à fond (0,6 rad) : il reste lisible pour l'essentiel. */
const BRAQUE = 0.3;
/** Braquage à fond du volant du conducteur, en radians (DRIVER_POSE.motion.steerMax). */
const BUTEE = 0.6;
const VOLANTS = ['deux_branches', 'sport', 'tulipe', 'bois', 'moyeu_large'];

const DIR = new URL('../../public/assets/vehicles/', import.meta.url);
const IDS = readdirSync(DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .filter((id) => (manifesteDe(id).cabin?.panels ?? []).some((panel) => panel.instrument?.mesure === 'vitesse'));

/** L'instrument de vitesse le mieux lu : un véhicule peut en porter plusieurs (un cadran et un écran hors champ). */
const meilleur = (instruments: readonly MesureInstrument[]): MesureInstrument => instruments.filter((i) => i.nom.startsWith('vitesse')).sort((a, b) => a.perdue - b.perdue)[0]!;

/** Les quatre vues de la mesure : garage et caméra embarquée, en portrait (390 × 844) et en paysage (844 × 390). */
function vues(v: Vehicule): Array<{ nom: string; camera: Camera }> {
  return [
    { nom: 'garage portrait', camera: cameraGarage(v, 390, 844) },
    { nom: 'garage paysage', camera: cameraGarage(v, 844, 390) },
    { nom: 'embarquée portrait', camera: cameraEmbarquee(v, 1.3, 74, 390, 844) },
    { nom: 'embarquée paysage', camera: cameraEmbarquee(v, 1.3, 74, 844, 390) },
  ];
}

describe('la vitesse se lit derrière le volant', () => {
  const rapport: Record<string, unknown> = {};

  it('le parc compte des véhicules à instruments', () => {
    expect(IDS.length).toBeGreaterThanOrEqual(3);
  });

  for (const id of IDS) {
    it(`${id} : volant droit, au plus ${CIBLE * 100} % de la vitesse perdue (volant d'origine et volants du catalogue)`, { timeout: 120_000 }, () => {
      const lignes: Record<string, number> = {};
      for (const volant of [undefined, ...VOLANTS]) {
        const v = charger(manifesteDe(id), volant);
        for (const { nom, camera } of vues(v)) {
          const m = meilleur(mesurer(v, camera, 0).instruments);
          lignes[`${volant ?? 'origine'} · ${nom}`] = Math.round(m.perdue * 100);
          // Un modèle de l'atelier garde son volant d'origine (le catalogue y est sans effet) : on ne juge que ce qu'il montre.
          if (volant === undefined || v.manifeste.interior?.steeringNode === undefined) expect(m.perdue, `${id} ${volant ?? 'origine'} ${nom}`).toBeLessThanOrEqual(CIBLE);
        }
      }
      rapport[id] = lignes;
    });

    it(`${id} : volant braqué à fond, la vitesse reste lisible pour l'essentiel (au plus ${BRAQUE * 100} %)`, { timeout: 120_000 }, () => {
      const v = charger(manifesteDe(id));
      expect(v.tournantes, 'le volant doit tourner').toBeGreaterThan(0);
      const lignes: Record<string, number> = {};
      for (const sens of [BUTEE, -BUTEE]) {
        for (const { nom, camera } of vues(v)) {
          const m = meilleur(mesurer(v, camera, sens).instruments);
          lignes[`${sens} · ${nom}`] = Math.round(m.perdue * 100);
          expect(m.perdue, `${id} ${nom} ${sens}`).toBeLessThanOrEqual(BRAQUE);
        }
      }
      rapport[`${id} braqué`] = lignes;
    });
  }

  it('écrit la mesure du jour si PMB_MESURE le demande', () => {
    const fichier = process.env.PMB_MESURE;
    if (fichier) writeFileSync(fichier, JSON.stringify(rapport, null, 1));
    expect(true).toBe(true);
  });
});

describe('zone utile des instruments', () => {
  const panneaux: CabinPanel[] = IDS.flatMap((id) => manifesteDe(id).cabin?.panels ?? []).filter((p) => p.instrument !== undefined);

  it('chaque zone tient dans sa toile', () => {
    for (const panel of panneaux) {
      const z = zoneUtile(panel);
      expect(z.u0).toBeGreaterThanOrEqual(0);
      expect(z.u1).toBeLessThanOrEqual(1);
      expect(z.v0).toBeGreaterThanOrEqual(0);
      expect(z.v1).toBeLessThanOrEqual(1);
      expect(z.u1).toBeGreaterThan(z.u0);
      expect(z.v1).toBeGreaterThan(z.v0);
    }
  });

  it('un afficheur de chiffres : la zone est le bloc des trois chiffres, à droite de la toile', () => {
    const afficheur = panneaux.find((p) => p.instrument?.affichage === 'chiffres');
    expect(afficheur).toBeDefined();
    const z = zoneUtile(afficheur!);
    expect(z.u1).toBeGreaterThan(0.5);
    const { largeur, hauteur } = dimensionsToile(afficheur!);
    expect(largeur).toBeGreaterThan(hauteur);
  });

  it('les manifestes sont lus tels quels (le même fichier que l\'app)', () => {
    for (const id of IDS) expect(JSON.parse(readFileSync(new URL(`${id}/vehicle.json`, DIR), 'utf8')).id).toBe(id);
  });
});
