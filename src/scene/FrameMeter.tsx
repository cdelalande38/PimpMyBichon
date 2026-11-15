// Mesures de cadence de « Sous le capot » (src/render/frameMeter.ts) : la scène tourne
// (src/scene/GarageCanvas fait tourner la caméra), chaque image donne sa durée, ses appels de
// dessin et ses triangles.
// « Mesurer » : cinq secondes au niveau en cours. « Comparer » : cinq variantes de la scène, deux
// passages chacune, à l'aller puis au retour (trame partout, sans reflet du sol et sans mobilier :
// src/scene/garage/Garage.tsx ; densité 1 : ici), nuanceurs prêts et temps de pose avant chaque
// fenêtre ; dans chaque fenêtre, la cadence naturelle et, sur les mêmes images, le temps de carte
// (minuterie de la carte, si le navigateur la donne). Tout est remis en l'état à la fin comme à
// l'abandon (onglet caché, contexte WebGL perdu, mode photo, niveau changé ; panneau fermé :
// src/ui/UnderHoodPanel.tsx).

import { addEffect, useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import { programsReady } from '../render/cutDither.ts';
import {
  COMPARE_FURNITURE,
  createCompareFrame,
  createCompareRun,
  METER_DURATION_MS,
  recordGpu,
  startCompareRun,
  stepCompare,
  summarizeFrames,
  type CompareFrame,
  type CompareRun,
  type CompareSkip,
  type FrameSample,
} from '../render/frameMeter.ts';
import type { QualityLevel } from '../render/quality.ts';
import { abortCompare, useRenderStats } from '../render/renderStats.ts';

/** Avant tout le reste de l'image (contrôles d'orbite : −1) : début du calcul de l'image. */
const FRAME_START_PRIORITY = -10;

/** Minuterie de la carte (EXT_disjoint_timer_query_webgl2), absente des types du DOM. */
interface TimerQueryExt {
  readonly TIME_ELAPSED_EXT: number;
  readonly GPU_DISJOINT_EXT: number;
}

/**
 * Requêtes de minuterie en vol au plus : les résultats arrivent une à trois images plus tard, plus
 * quand la carte est chargée ; trop peu de requêtes sauteraient justement les images lentes.
 */
const GPU_QUERIES = 32;

/**
 * Temps de carte des images de cadence de « Comparer » : une requête TIME_ELAPSED encadre l'image
 * (du début du calcul à la fin de la chaîne d'image), son résultat arrive une à trois images plus
 * tard ; une image « disjointe » (fréquence changée, préemption) est écartée. Requêtes créées au
 * départ de la comparaison et libérées à sa fin : aucune allocation par image.
 */
interface GpuTimer {
  context: WebGL2RenderingContext;
  ext: TimerQueryExt;
  queries: WebGLQuery[];
  /** 0 : libre ; 1 : en cours ; 2 : en attente du résultat. */
  state: Uint8Array;
  /** Fenêtre de « Comparer » de chaque requête. */
  window: Float64Array;
  active: number;
}

function createGpuTimer(context: WebGL2RenderingContext): GpuTimer | null {
  const ext = context.getExtension('EXT_disjoint_timer_query_webgl2') as TimerQueryExt | null;
  if (!ext) return null;
  const queries: WebGLQuery[] = [];
  for (let i = 0; i < GPU_QUERIES; i += 1) {
    const query = context.createQuery();
    if (query) queries.push(query);
  }
  return { context, ext, queries, state: new Uint8Array(queries.length), window: new Float64Array(queries.length), active: -1 };
}

function beginGpu(timer: GpuTimer, window: number): void {
  const { context, ext } = timer;
  // Une autre requête de minuterie en cours (outil de mesure posé sur la page) : on ne s'y emboîte pas.
  if (timer.active >= 0 || context.isContextLost() || context.getQuery(ext.TIME_ELAPSED_EXT, context.CURRENT_QUERY) !== null) return;
  const free = timer.state.indexOf(0);
  const query = timer.queries[free];
  if (free < 0 || !query) return;
  context.beginQuery(ext.TIME_ELAPSED_EXT, query);
  timer.state[free] = 1;
  timer.window[free] = window;
  timer.active = free;
}

function endGpu(timer: GpuTimer): void {
  if (timer.active < 0) return;
  timer.context.endQuery(timer.ext.TIME_ELAPSED_EXT);
  timer.state[timer.active] = 2;
  timer.active = -1;
}

/** Relève les résultats arrivés ; une période disjointe les écarte tous. */
function harvestGpu(timer: GpuTimer, run: CompareRun): void {
  const { context, ext } = timer;
  const disjoint = context.getParameter(ext.GPU_DISJOINT_EXT) === true;
  for (let i = 0; i < timer.queries.length; i += 1) {
    const query = timer.queries[i];
    if (timer.state[i] !== 2 || !query) continue;
    if (!disjoint && !context.getQueryParameter(query, context.QUERY_RESULT_AVAILABLE)) continue;
    if (!disjoint) recordGpu(run, timer.window[i] ?? -1, (context.getQueryParameter(query, context.QUERY_RESULT) as number) / 1e6);
    timer.state[i] = 0;
  }
}

function disposeGpu(timer: GpuTimer): void {
  endGpu(timer);
  for (const query of timer.queries) timer.context.deleteQuery(query);
}

export interface FrameMeterProps {
  level: QualityLevel;
  /** Coupe sans fondu (mouvement réduit, mode photo) : la trame ne se prépare pas d'elle-même. */
  instantCut: boolean;
  photo: boolean;
}

export function FrameMeter({ level, instantCut, photo }: FrameMeterProps) {
  const gl = useThree((state) => state.gl);
  const get = useThree((state) => state.get);
  const setDpr = useThree((state) => state.setDpr);
  const invalidate = useThree((state) => state.invalidate);
  const run = useRef<{ start: number; last: number; samples: FrameSample[] } | null>(null);

  // Mesure comparée : tampons alloués à la première mesure, image réutilisée.
  const tools = useRef<{ run: CompareRun; frame: CompareFrame } | null>(null);
  const started = useRef(false);
  const frameStart = useRef(0);
  /** Horodatage de l'image en cours (requestAnimationFrame) : calé sur le rythme de l'écran. */
  const frameTime = useRef(Number.NaN);
  /** Minuterie de la carte, le temps d'une comparaison (`null` : absente, ou pas de comparaison). */
  const timer = useRef<GpuTimer | null>(null);
  useEffect(
    () => () => {
      if (timer.current) disposeGpu(timer.current);
      timer.current = null;
    },
    [],
  );
  useEffect(() => addEffect((timestamp) => void (frameTime.current = timestamp)), []);
  const instantRef = useRef(instantCut);
  useEffect(() => {
    instantRef.current = instantCut;
  }, [instantCut]);

  /** Variantes que la scène ne permet pas, avec leur raison. */
  const skip = useCallback<CompareSkip>(
    (id) => {
      const stats = useRenderStats.getState();
      if (id === 'trame' && (stats.cutDither?.carriers ?? 0) === 0) return 'aucun matériau du décor ne porte la trame';
      if (id === 'sans-reflet' && stats.reflection === null) return 'pas de reflet du sol à ce niveau de qualité';
      if (id === 'sans-mobilier' && COMPARE_FURNITURE.every((name) => get().scene.getObjectByName(name) === undefined)) return 'pas de mobilier dans le garage';
      if (id === 'densite-1' && get().viewport.dpr <= 1) return 'l’écran est déjà en densité 1';
      return null;
    },
    [get],
  );

  useFrame(() => {
    frameStart.current = performance.now();
    const compare = tools.current;
    if (timer.current && compare && started.current && compare.run.phase === 'measure') beginGpu(timer.current, compare.run.window);
  }, FRAME_START_PRIORITY);

  // Après la chaîne d'image (priorité 1) : le compteur du moteur couvre toute l'image.
  useFrame((state) => {
    if (!useRenderStats.getState().meter.running) {
      run.current = null;
      return;
    }
    const now = performance.now();
    const current = run.current;
    if (!current) {
      // Première image : elle mesure la pause d'avant, on ne la compte pas.
      run.current = { start: now, last: now, samples: [] };
      state.invalidate();
      return;
    }
    const { calls, triangles } = state.gl.info.render;
    current.samples.push({ ms: now - current.last, calls, triangles });
    current.last = now;
    if (now - current.start < METER_DURATION_MS) {
      state.invalidate();
      return;
    }
    const summary = summarizeFrames(current.samples);
    run.current = null;
    useRenderStats.setState({ meter: { running: false, result: summary ? { ...summary, level } : null } });
  }, 2);

  // Mesure comparée. Aucune allocation par image : l'état du magasin ne change qu'aux fenêtres.
  useFrame((state) => {
    const stats = useRenderStats.getState();
    const gpu = timer.current;
    if (gpu) endGpu(gpu);
    if (!stats.compare.running) {
      started.current = false;
      if (gpu) disposeGpu(gpu);
      timer.current = null;
      return;
    }
    const { run, frame } = (tools.current ??= { run: createCompareRun(), frame: createCompareFrame() });
    if (gpu && started.current) harvestGpu(gpu, run);
    const cpuEnd = performance.now();
    const now = Number.isFinite(frameTime.current) ? frameTime.current : cpuEnd;
    if (!started.current) {
      // Première image : elle suit la pause du panneau ouvert ; on pose la première variante.
      started.current = true;
      startCompareRun(run, now, skip);
      timer.current = createGpuTimer(state.gl.getContext() as WebGL2RenderingContext);
      useRenderStats.setState({
        compare: {
          ...stats.compare,
          slot: run.slot,
          step: run.step,
          variant: run.variant,
          result: { level, dpr: state.viewport.dpr, outcomes: run.outcomes, screenMs: null },
        },
      });
      state.invalidate();
      return;
    }
    const programs = state.gl.info.programs;
    const dither = stats.cutDither;
    // Densité 1 : le rendu du Canvas remet le pixel ratio de ses réglages (écran retaillé) ; on le
    // repose, et la fenêtre recommence (variante dérangée).
    const dprOk = run.variant !== 'densite-1' || state.viewport.dpr === 1;
    if (!dprOk) setDpr(1);
    const canvas = state.gl.domElement;
    frame.now = now;
    frame.cpuMs = cpuEnd - frameStart.current;
    frame.calls = state.gl.info.render.calls;
    frame.triangles = state.gl.info.render.triangles;
    frame.programs = programs?.length ?? 0;
    frame.pixels = canvas.width * canvas.height;
    // Préchauffage de la trame en cours (mouvement non réduit) : on attend sa fin.
    const shadersReady = programsReady(programs);
    const ditherReady = instantRef.current || dither === null || dither.ready;
    frame.ready = shadersReady && dprOk && ditherReady;
    frame.wait = !dprOk ? 'taille' : !shadersReady ? 'programmes' : 'trame';
    const slot = run.slot;
    const outcomes = run.outcomes;
    const phase = stepCompare(run, frame, skip);
    if (phase === 'done') {
      started.current = false;
      if (timer.current) disposeGpu(timer.current);
      timer.current = null;
      const result = stats.compare.result;
      useRenderStats.setState({
        compare: {
          running: false,
          slot: run.slot,
          step: run.step,
          variant: null,
          result: { level: result?.level ?? level, dpr: result?.dpr ?? state.viewport.dpr, outcomes: run.outcomes, screenMs: run.screenMs },
          aborted: null,
        },
      });
      // Une image pour la scène rendue à l'état d'origine, puis plus rien.
      state.invalidate();
      return;
    }
    if (run.slot !== slot || run.outcomes !== outcomes) {
      const result = stats.compare.result;
      useRenderStats.setState({
        compare: {
          ...stats.compare,
          slot: run.slot,
          step: run.step,
          variant: run.variant,
          result: { level: result?.level ?? level, dpr: result?.dpr ?? state.viewport.dpr, outcomes: run.outcomes, screenMs: null },
        },
      });
    }
    state.invalidate();
  }, 2);

  // Densité 1 : posée et retirée dès que la variante change, même sans image (onglet caché).
  useEffect(() => {
    let saved: number | null = null;
    const sync = (variant: string | null) => {
      if (variant === 'densite-1' && saved === null) {
        saved = get().viewport.dpr;
        setDpr(1);
        invalidate();
      } else if (variant !== 'densite-1' && saved !== null) {
        setDpr(saved);
        saved = null;
        invalidate();
      }
    };
    sync(useRenderStats.getState().compare.variant);
    const unsubscribe = useRenderStats.subscribe((state) => sync(state.compare.variant));
    return () => {
      unsubscribe();
      sync(null);
    };
  }, [get, setDpr, invalidate]);

  // Abandons : onglet caché, contexte WebGL perdu, scène démontée.
  useEffect(() => {
    const canvas = gl.domElement;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') abortCompare('onglet caché');
    };
    const onLost = () => abortCompare('contexte WebGL perdu');
    document.addEventListener('visibilitychange', onVisibility);
    canvas.addEventListener('webglcontextlost', onLost);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      canvas.removeEventListener('webglcontextlost', onLost);
      abortCompare('scène arrêtée');
    };
  }, [gl]);
  useEffect(() => {
    if (photo) abortCompare('passage en mode photo');
  }, [photo]);
  // Le niveau ne change pas pendant la mesure (qualité auto suspendue) ; s'il change quand même, on arrête.
  useEffect(() => () => abortCompare('niveau de qualité changé'), [level]);

  return null;
}
