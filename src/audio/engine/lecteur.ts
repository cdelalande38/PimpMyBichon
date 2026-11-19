// Lecteur des sons de moteur (§ 9) : des enregistrements réels, en boucle, fondus entre voisins et
// accordés par playbackRate (± 25 % au plus). Web Audio : sources de tampons décodés, gains, un
// compresseur en limiteur ; aucune source synthétique (contrôle : tests/unit/sons-lecteur.test.ts et
// npm run audio:check). Rien ne tourne moteur coupé : sources arrêtées, minuterie levée, contexte
// suspendu. Contexte à part de la radio (élément audio) : les deux se mélangent sans se couper.
//
// Au garage : démarrer, ralenti tant qu'on le laisse, coup de gaz à l'appui (le régime monte tant
// qu'on appuie, retombe quand on lâche), couper. Depuis une autre scène : `drive(régime, charge,
// glissé)` (le régime glisse vers la cible en `glissé` secondes, entre deux mesures espacées),
// `setLevel(volume)` (volume d'ensemble, en rampe, sans toucher à la hauteur), démarrage sans le
// démarreur enregistré (véhicule déjà lancé).
//
// Second moteur (l'adversaire du duel, src/drive/adversaire/son.ts) : un lecteur « invité » (`hote`) joue dans
// le contexte du moteur du joueur et sort par son limiteur, sans ligne d'échappement ; son bus passe par une
// coupure des aigus et un placement gauche-droite (`placer`). Il ne suspend ni ne ferme jamais le contexte
// qu'il emprunte. Ses sons sont téléchargés et décodés pour lui (son propre cache).

import { brancherEchappement, type ChaineEchappement } from './echappement.ts';
import { dbToGain, loadGain, loopLevels, rpmRange, stepRpm } from './mix.ts';
import { engineFileUrl, parseEngineManifest, type EngineLoop, type EngineOneShot, type EngineSoundManifest } from './manifeste.ts';

/** État du moteur, lu par l'interface et posé en attribut data-moteur. */
export type EngineState = 'coupe' | 'demarrage' | 'ralenti' | 'charge' | 'coupure';

/** Cadence de la mise à jour des gains et des accords, moteur tournant (ms). */
const TICK_MS = 40;
/** Constante de temps des rampes de gain et d'accord (s). */
const SMOOTH = 0.05;
/** Bascule du démarrage vers la boucle de ralenti : au plus tard à 5 s, fondu de 1 s. */
const START_HANDOFF = 5;
const START_FADE = 1;
/** Fondu des boucles à la coupure (s). */
const STOP_FADE = 0.5;
/** Volume du bus moteur. */
const BUS_GAIN = 0.85;
/** Fondu de la coupure nette (s) : assez court pour être net, assez long pour ne pas claquer. */
const CUT_FADE = 0.04;

interface LoopVoice {
  loop: EngineLoop;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

type Loaded = { manifest: EngineSoundManifest; buffers: Map<string, AudioBuffer> };

export class EngineSoundPlayer {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  /** Sortie commune (limiteur vers les haut-parleurs) : le moteur et les bruitages de route y passent. */
  private master: DynamicsCompressorNode | null = null;
  /** Ligne d'échappement entre le bus et le limiteur (./echappement.ts). */
  private exhaust: ChaineEchappement | null = null;
  private readonly cache = new Map<string, Promise<Loaded | null>>();
  private current: Loaded | null = null;
  private voices: LoopVoice[] = [];
  /** Sons ponctuels en cours et leur gain. */
  private readonly shots = new Map<AudioBufferSourceNode, GainNode>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private timeouts: ReturnType<typeof setTimeout>[] = [];
  private rpm = 0;
  private pressed = false;
  private loadLevel = 0.3;
  /** Pilotage externe : régime visé, charge, et glissé depuis `from` à partir de `at` (temps du contexte) en `glide` s. */
  private external: { rpm: number; load: number; from: number; at: number; glide: number } | null = null;
  /** Volume d'ensemble, de 0 à 1 (1 au garage). */
  private level = 1;
  /** Fin du coup de gaz enregistré en cours (mode « prises »), en temps du contexte. */
  private revUntil = 0;
  private state: EngineState = 'coupe';
  /** Change à chaque coupure : une étape asynchrone d'un démarrage abandonné s'arrête là. */
  private run = 0;

  private readonly onState: (state: EngineState) => void;
  private readonly base: string;
  /** Lecteur invité : le contexte et la sortie du moteur du joueur (null tant qu'il n'est pas né). */
  private readonly hote: (() => { ctx: AudioContext; sortie: AudioNode } | null) | null;
  /** Invité : coupure des aigus et placement gauche-droite, entre son bus et la sortie de l'hôte. */
  private voile: BiquadFilterNode | null = null;
  private place: StereoPannerNode | null = null;

  constructor(onState: (state: EngineState) => void, base: string = import.meta.env.BASE_URL, hote: (() => { ctx: AudioContext; sortie: AudioNode } | null) | null = null) {
    this.onState = onState;
    this.base = base;
    this.hote = hote;
  }

  get engineState(): EngineState {
    return this.state;
  }

  private setState(state: EngineState): void {
    if (this.state === state) return;
    this.state = state;
    this.onState(state);
  }

  /** Contexte audio, créé au premier geste (le navigateur l'exige), repris s'il dormait. */
  private context(): AudioContext {
    const hote = this.ctx ? null : this.hote?.();
    if (hote) {
      const bus = hote.ctx.createGain();
      bus.gain.value = BUS_GAIN * this.level;
      const voile = hote.ctx.createBiquadFilter();
      voile.type = 'lowpass';
      voile.frequency.value = 20000;
      const place = hote.ctx.createStereoPanner();
      bus.connect(voile).connect(place).connect(hote.sortie);
      this.ctx = hote.ctx;
      this.bus = bus;
      this.voile = voile;
      this.place = place;
    }
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 4;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.2;
      const bus = ctx.createGain();
      bus.gain.value = BUS_GAIN * this.level;
      // Le bus passe par la ligne d'échappement choisie (égalisation, saturation douce), puis le limiteur.
      this.exhaust = brancherEchappement(ctx, bus, limiter);
      limiter.connect(ctx.destination);
      this.ctx = ctx;
      this.bus = bus;
      this.master = limiter;
    }
    return this.ctx;
  }

  /**
   * Contexte audio et sortie commune, une fois le contexte né (premier démarrage) : les bruitages
   * de route (src/audio/sfx/) s'y branchent, à côté du bus du moteur. Null avant.
   */
  get audio(): { ctx: AudioContext; sortie: AudioNode } | null {
    return this.ctx && this.master ? { ctx: this.ctx, sortie: this.master } : null;
  }

  /** Télécharge le manifeste et les sons d'une famille (une fois), puis les décode. */
  private load(famille: string): Promise<Loaded | null> {
    const known = this.cache.get(famille);
    if (known) return known;
    const ctx = this.context();
    const pending = (async () => {
      const response = await fetch(engineFileUrl(this.base, famille, 'engine.json'));
      if (!response.ok) throw new Error(`engine.json : ${response.status}`);
      const parsed = parseEngineManifest(await response.json());
      if ('problems' in parsed) throw new Error(parsed.problems.join(' ; '));
      const manifest = parsed.manifest;
      // Au garage : les boucles, le démarrage, la coupure et les coups de gaz.
      const files = new Map<string, string | undefined>([
        ...manifest.boucles.map((loop) => [loop.fichier, loop.empreinte] as const),
        ...manifest.ponctuels
          .filter((shot) => ['start', 'stop', 'rev'].includes(shot.emplacement))
          .map((shot) => [shot.fichier, shot.empreinte] as const),
      ]);
      const buffers = new Map<string, AudioBuffer>();
      await Promise.all(
        [...files].map(async ([file, empreinte]) => {
          const res = await fetch(engineFileUrl(this.base, famille, file, empreinte));
          if (!res.ok) throw new Error(`${file} : ${res.status}`);
          buffers.set(file, await ctx.decodeAudioData(await res.arrayBuffer()));
        }),
      );
      return { manifest, buffers };
    })();
    // Un échec (hors ligne à la première écoute) n'est pas gardé : on pourra réessayer.
    pending.catch(() => this.cache.delete(famille));
    this.cache.set(famille, pending);
    return pending;
  }

  /**
   * Démarre le moteur de la famille : démarrage enregistré, puis ralenti en boucle. Rend « echec »
   * si les sons n'ont pas pu être chargés (le moteur reste coupé, muet), « annule » si l'on a coupé
   * pendant le chargement. `demarreur` faux : sans le démarrage enregistré, les boucles entrent en
   * fondu (moteur remis en marche véhicule lancé).
   */
  async start(famille: string, options: { demarreur?: boolean } = {}): Promise<'ok' | 'echec' | 'annule'> {
    if (this.state !== 'coupe') return 'ok';
    // Invité sans hôte né : muet.
    if (this.hote && !this.ctx && !this.hote()) return 'echec';
    const ctx = this.context();
    const run = ++this.run;
    this.setState('demarrage');
    if (!this.hote) void ctx.resume();
    let loaded: Loaded | null;
    try {
      loaded = await this.load(famille);
    } catch {
      loaded = null;
    }
    if (run !== this.run) return 'annule';
    if (!loaded) {
      this.cleanup();
      return 'echec';
    }
    if (!this.hote) await ctx.resume().catch(() => undefined);
    if (run !== this.run) return 'annule';
    this.current = loaded;
    const { manifest, buffers } = loaded;
    const now = ctx.currentTime + 0.02;
    const start = options.demarreur === false ? undefined : this.pick('start');
    let handoff = 0;
    if (start) {
      const length = buffers.get(start.fichier)?.duration ?? start.duree;
      handoff = Math.max(0, Math.min(START_HANDOFF, length - START_FADE - 0.1));
      const voice = this.playShot(start, now);
      voice?.gain.gain.setValueAtTime(voice.gain.gain.value, now + handoff);
      voice?.gain.gain.linearRampToValueAtTime(0, now + handoff + START_FADE);
      voice?.source.stop(now + handoff + START_FADE + 0.05);
    }
    this.rpm = manifest.ralenti;
    this.pressed = false;
    this.voices = manifest.boucles.flatMap((loop) => {
      const buffer = buffers.get(loop.fichier);
      if (!buffer || !this.bus) return [];
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.loop = true;
      source.loopStart = loop.boucle[0];
      // Une boucle qui finit à 2 ms du bout du fichier va jusqu'au bout : c'est là que la fabrication l'a raccordée.
      source.loopEnd = buffer.duration - loop.boucle[1] < 0.002 ? buffer.duration : loop.boucle[1];
      const gain = ctx.createGain();
      gain.gain.value = 0;
      source.connect(gain).connect(this.bus);
      source.start(now + handoff, loop.boucle[0]);
      return [{ loop, source, gain }];
    });
    this.later(() => {
      if (run !== this.run) return;
      this.timer = setInterval(() => this.tick(), TICK_MS);
      this.tick(start ? START_FADE : 0.25);
      this.later(() => {
        if (run === this.run && this.state === 'demarrage') this.setState('ralenti');
      }, START_FADE * 1000);
    }, handoff * 1000);
    return 'ok';
  }

  /** Coup de gaz du garage : appui (vrai) et relâche (faux). */
  throttle(on: boolean): void {
    if (on === this.pressed) return;
    this.pressed = on;
    const ctx = this.ctx;
    const manifest = this.current?.manifest;
    if (!on || !ctx || !manifest || (this.state !== 'ralenti' && this.state !== 'charge')) return;
    if (manifest.gaz === 'prises') {
      const rev = this.pick('rev');
      if (rev && ctx.currentTime >= this.revUntil - 0.3) {
        const voice = this.playShot(rev, ctx.currentTime + 0.01);
        if (voice) this.revUntil = ctx.currentTime + (voice.source.buffer?.duration ?? rev.duree);
      }
    }
    this.tick();
  }

  /**
   * Pilotage depuis une autre scène (sortie de nuit) : régime en tr/min et charge de 0 à 1. `null`
   * rend la main au garage (ralenti et coup de gaz). `glide` : le régime glisse en ligne droite
   * vers la cible en tant de secondes (mesures espacées), au lieu d'y sauter.
   */
  drive(rpm: number | null, load = 0.5, glide = 0): void {
    if (rpm === null || !Number.isFinite(rpm)) {
      this.external = null;
      return;
    }
    const now = this.ctx?.currentTime ?? 0;
    const from = this.external ? this.externalRpm(now) : this.rpm;
    this.external = { rpm, load, from, at: now, glide: Number.isFinite(glide) ? Math.max(0, glide) : 0 };
  }

  /** Régime piloté à l'instant `now`, au fil du glissé. */
  private externalRpm(now: number): number {
    const external = this.external;
    if (!external) return this.rpm;
    if (!(external.glide > 0)) return external.rpm;
    const t = Math.min(1, Math.max(0, (now - external.at) / external.glide));
    return external.from + (external.rpm - external.from) * t;
  }

  /** Volume d'ensemble du moteur, de 0 à 1 (1 au garage), en rampe de `ramp` secondes : la hauteur ne change pas. */
  setLevel(level: number, ramp = 0.25): void {
    this.level = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 1;
    const ctx = this.ctx;
    const bus = this.bus;
    if (!ctx || !bus) return;
    const now = ctx.currentTime;
    bus.gain.cancelScheduledValues(now);
    bus.gain.setValueAtTime(bus.gain.value, now);
    bus.gain.linearRampToValueAtTime(BUS_GAIN * this.level, now + Math.max(0.01, ramp));
  }

  /**
   * Invité : placement gauche-droite (`pan`, de −1 à gauche à 1 à droite) et coupure des aigus (`coupure`, Hz),
   * en rampe de `ramp` secondes. Sans effet sur le moteur du joueur.
   */
  placer(pan: number, coupure: number, ramp = 0.1): void {
    const ctx = this.ctx;
    if (!ctx || !this.place || !this.voile) return;
    const tau = Math.max(0.01, ramp) / 3;
    this.place.pan.setTargetAtTime(Number.isFinite(pan) ? Math.min(1, Math.max(-1, pan)) : 0, ctx.currentTime, tau);
    this.voile.frequency.setTargetAtTime(Number.isFinite(coupure) ? Math.min(20000, Math.max(100, coupure)) : 20000, ctx.currentTime, tau);
  }

  /** Plage de régime jouable du jeu chargé (ralenti, plus haute boucle + 25 %), ou null. */
  get range(): { min: number; max: number } | null {
    const manifest = this.current?.manifest;
    return manifest ? rpmRange(manifest.boucles, manifest.ralenti) : null;
  }

  /**
   * Coupe le moteur. `withSound` : la coupure enregistrée se joue (geste « Couper ») ; sinon tout
   * s'arrête aussitôt (changement de véhicule, page en arrière-plan).
   */
  stop(withSound = true): void {
    if (this.state === 'coupe' || this.state === 'coupure') {
      if (!withSound && this.state === 'coupure') this.cleanup();
      return;
    }
    const ctx = this.ctx;
    const stop = withSound ? this.pick('stop') : undefined;
    if (!ctx || !stop || this.state === 'demarrage' || ctx.state !== 'running') {
      this.cleanup();
      return;
    }
    const run = ++this.run;
    this.setState('coupure');
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    const now = ctx.currentTime;
    for (const voice of this.voices) {
      voice.gain.gain.cancelScheduledValues(now);
      voice.gain.gain.setValueAtTime(voice.gain.gain.value, now);
      voice.gain.gain.linearRampToValueAtTime(0, now + STOP_FADE);
      voice.source.stop(now + STOP_FADE + 0.05);
    }
    this.voices = [];
    const shot = this.playShot(stop, now, STOP_FADE);
    const length = shot?.source.buffer?.duration ?? stop.duree;
    this.later(() => {
      if (run === this.run) this.cleanup();
    }, (length + 0.1) * 1000);
  }

  /**
   * Arrête tout, sans bruit : sources (après un fondu de CUT_FADE s, contre le claquement),
   * minuteries, contexte suspendu.
   */
  private cleanup(): void {
    this.run += 1;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const id of this.timeouts) clearTimeout(id);
    this.timeouts = [];
    const ctx = this.ctx;
    const live = ctx !== null && ctx.state === 'running';
    const now = ctx?.currentTime ?? 0;
    const fadeOut = (gain: GainNode, source: AudioBufferSourceNode) => {
      if (live) {
        gain.gain.cancelScheduledValues(now);
        gain.gain.setValueAtTime(gain.gain.value, now);
        gain.gain.linearRampToValueAtTime(0, now + CUT_FADE);
      }
      try {
        source.stop(live ? now + CUT_FADE + 0.01 : undefined);
      } catch {
        // déjà arrêtée
      }
    };
    for (const voice of this.voices) {
      fadeOut(voice.gain, voice.source);
      const { source, gain } = voice;
      const release = () => {
        source.disconnect();
        gain.disconnect();
      };
      if (live) source.onended = release;
      else release();
    }
    this.voices = [];
    for (const [shot, gain] of this.shots) {
      fadeOut(gain, shot);
      if (!live) shot.disconnect();
    }
    this.shots.clear();
    this.pressed = false;
    this.external = null;
    this.revUntil = 0;
    if (ctx && live && !this.hote) {
      // Suspendu après le fondu, sauf si l'on a redémarré entre-temps (jamais le contexte emprunté d'un invité).
      const run = this.run;
      this.later(() => {
        if (run === this.run && this.ctx === ctx && ctx.state === 'running') void ctx.suspend();
      }, (CUT_FADE + 0.05) * 1000);
    }
    this.setState('coupe');
  }

  /** Libère le contexte (fin de vie de l'app ou des tests). */
  dispose(): void {
    this.cleanup();
    if (this.hote) {
      // Invité : on se débranche de l'hôte, son contexte reste à lui.
      this.bus?.disconnect();
      this.voile?.disconnect();
      this.place?.disconnect();
      this.voile = null;
      this.place = null;
    } else void this.ctx?.close();
    this.ctx = null;
    this.bus = null;
    this.master = null;
    this.exhaust = null;
    this.cache.clear();
  }

  private later(fn: () => void, ms: number): void {
    const id = setTimeout(() => {
      this.timeouts = this.timeouts.filter((item) => item !== id);
      fn();
    }, ms);
    this.timeouts.push(id);
  }

  /** Un son ponctuel de l'emplacement, au hasard parmi ses variantes. */
  private pick(emplacement: string): EngineOneShot | undefined {
    const list = this.current?.manifest.ponctuels.filter((shot) => shot.emplacement === emplacement && this.current?.buffers.has(shot.fichier)) ?? [];
    return list[Math.floor(Math.random() * list.length)];
  }

  private playShot(shot: EngineOneShot, when: number, fadeIn = 0): { source: AudioBufferSourceNode; gain: GainNode } | null {
    const ctx = this.ctx;
    const buffer = this.current?.buffers.get(shot.fichier);
    if (!ctx || !buffer || !this.bus) return null;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    const level = dbToGain(shot.gain);
    if (fadeIn > 0) {
      gain.gain.setValueAtTime(0, when);
      gain.gain.linearRampToValueAtTime(level, when + fadeIn);
    } else {
      gain.gain.value = level;
    }
    source.connect(gain).connect(this.bus);
    this.shots.set(source, gain);
    source.onended = () => {
      this.shots.delete(source);
      source.disconnect();
      gain.disconnect();
    };
    source.start(when);
    return { source, gain };
  }

  /** Met à jour le régime, puis les gains et les accords des boucles. */
  private tick(smooth = SMOOTH): void {
    const ctx = this.ctx;
    const manifest = this.current?.manifest;
    if (!ctx || !manifest || this.voices.length === 0) return;
    this.exhaust?.suivre();
    const now = ctx.currentTime;
    const range = rpmRange(manifest.boucles, manifest.ralenti);
    let load: number;
    if (this.external) {
      this.rpm = Math.min(range.max, Math.max(range.min * 0.75, this.externalRpm(now)));
      load = this.external.load;
    } else {
      const loops = manifest.gaz === 'boucles' || !manifest.ponctuels.some((shot) => shot.emplacement === 'rev');
      const target = this.pressed && loops ? range.max : manifest.ralenti;
      this.rpm = stepRpm(this.rpm, target, TICK_MS / 1000);
      load = this.pressed ? 1 : 0.3;
    }
    this.loadLevel += (load - this.loadLevel) * 0.3;
    // Coup de gaz enregistré : le ralenti s'efface le temps de la prise.
    const revving = this.revUntil > now;
    const duck = revving ? 0.2 : 1;
    const levels = loopLevels(this.rpm, this.voices.map((voice) => voice.loop), this.loadLevel);
    for (const level of levels) {
      const voice = this.voices[level.index];
      if (!voice) continue;
      voice.gain.gain.setTargetAtTime(level.gain * dbToGain(voice.loop.gain) * loadGain(this.loadLevel) * duck, now, revving ? 0.08 : smooth);
      voice.source.playbackRate.setTargetAtTime(level.rate, now, smooth);
    }
    if (this.state === 'ralenti' || this.state === 'charge') {
      const loaded = this.pressed || revving || (this.external ? this.external.load > 0.35 || this.rpm > manifest.ralenti * 1.15 : this.rpm > manifest.ralenti * 1.08);
      this.setState(loaded ? 'charge' : 'ralenti');
    }
  }
}
