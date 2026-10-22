// ═══════════════════════════════════════════
//  STAN — verksamheterna lever (A)
//  Mehmets Kebab, Frisören på hörnet, Hustle Gym och Beat Studio.
//  Alla fyra har personal som jobbar och kunder som kommer, köar,
//  betalar, gör sitt ärende och går — hela tiden, även innan spelaren
//  köpt stället. Kunderna följer ett manus (en lista steg) och går via
//  en liten ruttplanerare mellan fasta platser: kö-platser, stolar,
//  maskiner. Allt är deterministiskt givet `rnd`.
//
//  Teckenförklaring för de egna möblerna (tillägg till LEGEND i interiors.js):
//    K grill   F kyl/automat   J frisörstol   Y löpbandskonsol
//    N bänkpress   H hantelställ   g glasvägg   L skåp
//  (Delade tecken: C disk, m bänk, h stol, t bord, S soffa, V soffbord,
//   D mixerbord, k högtalare, x växt, + glasdörr)
// ═══════════════════════════════════════════

import { registerInterior, updateInterior, KIT } from './interiors.js';

const {
    TS, PI, TAU, tc, rand, pick, clamp, SKINS, HAIRS, SHIRTS, SIGN_FONT, EMOJI_FONT,
    makeNpc, trySay, turnToward, chAt, solidTile, circleClear, nearestFreeSpot,
    tileHash, rgba, rr, disc, box, softShadow, neonText, neonLine, eachTile,
    wallPass, aoPass, slabGroup, plankFloor, carpetTile, plantAt, exitArrow, glassAt, glowSprite
} = KIT;

const BODY = 10; // hur nära möbler och väggar en gående kropp får komma (px)

// ═══════════════════════════════════════════
//  RUTTER — rutnätsrutter mellan fasta platser, utjämnade till raka sträckor
// ═══════════════════════════════════════════

const routeCache = new WeakMap();
const NEIGH = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, 1.4142], [1, -1, 1.4142], [-1, 1, 1.4142], [-1, -1, 1.4142]];

function nearSolid(def, tx, ty) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && solidTile(def, tx + dx, ty + dy)) return true;
    return false;
}

// Billigaste vägen mellan två fria rutor (rutor intill möbler kostar lite extra, så folk håller sig i gångarna)
function tileRoute(def, sx, sy, gx, gy) {
    let cache = routeCache.get(def);
    if (!cache) routeCache.set(def, cache = new Map());
    const key = sx + ',' + sy + '>' + gx + ',' + gy;
    if (cache.has(key)) return cache.get(key);
    const W = def.w, N = def.w * def.h;
    const dist = new Float32Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N);
    const start = sy * W + sx, goal = gy * W + gx;
    dist[start] = 0;
    const open = [start];
    while (open.length) {
        let bi = 0;
        for (let i = 1; i < open.length; i++) if (dist[open[i]] < dist[open[bi]]) bi = i;
        const cur = open[bi]; open[bi] = open[open.length - 1]; open.pop();
        if (done[cur]) continue;
        done[cur] = 1;
        if (cur === goal) break;
        const cx = cur % W, cy = (cur / W) | 0;
        for (const [dx, dy, cost] of NEIGH) {
            const nx = cx + dx, ny = cy + dy;
            if (solidTile(def, nx, ny)) continue;
            if (dx && dy && (solidTile(def, cx + dx, cy) || solidTile(def, cx, cy + dy))) continue; // inga genvägar över hörn
            const ni = ny * W + nx, nd = dist[cur] + cost + (nearSolid(def, nx, ny) ? 0.6 : 0);
            if (nd < dist[ni]) { dist[ni] = nd; prev[ni] = cur; open.push(ni); }
        }
    }
    let route = null;
    if (done[goal]) {
        route = [];
        for (let c = goal; c !== -1; c = prev[c]) route.push([c % W, (c / W) | 0]);
        route.reverse();
    }
    cache.set(key, route);
    return route;
}

function lineClear(def, ax, ay, bx, by, r) {
    const n = Math.ceil(Math.hypot(bx - ax, by - ay) / 5);
    for (let i = 1; i <= n; i++) {
        const k = i / n;
        if (!circleClear(def, ax + (bx - ax) * k, ay + (by - ay) * k, r)) return false;
    }
    return true;
}

// Väg från (x0,y0) till (x1,y1) som en lista punkter (utan startpunkten)
export function findPath(def, x0, y0, x1, y1) {
    const tileOf = (x, y) => {
        let tx = Math.floor(x / TS), ty = Math.floor(y / TS);
        if (solidTile(def, tx, ty)) { const p = nearestFreeSpot(def, x, y); tx = Math.floor(p.x / TS); ty = Math.floor(p.y / TS); }
        return [tx, ty];
    };
    const [sx, sy] = tileOf(x0, y0), [gx, gy] = tileOf(x1, y1);
    if (sx === gx && sy === gy) return [{ x: x1, y: y1 }];
    const route = tileRoute(def, sx, sy, gx, gy);
    if (!route) return [{ x: x1, y: y1 }];
    const pts = [{ x: x0, y: y0 }];
    for (let i = 1; i < route.length - 1; i++) pts.push({ x: tc(route[i][0]), y: tc(route[i][1]) });
    pts.push({ x: x1, y: y1 });
    const out = [];
    let i = 0;
    while (i < pts.length - 1) {
        let j = pts.length - 1;
        while (j > i + 1 && !lineClear(def, pts[i].x, pts[i].y, pts[j].x, pts[j].y, BODY)) j--;
        out.push(pts[j]);
        i = j;
    }
    return out;
}

// ═══════════════════════════════════════════
//  RÖRELSE
// ═══════════════════════════════════════════

// Går längs n.mv.path. true när framme.
function walk(n, dt, speed) {
    const mv = n.mv;
    if (!mv) return true;
    const p = mv.path[mv.i];
    if (!p) { n.mv = null; return true; }
    const dx = p.x - n.x, dy = p.y - n.y, d = Math.hypot(dx, dy), m = speed * dt;
    n.pose = 'walk';
    if (d <= m + 0.01) {
        n.x = p.x; n.y = p.y; n.phase += d * 0.12; mv.i++;
        if (mv.i >= mv.path.length) { n.mv = null; return true; }
        return false;
    }
    n.x += dx / d * m; n.y += dy / d * m;
    turnToward(n, Math.atan2(dy, dx), dt * 10);
    n.phase += m * 0.12;
    return false;
}

// Gå till (x,y) (planerar om när målet byts). true när framme.
function goStep(n, st, dt, x, y, speed) {
    if (Math.hypot(n.x - x, n.y - y) < 1.2) { n.mv = null; return true; }
    const mv = n.mv;
    if (!mv || mv.tx !== x || mv.ty !== y) n.mv = { path: findPath(st.def, n.x, n.y, x, y), i: 0, tx: x, ty: y };
    const done = walk(n, dt, speed);
    if (!done) avoid(n, st, dt);
    return done;
}

// Mjuk knuff bort från de man går nära så att ingen går i varandra
function avoid(n, st, dt) {
    let px = 0, py = 0;
    for (const m of st.npcs) {
        if (m === n || m.gone) continue;
        const dx = n.x - m.x, dy = n.y - m.y, d2 = dx * dx + dy * dy;
        if (d2 > 0.01 && d2 < 20 * 20) { const d = Math.sqrt(d2), k = (20 - d) / 20; px += dx / d * k; py += dy / d * k; }
    }
    if (!px && !py) return;
    const nx = n.x + px * 60 * dt, ny = n.y + py * 60 * dt;
    if (circleClear(st.def, nx, ny, 8)) { n.x = nx; n.y = ny; }
}

// Glidning (in i en stol, ut ur den). true när framme.
function tween(n, dt, x, y, dur) {
    const c = n.c;
    let tw = c.tw;
    if (!tw) tw = c.tw = { x0: n.x, y0: n.y, t: 0 };
    tw.t += dt;
    const k = Math.min(1, tw.t / dur), e = k * k * (3 - 2 * k);
    n.x = tw.x0 + (x - tw.x0) * e; n.y = tw.y0 + (y - tw.y0) * e;
    if (k >= 1) { c.tw = null; return true; }
    return false;
}

// Står stilla: benen går tillbaka till neutral, blicken mot ett håll
function stand(n, dt, ang, pose = 'idle') {
    n.pose = pose;
    if (pose === 'idle') n.phase += (Math.round(n.phase / PI) * PI - n.phase) * Math.min(1, dt * 5);
    else n.phase += dt * (pose === 'cheer' ? 2 : 1.5);
    if (ang != null) turnToward(n, ang, dt * 6);
}

// ═══════════════════════════════════════════
//  VERKSAMHETEN — gemensam motor
//  R = { id, maxCust, gap, at, queues, pools, until, serving, script, staff, act, panicLines, lines }
// ═══════════════════════════════════════════

const CAPS = ['#111827', '#dc2626', '#1d4ed8', '#16a34a', '#f59e0b', '#475569', '#7c3aed'];
const DRESSES = ['#db2777', '#7c3aed', '#0891b2', '#ea580c', '#be123c', '#4f46e5', '#15803d'];

function custLook(rnd) {
    const look = { shirt: pick(rnd, SHIRTS), skin: pick(rnd, SKINS), hair: pick(rnd, HAIRS) };
    const r = rnd();
    if (r < 0.26) look.dress = pick(rnd, DRESSES);
    else if (r < 0.48) look.cap = pick(rnd, CAPS);
    return look;
}

function makeCustomer(R, st, rnd) {
    const d = st.def.door;
    const n = makeNpc('customer', d.x + rand(rnd, -5, 5), d.y, rnd, { angle: -PI / 2, pose: 'walk', beh: 'cust', look: custLook(rnd) });
    n.customer = true; n.item = null; n.act = null;
    n.c = { script: R.script(rnd), si: -1, s: null, hold: null, last: null, flee: false, seat: null, tw: null, speed: rand(rnd, 46, 58) };
    return n;
}

// Personal: går mellan sina platser (spots) som klubbens patrol, men med ruttplanering och rånpanik
function makeStaff(kind, spots, rnd, o = {}) {
    const first = spots[o.start || 0];
    const n = makeNpc(kind, first.x, first.y, rnd, { angle: first.a == null ? PI / 2 : first.a, pose: first.pose || 'idle', beh: 'staff', look: o.look });
    n.staff = Object.assign({
        spots, si: o.start || 0, dir: 1, order: o.order || 'rand', speed: o.speed || 38, watch: o.watch !== false,
        walking: false, wait: rand(rnd, 0.5, 3), turn: first.a == null ? PI / 2 : first.a, up: false, greeted: false, role: kind
    }, o.extra);
    if (o.lines) { n.lines = o.lines; n.chatT = rand(rnd, 5, 15); }
    return n;
}

function holder(st, key) {
    for (const m of st.npcs) if (m.c && m.c.hold === key && !m.gone) return m;
    return null;
}
function custs(st) { return st.npcs.filter(m => m.beh === 'cust' && !m.gone); }
// Den som just nu betalar vid kön q
function payer(st, q) {
    for (const m of st.npcs) { const s = m.c && m.c.s; if (s && s.k === 'queue' && s.q === q && s.ph === 2 && !m.gone && !m.c.flee) return m; }
    return null;
}

function nextSpot(s, rnd) {
    const len = s.spots.length;
    if (len < 2) return;
    if (s.order === 'seq') s.si = (s.si + 1) % len;
    else if (s.order === 'ping') {
        if (s.si + s.dir >= len || s.si + s.dir < 0) s.dir = -s.dir;
        s.si += s.dir;
    } else {
        let i = Math.min(len - 1, Math.floor(rnd() * len));
        if (i === s.si) i = (i + 1) % len;
        s.si = i;
    }
}

function stepStaff(R, n, st, dt, rnd) {
    const s = n.staff;
    // Rån: händerna upp, säg något, stå still
    if (st.panic > 0) {
        if (!s.up) {
            s.up = true; n.mv = null; s.walking = false; n.pose = 'cheer';
            n.say = { text: pick(rnd, R.panicLines), life: 2.8 };
        } else if (!n.say && rnd() < dt * 0.5) trySay(st, n, pick(rnd, R.panicLines), 2.2);
        n.phase += dt * 2.4;
        return true;
    }
    if (s.up) { s.up = false; n.pose = 'idle'; s.wait = rand(rnd, 0.5, 1.5); }
    if (R.act && R.act(n, st, dt, rnd, s)) return true;
    if (s.walking) {
        const sp = s.spots[s.si];
        if (goStep(n, st, dt, sp.x, sp.y, s.speed)) {
            s.walking = false;
            n.pose = sp.pose || 'idle';
            s.wait = sp.w ? rand(rnd, sp.w[0], sp.w[1]) : 2;
            s.turn = sp.a == null ? n.angle : sp.a;
        }
        return true;
    }
    // står stilla: andas, jobbar och tittar gärna på spelaren
    stand(n, dt, null, n.pose === 'walk' ? 'idle' : n.pose);
    let want = s.turn;
    const f = st.focus;
    if (f && s.watch && n.pose !== 'walk') {
        const fx = f.x - n.x, fy = f.y - n.y;
        if (fx * fx + fy * fy < 140 * 140) want = Math.atan2(fy, fx);
    }
    turnToward(n, want, dt * 6);
    s.wait -= dt;
    if (s.wait > 0) return true;
    for (let i = 0; i < s.spots.length; i++) {
        nextSpot(s, rnd);
        const sp = s.spots[s.si];
        if (Math.hypot(sp.x - n.x, sp.y - n.y) > 4) break;
    }
    s.walking = true; n.pose = 'walk';
    return true;
}

// ── Kundens manus ──
//  { k: 'queue', q }                 köa vid kön q, betala när det är ens tur
//  { k: 'go', to }                   gå till en namngiven punkt (R.at)
//  { k: 'stay', dur: [a,b], pose, face, item, tag }   stå en stund
//  { k: 'item', set }                ta/lämna ifrån sig en sak
//  { k: 'use', pool, dur, until, needs, full, fresh }  ta en ledig plats i poolen (stol, maskin, bås), använd den en stund
//  { k: 'leave' }                    ut genom dörren
function nextStep(c) {
    c.si++;
    c.s = Object.assign({ ph: 0 }, c.script[Math.min(c.si, c.script.length - 1)]);
}

function stepStay(R, n, st, dt, rnd, c, s) {
    if (s.ph === 0) {
        s.ph = 1; s.t = rand(rnd, s.dur[0], s.dur[1]);
        if (s.item !== undefined) n.item = s.item;
    }
    let face = s.face;
    if (s.look) face = Math.atan2(s.look.y - n.y, s.look.x - n.x);
    stand(n, dt, face == null ? n.angle : face, s.pose || 'idle');
    s.t -= dt;
    return s.t <= 0;
}

function stepQueue(R, n, st, dt, rnd, c, s) {
    const Q = R.queues[s.q];
    if (s.ph === 0) { s.ph = 1; s.seq = ++st.biz.seq; s.arrived = false; }
    let rank = 0;
    for (const m of st.npcs) {
        const ms = m.c && m.c.s;
        if (m !== n && !m.gone && !m.c.flee && ms && ms.k === 'queue' && ms.q === s.q && ms.ph >= 1 && ms.seq < s.seq) rank++;
    }
    const slot = Q.slots[Math.min(rank, Q.slots.length - 1)];
    if (s.ph === 1) {
        if (!goStep(n, st, dt, slot.x, slot.y, c.speed)) return false;
        stand(n, dt, Q.face);
        if (rank === 0) {
            s.ph = 2; s.t = rand(rnd, Q.pay[0], Q.pay[1]);
            if (rnd() < 0.5) trySay(st, n, pick(rnd, Q.orders), 2.4);
        }
        return false;
    }
    // vid kassan: betalar
    stand(n, dt, Q.face);
    s.t -= dt;
    if (s.t > 0) return false;
    st.events.push({ type: 'sale', x: st.def.counter.x, y: st.def.counter.y });
    n.paid = true;
    if (rnd() < 0.3) trySay(st, n, pick(rnd, Q.thanks), 1.8);
    return true;
}

function stepUse(R, n, st, dt, rnd, c, s) {
    const pool = R.pools[s.pool];
    let slot = s.i == null ? null : pool[s.i];
    if (s.ph === 0 || s.ph === 9) {
        if (s.ph === 9) { stand(n, dt, n.angle); if ((s.t -= dt) > 0) return false; s.ph = 0; }
        const free = [];
        for (let i = 0; i < pool.length; i++) {
            const key = s.pool + ':' + i;
            if (holder(st, key) || (s.fresh && c.last === key)) continue;
            free.push(i);
        }
        if (!free.length) {
            if (s.full === 'wait') { s.ph = 9; s.t = 0.6; return false; }
            if (s.full === 'leave') { c.si = c.script.length - 2; return true; }
            return true; // hoppa över
        }
        s.i = s.first ? free[0] : pick(rnd, free);
        slot = pool[s.i];
        c.hold = s.pool + ':' + s.i;
        s.ph = 1;
    }
    if (s.ph === 1) {
        const tx = slot.ax != null ? slot.ax : slot.x, ty = slot.ay != null ? slot.ay : slot.y;
        if (!goStep(n, st, dt, tx, ty, c.speed)) return false;
        if (slot.ax != null) { c.seat = { ax: slot.ax, ay: slot.ay }; s.ph = 2; } else s.ph = 3;
    }
    if (s.ph === 2) {
        n.pose = 'sit';
        turnToward(n, slot.ang, dt * 9);
        if (!tween(n, dt, slot.x, slot.y, 0.38)) return false;
        s.ph = 3;
    }
    if (s.ph === 3) {
        if (!s.started) {
            s.started = true; s.t = rand(rnd, s.dur[0], s.dur[1]); s.say = rand(rnd, 1.5, 4); s.pt = rand(rnd, 2, 4);
            n.pose = slot.pose; n.act = slot.act; n.useT = 0;
        }
        n.x = slot.x; n.y = slot.y;
        turnToward(n, slot.ang, dt * 8);
        n.phase += dt * (slot.rate || 1.6);
        n.useT += dt;
        if (slot.cycle) {   // t.ex. artisten växlar mellan att jubla och att lyssna
            if ((s.pt -= dt) <= 0) {
                n.pose = n.pose === slot.pose ? slot.cycle.pose : slot.pose;
                s.pt = rand(rnd, slot.cycle.dur[0], slot.cycle.dur[1]);
            }
        }
        if (!s.needs || R.serving(st, n, s)) s.t -= dt;
        const lines = slot.lines || (R.lines && R.lines[slot.act]);
        if (lines && (s.say -= dt) <= 0) { trySay(st, n, pick(rnd, lines), 2.4); s.say = rand(rnd, slot.sayGap ? slot.sayGap[0] : 4, slot.sayGap ? slot.sayGap[1] : 9); }
        if (s.t <= 0 && (!s.until || R.until[s.until](st, n, s))) s.ph = slot.ax != null ? 4 : 5;
        return false;
    }
    if (s.ph === 4) {
        n.pose = 'sit'; n.act = null;
        if (!tween(n, dt, slot.ax, slot.ay, 0.38)) return false;
        c.seat = null;
    }
    n.act = null; n.pose = 'idle';
    c.last = c.hold; c.hold = null; c.used = true;
    return true;
}

function stepLeave(R, n, st, dt, rnd, c, s) {
    const d = st.def.door;
    if (goStep(n, st, dt, d.x, d.y, c.speed)) n.gone = true;
    return false;
}

// Rån: spring till dörren (ut ur stolen först om man sitter)
function stepFlee(R, n, st, dt, rnd, c) {
    const d = st.def.door;
    if (c.seat) {
        n.pose = 'sit';
        if (tween(n, dt, c.seat.ax, c.seat.ay, 0.2)) { c.seat = null; n.pose = 'walk'; }
        return;
    }
    if (n.act) n.act = null;
    if (!n.say && rnd() < dt * 0.9) trySay(st, n, pick(rnd, R.fleeLines), 1.6);
    if (goStep(n, st, dt, d.x, d.y, 122)) n.gone = true;
}

function stepCust(R, n, st, dt, rnd) {
    const c = n.c;
    if (st.panic > 0 && !c.flee) {
        c.flee = true; c.hold = null; c.tw = null; n.mv = null; n.say = null;
        if (c.s && c.s.k === 'use' && c.s.ph >= 2 && c.s.ph <= 4) { /* sitter kvar tills de glidit ut */ }
    }
    if (c.flee) { stepFlee(R, n, st, dt, rnd, c); return; }
    for (let guard = 0; guard < 6; guard++) {
        if (!c.s) nextStep(c);
        const s = c.s;
        let done = false;
        switch (s.k) {
            case 'queue': done = stepQueue(R, n, st, dt, rnd, c, s); break;
            case 'use': done = stepUse(R, n, st, dt, rnd, c, s); break;
            case 'stay': done = stepStay(R, n, st, dt, rnd, c, s); break;
            case 'go': {
                const p = R.at[s.to];
                done = goStep(n, st, dt, p.x, p.y, c.speed);
                if (done && p.a != null) n.angle = p.a;
                break;
            }
            case 'item': if (!s.onlyIfUsed || c.used) n.item = s.set; done = true; break;
            default: stepLeave(R, n, st, dt, rnd, c, s); // 'leave'
        }
        if (!done) return;
        c.s = null;
        dt = 0; // nästa steg får börja direkt, men utan att gå en gång till samma bildruta
    }
}

function bizStep(R, n, st, dt, rnd) {
    if (n.beh === 'cust') { stepCust(R, n, st, dt, rnd); return true; }
    if (n.beh === 'staff') { stepStaff(R, n, st, dt, rnd); return true; }
    return false;
}

function bizUpdate(R, st, dt, rnd) {
    const b = st.biz || (st.biz = { spawnT: rand(rnd, 1.5, 4), seq: 0, owned: false });
    const npcs = st.npcs;
    for (let i = npcs.length - 1; i >= 0; i--) if (npcs[i].gone) npcs.splice(i, 1);
    // rånet tar slut
    if (st.panic > 0) st.panic = Math.max(0, st.panic - dt);
    // ny ägare: personalen hälsar en gång
    if (st.owned && !b.owned) {
        let all = true;
        for (const n of npcs) {
            if (n.beh !== 'staff' || n.staff.greeted) continue;
            const had = n.say;
            trySay(st, n, 'Välkommen, chefen!', 3);
            if (!had && n.say) n.staff.greeted = true; else all = false;
        }
        if (all) b.owned = true;
    } else if (!st.owned && b.owned) { b.owned = false; for (const n of npcs) if (n.staff) n.staff.greeted = false; }
    // nya kunder
    if (st.panic > 0 || !(st.flow > 0.001)) return;
    b.spawnT -= dt * st.flow;
    if (b.spawnT > 0) return;
    const d = st.def.door;
    let count = 0, blocked = false;
    for (const m of npcs) {
        if (m.beh === 'cust') count++;
        if (Math.hypot(m.x - d.x, m.y - d.y) < 26) blocked = true;
    }
    if (count >= R.maxCust || blocked || (R.canSpawn && !R.canSpawn(st))) { b.spawnT = 0.8; return; }
    npcs.push(makeCustomer(R, st, rnd));
    b.spawnT = rand(rnd, R.gap[0], R.gap[1]);
}

// Rummet är redan igång när man kommer in: personalen står på sina platser och
// några kunder är mitt i sina ärenden. Det löser vi genom att låta verksamheten
// gå en stund "i förväg" på ett eget, kasserat tillstånd.
function populate(R, def, rnd) {
    const npcs = R.staff(def, rnd);
    const st = { id: def.id, def, t: 0, npcs, focus: null, talking: 0, events: [], owned: false, flow: 2.4, panic: 0 };
    for (let i = 0; i < 400; i++) {
        updateInterior(st, 0.1, rnd);
        if (i >= 280 && custs(st).length >= 2) break;
    }
    for (const n of st.npcs) { n.say = null; if (n.chatT) n.chatT = rand(rnd, 6, 18); }
    return st.npcs;
}

function makeTheme(R, th) {
    return Object.assign({
        populate: (def, rnd) => populate(R, def, rnd),
        update: (st, dt, rnd) => bizUpdate(R, st, dt, rnd),
        step: (n, st, dt, rnd) => bizStep(R, n, st, dt, rnd)
    }, th);
}

// ── Små hjälpmedel för ritningen ──
const FONT = '"Space Grotesk", "Segoe UI", sans-serif';
function label(g, text, x, y, size, color, o = {}) {
    g.save();
    g.font = `${o.weight || 700} ${size}px ${o.font || FONT}`;
    g.textAlign = o.align || 'center'; g.textBaseline = 'middle'; g.fillStyle = color;
    if (o.rot) { g.translate(x, y); g.rotate(o.rot); g.fillText(text, 0, 0); } else g.fillText(text, x, y);
    g.restore();
}
// Handens läge i figurens koordinater (lx framåt, ly åt höger), samma som i klubbens accessory
function at(n, lx, ly, rot = n.angle) {
    const c = Math.cos(rot), s = Math.sin(rot);
    return { x: n.x + lx * c - ly * s, y: n.y + lx * s + ly * c, c, s };
}
// En arm från axeln till handen (för sittande saknar figuren händer)
function armTo(ctx, n, side, hx, hy) {
    const L = n.look || {}, sh = at(n, 0, side * 6);
    ctx.lineCap = 'round'; ctx.strokeStyle = L.dress || L.shirt || '#888'; ctx.lineWidth = 3.2;
    ctx.beginPath(); ctx.moveTo(sh.x, sh.y); ctx.lineTo(hx, hy); ctx.stroke(); ctx.lineCap = 'butt';
    ctx.fillStyle = L.skin || '#e0ac69'; ctx.beginPath(); ctx.arc(hx, hy, 2.3, 0, TAU); ctx.fill();
}

const ROOMS = new Map();
function room(R, def, theme) {
    R.id = def.id;
    ROOMS.set(def.id, R);
    registerInterior(def, makeTheme(R, theme));
}

// ═══════════════════════════════════════════
//  🥙 MEHMETS KEBAB
//  Kök bakom disken (grill med roterande dönerspett, friteringsbänk),
//  matsal med bord, dryckeskyl och en kö längs mitten. 18 × 14 rutor.
// ═══════════════════════════════════════════

const KEBAB_ROWS = [
    '##################', //  0  väggen bakom köket (skylt)
    '##################', //  1  döner, meny
    '##################', //  2
    '#.KKK.mmm.mm.....#', //  3  grill (K), skärbänk, friteringsbänk
    '#................#', //  4  köket
    '#................#', //  5
    '#CCCCCCCCCCCCCCCC#', //  6  disken med kassan på ruta 10
    '#x..............F#', //  7  dryckeskylen står mot högra väggen
    '#...............F#', //  8
    '#.hth........hth.#', //  9  bord och stolar
    '#................#', // 10
    '#.hth........hth.#', // 11
    '#x..............x#', // 12
    '########ee########'  // 13  ingång
];

const KEBAB = {
    id: 'kebab', name: 'Mehmets Kebab', theme: 'biz-kebab', w: 18, h: 14,
    rows: KEBAB_ROWS,
    legend: {
        K: { name: 'grill', solid: true },
        F: { name: 'kyl', solid: true }
    },
    spawn: { x: 288, y: tc(11) },
    exit: { x: 288, y: 13 * TS + 24, r: 22 },
    door: { x: 288, y: 13 * TS + 10 },
    counter: { x: tc(10), y: 7 * TS + 15 },
    interactions: [{ id: 'counter', label: 'E — Disken: köp stället, kassan, råna', x: 352, y: 7 * TS + 20, r: 62 }],
    music: null,
    zones: [{ x: 1, y: 3, w: 16, h: 3, kind: 'kitchen' }]
};

// Bord (3 rutor: stol, bord, stol): vänstra stolen nås från vänster, högra från höger
const KEBAB_SEATS = [];
for (const [tx, ty] of [[2, 9], [2, 11], [13, 9], [13, 11]]) {
    KEBAB_SEATS.push({ x: tc(tx), y: tc(ty), ax: tc(tx - 1), ay: tc(ty), ang: 0, pose: 'sit', act: 'eat', rate: 1.6 });
    KEBAB_SEATS.push({ x: tc(tx + 2), y: tc(ty), ax: tc(tx + 3), ay: tc(ty), ang: PI, pose: 'sit', act: 'eat', rate: 1.6 });
}

function kebabScript(rnd) {
    const s = [];
    if (rnd() < 0.35) s.push({ k: 'go', to: 'fridge' }, { k: 'stay', dur: [1, 2], face: 0, item: 'can' });
    s.push({ k: 'queue', q: 'main' });
    s.push({ k: 'go', to: 'pick' }, { k: 'stay', dur: [2.6, 5], face: -PI / 2, tag: 'food' }, { k: 'item', set: 'wrap' });
    if (rnd() < 0.68) s.push({ k: 'use', pool: 'tables', dur: [12, 22], full: 'skip' }, { k: 'item', set: null, onlyIfUsed: true });
    s.push({ k: 'leave' });
    return s;
}

// Kassören går till kassan när någon ska betala
function deskAct(qname, home) {
    return (n, st, dt, rnd, s) => {
        if (s.role !== 'cashier') return false;
        const p = payer(st, qname);
        if (!p) {
            if (s.atDesk) { s.atDesk = false; s.walking = false; s.wait = rand(rnd, 1, 3); }
            return false;
        }
        s.atDesk = true; s.walking = false;
        if (goStep(n, st, dt, home.x, home.y, 46)) stand(n, dt, Math.atan2(p.y - n.y, p.x - n.x), 'work');
        return true;
    };
}

const KEBAB_R = {
    maxCust: 7, gap: [4.5, 9],
    at: {
        fridge: { x: 15 * TS + 12, y: 8 * TS, a: 0 },
        pick: { x: 392, y: 7 * TS + 15, a: -PI / 2 }
    },
    queues: {
        main: {
            slots: [0, 1, 2, 3, 4].map(k => ({ x: tc(10) + (k % 2 ? 5 : -3), y: 7 * TS + 15 + k * 28 })),
            face: -PI / 2, pay: [2.4, 4.2],
            orders: ['En kebabrulle, tack!', 'Kebab med vitsås!', 'Falafel, tack!', 'Extra stark!', 'Två rullar!', 'Mycket sås!', 'Tallrik, tack!'],
            thanks: ['Tack!', 'Mums!', 'Tackar!']
        }
    },
    pools: { tables: KEBAB_SEATS },
    until: {},
    panicLines: ['Ta det lugnt!', 'Ta pengarna!', 'Skjut inte!', 'Ta kassan!'],
    fleeLines: ['Hjälp!', 'Spring!', 'Rån!', 'Aaah!'],
    script: kebabScript,
    staff(def, rnd) {
        const grill = { x: 112, y: 141, a: -PI / 2, pose: 'work', w: [5, 9], tool: 'knife' };
        const grill2 = { x: 138, y: 141, a: -PI / 2, pose: 'work', w: [4, 7], tool: 'knife' };
        const prep = { x: 240, y: 141, a: -PI / 2, pose: 'work', w: [4, 8], tool: 'chop' };
        const fry = { x: 358, y: 141, a: -PI / 2, pose: 'work', w: [3, 6] };
        const chat = { x: 176, y: 172, a: PI / 2, pose: 'idle', w: [3, 6] };
        const mehmet = makeStaff('cook', [grill, grill2, prep, fry, chat], rnd, {
            speed: 36, look: { shirt: '#f8fafc', skin: '#c68642', hair: '#111111', cap: '#dc2626' },
            lines: ['Ortens bästa kebab!', 'Vitsås på allt?', 'Extra stark, bror?', 'Färskt kött varje dag.', 'Mehmet fixar.'],
            extra: { prep }
        });
        const cash = { x: tc(10), y: 5 * TS + 13, a: PI / 2, pose: 'work', w: [3, 6] };
        const kassor = makeStaff('cashier', [cash, { x: 400, y: 172, a: PI / 2, pose: 'idle', w: [2, 5] }, { x: 272, y: 172, a: PI / 2, pose: 'idle', w: [2, 5] }], rnd, {
            speed: 34, look: { shirt: '#2563eb', skin: '#e0ac69', hair: '#3f2a14', dress: null },
            lines: ['Nästa, tack!', 'Vill du ha dryck?', 'Det blir fyrtio kronor.', 'Välkommen!']
        });
        kassor.look.dress = undefined;
        return [mehmet, kassor];
    },
    act: null
};
KEBAB_R.act = (() => {
    const desk = deskAct('main', { x: tc(10), y: 5 * TS + 13 });
    return (n, st, dt, rnd, s) => {
        if (desk(n, st, dt, rnd, s)) return true;
        if (s.role === 'cook') {
            // väntar någon på maten står Mehmet vid skärbänken
            const waiting = st.npcs.some(m => m.c && m.c.s && m.c.s.tag === 'food' && !m.gone && !m.c.flee);
            if (waiting) {
                s.walking = false; s.atPrep = true;
                if (goStep(n, st, dt, s.prep.x, s.prep.y, 40)) stand(n, dt, -PI / 2, 'work');
                s.si = 2;
                return true;
            }
            if (s.atPrep) { s.atPrep = false; s.wait = rand(rnd, 0.5, 2); }
        }
        return false;
    };
})();

// ── Kebabens statiska lager ──
const K_WALL = { wall: '#2a1810', face: '#4b2f20', hi: '#6e4730', line: '#120a06' };
const STEEL = { side: '#3b414a', top: '#aab2bd', hi: 'rgba(255,255,255,0.55)' };

function kebabFloor(g, def, tx, ty, ch) {
    const x = tx * TS, y = ty * TS, h = tileHash(tx, ty);
    if (ch === 'e') { box(g, x, y, TS, TS, '#3a2418'); return; }
    if (ty >= 3 && ty <= 5) {
        // köket: vitt och grått kakel
        for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) box(g, x + i * 16, y + j * 16, 16, 16, (i + j + tx + ty) & 1 ? '#d9d6cd' : '#cfccc2');
        g.strokeStyle = 'rgba(70,60,50,0.28)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x, y + 16.5); g.lineTo(x + TS, y + 16.5); g.moveTo(x + 16.5, y); g.lineTo(x + 16.5, y + TS); g.stroke();
        g.fillStyle = 'rgba(60,40,20,0.07)';
        if (h & 3) g.fillRect(x + (h % 24), y + ((h >> 6) % 24), 6, 3);
        return;
    }
    // matsalen: terrakottaplattor
    box(g, x, y, TS, TS, (tx + ty) & 1 ? '#a24f2f' : '#98482a');
    g.fillStyle = `rgba(255,200,150,${0.04 + (h % 5) * 0.012})`; g.fillRect(x + 2, y + 2, TS - 4, TS - 4);
    g.strokeStyle = 'rgba(40,18,8,0.55)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
    g.fillStyle = 'rgba(0,0,0,0.1)';
    for (let i = 0; i < 2; i++) { const r = tileHash(h, i); g.fillRect(x + 3 + (r % 24), y + 3 + ((r >> 8) % 24), 3, 2); }
}

// Pann med pålägg (sedd uppifrån)
function topping(g, x, y, w, h, kind) {
    box(g, x, y, w, h, '#8a929c'); box(g, x + 1, y + 1, w - 2, h - 2, '#cfd5dc');
    const ix = x + 2, iy = y + 2, iw = w - 4, ih = h - 4;
    const base = { sallad: '#3f9a3a', tomat: '#d83a2a', lök: '#efe6f2', kål: '#8a2f7a', gurka: '#6fae3a', chili: '#c92a1c' }[kind];
    box(g, ix, iy, iw, ih, base);
    for (let i = 0; i < 9; i++) {
        const r = tileHash(x + i * 7, y + kind.length);
        const px = ix + 1.5 + (r % Math.max(1, iw - 3)), py = iy + 1.5 + ((r >> 8) % Math.max(1, ih - 3));
        g.fillStyle = kind === 'tomat' ? '#f06a52' : kind === 'lök' ? '#ffffff' : kind === 'kål' ? '#c46bb4' : kind === 'sallad' ? '#6cc460' : kind === 'gurka' ? '#b6e06a' : '#ff7a5c';
        g.beginPath(); g.arc(px, py, 1.5, 0, TAU); g.fill();
    }
    box(g, ix, iy, iw, 1.2, 'rgba(255,255,255,0.3)');
}

function kebabBackWall(g, def) {
    const x0 = TS, x1 = 17 * TS, yb = 3 * TS - 10;
    // vitt kakel, 16 × 10 i förband
    box(g, x0, 0, x1 - x0, yb, '#eeeadf');
    g.fillStyle = 'rgba(70,60,45,0.16)';
    for (let r = 0; r * 10 < yb; r++) {
        g.fillRect(x0, r * 10 + 9, x1 - x0, 1);
        for (let x = x0 + (r & 1) * 8; x < x1; x += 16) g.fillRect(x, r * 10, 1, 10);
    }
    // turkiskt mönsterband
    const by = 60;
    box(g, x0, by, x1 - x0, 14, '#12355f');
    for (let x = x0; x < x1; x += 14) {
        const a = ((x - x0) / 14) & 1;
        g.fillStyle = a ? '#e8b923' : '#d6483a';
        g.beginPath(); g.moveTo(x + 7, by + 2); g.lineTo(x + 12, by + 7); g.lineTo(x + 7, by + 12); g.lineTo(x + 2, by + 7); g.closePath(); g.fill();
        disc(g, x + 7, by + 7, 1.6, '#12355f');
    }
    box(g, x0, by - 1.5, x1 - x0, 1.5, '#e8b923'); box(g, x0, by + 14, x1 - x0, 1.5, '#e8b923');
    // ventilationshuv över grillen
    box(g, 52, 0, 120, 21, '#8d95a0'); box(g, 52, 0, 120, 3, '#c3cad3'); box(g, 52, 19, 120, 3, '#59616c');
    for (let i = 0; i < 6; i++) box(g, 58 + i * 19, 6, 12, 9, '#4f5762');
    // dönermaskinens värmepaneler och spett (själva köttet ritas i dyn)
    for (const cx of [88, 138]) {
        box(g, cx - 19, 24, 38, 62, '#2b2f36'); box(g, cx - 19, 24, 38, 2.5, '#6f7782');
        for (let i = 0; i < 4; i++) box(g, cx - 14 + i * 9, 32, 5, 50, '#4a2018');
        box(g, cx - 1, 20, 2, 66, '#c5ccd5');
        box(g, cx - 5, 17, 10, 7, '#59616c'); box(g, cx - 3, 18, 6, 2, '#aeb6c0');
        // dropplåt
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(cx + 1, 87, 17, 5, 0, 0, TAU); g.fill();
        g.fillStyle = '#7e8791'; g.beginPath(); g.ellipse(cx, 85, 17, 5, 0, 0, TAU); g.fill();
        g.fillStyle = '#4b535d'; g.beginPath(); g.ellipse(cx, 85, 14, 3.4, 0, 0, TAU); g.fill();
    }
    // hylla med tallrikar och kryddburkar
    const sx = 182, sy = 48;
    box(g, sx, sy + 8, 96, 4, '#6b4a2a'); box(g, sx, sy + 8, 96, 1.2, '#9a7344');
    for (let i = 0; i < 4; i++) { box(g, sx + 6 + i * 22, sy - 8, 14, 16, '#f7f3ea'); box(g, sx + 6 + i * 22, sy - 8, 14, 1.5, '#fff'); box(g, sx + 6 + i * 22, sy + 3, 14, 1.5, '#d6483a'); }
    box(g, sx, sy - 24, 96, 3, '#6b4a2a');
    ['#b45309', '#a16207', '#7c2d12', '#15803d', '#b91c1c', '#ca8a04'].forEach((c, i) => { box(g, sx + 5 + i * 15, sy - 36, 10, 12, c); box(g, sx + 5 + i * 15, sy - 36, 10, 3, '#e5e7eb'); box(g, sx + 7 + i * 15, sy - 31, 6, 4, 'rgba(255,255,255,0.7)'); });
    // klocka
    disc(g, 304, 24, 9, '#3b2a1a'); disc(g, 304, 24, 7.6, '#f8f4e8');
    g.strokeStyle = '#222'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(304, 24); g.lineTo(304, 19); g.moveTo(304, 24); g.lineTo(308, 25); g.stroke();
    // menytavlan
    const mx = 324, my = 30, mw = 208, mh = 56;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(mx + 2, my + 3, mw, mh);
    box(g, mx, my, mw, mh, '#7a5226'); box(g, mx + 2, my + 2, mw - 4, mh - 4, '#16110d');
    box(g, mx + 2, my + 2, mw - 4, 1, 'rgba(255,255,255,0.25)');
    label(g, 'MENY', mx + mw / 2, my + 9, 9, '#ffd23f', { font: SIGN_FONT, weight: 400 });
    box(g, mx + 8, my + 15, mw - 16, 1, 'rgba(255,210,63,0.5)');
    const items = [['KEBABRULLE', '85:-'], ['KEBAB TALLRIK', '99:-'], ['KYCKLINGRULLE', '85:-'], ['FALAFELRULLE', '79:-'], ['POMMES', '35:-'], ['LÄSK', '20:-']];
    items.forEach(([nm, pr], i) => {
        const cx = mx + 8 + (i % 2) * 100, cy = my + 23 + ((i / 2) | 0) * 10;
        label(g, nm, cx, cy, 6.4, '#f8f4e8', { align: 'left' });
        label(g, pr, cx + 88, cy, 6.6, '#ffd23f', { align: 'right' });
    });
    label(g, '+ riktig vitsås +', mx + mw / 2, my + mh - 6.5, 6.2, '#ff7a6a');
    // skylt
    g.fillStyle = 'rgba(10,6,4,0.9)'; rr(g, 150, 2, 276, 24, 6); g.fill();
    g.strokeStyle = 'rgba(255,170,40,0.85)'; g.lineWidth = 1.3; rr(g, 151, 3, 274, 22, 5); g.stroke();
    // wallPass ritar väggens framkant under det här: lägg tillbaka den
    box(g, TS, 3 * TS - 10, 16 * TS, 10, K_WALL.face); box(g, TS, 3 * TS - 10, 16 * TS, 1, K_WALL.hi); box(g, TS, 3 * TS - 2, 16 * TS, 2, K_WALL.line);
}

function kebabKitchen(g, def) {
    // grillbänken (rad 3, x 2..4): stålbänk med plåt för stekyta
    slabGroup(g, def, 'K', { side: '#2b2f36', top: '#7f8893', hi: 'rgba(255,255,255,0.45)', ins: 2 });
    box(g, 3 * TS + 5, 3 * TS + 6, 22, 20, '#23262b'); box(g, 3 * TS + 5, 3 * TS + 6, 22, 1.5, 'rgba(255,255,255,0.25)');
    for (const [dx, dy, c] of [[9, 12, '#a0522d'], [16, 17, '#8b4513'], [13, 21, '#b9672f'], [21, 11, '#8b4513']]) {
        g.fillStyle = c; rr(g, 3 * TS + dx - 3, 3 * TS + dy - 2, 6, 4, 1.5); g.fill();
    }
    box(g, 2 * TS + 4, 3 * TS + 8, 10, 14, '#c9d0d8'); box(g, 2 * TS + 5, 3 * TS + 9, 8, 12, '#e8ecf0');
    // skärbänk och friteringsbänk
    slabGroup(g, def, 'm', STEEL);
    box(g, 6 * TS + 5, 3 * TS + 5, 22, 22, '#d3a768'); box(g, 6 * TS + 5, 3 * TS + 5, 22, 1.5, 'rgba(255,255,255,0.4)');
    g.fillStyle = '#2f7d32'; g.beginPath(); g.ellipse(7 * TS + 16, 3 * TS + 15, 8, 6, 0.2, 0, TAU); g.fill();
    disc(g, 7 * TS + 12, 3 * TS + 13, 2.6, '#d83a2a'); disc(g, 7 * TS + 20, 3 * TS + 17, 2.6, '#d83a2a'); disc(g, 7 * TS + 16, 3 * TS + 20, 2, '#f3ecd0');
    box(g, 8 * TS + 8, 3 * TS + 9, 16, 4, '#9aa3ad'); box(g, 8 * TS + 22, 3 * TS + 8, 6, 6, '#4b2f20');
    // fritös: två korgar med olja
    for (let i = 0; i < 2; i++) {
        const fx = (10 + i) * TS + 4;
        box(g, fx, 3 * TS + 5, 24, 22, '#2b2f36'); box(g, fx + 2, 3 * TS + 7, 20, 18, '#d19a2a');
        g.fillStyle = 'rgba(255,240,170,0.5)'; g.fillRect(fx + 3, 3 * TS + 8, 8, 2);
        g.strokeStyle = '#1a1c20'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(fx + 6, 3 * TS + 14); g.lineTo(fx + 18, 3 * TS + 14); g.stroke();
    }
    // kökshandduk och mjölsäck i hörnet
    box(g, 14 * TS + 6, 3 * TS + 6, 18, 20, '#c9a46a'); box(g, 14 * TS + 6, 3 * TS + 6, 18, 2, '#e1c18c'); label(g, 'MJÖL', 14 * TS + 15, 3 * TS + 17, 5, '#6b4a2a');
    box(g, 16 * TS + 2, 3 * TS + 8, 10, 14, '#3b82c4'); box(g, 16 * TS + 2, 3 * TS + 8, 10, 3, '#9ccaf0');
}

function kebabCounter(g, def) {
    slabGroup(g, def, 'C', { side: '#3d2415', top: '#d7d2c4', hi: 'rgba(255,255,255,0.65)', ins: 3 });
    const y = 6 * TS;
    // pålägg i pannor (längs vänstra halvan)
    ['sallad', 'tomat', 'lök', 'kål', 'gurka', 'chili'].forEach((k, i) => topping(g, TS + 7 + i * 26, y + 6, 24, 20, k));
    // kassa
    const rx = 10 * TS;
    box(g, rx + 4, y + 6, 24, 20, '#1b2230'); box(g, rx + 6, y + 7, 20, 8, '#86efac'); box(g, rx + 6, y + 7, 20, 2, 'rgba(255,255,255,0.45)');
    for (let i = 0; i < 4; i++) for (let j = 0; j < 2; j++) box(g, rx + 7 + i * 5, y + 17 + j * 4, 3.5, 3, '#5b6577');
    // klocka där maten lämnas ut, och foliepaket
    disc(g, 12 * TS + 22, y + 16, 5.4, '#cfd5dc'); disc(g, 12 * TS + 22, y + 15, 4, '#eef1f4'); disc(g, 12 * TS + 22, y + 11, 1.2, '#59616c');
    for (let i = 0; i < 4; i++) { box(g, 13 * TS + 4, y + 6 + i * 5, 18, 4, '#d8dce2'); box(g, 13 * TS + 4, y + 6 + i * 5, 18, 1, '#fff'); }
    // såser och servetter
    for (const [bx, c] of [[14 * TS + 24, '#d83a2a'], [15 * TS + 6, '#f6f1e2'], [15 * TS + 14, '#facc15']]) {
        softShadow(g, bx, y + 16, 3, 3, 0.3); disc(g, bx, y + 16, 3.2, c); disc(g, bx, y + 16, 1.4, 'rgba(255,255,255,0.7)');
    }
    box(g, 15 * TS + 18, y + 8, 10, 8, '#7a5226'); box(g, 15 * TS + 19, y + 9, 8, 6, '#f6f1e2');
    // kantlist framför disken
    box(g, TS, y + TS - 3, 16 * TS, 3, '#a8791f');
    // "Beställ här" på golvet vid kön
    label(g, 'BESTÄLL HÄR', 11 * TS - 4, 7 * TS + 30, 6, 'rgba(255,255,255,0.45)', { font: SIGN_FONT, weight: 400 });
}

function kebabDining(g, def) {
    // stolar
    eachTile(def, 'h', (tx, ty) => {
        const x = tx * TS, y = ty * TS, right = chAt(def, tx - 1, ty) === 't';
        softShadow(g, x + 16, y + 16, 12, 12, 0.3);
        box(g, x + 5, y + 6, 22, 20, '#3a2415'); box(g, x + 7, y + 8, 18, 16, '#b3261e'); box(g, x + 8, y + 9, 16, 3, 'rgba(255,255,255,0.18)');
        box(g, right ? x + 23 : x + 3, y + 6, 6, 20, '#2a190d'); box(g, right ? x + 23 : x + 3, y + 6, 6, 2, 'rgba(255,255,255,0.15)');
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(x + 5.5, y + 6.5, 21, 19);
    });
    // bord med rutig duk, ketchup, vitsås och servetter
    eachTile(def, 't', (tx, ty) => {
        const x = tx * TS, y = ty * TS, h = tileHash(tx, ty);
        softShadow(g, x + 16, y + 16, 15, 14, 0.35);
        box(g, x + 1, y + 2, 30, 28, '#4a2d18'); box(g, x + 2, y + 3, 28, 26, '#f4efe2');
        for (let i = 0; i < 7; i++) for (let j = 0; j < 7; j++) if ((i + j) & 1) box(g, x + 2 + i * 4, y + 3 + j * 3.7, 4, 3.7, 'rgba(196,40,28,0.45)');
        g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1; g.strokeRect(x + 1.5, y + 2.5, 29, 27);
        disc(g, x + 12, y + 11, 2.6, '#d83a2a'); disc(g, x + 12, y + 11, 1, '#fff'); disc(g, x + 19, y + 11, 2.6, '#f6f1e2'); disc(g, x + 19, y + 11, 1, '#facc15');
        box(g, x + 22, y + 19, 5, 5, '#cfd5dc');
        if (h & 1) { disc(g, x + 8, y + 22, 3.4, '#f4efe2'); disc(g, x + 8, y + 22, 2.4, '#e8dcc0'); }
    });
    // dryckeskylen (x 16, rad 7..8): mörk kåpa med glasfront mot rummet
    {
        const x = 16 * TS, y = 7 * TS;
        softShadow(g, x + 16, y + 32, 15, 31, 0.3);
        box(g, x, y, TS, 2 * TS, '#1f242b'); box(g, x + 2, y + 2, TS - 4, 2 * TS - 4, '#e8ecf0');
        box(g, x + 2, y + 2, TS - 4, 3, 'rgba(255,255,255,0.7)');
        box(g, x + 2, y + 2, 11, 2 * TS - 4, '#13202c'); // glasfronten ligger mot väst
        const cans = ['#d83a2a', '#2563eb', '#16a34a', '#f59e0b', '#9333ea', '#e5e7eb'];
        for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) {
            for (let k = 0; k < 3; k++) { const yy = y + 5 + r * 14 + k * 4; box(g, x + 3 + c * 4.5, yy, 4, 3.4, cans[(r * 3 + c + k) % cans.length]); }
        }
        box(g, x + 2, y + 2, 11, 2 * TS - 4, 'rgba(160,215,240,0.18)');
        g.fillStyle = 'rgba(255,255,255,0.2)'; g.beginPath(); g.moveTo(x + 3, y + 20); g.lineTo(x + 8, y + 3); g.lineTo(x + 11, y + 3); g.lineTo(x + 6, y + 20); g.fill();
        box(g, x + 14, y + 6, TS - 18, 3, '#d83a2a'); label(g, 'COLA', x + 23, y + 24, 6, '#d83a2a', { rot: -PI / 2 });
        neonLine(g, [[x + 1, y + 3], [x + 1, y + 2 * TS - 3]], '#7dd3fc', 1.8);
    }
}

function kebabDecor(g, def) {
    eachTile(def, 'x', (tx, ty) => plantAt(g, tc(tx), tc(ty), tileHash(tx, ty) % 7));
    // dörrmatta och entré
    const x = 8 * TS, y = 13 * TS;
    box(g, x, y, 2 * TS, TS, '#24160d');
    box(g, x + 2, y + 2, 2 * TS - 4, 14, '#6b1d14'); box(g, x + 2, y + 2, 2 * TS - 4, 1.5, '#e8b923'); box(g, x + 2, y + 15, 2 * TS - 4, 1.5, '#e8b923');
    label(g, 'VÄLKOMMEN', x + TS, y + 9, 6.2, '#f6e7b8', { font: SIGN_FONT, weight: 400 });
    box(g, x, y + 18, 2 * TS, 14, '#1b2747'); box(g, x, y + 28, 2 * TS, 4, '#2d4474');
    box(g, x - 3, y + 1, 5, 17, '#4b2a1a'); box(g, x + 2 * TS - 2, y + 1, 5, 17, '#4b2a1a');
    // skylt över dörren på insidan: öppet + slogan
    g.fillStyle = 'rgba(10,6,4,0.88)'; rr(g, 2 * TS + 8, 13 * TS + 5, 5 * TS + 8, 22, 5); g.fill();
    g.strokeStyle = 'rgba(255,170,40,0.7)'; g.lineWidth = 1; rr(g, 2 * TS + 9, 13 * TS + 6, 5 * TS + 6, 20, 4); g.stroke();
    label(g, 'ORTENS BÄSTA KEBAB', 4 * TS + 28, 13 * TS + 12, 6.4, '#ffd23f', { font: SIGN_FONT, weight: 400 });
    label(g, 'med riktig vitsås', 4 * TS + 28, 13 * TS + 21, 6.4, '#f6e7b8');
    // utgång och posters på sidoväggarna
    box(g, 11 * TS + 12, 13 * TS + 8, 42, 12, '#052e16'); box(g, 11 * TS + 12, 13 * TS + 8, 42, 12, 'rgba(34,197,94,0.25)');
    label(g, 'UTGÅNG', 11 * TS + 33, 13 * TS + 14.5, 7, '#4ade80', { font: SIGN_FONT, weight: 400 });
    // affisch: Bosporen
    const px = 14 * TS + 2, py = 13 * TS + 3;
    box(g, px, py, 26, 26, '#f3ead2'); box(g, px + 2, py + 2, 22, 22, '#5fa8d3'); box(g, px + 2, py + 15, 22, 9, '#1d4e89');
    disc(g, px + 18, py + 8, 3.4, '#ffd23f'); box(g, px + 6, py + 9, 2.6, 8, '#f3ead2'); box(g, px + 11, py + 7, 2.6, 10, '#f3ead2');
}

function paintKebab(g, def) {
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
        const ch = def.rows[ty][tx];
        if (ch !== '#') kebabFloor(g, def, tx, ty, ch);
    }
    wallPass(g, def, K_WALL);
    aoPass(g, def);
    kebabBackWall(g, def);
    kebabKitchen(g, def);
    kebabCounter(g, def);
    kebabDining(g, def);
    kebabDecor(g, def);
}
