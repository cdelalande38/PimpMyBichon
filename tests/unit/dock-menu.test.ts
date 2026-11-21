// Arbre du dock (src/data/dockMenu.ts) : sections, entrées, « bientôt », section Mécanique liée au moteur.
import { describe, expect, it } from 'vitest';
import { activeEntry, directEntry, DOCK_MENU, sectionEntries, sectionOf, sectionsDeLaRangee, visibleSections } from '../../src/data/dockMenu.ts';

describe('arbre du dock', () => {
  it('Véhicule ouvre directement son contenu ; Custom et Mécanique montrent leurs entrées ; Garage (Ambiance seule) et Jouer s’ouvrent directement', () => {
    const direct = (id: string) => directEntry(DOCK_MENU.find((section) => section.id === id)!)?.id;
    expect(direct('vehicule')).toBe('vehicule');
    expect(direct('garage')).toBe('ambiance');
    expect(direct('jouer')).toBe('sortie');
    expect(direct('custom')).toBeUndefined();
    expect(direct('mecanique')).toBeUndefined();
    // Sans les « bientôt », Custom garde trois entrées (Peinture, Roues, Suspension) : il les montre.
    expect(directEntry(DOCK_MENU.find((section) => section.id === 'custom')!, false)).toBeUndefined();
    // Une section à une seule entrée disponible, sans « bientôt », s'ouvre directement.
    expect(directEntry({ id: 'custom', label: 'Custom', entries: [{ id: 'peinture', label: 'Peinture', available: true }, { id: 'stickers', label: 'Stickers', available: false }] }, false)?.id).toBe('peinture');
  });

  it('quatre sections dans l’ordre (plus la cachée « Jouer »), chacune au moins une entrée disponible, identifiants uniques', () => {
    expect(DOCK_MENU.map((section) => section.label)).toEqual(['Véhicule', 'Custom', 'Mécanique', 'Garage', 'Jouer']);
    const ids = DOCK_MENU.flatMap((section) => section.entries.map((entry) => entry.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of DOCK_MENU) {
      expect(section.entries.some((entry) => entry.available), section.label).toBe(true);
      for (const entry of section.entries) expect(entry.label.trim(), entry.id).not.toBe('');
    }
  });

  it('les entrées prévues : Peinture, Roues, Suspension, Intérieur, Stickers, Carrosserie, Phares, Ailerons et Néons ; Préparation, Moteur et Échappement ; Ambiance ; « Jouer » n’est plus dans le menu', () => {
    const custom = DOCK_MENU.find((section) => section.id === 'custom');
    const mecanique = DOCK_MENU.find((section) => section.id === 'mecanique');
    expect(custom && sectionEntries(custom).map((entry) => [entry.label, entry.available])).toEqual([
      ['Peinture', true],
      ['Roues', true],
      ['Suspension', true],
      ['Intérieur', true],
      ['Stickers', true],
      ['Carrosserie', true],
      ['Phares', true],
      ['Ailerons', true],
      ['Néons', true],
    ]);
    expect(mecanique && sectionEntries(mecanique).map((entry) => [entry.label, entry.available])).toEqual([
      ['Préparation', true],
      ['Moteur', true],
      ['Échappement', true],
    ]);
    // Garage : l'ambiance seule. L'écran « Jouer » (§ 5.5) a sa section cachée, ouverte par son bouton.
    const garage = DOCK_MENU.find((section) => section.id === 'garage');
    expect(garage && sectionEntries(garage).map((entry) => [entry.label, entry.available])).toEqual([['Ambiance', true]]);
    const jouer = DOCK_MENU.find((section) => section.id === 'jouer');
    expect(jouer?.cachee).toBe(true);
    expect(jouer && sectionEntries(jouer).map((entry) => entry.id)).toEqual(['sortie']);
    expect(sectionsDeLaRangee(true).map((section) => section.id)).not.toContain('jouer');
    // Masquées d'un coup : il ne reste que les entrées disponibles.
    expect(custom && sectionEntries(custom, false).map((entry) => entry.id)).toEqual(['peinture', 'roues', 'suspension', 'interieur', 'stickers', 'carrosserie', 'phares', 'ailerons', 'neons']);
  });

  it('« Mécanique » n’existe que pour un véhicule à moteur déclaré', () => {
    expect(sectionsDeLaRangee(true).map((section) => section.id)).toEqual(['vehicule', 'custom', 'mecanique', 'garage']);
    expect(sectionsDeLaRangee(false).map((section) => section.id)).toEqual(['vehicule', 'custom', 'garage']);
    expect(visibleSections(false).map((section) => section.id)).toEqual(['vehicule', 'custom', 'garage', 'jouer']);
  });

  it('on arrive sur la dernière entrée utilisée, sinon la première disponible ; jamais sur un « bientôt »', () => {
    const custom = DOCK_MENU.find((section) => section.id === 'custom');
    if (!custom) throw new Error('section Custom absente');
    expect(activeEntry(custom, undefined)?.id).toBe('peinture');
    expect(activeEntry(custom, 'carrosserie')?.id).toBe('carrosserie');
    expect(activeEntry({ id: 'custom', label: 'Custom', entries: [{ id: 'peinture', label: 'Peinture', available: true }, { id: 'carrosserie', label: 'Carrosserie', available: false }] }, 'carrosserie')?.id).toBe('peinture');
    expect(sectionOf('ambiance')?.id).toBe('garage');
    expect(sectionOf('sortie')?.id).toBe('jouer');
    expect(sectionOf('preparation')?.id).toBe('mecanique');
  });
});
