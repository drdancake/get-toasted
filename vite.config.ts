import { defineConfig } from 'vite';

export default defineConfig({
  // Relative base so the build works from GitHub Pages or any subfolder.
  base: './',
  server: { host: true, port: 5173 },
  build: { target: 'es2022', sourcemap: false },
});
