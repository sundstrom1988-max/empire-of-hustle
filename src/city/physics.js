// ═══════════════════════════════════════════
//  STAN — fysik
//  Arkadig bilfysik i GTA-anda: grepp i sidled,
//  drift med handbroms, studs och spinn vid krock.
// ═══════════════════════════════════════════

import { TILE, T, SOLID } from './constants.js';
import { tileAt } from './map.js';

const NO_INPUT = { throttle: 0, steer: 0, handbrake: false, nitro: false };
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// En bil approximeras med två cirklar längs mittlinjen.
export function vehicleCircles(v) {
    const r = v.spec.w / 2 + 1;
    const off = Math.max(0, v.spec.l / 2 - r);
    const c = Math.cos(v.angle), s = Math.sin(v.angle);
    return [
        { x: v.x + c * off, y: v.y + s * off, r, ox: c * off, oy: s * off },
        { x: v.x - c * off, y: v.y - s * off, r, ox: -c * off, oy: -s * off }
    ];
}

// Djupaste kontakten mellan en cirkel och solida rutor
function deepestTileContact(cx, cy, r, city) {
    let best = null;
    const x0 = Math.floor((cx - r) / TILE), x1 = Math.floor((cx + r) / TILE);
    const y0 = Math.floor((cy - r) / TILE), y1 = Math.floor((cy + r) / TILE);
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
        if (!SOLID.has(tileAt(city, tx, ty))) continue;
        const left = tx * TILE, top = ty * TILE, right = left + TILE, bottom = top + TILE;
        const px = clamp(cx, left, right), py = clamp(cy, top, bottom);
        let dx = cx - px, dy = cy - py;
        const d2 = dx * dx + dy * dy;
        let nx, ny, pen;
        if (d2 > 1e-6) {
            if (d2 >= r * r) continue;
            const d = Math.sqrt(d2);
            nx = dx / d; ny = dy / d; pen = r - d;
        } else {
            // Mittpunkten ligger inne i rutan: knuffa ut via närmaste kant
            const dl = cx - left, dr = right - cx, dt = cy - top, db = bottom - cy;
            const m = Math.min(dl, dr, dt, db);
            if (m === dl) { nx = -1; ny = 0; } else if (m === dr) { nx = 1; ny = 0; } else if (m === dt) { nx = 0; ny = -1; } else { nx = 0; ny = 1; }
            pen = m + r;
        }
        if (!best || pen > best.pen) best = { nx, ny, pen };
    }
    return best;
}

// Knuffar ut en bil ur väggar. Returnerar krockhastigheten (0 = ingen krock).
export function collideVehicleWithMap(v, city) {
    let impact = 0;
    for (let iter = 0; iter < 3; iter++) {
        let any = false;
        for (const c of vehicleCircles(v)) {
            const hit = deepestTileContact(c.x, c.y, c.r, city);
            if (!hit) continue;
            any = true;
            v.x += hit.nx * hit.pen;
            v.y += hit.ny * hit.pen;
            const vn = v.vx * hit.nx + v.vy * hit.ny;
            if (vn < 0) {
                const e = 0.3;
                v.vx -= (1 + e) * vn * hit.nx;
                v.vy -= (1 + e) * vn * hit.ny;
                // Friktion längs väggen
                v.vx *= 0.92; v.vy *= 0.92;
                // Spinn när man tar i med fronten eller bakdelen
                const torque = (c.ox * hit.ny - c.oy * hit.nx) * -vn;
                v.spin = clamp(v.spin + torque * 0.00012 / v.spec.mass, -6, 6);
                impact = Math.max(impact, -vn);
            }
        }
        if (!any) break;
    }
    return impact;
}

export function stepVehicle(v, ctl, dt, city) {
    const s = v.spec;
    if (v.wrecked || !ctl) ctl = NO_INPUT;
    const health = v.hp / v.maxHp;
    const perf = health < 0.25 ? 0.72 : 1;
    const nitro = ctl.nitro ? 1 : 0;
    const maxF = s.maxSpeed * perf * (nitro ? 1.3 : 1);

    // Styrning beror på farten (stillastående bil kan inte svänga)
    let fx = Math.cos(v.angle), fy = Math.sin(v.angle);
    const fwd0 = v.vx * fx + v.vy * fy;
    const speedFactor = Math.min(1, Math.abs(fwd0) / 140);
    const topDamp = 1 - 0.35 * Math.min(1, Math.abs(fwd0) / s.maxSpeed);
    let turn = ctl.steer * s.turn * speedFactor * topDamp * (fwd0 >= 0 ? 1 : -1);
    if (ctl.handbrake) turn *= 1.5;
    v.angle += (turn + v.spin) * dt;
    v.spin *= Math.max(0, 1 - 5 * dt);
    if (v.angle > Math.PI) v.angle -= Math.PI * 2;
    else if (v.angle < -Math.PI) v.angle += Math.PI * 2;

    fx = Math.cos(v.angle); fy = Math.sin(v.angle);
    const rx = -fy, ry = fx;
    let fwd = v.vx * fx + v.vy * fy;
    let lat = v.vx * rx + v.vy * ry;

    const th = ctl.throttle;
    v.braking = false;
    if (th > 0) {
        if (fwd < -5) { fwd += s.brake * th * dt; v.braking = true; }
        else fwd += s.accel * (nitro ? 1.7 : 1) * th * dt;
    } else if (th < 0) {
        if (fwd > 5) { fwd += s.brake * th * dt; v.braking = true; }
        else fwd += s.accel * 0.55 * th * dt;
    } else {
        fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 90 * dt);
    }
    if (ctl.handbrake) { fwd -= Math.sign(fwd) * Math.min(Math.abs(fwd), 240 * dt); v.braking = true; }

    if (fwd > maxF) fwd = Math.max(maxF, fwd - 500 * dt);
    const maxRev = s.maxSpeed * 0.35;
    if (fwd < -maxRev) fwd = -maxRev;
    fwd *= 1 - 0.12 * dt;

    const latBefore = lat;
    const grip = ctl.handbrake ? 1.1 : s.grip;
    lat -= lat * Math.min(1, grip * dt);

    // Gräs bromsar
    const ground = tileAt(city, Math.floor(v.x / TILE), Math.floor(v.y / TILE));
    if (ground === T.GRASS) fwd *= 1 - 1.4 * dt;

    v.vx = fx * fwd + rx * lat;
    v.vy = fy * fwd + ry * lat;
    v.x += v.vx * dt;
    v.y += v.vy * dt;

    const impact = collideVehicleWithMap(v, city);
    const skid = Math.abs(latBefore) > 110 || (ctl.handbrake && Math.abs(fwd) > 140);
    return { impact, skid, speed: fwd };
}

// Skada från en krock med hastigheten `impact`
export function impactDamage(impact, armor = 1) {
    if (impact <= 140) return 0;
    return (impact - 140) * 0.12 / armor;
}

// Krock mellan två fordon. Returnerar krockhastigheten.
export function collideVehicles(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const reach = (a.spec.l + b.spec.l) / 2 + 4;
    if (dx * dx + dy * dy > reach * reach) return 0;
    let best = null;
    for (const ca of vehicleCircles(a)) for (const cb of vehicleCircles(b)) {
        const ex = cb.x - ca.x, ey = cb.y - ca.y;
        const d = Math.hypot(ex, ey);
        const r = ca.r + cb.r;
        if (d >= r) continue;
        const pen = r - d;
        if (!best || pen > best.pen) {
            best = d > 1e-6 ? { pen, nx: ex / d, ny: ey / d, ca, cb } : { pen, nx: 1, ny: 0, ca, cb };
        }
    }
    if (!best) return 0;
    const ma = a.spec.mass * (a.parked ? 1.5 : 1), mb = b.spec.mass * (b.parked ? 1.5 : 1);
    const tot = ma + mb;
    a.x -= best.nx * best.pen * (mb / tot); a.y -= best.ny * best.pen * (mb / tot);
    b.x += best.nx * best.pen * (ma / tot); b.y += best.ny * best.pen * (ma / tot);
    const rvn = (b.vx - a.vx) * best.nx + (b.vy - a.vy) * best.ny;
    if (rvn >= 0) return 0;
    const j = -(1 + 0.35) * rvn / (1 / ma + 1 / mb);
    a.vx -= j * best.nx / ma; a.vy -= j * best.ny / ma;
    b.vx += j * best.nx / mb; b.vy += j * best.ny / mb;
    a.spin = clamp(a.spin + (best.ca.ox * best.ny - best.ca.oy * best.nx) * j * 0.00008 / ma, -6, 6);
    b.spin = clamp(b.spin - (best.cb.ox * best.ny - best.cb.oy * best.nx) * j * 0.00008 / mb, -6, 6);
    a.parked = false; b.parked = false;
    return -rvn;
}

// Fotgängare/spelare till fots
export function collideCircleWithMap(e, r, city) {
    for (let iter = 0; iter < 3; iter++) {
        const hit = deepestTileContact(e.x, e.y, r, city);
        if (!hit) return;
        e.x += hit.nx * hit.pen;
        e.y += hit.ny * hit.pen;
        const vn = e.vx * hit.nx + e.vy * hit.ny;
        if (vn < 0) { e.vx -= vn * hit.nx; e.vy -= vn * hit.ny; }
    }
}

export function stepWalker(p, mx, my, speed, dt, city) {
    const len = Math.hypot(mx, my);
    if (len > 0.01) {
        p.vx = mx / len * speed;
        p.vy = my / len * speed;
        p.angle = Math.atan2(my, mx);
    } else {
        p.vx *= Math.max(0, 1 - 10 * dt);
        p.vy *= Math.max(0, 1 - 10 * dt);
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    collideCircleWithMap(p, p.r || 7, city);
}

// Avstånd från en punkt till bilens kaross (0 = inuti)
export function distToVehicle(v, x, y) {
    const c = Math.cos(v.angle), s = Math.sin(v.angle);
    const lx = (x - v.x) * c + (y - v.y) * s;
    const ly = -(x - v.x) * s + (y - v.y) * c;
    const qx = Math.max(Math.abs(lx) - v.spec.l / 2, 0);
    const qy = Math.max(Math.abs(ly) - v.spec.w / 2, 0);
    return Math.hypot(qx, qy);
}
