import { defineConfig } from '@playwright/test';

// Les parcours tournent sur le site construit (dist/), servi par `vite preview` sous le même
// chemin que GitHub Pages : c'est le seul moyen d'éprouver le service worker et le hors-ligne.
const PORT = 4173;
const BASE_URL = `http://localhost:${PORT}/PimpMyBichon/`;

// Densité de pixels des captures : 1 par défaut (390 × 844 pixels, rapide en rendu logiciel).
// PMB_DSF=2 donne des captures plus fines pour une revue à l'œil.
const DEVICE_SCALE_FACTOR = Number(process.env.PMB_DSF ?? 1) || 1;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'test-results',
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  // WebGL en rendu logiciel occupe un cœur entier par page : inutile d'en lancer davantage.
  workers: 2,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list']],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: BASE_URL,
    // Gabarit de référence du cahier des charges : téléphone en portrait, 390 × 844.
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: DEVICE_SCALE_FACTOR,
    isMobile: true,
    hasTouch: true,
    locale: 'fr-FR',
    colorScheme: 'dark',
    // Scène immobile par défaut : en rendu logiciel, la rotation lente sature un cœur et
    // ralentit chaque action. Le parcours qui vérifie la rotation la réactive lui-même.
    reducedMotion: 'reduce',
    serviceWorkers: 'allow',
    trace: 'retain-on-failure',
    launchOptions: {
      // Machines sans carte graphique (CI) : WebGL en rendu logiciel.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
    },
  },
  projects: [{ name: 'telephone', use: { browserName: 'chromium' } }],
  webServer: {
    command: 'npm run preview',
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
