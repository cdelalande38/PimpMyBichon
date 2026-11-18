// Lecteur des sons d'interface (vague U, 18 novembre 2026) : les deux emplacements « gain » (un haut fait,
// un objet débloqué, une médaille, un record) et « dollars » (de l'argent seul) de la famille « interface »
// (public/assets/audio/sfx/interface/sfx.json) : trois prises générées par le commanditaire chacun. Sur le
// modèle de ./route.ts : qui joue quoi est dans src/data/bruitages.ts.
//
// - Même contexte audio et même sortie (limiteur) que le moteur et la route (src/audio/engine/lecteur.ts)
//   quand ce contexte existe. Il ne naît qu'au premier démarrage d'un moteur : au garage sans moteur
//   lancé, ou sortie sans son de moteur, le lecteur ouvre son propre contexte (même limiteur), sur geste.
// - L'index (sfx.json) est lu une seule fois par session : absent ou illisible, ou un emplacement sans
//   fichier, tout reste muet, sans erreur et sans nouvelle requête. Chaque fichier n'est demandé qu'une fois.
// - Une prise est tirée parmi les variantes, jamais deux fois de suite la même quand il y en a plusieurs.
// - Aucun son tant que la page n'a pas reçu de geste (le navigateur refuse), ni quand le curseur « Route »
//   du panneau « Son » est à zéro. Le niveau du curseur est relu à chaque son.
// - Rien n'est synthétisé : uniquement des prises (tools/audio-check.mjs le vérifie).

import { create } from 'zustand';
import { FAMILLE_INTERFACE, SONS_INTERFACE, type SonInterface } from '../../data/bruitages.ts';
import { useMixage } from '../../state/mixage.ts';
import { useEngineSound } from '../../state/engineSound.ts';
import { parseSfxManifest, sfxFileUrl, type SfxManifest } from './manifeste.ts';

/** Une prise décodée, avec son gain de lecture (dB). */
interface Prise {
  buffer: AudioBuffer;
  gain: number;
  fichier: string;
}

/** Contexte audio et sortie où brancher le son. */
export interface SortieAudio {
  ctx: AudioContext;
  sortie: AudioNode;
}

/** Ce que le lecteur emprunte au reste de l'app (remplaçable dans un essai). */
export interface DependancesInterface {
  /** Dossier de base de l'app. */
  base?: string;
  /** Contexte et sortie du moteur, s'ils existent. */
  sortie?: () => SortieAudio | null;
  /** Niveau du curseur « Route », de 0 à 1. */
  niveau?: () => number;
  /** La page a-t-elle reçu un geste ? */
  geste?: () => boolean;
  /** Nombre au hasard, dans [0, 1[. */
  hasard?: () => number;
  /** Un son demandé ou parti (pour les parcours et les témoins). */
  surEvenement?: (evenement: EvenementSon) => void;
}

export interface EvenementSon {
  type: 'demande' | 'joue';
  son: SonInterface;
  /** Fichier de la prise ; absent pour une demande. */
  fichier?: string;
}

const dbToGain = (db: number) => 10 ** (db / 20);
const unite = (value: number) => (Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0);

/** Un geste a-t-il déjà eu lieu dans la page ? (Le navigateur ne laisse pas jouer avant.) */
function gesteDejaFait(): boolean {
  return typeof navigator !== 'undefined' && navigator.userActivation?.hasBeenActive === true;
}

export class LecteurInterface {
  private readonly base: string;
  private readonly sortieMoteur: () => SortieAudio | null;
  private readonly niveau: () => number;
  private readonly geste: () => boolean;
  private readonly hasard: () => number;
  private readonly surEvenement: (evenement: EvenementSon) => void;
  /** L'index, lu une seule fois par session (null : absent ou illisible). */
  private index: Promise<SfxManifest | null> | null = null;
  /** Les prises décodées, une seule fois par session (null : rien de jouable). */
  private chargement: Promise<Map<string, Prise[]> | null> | null = null;
  /** Dernière prise jouée par emplacement, pour ne pas répéter la même. */
  private readonly derniere = new Map<string, number>();
  /** Contexte de secours, ouvert seulement si le moteur n'a pas le sien. */
  private secours: SortieAudio | null = null;

  constructor(dependances: DependancesInterface = {}) {
    this.base = dependances.base ?? import.meta.env.BASE_URL;
    this.sortieMoteur = dependances.sortie ?? (() => null);
    this.niveau = dependances.niveau ?? (() => 1);
    this.geste = dependances.geste ?? gesteDejaFait;
    this.hasard = dependances.hasard ?? Math.random;
    this.surEvenement = dependances.surEvenement ?? (() => undefined);
  }

  /** Le contexte où jouer : celui du moteur, sinon un contexte de secours (créé sur geste, une seule fois). */
  private sortie(): SortieAudio | null {
    const partage = this.sortieMoteur();
    if (partage) return partage;
    if (this.secours) return this.secours;
    if (typeof AudioContext === 'undefined' || !this.geste()) return null;
    try {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      // Même limiteur que celui du moteur (src/audio/engine/lecteur.ts).
      const limiteur = ctx.createDynamicsCompressor();
      limiteur.threshold.value = -6;
      limiteur.knee.value = 4;
      limiteur.ratio.value = 12;
      limiteur.attack.value = 0.003;
      limiteur.release.value = 0.2;
      limiteur.connect(ctx.destination);
      this.secours = { ctx, sortie: limiteur };
    } catch {
      this.secours = null;
    }
    return this.secours;
  }

  /** L'index de la famille, demandé une seule fois par session : absent ou illisible, tout reste muet. */
  private lireIndex(): Promise<SfxManifest | null> {
    this.index ??= (async () => {
      try {
        const response = await fetch(sfxFileUrl(this.base, FAMILLE_INTERFACE, 'sfx.json'));
        if (!response.ok) return null;
        return parseSfxManifest(await response.json())?.manifest ?? null;
      } catch {
        return null;
      }
    })();
    return this.index;
  }

  /** Décode les prises des emplacements voulus, une fois par session (un décodage n'est pas lié à un contexte). */
  private charger(ctx: AudioContext): Promise<Map<string, Prise[]> | null> {
    this.chargement ??= (async () => {
      try {
        const manifest = await this.lireIndex();
        if (!manifest) return null;
        const voulus = new Set(Object.values(SONS_INTERFACE).map((son) => son.emplacement));
        const entrees = manifest.ponctuels.filter((entree) => voulus.has(entree.emplacement));
        // Dans l'ordre de l'index, quelle que soit la fin des décodages.
        const decodees = await Promise.all(
          entrees.map(async (entree): Promise<[string, Prise] | null> => {
            try {
              const res = await fetch(sfxFileUrl(this.base, FAMILLE_INTERFACE, entree.fichier, entree.empreinte));
              if (!res.ok) return null;
              const buffer = await ctx.decodeAudioData(await res.arrayBuffer());
              return [entree.emplacement, { buffer, gain: entree.gain, fichier: entree.fichier }];
            } catch {
              return null;
            }
          }),
        );
        const prises = new Map<string, Prise[]>();
        for (const decodee of decodees) {
          if (!decodee) continue;
          const liste = prises.get(decodee[0]) ?? [];
          liste.push(decodee[1]);
          prises.set(decodee[0], liste);
        }
        return prises;
      } catch {
        return null;
      }
    })();
    return this.chargement;
  }

  /** Le contenu lu, pour les essais : nombre de prises par emplacement ; null tant que rien n'est chargé. */
  async contenu(): Promise<Record<string, number> | null> {
    const prises = this.chargement ? await this.chargement : null;
    if (!prises) return null;
    return Object.fromEntries([...prises].map(([emplacement, liste]) => [emplacement, liste.length]));
  }

  /** Charge à l'avance (avant le premier son), si un geste a eu lieu : le premier son part sans attendre. */
  precharger(): void {
    if (this.chargement) return;
    const sortie = this.sortie();
    if (sortie) void this.charger(sortie.ctx);
  }

  /** Indice de la prise à jouer : au hasard, sans répéter la précédente quand il y en a plusieurs. */
  choisir(emplacement: string, nombre: number): number {
    if (nombre <= 1) return 0;
    const avant = this.derniere.get(emplacement);
    // Sans précédente : une des `nombre` prises ; avec : une des `nombre - 1` autres (on saute la précédente).
    const choix = avant === undefined ? nombre : nombre - 1;
    let indice = Math.min(choix - 1, Math.floor(unite(this.hasard()) * choix));
    if (avant !== undefined && indice >= avant) indice += 1;
    this.derniere.set(emplacement, indice);
    return indice;
  }

  /**
   * Joue le son demandé. Rend vrai s'il est parti. Muet, sans erreur : sans geste, curseur à zéro, index
   * absent, emplacement vide, pas de contexte audio.
   */
  async jouer(son: SonInterface): Promise<boolean> {
    this.surEvenement({ type: 'demande', son });
    const regle = SONS_INTERFACE[son];
    const niveau = unite(this.niveau());
    if (niveau <= 0 || !this.geste()) return false;
    const sortie = this.sortie();
    if (!sortie) return false;
    const prises = await this.charger(sortie.ctx);
    const liste = prises?.get(regle.emplacement);
    if (!liste || liste.length === 0) return false;
    const prise = liste[this.choisir(regle.emplacement, liste.length)] as Prise;
    const { ctx } = sortie;
    const lancer = () => {
      const source = ctx.createBufferSource();
      source.buffer = prise.buffer;
      const gain = ctx.createGain();
      // Le niveau du curseur est relu au moment de jouer (il a pu bouger pendant le chargement).
      gain.gain.value = regle.niveau * unite(this.niveau()) * dbToGain(prise.gain);
      source.connect(gain).connect(sortie.sortie);
      source.onended = () => {
        source.disconnect();
        gain.disconnect();
      };
      source.start();
      this.surEvenement({ type: 'joue', son, fichier: prise.fichier });
    };
    if (ctx.state === 'running') lancer();
    else {
      try {
        await ctx.resume();
      } catch {
        return false;
      }
      lancer();
    }
    return true;
  }
}

/** Ce que les parcours lisent : sons demandés à l'app, sons réellement partis, le dernier. */
export interface TemoinSonsInterface {
  demandes: number;
  joues: number;
  dernier: SonInterface | null;
  derniereFichier: string | null;
}

export const useSonsInterface = create<TemoinSonsInterface>(() => ({ demandes: 0, joues: 0, dernier: null, derniereFichier: null }));

/** Le lecteur de l'app : un seul, son index n'est lu qu'une fois par session. */
export const sonsInterface = new LecteurInterface({
  sortie: () => useEngineSound.getState().audio(),
  niveau: () => useMixage.getState().route / 100,
  surEvenement: (evenement) =>
    useSonsInterface.setState((state) =>
      evenement.type === 'demande'
        ? { demandes: state.demandes + 1, dernier: evenement.son }
        : { joues: state.joues + 1, derniereFichier: evenement.fichier ?? null },
    ),
});

/** Demande un son d'interface (muet quand il ne peut pas partir). */
export function jouerSonInterface(son: SonInterface): void {
  void sonsInterface.jouer(son);
}
