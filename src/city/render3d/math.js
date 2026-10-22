// ═══════════════════════════════════════════
//  STAN 3D — ren logik (ingen three, ingen DOM)
//  Skala, koordinater, kameror, dygnets färger,
//  matriser för instansierade figurdelar och
//  en enkel pool. Testas i tests/render3d.test.js.
// ═══════════════════════════════════════════

// ── Skala (1 enhet = 1 px i världen) ──
//  three: x = världens x, z = världens y, y = upp
export const PERSON_H = 34;        // en människa
export const EYE_H = 30;           // ögonhöjd i förstapersonsvy
export const FLOOR_H = 40;         // en våning
export const GROUND_FLOOR_H = 50;  // bottenvåningen är högre: dörrar och skyltfönster
export const MAX_FLOORS = 8;       // fasadtexturen har åtta rader
export const CAR_H = 21;           // en bil
export const ROOM_H = 58;          // takhöjd inomhus (~3 m)

const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, k) => a + (b - a) * k;
export const smooth = k => k * k * (3 - 2 * k);

// 2D → 3D: världens (x, y) och höjd z
export function toScene(x, y, z = 0, out = { x: 0, y: 0, z: 0 }) {
    out.x = x; out.y = z; out.z = y;
    return out;
}
// 3D → 2D: { x, y (världens y), z (höjd) }
export function fromScene(x, y, z, out = { x: 0, y: 0, z: 0 }) {
    out.x = x; out.y = z; out.z = y;
    return out;
}
// 2D-vinkel (0 = +x, π/2 = +y nedåt) → rotation runt three:s y-axel för en modell som tittar mot +x
export const yawOf = angle => -angle;

// Kortaste vägen mellan två vinklar
export function angleDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
    return d;
}
export const lerpAngle = (a, b, k) => a + angleDiff(a, b) * k;

// ── Hus ──
// Samma våningsantal som 2D-renderaren (max(2, round(height*16))), taket vid åtta
export const floorsOf = b => Math.min(MAX_FLOORS, Math.max(2, Math.round((b.height || 0) * 16)));
export const buildingHeight = b => GROUND_FLOOR_H + (floorsOf(b) - 1) * FLOOR_H;

// Fasadstil efter stadsdel: kontor i Centrum, plåt och tegel i Industrin/Hamnen, annars bostäder
export function facadeStyle(b) {
    if (b.hq) return 'office';
    if (b.district === 'centrum') return 'office';
    if (b.district === 'industrin' || b.district === 'hamnen') return 'ind';
    return 'res';
}
// Villorna i Skogsbacken (och små låga hus) får sadeltak
export function hasGable(b) {
    return !b.hq && floorsOf(b) <= 2 && (b.district === 'skogsbacken' || ((b.id * 7) % 5 === 0 && b.w * b.h <= 6));
}

// ── Kameror ──
export const CHASE = {
    car: { back: 320, up: 220, ahead: 90, lookH: 18, turn: 3.2 },
    foot: { back: 210, up: 140, ahead: 60, lookH: 26, turn: 2.6 },
    room: { back: 120, up: 44, ahead: 40, lookH: 24, turn: 3.0 },
    fov: 58
};
export const FPS = { fov: 75, carEye: 16, bikeEye: 27, bob: 0.7 };

// Var kameran tittar ifrån: spelaren eller fordonet hen kör
export function cameraSubject(world) {
    const p = world.player, v = p.vehicle;
    if (v) return { x: v.x, y: v.y, angle: v.angle, speed: Math.hypot(v.vx || 0, v.vy || 0), max: v.spec?.maxSpeed || 400, car: true, bike: v.spec?.kind === 'bike', v };
    return { x: p.x, y: p.y, angle: p.angle, speed: Math.hypot(p.vx || 0, p.vy || 0), max: 200, car: false, bike: false, v: null };
}

// Följande kamera snett bakom: vinkeln glider mjukt efter, positionen sitter fast i målet (inget skak i fart).
//  st = { yaw, dist, init } sparas mellan bildrutorna. opts: { yaw?, pitch?, dist? }
//  blocked(x, y, h) → true om en punkt i världen ligger inne i ett hus (dras då närmare)
export function chaseCamera(st, subj, dt, opts = {}, room = false, blocked = null, out = {}) {
    const c = room ? CHASE.room : subj.car ? CHASE.car : CHASE.foot;
    const want = opts.yaw ?? subj.angle;
    if (!st.init) { st.yaw = want; st.dist = 1; st.init = true; }
    else st.yaw = lerpAngle(st.yaw, want, opts.yaw != null ? 1 : Math.min(1, dt * c.turn));
    const zoom = clamp(opts.dist ?? 1, 0.15, 3);
    const fast = subj.car ? clamp(subj.speed / (subj.max || 400), 0, 1) : 0;
    let back = c.back * zoom * (1 + fast * 0.22);
    let up = c.up * zoom * (1 + fast * 0.1);
    // pitch: + tittar uppåt (kameran sänks), − tittar ner (kameran höjs)
    if (opts.pitch != null) up = c.lookH + back * Math.tan(clamp(Math.atan2(c.up - c.lookH, c.back) - opts.pitch, 0.04, 1.4));
    const fx = Math.cos(st.yaw), fy = Math.sin(st.yaw);
    // Hus i vägen: gå längs linjen från målet bakåt och stanna före första väggen
    let k = 1;
    if (blocked) {
        const steps = 14;
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            if (blocked(subj.x - fx * back * t, subj.y - fy * back * t, c.lookH + (up - c.lookH) * t)) { k = Math.max(0.12, (i - 1) / steps); break; }
        }
    }
    // Snabbt in, långsamt ut igen
    st.dist += (k - st.dist) * Math.min(1, dt * (k < st.dist ? 14 : 2.5));
    if (!(dt > 0)) st.dist = Math.min(st.dist, k);
    back *= st.dist; up = c.lookH + (up - c.lookH) * st.dist;
    if (room) up = Math.min(up, ROOM_H - 6);
    out.x = subj.x - fx * back; out.y = subj.y - fy * back; out.z = up;
    out.lx = subj.x + fx * c.ahead * zoom; out.ly = subj.y + fy * c.ahead * zoom; out.lz = c.lookH;
    out.fov = CHASE.fov;
    return out;
}

// Förstapersonsvy: ögonen på spelaren, eller förarplatsen i bilen. Vinkel från opts.yaw/pitch.
export function fpsCamera(world, opts = {}, out = {}) {
    const p = world.player, v = p.vehicle;
    const pitch = clamp(opts.pitch ?? 0, -1.4, 1.4);
    let x, y, z, yaw;
    if (v) {
        const a = v.angle, L = v.spec?.l || 44, W = v.spec?.w || 22;
        const bike = v.spec?.kind === 'bike';
        // förarplatsen: lite bakom mitten, till vänster (högertrafik)
        const fwd = bike ? -0.12 * L : -0.04 * L, side = bike ? 0 : -0.2 * W;
        x = v.x + Math.cos(a) * fwd + Math.sin(a) * side;
        y = v.y + Math.sin(a) * fwd - Math.cos(a) * side;
        z = bike ? FPS.bikeEye : FPS.carEye;
        yaw = opts.yaw ?? a;
    } else {
        x = p.x; y = p.y;
        const moving = Math.hypot(p.vx || 0, p.vy || 0) > 20;
        z = p.dead ? 6 : EYE_H + (moving ? Math.abs(Math.sin(p.walkPhase || 0)) * FPS.bob : 0);
        yaw = opts.yaw ?? p.angle;
    }
    const cp = Math.cos(pitch);
    out.x = x; out.y = y; out.z = z;
    out.lx = x + Math.cos(yaw) * cp * 100; out.ly = y + Math.sin(yaw) * cp * 100; out.lz = z + Math.sin(pitch) * 100;
    out.yaw = yaw; out.pitch = pitch;
    out.fov = FPS.fov;
    return out;
}

// ── Dygnet: himmel, dimma och ljus ──
//  Nycklar över dygnet. Färger som 0xRRGGBB, styrkor som tal.
const DAY_KEYS = [
    //  timme  zenit     horisont  sol/måne  solstyrka  himmelsljus  mark      fönster
    [0, 0x050816, 0x10162e, 0x8fa4ff, 0.35, 0.55, 0x0b0d14, 1],
    [4.5, 0x060a1c, 0x161a33, 0x8fa4ff, 0.35, 0.55, 0x0b0d14, 1],
    [6, 0x2a3d6e, 0xf2a170, 0xffb27a, 0.9, 0.9, 0x2a2420, 0.6],
    [8, 0x3b82d6, 0xbcd7ef, 0xfff1d6, 2.4, 1.5, 0x4a4438, 0],
    [16.5, 0x3a7fd4, 0xc4dcef, 0xfff1d6, 2.4, 1.5, 0x4a4438, 0],
    [18.3, 0x37548f, 0xf6b278, 0xffb066, 1.7, 1.2, 0x3a3028, 0.15],
    [19.5, 0x23285a, 0xe0795a, 0xff8a50, 0.95, 0.95, 0x2a2026, 0.55],
    [20.5, 0x111637, 0x3a2f5c, 0xa8b4ff, 0.5, 0.7, 0x151520, 0.85],
    [21.5, 0x060a1c, 0x161a33, 0x8fa4ff, 0.35, 0.55, 0x0b0d14, 1],
    [24, 0x050816, 0x10162e, 0x8fa4ff, 0.35, 0.55, 0x0b0d14, 1]
];
const mixHex = (a, b, k) => {
    const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, k));
    const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, k));
    const bl = Math.round(lerp(a & 255, b & 255, k));
    return (r << 16) | (g << 8) | bl;
};
export { mixHex };

// hour: 0–24, darkness: världens mörker (0–0,6) — styr gatlampor som i 2D
export function dayPalette(hour, darkness = 0, out = {}) {
    const h = ((hour % 24) + 24) % 24;
    let i = 0;
    while (i < DAY_KEYS.length - 2 && DAY_KEYS[i + 1][0] <= h) i++;
    const a = DAY_KEYS[i], b = DAY_KEYS[i + 1];
    const k = clamp((h - a[0]) / Math.max(1e-6, b[0] - a[0]), 0, 1);
    out.zenith = mixHex(a[1], b[1], k);
    out.horizon = mixHex(a[2], b[2], k);
    out.sun = mixHex(a[3], b[3], k);
    out.sunI = lerp(a[4], b[4], k);
    out.skyI = lerp(a[5], b[5], k);
    out.ground = mixHex(a[6], b[6], k);
    out.windows = lerp(a[7], b[7], k);
    out.lamps = clamp(darkness / 0.6, 0, 1);
    out.night = clamp((out.lamps - 0.3) / 0.7, 0, 1);
    out.fog = mixHex(out.horizon, out.zenith, 0.25);
    // Solen går upp i öster (+x) och ner i väster; på natten lyser månen snett från sydväst
    const dayT = (h - 6) / 13; // 0 vid 06, 1 vid 19
    const ang = clamp(dayT, 0, 1) * Math.PI;
    const w = clamp(Math.min(dayT + 0.2, 1.2 - dayT) / 0.2, 0, 1); // 1 = sol, 0 = måne
    const sd = out.sunDir || (out.sunDir = [0, 1, 0]);
    sd[0] = lerp(-0.45, Math.cos(ang), w); sd[1] = lerp(0.75, Math.max(0.12, Math.sin(ang)), w); sd[2] = lerp(0.5, 0.35, w);
    const l = Math.hypot(sd[0], sd[1], sd[2]);
    sd[0] /= l; sd[1] /= l; sd[2] /= l;
    return out;
}

// ── Figurer: leder och poser ──
//  Lederna roterar runt sidled (z): + svänger framåt. Armar lyfts åt sidan runt framåtaxeln (x).
export function figurePose(pose, phase, moving = true, out = {}) {
    const s = Math.sin(phase);
    let legL = 0, legR = 0, armL = 0, armR = 0, sideL = 0, sideR = 0, bob = 0, lean = 0, sway = 0, sit = 0;
    switch (pose) {
        case 'sit':
            legL = legR = 1.45; armL = armR = 0.5; sit = 1;
            break;
        case 'ride':
            legL = legR = 1.1; armL = armR = 1.15; sit = 1; lean = 0.18;
            break;
        case 'cheer': {
            const up = Math.abs(Math.sin(phase * 3));
            armL = armR = 0.3; sideL = sideR = 2.5 + up * 0.35; bob = up * 1.2;
            break;
        }
        case 'dance':
            sway = Math.sin(phase * 2) * 0.35;
            armL = 1.2 + Math.sin(phase * 2) * 0.9; armR = 1.2 - Math.sin(phase * 2) * 0.9;
            sideL = sideR = 0.5; legL = s * 0.35; legR = -s * 0.35; bob = Math.abs(Math.sin(phase * 2)) * 1.5;
            break;
        case 'work':
            armL = armR = 1.1; legL = legR = 0;
            break;
        case 'idle':
            armL = armR = 0.05 + Math.sin(phase * 0.5) * 0.03;
            break;
        default: // walk
            if (moving) {
                legL = s * 0.6; legR = -s * 0.6;
                armL = -s * 0.5; armR = s * 0.5;
                bob = Math.abs(Math.cos(phase)) * 0.9;
            }
    }
    out.legL = legL; out.legR = legR; out.armL = armL; out.armR = armR;
    out.sideL = sideL; out.sideR = sideR; out.bob = bob; out.lean = lean; out.sway = sway; out.sit = sit;
    return out;
}

// ── Matriser (kolumnordning som three) direkt in i instansbuffertar ──
// Rot: flytta, vrid runt y (yaw), luta runt z (roll: + = framåt), skala
export function rootMatrix(m, o, x, y, z, yaw, roll, scale) {
    const cy = Math.cos(yaw), sy = Math.sin(yaw), cr = Math.cos(roll), sr = Math.sin(roll);
    // R = Ry(yaw) · Rz(-roll)
    // Rz(-roll): [cr sr 0; -sr cr 0; 0 0 1]
    const a00 = cy * cr, a01 = cy * sr, a02 = sy;
    const a10 = -sr, a11 = cr, a12 = 0;
    const a20 = -sy * cr, a21 = -sy * sr, a22 = cy;
    m[o] = a00 * scale; m[o + 1] = a10 * scale; m[o + 2] = a20 * scale; m[o + 3] = 0;
    m[o + 4] = a01 * scale; m[o + 5] = a11 * scale; m[o + 6] = a21 * scale; m[o + 7] = 0;
    m[o + 8] = a02 * scale; m[o + 9] = a12 * scale; m[o + 10] = a22 * scale; m[o + 11] = 0;
    m[o + 12] = x; m[o + 13] = y; m[o + 14] = z; m[o + 15] = 1;
}

// Led: out = root · T(jx, jy, jz) · Rz(rz) · Rx(rx) · S(sx, sy, sz)
export function jointMatrix(out, oo, root, ro, jx, jy, jz, rz, rx, sx = 1, sy = 1, sz = 1) {
    const cz = Math.cos(rz), sz_ = Math.sin(rz), cx = Math.cos(rx), sxn = Math.sin(rx);
    // L = Rz · Rx
    const l00 = cz, l01 = -sz_ * cx, l02 = sz_ * sxn;
    const l10 = sz_, l11 = cz * cx, l12 = -cz * sxn;
    const l20 = 0, l21 = sxn, l22 = cx;
    // kolumner i L (med skala)
    const c0x = l00 * sx, c0y = l10 * sx, c0z = l20 * sx;
    const c1x = l01 * sy, c1y = l11 * sy, c1z = l21 * sy;
    const c2x = l02 * sz, c2y = l12 * sz, c2z = l22 * sz;
    const r = root, b = ro;
    const R00 = r[b], R10 = r[b + 1], R20 = r[b + 2];
    const R01 = r[b + 4], R11 = r[b + 5], R21 = r[b + 6];
    const R02 = r[b + 8], R12 = r[b + 9], R22 = r[b + 10];
    out[oo] = R00 * c0x + R01 * c0y + R02 * c0z;
    out[oo + 1] = R10 * c0x + R11 * c0y + R12 * c0z;
    out[oo + 2] = R20 * c0x + R21 * c0y + R22 * c0z;
    out[oo + 3] = 0;
    out[oo + 4] = R00 * c1x + R01 * c1y + R02 * c1z;
    out[oo + 5] = R10 * c1x + R11 * c1y + R12 * c1z;
    out[oo + 6] = R20 * c1x + R21 * c1y + R22 * c1z;
    out[oo + 7] = 0;
    out[oo + 8] = R00 * c2x + R01 * c2y + R02 * c2z;
    out[oo + 9] = R10 * c2x + R11 * c2y + R12 * c2z;
    out[oo + 10] = R20 * c2x + R21 * c2y + R22 * c2z;
    out[oo + 11] = 0;
    out[oo + 12] = R00 * jx + R01 * jy + R02 * jz + r[b + 12];
    out[oo + 13] = R10 * jx + R11 * jy + R12 * jz + r[b + 13];
    out[oo + 14] = R20 * jx + R21 * jy + R22 * jz + r[b + 14];
    out[oo + 15] = 1;
}

// Transformera en punkt med en matris i en buffert
export function applyMatrix(m, o, x, y, z, out = { x: 0, y: 0, z: 0 }) {
    out.x = m[o] * x + m[o + 4] * y + m[o + 8] * z + m[o + 12];
    out.y = m[o + 1] * x + m[o + 5] * y + m[o + 9] * z + m[o + 13];
    out.z = m[o + 2] * x + m[o + 6] * y + m[o + 10] * z + m[o + 14];
    return out;
}

// ── Pool: ett återanvänt objekt per nyckel (id), städas när nyckeln inte setts på ett tag ──
export class Pool {
    constructor(make, maxIdle = 2) { this.make = make; this.map = new Map(); this.frame = 0; this.maxIdle = maxIdle; this.created = 0; }
    get(key) {
        let e = this.map.get(key);
        if (!e) { e = { obj: this.make(key), seen: 0 }; this.map.set(key, e); this.created++; }
        e.seen = this.frame;
        return e.obj;
    }
    // Anropas en gång per bildruta; returnerar de objekt som släpptes (för dispose)
    sweep(onDrop) {
        this.frame++;
        for (const [k, e] of this.map) {
            if (this.frame - e.seen > this.maxIdle) { this.map.delete(k); if (onDrop) onDrop(e.obj, k); }
        }
    }
    get size() { return this.map.size; }
}

// Färgsträng (#rgb, #rrggbb, rgb(...)) → [r, g, b] 0–1 i sRGB, cachad
const colorCache = new Map();
export function parseColor(str, fallback = 0x888888) {
    if (typeof str === 'number') return [((str >> 16) & 255) / 255, ((str >> 8) & 255) / 255, (str & 255) / 255];
    let c = colorCache.get(str);
    if (c) return c;
    let n = fallback;
    if (typeof str === 'string') {
        if (str[0] === '#') {
            let h = str.slice(1);
            if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
            const v = parseInt(h.slice(0, 6), 16);
            if (!Number.isNaN(v)) n = v;
        } else {
            const m = str.match(/rgba?\(([^)]+)\)/);
            if (m) { const p = m[1].split(',').map(Number); n = (clamp(p[0] | 0, 0, 255) << 16) | (clamp(p[1] | 0, 0, 255) << 8) | clamp(p[2] | 0, 0, 255); }
        }
    }
    c = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
    if (colorCache.size > 4000) colorCache.clear();
    colorCache.set(str, c);
    return c;
}

// Höjd på möbler inomhus (px), efter tecken och namn i LEGEND
const ROOM_HEIGHTS = { '#': ROOM_H, T: 10, P: ROOM_H, B: 21, o: 14, t: 14, h: 9, S: 9, V: 7, D: 19, k: 30, x: 26, W: 17, m: 15, f: 26, C: 20, G: 19, R: 46, A: 38, Q: 22 };
const NAME_HEIGHTS = [
    [/vägg|mur/, ROOM_H], [/hylla|kyl|frys|skåp|ställ|automat|maskin|ugn|spis/, 36], [/disk|kassa|bänk/, 20],
    [/scen|podium|ring/, 10], [/säng|soffa|bänk/, 10], [/stol|pall/, 10], [/bord/, 14], [/växt|palm/, 26],
    [/låda|lådor|kartong|pall/, 22], [/högtalare|tv|skärm/, 30], [/bil|lyft/, 24], [/stolpe/, 18]
];
export function furnitureHeight(ch, info) {
    if (ROOM_HEIGHTS[ch] != null) return ROOM_HEIGHTS[ch];
    const name = (info && info.name || '').toLowerCase();
    for (const [re, h] of NAME_HEIGHTS) if (re.test(name)) return h;
    return info && info.solid ? 18 : 0;
}
