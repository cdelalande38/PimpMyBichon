// « Sous le capot » : l'état du socle, pour la recette sur le téléphone.
// Quelle version tourne, est-elle prête hors ligne, installée, sauvegardée, et à quelle cadence.

import { useEffect, useState } from 'react';
import { BUILD, formatBuildDate } from '../app/buildInfo.ts';
import { precachePercent, usePwa } from '../pwa/pwaStore.ts';
import { QUALITY_LABELS, resolveQuality } from '../render/quality.ts';
import { useRenderStats } from '../render/renderStats.ts';
import { readStorageStatus, type StorageStatus } from '../state/persistence.ts';
import { useSettings } from '../state/store.ts';
import { count, formatBytes, offlineDetail, typo } from './labels.ts';

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
  if (!status.writable) {
    return 'Indisponible sur ce navigateur : tes réglages ne survivront pas à la fermeture de l’app.';
  }
  // Le navigateur ne dit pas toujours la place occupée : dans ce cas, on n'en parle pas.
  const used = status.usage === null ? '' : ` ${formatBytes(status.usage)} sur le téléphone.`;
  if (status.persisted === true) return `Protégée.${used}`;
  if (status.persisted === false) {
    return `Pas encore protégée : le navigateur peut l’effacer si la place manque. Installe l’atelier pour la mettre à l’abri.${used}`;
  }
  return `Protection inconnue sur ce navigateur.${used}`;
}

function privateAssetsLine(): string {
  const assets = BUILD.privateAssets;
  if (!assets.present) return 'Absents : sons et musique muets, substituts déclarés.';
  if (assets.engines + assets.sfx + assets.stations === 0) {
    return 'Dossier privé présent, sans son ni musique pour l’instant : emplacements muets.';
  }
  return `Présents : ${count(assets.engines, 'moteur')}, ${count(assets.sfx, 'bruitage')}, ${count(assets.stations, 'station')}.`;
}

function installLine(standalone: boolean, canInstall: boolean): string {
  if (standalone) return 'Installée : l’atelier tourne comme une app.';
  if (canInstall) return 'Dans le navigateur. Le bouton « Installer l’atelier » est dans le dock.';
  return 'Dans le navigateur. Pour l’installer : menu de Chrome, puis « Ajouter à l’écran d’accueil ».';
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
  const ratio =
    dpr === null ? '' : ` · pixel ratio ${dpr.toLocaleString('fr-FR', { maximumFractionDigits: 2 })}`;

  return (
    <dl className="facts">
      <dt>Version</dt>
      <dd>
        {BUILD.version} · {BUILD.commit}
        {date && ` · ${date}`}
      </dd>

      <dt>Hors ligne</dt>
      <dd>{typo(offlineDetail(offline, percent))}</dd>

      <dt>Installation</dt>
      <dd>{typo(installLine(standalone, canInstall))}</dd>

      <dt>Réseau</dt>
      <dd>{online ? 'En ligne.' : 'Hors ligne.'}</dd>

      <dt>Sauvegarde</dt>
      <dd>{typo(storageLine(storage))}</dd>

      <dt>Rendu 3D</dt>
      <dd>
        {gpu
          ? `${gpu.webgl2 ? 'WebGL 2' : 'WebGL 2 absent'}${gpu.renderer ? ` · ${gpu.renderer}` : ''}`
          : 'Pas encore démarré.'}
      </dd>

      <dt>Cadence</dt>
      <dd>
        {typo(
          fps === null
            ? 'Pas encore mesurée : fais tourner la forme.'
            : `${fps} i/s à la dernière mesure.`,
        )}
      </dd>

      <dt>Qualité</dt>
      <dd>
        {quality === 'auto' ? `Auto, niveau ${level.toLowerCase()} pour l’instant` : level}
        {ratio}.
      </dd>

      <dt>Assets privés</dt>
      <dd>{typo(privateAssetsLine())}</dd>

      <dt>Substituts</dt>
      <dd>placeholder_garage, placeholder_speedshape (voir TODO_ASSETS.md).</dd>
    </dl>
  );
}
