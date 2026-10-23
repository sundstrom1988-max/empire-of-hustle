import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';

// Versionen som visas i spelet: commit + tid för bygget
function buildStamp() {
    let hash = 'dev';
    try { hash = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { /* ingen git */ }
    const t = new Date();
    const pad = n => String(n).padStart(2, '0');
    return `${hash} · ${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())} ${pad(t.getHours())}:${pad(t.getMinutes())}`;
}

export default defineConfig({
    base: '/empire-of-hustle/',
    server: { port: 3000, open: true },
    build: { outDir: 'dist', assetsDir: 'assets' },
    define: { __BUILD__: JSON.stringify(buildStamp()) }
});
