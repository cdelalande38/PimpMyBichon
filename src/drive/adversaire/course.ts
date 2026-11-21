// Le duel d'une sortie (§ 5.5, jeu) : l'adversaire, son pilote, la course et le contact, tenus ensemble pour
// la scène (src/drive/scene/moteur.ts), sans three.js. Ce que la suite réutilisera (la carrière et ses
// épreuves « battre l'adversaire », le rodéo côte à côte) :
// - créer un adversaire depuis une entrée de données : `new DuelEnCourse(adversaire, vehicule, rail, niveau)` ;
// - le poser sur la grille à côté du joueur : `depart(...)` ;
// - l'avancer avec le joueur à chaque image : `pas(...)` ;
// - lire sa position et l'écart : `duel.position`, `duel.ecart` ; savoir qui a gagné : `duel.verdict`.
// Aucune allocation par image.
//
// Le duel reste un duel quel que soit le véhicule du joueur : sans adversaire choisi au menu, c'est celui
// « à ta mesure » (`adversaireAMesure`) qui court, au même véhicule que le joueur s'il y en a un dans le fichier,
// sinon au véhicule le plus proche du sien en temps de référence. Un véhicule lent à fond reste lent : choisir
// la Comète avec la Cox, c'est choisir de perdre, et le menu le dit (« plus vif » ou « moins vif » que toi).
//
// La grille (`grilleDepart`) : sur la chaussée à la ligne, côte à côte quand elle a la place pour deux, chacun au
// milieu de sa moitié (le joueur du côté de sa trajectoire, l'adversaire de l'autre, contre son bord, à la place
// que sa direction assistée tient ; avants alignés), resserrés vers l'axe autant qu'il le faut ; sinon en quinconce : le joueur reste où il est, l'adversaire derrière lui, décalé de l'autre
// côté. Toujours dans les limites de chacun (garde au bord comprise), à `garde` m de flanc à flanc au moins.

import { ADVERSAIRES, adversaireParId, CONTACT_ADVERSAIRE, niveauDuel, PILOTAGE_ADVERSAIRE, type Adversaire, type NiveauDuel, type ReglageContact, type ReglagePilotage } from '../../data/adversaires.ts';
import { REFERENCES, type FichierCourses } from '../../data/courses.ts';
import type { FormatCourse } from '../../jeu/contrat.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import { vehicleById } from '../../data/vehicles.ts';
import type { Pilot, Rail, RailPose } from '../contrat.ts';
import { tenuSurLaLigne, type EtatDepart } from '../depart.ts';
import { createPilot, laneLimits, performanceDe, PILOT } from '../pilote.ts';
import { createPose } from '../rail.ts';
import { createContact, devant, laneDuCote, pasContact, reculer, remettreContact, type CorpsRoute, type Retenue } from './contact.ts';
import { armerDuel, createDuel, pasDuel, type EtatDuel } from './duel.ts';
import { createPiloteAdversaire, graineDe, pasAdversaire, remettreAdversaire, type PiloteAdversaire } from './pilotage.ts';

/** Trempe d'un véhicule : son temps de conduite appliquée sur la médiane du catalogue, en moyenne sur toutes les courses d'un tour connues (1 : dans la moyenne ; plus bas : plus vif). */
export function trempe(vehicule: string, references: Readonly<Record<string, FichierCourses>> = REFERENCES): number | null {
  let somme = 0;
  let n = 0;
  for (const carte of Object.values(references)) {
    for (const depart of Object.values(carte.departs)) {
      const t = depart.tour1;
      const v = t?.vehicules[vehicule];
      if (t && v) {
        somme += v.main / t.main;
        n += 1;
      }
    }
  }
  return n > 0 ? somme / n : null;
}

/** L'adversaire à la mesure du joueur : au même véhicule s'il y en a un, sinon au véhicule de trempe la plus proche (le premier du fichier à égalité). */
export function adversaireAMesure(vehiculeJoueur: string, liste: readonly Adversaire[] = ADVERSAIRES, references: Readonly<Record<string, FichierCourses>> = REFERENCES): Adversaire | undefined {
  const meme = liste.find((a) => a.vehicule === vehiculeJoueur);
  if (meme) return meme;
  const tj = trempe(vehiculeJoueur, references);
  if (tj === null) return liste[0];
  let best = liste[0];
  let ecart = Infinity;
  for (const a of liste) {
    const ta = trempe(a.vehicule, references);
    const d = ta === null ? Infinity : Math.abs(ta - tj);
    if (d < ecart) {
      ecart = d;
      best = a;
    }
  }
  return best;
}

/** Un véhicule sur la grille : ses demi-mesures (m) et son genre. */
export interface CorpsGrille {
  demiLargeur: number;
  demiLongueur: number;
  kind: 'car' | 'bike';
}

export interface Grille {
  mode: 'cote' | 'quinconce';
  /** Abscisses (m) et écarts à l'axe (m, positifs à gauche) du joueur et de l'adversaire. */
  sJoueur: number;
  offsetJoueur: number;
  sAdversaire: number;
  offsetAdversaire: number;
}

/** Distance de pare-chocs à pare-chocs en quinconce, en mètres. */
export const QUINCONCE = 1.2;

const POSE_GRILLE: RailPose = createPose();
const LIM_J: [number, number] = [0, 0];
const LIM_A: [number, number] = [0, 0];
const LIM_ICI: [number, number] = [0, 0];

/** Écarts permis à un véhicule posé en `s` sur toute sa longueur (arrière, milieu, avant : la chaussée peut changer de largeur sous lui). */
export function limitesSurLaLongueur(rail: Rail, s: number, corps: CorpsGrille, out: [number, number]): [number, number] {
  out[0] = -Infinity;
  out[1] = Infinity;
  for (let k = -1; k <= 1; k += 1) {
    laneLimits(rail.poseAt(s + k * corps.demiLongueur, POSE_GRILLE), corps.kind, corps.demiLargeur, corps.demiLongueur, LIM_ICI);
    out[0] = Math.max(out[0], LIM_ICI[0]);
    out[1] = Math.min(out[1], LIM_ICI[1]);
  }
  if (out[0] > out[1]) out[0] = out[1] = (out[0] + out[1]) / 2;
  return out;
}

/**
 * La grille de départ (voir l'en-tête) : le joueur en `sJoueur`, à `offsetJoueur` (sa place sans duel). Écrit
 * dans `out` et le rend. Sur une route ouverte, l'adversaire ne recule pas avant le début de la route : il part
 * alors devant le joueur, en quinconce (la scène avance la ligne de départ devant lui, `avanceSurLaLigne`).
 */
export function grilleDepart(rail: Rail, sJoueur: number, offsetJoueur: number, joueur: CorpsGrille, adv: CorpsGrille, garde: number, out: Grille): Grille {
  const largeur = rail.poseAt(sJoueur, POSE_GRILLE).width;
  // Avants alignés sur la ligne.
  let sCote = sJoueur + joueur.demiLongueur - adv.demiLongueur;
  if (!rail.loop) sCote = Math.max(0, sCote);
  // Le joueur garde le côté de sa trajectoire (sa direction assistée l'y ramène au vert sans croiser l'adversaire).
  const joueurAGauche = offsetJoueur > 0;
  limitesSurLaLongueur(rail, sJoueur, joueur, joueurAGauche ? LIM_A : LIM_J);
  limitesSurLaLongueur(rail, sCote, adv, joueurAGauche ? LIM_J : LIM_A);
  // LIM_J : le véhicule de droite ; LIM_A : celui de gauche.
  const [loD, hiD] = LIM_J;
  const [loG, hiG] = LIM_A;
  const D = joueur.demiLargeur + adv.demiLargeur + garde;
  out.sJoueur = sJoueur;
  if (hiG - loD >= D - 1e-9 && hiD >= loD && hiG >= loG) {
    // Côte à côte : centres à une demi-chaussée l'un de l'autre (chacun au milieu de sa moitié), resserrés s'il le faut.
    const d = Math.min(hiG - loD, Math.max(D, largeur / 2));
    const m = Math.min(Math.min(hiG, hiD + d) - d / 2, Math.max(Math.max(loD, loG - d) + d / 2, 0));
    out.mode = 'cote';
    out.offsetJoueur = joueurAGauche ? m + d / 2 : m - d / 2;
    // L'adversaire à la place que sa direction assistée tient quand il serre son bord (src/drive/adversaire/contact.ts) :
    // au vert, il part tout droit, sans crochet. Jamais plus près du joueur que le milieu de sa moitié.
    const bord = joueurAGauche ? Math.min(m - d / 2, loD + PILOT.lane.request) : Math.max(m + d / 2, hiG - PILOT.lane.request);
    out.offsetAdversaire = bord;
    out.sAdversaire = sCote;
    return out;
  }
  out.mode = 'quinconce';
  out.offsetJoueur = offsetJoueur;
  const longueurs = joueur.demiLongueur + adv.demiLongueur + QUINCONCE;
  let s = sJoueur - longueurs;
  if (rail.loop) s = ((s % rail.length) + rail.length) % rail.length;
  else if (s < 0) s = Math.min(rail.length, sJoueur + longueurs);
  out.sAdversaire = s;
  // De l'autre côté du joueur, à la limite de l'adversaire là où il est.
  limitesSurLaLongueur(rail, s, adv, LIM_A);
  out.offsetAdversaire = offsetJoueur <= (LIM_A[0] + LIM_A[1]) / 2 ? Math.max(LIM_A[0], LIM_A[1] - PILOT.lane.request) : Math.min(LIM_A[1], LIM_A[0] + PILOT.lane.request);
  return out;
}

export class DuelEnCourse {
  readonly adversaire: Adversaire;
  readonly vehicule: VehicleManifest;
  readonly pilote: PiloteAdversaire;
  readonly duel: EtatDuel;
  readonly contact = createContact();
  private readonly reglage: ReglageContact;
  private readonly rail: Rail;
  private readonly limites: [number, number] = [0, 0];
  private readonly limitesJ: [number, number] = [0, 0];
  private readonly corpsJ: CorpsRoute = { s: 0, offset: 0, demiLargeur: 0.95, demiLongueur: 2.2 };
  private readonly corpsA: CorpsRoute = { s: 0, offset: 0, demiLargeur: 0.95, demiLongueur: 2.2 };
  /** Écart à l'axe montré (son pilote, plus le décalage d'évitement), m. */
  offset = 0;
  /** En course (feux armés) : l'adversaire est montré ; dans l'aperçu, il n'est pas là. */
  enPiste = false;
  /** Modèle posé (ou tombé : la course se court quand même, l'adversaire invisible). */
  modele: 'attente' | 'pret' | 'absent' = 'attente';
  /** Dernière retenue (pour les parcours). */
  retenue: Retenue = null;
  readonly niveau: NiveauDuel;
  /** La grille du dernier départ (pour les parcours et les tests). */
  readonly grille: Grille = { mode: 'cote', sJoueur: 0, offsetJoueur: 0, sAdversaire: 0, offsetAdversaire: 0 };
  /** Le joueur et ses mesures au dernier départ : la grille est refaite quand un modèle arrive avant les feux. */
  private joueur: Pilot | null = null;
  private readonly corpsGJ: CorpsGrille = { demiLargeur: 0.95, demiLongueur: 2.2, kind: 'car' };
  private readonly corpsGA: CorpsGrille = { demiLargeur: 0.95, demiLongueur: 2.2, kind: 'car' };
  /** Appelé après chaque grille posée (la scène y avance la ligne de départ si l'adversaire part devant). */
  surGrille: (() => void) | null = null;
  private sLigne = 0;
  private offsetLigne = 0;
  private tours = 1;

  constructor(adversaire: Adversaire, vehicule: VehicleManifest, rail: Rail, niveau: NiveauDuel, pilotage: ReglagePilotage = PILOTAGE_ADVERSAIRE, contact: ReglageContact = CONTACT_ADVERSAIRE) {
    this.adversaire = adversaire;
    this.niveau = niveau;
    this.vehicule = vehicule;
    this.rail = rail;
    this.reglage = contact;
    // Le véhicule tel qu'il sort du catalogue (pas de build, pas de pièces) : celui des temps de référence.
    const pilot = createPilot(rail, performanceDe(vehicule));
    this.pilote = createPiloteAdversaire(pilot, niveau, pilotage, graineDe(adversaire.id));
    const kind = vehicule.kind;
    this.corpsA.demiLargeur = PILOT.halfWidth[kind];
    this.corpsA.demiLongueur = PILOT.halfLength[kind];
    // Toute la course au plus (trois tours d'une boucle, ou la route) : relevés réservés une fois.
    this.duel = createDuel(rail.length * 3 + 50);
  }

  /** Mesures du modèle posé (demi-largeur, demi-longueur, m). */
  mesurer(demiLargeur: number, demiLongueur: number): void {
    this.corpsA.demiLargeur = demiLargeur;
    this.corpsA.demiLongueur = demiLongueur;
    this.pilote.pilot.setSize(demiLargeur, demiLongueur);
    this.regriller();
  }

  /** Le modèle du joueur posé : ses mesures, et la grille refaite si les feux ne sont pas encore partis. */
  mesurerJoueur(demiLargeur: number, demiLongueur: number): void {
    this.corpsGJ.demiLargeur = demiLargeur;
    this.corpsGJ.demiLongueur = demiLongueur;
    this.regriller();
  }

  private regriller(): void {
    const j = this.joueur;
    if (!j || !this.enPiste || this.duel.lance) return;
    this.depart(j, this.corpsGJ.kind, this.sLigne, this.offsetLigne, this.corpsGJ.demiLargeur, this.corpsGJ.demiLongueur, this.tours, true);
  }

  get pret(): boolean {
    return this.modele !== 'attente';
  }

  /**
   * Nouveau départ : la grille (`grilleDepart`) à la ligne du joueur (`sJoueur`, `offsetJoueur` : sa place sans
   * duel). Range le joueur à sa place sur la grille (`joueur.motion`, repris par son pilote au premier pas) et
   * l'adversaire à la sienne. `enPiste` faux : l'aperçu, l'adversaire n'est pas là et le joueur ne bouge pas.
   */
  depart(joueur: Pilot, kindJoueur: 'car' | 'bike', sJoueur: number, offsetJoueur: number, demiLargeurJoueur: number, demiLongueurJoueur: number, tours: number, enPiste: boolean): void {
    this.enPiste = enPiste;
    this.joueur = joueur;
    this.sLigne = sJoueur;
    this.offsetLigne = offsetJoueur;
    this.tours = tours;
    this.corpsGJ.demiLargeur = demiLargeurJoueur;
    this.corpsGJ.demiLongueur = demiLongueurJoueur;
    this.corpsGJ.kind = kindJoueur;
    this.corpsGA.demiLargeur = this.corpsA.demiLargeur;
    this.corpsGA.demiLongueur = this.corpsA.demiLongueur;
    this.corpsGA.kind = this.vehicule.kind;
    remettreContact(this.contact);
    const rail = this.rail;
    const g = grilleDepart(rail, sJoueur, offsetJoueur, this.corpsGJ, this.corpsGA, this.reglage.garde, this.grille);
    if (enPiste) joueur.motion.offset = g.offsetJoueur;
    remettreAdversaire(this.pilote, g.sAdversaire, g.offsetAdversaire);
    this.contact.cote = g.offsetAdversaire >= g.offsetJoueur ? 1 : -1;
    this.pilote.lane = laneDuCote(this.contact.cote);

    this.offset = this.pilote.pilot.motion.offset;
    armerDuel(this.duel, this.pilote.pilot.motion.s, rail.loop, rail.loop ? tours : 1, devant(sJoueur, this.pilote.pilot.motion.s, rail.length, rail.loop));
    this.retenue = null;
    this.surGrille?.();
  }

  /** De combien (m) l'avant de l'adversaire dépasse celui du joueur sur la grille (0 : aligné ou derrière, ou hors course). */
  get avanceSurLaLigne(): number {
    if (!this.enPiste) return 0;
    const g = this.grille;
    return Math.max(0, devant(g.sJoueur, g.sAdversaire, this.rail.length, this.rail.loop) + this.corpsGA.demiLongueur - this.corpsGJ.demiLongueur);
  }

  /**
   * Une image, après le pas du joueur et de son départ : l'adversaire avance (tenu tant que les feux ne sont
   * pas au vert), le contact les gêne l'un l'autre, la course se mesure. `auto` : le joueur en pilote
   * automatique (son pilote garde son écart d'une image à l'autre : on ne le pousse pas de côté).
   */
  pas(dt: number, joueur: Pilot, departJoueur: EtatDepart, demiLargeurJoueur: number, demiLongueurJoueur: number, auto = false): void {
    if (!this.enPiste) return;
    const rail = this.rail;
    const tenu = tenuSurLaLigne(departJoueur);
    const motion = pasAdversaire(this.pilote, dt, tenu);
    // Sur la grille, rien ne bouge de côté : la place est déjà sûre.
    if (tenu) {
      this.offset = motion.offset + this.contact.ecart;
      return;
    }
    this.corpsGA.demiLargeur = this.corpsA.demiLargeur;
    this.corpsGA.demiLongueur = this.corpsA.demiLongueur;
    limitesSurLaLongueur(rail, motion.s, this.corpsGA, this.limites);
    this.corpsGJ.demiLargeur = demiLargeurJoueur;
    this.corpsGJ.demiLongueur = demiLongueurJoueur;
    limitesSurLaLongueur(rail, joueur.motion.s, this.corpsGJ, this.limitesJ);
    if (auto) this.limitesJ[0] = this.limitesJ[1] = joueur.motion.offset;
    const j = this.corpsJ;
    j.s = joueur.motion.s;
    j.offset = joueur.motion.offset;
    j.demiLargeur = demiLargeurJoueur;
    j.demiLongueur = demiLongueurJoueur;
    const a = this.corpsA;
    a.s = motion.s;
    a.offset = motion.offset;
    const c = this.contact;
    // Un véhicule arrivé ne bloque plus l'autre : il passe, au travers s'il le faut. L'arrivée de l'adversaire est
    // comptée plus bas (pasDuel) : au bout d'une route ouverte, où il s'arrête net, elle vaut dès ce pas.
    const arrivee = departJoueur.phase === 'arrive' || this.duel.adv.phase === 'arrive' || motion.finished;
    const retenue = pasContact(c, j, a, this.limites[0], this.limites[1], this.limitesJ[0], this.limitesJ[1], this.reglage, dt, rail.length, rail.loop, arrivee);
    this.pilote.lane = laneDuCote(c.cote);
    // La poussée du joueur s'ajoute à l'écart de son pilote (reprise à chaque image, elle retombe sans contact).
    joueur.motion.offset += c.pousse;
    if (c.frotte) {
      // Flanc contre flanc : les deux perdent de la vitesse.
      const perte = this.reglage.frottement * Math.max(0, Number.isFinite(dt) ? dt : 0);
      joueur.motion.speed = Math.max(0, joueur.motion.speed - perte);
      motion.speed = Math.max(0, motion.speed - perte);
    }
    // Celui de derrière s'arrête contre celui de devant (quelques centimètres par pas, jamais un saut).
    if (retenue === 'joueur') {
      joueur.motion.s = reculer(joueur.motion.s, c.recul, rail.length, rail.loop);
      joueur.motion.speed = Math.min(joueur.motion.speed, motion.speed);
    } else if (retenue === 'adversaire') {
      motion.s = reculer(motion.s, c.recul, rail.length, rail.loop);
      motion.speed = Math.min(motion.speed, joueur.motion.speed);
    }
    this.pilote.vitesse = motion.speed;
    this.pilote.sAvant = motion.s;
    this.retenue = retenue;
    this.offset = motion.offset + this.contact.ecart;
    pasDuel(this.duel, departJoueur, dt, motion.s, rail, motion.finished);
  }
}

/** Le choix du menu (src/drive/adversaire/choix.ts) résolu : l'adversaire (choisi, sinon à la mesure du joueur) et le niveau. */
export function duelChoisi(choix: { adversaire: string | null; niveau: string | null }, vehiculeJoueur: string): { adversaire: Adversaire; niveau: NiveauDuel } | null {
  const adversaire = adversaireParId(choix.adversaire) ?? adversaireAMesure(vehiculeJoueur);
  const niveau = niveauDuel(choix.niveau);
  return adversaire && niveau ? { adversaire, niveau } : null;
}

/**
 * Le duel de la sortie qui s'ouvre, d'après le choix du menu : `null` sans duel choisi, en balade, en
 * carrière, ou si l'adversaire ou son véhicule manquent au catalogue.
 */
export function duelDeLaSortie(choix: { actif: boolean; adversaire: string | null; niveau: string | null }, format: FormatCourse, carriere: boolean, rail: Rail, vehiculeJoueur: string): DuelEnCourse | null {
  if (!choix.actif || carriere || format === 'balade') return null;
  const c = duelChoisi(choix, vehiculeJoueur);
  const vehicule = c ? vehicleById(c.adversaire.vehicule) : undefined;
  if (!c || !vehicule) return null;
  return new DuelEnCourse(c.adversaire, vehicule, rail, c.niveau);
}

/** Le duel en cours, pour l'interface (position, écart, mini-carte) ; `null` hors duel. */
export const liveDuel: { current: DuelEnCourse | null } = { current: null };
