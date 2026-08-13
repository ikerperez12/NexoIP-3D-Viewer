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
          src: 'node_modules/three/examples/jsm/libs/draco/draco_decoder.wasm',
          dest: 'draco',
          rename: { stripBase: true }
        },
        {
          src: 'node_modules/three/examples/jsm/libs/draco/draco_wasm_wrapper.js',
          dest: 'draco',
          rename: { stripBase: true }
        },
        {
          src: 'node_modules/three/examples/jsm/libs/basis/basis_transcoder.js',
          dest: 'basis',
          rename: { stripBase: true }
        },
        {
          src: 'node_modules/three/examples/jsm/libs/basis/basis_transcoder.wasm',
          dest: 'basis',
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
