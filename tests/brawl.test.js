import { describe, it, expect } from 'vitest';
import { World } from '../src/city/world.js';
import { INTERIORS, circleClear, interiorSolid, interactionAt, IN_TILE } from '../src/city/interiors.js';
import { BAN_TIME, DOWN_TIME, CALM_TIME, UP_TIME, GRABS, KO_COPS, LOOT_MAX, playerPunch, hitNpc, hurtInside, isGuard, isStaff } from '../src/city/brawl.js';
import { Renderer, withoutProps } from '../src/city/render.js';
import { stars } from '../src/city/wanted.js';
import { SHOPS } from '../src/data/gameData.js';
import { generateCity } from '../src/city/map.js';
import { mulberry32 } from '../src/city/rng.js';
import { createPlayerState } from '../src/game/state.js';

const city = generateCity(1337);
const DT = 1 / 60;
const IDLE = { throttle: 0, steer: 0, handbrake: false, mx: 0, my: 0, run: false, action: false, horn: false, punch: false, attack: false, rob: false, weapon: false };
const T = IN_TILE;
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
// Ett av verksamheternas rum (Nattklubben VIP = 'club', Skyskrapan = 'tower' …)
function inBiz(id, seed) {
    const w = world(seed);
    const slot = SHOPS.findIndex(s => s.id === id);
    const mk = city.markers.businesses.find(b => b.slot === slot);
    expect(w.enterInterior(id, mk), id).toBe(true);
    w.events.length = 0;
    return w;
}
const npcs = w => w.interior.state.npcs;
const guests = w => npcs(w).filter(n => n.kind === 'guest' || n.kind === 'vip' || n.kind === 'patron');
const msgs = w => w.events.filter(e => e.type === 'msg').map(e => e.text);
const run = (w, sec, input = IDLE) => { for (let i = 0; i < sec * 60; i++) { w.update(DT, input); if (!w.interior) return false; } return true; };
const work = n => isGuard(n) || isStaff(n);

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
// Slå ut alla som slåss just nu (stryk sprider bråket, så några varv)
function knockOutAll(w) {
    for (let k = 0; k < 6; k++) for (const n of npcs(w)) if (n.brawl === 'fight') hitNpc(w, n, 999, 'player');
}
// Starta ett bråk genom att slå en gäst/kund som står på golvet
function startFight(w) {
    const g = npcs(w).find(n => !work(n) && n.beh !== 'dancer' && !n.brawl && !n.leaving && !n.gone && !n.dead && !(n.upT > 0) && beside(w, n));
    expect(g, 'någon att slå').toBeTruthy();
    w.punchCd = 0;
    w.update(DT, { ...IDLE, punch: true });
    return g;
}

describe('Barbråk inomhus', () => {
    it('ett slag skadar gästen, startar bråket och vakten springer fram och slår', () => {
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
        for (let i = 0; i < 60 * 12 && w.interior && w.interior.fight.guardHits === 0; i++) w.update(DT, IDLE);
        expect(w.interior?.fight.guardHits).toBeGreaterThan(0);
        expect(bouncer.grabs).toBeGreaterThan(0);
        expect(Math.hypot(bouncer.x - p.x, bouncer.y - p.y)).toBeLessThan(45);
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

    it('slängs ut vid låg hälsa och kommer inte in igen direkt — dörren säger det', () => {
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
        // ute vid dörren: tipset säger att det är stängt, inte "Gå in"
        w.update(DT, IDLE);
        expect(w.hint).toMatch(/^🚫 💎 Club Diamant — stängt för dig \(\d+ s\)$/);
        // stängt för en en stund
        w.events.length = 0;
        expect(w.enterInterior('stripclub', city.markers.stripclub)).toBe(false);
        expect(w.interior).toBe(null);
        expect(msgs(w).some(t => t.includes('kommer inte in'))).toBe(true);
        w.time += BAN_TIME + 1;
        w.update(DT, IDLE);
        expect(w.hint).toBe('E — Gå in: 💎 Club Diamant');
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

    it('två vakter: var och en räknar sina egna träffar', () => {
        const w = inClub(8);
        const p = w.player;
        p.hp = p.maxHp = 1000;
        const a = { kind: 'guard', angle: 0 }, b = { kind: 'guard', angle: Math.PI };
        for (let i = 0; i < GRABS - 1; i++) { hurtInside(w, 1, a); hurtInside(w, 1, b); }
        expect(w.interior?.id).toBe('stripclub');            // fyra vaktträffar, men ingen vakt har tre
        expect(w.interior.fight.guardHits).toBe(2 * (GRABS - 1));
        hurtInside(w, 1, a);
        expect(w.interior).toBe(null);
    });

    it('ligger vakten utslagen är det personalen som slänger ut en', () => {
        const w = inClub(16);
        const bouncer = npcs(w).find(n => n.kind === 'bouncer');
        hitNpc(w, bouncer, 999, 'player');
        expect(bouncer.down).toBeGreaterThan(0);
        w.events.length = 0;
        const p = w.player;
        p.hp = p.maxHp * 0.21;
        hurtInside(w, 5, guests(w)[0]);
        expect(w.interior).toBe(null);
        expect(msgs(w).some(t => t.startsWith('😵 Personalen slängde ut dig!'))).toBe(true);
        expect(msgs(w).some(t => t.includes('Vakten slängde'))).toBe(false);
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

    it('utslagen på första slaget: ligger utan sittpose och glas', () => {
        const prof = createPlayerState('kimit');
        prof.weapons = ['bat']; prof.weapon = 'bat';
        const w = inClub(17, prof);
        const g = guests(w).find(n => n.beh === 'seat' && n.drink);
        expect(g.pose).toBe('sit');
        g.maxHp = 30; g.hp = 1;             // ett slag räcker
        g.item = 'wrap'; g.prop = 'bag'; g.act = 'eat';
        alone(w, g);
        beside(w, g);
        w.update(DT, { ...IDLE, punch: true });
        expect(g.down).toBeGreaterThan(0);
        expect(g.pose).not.toBe('sit');
        expect(g.drink).toBe(null);
        expect([g.item, g.prop, g.act]).toEqual([null, null, null]);
    });

    it('den som just rest sig går inte att slå direkt, och vakten ger sig in i bråket igen', () => {
        const w = inClub(18);
        w.player.hp = w.player.maxHp = 1000;
        const bouncer = npcs(w).find(n => n.kind === 'bouncer');
        alone(w, bouncer);
        hitNpc(w, bouncer, 999, 'player');
        expect(bouncer.brawl).toBe('down');
        // bråket pågår fortfarande (någon ger sig på spelaren hela tiden)
        for (let i = 0; i < 60 * (DOWN_TIME + 0.1) && bouncer.down > 0; i++) { w.interior.fight.quietT = 0; w.update(DT, IDLE); }
        expect(bouncer.down).toBe(0);
        expect(bouncer.brawl).toBe('fight');
        expect(bouncer.foe).toBe('player');
        expect(bouncer.upT).toBeGreaterThan(UP_TIME - 0.2);
        const hp = bouncer.hp;
        expect(hp).toBe(48);
        beside(w, bouncer);
        w.punchCd = 0;
        expect(playerPunch(w)).toBe(false);
        expect(bouncer.hp).toBe(hp);
        // efter skyddet går det igen
        for (let i = 0; i < 60 * UP_TIME + 5; i++) { w.interior.fight.quietT = 0; w.update(DT, IDLE); }
        expect(bouncer.upT).toBe(0);
        beside(w, bouncer);
        w.punchCd = 0;
        expect(playerPunch(w)).toBe(true);
        expect(bouncer.hp).toBeLessThan(hp);
    });

    it('R vid den som ligger länsar plånboken — en gång, och några per besök', () => {
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

    it('länsar man för mycket tar plånböckerna slut och personalen ringer snuten', () => {
        const w = inClub(19);
        w.player.hp = w.player.maxHp = 1000;
        const list = guests(w).filter(n => n.beh === 'seat').slice(0, LOOT_MAX + 1);
        expect(list.length).toBe(LOOT_MAX + 1);
        expect(stars(w.wanted)).toBe(0);
        let paid = 0;
        const all = npcs(w).slice();
        for (const g of list) {
            w.interior.state.npcs = all.filter(n => n === g || n.beh === 'dancer' || n.down > 0);
            hitNpc(w, g, 999, 'player');
            expect(g.down).toBeGreaterThan(0);
            beside(w, g);
            const m0 = w.profile.money;
            w.robCd = 0;
            w.update(DT, { ...IDLE, rob: true });
            if (w.profile.money > m0) paid++;
        }
        expect(paid).toBe(LOOT_MAX);
        expect(w.interior.fight.loots).toBe(LOOT_MAX);
        expect(msgs(w).some(t => t.includes('inga fler plånböcker'))).toBe(true);
        // KO_COPS knockouts: snuten är ringd och väntar utanför
        expect(w.interior.fight.kos).toBeGreaterThanOrEqual(KO_COPS);
        expect(msgs(w).some(t => t.startsWith('📞'))).toBe(true);
        expect(w.interior.seen).toBe(true);
        expect(stars(w.wanted)).toBeGreaterThanOrEqual(1);
        run(w, 5);
        expect(stars(w.wanted)).toBeGreaterThanOrEqual(1);   // svalnar inte medan man är inne
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

    it('bråket lugnar sig: gästerna går hem, vakten och personalen tillbaka till sina platser', () => {
        const w = inClub(13);
        const g = guests(w).find(n => n.beh === 'seat');
        beside(w, g);
        w.update(DT, { ...IDLE, punch: true });
        const fighters = npcs(w).filter(n => n.brawl === 'fight');
        const bouncer = npcs(w).find(n => n.kind === 'bouncer');
        expect(fighters).toContain(bouncer);
        expect(fighters.some(n => !work(n))).toBe(true);
        // spelaren gömmer sig bakom DJ-bordet (ingen kommer dit)
        const p = w.player;
        p.x = tc(3); p.y = tc(1);
        run(w, CALM_TIME + 1.5);
        expect(w.interior?.id).toBe('stripclub');
        expect(npcs(w).some(n => n.brawl === 'fight')).toBe(false);
        expect(w.interior.fight.on).toBe(false);
        expect(msgs(w).some(t => t.includes('lugnat sig'))).toBe(true);
        for (const n of fighters) {
            if (work(n)) {
                expect(npcs(w), n.kind).toContain(n);
                expect(n.leaving, n.kind).toBeFalsy();
            } else expect(n.leaving || n.brawl === 'down' || !npcs(w).includes(n), n.kind).toBe(true);
        }
        // vakten går runt möblerna tillbaka till sin post och står där igen
        const def = w.interior.def;
        let back = false;
        for (let i = 0; i < 60 * 30 && !back; i++) {
            w.update(DT, IDLE);
            expect(finite(bouncer)).toBe(true);
            if (bouncer.brawl === 'back') expect(interiorSolid(def, bouncer.x, bouncer.y)).toBe(false);
            back = !bouncer.brawl && bouncer.spots.some(s => Math.hypot(s.x - bouncer.x, s.y - bouncer.y) < 1);
        }
        expect(back).toBe(true);
        expect(npcs(w)).toContain(bouncer);
        expect(bouncer.beh).toBe('patrol');
        // och hämtar sig
        run(w, 20);
        expect(bouncer.hp).toBe(bouncer.maxHp);
    });

    it('två bråk i rad under samma besök: vakten är med i båda', () => {
        const w = inClub(13);
        const p = w.player;
        const bouncer = npcs(w).find(n => n.kind === 'bouncer');
        startFight(w);
        expect(bouncer.brawl).toBe('fight');
        p.x = tc(3); p.y = tc(1);
        run(w, CALM_TIME + 1.5);
        expect(w.interior.fight.on).toBe(false);
        // vänta tills vakten står på sin post igen (förut gick han hem och försvann)
        const atPost = () => !bouncer.brawl && !bouncer.leaving && bouncer.spots.some(s => Math.hypot(s.x - bouncer.x, s.y - bouncer.y) < 1);
        for (let i = 0; i < 60 * 30 && !atPost(); i++) w.update(DT, IDLE);
        expect(atPost()).toBe(true);
        run(w, 5);
        expect(npcs(w)).toContain(bouncer);
        // andra bråket: vakten kommer igen och det är han som slänger ut en
        w.events.length = 0;
        startFight(w);
        expect(w.interior.fight.n).toBe(2);
        expect(npcs(w)).toContain(bouncer);
        expect(bouncer.brawl).toBe('fight');
        expect(bouncer.foe).toBe('player');
        expect(msgs(w).some(t => t.includes('Vakterna är på väg'))).toBe(true);
        p.hp = p.maxHp = 1000;
        for (let i = 0; i < 60 * 15 && w.interior && w.interior.fight.guardHits === 0; i++) w.update(DT, IDLE);
        expect(w.interior?.fight.guardHits).toBeGreaterThan(0);
        run(w, 30);
        expect(w.interior).toBe(null);
        expect(msgs(w).some(t => t.includes('🕴️ Vakten slängde ut dig!'))).toBe(true);
    });

    for (const id of ['club', 'tower']) {
        it(`${id}: vakterna stannar kvar efter bråket och är med i nästa`, () => {
            const w = inBiz(id, 31);
            w.player.hp = w.player.maxHp = 1e6;
            run(w, 1);
            const guards = npcs(w).filter(isGuard);
            expect(guards.length).toBeGreaterThan(0);
            startFight(w);
            for (const g of guards) expect(g.brawl, id).toBe('fight');
            // panic betyder rån här: bråket rör den inte, men nya kunder släpps inte in
            expect(w.interior.state.panic).toBe(0);
            expect(w.interior.state.brawlT).toBeGreaterThan(0);
            w.update(DT, IDLE);
            expect(w.interior.state.flow).toBe(0);
            expect(npcs(w).some(n => n.pose === 'cheer' && work(n) && !n.brawl)).toBe(false);
            // alla som slåss slås ut; när de reser sig är bråket slut
            knockOutAll(w);
            for (const g of guards) expect(g.brawl).toBe('down');
            run(w, DOWN_TIME + 4);
            expect(w.interior?.id).toBe(id);
            for (const g of guards) {
                expect(npcs(w), id).toContain(g);
                expect(g.brawl).toBe(null);
                expect(g.leaving).toBeFalsy();
            }
            run(w, 12);
            for (const g of guards) { expect(npcs(w)).toContain(g); expect(g.leaving).toBeFalsy(); expect(finite(g)).toBe(true); }
            // nästa bråk: vakterna kommer igen
            w.events.length = 0;
            startFight(w);
            expect(w.interior.fight.n).toBe(2);
            for (const g of guards) { expect(g.brawl, id).toBe('fight'); expect(g.foe).toBe('player'); }
            expect(msgs(w).some(t => t.includes('Vakterna är på väg'))).toBe(true);
        });
    }

    it('Club Diamant: panic efter bråket räknas ner', () => {
        const w = inClub(20);
        startFight(w);
        expect(w.interior.state.panic).toBeGreaterThan(0);
        const p = w.player;
        p.x = tc(3); p.y = tc(1);
        run(w, CALM_TIME + 10);
        expect(w.interior?.id).toBe('stripclub');
        expect(w.interior.state.panic).toBe(0);
        expect(w.interior.state.brawlT).toBe(0);
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
        let downs = 0, fled = 0;
        const seen = new Set();
        for (let i = 0; i < 60 * 60; i++) {
            if (!w.interior) { w.time += BAN_TIME + 1; expect(w.enterInterior('stripclub', city.markers.stripclub)).toBe(true); }
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
                if (n.down > 0) expect(n.pose, n.kind).not.toBe('sit');
            }
            for (const c of w.crew) expect(finite(c)).toBe(true);
            expect(finite(w.player)).toBe(true);
        }
        expect(downs + fled).toBeGreaterThan(0);
        expect(w.profile.cityStats.barfights).toBeGreaterThanOrEqual(1);
    });

    it('verksamheternas rum: bråk går att starta och håller ihop', () => {
        const ids = SHOPS.map((s, slot) => ({ id: s.id, slot })).filter(s => INTERIORS[s.id]);
        expect(ids.length).toBeGreaterThan(0);
        for (const { id, slot } of ids) {
            const w = world(20 + slot);
            w.player.hp = w.player.maxHp = 1000;
            const mk = city.markers.businesses.find(b => b.slot === slot);
            expect(w.enterInterior(id, mk), id).toBe(true);
            expect(run(w, 1), id).toBe(true);
            const target = npcs(w).find(n => n.beh !== 'dancer' && !n.dead && !n.gone && beside(w, n));
            expect(target, id).toBeTruthy();
            w.punchCd = 0;
            w.update(DT, { ...IDLE, punch: true });
            expect(npcs(w).some(n => n.brawl === 'fight'), id).toBe(true);
            const fought = new Set();
            const def = w.interior.def;
            for (let i = 0; i < 60 * 20 && w.interior; i++) {
                w.update(DT, { ...IDLE, punch: i % 40 === 0 });
                w.events.length = 0;
                if (!w.interior) break;
                for (const n of npcs(w)) if (n.brawl === 'fight') fought.add(n);
                if (i % 60) continue;
                // panic betyder rån i de här rummen: personalen ska inte stå med händerna uppe
                expect(w.interior.state.panic, id).toBe(0);
                for (const n of npcs(w)) {
                    expect(finite(n), `${id}: ${n.kind}`).toBe(true);
                    expect(Number.isFinite(n.angle), `${id}: ${n.kind}`).toBe(true);
                    if (n.brawl === 'fight') expect(interiorSolid(def, n.x, n.y), `${id}: ${n.kind} i väggen`).toBe(false);
                }
            }
            if (!w.interior) continue; // utslängd av vakterna — också ett slut
            // när det är över (alla som slåss ligger, reser sig sedan): gästerna går, personalen är kvar
            knockOutAll(w);
            expect(run(w, DOWN_TIME + 3), id).toBe(true);
            expect(npcs(w).some(n => n.brawl === 'fight'), id).toBe(false);
            for (const n of fought) {
                if (work(n)) { if (npcs(w).includes(n)) expect(n.leaving, `${id}: ${n.kind}`).toBeFalsy(); }
                else expect(n.leaving || n.brawl === 'down' || !npcs(w).includes(n), `${id}: ${n.kind}`).toBe(true);
            }
        }
    });
});

describe('Barbråk: ritning', () => {
    it('den som slåss eller ligger har inget i händerna medan rummet ritas', () => {
        const tray = { kind: 'waitress', brawl: 'down', down: 3, drink: '#fff', staff: { role: 'x' } };
        const cook = { kind: 'cook', brawl: 'fight', item: 'wrap', act: 'chop', prop: 'box', staff: { tool: 'knife' } };
        const calm = { kind: 'guest', drink: '#f00', pose: 'sit' };
        const back = { kind: 'bouncer', brawl: 'back', prop: 'clip' };
        let inside;
        withoutProps([tray, cook, calm, back], () => {
            inside = {
                tray: [tray.kind, tray.drink, tray.staff], cook: [cook.item, cook.act, cook.prop, cook.staff],
                calm: [calm.kind, calm.drink], back: back.prop
            };
        });
        expect(inside.tray[0]).not.toBe('waitress');
        expect(inside.tray.slice(1)).toEqual([null, null]);
        expect(inside.cook).toEqual([null, null, null, null]);
        expect(inside.calm).toEqual(['guest', '#f00']);
        expect(inside.back).toBe('clip');
        // allt tillbaka efteråt
        expect(tray).toEqual({ kind: 'waitress', brawl: 'down', down: 3, drink: '#fff', staff: { role: 'x' } });
        expect(cook).toEqual({ kind: 'cook', brawl: 'fight', item: 'wrap', act: 'chop', prop: 'box', staff: { tool: 'knife' } });
        expect('item' in calm).toBe(false);
    });

    it('mobil: kameran håller spelaren ovanför personsökaren när man står längst ner i rummet', () => {
        const w = inClub(21);
        const bouncer = npcs(w).find(n => n.kind === 'bouncer');
        const p = w.player;
        p.x = bouncer.x - 20; p.y = bouncer.y;          // vid ingången, där vakten står
        const cam = { w: 390, h: 844, touch: true, zoomMul: 1 };
        Renderer.prototype.updateCamera.call(cam, w, 1);
        const sy = (p.y - cam.cam.y) * cam.cam.zoom + cam.h / 2;
        // personsökaren börjar 236 px upp (touchknapparna), tre rader är 72 px; figurens min/hälsa sitter ~53 px ovanför
        expect(sy - 53 * cam.cam.zoom).toBeLessThan(cam.h - 236 - 72);
        // på datorn ändras ingenting
        const desk = { w: 1280, h: 800, touch: false, zoomMul: 1 };
        Renderer.prototype.updateCamera.call(desk, w, 1);
        const dy = (p.y - desk.cam.y) * desk.cam.zoom + desk.h / 2;
        expect(dy).toBeLessThanOrEqual(desk.h - 120 + 0.01);
    });
});
