// Le duel d'une sortie (§ 5.5, jeu) : l'adversaire, son pilote, la course et le contact, tenus ensemble pour
// la scène (src/drive/scene/moteur.ts), sans three.js. Ce que la suite réutilisera (la carrière et ses
// épreuves « battre l'adversaire », le rodéo côte à côte) :
// - créer un adversaire depuis une entrée de données : `new DuelEnCourse(adversaire, vehicule, rail)` ;
// - le poser sur une ligne et régler son allure : `depart(...)` ;
// - l'avancer avec le joueur à chaque image : `pas(...)` ;
// - lire sa position et l'écart : `duel.position`, `duel.ecart` ; savoir qui a gagné : `duel.verdict`.
// Aucune allocation par image.

import { adversaireParId, CONTACT_ADVERSAIRE, PILOTAGE_ADVERSAIRE, type Adversaire, type ReglageContact, type ReglagePilotage } from '../../data/adversaires.ts';
import { seuilsMedailles, tempsReference } from '../../data/courses.ts';
import type { FormatCourse } from '../../jeu/contrat.ts';
import type { VehicleManifest } from '../../data/vehicleTypes.ts';
import { vehicleById } from '../../data/vehicles.ts';
import type { Pilot, Rail, RailPose } from '../contrat.ts';
import { tenuSurLaLigne, type EtatDepart } from '../depart.ts';
import { createPilot, laneLimits, performanceDe, PILOT } from '../pilote.ts';
import { createPose } from '../rail.ts';
import { abscisseRetenue, createContact, devant, laneDuCote, pasContact, remettreContact, type CorpsRoute, type Retenue } from './contact.ts';
import { armerDuel, createDuel, pasDuel, type EtatDuel } from './duel.ts';
import { allureDe, createPiloteAdversaire, graineDe, pasAdversaire, remettreAdversaire, type PiloteAdversaire } from './pilotage.ts';

/** Allure d'un adversaire sur une course : le temps visé (seuil de sa médaille pour le véhicule du joueur) et sa conduite appliquée. */
export function allureDuel(adversaire: Pick<Adversaire, 'niveau' | 'vehicule'>, carte: string, depart: string, format: FormatCourse, vehiculeJoueur: string, reglage: ReglagePilotage = PILOTAGE_ADVERSAIRE): number {
  const joueur = tempsReference(carte, depart, format, vehiculeJoueur);
  const lui = tempsReference(carte, depart, format, adversaire.vehicule);
  const vise = joueur ? seuilsMedailles(joueur)[adversaire.niveau] : null;
  return allureDe(lui?.main, vise, reglage.sansReference[adversaire.niveau]);
}

export class DuelEnCourse {
  readonly adversaire: Adversaire;
  readonly vehicule: VehicleManifest;
  readonly pilote: PiloteAdversaire;
  readonly duel: EtatDuel;
  readonly contact = createContact();
  private readonly reglage: ReglageContact;
  private readonly rail: Rail;
  private readonly pose: RailPose = createPose();
  private readonly limites: [number, number] = [0, 0];
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

  constructor(adversaire: Adversaire, vehicule: VehicleManifest, rail: Rail, pilotage: ReglagePilotage = PILOTAGE_ADVERSAIRE, contact: ReglageContact = CONTACT_ADVERSAIRE) {
    this.adversaire = adversaire;
    this.vehicule = vehicule;
    this.rail = rail;
    this.reglage = contact;
    // Le véhicule tel qu'il sort du catalogue (pas de build, pas de pièces) : celui des temps de référence.
    const pilot = createPilot(rail, performanceDe(vehicule));
    this.pilote = createPiloteAdversaire(pilot, 1, pilotage, graineDe(adversaire.id));
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
  }

  get pret(): boolean {
    return this.modele !== 'attente';
  }

  /**
   * Nouveau départ : allure de la course, adversaire sur la ligne à côté du joueur (`sJoueur`,
   * `offsetJoueur`, mesures du joueur), du côté où il y a le plus de place. Si la chaussée n'y suffit pas
   * avec le joueur où il est, le joueur est rangé sur la droite de la chaussée et l'adversaire à sa gauche ;
   * trop étroite même ainsi, l'adversaire part en quinconce, juste derrière, sur le côté. Rend l'écart à
   * l'axe où poser le joueur (le sien, ou rangé à droite). `enPiste` faux : l'aperçu, l'adversaire n'est pas là.
   */
  depart(allure: number, sJoueur: number, offsetJoueur: number, demiLargeurJoueur: number, demiLongueurJoueur: number, tours: number, enPiste: boolean): number {
    this.enPiste = enPiste;
    this.pilote.allure = Math.min(1, Math.max(0.2, allure));
    remettreContact(this.contact);
    const rail = this.rail;
    const a = this.corpsA;
    rail.poseAt(sJoueur, this.pose);
    laneLimits(this.pose, this.vehicule.kind, a.demiLargeur, a.demiLongueur, this.limites);
    const [lo, hi] = this.limites;
    const g = demiLargeurJoueur + a.demiLargeur + this.reglage.garde;
    let joueur = offsetJoueur;
    const placeDroite = joueur - g - lo;
    const placeGauche = hi - (joueur + g);
    let s = sJoueur;
    let offset: number;
    if (placeDroite >= 0 || placeGauche >= 0) {
      offset = placeDroite >= placeGauche ? joueur - g : joueur + g;
      this.contact.cote = placeDroite >= placeGauche ? -1 : 1;
    } else {
      // Le joueur rangé à droite : sa borne est celle de l'adversaire décalée de la différence des demi-largeurs.
      joueur = lo + demiLargeurJoueur - a.demiLargeur;
      if (joueur + g <= hi) {
        offset = joueur + g;
        this.contact.cote = 1;
      } else {
        // Trop étroit pour deux de front : en quinconce, juste derrière, côté gauche.
        joueur = offsetJoueur;
        s = abscisseRetenue(sJoueur, demiLongueurJoueur + a.demiLongueur + 1, rail.length, rail.loop);
        offset = hi;
      }
    }
    remettreAdversaire(this.pilote, s, offset);
    this.pilote.lane = laneDuCote(this.contact.cote);
    this.offset = this.pilote.pilot.motion.offset;
    armerDuel(this.duel, this.pilote.pilot.motion.s, rail.loop, rail.loop ? tours : 1, devant(sJoueur, this.pilote.pilot.motion.s, rail.length, rail.loop));
    this.retenue = null;
    return joueur;
  }

  /**
   * Une image, après le pas du joueur et de son départ : l'adversaire avance (tenu tant que les feux ne sont
   * pas au vert), le contact le range ou retient celui de derrière, la course se mesure.
   */
  pas(dt: number, joueur: Pilot, departJoueur: EtatDepart, demiLargeurJoueur: number, demiLongueurJoueur: number): void {
    if (!this.enPiste) return;
    const rail = this.rail;
    const motion = pasAdversaire(this.pilote, dt, tenuSurLaLigne(departJoueur));
    rail.poseAt(motion.s, this.pose);
    laneLimits(this.pose, this.vehicule.kind, this.corpsA.demiLargeur, this.corpsA.demiLongueur, this.limites);
    const j = this.corpsJ;
    j.s = joueur.motion.s;
    j.offset = joueur.motion.offset;
    j.demiLargeur = demiLargeurJoueur;
    j.demiLongueur = demiLongueurJoueur;
    const a = this.corpsA;
    a.s = motion.s;
    a.offset = motion.offset;
    const retenue = pasContact(this.contact, j, a, this.limites[0], this.limites[1], this.reglage, dt, rail.length, rail.loop);
    this.pilote.lane = laneDuCote(this.contact.cote);
    const longueurs = j.demiLongueur + a.demiLongueur;
    if (retenue === 'joueur') {
      joueur.motion.s = abscisseRetenue(motion.s, longueurs, rail.length, rail.loop);
      joueur.motion.speed = Math.min(joueur.motion.speed, this.pilote.vitesse);
    } else if (retenue === 'adversaire') {
      motion.s = abscisseRetenue(joueur.motion.s, longueurs, rail.length, rail.loop);
      motion.speed = Math.min(motion.speed, joueur.motion.speed / Math.max(0.2, this.pilote.allureIci));
      this.pilote.vitesse = motion.speed * this.pilote.allureIci;
    }
    this.retenue = retenue;
    this.offset = motion.offset + this.contact.ecart;
    pasDuel(this.duel, departJoueur, dt, motion.s, rail, motion.finished);
  }
}

/**
 * Le duel de la sortie qui s'ouvre, d'après le choix du menu : `null` sans duel choisi, en balade, en
 * carrière, ou si l'adversaire ou son véhicule manquent au catalogue.
 */
export function duelDeLaSortie(choix: { actif: boolean; adversaire: string | null }, format: FormatCourse, carriere: boolean, rail: Rail): DuelEnCourse | null {
  if (!choix.actif || carriere || format === 'balade') return null;
  const adversaire = adversaireParId(choix.adversaire);
  const vehicule = adversaire ? vehicleById(adversaire.vehicule) : undefined;
  if (!adversaire || !vehicule) return null;
  return new DuelEnCourse(adversaire, vehicule, rail);
}

/** Le duel en cours, pour l'interface (position, écart, mini-carte) ; `null` hors duel. */
export const liveDuel: { current: DuelEnCourse | null } = { current: null };
