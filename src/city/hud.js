// ═══════════════════════════════════════════
//  STAN — HUD i GTA-stil
// ═══════════════════════════════════════════

import { GANGS, DISTRICTS, TILE } from './constants.js';
import { stars } from './wanted.js';
import { phoneOpen } from './missions.js';

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

export class Hud {
    constructor() {
        this.msgs = [];
        this.big = null;
        this.banner = null;
        this.radio = null;
        this.wantedFlash = 0;
        this.t = 0;
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
                this.banner = { text: d.name, sub: `${g.icon} ${g.name}s område`, color: g.color, life: 3, max: 3 };
                break;
            }
            case 'radio':
                this.radio = { text: e.name, sub: e.tag || '', life: 3 };
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
        outlined(ctx, `🕖 ${clock}  ·  ☎️ ${left}/${world.maxMissions}`, W - 14, 26 + moneySize * 0.9, narrow ? 12 : 14, '#e5e7eb', 'right', BIG_FONT, 3);

        // ── Efterlyst: snutmärken ──
        const s = stars(world.wanted);
        const blink = this.wantedFlash > 0 && Math.sin(this.t * 18) > 0;
        const size = narrow ? 18 : 22;
        const wy = 26 + moneySize * 0.9 + (narrow ? 24 : 30);
        ctx.font = `${size}px ${EMOJI_FONT}`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        for (let i = 0; i < 5; i++) {
            const x = W - 14 - size * 0.6 - (4 - i) * (size + 4);
            ctx.globalAlpha = i < s ? (blink ? 0.35 : 1) : 0.18;
            ctx.fillText('👮', x, wy);
        }
        ctx.globalAlpha = 1;

        // ── Respekt (uppe till vänster) ──
        const bw = narrow ? 92 : 128;
        GANGS.forEach((g, i) => {
            const y = 16 + i * 22;
            const val = (profile.respect || {})[g.id] || 0;
            ctx.fillStyle = 'rgba(0,0,0,0.6)';
            ctx.fillRect(10, y - 8, bw + 30, 17);
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
        if (v) {
            bar(hy + 22, v.hp / v.maxHp, v.hp < v.maxHp * 0.3 ? '#f97316' : '#60a5fa', v.spec.kind === 'bike' ? '🛵' : '🚗');
            outlined(ctx, v.spec.name.toUpperCase(), 12, hy + 44, 11, '#e5e7eb', 'left', BIG_FONT, 3);
            if (p.nitro > 0) outlined(ctx, `⚡ NITRO ${p.nitro.toFixed(1)}`, 12, hy + 60, 12, '#38bdf8', 'left', BIG_FONT, 3);
        }

        // ── Distriktsbanner ──
        if (this.banner) {
            const b = this.banner;
            const a = Math.min(1, b.life, (b.max - b.life) * 4);
            const by = narrow ? H * 0.3 : H * 0.2;
            ctx.globalAlpha = a;
            outlined(ctx, b.text, W / 2, by, narrow ? 34 : 52, b.color, 'center', BIG_FONT, 7);
            outlined(ctx, b.sub, W / 2, by + (narrow ? 30 : 42), narrow ? 13 : 16, '#fff', 'center', BIG_FONT, 4);
            ctx.globalAlpha = 1;
        }
        if (this.radio) {
            ctx.globalAlpha = Math.min(1, this.radio.life);
            outlined(ctx, `📻 ${this.radio.text}`, W / 2, H * 0.32, narrow ? 15 : 19, '#7dd3fc', 'center', BIG_FONT, 4);
            if (this.radio.sub) outlined(ctx, this.radio.sub, W / 2, H * 0.32 + 22, 12, '#e5e7eb', 'center', BIG_FONT, 3);
            ctx.globalAlpha = 1;
        }

        // ── Pil mot målet ──
        const m = world.mission;
        if (m && m.target) this.drawArrow(ctx, r, world, m.target, '#ffd23f', m.target.label);
        else if (!m && left > 0 && world.state === 'play') {
            // Visa vägen till närmaste öppna telefon
            let best = null, bd = Infinity;
            for (const ph of world.city.markers.phones) {
                if (!phoneOpen(profile.respect || {}, ph.gang)) continue;
                const d = Math.hypot(ph.x - p.x, ph.y - p.y);
                if (d < bd) { bd = d; best = ph; }
            }
            if (best && bd > 260) this.drawArrow(ctx, r, world, best, 'rgba(255,255,255,0.75)', '☎️ Telefon', true);
        }

        // ── Personsökare (uppdrag + meddelanden) ──
        const pagerW = Math.min(440, W - 24);
        const lines = [];
        ctx.font = `${narrow ? 18 : 20}px ${PAGER_FONT}`;
        if (m) {
            const head = `🎯 ${m.title.toUpperCase()}${m.left !== undefined ? ` (${m.left} kvar)` : ''}`;
            lines.push({ text: head, color: '#bef264' });
            if (m.type === 'vip' && m.stage === 1 && m.damage !== undefined) lines.push({ text: `VIP-skick: ${Math.round((1 - Math.min(1, m.damage * 1.2)) * 100)}%`, color: '#bef264' });
        }
        for (const msg of this.msgs) for (const l of wrap(ctx, msg.text, pagerW - 24)) lines.push({ text: l, color: '#d9f99d', alpha: Math.min(1, msg.life) });
        if (lines.length) {
            const lh = narrow ? 18 : 20;
            const ph = lines.length * lh + 18;
            const px = (W - pagerW) / 2;
            const py = H - ph - (opts.touch ? 168 : 22);
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

        // ── Tips ──
        if (world.hint) outlined(ctx, world.hint, W / 2, H - (opts.touch ? 150 : 22) - (lines.length ? lines.length * 20 + 40 : 0), narrow ? 13 : 16, '#fff', 'center', BIG_FONT, 4);

        // ── Stor text ──
        if (this.big) {
            const b = this.big;
            const age = b.max - b.life;
            const scale = age < 0.25 ? 1.6 - age / 0.25 * 0.6 : 1;
            const a = Math.min(1, b.life / 0.5);
            ctx.save();
            ctx.globalAlpha = a;
            ctx.translate(W / 2, H * 0.42);
            ctx.scale(scale, scale);
            const big = b.text === 'WASTED' || b.text === 'BUSTED';
            outlined(ctx, b.text, 0, 0, narrow ? (big ? 54 : 30) : (big ? 92 : 50), b.color, 'center', BIG_FONT, big ? 10 : 7);
            if (b.sub) outlined(ctx, b.sub, 0, narrow ? 38 : 58, narrow ? 13 : 18, '#fff', 'center', BIG_FONT, 4);
            ctx.restore();
        }
        if (world.state === 'wasted') {
            ctx.fillStyle = `rgba(120,0,0,${Math.min(0.35, world.stateT * 0.15)})`; ctx.fillRect(0, 0, W, H);
        } else if (world.state === 'busted') {
            ctx.fillStyle = `rgba(0,30,120,${Math.min(0.3, world.stateT * 0.12)})`; ctx.fillRect(0, 0, W, H);
        }
    }

    drawArrow(ctx, r, world, target, color, label, small = false) {
        const W = r.w, H = r.h;
        const sp = r.worldToScreen(target.x, target.y);
        const margin = 46;
        if (sp.x > margin && sp.x < W - margin && sp.y > margin + 60 && sp.y < H - margin) return; // syns redan
        const cx = W / 2, cy = H / 2;
        const ang = Math.atan2(sp.y - cy, sp.x - cx);
        const rx = W / 2 - margin, ry = H / 2 - margin - 30;
        const k = Math.min(rx / Math.abs(Math.cos(ang) || 1e-6), ry / Math.abs(Math.sin(ang) || 1e-6));
        const ax = cx + Math.cos(ang) * k, ay = cy + Math.sin(ang) * k + 20;
        const sz = small ? 14 : 22;
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
}
