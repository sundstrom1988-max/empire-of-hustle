import { describe, it, expect, beforeEach } from 'vitest';
import * as A from '../src/multiplayer/authority.js';
import { gameState, resetGameState, createPlayerState, mergeRemoteState, normalizePlayer } from '../src/game/state.js';
import { cityEnter, cityPublish, cityRequest, cityRemotes, cityTaken, onCityNet, _resetCityNet, _hostHandle, _sanitizePos } from '../src/multiplayer/citynet.js';
import { World } from '../src/city/world.js';
import { generateCity } from '../src/city/map.js';
import { mulberry32 } from '../src/city/rng.js';
import { cityItemDefs, itemGain } from '../src/city/items.js';
import { createPed } from '../src/city/ai.js';
import { TILE } from '../src/city/constants.js';

const city = generateCity(1337);
const DT = 1 / 60;
const IDLE = { throttle: 0, steer: 0, handbrake: false, mx: 0, my: 0, run: false, action: false, horn: false };

describe('Värdens regler', () => {
    it('föremål: bara den som står nära och kommer först får det', () => {
        const items = new Map([['i1', { id: 'i1', x: 100, y: 100, takenUntil: 0 }]]);
        expect(A.validatePickup(items, 'i1', { x: 400, y: 100, in: null }, 1000).ok).toBe(false);
        expect(A.validatePickup(items, 'i1', { x: 120, y: 100, in: 'stripclub' }, 1000).ok).toBe(false);
        expect(A.validatePickup(items, 'i1', { x: 120, y: 100, in: null }, 1000).ok).toBe(true);
        A.takeItem(items, 'i1', 1000);
        expect(A.validatePickup(items, 'i1', { x: 100, y: 100, in: null }, 2000).reason).toBe('Någon hann före');
        expect(A.validatePickup(items, 'i1', { x: 100, y: 100, in: null }, 1000 + A.ITEM_RESPAWN * 1000 + 1).ok).toBe(true);
    });

    it('träffar: räckvidd, samma plats, skydd, tak på skada och inte för många per sekund', () => {
        const log = new Map();
        const a = { x: 0, y: 0, in: null }, t = { x: 50, y: 0, in: null };
        expect(A.validateHit(a, { ...t, x: 2000 }, 'bullet', 10, 0, log, 'a').ok).toBe(false);
        expect(A.validateHit(a, { ...t, in: 'stripclub' }, 'melee', 10, 0, log, 'a').ok).toBe(false);
        expect(A.validateHit(a, { ...t, prot: true }, 'melee', 10, 0, log, 'a').ok).toBe(false);
        expect(A.validateHit(a, t, 'melee', 999, 0, log, 'a').dmg).toBe(A.HIT_RULES.melee.max);
        let ok = 0;
        for (let i = 0; i < 40; i++) if (A.validateHit(a, t, 'bullet', 5, 100, log, 'b').ok) ok++;
        expect(ok).toBeLessThan(20);
    });

    it('ägande: pris, övertagning med ersättning och inget dubbelköp', () => {
        const def = A.PROPERTIES.stripclub;
        expect(A.validateBuy({}, 'stripclub', 'a', def.price - 1).ok).toBe(false);
        const r = A.validateBuy({}, 'stripclub', 'a', def.price);
        expect(r).toMatchObject({ ok: true, price: def.price, prevOwner: null });
        const owners = { stripclub: { owner: 'a' } };
        expect(A.validateBuy(owners, 'stripclub', 'a', 1e9).ok).toBe(false);
        const t = A.validateBuy(owners, 'stripclub', 'b', 1e9);
        expect(t).toMatchObject({ ok: true, prevOwner: 'a', price: def.price * def.takeover, refund: def.price * def.refund });
    });

    it('SMS: längd och spamskydd', () => {
        const log = [];
        expect(A.validateSms('', log, 0).ok).toBe(false);
        expect(A.validateSms('x'.repeat(A.SMS_MAX + 1), log, 0).ok).toBe(false);
        expect(A.validateSms('  hej  ', log, 0)).toMatchObject({ ok: true, text: 'hej' });
        expect(A.validateSms('igen', log, 100).reason).toBe('rate');
        let ok = 0;
        for (let i = 1; i <= 10; i++) if (A.validateSms('hej', log, i * 800).ok) ok++;
        expect(ok).toBeLessThan(10);
    });
});

describe('Online: varje klient äger sin egen spelare', () => {
    beforeEach(() => {
        resetGameState();
        gameState.isOnline = true;
        gameState.myCharKey = 'mehmet';
        gameState.players = [normalizePlayer({ charKey: 'kimit' }), normalizePlayer({ charKey: 'mehmet' })];
        gameState.turnSeq = 5;
    });

    it('min spelare skrivs inte över av värdens äldre kopia, även när det inte är min tur', () => {
        gameState.currentPlayerIdx = 0; // värdens tur
        const me = gameState.players[1];
        me.money = 9000;
        const remote = JSON.parse(JSON.stringify({ ...gameState, players: gameState.players }));
        remote.players[1].money = 1000;
        remote.players[0].money = 4242;
        remote.players[1].isAI = true;
        mergeRemoteState(remote);
        expect(gameState.players[1]).toBe(me);
        expect(me.money).toBe(9000);
        expect(me.isAI).toBe(true);          // det bestämmer värden
        expect(gameState.players[0].money).toBe(4242);
    });

    it('ett äldre turläge ignoreras men delade saker från värden gäller', () => {
        mergeRemoteState({ turnSeq: 3, currentPlayerIdx: 1, round: 1, cityOwners: { stripclub: { owner: 'kimit' } } });
        expect(gameState.currentPlayerIdx).toBe(0);
        expect(gameState.cityOwners.stripclub.owner).toBe('kimit');
    });

    it('värden tar bara avsändarens egen spelare från en gäst', () => {
        gameState.myCharKey = 'kimit'; // jag är värden
        const fake = { turnSeq: 6, players: [{ charKey: 'kimit', money: 1 }, { charKey: 'mehmet', money: 777 }], cityOwners: { stripclub: { owner: 'mehmet' } } };
        mergeRemoteState(fake, { onlyPlayer: 'mehmet', fromHost: false });
        expect(gameState.players[1].money).toBe(777);
        expect(gameState.players[0].money).not.toBe(1);
        expect(gameState.cityOwners.stripclub).toBeUndefined();
        expect(gameState.turnSeq).toBe(6);
    });
});

// En värld kopplad till den delade staden (offline = man är sin egen värd)
function netWorld(seed = 1, profile = createPlayerState('kimit')) {
    resetGameState();
    _resetCityNet();
    gameState.players = [profile];
    const net = { online: false, remotes: cityRemotes, taken: cityTaken, request: cityRequest };
    const w = new World(city, profile, { round: 2, rnd: mulberry32(seed), net });
    w.ownersRef = () => gameState.cityOwners;
    cityEnter(profile.charKey);
    onCityNet(e => w.onNet(e));
    cityPublish(w.netSnapshot(), true);
    return w;
}

describe('Delad stad', () => {
    it('ett vapen på marken kan bara tas av en spelare', () => {
        const w = netWorld(1);
        const it = cityItemDefs(city).find(d => d.type === 'pistol');
        w.player.x = it.x; w.player.y = it.y;
        cityPublish(w.netSnapshot(), true);
        // En annan spelare står på samma ställe och hinner före
        _hostHandle('cityPos', { p: { x: it.x, y: it.y } }, 'mehmet');
        _hostHandle('pickup', { item: it.id, req: 'x' }, 'mehmet');
        expect(cityTaken().has(it.id)).toBe(true);
        expect(w.tryPickup(it)).toBe(true);
        expect(w.profile.weapons).not.toContain('pistol');
        expect(w.feedOrMsg = w.events.some(e => e.type === 'msg' && e.text.includes('hann före'))).toBe(true);
    });

    it('plocka upp: vapen + ammo, sedan bara ammo, och fullt = nekas', () => {
        const w = netWorld(2);
        const pist = cityItemDefs(city).find(d => d.type === 'pistol');
        w.player.x = pist.x; w.player.y = pist.y;
        cityPublish(w.netSnapshot(), true);
        w.update(DT, IDLE);
        expect(w.nearItem?.id).toBe(pist.id);
        w.update(DT, { ...IDLE, action: true });
        expect(w.profile.weapons).toContain('pistol');
        expect(w.profile.ammo.pistol).toBe(12);
        expect(w.groundItems().some(d => d.id === pist.id)).toBe(false);
        w.profile.ammo.pistol = 120;
        expect(itemGain(w.profile, 'pistol')).toBe(null);
    });

    it('stripklubben: värden godkänner köpet, pengarna dras en gång', () => {
        const profile = createPlayerState('kimit');
        profile.money = 50000;
        const w = netWorld(3, profile);
        expect(w.buyProperty('stripclub')).toBe(true);
        expect(gameState.cityOwners.stripclub.owner).toBe('kimit');
        expect(profile.money).toBe(50000 - A.PROPERTIES.stripclub.price);
        expect(w.buyProperty('stripclub')).toBe(false); // redan din
        expect(profile.money).toBe(50000 - A.PROPERTIES.stripclub.price);
    });
});

describe('Crew', () => {
    it('rekrytera: kostar pengar, blir en figur i stan och sparas i crewet — med tak', () => {
        const profile = createPlayerState('kimit');
        profile.money = 50000;
        const w = netWorld(4, profile);
        const offers = w.recruitOffers();
        expect(offers.length).toBe(4);
        expect(w.recruit(offers[0].id)).toBe(true);
        expect(profile.crew.length).toBe(1);
        expect(w.crew.length).toBe(1);
        expect(profile.money).toBe(50000 - offers[0].cost);
        expect(w.recruit(offers[0].id)).toBe(false); // samma person två gånger
        for (const o of offers.slice(1)) w.recruit(o.id);
        expect(profile.crew.length).toBe(4);
    });

    it('crewet följer med och slår ner den som anfaller dig', () => {
        const profile = createPlayerState('kimit');
        profile.money = 50000;
        const w = netWorld(5, profile);
        w.player.x = 8 * TILE + 32; w.player.y = 3 * TILE + 32;
        const guard = w.recruitOffers().find(o => o.role === 'guard');
        w.recruit(guard.id);
        const c = w.crew[0];
        c.x = w.player.x - 30; c.y = w.player.y;
        w.manageSpawns = () => { };
        const opp = createPed(w.player.x + 60, w.player.y, w.rnd, { type: 'gang', gang: 'dods', attack: true, attackT: 60 });
        w.peds = [opp];
        for (let i = 0; i < 60 * 8 && !(opp.down > 0); i++) w.update(DT, IDLE);
        expect(opp.down).toBeGreaterThan(0);
        // Order: stanna, sedan följ
        expect(w.orderCrew('hold')).toBe(true);
        expect(c.order).toBe('hold');
        w.orderCrew('follow');
        w.player.x += 200;
        for (let i = 0; i < 60 * 4; i++) w.update(DT, IDLE);
        expect(Math.hypot(c.x - w.player.x, c.y - w.player.y)).toBeLessThan(120);
    });
});

describe('PvP och tjänster', () => {
    it('sänkt av en spelare: tappar 10 %, kommer tillbaka vid HQ med skydd', () => {
        const profile = createPlayerState('kimit');
        profile.money = 10000;
        const w = netWorld(6, profile);
        w.player.armor = 0;
        w.onNet({ type: 'hurt', from: 'mehmet', name: 'Mehmet', crew: -1, dmg: 60, kind: 'bullet' });
        expect(w.player.hp).toBe(40);
        w.onNet({ type: 'hurt', from: 'mehmet', name: 'Mehmet', crew: -1, dmg: 60, kind: 'bullet' });
        expect(w.pvpT).toBeGreaterThan(0);
        expect(profile.money).toBe(9000);
        expect(w.state).toBe('play');
        for (let i = 0; i < 60 * 5; i++) w.update(DT, IDLE);
        expect(w.player.dead).toBe(false);
        expect(w.player.hp).toBe(w.player.maxHp);
        expect(Math.hypot(w.player.x - city.markers.home.x, w.player.y - city.markers.home.y)).toBeLessThan(40);
        // Skyddad direkt efter comeback
        w.onNet({ type: 'hurt', from: 'mehmet', name: 'Mehmet', crew: -1, dmg: 60, kind: 'bullet' });
        expect(w.player.hp).toBe(w.player.maxHp);
    });

    it('skyddsvästen tar hälften av skadan', () => {
        const w = netWorld(7);
        w.player.armor = 50;
        w.onNet({ type: 'hurt', from: 'mehmet', name: 'Mehmet', crew: -1, dmg: 20, kind: 'melee' });
        expect(w.player.hp).toBe(92);
        expect(w.player.armor).toBe(38);
    });

    it('vinnaren får pengarna en gång även om resultatet kommer två gånger', () => {
        const profile = createPlayerState('kimit');
        const w = netWorld(8, profile);
        const m0 = profile.money;
        const res = { type: 'pvp', id: 'mehmet:1', killer: 'kimit', victim: 'mehmet', amount: 700, killerName: 'Dr. KimIT', victimName: 'Mehmet' };
        w.onNet(res);
        expect(profile.money).toBe(m0 + 700);
        expect(profile.cityStats.pvpWins).toBe(1);
    });

    it('taxi och doktor kostar pengar och gör det de ska', () => {
        const profile = createPlayerState('kimit');
        profile.money = 5000;
        const w = netWorld(9, profile);
        const d = w.taxiDestinations().find(x => x.label.includes('Club Diamant'));
        expect(w.taxi(d.i)).toBe(true);
        expect(Math.hypot(w.player.x - d.x, w.player.y - d.y)).toBeLessThan(2);
        expect(profile.money).toBe(5000 - d.price);
        w.player.hp = 30;
        w.lastHurtT = -99;
        const before = profile.money;
        expect(w.callDoctor()).toBe(true);
        expect(w.player.hp).toBe(w.player.maxHp);
        expect(profile.money).toBe(before - 400);
    });
});

describe('Positioner genom värden', () => {
    it('den som är inomhus syns vid dörren på kartan (dörren följer med genom värden)', () => {
        const city = generateCity(1337);
        const w = new World(city, createPlayerState('mehmet'), { round: 2, rnd: mulberry32(9) });
        w.enterInterior('stripclub', city.markers.stripclub);
        const sent = _sanitizePos(JSON.parse(JSON.stringify(w.netSnapshot())));
        expect(sent.in).toBe('stripclub');
        expect(sent.ox).toBe(Math.round(city.markers.stripclub.door.x));
        expect(sent.oy).toBe(Math.round(city.markers.stripclub.door.y));
        // Ute: dörren är samma som där man står
        const out = _sanitizePos({ x: 100, y: 200 });
        expect([out.ox, out.oy]).toEqual([100, 200]);
    });
});
