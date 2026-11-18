// Dock : fermé, compact ou agrandi (origine, lecture tolérante, sauvegarde), pile des niveaux
// (« Retour »), et recadrage de la scène au-dessus du dock agrandi.
import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { createStore, get, set } from 'idb-keyval';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DOCK_TOP_MARGIN, dockShift, easeOutCubic } from '../../src/scene/fit.ts';
import { DEFAULT_DOCK, DOCK_KEY, dockSize, entryOf, sanitizeDock, sanitizeLevels } from '../../src/state/dock.ts';

describe('taille du dock', () => {
  it('part du dock compact', () => {
    expect(DEFAULT_DOCK).toEqual({ expanded: false, closed: false });
    expect(dockSize(DEFAULT_DOCK)).toBe('compact');
    expect(Object.isFrozen(DEFAULT_DOCK)).toBe(true);
  });

  it('lit une sauvegarde abîmée sans casser : seul un « vrai » explicite agrandit ou ferme', () => {
    // L'ancienne sauvegarde (`{ expanded }`, version 1) se relit telle quelle, dock ouvert.
    expect(sanitizeDock({ expanded: true })).toEqual({ expanded: true, closed: false });
    expect(sanitizeDock({ expanded: true, closed: true })).toEqual({ expanded: true, closed: true });
    expect(dockSize({ expanded: true, closed: true })).toBe('ferme');
    expect(dockSize({ expanded: true, closed: false })).toBe('agrandi');
    for (const raw of [null, undefined, 42, 'agrandi', [], {}, { expanded: 'true' }, { expanded: 1 }, { expanded: false }, { closed: 'oui' }]) {
      expect(sanitizeDock(raw), JSON.stringify(raw)).toEqual({ expanded: false, closed: false });
    }
  });
});

describe('pile des niveaux du dock', () => {
  it('n’accepte que l’ordre de l’atelier : une zone de peinture, puis le nuancier', () => {
    const zone = { kind: 'zone', zone: 'carrosserie', step: 'couleur' } as const;
    const picker = { kind: 'nuancier', target: 'color' } as const;
    expect(sanitizeLevels('peinture', [zone, picker])).toEqual([zone, picker]);
    expect(sanitizeLevels('peinture', [picker])).toEqual([]);
    expect(sanitizeLevels('peinture', [zone, zone])).toEqual([zone]);
    expect(sanitizeLevels('ambiance', [zone])).toEqual([]);
    expect(sanitizeLevels('peinture', [{ kind: 'zone', zone: '<b>', step: 'couleur' }])).toEqual([]);
    expect(sanitizeLevels('peinture', 'zone')).toEqual([]);
  });

  it('« Retour » remonte d’un niveau, toujours le même chemin ; changer d’onglet repart du haut', async () => {
    vi.resetModules();
    const { useDock } = await import('../../src/state/dock.ts');
    const dock = useDock.getState;
    // Au lancement : les sections, un seul niveau à l'écran.
    expect(dock().menu).toBe('sections');
    dock().setSection('custom');
    // Custom : ses entrées seulement ; Peinture : son contenu seulement.
    expect(dock().menu).toBe('entrees');
    dock().setEntry('peinture');
    expect(dock().menu).toBe('contenu');
    expect(dock().levels).toEqual([]);
    dock().push({ kind: 'zone', zone: 'carrosserie', step: 'couleur' });
    dock().replace({ kind: 'zone', zone: 'carrosserie', step: 'finition' });
    dock().push({ kind: 'nuancier', target: 'color' });
    expect(dock().levels.map((level) => level.kind)).toEqual(['zone', 'nuancier']);
    expect(dock().back()).toBe(true);
    expect(dock().levels).toEqual([{ kind: 'zone', zone: 'carrosserie', step: 'finition' }]);
    expect(dock().back()).toBe(true);
    expect(dock().levels).toEqual([]);
    // Puis du contenu aux entrées de Custom, et des entrées aux sections ; plus rien ensuite.
    expect(dock().menu).toBe('contenu');
    expect(dock().back()).toBe(true);
    expect(dock().menu).toBe('entrees');
    expect(dock().back()).toBe(true);
    expect(dock().menu).toBe('sections');
    expect(dock().back()).toBe(false);
    // La zone choisie reste pressée dans la liste.
    expect(dock().zone).toBe('carrosserie');
    dock().setSection('custom');
    dock().setEntry('peinture');
    dock().push({ kind: 'zone', zone: 'toit', step: 'couleur' });
    // Garage, deux entrées (Ambiance, Sortie de nuit) : ses entrées d'abord, puis le contenu ;
    // « Retour » remonte aux entrées, puis aux sections.
    dock().setSection('garage');
    expect(dock().menu).toBe('entrees');
    expect(dock().levels).toEqual([]);
    dock().setEntry('sortie');
    expect(dock().menu).toBe('contenu');
    expect(entryOf('garage', dock().entries)).toBe('sortie');
    expect(dock().back()).toBe(true);
    expect(dock().menu).toBe('entrees');
    expect(dock().back()).toBe(true);
    expect(dock().menu).toBe('sections');
    dock().setSection('garage');
    dock().setEntry('ambiance');
    // Hors de la peinture, rien ne s'empile.
    dock().push({ kind: 'zone', zone: 'toit', step: 'couleur' });
    expect(dock().levels).toEqual([]);
    // Une entrée « bientôt » ne s'ouvre pas.
    dock().setSection('custom');
    dock().setEntry('carrosserie');
    expect(entryOf('custom', dock().entries)).toBe('peinture');
    // Ouverture de l'extérieur, sur une zone : le dock se rouvre s'il était fermé.
    dock().setClosed(true);
    dock().openEntry('peinture', 'jantes');
    expect(dock().closed).toBe(false);
    expect(dock().section).toBe('custom');
    expect(dock().menu).toBe('contenu');
    expect(dock().levels).toEqual([{ kind: 'zone', zone: 'jantes', step: 'couleur' }]);
    // Fermer ramène le menu à son accueil : rouvert, il montre les sections, la section reste retenue.
    dock().setClosed(true);
    expect(dock().menu).toBe('sections');
    expect(dock().levels).toEqual([]);
    dock().setClosed(false);
    expect(dock().menu).toBe('sections');
    expect(dock().section).toBe('custom');
    // On y retourne en un appui, et la suite repart de là.
    dock().openEntry('peinture', 'jantes');
    dock().back();
    dock().back();
    expect(dock().menu).toBe('entrees');
    dock().openEntry('ambiance');
    expect(dock().section).toBe('garage');
    expect(dock().menu).toBe('contenu');
  });
});

describe('sauvegarde du dock', () => {
  type DockModule = typeof import('../../src/state/dock.ts');

  async function launch(): Promise<DockModule['useDock']> {
    vi.resetModules();
    const { useDock } = await import('../../src/state/dock.ts');
    await vi.waitFor(() => expect(useDock.getState().hydrated).toBe(true));
    return useDock;
  }

  const db = () => createStore('pimpmybichon', 'kv');

  beforeEach(() => {
    globalThis.indexedDB = new IDBFactory();
  });

  it('retrouve le dock agrandi au lancement suivant, sans sa mesure à l’écran', async () => {
    const first = await launch();
    expect(first.getState().expanded).toBe(false);
    first.getState().toggle();
    first.getState().setTop(320);
    await vi.waitFor(async () => {
      const raw = await get<string>(DOCK_KEY, db());
      expect(raw ? (JSON.parse(raw) as { state: unknown }).state : null).toEqual({ expanded: true, closed: false });
    });

    const second = await launch();
    expect(second.getState().expanded).toBe(true);
    expect(second.getState().top).toBeNull();

    second.getState().setExpanded(false);
    await vi.waitFor(async () => {
      const raw = await get<string>(DOCK_KEY, db());
      expect(raw ? (JSON.parse(raw) as { state: unknown }).state : null).toEqual({ expanded: false, closed: false });
    });

    // Fermé : retenu d'une ouverture à l'autre, avec la taille d'avant la fermeture.
    second.getState().setExpanded(true);
    second.getState().setClosed(true);
    const third = await launch();
    expect(third.getState().closed).toBe(true);
    expect(third.getState().expanded).toBe(true);
  });

  it('l’ancienne sauvegarde (version 1) rouvre le dock ouvert, à sa taille', async () => {
    await set(DOCK_KEY, JSON.stringify({ state: { expanded: true }, version: 1 }), db());
    const useDock = await launch();
    expect(useDock.getState().expanded).toBe(true);
    expect(useDock.getState().closed).toBe(false);
  });

  it('une sauvegarde illisible rouvre le dock compact', async () => {
    await set(DOCK_KEY, JSON.stringify({ state: { expanded: '<script>' }, version: 1 }), db());
    const useDock = await launch();
    expect(useDock.getState().expanded).toBe(false);
  });

  it('une sauvegarde d’une autre version passe par la lecture tolérante', async () => {
    await set(DOCK_KEY, JSON.stringify({ state: { expanded: true, extra: 1 }, version: 0 }), db());
    const useDock = await launch();
    expect(useDock.getState().expanded).toBe(true);
  });
});

describe('recadrage au-dessus du dock agrandi', () => {
  it('ne bouge rien sans dock agrandi', () => {
    expect(dockShift(844, null)).toBe(0);
    expect(dockShift(844, Number.NaN)).toBe(0);
    expect(dockShift(0, 300)).toBe(0);
  });

  it('amène la cible au milieu de la partie libre', () => {
    const height = 844;
    const top = 340;
    const shift = dockShift(height, top);
    // La cible, au centre de l'image, remonte de `shift` pixels.
    expect(height / 2 - shift).toBeCloseTo((height * DOCK_TOP_MARGIN + top) / 2, 0);
    expect(shift).toBeGreaterThan(0);
  });

  it('ne descend jamais la vue, et borne un haut de dock hors de l’écran', () => {
    expect(dockShift(844, 844)).toBe(0);
    expect(dockShift(844, 2000)).toBe(0);
    expect(dockShift(844, -50)).toBe(dockShift(844, 0));
  });

  it('la courbe de transition part de 0 et arrive à 1', () => {
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
    expect(easeOutCubic(2)).toBe(1);
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});
