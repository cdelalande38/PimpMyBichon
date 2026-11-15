// Tutoriels : validité des données (chaque écran a le sien), écran courant, premier passage sous
// navigateur piloté, souvenir par écran sauvegardé et relu de façon tolérante.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, get, set } from 'idb-keyval';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '../../src/app/router.ts';
import { readdirSync, readFileSync } from 'node:fs';
import { DOCK_MENU } from '../../src/data/dockMenu.ts';
import type { VehicleManifest } from '../../src/data/vehicleTypes.ts';
import { masterZone } from '../../src/state/builds.ts';
import { orderedZones } from '../../src/ui/paint/paintLogic.ts';
import { TUTO_ACCUEIL, TUTOS, tutoForEcran, type EcranKey } from '../../src/data/tutos.ts';
import { sanitizeTutos, TUTOS_KEY } from '../../src/state/tutos.ts';
import { ecranCourant, ecranDuGarage, premierPassageActif, type EcranFaits } from '../../src/ui/tuto/ecran.ts';

/** Écrans à couvrir dès maintenant (consigne de l'utilisateur). */
const ECRANS_ATTENDUS: EcranKey[] = [
  'accueil',
  'entree:vehicule',
  'entree:peinture',
  'entree:preparation',
  'entree:ambiance',
  'panneau:radio',
  'panneau:reglages',
  'panneau:capot',
  'photo',
  'vue:interieur',
];

describe('données des tutos', () => {
  it('chaque écran attendu a son tutoriel, et un seul', () => {
    for (const ecran of ECRANS_ATTENDUS) {
      const owners = TUTOS.filter((tuto) => tuto.ecrans.includes(ecran));
      expect(owners.length, ecran).toBe(1);
    }
    // Toute entrée disponible du dock a le sien : une entrée qui s'ouvre demain réclame son tuto.
    for (const section of DOCK_MENU) {
      for (const entry of section.entries.filter((item) => item.available)) {
        expect(tutoForEcran(`entree:${entry.id}`), entry.id).toBeDefined();
      }
    }
    expect(tutoForEcran('accueil')?.id).toBe(TUTO_ACCUEIL);
  });

  it('pas d’identifiant ni d’écran en double ; titre, but et trois à cinq étapes non vides', () => {
    const ids = TUTOS.map((tuto) => tuto.id);
    expect(new Set(ids).size).toBe(ids.length);
    const ecrans = TUTOS.flatMap((tuto) => tuto.ecrans);
    expect(new Set(ecrans).size).toBe(ecrans.length);
    for (const tuto of TUTOS) {
      expect(tuto.id, tuto.id).toMatch(/^[a-z0-9-]+$/);
      expect(tuto.titre.trim().length, tuto.id).toBeGreaterThan(0);
      expect(tuto.but.trim().length, tuto.id).toBeGreaterThan(0);
      expect(tuto.ecrans.length, tuto.id).toBeGreaterThan(0);
      expect(tuto.etapes.length, tuto.id).toBeGreaterThanOrEqual(3);
      expect(tuto.etapes.length, tuto.id).toBeLessThanOrEqual(5);
      const textes = tuto.etapes.map((etape) => etape.texte.trim());
      for (const texte of textes) expect(texte.length, tuto.id).toBeGreaterThan(0);
      expect(new Set(textes).size, `${tuto.id} : étapes distinctes`).toBe(textes.length);
      for (const etape of tuto.etapes) if (etape.cible !== undefined) expect(etape.cible.trim().length, tuto.id).toBeGreaterThan(0);
    }
  });

  it('textes courts, en français, sans vouvoiement', () => {
    for (const tuto of TUTOS) {
      for (const texte of [tuto.titre, tuto.but, ...tuto.etapes.map((etape) => etape.texte)]) {
        expect(texte.length, texte).toBeLessThanOrEqual(140);
        expect(texte, texte).not.toMatch(/\b(vous|votre|vos)\b/i);
      }
    }
  });
});

describe('écran courant', () => {
  const base: EcranFaits = {
    route: { name: 'garage' },
    vue: 'atelier',
    dock: { closed: false, section: 'vehicule', entry: 'vehicule' },
    sortiAccueil: false,
  };

  it('l’ouverture est l’accueil ; « Véhicule » ne l’est plus une fois qu’on en est sorti', () => {
    expect(ecranCourant(base)).toBe('accueil');
    expect(ecranCourant({ ...base, sortiAccueil: true })).toBe('entree:vehicule');
    expect(ecranCourant({ ...base, dock: { closed: true, section: 'custom', entry: 'peinture' }, sortiAccueil: true })).toBe('accueil');
    expect(ecranCourant({ ...base, dock: { closed: false, section: 'custom', entry: 'peinture' }, sortiAccueil: true })).toBe('entree:peinture');
  });

  it('un seul niveau du menu : les sections sont l’accueil, les entrées n’ont pas de tutoriel, le contenu a le sien', () => {
    const custom = { closed: false, section: 'custom' as const, entry: 'peinture' as const };
    expect(ecranCourant({ ...base, dock: { ...custom, menu: 'sections' }, sortiAccueil: true })).toBe('accueil');
    expect(ecranCourant({ ...base, dock: { ...custom, menu: 'entrees' }, sortiAccueil: true })).toBeNull();
    expect(ecranCourant({ ...base, dock: { ...custom, menu: 'contenu' }, sortiAccueil: true })).toBe('entree:peinture');
  });

  it('panneaux, photo et vue intérieure passent devant le dock', () => {
    const routes: [Route, EcranKey | null][] = [
      [{ name: 'radio' }, 'panneau:radio'],
      [{ name: 'reglages' }, 'panneau:reglages'],
      [{ name: 'capot' }, 'panneau:capot'],
      [{ name: 'photo' }, 'photo'],
      [{ name: 'commande' }, null],
      [{ name: 'illisible', kind: 'build' }, null],
    ];
    for (const [route, ecran] of routes) expect(ecranCourant({ ...base, route, vue: 'interieur' }), route.name).toBe(ecran);
    expect(ecranCourant({ ...base, vue: 'interieur' })).toBe('vue:interieur');
    expect(ecranDuGarage('accueil')).toBe(true);
    expect(ecranDuGarage('entree:ambiance')).toBe(true);
    expect(ecranDuGarage('vue:interieur')).toBe(true);
    expect(ecranDuGarage('panneau:radio')).toBe(false);
    expect(ecranDuGarage('photo')).toBe(false);
    expect(ecranDuGarage(null)).toBe(false);
  });

  it('sous un navigateur piloté, le premier passage ne se propose qu’avec « ?tuto=1 »', () => {
    expect(premierPassageActif(false, '')).toBe(true);
    expect(premierPassageActif(true, '')).toBe(false);
    expect(premierPassageActif(true, '?tuto=0')).toBe(false);
    expect(premierPassageActif(true, '?tuto=1')).toBe(true);
    expect(premierPassageActif(true, '?x=2&tuto=1')).toBe(true);
  });
});

describe('souvenir des tutos', () => {
  it('lit une sauvegarde abîmée sans casser : seuls les tutos connus marqués « vrai » comptent', () => {
    expect(sanitizeTutos({ vus: { accueil: true, peinture: true } })).toEqual({ vus: { accueil: true, peinture: true } });
    expect(sanitizeTutos({ vus: { accueil: true, inconnu: true, radio: 'oui', photo: 1, __proto__: true } })).toEqual({ vus: { accueil: true } });
    for (const raw of [null, undefined, 42, 'accueil', [], {}, { vus: null }, { vus: ['accueil'] }, { vus: 'accueil' }]) {
      expect(sanitizeTutos(raw), JSON.stringify(raw)).toEqual({ vus: {} });
    }
  });

  type TutosModule = typeof import('../../src/state/tutos.ts');

  async function launch(): Promise<TutosModule['useTutos']> {
    vi.resetModules();
    const { useTutos } = await import('../../src/state/tutos.ts');
    await vi.waitFor(() => expect(useTutos.getState().hydrated).toBe(true));
    return useTutos;
  }

  const db = () => createStore('pimpmybichon', 'kv');

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('retient chaque écran proposé tout seul, d’un lancement à l’autre ; « ? » ne marque rien', async () => {
    const first = await launch();
    expect(first.getState().vus).toEqual({});
    first.getState().ouvrir('peinture');
    expect(first.getState().ouvert).toEqual({ id: 'peinture', etape: 0, auto: false });
    expect(first.getState().vus).toEqual({});
    first.getState().fermer();
    first.getState().ouvrir('accueil', true);
    first.getState().etape(2);
    expect(first.getState().ouvert).toEqual({ id: 'accueil', etape: 2, auto: true });
    first.getState().fermer();
    expect(first.getState().ouvert).toBeNull();
    first.getState().ouvrir('inconnu', true);
    expect(first.getState().ouvert).toBeNull();
    await vi.waitFor(async () => {
      const raw = await get<string>(TUTOS_KEY, db());
      expect(raw ? (JSON.parse(raw) as { state: unknown }).state : null).toEqual({ vus: { accueil: true } });
    });

    const second = await launch();
    expect(second.getState().vus).toEqual({ accueil: true });
    expect(second.getState().ouvert).toBeNull();
    expect(second.getState().pret).toBe(false);
  });

  it('relit une sauvegarde venue d’ailleurs sans tomber', async () => {
    await set(TUTOS_KEY, JSON.stringify({ state: { vus: { radio: true, fantome: true, photo: 'oui' } }, version: 1 }), db());
    expect((await launch()).getState().vus).toEqual({ radio: true });
    await set(TUTOS_KEY, '{pas du json', db());
    expect((await launch()).getState().vus).toEqual({});
  });
});

describe('textes qui dépendent du véhicule ou du menu', () => {
  const DIR = new URL('../../public/assets/vehicles/', import.meta.url);
  const manifests = readdirSync(DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((entry) => {
      try {
        return [JSON.parse(readFileSync(new URL(`${entry.name}/vehicle.json`, DIR), 'utf8')) as VehicleManifest];
      } catch {
        return [];
      }
    });

  it('le cadenas « suit la première zone de la liste » : vrai pour chaque véhicule, moto comprise', () => {
    const etape = TUTOS.find((tuto) => tuto.id === 'peinture')?.etapes.find((item) => item.cible?.includes('data-cadenas'));
    expect(etape?.texte).toMatch(/première zone de la liste/);
    expect(etape?.texte).not.toMatch(/carrosserie/);
    expect(manifests.length).toBeGreaterThan(0);
    for (const manifest of manifests) {
      const master = masterZone(manifest);
      expect(master, manifest.id).toBeDefined();
      expect(orderedZones(manifest)[0], manifest.id).toBe(master);
    }
  });

  it('l’accueil vise la croix seule : la poignée n’est pas aux sections', () => {
    const cibles = TUTOS.find((tuto) => tuto.id === TUTO_ACCUEIL)?.etapes.map((etape) => etape.cible ?? '') ?? [];
    expect(cibles.some((cible) => cible.includes('.dock-close'))).toBe(true);
    expect(cibles.some((cible) => cible.includes('.dock-handle'))).toBe(false);
  });
});
