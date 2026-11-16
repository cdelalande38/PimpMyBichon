// Coque de l'app : la scène 3D en fond, le HUD en haut (marque, état, boutons ronds de la radio, de
// la photo et de l'atelier), le dock en bas (la personnalisation), et un panneau bas piloté par l'adresse.
// Sortie de nuit (« #/sortie », § 5.5) : la scène de la route, chargée à la première sortie, prend la
// place de celle du garage (déchargée pour tenir la mémoire) ; l'atelier s'efface derrière l'écran de
// la sortie. Au retour, le garage se remonte tel qu'on l'avait laissé (tout vit dans les stores).

import { lazy, Suspense, useEffect, useState } from 'react';
import { mapById } from '../data/maps.ts';
import { resolveVehicle } from '../data/vehicles.ts';
import { useBench } from '../state/bench.ts';
import { useBuilds } from '../state/builds.ts';
import { useDrive } from '../state/drive.ts';
import { useSettings } from '../state/store.ts';
import { Dock } from '../ui/Dock.tsx';
import { DriveScreen } from '../ui/drive/DriveScreen.tsx';
import { Hud } from '../ui/Hud.tsx';
import { SceneOverlay } from '../ui/overlay/SceneOverlay.tsx';
import { PhotoBar } from '../ui/PhotoBar.tsx';
import { Sheets } from '../ui/Sheets.tsx';
import { Chargement } from '../ui/tuto/Chargement.tsx';
import { Tutos } from '../ui/tuto/Tutos.tsx';
import { isSheetRoute } from './router.ts';
import { SceneBoundary } from './SceneBoundary.tsx';
import { useRoute } from './useRoute.ts';

// three.js et la scène arrivent dans un second temps : la coque s'affiche d'abord.
const GarageCanvas = lazy(() => import('../scene/GarageCanvas.tsx'));
// La scène de la route n'est chargée qu'à la première sortie.
const DriveCanvas = lazy(() => import('../drive/DriveCanvas.tsx'));

function SceneFailure() {
  return (
    <p className="alert" role="alert">
      <b>Le garage 3D ne démarre pas.</b> Si c’est ta première visite, vérifie ta connexion. Sinon,
      ton navigateur a peut-être besoin d’une mise à jour (il faut WebGL 2).
    </p>
  );
}

export function App() {
  const route = useRoute();
  const textSize = useSettings((state) => state.textSize);
  const [sceneFailed, setSceneFailed] = useState(false);
  const benchStatus = useBench((state) => state.status);
  const setBenchStatus = useBench((state) => state.setStatus);
  const vehicle = resolveVehicle(useBuilds((state) => state.current));
  const photo = route.name === 'photo' && !sceneFailed;
  const sortie = route.name === 'sortie';
  const driveMap = mapById(useDrive((state) => state.map));
  const driveAttempt = useDrive((state) => state.attempt);

  // L'adresse décide : « #/sortie » entre en sortie (carte et départ choisis dans le menu, sinon la
  // première carte), toute autre adresse rentre au garage (bouton, geste retour d'Android).
  useEffect(() => {
    if (sortie) useDrive.getState().enter();
    else useDrive.getState().leave();
  }, [sortie]);

  // La taille du texte s'applique à la racine : toute l'interface est dimensionnée en rem.
  useEffect(() => {
    document.documentElement.dataset.text = textSize;
  }, [textSize]);

  return (
    <>
      <div className="app">
        {sortie ? (
          <SceneBoundary key={`sortie-${driveAttempt}`} onFail={() => useDrive.getState().fail()}>
            <Suspense fallback={null}>
              {driveMap && <DriveCanvas key={`${driveMap.id}-${driveAttempt}`} map={driveMap} vehicle={vehicle} />}
            </Suspense>
          </SceneBoundary>
        ) : (
          <SceneBoundary onFail={() => setSceneFailed(true)}>
            <Suspense fallback={<p className="stage-wait">Ouverture du garage…</p>}>
              <GarageCanvas paused={isSheetRoute(route)} photo={photo} />
            </Suspense>
          </SceneBoundary>
        )}

        {sortie ? (
          // Sortie de nuit : l'atelier s'efface, la route prend l'écran.
          <DriveScreen />
        ) : photo ? (
          // Mode photo : l'interface s'efface, la scène prend l'écran.
          <>
            <div className="mid" />
            <PhotoBar />
          </>
        ) : (
          <>
            {/* Panneau ouvert : le haut de l'écran et le dock passent derrière, hors d'atteinte. */}
            <Hud sceneFailed={sceneFailed} covered={isSheetRoute(route)} />
            {/* Ce qui se pose sur l'image sans toucher à ce fichier (pastilles de la pièce). */}
            {!sceneFailed && <SceneOverlay covered={isSheetRoute(route)} />}

            <div className="mid">
              {/* Jamais de substitut en silence : il est annoncé à l'écran, comme le chargement. */}
              {!sceneFailed && (vehicle.placeholder !== undefined || benchStatus !== 'pret') && (
                <p className="tag" role="status">
                  {vehicle.placeholder !== undefined ? `Substitut · ${vehicle.name}` : vehicle.name}
                  {benchStatus === 'chargement' && ' · en route…'}
                  {benchStatus === 'absent' && ' · modèle absent de cette version'}
                  {benchStatus === 'erreur' && ' · introuvable, relance avec du réseau'}
                </p>
              )}
              {/* Modèle tombé : nouvel essai sur le même véhicule (src/scene/GarageCanvas.tsx), en bas de
                  la zone centrale, sous le pouce (le haut à gauche est pris par le bouton « ? », styles.css). */}
              {!sceneFailed && benchStatus === 'erreur' && (
                <button type="button" className="btn mid-retry" onClick={() => setBenchStatus('chargement')}>
                  Réessayer
                </button>
              )}
              {sceneFailed && <SceneFailure />}
            </div>

            <Dock sceneFailed={sceneFailed} covered={isSheetRoute(route)} />
          </>
        )}
        <Sheets route={route} />
      </div>
      {/* Accueil d'un nouvel utilisateur, hors de la coque : écran de chargement, tutos et bouton « ? ». */}
      {/* En sortie, le garage n'est pas monté : l'écran d'ouverture du garage cède la place à celui de la route. */}
      <Chargement sceneFailed={sceneFailed || sortie} />
      <Tutos />
    </>
  );
}
