// ═══════════════════════════════════════════
//  STAN — AI
//  Trafik som följer filerna, fotgängare som
//  kastar sig undan, snutar och gäng som jagar
//  dig via ett flödesfält över gatunätet.
// ═══════════════════════════════════════════

import { TILE, T, DX, DY, DIR_ANGLE, OPPOSITE, WALKABLE } from './constants.js';
import { tileAt, laneDirs, isSolidAt } from './map.js';
import { forwardSpeed } from './vehicles.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const center = t => t * TILE + TILE / 2;

export function angleDiff(a, b) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return d;
}

// Fri sikt mellan två punkter (inga hus emellan)
export function lineClear(city, x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.ceil(d / 24);
    for (let i = 1; i < n; i++) {
        const t = i / n;
        if (isSolidAt(city, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
}

// ── Filföljande trafik ──
export function initLaneAI(v, tx, ty, dir, rnd = Math.random) {
    v.ai = {
        mode: 'lane', tx: tx + DX[dir], ty: ty + DY[dir], dir,
        wait: 0, patience: 2.5 + rnd() * 3, ignoreT: 0, stuckT: 0, revT: 0,
        cruise: 150 + rnd() * 90, hornT: 0
    };
    v.angle = DIR_ANGLE[dir];
}

function chooseNextDir(city, tx, ty, dir, rnd) {
    const mask = laneDirs(city, tx, ty);
    const opts = [];
    for (let d = 0; d < 4; d++) {
        if (!(mask & (1 << d)) || d === OPPOSITE[dir]) continue;
        if (tileAt(city, tx + DX[d], ty + DY[d]) !== T.ROAD) continue;
        opts.push(d);
    }
    if (!opts.length) return -1;
    if (opts.includes(dir) && rnd() < 0.55) return dir;
    return opts[Math.floor(rnd() * opts.length)];
}

// Försök hitta tillbaka till en fil efter en krock
function reacquireLane(v, city) {
    const cx = Math.floor(v.x / TILE), cy = Math.floor(v.y / TILE);
    let best = null;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const tx = cx + dx, ty = cy + dy;
        const mask = laneDirs(city, tx, ty);
        if (!mask) continue;
        for (let d = 0; d < 4; d++) {
            if (!(mask & (1 << d))) continue;
            const score = Math.hypot(center(tx) - v.x, center(ty) - v.y) / TILE + Math.abs(angleDiff(v.angle, DIR_ANGLE[d])) * 1.5;
            if (!best || score < best.score) best = { tx, ty, d, score };
        }
    }
    if (!best) return false;
    v.ai.tx = best.tx; v.ai.ty = best.ty; v.ai.dir = best.d;
    return true;
}

// Något i vägen framför bilen?
function blockedAhead(v, world, ignoreCars) {
    const fx = Math.cos(v.angle), fy = Math.sin(v.angle);
    const fwd = Math.max(0, forwardSpeed(v));
    const look = v.spec.l / 2 + 22 + fwd * 0.35;
    const check = (x, y, halfW, extra) => {
        const dx = x - v.x, dy = y - v.y;
        const along = dx * fx + dy * fy;
        if (along <= 0 || along > look + extra) return false;
        const side = Math.abs(-dx * fy + dy * fx);
        return side < v.spec.w / 2 + halfW + 3;
    };
    const p = world.player;
    if (!p.vehicle && !p.dead && check(p.x, p.y, 7, 0)) return 'player';
    if (!ignoreCars) {
        for (const u of world.vehicles) {
            if (u === v || Math.abs(u.x - v.x) > look + 60 || Math.abs(u.y - v.y) > look + 60) continue;
            if (check(u.x, u.y, u.spec.w / 2, u.spec.l / 2)) return u.driver === 'player' ? 'player' : 'car';
        }
    }
    for (const ped of world.peds) {
        if (ped.down > 0) continue;
        if (Math.abs(ped.x - v.x) > look + 20 || Math.abs(ped.y - v.y) > look + 20) continue;
        if (check(ped.x, ped.y, 6, 0)) return 'ped';
    }
    return false;
}

export function laneControl(v, world, dt) {
    const ai = v.ai, city = world.city;
    const tx = center(ai.tx), ty = center(ai.ty);
    let dx = tx - v.x, dy = ty - v.y;
    let d = Math.hypot(dx, dy);
    if (d > TILE * 1.8) {
        if (!reacquireLane(v, city)) { ai.lost = true; return { throttle: 0, steer: 0, handbrake: true }; }
        ai.lost = false;
        dx = center(ai.tx) - v.x; dy = center(ai.ty) - v.y; d = Math.hypot(dx, dy);
    }
    const fx = Math.cos(v.angle), fy = Math.sin(v.angle);
    if (d < 16 || (d < 44 && dx * fx + dy * fy < 0)) {
        const nd = chooseNextDir(city, ai.tx, ai.ty, ai.dir, world.rnd);
        if (nd >= 0) { ai.dir = nd; ai.tx += DX[nd]; ai.ty += DY[nd]; }
    }
    const want = Math.atan2(center(ai.ty) - v.y, center(ai.tx) - v.x);
    const diff = angleDiff(v.angle, want);
    const steer = clamp(diff * 2.6, -1, 1);
    const fwd = forwardSpeed(v);
    let target = Math.abs(diff) > 0.45 ? Math.min(ai.cruise, 115) : ai.cruise;

    ai.ignoreT = Math.max(0, ai.ignoreT - dt);
    const block = blockedAhead(v, world, ai.ignoreT > 0);
    if (block) {
        ai.wait += dt;
        if (block === 'player' && ai.wait > 1.2 && ai.hornT <= 0) { world.sfxAt('horn', v.x, v.y, 0.7); ai.hornT = 2.5 + world.rnd() * 2; }
        if (block === 'car' && ai.wait > ai.patience) ai.ignoreT = 1.4; // tränga sig förbi
        target = 0;
    } else {
        ai.wait = Math.max(0, ai.wait - dt * 2);
    }
    ai.hornT -= dt;
    let throttle = 0;
    if (target === 0) throttle = fwd > 15 ? -1 : 0;
    else if (fwd < target - 10) throttle = 1;
    else if (fwd > target + 25) throttle = -0.5;
    return { throttle, steer, handbrake: false };
}

// ── Jakt (snut och fientliga gäng) ──
// flow: flödesfältet att följa (standard: mot spelaren; polisens sökning har ett eget mot
// platsen där de såg dig sist — de vet inte var du är nu)
function flowStep(world, tx, ty, flow = world.flow) {
    const f = flow;
    if (!f) return null;
    const W = world.city.w;
    let best = null, bd = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = tx + dx, ny = ty + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= world.city.h) continue;
        const v = f[ny * W + nx];
        if (v < 0) continue;
        if (dx && dy) {
            // Diagonalt bara om båda raka grannar är fria
            if (f[ty * W + nx] < 0 || f[ny * W + tx] < 0) continue;
        }
        const cost = v + (dx && dy ? 0.4 : 0);
        if (cost < bd) { bd = cost; best = [nx, ny]; }
    }
    return best;
}

// speedFactor: andel av bilens toppfart (polisen: fast per nivå, aldrig över 1 — ingen gummibandsfart).
// opts (polisen, police.js):
//   role: 'tail' bakom dig, 'flank' vid sidan av din väg (side ±1), 'cut' dit du är på väg (genskjutning)
//   keep: håll så här långt avstånd och matcha farten i stället för att ramma (nivå 1–2, trafikstopp)
//   goal + flow: kör till en punkt (sökningen: där de såg dig sist) längs ett eget flödesfält
//   gas: högsta gaspådrag (polisen gasar mildare på låga nivåer)
//   corner: högsta fart genom en sväng (låga nivåer: de kör försiktigt, inte som i en film)
export function chaseControl(v, world, dt, speedFactor = 1, opts = {}) {
    const ai = v.ai;
    const p = world.player;
    const pv = p.vehicle;
    const pvx = pv ? pv.vx : 0, pvy = pv ? pv.vy : 0;
    let tx, ty;
    if (opts.goal) { tx = opts.goal.x; ty = opts.goal.y; }
    else if (opts.role === 'cut') { tx = p.x + pvx * 1.1; ty = p.y + pvy * 1.1; }
    else if (opts.role === 'flank') {
        const sp = Math.hypot(pvx, pvy) || 1, side = opts.side || 1;
        tx = p.x + pvx * 0.5 - pvy / sp * 70 * side; ty = p.y + pvy * 0.5 + pvx / sp * 70 * side;
    } else { tx = p.x + pvx * 0.3; ty = p.y + pvy * 0.3; }
    let gx = tx, gy = ty;
    const dist = opts.goal ? Math.hypot(tx - v.x, ty - v.y) : Math.hypot(p.x - v.x, p.y - v.y);
    if (dist > 230 || !lineClear(world.city, v.x, v.y, tx, ty)) {
        const flow = opts.flow || world.flow;
        const cx = Math.floor(v.x / TILE), cy = Math.floor(v.y / TILE);
        const s1 = flowStep(world, cx, cy, flow);
        if (s1) {
            const s2 = flowStep(world, s1[0], s1[1], flow) || s1;
            gx = center(s2[0]); gy = center(s2[1]);
        }
    }
    const want = Math.atan2(gy - v.y, gx - v.x);
    const diff = angleDiff(v.angle, want);
    let steer = clamp(diff * 3, -1, 1);
    const fwd = forwardSpeed(v);
    let throttle = opts.gas ?? 1;
    if (Math.abs(diff) > 1.9 && fwd > 160) throttle = -0.6;
    if (opts.corner && Math.abs(diff) > 0.5 && fwd > opts.corner) throttle = -0.6;
    if (fwd > v.spec.maxSpeed * speedFactor) throttle = 0;
    if (!opts.goal) {
        // Boxa in en stillastående spelare: bromsa i tid så att de inte bara rammar
        const playerSlow = !pv || Math.hypot(pvx, pvy) < 40;
        const stopDist = 70 + (fwd > 0 ? fwd * fwd / (2 * v.spec.brake) : 0);
        if (playerSlow && dist < stopDist) throttle = fwd > 20 ? -1 : (dist > 70 ? 0.3 : 0);
        // Håll avstånd (ingen ramning): på väg ikapp och nära → bromsa så att farten matchar
        if (opts.keep && dist > 1) {
            const closing = ((v.vx - pvx) * (p.x - v.x) + (v.vy - pvy) * (p.y - v.y)) / dist;
            const need = opts.keep + (closing > 0 ? closing * closing / (2 * v.spec.brake) : 0);
            if (dist < need && closing > 0) throttle = fwd > 15 ? -1 : 0;
            else if (dist < opts.keep + 25 && throttle > 0) throttle = Math.min(throttle, 0.25);
        }
    }

    ai.stuckT = (throttle > 0 && Math.abs(fwd) < 25) ? ai.stuckT + dt : Math.max(0, ai.stuckT - dt);
    if (ai.stuckT > 1.1) { ai.revT = 0.9; ai.stuckT = 0; }
    if (ai.revT > 0) {
        ai.revT -= dt;
        return { throttle: -1, steer: -steer, handbrake: false };
    }
    return { throttle, steer, handbrake: Math.abs(diff) > 1.2 && fwd > 220 };
}

// ── Fotgängare ──
const SHIRTS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#a855f7', '#14b8a6', '#f8fafc', '#111827', '#ec4899'];
const SKINS = ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#a0522d'];
// Metrosexuella: pastell, slickat hår, solglasögon
const METRO_SHIRTS = ['#f9a8d4', '#a7f3d0', '#c4b5fd', '#fde68a', '#bae6fd', '#fecaca', '#f5f5f4'];
const METRO_HAIR = ['#d6b370', '#8b5a2b', '#e7d3a1', '#3f2a14'];

// type: 'civ' | 'gang' | 'metro'
export function createPed(x, y, rnd = Math.random, opts = {}) {
    const type = opts.type || (opts.gang ? 'gang' : 'civ');
    const metro = type === 'metro';
    const angle = rnd() * Math.PI * 2, dir = Math.floor(rnd() * 4), t = 1 + rnd() * 4;
    const speed = metro ? (opts.scooter ? 95 : 48) : 38 + rnd() * 24, phase = rnd() * 10;
    // Var femte vanlig människa tål en smäll och slår tillbaka (avgörs av fasen — inget extra slumptal)
    const tough = type === 'civ' && !opts.cop && phase < 2;
    // Reaktionstid när en bil kommer: 0,15–0,65 s. De långsamma står som fån i strålkastarljuset.
    const reflex = 0.15 + ((phase * 7.31) % 1) * 0.5;
    const hp = opts.hp || (type === 'gang' ? (opts.vest ? 40 : 30) : metro ? 12 : tough ? 34 : 15);
    return {
        ent: 'ped', type, x, y, vx: 0, vy: 0, r: 8, angle,
        dir, t, mode: 'walk', tough, reflex, alarm: 0,
        speed, down: 0, phase,
        shirt: opts.shirt || (metro ? METRO_SHIRTS[Math.floor(rnd() * METRO_SHIRTS.length)] : SHIRTS[Math.floor(rnd() * SHIRTS.length)]),
        skin: SKINS[Math.floor(rnd() * SKINS.length)],
        hair: metro ? METRO_HAIR[Math.floor(rnd() * METRO_HAIR.length)] : rnd() < 0.5 ? '#1f1300' : rnd() < 0.5 ? '#5b3a1a' : '#d4a017',
        gang: opts.gang || null, cop: !!opts.cop,
        vest: !!opts.vest, scooter: !!opts.scooter,
        hp, maxHp: hp,
        attack: !!opts.attack, attackT: opts.attackT || 0, targetPed: null, hitCd: 0,
        buyer: false, creepT: 0, boredT: 0, talkT: 2 + rnd() * 4, say: null
    };
}

const PED_OK = new Set([T.SIDEWALK, T.PLAZA, T.GRASS, T.LOT]);

// Gå mot en punkt: rakt om det är fri sikt, annars via flödesfältet (om det leder dit)
export function seek(ped, world, tx, ty, useFlow) {
    const dx = tx - ped.x, dy = ty - ped.y;
    const d = Math.hypot(dx, dy) || 1;
    if (!useFlow || d < 90 || lineClear(world.city, ped.x, ped.y, tx, ty)) return { mx: dx / d, my: dy / d };
    const step = flowStep(world, Math.floor(ped.x / TILE), Math.floor(ped.y / TILE));
    if (!step) return { mx: dx / d, my: dy / d };
    const sx = center(step[0]) - ped.x, sy = center(step[1]) - ped.y;
    const sd = Math.hypot(sx, sy) || 1;
    return { mx: sx / sd, my: sy / sd };
}

export function pedControl(ped, world, dt) {
    if (ped.down > 0) return { mx: 0, my: 0, speed: 0 };
    const p = world.player;

    // ── Slagsmål: opps och gängmedlemmar som gått till attack ──
    if (ped.attack) {
        const t = ped.targetPed;
        if (t && t.down <= 0 && world.peds.includes(t)) {
            const m = seek(ped, world, t.x, t.y, false);
            ped.angle = Math.atan2(m.my, m.mx);
            return Math.hypot(t.x - ped.x, t.y - ped.y) < 19 ? { mx: 0, my: 0, speed: 0 } : { ...m, speed: 150 };
        }
        ped.targetPed = null;
        if (!p.dead) {
            const dist = Math.hypot(p.x - ped.x, p.y - ped.y);
            ped.angle = Math.atan2(p.y - ped.y, p.x - ped.x);
            // Beväpnade stannar på skjutavstånd
            if (ped.gun && dist < 210 && lineClear(world.city, ped.x, ped.y, p.x, p.y)) return { mx: 0, my: 0, speed: 0 };
            const m = seek(ped, world, p.x, p.y, true);
            const reach = p.vehicle ? p.vehicle.spec.l / 2 + 6 : 18;
            return dist < reach ? { mx: 0, my: 0, speed: 0 } : { ...m, speed: ped.vest ? 140 : 150 };
        }
    }

    // Hot: bil som kommer mot en i fart
    let threat = null;
    for (const v of world.vehicles) {
        const dx = ped.x - v.x, dy = ped.y - v.y;
        if (Math.abs(dx) > 130 || Math.abs(dy) > 130) continue;
        const sp = Math.hypot(v.vx, v.vy);
        if (sp < 140) continue;
        if ((dx * v.vx + dy * v.vy) / sp > 0 && Math.hypot(dx, dy) < 120) { threat = v; break; }
    }
    if (threat) {
        // Alla hinner inte: först fryser man, sedan kastar man sig åt sidan
        ped.alarm = (ped.alarm || 0) + dt;
        if (ped.alarm < (ped.reflex ?? 0.3)) return { mx: 0, my: 0, speed: 0 };
        const sp = Math.hypot(threat.vx, threat.vy);
        let nx = -threat.vy / sp, ny = threat.vx / sp;
        if ((ped.x - threat.x) * nx + (ped.y - threat.y) * ny < 0) { nx = -nx; ny = -ny; }
        ped.mode = 'flee'; ped.t = 1.5;
        return { mx: nx, my: ny, speed: 125 };
    }
    ped.alarm = 0;
    ped.t -= dt;
    if (ped.mode === 'flee') {
        if (ped.t <= 0) { ped.mode = 'walk'; ped.t = 2; }
        return { mx: Math.cos(ped.angle), my: Math.sin(ped.angle), speed: 130 };
    }

    // ── Kund som kommer fram för att köpa ──
    if (ped.buyer && !p.dead) {
        const m = seek(ped, world, p.x, p.y, true);
        ped.angle = Math.atan2(m.my, m.mx);
        return { ...m, speed: 75 };
    }

    // ── Metrosexuella som smyger efter dig ──
    if (ped.type === 'metro') {
        ped.boredT = Math.max(0, ped.boredT - dt);
        const d = Math.hypot(p.x - ped.x, p.y - ped.y);
        const pv = p.vehicle;
        const interesting = !p.dead && d < 280 && (!pv || Math.hypot(pv.vx, pv.vy) < 120) && ped.boredT <= 0;
        if (interesting) {
            ped.creepT += dt;
            if (ped.creepT > 25) { ped.creepT = 0; ped.boredT = 30; }
            ped.angle = Math.atan2(p.y - ped.y, p.x - ped.x);
            if (d > 78) {
                // Håll sig en bit bakom, glid sakta närmare
                const m = seek(ped, world, p.x - Math.cos(ped.angle) * 60, p.y - Math.sin(ped.angle) * 60, true);
                return { ...m, speed: ped.scooter ? 90 : 52 };
            }
            return { mx: 0, my: 0, speed: 0 };
        }
    }

    const tx = Math.floor(ped.x / TILE), ty = Math.floor(ped.y / TILE);
    const ahead = tileAt(world.city, Math.floor((ped.x + DX[ped.dir] * 20) / TILE), Math.floor((ped.y + DY[ped.dir] * 20) / TILE));
    if (ped.t <= 0 || !PED_OK.has(ahead)) {
        const opts = [];
        for (let d = 0; d < 4; d++) if (PED_OK.has(tileAt(world.city, tx + DX[d], ty + DY[d]))) opts.push(d);
        // Ibland går de över gatan
        if (!opts.length || world.rnd() < 0.04) {
            for (let d = 0; d < 4; d++) if (WALKABLE.has(tileAt(world.city, tx + DX[d], ty + DY[d]))) opts.push(d);
        }
        if (opts.length) ped.dir = opts[Math.floor(world.rnd() * opts.length)];
        ped.t = 2 + world.rnd() * 5;
    }
    return { mx: DX[ped.dir], my: DY[ped.dir], speed: ped.speed };
}
