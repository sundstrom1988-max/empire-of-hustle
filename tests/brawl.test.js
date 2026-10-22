import { describe, it, expect } from 'vitest';
import { World } from '../src/city/world.js';
import { INTERIORS, circleClear, interiorSolid, interactionAt } from '../src/city/interiors.js';
import { BAN_TIME, DOWN_TIME, CALM_TIME, playerPunch } from '../src/city/brawl.js';
import { SHOPS } from '../src/data/gameData.js';
import { generateCity } from '../src/city/map.js';
import { mulberry32 } from '../src/city/rng.js';
import { createPlayerState } from '../src/game/state.js';

const city = generateCity(1337);
const DT = 1 / 60;
const IDLE = { throttle: 0, steer: 0, handbrake: false, mx: 0, my: 0, run: false, action: false, horn: false, punch: false, attack: false, rob: false, weapon: false };
const T = INTERIORS.stripclub ? 32 : 32;
const tc = t => t * T + T / 2;

function world(seed = 5, prof = createPlayerState('kimit')) {
    return new World(city, prof, { round: 2, rnd: mulberry32(seed) });
}
function inClub(seed, prof) {
    const w = world(seed, prof);
    expect(w.enterInterior('stripclub', city.markers.stripclub)).toBe(true);
    w.events.length = 0;
    return w;
}
const npcs = w => w.interior.state.npcs;
const guests = w => npcs(w).filter(n => n.kind === 'guest' || n.kind === 'vip' || n.kind === 'patron');
const msgs = w => w.events.filter(e => e.type === 'msg').map(e => e.text);
const run = (w, sec, input = IDLE) => { for (let i = 0; i < sec * 60; i++) { w.update(DT, input); if (!w.interior) return false; } return true; };

// Ställ spelaren på golvet bredvid n och vänd den mot n
function beside(w, n, avoidTalk = false) {
    const def = w.interior.def, p = w.player;
    for (const r of [20, 24, 28, 32]) for (let k = 0; k < 16; k++) {
        const a = k * Math.PI / 8, x = n.x + Math.cos(a) * r, y = n.y + Math.sin(a) * r;
        if (!circleClear(def, x, y, p.r) || (avoidTalk && interactionAt(def, x, y))) continue;
        p.x = x; p.y = y; p.vx = p.vy = 0; p.angle = Math.atan2(n.y - y, n.x - x);
        return true;
    }
    return false;
}
// Slå tills n ligger (spelaren ställer sig bredvid inför varje slag)
function knockDown(w, n) {
    for (let i = 0; i < 12 && !(n.down > 0); i++) {
        beside(w, n);
        w.punchCd = 0;
        w.update(DT, { ...IDLE, punch: true });
    }
}
// Bara n (och dansarna) kvar i rummet
function alone(w, n) { w.interior.state.npcs = npcs(w).filter(m => m === n || m.beh === 'dancer'); }
function finite(e) { return Number.isFinite(e.x) && Number.isFinite(e.y); }

describe('Barbråk inomhus', () => {
    it('ett slag skadar gästen, startar bråket och vakten kommer', () => {
        const w = inClub(5);
        const g = guests(w).find(n => n.beh === 'seat');
        expect(beside(w, g)).toBe(true);
        w.update(DT, { ...IDLE, punch: true });
        const hit = npcs(w).find(n => n.maxHp > 0 && n.hp < n.maxHp);
        expect(hit).toBeTruthy();
        expect(hit.brawl).toBe('fight');
        expect(hit.foe).toBe('player');
        expect(hit.flashT).toBeGreaterThan(0);
        expect(Math.hypot(hit.x - w.player.x, hit.y - w.player.y)).toBeLessThan(45);
        expect(w.interior.fight.on).toBe(true);
        expect(w.profile.cityStats.barfights).toBe(1);
        expect(w.interior.state.panic).toBeGreaterThan(0);
        const bouncer = npcs(w).find(n => n.kind === 'bouncer');
        expect(bouncer.brawl).toBe('fight');
        expect(bouncer.foe).toBe('player');
        expect(bouncer.maxHp).toBe(80);
        expect(msgs(w).some(t => t.includes('Barbråk'))).toBe(true);
        // vakten springer fram och slår — men man dör inte inomhus
        const p = w.player, hp0 = p.hp;
        let near = Infinity;
        for (let i = 0; i < 60 * 12 && w.interior && p.hp >= hp0; i++) {
            w.update(DT, IDLE);
            near = Math.min(near, Math.hypot(bouncer.x - p.x, bouncer.y - p.y));
        }
        expect(near).toBeLessThan(40);
        expect(p.hp).toBeLessThan(hp0);
        expect(p.hp).toBeGreaterThanOrEqual(1);
        expect(w.state).toBe('play');
    });

    it('dansarna på scenen går inte att slå', () => {
        const w = inClub(6);
        const d = npcs(w).find(n => n.beh === 'dancer');
        alone(w, d);
        const p = w.player;
        p.x = d.x + 14; p.y = d.y; p.angle = Math.PI;
        w.punchCd = 0;
        expect(playerPunch(w)).toBe(false);
        expect(d.brawl).toBeFalsy();
        expect(d.hp).toBeUndefined();
        expect(w.interior.fight?.on).toBeFalsy();
    });

    it('slängs ut vid låg hälsa och kommer inte in igen direkt', () => {
        const w = inClub(7);
        const p = w.player;
        p.hp = p.maxHp * 0.32;
        const g = guests(w).find(n => n.beh === 'seat');
        beside(w, g);
        w.update(DT, { ...IDLE, punch: true });
        let minHp = p.hp;
        for (let i = 0; i < 60 * 30 && w.interior; i++) { w.update(DT, IDLE); minHp = Math.min(minHp, p.hp); }
        expect(w.interior).toBe(null);
        expect(minHp).toBeGreaterThanOrEqual(1);
        expect(p.dead).toBeFalsy();
        expect(w.state).toBe('play');
        expect(msgs(w).some(t => t.includes('slängde ut dig'))).toBe(true);
        expect(w.banned.stripclub).toBeGreaterThan(w.time);
        // stängt för en en stund
        w.events.length = 0;
        expect(w.enterInterior('stripclub', city.markers.stripclub)).toBe(false);
        expect(w.interior).toBe(null);
        expect(msgs(w).some(t => t.includes('kommer inte in'))).toBe(true);
        w.time += BAN_TIME + 1;
        expect(w.enterInterior('stripclub', city.markers.stripclub)).toBe(true);
    });

    it('vakten slänger ut en efter tre träffar även med full hälsa', () => {
        const w = inClub(8);
        const p = w.player;
        p.hp = p.maxHp = 1000;
        const bouncer = npcs(w).find(n => n.kind === 'bouncer');
        // bara vakten och dansarna kvar: det är vakten som slår
        const g = guests(w)[0];
        w.interior.state.npcs = npcs(w).filter(n => n === g || n === bouncer || n.beh === 'dancer');
        beside(w, g);
        w.update(DT, { ...IDLE, punch: true });
        expect(bouncer.brawl).toBe('fight');
        run(w, 30);
        expect(w.interior).toBe(null);
        expect(p.hp).toBeGreaterThan(p.maxHp * 0.5);
        expect(msgs(w).some(t => t.includes('🕴️ Vakten slängde ut dig!'))).toBe(true);
    });

    it('den nedslagna ligger med 💫, reser sig efter en stund och går ut', () => {
        const w = inClub(9);
        const g = guests(w).find(n => n.beh === 'seat');
        alone(w, g);
        knockDown(w, g);
        expect(g.down).toBeGreaterThan(0);
        expect(g.brawl).toBe('down');
        expect(g.hp).toBeLessThanOrEqual(0);
        expect(msgs(w).length).toBeGreaterThan(0);
        // ligger kvar och rör sig inte (förutom knuffen)
        run(w, 1);
        const x = g.x, y = g.y;
        run(w, DOWN_TIME - 2);
        expect(g.brawl).toBe('down');
        expect([g.x, g.y]).toEqual([x, y]);
        run(w, 2);
        expect(g.down).toBe(0);
        expect(g.brawl).toBe(null);
        expect(g.leaving).toBe(true);
        // ut genom dörren och bort
        let t = 0;
        while (npcs(w).includes(g) && t < 40) { w.update(DT, IDLE); t += DT; expect(finite(g)).toBe(true); }
        expect(npcs(w).includes(g)).toBe(false);
    });

    it('R vid den som ligger länsar plånboken — en gång', () => {
        const w = inClub(10);
        const g = guests(w).find(n => n.beh === 'seat');
        alone(w, g);
        knockDown(w, g);
        expect(g.down).toBeGreaterThan(0);
        beside(w, g);
        const m0 = w.profile.money;
        w.update(DT, { ...IDLE, rob: true });
        const got = w.profile.money - m0;
        expect(got).toBeGreaterThanOrEqual(40);
        expect(got).toBeLessThanOrEqual(250);
        expect(g.looted).toBe(true);
        w.robCd = 0;
        w.update(DT, { ...IDLE, rob: true });
        expect(w.profile.money - m0).toBe(got);
    });

    it('hos Pang-Pelle blir det inget bråk', () => {
        const w = world(11);
        expect(w.enterInterior('gunshop', city.markers.guns)).toBe(true);
        w.events.length = 0;
        const seller = npcs(w).find(n => n.kind === 'seller');
        const cust = npcs(w).find(n => n.kind === 'customer');
        beside(w, cust);
        w.update(DT, { ...IDLE, punch: true });
        w.update(DT, { ...IDLE, rob: true });
        for (const n of [seller, cust]) { expect(n.brawl).toBeFalsy(); expect(n.hp).toBeUndefined(); }
        expect(w.interior.fight).toBeUndefined();
        expect(msgs(w).some(t => t.includes('Pang-Pelle'))).toBe(true);
    });

    it('tipset säger diskret att man kan starta ett bråk', () => {
        const w = inClub(12);
        const g = guests(w).find(n => n.beh === 'seat' && beside(w, n, true));
        expect(g).toBeTruthy();
        w.update(DT, IDLE);
        expect(w.hint).toBe('SPACE — Starta bråk');
    });

    it('bråket lugnar sig när ingen kommer åt spelaren', () => {
        const w = inClub(13);
        const g = guests(w).find(n => n.beh === 'seat');
        beside(w, g);
        w.update(DT, { ...IDLE, punch: true });
        expect(npcs(w).some(n => n.brawl === 'fight')).toBe(true);
        // spelaren gömmer sig bakom DJ-bordet (ingen kommer dit)
        const p = w.player;
        p.x = tc(3); p.y = tc(1);
        run(w, CALM_TIME + 1.5);
        expect(w.interior?.id).toBe('stripclub');
        expect(npcs(w).some(n => n.brawl === 'fight')).toBe(false);
        expect(w.interior.fight.on).toBe(false);
        expect(msgs(w).some(t => t.includes('lugnat sig'))).toBe(true);
        expect(npcs(w).filter(n => n.stirred).every(n => n.leaving || n.brawl === 'down' || n.kind === 'dj' || !n.brawl)).toBe(true);
    });

    it('crewet i rummet går på den som ger sig på mig', () => {
        const prof = createPlayerState('kimit');
        prof.crew = [{ id: 'c1', name: 'Yusuf', role: 'guard', hp: 90, dmg: [14, 20], speed: 165 }];
        const w = inClub(14, prof);
        const c = w.crew[0];
        expect(c.interior).toBe('stripclub');
        w.player.hp = w.player.maxHp = 1000;
        const g = guests(w).find(n => n.beh === 'seat');
        w.interior.state.npcs = npcs(w).filter(n => n === g || n.beh === 'dancer');
        beside(w, g);
        w.update(DT, { ...IDLE, punch: true });
        let punched = false;
        for (let i = 0; i < 60 * 15 && !(g.down > 0); i++) { w.update(DT, IDLE); if (c.punchT > 0) punched = true; }
        expect(punched).toBe(true);
        expect(g.down > 0 || g.hp < g.maxHp).toBe(true);
        expect(finite(c)).toBe(true);
    });

    it('60 sekunder kaos: inga NaN, ingen i väggarna, man dör aldrig inomhus', () => {
        const prof = createPlayerState('kimit');
        prof.crew = [{ id: 'c1', name: 'Yusuf', role: 'guard', hp: 90, dmg: [14, 20], speed: 165 }, { id: 'c2', name: 'Mira', role: 'gunner', hp: 70, dmg: [11, 15], speed: 155 }];
        prof.weapons = ['bat']; prof.weapon = 'bat';
        const w = inClub(15, prof);
        let outs = 0, downs = 0, fled = 0;
        const seen = new Set();
        for (let i = 0; i < 60 * 60; i++) {
            if (!w.interior) { outs++; w.time += BAN_TIME + 1; expect(w.enterInterior('stripclub', city.markers.stripclub)).toBe(true); }
            const t = i / 60;
            w.update(DT, { ...IDLE, mx: Math.sin(t * 0.9), my: Math.cos(t * 0.6), run: i % 300 < 60, punch: i % 20 === 0, rob: i % 97 === 0 });
            w.events.length = 0;
            expect(w.state).toBe('play');
            expect(w.player.hp).toBeGreaterThanOrEqual(1);
            if (!w.interior) continue;
            for (const n of npcs(w)) {
                if (n.down > 0 && !seen.has(n)) { seen.add(n); downs++; }
                if (n.leaving && !n.brawl && !seen.has(n)) { seen.add(n); fled++; }
            }
            if (i % 30) continue;
            const def = w.interior.def;
            for (const n of npcs(w)) {
                expect(finite(n), n.kind).toBe(true);
                expect(Number.isFinite(n.angle), n.kind).toBe(true);
                if (n.brawl || n.leaving) expect(interiorSolid(def, n.x, n.y), `${n.kind} i väggen`).toBe(false);
            }
            for (const c of w.crew) expect(finite(c)).toBe(true);
            expect(finite(w.player)).toBe(true);
        }
        expect(downs + fled).toBeGreaterThan(0);
        expect(w.profile.cityStats.barfights).toBeGreaterThanOrEqual(1);
        expect(outs).toBeGreaterThanOrEqual(0);
    });

    it('verksamheternas rum: bråk går att starta och håller ihop', () => {
        const ids = SHOPS.map((s, slot) => ({ id: s.id, slot })).filter(s => INTERIORS[s.id]);
        for (const { id, slot } of ids) {
            const w = world(20 + slot);
            w.player.hp = w.player.maxHp = 1000;
            const mk = city.markers.businesses.find(b => b.slot === slot);
            expect(w.enterInterior(id, mk), id).toBe(true);
            run(w, 1);
            const target = npcs(w).find(n => n.beh !== 'dancer' && !n.dead && !n.gone && beside(w, n));
            if (!target) continue;
            w.punchCd = 0;
            w.update(DT, { ...IDLE, punch: true });
            expect(npcs(w).some(n => n.brawl === 'fight'), id).toBe(true);
            for (let i = 0; i < 60 * 20 && w.interior; i++) {
                w.update(DT, { ...IDLE, punch: i % 40 === 0 });
                w.events.length = 0;
                if (i % 60) continue;
                for (const n of npcs(w)) expect(finite(n), `${id}: ${n.kind}`).toBe(true);
            }
        }
    });
});
