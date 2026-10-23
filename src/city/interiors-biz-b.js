// ═══════════════════════════════════════════
//  STAN — verksamheternas rum (b)
//  Nattklubben VIP, KimIT Tech AB, Skyskrapan och RocketFuel Industries.
//  Alla fyra har personal som jobbar hela tiden och kunder som kommer,
//  köar, betalar, gör sitt och går — även innan spelaren köpt stället.
//
//  Gemensam motor (överst): vägsökning över rutnätet, en liten
//  "manusläsare" som styr både personal (loopar) och kunder (en runda
//  genom stället), kö vid disken, rån (panic) och hälsning till ägaren.
//  Rummen (nedan) är sedan bara data + målning + egna detaljer.
// ═══════════════════════════════════════════

import { registerInterior, KIT } from './interiors.js';

const {
    TS, PI, TAU, tc, rand, pick, clamp, SKINS, HAIRS, DRINKS, SIGN_FONT, EMOJI_FONT,
    makeNpc, trySay, turnToward, solidTile, circleClear,
    tileHash, rgba, rr, disc, box, softShadow, neonText, neonLine, zoneAt, eachTile, sprite,
    wallPass, aoPass, slabGroup, carpetTile, plantAt, exitArrow, chAt
} = KIT;

// ═══════════════════════════════════════════
//  RUTNÄT: byggare och vägsökning
// ═══════════════════════════════════════════

// Rutnätsbyggare: rummen skrivs som kod men blir vanliga strängrader (def.rows)
function mkGrid(w, h, doorX) {
    const g = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.')));
    const api = {
        set(x, y, c) { g[y][x] = c; return api; },
        rect(x0, y0, rw, rh, c) { for (let y = y0; y < y0 + rh; y++) for (let x = x0; x < x0 + rw; x++) g[y][x] = c; return api; },
        rows() { return g.map(r => r.join('')); }
    };
    g[h - 1][doorX] = 'e'; g[h - 1][doorX + 1] = 'e';
    return api;
}

// Områden som bara personalen går i (kunderna planerar aldrig rutter dit)
const STAFF_ZONES = new Set(['staff', 'service', 'dj', 'behind']);
const navCache = new WeakMap();
function nav(def, staff) {
    let N = navCache.get(def);
    if (!N) {
        N = { cust: new Uint8Array(def.w * def.h), staff: new Uint8Array(def.w * def.h), ghost: new Uint8Array(def.w * def.h) };
        for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
            const free = !solidTile(def, tx, ty);
            N.ghost[ty * def.w + tx] = def.rows[ty][tx] !== '#' ? 1 : 0;
            N.staff[ty * def.w + tx] = free ? 1 : 0;
            N.cust[ty * def.w + tx] = free && !STAFF_ZONES.has(zoneAt(def, tx, ty)) ? 1 : 0;
        }
        navCache.set(def, N);
    }
    return staff === 2 ? N.ghost : staff ? N.staff : N.cust;
}

const NEI = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const LOS_R = 7; // så mycket luft vill vi ha runt en gående figur

function clearAt(def, M, x, y) {
    if (M === nav(def, 2)) return M[clamp(Math.floor(y / TS), 0, def.h - 1) * def.w + clamp(Math.floor(x / TS), 0, def.w - 1)] === 1;
    return circleClear(def, x, y, LOS_R) && M[clamp(Math.floor(y / TS), 0, def.h - 1) * def.w + clamp(Math.floor(x / TS), 0, def.w - 1)] === 1;
}
function lineClear(def, M, a, b) {
    const d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.ceil(d / 5);
    for (let i = 1; i < n; i++) {
        const k = i / n;
        if (!clearAt(def, M, a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k)) return false;
    }
    return true;
}

// Rutt (lista av punkter) från (x0,y0) till (x1,y1): BFS över lediga rutor, sedan sträckt så att
// den går rakt där det går. null om målet inte går att nå.
function findPath(def, x0, y0, x1, y1, staff) {
    const W = def.w, H = def.h, M = nav(def, staff), ix = (x, y) => y * W + x;
    const tileOf = (x, y) => [clamp(Math.floor(x / TS), 0, W - 1), clamp(Math.floor(y / TS), 0, H - 1)];
    const nearFree = (tx, ty, px, py) => {
        if (M[ix(tx, ty)]) return [tx, ty];
        let best = null, bd = Infinity;
        for (let r = 1; r <= 4 && !best; r++) {
            for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
                const x = tx + dx, y = ty + dy;
                if (x < 0 || y < 0 || x >= W || y >= H || !M[ix(x, y)]) continue;
                const d = (tc(x) - px) ** 2 + (tc(y) - py) ** 2;
                if (d < bd) { bd = d; best = [x, y]; }
            }
        }
        return best;
    };
    const s = nearFree(...tileOf(x0, y0), x0, y0), g = nearFree(...tileOf(x1, y1), x1, y1);
    if (!s || !g) return null;
    const goalTileOk = M[ix(...tileOf(x1, y1))] === 1;
    const end = goalTileOk && (staff === 2 || circleClear(def, x1, y1, LOS_R)) ? { x: x1, y: y1 } : { x: tc(g[0]), y: tc(g[1]) };
    let tiles = [];
    if (s[0] === g[0] && s[1] === g[1]) tiles = [];
    else {
        const prev = new Int16Array(W * H).fill(-1), seen = new Uint8Array(W * H);
        const q = [ix(s[0], s[1])]; seen[q[0]] = 1;
        let found = false;
        for (let qi = 0; qi < q.length && !found; qi++) {
            const cur = q[qi], cx = cur % W, cy = (cur / W) | 0;
            for (let k = 0; k < 8; k++) {
                const nx = cx + NEI[k][0], ny = cy + NEI[k][1];
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
                const ni = ix(nx, ny);
                if (seen[ni] || !M[ni]) continue;
                if (k >= 4 && !(M[ix(cx + NEI[k][0], cy)] && M[ix(cx, cy + NEI[k][1])])) continue; // ingen diagonal runt hörn
                seen[ni] = 1; prev[ni] = cur; q.push(ni);
                if (nx === g[0] && ny === g[1]) { found = true; break; }
            }
        }
        if (!found) return null;
        for (let c = ix(g[0], g[1]); c !== ix(s[0], s[1]); c = prev[c]) tiles.push({ x: tc(c % W), y: tc((c / W) | 0) });
        tiles.reverse();
    }
    const pts = [{ x: x0, y: y0 }, ...tiles, end];
    // sträck: gå så rakt som möjligt
    const out = [];
    let i = 0;
    while (i < pts.length - 1) {
        let j = pts.length - 1;
        while (j > i + 1 && !lineClear(def, M, pts[i], pts[j])) j--;
        out.push(pts[j]); i = j;
    }
    return out;
}

// ═══════════════════════════════════════════
//  FOLK: manusläsaren
//  Alla (personal och kunder) har n.c = { stages, si, mode, path, ... }.
//  Steg (stages):
//    { k:'visit', x, y, a, pose, t:[min,max], drink, prop, sway }  gå dit, gör något en stund
//    { k:'go', x, y, vanish }          gå dit (vanish: tas bort när man kommit fram)
//    { k:'queue' }                     ställ dig i kön, betala vid disken ('sale')
//    { k:'sit', opts:[{sx,sy,fx,fy,a}], t:[min,max] }   sätt dig på en ledig stol/soffa
//    egna steg via spec.hooks (hiss i skyskrapan)
//  Personal loopar sitt manus (c.loop), kunder går det en gång och försvinner.
// ═══════════════════════════════════════════

const PANIC_LINES = ['Lugn!', 'Ta pengarna!', 'Ta det lugnt!', 'Inga konstigheter!', 'Ta kassan, bara!'];
const GREET_LINES = ['Välkommen, chefen!', 'Chefen! Kul att se dig!', 'Hej chefen!'];

function actor(kind, x, y, rnd, o = {}) {
    const n = makeNpc(kind, x, y, rnd, { look: o.look, beh: 'biz', angle: o.angle || 0, pose: o.pose || 'idle', drink: o.drink });
    n.c = {
        stages: o.stages || [], si: 0, mode: 'new', path: null, pi: 0, wait: 0, speed: o.speed || 44,
        loop: !!o.loop, order: o.order || 'seq', staff: !!o.staff, watch: !!o.watch, age: 0,
        seat: null, frozen: false, run: false, tx: x, ty: y, bx: x, by: y
    };
    n.cust = !o.staff;
    if (o.prop) n.prop = o.prop;
    if (o.lines) { n.lines = o.lines; n.chatT = rand(rnd, 5, 22); }
    return n;
}

function aim(n, def, x, y) {
    const c = n.c;
    c.tx = x; c.ty = y; c.ghost = false;
    c.path = findPath(def, n.x, n.y, x, y, c.staff || c.wide);
    // inget vanligt sätt ut (t.ex. personal instängd bakom en disk efter ett bråk): kliv över möblerna
    if (!c.path && c.wide) { c.path = findPath(def, n.x, n.y, x, y, 2); c.ghost = !!c.path; }
    c.pi = 0;
    return !!c.path;
}

function walkStep(n, def, dt) {
    const c = n.c, p = c.path && c.path[c.pi];
    if (!p) return true;
    const dx = p.x - n.x, dy = p.y - n.y, d = Math.hypot(dx, dy), m = c.speed * (c.run ? 1.55 : 1) * dt;
    const ox = n.x, oy = n.y;
    if (d <= m + 0.01) { n.x = p.x; n.y = p.y; c.pi++; } else {
        n.x += dx / d * m; n.y += dy / d * m;
        turnToward(n, Math.atan2(dy, dx), dt * 10);
    }
    n.phase += Math.hypot(n.x - ox, n.y - oy) * 0.12;
    n.pose = 'walk';
    // aldrig in i väggar/möbler: backa och planera om
    if (!c.ghost && !circleClear(def, n.x, n.y, 5) && circleClear(def, ox, oy, 5)) { n.x = ox; n.y = oy; c.pi = Math.max(0, c.pi - 1); aim(n, def, c.tx, c.ty); }
    return c.pi >= c.path.length;
}

// Mjuk knuff så att gående inte går genom varandra
function separate(n, state, dt) {
    const def = state.def, npcs = state.npcs;
    let px = 0, py = 0;
    for (let i = 0; i < npcs.length; i++) {
        const o = npcs[i];
        if (o === n || !o.c) continue;
        const dx = n.x - o.x, dy = n.y - o.y, d2 = dx * dx + dy * dy;
        if (d2 > 15 * 15 || d2 < 0.01) continue;
        const d = Math.sqrt(d2), k = (15 - d) / 15;
        px += dx / d * k; py += dy / d * k;
    }
    if (px || py) {
        const nx = n.x + px * 34 * dt, ny = n.y + py * 34 * dt;
        if (circleClear(def, nx, ny, 6)) { n.x = nx; n.y = ny; }
    }
}

function poseTick(n, dt) {
    switch (n.pose) {
        case 'idle': n.phase += (Math.round(n.phase / PI) * PI - n.phase) * Math.min(1, dt * 5); break;
        case 'dance': n.phase += dt * 3.3; break;
        case 'cheer': n.phase += dt * 2; break;
        case 'sit': n.phase += dt * 1.6; break;
        default: n.phase += dt * 1.5;
    }
}

function biz(state, spec, rnd) {
    let B = state.biz;
    if (B) return B;
    B = state.biz = { spawnT: rand(rnd, 1.2, 3.5), queue: [], taken: new Set(), greeted: false, panic: false, panicSayT: 0, ex: spec.initEx ? spec.initEx(state) : null };
    const q = state.npcs.filter(n => n.c && !n.brawl && n.c.mode === 'queue').sort((a, b) => a.c.qo - b.c.qo);
    for (const n of q) B.queue.push(n);
    for (const n of state.npcs) if (n.c && n.c.seat && !n.brawl) B.taken.add(n.c.seat.key);
    return B;
}

function nextStage(n, state, B, rnd, spec) {
    const c = n.c;
    if (c.seat) { B.taken.delete(c.seat.key); c.seat = null; }
    if (c.order === 'rand' && c.stages.length > 1) {
        let i = Math.min(c.stages.length - 1, Math.floor(rnd() * c.stages.length));
        if (i === c.si) i = (i + 1) % c.stages.length;
        c.si = i;
    } else c.si++;
    startStage(n, state, B, rnd, spec);
}

function startStage(n, state, B, rnd, spec) {
    const c = n.c, def = state.def;
    for (let guard = 0; guard < 6; guard++) {
        if (c.si >= c.stages.length) {
            if (c.loop && c.stages.length) c.si = 0;
            else { n.dead = true; c.mode = 'dead'; return; }
        }
        const s = c.stages[c.si];
        const hook = spec.hooks && spec.hooks[s.k];
        if (hook) {
            const r = hook.start(n, s, state, B, rnd);
            if (r === 'skip') { c.si++; continue; }
            c.mode = 'hook'; return;
        }
        switch (s.k) {
            case 'queue':
                B.queue.push(n); c.mode = 'queue'; c.qs = -1; c.payT = undefined; return;
            case 'sit': {
                const free = s.opts.filter(o => !B.taken.has(o.key));
                if (!free.length) { c.si++; continue; }
                const o = free[Math.min(free.length - 1, Math.floor(rnd() * free.length))];
                B.taken.add(o.key); c.seat = o;
                if (!aim(n, def, o.fx, o.fy)) { B.taken.delete(o.key); c.seat = null; c.si++; continue; }
                c.mode = 'walk'; return;
            }
            default: // visit, go
                if (!aim(n, def, s.x, s.y)) { c.si++; continue; }
                c.mode = 'walk'; return;
        }
    }
    n.dead = true; c.mode = 'dead';
}

function arrive(n, state, B, rnd, spec) {
    const c = n.c, s = c.stages[c.si];
    if (c.seat && s.k === 'sit') { // glid in på stolen
        c.slide = { x0: n.x, y0: n.y, x1: c.seat.sx, y1: c.seat.sy, t: 0, dur: 0.5, out: false };
        c.mode = 'slide'; return;
    }
    if (s.vanish) { n.dead = true; c.mode = 'dead'; return; }
    if (s.t) {
        c.mode = 'stay'; c.wait = rand(rnd, s.t[0], s.t[1]);
        n.pose = s.pose || 'idle'; c.face = s.a == null ? n.angle : s.a;
        c.bx = n.x; c.by = n.y; c.sway = !!s.sway; c.swayK = 0;
        if (s.drink !== undefined) n.drink = s.drink || null;
        if (s.prop !== undefined) n.prop = s.prop || null;
        if (s.say && rnd() < 0.6) trySay(state, n, s.say, 2.4);
        return;
    }
    nextStage(n, state, B, rnd, spec);
}

function stayStep(n, state, B, dt, rnd, spec) {
    const c = n.c, def = state.def;
    poseTick(n, dt);
    let want = c.face;
    const f = state.focus;
    if (f && c.watch && n.pose !== 'dance') {
        const fx = f.x - n.x, fy = f.y - n.y;
        if (fx * fx + fy * fy < 140 * 140) want = Math.atan2(fy, fx);
    }
    if (c.sway) { // dans: lite svaj runt platsen
        const t = state.t, ph = n.phase * 0.17, k = c.swayK = Math.min(1, (c.swayK || 0) + dt);
        const nx = c.bx + Math.sin(t * 0.55 + ph) * 6 * k, ny = c.by + Math.cos(t * 0.8 + ph * 1.7) * 4 * k;
        if (circleClear(def, nx, ny, 5)) { n.x = nx; n.y = ny; }
        want = -PI / 2 + Math.sin(t * 0.9 + ph) * 0.8;
        turnToward(n, want, dt * 8);
    } else turnToward(n, want, dt * 6);
    c.wait -= dt;
    if (c.wait > 0) return;
    if (c.seat) { // resa sig och gå ut ur stolen
        c.slide = { x0: n.x, y0: n.y, x1: c.seat.fx, y1: c.seat.fy, t: 0, dur: 0.45, out: true };
        c.mode = 'slide'; return;
    }
    nextStage(n, state, B, rnd, spec);
}

function slideStep(n, state, B, dt, rnd, spec) {
    const c = n.c, s = c.slide;
    s.t += dt;
    const k = clamp(s.t / s.dur, 0, 1), e = k * k * (3 - 2 * k);
    n.x = s.x0 + (s.x1 - s.x0) * e; n.y = s.y0 + (s.y1 - s.y0) * e;
    n.pose = 'sit'; // sittande hela glidet (stolen är en solid ruta; sittande figurer undantas)
    if (!s.out) turnToward(n, c.seat.a, dt * 10);
    if (k < 1) return;
    c.slide = null;
    if (s.out) n.pose = 'idle';
    if (!s.out) {
        const st = c.stages[c.si];
        c.mode = 'stay'; c.wait = rand(rnd, st.t[0], st.t[1]); n.pose = 'sit'; c.face = c.seat.a; c.sway = false;
        if (st.drink !== undefined) n.drink = st.drink || null;
        if (st.prop !== undefined) n.prop = st.prop || null;
    } else nextStage(n, state, B, rnd, spec);
}

function queueStep(n, state, B, dt, rnd, spec) {
    const c = n.c, def = state.def;
    const idx = B.queue.indexOf(n);
    if (idx < 0) { B.queue.push(n); return; }
    const slot = def.queue[Math.min(idx, def.queue.length - 1)];
    if (c.qs !== idx) {
        c.qs = idx;
        if (Math.hypot(n.x - slot.x, n.y - slot.y) > 3) { aim(n, def, slot.x, slot.y); c.qw = true; }
    }
    if (c.qw) {
        if (walkStep(n, def, dt)) { c.qw = false; n.pose = 'idle'; }
        else { separate(n, state, dt); return; }
    }
    poseTick(n, dt);
    n.pose = 'idle';
    const ahead = idx === 0 ? def.counter : def.queue[Math.min(idx, def.queue.length - 1) - 1] || def.counter;
    turnToward(n, Math.atan2(ahead.y - n.y, ahead.x - n.x), dt * 6);
    if (idx !== 0) return;
    if (c.payT === undefined) c.payT = rand(rnd, 2.3, 4.4);
    c.payT -= dt;
    if (c.payT > 0) return;
    state.events.push({ type: 'sale', x: def.counter.x, y: def.counter.y });
    B.queue.splice(0, 1);
    if (spec.onPay) spec.onPay(n, state, B, rnd);
    nextStage(n, state, B, rnd, spec);
}

function startPanic(state, B, rnd, spec) {
    B.panic = true; B.panicSayT = 0;
    for (const n of state.npcs) {
        const c = n.c;
        if (!c || n.brawl) continue; // slagsmål sköts av spelet
        if (c.staff) { // även den som sitter reser sig: händerna upp på ledig golvruta
            if (c.seat) { B.taken.delete(c.seat.key); n.x = c.seat.fx; n.y = c.seat.fy; c.seat = null; if (c.mode === 'slide') { c.mode = 'stay'; c.wait = 0.5; c.slide = null; } }
            c.frozen = true; n.pose = 'cheer'; n.say = null; continue;
        }
        // kunderna: spring till dörren och ut
        const qi = B.queue.indexOf(n); if (qi >= 0) B.queue.splice(qi, 1);
        if (c.seat) { B.taken.delete(c.seat.key); n.x = c.seat.fx; n.y = c.seat.fy; n.pose = 'idle'; c.seat = null; }
        if (spec.onFlee) spec.onFlee(n, state, B);
        const d = state.def.door, o = outPoint(state.def);
        c.stages = [{ k: 'go', x: d.x, y: d.y }, { k: 'go', x: o.x, y: o.y, vanish: true }];
        c.loop = false; c.run = true; c.si = 0; c.slide = null; c.speed = Math.max(c.speed, 95);
        startStage(n, state, B, rnd, spec);
    }
}

function endPanic(state, B) {
    B.panic = false;
    for (const n of state.npcs) {
        const c = n.c;
        if (!c || n.brawl || !c.staff || !c.frozen) continue;
        c.frozen = false; n.say = null;
        n.pose = c.mode === 'walk' ? 'walk' : (c.stages[c.si] && c.stages[c.si].pose) || 'idle';
    }
}

// punkten precis utanför dörren där kunderna försvinner
function outPoint(def) { return { x: def.door.x, y: def.h * TS - 12 }; }

// Slagsmål: spelet äger NPC:n medan n.brawl är satt. Här släpper vi köplats, stol och hiss.
function release(n, state, B, spec) {
    const c = n.c;
    const qi = B.queue.indexOf(n); if (qi >= 0) B.queue.splice(qi, 1);
    if (c.seat) { B.taken.delete(c.seat.key); c.seat = null; }
    c.slide = null; c.qw = false;
    if (spec.onFlee) spec.onFlee(n, state, B);
}

// Bråket över (n.leaving): personal eller kund, nu går man bara hem via dörren
function sendHome(n, state, B, rnd, spec) {
    const c = n.c;
    release(n, state, B, spec);
    c.staff = false; c.wide = true; c.loop = false; c.watch = false; c.frozen = false; c.run = false; c.back = true;
    c.speed = Math.max(c.speed, 44);
    n.cust = true; n.dead = false; n.say = null;
    c.stages = leaveStages(state.def); c.si = 0;
    startStage(n, state, B, rnd, spec);
}

function actStep(spec, n, state, dt, rnd) {
    const c = n.c;
    if (!c) return false;
    if (n.brawl) { // slagsmål: spelets egen kod flyttar, vänder och byter pose — vi rör inget
        if (!c.brawled) { c.brawled = true; release(n, state, biz(state, spec, rnd), spec); }
        return true;
    }
    const B = biz(state, spec, rnd), def = state.def;
    if (c.brawled) { // bråket slut: skickas hem om spelet sagt det, annars tillbaka till sitt manus
        c.brawled = false;
        if (!n.leaving) { c.mode = 'new'; c.path = null; c.sway = false; }
    }
    if (n.leaving && !c.back) { sendHome(n, state, B, rnd, spec); return true; }
    c.age += dt;
    if (c.frozen) { // rån: personalen står still med händerna upp
        n.pose = 'cheer'; n.phase += dt * 2;
        return true;
    }
    if (c.mode === 'new') { startStage(n, state, B, rnd, spec); return true; }
    // sista säkerhetsnätet: ingen kund blir kvar för evigt
    if (n.cust && c.age > 260 && !c.run) {
        const qi = B.queue.indexOf(n); if (qi >= 0) B.queue.splice(qi, 1);
        if (c.seat) { B.taken.delete(c.seat.key); c.seat = null; }
        if (spec.onFlee) spec.onFlee(n, state, B);
        const o = outPoint(def);
        c.stages = [{ k: 'go', x: def.door.x, y: def.door.y }, { k: 'go', x: o.x, y: o.y, vanish: true }];
        c.si = 0; c.run = true; c.loop = false; c.slide = null; startStage(n, state, B, rnd, spec);
    }
    switch (c.mode) {
        case 'walk':
            if (walkStep(n, def, dt)) arrive(n, state, B, rnd, spec);
            else separate(n, state, dt);
            break;
        case 'stay': stayStep(n, state, B, dt, rnd, spec); break;
        case 'slide': slideStep(n, state, B, dt, rnd, spec); break;
        case 'queue': queueStep(n, state, B, dt, rnd, spec); break;
        case 'hook': {
            const s = c.stages[c.si];
            if (spec.hooks[s.k].step(n, s, state, B, dt, rnd) === true) nextStage(n, state, B, rnd, spec);
            break;
        }
        default: break;
    }
    return true;
}

function bizUpdate(spec, state, dt, rnd) {
    const B = biz(state, spec, rnd), def = state.def, npcs = state.npcs;
    // rån: kunderna flyr, personalen jublar med händerna upp; sedan blir allt som vanligt
    if (state.panic > 0) {
        if (!B.panic) startPanic(state, B, rnd, spec);
        B.panicSayT -= dt;
        if (B.panicSayT <= 0) {
            B.panicSayT = 3.2;
            let k = 0;
            for (const n of npcs) if (n.c && n.c.staff && !n.brawl && k < 4) { n.say = { text: PANIC_LINES[(k + Math.floor(state.t)) % PANIC_LINES.length], life: 2.6 }; k++; }
        }
        state.panic = Math.max(0, state.panic - dt);
        if (state.panic <= 0) { endPanic(state, B); B.spawnT = rand(rnd, 2, 4); }
    } else if (B.panic) { endPanic(state, B); B.spawnT = rand(rnd, 2, 4); }
    // ägaren: personalen hälsar en gång
    if (state.owned && !B.greeted) {
        B.greeted = true;
        let k = 0;
        for (const n of npcs) if (n.c && n.c.staff && !n.brawl && k < 4) { n.say = { text: GREET_LINES[k % GREET_LINES.length], life: 3 }; k++; }
    } else if (!state.owned) B.greeted = false;
    for (let i = B.queue.length - 1; i >= 0; i--) if (B.queue[i].brawl) B.queue.splice(i, 1);
    if (spec.tick) spec.tick(state, B, dt, rnd);
    // bort med dem som gått ut
    for (let i = npcs.length - 1; i >= 0; i--) {
        if (!npcs[i].dead || npcs[i].brawl) continue;
        const qi = B.queue.indexOf(npcs[i]); if (qi >= 0) B.queue.splice(qi, 1);
        if (npcs[i].c && npcs[i].c.seat) B.taken.delete(npcs[i].c.seat.key);
        npcs.splice(i, 1);
    }
    // nya kunder: takten följer state.flow
    if (state.panic > 0) return;
    const flow = clamp(state.flow === undefined ? 1 : state.flow, 0, 3);
    B.spawnT -= dt * flow;
    if (B.spawnT > 0) return;
    let nc = 0;
    for (const n of npcs) if (n.cust && !n.brawl) nc++;
    if (nc >= Math.max(1, Math.round(spec.max * clamp(flow, 0.4, 1.5)))) return;
    if (B.queue.length >= def.queue.length - 1) return;
    const made = spec.spawn(state, B, rnd);
    if (made) { npcs.push(made); B.spawnT = rand(rnd, spec.iv[0], spec.iv[1]); }
}

function doorBlocked(state, x, y, r = 22) {
    for (const n of state.npcs) if (Math.hypot(n.x - x, n.y - y) < r) return true;
    return false;
}

function leaveStages(def) {
    const o = outPoint(def);
    return [{ k: 'go', x: def.door.x, y: def.door.y }, { k: 'go', x: o.x, y: o.y, vanish: true }];
}

// Placera en kund mitt i sitt manus (populate): steg idx, redan på plats
function dropIn(n, idx, rnd, pop) {
    const c = n.c, s = c.stages[idx];
    c.si = idx;
    if (s.k === 'queue') { c.mode = 'queue'; c.qo = pop.q++; c.qs = -1; return n; }
    if (s.k === 'sit') {
        const free = s.opts.filter(o => !pop.taken.has(o.key));
        if (!free.length) return null;
        const o = free[Math.min(free.length - 1, Math.floor(rnd() * free.length))];
        pop.taken.add(o.key);
        c.seat = o; n.x = o.sx; n.y = o.sy; n.pose = 'sit'; n.angle = o.a;
        c.mode = 'stay'; c.wait = rand(rnd, 1, s.t[1]); c.face = o.a;
        if (s.drink !== undefined) n.drink = s.drink || null;
        return n;
    }
    n.x = s.x; n.y = s.y;
    c.mode = 'stay'; c.wait = rand(rnd, 0.5, Math.max(1, s.t ? s.t[1] : 1));
    n.pose = s.pose || 'idle'; n.angle = s.a == null ? n.angle : s.a; c.face = n.angle; c.bx = n.x; c.by = n.y; c.sway = !!s.sway;
    if (s.drink !== undefined) n.drink = s.drink || null;
    if (s.prop !== undefined) n.prop = s.prop || null;
    return n;
}

const V = (x, y, a, pose, t0, t1, o = {}) => ({ k: 'visit', x, y, a, pose, t: [t0, t1], ...o });
// Personal: loopar sitt manus (stages) hela tiden. start = vilket steg man står i från början.
function staffAt(kind, rnd, pop, stages, o = {}) {
    const n = actor(kind, 0, 0, rnd, { staff: true, loop: true, order: o.order || 'seq', watch: !!o.watch, speed: o.speed || 38, look: o.look, stages, lines: o.lines, drink: o.drink, prop: o.prop });
    n.role = kind;
    return dropIn(n, o.start || 0, rnd, pop) || dropIn(n, 0, rnd, pop);
}

// Utseenden
const hairOf = rnd => pick(rnd, HAIRS), skinOf = rnd => pick(rnd, SKINS);
function look(rnd, shirts, o = {}) {
    const L = { shirt: pick(rnd, shirts), skin: skinOf(rnd), hair: hairOf(rnd) };
    if (o.dress && rnd() < o.dress) { L.dress = pick(rnd, o.dressCols || shirts); L.shirt = L.dress; }
    if (o.cap && rnd() < o.cap) L.cap = pick(rnd, o.capCols || ['#111827', '#1d4ed8', '#dc2626']);
    return L;
}

// Gemensamma saker i händerna / på kroppen
function accessoryB(ctx, n, t) {
    const L = n.look || {};
    const p = n.prop, goggles = L.goggles;
    if (!p && !goggles && !L.badge) return;
    ctx.save();
    ctx.translate(n.x, n.y); ctx.rotate(n.angle);
    const walk = n.pose === 'walk';
    const sw = walk ? Math.sin(n.phase) * 3.4 : 0;
    if (p === 'case') { // portfölj i högerhanden
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-3 + sw + 1.5, 12.5, 10, 5);
        ctx.fillStyle = '#6b3f1d'; ctx.fillRect(-3 + sw, 11.5, 10, 5);
        ctx.fillStyle = '#92602f'; ctx.fillRect(-3 + sw, 11.5, 10, 1.4);
        ctx.fillStyle = '#d4a72c'; ctx.fillRect(1.5 + sw, 13.2, 2, 1.6);
    } else if (p === 'tablet') { // surfplatta i båda händerna
        const x = walk ? 8 : 10;
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(x + 1, -5, 7, 10);
        ctx.fillStyle = '#1f2937'; ctx.fillRect(x, -6, 7, 10);
        ctx.fillStyle = '#7dd3fc'; ctx.fillRect(x + 1, -5, 5, 8);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x + 1, -5, 5, 1.6);
    } else if (p === 'cup') { // kaffekopp
        const x = walk ? 6 + sw : 9, y = walk ? 11.5 : 4.5;
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.beginPath(); ctx.arc(x + 1, y + 1.5, 3.4, 0, TAU); ctx.fill();
        ctx.fillStyle = '#f8fafc'; ctx.beginPath(); ctx.arc(x, y, 3.2, 0, TAU); ctx.fill();
        ctx.fillStyle = '#5b3a1a'; ctx.beginPath(); ctx.arc(x, y, 2.1, 0, TAU); ctx.fill();
    } else if (p === 'bag') { // kasse i högerhanden
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(-4 + sw + 1.5, 12.5, 9, 7);
        ctx.fillStyle = '#e11d48'; ctx.fillRect(-4 + sw, 11.5, 9, 7);
        ctx.fillStyle = '#fda4af'; ctx.fillRect(-4 + sw, 11.5, 9, 1.6);
        ctx.fillStyle = '#fff'; ctx.fillRect(-1 + sw, 14, 3, 2);
    } else if (p === 'clip') { // klippbräda
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(10, -5.5, 8, 11);
        ctx.fillStyle = '#92602f'; ctx.fillRect(9, -6.5, 8, 11);
        ctx.fillStyle = '#f8fafc'; ctx.fillRect(10, -5.5, 6, 9);
        ctx.fillStyle = '#94a3b8'; ctx.fillRect(11, -3.5, 4, 0.8); ctx.fillRect(11, -1.5, 4, 0.8); ctx.fillRect(11, 0.5, 4, 0.8);
    } else if (p === 'box') { // bär en låda
        ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(7, -7, 13, 15);
        ctx.fillStyle = '#b4802f'; ctx.fillRect(6, -8, 13, 15);
        ctx.fillStyle = '#d9a24a'; ctx.fillRect(6, -8, 13, 2);
        ctx.fillStyle = '#7a5520'; ctx.fillRect(11.5, -8, 2, 15);
    } else if (p === 'phone') { // mobil mot örat
        ctx.fillStyle = '#111827'; ctx.fillRect(2, -9.5, 5, 2.6);
        ctx.fillStyle = '#60a5fa'; ctx.fillRect(2.6, -9.2, 2.4, 2);
    } else if (p === 'mini') { // miniraket i handen
        ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(7, 8, 13, 4);
        ctx.fillStyle = '#e5e7eb'; ctx.fillRect(6, 7, 11, 3.6);
        ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.moveTo(17, 7); ctx.lineTo(21, 8.8); ctx.lineTo(17, 10.6); ctx.fill();
        ctx.fillStyle = '#ef4444'; ctx.fillRect(5, 6, 3, 1.6); ctx.fillRect(5, 9.8, 3, 1.6);
    }
    if (goggles) { // skyddsglasögon (ses uppifrån som ett band över ögonen)
        ctx.fillStyle = 'rgba(103,232,249,0.9)'; ctx.fillRect(2.4, -4.6, 2.6, 9.2);
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(2.4, -4.6, 1, 9.2);
        ctx.strokeStyle = '#0e7490'; ctx.lineWidth = 0.8; ctx.strokeRect(2.4, -4.6, 2.6, 9.2);
    }
    if (L.badge) { // namnbricka på bröstet
        ctx.fillStyle = L.badge; ctx.fillRect(4.6, 3.2, 2.2, 3);
    }
    ctx.restore();
}


// ═══════════════════════════════════════════
//  GEMENSAMMA MÅLARHJÄLPMEDEL
// ═══════════════════════════════════════════

// Rutor av ett visst tecken, räknade en gång per rum
const tileCache = new WeakMap();
function tilesOf(def, chars) {
    let m = tileCache.get(def);
    if (!m) { m = new Map(); tileCache.set(def, m); }
    let l = m.get(chars);
    if (!l) {
        l = [];
        eachTile(def, chars, (tx, ty) => l.push(tx, ty));
        m.set(chars, l);
    }
    return l;
}
const inView = (v, x, y, r) => x + r >= v.x0 && x - r <= v.x1 && y + r >= v.y0 && y - r <= v.y1;

function plate(g, x, y, w, h, r, fill, stroke, lw = 1) {
    rr(g, x, y, w, h, r); g.fillStyle = fill; g.fill();
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = lw; rr(g, x + 0.5, y + 0.5, w - 1, h - 1, Math.max(0, r - 0.5)); g.stroke(); }
}

// Skylt: mörk platta med neontext
function signPlate(g, text, cx, cy, w, h, size, color, glow, rot = 0) {
    g.save(); g.translate(cx, cy); if (rot) g.rotate(rot);
    g.fillStyle = 'rgba(4,8,16,0.88)'; rr(g, -w / 2, -h / 2, w, h, 5); g.fill();
    g.strokeStyle = rgba(glow, 0.85); g.lineWidth = 1.2; rr(g, -w / 2 + 1, -h / 2 + 1, w - 2, h - 2, 4); g.stroke();
    neonText(g, text, 0, 1, size, color, glow);
    g.restore();
}

// Rund bord sett uppifrån
function roundTable(g, cx, cy, r, side, top, glass) {
    softShadow(g, cx, cy, r + 1, r + 1, 0.35);
    disc(g, cx, cy, r, side); disc(g, cx, cy, r - 1.6, top);
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.arc(cx, cy, r - 1.6, PI * 1.1, PI * 1.6); g.lineTo(cx, cy); g.fill();
    if (glass) { disc(g, cx, cy, 3.4, glass); disc(g, cx, cy, 1.8, '#ffffff'); }
}

// Stol sedd uppifrån; dir = åt vilket håll stolen vänder (0 höger, PI vänster, -PI/2 upp, PI/2 ner)
function chairTop(g, cx, cy, dir, body, seat) {
    g.save(); g.translate(cx, cy); g.rotate(dir);
    g.fillStyle = 'rgba(0,0,0,0.3)'; rr(g, -10, -10, 22, 22, 5); g.fill();
    g.fillStyle = body; rr(g, -11, -10, 22, 20, 5); g.fill();
    g.fillStyle = seat; rr(g, -7, -8, 17, 16, 4); g.fill();
    g.fillStyle = body; rr(g, -12, -10, 5, 20, 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(-12, -10, 1.3, 20);
    g.restore();
}

// Soffsektion; vägg vid sidorna ger ryggstöd
function sofaB(g, def, tx, ty, pal) {
    const x = tx * TS, y = ty * TS;
    const wl = chAt(def, tx - 1, ty) === '#', wr = chAt(def, tx + 1, ty) === '#', wt = chAt(def, tx, ty - 1) === '#', wb = chAt(def, tx, ty + 1) === '#';
    const same = (dx, dy) => chAt(def, tx + dx, ty + dy) === def.rows[ty][tx];
    softShadow(g, x + 16, y + 16, 15, 15, 0.3);
    box(g, x, y, TS, TS, pal.base);
    // ryggstöd där det finns vägg, annars armstöd i ändarna
    const l = wl || !same(-1, 0) && !wt && !wb ? 9 : 2, r = wr || !same(1, 0) && !wt && !wb ? 9 : 2;
    const t = wt ? 9 : 2, b = wb ? 9 : 2;
    g.fillStyle = pal.seat; rr(g, x + l, y + t, TS - l - r, TS - t - b, 4); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.12)'; rr(g, x + l + 2, y + t + 2, TS - l - r - 4, 5, 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; rr(g, x + l, y + t, TS - l - r, TS - t - b, 4); g.stroke();
    g.fillStyle = pal.back;
    if (wt) g.fillRect(x, y, TS, 9); if (wb) g.fillRect(x, y + TS - 9, TS, 9);
    if (wl) g.fillRect(x, y, 9, TS); if (wr) g.fillRect(x + TS - 9, y, 9, TS);
    g.fillStyle = 'rgba(255,255,255,0.14)';
    if (wt) g.fillRect(x, y, TS, 1.5); if (wr) g.fillRect(x + TS - 1.5, y, 1.5, TS);
}

function bottle(g, x, y, col, len = 9) {
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 1, y + 1, 4, len);
    g.fillStyle = col; g.fillRect(x, y, 4, len);
    g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x + 0.6, y, 1, len);
    g.fillStyle = '#1f2937'; g.fillRect(x + 1, y - 2.4, 2, 2.6);
}

// Utgångsskylt (grön ruta)
function exitSign(g, x, y) {
    box(g, x, y, 42, 12, '#052e16'); box(g, x, y, 42, 12, 'rgba(34,197,94,0.25)');
    g.strokeStyle = 'rgba(74,222,128,0.7)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, 41, 11);
    g.font = `7px ${SIGN_FONT}`; g.fillStyle = '#4ade80'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('UTGÅNG', x + 21, y + 6.5);
}


// ═══════════════════════════════════════════
//  1. NATTKLUBBEN VIP  (id: club)
//  Entré med kassa, dansgolv med färgade rutor, DJ-bås, bar, VIP-bås med rep.
//  Blå/turkos stil — ingen scen, ingen show: en vanlig riktigt bra natt.
// ═══════════════════════════════════════════

const CLUB_W = 24, CLUB_H = 16;
const clubGrid = (() => {
    const g = mkGrid(CLUB_W, CLUB_H, 11);
    // DJ-bås: högtalare i sidorna, bord framför, DJ:n står bakom
    g.set(7, 1, 'k').set(7, 2, 'k').set(16, 1, 'k').set(16, 2, 'k').rect(8, 2, 8, 1, 'D');
    // baren längs vänstra väggen: personalen bakom (x1–2), disk (x3), barstolar (x4)
    g.rect(3, 4, 1, 8, 'B').set(1, 3, '2').set(2, 3, '2').set(1, 12, '2').set(2, 12, '2');
    for (const y of [5, 7, 9, 11]) g.set(4, y, 'o');
    // dansgolvet
    g.rect(7, 4, 10, 6, 'd');
    // VIP-båset uppe till höger: rep runt, soffor, bord
    g.rect(17, 1, 1, 4, 'W').rect(17, 7, 6, 1, 'W');
    g.rect(18, 1, 4, 1, 'S').rect(22, 1, 1, 5, 'S').rect(19, 3, 2, 2, 'V').set(22, 6, 'x');
    // loungebord med stolar
    g.set(21, 10, 't').set(20, 10, 'h').set(22, 10, 'h').set(21, 13, 't').set(20, 13, 'h').set(22, 13, 'h');
    g.set(6, 13, 't').set(5, 13, 'h').set(7, 13, 'h');
    // kassan vid entrén
    g.rect(14, 12, 4, 1, '1');
    // växter
    g.set(1, 1, 'x').set(6, 1, 'x').set(1, 14, 'x').set(22, 14, 'x').set(9, 14, 'x');
    return g;
})();

const CLUB_QUEUE = [17, 16, 15, 14, 13].map(x => ({ x: tc(x), y: tc(13) }));

const CLUB_DEF = {
    id: 'club', name: 'Nattklubben VIP', theme: 'biz-club', w: CLUB_W, h: CLUB_H,
    rows: clubGrid.rows(),
    legend: {
        D: { name: 'DJ-bord', solid: true }, k: { name: 'högtalare', solid: true }, B: { name: 'bardisk', solid: true },
        o: { name: 'barstol', solid: true }, W: { name: 'repstolpe', solid: true }, S: { name: 'soffa', solid: true },
        V: { name: 'soffbord', solid: true }, t: { name: 'bord', solid: true }, h: { name: 'stol', solid: true },
        x: { name: 'växt', solid: true }, 1: { name: 'kassadisk', solid: true }, 2: { name: 'backbar', solid: true }
    },
    spawn: { x: 384, y: tc(13) },
    exit: { x: 384, y: 15 * TS + 20, r: 22 },
    door: { x: 384, y: tc(14) },
    counter: { x: 512, y: 12 * TS + 14 },
    queue: CLUB_QUEUE,
    interactions: [{ id: 'counter', label: 'E — Kassan: inträde, ägande, intäkter', x: 528, y: tc(13), r: 66 }],
    music: 'club',
    zones: [
        { x: 8, y: 1, w: 8, h: 1, kind: 'dj' },
        { x: 1, y: 4, w: 2, h: 8, kind: 'service' },
        { x: 18, y: 1, w: 5, h: 6, kind: 'vip' },
        { x: 4, y: 12, w: 14, h: 3, kind: 'foyer' }
    ]
};

// ── Måla ──
const CLUB_PAL = { wall: '#0a1325', face: '#162a4e', hi: '#2e5090', line: '#040810' };

function clubFloorTile(g, def, tx, ty, ch) {
    const x = tx * TS, y = ty * TS, zone = zoneAt(def, tx, ty), h = tileHash(tx, ty);
    if (ch === 'd') {
        const a = (tx + ty) & 1;
        box(g, x, y, TS, TS, a ? '#0b1736' : '#091229');
        g.fillStyle = 'rgba(80,170,255,0.07)'; g.fillRect(x + 4, y + 4, TS - 8, TS - 8);
        g.strokeStyle = a ? 'rgba(60,200,255,0.5)' : 'rgba(80,140,255,0.45)'; g.lineWidth = 1.2; g.strokeRect(x + 3.5, y + 3.5, TS - 7, TS - 7);
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        g.fillStyle = 'rgba(255,255,255,0.05)'; g.beginPath(); g.moveTo(x + 4, y + 4); g.lineTo(x + 14, y + 4); g.lineTo(x + 4, y + 14); g.fill();
        return;
    }
    if (zone === 'vip') return carpetTile(g, x, y, '#0f2860', 'rgba(150,205,255,0.24)');
    if (zone === 'dj') {
        box(g, x, y, TS, TS, '#101830');
        g.strokeStyle = 'rgba(120,180,255,0.16)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        g.beginPath(); g.moveTo(x + 4, y + 16); g.lineTo(x + 28, y + 16); g.stroke();
        return;
    }
    if (zone === 'service') {
        box(g, x, y, TS, TS, '#171e2c');
        g.fillStyle = 'rgba(255,255,255,0.05)';
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(x + 4 + i * 8, y + 4 + j * 8, 3, 3);
        return;
    }
    if (ch === 'e') { box(g, x, y, TS, TS, '#070b16'); return; }
    if (zone === 'foyer') { // svart marmor med blå ådring
        box(g, x, y, TS, TS, (tx + ty) & 1 ? '#0a101e' : '#0c1424');
        g.strokeStyle = 'rgba(80,170,255,0.14)'; g.lineWidth = 1;
        g.beginPath(); g.moveTo(x + (h & 15), y); g.lineTo(x + 8 + (h >> 4 & 15), y + 14); g.lineTo(x + 4 + (h >> 8 & 15), y + TS); g.stroke();
        g.strokeStyle = 'rgba(60,110,200,0.14)'; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        return;
    }
    // svart blank golv med blå sken
    box(g, x, y, TS, TS, (tx + ty) & 1 ? '#0d1526' : '#0b1222');
    g.fillStyle = 'rgba(90,160,255,0.05)'; g.beginPath(); g.moveTo(x, y + 20); g.lineTo(x + 20, y); g.lineTo(x + 28, y); g.lineTo(x, y + 28); g.fill();
    g.strokeStyle = 'rgba(60,110,200,0.12)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
    if (h % 7 === 0) { g.fillStyle = 'rgba(160,220,255,0.18)'; g.fillRect(x + (h >> 3) % 28 + 2, y + (h >> 7) % 28 + 2, 1.6, 1.6); }
}

function paintClubB(g, def) {
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
        const ch = def.rows[ty][tx];
        if (ch !== '#') clubFloorTile(g, def, tx, ty, ch);
    }
    wallPass(g, def, CLUB_PAL);
    aoPass(g, def);
    // ljus runt dansgolvet
    neonLine(g, [[7 * TS + 1, 4 * TS + 1], [17 * TS - 1, 4 * TS + 1], [17 * TS - 1, 10 * TS - 1], [7 * TS + 1, 10 * TS - 1], [7 * TS + 1, 4 * TS + 1]], '#22e5ff', 2);
    clubBarB(g, def);
    clubDjB(g, def);
    clubVipB(g, def);
    clubLoungeB(g, def);
    clubFoyerB(g, def);
    eachTile(def, 'x', (tx, ty) => plantAt(g, tc(tx), tc(ty), tileHash(tx, ty) % 7));
    // neon längs väggarna
    neonLine(g, [[40, 27], [7 * TS - 6, 27]], '#22e5ff', 2.2);
    neonLine(g, [[17 * TS + 8, 27], [23 * TS - 6, 27]], '#8b5cf6', 2.2);
    neonLine(g, [[2 * TS, 15 * TS + 6], [10 * TS, 15 * TS + 6]], '#3b82f6', 2.2);
    neonLine(g, [[14 * TS, 15 * TS + 6], [22 * TS + 8, 15 * TS + 6]], '#3b82f6', 2.2);
    // skyltar
    signPlate(g, 'NATTKLUBBEN VIP', 384, 17, 232, 24, 15, '#9df3ff', '#22d3ee');
    signPlate(g, 'BAR', 16, 8 * TS, 44, 24, 13, '#8cf3ff', '#22e5ff', -PI / 2);
    signPlate(g, 'VIP', 23 * TS + 16, 3.5 * TS, 44, 24, 13, '#ffe38a', '#ffb300', PI / 2);
    g.font = `17px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('🍾', 238, 17); g.fillText('🍾', 530, 17);
    exitSign(g, 8 * TS + 4, 15 * TS + 10);
}

function clubBarB(g, def) {
    // bakbar: flaskhylla längs väggen, kylskåp i ändarna
    const y0 = 4 * TS, hh = 8 * TS;
    box(g, TS, y0, 14, hh, '#0a1220'); box(g, TS + 14, y0, 2, hh, '#22d3ee');
    g.fillStyle = 'rgba(34,211,238,0.18)'; g.fillRect(TS, y0, 14, hh);
    const BOT = ['#38bdf8', '#2dd4bf', '#e2e8f0', '#6366f1', '#22d3ee', '#a78bfa', '#7dd3fc'];
    for (let yy = y0 + 6, i = 0; yy < y0 + hh - 8; yy += 12, i++) {
        bottle(g, TS + 3, yy, BOT[(tileHash(i, 3) >> 3) % BOT.length], 8);
        bottle(g, TS + 9, yy + 1, BOT[(tileHash(i, 9) >> 3) % BOT.length], 7);
    }
    // kyl (tecken 2): rostfritt med glasdörr
    eachTile(def, '2', (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        softShadow(g, x + 16, y + 16, 15, 15, 0.3);
        box(g, x, y, TS, TS, '#2a3444'); box(g, x + 2, y + 2, TS - 4, TS - 4, '#7f93aa'); box(g, x + 2, y + 2, TS - 4, 2, 'rgba(255,255,255,0.35)');
        box(g, x + 5, y + 7, TS - 10, TS - 12, '#10304f'); box(g, x + 5, y + 7, TS - 10, TS - 12, 'rgba(34,211,238,0.25)');
        for (let i = 0; i < 3; i++) bottle(g, x + 7 + i * 6, y + 12, BOT[(tx + ty + i) % BOT.length], 9);
        box(g, x + 5, y + 20, TS - 10, 1.4, 'rgba(255,255,255,0.35)');
    });
    // disken
    slabGroup(g, def, 'B', { side: '#050c18', top: '#123a5e', hi: 'rgba(130,235,255,0.5)' });
    eachTile(def, 'B', (tx, ty) => {
        const h = tileHash(tx, ty), x = tx * TS, y = ty * TS;
        for (let i = 0; i < 2; i++) {
            const gx = x + 9 + ((h >> (i * 5)) & 13), gy = y + 8 + ((h >> (i * 5 + 3)) & 15);
            if ((h >> (i + 9)) & 1) continue;
            disc(g, gx, gy, 3, 'rgba(255,255,255,0.8)'); disc(g, gx, gy, 1.9, BOT[(h >> (i + 2)) % BOT.length]);
        }
    });
    // kassan på baren
    box(g, 3 * TS + 6, 9 * TS + 3, 19, 14, '#0b1220'); box(g, 3 * TS + 8, 9 * TS + 5, 15, 7, '#5eead4'); box(g, 3 * TS + 8, 9 * TS + 5, 15, 2, 'rgba(255,255,255,0.4)');
    neonLine(g, [[4 * TS - 2, 4 * TS + 6], [4 * TS - 2, 12 * TS - 6]], '#22e5ff', 2.2);
    // barstolar
    eachTile(def, 'o', (tx, ty) => {
        const cx = tc(tx), cy = tc(ty);
        softShadow(g, cx, cy, 11, 11, 0.35);
        disc(g, cx, cy, 11, '#8fa2b8'); disc(g, cx, cy, 9.2, '#0e7490'); disc(g, cx - 3, cy - 3, 3.2, 'rgba(255,255,255,0.3)');
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, 11, 0, TAU); g.stroke();
    });
}

function clubDjB(g, def) {
    slabGroup(g, def, 'D', { side: '#05070d', top: '#18213a', hi: 'rgba(120,200,255,0.45)', ins: 2 });
    // högtalare
    eachTile(def, 'k', (tx, ty) => {
        const x = tx * TS, y = ty * TS;
        box(g, x, y, TS, TS, '#05060a'); box(g, x + 2, y + 2, TS - 4, TS - 4, '#12141c');
        disc(g, x + 16, y + 19, 9.5, '#05060a'); disc(g, x + 16, y + 19, 7.5, '#232733'); disc(g, x + 16, y + 19, 3.2, '#0a0b10');
        disc(g, x + 16, y + 7, 2.6, '#232733');
        g.strokeStyle = 'rgba(80,200,255,0.4)'; g.lineWidth = 1; g.beginPath(); g.arc(x + 16, y + 19, 9.5, 0, TAU); g.stroke();
    });
    // utrustning på DJ-bordet (x 256..512, y 64..96)
    for (const px of [300, 468]) {
        box(g, px - 17, 66, 34, 28, '#0a0d16'); box(g, px - 16, 67, 32, 26, '#131a2c');
        disc(g, px, 80, 12.5, '#05060a'); disc(g, px, 80, 11, '#171d2d');
        g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 0.8;
        for (const r of [4, 6.5, 9]) { g.beginPath(); g.arc(px, 80, r, 0, TAU); g.stroke(); }
        disc(g, px, 80, 2.6, px < 384 ? '#22e5ff' : '#a78bfa');
    }
    box(g, 360, 67, 48, 26, '#090c14'); box(g, 361, 68, 46, 24, '#1b2338');
    for (let i = 0; i < 4; i++) { box(g, 365 + i * 10.5, 72, 2.4, 14, '#05070d'); box(g, 364.2 + i * 10.5, 74 + (i * 3) % 7, 4, 3, ['#22e5ff', '#3b82f6', '#2dd4bf', '#8b5cf6'][i]); }
    neonLine(g, [[8 * TS + 2, 3 * TS + 2], [16 * TS - 2, 3 * TS + 2]], '#8b5cf6', 2);
}

function clubVipB(g, def) {
    // rep: först repen, sedan stolparna
    const rope = (x1, y1, x2, y2) => {
        g.lineCap = 'round';
        g.strokeStyle = '#07163a'; g.lineWidth = 5; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        g.strokeStyle = '#2563eb'; g.lineWidth = 3; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x1, y1 - 0.8); g.lineTo(x2, y2 - 0.8); g.stroke();
        g.lineCap = 'butt';
    };
    eachTile(def, 'W', (tx, ty) => {
        if (chAt(def, tx + 1, ty) === 'W') rope(tc(tx), tc(ty), tc(tx + 1), tc(ty));
        if (chAt(def, tx, ty + 1) === 'W') rope(tc(tx), tc(ty), tc(tx), tc(ty + 1));
    });
    eachTile(def, 'W', (tx, ty) => {
        const cx = tc(tx), cy = tc(ty);
        softShadow(g, cx, cy, 7, 7, 0.4);
        disc(g, cx, cy, 6.5, '#27303e'); disc(g, cx, cy, 5.2, '#cbd5e1'); disc(g, cx, cy, 2.6, '#f8fafc');
    });
    eachTile(def, 'S', (tx, ty) => sofaB(g, def, tx, ty, { base: '#0a1b44', seat: '#1d4ed8', back: '#10307a' }));
    // soffbord: glasskiva med champagnekylare
    slabGroup(g, def, 'V', { side: '#c9d6e8', top: '#0c1a33', hi: 'rgba(255,255,255,0.3)', ins: 2 });
    const bx = 20 * TS, by = 4 * TS;
    disc(g, bx, by, 8, '#cbd5e1'); disc(g, bx, by, 6.4, '#7c8aa0'); disc(g, bx, by, 2.4, '#16a34a');
    for (const [dx, dy] of [[-18, -8], [18, 10], [-14, 14], [16, -12]]) { disc(g, bx + dx, by + dy, 2.8, 'rgba(255,255,255,0.8)'); disc(g, bx + dx, by + dy, 1.8, '#a5f3fc'); }
    // "VIP" invävd i mattan
    g.save(); g.translate(18.5 * TS, 5.2 * TS); g.rotate(-PI / 2);
    g.font = `13px ${SIGN_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = 'rgba(190,225,255,0.4)'; g.fillText('VIP', 0, 0);
    g.restore();
}

function clubLoungeB(g, def) {
    eachTile(def, 'h', (tx, ty) => {
        const right = chAt(def, tx - 1, ty) === 't'; // stolen står till höger om bordet?
        const left = chAt(def, tx + 1, ty) === 't';
        chairTop(g, tc(tx), tc(ty), left ? 0 : right ? PI : PI / 2, '#0a1b44', '#2563eb');
    });
    eachTile(def, 't', (tx, ty) => {
        const cx = tc(tx), cy = tc(ty), h = tileHash(tx, ty);
        roundTable(g, cx, cy, 14, '#0a1020', '#143a63', '#5eead4');
        for (let i = 0; i < 2; i++) {
            const a = (h >> (i * 4)) % 6 + i * PI, gx = cx + Math.cos(a) * 8, gy = cy + Math.sin(a) * 8;
            disc(g, gx, gy, 2.8, 'rgba(255,255,255,0.8)'); disc(g, gx, gy, 1.8, DRINKS[(h >> (i + 5)) % DRINKS.length]);
        }
    });
}

function clubFoyerB(g, def) {
    // mattan från dörren
    const x = 11 * TS, y = 13 * TS;
    box(g, x + 3, y + 2, 2 * TS - 6, 2 * TS - 4, '#0b2447'); box(g, x + 3, y + 2, 2 * TS - 6, 2 * TS - 4, 'rgba(34,211,238,0.1)');
    g.strokeStyle = 'rgba(34,229,255,0.6)'; g.lineWidth = 1.5; g.strokeRect(x + 4.5, y + 3.5, 2 * TS - 9, 2 * TS - 7);
    // kassan
    slabGroup(g, def, '1', { side: '#050c18', top: '#16405f', hi: 'rgba(130,235,255,0.5)' });
    box(g, 14 * TS + 4, 12 * TS + 5, 22, 20, '#0b1220'); box(g, 14 * TS + 6, 12 * TS + 7, 18, 9, '#5eead4'); box(g, 14 * TS + 6, 12 * TS + 7, 18, 2.4, 'rgba(255,255,255,0.45)');
    box(g, 14 * TS + 7, 12 * TS + 18, 16, 6, '#1f2937'); for (let i = 0; i < 4; i++) box(g, 14 * TS + 9 + i * 3.6, 12 * TS + 20, 2.4, 2.4, '#94a3b8');
    // prislapp
    plate(g, 14 * TS + 30, 12 * TS + 7, 72, 18, 4, '#050b16', '#22d3ee', 1.2);
    g.font = `7px ${SIGN_FONT}`; g.fillStyle = '#9df3ff'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('INGÅNG 200', 14 * TS + 66, 12 * TS + 16.5);
    // kreditkortsläsare + biljettbunt
    box(g, 17 * TS + 12, 12 * TS + 7, 14, 17, '#111827'); box(g, 17 * TS + 14, 12 * TS + 9, 10, 5, '#38bdf8'); box(g, 17 * TS + 14, 12 * TS + 16, 10, 5, '#475569');
    // ingångsdörrar (öppna glasdörrar mot nattgatan)
    const dx = 11 * TS, dy = 15 * TS, w = 2 * TS;
    box(g, dx, dy, w, TS, '#050914');
    box(g, dx, dy + 18, w, 14, '#0d1c3d'); box(g, dx, dy + 26, w, 6, '#1a3a78');
    box(g, dx - 2, dy + 1, 4, 17, '#7f93aa'); box(g, dx + w - 2, dy + 1, 4, 17, '#7f93aa');
    box(g, dx - 1, dy + 2, 2, 15, 'rgba(160,230,255,0.5)'); box(g, dx + w - 1, dy + 2, 2, 15, 'rgba(160,230,255,0.5)');
    neonLine(g, [[dx - 4, dy + 1], [dx - 4, dy + 22]], '#22e5ff', 2); neonLine(g, [[dx + w + 4, dy + 1], [dx + w + 4, dy + 22]], '#22e5ff', 2);
}

// ── Rörligt lager ──
const CLUB_COLS = ['#22e5ff', '#3b82f6', '#2dd4bf', '#8b5cf6'];

function dynClubB(ctx, state, v, t) {
    const def = state.def;
    // dansgolvet pulserar i blått och turkos
    const step = Math.floor(t * 2.4), dl = tilesOf(def, 'd');
    for (let i = 0; i < dl.length; i += 2) {
        const tx = dl[i], ty = dl[i + 1], x = tx * TS, y = ty * TS;
        if (x > v.x1 || x + TS < v.x0 || y > v.y1 || y + TS < v.y0) continue;
        ctx.globalAlpha = 0.07 + (Math.sin(t * 3.2 - (tx + ty) * 0.7) * 0.5 + 0.5) * 0.26;
        ctx.fillStyle = CLUB_COLS[(tx * 3 + ty * 5 + step) & 3];
        ctx.fillRect(x + 4, y + 4, TS - 8, TS - 8);
    }
    ctx.globalAlpha = 1;
    // DJ-podiet: LED-rutor som följer takten
    for (let x = 8; x < 16; x++) {
        const px = x * TS, py = TS;
        if (px > v.x1 || px + TS < v.x0) continue;
        const lv = 0.5 + 0.5 * Math.sin(t * 5.1 + x * 1.3);
        ctx.globalAlpha = 0.1 + lv * 0.3; ctx.fillStyle = CLUB_COLS[(x + step) & 3];
        ctx.fillRect(px + 3, py + 3, TS - 6, TS - 6);
    }
    ctx.globalAlpha = 1;
    // högtalarna pumpar i bastakt
    const beat = (t * 2.1) % 1;
    for (const [tx, ty] of [[7, 1], [7, 2], [16, 1], [16, 2]]) {
        const cx = tx * TS + 16, cy = ty * TS + 19;
        ctx.strokeStyle = `rgba(80,220,255,${0.55 * (1 - beat)})`; ctx.lineWidth = 1.4;
        ctx.beginPath(); ctx.arc(cx, cy, 7 + beat * 6, 0, TAU); ctx.stroke();
        disc(ctx, cx, cy, 3.2 + (beat < 0.25 ? 1.3 : 0), '#2a3040');
    }
    // DJ:ns skivor snurrar, ljudnivån hoppar
    for (const px of [300, 468]) {
        ctx.save(); ctx.translate(px, 80); ctx.rotate(t * 3.6 + px);
        ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.arc(0, 0, 8, 0, 1.2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.6)'; ctx.fillRect(8.5, -0.7, 2.6, 1.4);
        ctx.restore();
    }
    for (let i = 0; i < 4; i++) {
        const lv = 0.3 + 0.7 * Math.abs(Math.sin(t * (4.1 + i * 1.3) + i));
        ctx.fillStyle = lv > 0.85 ? '#f43f5e' : lv > 0.55 ? '#facc15' : '#22d3ee';
        ctx.fillRect(364.4 + i * 10.5, 91 - lv * 9, 3.6, lv * 9);
    }
    // skylten flimrar till ibland
    const f = (t * 0.27) % 1;
    if (f < 0.02 || (f > 0.05 && f < 0.065)) { ctx.fillStyle = 'rgba(4,8,16,0.65)'; rr(ctx, 270, 7, 228, 20, 4); ctx.fill(); }
    // kassaskärmen
    if (Math.floor(t * 1.7) % 6 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(14 * TS + 6, 12 * TS + 7, 18, 9); }
    exitArrow(ctx, def, t);
}

const CLUB_GLOWS = [
    [384, 24, 190, '#22d3ee', 0.3, 0],
    [384, 66, 170, '#3b82f6', 0.28, 2.2],
    [112, 250, 150, '#22e5ff', 0.2, 0],
    [112, 400, 110, '#22e5ff', 0.14, 0],
    [660, 110, 170, '#3b82f6', 0.26, 1.7],
    [735, 112, 100, '#ffb300', 0.16, 0],
    [384, 200, 150, '#2dd4bf', 0.13, 1.4],
    [512, 400, 90, '#22e5ff', 0.22, 0],
    [384, 492, 120, '#3b82f6', 0.26, 1.7],
    [680, 330, 90, '#22d3ee', 0.1, 0]
];
const CLUB_BEAMS = [
    [300, 34, '#22e5ff', 230, 52, 0.5, 0.9, 0], [350, 34, '#3b82f6', 250, 52, 0.46, 1.1, 1.7],
    [418, 34, '#8b5cf6', 250, 52, 0.46, 1.0, 3.1], [468, 34, '#2dd4bf', 230, 52, 0.5, 0.8, 4.4]
];
function coneB(hex) {
    return sprite('bcone' + hex, 64, 256, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, rgba(hex, 0.75)); gr.addColorStop(1, rgba(hex, 0));
        g.fillStyle = gr;
        for (const k of [1, 0.78, 0.56]) {
            g.globalAlpha = k === 1 ? 0.35 : 0.4;
            g.beginPath(); g.moveTo(w / 2 - 2 * k, 0); g.lineTo(w / 2 + 2 * k, 0); g.lineTo(w / 2 + (w / 2) * k, h); g.lineTo(w / 2 - (w / 2) * k, h); g.closePath(); g.fill();
        }
    });
}
function lightsClubB(ctx, state, v, t, glow) {
    glow(384 + Math.sin(t * 0.6) * 80, 210 + Math.cos(t * 0.5) * 30, 230, '#3b82f6', 0.1);
    glow(384 + Math.cos(t * 0.45) * 100, 215 + Math.sin(t * 0.7) * 30, 200, '#22e5ff', 0.08);
    for (let i = 0; i < 7; i++) {
        const x = 384 + Math.cos(t * 0.5 + i * 0.9) * (50 + 17 * i), y = 205 + Math.sin(t * 0.7 + i * 1.7) * 60;
        glow(x, y, 16, CLUB_COLS[(i + Math.floor(t)) & 3], 0.34);
    }
    for (let i = 0; i < CLUB_BEAMS.length; i++) {
        const b = CLUB_BEAMS[i], cone = coneB(b[2]);
        if (!cone) continue;
        ctx.save();
        ctx.translate(b[0], b[1]); ctx.rotate(Math.sin(t * b[6] + b[7]) * b[5]);
        ctx.globalAlpha = 0.5;
        ctx.drawImage(cone, -b[4] / 2, 0, b[4], b[3]);
        ctx.restore();
    }
    const tb = tilesOf(state.def, 't'), flick = 0.85 + 0.15 * Math.sin(t * 9);
    for (let i = 0; i < tb.length; i += 2) glow(tc(tb[i]), tc(tb[i + 1]), 24, '#5eead4', 0.2 * flick);
}

// ── Folk ──
const CLUB_LINES = {
    cashier: ['Ingång tvåhundra.', 'Nästa!', 'Kort eller swish?', 'Hej, välkommen in.'],
    bartender: ['Vad blir det?', 'En till?', 'Skål!', 'Blå Lagoon på g.'],
    dj: ['Hands up!', 'Mera bas!', 'Nu kör vi!', 'Vem vill ha en önskelåt?'],
    guard: ['Inga bråk här.', 'Ta det lugnt.', 'Köa som alla andra.', 'Namnet på listan?'],
    waitress: ['Champagne på väg!', 'Ursäkta!', 'Passa brickan!'],
    guest: ['Wooo!', 'Skål!', 'Bäst natt!', 'Kom, vi dansar!', 'Yalla!']
};
const CLUB_SHIRTS = ['#ef4444', '#3b82f6', '#22c55e', '#eab308', '#f97316', '#a855f7', '#14b8a6', '#f8fafc', '#0ea5e9', '#111827', '#1d4ed8', '#e11d48'];
const clubLook = rnd => {
    const L = look(rnd, CLUB_SHIRTS, { dress: 0.4, dressCols: ['#e11d48', '#a855f7', '#0ea5e9', '#14b8a6', '#f8fafc', '#facc15', '#ec4899'], cap: 0.12 });
    if (L.dress && rnd() < 0.5) L.sparkle = true;
    return L;
};

const clubBarSpots = [4, 6, 8, 10].map(ty => ({ x: tc(4), y: tc(ty) }));
const clubDanceTiles = [];
for (let ty = 5; ty <= 8; ty++) for (let tx = 8; tx <= 15; tx++) clubDanceTiles.push({ x: tc(tx), y: tc(ty) });
// stolar: sx/sy = stolens mitt, fx/fy = ledig ruta man kommer från, a = vänd mot bordet
const seat = (tx, ty, ftx, fty, a) => ({ key: tx + ',' + ty, sx: tc(tx), sy: tc(ty), fx: tc(ftx), fy: tc(fty), a });
const CLUB_LOUNGE = [seat(5, 13, 5, 14, 0), seat(7, 13, 7, 14, PI), seat(20, 13, 20, 14, 0), seat(22, 13, 22, 14, PI), seat(20, 10, 19, 10, 0), seat(22, 10, 22, 11, PI)];
const CLUB_VIPSEATS = [seat(19, 1, 19, 2, PI / 2), seat(21, 1, 21, 2, PI / 2), seat(22, 3, 21, 2, PI), seat(22, 5, 21, 5, PI)];

function clubScript(rnd, drink) {
    const dance = () => ({ k: 'visit', ...pick(rnd, clubDanceTiles), a: -PI / 2, pose: 'dance', t: [14, 34], sway: true, drink: rnd() < 0.3 ? pick(rnd, DRINKS) : null });
    const bar = () => ({ k: 'visit', ...pick(rnd, clubBarSpots), a: PI, pose: 'idle', t: [6, 12], drink: pick(rnd, DRINKS), say: 'En blå, tack!' });
    const lounge = () => ({ k: 'sit', opts: CLUB_LOUNGE, t: [10, 22], drink: pick(rnd, DRINKS) });
    const vip = () => ({ k: 'sit', opts: CLUB_VIPSEATS, t: [10, 20], drink: '#fde68a' });
    const r = rnd();
    const mid = r < 0.35 ? [bar(), dance()] : r < 0.7 ? [dance(), bar(), dance()] : r < 0.88 ? [dance(), lounge(), dance()] : [vip(), dance()];
    return [{ k: 'queue' }, ...mid, ...leaveStages(CLUB_DEF)];
}

function clubGuest(rnd, from) {
    const n = actor('guest', from.x, from.y, rnd, { look: clubLook(rnd), stages: clubScript(rnd), speed: rand(rnd, 44, 54), lines: CLUB_LINES.guest, angle: -PI / 2 });
    return n;
}

function populateClubB(def, rnd) {
    const npcs = [], pop = { q: 0, taken: new Set() };
    const add = n => { if (n) npcs.push(n); return n; };
    const H = PI / 2;
    add(staffAt('cashier', rnd, pop, [V(tc(15), 368, H, 'work', 6, 12), V(tc(16), 368, H, 'work', 5, 10)], { watch: true, lines: CLUB_LINES.cashier, look: { shirt: '#0e7490', skin: '#c68642', hair: '#111111' } }));
    add(staffAt('bartender', rnd, pop, [V(tc(2), tc(5), 0, 'work', 4, 9), V(tc(2), tc(6) + 6, 0, 'work', 4, 8), V(tc(2), tc(8), 0, 'work', 4, 9), V(tc(2), tc(10), 0, 'work', 4, 9)], { order: 'rand', start: 1, watch: true, lines: CLUB_LINES.bartender, look: { shirt: '#f8fafc', skin: '#c68642', hair: '#3f2a14' } }));
    add(staffAt('dj', rnd, pop, [V(tc(10), tc(1), H, 'work', 3, 7), V(tc(12), tc(1), H, 'work', 3, 7), V(tc(13) + 8, tc(1), H, 'work', 3, 7), V(tc(14), tc(1), H, 'work', 3, 7)], { order: 'rand', start: 1, speed: 28, lines: CLUB_LINES.dj, look: { shirt: '#1e1b4b', skin: '#e0ac69', hair: '#111111', cap: '#22d3ee' } }));
    add(staffAt('guard', rnd, pop, [V(tc(10), tc(13), 0, 'idle', 6, 11), V(tc(10), tc(11), -0.35, 'idle', 5, 9)], { watch: true, lines: CLUB_LINES.guard, look: { shirt: '#111827', skin: '#8d5524', hair: '#111111', cap: '#0f172a' } }));
    add(staffAt('guard', rnd, pop, [V(tc(18), tc(5), PI, 'idle', 8, 14), V(tc(18), tc(6) - 4, PI, 'idle', 6, 10)], { watch: true, start: 1, lines: CLUB_LINES.guard, look: { shirt: '#1e293b', skin: '#c68642', hair: '#111111', cap: '#0f172a' } }));
    add(staffAt('waitress', rnd, pop, [V(tc(5), tc(6), 0, 'idle', 1.5, 3), V(tc(19), tc(11), 0, 'idle', 2, 3.5), V(tc(21), tc(14), -PI / 2, 'idle', 2, 3.5), V(tc(19), tc(5), H, 'idle', 2, 3.5), V(tc(5), tc(14), -PI / 2, 'idle', 1.5, 3)], { speed: 50, lines: CLUB_LINES.waitress, drink: '#f8fafc', look: { shirt: '#111827', skin: '#e0ac69', hair: '#d4a017', dress: '#0e7490' } }));
    // kön vid kassan
    for (let i = 0; i < 2; i++) add(dropIn(clubGuest(rnd, CLUB_QUEUE[i]), 0, rnd, pop));
    // folk mitt i sin natt
    for (let i = 0; i < 9; i++) {
        const n = clubGuest(rnd, def.door), mid = n.c.stages.length - 3;
        add(dropIn(n, 1 + (i % Math.max(1, mid)), rnd, pop));
    }
    return npcs;
}

const CLUB_SPEC = {
    iv: [4.5, 8], max: 8, hooks: null,
    spawn(state, B, rnd) {
        if (doorBlocked(state, state.def.door.x, state.def.door.y)) return null;
        return clubGuest(rnd, state.def.door);
    }
};

registerInterior(CLUB_DEF, {
    populate: (def, rnd) => populateClubB(def, rnd),
    update: (state, dt, rnd) => bizUpdate(CLUB_SPEC, state, dt, rnd),
    step: (n, state, dt, rnd) => actStep(CLUB_SPEC, n, state, dt, rnd),
    paint: paintClubB,
    dyn: dynClubB,
    accessory: accessoryB,
    glows: CLUB_GLOWS,
    lights: lightsClubB
});

// ═══════════════════════════════════════════
//  2. KIMIT TECH AB  (id: tech)
//  Reception, öppet kontorslandskap, serverrum och mötesrum bakom glas,
//  pentry med kaffemaskin och bordsfotboll.
// ═══════════════════════════════════════════

const TECH_W = 24, TECH_H = 16;
const techGrid = (() => {
    const g = mkGrid(TECH_W, TECH_H, 11);
    // mötesrummet uppe till vänster (glasvägg österut och söderut, dörr mot korridoren)
    g.rect(8, 1, 1, 6, '4').rect(1, 6, 7, 1, '4').set(8, 3, '+').set(8, 4, '+');
    g.rect(3, 2, 3, 2, '5');
    for (const [x, y] of [[2, 2], [2, 3], [6, 2], [6, 3], [3, 4], [4, 4], [5, 4]]) g.set(x, y, 'h');
    g.set(1, 5, 'x');
    // serverrummet uppe till höger
    g.rect(16, 1, 1, 5, '4').rect(17, 5, 6, 1, '4').set(16, 2, '+').set(16, 3, '+');
    g.rect(17, 1, 6, 1, '3').rect(17, 4, 6, 1, '3');
    // pentry och bordsfotboll i korridoren
    g.rect(10, 1, 5, 1, '6').set(9, 1, 'x').set(15, 1, 'x');
    g.rect(11, 4, 3, 1, '7');
    // skrivbord: två pods per vinge, två rader
    for (const x of [2, 5, 17, 20]) for (const y of [8, 12]) g.rect(x, y, 2, 1, '2');
    // receptionen: logoväggen, personalen bakom disken, växter i ändarna
    g.rect(9, 8, 6, 1, '9').rect(9, 10, 6, 1, '1').set(8, 9, 'x').set(15, 9, 'x').set(15, 3, '8').set(15, 4, '8');
    g.set(1, 14, 'x').set(22, 14, 'x').set(7, 14, 'x').set(16, 14, 'x').set(1, 7, 'x').set(22, 7, 'x');
    return g;
})();

const TECH_QUEUE = [368, 396, 424, 452].map(y => ({ x: 384, y }));

const TECH_DEF = {
    id: 'tech', name: 'KimIT Tech AB', theme: 'biz-tech', w: TECH_W, h: TECH_H,
    rows: techGrid.rows(),
    legend: {
        '1': { name: 'receptionsdisk', solid: true }, '2': { name: 'skrivbord', solid: true }, '3': { name: 'serverrack', solid: true },
        '4': { name: 'glasvägg', solid: true }, '5': { name: 'mötesbord', solid: true }, '6': { name: 'pentrydisk', solid: true },
        '7': { name: 'bordsfotboll', solid: true }, '8': { name: 'sittsäck', solid: true }, '9': { name: 'logovägg', solid: true },
        h: { name: 'stol', solid: true }, x: { name: 'växt', solid: true }
    },
    spawn: { x: 384, y: tc(13) },
    exit: { x: 384, y: 15 * TS + 20, r: 22 },
    door: { x: 384, y: tc(14) },
    counter: { x: 384, y: 10 * TS + 10 },
    queue: TECH_QUEUE,
    interactions: [{ id: 'counter', label: 'E — Receptionen: ägande, intäkter, tjänster', x: 384, y: 11 * TS + 8, r: 64 }],
    music: null,
    zones: [
        { x: 9, y: 9, w: 6, h: 1, kind: 'staff' },
        { x: 1, y: 1, w: 7, h: 5, kind: 'meeting' },
        { x: 17, y: 1, w: 6, h: 4, kind: 'server' },
        { x: 9, y: 11, w: 6, h: 4, kind: 'lobby' },
        { x: 9, y: 1, w: 7, h: 3, kind: 'kitchen' }
    ]
};

// skrivbordens chefer: de lägre raderna (ty>=10) har stolen norr om bordet
const deskDev = ty => (ty < 10 ? 1 : -1);

// ── Måla ──
const TECH_PAL = { wall: '#1b2434', face: '#2d3a54', hi: '#4a5d84', line: '#090d15' };

function techFloorTile(g, def, tx, ty, ch) {
    const x = tx * TS, y = ty * TS, zone = zoneAt(def, tx, ty), h = tileHash(tx, ty);
    if (zone === 'meeting') {
        // ljust trägolv
        for (let i = 0; i < 4; i++) { box(g, x, y + i * 8, TS, 8, ['#8a6c4a', '#826545', '#8f7250', '#7c6041'][(h >> (i * 2)) & 3]); box(g, x, y + i * 8 + 7, TS, 1, 'rgba(0,0,0,0.28)'); }
        const j = (h >> 4) % 28 + 2; box(g, x + j, y + ((h >> 9) & 3) * 8, 1, 7, 'rgba(0,0,0,0.3)');
        return;
    }
    if (zone === 'server') {
        box(g, x, y, TS, TS, '#161d29');
        g.fillStyle = 'rgba(80,200,255,0.1)';
        for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) g.fillRect(x + 4 + i * 8, y + 4 + j * 8, 3, 3);
        g.strokeStyle = 'rgba(60,160,220,0.22)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        return;
    }
    if (zone === 'staff') { box(g, x, y, TS, TS, '#a9b2c2'); g.fillStyle = 'rgba(0,0,0,0.06)'; g.fillRect(x, y, TS, 1); g.fillRect(x, y, 1, TS); return; }
    if (zone === 'lobby' || ch === 'e') {
        // ljus polerad betong med fogar
        box(g, x, y, TS, TS, (tx + ty) & 1 ? '#b3bccb' : '#aab4c4');
        g.strokeStyle = 'rgba(40,60,90,0.28)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.moveTo(x + 3, y + 22); g.lineTo(x + 21, y + 3); g.lineTo(x + 28, y + 3); g.lineTo(x + 3, y + 28); g.fill();
        if (ch === 'e') box(g, x, y, TS, TS, '#1a2234');
        return;
    }
    if (zone === 'kitchen') {
        box(g, x, y, TS, TS, (tx + ty) & 1 ? '#c5ccd8' : '#b6bfcd');
        g.strokeStyle = 'rgba(40,60,90,0.25)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        return;
    }
    // kontorsmatta: blågrå plattor
    box(g, x, y, TS, TS, (tx + ty) & 1 ? '#3b4960' : '#38455b');
    g.fillStyle = 'rgba(255,255,255,0.04)'; for (let i = 0; i < 4; i++) g.fillRect(x, y + i * 8, TS, 1);
    g.fillStyle = 'rgba(0,0,0,0.12)'; for (let i = 0; i < 4; i++) g.fillRect(x + i * 8, y, 1, TS);
    g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
}

function officeChair(g, cx, cy, dir, col) {
    g.save(); g.translate(cx, cy);
    softShadow(g, 0, 0, 10, 10, 0.3);
    g.rotate(dir); // dir = åt vilket håll ryggstödet ligger (bort från bordet)
    g.fillStyle = '#10151e'; for (let i = 0; i < 5; i++) { g.save(); g.rotate(i * TAU / 5); g.fillRect(0, -1, 11, 2); g.restore(); }
    disc(g, 0, 0, 8.4, '#0d1118'); disc(g, 0, 0, 7.4, col);
    g.fillStyle = 'rgba(255,255,255,0.14)'; g.beginPath(); g.arc(0, 0, 7.4, PI * 1.1, PI * 1.6); g.lineTo(0, 0); g.fill();
    g.fillStyle = '#0d1118'; rr(g, 6, -8, 4.4, 16, 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.2)'; g.fillRect(6.4, -8, 1, 16);
    g.restore();
}

const screenCache = new WeakMap();
function techDeskScreens(def) {
    let out = screenCache.get(def);
    if (out) return out;
    out = []; screenCache.set(def, out);
    const l = tilesOf(def, '2');
    for (let i = 0; i < l.length; i += 2) {
        const tx = l[i], ty = l[i + 1], x = tx * TS, y = ty * TS, f = deskDev(ty);
        out.push({ x: x + 5, y: f > 0 ? y + 3 : y + 16, w: 22, h: 13, tx, ty, ph: tileHash(tx, ty) });
    }
    return out;
}

function paintTech(g, def) {
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
        const ch = def.rows[ty][tx];
        if (ch !== '#') techFloorTile(g, def, tx, ty, ch);
    }
    wallPass(g, def, TECH_PAL);
    aoPass(g, def);
    techMeeting(g, def);
    techServer(g, def);
    techKitchen(g, def);
    techOffice(g, def);
    techReception(g, def);
    eachTile(def, 'x', (tx, ty) => plantAt(g, tc(tx), tc(ty), tileHash(tx, ty) % 7));
    // väggdekor: kanban-tavla och skärm på sidoväggarna
    techWallArt(g, def);
    // skyltar
    neonLine(g, [[40, 27], [5 * TS, 27]], '#a78bfa', 2.2);
    neonLine(g, [[19 * TS, 27], [23 * TS - 6, 27]], '#38bdf8', 2.2);
    signPlate(g, 'KIMIT TECH AB', 384, 17, 214, 24, 14, '#c9b8ff', '#8b5cf6');
    g.font = `17px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('💻', 262, 17); g.fillText('🚀', 506, 17);
    exitSign(g, 8 * TS + 4, 15 * TS + 10);
    // ingångsdörr: glasdörrar med kontorets logotyp
    const dx = 11 * TS, dy = 15 * TS;
    box(g, dx, dy, 2 * TS, TS, '#0c121e'); box(g, dx, dy + 18, 2 * TS, 14, '#1b2740'); box(g, dx, dy + 26, 2 * TS, 6, '#2d4270');
    box(g, dx - 2, dy + 1, 4, 17, '#9aa8bd'); box(g, dx + 2 * TS - 2, dy + 1, 4, 17, '#9aa8bd');
    box(g, dx - 1, dy + 2, 2, 15, 'rgba(180,220,255,0.5)'); box(g, dx + 2 * TS - 1, dy + 2, 2, 15, 'rgba(180,220,255,0.5)');
}

function techMeeting(g, def) {
    // glasväggen (tecken 4) och glasdörren (+)
    const glassDef = (tx, ty, horizontal) => {
        const x = tx * TS, y = ty * TS;
        if (horizontal) {
            box(g, x, y + 12, TS, 8, 'rgba(150,210,255,0.28)'); box(g, x, y + 11, TS, 1.6, '#9db4d0'); box(g, x, y + 19, TS, 1.6, '#9db4d0');
            g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(x + 4, y + 19); g.lineTo(x + 12, y + 12); g.lineTo(x + 16, y + 12); g.lineTo(x + 8, y + 19); g.fill();
        } else {
            box(g, x + 12, y, 8, TS, 'rgba(150,210,255,0.28)'); box(g, x + 11, y, 1.6, TS, '#9db4d0'); box(g, x + 19, y, 1.6, TS, '#9db4d0');
            g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(x + 12, y + 4); g.lineTo(x + 19, y + 12); g.lineTo(x + 19, y + 16); g.lineTo(x + 12, y + 8); g.fill();
        }
    };
    eachTile(def, '4', (tx, ty) => {
        const v = chAt(def, tx, ty - 1) === '4' || chAt(def, tx, ty + 1) === '4';
        const hz = chAt(def, tx - 1, ty) === '4' || chAt(def, tx + 1, ty) === '4';
        if (v && !hz) glassDef(tx, ty, false); else if (hz && !v) glassDef(tx, ty, true);
        else { glassDef(tx, ty, false); glassDef(tx, ty, true); }
        if (v && hz) { glassDef(tx, ty, false); glassDef(tx, ty, true); }
    });
    // glasdörr: ram och handtag (öppningen är gångbar)
    for (const [tx, ty] of [[8, 3], [8, 4]]) {
        const x = tx * TS, y = ty * TS;
        box(g, x + 10, y, 12, TS, 'rgba(150,210,255,0.12)');
        box(g, x + 9, y, 1.5, TS, '#9db4d0'); box(g, x + 21.5, y, 1.5, TS, '#9db4d0');
    }
    box(g, 8 * TS + 14, 3 * TS + 2, 4, 5, '#d4d8de');
    // mötesbordet
    slabGroup(g, def, '5', { side: '#3a2a1a', top: '#a8825a', hi: 'rgba(255,235,200,0.4)', ins: 3 });
    for (const [x, y] of [[102, 70], [132, 70], [160, 98], [106, 100]]) { box(g, x, y, 17, 11, '#e5e7eb'); box(g, x + 1, y + 1, 15, 9, '#cbd5e1'); box(g, x + 2, y + 6, 13, 1, '#94a3b8'); }
    disc(g, 144, 96, 4, '#f8fafc'); disc(g, 144, 96, 2.4, '#5b3a1a'); disc(g, 118, 108, 3.4, '#f8fafc'); disc(g, 118, 108, 2, '#5b3a1a');
    box(g, 150, 78, 8, 14, '#111827'); box(g, 151, 79, 6, 10, '#38bdf8');
    // stolar
    eachTile(def, 'h', (tx, ty) => {
        const dir = chAt(def, tx + 1, ty) === '5' ? PI : chAt(def, tx - 1, ty) === '5' ? 0 : chAt(def, tx, ty - 1) === '5' ? PI / 2 : -PI / 2;
        officeChair(g, tc(tx), tc(ty), dir, '#2563eb');
    });
    // whiteboard på norra väggen: skiss med pilar och postit
    plate(g, 2 * TS + 4, 5, 124, 24, 3, '#e2e8f0', '#64748b', 1.4);
    g.strokeStyle = '#2563eb'; g.lineWidth = 1.2; g.beginPath(); g.moveTo(80, 12); g.lineTo(100, 12); g.lineTo(100, 22); g.lineTo(122, 22); g.stroke();
    g.strokeStyle = '#dc2626'; g.beginPath(); g.moveTo(130, 10); g.lineTo(160, 10); g.moveTo(130, 15); g.lineTo(150, 15); g.stroke();
    box(g, 84, 18, 8, 7, '#fde047'); box(g, 164, 11, 8, 7, '#fb7185'); disc(g, 108, 17, 3, 'rgba(34,197,94,0.8)');
    box(g, 2 * TS + 4, 28, 124, 3, '#94a3b8');
    // skärm på vänstra väggen
    box(g, 22, 2 * TS + 6, 9, 3 * TS - 12, '#05070b'); box(g, 25, 2 * TS + 9, 5, 3 * TS - 18, '#1d4ed8'); box(g, 25, 2 * TS + 9, 5, 3 * TS - 18, 'rgba(255,255,255,0.1)');
}

function techServer(g, def) {
    // racken: svart skåp med fläktar uppifrån och lampor mot gången
    eachTile(def, '3', (tx, ty) => {
        const x = tx * TS, y = ty * TS, up = ty < 3;
        softShadow(g, x + 16, y + 16, 15, 15, 0.3);
        box(g, x, y, TS, TS, '#070a10'); box(g, x + 2, y + 2, TS - 4, TS - 4, '#161c28'); box(g, x + 2, y + 2, TS - 4, 2, 'rgba(160,200,255,0.2)');
        disc(g, x + 10, y + (up ? 12 : 22), 5.2, '#05070b'); disc(g, x + 22, y + (up ? 12 : 22), 5.2, '#05070b');
        g.strokeStyle = 'rgba(120,180,255,0.35)'; g.lineWidth = 0.8;
        for (const cx of [x + 10, x + 22]) { g.beginPath(); g.arc(cx, y + (up ? 12 : 22), 3.4, 0, TAU); g.moveTo(cx - 3.4, y + (up ? 12 : 22)); g.lineTo(cx + 3.4, y + (up ? 12 : 22)); g.stroke(); }
        box(g, x + 4, up ? y + TS - 8 : y + 3, TS - 8, 5, '#0a0e16');
    });
    // kabelrännor och glödande golvlist
    neonLine(g, [[17 * TS + 6, 3 * TS + 2], [23 * TS - 6, 3 * TS + 2]], '#22d3ee', 1.6);
    box(g, 17 * TS, 2 * TS + 14, 6 * TS, 4, 'rgba(34,211,238,0.12)');
    // skylt på glaset
    g.save(); g.translate(16 * TS + 16, 4.5 * TS); g.rotate(PI / 2);
    g.font = `7px ${SIGN_FONT}`; g.fillStyle = 'rgba(190,230,255,0.75)'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('SERVERRUM', 0, 0);
    g.restore();
}

function techKitchen(g, def) {
    slabGroup(g, def, '6', { side: '#2a3342', top: '#d8dee8', hi: 'rgba(255,255,255,0.6)', ins: 2 });
    // kaffemaskin (x 10..11), mikro, diskho, fruktskål
    const y = TS;
    box(g, 10 * TS + 4, y + 5, 22, 20, '#1f2937'); box(g, 10 * TS + 6, y + 7, 18, 7, '#cbd5e1'); box(g, 10 * TS + 8, y + 15, 14, 7, '#0b0f17');
    disc(g, 10 * TS + 15, y + 19, 2.6, '#f8fafc'); disc(g, 10 * TS + 15, y + 19, 1.5, '#5b3a1a');
    box(g, 10 * TS + 26, y + 6, 6, 4, '#ef4444');
    box(g, 11 * TS + 30 - 8, y + 6, 24, 18, '#9aa3b2'); box(g, 11 * TS + 24, y + 8, 14, 14, '#0e1118'); box(g, 11 * TS + 24, y + 8, 14, 14, 'rgba(120,200,255,0.2)');
    box(g, 12 * TS + 5, y + 6, 24, 20, '#aab3c2'); box(g, 12 * TS + 8, y + 9, 18, 14, '#7b8798'); disc(g, 12 * TS + 17, y + 16, 2, '#cbd5e1');
    disc(g, 13 * TS + 11, y + 15, 7, '#e5e7eb'); disc(g, 13 * TS + 11, y + 15, 5.4, '#b45309');
    for (const [dx, dy, c] of [[-2, -2, '#dc2626'], [2, 1, '#facc15'], [-1, 3, '#16a34a'], [3, -3, '#dc2626']]) disc(g, 13 * TS + 11 + dx, y + 15 + dy, 1.8, c);
    for (let i = 0; i < 3; i++) { disc(g, 14 * TS + 6 + i * 8, y + 22, 2.6, ['#f8fafc', '#38bdf8', '#fb7185'][i]); disc(g, 14 * TS + 6 + i * 8, y + 22, 1.5, '#5b3a1a'); }
    // bordsfotboll
    const fx = 11 * TS, fy = 4 * TS, fw = 3 * TS;
    softShadow(g, fx + fw / 2, fy + 16, fw / 2, 15, 0.3);
    box(g, fx, fy, fw, TS, '#101620'); box(g, fx + 2, fy + 2, fw - 4, TS - 4, '#15803d');
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1;
    g.strokeRect(fx + 5.5, fy + 5.5, fw - 11, TS - 11); g.beginPath(); g.moveTo(fx + fw / 2, fy + 5); g.lineTo(fx + fw / 2, fy + TS - 5); g.stroke();
    g.beginPath(); g.arc(fx + fw / 2, fy + 16, 5, 0, TAU); g.stroke();
    box(g, fx - 3, fy + 12, 5, 8, '#1f2937'); box(g, fx + fw - 2, fy + 12, 5, 8, '#1f2937');
    // sittsäcksgrupp nere vid bordsfotbollen
    eachTile(def, '8', (tx, ty) => {
        const bx = tc(tx), by = tc(ty), c = ty === 3 ? '#f97316' : '#0ea5e9';
        softShadow(g, bx, by, 14, 13, 0.3); disc(g, bx, by, 13.4, c); disc(g, bx - 2.5, by - 2.5, 9, 'rgba(255,255,255,0.2)');
        g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1; g.beginPath(); g.arc(bx, by, 13.4, 0, TAU); g.stroke();
        g.strokeStyle = 'rgba(0,0,0,0.22)'; g.beginPath(); g.moveTo(bx - 8, by + 4); g.quadraticCurveTo(bx, by + 9, bx + 8, by + 4); g.stroke();
    });
}

function techOffice(g, def) {
    // stolar först (under borden), alla platser
    for (const s of techDeskScreens(def)) {
        const f = deskDev(s.ty);
        officeChair(g, tc(s.tx), tc(s.ty + f), f > 0 ? PI / 2 : -PI / 2, ['#334155', '#475569', '#6d28d9', '#0e7490'][s.ph & 3]);
    }
    slabGroup(g, def, '2', { side: '#394257', top: '#dfe4ec', hi: 'rgba(255,255,255,0.7)', ins: 2 });
    for (const s of techDeskScreens(def)) {
        const f = deskDev(s.ty), x = s.tx * TS, y = s.ty * TS;
        // skärm med ram och fot; innehållet ritas i dyn
        box(g, s.x - 1, s.y - 1, s.w + 2, s.h + 2, '#0a0d14');
        box(g, s.x, s.y, s.w, s.h, '#0b1220');
        box(g, x + 13, f > 0 ? y + 16 : y + 14, 6, 2, '#4b5563');
        // tangentbord och mus
        const ky = f > 0 ? y + 20 : y + 7;
        box(g, x + 7, ky, 15, 5, '#1f2937'); box(g, x + 8, ky + 1, 13, 1, '#4b5563'); box(g, x + 8, ky + 3, 13, 1, '#4b5563'); box(g, x + 24, ky, 3, 5, '#374151');
        // mugg eller liten växt på varannat bord
        const h = s.ph;
        if (h % 3 === 0) { disc(g, x + 4, f > 0 ? y + 23 : y + 9, 2.8, '#f8fafc'); disc(g, x + 4, f > 0 ? y + 23 : y + 9, 1.7, '#5b3a1a'); }
        else if (h % 3 === 1) { disc(g, x + 28, f > 0 ? y + 8 : y + 24, 3, '#16a34a'); disc(g, x + 28, f > 0 ? y + 8 : y + 24, 1.6, '#4ade80'); }
    }
}

function techReception(g, def) {
    // logoväggen bakom receptionisten
    const x = 9 * TS, y = 8 * TS, w = 6 * TS;
    softShadow(g, x + w / 2, y + 16, w / 2, 14, 0.3);
    box(g, x, y, w, TS, '#0b0f1a'); box(g, x + 2, y + 2, w - 4, TS - 4, '#161a2e');
    g.fillStyle = 'rgba(139,92,246,0.14)'; g.fillRect(x + 2, y + 2, w - 4, TS - 4);
    neonText(g, 'KimIT', x + w / 2 - 8, y + 16, 19, '#d8c8ff', '#8b5cf6');
    g.font = `15px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🚀', x + w - 24, y + 17);
    // receptionsdisken
    slabGroup(g, def, '1', { side: '#2a3342', top: '#e7ebf2', hi: 'rgba(255,255,255,0.85)', ins: 3 });
    const dy = 10 * TS;
    // skärm, telefon, klocka och kontraktsbunt på disken
    box(g, x + 14, dy + 6, 22, 15, '#0a0d14'); box(g, x + 15, dy + 7, 20, 11, '#3b82f6'); box(g, x + 15, dy + 7, 20, 3, 'rgba(255,255,255,0.4)');
    box(g, x + 70, dy + 8, 15, 11, '#1f2937'); box(g, x + 72, dy + 10, 11, 7, '#64748b');
    disc(g, x + 104, dy + 14, 5, '#cbd5e1'); disc(g, x + 104, dy + 14, 2.4, '#f59e0b');
    box(g, x + 128, dy + 8, 17, 13, '#f8fafc'); box(g, x + 130, dy + 10, 13, 1.4, '#94a3b8'); box(g, x + 130, dy + 13, 13, 1.4, '#94a3b8'); box(g, x + 130, dy + 16, 9, 1.4, '#94a3b8');
    box(g, x + 154, dy + 7, 4, 17, '#6d28d9');
    g.font = `7px ${SIGN_FONT}`; g.fillStyle = 'rgba(80,60,160,0.8)'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('KONTRAKT', x + 100, dy + 26);
}

function techWallArt(g, def) {
    // kanban på vänstra väggen (x 0..32, y 8..13 rader)
    const x = 5, y0 = 8 * TS + 3, hh = 5 * TS - 6;
    box(g, x, y0, 22, hh, '#cbd5e1'); box(g, x + 1, y0 + 1, 20, hh - 2, '#f1f5f9');
    for (let c = 0; c < 3; c++) {
        box(g, x + 1 + c * 7, y0 + 1, 0.8, hh - 2, '#94a3b8');
        for (let i = 0; i < 5 - c; i++) box(g, x + 2 + c * 7, y0 + 4 + i * 9 + c * 3, 5, 6, ['#fde047', '#fb7185', '#7dd3fc', '#86efac'][(c + i) & 3]);
    }
    // stor skärm på högra väggen: diagram
    const rx = 23 * TS + 4, ry = 8 * TS + 6, rh = 5 * TS - 12;
    box(g, rx, ry, 24, rh, '#05070b'); box(g, rx + 1.5, ry + 1.5, 21, rh - 3, '#0f2a4a');
    g.fillStyle = 'rgba(56,189,248,0.4)'; for (let i = 0; i < 7; i++) g.fillRect(rx + 4 + (i % 2) * 9, ry + 6 + i * 20, 5 + (i * 7) % 8, 12);
}

// ── Rörligt ──
const CODE_COLS = ['#7dd3fc', '#86efac', '#fda4af', '#fcd34d', '#c4b5fd', '#e2e8f0'];

function dynTech(ctx, state, v, t) {
    const def = state.def;
    // kodrader som rullar på skärmarna
    const scr = techDeskScreens(def);
    for (const s of scr) {
        if (!inView(v, s.x + s.w / 2, s.y + s.h / 2, 30)) continue;
        const lit = (s.ph >> 5) % 5 !== 0; // en av fem skärmar står på skärmsläckare
        if (!lit) {
            ctx.fillStyle = `rgba(80,140,255,${0.25 + 0.2 * Math.sin(t * 1.5 + s.ph)})`;
            ctx.fillRect(s.x + 2, s.y + 2, s.w - 4, s.h - 4);
            continue;
        }
        const off = (t * (3 + (s.ph % 4)) + s.ph) % 4;
        for (let k = -1; k < 4; k++) {
            const y = s.y + 1.5 + k * 4 - off;
            const y0 = Math.max(s.y + 1, y), y1 = Math.min(s.y + s.h - 1, y + 2);
            if (y1 <= y0) continue;
            const hh = tileHash(s.ph + k + Math.floor((t * (3 + (s.ph % 4)) + s.ph) / 4) * 7, 3);
            ctx.fillStyle = CODE_COLS[hh % CODE_COLS.length];
            ctx.globalAlpha = 0.85;
            const indent = (hh >> 3) % 3 * 3, len = 5 + (hh >> 6) % (s.w - 8 - indent);
            ctx.fillRect(s.x + 2 + indent, y0, len, y1 - y0);
        }
        ctx.globalAlpha = 1;
        if (Math.floor(t * 2 + s.ph) % 2 === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(s.x + s.w - 5, s.y + s.h - 4, 2, 2.4); }
    }
    // serverrackens lampor
    const rk = tilesOf(def, '3');
    for (let i = 0; i < rk.length; i += 2) {
        const tx = rk[i], ty = rk[i + 1], x = tx * TS, y = ty * TS, up = ty < 3;
        if (!inView(v, x + 16, y + 16, 24)) continue;
        for (let k = 0; k < 6; k++) {
            const h = tileHash(tx * 7 + k, ty), f = 1.5 + (h % 5) * 1.3;
            const on = Math.sin(t * f + h) > -0.3;
            const col = (h >> 4) % 11 === 0 ? '#f43f5e' : (h >> 3) % 4 === 0 ? '#fbbf24' : '#4ade80';
            ctx.fillStyle = on ? col : 'rgba(20,40,30,0.9)';
            ctx.fillRect(x + 5 + k * 4.2, up ? y + TS - 6 : y + 4.6, 2.4, 2.4);
        }
    }
    // kaffemaskinen ångar och lampan blinkar
    for (let i = 0; i < 3; i++) {
        const k = (t * 0.5 + i / 3) % 1;
        ctx.fillStyle = `rgba(255,255,255,${0.32 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(10 * TS + 15 + Math.sin(t * 3 + i) * 2, TS + 12 - k * 12, 2 + k * 2.4, 0, TAU); ctx.fill();
    }
    ctx.fillStyle = Math.floor(t * 1.4) % 2 ? '#4ade80' : '#14532d'; ctx.fillRect(10 * TS + 26, TS + 6, 6, 4);
    // bordsfotboll: stänger sladdar och bollen rullar
    const fx = 11 * TS, fy = 4 * TS;
    for (let i = 0; i < 4; i++) {
        const off = Math.sin(t * (1.7 + i * 0.5) + i) * 4, rx = fx + 10 + i * 24;
        ctx.fillStyle = '#d1d5db'; ctx.fillRect(rx - 1.2, fy + 3, 2.4, TS - 6);
        ctx.fillStyle = i & 1 ? '#ef4444' : '#2563eb';
        ctx.fillRect(rx - 3, fy + 8 + off, 6, 3.4); ctx.fillRect(rx - 3, fy + 20 + off * 0.6, 6, 3.4);
    }
    disc(ctx, fx + 48 + Math.sin(t * 1.1) * 28, fy + 16 + Math.sin(t * 2.3) * 6, 2.3, '#fafafa');
    // loggan flimrar
    const f = (t * 0.23) % 1;
    if (f < 0.02 || (f > 0.05 && f < 0.062)) { ctx.fillStyle = 'rgba(11,15,26,0.7)'; rr(ctx, 9 * TS + 20, 8 * TS + 4, 6 * TS - 40, 24, 4); ctx.fill(); }
    // mötesrummets skärm byter bild
    const slide = Math.floor(t / 3.5) % 3;
    ctx.fillStyle = ['#38bdf8', '#a78bfa', '#4ade80'][slide]; ctx.globalAlpha = 0.5;
    ctx.fillRect(25, 2 * TS + 12 + (slide * 8) % 24, 5, 8); ctx.globalAlpha = 1;
    exitArrow(ctx, def, t);
}

const TECH_GLOWS = [
    [384, 24, 170, '#8b5cf6', 0.26, 0],
    [128, 100, 150, '#cfe8ff', 0.09, 0],
    [660, 90, 170, '#22d3ee', 0.2, 1.8],
    [384, 100, 150, '#ffb347', 0.12, 0],
    [384, 280, 160, '#a855f7', 0.2, 2.4],
    [384, 200, 200, '#cfe8ff', 0.06, 0],
    [384, 440, 130, '#9cc3ff', 0.18, 0],
    [128, 330, 150, '#cfe8ff', 0.05, 0],
    [640, 330, 150, '#cfe8ff', 0.05, 0]
];
function lightsTech(ctx, state, v, t, glow) {
    for (const s of techDeskScreens(state.def)) glow(s.x + s.w / 2, s.y + s.h / 2, 26, '#60a5fa', 0.1 + 0.03 * Math.sin(t * 2 + s.ph));
}

// ── Folk ──
const TECH_LINES = {
    receptionist: ['Välkommen till KimIT!', 'Har ni en bokning?', 'Kontraktet ligger här.', 'Ett ögonblick.'],
    dev: ['Det funkar på min dator.', 'Merge conflict...', 'Mer kaffe.', 'git push --force!', 'Det är en feature.'],
    sysadmin: ['Servern surrar fint.', 'Inget är nere. Än.', 'Starta om den.'],
    client: ['Spännande projekt!', 'Vart skriver jag på?', 'Rocket fuel, sa du?']
};
const TECH_SUITS = ['#1f2937', '#111827', '#334155', '#1e293b', '#3f3f46', '#0f172a', '#1e3a5f', '#3b0764'];
const techLook = rnd => look(rnd, TECH_SUITS, { dress: 0.35, dressCols: ['#7c3aed', '#0f766e', '#be123c', '#1d4ed8', '#334155'] });

// platser: sitter vid mötesbordet (sx/sy = stol, fx/fy = ledig ruta framför)
const TECH_MEET = [seat(2, 2, 1, 2, 0), seat(2, 3, 1, 3, 0), seat(6, 2, 7, 2, PI), seat(6, 3, 7, 3, PI), seat(3, 4, 3, 5, -PI / 2), seat(4, 4, 4, 5, -PI / 2), seat(5, 4, 5, 5, -PI / 2)];
const TECH_COFFEE = { x: 12 * TS + 16, y: 2 * TS + 14 };

function techClient(rnd, from) {
    const stages = [{ k: 'queue' }];
    if (rnd() < 0.3) stages.push({ k: 'visit', x: TECH_COFFEE.x + (rnd() < 0.5 ? -32 : 32), y: TECH_COFFEE.y, a: -PI / 2, pose: 'idle', t: [3, 6], prop: 'cup', say: 'Kaffe, tack.' });
    stages.push({ k: 'sit', opts: TECH_MEET, t: [12, 24], prop: null });
    stages.push(...leaveStages(TECH_DEF));
    const prop = pick(rnd, ['case', 'case', 'tablet', null, 'phone']);
    const n = actor('client', from.x, from.y, rnd, { look: techLook(rnd), stages, speed: rand(rnd, 40, 48), lines: TECH_LINES.client, angle: -PI / 2, prop });
    return n;
}

function populateTech(def, rnd) {
    const npcs = [], pop = { q: 0, taken: new Set() };
    const add = n => { if (n) npcs.push(n); return n; };
    add(staffAt('receptionist', rnd, pop, [V(tc(11), tc(9), PI / 2, 'work', 7, 14), V(tc(13), tc(9), PI / 2, 'work', 6, 12)], { watch: true, lines: TECH_LINES.receptionist, look: { shirt: '#7c3aed', skin: '#e0ac69', hair: '#7c2d12', dress: '#7c3aed' } }));
    // utvecklarna vid sina skrivbord (tx, ty = stolens ruta)
    const seatsDev = [[2, 9], [6, 9], [3, 11], [5, 11], [17, 9], [21, 9], [18, 11], [20, 11]];
    const HOODIES = ['#e11d48', '#f97316', '#22c55e', '#0ea5e9', '#a855f7', '#eab308', '#14b8a6', '#64748b'];
    seatsDev.forEach(([tx, ty], i) => {
        const a = ty < 10 ? -PI / 2 : PI / 2, px = tc(tx), py = tc(ty);
        const stages = [V(px, py, a, 'work', 28, 60)];
        if (i % 3 === 0) stages.push(V(TECH_COFFEE.x + (i % 2 ? 32 : -32), TECH_COFFEE.y, -PI / 2, 'idle', 3, 6, { prop: 'cup', say: 'Kaffe...' }), V(px, py, a, 'work', 25, 50, { prop: null }));
        if (i % 4 === 1) stages.push(V(12 * TS + (i % 2 ? 6 : 26), 3 * TS + 10, PI / 2, 'work', 9, 15), V(px, py, a, 'work', 25, 45));
        if (i % 4 === 2) stages.push(V(12 * TS + 16, 5 * TS + 18, -PI / 2, 'work', 9, 15), V(px, py, a, 'work', 25, 45));
        add(staffAt('dev', rnd, pop, stages, { lines: TECH_LINES.dev, look: { shirt: HOODIES[i], skin: pick(rnd, SKINS), hair: pick(rnd, HAIRS), cap: i === 3 ? '#0f172a' : undefined } }));
    });
    // mötet: presentatör vid whiteboarden, två som sitter
    add(staffAt('dev', rnd, pop, [V(tc(4), tc(1), -PI / 2, 'work', 18, 30), V(tc(5) + 8, tc(1), -PI / 2, 'work', 10, 20)], { order: 'seq', look: { shirt: '#1d4ed8', skin: '#c68642', hair: '#111111' }, lines: TECH_LINES.dev, prop: 'clip' }));
    for (const [i, c] of [[0, TECH_MEET[3]], [1, TECH_MEET[5]]]) {
        add(staffAt('dev', rnd, pop, [{ k: 'sit', opts: [c], t: [26, 50], prop: i ? 'tablet' : null }, V(tc(i ? 20 : 3), tc(i ? 9 : 9), -PI / 2, 'work', 25, 50, { prop: null })], { look: { shirt: i ? '#0ea5e9' : '#f97316', skin: pick(rnd, SKINS), hair: pick(rnd, HAIRS) } }));
    }
    // sysadmin i serverrummet
    add(staffAt('sysadmin', rnd, pop, [V(tc(18), tc(2), -PI / 2, 'work', 6, 12), V(tc(21), tc(3), PI / 2, 'work', 6, 12), V(tc(19), tc(3), PI / 2, 'work', 5, 9), V(tc(21), tc(2), -PI / 2, 'work', 5, 9)], { order: 'rand', lines: TECH_LINES.sysadmin, look: { shirt: '#334155', skin: '#e0ac69', hair: '#d6d3d1', cap: '#0ea5e9' }, prop: 'tablet' }));
    // kunder mitt i sin runda
    add(dropIn(techClient(rnd, TECH_QUEUE[0]), 0, rnd, pop));
    add(dropIn(techClient(rnd, TECH_QUEUE[1]), 0, rnd, pop));
    for (let i = 0; i < 2; i++) {
        const c = techClient(rnd, def.door), si = c.c.stages.findIndex(s => s.k === 'sit');
        add(dropIn(c, si, rnd, pop));
    }
    const cf = techClient(rnd, def.door);
    cf.c.stages.splice(1, 0, { k: 'visit', x: TECH_COFFEE.x + 32, y: TECH_COFFEE.y, a: -PI / 2, pose: 'idle', t: [3, 6], prop: 'cup' });
    add(dropIn(cf, 1, rnd, pop));
    return npcs;
}

const TECH_SPEC = {
    iv: [6, 11], max: 7, hooks: null,
    spawn(state, B, rnd) {
        if (doorBlocked(state, state.def.door.x, state.def.door.y)) return null;
        return techClient(rnd, state.def.door);
    }
};

registerInterior(TECH_DEF, {
    populate: (def, rnd) => populateTech(def, rnd),
    update: (state, dt, rnd) => bizUpdate(TECH_SPEC, state, dt, rnd),
    step: (n, state, dt, rnd) => actStep(TECH_SPEC, n, state, dt, rnd),
    paint: paintTech,
    dyn: dynTech,
    accessory: accessoryB,
    glows: TECH_GLOWS,
    lights: lightsTech
});

// ═══════════════════════════════════════════
//  3. SKYSKRAPAN  (id: tower)
//  Stor lobby med marmorgolv, receptionsdisk, säkerhetsvakt, fem hissar
//  (dörrar som öppnas och stängs, våningsvisare), sittgrupper, växter, fontän.
//  Besökare checkar in och betalar hyra, tar hissen upp; andra kommer ut ur
//  hissarna och går mot utgången.
// ═══════════════════════════════════════════

const TOWER_W = 26, TOWER_H = 16;
const EL_X = [224, 320, 416, 512, 608]; // hissdörrarnas mitt (px)
const EL_Y = 73;                       // där man stannar/kommer ut framför hissen
const towerGrid = (() => {
    const g = mkGrid(TOWER_W, TOWER_H, 12);
    // hissraden: pelare mellan fem par hissrutor
    for (const x of [5, 8, 11, 14, 17, 20]) g.set(x, 1, '5');
    for (const x of [6, 7, 9, 10, 12, 13, 15, 16, 18, 19]) g.set(x, 1, '2');
    // fontänen
    g.rect(12, 5, 2, 2, '3');
    // receptionsön: logovägg, pelare i ändarna, personal på insidan, disk framför
    g.rect(8, 8, 10, 1, '9').set(8, 9, '5').set(17, 9, '5').rect(8, 10, 10, 1, '1');
    // sittgrupper
    g.rect(2, 6, 4, 1, 'S').rect(3, 7, 2, 1, 'V').rect(2, 8, 4, 1, 'S');
    g.rect(20, 6, 4, 1, 'S').rect(21, 7, 2, 1, 'V').rect(20, 8, 4, 1, 'S');
    // vaktkuren i hörnet
    g.rect(20, 12, 5, 1, '8').rect(19, 13, 1, 2, '8');
    // marmorpelare i lobbyn
    for (const [x, y] of [[3, 3], [22, 3], [3, 11]]) g.set(x, y, '5');
    for (const [x, y] of [[1, 1], [24, 1], [1, 4], [24, 4], [1, 10], [24, 10], [1, 14], [24, 14], [7, 14], [18, 14], [10, 3], [15, 3]]) g.set(x, y, 'x');
    return g;
})();

const TOWER_QUEUE = [368, 396, 424, 452].map(y => ({ x: 416, y }));

const TOWER_DEF = {
    id: 'tower', name: 'Skyskrapan', theme: 'biz-tower', w: TOWER_W, h: TOWER_H,
    rows: towerGrid.rows(),
    legend: {
        '1': { name: 'receptionsdisk', solid: true }, '2': { name: 'hiss', solid: true }, '3': { name: 'fontän', solid: true },
        '5': { name: 'marmorpelare', solid: true }, '8': { name: 'vaktdisk', solid: true }, '9': { name: 'logovägg', solid: true },
        S: { name: 'soffa', solid: true }, V: { name: 'soffbord', solid: true }, x: { name: 'växt', solid: true }
    },
    spawn: { x: 416, y: tc(13) },
    exit: { x: 416, y: 15 * TS + 20, r: 22 },
    door: { x: 416, y: tc(14) },
    counter: { x: 416, y: 10 * TS + 10 },
    queue: TOWER_QUEUE,
    interactions: [{ id: 'counter', label: 'E — Receptionen: hyra, ägande, intäkter', x: 416, y: 11 * TS + 8, r: 64 }],
    music: null,
    zones: [
        { x: 9, y: 9, w: 8, h: 1, kind: 'staff' },
        { x: 20, y: 13, w: 5, h: 2, kind: 'staff' },
        { x: 12, y: 11, w: 2, h: 4, kind: 'runner' },
        { x: 1, y: 5, w: 6, h: 5, kind: 'rug' },
        { x: 19, y: 5, w: 6, h: 5, kind: 'rug' }
    ]
};

// ── Måla ──
const TOWER_PAL = { wall: '#161c28', face: '#34415a', hi: '#6980a8', line: '#06080e' };

function towerFloorTile(g, def, tx, ty, ch) {
    const x = tx * TS, y = ty * TS, zone = zoneAt(def, tx, ty), h = tileHash(tx, ty);
    if (zone === 'staff') { box(g, x, y, TS, TS, '#2f3542'); g.fillStyle = 'rgba(255,255,255,0.05)'; g.fillRect(x, y, TS, 1); g.fillRect(x, y, 1, TS); return; }
    if (ch === 'e') { box(g, x, y, TS, TS, '#0e1420'); return; }
    if (zone === 'runner') {
        box(g, x, y, TS, TS, '#7a1b2e'); box(g, x, y, TS, TS, 'rgba(0,0,0,0.1)');
        g.fillStyle = 'rgba(255,215,130,0.3)'; g.fillRect(x + 14, y + 12, 4, 8); g.fillRect(x + 12, y + 14, 8, 4);
        g.fillStyle = '#d4a72c';
        if (chAt(def, tx - 1, ty) !== 'e' && zoneAt(def, tx - 1, ty) !== 'runner') g.fillRect(x, y, 3, TS);
        if (zoneAt(def, tx + 1, ty) !== 'runner') g.fillRect(x + TS - 3, y, 3, TS);
        return;
    }
    if (zone === 'rug') return carpetTile(g, x, y, '#1f4a52', 'rgba(255,225,160,0.22)');
    // marmor: stora rutor om 2×2 rutor, ljust och mörkt, med ådring
    const big = ((tx >> 1) + (ty >> 1)) & 1;
    box(g, x, y, TS, TS, big ? '#a8a292' : '#948e7e');
    g.fillStyle = big ? 'rgba(255,255,255,0.13)' : 'rgba(255,255,255,0.07)'; g.beginPath(); g.moveTo(x + 2, y + 22); g.lineTo(x + 20, y + 2); g.lineTo(x + 30, y + 2); g.lineTo(x + 2, y + 30); g.fill();
    g.strokeStyle = big ? 'rgba(110,100,80,0.3)' : 'rgba(40,36,30,0.22)'; g.lineWidth = 0.9;
    g.beginPath(); g.moveTo(x + (h & 31), y); g.bezierCurveTo(x + 8 + (h >> 5 & 15), y + 10, x + 20 - (h >> 9 & 7), y + 18, x + (h >> 3 & 31), y + TS); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.14)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
}

// Marmorpelare (rund, med guldringar)
function column(g, cx, cy) {
    softShadow(g, cx, cy, 15, 15, 0.38);
    disc(g, cx, cy, 14.5, '#7b7466'); disc(g, cx, cy, 13, '#d9d3c3'); disc(g, cx - 3, cy - 3, 8, 'rgba(255,255,255,0.4)');
    g.strokeStyle = '#d4a72c'; g.lineWidth = 2; g.beginPath(); g.arc(cx, cy, 13.6, 0, TAU); g.stroke();
    g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, 9, 0, TAU); g.stroke();
}

// Soffrad: dir = åt vilket håll sitsen vetter (ryggstödet ligger på motsatt sida)
function sofaRun(g, tx, ty, len, dir, pal) {
    const x = tx * TS, y = ty * TS, w = len * TS;
    softShadow(g, x + w / 2, y + 16, w / 2, 15, 0.3);
    box(g, x, y, w, TS, pal.base);
    const back = dir === 'S' ? [x, y, w, 9] : [x, y + TS - 9, w, 9];
    const seatY = dir === 'S' ? y + 9 : y + 2, seatH = TS - 11;
    for (let i = 0; i < len; i++) {
        g.fillStyle = pal.seat; rr(g, x + i * TS + 2, seatY, TS - 4, seatH, 4); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.12)'; rr(g, x + i * TS + 4, seatY + 2, TS - 8, 5, 2); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; rr(g, x + i * TS + 2, seatY, TS - 4, seatH, 4); g.stroke();
    }
    g.fillStyle = pal.back; g.fillRect(...back);
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(back[0], dir === 'S' ? back[1] : back[1] + back[3] - 1.5, back[2], 1.5);
    box(g, x, y, 4, TS, pal.back); box(g, x + w - 4, y, 4, TS, pal.back);
}

function leafPaint(g, x, y, w, h) {
    if (w <= 0) return;
    g.fillStyle = '#9ba7bb'; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(255,255,255,0.28)'; for (let i = 3; i < w; i += 5) g.fillRect(x + i, y, 1, h);
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, y + h - 2, w, 2);
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(x, y, w, 1.4);
}

function paintTower(g, def) {
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
        const ch = def.rows[ty][tx];
        if (ch !== '#') towerFloorTile(g, def, tx, ty, ch);
    }
    wallPass(g, def, TOWER_PAL);
    aoPass(g, def);
    // fönster med nattstad i sidoväggarna
    for (const wx of [0, def.w - 1]) for (const wy of [3, 6, 9, 12]) {
        const x = wx * TS + 4, y = wy * TS + 3;
        box(g, x - 1, y - 1, 24, 2 * TS - 4, '#0b0f18'); box(g, x, y, 22, 2 * TS - 6, '#0b1630');
        g.fillStyle = '#16244a';
        for (let i = 0; i < 4; i++) g.fillRect(x + 1 + i * 5, y + 22 - ((tileHash(wx + i, wy) >> 4) % 18), 4, 40);
        for (let i = 0; i < 14; i++) { const hh = tileHash(i + wx, wy); g.fillStyle = hh & 1 ? '#fde68a' : '#7dd3fc'; g.fillRect(x + 1 + hh % 20, y + 2 + (hh >> 5) % 48, 1.4, 1.4); }
        box(g, x + 10, y, 1.6, 2 * TS - 6, '#0b0f18');
    }
    towerBank(g, def);
    towerFountain(g, def);
    towerReception(g, def);
    towerSeating(g, def);
    towerSecurity(g, def);
    eachTile(def, 'x', (tx, ty) => plantAt(g, tc(tx), tc(ty), tileHash(tx, ty) % 7));
    // pelare (tecken 5 utom i hissraden och receptionsön)
    eachTile(def, '5', (tx, ty) => { if (ty > 1) column(g, tc(tx), tc(ty)); });
    // skylt och neon
    neonLine(g, [[40, 27], [4 * TS + 20, 27]], '#f59e0b', 2.2);
    neonLine(g, [[21 * TS + 12, 27], [25 * TS - 6, 27]], '#f59e0b', 2.2);
    signPlate(g, 'SKYSKRAPAN', 416, 17, 220, 24, 15, '#ffe1a0', '#f59e0b');
    g.font = `17px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('🏗️', 292, 17); g.fillText('🏙️', 540, 17);
    exitSign(g, 9 * TS + 6, 15 * TS + 10);
    towerDoor(g, def);
}

function towerBank(g, def) {
    // bakgrund i borstat stål över hela raden
    const x0 = 5 * TS, w = 16 * TS;
    box(g, x0, TS, w, TS, '#2a3344');
    box(g, x0, TS, w, 2, '#6a7894');
    for (const cx of EL_X) {
        // karm, inre schakt och stängda dörrar
        box(g, cx - 31, TS, 62, TS, '#57647e'); box(g, cx - 31, TS, 62, 2, 'rgba(255,255,255,0.35)');
        box(g, cx - 27, TS + 4, 54, TS - 4, '#0b0f18');
        leafPaint(g, cx - 26, TS + 4, 26, TS - 4); leafPaint(g, cx, TS + 4, 26, TS - 4);
        box(g, cx - 1, TS + 4, 2, TS - 4, '#2a3140');
        box(g, cx - 31, 2 * TS - 4, 62, 4, '#3a4358'); box(g, cx - 31, 2 * TS - 5, 62, 1, 'rgba(255,255,255,0.3)');
    }
    // pelarna mellan hissarna: marmorplatta med guldlist och ringknapp
    for (const px of [5, 8, 11, 14, 17, 20]) {
        const x = px * TS;
        box(g, x, TS, TS, TS, '#cfc8b6'); box(g, x + 1, TS + 1, TS - 2, TS - 2, '#b9b2a0');
        box(g, x + 2, TS + 2, 1.5, TS - 4, '#d4a72c'); box(g, x + TS - 3.5, TS + 2, 1.5, TS - 4, '#d4a72c');
        g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x + 6, TS + 3, 8, TS - 8);
        if (px > 5 && px < 20) { disc(g, x + 16, TS + 18, 3.4, '#1f2937'); disc(g, x + 16, TS + 18, 2, '#fbbf24'); }
    }
}

function towerFountain(g, def) {
    const cx = 416, cy = 192;
    softShadow(g, cx, cy, 34, 34, 0.4);
    disc(g, cx, cy, 31, '#8d8576'); disc(g, cx, cy, 29, '#e2dccb');
    disc(g, cx, cy, 25, '#b9b09c'); disc(g, cx, cy, 24, '#2b6e9a');
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.beginPath(); g.arc(cx, cy, 24, PI * 1.1, PI * 1.6); g.lineTo(cx, cy); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.28)'; g.lineWidth = 1; g.beginPath(); g.arc(cx, cy, 29, 0, TAU); g.stroke();
    // piedestal med skål
    disc(g, cx, cy, 9, '#d9d3c3'); disc(g, cx, cy, 7, '#8d8576'); disc(g, cx, cy, 4, '#2b6e9a');
    // guldmynt på botten
    for (let i = 0; i < 9; i++) { const a = i * 2.4, r = 12 + (i % 3) * 4; disc(g, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.3, 'rgba(250,204,21,0.75)'); }
}

function towerReception(g, def) {
    // logoväggen
    const x = 8 * TS, y = 8 * TS, w = 10 * TS;
    softShadow(g, x + w / 2, y + 16, w / 2, 14, 0.3);
    box(g, x, y, w, TS, '#0b0e16'); box(g, x + 2, y + 2, w - 4, TS - 4, '#1a2030');
    g.strokeStyle = '#d4a72c'; g.lineWidth = 1.2; g.strokeRect(x + 3.5, y + 3.5, w - 7, TS - 7);
    neonText(g, 'VÄLKOMMEN', x + w / 2, y + 16.5, 14, '#ffe1a0', '#f59e0b');
    g.font = `15px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🏗️', x + 26, y + 17); g.fillText('🏗️', x + w - 26, y + 17);
    // disken: mörkt trä med marmorskiva
    slabGroup(g, def, '1', { side: '#241810', top: '#e6e0d2', hi: 'rgba(255,255,255,0.9)', ins: 3 });
    const dy = 10 * TS;
    g.strokeStyle = 'rgba(120,110,90,0.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(x + 20, dy + 20); g.bezierCurveTo(x + 80, dy + 8, x + 120, dy + 26, x + 190, dy + 10); g.stroke();
    // två skärmar, telefon, klocka, gästbok, nyckelskåp
    for (const sx of [x + 40, x + 232]) { box(g, sx, dy + 6, 24, 16, '#0a0d14'); box(g, sx + 1, dy + 7, 22, 12, '#3b82f6'); box(g, sx + 1, dy + 7, 22, 3, 'rgba(255,255,255,0.4)'); }
    box(g, x + 100, dy + 9, 16, 12, '#1f2937'); box(g, x + 102, dy + 11, 12, 8, '#64748b');
    disc(g, x + 160, dy + 15, 5.4, '#d4a72c'); disc(g, x + 160, dy + 15, 3.4, '#fde68a');
    box(g, x + 182, dy + 7, 22, 16, '#7c2d12'); box(g, x + 184, dy + 9, 18, 12, '#f8fafc'); box(g, x + 186, dy + 12, 14, 1.2, '#94a3b8'); box(g, x + 186, dy + 15, 14, 1.2, '#94a3b8');
    box(g, x + 276, dy + 6, 5, 18, '#d4a72c');
}

function towerSeating(g, def) {
    const pal = { base: '#10273a', seat: '#1e5a7d', back: '#16405a' };
    sofaRun(g, 2, 6, 4, 'S', pal); sofaRun(g, 2, 8, 4, 'N', pal);
    sofaRun(g, 20, 6, 4, 'S', pal); sofaRun(g, 20, 8, 4, 'N', pal);
    slabGroup(g, def, 'V', { side: '#c9d6e8', top: '#0e1a2c', hi: 'rgba(255,255,255,0.35)', ins: 2 });
    for (const bx of [4 * TS, 22 * TS]) {
        const by = 7 * TS + 16;
        disc(g, bx, by, 6, '#e5e7eb'); disc(g, bx, by, 4.4, '#16a34a'); disc(g, bx, by, 2, '#4ade80');
        box(g, bx - 24, by - 7, 11, 14, '#f8fafc'); box(g, bx - 22, by - 5, 7, 2, '#ef4444'); box(g, bx - 22, by - 1, 7, 1.2, '#94a3b8');
        box(g, bx + 14, by - 6, 10, 13, '#fde047'); box(g, bx + 16, by - 4, 6, 1.2, '#92400e'); box(g, bx + 16, by, 6, 1.2, '#92400e');
    }
}

function towerSecurity(g, def) {
    slabGroup(g, def, '8', { side: '#0c0f16', top: '#2a3342', hi: 'rgba(160,190,255,0.4)', ins: 2 });
    // övervakningsskärmar på kurens disk (rad 12, x 20..24)
    for (let i = 0; i < 5; i++) {
        const sx = 20 * TS + 3 + i * 31, sy = 12 * TS + 5;
        box(g, sx, sy, 26, 20, '#05070b'); box(g, sx + 1.5, sy + 1.5, 23, 17, '#0e1a14');
    }
    box(g, 19 * TS + 5, 13 * TS + 4, 22, 2 * TS - 8, '#131a28'); box(g, 19 * TS + 8, 13 * TS + 10, 16, 20, '#0a0d14'); box(g, 19 * TS + 9, 13 * TS + 11, 14, 8, '#fbbf24');
}

function towerDoor(g, def) {
    // dörrkarm, trösklar och dörrmatta (glasbladen ritas i dyn)
    const x = 12 * TS, y = 15 * TS, w = 2 * TS;
    box(g, x, y, w, TS, '#05080f'); box(g, x, y + 22, w, 10, '#1a2a52');
    box(g, x - 4, y, 6, TS, '#8795ad'); box(g, x + w - 2, y, 6, TS, '#8795ad');
    box(g, x - 3, y + 1, 2, TS - 2, 'rgba(255,255,255,0.35)'); box(g, x + w + 2, y + 1, 2, TS - 2, 'rgba(255,255,255,0.35)');
    neonLine(g, [[x - 6, y + 2], [x - 6, y + 24]], '#f59e0b', 2); neonLine(g, [[x + w + 6, y + 2], [x + w + 6, y + 24]], '#f59e0b', 2);
    // dörrmatta
    box(g, x + 2, 13.4 * TS, w - 4, 20, '#10233f'); g.strokeStyle = '#d4a72c'; g.lineWidth = 1; g.strokeRect(x + 3.5, 13.4 * TS + 1.5, w - 7, 17);
    g.font = `6px ${SIGN_FONT}`; g.fillStyle = 'rgba(255,225,160,0.9)'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('VÄLKOMMEN', x + TS, 13.4 * TS + 10);
}

// ── Hissarna: tillstånd (B.ex) ──
function initElevators() {
    return EL_X.map((x, i) => ({ x, open: 0, want: 0, away: 0, trip: 1, maxF: 8 + i * 3, idleT: 2 + i * 2.3, assigned: 0, pend: 0, pendT: 0, ding: 0 }));
}

function towerTick(state, B, dt, rnd) {
    const ex = B.ex, flow = clamp(state.flow === undefined ? 1 : state.flow, 0, 3);
    const panic = state.panic > 0;
    for (let i = 0; i < ex.length; i++) {
        const e = ex[i];
        if (panic) { e.want = 0; e.pend = 0; }
        if (e.away > 0) {
            e.away -= dt;
            e.open = Math.max(0, e.open - dt * 2.2);
            if (e.away <= 0 && !panic) { // ankomst: ding, dörrarna glider upp, ibland kliver folk ut
                e.want = 3.6; e.ding = 1.2;
                e.pend = rnd() < clamp(0.8 * flow, 0, 1) ? (rnd() < 0.3 ? 2 : 1) : 0;
                e.pendT = 0;
            } else if (e.away <= 0) e.away = 0;
            continue;
        }
        const wantsOpen = e.want > 0 || e.pend > 0;
        if (e.want > 0) e.want -= dt;
        e.open = clamp(e.open + (wantsOpen ? 1 : -1) * dt * 2.2, 0, 1);
        if (e.ding > 0) e.ding -= dt;
        if (e.pend > 0 && e.open > 0.7) {
            e.pendT -= dt;
            if (e.pendT <= 0) {
                e.pend--; e.pendT = 0.9;
                let nc = 0;
                for (const n of state.npcs) if (n.cust && !n.brawl) nc++;
                if (nc < 14 && !panic) state.npcs.push(towerArrival(rnd, e.x));
            }
        }
        // en tom, stängd hiss åker upp på en tur
        if (!wantsOpen && e.open < 0.02 && e.assigned <= 0) {
            e.idleT -= dt;
            if (e.idleT <= 0) { e.trip = rand(rnd, 7, 16); e.away = e.trip; e.maxF = 5 + Math.floor(rnd() * 20); e.idleT = rand(rnd, 3, 9); }
        }
    }
    // entrédörrarna glider upp när någon är nära
    const d = state.def.door;
    let near = false;
    for (const n of state.npcs) if (Math.abs(n.x - d.x) < 44 && n.y > d.y - 40) { near = true; break; }
    B.dk = clamp((B.dk || 0) + (near ? 1 : -1) * dt * 3, 0, 1);
}

// Hisshooken: välj hiss, gå dit, vänta på öppna dörrar och kliv in
const TOWER_HOOKS = {
    board: {
        start(n, s, state, B) {
            const c = n.c, def = state.def;
            const pick1 = () => {
                let best = -1, bs = 1e9;
                B.ex.forEach((e, i) => { const sc = (e.away > 0 ? 100 + e.away : 0) + e.assigned * 6 + Math.abs(e.x - n.x) * 0.02; if (sc < bs) { bs = sc; best = i; } });
                return best;
            };
            const i = pick1();
            c.elev = i; B.ex[i].assigned++; c.hm = 'walk'; c.hw = 0;
            if (!aim(n, def, B.ex[i].x, EL_Y)) { B.ex[i].assigned--; return 'skip'; }
            return true;
        },
        step(n, s, state, B, dt) {
            const c = n.c, def = state.def;
            let e = B.ex[c.elev];
            if (c.hm === 'walk') {
                if (walkStep(n, def, dt)) { c.hm = 'wait'; n.pose = 'idle'; } else separate(n, state, dt);
                return false;
            }
            poseTick(n, dt);
            n.pose = 'idle';
            turnToward(n, -PI / 2, dt * 8);
            c.hw += dt;
            if (e.away <= 0) e.want = Math.max(e.want, 1.6); // tryck på knappen
            if (e.away <= 0 && e.open >= 0.88) { // in i hissen
                e.assigned--; e.want = Math.max(e.want, 1.3); e.boarded = (e.boarded || 0) + 1;
                n.dead = true; c.hm = 'done';
                return false;
            }
            if (c.hw > 7 && e.away > 0) { // den här hissen är på väg: pröva en annan
                const alt = B.ex.findIndex((q, i) => i !== c.elev && q.away <= 0);
                if (alt >= 0) { e.assigned--; c.elev = alt; B.ex[alt].assigned++; c.hm = 'walk'; c.hw = 0; if (!aim(n, def, B.ex[alt].x, EL_Y)) { n.dead = true; } }
            }
            return false;
        }
    }
};

// ── Rörligt ──
function dynTower(ctx, state, v, t) {
    const def = state.def, B = state.biz;
    // fontänen: ringar på vattnet och strålar
    const cx = 416, cy = 192;
    if (inView(v, cx, cy, 40)) {
        for (let k = 0; k < 3; k++) {
            const p = (t * 0.45 + k / 3) % 1;
            ctx.strokeStyle = `rgba(190,235,255,${0.5 * (1 - p)})`; ctx.lineWidth = 1.2;
            ctx.beginPath(); ctx.arc(cx, cy, 6 + p * 17, 0, TAU); ctx.stroke();
        }
        for (let i = 0; i < 6; i++) {
            const a = i * TAU / 6 + t * 0.6, r = 9 + Math.sin(t * 3 + i * 2) * 2.5;
            disc(ctx, cx + Math.cos(a) * r, cy + Math.sin(a) * r, 1.8, 'rgba(230,248,255,0.85)');
        }
        disc(ctx, cx, cy, 3.4 + Math.sin(t * 5) * 0.8, 'rgba(240,252,255,0.95)');
        ctx.fillStyle = 'rgba(255,255,255,0.65)';
        for (let i = 0; i < 4; i++) { const a = t * 1.7 + i * 1.7; ctx.fillRect(cx + Math.cos(a) * 19 - 0.7, cy + Math.sin(a * 1.3) * 19 - 0.7, 1.5, 1.5); }
    }
    // hissarnas våningsvisare
    if (B && B.ex) {
        ctx.save();
        ctx.font = '700 8px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let i = 0; i < B.ex.length; i++) {
            const e = B.ex[i], x = e.x;
            if (!inView(v, x, 40, 40)) continue;
            ctx.fillStyle = '#05070b'; ctx.fillRect(x - 15, TS + 1, 30, 9);
            let txt = 'L', col = '#4ade80', dir = 0;
            if (e.away > 0) {
                const p = 1 - e.away / e.trip;
                txt = String(Math.max(1, Math.round(e.maxF * (p < 0.5 ? p * 2 : (1 - p) * 2)))); col = '#fb923c'; dir = p < 0.5 ? 1 : -1;
            }
            ctx.fillStyle = col; ctx.fillText(txt, x + 3, TS + 6);
            if (dir) { ctx.beginPath(); if (dir > 0) { ctx.moveTo(x - 9, TS + 7.6); ctx.lineTo(x - 5, TS + 7.6); ctx.lineTo(x - 7, TS + 3.6); } else { ctx.moveTo(x - 9, TS + 3.6); ctx.lineTo(x - 5, TS + 3.6); ctx.lineTo(x - 7, TS + 7.6); } ctx.fill(); }
            else if (e.open > 0.1) { ctx.fillStyle = (Math.floor(t * 3) & 1) ? '#4ade80' : '#14532d'; ctx.fillRect(x - 10, TS + 3, 5, 4); }
            if (e.ding > 0) { ctx.fillStyle = `rgba(74,222,128,${0.5 * Math.min(1, e.ding)})`; ctx.fillRect(x - 15, TS + 1, 30, 9); }
        }
        ctx.restore();
    }
    // entrédörrens glasblad
    const k = B ? B.dk || 0 : 0, dx = 12 * TS, dy = 15 * TS;
    const lw = 30 * (1 - k);
    if (lw > 0.5) {
        ctx.fillStyle = 'rgba(150,215,255,0.34)'; ctx.fillRect(dx + 2, dy + 2, lw, 24); ctx.fillRect(dx + 2 * TS - 2 - lw, dy + 2, lw, 24);
        ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(dx + 2, dy + 2, lw, 1.4); ctx.fillRect(dx + 2 * TS - 2 - lw, dy + 2, lw, 1.4);
        ctx.fillStyle = '#c7d2e2'; ctx.fillRect(dx + 2 + lw - 1.5, dy + 2, 1.5, 24); ctx.fillRect(dx + 2 * TS - 2 - lw, dy + 2, 1.5, 24);
    }
    // övervakningsskärmarna i vaktkuren
    for (let i = 0; i < 5; i++) {
        const sx = 20 * TS + 4.5 + i * 31, sy = 12 * TS + 6.5;
        if (!inView(v, sx, sy, 30)) continue;
        ctx.fillStyle = i === 2 ? 'rgba(80,200,120,0.32)' : 'rgba(120,200,150,0.2)'; ctx.fillRect(sx, sy, 23, 17);
        const sc = (t * 14 + i * 9) % 17;
        ctx.fillStyle = 'rgba(190,255,210,0.5)'; ctx.fillRect(sx, sy + sc, 23, 1.2);
        for (let q = 0; q < 3; q++) { const hh = tileHash(i * 3 + q, Math.floor(t * 0.8) + i); ctx.fillStyle = 'rgba(220,255,230,0.45)'; ctx.fillRect(sx + 2 + hh % 16, sy + 2 + (hh >> 4) % 12, 3, 3); }
    }
    exitArrow(ctx, def, t);
}

// Det som ligger över folk: hissens inre och dörrar (människor försvinner in i hissen)
function overTower(ctx, state, v, t) {
    const B = state.biz;
    if (!B || !B.ex) return;
    for (let i = 0; i < B.ex.length; i++) {
        const e = B.ex[i], cx = e.x;
        if (e.open < 0.02 || !inView(v, cx, 50, 60)) continue;
        const k = e.open, h = 26 * k;
        ctx.save();
        ctx.beginPath(); ctx.rect(cx - h, TS + 4, 2 * h, 34); ctx.clip();
        // inre: mörk bakvägg med spegel och handledare, varmt golv, sidoväggar
        ctx.fillStyle = '#463d2e'; ctx.fillRect(cx - 27, TS + 4, 54, 10);
        ctx.fillStyle = '#7f95ad'; ctx.fillRect(cx - 19, TS + 6, 38, 5);
        ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(cx - 19, TS + 6, 38, 1.2);
        ctx.fillStyle = '#d4a72c'; ctx.fillRect(cx - 27, TS + 13, 54, 1.6);
        ctx.fillStyle = '#a8946a'; ctx.fillRect(cx - 27, TS + 14.6, 54, 24);
        ctx.fillStyle = 'rgba(0,0,0,0.12)'; for (let g = 0; g < 54; g += 9) ctx.fillRect(cx - 27 + g, TS + 14.6, 1, 24);
        ctx.fillStyle = '#566074'; ctx.fillRect(cx - 27, TS + 4, 3.4, 35); ctx.fillRect(cx + 23.6, TS + 4, 3.4, 35);
        ctx.fillStyle = 'rgba(255,244,208,0.22)'; ctx.fillRect(cx - 24, TS + 14.6, 48, 7);
        ctx.restore();
        // tröskel
        ctx.fillStyle = '#4b5568'; ctx.fillRect(cx - 27, 2 * TS + 2, 54, 4);
        ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(cx - 27, 2 * TS + 2, 54, 1);
        // dörrbladen glider in i karmen
        leafPaint(ctx, cx - 26, TS + 4, 26 - h, TS - 4);
        leafPaint(ctx, cx + h, TS + 4, 26 - h, TS - 4);
    }
}

const TOWER_GLOWS = [
    [416, 24, 190, '#f59e0b', 0.28, 0],
    [416, 54, 260, '#ffe8b0', 0.09, 0],
    [416, 192, 120, '#60a5fa', 0.2, 1.6],
    [416, 310, 190, '#ffe8b0', 0.1, 0],
    [112, 240, 130, '#ffe1a0', 0.1, 0],
    [720, 240, 130, '#ffe1a0', 0.1, 0],
    [704, 420, 110, '#60a5fa', 0.14, 0],
    [416, 490, 120, '#bcd4ff', 0.22, 0],
    [416, 400, 110, '#f59e0b', 0.08, 0]
];
function lightsTower(ctx, state, v, t, glow) {
    const B = state.biz;
    if (!B || !B.ex) return;
    for (const e of B.ex) {
        if (e.open > 0.05) glow(e.x, 62, 50, '#ffe8b0', 0.12 * e.open);
        glow(e.x, 38, 20, e.away > 0 ? '#fb923c' : '#4ade80', 0.12);
    }
}

// ── Folk ──
const TOWER_LINES = {
    receptionist: ['Välkommen till Skyskrapan.', 'Hyran förfaller i dag.', 'Vilken våning?', 'Hissen står där borta.'],
    guard: ['Visa passerkortet.', 'Hissarna är dit bort.', 'Ta det lugnt i lobbyn.', 'Inga bråk här.'],
    cleaner: ['Pass upp, vått golv!', 'Ser ut som en grisfarm här.'],
    tenant: ['Femte våningen, tack.', 'Hyran höjs igen...', 'Fin fontän.', 'Dags för möte.']
};
const TOWER_SHIRTS = ['#1f2937', '#334155', '#0f172a', '#3f3f46', '#1e3a5f', '#e5e7eb', '#a16207', '#7f1d1d', '#065f46', '#4c1d95'];
const towerLook = rnd => look(rnd, TOWER_SHIRTS, { dress: 0.35, dressCols: ['#be123c', '#0f766e', '#7c3aed', '#1d4ed8', '#334155', '#f8fafc'] });

const TOWER_SOFAS = [
    seat(2, 6, 1, 6, PI / 2), seat(5, 6, 6, 6, PI / 2), seat(2, 8, 1, 8, -PI / 2), seat(5, 8, 6, 8, -PI / 2),
    seat(20, 6, 19, 6, PI / 2), seat(23, 6, 24, 6, PI / 2), seat(20, 8, 19, 8, -PI / 2), seat(23, 8, 24, 8, -PI / 2)
];
const FOUNTAIN_SPOTS = [[11, 5], [11, 6], [14, 5], [14, 6], [12, 4], [13, 4], [12, 7], [13, 7]].map(([x, y]) => ({ x: tc(x), y: tc(y), a: Math.atan2(192 - tc(y), 416 - tc(x)) }));

function towerTenantProp(rnd) { return pick(rnd, ['case', 'case', 'tablet', null, 'phone', 'bag']); }

function towerVisitor(rnd, from) {
    const stages = [{ k: 'queue' }];
    if (rnd() < 0.22) stages.push({ k: 'sit', opts: TOWER_SOFAS, t: [7, 14], drink: null });
    stages.push({ k: 'board' });
    return actor('tenant', from.x, from.y, rnd, { look: towerLook(rnd), stages, speed: rand(rnd, 40, 50), lines: TOWER_LINES.tenant, angle: -PI / 2, prop: towerTenantProp(rnd) });
}

// Den som kliver ut ur en hiss: går mot utgången, ibland via fontän eller soffa
function towerArrival(rnd, x) {
    const r = rnd(), stages = [];
    if (r < 0.28) { const f = pick(rnd, FOUNTAIN_SPOTS); stages.push({ k: 'visit', x: f.x, y: f.y, a: f.a, pose: 'idle', t: [3, 6], prop: null, say: 'Fin fontän.' }); }
    else if (r < 0.46) stages.push({ k: 'sit', opts: TOWER_SOFAS, t: [7, 14], drink: null });
    stages.push(...leaveStages(TOWER_DEF));
    return actor('tenant', x, EL_Y, rnd, { look: towerLook(rnd), stages, speed: rand(rnd, 42, 52), lines: TOWER_LINES.tenant, angle: PI / 2, prop: towerTenantProp(rnd) });
}

function populateTower(def, rnd) {
    const npcs = [], pop = { q: 0, taken: new Set() };
    const add = n => { if (n) npcs.push(n); return n; };
    const H = PI / 2;
    add(staffAt('receptionist', rnd, pop, [V(tc(12), tc(9), H, 'work', 7, 14), V(tc(11), tc(9), H, 'work', 5, 10)], { watch: true, lines: TOWER_LINES.receptionist, look: { shirt: '#0f766e', skin: '#e0ac69', hair: '#7c2d12', dress: '#0f766e', badge: '#fde047' } }));
    add(staffAt('receptionist', rnd, pop, [V(tc(14), tc(9), H, 'work', 8, 15), V(tc(15), tc(9), H, 'work', 5, 10)], { watch: true, start: 1, lines: TOWER_LINES.receptionist, look: { shirt: '#1e3a5f', skin: '#c68642', hair: '#111111', badge: '#fde047' } }));
    // vakt i lobbyn: går mellan dörren, hissarna och sofforna
    add(staffAt('guard', rnd, pop, [V(tc(10), tc(13), 0, 'idle', 6, 10), V(tc(6), tc(12), -0.5, 'idle', 5, 9), V(tc(7), tc(3), 0, 'idle', 6, 10), V(tc(18), tc(3), PI, 'idle', 6, 10), V(tc(18), tc(13), PI, 'idle', 5, 9)], { watch: true, speed: 34, lines: TOWER_LINES.guard, look: { shirt: '#0f172a', skin: '#8d5524', hair: '#111111', cap: '#0b1224', badge: '#fbbf24' } }));
    // vakt i kuren
    add(staffAt('guard', rnd, pop, [V(tc(22), tc(13), -H, 'work', 8, 14), V(tc(23), tc(14) - 6, -H, 'work', 6, 11), V(tc(21), tc(14) - 6, -H, 'work', 6, 11)], { watch: true, order: 'rand', lines: TOWER_LINES.guard, look: { shirt: '#1e293b', skin: '#c68642', hair: '#111111', cap: '#0b1224', badge: '#fbbf24' } }));
    // städaren
    add(staffAt('cleaner', rnd, pop, [V(tc(4), tc(13), 0, 'work', 4, 7), V(tc(9), tc(12), 0, 'work', 4, 7), V(tc(6), tc(2), 0, 'work', 4, 7), V(tc(19), tc(2), 0, 'work', 4, 7), V(tc(21), tc(12) - 4, 0, 'work', 3, 5)], { speed: 26, lines: TOWER_LINES.cleaner, look: { shirt: '#0e7490', skin: '#e0ac69', hair: '#d6d3d1', cap: '#0e7490' } }));
    // kön
    for (let i = 0; i < 2; i++) add(dropIn(towerVisitor(rnd, TOWER_QUEUE[i]), 0, rnd, pop));
    // soffgrupperna
    for (let i = 0; i < 2; i++) { const c = towerVisitor(rnd, def.door); c.c.stages.splice(1, 0, { k: 'sit', opts: TOWER_SOFAS, t: [9, 18], drink: null }); add(dropIn(c, 1, rnd, pop)); }
    // på väg till hissen och på väg ut
    const w1 = towerVisitor(rnd, { x: tc(10), y: tc(7) }); w1.c.stages = [{ k: 'board' }]; add(w1);
    const w2 = towerVisitor(rnd, { x: tc(15), y: tc(7) }); w2.c.stages = [{ k: 'board' }]; add(w2);
    for (const [fx, fy] of [[7, 5], [18, 12], [14, 7]]) {
        const a = towerArrival(rnd, EL_X[2]); a.x = tc(fx); a.y = tc(fy); a.angle = PI / 2; a.c.stages = leaveStages(def); add(a);
    }
    const f = pick(rnd, FOUNTAIN_SPOTS), fv = towerArrival(rnd, EL_X[1]);
    fv.c.stages = [{ k: 'visit', x: f.x, y: f.y, a: f.a, pose: 'idle', t: [4, 9], prop: null }, ...leaveStages(def)];
    add(dropIn(fv, 0, rnd, pop));
    return npcs;
}

const TOWER_SPEC = {
    iv: [4.5, 9], max: 8, hooks: TOWER_HOOKS,
    initEx: () => initElevators(),
    spawn(state, B, rnd) {
        if (doorBlocked(state, state.def.door.x, state.def.door.y)) return null;
        return towerVisitor(rnd, state.def.door);
    },
    tick: towerTick,
    onFlee(n, state, B) {
        if (n.c.hm === 'walk' || n.c.hm === 'wait') { const e = B.ex[n.c.elev]; if (e) e.assigned = Math.max(0, e.assigned - 1); n.c.hm = null; }
    }
};

registerInterior(TOWER_DEF, {
    populate: (def, rnd) => populateTower(def, rnd),
    update: (state, dt, rnd) => bizUpdate(TOWER_SPEC, state, dt, rnd),
    step: (n, state, dt, rnd) => actStep(TOWER_SPEC, n, state, dt, rnd),
    paint: paintTower,
    dyn: dynTower,
    over: overTower,
    accessory: accessoryB,
    glows: TOWER_GLOWS,
    lights: lightsTower
});

// ═══════════════════════════════════════════
//  4. ROCKETFUEL INDUSTRIES  (id: rocket)
//  Fabrik och labb: en stor raket på sin plattform, löpande band med lådor,
//  bränsletankar med mätare, kontrollpaneler med blinkande lampor och en
//  försäljningsdisk. Ingenjörer i vita labbrockar jobbar hela tiden.
// ═══════════════════════════════════════════

const ROCKET_W = 26, ROCKET_H = 16;
const rocketGrid = (() => {
    const g = mkGrid(ROCKET_W, ROCKET_H, 12);
    // raketens plattform (x 8..17, y 2..4)
    g.rect(8, 2, 10, 3, '2');
    // bränsletankar uppe till höger: 2×2 rutor var
    g.rect(19, 2, 2, 2, '4').rect(22, 2, 2, 2, '4').rect(19, 5, 2, 2, '4').rect(22, 5, 2, 2, '4');
    // löpande bandet (x 12..23, y 8) med pressen i början och lådhögen i slutet
    g.rect(10, 8, 2, 1, '8').rect(12, 8, 12, 1, '3').rect(24, 8, 1, 3, 'Q');
    // kontrollpaneler: längs vänstra väggen och uppe till vänster
    g.rect(1, 3, 1, 6, '5').rect(3, 1, 4, 1, '5');
    // försäljningen: hyllor, disk och lådor som stänger av personalens sida
    g.rect(4, 10, 6, 1, '7').set(3, 11, 'Q').set(10, 11, 'Q').rect(4, 12, 6, 1, '1');
    // labbänk, tunnor och lådor på golvet nere till höger
    g.rect(15, 12, 4, 1, '6').rect(22, 11, 3, 3, 'Q').set(21, 13, '9').set(21, 14, '9').set(20, 14, '9');
    return g;
})();

const ROCKET_QUEUE = [4, 5, 6, 7, 8].map(x => ({ x: tc(x), y: tc(13) }));

const ROCKET_DEF = {
    id: 'rocket', name: 'RocketFuel Industries', theme: 'biz-rocket', w: ROCKET_W, h: ROCKET_H,
    rows: rocketGrid.rows(),
    legend: {
        '1': { name: 'försäljningsdisk', solid: true }, '2': { name: 'raketplattform', solid: true }, '3': { name: 'löpande band', solid: true },
        '4': { name: 'bränsletank', solid: true }, '5': { name: 'kontrollpanel', solid: true }, '6': { name: 'maskin', solid: true },
        '7': { name: 'varuhylla', solid: true }, '8': { name: 'press', solid: true }, '9': { name: 'tunna', solid: true }, Q: { name: 'lådor', solid: true }
    },
    spawn: { x: 416, y: tc(13) },
    exit: { x: 416, y: 15 * TS + 20, r: 22 },
    door: { x: 416, y: tc(14) },
    counter: { x: tc(4), y: 12 * TS + 14 },
    queue: ROCKET_QUEUE,
    interactions: [{ id: 'counter', label: 'E — Försäljningen: köp raketer, ägande, intäkter', x: tc(5) + 8, y: tc(13), r: 66 }],
    music: null,
    zones: [
        { x: 4, y: 11, w: 6, h: 1, kind: 'staff' },
        { x: 1, y: 9, w: 11, h: 6, kind: 'shop' },
        { x: 1, y: 1, w: 6, h: 8, kind: 'lab' }
    ]
};

// ── Måla ──
const ROCKET_PAL = { wall: '#20262e', face: '#3a4452', hi: '#5c6b82', line: '#080b10' };

function rocketFloorTile(g, def, tx, ty, ch) {
    const x = tx * TS, y = ty * TS, zone = zoneAt(def, tx, ty), h = tileHash(tx, ty);
    if (ch === 'e') { box(g, x, y, TS, TS, '#1b1f26'); return; }
    if (zone === 'shop') {
        // ljus gjuten betong med röd varumärkesrand
        box(g, x, y, TS, TS, (tx + ty) & 1 ? '#6b717b' : '#656b75');
        g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        g.fillStyle = 'rgba(255,255,255,0.07)'; g.fillRect(x + 2 + (h & 15), y + 3 + (h >> 4 & 15), 8, 1.4);
        return;
    }
    if (zone === 'lab') {
        box(g, x, y, TS, TS, (tx + ty) & 1 ? '#2d3745' : '#2a3441');
        g.strokeStyle = 'rgba(80,170,255,0.12)'; g.lineWidth = 1; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
        return;
    }
    // räfflad stålplåt med nitar
    box(g, x, y, TS, TS, (tx + ty) & 1 ? '#444b55' : '#40474f');
    g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 1.2;
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) {
        const px = x + 4 + i * 8, py = y + 4 + j * 8; g.beginPath();
        if ((i + j) & 1) { g.moveTo(px - 2, py - 2); g.lineTo(px + 2, py + 2); } else { g.moveTo(px + 2, py - 2); g.lineTo(px - 2, py + 2); }
        g.stroke();
    }
    g.strokeStyle = 'rgba(0,0,0,0.32)'; g.strokeRect(x + 0.5, y + 0.5, TS - 1, TS - 1);
    for (const [dx, dy] of [[2, 2], [TS - 3, 2], [2, TS - 3], [TS - 3, TS - 3]]) { g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x + dx, y + dy, 1.6, 1.6); }
}

function hazard(g, x, y, w, h, vertical) {
    g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
    box(g, x, y, w, h, '#16181b');
    g.fillStyle = '#e8b923';
    const n = Math.ceil((vertical ? h : w) / 12) + 2;
    for (let i = -1; i < n; i++) {
        g.beginPath();
        if (vertical) { g.moveTo(x, y + i * 12); g.lineTo(x + w, y + i * 12 - w); g.lineTo(x + w, y + i * 12 - w + 6); g.lineTo(x, y + i * 12 + 6); }
        else { g.moveTo(x + i * 12, y + h); g.lineTo(x + i * 12 + h, y); g.lineTo(x + i * 12 + h + 6, y); g.lineTo(x + i * 12 + 6, y + h); }
        g.closePath(); g.fill();
    }
    g.restore();
}

function paintRocket(g, def) {
    for (let ty = 0; ty < def.h; ty++) for (let tx = 0; tx < def.w; tx++) {
        const ch = def.rows[ty][tx];
        if (ch !== '#') rocketFloorTile(g, def, tx, ty, ch);
    }
    wallPass(g, def, ROCKET_PAL);
    aoPass(g, def);
    rocketFloorMarks(g, def);
    rocketPlatform(g, def);
    rocketTanks(g, def);
    rocketBelt(g, def);
    rocketConsoles(g, def);
    rocketLab(g, def);
    rocketSales(g, def);
    rocketWalls(g, def);
}

function rocketFloorMarks(g, def) {
    // gula gångstråk: runt raketen och längs bandet
    g.fillStyle = 'rgba(232,185,35,0.7)';
    g.fillRect(7 * TS + 20, 2 * TS - 4, 2, 3 * TS + 8); g.fillRect(18 * TS + 8, 2 * TS - 4, 2, 3 * TS + 8);
    g.fillRect(8 * TS - 4, 5 * TS + 2, 10 * TS + 8, 2);
    g.fillRect(9 * TS, 7 * TS + 28, 15 * TS, 2); g.fillRect(9 * TS, 9 * TS + 2, 15 * TS, 2);
    // rör i golvet från tankarna till raketen
    for (const [y, c] of [[3 * TS + 6, '#7c8696'], [3 * TS + 20, '#566174']]) {
        g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 7; g.beginPath(); g.moveTo(18 * TS, y + 1.5); g.lineTo(19 * TS, y + 1.5); g.stroke();
        g.strokeStyle = c; g.lineWidth = 5; g.beginPath(); g.moveTo(18 * TS, y); g.lineTo(19 * TS, y); g.stroke();
        g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 1; g.beginPath(); g.moveTo(18 * TS, y - 1.6); g.lineTo(19 * TS, y - 1.6); g.stroke();
    }
    for (const [x, y, c] of [[19 * TS - 4, 3 * TS + 3, '#e8b923'], [19 * TS - 4, 3 * TS + 17, '#e8b923']]) box(g, x, y, 3, 6, c);
    // golvbrunnar
    for (const [x, y] of [[3 * TS + 16, 5 * TS + 16], [20 * TS + 16, 10 * TS + 16]]) { disc(g, x, y, 8, '#23282f'); g.strokeStyle = '#59616d'; g.lineWidth = 1; g.beginPath(); g.arc(x, y, 8, 0, TAU); g.stroke(); for (let i = -4; i <= 4; i += 4) { g.beginPath(); g.moveTo(x - 5, y + i); g.lineTo(x + 5, y + i); g.stroke(); } }
}

function rocketPlatform(g, def) {
    const px = 8 * TS, py = 2 * TS, pw = 10 * TS, ph = 3 * TS;
    softShadow(g, px + pw / 2, py + ph / 2 + 3, pw / 2, ph / 2, 0.3);
    box(g, px, py, pw, ph, '#2b3038'); box(g, px + 3, py + 3, pw - 6, ph - 6, '#353b45');
    g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
    for (let x = px + 8; x < px + pw - 4; x += 8) { g.beginPath(); g.moveTo(x, py + 4); g.lineTo(x, py + ph - 4); g.stroke(); }
    // varningsrelingar längs långsidorna
    hazard(g, px, py, pw, 6, false); hazard(g, px, py + ph - 6, pw, 6, false);
    box(g, px, py, 4, ph, '#16181b'); box(g, px + pw - 4, py, 4, ph, '#16181b');
    drawRocketBody(g);
    // slangar från tankarna till raketens nos
    g.lineCap = 'round';
    g.strokeStyle = '#11141a'; g.lineWidth = 5; g.beginPath(); g.moveTo(18 * TS - 8, 3 * TS + 6); g.bezierCurveTo(18 * TS - 20, 3 * TS + 30, 560, 130, 538, 126); g.stroke();
    g.strokeStyle = '#e8b923'; g.lineWidth = 1.2; g.setLineDash([3, 5]); g.beginPath(); g.moveTo(18 * TS - 8, 3 * TS + 6); g.bezierCurveTo(18 * TS - 20, 3 * TS + 30, 560, 130, 538, 126); g.stroke(); g.setLineDash([]);
    g.lineCap = 'butt';
}

function drawRocketBody(g) {
    const cy = 112, x0 = 290, x1 = 520, r = 17;
    // vaggor under raketen
    for (const cx of [326, 410, 486]) { box(g, cx - 7, 70, 14, 84, '#202530'); box(g, cx - 5, 74, 10, 76, '#59627a'); box(g, cx - 5, 74, 10, 3, '#9aa6bb'); }
    softShadow(g, (x0 + x1) / 2 + 20, cy + 6, (x1 - x0) / 2 + 40, r + 2, 0.4);
    // fenor
    for (const s of [-1, 1]) {
        g.fillStyle = '#7f1d1d'; g.beginPath();
        g.moveTo(x0 + 2, cy + s * (r - 2)); g.lineTo(x0 - 16, cy + s * (r + 20)); g.lineTo(x0 + 22, cy + s * (r + 20)); g.lineTo(x0 + 46, cy + s * (r - 2)); g.closePath(); g.fill();
        g.fillStyle = '#dc2626'; g.beginPath();
        g.moveTo(x0 + 4, cy + s * (r - 2)); g.lineTo(x0 - 12, cy + s * (r + 16)); g.lineTo(x0 + 18, cy + s * (r + 16)); g.lineTo(x0 + 38, cy + s * (r - 2)); g.closePath(); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; g.stroke();
    }
    // motorklocka
    g.fillStyle = '#2b2f38'; g.beginPath(); g.moveTo(x0, cy - 9); g.lineTo(x0 - 20, cy - 15); g.lineTo(x0 - 20, cy + 15); g.lineTo(x0, cy + 9); g.closePath(); g.fill();
    g.strokeStyle = '#6b7384'; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = '#12151b'; g.beginPath(); g.ellipse(x0 - 20, cy, 3, 14, 0, 0, TAU); g.fill();
    g.fillStyle = '#7f4f2a'; g.beginPath(); g.moveTo(x0 - 4, cy - 7); g.lineTo(x0 - 4, cy + 7); g.lineTo(x0, cy + 9); g.lineTo(x0, cy - 9); g.fill();
    // kroppen: cylinder med skuggning
    const gr = g.createLinearGradient(0, cy - r, 0, cy + r);
    gr.addColorStop(0, '#a3afc2'); gr.addColorStop(0.22, '#f8fafc'); gr.addColorStop(0.5, '#e5e9f0'); gr.addColorStop(1, '#7a869b');
    rr(g, x0, cy - r, x1 - x0, 2 * r, 5); g.fillStyle = gr; g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 1; rr(g, x0 + 0.5, cy - r + 0.5, x1 - x0 - 1, 2 * r - 1, 5); g.stroke();
    // röda band
    for (const bx of [x0 + 46, x1 - 54]) { box(g, bx, cy - r, 14, 2 * r, '#c81e1e'); box(g, bx, cy - r, 14, 4, 'rgba(255,255,255,0.35)'); box(g, bx, cy + r - 5, 14, 5, 'rgba(0,0,0,0.25)'); }
    // plåtskarvar och nitar
    g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 1;
    for (let x = x0 + 80; x < x1 - 60; x += 34) { g.beginPath(); g.moveTo(x, cy - r + 1); g.lineTo(x, cy + r - 1); g.stroke(); }
    g.fillStyle = 'rgba(0,0,0,0.3)';
    for (let x = x0 + 8; x < x1 - 4; x += 12) { g.fillRect(x, cy - r + 3, 1.4, 1.4); g.fillRect(x, cy + r - 5, 1.4, 1.4); }
    // text
    g.save(); g.font = `9px ${SIGN_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#b91c1c';
    g.fillText('ROCKETFUEL', (x0 + 46 + 14 + x1 - 54) / 2, cy - 1); g.restore();
    box(g, x0 + 24, cy - 3, 12, 6, '#f8fafc'); g.font = `5px ${SIGN_FONT}`; g.fillStyle = '#7f1d1d'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('RF', x0 + 30, cy);
    // nosen
    const gn = g.createLinearGradient(0, cy - r, 0, cy + r);
    gn.addColorStop(0, '#f87171'); gn.addColorStop(0.3, '#ef4444'); gn.addColorStop(1, '#7f1d1d');
    g.fillStyle = gn; g.beginPath(); g.moveTo(x1, cy - r); g.quadraticCurveTo(x1 + 38, cy - r + 2, x1 + 54, cy); g.quadraticCurveTo(x1 + 38, cy + r - 2, x1, cy + r); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.5)'; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.moveTo(x1 + 4, cy - r + 3); g.quadraticCurveTo(x1 + 30, cy - r + 5, x1 + 40, cy - 3); g.lineTo(x1 + 8, cy - 3); g.fill();
    // lucka
    disc(g, x1 - 22, cy, 5, '#111827'); disc(g, x1 - 22, cy, 3.6, '#38bdf8'); disc(g, x1 - 23, cy - 1, 1.4, 'rgba(255,255,255,0.8)');
}

function rocketTanks(g, def) {
    const tanks = [[19, 2, 'LOX'], [22, 2, 'RP-1'], [19, 5, 'H2'], [22, 5, 'N2']];
    for (const [tx, ty, label] of tanks) {
        const cx = tx * TS + TS, cy = ty * TS + TS;
        softShadow(g, cx, cy, 31, 31, 0.4);
        disc(g, cx, cy, 30, '#3a414c');
        const gr = g.createRadialGradient(cx - 9, cy - 9, 4, cx, cy, 29);
        gr.addColorStop(0, '#e2e8f0'); gr.addColorStop(0.55, '#b6bfcc'); gr.addColorStop(1, '#6a7587');
        g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, 28, 0, TAU); g.fill();
        g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 1;
        for (const r of [10, 19]) { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke(); }
        for (let i = 0; i < 12; i++) { const a = i * TAU / 12; disc(g, cx + Math.cos(a) * 24, cy + Math.sin(a) * 24, 1.3, 'rgba(0,0,0,0.4)'); }
        // färgband och märkning
        g.strokeStyle = label === 'LOX' ? '#38bdf8' : label === 'RP-1' ? '#f97316' : label === 'H2' ? '#a3e635' : '#e5e7eb'; g.lineWidth = 3; g.beginPath(); g.arc(cx, cy, 25.4, PI * 0.15, PI * 0.85); g.stroke();
        g.font = `8px ${SIGN_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = '#1f2937'; g.fillText(label, cx, cy + 14);
        // luckan på toppen
        disc(g, cx - 6, cy - 6, 6, '#586274'); disc(g, cx - 6, cy - 6, 4.4, '#8e9ab0');
        // mätarens fäste
        box(g, cx + 6, cy - 14, 15, 14, '#171b22'); box(g, cx + 7, cy - 13, 13, 12, '#e8edf5');
    }
    // rörstomme mellan tankarna
    for (const x of [21 * TS + 2]) { g.fillStyle = '#566174'; g.fillRect(x - 3, 2 * TS + 8, 6, 5 * TS - 8); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x - 3, 2 * TS + 8, 1.4, 5 * TS - 8); }
    for (const y of [4 * TS + 16]) box(g, 19 * TS + 6, y - 3, 5 * TS - 12, 6, '#566174');
}

function rocketBelt(g, def) {
    // pressen i början
    const mx = 10 * TS, my = 8 * TS;
    softShadow(g, mx + TS, my + 16, TS, 15, 0.35);
    box(g, mx, my, 2 * TS, TS, '#22272f'); box(g, mx + 2, my + 2, 2 * TS - 4, TS - 4, '#4b5666');
    box(g, mx + 4, my + 4, 2 * TS - 8, 9, '#e8b923'); hazard(g, mx + 4, my + TS - 11, 2 * TS - 8, 7, false);
    disc(g, mx + 16, my + 18, 6, '#161a20'); disc(g, mx + 16, my + 18, 4.6, '#6a7587');
    box(g, mx + 38, my + 6, 20, 14, '#0e1218'); box(g, mx + 39, my + 7, 18, 12, '#0f3d2e');
    // bandet
    const bx = 12 * TS, by = 8 * TS, bw = 12 * TS;
    softShadow(g, bx + bw / 2, by + 17, bw / 2, 15, 0.3);
    box(g, bx, by, bw, TS, '#101318');
    box(g, bx, by + 4, bw, TS - 8, '#1c2026');
    box(g, bx, by, bw, 4, '#7a8498'); box(g, bx, by, bw, 1.4, 'rgba(255,255,255,0.4)');
    box(g, bx, by + TS - 4, bw, 4, '#5d6779');
    for (let x = bx + 16; x < bx + bw; x += 64) { disc(g, x, by + 2, 1.6, '#262b34'); disc(g, x, by + TS - 2, 1.6, '#262b34'); }
    // lådhögen i slutet
    eachTile(def, 'Q', (tx, ty) => crate(g, tx, ty));
}

function crate(g, tx, ty) {
    const x = tx * TS, y = ty * TS, h = tileHash(tx, ty);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, y + 4, TS - 2, TS - 2);
    box(g, x + 1, y + 1, TS - 2, TS - 2, h & 1 ? '#a8782e' : '#b4802f');
    g.fillStyle = 'rgba(0,0,0,0.25)'; for (let i = 1; i < 4; i++) g.fillRect(x + 1, y + i * 8, TS - 2, 1);
    g.strokeStyle = '#6e4d1a'; g.lineWidth = 2; g.strokeRect(x + 2, y + 2, TS - 4, TS - 4);
    box(g, x + 12, y + 1, 8, TS - 2, 'rgba(255,255,255,0.35)');
    g.font = `5px ${SIGN_FONT}`; g.fillStyle = '#7f1d1d'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('RF', x + 16, y + 16);
    if ((h >> 3) % 4 === 0) { box(g, x + 4, y + 22, 8, 6, '#e8b923'); }
}

function rocketConsoles(g, def) {
    eachTile(def, '5', (tx, ty) => {
        const x = tx * TS, y = ty * TS, vert = tx < 2; // vertikal rad mot vänster vägg, rad längs övre väggen
        softShadow(g, x + 16, y + 16, 15, 15, 0.3);
        box(g, x, y, TS, TS, '#12161c'); box(g, x + 1, y + 1, TS - 2, TS - 2, '#2a323d');
        if (vert) {
            box(g, x + 3, y + 3, 13, TS - 6, '#05080c'); box(g, x + 4, y + 4, 11, TS - 8, '#0c2230');
            box(g, x + 18, y + 3, 11, TS - 6, '#1a2029');
            for (let i = 0; i < 6; i++) for (let j = 0; j < 2; j++) box(g, x + 20 + j * 5, y + 5 + i * 4.4, 3, 3, '#3a4350');
        } else {
            box(g, x + 3, y + 3, TS - 6, 12, '#05080c'); box(g, x + 4, y + 4, TS - 8, 10, '#0c2230');
            box(g, x + 3, y + 17, TS - 6, 11, '#1a2029');
            for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) box(g, x + 5 + i * 5, y + 19 + j * 4.4, 3, 3, '#3a4350');
        }
        box(g, x + 1, y + 1, TS - 2, 1.4, 'rgba(255,255,255,0.18)');
    });
    // stol vid vänstra raden
    for (const ty of [4, 7]) { disc(g, 2 * TS + 14, ty * TS + 16, 9, '#10151c'); disc(g, 2 * TS + 14, ty * TS + 16, 7.4, '#475569'); }
}

function rocketLab(g, def) {
    // labbänk (rad 12, x 15..18): mikroskop, provrör, dator
    slabGroup(g, def, '6', { side: '#1f242c', top: '#cfd6e0', hi: 'rgba(255,255,255,0.8)', ins: 2 });
    eachTile(def, '6', (tx, ty) => {
        if (ty !== 12) return;
        const x = tx * TS, y = ty * TS, i = tx - 15;
        if (i === 0) { box(g, x + 5, y + 5, 22, 18, '#0a0d14'); box(g, x + 6, y + 6, 20, 12, '#38bdf8'); box(g, x + 6, y + 6, 20, 3, 'rgba(255,255,255,0.4)'); }
        if (i === 1) { disc(g, x + 14, y + 16, 6, '#4b5563'); disc(g, x + 14, y + 16, 3.4, '#cbd5e1'); box(g, x + 18, y + 12, 3, 10, '#1f2937'); }
        if (i === 2) for (let k = 0; k < 4; k++) { box(g, x + 4 + k * 6.4, y + 9, 3, 13, 'rgba(180,230,255,0.8)'); box(g, x + 4 + k * 6.4, y + 15 + (k & 1) * 3, 3, 7 - (k & 1) * 3, ['#ef4444', '#22c55e', '#facc15', '#a855f7'][k]); }
        if (i === 3) { box(g, x + 6, y + 6, 20, 16, '#e5e7eb'); disc(g, x + 16, y + 14, 4.6, '#7f1d1d'); disc(g, x + 16, y + 14, 2.4, '#ef4444'); }
    });
    // tunnor
    eachTile(def, '9', (tx, ty) => {
        const cx = tc(tx), cy = tc(ty), h = tileHash(tx, ty);
        softShadow(g, cx, cy, 13, 13, 0.35);
        disc(g, cx, cy, 13, '#6b1313'); disc(g, cx, cy, 11.4, h & 1 ? '#b91c1c' : '#1d4ed8');
        g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 1; for (const r of [5, 8.5]) { g.beginPath(); g.arc(cx, cy, r, 0, TAU); g.stroke(); }
        disc(g, cx - 3, cy - 3, 2.4, 'rgba(255,255,255,0.4)'); disc(g, cx + 4, cy + 3, 1.8, '#e8b923');
    });
}

function rocketSales(g, def) {
    // hyllor med varor (rad 10)
    eachTile(def, '7', (tx, ty) => {
        const x = tx * TS, y = ty * TS, h = tileHash(tx, ty);
        g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, y + 4, TS, TS);
        box(g, x, y, TS, TS, '#171b21'); box(g, x + 1, y + 1, TS - 2, TS - 2, '#2e3540');
        box(g, x + 1, y + TS - 9, TS - 2, 2, '#4b5666'); box(g, x + 1, y + 15, TS - 2, 2, '#4b5666');
        const k = h % 3;
        for (let i = 0; i < 3; i++) {
            const ix = x + 3 + i * 9;
            if (k === 0) { box(g, ix, y + 6, 7, 9, '#dc2626'); box(g, ix + 2, y + 3, 3, 3, '#6b7280'); box(g, ix + 1, y + 9, 5, 2, '#fff'); box(g, ix, y + 20, 7, 9, '#2563eb'); }
            else if (k === 1) { box(g, ix + 2, y + 4, 3, 11, '#f1f5f9'); box(g, ix + 2, y + 4, 3, 3, '#ef4444'); box(g, ix + 2, y + 18, 3, 10, '#f1f5f9'); box(g, ix + 2, y + 18, 3, 3, '#ef4444'); box(g, ix, y + 13, 7, 2, '#ef4444'); }
            else { box(g, ix, y + 5, 7, 10, ['#1f2937', '#be123c', '#0f766e'][i]); box(g, ix + 2, y + 6, 3, 2, '#fef3c7'); box(g, ix, y + 19, 7, 10, ['#be123c', '#0f766e', '#1f2937'][i]); }
        }
    });
    // disken
    slabGroup(g, def, '1', { side: '#1a1d22', top: '#9a6a3a', hi: 'rgba(255,230,190,0.45)', ins: 3 });
    const dy = 12 * TS, x = 4 * TS;
    // kassa, modellraket, orderblock, prislapp
    box(g, x + 8, dy + 6, 22, 18, '#0a0d14'); box(g, x + 10, dy + 8, 18, 9, '#86efac'); box(g, x + 10, dy + 8, 18, 2.4, 'rgba(255,255,255,0.45)');
    box(g, x + 36, dy + 11, 40, 10, '#e5e7eb'); box(g, x + 36, dy + 11, 40, 3, '#fff'); g.fillStyle = '#ef4444'; g.beginPath(); g.moveTo(x + 76, dy + 11); g.lineTo(x + 88, dy + 16); g.lineTo(x + 76, dy + 21); g.fill();
    box(g, x + 44, dy + 8, 6, 5, '#dc2626'); box(g, x + 44, dy + 19, 6, 5, '#dc2626'); box(g, x + 90, dy + 12, 8, 8, '#6b7280');
    box(g, x + 112, dy + 6, 20, 18, '#f8fafc'); for (let i = 0; i < 4; i++) box(g, x + 114, dy + 9 + i * 4, 16, 1.2, '#94a3b8');
    plate(g, x + 142, dy + 7, 46, 16, 3, '#16181c', '#e8b923', 1);
    g.font = `6px ${SIGN_FONT}`; g.fillStyle = '#fde68a'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('RAKETER', x + 165, dy + 15.5);
    // skylt över hyllorna
    plate(g, 4.4 * TS, 10 * TS + 8, 5.2 * TS, 16, 4, 'rgba(10,12,16,0.92)', 'rgba(255,106,0,0.9)', 1.2);
    neonText(g, 'FÖRSÄLJNING', 7 * TS, 10 * TS + 16.5, 9, '#ffc58a', '#ff6a00');
}

function rocketWalls(g, def) {
    signPlate(g, 'ROCKETFUEL INDUSTRIES', 416, 17, 290, 24, 12, '#ffc58a', '#ff6a00');
    g.font = `17px ${EMOJI_FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('🚀', 250, 17); g.fillText('🚀', 582, 17);
    // nedräkningsskylt uppe till höger (siffrorna i dyn)
    plate(g, 21 * TS - 6, 5, 106, 22, 4, '#05070b', '#ef4444', 1.2);
    // varningsskyltar och brandsläckare på väggarna
    hazard(g, 0, 10 * TS, 8, 32, true); hazard(g, 25 * TS + 24, 3 * TS, 8, 64, true);
    for (const [x, y] of [[26 * TS - 12, 12 * TS + 6], [4, 9 * TS + 2]]) { box(g, x, y, 8, 12, '#b91c1c'); box(g, x + 1, y + 1, 6, 3, '#fecaca'); box(g, x + 2, y + 5, 4, 5, '#7f1d1d'); }
    exitSign(g, 9 * TS + 6, 15 * TS + 10);
    // stålporten: stora tunga dörrar
    const x = 12 * TS, y = 15 * TS, w = 2 * TS;
    box(g, x, y, w, TS, '#59606a');
    for (const side of [0, 1]) {
        const bx = x + 2 + side * 31;
        box(g, bx, y + 2, 29, 28, '#78808b'); box(g, bx, y + 2, 29, 3, 'rgba(255,255,255,0.28)');
        g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; g.strokeRect(bx + 0.5, y + 2.5, 28, 27);
        for (const [dx, dy] of [[4, 6], [25, 6], [4, 26], [25, 26]]) disc(g, bx + dx, y + dy, 1.4, '#3a3f47');
    }
    box(g, x, y + 24, w, 6, '#17181a');
    g.fillStyle = '#e8b923';
    for (let xx = x - 4; xx < x + w; xx += 12) { g.beginPath(); g.moveTo(xx, y + 24); g.lineTo(xx + 6, y + 24); g.lineTo(xx + 2, y + 30); g.lineTo(xx - 4, y + 30); g.closePath(); g.fill(); }
    box(g, x + 31, y + 2, 2, 22, '#2a2f36');
}

// ── Rörligt ──
const ROCKET_TANKS = [[19, 2], [22, 2], [19, 5], [22, 5]].map(([tx, ty], i) => ({ cx: tx * TS + TS, cy: ty * TS + TS, ph: i * 1.7 + 0.4 }));
const BOX_COLS = ['#b4802f', '#a8782e', '#c08a38'];

function dynRocket(ctx, state, v, t) {
    const def = state.def;
    // bandet rullar: ränder glider åt höger
    const bx = 12 * TS, by = 8 * TS, bw = 12 * TS;
    if (inView(v, bx + bw / 2, by + 16, bw / 2 + 20)) {
        ctx.fillStyle = 'rgba(255,255,255,0.07)';
        const off = (t * 30) % 12;
        for (let x = bx + off; x < bx + bw; x += 12) ctx.fillRect(x, by + 5, 2.2, TS - 10);
        // lådor och miniraketer på väg mot hörnet
        for (let k = 0; k < 6; k++) {
            const px = bx + ((t * 30 + k * 64) % bw), h = tileHash(k, 5);
            if (px > bx + bw - 10) continue;
            const rocketBox = h % 3 === 0;
            ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(px - 9, by + 8, 21, 18);
            if (rocketBox) { // miniraket på bandet
                ctx.fillStyle = '#e5e7eb'; ctx.fillRect(px - 10, by + 12, 17, 8);
                ctx.fillStyle = '#ef4444'; ctx.beginPath(); ctx.moveTo(px + 7, by + 12); ctx.lineTo(px + 13, by + 16); ctx.lineTo(px + 7, by + 20); ctx.fill();
                ctx.fillRect(px - 10, by + 10, 5, 3); ctx.fillRect(px - 10, by + 19, 5, 3);
            } else {
                ctx.fillStyle = BOX_COLS[h % 3]; ctx.fillRect(px - 10, by + 7, 20, 17);
                ctx.fillStyle = 'rgba(255,255,255,0.3)'; ctx.fillRect(px - 2, by + 7, 4, 17);
                ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(px - 10, by + 7, 20, 2);
            }
        }
    }
    // pressens kolv slår ned var tredje sekund
    const pk = (t % 3) / 3, hit = pk < 0.12 ? pk / 0.12 : pk < 0.3 ? 1 - (pk - 0.12) / 0.18 : 0;
    ctx.fillStyle = '#9aa5b8'; ctx.fillRect(10 * TS + 8, 8 * TS + 8 + hit * 5, 10, 8);
    ctx.fillStyle = hit > 0.2 ? '#fbbf24' : '#1f2937'; ctx.fillRect(10 * TS + 51, 8 * TS + 9, 4, 4);
    // tankarnas mätare: visare och nivå
    for (const k of ROCKET_TANKS) {
        if (!inView(v, k.cx, k.cy, 40)) continue;
        const lvl = 0.55 + 0.4 * Math.sin(t * 0.22 + k.ph) * Math.sin(t * 0.13 + k.ph * 2);
        const gx = k.cx + 13.5, gy = k.cy - 7;
        ctx.save(); ctx.translate(gx, gy);
        const a = -PI * 0.85 + lvl * PI * 1.7 + Math.sin(t * 9 + k.ph) * 0.03;
        ctx.strokeStyle = '#ef4444'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 4.6, PI * 0.15, PI * 0.5); ctx.stroke();
        ctx.strokeStyle = '#16a34a'; ctx.beginPath(); ctx.arc(0, 0, 4.6, -PI * 0.85, -PI * 0.2); ctx.stroke();
        ctx.strokeStyle = '#111827'; ctx.lineWidth = 1.3; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 5.2, Math.sin(a) * 5.2); ctx.stroke();
        ctx.restore();
        // nivåstav på tankens kant
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(k.cx - 27, k.cy - 16, 4, 32);
        ctx.fillStyle = lvl > 0.85 ? '#f43f5e' : lvl < 0.3 ? '#fbbf24' : '#38bdf8'; ctx.fillRect(k.cx - 26.5, k.cy + 15.5 - lvl * 31, 3, lvl * 31);
        // varningslampa
        ctx.fillStyle = Math.floor(t * 2 + k.ph) % 2 ? '#fb923c' : '#5b2a0a'; ctx.beginPath(); ctx.arc(k.cx + 18, k.cy + 15, 2, 0, TAU); ctx.fill();
    }
    // kontrollpaneler: skärmar med grafer och blinkande lampor
    const cs = tilesOf(def, '5');
    for (let i = 0; i < cs.length; i += 2) {
        const tx = cs[i], ty = cs[i + 1], x = tx * TS, y = ty * TS, vert = tx < 2, ph = tileHash(tx, ty);
        if (!inView(v, x + 16, y + 16, 24)) continue;
        // skärm
        const sx = vert ? x + 4 : x + 4, sy = vert ? y + 4 : y + 4, sw = vert ? 11 : TS - 8, sh = vert ? TS - 8 : 10;
        const col = ph % 3 === 0 ? '#4ade80' : ph % 3 === 1 ? '#22d3ee' : '#fbbf24';
        ctx.fillStyle = col; ctx.globalAlpha = 0.85;
        for (let k = 0; k < 5; k++) {
            const lv = 0.25 + 0.75 * Math.abs(Math.sin(t * (1.1 + k * 0.37) + ph + k));
            if (vert) ctx.fillRect(sx + 1, sy + 2 + k * 4.6, (sw - 2) * lv, 2.4); else ctx.fillRect(sx + 2 + k * 4.4, sy + sh - 2 - (sh - 4) * lv, 2.6, (sh - 4) * lv);
        }
        ctx.globalAlpha = 1;
        // lampor
        const n = 10;
        for (let k = 0; k < n; k++) {
            const hh = tileHash(ph + k, tx * 3 + ty), f = 1.2 + (hh % 5) * 0.9;
            const on = Math.sin(t * f + hh) > 0.05;
            ctx.fillStyle = on ? (hh % 7 === 0 ? '#f43f5e' : hh % 3 === 0 ? '#fbbf24' : '#4ade80') : 'rgba(20,30,28,0.9)';
            if (vert) ctx.fillRect(x + 20 + (k & 1) * 5, y + 5 + (k >> 1) * 4.4, 2.6, 2.6); else ctx.fillRect(x + 6 + (k >> 1) * 5, y + 20 + (k & 1) * 4.4, 2.6, 2.6);
        }
    }
    // raketen: ångor vid fenorna, pilotlåga i motorn
    for (let i = 0; i < 3; i++) {
        const k = (t * 0.45 + i / 3) % 1;
        ctx.fillStyle = `rgba(235,245,255,${0.34 * (1 - k)})`;
        ctx.beginPath(); ctx.arc(318 + i * 40 + Math.sin(t * 2 + i) * 3, 80 - k * 12, 2.6 + k * 4, 0, TAU); ctx.fill();
        ctx.beginPath(); ctx.arc(330 + i * 36 + Math.cos(t * 2 + i) * 3, 144 + k * 12, 2.6 + k * 4, 0, TAU); ctx.fill();
    }
    const fl = 0.6 + 0.4 * Math.sin(t * 17) * Math.sin(t * 7.3);
    ctx.fillStyle = `rgba(255,150,50,${0.55 * fl})`; ctx.beginPath(); ctx.ellipse(266, 112, 6 + fl * 2, 9, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = `rgba(255,240,180,${0.7 * fl})`; ctx.beginPath(); ctx.ellipse(268, 112, 3, 5, 0, 0, TAU); ctx.fill();
    // varningsljus som snurrar på plattformens hörn
    for (const [px, py] of [[8 * TS + 6, 2 * TS + 10], [18 * TS - 6, 5 * TS - 10]]) {
        const a = t * 4 + px;
        ctx.fillStyle = 'rgba(255,150,0,0.14)'; ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, 40, a - 0.4, a + 0.4); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(px, py); ctx.arc(px, py, 40, a + PI - 0.4, a + PI + 0.4); ctx.closePath(); ctx.fill();
        disc(ctx, px, py, 3.2, Math.sin(a) > 0 ? '#ffb347' : '#7c2d12');
    }
    // nedräkningsskylten
    ctx.save();
    ctx.font = `700 12px monospace`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const sec = 59 - Math.floor(t) % 60, fr = Math.floor((t % 1) * 100);
    ctx.fillStyle = '#ef4444'; ctx.fillText(`T-00:${String(sec).padStart(2, '0')}:${String(fr).padStart(2, '0')}`, 21 * TS + 47, 17);
    ctx.restore();
    // kassaskärmen blinkar
    if (Math.floor(t * 1.8) % 6 === 0) { ctx.fillStyle = 'rgba(255,255,255,0.4)'; ctx.fillRect(4 * TS + 10, 12 * TS + 8, 18, 9); }
    exitArrow(ctx, def, t);
}

const ROCKET_GLOWS = [
    [416, 24, 200, '#ff6a00', 0.26, 0],
    [268, 112, 80, '#ff8a3d', 0.3, 3.1],
    [416, 112, 220, '#cfe8ff', 0.07, 0],
    [48, 200, 130, '#22d3ee', 0.17, 0],
    [130, 40, 90, '#22d3ee', 0.14, 0],
    [672, 128, 120, '#38bdf8', 0.12, 0],
    [672, 224, 120, '#38bdf8', 0.12, 0],
    [576, 270, 140, '#ffd23f', 0.1, 0],
    [224, 340, 130, '#ffe1a0', 0.16, 0],
    [416, 492, 110, '#ff8a3d', 0.18, 2.4],
    [520, 400, 110, '#7dd3fc', 0.1, 0]
];

// ── Folk ──
const ROCKET_LINES = {
    engineer: ['Trycket ser bra ut.', 'Kolla mätarna.', 'Bränsle i, raket ut.', 'T minus snart.', 'Det är inte raketforskning. Jo, det är det.'],
    seller: ['En raket? Självklart.', 'Ta en keps med!', 'Kvitto?', 'RocketFuel, världens bästa.'],
    buyer: ['Wow, den är stor!', 'Går den att köra?', 'Jag tar den röda.', 'Dyr men fin.']
};
const ENG_LOOK = rnd => ({ shirt: '#f8fafc', skin: pick(rnd, SKINS), hair: pick(rnd, HAIRS) });
const ROCKET_SHIRTS = ['#1f2937', '#334155', '#0ea5e9', '#dc2626', '#16a34a', '#eab308', '#7c3aed', '#f97316', '#0f766e'];
const rocketLook = rnd => look(rnd, ROCKET_SHIRTS, { dress: 0.3, dressCols: ['#be123c', '#0f766e', '#7c3aed', '#1d4ed8', '#f59e0b'], cap: 0.2, capCols: ['#dc2626', '#1d4ed8', '#111827'] });
const VIEW_SPOTS = [];
for (let tx = 8; tx <= 17; tx++) VIEW_SPOTS.push({ x: tc(tx), y: tc(5) });

function rocketBuyer(rnd, from) {
    const view = pick(rnd, VIEW_SPOTS);
    const stages = [{ k: 'queue' }, { k: 'visit', x: view.x, y: view.y, a: -PI / 2, pose: 'idle', t: [8, 17], prop: rnd() < 0.4 ? 'phone' : null, say: 'Wow...' }];
    if (rnd() < 0.3) { const v2 = pick(rnd, VIEW_SPOTS); stages.push({ k: 'visit', x: v2.x, y: v2.y, a: -PI / 2, pose: 'idle', t: [4, 8], prop: null }); }
    stages.push(...leaveStages(ROCKET_DEF));
    return actor('buyer', from.x, from.y, rnd, { look: rocketLook(rnd), stages, speed: rand(rnd, 40, 50), lines: ROCKET_LINES.buyer, angle: PI, prop: null });
}

function populateRocket(def, rnd) {
    const npcs = [], pop = { q: 0, taken: new Set() };
    const add = n => { if (n) npcs.push(n); return n; };
    const H = PI / 2, N = -PI / 2;
    const eng = (extra = {}) => ({ look: { ...ENG_LOOK(rnd), ...(extra.look || {}) }, lines: ROCKET_LINES.engineer, order: extra.order, start: extra.start, prop: extra.prop, speed: 36 });
    // kontrollpanelerna
    add(staffAt('engineer', rnd, pop, [V(tc(2), tc(4), PI, 'work', 8, 16), V(tc(2), tc(5), PI, 'work', 6, 12), V(tc(2), tc(3), PI, 'work', 6, 12)], eng({ look: { goggles: true } })));
    add(staffAt('engineer', rnd, pop, [V(tc(2), tc(7), PI, 'work', 8, 16), V(tc(2), tc(8), PI, 'work', 6, 12)], eng({ start: 1 })));
    add(staffAt('engineer', rnd, pop, [V(tc(4), tc(2), N, 'work', 8, 16), V(tc(5), tc(2), N, 'work', 6, 12), V(tc(6), tc(2), N, 'work', 6, 10)], eng({ look: { goggles: true }, order: 'rand' })));
    // vid bandet: norra och södra sidan
    add(staffAt('engineer', rnd, pop, [V(tc(14), tc(7), H, 'work', 9, 16), V(tc(16), tc(7), H, 'work', 7, 12)], eng({ look: { cap: '#fde047' } })));
    add(staffAt('engineer', rnd, pop, [V(tc(19), tc(7), H, 'work', 9, 16), V(tc(21), tc(7), H, 'work', 7, 12)], eng({ start: 1, look: { goggles: true } })));
    add(staffAt('engineer', rnd, pop, [V(tc(15), tc(9), N, 'work', 9, 16), V(tc(17), tc(9), N, 'work', 7, 12)], eng({ start: 1 })));
    add(staffAt('engineer', rnd, pop, [V(tc(20), tc(9), N, 'work', 9, 16), V(tc(22), tc(9), N, 'work', 7, 12)], eng({ look: { cap: '#fde047' } })));
    // tankarna: inspektör med klippbräda
    add(staffAt('engineer', rnd, pop, [V(tc(20), tc(4), N, 'work', 6, 10), V(tc(23), tc(4), H, 'work', 6, 10), V(tc(21), tc(4), N, 'work', 5, 8)], eng({ prop: 'clip', look: { goggles: true }, order: 'rand' })));
    // labbet
    add(staffAt('engineer', rnd, pop, [V(tc(16), tc(11), H, 'work', 10, 18), V(tc(18), tc(11), H, 'work', 8, 14)], eng({ start: 1 })));
    // raketinspektören går längs fronten
    add(staffAt('engineer', rnd, pop, [V(tc(10), tc(6), N, 'work', 6, 10), V(tc(13), tc(6), N, 'work', 6, 10), V(tc(16), tc(6), N, 'work', 6, 10)], eng({ prop: 'clip', look: { cap: '#fde047' }, order: 'rand' })));
    // försäljaren
    add(staffAt('seller', rnd, pop, [V(tc(5), tc(11), H, 'work', 6, 11), V(tc(7), tc(11), H, 'work', 5, 9), V(tc(8), tc(11), H, 'work', 5, 9)], { watch: true, lines: ROCKET_LINES.seller, look: { shirt: '#dc2626', skin: '#c68642', hair: '#111111', cap: '#111827', badge: '#fde047' } }));
    // köpare: två i kön, tre vid raketen, en på väg
    for (let i = 0; i < 2; i++) add(dropIn(rocketBuyer(rnd, ROCKET_QUEUE[i]), 0, rnd, pop));
    for (let i = 0; i < 3; i++) add(dropIn(rocketBuyer(rnd, def.door), 1, rnd, pop));
    const w = rocketBuyer(rnd, { x: tc(3), y: tc(9) }); w.c.stages.shift(); w.prop = 'mini'; add(w);
    return npcs;
}

const ROCKET_SPEC = {
    iv: [6, 11], max: 7, hooks: null,
    spawn(state, B, rnd) {
        if (doorBlocked(state, state.def.door.x, state.def.door.y)) return null;
        return rocketBuyer(rnd, state.def.door);
    },
    onPay(n, state, B, rnd) { n.prop = pick(rnd, ['mini', 'bag', 'bag', 'case']); }
};

registerInterior(ROCKET_DEF, {
    populate: (def, rnd) => populateRocket(def, rnd),
    update: (state, dt, rnd) => bizUpdate(ROCKET_SPEC, state, dt, rnd),
    step: (n, state, dt, rnd) => actStep(ROCKET_SPEC, n, state, dt, rnd),
    paint: paintRocket,
    dyn: dynRocket,
    accessory: accessoryB,
    glows: ROCKET_GLOWS
});
