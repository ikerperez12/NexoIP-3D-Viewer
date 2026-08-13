import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteStaticCopy } from 'vite-plugin-static-copy';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    viteStaticCopy({
      targets: [
        {
          src: 'node_modules/three/examples/jsm/libs/draco/*',
          dest: 'draco',
          rename: { stripBase: true }
        }
      ]
    })
  ],
  server: {
    host: '127.0.0.1',
    port: 3000,
    strictPort: true
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    reportCompressedSize: true
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.{js,jsx}'],
    passWithNoTests: false
  }
});
