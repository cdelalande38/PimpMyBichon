// Lignes de départ et d'arrivée de la sortie de nuit (src/drive/depart.ts) : une bande en damier noir
// et blanc sur toute la largeur de la chaussée, dessinée par le code (aucune image, aucun texte). La
// ligne de départ est posée juste devant le véhicule, à l'abscisse du départ choisi ; la ligne
// d'arrivée finit au bout d'un parcours ouvert (une boucle n'a que la ligne de départ).
//
// Elle épouse la chaussée : posée sur le relief des tronçons chargés (src/drive/scene/relief.ts), pente
// et dévers compris, recalée quand un tronçon arrive ; sur le rail en attendant. Comme le marquage, elle est tirée vers
// la caméra (décalage de profondeur) pour ne jamais scintiller sur l'enrobé, et elle reçoit les phares
// et les lampadaires (patch de nuit du marquage). Un appel de dessin par ligne, deux au plus ; aucune
// allocation par image.

import { BufferAttribute, BufferGeometry, Color, Group, Mesh, MeshStandardMaterial } from 'three';
import { NO_MIRROR_LAYER } from '../../render/layers.ts';
import type { Rail, RailPose } from '../contrat.ts';
import { createPose } from '../rail.ts';
import { patchNight, type NightUniforms } from './materiaux.ts';

export const LIGNES = {
  /** Côté visé d'une case du damier, en mètres (ajusté pour tomber juste sur la largeur). */
  caseVisee: 0.55,
  /** Rangées de cases dans la longueur. */
  rangees: 2,
  /**
   * Hauteur au-dessus de la chaussée, en mètres (en plus du décalage de profondeur) : au-dessus du relief
   * (qui garde le point le plus haut de chaque case de 2 m, jamais sous l'enrobé), ou du rail tant que le
   * tronçon n'est pas chargé (l'enrobé dessiné peut être quelques centimètres au-dessus du rail).
   */
  hausse: 0.02,
  hausseSansRelief: 0.08,
  /** Dévers le plus fort accepté du relief, en m/m (au-delà : bord de talus ou mur, ignoré). */
  deversMax: 0.08,
  /** Écart à la ligne au-delà duquel elle n'est pas dessinée, en mètres. */
  portee: 1500,
  /** Écart entre l'avant du véhicule et la ligne de départ, en mètres. */
  devant: 0.4,
  blanc: '#e9e7e0',
  noir: '#0d0d10',
} as const;

/** Ce que la ligne lit du relief : la hauteur du sol au point (x, z), pour qui est à la hauteur y. */
export interface SolLignes {
  readonly size: number;
  ground(x: number, z: number, y?: number): number;
}

interface Ligne {
  mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  /** Abscisse du début de la bande et sa longueur, en mètres. */
  from: number;
  depth: number;
  cols: number;
  /** Abscisse de référence (pour la portée). */
  at: number;
}

/** Les lignes d'une sortie : posées à chaque départ, recalées sur le relief, libérées au démontage. */
export class LignesDepart {
  readonly group = new Group();
  private readonly material: MeshStandardMaterial;
  private readonly lines: Ligne[] = [];
  private readonly pose: RailPose = createPose();
  private rail: Rail | null = null;
  private reliefSize = -1;

  constructor(uniforms: NightUniforms) {
    this.group.name = 'lignes-depart';
    const m = new MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.6, metalness: 0, envMapIntensity: 0 });
    m.name = 'nuit_damier';
    m.polygonOffset = true;
    m.polygonOffsetFactor = -1;
    m.polygonOffsetUnits = -4;
    this.material = patchNight(m, uniforms, { lamps: { diffuse: 1.6, spec: 1.6 }, wet: { rough: 0.25 }, reflect: true, retro: 4 });
  }

  /** Pose la ligne de départ devant le véhicule (centre à `s`, demi-longueur `halfLength`) et l'arrivée. */
  poser(rail: Rail, s: number, halfLength: number): void {
    this.clear();
    this.rail = rail;
    const depth = LIGNES.caseVisee * LIGNES.rangees;
    const start = s + Math.max(0.5, halfLength) + LIGNES.devant;
    this.add(rail, rail.loop ? start : Math.min(start, Math.max(0, rail.length - depth)), depth, s);
    if (!rail.loop && rail.length - start > depth * 4) this.add(rail, rail.length - depth, depth, rail.length);
    this.reliefSize = -1;
  }

  /** À chaque image : portée autour du véhicule ; recalage sur le relief quand un tronçon arrive. */
  update(sol: SolLignes | null, s: number): void {
    const rail = this.rail;
    if (!rail) return;
    for (const line of this.lines) {
      let d = Math.abs(s - line.at);
      if (rail.loop && rail.length > 0) d = Math.min(d, rail.length - (d % rail.length));
      line.mesh.visible = d < LIGNES.portee;
    }
    if (sol && sol.size !== this.reliefSize) {
      this.reliefSize = sol.size;
      for (const line of this.lines) this.shape(line, sol);
    }
  }

  get count(): number {
    return this.lines.length;
  }

  private add(rail: Rail, from: number, depth: number, at: number): void {
    const width = rail.poseAt(from + depth / 2, this.pose).width;
    const cols = Math.max(4, Math.round(width / LIGNES.caseVisee));
    const quads = cols * LIGNES.rangees;
    const geometry = new BufferGeometry();
    const positions = new Float32Array(quads * 4 * 3);
    const colors = new Float32Array(quads * 4 * 3);
    const index = new Uint16Array(quads * 6);
    const white = new Color(LIGNES.blanc);
    const black = new Color(LIGNES.noir);
    for (let r = 0; r < LIGNES.rangees; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        const q = r * cols + c;
        const tint = (r + c) % 2 === 0 ? white : black;
        for (let k = 0; k < 4; k += 1) {
          colors[(q * 4 + k) * 3] = tint.r;
          colors[(q * 4 + k) * 3 + 1] = tint.g;
          colors[(q * 4 + k) * 3 + 2] = tint.b;
        }
        // Deux triangles, face vers le haut (sommets : arrière droite, arrière gauche, avant gauche, avant droite).
        const v = q * 4;
        index.set([v, v + 2, v + 1, v, v + 3, v + 2], q * 6);
      }
    }
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    geometry.setAttribute('color', new BufferAttribute(colors, 3));
    geometry.setIndex(new BufferAttribute(index, 1));
    const mesh = new Mesh(geometry, this.material);
    mesh.name = 'ligne-damier';
    mesh.layers.set(NO_MIRROR_LAYER);
    mesh.frustumCulled = true;
    const line: Ligne = { mesh, from, depth, cols, at };
    this.shape(line, null);
    this.lines.push(line);
    this.group.add(mesh);
  }

  /** Sommets de la bande : sur le relief à l'axe (pente), plus le dévers lu de part et d'autre, borné. */
  private shape(line: Ligne, sol: SolLignes | null): void {
    const rail = this.rail;
    if (!rail) return;
    const pose = this.pose;
    const geometry = line.mesh.geometry;
    const positions = geometry.getAttribute('position') as BufferAttribute;
    const array = positions.array as Float32Array;
    const rows = LIGNES.rangees;
    const cols = line.cols;
    for (let j = 0; j <= rows; j += 1) {
      rail.poseAt(line.from + (j * line.depth) / rows, pose);
      const tx = pose.tangent[0];
      const tz = pose.tangent[2];
      const hl = Math.hypot(tx, tz) || 1;
      // Gauche de la marche (comme l'écart latéral du pilote, src/drive/scene/moteur.ts).
      const lx = tz / hl;
      const lz = -tx / hl;
      const [ax, ay, az] = pose.position;
      const half = pose.width / 2;
      const axis = sol ? sol.ground(ax, az, ay + 1.5) : Number.NaN;
      for (let i = 0; i <= cols; i += 1) {
        const lateral = -half + (i * pose.width) / cols;
        const x = ax + lx * lateral;
        const z = az + lz * lateral;
        let bank = 0;
        if (sol && axis === axis) {
          const h = sol.ground(x, z, ay + 1.5);
          if (h === h) bank = Math.max(-LIGNES.deversMax * Math.abs(lateral), Math.min(LIGNES.deversMax * Math.abs(lateral), h - axis));
        }
        const y = sol && axis === axis ? axis + bank + LIGNES.hausse : ay + LIGNES.hausseSansRelief;
        // Chaque coin de grille appartient à jusqu'à quatre cases (sommets non partagés : couleurs franches).
        for (let dr = -1; dr <= 0; dr += 1) {
          const r = j + dr;
          if (r < 0 || r >= rows) continue;
          for (let dc = -1; dc <= 0; dc += 1) {
            const c = i + dc;
            if (c < 0 || c >= cols) continue;
            // Coin de la case (r, c) : arrière (dr = 0) ou avant (dr = -1) ; droite (dc = 0) ou gauche (dc = -1).
            const back = dr === 0;
            const right = dc === 0;
            const k = back ? (right ? 0 : 1) : right ? 3 : 2;
            const o = ((r * cols + c) * 4 + k) * 3;
            array[o] = x;
            array[o + 1] = y;
            array[o + 2] = z;
          }
        }
      }
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();
  }

  private clear(): void {
    for (const line of this.lines) {
      this.group.remove(line.mesh);
      line.mesh.geometry.dispose();
    }
    this.lines.length = 0;
  }

  dispose(): void {
    this.clear();
    this.material.dispose();
    this.rail = null;
  }
}
