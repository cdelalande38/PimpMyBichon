// Lecteur des bruitages de route en sortie de nuit (§ 5.5 « Son », § 9) : roulement, vent, pluie,
// tunnel, NOS, dérapage long (les pneus qui glissent) en boucles ; freinage, dérapage court, rapport,
// coup d'envoi du NOS, retour de flamme en ponctuels. Même contexte
// audio et même sortie (limiteur) que le moteur (src/audio/engine/lecteur.ts), avec son propre
// gain : le curseur « Route ». Qui joue quoi : src/data/bruitages.ts ; règles : ./regles.ts.
//
// - L'index des bruitages (public/assets/audio/sfx/route/sfx.json) est lu une fois par session :
//   absent ou illisible, tout reste muet, sans erreur et sans nouvelle requête.
// - Un emplacement sans fichier reste muet. Rien n'est synthétisé : uniquement des prises.
// - `mettreAJour` est appelé dix fois par seconde par src/drive/son.ts : il ne fait que des rampes
//   sur des nœuds déjà créés (aucune allocation) ; un ponctuel crée sa source à son départ.

import { BOUCLES_ROUTE, FAMILLE_ROUTE, FONDU_BOUCLES, PONCTUELS_ROUTE, type BoucleRoute } from '../../data/bruitages.ts';
import { engineFileUrl, parseEngineManifest } from '../engine/manifeste.ts';
import { parseSfxManifest, sfxFileUrl, type SfxBoucle, type SfxManifest, type SfxPonctuel } from './manifeste.ts';
import { feuxSon } from './feux.ts';
import { copierInstant, coupureBoucle, hauteurBoucle, niveauBoucle, ponctuelPart, suiviGlisseRepos, suivreGlisse, type EtatRoute, type InstantRoute, type SuiviGlisse } from './regles.ts';

/** Un son décodé, avec son gain de lecture (dB). */
interface Prise {
  buffer: AudioBuffer;
  gain: number;
}

interface Jeu {
  boucles: Map<string, { entree: SfxBoucle; buffer: AudioBuffer }>;
  ponctuels: Map<string, Prise[]>;
}

interface Voix {
  boucle: BoucleRoute;
  source: AudioBufferSourceNode;
  gain: GainNode;
  filtre: BiquadFilterNode | null;
  /** Suivi de la glisse (hystérésis, rampes) d'une boucle de glisse ; null pour les autres. */
  suivi: SuiviGlisse | null;
  /** Gain de lecture de la prise (linéaire). */
  base: number;
}

const dbToGain = (db: number) => 10 ** (db / 20);

/** Constante de temps des rampes de niveau et de hauteur à chaque mise à jour (s). */
const LISSAGE = 0.12;

/** Un instant neutre (véhicule arrêté). */
export function instantRepos(): InstantRoute {
  return { vitesseKmh: 0, accel: 0, shifting: false, charge: 0, regime: 0, nos: false };
}

export class LecteurBruitages {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private niveau = 1;
  private actif = false;
  /** L'index de la route, lu une seule fois par session (null : absent ou illisible). */
  private index: Promise<SfxManifest | null> | null = null;
  private chargement: Promise<Jeu | null> | null = null;
  private jeu: Jeu | null = null;
  /** Retours de flamme par famille de moteur (une lecture par famille et par session). */
  private readonly moteurs = new Map<string, Promise<Prise[]>>();
  private flammes: Prise[] = [];
  private famille: string | null = null;
  private voix: Voix[] = [];
  private readonly avant: InstantRoute = instantRepos();
  /** L'instant présent, avec le NOS tiré de l'état de la route (front montant du coup d'envoi). */
  private readonly present: InstantRoute = instantRepos();
  /** Dernière mise à jour (temps du contexte, s) : pas de temps des rampes de glisse. */
  private dernierTemps = -1;
  private readonly dernierDepart = new Float64Array(PONCTUELS_ROUTE.length).fill(-Infinity);
  private readonly onBruitage: (emplacement: string) => void;
  private readonly base: string;

  constructor(onBruitage: (emplacement: string) => void = () => {}, base: string = import.meta.env.BASE_URL) {
    this.onBruitage = onBruitage;
    this.base = base;
  }

  /** L'index de la route est-il lu, et combien de boucles et de ponctuels a-t-il ? (Pour les essais.) */
  get contenu(): { boucles: number; ponctuels: number } | null {
    if (!this.jeu) return null;
    let ponctuels = 0;
    for (const list of this.jeu.ponctuels.values()) ponctuels += list.length;
    return { boucles: this.jeu.boucles.size, ponctuels };
  }

  /** L'index de la route, demandé une seule fois par session : absent ou illisible, tout reste muet. */
  private lireIndex(): Promise<SfxManifest | null> {
    this.index ??= (async () => {
      try {
        const response = await fetch(sfxFileUrl(this.base, FAMILLE_ROUTE, 'sfx.json'));
        if (!response.ok) return null;
        return parseSfxManifest(await response.json())?.manifest ?? null;
      } catch {
        return null;
      }
    })();
    return this.index;
  }

  /** Décode les sons de la route utiles à la sortie, une fois par contexte audio. */
  private charger(ctx: AudioContext): Promise<Jeu | null> {
    this.chargement ??= (async () => {
      try {
        const manifest = await this.lireIndex();
        if (!manifest) return null;
        const voulus = new Set([...BOUCLES_ROUTE.map((b) => b.emplacement), ...PONCTUELS_ROUTE.map((p) => p.emplacement)]);
        const jeu: Jeu = { boucles: new Map(), ponctuels: new Map() };
        const decoder = async (entree: SfxBoucle | SfxPonctuel) => {
          const res = await fetch(sfxFileUrl(this.base, FAMILLE_ROUTE, entree.fichier, entree.empreinte));
          if (!res.ok) return null;
          return ctx.decodeAudioData(await res.arrayBuffer());
        };
        await Promise.all([
          ...manifest.boucles
            .filter((entree) => voulus.has(entree.emplacement))
            .map(async (entree) => {
              const buffer = await decoder(entree).catch(() => null);
              if (buffer && !jeu.boucles.has(entree.emplacement)) jeu.boucles.set(entree.emplacement, { entree, buffer });
            }),
          ...manifest.ponctuels
            .filter((entree) => voulus.has(entree.emplacement))
            .map(async (entree) => {
              const buffer = await decoder(entree).catch(() => null);
              if (!buffer) return;
              const list = jeu.ponctuels.get(entree.emplacement) ?? [];
              list.push({ buffer, gain: entree.gain });
              jeu.ponctuels.set(entree.emplacement, list);
            }),
        ]);
        return jeu;
      } catch {
        return null;
      }
    })();
    return this.chargement;
  }

  /** Retours de flamme de la famille du moteur, s'il y en a (sinon ceux de la route). */
  private chargerMoteur(ctx: AudioContext, famille: string): Promise<Prise[]> {
    const known = this.moteurs.get(famille);
    if (known) return known;
    const emplacements = new Set(PONCTUELS_ROUTE.filter((p) => p.famille === 'moteur').map((p) => p.emplacement));
    const pending = (async () => {
      try {
        if (emplacements.size === 0) return [];
        const response = await fetch(engineFileUrl(this.base, famille, 'engine.json'));
        if (!response.ok) return [];
        const parsed = parseEngineManifest(await response.json());
        if ('problems' in parsed) return [];
        const shots = parsed.manifest.ponctuels.filter((shot) => emplacements.has(shot.emplacement));
        const prises = await Promise.all(
          shots.map(async (shot) => {
            const res = await fetch(engineFileUrl(this.base, famille, shot.fichier, shot.empreinte));
            if (!res.ok) return null;
            return { buffer: await ctx.decodeAudioData(await res.arrayBuffer()), gain: shot.gain };
          }),
        );
        return prises.filter((prise): prise is Prise => prise !== null);
      } catch {
        return [];
      }
    })();
    this.moteurs.set(famille, pending);
    return pending;
  }

  /**
   * Branche le lecteur sur le contexte et la sortie du moteur (à chaque mise à jour : le contexte
   * peut changer). Rend vrai si le lecteur est branché.
   */
  private brancher(audio: { ctx: AudioContext; sortie: AudioNode } | null): boolean {
    if (!audio) {
      if (this.ctx) this.debrancher();
      return false;
    }
    if (this.ctx === audio.ctx && this.bus) return true;
    this.debrancher();
    this.ctx = audio.ctx;
    const bus = audio.ctx.createGain();
    bus.gain.value = this.niveau;
    bus.connect(audio.sortie);
    this.bus = bus;
    void this.charger(audio.ctx).then((jeu) => {
      if (this.ctx !== audio.ctx) return;
      this.jeu = jeu;
      if (this.actif) this.lancerBoucles();
    });
    return true;
  }

  private debrancher(): void {
    this.arreterBoucles();
    this.bus?.disconnect();
    this.bus = null;
    this.ctx = null;
    this.jeu = null;
    this.chargement = null;
    this.moteurs.clear();
    this.flammes = [];
    this.famille = null;
  }

  /** Démarre les boucles présentes, à gain nul (les rampes les font monter). */
  private lancerBoucles(): void {
    const ctx = this.ctx;
    const bus = this.bus;
    const jeu = this.jeu;
    if (!ctx || !bus || !jeu || this.voix.length > 0) return;
    for (const boucle of BOUCLES_ROUTE) {
      const prise = jeu.boucles.get(boucle.emplacement);
      if (!prise) continue;
      const source = ctx.createBufferSource();
      source.buffer = prise.buffer;
      source.loop = true;
      source.loopStart = prise.entree.boucle[0];
      source.loopEnd = Math.min(prise.buffer.duration, prise.entree.boucle[1]);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      let filtre: BiquadFilterNode | null = null;
      if (boucle.neige || boucle.mouille) {
        filtre = ctx.createBiquadFilter();
        filtre.type = 'lowpass';
        filtre.frequency.value = 20000;
        source.connect(filtre).connect(gain);
      } else {
        source.connect(gain);
      }
      gain.connect(bus);
      // Départ au hasard dans la boucle : deux sorties ne sonnent pas pareil au même endroit.
      source.start(ctx.currentTime, prise.entree.boucle[0] + Math.random() * (source.loopEnd - prise.entree.boucle[0]));
      this.voix.push({ boucle, source, gain, filtre, suivi: boucle.glisse ? suiviGlisseRepos() : null, base: dbToGain(prise.entree.gain) });
    }
  }

  /** Éteint les boucles en un fondu court, puis les libère. */
  private arreterBoucles(): void {
    const ctx = this.ctx;
    for (const voix of this.voix) {
      try {
        if (ctx && ctx.state === 'running') {
          voix.gain.gain.cancelScheduledValues(ctx.currentTime);
          voix.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
          voix.source.stop(ctx.currentTime + 0.3);
        } else {
          voix.source.stop();
        }
      } catch {
        // Source déjà arrêtée.
      }
      voix.source.onended = () => {
        voix.source.disconnect();
        voix.filtre?.disconnect();
        voix.gain.disconnect();
      };
    }
    this.voix = [];
  }

  /**
   * Mise à jour, dix fois par seconde : `actif` (la sortie roule, moteur voulu), le niveau du
   * curseur « Route » (de 0 à 1), la météo locale, l'instant présent du moteur, la famille du moteur.
   */
  mettreAJour(
    audio: { ctx: AudioContext; sortie: AudioNode } | null,
    actif: boolean,
    niveau: number,
    etat: EtatRoute,
    instant: InstantRoute,
    famille: string | null,
  ): void {
    this.niveau = Number.isFinite(niveau) ? Math.min(1, Math.max(0, niveau)) : 1;
    if (!this.brancher(audio)) return;
    const ctx = this.ctx as AudioContext;
    const now = ctx.currentTime;
    const dt = this.dernierTemps >= 0 ? Math.min(0.5, Math.max(0, now - this.dernierTemps)) : 0;
    this.dernierTemps = now;
    (this.bus as GainNode).gain.setTargetAtTime(this.niveau, now, LISSAGE);
    // L'instant présent : celui du moteur, avec le NOS de l'état de la route.
    const present = this.present;
    copierInstant(instant, present);
    present.nos = etat.nos;
    present.feuxRouges = feuxSon.rouges;
    present.vert = feuxSon.vert;
    if (!actif) {
      if (this.actif) this.couper();
      copierInstant(present, this.avant);
      return;
    }
    if (!this.actif) {
      this.actif = true;
      this.lancerBoucles();
      copierInstant(present, this.avant);
    }
    if (famille !== this.famille) {
      this.famille = famille;
      this.flammes = [];
      if (famille) {
        void this.chargerMoteur(ctx, famille).then((prises) => {
          if (this.famille === famille) this.flammes = prises;
        });
      }
    }
    for (const voix of this.voix) {
      const glisse = voix.suivi && voix.boucle.glisse ? suivreGlisse(voix.suivi, etat.glisse ?? 0, etat.vitesseKmh, dt, voix.boucle.glisse) : 0;
      const cible = niveauBoucle(voix.boucle, etat, glisse) * voix.base;
      // Trois constantes de temps font la rampe : FONDU_BOUCLES à l'aller comme au retour.
      voix.gain.gain.setTargetAtTime(cible, now, FONDU_BOUCLES / 3);
      voix.source.playbackRate.setTargetAtTime(hauteurBoucle(voix.boucle, etat, glisse), now, LISSAGE);
      voix.filtre?.frequency.setTargetAtTime(coupureBoucle(voix.boucle, etat), now, LISSAGE);
    }
    if (ctx.state === 'running') {
      for (let i = 0; i < PONCTUELS_ROUTE.length; i += 1) {
        const ponctuel = PONCTUELS_ROUTE[i] as (typeof PONCTUELS_ROUTE)[number];
        if (!ponctuelPart(ponctuel, this.avant, present, now - (this.dernierDepart[i] ?? -Infinity), Math.random())) continue;
        const prises = ponctuel.famille === 'moteur' && this.flammes.length > 0 ? this.flammes : this.jeu?.ponctuels.get(ponctuel.emplacement);
        if (!prises || prises.length === 0) continue;
        this.dernierDepart[i] = now;
        this.jouer(prises[Math.floor(Math.random() * prises.length)] as Prise, ponctuel.niveau);
        this.onBruitage(ponctuel.emplacement);
      }
    }
    copierInstant(present, this.avant);
  }

  private jouer(prise: Prise, niveau: number): void {
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    const source = ctx.createBufferSource();
    source.buffer = prise.buffer;
    const gain = ctx.createGain();
    gain.gain.value = niveau * dbToGain(prise.gain);
    source.connect(gain).connect(bus);
    source.onended = () => {
      source.disconnect();
      gain.disconnect();
    };
    source.start();
  }

  /** Coupe tout (pause, bout du parcours, moteur coupé, garage). L'index lu reste en mémoire. */
  couper(): void {
    this.actif = false;
    this.arreterBoucles();
    this.dernierDepart.fill(-Infinity);
    this.dernierTemps = -1;
  }
}
