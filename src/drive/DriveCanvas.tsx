// Sortie de nuit (§ 5.5) : la scène 3D, chargée à la demande comme celle du garage. Rendu continu
// pendant la sortie (à la demande en pause), arrêté quand on la quitte (démontage). Le niveau de
// qualité est celui de l'app (réglage, ou niveau retenu d'après la cadence, src/render/quality.ts).
// L'élément racine porte la classe drive-stage et les attributs data- du contrat
// (src/drive/contrat.ts, DRIVE_STAGE_CLASS), posés par la boucle de la scène.

import { Canvas } from '@react-three/fiber';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { MapManifest } from '../data/mapTypes.ts';
import type { VehicleManifest } from '../data/vehicleTypes.ts';
import { QUALITY_PROFILES, resolveQuality } from '../render/quality.ts';
import { useRenderStats } from '../render/renderStats.ts';
import { useDrive } from '../state/drive.ts';
import { useSettings } from '../state/store.ts';
import { DRIVE_STAGE_CLASS } from './contrat.ts';
import { DriveScene } from './scene/Scene.tsx';

export interface DriveCanvasProps {
  map: MapManifest;
  vehicle: VehicleManifest;
}

function hasFloatTargets(gl: { extensions: { has: (name: string) => boolean } }): boolean {
  return gl.extensions.has('EXT_color_buffer_float') || gl.extensions.has('EXT_color_buffer_half_float');
}

/** Rendu logiciel (aucun processeur graphique) : la qualité « auto » y part en économie. */
function isSoftware(context: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  const info = context.getExtension('WEBGL_debug_renderer_info');
  const name = String(context.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : context.RENDERER) ?? '');
  return /swiftshader|llvmpipe|softpipe|software/i.test(name);
}

export default function DriveCanvas({ map, vehicle }: DriveCanvasProps) {
  const quality = useSettings((state) => state.quality);
  const autoLevel = useRenderStats((state) => state.auto.level);
  const floatKnown = useRenderStats((state) => state.floatTargets);
  const floatTargets = floatKnown !== false;
  const fullFloat = useRenderStats((state) => state.fullFloatTargets) !== false;
  const [software, setSoftware] = useState<boolean | null>(null);
  const level = quality === 'auto' && software === true ? 'eco' : resolveQuality(quality, autoLevel, floatTargets, fullFloat);
  const profile = QUALITY_PROFILES[level];
  const paused = useDrive((state) => state.paused);
  const weather = useDrive((state) => state.weather);
  const stage = useRef<HTMLDivElement>(null);

  // État de départ, avant la première image de la scène.
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    element.dataset.sortie = 'chargement';
    element.dataset.troncons = '0';
    element.dataset.s = '0';
    element.dataset.vitesse = '0';
    element.dataset.camera = useDrive.getState().camera;
  }, [map.id, vehicle.id]);
  useEffect(() => {
    if (stage.current) stage.current.dataset.meteo = weather;
  }, [weather]);

  return (
    <div
      ref={stage}
      className={DRIVE_STAGE_CLASS}
      role="img"
      data-carte={map.id}
      data-vehicule={vehicle.id}
      data-qualite={level}
      aria-label={`Sortie : ${map.name}.`}
      style={{ position: 'absolute', inset: 0 }}
    >
      <Canvas
        frameloop={paused ? 'demand' : 'always'}
        dpr={[1, profile.dprMax]}
        // Tout passe par le composeur et ses cibles : ni MSAA, ni profondeur, ni stencil sur le canvas.
        gl={{ antialias: false, depth: false, stencil: false, powerPreference: 'high-performance' }}
        camera={{ fov: 55, near: 0.15, far: 24000, position: [0, 2, 6] }}
        onCreated={({ gl }) => {
          useRenderStats.setState({ floatTargets: hasFloatTargets(gl), fullFloatTargets: gl.extensions.has('EXT_color_buffer_float') });
          setSoftware(isSoftware(gl.getContext()));
        }}
      >
        {floatKnown !== null && software !== null && <DriveScene key={`${map.id}:${level}`} map={map} vehicle={vehicle} level={level} floatTargets={floatTargets} stage={stage} />}
      </Canvas>
    </div>
  );
}
