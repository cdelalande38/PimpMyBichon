// Balises de virage (src/drive/scene/chevrons.ts) sur les cartes fabriquées : côté extérieur, pointe dans
// le sens du virage, jamais sur la chaussée, nombre borné, fenêtre autour du véhicule, libération.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { MapRoute } from '../../src/data/mapTypes.ts';
import { REGLAGES_VIRAGES } from '../../src/data/virages.ts';
import { createPose, createRail, lateralPoint } from '../../src/drive/rail.ts';
import { BALISE_STRIDE, Chevrons, chevronGeometry, planBalises } from '../../src/drive/scene/chevrons.ts';
import { createNightUniforms } from '../../src/drive/scene/materiaux.ts';
import { liveVirages, trouverVirages } from '../../src/drive/virages.ts';

const DOSSIER = 'public/assets/maps';
const CARTES = (existsSync(DOSSIER) ? readdirSync(DOSSIER) : []).filter((id) => existsSync(`${DOSSIER}/${id}/route.json`));

function charger(id: string): MapRoute {
  return JSON.parse(readFileSync(`${DOSSIER}/${id}/route.json`, 'utf8')) as MapRoute;
}

describe('plan des balises', () => {
  it('il y a des cartes fabriquées à éprouver', () => {
    expect(CARTES.length).toBeGreaterThanOrEqual(4);
  });

  for (const id of CARTES) {
    it(`${id} : à l’extérieur, hors chaussée, nombre borné, face vers l’arrivant`, () => {
      const rail = createRail(charger(id));
      const virages = trouverVirages(rail);
      const plan = planBalises(rail, virages);
      const c = REGLAGES_VIRAGES.chevrons;
      const pose = createPose();
      const point: [number, number, number] = [0, 0, 0];
      let total = 0;
      let cranMax = 0;
      for (let v = 0; v < virages.liste.length; v += 1) {
        const virage = virages.liste[v]!;
        cranMax = Math.max(cranMax, virage.cran);
        const debut = plan.debut[v]!;
        const nombre = plan.nombre[v]!;
        if (virage.cran < c.cranMin) {
          expect(nombre).toBe(0);
          expect(debut).toBe(-1);
          continue;
        }
        // Nombre borné par la longueur posée et l'écart du cran.
        const borne = Math.floor((c.avance[virage.cran - 1]! + virage.longueur + c.prolongement) / c.ecart[virage.cran - 1]!) + 1;
        expect(nombre).toBeLessThanOrEqual(borne);
        expect(nombre).toBeGreaterThan(0);
        for (let k = 0; k < nombre; k += 1) {
          const o = (debut + k) * BALISE_STRIDE;
          const s = plan.abscisse[debut + k]!;
          rail.poseAt(s, pose);
          // Écart latéral signé du pied, vers la gauche de la marche : négatif pour un virage à gauche (extérieur = droite).
          const px = plan.donnees[o + 3]!;
          const pz = plan.donnees[o + 4]!;
          const gauche = lateralPoint(pose, 1, 0, point);
          const ecart = (px - pose.position[0]) * (gauche[0] - pose.position[0]) + (pz - pose.position[2]) * (gauche[2] - pose.position[2]);
          expect(Math.sign(ecart), `${id} virage ${v} panneau ${k}`).toBe(-virage.sens);
          // Jamais sur la chaussée dessinée : à plus d'une demi-largeur de l'axe.
          expect(Math.abs(ecart)).toBeGreaterThan(pose.width / 2 + 0.2);
          expect(plan.donnees[o + 6]).toBe(virage.sens);
          // Face (+Z tourné par le cap) : vers l'arrière de la route, c'est-à-dire contre la tangente.
          const cap = plan.donnees[o + 5]!;
          const face = [Math.sin(cap), Math.cos(cap)];
          const contre = -(face[0]! * pose.tangent[0] + face[1]! * pose.tangent[2]);
          expect(contre, `${id} virage ${v} panneau ${k} regarde en arrière`).toBeGreaterThan(0.3);
        }
        total += nombre;
      }
      expect(total).toBe(plan.count);
      expect(cranMax).toBeGreaterThanOrEqual(2);
      // Les panneaux plus nombreux là où le virage est plus sévère : écart de plus en plus serré.
      for (let i = 1; i < c.ecart.length; i += 1) expect(c.ecart[i]).toBeLessThan(c.ecart[i - 1]!);
      for (let i = 1; i < c.avance.length; i += 1) expect(c.avance[i]).toBeGreaterThan(c.avance[i - 1]!);
    });

    it(`${id} : la fenêtre ne pose que le voisinage, au plus trois appels de dessin, libérée au démontage`, () => {
      const route = charger(id);
      const rail = createRail(route);
      const balises = new Chevrons(createNightUniforms(), rail);
      expect(liveVirages.current?.virages).toBe(balises.virages);
      const pas = Math.max(250, Math.floor(rail.length / 40));
      let posees = 0;
      for (let s = 0; s < rail.length; s += pas) {
        balises.update(null, s, null, 0);
        const p = balises.posees;
        expect(p.gauche + p.droite).toBeLessThanOrEqual(REGLAGES_VIRAGES.chevrons.max);
        expect(p.lisses).toBeLessThanOrEqual(REGLAGES_VIRAGES.chevrons.max);
        expect(balises.appels).toBeLessThanOrEqual(3);
        posees = Math.max(posees, p.gauche + p.droite);
        // Rien n'est posé loin du véhicule : tout le plan ne tient pas dans la fenêtre sur une longue route.
        if (balises.plan.count > 3 * REGLAGES_VIRAGES.chevrons.max) expect(p.gauche + p.droite).toBeLessThan(balises.plan.count);
      }
      expect(posees).toBeGreaterThan(0);
      balises.dispose();
      expect(liveVirages.current).toBeNull();
    });
  }

  it('le panneau pointe à droite ou à gauche : deux géométries en miroir, faces vers +Z', () => {
    const g = chevronGeometry(true);
    const d = chevronGeometry(false);
    expect(g.getAttribute('position').count).toBe(d.getAttribute('position').count);
    // Les chevrons blancs sont nettement plus clairs que le fond : seuls eux renvoient la lumière.
    const colors = g.getAttribute('color');
    let clairs = 0;
    for (let i = 0; i < colors.count; i += 1) if (colors.getX(i) > 0.8) clairs += 1;
    expect(clairs).toBeGreaterThan(0);
    expect(clairs).toBeLessThan(colors.count / 2);
    // Pointe à droite : la pointe (sommet blanc à mi-hauteur, le plus écarté) est du côté +X ; à gauche, du côté −X.
    const pointe = (geo: ReturnType<typeof chevronGeometry>) => {
      const pos = geo.getAttribute('position');
      const col = geo.getAttribute('color');
      let x = 0;
      for (let i = 0; i < pos.count; i += 1) if (col.getX(i) > 0.8 && Math.abs(pos.getY(i) - 1.575) < 1e-3 && Math.abs(pos.getX(i)) > Math.abs(x)) x = pos.getX(i);
      return x;
    };
    expect(pointe(g)).toBeGreaterThan(0);
    expect(pointe(d)).toBeLessThan(0);
  });
});
