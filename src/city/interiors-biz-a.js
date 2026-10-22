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
    for (let i = 0; i < route.length; i++) pts.push({ x: tc(route[i][0]), y: tc(route[i][1]) });
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

// Gå till (x,y) (planerar om när målet byts eller när man knuffats så att nästa sträcka skär ett hörn). true när framme.
function goStep(n, st, dt, x, y, speed) {
    if (Math.hypot(n.x - x, n.y - y) < 1.2) { n.mv = null; return true; }
    let mv = n.mv;
    if (!mv || mv.tx !== x || mv.ty !== y) mv = n.mv = { path: findPath(st.def, n.x, n.y, x, y), i: 0, tx: x, ty: y, cd: 0.25 };
    else if ((mv.cd -= dt) <= 0) {
        mv.cd = 0.25;
        const p = mv.path[mv.i];
        if (p && !lineClear(st.def, n.x, n.y, p.x, p.y, 8)) mv = n.mv = { path: findPath(st.def, n.x, n.y, x, y), i: 0, tx: x, ty: y, cd: 0.25 };
    }
    const done = walk(n, dt, speed);
    if (!done) avoid(n, st, dt);
    return done;
}

// Mjuk knuff åt sidan bort från de man går nära så att ingen går rakt i varandra. Aldrig framåt/bakåt (då kan
// två som möts i en smal gång fastna): går det inte att väja går man bara förbi varandra.
function avoid(n, st, dt) {
    const mv = n.mv, p = mv && mv.path[mv.i];
    if (!p) return;
    const hl = Math.hypot(p.x - n.x, p.y - n.y);
    if (hl < 0.5) return;
    const hx = (p.x - n.x) / hl, hy = (p.y - n.y) / hl;
    let px = 0, py = 0;
    for (const m of st.npcs) {
        if (m === n || m.gone) continue;
        const dx = n.x - m.x, dy = n.y - m.y, d2 = dx * dx + dy * dy;
        if (d2 > 0.01 && d2 < 20 * 20) { const d = Math.sqrt(d2), k = (20 - d) / 20; px += dx / d * k; py += dy / d * k; }
    }
    const along = px * hx + py * hy;
    px -= along * hx; py -= along * hy;
    if (!px && !py) return;
    const nx = n.x + px * 40 * dt, ny = n.y + py * 40 * dt;
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

// Räknas med i köer, på platser och i maxantalet: inte borta, inte i slagsmål (n.brawl) och inte på väg ut efter ett
function live(m) { return !m.gone && !m.brawl && !m.leaving; }
function holder(st, key) {
    for (const m of st.npcs) if (m.c && m.c.hold === key && live(m)) return m;
    return null;
}
function custs(st) { return st.npcs.filter(m => m.beh === 'cust' && !m.gone && !m.brawl); }
// Den som just nu betalar vid kön q
function payer(st, q) {
    for (const m of st.npcs) { const s = m.c && m.c.s; if (s && s.k === 'queue' && s.q === q && s.ph === 2 && live(m) && !m.c.flee) return m; }
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
        if (m !== n && live(m) && ms && !m.c.flee && ms.k === 'queue' && ms.q === s.q && ms.ph >= 1 && ms.seq < s.seq) rank++;
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
        if (s.ph === 0 && s.skipIf && R.until[s.skipIf](st, n, s)) return true;
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
            s.started = true; s.since = st.t; s.t = rand(rnd, s.dur[0], s.dur[1]); s.say = rand(rnd, 1.5, 4); s.pt = rand(rnd, 2, 4);
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

// Spelets slagsmål är över (n.brawl nollställt, n.leaving satt): tillbaka till dörren som en vanlig gående, även personalen
function stepLeaving(R, n, st, dt) {
    const d = st.def.door;
    if (n.c) { n.c.hold = null; n.c.seat = null; n.c.tw = null; n.c.flee = false; }
    n.act = null;
    if (goStep(n, st, dt, d.x, d.y, n.c ? n.c.speed : 52)) n.gone = true;
}

function bizStep(R, n, st, dt, rnd) {
    if (n.brawl) return true;               // slagsmål sköts av spelet: rör inte
    if (n.leaving) { stepLeaving(R, n, st, dt); return true; }
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
            if (n.beh !== 'staff' || n.staff.greeted || n.brawl || n.leaving) continue;
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
        if (m.brawl) continue;
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
export const bizRooms = ROOMS; // för tester: rummens platser, köer och manus
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
            speed: 34, look: { shirt: '#2563eb', skin: '#e0ac69', hair: '#3f2a14' },
            lines: ['Nästa, tack!', 'Vill du ha dryck?', 'Det blir fyrtio kronor.', 'Välkommen!']
        });
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
            const waiting = st.npcs.some(m => m.c && m.c.s && m.c.s.tag === 'food' && live(m) && !m.c.flee);
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
    neonText(g, 'MEHMETS KEBAB', 288, 14.5, 16, '#ffd23f', '#ff6a00');
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
    // gummimattor framför bänkarna, golvbrunn, pitalådor, skurhink och soptunna
    for (const [mx, mw] of [[2 * TS - 2, 3 * TS + 8], [6 * TS, 3 * TS], [10 * TS, 2 * TS + 8]]) {
        box(g, mx, 4 * TS + 2, mw, 14, '#2a2d33'); box(g, mx, 4 * TS + 2, mw, 1.5, 'rgba(255,255,255,0.18)');
        g.fillStyle = 'rgba(255,255,255,0.08)'; for (let x = mx + 4; x < mx + mw - 4; x += 8) g.fillRect(x, 4 * TS + 5, 4, 8);
    }
    box(g, 8 * TS + 10, 5 * TS + 8, 12, 12, '#8d95a0'); for (let i = 0; i < 3; i++) box(g, 8 * TS + 12, 5 * TS + 10 + i * 3.4, 8, 1.4, '#3b414a');
    for (const [cx, cy] of [[15 * TS, 4 * TS + 4], [15 * TS + 2, 5 * TS + 8]]) {
        box(g, cx + 2, cy + 2, 28, 20, 'rgba(0,0,0,0.25)'); box(g, cx, cy, 28, 20, '#b8814a'); box(g, cx, cy, 28, 3, '#d9a566');
        box(g, cx + 4, cy + 7, 20, 7, '#f3ead2'); label(g, 'PITA', cx + 14, cy + 10.6, 5, '#7a4a1a');
    }
    disc(g, 1 * TS + 16, 5 * TS + 16, 9, '#3b82c4'); disc(g, 1 * TS + 16, 5 * TS + 16, 7, '#9ccaf0'); disc(g, 1 * TS + 16, 5 * TS + 16, 4.4, '#5aa0d8');
    disc(g, 5 * TS - 4, 5 * TS + 14, 10, '#2d3138'); disc(g, 5 * TS - 4, 5 * TS + 14, 8, '#40454d'); disc(g, 5 * TS - 4, 5 * TS + 14, 3, '#23262b');
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

// ── Kebabens rörliga lager ──
// Roterande dönerspett sett från sidan: koniskt kött i skivor med glänsande reflexer som vandrar
function doner(ctx, cx, t, speed, rTop, rBot, pal) {
    const y0 = 29, n = 13, sh = 4.1, th = t * speed * 1.5;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cx - rTop, y0); ctx.lineTo(cx + rTop, y0); ctx.lineTo(cx + rBot, y0 + n * sh); ctx.lineTo(cx - rBot, y0 + n * sh); ctx.closePath();
    ctx.clip();
    for (let j = 0; j < n; j++) {
        const k = j / (n - 1), r = rTop + (rBot - rTop) * k + Math.sin(j * 1.9) * 1.1, y = y0 + j * sh;
        ctx.fillStyle = pal[(tileHash(j, rTop | 0) >> 3) % pal.length];
        ctx.fillRect(cx - r - 1, y, r * 2 + 2, sh + 0.4);
        // ytan snurrar: ljusa och mörka kornlinjer vandrar över sidan
        for (let i = 0; i < 4; i++) {
            const a = th + j * 0.5 + i * 1.57, vis = Math.cos(a);
            if (vis < 0) continue;
            ctx.fillStyle = i & 1 ? 'rgba(255,225,170,0.30)' : 'rgba(40,12,4,0.30)';
            ctx.fillRect(cx + Math.sin(a) * r * 0.92 - 1, y, 2.2 * vis + 0.5, sh);
        }
        ctx.fillStyle = 'rgba(60,20,6,0.28)'; ctx.fillRect(cx - r, y + sh - 1, r * 2, 1);
    }
    // cylindrisk skuggning och glans
    const gr = ctx.createLinearGradient(cx - rTop, 0, cx + rTop, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(0.28, 'rgba(255,255,255,0.14)'); gr.addColorStop(0.5, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.55)');
    ctx.fillStyle = gr; ctx.fillRect(cx - rTop - 1, y0, rTop * 2 + 2, n * sh);
    ctx.restore();
    // toppen med knoppen
    ctx.fillStyle = pal[0]; ctx.beginPath(); ctx.ellipse(cx, y0, rTop, 2.6, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,230,180,0.35)'; ctx.beginPath(); ctx.ellipse(cx - 2, y0 - 0.4, rTop * 0.55, 1.2, 0, 0, TAU); ctx.fill();
    // fettdroppe som glider ned
    const dy = (t * 26 + cx) % 58;
    ctx.fillStyle = 'rgba(255,214,120,0.85)'; ctx.beginPath(); ctx.arc(cx + Math.sin(cx + Math.floor(t * 26 / 58) * 3) * rBot * 0.6, y0 + 6 + dy, 1.1, 0, TAU); ctx.fill();
}
const BEEF = ['#8a4a2b', '#9c5732', '#7a3d22', '#a4623a', '#6f3620'];
const CHICKEN = ['#c98d4f', '#d9a45e', '#b9783d', '#e0b374', '#c28246'];

function dynKebab(ctx, st, v, t) {
    const def = st.def;
    // värmeelement
    for (const cx of [88, 138]) {
        for (let i = 0; i < 4; i++) {
            ctx.fillStyle = rgba('#ff6a1a', 0.5 + 0.2 * Math.sin(t * 3 + i * 1.3 + cx));
            ctx.fillRect(cx - 14 + i * 9, 34, 5, 46);
            ctx.fillStyle = 'rgba(255,230,160,0.35)'; ctx.fillRect(cx - 13 + i * 9, 34, 1.4, 46);
        }
    }
    doner(ctx, 88, t, 1.0, 15, 6, BEEF);
    doner(ctx, 138, t, 1.25, 11, 5, CHICKEN);
    // ånga från stekplåten och fritösen
    for (const [sx, sy] of [[3 * TS + 16, 3 * TS + 8], [10 * TS + 16, 3 * TS + 6], [11 * TS + 16, 3 * TS + 6]]) {
        for (let i = 0; i < 3; i++) {
            const k = ((t * 0.45 + i / 3 + sx * 0.013) % 1);
            ctx.globalAlpha = (1 - k) * 0.22;
            ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(sx + Math.sin(k * 6 + i) * 4, sy - k * 26, 2 + k * 4, 0, TAU); ctx.fill();
        }
    }
    ctx.globalAlpha = 1;
    // kassaskärmen blinkar till
    if (Math.floor(t * 2) % 5 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(10 * TS + 6, 6 * TS + 7, 20, 8); }
    // menytavlans kant tänds i takt
    for (let i = 0; i < 26; i++) {
        if ((i + Math.floor(t * 5)) % 4) continue;
        const px = 324 + 4 + i * 8, py = i < 13 ? 31.5 : 85.5;
        ctx.fillStyle = '#fff1b8'; ctx.beginPath(); ctx.arc(px % 208 + 324, py, 1.2, 0, TAU); ctx.fill();
    }
    exitArrow(ctx, def, t);
}

// ── Saker i händerna och verktyg (alla rum) ──
function drawWrap(ctx, x, y, rot, s = 1) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.scale(s, s);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; rr(ctx, -6, -2.2, 13, 6, 3); ctx.fill();
    ctx.fillStyle = '#d6dae0'; rr(ctx, -6.5, -3, 12, 6, 2.8); ctx.fill();            // foliepappret
    ctx.fillStyle = '#eecf8c'; rr(ctx, 1.5, -2.6, 5.4, 5.2, 2.4); ctx.fill();         // pitabröd
    ctx.fillStyle = '#7bbf4a'; ctx.fillRect(5, -1.8, 2, 1.6);                           // sallad
    ctx.fillStyle = '#d83a2a'; ctx.fillRect(5.2, 0.4, 1.8, 1.4);                        // tomat
    ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(-5.5, -2.6, 6, 1);
    ctx.restore();
}
function drawCan(ctx, x, y, col = '#d83a2a') {
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(x + 0.8, y + 1, 2.8, 0, TAU); ctx.fill();
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, 2.7, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e5e7eb'; ctx.beginPath(); ctx.arc(x, y, 1.6, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(x - 0.4, y - 0.8, 0.8, 1.6);
}

// Verktyg för personalen. spot.tool: 'knife' (skär dönern), 'chop' (hackar), 'scissors', 'clipper', ...
function staffTool(ctx, n, t) {
    const sp = n.staff.spots[n.staff.si];
    let tool = n.pose === 'work' ? (n.staff.tool || (sp && sp.tool)) : null;
    if (n.kind === 'cook' && n.staff.atPrep) tool = 'chop';
    if (!tool) return;
    if (tool === 'knife' || tool === 'chop') {
        const fast = tool === 'chop';
        const sw = fast ? Math.abs(Math.sin(t * 13 + n.phase)) : Math.abs(Math.sin(t * 2.6 + n.phase));
        const reach = (fast ? 11 : 9) + (fast ? 3 : 8) * sw, p = at(n, reach, 5.6);
        const a = n.angle + (fast ? 0.15 : -0.5 + 0.5 * sw);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a);
        ctx.fillStyle = '#2a2018'; ctx.fillRect(-4, -1.3, 5, 2.6);
        ctx.fillStyle = '#dfe5ec'; ctx.beginPath(); ctx.moveTo(1, -1.7); ctx.lineTo(15, -0.6); ctx.lineTo(15, 1); ctx.lineTo(1, 1.7); ctx.closePath(); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.8)'; ctx.fillRect(2, -1.2, 11, 0.7);
        ctx.restore();
        // skivor som faller ned i brickan
        if (!fast) {
            ctx.fillStyle = '#9c5732';
            for (let i = 0; i < 3; i++) {
                const k = (t * 1.3 + i / 3) % 1;
                ctx.globalAlpha = 1 - k; ctx.fillRect(p.x + Math.cos(n.angle) * 12 + (i - 1) * 3, p.y + Math.sin(n.angle) * 12 - 2 + k * 9, 2.2, 1.4);
            }
            ctx.globalAlpha = 1;
        }
    }
}

function itemOf(ctx, n, t) {
    const L = n.look || {};
    if (n.pose === 'sit') {
        // sittande saknar händer i renderaren: en arm och en hand om maten
        if (n.act === 'eat' && n.item === 'wrap') {
            const bite = Math.max(0, Math.sin(t * 2.4 + n.phase * 0.5));
            const p = at(n, 9 - bite * 4.5, 4 - bite * 2);
            armTo(ctx, n, 1, p.x, p.y);
            drawWrap(ctx, p.x + Math.cos(n.angle) * 2, p.y + Math.sin(n.angle) * 2, n.angle - 0.3 + bite * 0.2);
        }
        return;
    }
    if (n.item === 'wrap') {
        const p = at(n, 10.5, 7);
        armTo(ctx, n, 1, p.x, p.y);
        drawWrap(ctx, p.x + Math.cos(n.angle) * 3, p.y + Math.sin(n.angle) * 3, n.angle - 0.35);
    } else if (n.item === 'can') {
        const p = at(n, 9, 8);
        armTo(ctx, n, 1, p.x, p.y);
        drawCan(ctx, p.x, p.y);
    }
}

function accessoryA(ctx, n, t) {
    if (n.staff) staffTool(ctx, n, t);
    if (n.item || n.act) itemOf(ctx, n, t);
}

function lightsKebab(ctx, st, v, t, glow) {
    // grillen ger ett varmt sken som andas
    glow(112, 108, 84, '#ff8a2a', 0.2 + 0.07 * Math.sin(t * 2.3));
    glow(360, 112, 52, '#ffb347', 0.12 + 0.04 * Math.sin(t * 7));
}

registerKebab();
function registerKebab() {
    room(KEBAB_R, KEBAB, {
        paint: paintKebab, dyn: dynKebab, accessory: accessoryA, lights: lightsKebab,
        glows: [
            [288, 14, 160, '#ff7a1a', 0.3, 0],
            [416, 60, 120, '#ffd36a', 0.16, 0],
            [528, 256, 72, '#7dd3fc', 0.22, 2.2],
            [112, 300, 130, '#ffb45a', 0.1, 0],
            [112, 330, 130, '#ffb45a', 0.1, 0],
            [464, 300, 130, '#ffb45a', 0.1, 0],
            [464, 340, 130, '#ffb45a', 0.1, 0],
            [288, 426, 70, '#22c55e', 0.12, 3.2]
        ]
    });
}

// ═══════════════════════════════════════════
//  Gemensamma möbler
// ═══════════════════════════════════════════

// Soffa: ryggen mot väggen om det finns en, annars mot ändan
function sofaPaint(g, def, pal) {
    eachTile(def, 'S', (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        const wl = chAt(def, tx - 1, ty) === '#', wr = chAt(def, tx + 1, ty) === '#', wt = chAt(def, tx, ty - 1) === '#', wb = chAt(def, tx, ty + 1) === '#';
        softShadow(g, x + 16, y + 16, 15, 15, 0.3);
        box(g, x, y, TS, TS, pal.base);
        const l = wl ? 10 : 2, r = wr ? 10 : 2, t = wt ? 10 : 2, b = wb ? 10 : 2;
        g.fillStyle = pal.seat; rr(g, x + l, y + t, TS - l - r, TS - t - b, 4); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.13)'; rr(g, x + l + 2, y + t + 2, TS - l - r - 4, 5, 2); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; rr(g, x + l, y + t, TS - l - r, TS - t - b, 4); g.stroke();
        g.fillStyle = pal.back;
        if (wt) g.fillRect(x, y, TS, 10); if (wb) g.fillRect(x, y + TS - 10, TS, 10);
        if (wl) g.fillRect(x, y, 10, TS); if (wr) g.fillRect(x + TS - 10, y, 10, TS);
        g.fillStyle = 'rgba(255,255,255,0.14)';
        if (wt) g.fillRect(x, y, TS, 1.5); if (wr) g.fillRect(x + TS - 1.5, y, 1.5, TS);
        // sömmar mellan sittplatserna
        g.strokeStyle = 'rgba(0,0,0,0.3)';
        if (chAt(def, tx + 1, ty) === 'S') { g.beginPath(); g.moveTo(x + TS - 0.5, y + t); g.lineTo(x + TS - 0.5, y + TS - b); g.stroke(); }
        if (chAt(def, tx, ty + 1) === 'S') { g.beginPath(); g.moveTo(x + l, y + TS - 0.5); g.lineTo(x + TS - r, y + TS - 0.5); g.stroke(); }
    });
}

// Soffbord
function coffeeTable(g, def, o) {
    slabGroup(g, def, 'V', { side: o.side, top: o.top, hi: 'rgba(255,255,255,0.3)', ins: 2 });
}

// Den vanliga utgångsskylten
function exitSign(g, x, y) {
    box(g, x, y, 42, 12, '#052e16'); box(g, x, y, 42, 12, 'rgba(34,197,94,0.25)');
    label(g, 'UTGÅNG', x + 21, y + 6.5, 7, '#4ade80', { font: SIGN_FONT, weight: 400 });
}

// Framkant på en vägg som just målats över (wallPass ritar den under)
function wallLip(g, x0, x1, ty, pal) {
    box(g, x0, ty * TS - 10, x1 - x0, 10, pal.face); box(g, x0, ty * TS - 10, x1 - x0, 1, pal.hi); box(g, x0, ty * TS - 2, x1 - x0, 2, pal.line);
}

// ═══════════════════════════════════════════
//  💈 FRISÖREN PÅ HÖRNET
//  Tre frisörstolar framför speglar, väntsoffor, kassan i hörnet.
//  18 × 13 rutor.
// ═══════════════════════════════════════════

const BARBER_ROWS = [
    '##################', //  0  skylt
    '##################', //  1  speglar
    '##################', //  2
    '#.mmm..mmm..mmm.x#', //  3  verktygsbänkar under speglarna
    '#..J....J....J...#', //  4  frisörstolarna (J)
    '#x...............#', //  5  frisörerna står bakom stolarna
    '#................#', //  6
    '#S...............#', //  7  väntsoffa längs vänstra väggen
    '#S...............#', //  8
    '#S.V........CCCCC#', //  9  soffbord, kassadisken
    '#...........C....#', // 10  kassören står i hörnet bakom disken
    '#.SSS.......C....#', // 11  mer soffa
    '########ee########'  // 12  ingång
];

const BARBER = {
    id: 'barber', name: 'Frisören på hörnet', theme: 'biz-barber', w: 18, h: 13,
    rows: BARBER_ROWS,
    legend: { J: { name: 'frisörstol', solid: true } },
    spawn: { x: 288, y: tc(10) },
    exit: { x: 288, y: 12 * TS + 24, r: 22 },
    door: { x: 288, y: 12 * TS + 10 },
    counter: { x: tc(14), y: 8 * TS + 15 },
    interactions: [{ id: 'counter', label: 'E — Disken: köp stället, kassan, råna', x: 432, y: 8 * TS + 20, r: 62 }],
    music: null,
    zones: [{ x: 1, y: 7, w: 5, h: 5, kind: 'rug' }, { x: 13, y: 10, w: 4, h: 2, kind: 'desk' }]
};

const CHAIRS = [3, 8, 13];
const BARBER_SEATS = [
    // soffan på vänsterkanten (blick österut) och den längs nedre väggen (blick norrut)
    ...[7, 8, 9].map(ty => ({ x: tc(1), y: tc(ty), ax: tc(2), ay: tc(ty), ang: 0, pose: 'sit', act: 'read', rate: 1.2 })),
    ...[2, 3, 4].map(tx => ({ x: tc(tx), y: tc(11), ax: tc(tx), ay: tc(10), ang: -PI / 2, pose: 'sit', act: 'read', rate: 1.2 }))
];
const BARBER_CHAIRS = CHAIRS.map((cx, i) => ({ x: tc(cx), y: tc(4), ax: tc(cx + 1), ay: tc(4), ang: -PI / 2, pose: 'sit', act: 'cut', rate: 1.2, i }));

function barberScript(rnd) {
    return [
        { k: 'use', pool: 'sofa', dur: [1.5, 4], until: 'chairFree', skipIf: 'chairFree', full: 'skip' },
        { k: 'use', pool: 'chair', dur: [13, 21], needs: true, full: 'wait' },
        { k: 'queue', q: 'main' },
        { k: 'leave' }
    ];
}

function chairsFree(st) { let f = 0; for (let i = 0; i < BARBER_CHAIRS.length; i++) if (!holder(st, 'chair:' + i)) f++; return f; }

const BARBER_R = {
    maxCust: 7, gap: [5, 10],
    at: {},
    queues: {
        main: {
            slots: [0, 1, 2, 3, 4].map(k => ({ x: tc(14) - k * 36, y: 8 * TS + 15 + (k % 2 ? 3 : -2) })),
            face: PI / 2, pay: [2.4, 4],
            orders: ['Hur mycket blir det?', 'Swish går bra?', 'Tack, grymt!', 'Fräscht, bram!'],
            thanks: ['Tack!', 'Vi ses!', 'Grymt jobbat!']
        }
    },
    pools: { sofa: BARBER_SEATS, chair: BARBER_CHAIRS },
    until: {
        // någon får ta en ledig stol först när de som väntat längre fått sin
        chairFree(st, n) {
            const free = chairsFree(st);
            let ahead = 0;
            for (const m of st.npcs) {
                const ms = m.c && m.c.s;
                if (m === n || !live(m) || !ms || ms.k !== 'use' || ms.pool !== 'sofa' || ms.ph < 1 || m.c.flee) continue;
                const mine = n.c && n.c.s && n.c.s.since;
                if (mine == null || (ms.since != null && ms.since < mine)) ahead++;
            }
            return free > ahead;
        }
    },
    serving: (st, n, s) => st.npcs.some(m => m.staff && live(m) && m.staff.chair === s.i && m.staff.atWork),
    lines: { read: ['Hmm, nästa blir jag.', 'Ska ha en fade.', 'Fin frisyr, bram.'], cut: ['Lite kortare på sidorna.', 'Perfekt!', 'Skägget också.', 'Snyggt, bram!'] },
    panicLines: ['Ta det lugnt!', 'Ta pengarna!', 'Jag har familj!', 'Ta kassan!'],
    fleeLines: ['Hjälp!', 'Spring!', 'Rån!', 'Aaah!'],
    script: barberScript,
    staff(def, rnd) {
        const looks = [
            { shirt: '#111827', skin: '#c68642', hair: '#111111', cap: '#111827' },
            { shirt: '#f8fafc', skin: '#e0ac69', hair: '#3f2a14' },
            { shirt: '#7f1d1d', skin: '#8d5524', hair: '#111111' }
        ];
        const out = [];
        CHAIRS.forEach((cx, i) => {
            const x = tc(cx);
            const spots = [
                { x, y: 5 * TS + 12, a: -PI / 2, pose: 'idle', w: [5, 10] },
                { x: x - 34, y: 4 * TS + 16, a: -PI / 2, pose: 'work', w: [3, 6], tool: 'comb' },
                { x: x + 40, y: 5 * TS + 14, a: PI / 2, pose: 'idle', w: [3, 6] }
            ];
            const b = makeStaff('barber', spots, rnd, {
                speed: 36, look: looks[i], order: 'ping',
                lines: ['Fade eller klassiskt?', 'Skägget också?', 'Lite gel?', 'Nästa, tack!', 'Bram, vi fixar det.'],
                extra: { chair: i, work: { x: x + (i % 2 ? -8 : 8), y: 5 * TS + 11 }, atWork: false }
            });
            out.push(b);
        });
        const kassor = makeStaff('cashier', [
            { x: tc(14), y: 10 * TS + 15, a: -PI / 2, pose: 'work', w: [3, 6] },
            { x: tc(16), y: 10 * TS + 15, a: -PI / 2, pose: 'idle', w: [2, 5] }
        ], rnd, { speed: 30, look: { shirt: '#a21caf', skin: '#f1c27d', hair: '#7c2d12', dress: '#a21caf' }, lines: ['Betalning, tack!', 'Swish eller kort?', 'Välkommen!'] });
        out.push(kassor);
        return out;
    },
    act: null
};
BARBER_R.act = (() => {
    const desk = deskAct('main', { x: tc(14), y: 10 * TS + 15 });
    return (n, st, dt, rnd, s) => {
        if (desk(n, st, dt, rnd, s)) return true;
        if (s.role !== 'barber') return false;
        const cust = holder(st, 'chair:' + s.chair);
        const ready = cust && cust.c.s && cust.c.s.k === 'use' && cust.c.s.ph === 3;
        if (!ready) {
            if (s.atWork) { s.atWork = false; s.walking = false; s.wait = rand(rnd, 1.5, 3.5); n.pose = 'idle'; }
            return false;
        }
        s.walking = false;
        if (goStep(n, st, dt, s.work.x, s.work.y, 44)) {
            s.atWork = true;
            stand(n, dt, -PI / 2, 'work');
            s.t = (s.t || 0) + dt;
        } else s.atWork = false;
        return true;
    };
})();

// ── Frisörens statiska lager ──
const B_WALL = { wall: '#15213a', face: '#2a4068', hi: '#43629c', line: '#080d1a' };

function barberFloor(g, def, tx, ty, ch) {
    const x = tx * TS, y = ty * TS, zone = KIT.zoneAt(def, tx, ty);
    if (ch === 'e') { box(g, x, y, TS, TS, '#1a1a1f'); return; }
    if (zone === 'desk') {
        box(g, x, y, TS, TS, '#3b2a1d'); g.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 4; i++) g.fillRect(x, y + i * 8, TS, 1);
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + 7, TS, 1); g.fillRect(x, y + 23, TS, 1);
        return;
    }
    if (zone === 'rug') {
        box(g, x, y, TS, TS, '#1d3557');
        g.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 4; i++) g.fillRect(x, y + i * 8, TS, 1);
        g.strokeStyle = 'rgba(232,185,35,0.55)'; g.lineWidth = 1.2;
        const l = KIT.zoneAt(def, tx - 1, ty) !== 'rug', r = KIT.zoneAt(def, tx + 1, ty) !== 'rug', t = KIT.zoneAt(def, tx, ty - 1) !== 'rug', b = KIT.zoneAt(def, tx, ty + 1) !== 'rug';
        g.beginPath();
        if (l) { g.moveTo(x + 3, y); g.lineTo(x + 3, y + TS); } if (r) { g.moveTo(x + TS - 3, y); g.lineTo(x + TS - 3, y + TS); }
        if (t) { g.moveTo(x, y + 3); g.lineTo(x + TS, y + 3); } if (b) { g.moveTo(x, y + TS - 3); g.lineTo(x + TS, y + TS - 3); }
        g.stroke();
        return;
    }
    // svartvitt rutgolv, 16 px rutor
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) box(g, x + i * 16, y + j * 16, 16, 16, (i + j + tx + ty) & 1 ? '#1c1d22' : '#e8e5dc');
    g.fillStyle = 'rgba(255,255,255,0.05)'; g.beginPath(); g.moveTo(x + 4, y + TS); g.lineTo(x + 18, y); g.lineTo(x + 24, y); g.lineTo(x + 10, y + TS); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
}

function mirrorAt(g, cx, y, w, h) {
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(cx - w / 2 + 2, y + 3, w, h);
    box(g, cx - w / 2, y, w, h, '#a87a2e'); box(g, cx - w / 2, y, w, 2, '#e1b559'); box(g, cx - w / 2, y + h - 2, w, 2, '#6e4d18');
    const gx = cx - w / 2 + 4, gy = y + 4, gw = w - 8, gh = h - 8;
    const gr = g.createLinearGradient(gx, gy, gx, gy + gh);
    gr.addColorStop(0, '#9fb7c9'); gr.addColorStop(0.55, '#6f8aa0'); gr.addColorStop(1, '#4a647c');
    g.fillStyle = gr; g.fillRect(gx, gy, gw, gh);
    // skarpa reflexer och facetterad kant
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.beginPath(); g.moveTo(gx + 8, gy + gh); g.lineTo(gx + 30, gy); g.lineTo(gx + 44, gy); g.lineTo(gx + 22, gy + gh); g.fill();
    g.beginPath(); g.moveTo(gx + 52, gy + gh); g.lineTo(gx + 62, gy); g.lineTo(gx + 67, gy); g.lineTo(gx + 57, gy + gh); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 1; g.strokeRect(gx + 0.5, gy + 0.5, gw - 1, gh - 1);
    // lampor i ramen
    for (let i = 0; i < 8; i++) { const bx = cx - w / 2 + 6 + i * ((w - 12) / 7); disc(g, bx, y + 2, 1.6, '#fff4c2'); }
}

function barberTopWall(g) {
    const yb = 3 * TS - 10;
    // panel under spegelhöjd
    box(g, TS, 0, 16 * TS, yb, '#15213a');
    for (let i = 0; i < 32; i++) box(g, TS + i * 16, 0, 1, yb, 'rgba(255,255,255,0.025)');
    // wainscot i valnöt
    box(g, TS, 72, 16 * TS, 14, '#5b3a1f'); box(g, TS, 72, 16 * TS, 2, '#8a5f33'); box(g, TS, 84, 16 * TS, 2, '#2d1b0c');
    // skylt
    g.fillStyle = 'rgba(6,8,18,0.92)'; rr(g, 148, 3, 280, 24, 6); g.fill();
    g.strokeStyle = 'rgba(255,70,100,0.85)'; g.lineWidth = 1.3; rr(g, 149, 4, 278, 22, 5); g.stroke();
    neonText(g, 'FRISÖREN PÅ HÖRNET', 288, 15, 15, '#ffd0d8', '#ff2d55');
    // sax-ikoner
    for (const sx of [128, 448]) {
        g.save(); g.translate(sx, 15); g.strokeStyle = '#dbe4ee'; g.lineWidth = 1.6; g.lineCap = 'round';
        g.beginPath(); g.moveTo(-7, -6); g.lineTo(6, 6); g.moveTo(-7, 6); g.lineTo(6, -6); g.stroke();
        g.strokeStyle = '#ff2d55'; g.beginPath(); g.arc(-8, -7, 2.4, 0, TAU); g.moveTo(-5.6, 7); g.arc(-8, 7, 2.4, 0, TAU); g.stroke();
        g.restore();
    }
    label(g, 'Fade · skägg · allt du behöver, bram', 288, 34, 7, '#e9c46a');
    // speglar över stolarna
    for (const cx of CHAIRS) mirrorAt(g, tc(cx), 40, 108, 40);
    // inramade frisyrer mellan speglarna
    for (const px of [192, 352]) {
        box(g, px - 14, 38, 28, 24, '#a87a2e'); box(g, px - 12, 40, 24, 20, '#efe8d6');
        g.fillStyle = '#2a2a30'; g.beginPath(); g.arc(px, 55, 7, PI, 0); g.fill(); g.fillRect(px - 5, 50, 10, 10);
        g.fillStyle = '#e0ac69'; g.beginPath(); g.ellipse(px, 54, 4.6, 5.2, 0, 0, TAU); g.fill();
        g.fillStyle = '#1c1c20'; g.beginPath(); g.arc(px, 51, 5.2, PI * 1.05, PI * 1.95); g.fill();
    }
    wallLip(g, TS, 17 * TS, 3, B_WALL);
}

function barberChairs(g, def) {
    for (const cx of CHAIRS) {
        const x = tc(cx), y = tc(4);
        // gummimatta och hårtussar
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(x + 2, y + 4, 24, 21, 0, 0, TAU); g.fill();
        g.fillStyle = '#23242a'; g.beginPath(); g.ellipse(x, y + 2, 23, 20, 0, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1; g.beginPath(); g.ellipse(x, y + 2, 20, 17, 0, 0, TAU); g.stroke();
        g.fillStyle = 'rgba(15,10,6,0.7)';
        for (let i = 0; i < 12; i++) { const r = tileHash(cx, i); g.fillRect(x - 21 + (r % 42), y - 14 + ((r >> 8) % 34), 2 + (r >> 20) % 2, 1); }
        // stolens fot, sits, ryggstöd och armstöd i krom
        softShadow(g, x, y, 15, 15, 0.3);
        disc(g, x, y, 14, '#b8bfc9'); disc(g, x, y, 12, '#d9dee5');
        g.fillStyle = '#7d1520'; rr(g, x - 11, y - 10, 22, 21, 6); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.18)'; rr(g, x - 8, y - 8, 16, 5, 2); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; rr(g, x - 11, y - 10, 22, 21, 6); g.stroke();
        g.fillStyle = '#5e0f18'; rr(g, x - 12, y + 6, 24, 9, 4); g.fill();   // ryggstöd (sydsidan: kunden vänder sig mot spegeln)
        g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(x - 9, y + 7, 18, 1.4);
        for (const sx of [-14, 12]) { box(g, x + sx, y - 8, 3, 16, '#aeb6c2'); box(g, x + sx, y - 8, 1, 16, '#f2f5f8'); }
        box(g, x - 9, y - 16, 18, 4, '#aeb6c2'); box(g, x - 9, y - 16, 18, 1, '#fff');    // fotstöd
    }
}

function barberBenches(g, def) {
    slabGroup(g, def, 'm', { side: '#3a2412', top: '#c8a06a', hi: 'rgba(255,240,200,0.5)', ins: 2 });
    CHAIRS.forEach((cx, i) => {
        const x = tc(cx) - 44, y = 3 * TS;
        // kam, sax, maskin, sprayflaska, handduk
        box(g, x + 7, y + 6, 16, 3, '#1c1d22'); for (let k = 0; k < 8; k++) box(g, x + 7 + k * 2, y + 9, 1, 3, '#1c1d22');
        g.strokeStyle = '#cfd6df'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(x + 30, y + 8); g.lineTo(x + 40, y + 18); g.moveTo(x + 40, y + 8); g.lineTo(x + 30, y + 18); g.stroke();
        box(g, x + 48, y + 5, 8, 14, '#222'); box(g, x + 49, y + 6, 6, 4, '#7dd3fc'); box(g, x + 49, y + 12, 6, 6, '#e11d48');
        softShadow(g, x + 66, y + 14, 4, 4, 0.3); disc(g, x + 66, y + 14, 4, '#2563eb'); disc(g, x + 66, y + 14, 2, '#bfdbfe');
        box(g, x + 74, y + 5, 12, 20, i % 2 ? '#f4efe2' : '#e8e2d2'); box(g, x + 74, y + 5, 12, 2, '#fff'); box(g, x + 74, y + 12, 12, 2, '#dc2626');
    });
}

function barberDesk(g, def) {
    slabGroup(g, def, 'C', { side: '#3d2210', top: '#e6e0d0', hi: 'rgba(255,255,255,0.6)', ins: 3 });
    const y = 9 * TS;
    // kassa, kortterminal, dricksburk, visitkort
    box(g, 13 * TS + 4, y + 6, 24, 20, '#1b2230'); box(g, 13 * TS + 6, y + 7, 20, 8, '#86efac'); box(g, 13 * TS + 6, y + 7, 20, 2, 'rgba(255,255,255,0.4)');
    for (let i = 0; i < 4; i++) box(g, 13 * TS + 8 + i * 4.5, y + 18, 3, 3, '#5b6577');
    box(g, 14 * TS + 10, y + 8, 8, 14, '#2a2a30'); box(g, 14 * TS + 11, y + 9, 6, 4, '#7dd3fc');
    disc(g, 15 * TS + 8, y + 16, 5, 'rgba(255,255,255,0.55)'); disc(g, 15 * TS + 8, y + 17, 3.2, '#d4a72c'); disc(g, 15 * TS + 7, y + 16, 1.4, '#f7da7a');
    box(g, 15 * TS + 18, y + 8, 10, 8, '#a87a2e'); box(g, 15 * TS + 19, y + 9, 8, 6, '#f6f1e2');
    box(g, 16 * TS + 4, y + 18, 3, 8, '#16a34a');
    box(g, 12 * TS, y, 5 * TS, 3, '#a87a2e');
    // produkthylla på högra väggen
    const sx = 17 * TS;
    for (let r = 0; r < 3; r++) {
        const yy = y + 4 + r * 32 + 2;
        box(g, sx + 2, yy, 28, 26, '#2a1a0c'); box(g, sx + 2, yy + 24, 28, 2, '#8a5f33');
        ['#2563eb', '#e11d48', '#eab308', '#16a34a', '#f8fafc'].forEach((c, k) => { box(g, sx + 4 + k * 5.4, yy + 6 + (k % 2) * 2, 4, 18 - (k % 2) * 2, c); box(g, sx + 4 + k * 5.4, yy + 6 + (k % 2) * 2, 4, 2, '#d1d5db'); });
    }
}

function barberDecor(g, def) {
    sofaPaint(g, def, { base: '#2d1a12', seat: '#8e2b2b', back: '#6b1d1d' });
    coffeeTable(g, def, { side: '#3a2412', top: '#2a2d36' });
    // tidningar på soffbordet
    box(g, 3 * TS + 5, 9 * TS + 7, 12, 9, '#e5e7eb'); box(g, 3 * TS + 6, 9 * TS + 8, 10, 3, '#dc2626'); box(g, 3 * TS + 15, 9 * TS + 14, 11, 9, '#f6f1e2'); box(g, 3 * TS + 17, 9 * TS + 16, 7, 2, '#2563eb');
    eachTile(def, 'x', (tx, ty) => plantAt(g, tc(tx), tc(ty), tileHash(tx, ty) % 7));
    // dörrmatta
    const x = 8 * TS, y = 12 * TS;
    box(g, x, y, 2 * TS, TS, '#16161a');
    box(g, x + 3, y + 2, 2 * TS - 6, 16, '#1c3a6b'); box(g, x + 3, y + 2, 2 * TS - 6, 1.5, '#e8e5dc'); box(g, x + 3, y + 16, 2 * TS - 6, 1.5, '#e8e5dc');
    label(g, 'VÄLKOMMEN', x + TS, y + 10, 6, '#e8e5dc', { font: SIGN_FONT, weight: 400 });
    box(g, x, y + 20, 2 * TS, 12, '#1b2747'); box(g, x, y + 28, 2 * TS, 4, '#2d4474');
    box(g, x - 3, y + 1, 5, 18, '#4b2a1a'); box(g, x + 2 * TS - 2, y + 1, 5, 18, '#4b2a1a');
    // prislista på nedre väggen
    g.fillStyle = 'rgba(6,8,18,0.92)'; rr(g, 2 * TS + 6, 12 * TS + 5, 5 * TS + 8, 22, 4); g.fill();
    g.strokeStyle = 'rgba(233,196,106,0.8)'; g.lineWidth = 1; rr(g, 2 * TS + 7, 12 * TS + 6, 5 * TS + 6, 20, 3); g.stroke();
    label(g, 'PRISLISTA', 4 * TS + 26, 12 * TS + 11, 6.4, '#e9c46a', { font: SIGN_FONT, weight: 400 });
    label(g, 'FADE 250 · SKÄGG 150 · BARN 150', 4 * TS + 26, 12 * TS + 21, 5.6, '#f6f1e2');
    exitSign(g, 11 * TS + 10, 12 * TS + 8);
    neonText(g, 'ÖPPET', 15 * TS + 10, 12 * TS + 16, 12, '#8cf3ff', '#22d3ee');
}

function paintBarber(g, def) {
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
        const ch = def.rows[ty][tx];
        if (ch !== '#') barberFloor(g, def, tx, ty, ch);
    }
    wallPass(g, def, B_WALL);
    aoPass(g, def);
    barberTopWall(g);
    barberBenches(g, def);
    barberChairs(g, def);
    barberDesk(g, def);
    barberDecor(g, def);
}

// ── Frisörens rörliga lager ──
function poleAt(ctx, cx, y0, h, t, w = 12) {
    ctx.save();
    ctx.beginPath(); rr(ctx, cx - w / 2, y0, w, h, w / 2); ctx.clip();
    ctx.fillStyle = '#f4f4f6'; ctx.fillRect(cx - w / 2, y0, w, h);
    const per = 22, off = (t * 16) % per;
    for (let yy = y0 - per * 2 + off; yy < y0 + h + per; yy += per) {
        for (const [c, o] of [['#d92b3a', 0], ['#2457c5', per / 2]]) {
            ctx.fillStyle = c; ctx.beginPath();
            ctx.moveTo(cx - w / 2, yy + o + w * 0.9); ctx.lineTo(cx + w / 2, yy + o); ctx.lineTo(cx + w / 2, yy + o + 6); ctx.lineTo(cx - w / 2, yy + o + w * 0.9 + 6); ctx.closePath(); ctx.fill();
        }
    }
    const gr = ctx.createLinearGradient(cx - w / 2, 0, cx + w / 2, 0);
    gr.addColorStop(0, 'rgba(0,0,0,0.45)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.6, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.5)');
    ctx.fillStyle = gr; ctx.fillRect(cx - w / 2, y0, w, h);
    ctx.restore();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1; ctx.beginPath(); rr(ctx, cx - w / 2, y0, w, h, w / 2); ctx.stroke();
    // kromade ändar
    for (const yy of [y0 - 3, y0 + h - 2]) { ctx.fillStyle = '#aab3c0'; ctx.fillRect(cx - w / 2 - 1.5, yy, w + 3, 5); ctx.fillStyle = '#eef2f6'; ctx.fillRect(cx - w / 2 - 1.5, yy, w + 3, 1.4); }
}

function dynBarber(ctx, st, v, t) {
    const def = st.def;
    poleAt(ctx, 192, 32, 52, t);
    poleAt(ctx, 352, 32, 52, t);
    // glans som sveper över speglarna
    const k = (t * 0.22) % 1.6;
    for (const cx of CHAIRS) {
        const mx = tc(cx) - 50 + 4, gx = mx + (k - 0.2) * 110;
        ctx.save(); ctx.beginPath(); ctx.rect(mx, 44, 92, 32); ctx.clip();
        ctx.fillStyle = 'rgba(255,255,255,0.22)'; ctx.beginPath(); ctx.moveTo(gx, 76); ctx.lineTo(gx + 14, 44); ctx.lineTo(gx + 24, 44); ctx.lineTo(gx + 10, 76); ctx.fill();
        ctx.restore();
    }
    // spegellampor blinkar lugnt
    for (const cx of CHAIRS) for (let i = 0; i < 8; i++) {
        const bx = tc(cx) - 54 + 6 + i * (96 / 7);
        ctx.fillStyle = `rgba(255,244,194,${0.55 + 0.45 * Math.sin(t * 2 + i + cx)})`; ctx.beginPath(); ctx.arc(bx, 42, 2.2, 0, TAU); ctx.fill();
    }
    // kassaskärmen
    if (Math.floor(t * 2) % 5 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(13 * TS + 6, 9 * TS + 7, 20, 8); }
    exitArrow(ctx, def, t);
}

// Cape, sax och kam; läsmaterial i soffan
function accessoryBarber(ctx, n, t, st) {
    if (n.act === 'cut') {
        // frisörens cape: en ring runt huvudet så att ansiktet syns
        const L = n.look || {}, p = at(n, 0, 0);
        ctx.fillStyle = '#20232b'; ctx.beginPath(); ctx.ellipse(p.x, p.y, 11.6, 13.6, 0, 0, TAU); ctx.ellipse(p.x + p.c * 0.8, p.y + p.s * 0.8, 5.7, 5.7, 0, 0, TAU); ctx.fill('evenodd');
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.ellipse(p.x, p.y, 10.8, 12.8, 0, 0, TAU); ctx.stroke();
        ctx.strokeStyle = '#f2f2f4'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(p.x + p.c * 0.8, p.y + p.s * 0.8, 6.3, 0, TAU); ctx.stroke();
        void L;
    }
    if (n.act === 'read') {
        const a = n.angle, p = at(n, 9, 0), cols = ['#dc2626', '#2563eb', '#f59e0b', '#16a34a'];
        armTo(ctx, n, 1, p.x - Math.sin(a) * 4, p.y + Math.cos(a) * 4); armTo(ctx, n, -1, p.x + Math.sin(a) * 4, p.y - Math.cos(a) * 4);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a);
        ctx.fillStyle = cols[(n.look.shirt.charCodeAt(2) || 0) % 4]; ctx.fillRect(-3, -5.5, 6, 11);
        ctx.fillStyle = '#f6f1e2'; ctx.fillRect(-2, -4.5, 4.4, 9); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(-0.4, -4.5, 0.8, 9);
        ctx.restore();
    }
    if (n.staff && n.staff.role === 'barber') {
        const s = n.staff;
        if (s.atWork) {
            // sax i ena handen, kam i den andra: arbetar vid huvudet
            const cx = tc(CHAIRS[s.chair]), cy = tc(4), k = Math.sin(t * 5 + s.chair);
            const side = Math.sin(t * 0.7 + s.chair * 2) > 0 ? 1 : -1;
            const hx = cx + side * (6 + 1.5 * Math.sin(t * 2)), hy = cy - 5 + 3 * Math.sin(t * 1.3);
            const h1 = at(n, 8.8, 5.6), h2 = at(n, 8.8, -5.6);
            ctx.lineCap = 'round'; ctx.strokeStyle = n.look.shirt; ctx.lineWidth = 3.2;
            ctx.beginPath(); ctx.moveTo(h1.x, h1.y); ctx.lineTo(hx, hy + 3); ctx.moveTo(h2.x, h2.y); ctx.lineTo(cx - side * 7, cy + 1); ctx.stroke(); ctx.lineCap = 'butt';
            ctx.fillStyle = n.look.skin; ctx.beginPath(); ctx.arc(hx, hy + 3, 2.2, 0, TAU); ctx.arc(cx - side * 7, cy + 1, 2.2, 0, TAU); ctx.fill();
            // saxen öppnar och stänger
            const open = 0.25 + 0.35 * (0.5 + 0.5 * k);
            ctx.save(); ctx.translate(hx, hy); ctx.rotate(-PI / 2 + (side > 0 ? 0.5 : -0.5));
            ctx.strokeStyle = '#f4f8fc'; ctx.lineWidth = 2; ctx.lineCap = 'round';
            ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(11, -9 * open); ctx.moveTo(0, 0); ctx.lineTo(11, 9 * open); ctx.stroke();
            ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(-2.4, -1.8, 2, 0, TAU); ctx.arc(-2.4, 1.8, 2, 0, TAU); ctx.stroke();
            ctx.restore();
            // kam
            ctx.save(); ctx.translate(cx - side * 7, cy); ctx.fillStyle = '#1c1d22'; ctx.fillRect(-5, -1, 10, 2.4); for (let i = 0; i < 6; i++) ctx.fillRect(-5 + i * 1.8, 1.4, 0.8, 2); ctx.restore();
            // hårtussar som faller
            ctx.fillStyle = 'rgba(30,20,12,0.9)';
            for (let i = 0; i < 4; i++) { const f = (t * 0.9 + i / 4) % 1; ctx.globalAlpha = 1 - f; ctx.fillRect(cx + side * (8 + i * 2) - f * 4 * side, cy - 4 + f * 18, 1.6, 1); }
            ctx.globalAlpha = 1;
        } else if (n.pose === 'work' && s.spots[s.si] && s.spots[s.si].tool === 'comb') {
            const p = at(n, 11, 4); ctx.fillStyle = '#1c1d22'; ctx.fillRect(p.x - 4, p.y - 1, 8, 2);
        }
    }
}

function lightsBarber(ctx, st, v, t, glow) {
    for (const cx of CHAIRS) glow(tc(cx), 64, 62, '#fff1c9', 0.16);
    glow(192, 58, 44, '#ff4d6a', 0.2 + 0.05 * Math.sin(t * 3)); glow(352, 58, 44, '#4d7dff', 0.2 + 0.05 * Math.sin(t * 3 + 1));
}

registerBarber();
function registerBarber() {
    room(BARBER_R, BARBER, {
        paint: paintBarber, dyn: dynBarber, lights: lightsBarber,
        accessory: (ctx, n, t) => { accessoryA(ctx, n, t); accessoryBarber(ctx, n, t); },
        glows: [
            [288, 14, 170, '#ff2d55', 0.28, 0],
            [112, 150, 100, '#fff1c9', 0.1, 0], [272, 150, 100, '#fff1c9', 0.1, 0], [432, 150, 100, '#fff1c9', 0.1, 0],
            [464, 300, 90, '#86efac', 0.12, 2.5],
            [100, 290, 120, '#ffb45a', 0.1, 0],
            [366, 400, 70, '#22d3ee', 0.25, 3.1]
        ]
    });
}

// ═══════════════════════════════════════════
//  🏋️ HUSTLE GYM
//  Löpband längs speglarna, hantelställ, bänkpressar, lyftplattformar,
//  reception vid ingången. Gummigolv. 20 × 15 rutor.
// ═══════════════════════════════════════════

const GYM_ROWS = [
    '####################', //  0  skylt
    '####################', //  1  speglar
    '####################', //  2
    '#.Y..Y..Y...HHHH...#', //  3  löpbandens konsoler (Y), hantelställ (H)
    '#..................#', //  4  löpbanden ligger på golvet (rad 4–5)
    '#..................#', //  5
    '#............N...N.#', //  6  bänkpressarnas ställ
    '#............N...N.#', //  7  bänkarna
    '#............N...N.#', //  8
    '#..................#', //  9  lyftplattformar (ritade på golvet, rad 8–9)
    '#................L.#', // 10
    '#CCCCCC...........L#', // 11  receptionens disk
    '#.....C...........L#', // 12  receptionisten bakom disken
    '#.....C.....FF....L#', // 13  automat med proteinshakes
    '#########ee#########'  // 14  ingång
];

const GYM = {
    id: 'gym', name: 'Hustle Gym', theme: 'biz-gym', w: 20, h: 15,
    rows: GYM_ROWS,
    legend: {
        Y: { name: 'löpband', solid: true }, N: { name: 'bänkpress', solid: true }, H: { name: 'hantelställ', solid: true },
        L: { name: 'skåp', solid: true }, F: { name: 'kyl', solid: true }
    },
    spawn: { x: 320, y: tc(12) },
    exit: { x: 320, y: 14 * TS + 24, r: 22 },
    door: { x: 320, y: 14 * TS + 10 },
    counter: { x: tc(3), y: 10 * TS + 15 },
    interactions: [{ id: 'counter', label: 'E — Receptionen: köp stället, kassan, råna', x: 160, y: 10 * TS + 20, r: 62 }],
    music: null,
    zones: [
        { x: 2, y: 4, w: 1, h: 2, kind: 'belt' }, { x: 5, y: 4, w: 1, h: 2, kind: 'belt' }, { x: 8, y: 4, w: 1, h: 2, kind: 'belt' },
        { x: 5, y: 8, w: 2, h: 2, kind: 'lift' }, { x: 9, y: 8, w: 2, h: 2, kind: 'lift' },
        { x: 1, y: 12, w: 5, h: 2, kind: 'desk' }
    ]
};

const TREADS = [2, 5, 8];
const GYM_STATIONS = [
    ...TREADS.map(tx => ({ x: tc(tx), y: 5 * TS + 6, ang: -PI / 2, pose: 'walk', act: 'run', rate: 9, kind: 'tread', tx })),
    ...[396, 444, 492].map(x => ({ x, y: 4 * TS + 14, ang: -PI / 2, pose: 'work', act: 'curl', rate: 3.3, kind: 'db' })),
    ...[13, 17].map(tx => ({ x: tc(tx), y: 7 * TS + 16, ax: tc(tx - 1), ay: 7 * TS + 16, ang: -PI / 2, pose: 'sit', act: 'press', rate: 2.2, kind: 'bench', tx })),
    { x: 192, y: 9 * TS, ang: -PI / 2, pose: 'work', act: 'lift', rate: 2.2, kind: 'plat', tx: 5 },
    { x: 320, y: 9 * TS, ang: -PI / 2, pose: 'work', act: 'lift', rate: 2.2, kind: 'plat', tx: 9 }
];

function gymScript(rnd) {
    const s = [{ k: 'queue', q: 'main' }, { k: 'use', pool: 'gym', dur: [14, 24], full: 'wait' }];
    if (rnd() < 0.55) s.push({ k: 'use', pool: 'gym', dur: [11, 19], full: 'skip', fresh: true });
    if (rnd() < 0.35) s.push({ k: 'go', to: 'vend' }, { k: 'stay', dur: [1.4, 2.4], face: PI / 2, item: 'shake' });
    s.push({ k: 'leave' });
    return s;
}

const GYM_R = {
    maxCust: 8, gap: [4.5, 9],
    at: { vend: { x: 13 * TS, y: 12 * TS + 16, a: PI / 2 } },
    queues: {
        main: {
            slots: [0, 1, 2, 3, 4].map(k => ({ x: tc(3) + k * 34, y: 10 * TS + 15 + (k % 2 ? 3 : -2) })),
            face: PI / 2, pay: [2.4, 4],
            orders: ['Ett månadskort, tack.', 'Dagspass, tack!', 'Är det PT idag?', 'Swish går bra?'],
            thanks: ['Tack!', 'Nu kör vi!', 'Ses!']
        }
    },
    pools: { gym: GYM_STATIONS },
    until: {},
    lines: { run: ['Pust...', 'Fem minuter till.'], curl: ['Ännu en!', 'Gains!', 'Känn pumpen.'], press: ['Spotta mig!', 'Tre till!', 'Tungt!'], lift: ['Hustle!', 'Upp med den!', 'Ännu ett set.'] },
    panicLines: ['Ta det lugnt!', 'Ta pengarna!', 'Jag är bara PT!', 'Ta kassan!'],
    fleeLines: ['Hjälp!', 'Spring!', 'Rån!', 'Aaah!'],
    script: gymScript,
    staff(def, rnd) {
        const recep = makeStaff('cashier', [
            { x: tc(3), y: 12 * TS + 16, a: -PI / 2, pose: 'work', w: [3, 6] },
            { x: tc(1) + 4, y: 12 * TS + 16, a: -PI / 2, pose: 'idle', w: [2, 5] },
            { x: tc(5), y: 13 * TS + 8, a: -PI / 2, pose: 'idle', w: [2, 5] }
        ], rnd, { speed: 30, look: { shirt: '#ea580c', skin: '#e0ac69', hair: '#111111', dress: '#ea580c' }, lines: ['Välkommen!', 'Kortet piper in.', 'Glöm inte handduken!', 'Månadskort eller dagspass?'] });
        const pt = makeStaff('trainer', [
            { x: tc(4), y: 6 * TS + 8, a: -PI / 2, pose: 'idle', w: [2, 5] },
            { x: 368, y: 4 * TS + 16, a: 0, pose: 'idle', w: [3, 5] },
            { x: tc(15), y: 7 * TS + 16, a: 0, pose: 'work', w: [4, 8] },
            { x: tc(11), y: 9 * TS + 16, a: PI / 2, pose: 'idle', w: [2, 4] },
            { x: 256, y: 9 * TS + 16, a: -PI / 2, pose: 'work', w: [3, 6] },
            { x: tc(8) + 20, y: 6 * TS + 20, a: -PI / 2, pose: 'idle', w: [2, 4] }
        ], rnd, {
            speed: 44, look: { shirt: '#111827', skin: '#8d5524', hair: '#111111', cap: '#ea580c' },
            lines: ['Rak rygg!', 'Andas ut!', 'Bra jobbat!', 'Ett set till!', 'Inga ursäkter!', 'Gains!']
        });
        return [recep, pt];
    },
    act: null
};
GYM_R.act = deskAct('main', { x: tc(3), y: 12 * TS + 16 });

// ── Gymmets statiska lager ──
const G_WALL = { wall: '#25282e', face: '#454b55', hi: '#5f6774', line: '#0e1014' };

function gymFloor(g, def, tx, ty, ch) {
    const x = tx * TS, y = ty * TS, h = tileHash(tx, ty), zone = KIT.zoneAt(def, tx, ty);
    if (ch === 'e') {
        box(g, x, y, TS, TS, '#6c727c');
        g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = 1.2;
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const px = x + 4 + i * 8, py = y + 4 + j * 8; g.beginPath(); if ((i + j) & 1) { g.moveTo(px - 2, py - 2); g.lineTo(px + 2, py + 2); } else { g.moveTo(px + 2, py - 2); g.lineTo(px - 2, py + 2); } g.stroke(); }
        return;
    }
    if (zone === 'desk') {
        box(g, x, y, TS, TS, '#2f3238'); g.fillStyle = 'rgba(255,255,255,0.05)';
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(x + 3 + i * 8, y + 3 + j * 8, 4, 4);
        return;
    }
    if (zone === 'lift') {
        // lyftplattform av trä med gummikant
        for (let i = 0; i < 4; i++) box(g, x, y + i * 8, TS, 8, ['#a97c4a', '#9c7041', '#b08350', '#a27545'][(h >> i) & 3]);
        g.fillStyle = 'rgba(0,0,0,0.22)'; for (let i = 0; i < 4; i++) g.fillRect(x, y + i * 8 + 7, TS, 1);
        return;
    }
    // svart gummigolv med fina korn och skarvar
    box(g, x, y, TS, TS, (tx + ty) & 1 ? '#27292e' : '#24262b');
    g.fillStyle = 'rgba(255,255,255,0.05)';
    for (let i = 0; i < 9; i++) { const r = tileHash(h, i); g.fillRect(x + (r % 30), y + ((r >> 8) % 30), 1.4, 1.4); }
    g.fillStyle = 'rgba(255,120,30,0.05)';
    for (let i = 0; i < 3; i++) { const r = tileHash(h, i + 20); g.fillRect(x + (r % 28), y + ((r >> 8) % 28), 2, 2); }
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
}

function gymTopWall(g) {
    const yb = 3 * TS - 10, x0 = TS, x1 = 19 * TS;
    box(g, x0, 0, x1 - x0, yb, '#25282e');
    // spegelväggen: fem paneler med kromlister
    for (let i = 0; i < 5; i++) {
        const px = x0 + 6 + i * 113, pw = 106;
        box(g, px - 2, 32, pw + 4, 40, '#9aa3af'); box(g, px, 34, pw, 36, '#5d7388');
        const gr = g.createLinearGradient(px, 34, px, 70);
        gr.addColorStop(0, '#9ab3c7'); gr.addColorStop(0.6, '#5f788e'); gr.addColorStop(1, '#3d5368');
        g.fillStyle = gr; g.fillRect(px, 34, pw, 36);
        g.fillStyle = 'rgba(255,255,255,0.2)'; g.beginPath(); g.moveTo(px + 14, 70); g.lineTo(px + 40, 34); g.lineTo(px + 56, 34); g.lineTo(px + 30, 70); g.fill();
        g.beginPath(); g.moveTo(px + 70, 70); g.lineTo(px + 80, 34); g.lineTo(px + 86, 34); g.lineTo(px + 76, 70); g.fill();
        g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 1; g.strokeRect(px + 0.5, 34.5, pw - 1, 35);
    }
    // orange band med slogan
    box(g, x0, 72, x1 - x0, 14, '#d9570f'); box(g, x0, 72, x1 - x0, 2, '#ff9a4a'); box(g, x0, 84, x1 - x0, 2, '#7a2f06');
    label(g, 'NO PAIN · NO GAIN · NO EXCUSES · HUSTLE HARD · NO PAIN · NO GAIN · NO EXCUSES · HUSTLE HARD', 320, 79.5, 6.6, '#1a0d04', { font: SIGN_FONT, weight: 400 });
    // skylt
    g.fillStyle = 'rgba(8,8,10,0.94)'; rr(g, 192, 3, 256, 25, 6); g.fill();
    g.strokeStyle = 'rgba(255,140,40,0.9)'; g.lineWidth = 1.4; rr(g, 193, 4, 254, 23, 5); g.stroke();
    neonText(g, 'HUSTLE GYM', 320, 16, 17, '#ffcf8a', '#ff6a00');
    // hantlar som ikoner
    for (const sx of [168, 472]) {
        g.save(); g.translate(sx, 16); g.fillStyle = '#dfe4ea';
        g.fillRect(-9, -1.4, 18, 2.8); g.fillRect(-12, -7, 4, 14); g.fillRect(8, -7, 4, 14); g.fillRect(-15, -4.5, 3, 9); g.fillRect(12, -4.5, 3, 9);
        g.fillStyle = '#ff6a00'; g.fillRect(-12, -7, 4, 2); g.fillRect(8, -7, 4, 2);
        g.restore();
    }
    wallLip(g, x0, x1, 3, G_WALL);
}

function dumbbell(g, cx, cy, r, col) {
    g.fillStyle = '#0d0e11'; g.beginPath(); g.arc(cx, cy - 10, r + 0.8, 0, TAU); g.arc(cx, cy + 10, r + 0.8, 0, TAU); g.fill();
    box(g, cx - 1.3, cy - 10, 2.6, 20, '#9aa3af');
    for (const yy of [cy - 10, cy + 10]) {
        g.fillStyle = col; g.beginPath(); for (let i = 0; i < 6; i++) { const a = i * PI / 3 + PI / 6; g.lineTo(cx + Math.cos(a) * r, yy + Math.sin(a) * r); } g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.4)'; g.beginPath(); g.arc(cx - r * 0.3, yy - r * 0.3, r * 0.35, 0, TAU); g.fill();
    }
}

function gymEquipment(g, def) {
    // löpband: konsol vid väggen, band på golvet
    TREADS.forEach(tx => {
        const cx = tc(tx), y0 = 4 * TS;
        softShadow(g, cx, y0 + 30, 18, 33, 0.28);
        box(g, cx - 17, y0 + 1, 34, 62, '#16171b');                  // ram
        box(g, cx - 14, y0 + 3, 28, 58, '#2b2d33');                  // band
        g.fillStyle = 'rgba(255,255,255,0.05)'; for (let i = 0; i < 12; i++) g.fillRect(cx - 14, y0 + 6 + i * 4.6, 28, 1);
        box(g, cx - 17, y0 + 1, 3, 62, '#3b3e46'); box(g, cx + 14, y0 + 1, 3, 62, '#3b3e46');
        box(g, cx - 17, y0 + 1, 3, 62, '#d9570f'); box(g, cx + 14, y0 + 1, 3, 62, '#d9570f');
        box(g, cx - 14, y0 + 3, 28, 4, 'rgba(0,0,0,0.5)');
        // konsol (solid rutan i rad 3)
        const yc = 3 * TS;
        box(g, cx - 18, yc + 1, 36, 30, '#1b1c20'); box(g, cx - 16, yc + 3, 32, 26, '#3a3d45'); box(g, cx - 16, yc + 3, 32, 2, 'rgba(255,255,255,0.3)');
        box(g, cx - 11, yc + 6, 22, 11, '#0c1b22');
        for (let i = 0; i < 4; i++) box(g, cx - 10 + i * 5, yc + 21, 3, 4, i === 3 ? '#ef4444' : '#8a919c');
        // handtag
        g.strokeStyle = '#b8bfca'; g.lineWidth = 2.4; g.lineCap = 'round';
        g.beginPath(); g.moveTo(cx - 17, yc + 28); g.lineTo(cx - 17, y0 + 18); g.moveTo(cx + 17, yc + 28); g.lineTo(cx + 17, y0 + 18); g.stroke(); g.lineCap = 'butt';
    });
    // hantelställ
    eachTile(def, 'H', (tx, ty) => { if (chAt(def, tx - 1, ty) === 'H') return; });
    {
        const x0 = 12 * TS, y0 = 3 * TS, w = 4 * TS;
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x0 + 2, y0 + 4, w, TS);
        box(g, x0, y0, w, TS, '#15171b'); box(g, x0 + 2, y0 + 2, w - 4, TS - 4, '#2a2d33'); box(g, x0 + 2, y0 + 2, w - 4, 1.5, 'rgba(255,255,255,0.18)');
        const cols = ['#a7b0bb', '#a7b0bb', '#8a94a1', '#8a94a1', '#6f7a88', '#6f7a88', '#5a6472', '#d9570f'];
        for (let i = 0; i < 8; i++) dumbbell(g, x0 + 11 + i * 15.2, y0 + 16, 3.4 + i * 0.35, cols[i]);
    }
    // bänkpress: ställ (rad 6) och bänk (rad 7–8)
    for (const tx of [13, 17]) {
        const cx = tc(tx), y0 = 6 * TS;
        softShadow(g, cx, y0 + 48, 18, 48, 0.28);
        box(g, cx - 12, y0 + 34, 24, 58, '#15171b');                // bänkpad
        g.fillStyle = '#2f3138'; rr(g, cx - 10, y0 + 36, 20, 54, 5); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.1)'; rr(g, cx - 8, y0 + 38, 5, 50, 2); g.fill();
        box(g, cx - 20, y0 + 60, 4, 4, '#aeb6c2'); box(g, cx + 16, y0 + 60, 4, 4, '#aeb6c2');
        // ställningen vid huvudändan
        for (const sx of [-17, 17]) { disc(g, cx + sx, y0 + 12, 4.4, '#0f1013'); disc(g, cx + sx, y0 + 12, 2.8, '#9aa3af'); box(g, cx + sx - 1.5, y0 + 12, 3, 20, '#16181c'); }
        box(g, cx - 17, y0 + 30, 34, 3, '#16181c');
    }
    // lyftplattformar: gummiramar, brickor och krita
    for (const px of [5, 9]) {
        const x = px * TS, y = 8 * TS;
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, y + 3, 2 * TS, 2 * TS);
        box(g, x - 3, y - 3, 2 * TS + 6, 3, '#101114'); box(g, x - 3, y + 2 * TS, 2 * TS + 6, 3, '#101114');
        box(g, x - 3, y - 3, 3, 2 * TS + 6, '#101114'); box(g, x + 2 * TS, y - 3, 3, 2 * TS + 6, '#101114');
        // viktskivor i travar vid sidan
        for (let k = 0; k < 3; k++) { disc(g, x + 2 * TS + 11, y + 12 + k * 3, 8 - k, ['#c2261b', '#1f56c4', '#e8b923'][k]); disc(g, x + 2 * TS + 11, y + 12 + k * 3, 1.6, '#0b0b0e'); }
    }
}

function gymReception(g, def) {
    slabGroup(g, def, 'C', { side: '#1f2228', top: '#d8dce2', hi: 'rgba(255,255,255,0.7)', ins: 3 });
    const y = 11 * TS;
    // LED-list i framkanten
    box(g, TS, y + TS - 4, 6 * TS, 2.5, '#38bdf8'); box(g, TS, y + TS - 4, 6 * TS, 0.8, '#e0f7ff');
    // datorskärm, incheckningsplatta, shakers, handdukar
    box(g, TS + 8, y + 6, 24, 18, '#101318'); box(g, TS + 10, y + 8, 20, 12, '#0e7490'); box(g, TS + 10, y + 8, 20, 3, 'rgba(255,255,255,0.35)'); box(g, TS + 18, y + 24, 8, 3, '#2a2d33');
    box(g, 3 * TS + 4, y + 6, 24, 20, '#1b2230'); box(g, 3 * TS + 6, y + 7, 20, 8, '#86efac'); box(g, 3 * TS + 6, y + 7, 20, 2, 'rgba(255,255,255,0.4)');
    for (let i = 0; i < 4; i++) box(g, 3 * TS + 8 + i * 4.5, y + 18, 3, 3, '#5b6577');
    for (const [sx, c] of [[4 * TS + 8, '#2563eb'], [4 * TS + 17, '#ea580c']]) { softShadow(g, sx, y + 14, 3.6, 3.6, 0.3); disc(g, sx, y + 14, 3.8, c); disc(g, sx, y + 14, 2, 'rgba(255,255,255,0.7)'); }
    for (let i = 0; i < 4; i++) { box(g, 5 * TS + 3, y + 6 + i * 4.4, 22, 3.8, i & 1 ? '#f4f4f6' : '#e2e5ea'); }
    box(g, 5 * TS + 3, y + 6, 22, 1, 'rgba(255,255,255,0.8)');
    box(g, 6 * TS + 2, y, 3, TS, '#a8b0bb'); // kant mot personalrummet
    // skåp (lockers) längs högra väggen
    eachTile(def, 'L', (tx, ty) => {
        const x = tx * TS, yy = ty * TS;
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, yy + 3, TS, TS);
        box(g, x, yy, TS, TS, '#1f3b66'); box(g, x + 2, yy + 2, TS - 4, TS - 4, '#2f5a99');
        for (let i = 0; i < 2; i++) { box(g, x + 4, yy + 3 + i * 13, 24, 11, '#3b6bb5'); box(g, x + 4, yy + 3 + i * 13, 24, 1.2, 'rgba(255,255,255,0.35)'); for (let k = 0; k < 3; k++) box(g, x + 7 + k * 2.6, yy + 5 + i * 13, 1.2, 4, 'rgba(0,0,0,0.4)'); box(g, x + 21, yy + 8 + i * 13, 4, 2.4, '#d1d6dd'); }
    });
    // automat med proteinshakes
    {
        const x = 12 * TS, yy = 13 * TS;
        softShadow(g, x + 32, yy + 16, 32, 16, 0.3);
        box(g, x, yy, 2 * TS, TS, '#15171b'); box(g, x + 2, yy + 2, 2 * TS - 4, TS - 4, '#2a2d33');
        box(g, x + 3, yy + 3, 2 * TS - 6, 13, '#0e1a22');
        const cols = ['#2563eb', '#ea580c', '#16a34a', '#e11d48', '#a855f7', '#facc15'];
        for (let i = 0; i < 6; i++) { box(g, x + 5 + i * 9, yy + 5, 6, 9, cols[i]); box(g, x + 5 + i * 9, yy + 5, 6, 2, 'rgba(255,255,255,0.5)'); }
        box(g, x + 3, yy + 3, 2 * TS - 6, 13, 'rgba(160,215,240,0.14)');
        box(g, x + 18, yy + 19, 28, 8, '#0b0b0e'); label(g, 'PROTEIN', x + 32, yy + 23.3, 5.6, '#ff9a4a', { font: SIGN_FONT, weight: 400 });
    }
}

function gymDecor(g, def) {
    // logga på golvet
    g.save(); g.globalAlpha = 0.16; label(g, 'HUSTLE', 14 * TS, 11 * TS, 22, '#ff7a1a', { font: SIGN_FONT, weight: 400 }); g.restore();
    // stretchmattor, kettlebells och skumrulle
    for (const [mx, my] of [[1, 8], [2, 8]]) {
        box(g, mx * TS + 4, my * TS + 2, 24, 60, '#0e7490'); box(g, mx * TS + 4, my * TS + 2, 24, 2, 'rgba(255,255,255,0.3)');
        g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1; g.strokeRect(mx * TS + 4.5, my * TS + 2.5, 23, 59);
    }
    for (const [kx, ky, r] of [[3 * TS + 10, 8 * TS + 12, 6], [3 * TS + 24, 8 * TS + 12, 5], [3 * TS + 16, 8 * TS + 26, 7]]) {
        softShadow(g, kx, ky, r, r, 0.3); disc(g, kx, ky, r, '#1c1d22'); disc(g, kx, ky, r * 0.55, '#2e3037'); disc(g, kx - r * 0.3, ky - r * 0.3, r * 0.25, 'rgba(255,255,255,0.5)');
    }
    box(g, 3 * TS + 3, 9 * TS + 14, 26, 9, '#ea580c'); box(g, 3 * TS + 3, 9 * TS + 14, 26, 2, 'rgba(255,255,255,0.3)');
    // dörr
    const x = 9 * TS, y = 14 * TS;
    box(g, x, y, 2 * TS, TS, '#4a5058');
    box(g, x + 2, y + 2, 2 * TS - 4, 14, '#101114'); box(g, x + 2, y + 2, 2 * TS - 4, 1.5, '#ff9a4a'); box(g, x + 2, y + 15, 2 * TS - 4, 1.5, '#ff9a4a');
    label(g, 'VÄLKOMMEN', x + TS, y + 9, 6, '#ffcf8a', { font: SIGN_FONT, weight: 400 });
    box(g, x, y + 20, 2 * TS, 12, '#1b2747'); box(g, x, y + 28, 2 * TS, 4, '#2d4474');
    exitSign(g, 12 * TS + 10, 14 * TS + 8);
    neonText(g, 'ÖPPET', 16 * TS + 6, 14 * TS + 16, 12, '#8cf3ff', '#22d3ee');
    label(g, 'RECEPTION', 3 * TS + 16, 14 * TS + 16, 8, '#ffb870', { font: SIGN_FONT, weight: 400 });
    // omklädningsskylt över skåpen
    g.save(); g.translate(19 * TS + 16, 12 * TS); g.rotate(-PI / 2); label(g, 'OMKLÄDNING', 0, 0, 7, '#8ab4f8', { font: SIGN_FONT, weight: 400 }); g.restore();
}

function paintGym(g, def) {
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
        const ch = def.rows[ty][tx];
        if (ch !== '#') gymFloor(g, def, tx, ty, ch);
    }
    wallPass(g, def, G_WALL);
    aoPass(g, def);
    gymTopWall(g);
    gymEquipment(g, def);
    gymReception(g, def);
    gymDecor(g, def);
}

// ── Gymmets rörliga lager ──
function dynGym(ctx, st, v, t) {
    const def = st.def;
    const use = {};
    for (const m of st.npcs) if (m.c && m.c.hold && m.c.hold.startsWith('gym:') && m.c.s && m.c.s.ph === 3) use[m.c.hold] = m;
    // löpbanden: ränder glider när någon springer, konsolen lyser
    TREADS.forEach((tx, i) => {
        const cx = tc(tx), y0 = 4 * TS, on = !!use['gym:' + i];
        ctx.save(); ctx.beginPath(); ctx.rect(cx - 14, y0 + 7, 28, 54); ctx.clip();
        if (on) {
            ctx.fillStyle = 'rgba(255,255,255,0.12)';
            for (let k = -1; k < 14; k++) ctx.fillRect(cx - 14, y0 + 7 + ((k * 4.6 + t * 34) % 62), 28, 1.2);
        }
        ctx.restore();
        ctx.fillStyle = on ? (Math.floor(t * 2) % 2 ? '#22d3ee' : '#67e8f9') : '#0e3a44';
        ctx.fillRect(cx - 11, 3 * TS + 6, 22, 11);
        if (on) { ctx.fillStyle = 'rgba(0,0,0,0.65)'; for (let k = 0; k < 4; k++) ctx.fillRect(cx - 9 + k * 5, 3 * TS + 10, 3, 4 - (k + Math.floor(t * 3)) % 3); }
    });
    // stången ligger i ställningen när ingen pressar
    [13, 17].forEach((tx, i) => {
        if (use['gym:' + (6 + i)]) return;
        const cx = tc(tx), y = 6 * TS + 12;
        ctx.fillStyle = '#c3c9d1'; ctx.fillRect(cx - 24, y - 1.2, 48, 2.4);
        for (const sx of [-1, 1]) { ctx.fillStyle = '#0f1013'; ctx.fillRect(cx + sx * 22 - 2, y - 7, 4, 14); ctx.fillStyle = '#c2261b'; ctx.fillRect(cx + sx * 22 - 2, y - 7, 4, 3); }
    });
    // stången på lyftplattformen när ingen lyfter
    [[5, 8], [9, 9]].forEach(([tx, idx]) => {
        if (use['gym:' + idx]) return;
        const cx = tx * TS + 32, y = 9 * TS + 14;
        ctx.fillStyle = '#c3c9d1'; ctx.fillRect(cx - 24, y - 1.2, 48, 2.4);
        for (const sx of [-1, 1]) { ctx.fillStyle = '#0f1013'; ctx.fillRect(cx + sx * 22 - 2.5, y - 8, 5, 16); ctx.fillStyle = '#1f56c4'; ctx.fillRect(cx + sx * 22 - 2.5, y - 8, 5, 3); }
    });
    // skyltens flimmer och incheckningsskärmen
    if (Math.floor(t * 2) % 5 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(3 * TS + 6, 11 * TS + 7, 20, 8); }
    const f = (t * 0.27) % 1;
    if (f < 0.02 || (f > 0.05 && f < 0.065)) { ctx.fillStyle = 'rgba(8,8,10,0.6)'; rr(ctx, 195, 6, 250, 19, 4); ctx.fill(); }
    exitArrow(ctx, def, t);
}

function lineBar(ctx, n, lx, lift, plateCols, w = 22) {
    // stången sedd uppifrån: tvärs över kroppen, skivorna blir större när den lyfts (närmare kameran)
    const c = at(n, lx, 0), sc = 1 + 0.28 * lift, ax = -Math.sin(n.angle), ay = Math.cos(n.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(c.x - w * ax - 1 + 3, c.y - w * ay + 3 - 1, 2, 2);
    ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(n.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(-1 + 3 * lift, -w * sc + 2, 2.4, w * 2 * sc);
    ctx.fillStyle = '#d3d9e0'; ctx.fillRect(-1.2 * sc, -w * sc, 2.4 * sc, w * 2 * sc);
    for (const sd of [-1, 1]) {
        ctx.fillStyle = '#0f1013'; ctx.fillRect(-3.4 * sc, sd * (w - 1) * sc - (sd > 0 ? 0 : 5.5 * sc), 6.8 * sc, 6.5 * sc);
        ctx.fillStyle = plateCols[0]; ctx.fillRect(-3 * sc, sd * (w - 1) * sc - (sd > 0 ? 0 : 5 * sc), 6 * sc, 2.4 * sc);
    }
    ctx.restore();
    return c;
}

function accessoryGym(ctx, n, t) {
    if (n.act === 'curl') {
        // två hantlar som lyfts om vartannat
        for (const side of [-1, 1]) {
            const lift = 0.5 + 0.5 * Math.sin(n.phase + (side > 0 ? 0 : PI)), p = at(n, 8.8 + 4 * lift, side * 5.6);
            armTo(ctx, n, side, p.x, p.y);
            const r = 3.2 + 1.6 * lift;
            ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(p.x + 1.4, p.y + 1.6, r, 0, TAU); ctx.fill();
            ctx.fillStyle = '#16171b'; ctx.beginPath(); for (let i = 0; i < 6; i++) ctx.lineTo(p.x + Math.cos(i * PI / 3) * r, p.y + Math.sin(i * PI / 3) * r); ctx.closePath(); ctx.fill();
            ctx.fillStyle = side > 0 ? '#d9570f' : '#8a94a1'; ctx.beginPath(); ctx.arc(p.x, p.y, r * 0.55, 0, TAU); ctx.fill();
        }
    } else if (n.act === 'lift') {
        const lift = 0.5 + 0.5 * Math.sin(n.phase), c = lineBar(ctx, n, 11 + 5 * lift, lift, ['#c2261b'], 23);
        for (const side of [-1, 1]) { const h = at(n, 9 + 4 * lift, side * 5.6); armTo(ctx, n, side, h.x, h.y); }
        void c;
    } else if (n.act === 'press') {
        const lift = 0.5 + 0.5 * Math.sin(n.phase);
        for (const side of [-1, 1]) { const h = at(n, 5 + 2 * lift, side * 8); armTo(ctx, n, side, h.x, h.y); }
        lineBar(ctx, n, 1 + 2 * lift, lift, ['#1f56c4'], 24);
    } else if (n.act === 'run') {
        // svettdroppar
        ctx.fillStyle = 'rgba(180,230,255,0.9)';
        for (let i = 0; i < 2; i++) { const f = (t * 1.6 + i * 0.5 + n.phase * 0.02) % 1, p = at(n, 2 - f * 6, (i ? 7 : -7) + (i ? f : -f) * 5); ctx.globalAlpha = 1 - f; ctx.beginPath(); ctx.arc(p.x, p.y, 1.1, 0, TAU); ctx.fill(); }
        ctx.globalAlpha = 1;
        // pannband
        const p = at(n, 0.8, 0); ctx.strokeStyle = '#ea580c'; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(p.x, p.y, 3.5, n.angle - 1.7, n.angle + 1.7); ctx.stroke();
    }
    if (n.item === 'shake' && n.pose !== 'sit') {
        const p = at(n, 9.5, 8);
        armTo(ctx, n, 1, p.x, p.y);
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(p.x + 1, p.y + 1.2, 3.2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#2563eb'; ctx.beginPath(); ctx.arc(p.x, p.y, 3.1, 0, TAU); ctx.fill();
        ctx.fillStyle = '#e5e7eb'; ctx.beginPath(); ctx.arc(p.x, p.y, 1.7, 0, TAU); ctx.fill();
        ctx.fillStyle = '#ea580c'; ctx.fillRect(p.x - 0.5, p.y - 3.4, 1, 1.4);
    }
}

function lightsGym(ctx, st, v, t, glow) {
    glow(320, 16, 120, '#ff6a00', 0.22 + 0.04 * Math.sin(t * 2));
    for (let i = 0; i < 4; i++) glow(100 + i * 150, 62, 90, '#cfe8ff', 0.07);
    glow(432, 428, 66, '#ffb870', 0.14);
}

registerGym();
function registerGym() {
    room(GYM_R, GYM, {
        paint: paintGym, dyn: dynGym, lights: lightsGym,
        accessory: (ctx, n, t) => { accessoryA(ctx, n, t); accessoryGym(ctx, n, t); },
        glows: [
            [320, 14, 190, '#ff6a00', 0.24, 0],
            [140, 150, 120, '#22d3ee', 0.09, 0],
            [112, 400, 100, '#38bdf8', 0.16, 2.4],
            [320, 262, 130, '#fff1c9', 0.07, 0],
            [432, 438, 60, '#ffb870', 0.16, 0],
            [320, 470, 70, '#22c55e', 0.12, 3.2]
        ]
    });
}

// ═══════════════════════════════════════════
//  🎵 BEAT STUDIO
//  Två sångbås bakom glas, kontrollrum med mixerbord och reception/lounge.
//  22 × 15 rutor.
// ═══════════════════════════════════════════

const STUDIO_ROWS = [
    '######################', //  0  skylt
    '######################', //  1  akustikpaneler, guldskivor
    '######################', //  2
    '#....g....gkSSSSSk..x#', //  3  sångbås A (x 1–4) och B (x 6–9), lounge med soffa och högtalare
    '#....g....g.........S#', //  4
    '#....g....g..VVV....S#', //  5
    '#....g....g.........S#', //  6
    '#g+gggg+ggg..........#', //  7  glasfronten med dörrar till båsen (x 2 och 7)
    '#....................#', //  8  gången mellan glaset och mixerbordet (två rader bred)
    '#....................#', //  9
    '#kDDDDDDDk........C..#', // 10  mixerbordet, högtalare, receptionens disk
    '#L................C..#', // 11  utrustningsrack
    '#L.VVV............C..#', // 12  producentens soffbord
    '#.SSSSS...........C..#', // 13  klientsoffa
    '##########ee##########'  // 14  ingång
];

const STUDIO = {
    id: 'studio', name: 'Beat Studio', theme: 'biz-studio', w: 22, h: 15,
    rows: STUDIO_ROWS,
    legend: { g: { name: 'glasvägg', solid: true }, L: { name: 'skåp', solid: true } },
    spawn: { x: 352, y: tc(12) },
    exit: { x: 352, y: 14 * TS + 24, r: 22 },
    door: { x: 352, y: 14 * TS + 10 },
    counter: { x: 17 * TS + 16, y: 10 * TS + 16 },
    interactions: [{ id: 'counter', label: 'E — Receptionen: köp stället, kassan, råna', x: 16 * TS + 20, y: 10 * TS + 22, r: 62 }],
    music: null,
    zones: [
        { x: 1, y: 3, w: 4, h: 4, kind: 'booth' }, { x: 6, y: 3, w: 4, h: 4, kind: 'booth' },
        { x: 1, y: 8, w: 9, h: 6, kind: 'ctrl' }, { x: 19, y: 10, w: 2, h: 4, kind: 'desk' }
    ]
};

const BOOTHS = [96, 256];
const STUDIO_LINES = ['Yeah!', 'Check, check...', 'Hustle, hustle, varje dag', 'Ta det från början!', 'Mer bas i hörlurarna!', 'Det här blir en hit!', 'Skrrt skrrt!', 'En take till!', 'Jag kallar den Hustle City', 'Brrra!'];
const STUDIO_BOOTH = BOOTHS.map(x => ({
    x, y: 168, ang: -PI / 2, pose: 'cheer', act: 'rec', rate: 2.4, lines: STUDIO_LINES, sayGap: [2.5, 5],
    cycle: { pose: 'work', dur: [1.4, 3] }
}));
const STUDIO_LOUNGE = [
    ...[12, 13, 14, 15, 16].map(tx => ({ x: tc(tx), y: tc(3), ax: tc(tx), ay: tc(4), ang: PI / 2, pose: 'sit', act: 'phone', rate: 1.2 })),
    ...[4, 5, 6].map(ty => ({ x: tc(20), y: tc(ty), ax: tc(19), ay: tc(ty), ang: PI, pose: 'sit', act: 'phone', rate: 1.2 }))
];

function boothsFree(st) { let f = 0; for (let i = 0; i < STUDIO_BOOTH.length; i++) if (!holder(st, 'booth:' + i)) f++; return f; }

function studioScript(rnd) {
    return [
        { k: 'queue', q: 'main' },
        { k: 'use', pool: 'lounge', dur: [2, 6], until: 'boothFree', skipIf: 'boothFree', full: 'skip' },
        { k: 'use', pool: 'booth', dur: [12, 20], full: 'wait' },
        { k: 'leave' }
    ];
}

const STUDIO_R = {
    maxCust: 7, gap: [5, 10],
    at: {},
    queues: {
        main: {
            slots: [0, 1, 2, 3].map(k => ({ x: 17 * TS + 16 + (k % 2 ? 3 : -2), y: 10 * TS + 16 + k * 34 })),
            face: 0, pay: [2.6, 4.4],
            orders: ['En timme i studion.', 'Jag har en beat.', 'Studio A, tack!', 'Swish går bra?'],
            thanks: ['Tack!', 'Nu kör vi!', 'Det blir en hit.']
        }
    },
    pools: { lounge: STUDIO_LOUNGE, booth: STUDIO_BOOTH },
    until: {
        boothFree(st, n) {
            const free = boothsFree(st);
            let ahead = 0;
            for (const m of st.npcs) {
                const ms = m.c && m.c.s;
                if (m === n || !live(m) || !ms || ms.k !== 'use' || ms.pool !== 'lounge' || ms.ph < 1 || m.c.flee) continue;
                const mine = n.c && n.c.s && n.c.s.since;
                if (mine == null || (ms.since != null && ms.since < mine)) ahead++;
            }
            return free > ahead;
        }
    },
    lines: { phone: ['Nytt spår på gång.', 'Fan vad bra det blir.', 'Lyssna på den här.'] },
    panicLines: ['Ta det lugnt!', 'Ta pengarna!', 'Inte masterbanden!', 'Ta kassan!'],
    fleeLines: ['Hjälp!', 'Spring!', 'Rån!', 'Aaah!'],
    script: studioScript,
    staff(def, rnd) {
        const mix = x => ({ x, y: 11 * TS + 12, a: -PI / 2, pose: 'work', w: [4, 8] });
        const producer = makeStaff('producer', [
            mix(112), mix(176), mix(240), { x: 240, y: 12 * TS + 16, a: -PI / 2, pose: 'idle', w: [2, 4] }
        ], rnd, {
            speed: 34, look: { shirt: '#18181b', skin: '#8d5524', hair: '#111111', cap: '#7c3aed' }, start: 1,
            lines: ['Ta det en gång till.', 'Mer bas!', 'Det där satt!', 'Sänk hörlurarna.', 'Hit, hit, hit.', 'Lägg en trumloop.']
        });
        const recep = makeStaff('cashier', [
            { x: 19 * TS + 16, y: 10 * TS + 16, a: PI, pose: 'work', w: [3, 6] },
            { x: 20 * TS + 16, y: 12 * TS, a: PI, pose: 'idle', w: [2, 5] },
            { x: 19 * TS + 16, y: 12 * TS + 16, a: PI, pose: 'idle', w: [2, 5] }
        ], rnd, {
            speed: 30, look: { shirt: '#be185d', skin: '#f1c27d', hair: '#7c2d12', dress: '#be185d' },
            lines: ['Välkommen till Beat Studio!', 'Sessionen kostar 600.', 'Studio A är ledigt.', 'Skriv på kontraktet här.']
        });
        return [producer, recep];
    },
    act: null
};
STUDIO_R.act = deskAct('main', { x: 19 * TS + 16, y: 10 * TS + 16 });

// ── Studions statiska lager ──
const S_WALL = { wall: '#150f1d', face: '#33254b', hi: '#523e7c', line: '#07040b' };

function studioFloor(g, def, tx, ty, ch) {
    const x = tx * TS, y = ty * TS, h = tileHash(tx, ty), zone = KIT.zoneAt(def, tx, ty);
    if (ch === 'e') { box(g, x, y, TS, TS, '#17101f'); return; }
    if (zone === 'booth') {
        box(g, x, y, TS, TS, '#231d2d');
        g.fillStyle = 'rgba(255,255,255,0.04)'; for (let i = 0; i < 8; i++) { const r = tileHash(h, i); g.fillRect(x + (r % 30), y + ((r >> 8) % 30), 1.6, 1.6); }
        return;
    }
    if (zone === 'ctrl') {
        box(g, x, y, TS, TS, (tx + ty) & 1 ? '#2a2540' : '#272239');
        g.strokeStyle = 'rgba(160,140,255,0.10)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        g.fillStyle = 'rgba(255,255,255,0.03)'; for (let i = 0; i < 6; i++) { const r = tileHash(h, i); g.fillRect(x + (r % 30), y + ((r >> 8) % 30), 1.6, 1.6); }
        return;
    }
    if (zone === 'desk') {
        box(g, x, y, TS, TS, '#1b1626'); g.fillStyle = 'rgba(255,255,255,0.05)';
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(x + 3 + i * 8, y + 3 + j * 8, 4, 4);
        return;
    }
    plankFloor(g, tx, ty, ['#3a2a30', '#37272d', '#3d2d33', '#34252b']);
}

// Akustikpanel: skumpyramider sedda uppifrån
function foam(g, x, y, w, h, c1, c2) {
    box(g, x, y, w, h, c1);
    const s = 8;
    for (let i = 0; i < w / s; i++) for (let j = 0; j < h / s; j++) {
        const px = x + i * s, py = y + j * s;
        g.fillStyle = (i + j) & 1 ? c2 : c1; g.fillRect(px, py, s, s);
        g.fillStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.moveTo(px, py + s); g.lineTo(px + s / 2, py); g.lineTo(px + s, py + s); g.fill();
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.moveTo(px + s / 2, py); g.lineTo(px + s, py + s); g.lineTo(px + s / 2, py + s); g.fill();
    }
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
}

function goldRecord(g, cx, cy, plat) {
    box(g, cx - 15, cy - 15, 30, 30, '#2a1d0c'); box(g, cx - 13, cy - 13, 26, 26, '#15100a');
    disc(g, cx, cy, 11, plat ? '#cfd6e0' : '#e8b923'); disc(g, cx, cy, 8, plat ? '#aeb8c5' : '#c99710');
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 0.6; for (const r of [9.4, 7, 5.4]) { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke(); }
    disc(g, cx, cy, 3, '#b91c1c'); disc(g, cx, cy, 0.9, '#15100a');
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.arc(cx, cy, 10.5, PI * 1.15, PI * 1.45); g.lineTo(cx, cy); g.fill();
}

function studioTopWall(g) {
    const yb = 3 * TS - 10, x0 = TS, x1 = 21 * TS;
    box(g, x0, 0, x1 - x0, yb, '#18101f');
    // akustikpaneler längs hela väggen under skylten
    for (let i = 0; i < 10; i++) foam(g, x0 + 2 + i * 64, 34, 60, 44, i & 1 ? '#3b2a57' : '#2a2038', i & 1 ? '#2d2142' : '#3f2f5e');
    box(g, x0, 78, x1 - x0, 8, '#0d0912'); box(g, x0, 78, x1 - x0, 1.5, 'rgba(160,140,255,0.4)');
    // guldskivor över loungen
    goldRecord(g, 13 * TS + 16, 56, false); goldRecord(g, 14 * TS + 16 + 12, 56, true); goldRecord(g, 16 * TS + 8, 56, false);
    // skylt
    g.fillStyle = 'rgba(6,4,12,0.94)'; rr(g, 232, 3, 240, 25, 6); g.fill();
    g.strokeStyle = 'rgba(255,60,200,0.9)'; g.lineWidth = 1.4; rr(g, 233, 4, 238, 23, 5); g.stroke();
    neonText(g, 'BEAT STUDIO', 352, 16, 17, '#ffb3f0', '#ff2bd6');
    // ljudvåg som ikon
    for (const [sx, dir] of [[210, -1], [494, 1]]) {
        g.strokeStyle = '#22e5ff'; g.lineWidth = 2; g.lineCap = 'round'; g.beginPath();
        for (let i = 0; i < 5; i++) { const hh = [3, 8, 12, 7, 4][i]; g.moveTo(sx + dir * i * 5, 16 - hh); g.lineTo(sx + dir * i * 5, 16 + hh); }
        g.stroke(); g.lineCap = 'butt';
    }
    label(g, 'Producera hits · sälj beats', 352, 33, 7, '#d9b8ff');
    // båsens skyltar
    for (const [i, cx] of BOOTHS.entries()) { box(g, cx - 14, 8 * 0 + 38, 0, 0, '#000'); label(g, i ? 'STUDIO B' : 'STUDIO A', cx, 86 - 6, 6, '#c4a1ff', { font: SIGN_FONT, weight: 400 }); }
    wallLip(g, x0, x1, 3, S_WALL);
}

function studioGlass(g, def) {
    eachTile(def, 'g', (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        const gl = (dx, dy) => chAt(def, tx + dx, ty + dy) === 'g' || chAt(def, tx + dx, ty + dy) === '+';
        const hz = gl(-1, 0) || gl(1, 0), vt = gl(0, -1) || gl(0, 1);
        const T = 7;
        g.fillStyle = 'rgba(0,0,0,0.3)';
        if (hz) g.fillRect(x, y + 16 - T / 2 + 3, TS, T);
        if (vt) g.fillRect(x + 16 - T / 2 + 3, y, T, TS);
        const strip = (sx, sy, w, h) => {
            box(g, sx, sy, w, h, '#1b2a36'); box(g, sx + 1, sy + 1, w - 2, h - 2, 'rgba(120,205,230,0.55)');
            box(g, sx + 1, sy + 1, w - 2, 1.2, 'rgba(255,255,255,0.55)');
        };
        if (hz) strip(x, y + 16 - T / 2, TS, T);
        if (vt) strip(x + 16 - T / 2, y, T, TS);
        // kromlist där glaspartier möts
        if (hz && vt) box(g, x + 16 - 4, y + 16 - 4, 8, 8, '#aeb6c2');
        // reflexer
        g.fillStyle = 'rgba(255,255,255,0.35)';
        if (hz) { g.beginPath(); g.moveTo(x + 6, y + 16 + 3); g.lineTo(x + 12, y + 16 - 3); g.lineTo(x + 16, y + 16 - 3); g.lineTo(x + 10, y + 16 + 3); g.fill(); }
        if (vt && !hz) { g.beginPath(); g.moveTo(x + 16 - 3, y + 6); g.lineTo(x + 16 + 3, y + 10); g.lineTo(x + 16 + 3, y + 14); g.lineTo(x + 16 - 3, y + 10); g.fill(); }
    });
    // glasdörrarna
    eachTile(def, '+', (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        box(g, x, y + 12, 5, 8, '#aeb6c2'); box(g, x + TS - 5, y + 12, 5, 8, '#aeb6c2');
        box(g, x, y + 12, 5, 2, '#f2f5f8'); box(g, x + TS - 5, y + 12, 5, 2, '#f2f5f8');
        box(g, x + 5, y + 15, TS - 10, 2, 'rgba(255,255,255,0.18)');
        g.strokeStyle = 'rgba(120,205,230,0.5)'; g.lineWidth = 3; g.beginPath(); g.moveTo(x + 4, y + 14); g.lineTo(x + 4, y - 2); g.stroke();
    });
}

function studioBooths(g, def) {
    for (const cx of BOOTHS) {
        // matta under mikrofonen
        g.fillStyle = 'rgba(0,0,0,0.25)'; rr(g, cx - 36, 4 * TS + 2, 76, 70, 8); g.fill();
        g.fillStyle = '#4a1d5e'; rr(g, cx - 38, 4 * TS, 76, 70, 8); g.fill();
        g.strokeStyle = 'rgba(255,200,255,0.3)'; g.lineWidth = 1.2; rr(g, cx - 34, 4 * TS + 4, 68, 62, 6); g.stroke();
        for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(cx - 28 + k * 18, 4 * TS + 10); g.lineTo(cx - 19 + k * 18, 4 * TS + 35); g.lineTo(cx - 28 + k * 18, 4 * TS + 60); g.lineTo(cx - 37 + k * 18, 4 * TS + 35); g.closePath(); g.stroke(); }
        // mikrofonställ med popfilter, notställ
        const my = 4 * TS + 12;
        softShadow(g, cx, my + 4, 7, 7, 0.4);
        disc(g, cx, my, 6, '#0d0b12'); disc(g, cx, my, 3.4, '#9aa3af');
        g.strokeStyle = '#aab3be'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(cx, my); g.lineTo(cx, my + 12); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, my + 13, 6.4, 0, TAU); g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.1)'; g.beginPath(); g.arc(cx, my + 13, 6.4, 0, TAU); g.fill();
        disc(g, cx, my + 13, 2, '#1c1c22');
        box(g, cx + 26, 5 * TS + 12, 3, 16, '#aab3be'); box(g, cx + 22, 5 * TS + 8, 11, 10, '#f6f1e2'); box(g, cx + 24, 5 * TS + 10, 7, 1, '#444'); box(g, cx + 24, 5 * TS + 13, 7, 1, '#444');
        // pall
        softShadow(g, cx - 28, 6 * TS + 6, 8, 8, 0.3); disc(g, cx - 28, 6 * TS + 6, 7.4, '#15131c'); disc(g, cx - 28, 6 * TS + 6, 5.8, '#7c3aed');
    }
    // akustikpaneler på båsens vänstervägg
    foam(g, 2, 3 * TS + 2, 8, 4 * TS - 4, '#3b2a57', '#2d2142');
}

function studioConsole(g, def) {
    slabGroup(g, def, 'D', { side: '#08070c', top: '#17141f', hi: 'rgba(160,140,255,0.35)', ins: 2 });
    const x0 = 2 * TS, y0 = 10 * TS;
    // kanalremsor: fader, rattar, knappar
    for (let i = 0; i < 16; i++) {
        const cx = x0 + 7 + i * 13.75;
        box(g, cx - 5, y0 + 3, 10, 26, '#222030'); box(g, cx - 5, y0 + 3, 10, 1, 'rgba(255,255,255,0.15)');
        disc(g, cx, y0 + 8, 1.7, ['#ef4444', '#22c55e', '#3b82f6', '#eab308'][i & 3]);
        box(g, cx - 0.7, y0 + 13, 1.4, 11, '#050408');
        box(g, cx - 3, y0 + 14 + (i * 7) % 8, 6, 3, '#d7dce3'); box(g, cx - 3, y0 + 14 + (i * 7) % 8, 6, 1, '#fff');
    }
    // skärmar och MIDI-klaviatur ovanpå
    for (const sx of [3 * TS + 8, 6 * TS + 4]) { box(g, sx, y0 - 5, 28, 10, '#0b0b10'); box(g, sx + 1, y0 - 4, 26, 8, '#14323f'); box(g, sx + 1, y0 - 4, 26, 2, 'rgba(255,255,255,0.3)'); }
    // högtalare (monitorer)
    eachTile(def, 'k', (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        box(g, x, y, TS, TS, '#08070c'); box(g, x + 2, y + 2, TS - 4, TS - 4, '#17151f');
        disc(g, x + 16, y + 20, 9, '#07060a'); disc(g, x + 16, y + 20, 7.2, '#2a2833'); disc(g, x + 16, y + 20, 3, '#0c0b10');
        disc(g, x + 16, y + 8, 2.8, '#2a2833');
        g.strokeStyle = 'rgba(255,255,255,0.15)'; g.lineWidth = 1; g.beginPath(); g.arc(x + 16, y + 20, 9, 0, TAU); g.stroke();
    });
    // utrustningsrack (L)
    eachTile(def, 'L', (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, y + 3, TS, TS);
        box(g, x, y, TS, TS, '#101015'); box(g, x + 2, y + 2, TS - 4, TS - 4, '#22222c');
        for (let i = 0; i < 4; i++) { box(g, x + 4, y + 4 + i * 6.5, 24, 5, '#14141b'); disc(g, x + 8, y + 6.5 + i * 6.5, 1.1, '#6b7280'); disc(g, x + 12, y + 6.5 + i * 6.5, 1.1, '#6b7280'); }
    });
    // producentens stol (rullstol) vid bordet
    {
        const cx = 5 * TS + 16, cy = 11 * TS + 20;
        softShadow(g, cx, cy, 11, 11, 0.3);
        disc(g, cx, cy, 11, '#0e0d13'); disc(g, cx, cy, 9, '#2f2745'); box(g, cx - 8, cy + 6, 16, 4, '#1a1627');
        for (let i = 0; i < 5; i++) { const a = i * TAU / 5 + 0.4; g.strokeStyle = '#0a0a0e'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 13, cy + Math.sin(a) * 13); g.stroke(); }
    }
}

function studioLounge(g, def) {
    sofaPaint(g, def, { base: '#1e1230', seat: '#6d28d9', back: '#4c1d95' });
    // soffbord: ett i loungen, ett i kontrollrummet
    coffeeTable(g, def, { side: '#0b0912', top: '#241c33' });
    box(g, 13 * TS + 6, 5 * TS + 8, 14, 10, '#f6f1e2'); box(g, 13 * TS + 8, 5 * TS + 10, 10, 2, '#7c3aed');
    disc(g, 14 * TS + 22, 5 * TS + 16, 6.5, '#15131c'); disc(g, 14 * TS + 22, 5 * TS + 16, 4.8, '#7c3aed'); disc(g, 14 * TS + 22, 5 * TS + 16, 1.6, '#e5e7eb'); // hörlurar
    disc(g, 15 * TS + 12, 5 * TS + 14, 3.4, 'rgba(255,255,255,0.8)'); disc(g, 15 * TS + 12, 5 * TS + 14, 2.2, '#22e5ff');
    box(g, 3 * TS + 6, 12 * TS + 8, 18, 10, '#e8e0d0'); box(g, 4 * TS + 16, 12 * TS + 10, 8, 14, '#1f2937'); box(g, 4 * TS + 17, 12 * TS + 11, 6, 6, '#3b82f6');
    eachTile(def, 'x', (tx, ty) => plantAt(g, tc(tx), tc(ty), tileHash(tx, ty) % 7));
    // golvlampa i loungehörnet
    softShadow(g, 19 * TS + 16, 7 * TS + 18, 6, 6, 0.3); disc(g, 19 * TS + 16, 7 * TS + 18, 5.2, '#1a1424'); disc(g, 19 * TS + 16, 7 * TS + 18, 3.2, '#ffd9a0');
}

function studioDesk(g, def) {
    slabGroup(g, def, 'C', { side: '#0e0a15', top: '#2c2540', hi: 'rgba(160,140,255,0.45)', ins: 3 });
    const x = 18 * TS;
    neonLine(g, [[x + 1.5, 10 * TS + 3], [x + 1.5, 14 * TS - 3]], '#ff2bd6', 2.2);
    // kortterminal vid betalplatsen, dator, mikrofon och kontraktsblock
    box(g, x + 8, 10 * TS + 6, 18, 20, '#1b2230'); box(g, x + 10, 10 * TS + 8, 14, 7, '#86efac'); box(g, x + 10, 10 * TS + 8, 14, 2, 'rgba(255,255,255,0.4)');
    for (let i = 0; i < 3; i++) box(g, x + 11 + i * 4.4, 10 * TS + 18, 3, 3, '#5b6577');
    box(g, x + 8, 11 * TS + 4, 18, 22, '#0b0b10'); box(g, x + 10, 11 * TS + 6, 14, 18, '#0e7490'); box(g, x + 10, 11 * TS + 6, 14, 3, 'rgba(255,255,255,0.3)');
    disc(g, x + 16, 12 * TS + 16, 5, '#15131c'); disc(g, x + 16, 12 * TS + 16, 3.4, '#9aa3af'); box(g, x + 15, 12 * TS + 8, 2, 8, '#9aa3af');
    box(g, x + 8, 13 * TS + 6, 16, 20, '#f6f1e2'); box(g, x + 10, 13 * TS + 9, 12, 1.4, '#444'); box(g, x + 10, 13 * TS + 13, 12, 1.4, '#444'); box(g, x + 10, 13 * TS + 17, 8, 1.4, '#444');
    g.save(); g.translate(x + 28, 12 * TS + 20); g.rotate(PI / 2); label(g, 'BEAT', 0, 0, 7, 'rgba(255,255,255,0.35)', { font: SIGN_FONT, weight: 400 }); g.restore();
}

function studioEntrance(g, def) {
    const x = 10 * TS, y = 14 * TS;
    box(g, x, y, 2 * TS, TS, '#17101f');
    box(g, x + 3, y + 2, 2 * TS - 6, 15, '#3a1a56'); box(g, x + 3, y + 2, 2 * TS - 6, 1.5, '#ff2bd6'); box(g, x + 3, y + 16, 2 * TS - 6, 1.5, '#ff2bd6');
    label(g, 'VÄLKOMMEN', x + TS, y + 10, 6, '#ffb3f0', { font: SIGN_FONT, weight: 400 });
    box(g, x, y + 20, 2 * TS, 12, '#1b2747'); box(g, x, y + 28, 2 * TS, 4, '#2d4474');
    box(g, x - 3, y + 1, 5, 18, '#33254b'); box(g, x + 2 * TS - 2, y + 1, 5, 18, '#33254b');
    exitSign(g, 13 * TS + 6, 14 * TS + 8);
    // prislista och affisch på nedre väggen
    g.fillStyle = 'rgba(6,4,12,0.92)'; rr(g, 2 * TS + 6, 14 * TS + 5, 5 * TS + 8, 22, 4); g.fill();
    g.strokeStyle = 'rgba(196,161,255,0.8)'; g.lineWidth = 1; rr(g, 2 * TS + 7, 14 * TS + 6, 5 * TS + 6, 20, 3); g.stroke();
    label(g, 'SESSION 600 kr', 4 * TS + 26, 14 * TS + 12, 6.4, '#c4a1ff', { font: SIGN_FONT, weight: 400 });
    label(g, 'Inspelning · mix · master', 4 * TS + 26, 14 * TS + 21, 5.6, '#f6f1e2');
    box(g, 15 * TS + 8, 14 * TS + 4, 22, 24, '#f3ead2'); box(g, 15 * TS + 10, 14 * TS + 6, 18, 20, '#2a1a4a');
    g.strokeStyle = '#22e5ff'; g.lineWidth = 1.4; g.beginPath(); for (let i = 0; i <= 14; i++) { const yy = 14 * TS + 16 + Math.sin(i * 0.9) * (i % 3 ? 5 : 2); if (i) g.lineTo(15 * TS + 12 + i, yy); else g.moveTo(15 * TS + 12, yy); } g.stroke();
    neonText(g, 'ÖPPET', 18 * TS + 6, 14 * TS + 16, 12, '#ffb3f0', '#ff2bd6');
}

function paintStudio(g, def) {
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
        const ch = def.rows[ty][tx];
        if (ch !== '#') studioFloor(g, def, tx, ty, ch);
    }
    wallPass(g, def, S_WALL);
    aoPass(g, def);
    studioTopWall(g);
    studioBooths(g, def);
    studioGlass(g, def);
    studioConsole(g, def);
    studioLounge(g, def);
    studioDesk(g, def);
    studioEntrance(g, def);
}

// ── Studions rörliga lager ──
function dynStudio(ctx, st, v, t) {
    const def = st.def;
    const rec = BOOTHS.map((_, i) => { const m = holder(st, 'booth:' + i); return !!(m && m.c.s && m.c.s.ph === 3); });
    const lvl = rec.some(Boolean) ? 1 : 0.35;
    // VU-mätarna på mixerbordet: 16 kanaler, grönt-gult-rött
    const x0 = 2 * TS, y0 = 10 * TS;
    for (let i = 0; i < 16; i++) {
        const cx = x0 + 7 + i * 13.75;
        const lv = Math.max(0, Math.min(1, lvl * (0.25 + 0.75 * Math.abs(Math.sin(t * (3.1 + (i % 5) * 0.9) + i * 1.7)) * (0.6 + 0.4 * Math.sin(t * 1.3 + i)))));
        const n = Math.round(lv * 6);
        for (let k = 0; k < 6; k++) {
            ctx.fillStyle = k < n ? (k > 4 ? '#ef4444' : k > 2 ? '#facc15' : '#22c55e') : 'rgba(255,255,255,0.07)';
            ctx.fillRect(cx - 5 + (k % 2) * 5.2, y0 + 28 - (k >> 1) * 0 - 0, 0, 0);
        }
        // sex LED i en kolumn längs remsans nederkant (mot producenten)
        for (let k = 0; k < 6; k++) {
            ctx.fillStyle = k < n ? (k > 4 ? '#ef4444' : k > 2 ? '#facc15' : '#22c55e') : 'rgba(255,255,255,0.08)';
            ctx.fillRect(cx - 4.5 + k * 1.6, y0 + 26.5, 1.3, 2.4);
        }
        // toppmätare: liten stapel överst
        ctx.fillStyle = n > 4 ? '#ef4444' : '#22c55e'; ctx.fillRect(cx - 4, y0 + 4.4, Math.max(1, lv * 8), 1.3);
    }
    // skärmarnas vågformer
    for (const sx of [3 * TS + 8, 6 * TS + 4]) {
        ctx.strokeStyle = '#4ade80'; ctx.lineWidth = 1; ctx.beginPath();
        for (let i = 0; i <= 24; i++) { const yy = y0 - 0.5 + Math.sin(t * 5 + i * 0.7 + sx) * 2.4 * lvl; if (i) ctx.lineTo(sx + 1 + i, yy); else ctx.moveTo(sx + 1, yy); }
        ctx.stroke();
    }
    // högtalarna pumpar (monitorerna vid mixerbordet och de i loungen)
    for (const [sx, sy] of [[1 * TS, 10 * TS], [9 * TS, 10 * TS], [11 * TS, 3 * TS], [17 * TS, 3 * TS]]) {
        const k = lvl * (0.5 + 0.5 * Math.sin(t * 9));
        ctx.strokeStyle = `rgba(255,255,255,${0.1 + 0.2 * k})`; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(sx + 16, sy + 20, 9 + k * 1.6, 0, TAU); ctx.stroke();
    }
    // rackens lampor
    for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) {
        if ((Math.floor(t * (1.5 + j * 0.7)) + i + r) % 3 === 0) { ctx.fillStyle = ['#22c55e', '#ef4444', '#22e5ff'][j]; ctx.fillRect(1 * TS + 18 + j * 3, (11 + r) * TS + 5.5 + i * 6.5, 2, 2); }
    }
    // REC-lamporna över båsens dörrar
    [2, 7].forEach((tx, i) => {
        const on = rec[i];
        ctx.fillStyle = on ? (Math.floor(t * 2) % 2 ? '#ff3b3b' : '#ff7a7a') : '#4a1212';
        rr(ctx, tx * TS + 6, 7 * TS - 1, 20, 7, 2); ctx.fill();
        label(ctx, 'REC', tx * TS + 16, 7 * TS + 2.6, 5, on ? '#fff' : '#7a2a2a', { font: SIGN_FONT, weight: 400 });
    });
    // skylten flimrar
    const f = (t * 0.29) % 1;
    if (f < 0.02 || (f > 0.05 && f < 0.065)) { ctx.fillStyle = 'rgba(6,4,12,0.6)'; rr(ctx, 236, 6, 232, 19, 4); ctx.fill(); }
    if (Math.floor(t * 2) % 5 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(18 * TS + 10, 10 * TS + 8, 14, 7); }
    exitArrow(ctx, def, t);
}

function accessoryStudio(ctx, n, t) {
    if (n.act === 'rec') {
        // hörlurar, och en handhållen mikrofon när artisten jublar
        const p = at(n, 0.4, 0);
        ctx.strokeStyle = '#111827'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 5.2, n.angle + PI / 2 - 1.2, n.angle + PI / 2 + 1.2); ctx.arc(p.x, p.y, 5.2, n.angle - PI / 2 - 1.2, n.angle - PI / 2 + 1.2); ctx.stroke();
        ctx.fillStyle = '#7c3aed'; for (const sd of [-1, 1]) { const e = at(n, 0.4, sd * 5.4); ctx.beginPath(); ctx.arc(e.x, e.y, 2.4, 0, TAU); ctx.fill(); }
        const hand = n.pose === 'cheer' ? at(n, 3.6 + 3.2 * Math.abs(Math.sin(n.phase * 3)), 13.6) : at(n, 9, 5.6);
        const m = at(n, 0, 0);
        ctx.save(); ctx.translate(hand.x, hand.y); ctx.rotate(Math.atan2(m.y - hand.y, m.x - hand.x));
        ctx.fillStyle = '#15131c'; ctx.fillRect(-1, -1.3, 7, 2.6); ctx.fillStyle = '#9aa3af'; ctx.beginPath(); ctx.arc(7, 0, 2.6, 0, TAU); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(6.4, -0.8, 0.9, 0, TAU); ctx.fill();
        ctx.restore();
        // ljudvågor från munnen
        ctx.strokeStyle = `rgba(255,210,255,${0.35 + 0.25 * Math.sin(t * 8)})`; ctx.lineWidth = 1;
        const w = (t * 1.5 + n.phase) % 1;
        for (let k = 0; k < 2; k++) { const f = (w + k * 0.5) % 1; ctx.globalAlpha = 1 - f; ctx.beginPath(); ctx.arc(p.x, p.y, 7 + f * 9, n.angle - 0.6, n.angle + 0.6); ctx.stroke(); }
        ctx.globalAlpha = 1;
    } else if (n.act === 'phone') {
        const a = n.angle, p = at(n, 8, 3);
        armTo(ctx, n, 1, p.x, p.y);
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(a);
        ctx.fillStyle = '#0b0b10'; rr(ctx, -2.2, -3.4, 4.4, 6.8, 1); ctx.fill();
        ctx.fillStyle = `rgba(120,200,255,${0.6 + 0.3 * Math.sin(t * 3 + n.phase)})`; ctx.fillRect(-1.5, -2.8, 3, 5.4);
        ctx.restore();
    } else if (n.kind === 'producer' && n.pose === 'work') {
        // hörlurar runt halsen och en hand på ett reglage
        const p = at(n, 0.4, 0);
        ctx.strokeStyle = '#7c3aed'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(p.x, p.y, 5.2, n.angle + PI / 2 - 1.1, n.angle + PI / 2 + 1.1); ctx.arc(p.x, p.y, 5.2, n.angle - PI / 2 - 1.1, n.angle - PI / 2 + 1.1); ctx.stroke();
    }
}

function lightsStudio(ctx, st, v, t, glow) {
    [2, 7].forEach((tx, i) => { const m = holder(st, 'booth:' + i); if (m && m.c.s && m.c.s.ph === 3) glow(tx * TS + 16, 7 * TS + 2, 54, '#ff2a2a', 0.3 + 0.12 * Math.sin(t * 6)); });
    for (let i = 0; i < 6; i++) glow(2 * TS + 14 + i * 30, 10 * TS + 14, 24, ['#22e5ff', '#ff2bd6', '#a855f7'][i % 3], 0.1 + 0.05 * Math.sin(t * 3 + i));
}

registerStudio();
function registerStudio() {
    room(STUDIO_R, STUDIO, {
        paint: paintStudio, dyn: dynStudio, lights: lightsStudio, accessory: (ctx, n, t) => { accessoryA(ctx, n, t); accessoryStudio(ctx, n, t); },
        glows: [
            [352, 14, 190, '#ff2bd6', 0.3, 0],
            [210, 60, 120, '#7c3aed', 0.14, 2.1],
            [500, 60, 120, '#22e5ff', 0.1, 1.8],
            [128, 130, 90, '#a855f7', 0.1, 0], [288, 130, 90, '#a855f7', 0.1, 0],
            [160, 336, 150, '#7c3aed', 0.12, 0],
            [624, 330, 90, '#ff2bd6', 0.14, 2.6],
            [640, 250, 80, '#ffd9a0', 0.14, 0],
            [352, 466, 80, '#22c55e', 0.12, 3.2]
        ]
    });
}
