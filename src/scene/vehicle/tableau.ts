// Instruments du tableau de bord (demande du 16 novembre 2026 : « le compteur reste à 0, ça serait top
// qu'il soit synchro avec le vrai compteur »). Un panneau de `cabin.panels` (manifeste) qui porte un
// `instrument` est dessiné ici sur une toile : un cadran rond à aiguille et graduations, ou un
// afficheur de chiffres à segments (avec une barre de régime facultative). Aucune police ni image
// téléchargée : les chiffres sont des segments dessinés à la main, l'unité emploie la police déjà servie.
//
// Partagé par le garage (src/scene/GarageCanvas.tsx : les instruments restent à zéro, dessinés une fois,
// rien n'est redessiné) et par la sortie de nuit (src/drive/scene/vehicule.tsx : ils suivent le pilote).
//
// Coût : un appel de dessin par panneau, comme avant ; une toile par instrument, réécrite et renvoyée
// au processeur graphique seulement quand la valeur AFFICHÉE change, dix fois par seconde au plus
// (`Rafraichisseur`). Aucune allocation par image : l'appel de `LiveInstrument.update` ne manipule que des nombres.

import { CanvasTexture, CircleGeometry, Color, Group, LinearFilter, Mesh, MeshBasicMaterial, PlaneGeometry, SRGBColorSpace, Vector3 } from 'three';
import type { Pilot } from '../../drive/contrat.ts';
import type { CabinPanel, PanelInstrument } from '../../data/vehicleTypes.ts';

/** Densité de la toile : pixels par mètre, bornés entre 128 et 512 sur la plus grande dimension. */
const PIXELS_PAR_METRE = 1400;

/** Intervalle minimal entre deux réécritures d'une toile, en millisecondes (dix par seconde). */
export const CADENCE_MS = 100;
/** Fin de plage d'un compteur de vitesse sans `max` au manifeste, en km/h. */
export const VITESSE_MAX = 240;
/** Fin de plage d'un cadran de régime au garage (aucun pilote n'en donne la fin), en tr/min. */
export const REGIME_MAX = 8000;
/** Cellules de la barre de régime d'un afficheur. */
export const CELLULES = 16;
/** Pas du régime affiché sur une aiguille, en tr/min. */
export const PAS_REGIME = 50;
/** Balayage d'un cadran sans `balayage` au manifeste : de −135° à +135°, depuis le haut, en degrés. */
export const BALAYAGE: readonly [number, number] = [-135, 135];

/** Vitesse affichée, en km/h entiers : la même formule que le compte-tours de l'écran (CompteTours.tsx). */
export function kmhAffiche(speed: number): number {
  return Number.isFinite(speed) ? Math.max(0, Math.round(speed * 3.6)) : 0;
}

/** Régime affiché sur une aiguille : arrondi au pas, jamais négatif. */
export function regimeAffiche(rpm: number): number {
  return Number.isFinite(rpm) ? Math.max(0, Math.round(rpm / PAS_REGIME) * PAS_REGIME) : 0;
}

/** Cellule allumée de la barre de régime (0 à CELLULES), pour un régime et la fin du cadran. */
export function cellulesAllumees(rpm: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(rpm)) return 0;
  return Math.min(CELLULES, Math.max(0, Math.round((rpm / max) * CELLULES)));
}

/** Fraction de la plage (0 à 1), bornée : en deçà de zéro ou au-delà du maximum, l'aiguille bute. */
export function fraction(value: number, max: number): number {
  if (!(max > 0) || !Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value / max));
}

/**
 * Angle de l'aiguille, en degrés, mesuré depuis le haut du cadran dans le sens horaire (0° : midi,
 * 90° : trois heures). `sens` antihoraire renverse le balayage.
 */
export function angleAiguille(value: number, max: number, balayage: readonly [number, number] = BALAYAGE, sens: 'horaire' | 'antihoraire' = 'horaire'): number {
  const angle = balayage[0] + fraction(value, max) * (balayage[1] - balayage[0]);
  return sens === 'antihoraire' ? -angle : angle;
}

/** Segments allumés de chaque chiffre : bits a (haut), b, c, d (bas), e, f, g (milieu). */
const SEGMENTS: readonly number[] = [0b0111111, 0b0000110, 0b1011011, 0b1001111, 0b1100110, 0b1101101, 0b1111101, 0b0000111, 0b1111111, 0b1101111];

/** Masque des segments d'un chiffre de 0 à 9 (0 pour tout autre nombre). */
export function segmentsDe(digit: number): number {
  return SEGMENTS[digit] ?? 0;
}

/** Valeur lue sur le pilote pour un instrument : km/h entiers ou tr/min (0 sans pilote ni moteur). */
export function mesureDe(mesure: PanelInstrument['mesure'], pilot: Pilot | null): number {
  if (mesure === 'vitesse') return kmhAffiche(pilot?.motion.speed ?? 0);
  const rpm = pilot?.train?.rpm ?? 0;
  return Number.isFinite(rpm) ? Math.max(0, rpm) : 0;
}

/** Fin de plage d'un instrument : le manifeste, sinon la fin du cadran du moteur (régime) ou 240 km/h. */
export function maxDe(instrument: PanelInstrument, mesure: PanelInstrument['mesure'], pilot: Pilot | null): number {
  if (instrument.max !== undefined) return instrument.max;
  if (mesure === 'vitesse') return VITESSE_MAX;
  return pilot?.train?.zones.max ?? REGIME_MAX;
}

/** Affichage retenu : le manifeste, sinon l'aiguille sur un disque et les chiffres sur un rectangle. */
export function affichageDe(panel: CabinPanel): 'aiguille' | 'chiffres' {
  return panel.instrument?.affichage ?? (panel.shape === 'disque' ? 'aiguille' : 'chiffres');
}

/**
 * Cadence d'écriture d'une toile : réécrit seulement si la valeur affichée a changé ET si la
 * dernière écriture date d'au moins `interval` ms. Une valeur retenue par la cadence n'est pas
 * perdue : elle diffère encore de la dernière écrite à l'appel suivant.
 */
export class Rafraichisseur {
  private a = Number.NaN;
  private b = Number.NaN;
  private at = -Infinity;
  writes = 0;
  private readonly interval: number;
  constructor(interval: number = CADENCE_MS) {
    this.interval = interval;
  }
  /** Vrai si la toile doit être réécrite (et enregistre l'écriture). */
  due(a: number, b: number, now: number): boolean {
    if (a === this.a && b === this.b) return false;
    if (now - this.at < this.interval) return false;
    this.a = a;
    this.b = b;
    this.at = now;
    this.writes += 1;
    return true;
  }
}

const rgba = (color: Color, alpha: number): string => `rgba(${Math.round(color.r * 255)},${Math.round(color.g * 255)},${Math.round(color.b * 255)},${alpha})`;
/** Rouge de la zone rouge d'un cadran de régime et des dernières cellules de la barre. */
const ROUGE = '#ff3b2a';

/** Zone rouge du cadran (tr/min, ou 0 : aucune), lue sur le pilote au moment de dessiner. */
function rougeDe(pilot: Pilot | null): number {
  return pilot?.train?.zones.rouge ?? 0;
}

type Ctx = CanvasRenderingContext2D;

function dessinerAiguille(ctx: Ctx, size: number, color: Color, instrument: PanelInstrument, value: number, max: number, rouge: number): void {
  const c = size / 2;
  const balayage = instrument.balayage ?? BALAYAGE;
  const sens = instrument.sens ?? 'horaire';
  const at = (angle: number, radius: number): [number, number] => {
    const a = (angle * Math.PI) / 180;
    return [c + Math.sin(a) * radius, c - Math.cos(a) * radius];
  };
  // Fond : noir opaque (la toile recouvre le support), puis le disque très atténué.
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = rgba(color, 0.13);
  ctx.beginPath();
  ctx.arc(c, c, c * 0.97, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineCap = 'round';
  // Graduations : une grande tous les ~1/8 de la plage, une petite entre elles.
  const major = max > 1000 ? (max > 10000 ? 2000 : 1000) : max > 120 ? 20 : 10;
  const minor = major / 2;
  for (let v = 0; v <= max + 1e-6; v += minor) {
    const big = Math.abs(v / major - Math.round(v / major)) < 1e-6;
    const [x0, y0] = at(angleAiguille(v, max, balayage, sens), c * (big ? 0.72 : 0.8));
    const [x1, y1] = at(angleAiguille(v, max, balayage, sens), c * 0.9);
    ctx.strokeStyle = rouge > 0 && v >= rouge ? ROUGE : rgba(color, big ? 1 : 0.55);
    ctx.lineWidth = size * (big ? 0.028 : 0.018);
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  // Aiguille : fine et lumineuse, avec un court contrepoids derrière le moyeu.
  const angle = angleAiguille(value, max, balayage, sens);
  const [tx, ty] = at(angle, c * 0.84);
  const [bx, by] = at(angle + 180, c * 0.16);
  ctx.strokeStyle = rgba(color, 1);
  ctx.lineWidth = size * 0.034;
  ctx.beginPath();
  ctx.moveTo(bx, by);
  ctx.lineTo(tx, ty);
  ctx.stroke();
  ctx.fillStyle = rgba(color, 1);
  ctx.beginPath();
  ctx.arc(c, c, size * 0.05, 0, Math.PI * 2);
  ctx.fill();
}

/** Mise en page d'un afficheur de chiffres sur sa toile (pixels de la toile) : partagée par le dessin et par la mesure de lisibilité. */
export interface PageChiffres {
  /** Bords gauche et droit de la zone utile, hauteur de la zone des chiffres. */
  xl: number;
  xr: number;
  zone: number;
  /** Les trois chiffres : hauteur, largeur, écart, épaisseur d'un segment, hauteur d'un segment vertical. */
  dh: number;
  dw: number;
  gap: number;
  t: number;
  hv: number;
  /** Coin haut gauche du bloc des trois chiffres. */
  x0: number;
  y0: number;
  /** Écran très large (écran de planche). */
  wide: boolean;
}

export function pageChiffres(w: number, h: number, barre: boolean, haut: number): PageChiffres {
  const wide = w / h > 2.5;
  // Très large (écran de planche) : chiffres à droite (le volant masque souvent la gauche d'un écran bas),
  // barre de régime en haut à gauche ; sinon la barre passe sous les chiffres.
  const margin = haut > 0 ? 0.15 : 0.05;
  const xl = margin * w;
  const xr = (1 - margin) * w;
  const zone = barre && !wide ? h * 0.78 : h; // hauteur de la zone des chiffres
  const dh = zone * (wide ? 0.6 : 0.62);
  const dw = dh * 0.56;
  const gap = dw * 0.3;
  const t = Math.max(2, dh * 0.13);
  const hv = (dh - 3 * t) / 2; // hauteur d'un segment vertical
  const block = 3 * dw + 2 * gap;
  const x0 = xr - block;
  const y0 = zone * (wide ? 0.3 : 0.14);
  return { xl, xr, zone, dh, dw, gap, t, hv, x0, y0, wide };
}

function dessinerChiffres(ctx: Ctx, w: number, h: number, color: Color, kmh: number, barre: boolean, rpm: number, max: number, rouge: number, haut: number): void {
  ctx.clearRect(0, 0, w, h);
  ctx.save();
  if (haut > 0) {
    // Écran en trapèze (bord haut plus étroit) : seul l'intérieur est opaque ; le reste est jeté (alphaTest).
    const inset = ((1 - haut) / 2) * w;
    ctx.beginPath();
    ctx.moveTo(inset, 0);
    ctx.lineTo(w - inset, 0);
    ctx.lineTo(w, h);
    ctx.lineTo(0, h);
    ctx.closePath();
    ctx.clip();
  }
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = rgba(color, 0.08);
  ctx.fillRect(0, 0, w, h);
  const { xl, xr, zone, dh, dw, gap, t, hv, x0, y0, wide } = pageChiffres(w, h, barre, haut);
  const value = Math.min(999, Math.max(0, Math.round(kmh)));
  const digits = [Math.floor(value / 100), Math.floor(value / 10) % 10, value % 10];
  for (let i = 0; i < 3; i += 1) {
    const x = x0 + i * (dw + gap);
    // Les zéros de tête restent éteints (« 7 » et non « 007 »).
    const blank = (i === 0 && value < 100) || (i === 1 && value < 10);
    const mask = blank ? 0 : segmentsDe(digits[i] ?? 0);
    for (let s = 0; s < 7; s += 1) {
      ctx.fillStyle = mask & (1 << s) ? rgba(color, 1) : rgba(color, 0.1);
      if (s === 0) ctx.fillRect(x + t, y0, dw - 2 * t, t); // a
      else if (s === 3) ctx.fillRect(x + t, y0 + dh - t, dw - 2 * t, t); // d
      else if (s === 6) ctx.fillRect(x + t, y0 + (dh - t) / 2, dw - 2 * t, t); // g
      else if (s === 1) ctx.fillRect(x + dw - t, y0 + t, t, hv); // b
      else if (s === 2) ctx.fillRect(x + dw - t, y0 + 2 * t + hv, t, hv); // c
      else if (s === 4) ctx.fillRect(x, y0 + 2 * t + hv, t, hv); // e
      else ctx.fillRect(x, y0 + t, t, hv); // f
    }
  }
  // Unité : la police déjà servie par l'app (repli sans empattement), petite, au pied des chiffres.
  ctx.fillStyle = rgba(color, 0.85);
  const font = Math.round(wide ? h * 0.2 : zone * 0.14);
  ctx.font = `${font}px 'Chakra Petch', sans-serif`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText('km/h', wide ? x0 - font * 2.6 : xl, y0 + dh);
  if (barre) {
    // Barre de régime : CELLULES cellules, les dernières en rouge à partir de la zone rouge.
    const lit = cellulesAllumees(rpm, max);
    const bx = xl;
    const bw = ((wide ? x0 - font * 3.2 : xr) - bx) / CELLULES;
    const by = wide ? h * 0.1 : h * 0.82;
    const bh = wide ? h * 0.2 : h * 0.12;
    for (let i = 0; i < CELLULES; i += 1) {
      const red = rouge > 0 && ((i + 0.5) / CELLULES) * max >= rouge;
      ctx.fillStyle = i < lit ? (red ? ROUGE : rgba(color, 1)) : rgba(color, 0.1);
      ctx.fillRect(bx + i * bw + bw * 0.1, by, bw * 0.8, bh);
    }
  }
  ctx.restore();
}

/** Dimensions de la toile d'un panneau, en pixels : 1 400 pixels par mètre, de 128 à 512 sur la plus grande dimension. */
export function dimensionsToile(panel: CabinPanel): { largeur: number; hauteur: number } {
  const [w, h] = panel.size;
  const scale = Math.min(512, Math.max(128, PIXELS_PAR_METRE * Math.max(w, h))) / Math.max(w, h);
  return { largeur: Math.max(32, Math.round(w * scale)), hauteur: Math.max(32, Math.round((panel.shape === 'disque' ? w : h) * scale)) };
}

/**
 * Zone utile d'un instrument de vitesse, en coordonnées de la toile ramenées à 0..1 (u vers la droite,
 * v vers le bas) : celle qu'il faut voir en entier. Un cadran : le disque des graduations ; un afficheur :
 * le bloc des trois chiffres. Sert à la mesure de ce que le volant en masque (tests/unit/tableau-vue.test.ts).
 */
export interface ZoneUtile {
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  contient(u: number, v: number): boolean;
}

export function zoneUtile(panel: CabinPanel): ZoneUtile {
  if (affichageDe(panel) === 'aiguille') {
    return { u0: 0.05, u1: 0.95, v0: 0.05, v1: 0.95, contient: (u, v) => Math.hypot(u - 0.5, v - 0.5) <= 0.45 };
  }
  const { largeur, hauteur } = dimensionsToile(panel);
  const haut = panel.haut !== undefined && panel.shape === 'rectangle' ? panel.haut / panel.size[0] : 0;
  const p = pageChiffres(largeur, hauteur, panel.instrument?.barre === 'regime', haut);
  return { u0: p.x0 / largeur, u1: p.xr / largeur, v0: p.y0 / hauteur, v1: (p.y0 + p.dh) / hauteur, contient: () => true };
}

/**
 * Un instrument vivant : sa toile, sa texture et sa cadence. Dessiné à zéro à la création (garage :
 * rien n'est ensuite redessiné) ; `update(pilot, now)` le fait suivre le pilote de la sortie et
 * renvoie vrai si la toile a été réécrite.
 */
export class LiveInstrument {
  readonly texture: CanvasTexture;
  readonly instrument: PanelInstrument;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: Ctx;
  private readonly color: Color;
  private readonly kind: 'aiguille' | 'chiffres';
  /** Largeur du bord haut sur celle du bas (0 : un rectangle). */
  private readonly haut: number;
  private readonly cadence = new Rafraichisseur();
  /** Le régime compte (cadran de régime, ou afficheur à barre de régime). */
  private readonly usesRpm: boolean;
  /** Dernière vitesse dessinée, en km/h (la valeur de `data-tableau`). */
  kmh = 0;
  /** Dernier régime dessiné, en tr/min. */
  rpm = 0;

  constructor(panel: CabinPanel & { instrument: PanelInstrument }) {
    this.instrument = panel.instrument;
    this.kind = affichageDe(panel);
    this.usesRpm = panel.instrument.mesure === 'regime' || panel.instrument.barre === 'regime';
    this.color = new Color(panel.color);
    this.haut = panel.haut !== undefined && panel.shape === 'rectangle' ? panel.haut / panel.size[0] : 0;
    this.canvas = document.createElement('canvas');
    const { largeur, hauteur } = dimensionsToile(panel);
    this.canvas.width = largeur;
    this.canvas.height = hauteur;
    const ctx = this.canvas.getContext('2d');
    if (!ctx) throw new Error('canvas 2D indisponible');
    this.ctx = ctx;
    this.texture = new CanvasTexture(this.canvas);
    this.texture.colorSpace = SRGBColorSpace;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = LinearFilter;
    this.texture.magFilter = LinearFilter;
    this.paint(0, 0, maxDe(panel.instrument, panel.instrument.mesure, null), 0);
  }

  private paint(kmh: number, rpm: number, max: number, rouge: number): void {
    this.kmh = kmh;
    this.rpm = rpm;
    if (this.kind === 'aiguille') {
      const mesure = this.instrument.mesure;
      dessinerAiguille(this.ctx, this.canvas.width, this.color, this.instrument, mesure === 'vitesse' ? kmh : rpm, max, mesure === 'regime' ? rouge : 0);
    } else dessinerChiffres(this.ctx, this.canvas.width, this.canvas.height, this.color, kmh, this.instrument.barre === 'regime', rpm, max, rouge, this.haut);
    this.texture.needsUpdate = true;
  }

  /**
   * Suit le pilote. Vrai si la toile a été réécrite : la valeur affichée a changé (km/h entier,
   * régime au pas de l'aiguille ou à la cellule de la barre) et la dernière écriture date de plus de
   * CADENCE_MS. Sans allocation : que des nombres.
   */
  update(pilot: Pilot | null, now: number): boolean {
    const kmh = kmhAffiche(pilot?.motion.speed ?? 0);
    let rpm = 0;
    let max = this.instrument.max ?? VITESSE_MAX;
    if (this.usesRpm) {
      rpm = mesureDe('regime', pilot);
      max = this.instrument.max ?? pilot?.train?.zones.max ?? REGIME_MAX;
    }
    const cells = cellulesAllumees(rpm, max);
    let a: number;
    let b: number;
    if (this.kind === 'aiguille') {
      rpm = regimeAffiche(rpm);
      a = this.instrument.mesure === 'vitesse' ? kmh : rpm;
      b = max;
    } else {
      a = kmh;
      b = this.instrument.barre === 'regime' ? max * 100 + cells : 0;
    }
    if (!this.cadence.due(a, b, now)) return false;
    this.paint(kmh, rpm, max, rougeDe(pilot));
    return true;
  }

  /** Nombre de réécritures de la toile depuis la création (tests, diagnostic). */
  get writes(): number {
    return this.cadence.writes;
  }

  dispose(): void {
    this.texture.dispose();
  }
}

/** Un panneau monté : son maillage, son instrument s'il en porte un, et de quoi tout libérer. */
export interface BuiltPanel {
  mesh: Mesh;
  live: LiveInstrument | null;
  dispose(): void;
}

/**
 * Le maillage d'un panneau de `cabin.panels` : disque ou rectangle face à sa normale, rétroéclairé.
 * Un panneau sans `instrument` reste une surface unie (comme avant) ; avec un instrument, sa toile.
 */
export function buildPanel(panel: CabinPanel): BuiltPanel {
  const [w, h] = panel.size;
  const geometry = panel.shape === 'disque' ? new CircleGeometry(w / 2, 48) : new PlaneGeometry(w, h);
  const intensity = panel.intensity ?? 1;
  const live = panel.instrument ? new LiveInstrument(panel as CabinPanel & { instrument: PanelInstrument }) : null;
  const material = live
    ? new MeshBasicMaterial({
        map: live.texture,
        color: new Color(1, 1, 1).multiplyScalar(intensity),
        toneMapped: false,
        fog: false,
        // Un écran en trapèze : le coin vide de la toile est jeté ; un panneau posé tout contre une surface du modèle la devance un peu.
        alphaTest: panel.haut !== undefined ? 0.5 : 0,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      })
    : new MeshBasicMaterial({ color: new Color(panel.color).multiplyScalar(intensity), toneMapped: false, fog: false });
  const mesh = new Mesh(geometry, material);
  mesh.position.set(...panel.center);
  mesh.lookAt(new Vector3(...panel.center).add(new Vector3(...panel.normal)));
  return {
    mesh,
    live,
    dispose() {
      geometry.dispose();
      material.dispose();
      live?.dispose();
    },
  };
}

/**
 * Le tableau de bord de la sortie de nuit : les panneaux à instrument du manifeste, groupés pour se
 * poser dans le repère du véhicule. À la caméra embarquée (`data-camera` de la scène) il est visible
 * et suit le pilote ; ailleurs il est masqué et rien n'est redessiné. Publie la vitesse affichée
 * (`data-tableau`) sur la scène pour les parcours. `frame` ne manipule que des nombres.
 */
export class TableauVivant {
  readonly group = new Group();
  private readonly built: BuiltPanel[];
  private readonly lives: LiveInstrument[] = [];
  private readonly speed: LiveInstrument | null;

  constructor(panels: readonly CabinPanel[]) {
    this.built = panels.filter((panel) => panel.instrument).map(buildPanel);
    this.group.name = 'tableau';
    this.group.visible = false;
    for (const panel of this.built) {
      this.group.add(panel.mesh);
      if (panel.live) this.lives.push(panel.live);
    }
    this.speed = this.lives.find((live) => live.instrument.mesure === 'vitesse') ?? null;
  }

  /** Aucun panneau à instrument : rien à monter. */
  get empty(): boolean {
    return this.built.length === 0;
  }

  /** Suit l'assiette de la caisse (hauteur, tangage), comme le garage. */
  pose(y: number, pitch: number): void {
    this.group.position.y = y;
    this.group.rotation.z = pitch;
  }

  /** Une image : visible et vivant à la caméra embarquée seulement ; `host` est l'élément de la scène. */
  frame(host: HTMLElement | null, pilot: Pilot | null, now: number): void {
    const shown = host?.dataset.camera === 'embarquee';
    if (this.group.visible !== shown) {
      this.group.visible = shown;
      // Hors de la caméra embarquée, la valeur publiée disparaît : plus rien n'est affiché.
      if (!shown && host) delete host.dataset.tableau;
    }
    if (!shown) return;
    let rewritten = false;
    for (let i = 0; i < this.lives.length; i += 1) if (this.lives[i]!.update(pilot, now)) rewritten = true;
    if (host && this.speed && (rewritten || host.dataset.tableau === undefined)) host.dataset.tableau = String(this.speed.kmh);
  }

  dispose(): void {
    for (const panel of this.built) panel.dispose();
  }
}
