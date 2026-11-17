// Balises de virage de la sortie de nuit : à l'extérieur des courbes qui le méritent, une file de
// panneaux à chevrons (deux flèches en pointe, blanches sur fond sombre, sans texte, dessinées par le
// code), posés au bord de la chaussée dessinée, tournés vers celui qui arrive, la pointe dans le sens
// du virage. Plus le virage est sévère, plus les panneaux sont serrés et commencés tôt (réglages :
// src/data/virages.ts). Ils renvoient la lumière des phares comme les piquets et le marquage (retro de
// materiaux.ts) : le chevron est clair, le fond reste noir.
//
// Une glissière les porte là où la carte n'en a pas déjà : chaque tronçon de glissière de la carte
// chargée est lu (sommets de ses maillages, rangés par cases de 3 m) et un panneau qui a déjà la sienne
// derrière lui n'ajoute pas la sienne.
//
// Le plan (où va chaque panneau) se calcule une fois, à l'entrée de la carte (`planBalises`, pur,
// testé). Seuls les panneaux autour du véhicule sont posés (portée devant et derrière) : trois appels
// de dessin au plus (panneaux à pointe à gauche, à droite, glissière), des instances remplies quand la
// fenêtre change, jamais à chaque image. Libérés au démontage.

import {
  BufferAttribute,
  BoxGeometry,
  BufferGeometry,
  Euler,
  Group,
  InstancedMesh,
  Material,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  Vector3,
} from 'three';
import { REGLAGES_VIRAGES, type ReglagesVirages } from '../../data/virages.ts';
import { NO_MIRROR_LAYER } from '../../render/layers.ts';
import type { Rail } from '../contrat.ts';
import { createPose, headingOf, lateralPoint } from '../rail.ts';
import { liveVirages, trouverVirages, type Virages } from '../virages.ts';
import { patchNight, type NightUniforms } from './materiaux.ts';

/** Nombres par panneau dans `PlanBalises.donnees`. */
export const BALISE_STRIDE = 8;
const [AX, AY, AZ, PX, PZ, CAP, SENS, LAT] = [0, 1, 2, 3, 4, 5, 6, 7] as const;

/** Où vont les panneaux de tout le parcours (calculé une fois). */
export interface PlanBalises {
  /** BALISE_STRIDE nombres par panneau : point de l'axe (x, y, z), pied du panneau (x, z), cap, sens du virage, écart à l'axe (m). */
  readonly donnees: Float32Array;
  readonly count: number;
  /** Premier panneau de chaque virage (−1 : sans balises) et leur nombre. */
  readonly debut: Int32Array;
  readonly nombre: Int32Array;
  /** Abscisse de chaque panneau. */
  readonly abscisse: Float32Array;
}

/** Distance, derrière un panneau, du point de la route qu'il regarde (m) : il fait face à celui qui arrive. */
const REGARD = 22;

/**
 * Le plan des balises : pour chaque virage assez sévère, des panneaux à l'extérieur, du début moins
 * l'avance du cran jusqu'à la fin plus le prolongement. Écart à l'axe : demi-largeur de la chaussée
 * dessinée plus `retrait` (le pied reste dehors, au bord, jamais sur l'enrobé).
 */
export function planBalises(rail: Rail, virages: Virages, reglages: ReglagesVirages = REGLAGES_VIRAGES): PlanBalises {
  const c = reglages.chevrons;
  const pose = createPose();
  const regard = createPose();
  const point: [number, number, number] = [0, 0, 0];
  const n = virages.liste.length;
  const debut = new Int32Array(n).fill(-1);
  const nombre = new Int32Array(n);
  const out: number[] = [];
  const abs: number[] = [];
  for (let v = 0; v < n; v += 1) {
    const virage = virages.liste[v]!;
    if (virage.cran < c.cranMin) continue;
    const ecart = c.ecart[virage.cran - 1] ?? 20;
    const avance = c.avance[virage.cran - 1] ?? 0;
    const from = virage.debut - avance;
    const to = virage.debut + virage.longueur + c.prolongement;
    debut[v] = abs.length;
    for (let s = from; s <= to + 1e-6; s += ecart) {
      // Parcours ouvert : pas de panneau avant le départ ni après l'arrivée.
      if (!virages.boucle && (s < 0 || s > virages.longueur)) continue;
      rail.poseAt(s, pose);
      const cote = virage.sens > 0 ? -1 : 1;
      const lat = pose.width / 2 + c.retrait;
      lateralPoint(pose, cote * lat, 0, point);
      // Il regarde la route à REGARD m derrière lui (la tangente, tout au début d'un parcours ouvert).
      rail.poseAt(s - REGARD, regard);
      let vx = regard.position[0] - pose.position[0];
      let vz = regard.position[2] - pose.position[2];
      if (Math.hypot(vx, vz) < 1) {
        vx = -pose.tangent[0];
        vz = -pose.tangent[2];
      }
      // Cap qui tourne la face +Z du panneau vers (vx, vz).
      const cap = Math.atan2(vx, vz);
      out.push(pose.position[0], pose.position[1], pose.position[2], point[0], point[2], cap, virage.sens, lat);
      abs.push(pose.s);
      nombre[v] = (nombre[v] ?? 0) + 1;
    }
  }
  return { donnees: Float32Array.from(out), count: abs.length, debut, nombre, abscisse: Float32Array.from(abs) };
}

// --- Géométrie : panneau à chevrons sur un piquet, face vers +Z ; la pointe vers +X (virage à droite)
//     ou −X (à gauche), vue de face.

const PANNEAU = { largeur: 1.1, hauteur: 1.25, bas: 0.95, fond: [0.05, 0.055, 0.075], blanc: [0.93, 0.92, 0.86], piquet: [0.42, 0.44, 0.47] } as const;

class Maillage {
  readonly positions: number[] = [];
  readonly normales: number[] = [];
  readonly couleurs: number[] = [];

  /** Quadrilatère a, b, c, d (sens direct vu du côté de la normale). */
  quad(a: readonly number[], b: readonly number[], c: readonly number[], d: readonly number[], couleur: readonly number[]): void {
    const ux = (b[0] ?? 0) - (a[0] ?? 0);
    const uy = (b[1] ?? 0) - (a[1] ?? 0);
    const uz = (b[2] ?? 0) - (a[2] ?? 0);
    const vx = (c[0] ?? 0) - (a[0] ?? 0);
    const vy = (c[1] ?? 0) - (a[1] ?? 0);
    const vz = (c[2] ?? 0) - (a[2] ?? 0);
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    for (const p of [a, b, c, a, c, d]) {
      this.positions.push(p[0] ?? 0, p[1] ?? 0, p[2] ?? 0);
      this.normales.push(nx, ny, nz);
      this.couleurs.push(couleur[0] ?? 1, couleur[1] ?? 1, couleur[2] ?? 1);
    }
  }

  geometrie(): BufferGeometry {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(Float32Array.from(this.positions), 3));
    g.setAttribute('normal', new BufferAttribute(Float32Array.from(this.normales), 3));
    g.setAttribute('color', new BufferAttribute(Float32Array.from(this.couleurs), 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** Un panneau et son piquet. `droite` : la pointe vers +X ; sinon le dessin est reflété (sens des quads inversé avec lui). */
export function chevronGeometry(droite: boolean): BufferGeometry {
  const m = new Maillage();
  const w = PANNEAU.largeur / 2;
  const h0 = PANNEAU.bas;
  const h1 = PANNEAU.bas + PANNEAU.hauteur;
  const mid = (h0 + h1) / 2;
  // Reflet : x → −x, et l'ordre des sommets s'inverse pour garder la face vers +Z.
  const fx = droite ? 1 : -1;
  const q = (pts: number[][], couleur: readonly number[], z: number, face: 1 | -1) => {
    const mapped = pts.map((p) => [(p[0] ?? 0) * fx, p[1] ?? 0, z]);
    const ordre = (face === 1) === droite ? [0, 1, 2, 3] : [3, 2, 1, 0];
    const [a, b, c, d] = ordre.map((i) => mapped[i] as number[]);
    m.quad(a as number[], b as number[], c as number[], d as number[], couleur);
  };
  // Fond (face avant et dos), puis deux chevrons blancs légèrement en avant.
  const fond = [[-w, h0], [w, h0], [w, h1], [-w, h1]];
  q(fond, PANNEAU.fond, 0.02, 1);
  q(fond, PANNEAU.fond, -0.02, -1);
  const echelle = 0.95;
  for (const cx of [-0.24, 0.24]) {
    const P = (x: number, y: number) => [cx + x * echelle * 0.9, mid + y * echelle * (PANNEAU.hauteur / 1.0) * 0.9];
    // Chevron « > » : deux bras en parallélogramme (haut puis bas), sens direct vu de face.
    q([P(-0.25, 0.45), P(0.05, 0), P(0.25, 0), P(-0.05, 0.45)], PANNEAU.blanc, 0.025, 1);
    q([P(-0.25, -0.45), P(-0.05, -0.45), P(0.25, 0), P(0.05, 0)], PANNEAU.blanc, 0.025, 1);
  }
  // Piquet derrière le panneau : un prisme de 7 cm, du sol (enfoncé de 10 cm) au bas du panneau.
  const p = 0.035;
  const y0 = -0.1;
  const y1 = h0 + 0.1;
  const z0 = -0.06;
  const z1 = -0.13;
  const faces = [
    [[-p, y0, z0], [p, y0, z0], [p, y1, z0], [-p, y1, z0]],
    [[p, y0, z1], [-p, y0, z1], [-p, y1, z1], [p, y1, z1]],
    [[p, y0, z0], [p, y0, z1], [p, y1, z1], [p, y1, z0]],
    [[-p, y0, z1], [-p, y0, z0], [-p, y1, z0], [-p, y1, z1]],
  ];
  for (const f of faces) m.quad(f[0] as number[], f[1] as number[], f[2] as number[], f[3] as number[], PANNEAU.piquet);
  return m.geometrie();
}

/** Lisse de glissière : de 0 à 1 le long de +X (mise à l'échelle par la longueur du tronçon), 0,30 m de haut entre 0,45 et 0,75 m. */
function lisseGeometry(): BufferGeometry {
  return new BoxGeometry(1, 0.3, 0.07).translate(0.5, 0.6, 0);
}

/** Cases de 3 m où la carte a déjà une glissière (sommets des maillages « glissiere » des tronçons chargés). */
class GlissieresCarte {
  private readonly cases = new Set<number>();
  private static key(x: number, z: number): number {
    return (Math.floor(x / 3) + 20000) * 40000 + Math.floor(z / 3) + 20000;
  }
  lire(root: Object3D): void {
    this.cases.clear();
    const v = new Vector3();
    root.traverse((o) => {
      if (!(o instanceof Mesh)) return;
      const nom = `${o.name} ${(o.material as Material | undefined)?.name ?? ''}`;
      if (!nom.includes('glissiere')) return;
      o.updateWorldMatrix(true, false);
      const pos = (o.geometry as BufferGeometry).getAttribute('position');
      for (let i = 0; i < pos.count; i += 1) {
        v.fromBufferAttribute(pos, i).applyMatrix4(o.matrixWorld);
        this.cases.add(GlissieresCarte.key(v.x, v.z));
      }
    });
  }
  a(x: number, z: number): boolean {
    return this.cases.has(GlissieresCarte.key(x, z));
  }
}

/** Ce que les balises lisent du relief : la hauteur du sol au point (x, z), pour qui est à la hauteur y. */
export interface SolBalises {
  readonly size: number;
  ground(x: number, z: number, y?: number): number;
}

/** Réglages de pose sur le relief (comme les lignes de départ, src/drive/scene/lignes.ts). */
const POSE = { deversMax: 0.08, enfoncement: 0.04 } as const;

/** Les balises d'une sortie : plan calculé à l'entrée, panneaux posés autour du véhicule, libérés au démontage. */
export class Chevrons {
  readonly group = new Group();
  readonly virages: Virages;
  readonly plan: PlanBalises;
  private readonly reglages: ReglagesVirages;
  private readonly rail: Rail;
  private readonly gauche: InstancedMesh;
  private readonly droite: InstancedMesh;
  private readonly lisses: InstancedMesh;
  private readonly materiauPanneau: MeshStandardMaterial;
  private readonly materiauLisse: MeshStandardMaterial;
  private readonly geometries: BufferGeometry[];
  private readonly carte = new GlissieresCarte();
  // Objets de travail.
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly e = new Euler();
  private readonly p = new Vector3();
  private readonly sc = new Vector3(1, 1, 1);
  private readonly hauteurs: Float32Array;
  private readonly poses: Uint8Array;
  // État de la fenêtre.
  private derniere = Number.NaN;
  private chargees = -1;
  private reliefTaille = -1;
  private nGauche = 0;
  private nDroite = 0;
  private nLisses = 0;
  /** Virages posés (premier, nombre) : change quand la fenêtre change. */
  private fenetre: number[] = [];

  constructor(uniforms: NightUniforms, rail: Rail, virages?: Virages, reglages: ReglagesVirages = REGLAGES_VIRAGES) {
    this.rail = rail;
    this.reglages = reglages;
    this.virages = virages ?? trouverVirages(rail, reglages);
    this.plan = planBalises(rail, this.virages, reglages);
    this.group.name = 'balises-virage';
    this.hauteurs = new Float32Array(this.plan.count);
    this.poses = new Uint8Array(this.plan.count);
    const max = reglages.chevrons.max;

    const panneau = new MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.55, metalness: 0, envMapIntensity: 0 });
    panneau.name = 'nuit_chevrons';
    this.materiauPanneau = patchNight(panneau, uniforms, { lamps: { diffuse: 1.4, spec: 0.5 }, wet: { rough: 0.3 }, retro: 26 });
    const lisse = new MeshStandardMaterial({ color: '#9ca1a7', roughness: 0.4, metalness: 0.6, envMapIntensity: 0 });
    lisse.name = 'nuit_lisse_virage';
    this.materiauLisse = patchNight(lisse, uniforms, { lamps: { diffuse: 1.6, spec: 0.8 }, retro: 8, head: { diffuse: 1, spec: 2 } });
    const gG = chevronGeometry(false);
    const gD = chevronGeometry(true);
    const gL = lisseGeometry();
    this.geometries = [gG, gD, gL];
    this.gauche = this.fabriquer(gG, this.materiauPanneau, max, false);
    this.droite = this.fabriquer(gD, this.materiauPanneau, max, false);
    this.lisses = this.fabriquer(gL, this.materiauLisse, max, true);
    this.group.add(this.gauche, this.droite, this.lisses);
    liveVirages.current = { rail, virages: this.virages };
  }

  private fabriquer(g: BufferGeometry, material: MeshStandardMaterial, max: number, discret: boolean): InstancedMesh {
    const mesh = new InstancedMesh(g, material, max);
    mesh.count = 0;
    mesh.frustumCulled = false;
    if (discret) mesh.layers.set(NO_MIRROR_LAYER);
    return mesh;
  }

  /** Nombre de panneaux posés (à gauche, à droite) et de tronçons de glissière. */
  get posees(): { gauche: number; droite: number; lisses: number } {
    return { gauche: this.nGauche, droite: this.nDroite, lisses: this.nLisses };
  }

  /** Appels de dessin : toujours trois au plus. */
  get appels(): number {
    return (this.nGauche > 0 ? 1 : 0) + (this.nDroite > 0 ? 1 : 0) + (this.nLisses > 0 ? 1 : 0);
  }

  /**
   * À chaque image : la fenêtre ne bouge que si le véhicule a avancé de 20 m, qu'un tronçon est arrivé
   * ou que le relief a changé ; alors les panneaux sont reposés (instances réécrites, rien d'alloué).
   */
  update(sol: SolBalises | null, s: number, root: Object3D | null, chargees: number): void {
    const loupe = chargees !== this.chargees;
    const relief = sol !== null && sol.size !== this.reliefTaille;
    const bouge = !(Math.abs(s - this.derniere) < 20) && !(this.rail.loop && this.rail.length - Math.abs(s - this.derniere) < 20);
    if (!loupe && !relief && !bouge) return;
    if (loupe && root) {
      this.chargees = chargees;
      this.carte.lire(root);
      this.poses.fill(0);
    }
    if (relief && sol) {
      this.reliefTaille = sol.size;
      this.poses.fill(0);
    }
    this.derniere = s;
    this.poser(sol, s);
  }

  private poser(sol: SolBalises | null, s: number): void {
    const { plan, virages, reglages } = this;
    const c = reglages.chevrons;
    const longueur = this.rail.length;
    this.nGauche = 0;
    this.nDroite = 0;
    this.nLisses = 0;
    // Les virages dont les panneaux tombent dans la fenêtre, du plus proche au plus loin.
    const proches = this.fenetre;
    proches.length = 0;
    for (let v = 0; v < virages.liste.length; v += 1) {
      const debut = plan.debut[v] ?? -1;
      if (debut < 0) continue;
      const premier = plan.abscisse[debut] ?? 0;
      const dernier = plan.abscisse[debut + (plan.nombre[v] ?? 1) - 1] ?? premier;
      // Écart (devant) de s au premier panneau, et au dernier : en boucle, modulo la longueur.
      let d0 = premier - s;
      let span = dernier - premier;
      if (virages.boucle) {
        d0 = ((((d0 + c.derriere) % longueur) + longueur) % longueur) - c.derriere;
        span = ((span % longueur) + longueur) % longueur;
      }
      const d1 = d0 + span;
      if (d1 < -c.derriere || d0 > c.devant) continue;
      proches.push(v);
    }
    proches.sort((a, b) => Math.abs((plan.abscisse[plan.debut[a] ?? 0] ?? 0) - s) - Math.abs((plan.abscisse[plan.debut[b] ?? 0] ?? 0) - s));
    const max = c.max;
    for (const v of proches) {
      const debut = plan.debut[v] ?? 0;
      const nombre = plan.nombre[v] ?? 0;
      for (let k = 0; k < nombre; k += 1) {
        const i = debut + k;
        if (this.nGauche + this.nDroite >= max) return this.finir();
        this.placer(i, sol);
      }
      // Glissière entre deux panneaux voisins, quand la carte n'en a pas déjà derrière eux.
      for (let k = 0; k + 1 < nombre; k += 1) {
        if (this.nLisses >= max) break;
        this.lisse(debut + k, debut + k + 1);
      }
    }
    this.finir();
  }

  private finir(): void {
    this.gauche.count = this.nGauche;
    this.droite.count = this.nDroite;
    this.lisses.count = this.nLisses;
    this.gauche.instanceMatrix.needsUpdate = true;
    this.droite.instanceMatrix.needsUpdate = true;
    this.lisses.instanceMatrix.needsUpdate = true;
  }

  /** Hauteur du pied du panneau i : le sol lu sous lui (dévers borné), sinon la hauteur du rail. */
  private hauteur(i: number, sol: SolBalises | null): number {
    if (this.poses[i]) return this.hauteurs[i] ?? 0;
    const d = this.plan.donnees;
    const o = i * BALISE_STRIDE;
    const ay = d[o + AY] ?? 0;
    let y = ay;
    if (sol) {
      const axis = sol.ground(d[o + AX] ?? 0, d[o + AZ] ?? 0, ay + 1.5);
      const h = sol.ground(d[o + PX] ?? 0, d[o + PZ] ?? 0, ay + 1.5);
      if (axis === axis && h === h) {
        const lim = POSE.deversMax * (d[o + LAT] ?? 0);
        y = axis + Math.max(-lim, Math.min(lim, h - axis));
      }
    }
    y -= POSE.enfoncement;
    this.hauteurs[i] = y;
    this.poses[i] = sol ? 1 : 0;
    return y;
  }

  private placer(i: number, sol: SolBalises | null): void {
    const d = this.plan.donnees;
    const o = i * BALISE_STRIDE;
    const y = this.hauteur(i, sol);
    this.p.set(d[o + PX] ?? 0, y, d[o + PZ] ?? 0);
    this.q.setFromEuler(this.e.set(0, d[o + CAP] ?? 0, 0));
    this.m.compose(this.p, this.q, this.sc);
    // Virage à gauche (sens +1) : pointe à gauche.
    if ((d[o + SENS] ?? 1) > 0) this.gauche.setMatrixAt(this.nGauche++, this.m);
    else this.droite.setMatrixAt(this.nDroite++, this.m);
  }

  private lisse(i: number, j: number): void {
    const d = this.plan.donnees;
    const a = i * BALISE_STRIDE;
    const b = j * BALISE_STRIDE;
    const xa = d[a + PX] ?? 0;
    const za = d[a + PZ] ?? 0;
    const xb = d[b + PX] ?? 0;
    const zb = d[b + PZ] ?? 0;
    // La carte a déjà sa glissière ici (à 0,3 m en dedans du bord, derrière le panneau) : on n'en ajoute pas.
    if (this.carte.a(xa, za) || this.carte.a(xb, zb)) return;
    const ya = this.hauteurs[i] ?? 0;
    const yb = this.hauteurs[j] ?? 0;
    const dx = xb - xa;
    const dz = zb - za;
    const plat = Math.hypot(dx, dz);
    if (plat < 0.5) return;
    const longueur = Math.hypot(plat, yb - ya);
    this.p.set(xa, ya, za);
    this.q.setFromEuler(this.e.set(0, headingOf(dx, dz), Math.atan2(yb - ya, plat)));
    this.sc.set(longueur, 1, 1);
    this.m.compose(this.p, this.q, this.sc);
    this.sc.set(1, 1, 1);
    this.lisses.setMatrixAt(this.nLisses++, this.m);
  }

  dispose(): void {
    this.group.remove(this.gauche, this.droite, this.lisses);
    for (const mesh of [this.gauche, this.droite, this.lisses]) mesh.dispose();
    for (const g of this.geometries) g.dispose();
    this.materiauPanneau.dispose();
    this.materiauLisse.dispose();
    if (liveVirages.current?.virages === this.virages) liveVirages.current = null;
  }
}
