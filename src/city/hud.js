// ═══════════════════════════════════════════
//  STAN — HUD i GTA-stil
// ═══════════════════════════════════════════

import { GANGS, DISTRICTS, TILE } from './constants.js';
import { stars } from './wanted.js';
import { phoneAccess, gangById } from './missions.js';
import { WEAPONS } from './weapons.js';
import { buildMinimapBase, drawMap, MAP_LEGEND } from './minimap.js';
import { STAMINA_MAX } from './input.js';
import { eTarget } from './camera.js';

const BIG_FONT = 'Bungee, Impact, "Arial Black", sans-serif';
const PAGER_FONT = 'VT323, "Courier New", monospace';
const EMOJI_FONT = '"Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';

function outlined(ctx, text, x, y, size, fill, align = 'left', font = BIG_FONT, stroke = 5) {
    ctx.font = `${size}px ${font}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = stroke;
    ctx.strokeStyle = '#000';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = fill;
    ctx.fillText(text, x, y);
}

function wrap(ctx, text, maxW) {
    const words = String(text).split(' ');
    const lines = [];
    let line = '';
    for (const w of words) {
        const test = line ? line + ' ' + w : w;
        if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test;
    }
    if (line) lines.push(line);
    return lines;
}

const fmtTime = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

// Touch: knapparna heter annat än tangenterna (fight = 👊/vapnet, eller ⤵ i bilen)
export function touchText(text, fight) {
    return String(text).replace('ESC —', '🏠 HEM —').replaceAll('SPACE —', `${fight} —`).replace(/^R —/, '💰 —')
        .replaceAll('(SPACE)', `(${fight})`).replaceAll('(R)', '(💰)').replace(/SPACE (slår|skjuter)/g, `${fight} $1`).replace('Q byter vapen', '🔫 byter vapen');
}

// ── Personsökarens plats ──
// x och bredd. På bred touchskärm (liggande) hamnar rutan högt upp: håll den mellan
// HUD-kolumnerna (respekt/hälsa till vänster, pengar/snutar/minikarta till höger).
// mmR = minikartans högerkant på datorn, mapX = minikartans x på touch.
const HUD_LEFT = 176;
export function pagerX(W, { touch = false, narrow = false, mmR = 0, mapX = W } = {}) {
    let w = Math.min(440, W - 24, mmR ? W - mmR - 14 : W);
    let x = Math.max((W - w) / 2, mmR);
    if (touch && !narrow) {
        const right = mapX - 14;
        w = Math.max(200, Math.min(w, right - HUD_LEFT));
        x = Math.max(HUD_LEFT, Math.min((W - w) / 2, right - w));
    }
    return { x, w };
}
// y för rutans överkant (ph = höjden). Touch: ovanför knapparna, men aldrig under
// knappraden uppe — där ska uppdragstimern (y − 14) och tipset också få plats.
// Inomhus på smal skärm: under rummet (render.js håller spelaren minst 260 px ovanför
// botten) och ovanför knapparna, så rutan inte täcker rummets nedre del med utgången.
export const PAGER_TOP = 72;          // bred skärm: knappraden uppe ligger på 8–42 px
export const PAGER_TOP_NARROW = 290;  // smal: knapparna på 196 px, minikartan till 252 + etikett
export function pagerY(H, ph, { touch = false, narrow = false, indoor = false } = {}) {
    if (!touch) return H - ph - 22;
    const top = narrow ? PAGER_TOP_NARROW : PAGER_TOP;
    if (indoor && narrow) return Math.max(top, Math.min(H - 254, H - 160 - ph));
    return Math.max(top, H - ph - 236);
}

export class Hud {
    constructor() {
        this.msgs = [];
        this.big = null;
        this.banner = null;
        this.radio = null;
        this.wantedFlash = 0;
        this.t = 0;
        this.mapBase = null;
        this.mapRect = null;
    }

    // Minikartan: nere till vänster på datorn, uppe till höger på mobilen
    minimapRect(W, H, touch, narrow) {
        if (touch || narrow) {
            const size = Math.round(Math.min(124, W * 0.32));
            return { x: W - size - 12, y: narrow ? 128 : 118, size };
        }
        const size = Math.round(Math.max(130, Math.min(190, Math.min(W, H) * 0.24)));
        return { x: 16, y: H - size - 30, size };
    }

    onEvent(e) {
        switch (e.type) {
            case 'msg':
                this.msgs.push({ text: e.text, life: 6 });
                if (this.msgs.length > 3) this.msgs.shift();
                break;
            case 'big':
                this.big = { text: e.text, color: e.color, sub: e.sub, life: 3.4, max: 3.4 };
                break;
            case 'district': {
                const d = DISTRICTS[e.id];
                const g = GANGS.find(x => x.id === d.gang);
                const sub = e.own ? `🏠 Ditt turf · ${g.icon} ${g.name}` : e.hostile ? `⚠️ FIENTLIGT TURF · ${g.icon} ${g.name}` : `${g.icon} ${g.name}s turf`;
                this.banner = { text: d.name, sub, subColor: e.hostile ? '#f87171' : '#fff', color: g.color, life: 3, max: 3 };
                break;
            }
            case 'radio':
                this.radio = { text: e.name, sub: e.tag || '', life: 3, icon: '📻' };
                break;
            case 'view':
                this.radio = { text: e.name, sub: e.tag || '', life: 2, icon: '🔍' };
                break;
            case 'cam': // kameraläget byttes (index.js): namnet syns en stund
                this.camBanner = { text: e.name, sub: e.tag || '', icon: e.icon || '🎥', life: 2.4, max: 2.4 };
                break;
            case 'interior':
                this.banner = null; // turf-skylten hör till gatan
                break;
            case 'wanted':
                if (e.up) this.wantedFlash = 2;
                break;
        }
    }

    update(dt) {
        this.t += dt;
        this.wantedFlash = Math.max(0, this.wantedFlash - dt);
        for (const m of this.msgs) m.life -= dt;
        this.msgs = this.msgs.filter(m => m.life > 0);
        if (this.big && (this.big.life -= dt) <= 0) this.big = null;
        if (this.banner && (this.banner.life -= dt) <= 0) this.banner = null;
        if (this.radio && (this.radio.life -= dt) <= 0) this.radio = null;
        if (this.camBanner && (this.camBanner.life -= dt) <= 0) this.camBanner = null;
    }

    draw(ctx, world, r, opts = {}) {
        const W = r.w, H = r.h;
        ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
        const narrow = W < 560;
        const p = world.player, profile = world.profile;

        // ── Pengar (uppe till höger) ──
        const moneySize = narrow ? 24 : 34;
        outlined(ctx, `${Math.floor(profile.money || 0).toLocaleString('sv-SE')} kr`, W - 14, 26, moneySize, '#ffd23f', 'right', BIG_FONT, 6);
        // Klocka + uppdrag kvar
        const h = world.hour();
        const clock = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
        const left = Math.max(0, world.maxMissions - (profile.missionsThisRound || 0));
        const goods = profile.cityGoods || 0;
        outlined(ctx, `🕖 ${clock}  ·  ☎️ ${left}/${world.maxMissions}${goods ? `  ·  🎒 ${goods}` : ''}`, W - 14, 26 + moneySize * 0.9, narrow ? 12 : 14, '#e5e7eb', 'right', BIG_FONT, 3);

        // ── Efterlyst: snutmärken ──
        const s = stars(world.wanted);
        const blink = this.wantedFlash > 0 && Math.sin(this.t * 18) > 0;
        const size = narrow ? 18 : 22;
        const wy = 26 + moneySize * 0.9 + (narrow ? 24 : 30);
        const lost = s > 0 && world.wanted.seenT > 4;
        ctx.font = `${size}px ${EMOJI_FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let i = 0; i < 5; i++) {
            const x = W - 14 - size * 0.6 - (4 - i) * (size + 4);
            ctx.globalAlpha = i < s ? (blink ? 0.35 : lost ? 0.5 + 0.3 * Math.sin(this.t * 4) : 1) : 0.18;
            ctx.fillText('👮', x, wy);
        }
        ctx.globalAlpha = 1;
        if (s > 0) outlined(ctx, lost ? '🔍 SNUTEN LETAR — HÅLL DIG UNDAN' : '👀 SNUTEN SER DIG', W - 14, wy + size * 0.5 + 10, narrow ? 10 : 12, lost ? '#cbd5e1' : '#f87171', 'right', BIG_FONT, 3);

        // ── Respekt (uppe till vänster) ──
        // Tre rader: ditt gäng, turfets gäng och det gäng som hatar dig mest
        const bw = narrow ? 92 : 128;
        const resp = profile.respect || {};
        const rows = [];
        const add = id => { if (id && !rows.includes(id) && rows.length < 3) rows.push(id); };
        add(profile.gang);
        add(DISTRICTS[world.district]?.gang);
        GANGS.map(g => g.id).sort((a, b) => (resp[a] || 0) - (resp[b] || 0)).forEach(id => { if ((resp[id] || 0) < 0 || (world.beef[id] || 0) > 0) add(id); });
        GANGS.forEach(g => add(g.id));
        rows.forEach((id, i) => {
            const g = gangById(id);
            const y = 16 + i * 22;
            const val = resp[g.id] || 0;
            const beef = (world.beef[g.id] || 0) > 0;
            ctx.fillStyle = beef && Math.sin(this.t * 8) > 0 ? 'rgba(127,29,29,0.85)' : 'rgba(0,0,0,0.6)';
            ctx.fillRect(10, y - 8, bw + 30, 17);
            if (g.id === profile.gang) { ctx.strokeStyle = g.color; ctx.lineWidth = 1.5; ctx.strokeRect(10.5, y - 7.5, bw + 29, 16); }
            ctx.font = `13px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText(g.icon, 21, y + 0.5);
            const x0 = 32, mid = x0 + bw / 2;
            ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(x0, y - 4, bw, 9);
            const w = Math.abs(val) / 100 * (bw / 2);
            ctx.fillStyle = val >= 0 ? g.color : '#ef4444';
            ctx.fillRect(val >= 0 ? mid : mid - w, y - 4, w, 9);
            ctx.fillStyle = '#fff'; ctx.fillRect(mid - 0.5, y - 6, 1, 13);
        });

        // ── Hälsa / bil ──
        const hy = 16 + 3 * 22 + 6;
        const v = p.vehicle;
        const bar = (y, frac, color, label) => {
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(10, y - 8, bw + 30, 17);
            ctx.font = `12px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.fillText(label, 21, y + 0.5);
            ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(32, y - 4, bw, 9);
            ctx.fillStyle = color; ctx.fillRect(32, y - 4, bw * Math.max(0, Math.min(1, frac)), 9);
        };
        bar(hy, p.hp / p.maxHp, p.hp < 35 ? '#ef4444' : '#22c55e', '❤️');
        if (p.armor > 0) { ctx.fillStyle = '#60a5fa'; ctx.fillRect(32, hy + 3, bw * Math.min(1, p.armor / 100), 3); }
        // Uthållighet: liten stapel bredvid hälsan, bara när den inte är full (även inomhus).
        // Röd = andfådd: ingen spring förrän den fyllts på en bit.
        if (p.stamina < STAMINA_MAX) {
            const sx = bw + 46, sw = narrow ? 40 : 56;
            ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(sx, hy - 8, sw + 26, 17);
            ctx.font = `11px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
            ctx.fillText('🏃', sx + 11, hy + 0.5);
            ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(sx + 21, hy - 4, sw, 9);
            ctx.fillStyle = p.winded ? (Math.sin(this.t * 8) > 0 ? '#ef4444' : '#f87171') : '#facc15';
            ctx.fillRect(sx + 21, hy - 4, sw * Math.max(0, p.stamina / STAMINA_MAX), 9);
        }
        if (v) {
            bar(hy + 22, v.hp / v.maxHp, v.hp < v.maxHp * 0.3 ? '#f97316' : '#60a5fa', v.spec.kind === 'bike' ? '🛵' : '🚗');
            outlined(ctx, v.spec.name.toUpperCase(), 12, hy + 44, 11, '#e5e7eb', 'left', BIG_FONT, 3);
            if (p.nitro > 0) outlined(ctx, `⚡ NITRO ${p.nitro.toFixed(1)}`, 12, hy + 60, 12, '#38bdf8', 'left', BIG_FONT, 3);
        } else {
            // Vapen i handen
            const w = WEAPONS[profile.weapon] || WEAPONS.fists;
            const ammo = w.melee ? '' : `  ${profile.ammo?.[w.id] || 0}`;
            outlined(ctx, `${w.icon} ${w.name.toUpperCase()}${ammo}`, 12, hy + 22, narrow ? 12 : 14, !w.melee && !(profile.ammo?.[w.id] > 0) ? '#f87171' : '#e5e7eb', 'left', BIG_FONT, 3);
        }
        // Crew: namn, hälsa och order (kompakt på mobil)
        const crew = world.crew || [];
        if (crew.length) {
            const orderTxt = { follow: 'FÖLJ', hold: 'STANNA', attack: 'ANFALL' };
            const cy0 = hy + (v ? 72 : 42) + (world.date ? 40 : 0);
            if (narrow) {
                const up = crew.filter(c => !(c.down > 0)).length;
                outlined(ctx, `👥 ${up}/${crew.length} · ${orderTxt[crew[0].order] || ''}`, 12, cy0, 11, '#86efac', 'left', BIG_FONT, 3);
            } else {
                crew.forEach((c, i) => {
                    const y = cy0 + i * 17;
                    const icon = { guard: '🛡️', gunner: '🎯', scout: '👀' }[c.role] || '👤';
                    outlined(ctx, `${icon} ${c.name}`, 12, y, 11, c.down > 0 ? '#9ca3af' : '#e5e7eb', 'left', BIG_FONT, 3);
                    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(98, y - 3, 46, 6);
                    ctx.fillStyle = c.down > 0 ? '#6b7280' : c.hp / c.maxHp < 0.35 ? '#ef4444' : '#22c55e';
                    ctx.fillRect(99, y - 2, 44 * Math.max(0, c.hp / c.maxHp), 4);
                    outlined(ctx, c.down > 0 ? `NERE ${Math.ceil(c.down)}` : orderTxt[c.order] || '', 150, y, 9, c.down > 0 ? '#f87171' : '#86efac', 'left', BIG_FONT, 3);
                });
            }
        }
        // Dejt: humör och vart hon bor
        const date = world.date;
        if (date) {
            bar(hy + (v && p.nitro > 0 ? 82 : 66), date.mood / 100, date.mood < 35 ? '#ef4444' : '#f472b6', date.mood < 35 ? '😠' : '😍');
            outlined(ctx, `${date.name.toUpperCase()} · ${Math.max(0, Math.ceil(date.limit - date.t))} s`, 12, hy + (v && p.nitro > 0 ? 100 : 84), 11, '#f9a8d4', 'left', BIG_FONT, 3);
        }

        // ── Distriktsbanner ──
        if (this.banner && !world.interior) {
            const b = this.banner;
            const a = Math.min(1, b.life, (b.max - b.life) * 4);
            const by = narrow ? Math.max(H * 0.36, 300) : H * 0.2; // under knappraden och minikartan på mobilen
            ctx.globalAlpha = a;
            outlined(ctx, b.text, W / 2, by, narrow ? 34 : 52, b.color, 'center', BIG_FONT, 7);
            outlined(ctx, b.sub, W / 2, by + (narrow ? 30 : 42), narrow ? 13 : 16, b.subColor || '#fff', 'center', BIG_FONT, 4);
            ctx.globalAlpha = 1;
        }
        // ── Kamerabanner: lägets namn när det byts ──
        if (this.camBanner) {
            const b = this.camBanner;
            const a = Math.min(1, b.life / 0.4, (b.max - b.life) * 6 + 0.2);
            const cy = narrow ? Math.max(H * 0.36, 300) + 64 : H * 0.62;
            ctx.globalAlpha = Math.max(0, a);
            ctx.font = `${narrow ? 17 : 24}px ${BIG_FONT}`;
            const tw = ctx.measureText(`${b.icon} ${b.text}`).width + 36;
            ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(W / 2 - tw / 2, cy - (narrow ? 18 : 24), tw, narrow ? 54 : 66);
            ctx.fillStyle = '#ffd23f'; ctx.fillRect(W / 2 - tw / 2, cy - (narrow ? 18 : 24), tw, 3);
            outlined(ctx, `${b.icon} ${b.text}`, W / 2, cy, narrow ? 17 : 24, '#ffd23f', 'center', BIG_FONT, 5);
            if (b.sub) outlined(ctx, b.sub, W / 2, cy + (narrow ? 22 : 28), narrow ? 10 : 12, '#e5e7eb', 'center', BIG_FONT, 3);
            ctx.globalAlpha = 1;
        } else if (this.radio) {
            ctx.globalAlpha = Math.min(1, this.radio.life);
            outlined(ctx, `${this.radio.icon || '📻'} ${this.radio.text}`, W / 2, H * 0.6, narrow ? 15 : 19, '#7dd3fc', 'center', BIG_FONT, 4);
            if (this.radio.sub) outlined(ctx, this.radio.sub, W / 2, H * 0.6 + 22, 12, '#e5e7eb', 'center', BIG_FONT, 3);
            ctx.globalAlpha = 1;
        }

        // ── Personsökare (uppdrag + meddelanden) ──
        const m = world.mission;
        // Personsökaren får inte hamna under minikartan på smala datorskärmar
        const mmR = this.mapRect && !opts.touch && !narrow && !world.showMap ? this.mapRect.x + this.mapRect.size + 14 : 0;
        const { x: px, w: pagerW } = pagerX(W, { touch: opts.touch, narrow, mmR, mapX: this.minimapRect(W, H, opts.touch, narrow).x });
        const lines = [];
        ctx.font = `${narrow ? 18 : 20}px ${PAGER_FONT}`;
        if (m) {
            const head = `🎯 ${m.title.toUpperCase()}${m.left !== undefined ? ` (${m.left} kvar)` : ''}`;
            lines.push({ text: head, color: '#bef264' });
            if (m.type === 'vip' && m.stage === 1 && m.damage !== undefined) lines.push({ text: `VIP-skick: ${Math.round((1 - Math.min(1, m.damage * 1.2)) * 100)}%`, color: '#bef264' });
        }
        const fightIcon = p.vehicle ? '⤵' : (WEAPONS[profile.weapon] || WEAPONS.fists).icon;
        for (const msg of this.msgs) for (const l of wrap(ctx, opts.touch ? touchText(msg.text, fightIcon) : msg.text, pagerW - 24)) lines.push({ text: l, color: '#d9f99d', alpha: Math.min(1, msg.life) });
        const lh = narrow ? 18 : 20;
        const ph = lines.length ? lines.length * lh + 18 : 0;
        const py = pagerY(H, ph, { touch: opts.touch, narrow, indoor: !!world.interior });
        if (lines.length) {
            ctx.fillStyle = 'rgba(12,26,8,0.88)'; ctx.fillRect(px, py, pagerW, ph);
            ctx.strokeStyle = '#4d7c0f'; ctx.lineWidth = 2; ctx.strokeRect(px + 1, py + 1, pagerW - 2, ph - 2);
            ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
            lines.forEach((l, i) => {
                ctx.globalAlpha = l.alpha ?? 1;
                ctx.fillStyle = l.color;
                ctx.fillText(l.text, px + 12, py + 9 + lh * (i + 0.5));
            });
            ctx.globalAlpha = 1;
            if (m) {
                const urgent = m.timeLeft < 15 && Math.sin(this.t * 10) > 0;
                outlined(ctx, `⏱ ${fmtTime(m.timeLeft ?? m.timeLimit)}`, px + pagerW - 10, py - 14, narrow ? 16 : 20, urgent ? '#ef4444' : '#fde047', 'right', BIG_FONT, 4);
            }
        }

        // ── Pil mot målet ── (inte inomhus: där gäller rummets koordinater)
        const outside = !world.interior;
        // Pilarna stannar ovanför personsökaren — om den ligger högt upp (liggande touch) ovanför knapparna
        const arrowBottom = py > H / 2 ? py : opts.touch ? H - 110 : H;
        if (date && outside) this.drawArrow(ctx, r, world, date.dest, '#f472b6', `💃 ${date.name}s lägenhet`, false, arrowBottom);
        if (m && m.target) { if (outside) this.drawArrow(ctx, r, world, m.target, '#ffd23f', m.target.label, false, arrowBottom); }
        else if (!m && !date && left > 0 && world.state === 'play' && outside) {
            // Visa vägen till närmaste öppna telefon
            let best = null, bd = Infinity;
            for (const ph of world.city.markers.phones) {
                if (!phoneAccess(profile, ph.gang)) continue;
                const d = Math.hypot(ph.x - p.x, ph.y - p.y);
                if (d < bd) { bd = d; best = ph; }
            }
            if (best && bd > 260) this.drawArrow(ctx, r, world, best, 'rgba(255,255,255,0.75)', '☎️ Telefon', true, arrowBottom);
        }

        // ── Tips ── (på touch heter knapparna annat än tangenterna)
        let hint = world.hint;
        if (hint && opts.touch) hint = touchText(hint, fightIcon);
        if (hint) outlined(ctx, hint, W / 2, py - (lines.length ? 22 : 8), narrow ? 13 : 16, '#fff', 'center', BIG_FONT, 4);

        // ── Minikarta över hela stan ──
        if (!this.mapBase) this.mapBase = buildMinimapBase(world.city);
        const remotes = world.remotes();
        const scout = (world.crew || []).some(c => c.role === 'scout' && !(c.down > 0));
        const mm = this.minimapRect(W, H, opts.touch, narrow);
        this.mapRect = mm;
        if (!world.showMap) drawMap(ctx, world, this.mapBase, mm, { remotes, showCops: scout, t: this.t });

        // ── Händelser: vem som kom, gick och sänkte vem ──
        world.feed.forEach((f, i) => {
            ctx.globalAlpha = Math.min(1, f.life);
            outlined(ctx, f.text, W / 2, (narrow ? 236 : 62) + i * 18, narrow ? 11 : 13, f.color, 'center', BIG_FONT, 3);
        });
        ctx.globalAlpha = 1;

        // ── Stor karta (M) ──
        if (world.showMap) {
            ctx.fillStyle = 'rgba(0,0,0,0.78)'; ctx.fillRect(0, 0, W, H);
            const size = Math.min(W - 40, H - 110);
            const box = { x: (W - size) / 2, y: 70, size };
            drawMap(ctx, world, this.mapBase, box, { remotes, showCops: scout, full: true, t: this.t });
            outlined(ctx, 'HUSTLE CITY', box.x, box.y - 16, narrow ? 16 : 20, '#ffd23f', 'left', BIG_FONT, 5);
            const legend = MAP_LEGEND.map(([sym, , label]) => `${sym} ${label}`).join('   ');
            outlined(ctx, `${legend}   ·   M / tryck = stäng`, W / 2, box.y + size + 22, narrow ? 10 : 12, '#e5e7eb', 'center', BIG_FONT, 3);
            this.mapRect = { x: 0, y: 0, size: Math.max(W, H) };
        }

        // ── Stor text ──
        if (this.big) {
            const b = this.big;
            const age = b.max - b.life;
            const scale = age < 0.25 ? 1.6 - age / 0.25 * 0.6 : 1;
            const a = Math.min(1, b.life / 0.5);
            ctx.save();
            ctx.globalAlpha = a;
            const big = b.text === 'WASTED' || b.text === 'BUSTED';
            ctx.translate(W / 2, big ? H * 0.42 : narrow ? H * 0.4 : H * 0.3);
            ctx.scale(scale, scale);
            outlined(ctx, b.text, 0, 0, narrow ? (big ? 54 : 30) : (big ? 92 : 50), b.color, 'center', BIG_FONT, big ? 10 : 7);
            if (b.sub) outlined(ctx, b.sub, 0, narrow ? 38 : 58, narrow ? 13 : 18, '#fff', 'center', BIG_FONT, 4);
            ctx.restore();
        }
        // Träffad: röd kant
        if (p.hurtT > 0) {
            const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.3, W / 2, H / 2, Math.max(W, H) * 0.7);
            g.addColorStop(0, 'rgba(200,0,0,0)');
            g.addColorStop(1, `rgba(200,0,0,${p.hurtT * 1.5})`);
            ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
        }
        // Sänkt i PvP / skyddad efter comeback
        if (world.pvpT > 0) {
            ctx.fillStyle = 'rgba(80,0,0,0.45)'; ctx.fillRect(0, 0, W, H);
            outlined(ctx, `TILLBAKA VID HQ OM ${Math.ceil(world.pvpT)}`, W / 2, H * 0.6, narrow ? 14 : 18, '#fff', 'center', BIG_FONT, 4);
        } else if (p.protT > 0) {
            outlined(ctx, `🛡️ SKYDDAD ${Math.ceil(p.protT)}`, W / 2, H * 0.5 + 46, narrow ? 12 : 14, '#93c5fd', 'center', BIG_FONT, 3);
        }
        // "Några timmar senare..."
        if (world.fade) {
            const f = world.fade;
            const a = Math.min(1, f.t / 0.5, (f.dur - f.t) / 0.6);
            ctx.globalAlpha = Math.max(0, a);
            ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
            outlined(ctx, f.text, W / 2, H * 0.45, narrow ? 22 : 34, '#f9a8d4', 'center', BIG_FONT, 5);
            if (f.sub) outlined(ctx, f.sub, W / 2, H * 0.45 + (narrow ? 32 : 46), narrow ? 13 : 17, '#fff', 'center', BIG_FONT, 4);
            ctx.globalAlpha = 1;
        }
        if (world.state === 'wasted') {
            ctx.fillStyle = `rgba(120,0,0,${Math.min(0.35, world.stateT * 0.15)})`; ctx.fillRect(0, 0, W, H);
        } else if (world.state === 'busted') {
            ctx.fillStyle = `rgba(0,30,120,${Math.min(0.3, world.stateT * 0.12)})`; ctx.fillRect(0, 0, W, H);
        }
    }

    drawArrow(ctx, r, world, target, color, label, small = false, bottom = r.h) {
        const W = r.w, H = r.h;
        const sp = r.worldToScreen(target.x, target.y);
        const margin = 46;
        if (sp.x > margin && sp.x < W - margin && sp.y > margin + 60 && sp.y < H - margin) return; // syns redan
        const cx = W / 2, cy = H / 2;
        const ang = Math.atan2(sp.y - cy, sp.x - cx);
        const rx = W / 2 - margin, ry = H / 2 - margin - 30;
        const k = Math.min(rx / Math.abs(Math.cos(ang) || 1e-6), ry / Math.abs(Math.sin(ang) || 1e-6));
        const sz = small ? 14 : 22;
        const ax = cx + Math.cos(ang) * k, ay = Math.min(cy + Math.sin(ang) * k + 20, bottom - sz - 30);
        ctx.save();
        ctx.translate(ax, ay);
        ctx.rotate(ang);
        ctx.fillStyle = color; ctx.strokeStyle = '#000'; ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(sz, 0); ctx.lineTo(-sz * 0.7, -sz * 0.8); ctx.lineTo(-sz * 0.35, 0); ctx.lineTo(-sz * 0.7, sz * 0.8);
        ctx.closePath(); ctx.fill(); ctx.stroke();
        ctx.restore();
        const meters = Math.round(Math.hypot(target.x - world.player.x, target.y - world.player.y) / TILE * 5);
        outlined(ctx, `${label ? label + ' · ' : ''}${meters} m`, ax - Math.cos(ang) * (sz + 34), ay - Math.sin(ang) * (sz + 18), small ? 11 : 13, '#fff', 'center', BIG_FONT, 3);
    }

    // ── 3D (förstaperson/följkamera): det som hör till platser i världen ──
    //  2D-renderaren ritar det här i överblicken. I 3D projiceras det genom 3D-kameran:
    //  view.worldToScreen(x, y, z) → { x, y, visible, depth } (CSS-px, depth i världs-px).
    //  Flytande texter, pratbubblor, namnskyltar (andra spelare, crew), hälsa i bråk,
    //  markeringen av det E väljer, siktet och "klicka för att styra blicken".
    drawWorld3D(ctx, world, view, opts = {}) {
        const W = view.w, H = view.h;
        ctx.setTransform(view.dpr, 0, 0, view.dpr, 0, 0);
        const narrow = W < 560;
        const I = world.interior, here = I ? I.id : null;
        const P = (x, y, z) => view.worldToScreen(x, y, z);
        const on = (s, pad = 30) => s.depth !== Infinity && s.x > -pad && s.x < W + pad && s.y > -pad && s.y < H + pad;
        // läsbart nära, mindre längre bort (men aldrig pyttesmått)
        const sc = (d, ref) => clampN(ref / Math.max(1, d), 0.55, 1.25);
        const fade = (d, near, far) => clampN((far - d) / (far - near), 0, 1);
        const people = I ? (I.state?.npcs || []) : world.peds;

        // Hälsa och ilska hos den man slåss med (gatan: motorn ritar 😠/💫 själv; inne gör vi det här)
        for (const n of people) {
            if (n.dead) continue;
            const fight = I ? (n.brawl === 'fight' || n.foe === 'player' || n.down > 0) : ((n.attack || n.cop) && !(n.down > 0));
            if (!fight) continue;
            const s = P(n.x, n.y, 44);
            if (!on(s) || s.depth > 800) continue;
            const k = sc(s.depth, 260);
            if (n.maxHp > 0 && n.hp < n.maxHp && !(n.down > 0)) {
                const f = clampN(n.hp / n.maxHp, 0, 1), bw = 30 * k;
                ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(s.x - bw / 2 - 1, s.y - 4, bw + 2, 6);
                ctx.fillStyle = f < 0.35 ? '#ef4444' : '#facc15'; ctx.fillRect(s.x - bw / 2, s.y - 3, bw * f, 4);
            }
            if (I) {
                const guard = n.kind === 'bouncer' || n.kind === 'guard';
                const ic = n.down > 0 ? '💫' : guard && n.brawl === 'fight' ? '🕴️' : n.foe === 'player' ? '😠' : '';
                if (ic) { ctx.font = `${Math.round(15 * k)}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(ic, s.x, s.y - 14 * k); }
            }
        }

        // Pratbubblor: folk på gatan, personal och gäster inne
        for (const n of people) {
            if (!n.say || !n.say.text) continue;
            const s = P(n.x, n.y, 52);
            if (!on(s, 60) || s.depth > 900) continue;
            const a = fade(s.depth, 600, 900) * Math.min(1, (n.say.life ?? 1) * 2);
            if (a > 0.02) speechBubble(ctx, s.x, s.y, n.say.text, a, n.attack ? '#fee2e2' : n.type === 'metro' || I ? '#fdf2f8' : '#ffffff', sc(s.depth, 320));
        }

        // Andra riktiga spelare: romb, namn, hälsa, efterlysning — och deras crew
        for (const r of world.remotes()) {
            if ((r.in || null) !== here) continue;
            for (const c of r.crew || []) {
                if (c.d) continue;
                const s = P(c.x, c.y, 46);
                if (on(s) && s.depth < 900) crewShield(ctx, s.x, s.y, r.color || '#60a5fa', false, null, sc(s.depth, 300));
            }
            const s = P(r.rx, r.ry, r.v && !here ? 40 : 52);
            if (!on(s, 60) || s.depth > 1800) continue;
            const k = sc(s.depth, 420);
            const y = s.y;
            ctx.beginPath(); ctx.moveTo(s.x, y - 9 * k); ctx.lineTo(s.x + 7 * k, y - 2 * k); ctx.lineTo(s.x, y + 5 * k); ctx.lineTo(s.x - 7 * k, y - 2 * k); ctx.closePath();
            ctx.fillStyle = r.color || '#60a5fa'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
            outlined(ctx, `${r.icon || ''} ${r.name || r.id}`, s.x, y - 20 * k, Math.round(12 * k), '#fff', 'center', BIG_FONT, 3);
            const f = clampN((r.hp || 0) / (r.mhp || 100), 0, 1), bw = 34 * k;
            ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillRect(s.x - bw / 2 - 1, y - 34 * k, bw + 2, 6);
            ctx.fillStyle = f < 0.35 ? '#ef4444' : '#22c55e'; ctx.fillRect(s.x - bw / 2, y - 34 * k + 1, bw * f, 4);
            if (r.stars > 0) { ctx.font = `${Math.round(10 * k)}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.fillText('👮'.repeat(Math.min(5, r.stars)), s.x, y - 44 * k); }
        }
        // Mitt crew: grön sköld med hälsa
        for (const c of world.crew || []) {
            if (c.hidden || (c.interior || null) !== here) continue;
            const s = P(c.x, c.y, 46);
            if (on(s) && s.depth < 1000) crewShield(ctx, s.x, s.y, '#22c55e', true, c, sc(s.depth, 300));
        }

        // Flytande texter (belöningar, kombos): stiger uppåt från där de hände
        for (const f of world.floaters || []) {
            if (f._y0 === undefined || f.life > (f._l ?? 0)) f._y0 = f.y; // ny eller återanvänd (kombo)
            f._l = f.life;
            const s = P(f.x, f._y0, 36 + (f._y0 - f.y));
            if (!on(s, 80) || s.depth > 1500) continue;
            ctx.globalAlpha = clampN(f.life, 0, 1);
            outlined(ctx, f.text, s.x, s.y, Math.round(19 * sc(s.depth, 300)), f.color || '#ffd23f', 'center', BIG_FONT, 4);
        }
        ctx.globalAlpha = 1;

        // Det E väljer just nu: hörn runt målet, tangenten och vad som händer
        const t = eTarget(world);
        if (t) {
            const s = P(t.x, t.y, t.z);
            if (on(s, 0)) eMarker(ctx, s.x, s.y, t, opts.touch, sc(s.depth, t.kind === 'car' ? 160 : 120), this.t);
        }

        // Siktet: där slaget/skottet går (rakt fram längs blicken, i gubbens höjd)
        const p = world.player;
        if (!p.vehicle && !p.dead && world.state === 'play' && !world.fade && !world.showMap) {
            const wpn = WEAPONS[world.profile.weapon] || WEAPONS.fists;
            const ranged = !wpn.melee;
            const reach = ranged ? 240 : 42;
            const s = P(p.x + Math.cos(p.angle) * reach, p.y + Math.sin(p.angle) * reach, opts.mode === 'fps' ? 30 : ranged ? 19 : 22);
            const x = s.depth === Infinity ? W / 2 : clampN(s.x, 16, W - 16), y = s.depth === Infinity ? H / 2 : clampN(s.y, 16, H - 16);
            crosshair(ctx, x, y, ranged, ranged && !(world.profile.ammo?.[wpn.id] > 0));
        }

        // Datorn utan pekarlås: man måste klicka i bilden för att styra blicken
        if (opts.lockHint && !world.showMap) {
            ctx.globalAlpha = 0.8 + 0.2 * Math.sin(this.t * 4);
            const y = narrow ? H * 0.46 : H * 0.4;
            ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(W / 2 - Math.min(W, 520) / 2, y - 20, Math.min(W, 520), 52);
            outlined(ctx, '🖱️ KLICKA I BILDEN FÖR ATT STYRA BLICKEN', W / 2, y - 2, narrow ? 12 : 17, '#fff', 'center', BIG_FONT, 4);
            outlined(ctx, 'Musen tittar · Esc släpper musen (paus) · V/C byter kamera', W / 2, y + 20, narrow ? 9 : 11, '#e5e7eb', 'center', BIG_FONT, 3);
            ctx.globalAlpha = 1;
        }
    }
}

const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);

function roundRectPath(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

// Pratbubbla med pip nedåt mot den som pratar (3D: projicerad ovanför huvudet)
function speechBubble(ctx, x, y, text, alpha, fill, k = 1) {
    const size = Math.max(10, Math.round(12 * k));
    ctx.font = `${size}px "Space Grotesk", sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const w = Math.min(240, ctx.measureText(text).width + 16), h = size + 9;
    const by = y - h / 2 - 6;
    ctx.globalAlpha = alpha;
    ctx.fillStyle = fill; ctx.strokeStyle = '#111'; ctx.lineWidth = 1.5;
    roundRectPath(ctx, x - w / 2, by - h / 2, w, h, 7); ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x - 4, by + h / 2 - 1); ctx.lineTo(x, by + h / 2 + 6); ctx.lineTo(x + 4, by + h / 2 - 1); ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#111'; ctx.fillText(text, x, by + 0.5, 228);
    ctx.globalAlpha = 1;
}

// Sköld ovanför en crewmedlem: grön = mitt (med hälsa), annars ägarens färg
function crewShield(ctx, x, y, color, mine, c, k = 1) {
    ctx.beginPath();
    ctx.moveTo(x - 6 * k, y - 6 * k); ctx.lineTo(x + 6 * k, y - 6 * k); ctx.lineTo(x + 6 * k, y + k); ctx.lineTo(x, y + 7 * k); ctx.lineTo(x - 6 * k, y + k); ctx.closePath();
    ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = mine ? '#052e16' : '#fff'; ctx.stroke();
    if (c) {
        const f = clampN(c.hp / c.maxHp, 0, 1), bw = 22 * k;
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x - bw / 2 - 1, y - 13 * k, bw + 2, 4);
        ctx.fillStyle = c.down > 0 ? '#6b7280' : f < 0.35 ? '#ef4444' : '#22c55e'; ctx.fillRect(x - bw / 2, y - 13 * k + 1, bw * f, 2);
        if (c.down > 0) { ctx.font = `${Math.round(12 * k)}px ${EMOJI_FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('💤', x, y - 22 * k); }
    }
}

// Markeringen för det E väljer: fyra hörn som andas, tangenten och vad som händer
function eMarker(ctx, x, y, t, touch, k, time) {
    const r = (t.kind === 'car' ? 34 : t.kind === 'talk' ? 26 : 22) * k * (1 + 0.06 * Math.sin(time * 6));
    const col = t.shut ? '#f87171' : '#facc15';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 5; ctx.lineCap = 'round';
    const corners = () => {
        ctx.beginPath();
        for (const [sx, sy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            ctx.moveTo(x + sx * r, y + sy * (r - 9 * k)); ctx.lineTo(x + sx * r, y + sy * r); ctx.lineTo(x + sx * (r - 9 * k), y + sy * r);
        }
        ctx.stroke();
    };
    corners();
    ctx.strokeStyle = col; ctx.lineWidth = 2.5; corners();
    ctx.lineCap = 'butt';
    // tangenten (touch: den gröna E-knappen)
    const kx = x, ky = y - r - 16;
    ctx.fillStyle = t.shut ? '#7f1d1d' : touch ? '#16a34a' : '#111'; ctx.strokeStyle = col; ctx.lineWidth = 2;
    roundRectPath(ctx, kx - 12, ky - 12, 24, 24, touch ? 12 : 5); ctx.fill(); ctx.stroke();
    outlined(ctx, 'E', kx, ky + 1, 14, '#fff', 'center', BIG_FONT, 3);
    outlined(ctx, t.label, x, y + r + 14, 12, col, 'center', BIG_FONT, 3);
}

// Siktet mitt i blicken: kors för skjutvapen (rött utan ammo), liten ring för nävar/slagträ
function crosshair(ctx, x, y, ranged, empty) {
    ctx.lineCap = 'round';
    const draw = (col, w) => {
        ctx.strokeStyle = col; ctx.lineWidth = w;
        ctx.beginPath();
        if (ranged) {
            for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * 5, y + dy * 5); ctx.lineTo(x + dx * 12, y + dy * 12); }
        } else ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.stroke();
    };
    draw('rgba(0,0,0,0.65)', 4);
    draw(empty ? '#f87171' : 'rgba(255,255,255,0.95)', 2);
    ctx.fillStyle = empty ? '#f87171' : '#fff';
    ctx.beginPath(); ctx.arc(x, y, 1.6, 0, Math.PI * 2); ctx.fill();
    ctx.lineCap = 'butt';
}
