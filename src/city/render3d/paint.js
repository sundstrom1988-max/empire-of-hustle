// ═══════════════════════════════════════════
//  STAN 3D — målade texturer (canvas, ingen three)
//  Marken målas med 2D-renderarens egen ruta-för-
//  ruta-målning så att gator, övergångsställen och
//  parkeringar ser likadana ut i 3D. Här finns också
//  fasader, tak, effektatlas och etikettatlas.
// ═══════════════════════════════════════════

import { TILE, T } from '../constants.js';
import { tileAt } from '../map.js';
import { Renderer } from '../render.js';

export const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
export const SIGN_FONT = 'Bungee, Impact, "Arial Black", sans-serif';

const mk = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function hash(x, y) {
    let h = (x * 374761393 + y * 668265263) >>> 0;
    h = (h ^ (h >>> 13)) * 1274126177 >>> 0;
    return (h ^ (h >>> 16)) >>> 0;
}
const rnd01 = (x, y) => hash(x, y) / 4294967296;

// ── Marken ──
// Reservmålning om 2D-renderarens drawTile skulle saknas
const FALLBACK = { [T.ROAD]: '#2c2e35', [T.SIDEWALK]: '#80838b', [T.GRASS]: '#3d6b2f', [T.TREE]: '#3d6b2f', [T.PLAZA]: '#a89f8c', [T.LOT]: '#34363c', [T.WATER]: '#1b4b7d', [T.WALL]: '#2a2224' };
function drawTile(g, city, tx, ty, x, y) {
    try { Renderer.prototype.drawTile.call(null, g, city, tx, ty, x, y); return; } catch (e) { /* faller tillbaka */ }
    g.fillStyle = FALLBACK[tileAt(city, tx, ty)] || '#1d1e24'; g.fillRect(x, y, TILE, TILE);
}

// En bit av marken (tx0, ty0, n×n rutor) i `px` pixlar. Vattenrutor blir genomskinliga (vattnet ligger lägre).
export function paintGround(city, tx0, ty0, n, px, canvas = null) {
    const cv = canvas || mk(px, px);
    const g = cv.getContext('2d');
    const s = px / (n * TILE);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, px, px);
    g.setTransform(s, 0, 0, s, 0, 0);
    for (let ly = 0; ly < n; ly++) for (let lx = 0; lx < n; lx++) {
        const tx = tx0 + lx, ty = ty0 + ly;
        if (tx < 0 || ty < 0 || tx >= city.w || ty >= city.h) continue;
        const t = tileAt(city, tx, ty);
        if (t === T.WATER) continue;
        drawTile(g, city, tx, ty, lx * TILE, ly * TILE);
        if (t === T.BUILDING) { g.fillStyle = '#26272d'; g.fillRect(lx * TILE, ly * TILE, TILE, TILE); }
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    return cv;
}

// ── Fasader: 8 fack × 8 våningar, nedersta raden = bottenvåningen ──
//  albedo: ljus vägg (tonas med husets färg), mörka rutor. lit: tända fönster på svart.
export const FACADE = { cols: 8, rows: 8, cw: 32, ch: 64 };

function windowRect(style, col, row, rnd) {
    const { cw, ch } = FACADE;
    if (style === 'office') return row === 0 ? [1, 8, cw - 2, ch - 10] : [0, 10, cw, ch - 22];
    if (style === 'ind') {
        if (row === 0) return rnd < 0.5 ? [3, 14, cw - 6, ch - 14] : null; // garageport
        return col % 2 === 0 && rnd < 0.75 ? [7, 14, cw - 14, 18] : null;
    }
    if (row === 0) return [3, 12, cw - 6, ch - 14];
    return [8, 14, cw - 16, 32];
}

export function paintFacade(style, lit) {
    const { cols, rows, cw, ch } = FACADE;
    const W = cols * cw, H = rows * ch;
    const cv = mk(W, H), g = cv.getContext('2d');
    g.fillStyle = lit ? '#000' : '#e9e6e1';
    g.fillRect(0, 0, W, H);
    const salt = style === 'office' ? 11 : style === 'ind' ? 23 : 5;
    if (!lit) {
        // Puts/tegel/plåt-brus
        for (let i = 0; i < 2600; i++) {
            const x = rnd01(i, salt) * W, y = rnd01(salt, i) * H, r = rnd01(i, i + salt);
            g.fillStyle = r < 0.5 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.06)';
            g.fillRect(x, y, 2 + r * 3, 1 + r * 2);
        }
        if (style === 'ind') {
            // Korrugerad plåt: lodräta ränder
            for (let x = 0; x < W; x += 4) { g.fillStyle = x % 8 ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)'; g.fillRect(x, 0, 2, H); }
        }
        if (style === 'res') {
            // Tegelfogar på bottenvåningen
            g.fillStyle = 'rgba(0,0,0,0.07)';
            for (let y = H - ch; y < H; y += 6) g.fillRect(0, y, W, 1);
        }
    }
    for (let row = 0; row < rows; row++) {
        const y0 = H - (row + 1) * ch; // rad 0 längst ner (flipY)
        if (!lit) {
            // Våningsband och sockel
            g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(0, y0 + ch - 3, W, 3);
            g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(0, y0 + ch - 5, W, 2);
            if (row === 0) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, H - 6, W, 6); }
        }
        for (let col = 0; col < cols; col++) {
            const r = rnd01(col * 7 + salt, row * 13 + 1);
            const wr = windowRect(style, col, row, r);
            if (!wr) continue;
            const x = col * cw + wr[0], y = y0 + wr[1], w = wr[2], h = wr[3];
            if (lit) {
                // Tända fönster: varmt, kallt eller tv-blått. Butiker på bottenvåningen lyser oftare.
                const on = rnd01(col + 31, row * 3 + salt);
                const p = row === 0 ? (style === 'ind' ? 0.2 : 0.8) : style === 'office' ? 0.4 : 0.36;
                if (on > p) continue;
                const k = rnd01(col * 5, row + salt * 3);
                const c = k < 0.66 ? [255, 196, 112] : k < 0.88 ? [226, 234, 255] : [110, 150, 255];
                const dim = 0.4 + 0.6 * rnd01(row, col + 99);
                const rgb = (f) => `rgb(${c.map(v => Math.round(v * dim * f)).join(',')})`;
                // rummet innanför: ljusare upptill (taklampa), mörkare golv
                const grd = g.createLinearGradient(0, y, 0, y + h);
                grd.addColorStop(0, rgb(1)); grd.addColorStop(0.6, rgb(0.8)); grd.addColorStop(1, rgb(0.45));
                g.fillStyle = grd; g.fillRect(x, y, w, h);
                // gardin på ena sidan, ibland en siluett, alltid spröjs
                const cur = rnd01(col, row + 7);
                if (cur < 0.5) { g.fillStyle = `rgba(0,0,0,${0.35 + cur * 0.4})`; g.fillRect(cur < 0.25 ? x : x + w * 0.62, y, w * 0.38, h); }
                if (rnd01(col + 9, row + 11) < 0.15 && style !== 'ind') { g.fillStyle = 'rgba(0,0,0,0.55)'; g.beginPath(); g.arc(x + w * 0.45, y + h * 0.42, w * 0.14, 0, Math.PI * 2); g.fill(); g.fillRect(x + w * 0.3, y + h * 0.55, w * 0.3, h * 0.45); }
                g.fillStyle = 'rgba(0,0,0,0.6)';
                if (style === 'office') { for (let xx = x + 15; xx < x + w; xx += 16) g.fillRect(xx, y, 1.5, h); }
                else { g.fillRect(x + w / 2 - 1, y, 2, h); g.fillRect(x, y + h * 0.42, w, 2); }
                continue;
            }
            if (style === 'ind' && row === 0) {
                // Garageport med lameller
                g.fillStyle = '#9aa0a6'; g.fillRect(x, y, w, h);
                g.fillStyle = 'rgba(0,0,0,0.22)';
                for (let yy = y + 3; yy < y + h; yy += 4) g.fillRect(x, yy, w, 1);
                g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x - 1, y - 2, w + 2, 2);
                continue;
            }
            // Karm
            g.fillStyle = 'rgba(30,30,34,0.55)'; g.fillRect(x - 2, y - 2, w + 4, h + 4);
            g.fillStyle = '#f4f2ee'; g.fillRect(x - 1, y - 1, w + 2, h + 2);
            // Glas med himmelsreflex
            const grd = g.createLinearGradient(x, y, x + w * 0.6, y + h);
            grd.addColorStop(0, '#9ab3cc'); grd.addColorStop(0.45, '#4a627c'); grd.addColorStop(1, '#202d3c');
            g.fillStyle = grd; g.fillRect(x, y, w, h);
            g.fillStyle = 'rgba(255,255,255,0.10)';
            g.beginPath(); g.moveTo(x, y + h * 0.7); g.lineTo(x + w * 0.7, y); g.lineTo(x + w, y); g.lineTo(x, y + h); g.closePath(); g.fill();
            // Spröjs
            g.fillStyle = '#e9e6e1';
            if (style === 'office') { for (let xx = x + 15; xx < x + w; xx += 16) g.fillRect(xx, y, 1, h); }
            else if (row === 0) { g.fillRect(x + w / 2 - 1, y, 2, h); g.fillRect(x, y + 10, w, 2); }
            else { g.fillRect(x + w / 2 - 1, y, 2, h); g.fillRect(x, y + h * 0.42, w, 2); }
            // Fönsterbleck
            if (style === 'res' && row > 0) { g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x - 3, y + h + 1, w + 6, 3); }
            // Balkong ibland
            if (style === 'res' && row > 0 && rnd01(col + 3, row + 17) < 0.18) {
                g.fillStyle = 'rgba(40,40,44,0.75)'; g.fillRect(col * cw + 2, y + h - 10, cw - 4, 2);
                for (let xx = col * cw + 3; xx < col * cw + cw - 2; xx += 3) g.fillRect(xx, y + h - 10, 1, 12);
                g.fillRect(col * cw + 2, y + h + 1, cw - 4, 2);
            }
        }
    }
    return cv;
}

// Takpapp/grus (ljust, tonas med takets färg)
export function paintRoof() {
    const S = 256, cv = mk(S, S), g = cv.getContext('2d');
    g.fillStyle = '#d8d8d8'; g.fillRect(0, 0, S, S);
    for (let i = 0; i < 9000; i++) {
        const x = rnd01(i, 3) * S, y = rnd01(5, i) * S, r = rnd01(i, i);
        g.fillStyle = r < 0.5 ? `rgba(0,0,0,${0.04 + r * 0.08})` : `rgba(255,255,255,${0.03 + (r - 0.5) * 0.1})`;
        g.fillRect(x, y, 1 + r * 2, 1 + r * 2);
    }
    g.fillStyle = 'rgba(0,0,0,0.08)';
    for (let y = 0; y < S; y += 64) g.fillRect(0, y, S, 2);
    return cv;
}

// Vattnets normalkarta (mjuka vågor)
export function paintWaterNormals() {
    const S = 256, cv = mk(S, S), g = cv.getContext('2d');
    const img = g.createImageData(S, S), d = img.data;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const a = (x / S) * Math.PI * 2, b = (y / S) * Math.PI * 2;
        const nx = Math.cos(a * 3 + Math.sin(b * 2) * 1.5) * 0.35 + Math.cos(a * 7 + b * 5) * 0.12;
        const ny = Math.sin(b * 4 + Math.cos(a * 3)) * 0.35 + Math.sin(b * 9 - a * 4) * 0.1;
        const i = (y * S + x) * 4;
        d[i] = 128 + nx * 127; d[i + 1] = 128 + ny * 127; d[i + 2] = 230; d[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    return cv;
}

// ── Effektatlas: 4×4 vita former som tonas per instans ──
export const FX = { glow: 0, soft: 1, ring: 2, dash: 3, beam: 4, smoke: 5, spark: 6, square: 7, flare: 8, fire: 9, edge: 10, disc: 11, stripes: 12, arrow: 13, cone: 14, dot: 15 };
export function paintFxAtlas() {
    const C = 128, S = C * 4, cv = mk(S, S), g = cv.getContext('2d');
    const cell = (i, fn) => { g.save(); g.translate((i % 4) * C, Math.floor(i / 4) * C); g.beginPath(); g.rect(0, 0, C, C); g.clip(); fn(g); g.restore(); };
    const radial = (stops) => { const r = g.createRadialGradient(64, 64, 0, 64, 64, 62); stops.forEach(([k, a]) => r.addColorStop(k, `rgba(255,255,255,${a})`)); return r; };
    cell(FX.glow, () => { g.fillStyle = radial([[0, 1], [0.15, 0.85], [0.4, 0.3], [1, 0]]); g.fillRect(0, 0, C, C); });
    cell(FX.soft, () => { g.fillStyle = radial([[0, 1], [0.55, 0.75], [1, 0]]); g.fillRect(0, 0, C, C); });
    cell(FX.ring, () => { g.strokeStyle = '#fff'; g.lineWidth = 7; g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.stroke(); });
    cell(FX.dash, () => { g.strokeStyle = '#fff'; g.lineWidth = 7; g.setLineDash([18, 12]); g.beginPath(); g.arc(64, 64, 56, 0, Math.PI * 2); g.stroke(); });
    cell(FX.beam, () => {
        // Strålkastarkägla på marken: smal vid lampan (vänster), bred och svag långt bort
        const grd = g.createLinearGradient(0, 0, C, 0);
        grd.addColorStop(0, 'rgba(255,255,255,0.95)'); grd.addColorStop(0.5, 'rgba(255,255,255,0.45)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd;
        g.beginPath(); g.moveTo(0, 56); g.lineTo(C, 4); g.lineTo(C, 124); g.lineTo(0, 72); g.closePath(); g.fill();
        g.globalCompositeOperation = 'destination-in';
        const v = g.createLinearGradient(0, 0, 0, C);
        v.addColorStop(0, 'rgba(0,0,0,0)'); v.addColorStop(0.3, 'rgba(0,0,0,1)'); v.addColorStop(0.7, 'rgba(0,0,0,1)'); v.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = v; g.fillRect(0, 0, C, C);
    });
    cell(FX.smoke, () => {
        for (let i = 0; i < 9; i++) {
            const a = i * 0.7, r = 18 + (i % 3) * 8, x = 64 + Math.cos(a) * 20, y = 64 + Math.sin(a * 1.3) * 18;
            const grd = g.createRadialGradient(x, y, 0, x, y, r + 10);
            grd.addColorStop(0, 'rgba(255,255,255,0.5)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = grd; g.fillRect(0, 0, C, C);
        }
    });
    cell(FX.spark, () => {
        const grd = g.createLinearGradient(0, 0, C, 0);
        grd.addColorStop(0, 'rgba(255,255,255,0)'); grd.addColorStop(0.7, 'rgba(255,255,255,0.8)'); grd.addColorStop(1, 'rgba(255,255,255,1)');
        g.fillStyle = grd; g.fillRect(4, 56, C - 8, 16);
    });
    cell(FX.square, () => { g.fillStyle = '#fff'; g.fillRect(8, 8, C - 16, C - 16); });
    cell(FX.flare, () => {
        g.fillStyle = radial([[0, 1], [0.08, 0.9], [0.25, 0.25], [1, 0]]); g.fillRect(0, 0, C, C);
        const ray = g.createLinearGradient(0, 0, C, 0);
        ray.addColorStop(0, 'rgba(255,255,255,0)'); ray.addColorStop(0.5, 'rgba(255,255,255,0.7)'); ray.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = ray; g.fillRect(0, 62, C, 4);
    });
    cell(FX.fire, () => {
        const r = g.createRadialGradient(64, 64, 0, 64, 64, 62);
        r.addColorStop(0, 'rgba(255,255,230,1)'); r.addColorStop(0.3, 'rgba(255,200,80,0.95)'); r.addColorStop(0.65, 'rgba(240,90,20,0.6)'); r.addColorStop(1, 'rgba(80,20,10,0)');
        g.fillStyle = r; g.fillRect(0, 0, C, C);
    });
    cell(FX.edge, () => {
        // Kontaktskugga: mörk mot väggen (vänster), tonar ut
        const grd = g.createLinearGradient(0, 0, C, 0);
        grd.addColorStop(0, 'rgba(255,255,255,0.85)'); grd.addColorStop(0.4, 'rgba(255,255,255,0.35)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.fillRect(0, 0, C, C);
    });
    cell(FX.disc, () => { g.fillStyle = '#fff'; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill(); });
    cell(FX.stripes, () => {
        g.fillStyle = '#fff';
        for (let i = -4; i < 8; i++) { g.beginPath(); g.moveTo(i * 24, 0); g.lineTo(i * 24 + 12, 0); g.lineTo(i * 24 + 12 + C, C); g.lineTo(i * 24 + C, C); g.closePath(); g.fill(); }
    });
    cell(FX.arrow, () => {
        g.fillStyle = '#fff'; g.strokeStyle = 'rgba(0,0,0,1)'; g.lineWidth = 6;
        g.beginPath(); g.moveTo(64, 120); g.lineTo(14, 60); g.lineTo(44, 60); g.lineTo(44, 8); g.lineTo(84, 8); g.lineTo(84, 60); g.lineTo(114, 60); g.closePath(); g.fill();
    });
    cell(FX.cone, () => {
        // Ljuskägla uppifrån och ner (för lampor och scenljus)
        const grd = g.createLinearGradient(0, 0, 0, C);
        grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grd; g.beginPath(); g.moveTo(54, 0); g.lineTo(74, 0); g.lineTo(C, C); g.lineTo(0, C); g.closePath(); g.fill();
    });
    cell(FX.dot, () => { g.fillStyle = radial([[0, 1], [0.6, 1], [0.8, 0.4], [1, 0]]); g.fillRect(32, 32, 64, 64); });
    return cv;
}
export function fxRect(i, out = [0, 0, 0, 0]) {
    const u0 = (i % 4) / 4, v1 = 1 - Math.floor(i / 4) / 4;
    out[0] = u0 + 0.002; out[1] = v1 - 0.25 + 0.002; out[2] = u0 + 0.25 - 0.002; out[3] = v1 - 0.002;
    return out;
}

// ── Etikettatlas: emoji och skyltar ritas en gång och återanvänds ──
export class LabelAtlas {
    constructor(size = 1024) {
        this.size = size;
        this.canvas = mk(size, size);
        this.g = this.canvas.getContext('2d');
        this.map = new Map();
        this.reset();
    }
    reset() {
        this.g.clearRect(0, 0, this.size, this.size);
        this.map.clear();
        this.x = 0; this.y = 0; this.rowH = 0;
        this.dirty = true;
        this.version = (this.version || 0) + 1;
    }
    alloc(w, h) {
        if (this.x + w > this.size) { this.x = 0; this.y += this.rowH + 2; this.rowH = 0; }
        if (this.y + h > this.size) { this.reset(); }
        const r = { x: this.x, y: this.y, w, h };
        this.x += w + 2; this.rowH = Math.max(this.rowH, h);
        return r;
    }
    uv(r) {
        const S = this.size;
        return [(r.x + 0.5) / S, 1 - (r.y + r.h - 0.5) / S, (r.x + r.w - 0.5) / S, 1 - (r.y + 0.5) / S];
    }
    // Emoji i en kvadratisk ruta
    icon(ch) {
        const key = 'i:' + ch;
        let e = this.map.get(key);
        if (e) return e;
        const C = 72, r = this.alloc(C, C), g = this.g;
        g.save();
        g.font = `${C * 0.8}px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(ch, r.x + C / 2, r.y + C / 2 + 3);
        g.restore();
        e = { uv: this.uv(r), aspect: 1 };
        this.map.set(key, e); this.dirty = true;
        return e;
    }
    // Skylt: text med kontur och valfri neonglöd. Höjden är fast, bredden följer texten.
    text(str, color = '#fff', opts) {
        opts = opts || {};
        const key = 't:' + str + '|' + color + '|' + (opts.glow || '') + '|' + (opts.size || 28) + '|' + (opts.bg || '');
        let e = this.map.get(key);
        if (e) return e;
        const g = this.g, size = opts.size || 28, pad = opts.glow ? 12 : 6;
        g.save();
        g.font = `${size}px ${opts.font || SIGN_FONT}`;
        const tw = Math.min(this.size - 4, Math.ceil(g.measureText(str).width) + pad * 2 + 6);
        const th = Math.ceil(size * 1.35) + pad;
        const r = this.alloc(tw, th);
        g.beginPath(); g.rect(r.x, r.y, r.w, r.h); g.clip();
        g.textAlign = 'center'; g.textBaseline = 'middle';
        const cx = r.x + tw / 2, cy = r.y + th / 2 + 1;
        if (opts.bg) {
            g.fillStyle = opts.bg;
            const rr = 8, x = r.x + 2, y = r.y + 2, w = tw - 4, h = th - 4;
            g.beginPath(); g.moveTo(x + rr, y); g.arcTo(x + w, y, x + w, y + h, rr); g.arcTo(x + w, y + h, x, y + h, rr); g.arcTo(x, y + h, x, y, rr); g.arcTo(x, y, x + w, y, rr); g.closePath(); g.fill();
        }
        if (opts.glow) { g.shadowColor = opts.glow; g.shadowBlur = 12; }
        g.lineWidth = Math.max(3, size * 0.16); g.strokeStyle = opts.stroke || '#000'; g.lineJoin = 'round';
        if (!opts.bg) g.strokeText(str, cx, cy);
        g.fillStyle = color; g.fillText(str, cx, cy);
        if (opts.glow) { g.shadowBlur = 4; g.fillText(str, cx, cy); }
        g.restore();
        e = { uv: this.uv(r), aspect: tw / th };
        this.map.set(key, e); this.dirty = true;
        return e;
    }
}

// ── Inomhus: sidor på hyllor, vapenställ och väggar (tonas med möbelns färg) ──
export function paintShelf(kind) {
    const W = 128, H = 128, cv = mk(W, H), g = cv.getContext('2d');
    if (kind === 'rack') {
        // Perforerad skiva med vapen
        g.fillStyle = '#b9b4ac'; g.fillRect(0, 0, W, H);
        g.fillStyle = 'rgba(0,0,0,0.25)';
        for (let y = 4; y < H; y += 8) for (let x = 4; x < W; x += 8) g.fillRect(x, y, 2, 2);
        const gun = (x, y, w, long) => {
            g.fillStyle = '#1b1d21';
            g.fillRect(x, y, w, 6); g.fillRect(x + w * 0.62, y + 5, 6, 12);
            if (long) { g.fillStyle = '#6b4423'; g.fillRect(x - 14, y + 1, 16, 8); }
        };
        gun(20, 16, 70, true); gun(14, 48, 44, false); gun(70, 52, 40, false); gun(24, 84, 84, true); gun(30, 112, 34, false);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, H - 6, W, 6);
        return cv;
    }
    g.fillStyle = '#9a9690'; g.fillRect(0, 0, W, H);
    const cols = ['#ef4444', '#f59e0b', '#22c55e', '#3b82f6', '#a855f7', '#e5e7eb', '#111827', '#f97316', '#14b8a6'];
    for (let s = 0; s < 4; s++) {
        const y0 = s * 32;
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, y0, W, 32);
        let x = 2;
        while (x < W - 6) {
            const w = 6 + Math.floor(rnd01(x, s) * 12), h = 10 + Math.floor(rnd01(s, x) * 16);
            g.fillStyle = cols[Math.floor(rnd01(x * 3, s * 7) * cols.length)];
            g.fillRect(x, y0 + 28 - h, w, h);
            g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x, y0 + 28 - h, 2, h);
            x += w + 2;
        }
        g.fillStyle = '#5b5148'; g.fillRect(0, y0 + 28, W, 4);
    }
    return cv;
}
export function paintWall() {
    const W = 128, H = 128, cv = mk(W, H), g = cv.getContext('2d');
    g.fillStyle = '#d9d4cc'; g.fillRect(0, 0, W, H);
    for (let i = 0; i < 900; i++) { const r = rnd01(i, 71); g.fillStyle = r < 0.5 ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)'; g.fillRect(rnd01(i, 3) * W, rnd01(4, i) * H, 2, 2); }
    // paneler, list upptill, sockel nertill
    g.fillStyle = 'rgba(0,0,0,0.12)';
    for (let x = 0; x < W; x += 32) g.fillRect(x, 0, 2, H);
    g.fillStyle = 'rgba(0,0,0,0.45)'; g.fillRect(0, H - 12, W, 12);
    g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(0, H - 14, W, 2);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, W, 6);
    return cv;
}

// ── Inomhus: rummet målat uppifrån (golv, möbler, skyltar) som golvtextur ──
export function paintRoom(INT, state, scale) {
    const def = state.def, TS = INT.IN_TILE || 32;
    const W = def.w * TS, H = def.h * TS;
    const cv = mk(Math.round(W * scale), Math.round(H * scale)), g = cv.getContext('2d');
    g.setTransform(scale, 0, 0, scale, 0, 0);
    g.fillStyle = '#07060b'; g.fillRect(0, 0, W, H);
    const view = { x0: 0, y0: 0, x1: W, y1: H };
    // Utan folk: de ritas som 3D-figurer
    const bare = Object.assign(Object.create(Object.getPrototypeOf(state)), state, { npcs: [] });
    try { INT.drawInterior(g, bare, view, state.t, () => {}); } catch (e) { console.warn('3D: kunde inte måla rummet', e); }
    g.setTransform(1, 0, 0, 1, 0, 0);
    return cv;
}

// Rummets ljus (additivt sken på golvet) i låg upplösning — uppdateras några gånger i sekunden
export function paintRoomLight(INT, state, canvas, scale, t) {
    const def = state.def, TS = INT.IN_TILE || 32;
    const g = canvas.getContext('2d');
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    g.fillStyle = '#000'; g.fillRect(0, 0, canvas.width, canvas.height);
    g.setTransform(scale, 0, 0, scale, 0, 0);
    try { INT.drawInteriorLights(g, state, { x0: 0, y0: 0, x1: def.w * TS, y1: def.h * TS }, t); } catch (e) { /* tomt ljus */ }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = 'source-over';
    return canvas;
}
export const makeCanvas = mk;
