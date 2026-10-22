// ═══════════════════════════════════════════
//  STAN — rendering i GTA2-stil
//  Marken cachas i bitar. Husen ritas med
//  perspektiv: taken skalas ut från kamerans
//  mitt så att stan ser 3D ut. Ovanpå det
//  läggs mörker med strålkastare och blåljus.
// ═══════════════════════════════════════════

import { TILE, T, N, E, S, W, DX, DY } from './constants.js';
import { tileAt, laneDirs } from './map.js';
import { phoneAccess, gangById } from './missions.js';
import { SHOPS } from '../data/gameData.js';
import { VEHICLES } from './vehicles.js';
import { ITEM_TYPES } from './items.js';
import * as INT from './interiors.js';

export const CREW_LOOK = { guard: { shirt: '#111827' }, gunner: { shirt: '#7f1d1d' }, scout: { shirt: '#065f46' } };
// Storlek på figurerna (cirka 25 % större än förut)
const PED_SCALE = 1.6, PLAYER_SCALE = 1.8;

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
        if (world.interior) {
            // Inomhus: följ spelaren men håll kameran inom rummet
            const def = world.interior.def, p = world.player;
            const z = clamp(Math.min(this.w, this.h) / 760, 0.6, 1.25) * (this.zoomMul || 1);
            const W = def.w * (INT.IN_TILE || 32), H = def.h * (INT.IN_TILE || 32);
            const hw = this.w / 2 / z, hh = this.h / 2 / z;
            // Knappraden ligger överst på bredare skärmar — låt rummet börja under den
            const top = (this.w > 560 ? 52 : 0) / z;
            const cx = W <= hw * 2 ? W / 2 : clamp(p.x, hw, W - hw);
            let cy = H <= hh * 2 - top ? H / 2 - top / 2 : clamp(p.y, hh - top, H - hh);
            // ...men spelaren får aldrig hamna under personsökaren/touchknapparna längst ner
            const bottom = (this.w > 560 ? 120 : 260) / z;
            if (p.y > cy + hh - bottom) cy = p.y - hh + bottom;
            if (!this.cam || this.camIn !== world.interior.id) this.cam = { x: cx, y: cy, zoom: z, sx: 0, sy: 0 };
            this.camIn = world.interior.id;
            const k = Math.min(1, dt * 6);
            this.cam.x += (cx - this.cam.x) * k; this.cam.y += (cy - this.cam.y) * k; this.cam.zoom = z;
            this.cam.sx = this.cam.sy = 0;
            return;
        }
        if (this.camIn) { this.camIn = null; this.cam = null; }
        const p = world.player, v = p.vehicle;
        const vx = v ? v.vx : 0, vy = v ? v.vy : 0;
        const tx = p.x + vx * 0.4, ty = p.y + vy * 0.4;
        const base = clamp(Math.min(this.w, this.h) / 900, 0.55, 1);
        const speed = Math.hypot(vx, vy);
        // zoomMul: spelarens val av vy (🔍 / V)
        const zTarget = Math.max(0.3, base * (v ? 1 - Math.min(0.3, speed / 1700) : 1.06) * (this.zoomMul || 1));
        this.zTarget = zTarget;
        if (!this.cam) this.cam = { x: tx, y: ty, zoom: zTarget };
        const k = Math.min(1, dt * 4);
        this.cam.x += (tx - this.cam.x) * k;
        this.cam.y += (ty - this.cam.y) * k;
        this.cam.zoom += (zTarget - this.cam.zoom) * Math.min(1, dt * 1.6);
        const sh = dt > 0 ? world.shake * 9 : 0; // ingen skakning när spelet står pausat
        this.cam.sx = (Math.random() - 0.5) * sh;
        this.cam.sy = (Math.random() - 0.5) * sh;
    }

    screenToWorld(x, y) {
        const c = this.cam;
        if (!c) return null;
        return { x: (x - this.w / 2) / c.zoom + c.x, y: (y - this.h / 2) / c.zoom + c.y };
    }

    worldToScreen(x, y) {
        const c = this.cam;
        return { x: (x - c.x) * c.zoom + this.w / 2, y: (y - c.y) * c.zoom + this.h / 2 };
    }

    draw(world, dt) {
        if (!this.cam) this.updateCamera(world, 0);
        this.t += dt;
        if (world.interior) { this.drawInteriorScene(world); return; }
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
        this.drawDrops(world, view);
        this.drawItems(world, view);
        this.drawPeds(world, view);
        this.drawCrew(world, view);
        this.drawRemotes(world, view);
        this.drawPlayerOnFoot(world);
        this.drawVehicles(world, view);
        this.drawBullets(world, view);
        this.drawTrees(world.city, view);
        this.drawBuildings(world, view);
        this.drawDoors(world, view);
        this.drawTags(world, view);
        this.drawParticles(world, view);
        this.drawTargetMarker(world);
        this.drawSpeech(world, view);
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
            const open = phoneAccess(world.profile, ph.gang) && !world.mission;
            const col = gangById(ph.gang).color;
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
        const rc = m.recruit;
        if (rc && vis(rc)) {
            ctx.fillStyle = `rgba(34,197,94,${0.18 + pulse * 0.2})`;
            ctx.beginPath(); ctx.arc(rc.x, rc.y, 26, 0, Math.PI * 2); ctx.fill();
            this.ring(rc.x, rc.y, 26, '#22c55e', 2);
            this.emoji('👥', rc.x, rc.y, 20);
        }
        const dl = m.dealer;
        if (dl && vis(dl)) {
            ctx.fillStyle = `rgba(163,230,53,${0.18 + pulse * 0.2})`;
            ctx.beginPath(); ctx.arc(dl.x, dl.y, 26, 0, Math.PI * 2); ctx.fill();
            this.ring(dl.x, dl.y, 26, '#a3e635', 2);
            this.emoji('🎒', dl.x, dl.y, 20);
        }
        const gs = m.guns;
        if (gs && vis(gs)) {
            ctx.fillStyle = `rgba(249,115,22,${0.16 + pulse * 0.18})`;
            ctx.beginPath(); ctx.arc(gs.x, gs.y, 26, 0, Math.PI * 2); ctx.fill();
            this.ring(gs.x, gs.y, 26, '#f97316', 2);
            this.emoji('🔫', gs.x, gs.y, 20);
        }
        const cl = m.club;
        if (cl && vis(cl, 120)) {
            // Neonskylt som blinkar när klubben är öppen
            const open = world.isClubOpen();
            const neon = open && Math.sin(t * 7) > -0.6;
            ctx.fillStyle = open ? `rgba(244,114,182,${0.14 + pulse * 0.16})` : 'rgba(100,100,100,0.18)';
            ctx.beginPath(); ctx.arc(cl.x, cl.y, 46, 0, Math.PI * 2); ctx.fill();
            ctx.setLineDash([10, 7]); this.ring(cl.x, cl.y, 46, open ? '#f472b6' : '#666', 2.5); ctx.setLineDash([]);
            this.emoji('🍾', cl.x, cl.y - 4, 22);
            ctx.font = 'bold 11px Bungee, Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(open ? 'NATTKLUBBEN' : 'STÄNGT · 20:00', cl.x, cl.y + 22);
            ctx.fillStyle = neon ? '#f9a8d4' : open ? '#9d174d' : '#9ca3af'; ctx.fillText(open ? 'NATTKLUBBEN' : 'STÄNGT · 20:00', cl.x, cl.y + 22);
        }
    }

    // Dörrar till fastigheter, gömställen och banken. Ritas ovanpå taken så att skylten alltid syns.
    drawDoors(world, view) {
        const ctx = this.ctx, prof = world.profile;
        for (const d of world.doors()) {
            const o = d.door || d;
            if (o.x < view.x0 - 60 || o.x > view.x1 + 60 || o.y < view.y0 - 60 || o.y > view.y1 + 60) continue;
            let icon, label, color;
            if (d.kind === 'business') {
                const shop = SHOPS[d.slot];
                const owned = (prof.owned || []).includes(shop.id);
                icon = shop.icon; color = owned ? '#22c55e' : '#ffd23f';
                label = owned ? ((prof.cityCollected || []).includes(shop.id) ? 'ÖPPET · DIN' : 'ÖPPET · DIN · 💰') : 'ÖPPET · TILL SALU';
            } else if (d.kind === 'house') {
                const owned = world.ownsHouse(d);
                icon = owned ? '🏡' : '🔑'; color = owned ? '#22c55e' : '#38bdf8'; label = owned ? 'GÖMSTÄLLE' : 'TILL SALU';
            } else { icon = '🏦'; color = '#a78bfa'; label = 'BANKEN'; }
            const horiz = o.side === N || o.side === S;
            const dw = horiz ? 22 : 6, dh = horiz ? 6 : 22;
            ctx.fillStyle = '#2a1a0e'; ctx.fillRect(o.x - dw / 2, o.y - dh / 2, dw, dh);
            ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.strokeRect(o.x - dw / 2, o.y - dh / 2, dw, dh);
            // Pulserande markering på trottoaren framför dörren
            const fx = o.x - DX[o.side] * 15, fy = o.y - DY[o.side] * 15;
            ctx.globalAlpha = 0.25 + (0.5 + 0.5 * Math.sin(this.t * 4 + o.x)) * 0.35;
            ctx.fillStyle = color; ctx.beginPath(); ctx.arc(fx, fy, 10, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
            this.emoji(icon, fx, fy - 26, 16);
            ctx.font = '9px Bungee, Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(label, fx, fy - 13);
            ctx.fillStyle = color; ctx.fillText(label, fx, fy - 13);
        }
        // Club Diamant och Pang-Pelle: riktiga rum man går in i — neonskylt och en dörr som lyser
        for (const sd of world.specialDoors()) {
            const o = sd.door;
            if (o.x < view.x0 - 120 || o.x > view.x1 + 120 || o.y < view.y0 - 120 || o.y > view.y1 + 120) continue;
            const horiz = o.side === N || o.side === S;
            const dw = horiz ? 28 : 7, dh = horiz ? 7 : 28;
            const flick = Math.sin(this.t * 7 + o.x) > -0.7;
            ctx.fillStyle = '#12060f'; ctx.fillRect(o.x - dw / 2, o.y - dh / 2, dw, dh);
            ctx.shadowColor = sd.color; ctx.shadowBlur = flick ? 14 : 4;
            ctx.strokeStyle = sd.color; ctx.lineWidth = 3; ctx.strokeRect(o.x - dw / 2, o.y - dh / 2, dw, dh);
            const fx = o.x - DX[o.side] * 18, fy = o.y - DY[o.side] * 18;
            ctx.globalAlpha = 0.3 + (0.5 + 0.5 * Math.sin(this.t * 4 + o.y)) * 0.4;
            ctx.fillStyle = sd.color; ctx.beginPath(); ctx.arc(fx, fy, 13, 0, Math.PI * 2); ctx.fill();
            ctx.globalAlpha = 1;
            // Skylten: stor text med neonglöd, ägaren under
            ctx.font = 'bold 15px Bungee, Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.lineWidth = 4; ctx.strokeStyle = '#000'; ctx.strokeText(sd.title, fx, fy - 44);
            ctx.fillStyle = flick ? sd.neon : sd.color; ctx.fillText(sd.title, fx, fy - 44);
            ctx.shadowBlur = 0;
            this.emoji(sd.icon, fx, fy - 64, 20);
            ctx.font = '9px Bungee, Impact, sans-serif';
            ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(sd.sub, fx, fy - 27);
            ctx.fillStyle = '#fff'; ctx.fillText(sd.sub, fx, fy - 27);
            ctx.font = '10px Bungee, Impact, sans-serif';
            ctx.strokeText('GÅ IN', fx, fy); ctx.fillStyle = '#fff'; ctx.fillText('GÅ IN', fx, fy);
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

    // Tappade plånböcker
    drawDrops(world, view) {
        for (const d of world.drops) {
            if (d.x < view.x0 - 20 || d.x > view.x1 + 20 || d.y < view.y0 - 20 || d.y > view.y1 + 20) continue;
            if (d.life < 4 && Math.sin(this.t * 16) > 0) continue; // blinkar innan den försvinner
            this.emoji('💵', d.x, d.y + Math.sin(this.t * 5 + d.x) * 2, 14);
        }
    }

    drawBullets(world, view) {
        const ctx = this.ctx;
        if (!world.bullets.length) return;
        ctx.lineCap = 'round';
        for (const b of world.bullets) {
            if (b.x < view.x0 - 40 || b.x > view.x1 + 40 || b.y < view.y0 - 40 || b.y > view.y1 + 40) continue;
            ctx.strokeStyle = b.from === 'player' ? 'rgba(255,236,150,0.95)' : 'rgba(255,140,90,0.95)';
            ctx.lineWidth = 2;
            ctx.beginPath(); ctx.moveTo(b.px, b.py); ctx.lineTo(b.x, b.y); ctx.stroke();
        }
        ctx.lineCap = 'butt';
    }

    // Mynningsflamma framför den som skjuter
    muzzle(x, y, angle, dist) {
        const ctx = this.ctx;
        const fx = x + Math.cos(angle) * dist, fy = y + Math.sin(angle) * dist;
        ctx.fillStyle = 'rgba(255,220,120,0.95)';
        ctx.beginPath(); ctx.arc(fx, fy, 5 + Math.random() * 3, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.beginPath(); ctx.arc(fx, fy, 2.5, 0, Math.PI * 2); ctx.fill();
    }

    // ── Folk ──
    // extra: { vest: gängfärg för ryggmärket, metro, scooter, punch }
    drawPedShape(ctx, ped, shirt, skin, hair, phase, scale = 1, extra = {}) {
        ctx.save();
        ctx.translate(ped.x, ped.y);
        if (ped.down > 0) {
            ctx.rotate(ped.angle + Math.PI / 2);
            ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(1, 2, 6, 11, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = extra.vest ? '#111' : shirt; ctx.beginPath(); ctx.ellipse(0, 0, 5, 9, 0, 0, Math.PI * 2); ctx.fill();
            if (extra.vest) { ctx.fillStyle = extra.vest; ctx.beginPath(); ctx.arc(0, 1, 2.6, 0, Math.PI * 2); ctx.fill(); }
            ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0, -11, 3.5, 0, Math.PI * 2); ctx.fill();
            ctx.restore();
            return;
        }
        ctx.rotate(ped.angle);
        // Dans: kroppen gungar och vrider sig i takt
        const pose = extra.pose || 'walk';
        if (pose === 'dance') ctx.rotate(Math.sin(phase * 2) * 0.45);
        ctx.scale(scale, scale);
        const still = extra.scooter || pose === 'sit' || pose === 'work';
        const swing = still ? 0 : Math.sin(phase) * 4;
        const OUT = 'rgba(0,0,0,0.55)';
        ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(2, 2, 6, 7.5, 0, 0, Math.PI * 2); ctx.fill();
        if (extra.scooter) {
            // Elsparkcykel: bräda + styre
            ctx.fillStyle = '#27272a'; roundRect(ctx, -8, -2.2, 18, 4.4, 2); ctx.fill();
            ctx.fillStyle = '#22c55e'; ctx.fillRect(-8, -2.2, 3, 4.4);
            ctx.strokeStyle = '#a1a1aa'; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.moveTo(9, -5); ctx.lineTo(9, 5); ctx.stroke();
        }
        // Fötter (sittande: framåt)
        ctx.fillStyle = extra.metro ? '#e5e7eb' : extra.dress ? '#f5f5f4' : '#1f2937';
        if (pose === 'sit') { ctx.fillRect(4, -3.5, 4, 2.6); ctx.fillRect(4, 1, 4, 2.6); }
        else { ctx.fillRect(swing - 2, -4, 5, 3); ctx.fillRect(-swing - 2, 1, 5, 3); }
        // Kropp med kontur, klänning för den som har en
        ctx.lineWidth = 0.8; ctx.strokeStyle = OUT;
        if (extra.dress) {
            ctx.fillStyle = extra.dress; ctx.beginPath(); ctx.ellipse(-0.5, 0, 5.2, 7.6, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
            if (extra.sparkle) {
                ctx.fillStyle = 'rgba(255,255,255,0.85)';
                for (let i = 0; i < 4; i++) { const a = phase * 3 + i * 1.6; ctx.fillRect(Math.cos(a) * 3 - 0.5, Math.sin(a * 1.3) * 5 - 0.5, 1.2, 1.2); }
            }
        } else {
            ctx.fillStyle = shirt; ctx.beginPath(); ctx.ellipse(0, 0, 4.2, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        }
        if (extra.vest) {
            // Skinnväst med ryggmärke
            ctx.fillStyle = '#111';
            ctx.beginPath(); ctx.ellipse(-0.8, 0, 3.8, 7.2, 0, Math.PI * 0.5, Math.PI * 1.5); ctx.fill();
            ctx.fillRect(-0.8, -6.5, 1.8, 13);
            ctx.fillStyle = extra.vest; ctx.beginPath(); ctx.arc(-2.9, 0, 2.3, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = extra.patch || '#fff'; ctx.lineWidth = 0.9;
            ctx.beginPath(); ctx.arc(-2.9, 0, 3.3, Math.PI * 0.6, Math.PI * 1.4); ctx.stroke();
        }
        // Händer: svänger mot fötterna när man går, upp när man jublar, fram när man jobbar
        const hand = (x, y, r = 1.8) => { ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill(); ctx.lineWidth = 0.6; ctx.strokeStyle = OUT; ctx.stroke(); };
        if (extra.weapon === 'bat') {
            ctx.fillStyle = '#a16207'; ctx.save(); ctx.translate(6, 4); ctx.rotate(extra.punch ? -0.2 : 0.9); ctx.fillRect(0, -1.2, 12, 2.6); ctx.restore();
            hand(6, 4); hand(-swing * 0.5, -7);
        } else if (extra.weapon) {
            // Skjutvapen: pistol kort, uzi/hagel längre
            const len = extra.weapon === 'shotgun' ? 11 : extra.weapon === 'uzi' ? 8 : 6;
            ctx.fillStyle = '#111827'; ctx.fillRect(6, 1.3, len, 2.4);
            hand(6, 2.5, 2.1); hand(-swing * 0.5, -7);
        } else if (extra.punch) { hand(9, 3.5, 2.4); hand(1, -7); }
        else if (pose === 'cheer') { const up = Math.abs(Math.sin(phase * 3)) * 2; hand(2 + up, -8.5, 2); hand(2 + up, 8.5, 2); }
        else if (pose === 'work') { hand(5.5, -3.5); hand(5.5, 3.5); }
        else if (pose === 'dance') { hand(Math.sin(phase * 2) * 4, -8.5, 2); hand(-Math.sin(phase * 2) * 4, 8.5, 2); }
        else if (!extra.scooter && pose !== 'sit') { hand(-swing * 0.6, -7.2); hand(swing * 0.6, 7.2); }
        // Huvud med hår, keps/huva och en liten glans
        ctx.fillStyle = skin; ctx.beginPath(); ctx.arc(0.5, 0, 3.4, 0, Math.PI * 2); ctx.fill();
        ctx.lineWidth = 0.6; ctx.strokeStyle = OUT; ctx.stroke();
        ctx.fillStyle = extra.hood ? '#111827' : hair; ctx.beginPath(); ctx.arc(-0.6, 0, extra.hood ? 3.9 : 3.2, Math.PI * (extra.hood ? 0.35 : 0.5), Math.PI * (extra.hood ? 1.65 : 1.5)); ctx.fill();
        if (extra.dress) { ctx.fillStyle = hair; ctx.beginPath(); ctx.ellipse(-2.4, 0, 2.2, 3.8, 0, 0, Math.PI * 2); ctx.fill(); }
        if (extra.cap) {
            ctx.fillStyle = extra.cap === true ? '#111827' : extra.cap;
            ctx.beginPath(); ctx.arc(0, 0, 3.6, Math.PI * 0.5, Math.PI * 1.5); ctx.fill();
            ctx.fillRect(1.5, -2.6, 2.6, 5.2);
        }
        if (extra.metro) {
            // Slickat hår och solglasögon
            ctx.fillStyle = hair; ctx.beginPath(); ctx.ellipse(-0.3, 0, 3.6, 3.3, 0, Math.PI * 0.55, Math.PI * 1.45); ctx.fill();
            ctx.fillStyle = '#0a0a0a'; ctx.fillRect(2.3, -2.6, 1.6, 5.2);
        }
        ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(1.3, -1, 1.2, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
    }

    // Folk inomhus (interiörernas personal och gäster) ritas med samma figurer
    drawPerson(ctx, npc) {
        const look = npc.look || {};
        // Barbråk (brawl.js): garden uppe under uppdragningen, näven ute när slaget går
        const fight = npc.brawl === 'fight';
        this.drawPedShape(ctx, npc, look.shirt || '#444', look.skin || '#e0ac69', look.hair || '#1f1300', npc.phase || 0, PED_SCALE,
            { dress: look.dress, sparkle: look.sparkle, cap: look.cap, pose: fight && npc.windup > 0 ? 'work' : npc.pose, punch: npc.punchT > 0 });
        if (npc.brawl) this.drawBrawler(ctx, npc);
        else if (npc.flashT > 0) this.hitFlash(ctx, npc.x, npc.y);
    }

    hitFlash(ctx, x, y) {
        ctx.globalAlpha = 0.75; ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 1;
    }

    // Blixt vid träff, hälsa, arg min och röd ring (går på mig), 🕴️ för vakter, 💫 för den som ligger
    drawBrawler(ctx, npc) {
        if (npc.flashT > 0) this.hitFlash(ctx, npc.x, npc.y);
        if (npc.down > 0) {
            this.emoji('💫', npc.x, npc.y - 17 + Math.sin(this.t * 5) * 1.5, 14);
            return;
        }
        if (npc.maxHp > 0 && npc.hp < npc.maxHp) {
            const f = Math.max(0, npc.hp / npc.maxHp);
            ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(npc.x - 13, npc.y - 40, 26, 6);
            ctx.fillStyle = f < 0.35 ? '#ef4444' : '#facc15'; ctx.fillRect(npc.x - 12, npc.y - 39, 24 * f, 4);
        }
        const guard = npc.kind === 'bouncer' || npc.kind === 'guard';
        if (npc.foe === 'player') {
            ctx.globalAlpha = 0.55 + 0.35 * Math.sin(this.t * 10);
            this.ring(npc.x, npc.y, 15, '#ef4444', 2.5);
            ctx.globalAlpha = 1;
        }
        if (guard) {
            // 🕴️ är en tunn figur: ljus platta bakom så att den syns mot dansgolvet
            ctx.fillStyle = 'rgba(255,255,255,0.85)'; ctx.beginPath(); ctx.arc(npc.x, npc.y - 25, 9, 0, Math.PI * 2); ctx.fill();
            ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.stroke();
            this.emoji('🕴️', npc.x, npc.y - 25, 15);
        } else if (npc.foe === 'player') this.emoji('😠', npc.x, npc.y - 24, 14);
    }

    pedExtra(ped) {
        const g = ped.vest ? gangById(ped.gang) : null;
        return { vest: g ? g.color : null, patch: g?.patch, metro: ped.type === 'metro', scooter: ped.scooter, hood: ped.hood, weapon: ped.gun && ped.attack ? 'pistol' : null, punch: ped.windup > 0 };
    }

    drawPeds(world, view) {
        const ctx = this.ctx;
        for (const ped of world.peds) {
            if (ped.x < view.x0 - 20 || ped.x > view.x1 + 20 || ped.y < view.y0 - 20 || ped.y > view.y1 + 20) continue;
            this.drawPedShape(ctx, ped, ped.cop ? '#1e3a8a' : ped.shirt, ped.skin, ped.cop ? '#0f172a' : ped.hair, ped.phase, PED_SCALE, this.pedExtra(ped));
            if (ped.muzzle > 0) this.muzzle(ped.x, ped.y, ped.angle, 16);
            if (ped.flashT > 0) {
                // Träffad: vit blixt
                ctx.globalAlpha = 0.75; ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.arc(ped.x, ped.y, 12, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
            }
            if ((ped.attack || ped.cop) && !(ped.down > 0) && ped.hp < ped.maxHp) {
                // Livsmätare för den du slåss mot
                ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(ped.x - 13, ped.y - 36, 26, 6);
                ctx.fillStyle = ped.hp / ped.maxHp < 0.35 ? '#ef4444' : '#facc15';
                ctx.fillRect(ped.x - 12, ped.y - 35, 24 * Math.max(0, ped.hp / ped.maxHp), 4);
            }
            if (ped.dead) continue;
            if (ped.down > 0 && ped.down > 2) this.emoji('💫', ped.x, ped.y - 17, 14);
            else if (ped.attack && ped.down <= 0) {
                // Fiender: röd ring och arg min (crew som hjälper dig får sin sköld)
                ctx.globalAlpha = 0.55 + 0.35 * Math.sin(this.t * 10);
                this.ring(ped.x, ped.y, 15, ped.targetPed ? (gangById(ped.gang)?.color || '#22c55e') : '#ef4444', 2.5);
                ctx.globalAlpha = 1;
                this.emoji(ped.targetPed ? '🛡️' : ped.mugger ? '🦹' : ped.cop ? '🚔' : ped.gun ? '🔫' : '😠', ped.x, ped.y - 24, 14);
            } else if (ped.buyer) this.emoji('💸', ped.x, ped.y - 24, 16);
        }
    }

    drawPlayerOnFoot(world) {
        const p = world.player;
        if (p.vehicle) return;
        const ctx = this.ctx;
        ctx.globalAlpha = 0.5 + 0.3 * Math.sin(this.t * 6);
        this.ring(p.x, p.y, 21, '#ffd23f', 2.5);
        ctx.globalAlpha = 1;
        // Gul pil vid fötterna: det är DU, och hit tittar du
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.angle);
        ctx.beginPath(); ctx.moveTo(30, 0); ctx.lineTo(22, -6); ctx.lineTo(22, 6); ctx.closePath();
        ctx.fillStyle = '#ffd23f'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = '#000'; ctx.stroke();
        ctx.restore();
        const fake = { x: p.x, y: p.y, angle: p.angle, down: p.dead ? 1 : 0 };
        const g = gangById(world.profile.gang);
        const mc = g && g.kind === 'mc';
        const weapon = world.profile.weapon && world.profile.weapon !== 'fists' ? world.profile.weapon : null;
        this.drawPedShape(ctx, fake, g && !mc ? g.color : p.color, '#e0ac69', '#1f1300', p.walkPhase, PLAYER_SCALE,
            { vest: mc ? g.color : null, patch: g?.patch, punch: p.punchT > 0, weapon });
        if (p.muzzle > 0) this.muzzle(p.x, p.y, p.angle, weapon === 'shotgun' ? 32 : 27);
        this.emoji(p.charIcon, p.x, p.y - 31, 17);
    }

    // ── Fordon ──
    drawVehicles(world, view) {
        const ctx = this.ctx;
        const flash = Math.sin(this.t * 14) > 0;
        if (world.date && world.player.vehicle) {
            const v = world.player.vehicle;
            this.emoji(world.date.mood < 35 ? '😠' : '💕', v.x, v.y - 30 + Math.sin(this.t * 4) * 3, 14);
        }
        for (const v of world.vehicles.concat(this.remoteCars(world))) {
            if (v.x < view.x0 - 60 || v.x > view.x1 + 60 || v.y < view.y0 - 60 || v.y > view.y1 + 60) continue;
            ctx.save();
            ctx.translate(v.x, v.y);
            ctx.rotate(v.angle);
            const L = v.spec.l, Wd = v.spec.w;
            if (v.spec.kind === 'bike') { this.drawBike(ctx, v, L, Wd, world); ctx.restore(); continue; }
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
                if (v.gang) {
                    const g = gangById(v.gang);
                    ctx.fillStyle = g.color; ctx.globalAlpha = 0.8;
                    ctx.fillRect(-L / 2 + 2, -1.5, L - 4, 3);
                    ctx.globalAlpha = 1;
                    ctx.rotate(-v.angle);
                    this.emoji(g.icon, 0, 0, 12);
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

    // Inomhus: rummet, personalen och gästerna, andra spelare där inne, mitt crew och jag
    drawInteriorScene(world) {
        const ctx = this.ctx, c = this.cam, dpr = this.dpr, I = world.interior;
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#07060b';
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
        const z = c.zoom * dpr;
        ctx.setTransform(z, 0, 0, z, this.canvas.width / 2 - c.x * z, this.canvas.height / 2 - c.y * z);
        const hw = this.w / 2 / c.zoom, hh = this.h / 2 / c.zoom;
        const view = { x0: c.x - hw, y0: c.y - hh, x1: c.x + hw, y1: c.y + hh };
        const drawPerson = (cx, npc) => this.drawPerson(cx, npc);
        if (INT.drawInterior) INT.drawInterior(ctx, I.state, view, this.t, drawPerson);
        else for (const npc of I.state.npcs) drawPerson(ctx, npc);
        this.drawCrew(world, view);
        this.drawRemotes(world, view);
        this.drawPlayerOnFoot(world);
        if (INT.drawInteriorLights) INT.drawInteriorLights(ctx, I.state, view, this.t);
        this.drawTags(world, view);
        // Pratbubblor från personal och gäster
        ctx.font = '11px "Space Grotesk", sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const npc of I.state.npcs) {
            if (!npc.say) continue;
            // bråkare har hälsostapel och arg min ovanför huvudet: bubblan en bit högre
            const w = Math.min(200, ctx.measureText(npc.say.text).width + 14), x = npc.x, y = npc.y - (npc.brawl ? 53 : 38);
            ctx.fillStyle = '#fdf2f8'; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
            roundRect(ctx, x - w / 2, y - 9, w, 18, 7); ctx.fill(); ctx.stroke();
            ctx.fillStyle = '#111'; ctx.fillText(npc.say.text, x, y + 0.5, 190);
        }
        // Var man kan prata med någon (E)
        const it = world.nearInteraction;
        if (it) { ctx.globalAlpha = 0.5 + 0.4 * Math.sin(this.t * 6); this.ring(it.x, it.y, it.r || 26, '#facc15', 2.5); ctx.globalAlpha = 1; }
        this.drawFloaters(world);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    // Mitt crew: vanliga figurer i rollens färg (skölden ritas i drawTags)
    drawCrew(world, view) {
        const ctx = this.ctx;
        const here = world.interior ? world.interior.id : null;
        for (const c of world.crew) {
            if (c.hidden || (c.interior || null) !== here) continue;
            if (c.x < view.x0 - 30 || c.x > view.x1 + 30 || c.y < view.y0 - 30 || c.y > view.y1 + 30) continue;
            this.drawPedShape(ctx, c, CREW_LOOK[c.role]?.shirt || '#333', '#c68642', '#111', c.phase, PED_SCALE, { punch: c.punchT > 0, weapon: c.role === 'gunner' ? 'pistol' : null });
            if (c.muzzle > 0) { this.muzzle(c.x, c.y, c.angle, 18); c.muzzle -= 1 / 60; }
            if (c.flashT > 0) {
                ctx.globalAlpha = 0.7; ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.arc(c.x, c.y, 12, 0, Math.PI * 2); ctx.fill();
                ctx.globalAlpha = 1;
            }
            if (c.down > 0) this.emoji('💤', c.x, c.y - 18, 13);
        }
    }

    // Vapen och grejer på marken: lysande ring + ikon, namn när du står nära
    drawItems(world, view) {
        const ctx = this.ctx;
        for (const it of world.groundItems()) {
            if (it.x < view.x0 - 30 || it.x > view.x1 + 30 || it.y < view.y0 - 30 || it.y > view.y1 + 30) continue;
            const def = ITEM_TYPES[it.type];
            const pulse = 0.5 + 0.5 * Math.sin(this.t * 4 + it.x * 0.01);
            ctx.fillStyle = `rgba(250,204,21,${0.18 + pulse * 0.22})`;
            ctx.beginPath(); ctx.arc(it.x, it.y, 15, 0, Math.PI * 2); ctx.fill();
            this.ring(it.x, it.y, 15, '#facc15', 2);
            this.emoji(def.icon, it.x, it.y + Math.sin(this.t * 3 + it.x) * 1.5, 16);
            if (world.nearItem === it) {
                ctx.font = '10px Bungee, Impact, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
                ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(def.label.toUpperCase(), it.x, it.y - 24);
                ctx.fillStyle = '#facc15'; ctx.fillText(def.label.toUpperCase(), it.x, it.y - 24);
            }
        }
    }

    // Andra spelare som kör: en låtsasbil som följer deras position
    remoteCars(world) {
        const out = [];
        if (world.interior) return out;
        for (const r of world.remotes()) {
            if (!r.v || r.in || !VEHICLES[r.v]) continue;
            const c = r._car || (r._car = { hp: 1, maxHp: 1, driver: 'remote', vx: 0, vy: 0 });
            c.x = r.rx; c.y = r.ry; c.angle = r.ra; c.type = r.v; c.spec = VEHICLES[r.v]; c.color = r.vc || '#888';
            out.push(c);
        }
        return out;
    }

    // Andra riktiga spelare till fots, och deras crew
    drawRemotes(world, view) {
        const ctx = this.ctx;
        const here = world.interior ? world.interior.id : null;
        for (const r of world.remotes()) {
            if ((r.in || null) !== here) continue;
            for (const c of r.crew || []) {
                if (c.d || c.x < view.x0 - 30 || c.x > view.x1 + 30 || c.y < view.y0 - 30 || c.y > view.y1 + 30) continue;
                const fake = { x: c.x, y: c.y, angle: c.a || 0, down: 0 };
                this.drawPedShape(ctx, fake, CREW_LOOK[c.r]?.shirt || '#444', '#c68642', '#111', (r.phase || 0) * 0.8, PED_SCALE, { vest: r.color });
            }
            if (r.v && !here) continue;
            const x = r.rx, y = r.ry;
            if (x < view.x0 - 40 || x > view.x1 + 40 || y < view.y0 - 40 || y > view.y1 + 40) continue;
            const fake = { x, y, angle: r.ra || 0, down: r.dead ? 1 : 0 };
            ctx.globalAlpha = r.prot ? 0.55 + 0.25 * Math.sin(this.t * 12) : 1;
            this.drawPedShape(ctx, fake, r.color || '#60a5fa', '#e0ac69', '#1f1300', r.phase || 0, PLAYER_SCALE, { weapon: r.w && r.w !== 'fists' ? r.w : null });
            ctx.globalAlpha = 1;
        }
    }

    // Namn, hälsa och markör ovanför andra spelare och mitt crew — ritas ovanpå taken
    drawTags(world, view) {
        const ctx = this.ctx;
        const here = world.interior ? world.interior.id : null;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const r of world.remotes()) {
            if ((r.in || null) !== here) continue;
            const x = r.rx, y = r.ry - (r.v && !here ? 34 : 40);
            if (x < view.x0 - 80 || x > view.x1 + 80 || y < view.y0 - 60 || y > view.y1 + 60) continue;
            // Romb i spelarens färg = en riktig spelare
            ctx.beginPath(); ctx.moveTo(x, y - 9); ctx.lineTo(x + 7, y - 2); ctx.lineTo(x, y + 5); ctx.lineTo(x - 7, y - 2); ctx.closePath();
            ctx.fillStyle = r.color || '#60a5fa'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
            ctx.font = '11px Bungee, Impact, sans-serif';
            const label = `${r.icon || ''} ${r.name || r.id}`;
            ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(label, x, y - 18);
            ctx.fillStyle = '#fff'; ctx.fillText(label, x, y - 18);
            const f = Math.max(0, Math.min(1, (r.hp || 0) / (r.mhp || 100)));
            ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(x - 17, y - 32, 34, 6);
            ctx.fillStyle = f < 0.35 ? '#ef4444' : '#22c55e'; ctx.fillRect(x - 16, y - 31, 32 * f, 4);
            if (r.stars > 0) { ctx.font = `10px ${EMOJI_FONT}`; ctx.fillText('👮'.repeat(Math.min(5, r.stars)), x, y - 42); }
            for (const c of r.crew || []) {
                if (c.d) continue;
                this.crewBadge(c.x, c.y - 27, r.color || '#60a5fa', false);
            }
        }
        for (const c of world.crew || []) {
            if (c.hidden || (c.interior || null) !== here) continue;
            this.crewBadge(c.x, c.y - 27, '#22c55e', true, c);
        }
    }

    // Sköld ovanför ett crew-medlem: grön = mitt, annars ägarens färg
    crewBadge(x, y, color, mine, c = null) {
        const ctx = this.ctx;
        ctx.beginPath();
        ctx.moveTo(x - 6, y - 6); ctx.lineTo(x + 6, y - 6); ctx.lineTo(x + 6, y + 1); ctx.lineTo(x, y + 7); ctx.lineTo(x - 6, y + 1); ctx.closePath();
        ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = mine ? '#052e16' : '#fff'; ctx.stroke();
        if (c) {
            const f = Math.max(0, Math.min(1, c.hp / c.maxHp));
            ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - 11, y - 13, 22, 4);
            ctx.fillStyle = c.down > 0 ? '#6b7280' : f < 0.35 ? '#ef4444' : '#22c55e'; ctx.fillRect(x - 10, y - 12, 20 * f, 2);
        }
    }

    drawBike(ctx, v, L, Wd, world) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-L / 2 + 2, -Wd / 4 + 3, L, Wd / 2);
        // Vem sitter på? Gängmedlemmar i MC-klubbar bär väst, spelaren bär sin egen stil
        let riderShirt = '#3b82f6', vest = null, patch = null;
        if (v.driver === 'player') {
            const g = gangById(world.profile.gang);
            riderShirt = g && g.kind !== 'mc' ? g.color : world.player.color;
            if (g && g.kind === 'mc') { vest = g.color; patch = g.patch; }
        } else if (v.gang) {
            const g = gangById(v.gang);
            riderShirt = g.kind === 'mc' ? '#3f3f46' : g.color;
            if (g.kind === 'mc') { vest = g.color; patch = g.patch; }
        }
        if (v.spec.chopper) {
            // HD-chopper: fet bakdäck, lång parallell framgaffel, droppformad tank, ape hangers
            const front = L / 2, hb = L / 2 - 15;
            ctx.fillStyle = '#111'; roundRect(ctx, -L / 2, -4, 11, 8, 2); ctx.fill();          // bakdäck
            ctx.fillStyle = '#e4e4e7'; ctx.fillRect(-L / 2 + 3, -Wd / 2 + 1.5, 13, 1.8);        // avgasrör
            ctx.fillRect(-L / 2 + 3, Wd / 2 - 3.3, 13, 1.8);
            ctx.fillStyle = '#18181b'; ctx.fillRect(-L / 2 + 8, -2.5, L - 20, 5);                 // ram
            ctx.strokeStyle = '#d4d4d8'; ctx.lineWidth = 1.2;                                      // gaffel
            ctx.beginPath(); ctx.moveTo(hb, -2); ctx.lineTo(front - 3, -1.3); ctx.moveTo(hb, 2); ctx.lineTo(front - 3, 1.3); ctx.stroke();
            ctx.fillStyle = '#111'; roundRect(ctx, front - 6, -1.6, 7, 3.2, 1.5); ctx.fill();    // smalt framhjul
            ctx.fillStyle = v.wrecked ? '#222' : v.color;                                          // tank
            ctx.beginPath(); ctx.ellipse(hb - 4, 0, 6, 3.6, 0, 0, Math.PI * 2); ctx.fill();
            ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(hb - 7, -2.2, 5, 1.1);
            ctx.strokeStyle = '#a1a1aa'; ctx.lineWidth = 1.4;                                      // styre
            ctx.beginPath(); ctx.moveTo(hb - 2, -Wd / 2); ctx.lineTo(hb, -Wd / 2 + 2); ctx.lineTo(hb, Wd / 2 - 2); ctx.lineTo(hb - 2, Wd / 2); ctx.stroke();
        } else {
            ctx.fillStyle = '#111'; ctx.fillRect(-L / 2, -2, 8, 4); ctx.fillRect(L / 2 - 8, -2, 8, 4);
            ctx.fillStyle = v.wrecked ? '#222' : v.color; roundRect(ctx, -L / 2 + 5, -Wd / 4, L - 10, Wd / 2, 2); ctx.fill();
            ctx.fillStyle = '#9ca3af'; ctx.fillRect(L / 2 - 9, -Wd / 2, 2, Wd);
        }
        if (v.driver) {
            const rx = v.spec.chopper ? -6 : -2;
            // Armar ut mot styret
            if (v.spec.chopper) {
                ctx.strokeStyle = vest ? '#3f3f46' : riderShirt; ctx.lineWidth = 2.2;
                ctx.beginPath(); ctx.moveTo(rx + 2, -4); ctx.lineTo(L / 2 - 16, -Wd / 2 + 1); ctx.moveTo(rx + 2, 4); ctx.lineTo(L / 2 - 16, Wd / 2 - 1); ctx.stroke();
            }
            ctx.fillStyle = vest ? '#111' : riderShirt; ctx.beginPath(); ctx.ellipse(rx, 0, 4.6, 7, 0, 0, Math.PI * 2); ctx.fill();
            if (vest) {
                // Ryggmärke bakom hjälmen
                ctx.fillStyle = vest; ctx.beginPath(); ctx.arc(rx - 2.6, 0, 2.6, 0, Math.PI * 2); ctx.fill();
                ctx.strokeStyle = patch || '#fff'; ctx.lineWidth = 1;
                ctx.beginPath(); ctx.arc(rx - 2.6, 0, 3.7, Math.PI * 0.6, Math.PI * 1.4); ctx.stroke();
            }
            ctx.fillStyle = v.spec.chopper ? '#3f2a14' : '#111'; ctx.beginPath(); ctx.arc(rx + 2, 0, 3.1, 0, Math.PI * 2); ctx.fill();
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

    drawSpeech(world, view) {
        const ctx = this.ctx;
        ctx.font = '11px "Space Grotesk", sans-serif';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (const ped of world.peds) {
            if (!ped.say || ped.x < view.x0 - 80 || ped.x > view.x1 + 80 || ped.y < view.y0 - 60 || ped.y > view.y1 + 60) continue;
            const text = ped.say.text;
            const w = Math.min(220, ctx.measureText(text).width + 14), h = 18;
            const x = ped.x, y = ped.y - 38;
            ctx.globalAlpha = Math.min(1, ped.say.life * 2);
            ctx.fillStyle = ped.attack ? '#fee2e2' : ped.type === 'metro' ? '#fdf2f8' : '#ffffff';
            ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
            roundRect(ctx, x - w / 2, y - h / 2, w, h, 7); ctx.fill(); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(x - 4, y + h / 2 - 1); ctx.lineTo(x, y + h / 2 + 6); ctx.lineTo(x + 4, y + h / 2 - 1); ctx.closePath(); ctx.fill();
            ctx.fillStyle = '#111';
            ctx.fillText(text, x, y + 0.5, 210);
        }
        ctx.globalAlpha = 1;
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
            const club = world.city.markers.club;
            if (club && world.isClubOpen() && vis(club.x, club.y, 200)) hole(club.x, club.y, 170, 0.8);
            if (p.muzzle > 0) hole(p.x, p.y, 160, 0.9);
            for (const ped of world.peds) if (ped.muzzle > 0 && vis(ped.x, ped.y, 150)) hole(ped.x, ped.y, 130, 0.8);
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
        const club = world.city.markers.club;
        if (club && world.isClubOpen() && vis(club.x, club.y, 200)) {
            const beat = 0.5 + 0.5 * Math.sin(this.t * 7.3);
            glow(club.x, club.y, 150, `rgba(244,80,180,${0.18 + beat * 0.2})`);
            glow(club.x + Math.cos(this.t) * 40, club.y + Math.sin(this.t * 1.3) * 30, 90, `rgba(120,80,255,${0.15 + (1 - beat) * 0.15})`);
        }
        const p = world.player;
        if (p.muzzle > 0) glow(p.x, p.y, 120, 'rgba(255,200,90,0.5)');
        ctx.globalCompositeOperation = 'source-over';
    }
}
