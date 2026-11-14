import { defineConfig } from 'vitest/config';

// Tests unitaires : logique pure uniquement (routage, réglages, outils de contrôle).
// Les parcours et le rendu passent par Playwright (tests/e2e).
export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
    restoreMocks: true,
  },
});
