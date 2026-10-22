// ═══════════════════════════════════════════
//  STAN — minikarta över hela stan
//  Gator och områden ritas en gång till en egen bild.
//  Ovanpå: viktiga platser, mitt crew, riktiga spelare
//  (från nätdata) och jag själv. M öppnar en stor karta.
// ═══════════════════════════════════════════

import { TILE, T, DISTRICTS, GANGS } from './constants.js';
import { tileAt, districtAt } from './map.js';

const PX = 3; // pixlar per ruta i grundbilden
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
const BIG_FONT = 'Bungee, Impact, "Arial Black", sans-serif';

function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const c = v => Math.max(0, Math.min(255, Math.round(v * f)));
    return `rgb(${c(n >> 16 & 255)},${c(n >> 8 & 255)},${c(n & 255)})`;
}

// Grundbild: områdenas färg på husen, gator, parker och vatten
export function buildMinimapBase(city) {
    if (typeof document === 'undefined') return null;
    const cv = document.createElement('canvas');
    cv.width = city.w * PX; cv.height = city.h * PX;
    const g = cv.getContext('2d');
    for (let ty = 0; ty < city.h; ty++) for (let tx = 0; tx < city.w; tx++) {
        const t = tileAt(city, tx, ty);
        let col;
        if (t === T.ROAD) col = '#2f323a';
        else if (t === T.SIDEWALK || t === T.PLAZA) col = '#6b7080';
        else if (t === T.WATER) col = '#1d4e89';
        else if (t === T.GRASS || t === T.PARK) col = '#2f6b33';
        else if (t === T.LOT) col = '#4a4d55';
        else {
            const d = DISTRICTS[districtAt(city, tx * TILE + TILE / 2, ty * TILE + TILE / 2)];
            const gang = d && GANGS.find(x => x.id === d.gang);
            col = gang ? shade(gang.color, 0.45) : '#3b3b45';
        }
        g.fillStyle = col;
        g.fillRect(tx * PX, ty * PX, PX, PX);
    }
    return cv;
}

// Viktiga platser som alltid syns på kartan
export function mapPlaces(world) {
    const m = world.city.markers, prof = world.profile;
    const out = [];
    const add = (o, icon, label, color, kind) => { if (o) out.push({ x: (o.door || o).x, y: (o.door || o).y, icon, label, color, kind }); };
    add(m.home, '🏠', 'HQ', '#ffd23f', 'home');
    add(m.stripclub, '💎', 'Club Diamant', '#f472b6', 'stripclub');
    add(m.guns, '🔫', 'Pang-Pelle', '#f97316', 'guns');
    add(m.bank, '🏦', 'Banken', '#a78bfa', 'bank');
    add(m.club, '🍾', 'Nattklubben', '#f9a8d4', 'club');
    (m.sprays || []).forEach(sp => add(sp, '🎨', 'Lackverkstan', '#38bdf8', 'spray'));
    add(m.fence, '🔧', 'Skroten', '#eab308', 'fence');
    (m.houses || []).forEach(h => { if ((prof.cityHouses || []).includes(h.id)) add(h, '🏡', h.name, '#22c55e', 'house'); });
    if (world.mission?.target) add(world.mission.target, '⭐', world.mission.target.label || 'Mål', '#ffd23f', 'target');
    return out;
}

// Var en spelare syns på kartan: inomhus ritas de vid byggnadens dörr
function mapPos(r) { return r.in ? { x: r.ox ?? r.x, y: r.oy ?? r.y } : { x: r.rx ?? r.x, y: r.ry ?? r.y }; }

// Sprid ut markörer som hamnar ovanpå varandra
function spread(points, minD) {
    for (let i = 0; i < points.length; i++) {
        let n = 0;
        for (let j = 0; j < i; j++) {
            if (Math.hypot(points[i].sx - points[j].sx, points[i].sy - points[j].sy) < minD) n++;
        }
        if (n) {
            const a = n * 2.1;
            points[i].sx += Math.cos(a) * minD * 0.8;
            points[i].sy += Math.sin(a) * minD * 0.8;
        }
    }
}

function diamond(ctx, x, y, s, fill) {
    ctx.beginPath();
    ctx.moveTo(x, y - s); ctx.lineTo(x + s, y); ctx.lineTo(x, y + s); ctx.lineTo(x - s, y); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
}

function shield(ctx, x, y, s, fill) {
    ctx.beginPath();
    ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y - s); ctx.lineTo(x + s, y + s * 0.2); ctx.lineTo(x, y + s * 1.2); ctx.lineTo(x - s, y + s * 0.2); ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#052e16'; ctx.stroke();
}

// Rita kartan i en ruta (x, y, size). full = stor karta med namn och teckenförklaring.
export function drawMap(ctx, world, base, box, opts = {}) {
    const { x, y, size } = box;
    const full = !!opts.full;
    const city = world.city;
    const scale = size / (city.w * TILE);
    const toS = (wx, wy) => ({ sx: x + wx * scale, sy: y + wy * scale });
    ctx.save();
    // Ram
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(x - 4, y - 4, size + 8, size + 8);
    ctx.beginPath(); ctx.rect(x, y, size, size); ctx.clip();
    if (base) { ctx.imageSmoothingEnabled = false; ctx.drawImage(base, x, y, size, size); }
    else { ctx.fillStyle = '#23252c'; ctx.fillRect(x, y, size, size); }

    // Platser
    const iconSize = full ? 18 : Math.max(10, size / 15);
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const pl of mapPlaces(world)) {
        const { sx, sy } = toS(pl.x, pl.y);
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.beginPath(); ctx.arc(sx, sy, iconSize * 0.62, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = pl.color; ctx.lineWidth = 1.5; ctx.stroke();
        ctx.font = `${iconSize * 0.75}px ${EMOJI_FONT}`;
        ctx.fillText(pl.icon, sx, sy + 0.5);
        if (full) {
            ctx.font = `11px ${BIG_FONT}`;
            ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(pl.label, sx, sy + iconSize * 0.9);
            ctx.fillStyle = pl.color; ctx.fillText(pl.label, sx, sy + iconSize * 0.9);
        }
    }

    // Snutar syns bara om du har en spanare i crewet
    if (opts.showCops) {
        for (const v of world.vehicles) {
            if (v.driver !== 'cop' || v.wrecked) continue;
            const { sx, sy } = toS(v.x, v.y);
            ctx.fillStyle = Math.sin(opts.t * 10) > 0 ? '#ef4444' : '#3b82f6';
            ctx.fillRect(sx - 2.5, sy - 2.5, 5, 5);
        }
    }

    // Mitt crew: gröna sköldar
    for (const c of world.crew || []) {
        if (c.hidden) continue;
        const pos = world.interior ? { x: world.interior.door.x, y: world.interior.door.y } : c;
        const { sx, sy } = toS(pos.x, pos.y);
        shield(ctx, sx, sy, full ? 5 : 3.5, c.down > 0 ? '#6b7280' : '#22c55e');
    }

    // Riktiga spelare: romber i deras färg, inomhus vid dörren med en husikon
    const pts = [];
    for (const r of opts.remotes || []) {
        const p = mapPos(r);
        pts.push({ r, ...toS(p.x, p.y) });
    }
    spread(pts, full ? 14 : 8);
    for (const pt of pts) {
        const r = pt.r;
        const s = full ? 8 : 5.5;
        diamond(ctx, pt.sx, pt.sy, s, r.dead ? '#6b7280' : (r.color || '#60a5fa'));
        if (r.in) {
            ctx.font = `${full ? 12 : 9}px ${EMOJI_FONT}`;
            ctx.fillText('🏠', pt.sx + s + 3, pt.sy - s);
        }
        if (full || opts.names) {
            const label = `${r.icon || ''} ${r.name || r.id}${r.in ? ' (inne)' : ''}`;
            ctx.font = `${full ? 12 : 9}px ${BIG_FONT}`;
            ctx.lineWidth = 3; ctx.strokeStyle = '#000'; ctx.strokeText(label, pt.sx, pt.sy - s - 8);
            ctx.fillStyle = '#fff'; ctx.fillText(label, pt.sx, pt.sy - s - 8);
        }
    }

    // Jag: gul pil åt det håll jag tittar
    const p = world.player;
    const mePos = world.interior ? world.interior.door : p;
    const { sx, sy } = toS(mePos.x, mePos.y);
    const a = p.vehicle ? p.vehicle.angle : p.angle;
    const s = full ? 9 : 6.5;
    ctx.save();
    ctx.translate(sx, sy); ctx.rotate(a);
    ctx.beginPath(); ctx.moveTo(s, 0); ctx.lineTo(-s * 0.75, -s * 0.7); ctx.lineTo(-s * 0.35, 0); ctx.lineTo(-s * 0.75, s * 0.7); ctx.closePath();
    ctx.fillStyle = '#ffd23f'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#000'; ctx.stroke();
    ctx.restore();
    if (world.interior) {
        ctx.font = `${full ? 12 : 9}px ${EMOJI_FONT}`;
        ctx.fillText('🏠', sx + s + 3, sy - s);
    }
    ctx.restore();

    // Ram och rubrik
    ctx.strokeStyle = '#ffd23f'; ctx.lineWidth = 2;
    ctx.strokeRect(x - 1, y - 1, size + 2, size + 2);
    if (!full) {
        ctx.font = `9px ${BIG_FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
        ctx.fillStyle = 'rgba(255,255,255,0.75)';
        const n = (opts.remotes || []).length;
        ctx.fillText(n ? `KARTA (M) · ${n} SPELARE` : 'KARTA (M)', x + 3, y + size + 6);
    }
}

// Teckenförklaring till den stora kartan
export const MAP_LEGEND = [
    ['➤', '#ffd23f', 'Du'], ['◆', '#60a5fa', 'Andra spelare'], ['⛊', '#22c55e', 'Ditt crew'], ['🏠', '#fff', 'Inomhus']
];
