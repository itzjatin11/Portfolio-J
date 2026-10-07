import { resolve } from 'node:path';
import { defineConfig } from 'vite';

// Two pages: the current site (index.html) and the "Hello from Auckland" concept (hello.html).
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        hello: resolve(import.meta.dirname, 'hello.html'),
      },
    },
  },
});
