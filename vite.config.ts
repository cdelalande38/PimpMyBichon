import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import { detectPrivateAssets } from './tools/private-assets.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as {
  version: string;
};

function git(args: string[]): string | null {
  try {
    const out = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out.trim() || null;
  } catch {
    return null;
  }
}

// GitHub Pages sert un site de projet sous /<nom-du-dépôt>/ (§ 11).
// PMB_BASE permet un autre socle, par exemple "./" pour un APK qui embarque les fichiers.
const base = process.env.PMB_BASE ?? '/PimpMyBichon/';

// Identité du build, affichée dans « Sous le capot » pour savoir quelle version tourne sur le téléphone.
// Un « + » signale un arbre de travail modifié par rapport au commit.
const head = process.env.GITHUB_SHA ?? git(['rev-parse', 'HEAD']);
const dirty = process.env.GITHUB_SHA ? false : Boolean(git(['status', '--porcelain']));
const buildInfo = {
  version: pkg.version,
  commit: head ? `${head.slice(0, 7)}${dirty ? '+' : ''}` : 'local',
  date: git(['log', '-1', '--format=%cI']) ?? '',
  privateAssets: detectPrivateAssets({ root }),
};

const NIGHT = '#0a0911';

export default defineConfig({
  base,
  define: {
    __PMB_BUILD__: JSON.stringify(buildInfo),
  },
  plugins: [
    react(),
    VitePWA({
      // Service worker écrit à la main : progression du précache et, plus tard,
      // mise en cache à la demande des véhicules et des stations de radio.
      strategies: 'injectManifest',
      srcDir: 'src/pwa',
      filename: 'sw.ts',
      // Jamais de rechargement surprise : la nouvelle version attend un geste ou le prochain lancement.
      registerType: 'prompt',
      injectRegister: false,
      // Les icônes entrent déjà dans le précache par le motif de fichiers : pas de doublon.
      includeManifestIcons: false,
      manifest: {
        name: 'PimpMyBichon',
        short_name: 'PimpMyBichon',
        description:
          'L’atelier de Bichon : prépare un véhicule dans le garage, sors-le de nuit, livre la commande.',
        lang: 'fr',
        dir: 'ltr',
        id: base,
        start_url: base,
        scope: base,
        display: 'standalone',
        orientation: 'portrait',
        background_color: NIGHT,
        theme_color: NIGHT,
        icons: [
          { src: 'icons/pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'icons/pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
          {
            src: 'icons/monochrome-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'monochrome',
          },
        ],
      },
      injectManifest: {
        // Script classique : le type de service worker le plus largement pris en charge.
        rollupFormat: 'iife',
        // Précache : toute la coque de l'app. Les véhicules et la musique n'y entrent pas,
        // ils se téléchargent à la demande puis restent hors ligne (§ 7).
        globPatterns: ['**/*.{js,css,html,woff2,svg,png,webp,ico}'],
        globIgnores: ['assets/vehicles/**', 'assets/audio/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    // three.js pèse environ 700 ko minifié à lui seul : le seuil par défaut (500 ko)
    // signalerait un avertissement permanent et sans objet.
    chunkSizeWarningLimit: 1200,
    rolldownOptions: {
      output: {
        // Morceaux stables d'un déploiement à l'autre : sur un mauvais réseau,
        // une mise à jour de l'app ne retélécharge pas three.js.
        // Un groupe emporte aussi les dépendances de ses modules : la priorité la plus haute va
        // donc à React, sinon il partirait dans le morceau 3D et la coque attendrait three.js.
        codeSplitting: {
          groups: [
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler|zustand|use-sync-external-store)[\\/]/,
              priority: 30,
            },
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 20 },
            {
              name: 'r3f',
              test: /node_modules[\\/](@react-three|postprocessing|three-stdlib|maath)[\\/]/,
              priority: 10,
            },
          ],
        },
      },
    },
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
});
