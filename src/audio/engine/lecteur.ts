// Lecteur des sons de moteur (§ 9) : des enregistrements réels, en boucle, fondus entre voisins et
// accordés par playbackRate (± 25 % au plus). Web Audio : sources de tampons décodés, gains, un
// compresseur en limiteur ; aucune source synthétique (contrôle : tests/unit/sons-lecteur.test.ts et
// npm run audio:check). Rien ne tourne moteur coupé : sources arrêtées, minuterie levée, contexte
// suspendu. Contexte à part de la radio (élément audio) : les deux se mélangent sans se couper.
//
// Au garage : démarrer, ralenti tant qu'on le laisse, coup de gaz à l'appui (le régime monte tant
// qu'on appuie, retombe quand on lâche), couper. Depuis une autre scène : `drive(régime, charge)`.

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

interface LoopVoice {
  loop: EngineLoop;
  source: AudioBufferSourceNode;
  gain: GainNode;
}

type Loaded = { manifest: EngineSoundManifest; buffers: Map<string, AudioBuffer> };

export class EngineSoundPlayer {
  private ctx: AudioContext | null = null;
  private bus: GainNode | null = null;
  private readonly cache = new Map<string, Promise<Loaded | null>>();
  private current: Loaded | null = null;
  private voices: LoopVoice[] = [];
  private readonly shots = new Set<AudioBufferSourceNode>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private timeouts: ReturnType<typeof setTimeout>[] = [];
  private rpm = 0;
  private pressed = false;
  private loadLevel = 0.3;
  private external: { rpm: number; load: number } | null = null;
  /** Fin du coup de gaz enregistré en cours (mode « prises »), en temps du contexte. */
  private revUntil = 0;
  private state: EngineState = 'coupe';
  /** Change à chaque coupure : une étape asynchrone d'un démarrage abandonné s'arrête là. */
  private run = 0;

  private readonly onState: (state: EngineState) => void;
  private readonly base: string;

  constructor(onState: (state: EngineState) => void, base: string = import.meta.env.BASE_URL) {
    this.onState = onState;
    this.base = base;
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
    if (!this.ctx) {
      const ctx = new AudioContext({ latencyHint: 'interactive' });
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -6;
      limiter.knee.value = 4;
      limiter.ratio.value = 12;
      limiter.attack.value = 0.003;
      limiter.release.value = 0.2;
      const bus = ctx.createGain();
      bus.gain.value = BUS_GAIN;
      bus.connect(limiter).connect(ctx.destination);
      this.ctx = ctx;
      this.bus = bus;
    }
    return this.ctx;
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
   * pendant le chargement.
   */
  async start(famille: string): Promise<'ok' | 'echec' | 'annule'> {
    if (this.state !== 'coupe') return 'ok';
    const ctx = this.context();
    const run = ++this.run;
    this.setState('demarrage');
    void ctx.resume();
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
    await ctx.resume().catch(() => undefined);
    if (run !== this.run) return 'annule';
    this.current = loaded;
    const { manifest, buffers } = loaded;
    const now = ctx.currentTime + 0.02;
    const start = this.pick('start');
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
      this.tick(START_FADE);
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
   * rend la main au garage (ralenti et coup de gaz).
   */
  drive(rpm: number | null, load = 0.5): void {
    this.external = rpm === null ? null : { rpm, load };
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

  /** Arrête tout, sans bruit : sources, minuteries, contexte suspendu. */
  private cleanup(): void {
    this.run += 1;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null;
    for (const id of this.timeouts) clearTimeout(id);
    this.timeouts = [];
    for (const voice of this.voices) {
      try {
        voice.source.stop();
      } catch {
        // déjà arrêtée
      }
      voice.source.disconnect();
      voice.gain.disconnect();
    }
    this.voices = [];
    for (const shot of this.shots) {
      try {
        shot.stop();
      } catch {
        // déjà arrêtée
      }
      shot.disconnect();
    }
    this.shots.clear();
    this.pressed = false;
    this.external = null;
    this.revUntil = 0;
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
    this.setState('coupe');
  }

  /** Libère le contexte (fin de vie de l'app ou des tests). */
  dispose(): void {
    this.cleanup();
    void this.ctx?.close();
    this.ctx = null;
    this.bus = null;
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
    this.shots.add(source);
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
    const now = ctx.currentTime;
    const range = rpmRange(manifest.boucles, manifest.ralenti);
    let load: number;
    if (this.external) {
      this.rpm = Math.min(range.max, Math.max(range.min * 0.75, this.external.rpm));
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
