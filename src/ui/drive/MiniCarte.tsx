// Mini-carte de la sortie de nuit : un petit cadre où le tracé défile, orienté dans le sens de la marche
// (ce qui vient est en haut), le véhicule fixe en bas au centre, quelques centaines de mètres de route
// devant lui (l'échelle s'ouvre avec la vitesse), la ligne d'arrivée ou de tour quand elle approche, et
// le prochain virage mis en valeur, d'une couleur qui dit sa sévérité. Une flèche courbe l'annonce
// quand il est à quelques secondes (à la vitesse du moment) et s'efface une fois dedans. Ni texte ni voix.
//
// Comme le compte-tours, elle vit hors de React : une toile 2D redessinée une dizaine de fois par seconde
// (setInterval), l'annonce et les attributs mis à jour par référence, seulement quand ils changent.
// Rien n'est alloué à chaque dessin (tableaux et pose réservés une fois, aucun objet par point).
//
// Pour les parcours : data-visible (vrai en course : feux passés, arrivée non franchie),
// data-virage (« gauche:120 », « droite:30 » : sens et distance arrondie à 10 m du prochain virage ;
// « aucun » s'il n'y en a plus), data-virage-index (change dès qu'on l'a passé), data-virage-cran,
// data-dedans (indice du virage où l'on est, « non » sinon), data-annonce (la flèche est levée).

import { useEffect, useRef } from 'react';
import { REGLAGES_VIRAGES } from '../../data/virages.ts';
import { createPose } from '../../drive/rail.ts';
import { annonceActive, couleurDuCran, liveVirages, situationNeuve, situer } from '../../drive/virages.ts';
import { liveDepart, livePilot } from '../../state/drive.ts';
import { liveDuel } from '../../drive/adversaire/course.ts';
import { devant } from '../../drive/adversaire/contact.ts';
import './minicarte.css';

/** Côté du cadre, en pixels CSS. */
export const COTE = 124;
/** Réglage du dessin : place du véhicule (part de la hauteur), échelle, tracé. */
export const CARTE = {
  vehicule: 0.8,
  marge: 8,
  /** Portée devant le véhicule, en mètres : au repos, et en plus par m/s. */
  porteeMin: 200,
  porteeParVitesse: 7,
  porteeMax: 850,
  /** Points du tracé par dessin. */
  points: 96,
  /** Dessins par seconde. */
  cadence: 10,
  /** Adoucissement de l'échelle, par dessin. */
  lissage: 0.12,
} as const;

const SENS_NOM = ['droite', 'gauche'] as const;

export function MiniCarte() {
  const root = useRef<HTMLDivElement>(null);
  const toile = useRef<HTMLCanvasElement>(null);
  const annonce = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = root.current;
    const canvas = toile.current;
    const pastille = annonce.current;
    if (!el || !canvas || !pastille) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(COTE * dpr);
    canvas.height = Math.round(COTE * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    const N = CARTE.points;
    const xs = new Float32Array(N + 1);
    const ys = new Float32Array(N + 1);
    const abscisses = new Float32Array(N + 1);
    const cases = new Int16Array(N + 1);
    const pose = createPose();
    const situation = situationNeuve();
    const cx = COTE / 2;
    const cy = COTE * CARTE.vehicule;
    const hauteurUtile = cy - CARTE.marge;
    let portee: number = CARTE.porteeMin;
    // Valeurs affichées (n'écrire le DOM que si elles changent).
    const memo = { adversaire: '', visible: '', virage: '', index: '', cran: '', dedans: '', annonce: '', sens: '', couleur: '' };

    const ecrire = (cle: keyof typeof memo, attribut: string, valeur: string) => {
      if (memo[cle] === valeur) return;
      memo[cle] = valeur;
      el.setAttribute(attribut, valeur);
    };

    /** Projette le point de la pose courante dans le repère de la carte (avant en haut, gauche à gauche). */
    const projeter = (i: number, px: number, pz: number, fx: number, fz: number, k: number) => {
      const dx = pose.position[0] - px;
      const dz = pose.position[2] - pz;
      const devant = dx * fx + dz * fz;
      // Gauche de la marche : (tz, −tx).
      const gauche = dx * fz - dz * fx;
      xs[i] = cx - gauche * k;
      ys[i] = cy - devant * k;
    };

    const trait = (de: number, a: number) => {
      ctx.moveTo(xs[de]!, ys[de]!);
      for (let i = de + 1; i <= a; i += 1) ctx.lineTo(xs[i]!, ys[i]!);
    };

    const dessiner = () => {
      const depart = liveDepart.current;
      const pilote = livePilot.current;
      const donnees = liveVirages.current;
      const course = depart?.phase === 'parti' && pilote !== null && donnees !== null;
      ecrire('visible', 'data-visible', course ? 'true' : 'false');
      if (!course || !pilote || !donnees || document.hidden) return;
      const { rail, virages } = donnees;
      const s = pilote.motion.s;
      const vitesse = pilote.motion.speed;
      const longueur = rail.length;

      // Échelle : la portée s'ouvre avec la vitesse, adoucie.
      const but = Math.min(CARTE.porteeMax, CARTE.porteeMin + vitesse * CARTE.porteeParVitesse);
      portee += (but - portee) * CARTE.lissage;
      const k = hauteurUtile / portee;
      const derriere = (COTE - cy - 4) / k;
      const total = portee + derriere;

      rail.poseAt(s, pose);
      const px = pose.position[0];
      const pz = pose.position[2];
      const horiz = Math.hypot(pose.tangent[0], pose.tangent[2]) || 1;
      const fx = pose.tangent[0] / horiz;
      const fz = pose.tangent[2] / horiz;

      situer(virages, s, situation);
      const prochain = situation.prochain;
      const courant = situation.courant;

      // Points du tracé et virage où tombe chacun (−1 : en ligne).
      for (let i = 0; i <= N; i += 1) {
        const si = s - derriere + (i * total) / N;
        rail.poseAt(si, pose);
        projeter(i, px, pz, fx, fz, k);
        abscisses[i] = si;
        let c = -1;
        if (virages.liste.length > 0) {
          situer(virages, si, situation);
          c = situation.courant;
        }
        cases[i] = c;
      }
      // `situer` a écrit dans `situation` pendant le tracé : on relit celle du véhicule.
      situer(virages, s, situation);

      ctx.clearRect(0, 0, COTE, COTE);
      // Route : un liseré sombre, puis la chaussée (derrière : plus terne).
      const iv = Math.min(N, Math.max(0, Math.round((derriere / total) * N)));
      ctx.lineWidth = 7;
      ctx.strokeStyle = 'rgba(6,6,12,0.85)';
      ctx.beginPath();
      trait(0, N);
      ctx.stroke();
      ctx.lineWidth = 3.4;
      ctx.strokeStyle = 'rgba(120,126,150,0.55)';
      ctx.beginPath();
      trait(0, iv);
      ctx.stroke();
      ctx.strokeStyle = '#aab0c6';
      ctx.beginPath();
      trait(iv, N);
      ctx.stroke();

      // Virages : chacun de la couleur de son cran ; le prochain (et celui où l'on est) en plein et plus épais.
      let debut = 0;
      while (debut <= N) {
        const c = cases[debut]!;
        let fin = debut;
        while (fin + 1 <= N && cases[fin + 1] === c) fin += 1;
        if (c >= 0 && fin > debut) {
          const v = virages.liste[c]!;
          const mis = c === prochain || c === courant;
          ctx.lineWidth = mis ? 5.2 : 3.6;
          ctx.globalAlpha = mis ? 1 : 0.55;
          ctx.strokeStyle = couleurDuCran(v.cran);
          ctx.beginPath();
          trait(debut, fin);
          ctx.stroke();
        }
        debut = fin + 1;
      }
      ctx.globalAlpha = 1;

      // Ligne d'arrivée (parcours ouvert) ou de tour (boucle) quand elle est dans le cadre.
      let ligne = Number.NaN;
      if (!rail.loop) ligne = longueur;
      else if (depart) ligne = depart.ligne;
      if (ligne === ligne) {
        let d = ligne - s;
        if (rail.loop) d = (((d + derriere) % longueur) + longueur) % longueur - derriere;
        if (d > -derriere && d < portee) {
          rail.poseAt(s + d, pose);
          projeter(0, px, pz, fx, fz, k);
          const dx = pose.tangent[0];
          const dz = pose.tangent[2];
          const h = Math.hypot(dx, dz) || 1;
          // Perpendiculaire à la route, en damier de quatre cases.
          const angle = Math.atan2(-(dx * fx + dz * fz) / h, (dx * fz - dz * fx) / h);
          ctx.save();
          ctx.translate(xs[0]!, ys[0]!);
          ctx.rotate(angle);
          for (let i = 0; i < 6; i += 1) {
            ctx.fillStyle = i % 2 === 0 ? '#f4f1e6' : '#0d0d10';
            ctx.fillRect(-9 + i * 3, -1.5, 3, 3);
          }
          ctx.restore();
        }
      }

      // Duel : l'adversaire, un point de sa couleur sur le tracé, quand il est dans le cadre.
      const duel = liveDuel.current;
      if (duel && duel.enPiste) {
        const d = devant(s, duel.pilote.pilot.motion.s, longueur, rail.loop);
        if (d > -derriere && d < portee) {
          rail.poseAt(s + d, pose);
          projeter(0, px, pz, fx, fz, k);
          ctx.beginPath();
          ctx.arc(xs[0]!, ys[0]!, 4.5, 0, Math.PI * 2);
          ctx.fillStyle = duel.adversaire.couleur;
          ctx.strokeStyle = '#f4f1e6';
          ctx.lineWidth = 1.5;
          ctx.fill();
          ctx.stroke();
        }
        ecrire('adversaire', 'data-adversaire', d > -derriere && d < portee ? 'cadre' : 'hors');
      }

      // Le véhicule : une pointe claire, fixe, vers le haut.
      ctx.beginPath();
      ctx.moveTo(cx, cy - 7);
      ctx.lineTo(cx - 5, cy + 5);
      ctx.lineTo(cx, cy + 2.5);
      ctx.lineTo(cx + 5, cy + 5);
      ctx.closePath();
      ctx.fillStyle = '#f4f1e6';
      ctx.strokeStyle = 'rgba(6,6,12,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fill();

      // Attributs et annonce.
      const v = prochain >= 0 ? virages.liste[prochain] : undefined;
      const distance = Math.round(situation.distance / 10) * 10;
      ecrire('virage', 'data-virage', v ? `${SENS_NOM[v.sens > 0 ? 1 : 0]}:${distance}` : 'aucun');
      ecrire('index', 'data-virage-index', String(prochain));
      ecrire('cran', 'data-virage-cran', v ? String(v.cran) : '0');
      ecrire('dedans', 'data-dedans', courant >= 0 ? String(courant) : 'non');
      const levee = v !== undefined && courant < 0 && annonceActive(situation.distance, vitesse, REGLAGES_VIRAGES);
      if (v) {
        const sens = v.sens > 0 ? 'gauche' : 'droite';
        if (memo.sens !== sens) {
          memo.sens = sens;
          pastille.dataset.sens = sens;
        }
        const couleur = couleurDuCran(v.cran);
        if (memo.couleur !== couleur) {
          memo.couleur = couleur;
          pastille.style.color = couleur;
        }
        if (pastille.dataset.cran !== String(v.cran)) pastille.dataset.cran = String(v.cran);
      }
      const actif = String(levee);
      if (memo.annonce !== actif) {
        memo.annonce = actif;
        pastille.dataset.actif = actif;
        el.setAttribute('data-annonce', actif);
      }
    };

    dessiner();
    const timer = window.setInterval(dessiner, Math.round(1000 / CARTE.cadence));
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div ref={root} className="minicarte" role="img" aria-label="Mini-carte du parcours" data-visible="false" data-virage="aucun" data-annonce="false" data-dedans="non">
      <canvas ref={toile} style={{ width: COTE, height: COTE }} aria-hidden="true" />
      <span ref={annonce} className="minicarte-annonce" data-actif="false" data-sens="gauche" aria-hidden="true">
        <svg viewBox="0 0 32 32" focusable="false">
          <path className="mc-tige" d="M19 29 V19 Q19 11 11 11 H9" />
          <path className="mc-pointe" d="M10 3.5 L1.5 11 L10 18.5 Z" />
        </svg>
      </span>
    </div>
  );
}
