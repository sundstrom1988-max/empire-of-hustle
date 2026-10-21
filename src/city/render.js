// ═══════════════════════════════════════════
//  STAN — rendering i GTA2-stil
//  Marken cachas i bitar. Husen ritas med
//  perspektiv: taken skalas ut från kamerans
//  mitt så att stan ser 3D ut. Ovanpå det
//  läggs mörker med strålkastare och blåljus.
// ═══════════════════════════════════════════

import { TILE, T, N, E, S, W, DX, DY } from './constants.js';
import { tileAt, laneDirs } from './map.js';
import { phoneOpen } from './missions.js';
import { SHOPS } from '../data/gameData.js';

const CHUNK = 8; // rutor per cache-bit
const CHUNK_PX = CHUNK * TILE;
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

function tileHash(x, y) {
    let h = (x * 374761393 + y * 668265263) >>> 0;
    h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}

function shadeColor(hex, f) {
    if (!hex || hex[0] !== '#') return hex;
    const n = parseInt(hex.slice(1), 16);
    const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
    const g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
    const b = clamp(Math.round((n & 255) * f), 0, 255);
    return `rgb(${r},${g},${b})`;
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

const hasV = m => (m & ((1 << N) | (1 << S))) !== 0;
const hasH = m => (m & ((1 << E) | (1 << W))) !== 0;

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext('2d', { alpha: false });
        this.light = document.createElement('canvas');
        this.lctx = this.light.getContext('2d');
        this.chunks = new Map();
        this.cam = null;
        this.dpr = 1; this.w = 1; this.h = 1;
        this.t = 0;
        this.resize();
    }

    resize() {
        this.dpr = Math.min(2, window.devicePixelRatio || 1);
        this.w = Math.max(1, this.canvas.clientWidth);
        this.h = Math.max(1, this.canvas.clientHeight);
        this.canvas.width = Math.round(this.w * this.dpr);
        this.canvas.height = Math.round(this.h * this.dpr);
        this.light.width = Math.ceil(this.w / 2);
        this.light.height = Math.ceil(this.h / 2);
    }

    // ── Kamera: följer spelaren, tittar framåt, zoomar ut i fart ──
    updateCamera(world, dt) {
        const p = world.player, v = p.vehicle;
        const vx = v ? v.vx : 0, vy = v ? v.vy : 0;
        const tx = p.x + vx * 0.4, ty = p.y + vy * 0.4;
        const base = clamp(Math.min(this.w, this.h) / 900, 0.55, 1);
        const speed = Math.hypot(vx, vy);
        const zTarget = base * (1 - Math.min(0.3, speed / 1700));
        if (!this.cam) this.cam = { x: tx, y: ty, zoom: zTarget };
        const k = Math.min(1, dt * 4);
        this.cam.x += (tx - this.cam.x) * k;
        this.cam.y += (ty - this.cam.y) * k;
        this.cam.zoom += (zTarget - this.cam.zoom) * Math.min(1, dt * 1.6);
        const sh = dt > 0 ? world.shake * 9 : 0; // ingen skakning när spelet står pausat
        this.cam.sx = (Math.random() - 0.5) * sh;
        this.cam.sy = (Math.random() - 0.5) * sh;
    }

    worldToScreen(x, y) {
        const c = this.cam;
        return { x: (x - c.x) * c.zoom + this.w / 2, y: (y - c.y) * c.zoom + this.h / 2 };
    }

    draw(world, dt) {
        if (!this.cam) this.updateCamera(world, 0);
        this.t += dt;
        const ctx = this.ctx, c = this.cam, dpr = this.dpr;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#101018';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        const z = c.zoom * dpr;
        ctx.setTransform(z, 0, 0, z, this.canvas.width / 2 - c.x * z + c.sx * dpr, this.canvas.height / 2 - c.y * z + c.sy * dpr);
        const hw = this.w / 2 / c.zoom, hh = this.h / 2 / c.zoom;
        const view = { x0: c.x - hw, y0: c.y - hh, x1: c.x + hw, y1: c.y + hh };

        this.drawGround(world.city, view);
        this.drawWater(world.city, view);
        this.drawSkids(world);
        this.drawMarkers(world, view);
        this.drawPickups(world, view);
        this.drawPeds(world, view);
        this.drawPlayerOnFoot(world);
        this.drawVehicles(world, view);
        this.drawTrees(world.city, view);
        this.drawBuildings(world, view);
        this.drawParticles(world, view);
        this.drawTargetMarker(world);
        this.drawFloaters(world);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.drawLighting(world, view);
    }

    // ── Mark ──
    drawGround(city, v) {
        const ctx = this.ctx;
        const cx0 = Math.floor(v.x0 / CHUNK_PX), cx1 = Math.floor(v.x1 / CHUNK_PX);
        const cy0 = Math.floor(v.y0 / CHUNK_PX), cy1 = Math.floor(v.y1 / CHUNK_PX);
        for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
            if (cx < 0 || cy < 0 || cx * CHUNK >= city.w || cy * CHUNK >= city.h) continue;
            ctx.drawImage(this.chunk(city, cx, cy), cx * CHUNK_PX, cy * CHUNK_PX);
        }
    }

    chunk(city, cx, cy) {
        const key = cx + ',' + cy;
        let cv = this.chunks.get(key);
        if (cv) { this.chunks.delete(key); this.chunks.set(key, cv); return cv; }
        cv = document.createElement('canvas');
        cv.width = CHUNK_PX; cv.height = CHUNK_PX;
        const g = cv.getContext('2d');
        for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) {
            this.drawTile(g, city, cx * CHUNK + lx, cy * CHUNK + ly, lx * TILE, ly * TILE);
        }
        this.chunks.set(key, cv);
        if (this.chunks.size > 90) this.chunks.delete(this.chunks.keys().next().value);
        return cv;
    }

    drawTile(g, city, tx, ty, x, y) {
        const t = tileAt(city, tx, ty);
        const h = tileHash(tx, ty);
        const speckle = (base, light, dark, n) => {
            g.fillStyle = base; g.fillRect(x, y, TILE, TILE);
            for (let i = 0; i < n; i++) {
                const r = tileHash(h + i, i * 7);
                g.fillStyle = r & 1 ? light : dark;
                g.fillRect(x + (r % 61), y + ((r >> 8) % 61), 2 + (r >> 20) % 3, 2 + (r >> 24) % 3);
            }
        };
        switch (t) {
            case T.ROAD: {
                speckle('#2c2e35', '#33363e', '#25272d', 10);
                const m = laneDirs(city, tx, ty);
                const isRoad = (ax, ay) => tileAt(city, ax, ay) === T.ROAD;
                const inter = (ax, ay) => { const mm = laneDirs(city, ax, ay); return hasV(mm) && hasH(mm); };
                if (hasV(m) && !hasH(m)) {
                    if (m & (1 << S)) { g.fillStyle = '#e8b923'; g.fillRect(x + 61, y + 6, 3, 22); g.fillRect(x + 61, y + 38, 3, 22); }
                    if (m & (1 << N)) { g.fillStyle = '#e8b923'; g.fillRect(x, y + 6, 3, 22); g.fillRect(x, y + 38, 3, 22); }
                    g.fillStyle = 'rgba(255,255,255,0.55)';
                    if (!isRoad(tx - 1, ty)) g.fillRect(x + 4, y, 2, TILE);
                    if (!isRoad(tx + 1, ty)) g.fillRect(x + 58, y, 2, TILE);
                    const zebraTop = inter(tx, ty - 1), zebraBot = inter(tx, ty + 1);
                    if (zebraTop || zebraBot) {
                        g.fillStyle = 'rgba(240,240,240,0.75)';
                        for (let i = 0; i < 5; i++) g.fillRect(x + 6 + i * 11, zebraTop ? y + 4 : y + 42, 7, 18);
                    }
                } else if (hasH(m) && !hasV(m)) {
                    if (m & (1 << W)) { g.fillStyle = '#e8b923'; g.fillRect(x + 6, y + 61, 22, 3); g.fillRect(x + 38, y + 61, 22, 3); }
                    if (m & (1 << E)) { g.fillStyle = '#e8b923'; g.fillRect(x + 6, y, 22, 3); g.fillRect(x + 38, y, 22, 3); }
                    g.fillStyle = 'rgba(255,255,255,0.55)';
                    if (!isRoad(tx, ty - 1)) g.fillRect(x, y + 4, TILE, 2);
                    if (!isRoad(tx, ty + 1)) g.fillRect(x, y + 58, TILE, 2);
                    const zl = inter(tx - 1, ty), zr = inter(tx + 1, ty);
                    if (zl || zr) {
                        g.fillStyle = 'rgba(240,240,240,0.75)';
                        for (let i = 0; i < 5; i++) g.fillRect(zl ? x + 4 : x + 42, y + 6 + i * 11, 18, 7);
                    }
                } else if ((h & 15) === 0) {
                    g.fillStyle = '#3a3c44'; g.beginPath(); g.arc(x + 32, y + 32, 7, 0, Math.PI * 2); g.fill(); // brunnslock
                }
                break;
            }
            case T.SIDEWALK: {
                g.fillStyle = '#80838b'; g.fillRect(x, y, TILE, TILE);
                g.strokeStyle = '#6f727a'; g.lineWidth = 1;
                g.beginPath();
                g.moveTo(x + 32.5, y); g.lineTo(x + 32.5, y + TILE);
                g.moveTo(x, y + 32.5); g.lineTo(x + TILE, y + 32.5);
                g.stroke();
                if ((h & 7) === 0) { g.fillStyle = '#6b6e75'; g.fillRect(x + (h >> 8) % 40 + 8, y + (h >> 16) % 40 + 8, 6, 3); }
                g.fillStyle = '#a7aab1';
                for (let d = 0; d < 4; d++) {
                    if (tileAt(city, tx + DX[d], ty + DY[d]) !== T.ROAD) continue;
                    if (d === N) g.fillRect(x, y, TILE, 4);
                    if (d === S) g.fillRect(x, y + 60, TILE, 4);
                    if (d === W) g.fillRect(x, y, 4, TILE);
                    if (d === E) g.fillRect(x + 60, y, 4, TILE);
                }
                break;
            }
            case T.GRASS: case T.TREE:
                speckle('#3d6b2f', '#4b7f3a', '#335c27', 18);
                if (t === T.TREE) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(x + 36, y + 38, 26, 22, 0, 0, Math.PI * 2); g.fill(); }
                break;
            case T.PLAZA:
                g.fillStyle = '#a89f8c'; g.fillRect(x, y, TILE, TILE);
                g.fillStyle = '#9b927e'; g.fillRect(x, y, 32, 32); g.fillRect(x + 32, y + 32, 32, 32);
                break;
            case T.LOT:
                speckle('#34363c', '#3b3d44', '#2e3035', 8);
                g.fillStyle = 'rgba(255,255,255,0.45)';
                g.fillRect(x, y, 2, 30); g.fillRect(x, y + 34, 2, 30);
                break;
            case T.WATER:
                g.fillStyle = '#1b4b7d'; g.fillRect(x, y, TILE, TILE);
                g.fillStyle = '#1f5690'; g.fillRect(x + (h % 30), y + ((h >> 8) % 50), 22, 3);
                break;
            case T.WALL:
                g.fillStyle = '#2a2224'; g.fillRect(x, y, TILE, TILE);
                g.fillStyle = '#3a2f31';
                for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) g.fillRect(x + c * 32 + (r & 1) * 16, y + r * 16, 30, 14);
                break;
            default:
                g.fillStyle = '#1d1e24'; g.fillRect(x, y, TILE, TILE);
        }
    }

    drawWater(city, v) {
        const ctx = this.ctx;
        const x0 = Math.max(0, Math.floor(v.x0 / TILE)), x1 = Math.min(city.w - 1, Math.floor(v.x1 / TILE));
        const y0 = Math.max(0, Math.floor(v.y0 / TILE)), y1 = Math.min(city.h - 1, Math.floor(v.y1 / TILE));
        ctx.strokeStyle = 'rgba(160,210,255,0.35)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
            if (tileAt(city, tx, ty) !== T.WATER) continue;
            const ph = this.t * 1.5 + tx * 0.7 + ty * 1.3;
            const ox = tx * TILE + 10 + Math.sin(ph) * 8, oy = ty * TILE + 20 + ((tx * 13 + ty * 7) % 30);
            ctx.moveTo(ox, oy); ctx.quadraticCurveTo(ox + 10, oy - 5, ox + 20, oy);
        }
        ctx.stroke();
    }

    drawSkids(world) {
        const ctx = this.ctx;
        for (const s of world.scorches) {
            const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r);
            g.addColorStop(0, 'rgba(8,6,6,0.75)');
            g.addColorStop(0.6, 'rgba(15,12,10,0.4)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        }
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        for (const s of world.skids) {
            ctx.strokeStyle = `rgba(10,10,12,${Math.min(0.55, s.life / 14 * 0.55)})`;
            ctx.beginPath(); ctx.moveTo(s.x1, s.y1); ctx.lineTo(s.x2, s.y2); ctx.stroke();
        }
        ctx.lineCap = 'butt';
    }

    emoji(text, x, y, size) {
        const ctx = this.ctx;
        ctx.font = `${size}px ${EMOJI_FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y);
    }

    ring(x, y, r, color, width = 3) {
        const ctx = this.ctx;
        ctx.strokeStyle = color; ctx.lineWidth = width;
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
    }

    // ── Platser på marken ──
    drawMarkers(world, view) {
        const ctx = this.ctx, m = world.city.markers, t = this.t;
        const vis = (o, pad = 80) => o.x > view.x0 - pad && o.x < view.x1 + pad && o.y > view.y0 - pad && o.y < view.y1 + pad;
        const pulse = 0.5 + 0.5 * Math.sin(t * 5);
        for (const ph of m.phones) {
            if (!vis(ph)) continue;
            const open = phoneOpen(world.profile.respect || {}, ph.gang) && !world.mission;
            const col = { kebab: '#22c55e', orden: '#a855f7', taco: '#f97316' }[ph.gang];
            ctx.fillStyle = open ? col : '#555';
            ctx.globalAlpha = open ? 0.25 + pulse * 0.25 : 0.25;
            ctx.beginPath(); ctx.arc(ph.x, ph.y, 30 + (open ? pulse * 8 : 0), 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
            roundRect(ctx, ph.x - 10, ph.y - 16, 20, 28, 4); ctx.fillStyle = '#1f2937'; ctx.fill();
            ctx.strokeStyle = col; ctx.lineWidth = 2; ctx.stroke();
            this.emoji('☎️', ph.x, ph.y - 2 + (open ? Math.sin(t * 20) * 1.5 : 0), 16);
        }
        for (const sp of m.sprays) {
            if (!vis(sp)) continue;
            ctx.fillStyle = 'rgba(56,189,248,0.25)'; ctx.fillRect(sp.x - 30, sp.y - 30, 60, 60);
            ctx.strokeStyle = '#38bdf8'; ctx.lineWidth = 2; ctx.setLineDash([8, 6]); ctx.strokeRect(sp.x - 30, sp.y - 30, 60, 60); ctx.setLineDash([]);
            this.emoji('🎨', sp.x, sp.y, 24);
        }
        if (vis(m.fence)) {
            const f = m.fence;
            ctx.save(); ctx.beginPath(); ctx.rect(f.x - 34, f.y - 34, 68, 68); ctx.clip();
            for (let i = -4; i < 6; i++) { ctx.fillStyle = i & 1 ? '#111' : '#eab308'; ctx.beginPath(); ctx.moveTo(f.x - 34 + i * 16, f.y - 34); ctx.lineTo(f.x - 18 + i * 16, f.y - 34); ctx.lineTo(f.x - 50 + i * 16, f.y + 34); ctx.lineTo(f.x - 66 + i * 16, f.y + 34); ctx.fill(); }
            ctx.restore();
            ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(f.x - 26, f.y - 26, 52, 52);
            this.emoji('🔧', f.x, f.y, 26);
        }
        const h = m.home;
        if (vis(h)) {
            ctx.fillStyle = `rgba(255,210,63,${0.15 + pulse * 0.15})`;
            ctx.beginPath(); ctx.arc(h.x, h.y, 34, 0, Math.PI * 2); ctx.fill();
            this.emoji('🏠', h.x, h.y, 22);
        }
        const owned = world.profile.owned || [];
        const collected = world.profile.cityCollected || [];
        for (const b of m.businesses) {
            const shop = SHOPS[b.slot];
            if (!shop || !owned.includes(shop.id) || !vis(b)) continue;
            const done = collected.includes(shop.id);
            ctx.fillStyle = done ? 'rgba(120,120,120,0.25)' : `rgba(255,210,63,${0.25 + pulse * 0.3})`;
            ctx.beginPath(); ctx.arc(b.x, b.y, 26, 0, Math.PI * 2); ctx.fill();
            this.emoji(done ? '✔️' : '💰', b.x, b.y, 18);
        }
    }

    drawPickups(world, view) {
        const ctx = this.ctx;
        const icons = { cash: '💰', repair: '🔧', nitro: '⚡', bribe: '👮', health: '❤️' };
        const cols = { cash: '#ffd23f', repair: '#94a3b8', nitro: '#38bdf8', bribe: '#60a5fa', health: '#ef4444' };
        for (const pk of world.pickups) {
            if (pk.taken || pk.x < view.x0 - 30 || pk.x > view.x1 + 30 || pk.y < view.y0 - 30 || pk.y > view.y1 + 30) continue;
            const s = 1 + Math.sin(this.t * 4 + pk.phase) * 0.12;
            ctx.save(); ctx.translate(pk.x, pk.y); ctx.rotate(Math.sin(this.t * 2 + pk.phase) * 0.3); ctx.scale(s, s);
            ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-11, -9, 24, 24);
            ctx.fillStyle = '#7c5a2c'; ctx.fillRect(-12, -12, 24, 24);
            ctx.strokeStyle = cols[pk.type]; ctx.lineWidth = 3; ctx.strokeRect(-12, -12, 24, 24);
            ctx.restore();
            this.emoji(icons[pk.type], pk.x, pk.y, 15);
        }
    }

    // ── Folk ──
    drawPedShape(ctx, ped, shirt, skin, hair, phase, scale = 1) {
        ctx.save();
        ctx.translate(ped.x, ped.y);
        if (ped.down > 0) {
            ctx.rotate(ped.angle + Math.PI / 2);
            ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(1, 2, 6, 11, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = shirt; ctx.beginPath(); ctx.ellipse(0, 0, 5, 9, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, -11, 3.5, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            return;
        }
        ctx.rotate(ped.angle);
        ctx.scale(scale, scale);
        const swing = Math.sin(phase) * 4;
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(2, 2, 6, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#1f2937';
        ctx.fillRect(swing - 2, -4, 5, 3); ctx.fillRect(-swing - 2, 1, 5, 3);
        ctx.fillStyle = shirt; ctx.beginPath(); ctx.ellipse(0, 0, 4.2, 7, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0.5, 0, 3.4, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = hair; ctx.beginPath(); ctx.arc(-0.6, 0, 3.2, Math.PI * 0.5, Math.PI * 1.5); ctx.fill();
        ctx.restore();
    }

    drawPeds(world, view) {
        const ctx = this.ctx;
        for (const ped of world.peds) {
            if (ped.x < view.x0 - 20 || ped.x > view.x1 + 20 || ped.y < view.y0 - 20 || ped.y > view.y1 + 20) continue;
            this.drawPedShape(ctx, ped, ped.cop ? '#1e3a8a' : ped.shirt, ped.skin, ped.cop ? '#0f172a' : ped.hair, ped.phase);
            if (ped.down > 0 && ped.down > 2) this.emoji('💫', ped.x, ped.y - 14, 12);
        }
    }

    drawPlayerOnFoot(world) {
        const p = world.player;
        if (p.vehicle) return;
        const ctx = this.ctx;
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.t * 6);
        this.ring(p.x, p.y, 15, p.color, 2);
        ctx.globalAlpha = 1;
        const fake = { x: p.x, y: p.y, angle: p.angle, down: p.dead ? 1 : 0 };
        this.drawPedShape(ctx, fake, p.color, '#e0ac69', '#1f1300', p.walkPhase, 1.15);
        this.emoji(p.charIcon, p.x, p.y - 22, 14);
    }

    // ── Fordon ──
    drawVehicles(world, view) {
        const ctx = this.ctx;
        const flash = Math.sin(this.t * 14) > 0;
        for (const v of world.vehicles) {
            if (v.x < view.x0 - 60 || v.x > view.x1 + 60 || v.y < view.y0 - 60 || v.y > view.y1 + 60) continue;
            ctx.save();
            ctx.translate(v.x, v.y);
            ctx.rotate(v.angle);
            const L = v.spec.l, Wd = v.spec.w;
            if (v.spec.kind === 'bike') { this.drawBike(ctx, v, L, Wd); ctx.restore(); continue; }
            ctx.fillStyle = 'rgba(0,0,0,0.38)';
            roundRect(ctx, -L / 2 + 3, -Wd / 2 + 4, L, Wd, 6); ctx.fill();
            const body = v.exploded ? '#1a1a1a' : v.wrecked ? shadeColor(v.color, 0.35) : v.color;
            ctx.fillStyle = body;
            roundRect(ctx, -L / 2, -Wd / 2, L, Wd, 6); ctx.fill();
            ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.5; ctx.stroke();
            if (!v.exploded) {
                // Huv-glans
                ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(L * 0.3, -Wd / 2 + 3, L * 0.16, Wd - 6);
                // Rutor
                ctx.fillStyle = v.wrecked ? '#0b0b0b' : '#1c2635';
                ctx.beginPath(); ctx.moveTo(L * 0.1, -Wd / 2 + 2.5); ctx.lineTo(L * 0.27, -Wd / 2 + 4); ctx.lineTo(L * 0.27, Wd / 2 - 4); ctx.lineTo(L * 0.1, Wd / 2 - 2.5); ctx.fill();
                ctx.beginPath(); ctx.moveTo(-L * 0.3, -Wd / 2 + 3.5); ctx.lineTo(-L * 0.2, -Wd / 2 + 2.5); ctx.lineTo(-L * 0.2, Wd / 2 - 2.5); ctx.lineTo(-L * 0.3, Wd / 2 - 3.5); ctx.fill();
                ctx.fillStyle = 'rgba(160,200,255,0.25)'; ctx.fillRect(L * 0.12, -Wd / 2 + 4, 3, Wd - 8);
                // Tak
                ctx.fillStyle = shadeColor(v.color, v.wrecked ? 0.3 : 1.12);
                roundRect(ctx, -L * 0.2, -Wd / 2 + 3, L * 0.3, Wd - 6, 3); ctx.fill();
                // Lampor
                ctx.fillStyle = '#fff7c2'; ctx.fillRect(L / 2 - 3, -Wd / 2 + 2, 3, 4); ctx.fillRect(L / 2 - 3, Wd / 2 - 6, 3, 4);
                ctx.fillStyle = v.braking ? '#ff3b3b' : '#991b1b'; ctx.fillRect(-L / 2, -Wd / 2 + 2, 3, 4); ctx.fillRect(-L / 2, Wd / 2 - 6, 3, 4);
                if (v.spec.police) {
                    ctx.fillStyle = '#1d4ed8'; ctx.fillRect(-L / 2 + 4, -Wd / 2, L - 8, 3); ctx.fillRect(-L / 2 + 4, Wd / 2 - 3, L - 8, 3);
                    ctx.fillStyle = '#facc15';
                    for (let i = 0; i < 5; i++) { ctx.fillRect(-L / 2 + 6 + i * 7, -Wd / 2, 3.5, 3); ctx.fillRect(-L / 2 + 9.5 + i * 7, Wd / 2 - 3, 3.5, 3); }
                    const on = v.siren;
                    ctx.fillStyle = on && flash ? '#ef4444' : '#7f1d1d'; ctx.fillRect(-4, -Wd / 2 + 4, 6, (Wd - 8) / 2);
                    ctx.fillStyle = on && !flash ? '#3b82f6' : '#1e3a8a'; ctx.fillRect(-4, 0, 6, (Wd - 8) / 2);
                }
                if (v.spec.taxi) { ctx.fillStyle = '#111'; ctx.fillRect(-6, -4, 9, 8); ctx.fillStyle = '#fde047'; ctx.fillRect(-5, -3, 7, 6); }
                if (v.spec.gang) {
                    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(-L / 2 + 2, -1.5, L - 4, 3);
                    ctx.rotate(-v.angle);
                    this.emoji({ kebab: '🥙', orden: '🧙', taco: '🌮' }[v.spec.gang], 0, 0, 12);
                    ctx.rotate(v.angle);
                }
                if (v.spec.sport) { ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(-L / 2 + 2, -2, L - 6, 1.5); ctx.fillRect(-L / 2 + 2, 1, L - 6, 1.5); }
                if (v.owned && !v.driver) { ctx.rotate(-v.angle); this.emoji('🔑', 0, -Wd, 11); ctx.rotate(v.angle); }
                if (v.hp < v.maxHp * 0.5) {
                    ctx.fillStyle = 'rgba(0,0,0,0.35)';
                    ctx.beginPath(); ctx.arc(L * 0.38, -Wd * 0.2, 4, 0, Math.PI * 2); ctx.arc(-L * 0.4, Wd * 0.25, 3, 0, Math.PI * 2); ctx.fill();
                }
            }
            ctx.restore();
            if (v.tag && !v.wrecked && world.mission && (world.mission.car === v || (world.mission.cars || []).includes(v))) {
                ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.t * 8);
                this.ring(v.x, v.y, v.spec.l * 0.7, '#ffd23f', 3);
                ctx.globalAlpha = 1;
            }
        }
    }

    drawBike(ctx, v, L, Wd) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-L / 2 + 2, -Wd / 4 + 3, L, Wd / 2);
        ctx.fillStyle = '#111'; ctx.fillRect(-L / 2, -2, 8, 4); ctx.fillRect(L / 2 - 8, -2, 8, 4);
        ctx.fillStyle = v.wrecked ? '#222' : v.color; roundRect(ctx, -L / 2 + 5, -Wd / 4, L - 10, Wd / 2, 2); ctx.fill();
        ctx.fillStyle = '#9ca3af'; ctx.fillRect(L / 2 - 9, -Wd / 2, 2, Wd);
        if (v.driver) {
            ctx.fillStyle = v.driver === 'player' ? '#ff4fd8' : '#3b82f6'; ctx.beginPath(); ctx.ellipse(-2, 0, 4, 6.5, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = '#111'; ctx.beginPath(); ctx.arc(-1, 0, 3.6, 0, Math.PI * 2); ctx.fill();
        }
    }

    drawTrees(city, v) {
        const ctx = this.ctx, c = this.cam;
        const x0 = Math.max(0, Math.floor(v.x0 / TILE) - 1), x1 = Math.min(city.w - 1, Math.floor(v.x1 / TILE) + 1);
        const y0 = Math.max(0, Math.floor(v.y0 / TILE) - 1), y1 = Math.min(city.h - 1, Math.floor(v.y1 / TILE) + 1);
        for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
            if (tileAt(city, tx, ty) !== T.TREE) continue;
            const bx = tx * TILE + 32, by = ty * TILE + 32;
            const k = 0.12;
            const cx = bx + (bx - c.x) * k, cy = by + (by - c.y) * k;
            const h = tileHash(tx, ty);
            ctx.fillStyle = (h & 1) ? '#24501f' : '#2b5a24';
            ctx.beginPath(); ctx.arc(cx, cy, 28 + (h % 6), 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = (h & 2) ? '#3a7a2e' : '#357030';
            ctx.beginPath(); ctx.arc(cx - 6, cy - 6, 17, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.beginPath(); ctx.arc(cx - 10, cy - 10, 8, 0, Math.PI * 2); ctx.fill();
        }
    }

    // ── Hus med GTA2-perspektiv ──
    drawBuildings(world, view) {
        const ctx = this.ctx, c = this.cam, city = world.city;
        const night = world.darkness() > 0.2;
        const pad = 260;
        const list = [];
        for (const b of city.buildings) {
            const x0 = b.x * TILE, y0 = b.y * TILE, x1 = x0 + b.w * TILE, y1 = y0 + b.h * TILE;
            if (x1 < view.x0 - pad || x0 > view.x1 + pad || y1 < view.y0 - pad || y0 > view.y1 + pad) continue;
            const dx = Math.max(x0 - c.x, 0, c.x - x1), dy = Math.max(y0 - c.y, 0, c.y - y1);
            list.push({ b, x0, y0, x1, y1, d: dx * dx + dy * dy });
        }
        list.sort((a, b) => b.d - a.d);
        const owned = world.profile.owned || [];
        for (const { b, x0, y0, x1, y1 } of list) {
            const k = 1 + b.height;
            const R = (x, y) => [c.x + (x - c.x) * k, c.y + (y - c.y) * k];
            const A = [x0, y0], B = [x1, y0], C = [x1, y1], D = [x0, y1];
            const RA = R(x0, y0), RB = R(x1, y0), RC = R(x1, y1), RD = R(x0, y1);
            const floors = Math.max(2, Math.round(b.height * 16));
            const wall = (p1, p2, r2, r1, fill) => {
                ctx.fillStyle = fill;
                ctx.beginPath(); ctx.moveTo(p1[0], p1[1]); ctx.lineTo(p2[0], p2[1]); ctx.lineTo(r2[0], r2[1]); ctx.lineTo(r1[0], r1[1]); ctx.closePath(); ctx.fill();
                ctx.strokeStyle = 'rgba(0,0,0,0.28)'; ctx.lineWidth = 1.5;
                ctx.beginPath();
                for (let f = 1; f < floors; f++) {
                    const t = f / floors;
                    ctx.moveTo(p1[0] + (r1[0] - p1[0]) * t, p1[1] + (r1[1] - p1[1]) * t);
                    ctx.lineTo(p2[0] + (r2[0] - p2[0]) * t, p2[1] + (r2[1] - p2[1]) * t);
                }
                ctx.stroke();
                // Fönster: streckad linje mitt i varje våning, tända på natten
                ctx.setLineDash([7, 9]);
                ctx.lineDashOffset = b.id * 3;
                ctx.lineWidth = 4;
                ctx.strokeStyle = night ? 'rgba(255,214,120,0.75)' : 'rgba(170,200,230,0.35)';
                ctx.beginPath();
                for (let f = 0; f < floors; f++) {
                    if (night && ((b.id * 7 + f * 3) % 5 === 0)) continue;
                    const t = (f + 0.5) / floors;
                    ctx.moveTo(p1[0] + (r1[0] - p1[0]) * t, p1[1] + (r1[1] - p1[1]) * t);
                    ctx.lineTo(p2[0] + (r2[0] - p2[0]) * t, p2[1] + (r2[1] - p2[1]) * t);
                }
                ctx.stroke();
                ctx.setLineDash([]);
            };
            if (c.y < y0) wall(A, B, RB, RA, b.wall);
            if (c.y > y1) wall(D, C, RC, RD, b.wallLight);
            if (c.x < x0) wall(A, D, RD, RA, b.wallLight);
            if (c.x > x1) wall(B, C, RC, RB, b.wall);
            // Tak
            ctx.fillStyle = b.roof;
            ctx.beginPath(); ctx.moveTo(RA[0], RA[1]); ctx.lineTo(RB[0], RB[1]); ctx.lineTo(RC[0], RC[1]); ctx.lineTo(RD[0], RD[1]); ctx.closePath(); ctx.fill();
            const rw = RB[0] - RA[0], rh = RD[1] - RA[1];
            ctx.strokeStyle = b.roofDark; ctx.lineWidth = 5;
            ctx.strokeRect(RA[0] + 4, RA[1] + 4, rw - 8, rh - 8);
            for (const det of b.details) {
                const s = Math.min(rw, rh) * det.s;
                const dx = RA[0] + rw * det.u, dy = RA[1] + rh * det.v;
                ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(dx + 3, dy + 3, s, s);
                ctx.fillStyle = b.roofDark; ctx.fillRect(dx, dy, s, s);
                ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(dx, dy, s, s * 0.3);
            }
            const mx = (RA[0] + RC[0]) / 2, my = (RA[1] + RC[1]) / 2;
            if (b.hq) {
                ctx.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(ctx, mx - 40, my - 18, 80, 36, 8); ctx.fill();
                ctx.font = `bold ${16 * k}px Bungee, Impact, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.fillStyle = '#ffd23f'; ctx.fillText('HQ', mx, my);
            } else if (b.shopSlot !== undefined && SHOPS[b.shopSlot]) {
                const shop = SHOPS[b.shopSlot];
                const mine = owned.includes(shop.id);
                ctx.fillStyle = mine ? 'rgba(255,210,63,0.85)' : 'rgba(0,0,0,0.45)';
                ctx.beginPath(); ctx.arc(mx, my, 22 * k, 0, Math.PI * 2); ctx.fill();
                this.emoji(shop.icon, mx, my, 24 * k);
            }
        }
    }

    // ── Partiklar och text ──
    drawParticles(world, view) {
        const ctx = this.ctx;
        // Eldklot sist så att röken inte täcker dem
        const ordered = world.particles.filter(p => p.type !== 'blast').concat(world.particles.filter(p => p.type === 'blast'));
        for (const p of ordered) {
            const pad = p.type === 'blast' ? 160 : 40;
            if (p.x < view.x0 - pad || p.x > view.x1 + pad || p.y < view.y0 - pad || p.y > view.y1 + pad) continue;
            const a = p.life / p.max;
            switch (p.type) {
                case 'smoke':
                    ctx.fillStyle = `rgba(60,60,64,${a * 0.45})`;
                    ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
                    break;
                case 'fire':
                    ctx.fillStyle = a > 0.6 ? `rgba(255,240,150,${a})` : `rgba(255,${Math.floor(90 + a * 120)},20,${a})`;
                    ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (0.5 + a * 0.7), 0, Math.PI * 2); ctx.fill();
                    break;
                case 'nitro':
                    ctx.fillStyle = `rgba(80,180,255,${a})`;
                    ctx.beginPath(); ctx.arc(p.x, p.y, 5 * a + 2, 0, Math.PI * 2); ctx.fill();
                    break;
                case 'spark':
                    ctx.strokeStyle = `rgba(255,220,90,${a})`; ctx.lineWidth = 2;
                    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - p.vx * 0.03, p.y - p.vy * 0.03); ctx.stroke();
                    break;
                case 'debris':
                    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
                    ctx.fillStyle = `rgba(30,30,30,${a})`; ctx.fillRect(-3, -2, 6, 4);
                    ctx.restore();
                    break;
                case 'stars':
                    ctx.globalAlpha = a;
                    this.emoji('💫', p.x, p.y - 12 - (1 - a) * 10, 14);
                    ctx.globalAlpha = 1;
                    break;
                case 'blast': {
                    // Eldklot som växer och slocknar
                    const r = p.size * (0.35 + (1 - a) * 0.75);
                    const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
                    g.addColorStop(0, `rgba(255,255,220,${a})`);
                    g.addColorStop(0.35, `rgba(255,180,40,${a * 0.9})`);
                    g.addColorStop(0.7, `rgba(220,60,10,${a * 0.6})`);
                    g.addColorStop(1, 'rgba(60,20,10,0)');
                    ctx.fillStyle = g;
                    ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill();
                    ctx.strokeStyle = `rgba(255,230,180,${a * 0.6})`; ctx.lineWidth = 4;
                    ctx.beginPath(); ctx.arc(p.x, p.y, r * 1.15, 0, Math.PI * 2); ctx.stroke();
                    break;
                }
            }
        }
    }

    drawTargetMarker(world) {
        const m = world.mission;
        if (!m || !m.target) return;
        const ctx = this.ctx, t = this.t;
        const { x, y } = m.target;
        ctx.fillStyle = `rgba(255,210,63,${0.18 + 0.12 * Math.sin(t * 5)})`;
        ctx.beginPath(); ctx.arc(x, y, 46, 0, Math.PI * 2); ctx.fill();
        this.ring(x, y, 46, '#ffd23f', 3);
        // Studsande GTA-pil
        const by = y - 70 - Math.abs(Math.sin(t * 4)) * 18;
        ctx.fillStyle = '#ffd23f'; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(x, by + 30); ctx.lineTo(x - 18, by + 6); ctx.lineTo(x - 7, by + 6); ctx.lineTo(x - 7, by - 14); ctx.lineTo(x + 7, by - 14); ctx.lineTo(x + 7, by + 6); ctx.lineTo(x + 18, by + 6); ctx.closePath();
        ctx.fill(); ctx.stroke();
    }

    drawFloaters(world) {
        const ctx = this.ctx;
        ctx.font = '18px Bungee, Impact, sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.lineWidth = 4; ctx.strokeStyle = '#000';
        for (const f of world.floaters) {
            ctx.globalAlpha = Math.min(1, f.life);
            ctx.strokeText(f.text, f.x, f.y);
            ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y);
        }
        ctx.globalAlpha = 1;
    }

    // ── Ljus: mörker med strålkastare, gatlampor, blåljus, eld ──
    drawLighting(world, view) {
        const dark = world.darkness();
        const flashes = world.flashes;
        const ctx = this.ctx, lc = this.lctx, c = this.cam;
        const lw = this.light.width, lh = this.light.height;
        const sx = x => (x - c.x) * c.zoom * (lw / this.w) + lw / 2;
        const sy = y => (y - c.y) * c.zoom * (lh / this.h) + lh / 2;
        const sr = r => r * c.zoom * (lw / this.w);
        const vis = (x, y, pad) => x > view.x0 - pad && x < view.x1 + pad && y > view.y0 - pad && y < view.y1 + pad;
        const flash = Math.sin(this.t * 14) > 0;

        if (dark > 0.02) {
            lc.setTransform(1, 0, 0, 1, 0, 0);
            lc.globalCompositeOperation = 'source-over';
            lc.clearRect(0, 0, lw, lh);
            lc.fillStyle = `rgba(6,8,30,${dark})`;
            lc.fillRect(0, 0, lw, lh);
            lc.globalCompositeOperation = 'destination-out';
            const hole = (x, y, r, strength = 1) => {
                const g = lc.createRadialGradient(sx(x), sy(y), 0, sx(x), sy(y), sr(r));
                g.addColorStop(0, `rgba(0,0,0,${strength})`);
                g.addColorStop(1, 'rgba(0,0,0,0)');
                lc.fillStyle = g;
                lc.beginPath(); lc.arc(sx(x), sy(y), sr(r), 0, Math.PI * 2); lc.fill();
            };
            for (const l of world.city.lights) if (vis(l.x, l.y, 160)) hole(l.x, l.y, 150, 0.85);
            for (const v of world.vehicles) {
                if (v.wrecked || !vis(v.x, v.y, 200)) continue;
                if (v.driver || v === world.player.vehicle) {
                    const fx = Math.cos(v.angle), fy = Math.sin(v.angle);
                    hole(v.x + fx * (v.spec.l / 2 + 60), v.y + fy * (v.spec.l / 2 + 60), 85, 0.9);
                    hole(v.x + fx * (v.spec.l / 2 + 140), v.y + fy * (v.spec.l / 2 + 140), 90, 0.6);
                }
                if (v.siren) hole(v.x, v.y, 110, 0.7);
            }
            for (const v of world.vehicles) if (v.wrecked && !v.exploded && vis(v.x, v.y, 150)) hole(v.x, v.y, 140, 1);
            for (const f of flashes) hole(f.x, f.y, 400, Math.min(1, f.life * 2));
            const p = world.player;
            hole(p.x, p.y, 70, 0.6);
            lc.globalCompositeOperation = 'source-over';
            ctx.drawImage(this.light, 0, 0, this.canvas.width, this.canvas.height);
        }

        // Additivt färgat ljus
        ctx.globalCompositeOperation = 'lighter';
        const glow = (x, y, r, color) => {
            const X = (x - c.x) * c.zoom * this.dpr + this.canvas.width / 2;
            const Y = (y - c.y) * c.zoom * this.dpr + this.canvas.height / 2;
            const Rr = r * c.zoom * this.dpr;
            const g = ctx.createRadialGradient(X, Y, 0, X, Y, Rr);
            g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
            ctx.fillStyle = g;
            ctx.beginPath(); ctx.arc(X, Y, Rr, 0, Math.PI * 2); ctx.fill();
        };
        for (const v of world.vehicles) {
            if (!vis(v.x, v.y, 150)) continue;
            if (v.siren && !v.wrecked) glow(v.x, v.y, 90, flash ? 'rgba(255,40,40,0.45)' : 'rgba(40,90,255,0.45)');
            if (v.wrecked && !v.exploded) glow(v.x, v.y, 110, 'rgba(255,120,30,0.35)');
        }
        for (const f of flashes) glow(f.x, f.y, 260, `rgba(255,190,90,${Math.min(0.8, f.life * 1.6)})`);
        if (dark > 0.15) for (const l of world.city.lights) if (vis(l.x, l.y, 120)) glow(l.x, l.y, 110, `rgba(255,190,110,${dark * 0.22})`);
        ctx.globalCompositeOperation = 'source-over';
    }
}
