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

// ── Körkänslan: gäller alla fordon (specen ger varje bil dess karaktär) ──
// Mätt och avvägt mot riktiga stan (gatan 128 px + trottoarer, bilen ~44 px): se tests/driving.test.js.
export const DRIVE = {
    steerRate: 7,       // ratten följer styrningen: 0 → fullt utslag på ~0,14 s (tangenterna är av/på)
    steerCenter: 11,    // ...och tillbaka mot mitten (eller över till andra hållet) lite fortare
    lowTurn: 110,       // px/s: under den farten är svängradien fast (~45 px för Volvon) — vändbar i låg fart
    gripDamp: 3,        // sidofarten dämpas med grip × 3 per sekund: bilen går dit nosen pekar...
    gripAcc: 75,        // ...upp till grip × 75 px/s² i sidled: över gränsen glider den (drift)
    hbGrip: 1.6,        // handbromsen: bakhjulen släpper och bilen sladdar
    pivot: 1.3,         // rad/s: nosen mot en vägg + gas + ratt → nosen glider längs väggen, bilen vrider sig loss
    pivotSpeed: 60,     // px/s: bara när bilen i stort sett står still mot väggen
    wallE: 0.3,         // studs mot väggar
    wallMu: 0.35        // friktion längs väggen, i proportion till stöten (skrapar man längs den tappar man lite)
};

// Knuffar ut en bil ur väggar. Returnerar krockhastigheten (0 = ingen krock).
// Sparar också vilken ände som ligger an (v.wallF/v.wallB = väggens normal, en kort stund) —
// stepVehicle låter då en bil som trycker nosen mot väggen vrida sig loss med ratten — och
// hur fort bilen skrapar längs väggen (v.scrape, px/s) och var (v.scrapeX/Y), och var den
// hårdaste smällen tog (v.hitX/Y) — för gnistorna.
export function collideVehicleWithMap(v, city) {
    let impact = 0;
    v.scrape = 0;
    const r = v.spec.w / 2 + 1;
    const off = Math.max(0, v.spec.l / 2 - r);
    for (let iter = 0; iter < 3; iter++) {
        let any = false;
        for (let i = 0; i < 2; i++) {
            // Cirklarnas läge räknas om efter varje knuff (fronten först, sedan bakdelen)
            const sg = i === 0 ? 1 : -1;
            const ox = Math.cos(v.angle) * off * sg, oy = Math.sin(v.angle) * off * sg;
            const hit = deepestTileContact(v.x + ox, v.y + oy, r, city);
            if (!hit) continue;
            any = true;
            const wn = i === 0 ? (v.wallF ||= [0, 0]) : (v.wallB ||= [0, 0]);
            wn[0] = hit.nx; wn[1] = hit.ny;
            if (i === 0) v.wallFT = 0.15; else v.wallBT = 0.15;
            v.x += hit.nx * hit.pen;
            v.y += hit.ny * hit.pen;
            const vn = v.vx * hit.nx + v.vy * hit.ny;
            if (vn < 0) {
                const jn = -(1 + DRIVE.wallE) * vn;
                v.vx += jn * hit.nx;
                v.vy += jn * hit.ny;
                // Friktion längs väggen i proportion till stöten: en smäll bromsar, att glida
                // längs väggen med nosen lite inåt gör det knappt (bilen fastnar inte)
                const tx = -hit.ny, ty = hit.nx;
                const vt = v.vx * tx + v.vy * ty;
                const dv = Math.sign(vt) * Math.min(Math.abs(vt), DRIVE.wallMu * jn);
                v.vx -= dv * tx; v.vy -= dv * ty;
                if (Math.abs(vt) > v.scrape) { v.scrape = Math.abs(vt); v.scrapeX = v.x + ox - hit.nx * r; v.scrapeY = v.y + oy - hit.ny * r; }
                // Spinn när man tar i med fronten eller bakdelen (snett in = nosen vrids längs väggen)
                const torque = (ox * hit.ny - oy * hit.nx) * -vn;
                v.spin = clamp(v.spin + torque * 0.00012 / v.spec.mass, -6, 6);
                if (-vn > impact) { impact = -vn; v.hitX = v.x + ox - hit.nx * r; v.hitY = v.y + oy - hit.ny * r; }
            }
        }
        if (!any) break;
    }
    return impact;
}

export function stepVehicle(v, ctl, dt, city) {
    const s = v.spec, D = DRIVE;
    if (v.wrecked || !ctl) ctl = NO_INPUT;
    const health = v.hp / v.maxHp;
    const perf = health < 0.25 ? 0.72 : 1;
    const nitro = ctl.nitro ? 1 : 0;
    const maxF = s.maxSpeed * perf * (nitro ? 1.3 : 1);
    const th = clamp(ctl.throttle || 0, -1, 1);

    // Spelarens ratt följer styrningen mjukt (tangenterna är av/på: ett kort tryck ger en liten
    // sväng, inget ryck). Datorförarna (trafik, polis, gäng) styr redan steglöst och direkt.
    // v.steerPos = hjulens utslag −1..1 (kan ritas: ratten i förstaperson, framhjulen).
    const want = clamp(ctl.steer || 0, -1, 1);
    let st = want;
    if (v.driver === 'player') {
        st = Number.isFinite(v.steerPos) ? v.steerPos : 0;
        const back = Math.abs(want) < Math.abs(st) || want * st < 0;
        const rate = (back ? D.steerCenter : D.steerRate) * dt;
        st += clamp(want - st, -rate, rate);
    }
    v.steerPos = st;

    // Styrning beror på farten (stillastående bil svänger inte — utom mot en vägg, se nedan).
    // Under lowTurn är svängradien fast; i hög fart svänger den inte skarpare än greppet orkar.
    let fx = Math.cos(v.angle), fy = Math.sin(v.angle);
    const fwd0 = v.vx * fx + v.vy * fy;
    const sp0 = Math.abs(fwd0);
    const speedFactor = Math.min(1, sp0 / D.lowTurn);
    const topDamp = 1 - 0.35 * Math.min(1, sp0 / s.maxSpeed);
    let turn = st * s.turn * speedFactor * topDamp * (fwd0 >= 0 ? 1 : -1);
    if (ctl.handbrake) turn *= 1.5;
    else {
        // Greppgränsen: nosen vrids aldrig fortare än däcken hinner vända färdriktningen
        // (för fort in i kurvan = bilen går vidare, den snurrar inte runt)
        const vel = Math.hypot(v.vx, v.vy);
        if (vel > 1) { const lim = s.grip * D.gripAcc / vel; turn = clamp(turn, -lim, lim); }
    }
    // Nosen (eller bakänden när man backar) trycker mot en vägg: hjulen skjuter den längs väggen,
    // så bilen vrider sig runt den andra änden i stället för att stå fast. Snett mot väggen rättar
    // den in sig längs väggen av sig själv; rakt mot den vrider ratten loss den.
    v.wallFT = (v.wallFT || 0) - dt; v.wallBT = (v.wallBT || 0) - dt;
    const push = th > 0.05 ? 1 : th < -0.05 ? -1 : 0;
    const wall = push > 0 ? (v.wallFT > 0 && v.wallF) : push < 0 ? (v.wallBT > 0 && v.wallB) : null;
    let pivot = 0;
    if (wall && sp0 < D.pivotSpeed && (fx * wall[0] + fy * wall[1]) * push < -0.25) {
        const slow = Math.abs(th) * (1 - sp0 / D.pivotSpeed);
        const along = (fx * wall[1] - fy * wall[0]) * push; // sin(vinkeln mot väggen), med tecken
        pivot = (st * push * D.pivot + along * D.pivot) * slow;
    }
    const da = (turn + pivot + v.spin) * dt;
    v.angle += da;
    if (pivot) {
        // Vrid runt den fria änden (bakdelen när nosen ligger mot väggen): den står kvar
        const off = Math.max(0, s.l / 2 - (s.w / 2 + 1)) * push;
        v.x += off * (Math.cos(v.angle) - fx);
        v.y += off * (Math.sin(v.angle) - fy);
    }
    v.spin *= Math.exp(-5 * dt);
    if (v.angle > Math.PI) v.angle -= Math.PI * 2;
    else if (v.angle < -Math.PI) v.angle += Math.PI * 2;

    fx = Math.cos(v.angle); fy = Math.sin(v.angle);
    const rx = -fy, ry = fx;
    let fwd = v.vx * fx + v.vy * fy;
    let lat = v.vx * rx + v.vy * ry;

    // W gasar längs nosen. S bromsar, och under 5 px/s backar den (och tvärtom med W).
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

    // Sidogrepp: däcken tar bort sidofarten (bilen går dit nosen pekar) upp till greppgränsen.
    // Över den — handbroms, en smäll från sidan — glider bilen och tar sig sedan.
    const latBefore = lat;
    const grip = ctl.handbrake ? D.hbGrip : s.grip;
    const cap = grip * D.gripAcc * dt;
    lat -= clamp(lat * (1 - Math.exp(-grip * D.gripDamp * dt)), -cap, cap);

    // Gräs bromsar
    const ground = tileAt(city, Math.floor(v.x / TILE), Math.floor(v.y / TILE));
    if (ground === T.GRASS) fwd *= 1 - 1.4 * dt;

    v.vx = fx * fwd + rx * lat;
    v.vy = fy * fwd + ry * lat;
    v.x += v.vx * dt;
    v.y += v.vy * dt;
    v.reversing = fwd < -5;

    const impact = collideVehicleWithMap(v, city);
    const skid = Math.abs(latBefore) > 110 || (ctl.handbrake && Math.abs(fwd) > 140);
    return { impact, skid, speed: fwd, scrape: v.scrape };
}

// Skada från en krock med hastigheten `impact`
export function impactDamage(impact, armor = 1) {
    if (impact <= 140) return 0;
    return (impact - 140) * 0.12 / armor;
}

// Krock mellan två fordon. Returnerar krockhastigheten (relativ fart längs normalen när de
// närmar sig varandra, annars 0). out (valfritt) fylls med { touch, nx, ny, pen }: om bilarna
// ligger an mot varandra just nu (även när de inte närmar sig — fastklämda, knuffande) och
// normalen från a mot b. Polisen (world.resolveCollisions) räknar en sammanhängande kontakt
// per par med det, i stället för en ny smäll varje bildruta.
export function collideVehicles(a, b, out = null) {
    if (out) { out.touch = false; out.nx = 0; out.ny = 0; out.pen = 0; }
    const dx = b.x - a.x, dy = b.y - a.y;
    const reach = (a.spec.l + b.spec.l) / 2 + 4;
    if (dx * dx + dy * dy > reach * reach) return 0;
    let best = null, near = null;
    for (const ca of vehicleCircles(a)) for (const cb of vehicleCircles(b)) {
        const ex = cb.x - ca.x, ey = cb.y - ca.y;
        const d = Math.hypot(ex, ey);
        const r = ca.r + cb.r;
        // Ligger an (inom 2 px): räknas som kontakt även när överlappet nyss rättats till
        if (out && d < r + 2 && (!near || d - r < near.gap)) near = { gap: d - r, nx: d > 1e-6 ? ex / d : 1, ny: d > 1e-6 ? ey / d : 0 };
        if (d >= r) continue;
        const pen = r - d;
        if (!best || pen > best.pen) {
            best = d > 1e-6 ? { pen, nx: ex / d, ny: ey / d, ca, cb } : { pen, nx: 1, ny: 0, ca, cb };
        }
    }
    if (out && near) { out.touch = true; out.nx = near.nx; out.ny = near.ny; }
    if (!best) return 0;
    if (out) { out.nx = best.nx; out.ny = best.ny; out.pen = best.pen; }
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
