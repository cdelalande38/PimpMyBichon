// « Sous le capot » : l'état du socle, pour la recette sur le téléphone.
// Quelle version tourne, est-elle prête hors ligne, installée, sauvegardée, et à quelle cadence.

import { useEffect, useState } from 'react';
import { BUILD, formatBuildDate } from '../app/buildInfo.ts';
import { precachePercent, usePwa } from '../pwa/pwaStore.ts';
import { QUALITY_LABELS, resolveQuality } from '../render/quality.ts';
import { useRenderStats } from '../render/renderStats.ts';
import { readStorageStatus, type StorageStatus } from '../state/persistence.ts';
import { useSettings } from '../state/store.ts';
import { count, formatBytes, offlineDetail } from './labels.ts';

function useStorageStatus(): StorageStatus | null {
  const [status, setStatus] = useState<StorageStatus | null>(null);
  useEffect(() => {
    let alive = true;
    void readStorageStatus().then((value) => {
      if (alive) setStatus(value);
    });
    return () => {
      alive = false;
    };
  }, []);
  return status;
}

function storageLine(status: StorageStatus | null): string {
  if (!status) return 'Vérification…';
  const used = `${formatBytes(status.usage)} sur le téléphone`;
  if (status.persisted === true) return `Protégée. ${used}.`;
  if (status.persisted === false) {
    return `Pas encore protégée : le navigateur peut l’effacer si la place manque. Installe l’atelier pour la mettre à l’abri. ${used}.`;
  }
  return `Protection inconnue sur ce navigateur. ${used}.`;
}

function privateAssetsLine(): string {
  const assets = BUILD.privateAssets;
  if (!assets.present) return 'Absents : sons et musique muets, substituts déclarés.';
  return `Présents : ${count(assets.engines, 'moteur')}, ${count(assets.sfx, 'bruitage')}, ${count(assets.stations, 'station')}.`;
}

export function UnderHoodPanel() {
  const offline = usePwa((state) => state.offline);
  const percent = usePwa(precachePercent);
  const standalone = usePwa((state) => state.standalone);
  const online = usePwa((state) => state.online);
  const canInstall = usePwa((state) => state.canInstall);
  const gpu = useRenderStats((state) => state.gpu);
  const fps = useRenderStats((state) => state.fps);
  const dpr = useRenderStats((state) => state.dpr);
  const quality = useSettings((state) => state.quality);
  const storage = useStorageStatus();

  const date = formatBuildDate(BUILD.date);
  const level = QUALITY_LABELS[resolveQuality(quality)];

  return (
    <dl className="facts">
      <dt>Version</dt>
      <dd>
        {BUILD.version} · {BUILD.commit}
        {date && ` · ${date}`}
      </dd>

      <dt>Hors ligne</dt>
      <dd>{offlineDetail(offline, percent)}</dd>

      <dt>Installation</dt>
      <dd>
        {standalone
          ? 'Installée : l’atelier tourne comme une app.'
          : canInstall
            ? 'Dans le navigateur. Le bouton « Installer l’atelier » est dans le dock.'
            : 'Dans le navigateur. Pour l’installer : menu de Chrome, puis « Ajouter à l’écran d’accueil ».'}
      </dd>

      <dt>Réseau</dt>
      <dd>{online ? 'En ligne.' : 'Hors ligne.'}</dd>

      <dt>Sauvegarde</dt>
      <dd>{storageLine(storage)}</dd>

      <dt>Rendu 3D</dt>
      <dd>
        {gpu
          ? `${gpu.webgl2 ? 'WebGL 2' : 'WebGL 2 absent'}${gpu.renderer ? ` · ${gpu.renderer}` : ''}`
          : 'Pas encore démarré.'}
      </dd>

      <dt>Cadence</dt>
      <dd>
        {fps === null
          ? 'Pas encore mesurée : fais tourner la forme.'
          : `${fps} i/s à la dernière mesure.`}
      </dd>

      <dt>Qualité</dt>
      <dd>
        {quality === 'auto' ? `Auto, niveau ${level.toLowerCase()} pour l’instant` : level}
        {dpr !== null &&
          ` · pixel ratio ${dpr.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`}
        .
      </dd>

      <dt>Assets privés</dt>
      <dd>{privateAssetsLine()}</dd>

      <dt>Substituts</dt>
      <dd>placeholder_garage, placeholder_speedshape (voir TODO_ASSETS.md).</dd>
    </dl>
  );
}
