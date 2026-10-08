import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Two pages: the current site (index.html) and the "Hello from Auckland" concept (hello.html).
export default defineConfig({
  build: {
    // three.js alone is ~560 kB minified (~140 kB gzipped); it's loaded on demand after first paint
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        hello: resolve(import.meta.dirname, 'hello.html'),
      },
      output: {
        // Libraries in their own chunks, so a change to the site's code doesn't change their file
        // names: returning visitors keep them from cache. (three is only ever loaded by the
        // dynamic import of the 3D scene; gsap and lenis are needed up front.)
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/ },
            // gsap's core and lenis, which both pages use; ScrollTrigger (old page only) stays out
            { name: 'motion', test: (id) => /node_modules[\\/](gsap|lenis)[\\/]/.test(id) && !/ScrollTrigger|Observer/.test(id) },
          ],
        },
      },
    },
  },
});
