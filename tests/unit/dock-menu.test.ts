// Arbre du dock (src/data/dockMenu.ts) : sections, entrées, « bientôt », section Mécanique liée au moteur.
import { describe, expect, it } from 'vitest';
import { activeEntry, DOCK_MENU, sectionEntries, sectionOf, visibleSections } from '../../src/data/dockMenu.ts';

describe('arbre du dock', () => {
  it('quatre sections dans l’ordre, chacune au moins une entrée disponible, identifiants uniques', () => {
    expect(DOCK_MENU.map((section) => section.label)).toEqual(['Véhicule', 'Custom', 'Mécanique', 'Garage']);
    const ids = DOCK_MENU.flatMap((section) => section.entries.map((entry) => entry.id));
    expect(new Set(ids).size).toBe(ids.length);
    for (const section of DOCK_MENU) {
      expect(section.entries.some((entry) => entry.available), section.label).toBe(true);
      for (const entry of section.entries) expect(entry.label.trim(), entry.id).not.toBe('');
    }
  });

  it('les entrées prévues : Peinture puis cinq « bientôt » ; Préparation puis Moteur et Échappement', () => {
    const custom = DOCK_MENU.find((section) => section.id === 'custom');
    const mecanique = DOCK_MENU.find((section) => section.id === 'mecanique');
    expect(custom && sectionEntries(custom).map((entry) => [entry.label, entry.available])).toEqual([
      ['Peinture', true],
      ['Stickers', false],
      ['Carrosserie', false],
      ['Phares', false],
      ['Ailerons', false],
      ['Suspension', false],
    ]);
    expect(mecanique && sectionEntries(mecanique).map((entry) => entry.label)).toEqual(['Préparation', 'Moteur', 'Échappement']);
    // Masquées d'un coup : il ne reste que les entrées disponibles.
    expect(custom && sectionEntries(custom, false).map((entry) => entry.id)).toEqual(['peinture']);
  });

  it('« Mécanique » n’existe que pour un véhicule à moteur déclaré', () => {
    expect(visibleSections(true).map((section) => section.id)).toEqual(['vehicule', 'custom', 'mecanique', 'garage']);
    expect(visibleSections(false).map((section) => section.id)).toEqual(['vehicule', 'custom', 'garage']);
  });

  it('on arrive sur la dernière entrée utilisée, sinon la première disponible ; jamais sur un « bientôt »', () => {
    const custom = DOCK_MENU.find((section) => section.id === 'custom');
    if (!custom) throw new Error('section Custom absente');
    expect(activeEntry(custom, undefined)?.id).toBe('peinture');
    expect(activeEntry(custom, 'stickers')?.id).toBe('peinture');
    expect(sectionOf('ambiance')?.id).toBe('garage');
    expect(sectionOf('preparation')?.id).toBe('mecanique');
  });
});
