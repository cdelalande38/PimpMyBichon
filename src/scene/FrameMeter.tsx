// Mesures de cadence de « Sous le capot » (src/render/frameMeter.ts) : la scène tourne
// (src/scene/GarageCanvas fait tourner la caméra), chaque image donne sa durée, ses appels de
// dessin et ses triangles.
// « Mesurer » : cinq secondes au niveau en cours. « Comparer » : quatre mesures d'affilée, une
// variante de la scène chacune (trame partout et sans reflet du sol : src/scene/garage/Garage.tsx ;
// densité 1 : ici), nuanceurs prêts et temps de pose avant chaque fenêtre ; tout est remis en
// l'état à la fin comme à l'abandon (onglet caché, contexte WebGL perdu, mode photo, niveau changé ;
// panneau fermé : src/ui/UnderHoodPanel.tsx).

import { useFrame, useThree } from '@react-three/fiber';
import { useCallback, useEffect, useRef } from 'react';
import { programsReady } from '../render/cutDither.ts';
import {
  createCompareFrame,
  createCompareRun,
  METER_DURATION_MS,
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
      if (id === 'densite-1' && get().viewport.dpr <= 1) return 'l’écran est déjà en densité 1';
      return null;
    },
    [get],
  );

  useFrame(() => {
    frameStart.current = performance.now();
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

  // Mesure comparée. Aucune allocation par image : l'état du magasin ne change qu'aux étapes.
  useFrame((state) => {
    const stats = useRenderStats.getState();
    if (!stats.compare.running) {
      started.current = false;
      return;
    }
    const now = performance.now();
    const { run: compare, frame } = (tools.current ??= { run: createCompareRun(), frame: createCompareFrame() });
    if (!started.current) {
      // Première image : elle suit la pause du panneau ouvert ; on pose la première variante.
      started.current = true;
      startCompareRun(compare, now, skip);
      useRenderStats.setState({
        compare: {
          ...stats.compare,
          step: compare.step,
          variant: compare.variant,
          result: { level, dpr: state.viewport.dpr, outcomes: [...compare.outcomes] },
        },
      });
      state.invalidate();
      return;
    }
    const programs = state.gl.info.programs;
    const dither = stats.cutDither;
    // Densité 1 : le rendu du Canvas remet le pixel ratio de ses réglages ; on le repose, et la
    // fenêtre recommence (variante dérangée).
    const dprOk = compare.variant !== 'densite-1' || state.viewport.dpr === 1;
    if (!dprOk) setDpr(1);
    frame.now = now;
    frame.cpuMs = now - frameStart.current;
    frame.calls = state.gl.info.render.calls;
    frame.triangles = state.gl.info.render.triangles;
    frame.programs = programs?.length ?? 0;
    // Préchauffage de la trame en cours (mouvement non réduit) : on attend sa fin.
    frame.ready = programsReady(programs) && dprOk && (instantRef.current || dither === null || dither.ready);
    const outcomes = compare.outcomes.length;
    const phase = stepCompare(compare, frame, skip);
    if (phase === 'done') {
      started.current = false;
      const result = stats.compare.result;
      useRenderStats.setState({
        compare: {
          running: false,
          step: compare.step,
          variant: null,
          result: { level: result?.level ?? level, dpr: result?.dpr ?? state.viewport.dpr, outcomes: [...compare.outcomes] },
          aborted: null,
        },
      });
      // Une image pour la scène rendue à l'état d'origine, puis plus rien.
      state.invalidate();
      return;
    }
    if (compare.variant !== stats.compare.variant || compare.step !== stats.compare.step || compare.outcomes.length !== outcomes) {
      const result = stats.compare.result;
      useRenderStats.setState({
        compare: {
          ...stats.compare,
          step: compare.step,
          variant: compare.variant,
          result: { level: result?.level ?? level, dpr: result?.dpr ?? state.viewport.dpr, outcomes: [...compare.outcomes] },
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
