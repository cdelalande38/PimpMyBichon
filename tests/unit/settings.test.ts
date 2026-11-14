import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings } from '../../src/state/settings.ts';

describe('sanitizeSettings', () => {
  it('garde une sauvegarde valide telle quelle', () => {
    const saved = { quality: 'max', autoRotate: false, textSize: 'tres-grand' } as const;
    expect(sanitizeSettings(saved)).toEqual(saved);
  });

  it('retombe sur l’origine pour tout ce qui n’est pas un objet', () => {
    for (const raw of [null, undefined, 42, 'max', true, []]) {
      expect(sanitizeSettings(raw)).toEqual(DEFAULT_SETTINGS);
    }
  });

  it('remplace une valeur inconnue par l’origine, champ par champ', () => {
    expect(
      sanitizeSettings({ quality: 'ultra', autoRotate: 'oui', textSize: 'grand' }),
    ).toEqual({ ...DEFAULT_SETTINGS, textSize: 'grand' });
  });

  it('ignore les champs en trop', () => {
    const result = sanitizeSettings({ quality: 'eco', hydrated: true, __proto__: { x: 1 } });
    expect(result).toEqual({ ...DEFAULT_SETTINGS, quality: 'eco' });
    expect(Object.keys(result).sort()).toEqual(['autoRotate', 'quality', 'textSize']);
  });

  it('démarre en qualité automatique, rotation activée, texte normal', () => {
    expect(DEFAULT_SETTINGS).toEqual({ quality: 'auto', autoRotate: true, textSize: 'normal' });
  });
});
