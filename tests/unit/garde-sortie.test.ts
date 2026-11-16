// Garde de la sortie de nuit (src/app/gardeSortie.ts) : quand la question a un sens, et la pause qui
// l'accompagne. La mécanique d'historique (sentinelle, retour, « Rentrer ») est éprouvée en vrai
// navigateur par tests/e2e/retour-sortie.spec.ts.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAPS } from '../../src/data/maps.ts';
import { IDLE_TELEMETRY } from '../../src/state/drive.ts';

async function launch() {
  vi.resetModules();
  const { useDrive } = await import('../../src/state/drive.ts');
  await vi.waitFor(() => expect(useDrive.getState().hydrated).toBe(true));
  const garde = await import('../../src/app/gardeSortie.ts');
  const route = await import('../../src/app/useRoute.ts');
  return { useDrive, garde, route };
}

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory();
});

describe('confirmation utile', () => {
  it('seulement quand la route est prête, ni en échec ni arrivée au bout', async () => {
    const { useDrive, garde } = await launch();
    expect(garde.confirmationUtile()).toBe(false); // pas de carte
    useDrive.getState().enter(MAPS[0]!.id);
    expect(garde.confirmationUtile()).toBe(false); // chargement
    useDrive.getState().setTelemetry({ ...IDLE_TELEMETRY, ready: true });
    expect(garde.confirmationUtile()).toBe(true);
    useDrive.getState().setTelemetry({ ...IDLE_TELEMETRY, ready: true, finished: true });
    expect(garde.confirmationUtile()).toBe(false); // bout du parcours
    useDrive.getState().setTelemetry({ ...IDLE_TELEMETRY, ready: false, failed: true });
    expect(garde.confirmationUtile()).toBe(false); // erreur
  });
});

describe('pause du dialogue', () => {
  it('met la sortie en pause, et ne reprend que si c’est le dialogue qui l’a arrêtée', async () => {
    const { useDrive, garde } = await launch();
    useDrive.getState().enter(MAPS[0]!.id);
    useDrive.getState().setTelemetry({ ...IDLE_TELEMETRY, ready: true });

    garde.ouvrirDialogue();
    expect(garde.useQuitter.getState().ouvert).toBe(true);
    expect(useDrive.getState().paused).toBe(true);
    garde.resterSurLaRoute();
    expect(garde.useQuitter.getState().ouvert).toBe(false);
    expect(useDrive.getState().paused).toBe(false);

    // Déjà en pause : on la laisse en pause.
    useDrive.getState().setPaused(true);
    garde.ouvrirDialogue();
    garde.resterSurLaRoute();
    expect(useDrive.getState().paused).toBe(true);
  });
});

describe('sentinelle d’historique', () => {
  it('se reconnaît à son marqueur, et dit si l’entrée de dessous a été empilée par l’app', async () => {
    const { route } = await launch();
    expect(route.estSentinelle(null)).toBe(false);
    expect(route.estSentinelle({ pmbSheet: true })).toBe(false);
    expect(route.estSentinelle(route.etatSentinelle({ pmbSheet: true }))).toBe(true);
    expect(route.etatSentinelle({ pmbSheet: true })).toMatchObject({ pmbSous: true });
    expect(route.etatSentinelle(null)).toMatchObject({ pmbSous: false });
  });
});
