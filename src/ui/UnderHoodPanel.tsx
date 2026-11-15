// « Sous le capot » : l'état du socle, pour la recette sur le téléphone.
// Quelle version tourne, est-elle prête hors ligne, installée, sauvegardée, et à quelle cadence.

import { useEffect, useState } from 'react';
import { BUILD, formatBuildDate } from '../app/buildInfo.ts';
import { precachePercent, usePwa } from '../pwa/pwaStore.ts';
import { QUALITY_LABELS, resolveQuality } from '../render/quality.ts';
import { METER_DURATION_MS } from '../render/frameMeter.ts';
import { startMeter, useRenderStats, type RenderStatsState } from '../render/renderStats.ts';
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
  // Le navigateur ne dit pas toujours la place occupée : dans ce cas, on n'en parle pas. Son
  // chiffre vaut pour toute l'adresse du site, pas pour l'atelier seul.
  const used =
    status.usage === null ? '' : ` Le navigateur garde ${formatBytes(status.usage)} pour toute l’adresse du site, atelier hors ligne compris.`;
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

const decimal = (value: number) => value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function qualityLine(quality: string, level: string, auto: RenderStatsState['auto'], floatTargets: boolean | null): string {
  if (floatTargets === false) return `${level} imposé : ce processeur graphique ne rend pas en demi-flottants`;
  if (quality !== 'auto') return level;
  if (auto.fps === null) return `Auto, niveau ${level.toLowerCase()} pour l’instant : cadence pas encore mesurée`;
  const fixed = auto.settled ? ', retenu' : '';
  return `Auto, niveau ${level.toLowerCase()}${fixed} (cadence vue : ${Math.round(auto.fps)} i/s)`;
}

function meterLine(meter: RenderStatsState['meter']): string {
  if (meter.running) return `Mesure en cours : la scène tourne ${METER_DURATION_MS / 1000} secondes…`;
  const result = meter.result;
  if (!result) return 'Appuie sur « Mesurer » : la scène tourne cinq secondes au niveau en cours.';
  return (
    `${QUALITY_LABELS[result.level]} : ${decimal(result.fps)} i/s en moyenne, ${decimal(result.worstFps)} i/s au pire centile · ` +
    `${result.calls.toLocaleString('fr-FR')} appels de dessin · ${result.triangles.toLocaleString('fr-FR')} triangles par image ` +
    `(${result.frames} images).`
  );
}

function cutLine(cut: RenderStatsState['cut']): string {
  if (cut === null) return 'Pas encore décidée.';
  const { min, max } = cut.vehicle;
  const size = [0, 2, 1].map((k) => decimal((max[k] ?? 0) - (min[k] ?? 0))).join(' × ');
  const protectedBox = ` Véhicule protégé : ${size} m.`;
  if (cut.hidden === 0) return `Rien ne passe devant le véhicule : aucun des ${cut.total} éléments du décor n’est retiré.${protectedBox}`;
  const verb = cut.hidden > 1 ? 'retirés de l’image : ils passeraient' : 'retiré de l’image : il passerait';
  return `${count(cut.hidden, 'élément')} du décor sur ${cut.total} ${verb} devant le véhicule.${protectedBox}`;
}

function ditherLine(dither: RenderStatsState['cutDither']): string {
  if (dither === null) return '';
  if (!dither.ready) return ' Fondu en trame pas prêt : le décor bascule d’un coup (mouvement réduit, photo, ou nuanceurs en préparation).';
  const now = dither.active > 0 ? ` (${count(dither.active, 'matériau', 'matériaux')} en fondu)` : '';
  const warm = dither.warm ? `, préparé en ${dither.warm.ms} ms (prêt en ${dither.warm.readyMs} ms)` : '';
  return ` Fondu en trame prêt, compilé à part pour ${count(dither.carriers, 'matériau opaque', 'matériaux opaques')}${warm}${now}.`;
}

/** « Mesurer » : cinq secondes de rotation, cadence et coût par image au niveau en cours. */
export function MeterButton() {
  const running = useRenderStats((state) => state.meter.running);
  const ready = useRenderStats((state) => state.gpu !== null);
  return (
    <button type="button" className="btn" disabled={running || !ready} onClick={startMeter}>
      {running ? 'Mesure…' : 'Mesurer'}
    </button>
  );
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
  const frame = useRenderStats((state) => state.frame);
  const probe = useRenderStats((state) => state.probe);
  const reflection = useRenderStats((state) => state.reflection);
  const quality = useSettings((state) => state.quality);
  const auto = useRenderStats((state) => state.auto);
  const floatTargets = useRenderStats((state) => state.floatTargets);
  const meter = useRenderStats((state) => state.meter);
  const cut = useRenderStats((state) => state.cut);
  const dither = useRenderStats((state) => state.cutDither);
  const programs = useRenderStats((state) => state.programs);
  const storage = useStorageStatus();

  const date = formatBuildDate(BUILD.date);
  const level = QUALITY_LABELS[resolveQuality(quality, auto.level, floatTargets !== false)];
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
            ? 'Pas encore mesurée : fais tourner le véhicule.'
            : `${fps} i/s à la dernière mesure.`,
        )}
      </dd>

      <dt>Image</dt>
      <dd data-fact="image">
        {typo(
          frame === null
            ? 'Pas encore dessinée.'
            : `${frame.calls.toLocaleString('fr-FR')} appels de dessin · ${frame.triangles.toLocaleString('fr-FR')} triangles` +
                `${programs === null ? '' : ` · ${programs} programmes de nuanceur`}.`,
        )}
      </dd>

      <dt>Reflets</dt>
      <dd data-fact="sonde">
        {typo(
          probe === null
            ? 'Sonde pas encore calculée.'
            : `Sonde de ${probe.size} px par face, calculée en ${probe.ms} ms (${probe.updates} calcul${probe.updates > 1 ? 's' : ''}).`,
        )}
      </dd>
      <dt>Sol</dt>
      <dd data-fact="sol">
        {typo(
          reflection === null
            ? 'Sol sans réflexion planaire : il brille par la sonde.'
            : `Réflexion du sol sur ${reflection.width} × ${reflection.height} px.`,
        )}
      </dd>

      <dt>Coupe</dt>
      <dd data-fact="coupe">{typo(cutLine(cut) + ditherLine(dither))}</dd>

      <dt>Qualité</dt>
      <dd data-fact="qualite">
        {typo(qualityLine(quality, level, auto, floatTargets))}
        {ratio}.
      </dd>

      <dt>Mesure</dt>
      <dd data-fact="mesure" aria-live="polite">
        {typo(meterLine(meter))}
      </dd>

      <dt>Assets privés</dt>
      <dd>{typo(privateAssetsLine())}</dd>

      <dt>Substituts</dt>
      <dd>
        {typo(
          'Le mobilier du garage, modelé par le code en attendant des modèles (placeholder_canape_a, placeholder_quad…), et placeholder_banc à la place des véhicules. Liste complète dans TODO_ASSETS.md.',
        )}
      </dd>
    </dl>
  );
}
