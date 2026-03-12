import { defineConfig } from 'vite';

export default defineConfig({
    base: '/empire-of-hustle/',
    server: { port: 3000, open: true },
    build: { outDir: 'dist', assetsDir: 'assets' }
});
