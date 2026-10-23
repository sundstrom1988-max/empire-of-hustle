import { describe, it, expect, afterEach } from 'vitest';
import { World } from '../src/city/world.js';
import { generateCity, laneDirs, tileAt } from '../src/city/map.js';
import { mulberry32 } from '../src/city/rng.js';
import { createPlayerState } from '../src/game/state.js';
import { createVehicle, forwardSpeed } from '../src/city/vehicles.js';
import { initLaneAI, angleDiff } from '../src/city/ai.js';
import { TILE, T, DX, DY, DIR_ANGLE } from '../src/city/constants.js';
import { _sanitizePos } from '../src/multiplayer/citynet.js';
import { stars, setStars } from '../src/city/wanted.js';
import * as POL from '../src/city/police.js';

// ═══════════════════════════════════════════
//  Polisen (masterprompt avsnitt 5): graderad reaktion, trafikstopp,
//  incidenträkning, insatstak, jakt/sökning. De åtta obligatoriska
//  testfallen + en standardiserad flyktsimulering.
// ═══════════════════════════════════════════

const city = generateCity(1337);
const STEP = 1 / 60;
const IDLE = { throttle: 0, steer: 0, handbrake: false, mx: 0, my: 0, run: false, action: false, horn: false, punch: false, attack: false, rob: false, weapon: false };
const ROAD_Y = 3 * TILE + 32;   // lång rak väg längs norra kanten (filen österut), x från ruta 2 till 59
const X0 = 8 * TILE + 32;
const CFG0 = { ...POL.POLICE };
afterEach(() => Object.assign(POL.POLICE, CFG0));

// En stad med bara spelaren, polisen och dispatchern: ingen trafik eller folk som stör mätningen.
// Dispatchern körs fyra gånger i sekunden som i spelet, och bilar långt bort städas bort.
function quietWorld(seed = 1, profile = createPlayerState('kimit')) {
    const w = new World(city, profile, { round: 2, rnd: mulberry32(seed) });
    w.vehicles = []; w.peds = [];
    w.manageSpawns = function (dt) {
        this.spawnT -= dt;
        if (this.spawnT > 0) return;
        this.spawnT = 0.25;
        for (const v of [...this.vehicles]) if (v !== this.player.vehicle && Math.hypot(v.x - this.player.x, v.y - this.player.y) > 1900) this.removeVehicle(v);
        this.dispatchPolice();
    };
    return w;
}
function playerCar(w, x = X0, y = ROAD_Y, angle = 0, type = 'volvo') {
    const car = createVehicle(type, x, y, angle);
    car.driver = 'player';
    w.vehicles.push(car);
    w.player.vehicle = car; w.player.x = x; w.player.y = y;
    return car;
}
// En stillastående polisbil (ingen AI: den står där den står tills dispatchern behöver den)
function parkedCop(w, x, y = ROAD_Y, angle = 0) {
    const v = createVehicle('police', x, y, angle);
    v.driver = 'cop';
    w.vehicles.push(v);
    return v;
}
const cops = w => w.vehicles.filter(v => v.driver === 'cop' && !v.wrecked);
const units = w => cops(w).filter(v => ['stop', 'chase', 'search'].includes(v.pol?.task));
const near = (w, r = 300) => cops(w).filter(v => Math.hypot(v.x - w.player.x, v.y - w.player.y) < r).length;
const kinds = (w, k) => w.police.incidents.filter(e => e.kind === k).length;
function run(w, sec, input = () => IDLE, each = null) {
    const n = Math.round(sec / STEP);
    for (let i = 0; i < n; i++) {
        w.update(STEP, typeof input === 'function' ? input(i * STEP, w) : input);
        w.events.length = 0;
        if (each) each(w, i * STEP);
    }
}
// Gas tills bilen nått en viss fart (framåt), sedan släpp
const cruise = (car, speed, gas = 0.6) => ({ ...IDLE, throttle: forwardSpeed(car) < speed ? gas : 0 });

describe('police.js: händelser, nivåer och tak', () => {
    it('nivåerna har insatstaken 0/1/2/3/4/6, eget tak till fots och fartfaktor ≤ 1', () => {
        expect([0, 1, 2, 3, 4, 5].map(POL.carCap)).toEqual([0, 1, 2, 3, 4, 6]);
        for (let l = 0; l <= 5; l++) {
            expect(POL.footCap(l)).toBeLessThanOrEqual(POL.carCap(l) || 1);
            expect(POL.chaseSpeed(l)).toBeLessThanOrEqual(1);
        }
        // Startbilen (Volvo 350 px/s) är snabbare än polisen på nivå 1–2
        expect(460 * POL.chaseSpeed(1)).toBeLessThan(350);
        expect(460 * POL.chaseSpeed(2)).toBeLessThan(350);
        expect(POL.copsArmed(1, true)).toBe(false);
        expect(POL.copsArmed(2, true)).toBe(false);
        expect(POL.copsArmed(4, false)).toBe(true);
        expect(POL.arrestMeans(2)).toBe('fine');
        expect(POL.arrestMeans(3)).toBe('busted');
    });

    it('en händelse ingen snut såg ger inget; samma händelse flera bildrutor i rad räknas en gång', () => {
        const P = POL.createPolice();
        expect(POL.report(P, 'shot', { witnessed: false })).toBe(null);
        expect(P.level).toBe(0);
        expect(POL.report(P, 'assault').level).toBe(1);
        for (let i = 0; i < 30; i++) { POL.report(P, 'assault'); POL.tickPolice(P, STEP, { sees: true }); }
        expect(P.incident.kinds.assault).toBe(1);
        expect(P.level).toBe(1);
    });

    it('varje höjning har en orsak, taken håller och tid i jakt höjer aldrig nivån', () => {
        const P = POL.createPolice();
        POL.report(P, 'bump', { at: { x: 0, y: 0 } });
        expect(P.level).toBe(1);
        expect(P.reason).toBe('Lätt krock med en polisbil');
        POL.report(P, 'bump');   // en buckla till höjer inte (tak 1)
        expect(P.level).toBe(1);
        POL.report(P, 'hitPed', { at: { x: 0, y: 0 } });
        expect(P.level).toBe(2);
        expect(P.reason).toBe('Körde på en fotgängare');
        // Tio minuter jakt där de ser dig hela tiden: samma nivå
        for (let i = 0; i < 600; i++) POL.tickPolice(P, 1, { sees: true, pos: { x: 0, y: 0 } });
        expect(P.level).toBe(2);
        expect(P.phase).toBe('chase');
        // Grovt våld: 4, fortsatt grovt våld: 5, aldrig mer
        POL.report(P, 'shot');
        expect(P.level).toBe(4);
        for (let i = 0; i < 10; i++) { POL.tickPolice(P, 7, { sees: true }); POL.report(P, 'shot'); }
        expect(P.level).toBe(5);
        expect(P.reason).toBe('Fortsatt skottlossning');
    });

    it('skuld vid krock: vem rörde sig mot vem, gas och nosen mot målet', () => {
        const n = { x: 1, y: 0 };   // från spelaren mot den andra
        // Polisen kör in i en stillastående spelare
        expect(POL.judgeContact({ vx: 0, vy: 0, angle: 0 }, { vx: -200, vy: 0 }, n, { throttle: 0 }).fault).toBe(false);
        // Spelaren väjer undan (kör bort) och blir påkörd bakifrån
        expect(POL.judgeContact({ vx: -80, vy: 0, angle: Math.PI }, { vx: -250, vy: 0 }, n, { throttle: 1 }).fault).toBe(false);
        // Spelaren kör långsamt in i en stillastående polisbil: skyldig, men det är ingen ramning
        const slow = POL.judgeContact({ vx: 50, vy: 0, angle: 0 }, { vx: 0, vy: 0 }, n, { throttle: 0.4 });
        expect(slow.fault).toBe(true);
        expect(slow.deliberate).toBe(false);
        // Gas, fart och nosen mot polisen: medveten
        expect(POL.judgeContact({ vx: 160, vy: 0, angle: 0 }, { vx: 0, vy: 0 }, n, { throttle: 1 }).deliberate).toBe(true);
        // Kedjekrock: nyss knuffad av någon annan
        expect(POL.judgeContact({ vx: 160, vy: 0, angle: 0 }, { vx: 0, vy: 0 }, n, { throttle: 0, pushedT: 0.2 }).fault).toBe(false);
    });

    it('trafikstoppets besked: varning, bot eller samhällstjänst — aldrig fängelse', () => {
        const P = POL.createPolice();
        POL.report(P, 'bump');
        expect(POL.stopOutcome(P, 1000).warning).toBe(true);
        P.incident.copDamage = 30;                       // polisbilen fick en buckla värd att laga
        const o = POL.stopOutcome(P, 1000);
        expect(o.warning).toBe(false);
        expect(o.total).toBe(150 + 180);
        const broke = POL.stopOutcome(P, 100);
        expect(broke.paid).toBe(100);
        expect(broke.short).toBe(230);
        expect(POL.outcomeText(broke)).toContain('samhällstjänst');
    });

    it('sparning: en jakt blir en sökning där de såg dig sist, och skräp i sparfilen tvättas', () => {
        const P = POL.createPolice();
        POL.report(P, 'ram', { at: { x: 100, y: 200 } });
        POL.report(P, 'hitPed', { at: { x: 120, y: 210 } });
        const snap = JSON.parse(JSON.stringify(POL.policeSnapshot(P)));
        const R = POL.restorePolice(snap);
        expect(R.level).toBe(2);
        expect(R.phase).toBe('search');
        expect(R.lastSeen).toEqual({ x: 120, y: 210 });
        expect(R.searchT).toBe(POL.LEVELS[2].search);
        expect(R.incidents.length).toBe(P.incidents.length);
        const bad = POL.restorePolice({ level: 99, phase: 'fly', heat: -5, lastSeen: { x: 'a' }, incidents: 'nej', incident: { kinds: { hack: 9 } } });
        expect(bad.level).toBe(5);
        expect(bad.heat).toBe(0);
        expect(bad.lastSeen).toBe(null);
        expect(bad.incidents).toEqual([]);
        expect(bad.incident.kinds.hack).toBeUndefined();
        expect(POL.restorePolice(null).level).toBe(0);
    });

    it('HUD:ens status: stopp med nedräkning, jakt, sökning och avslut', () => {
        const P = POL.createPolice();
        POL.report(P, 'bump', { speed: 0 });
        let st = POL.policeStatus(P);
        expect(st.action).toBe('Polisen vill prata – stanna på en säker plats');
        expect(st.countdown).toBeCloseTo(POL.POLICE.stopWindow, 1);
        expect(st.reason).toBe('Lätt krock med en polisbil');
        POL.report(P, 'hitPed', { at: { x: 0, y: 0 } });
        expect(POL.policeStatus(P).action).toBe('JAGAR DIG');
        for (let i = 0; i < 4 * 60; i++) POL.tickPolice(P, STEP, { sees: false });
        st = POL.policeStatus(P);
        expect(st.phase).toBe('search');
        expect(st.action).toBe('SÖKER där du sågs senast');
        expect(st.countdown).toBeGreaterThan(15);
        for (let i = 0; i < 25 * 60; i++) POL.tickPolice(P, STEP, { sees: false });
        st = POL.policeStatus(P);
        expect(st.level).toBe(0);
        expect(P.lastEnd.why).toBe('lost');
        expect(P.lastEnd.text).toBe('Polisen gav upp sökningen');
        // Beskedet syns en stund i panelen efter avslut
        const Q = POL.createPolice();
        POL.report(Q, 'hitPed', { at: { x: 0, y: 0 } });
        POL.clearPolice(Q, 'Ny lack – polisen känner inte igen bilen');
        expect(POL.policeStatus(Q).action).toBe('Ny lack – polisen känner inte igen bilen');
    });
});

describe('Polisen: de obligatoriska testfallen', () => {
    // 1) Kör långsamt emot en polisbil en gång och stanna: liten reaktion, högst nivå 1,
    //    ingen fordonsklunga och ingen automatisk brand.
    it('1: en långsam krock och stanna → högst nivå 1, ingen klunga, ingen brand, varning', () => {
        const w = quietWorld(11);
        const car = playerCar(w);
        const cop = parkedCop(w, X0 + 62);
        let hit = false, maxL = 0, maxNear = 0, maxUnits = 0;
        run(w, 25, () => {
            if (!hit && w.police.level > 0) hit = true;
            return hit ? { ...IDLE, throttle: forwardSpeed(car) > 5 ? -1 : 0 } : cruise(car, 70, 0.5);
        }, w2 => { maxL = Math.max(maxL, w2.police.level); maxNear = Math.max(maxNear, near(w2)); maxUnits = Math.max(maxUnits, units(w2).length); });
        expect(hit).toBe(true);
        expect(maxL).toBe(1);
        expect(kinds(w, 'bump')).toBe(1);
        expect(maxUnits).toBeLessThanOrEqual(1);
        expect(maxNear).toBeLessThanOrEqual(2);
        expect(w.vehicles.some(v => v.wrecked || v.burnT > 0)).toBe(false);
        expect(car.hp).toBeGreaterThan(95);
        expect(cop.hp).toBeGreaterThan(160);
        // Stannade och samarbetade: varning, fri att åka, inget gripande
        expect(w.state).toBe('play');
        expect(w.police.level).toBe(0);
        expect(w.police.phase).toBe('calm');
        expect(w.police.lastEnd?.why).toBe('warning');
        expect(w.profile.money).toBe(1000);
        expect(units(w).length).toBe(0);
    });

    // 2) Låt en polis köra in i en stillastående spelare: inget automatiskt nytt spelarbrott.
    it('2: polisen kör in i en stillastående (eller väjande) spelare → inget brott', () => {
        const w = quietWorld(12);
        const car = playerCar(w);
        const cop = parkedCop(w, X0 + 130, ROAD_Y, Math.PI);
        cop.vx = -220;   // rullar rakt in i spelaren
        run(w, 3, { ...IDLE, handbrake: true });
        expect(Math.hypot(cop.x - car.x, cop.y - car.y)).toBeLessThan(60);   // de krockade
        expect(w.police.level).toBe(0);
        expect(w.police.incidents.length).toBe(0);
        expect(cop.lastHitBy).not.toBe('player');
        // Väjande: spelaren kör bort och blir påkörd bakifrån av en snabbare polisbil
        const w2 = quietWorld(13);
        const car2 = playerCar(w2, X0, ROAD_Y, Math.PI);
        const cop2 = parkedCop(w2, X0 + 150, ROAD_Y, Math.PI);
        car2.vx = -60; cop2.vx = -260;
        run(w2, 2, { ...IDLE, throttle: 0.3 });
        expect(w2.contacts.size).toBeGreaterThan(0);   // de har haft kontakt
        expect(w2.police.level).toBe(0);
        expect(w2.police.incidents.length).toBe(0);
    });

    // 3) Låt två bilar ligga i kontakt en stund: en sammanhängande incident, inte hundratals.
    it('3: tio sekunders kontakt (spelaren trycker på) → EN kontakt, EN incident, skada en gång', () => {
        const w = quietWorld(14);
        const car = playerCar(w);
        const cop = parkedCop(w, X0 + 60);
        let hp0 = null;
        run(w, 10, () => ({ ...IDLE, throttle: 1 }), w2 => { if (hp0 === null && w2.contacts.size) hp0 = car.hp; });
        const c = w.contacts.get(POL.pairKey(car, cop));
        expect(c).toBeTruthy();
        expect(c.n).toBe(1);                                   // en sammanhängande kontakt
        expect(kinds(w, 'bump') + kinds(w, 'crash')).toBe(1);   // en incident
        expect(kinds(w, 'ram')).toBe(0);                       // ingen separation = ingen ny ramning
        expect(w.police.incidents.length).toBeLessThanOrEqual(2);
        expect(w.police.level).toBeLessThanOrEqual(1);
        expect(car.hp).toBe(hp0);                              // ingen skada av överlappet bildruta för bildruta
        expect(cop.wrecked).toBe(false);
        // Fastklämd mellan två polisbilar som trycker på: inget spelarbrott alls
        const w2 = quietWorld(15);
        const car2 = playerCar(w2);
        const a = parkedCop(w2, X0 - 50), b = parkedCop(w2, X0 + 50, ROAD_Y, Math.PI);
        run(w2, 5, { ...IDLE, handbrake: true }, () => { a.vx = 90; b.vx = -90; });
        expect(w2.police.level).toBe(0);
        expect(w2.police.incidents.length).toBe(0);
        expect(car2.wrecked).toBe(false);
    });

    // 4) Separera fordonen och ramma upprepade gånger: nivån stiger med förklaring, inom taket.
    it('4: upprepade separata ramningar → nivån stiger med orsak, inom insatstaket', () => {
        // Inga patruller: en patrull som hinner fram bakom bilen när den backar blir en egen
        // kontakt mitt i serien (beror bara på hur fort den kör hit, inte på ramningarna)
        POL.POLICE.patrol = 0;
        const w = quietWorld(16);
        const car = playerCar(w);
        const cop = parkedCop(w, X0 + 70);
        const seen = [];
        let overCap = 0;
        // 3 s per varv: gasa rakt mot polisbilen, backa loss, vänta
        run(w, 12, t => {
            const ph = t % 3;
            return ph < 1.2 ? { ...IDLE, throttle: 1 } : ph < 2.3 ? { ...IDLE, throttle: -1 } : IDLE;
        }, w2 => {
            const P = w2.police;
            if (P.level && seen[seen.length - 1]?.level !== P.level) seen.push({ level: P.level, reason: P.reason });
            if (units(w2).length > POL.carCap(P.level)) overCap++;
        });
        expect(seen.map(s => s.level)).toEqual([1, 2, 3]);
        expect(seen[1].reason).toBe('Körde in i polisbilen igen');
        expect(seen[2].reason).toBe('Upprepad ramning med gas och styrning mot polisen');
        expect(w.police.level).toBe(3);   // taket för ramning
        expect(overCap).toBe(0);
        expect(kinds(w, 'ram')).toBeGreaterThanOrEqual(2);
        expect(cop.hp).toBeGreaterThan(0);
    });

    // 5) Ignorera en faktisk stoppbegäran: begränsad jakt, utan eskalering varje bildruta.
    it('5: strunta i stoppet → nivå 2 en gång, sedan ingen eskalering', () => {
        const w = quietWorld(17);
        const car = playerCar(w);
        parkedCop(w, X0 + 62);
        let hit = false, maxL = 0, at2 = null;
        run(w, 40, (t, w2) => {
            if (!hit && w2.police.level > 0) hit = true;
            if (!hit) return cruise(car, 70, 0.5);
            // Kör vidare längs vägen i lugn fart (håller sig i filen) i stället för att stanna
            return { ...cruise(car, 110, 0.6), steer: Math.max(-1, Math.min(1, (ROAD_Y - car.y) * 0.02 - angleDiff(0, car.angle) * 2)) };
        }, (w2, t) => { maxL = Math.max(maxL, w2.police.level); if (at2 === null && w2.police.level === 2) at2 = t; });
        expect(hit).toBe(true);
        expect(at2).toBeGreaterThan(POL.POLICE.stopWindow - 0.5);   // först när fönstret gått ut
        expect(at2).toBeLessThan(POL.POLICE.stopWindowMax + 1);
        expect(maxL).toBe(2);
        expect(kinds(w, 'ignoredStop')).toBe(1);
        expect(w.police.reason).toBe('Stannade inte när polisen ville prata');
        expect(w.police.incidents.filter(e => !e.kind.startsWith('end')).length).toBeLessThanOrEqual(3);
        expect(units(w).length).toBeLessThanOrEqual(2);
        expect(w.state).toBe('play');
    });

    // 6) Tappa kontakten: sökningen upphör, enheterna lämnar och samma gamla incident startar inte om.
    it('6: tappa kontakten → sökning, avslut, enheterna åker, en passerande snut startar inget', () => {
        POL.POLICE.patrol = 0;   // inga patruller som råkar hitta dig i det här testet
        const w = quietWorld(18);
        const car = playerCar(w);
        const cop = parkedCop(w, X0 - 90);
        initLaneAI(cop, 7, 3, 1, w.rnd);
        w.update(STEP, IDLE);
        w.crime('hitPed', { witnessed: true });
        const id = w.police.incident.id;
        run(w, 1);
        expect(w.police.phase).toBe('chase');
        expect(units(w).length).toBeGreaterThan(0);
        // Spelaren försvinner långt bort, utom synhåll, och håller sig undan
        car.x = 40 * TILE + 32; car.y = 23 * TILE + 32; w.player.x = car.x; w.player.y = car.y;
        const ls = { ...w.police.lastSeen };
        let searched = false, endT = null;
        run(w, 40, { ...IDLE, handbrake: true }, (w2, t) => {
            if (w2.police.phase === 'search') { searched = true; expect(w2.police.lastSeen).toEqual(ls); }
            if (endT === null && w2.police.level === 0) endT = t;
        });
        expect(searched).toBe(true);
        expect(endT).toBeGreaterThan(15);
        expect(endT).toBeLessThan(30);
        expect(w.police.lastEnd.why).toBe('lost');
        expect(units(w).length).toBe(0);
        expect(cops(w).every(v => !v.siren && ['patrol', 'leave'].includes(v.pol?.task))).toBe(true);
        // En polisbil kör förbi alldeles intill: den gamla incidenten startar inte om
        const passer = parkedCop(w, car.x + 120, car.y, Math.PI);
        passer.vx = -60;
        run(w, 5, { ...IDLE, handbrake: true });
        expect(w.police.level).toBe(0);
        expect(w.police.incident).toBe(null);
        // ...men en ny faktisk förseelse är en ny incident
        w.crime('hitPed', { witnessed: true });
        expect(w.police.level).toBe(2);
        expect(w.police.incident.id).toBe(id + 1);
    });

    // 7) Samma kontrollerade situation vid 30, 60 och 120 bilder/s: likvärdigt antal
    //    incidenter, förstärkningar och skada. Frame-loopen i index.js emuleras: en
    //    ackumulator med fasta steg på 1/60 s och kontrollerna lästa en gång per bildruta.
    it('7: 30, 60 och 120 bilder/s ger i huvudsak samma incidenter, förstärkningar och skada', () => {
        const scene = (fps) => {
            const w = quietWorld(19);
            const car = playerCar(w);
            const cop = parkedCop(w, X0 + 70);
            let acc = 0, t = 0, maxUnits = 0;
            const frame = 1 / fps;
            for (let f = 0; f < fps * 14; f++) {
                t += frame; acc += frame;
                const ph = t % 3.5;
                const input = t < 10.5 ? (ph < 1.2 ? { ...IDLE, throttle: 1 } : ph < 2.4 ? { ...IDLE, throttle: -1 } : IDLE) : { ...IDLE, throttle: -0.5 };
                let steps = 0;
                while (acc >= STEP - 1e-9 && steps < 5) { w.update(STEP, input); acc -= STEP; steps++; }
                w.events.length = 0;
                maxUnits = Math.max(maxUnits, units(w).length);
            }
            return { incidents: w.police.incidents.filter(e => !e.kind.startsWith('end')).length, level: w.police.level, maxUnits, carDmg: car.maxHp - car.hp, copDmg: cop.maxHp - cop.hp };
        };
        const r30 = scene(30), r60 = scene(60), r120 = scene(120);
        console.log(`[bildfrekvens] 30: ${JSON.stringify(r30)} · 60: ${JSON.stringify(r60)} · 120: ${JSON.stringify(r120)}`);
        for (const r of [r30, r120]) {
            expect(Math.abs(r.incidents - r60.incidents)).toBeLessThanOrEqual(1);
            expect(r.level).toBe(r60.level);
            expect(Math.abs(r.maxUnits - r60.maxUnits)).toBeLessThanOrEqual(1);
            expect(Math.abs(r.carDmg - r60.carDmg)).toBeLessThanOrEqual(Math.max(4, r60.carDmg * 0.25));
            expect(Math.abs(r.copDmg - r60.copDmg)).toBeLessThanOrEqual(Math.max(4, r60.copDmg * 0.25));
        }
        expect(r60.incidents).toBeGreaterThan(0);
        expect(r60.incidents).toBeLessThan(10);
    });

    // 8) Flera klienter: polisen simuleras lokalt hos den skyldiga spelaren. Andra klienter får
    //    bara nivån (stars) i positionen som värden skickar vidare — ingen dubbel insats hos dem.
    it('8: två klienter → bara den skyldigas klient äger incidenten, ingen dubblerad insats', () => {
        POL.POLICE.patrol = 0;
        const remotesA = new Map(), remotesB = new Map();
        const net = remotes => ({ online: true, remotes: () => remotes, taken: () => new Set(), request: () => true });
        const A = quietWorld(21, createPlayerState('kimit'));
        const B = quietWorld(22, createPlayerState('mehmet'));
        A.net = net(remotesA); B.net = net(remotesB);
        const carA = playerCar(A);
        parkedCop(A, X0 + 62);
        // B står alldeles bredvid samma polisbil (i sin egen stad) och ser A
        B.player.x = X0 + 30; B.player.y = ROAD_Y + 70;
        const relay = () => {
            // Som värden: varje klients position tvättas (sanitizePos) och skickas till den andra
            remotesB.set('kimit', { ..._sanitizePos(JSON.parse(JSON.stringify(A.netSnapshot()))), id: 'kimit', rx: A.player.x, ry: A.player.y });
            remotesA.set('mehmet', { ..._sanitizePos(JSON.parse(JSON.stringify(B.netSnapshot()))), id: 'mehmet', rx: B.player.x, ry: B.player.y });
        };
        let hit = false, maxRemoteStars = 0, maxBLevel = 0, maxBUnits = 0, maxAUnits = 0;
        const moneyB = B.profile.money;
        for (let i = 0; i < 60 * 25; i++) {
            if (!hit && A.police.level > 0) hit = true;
            A.update(STEP, hit ? { ...IDLE, throttle: forwardSpeed(carA) > 5 ? -1 : 0 } : cruise(carA, 70, 0.5));
            B.update(STEP, IDLE);
            A.events.length = 0; B.events.length = 0;
            if (i % 6 === 0) relay();
            maxRemoteStars = Math.max(maxRemoteStars, remotesB.get('kimit')?.stars || 0);
            maxBLevel = Math.max(maxBLevel, B.police.level);
            maxBUnits = Math.max(maxBUnits, units(B).length);
            maxAUnits = Math.max(maxAUnits, units(A).length);
        }
        relay();
        expect(hit).toBe(true);
        expect(maxRemoteStars).toBe(1);                // B såg A:s nivå (en gemensam incident, A:s)
        expect(remotesB.get('kimit').stars).toBe(0);   // ...och att den tog slut
        expect(maxBLevel).toBe(0);                     // B fick ingen egen insats
        expect(B.police.incidents.length).toBe(0);
        expect(maxBUnits).toBe(0);
        expect(maxAUnits).toBeLessThanOrEqual(1);      // A: en enhet för trafikstoppet
        expect(B.profile.money).toBe(moneyB);          // beskedet gällde bara A
        expect(A.police.lastEnd.why).toBe('warning');
        // Positionen bär bara nivån, inget annat polisläge
        expect(Object.keys(_sanitizePos(A.netSnapshot()))).not.toContain('police');
    });
});

describe('Polisen i världen: gripande, platser, sparning', () => {
    it('nivå 1–2: hinner de ikapp blir det bot, inte BUSTED; nivå 3: BUSTED', () => {
        const w = quietWorld(31);
        playerCar(w);
        const cop = parkedCop(w, X0 - 70);
        initLaneAI(cop, 7, 3, 1, w.rnd);
        w.profile.money = 5000;
        setStars(w.wanted, 2);
        run(w, 12, { ...IDLE, handbrake: true });
        expect(w.state).toBe('play');
        expect(w.police.level).toBe(0);
        expect(w.police.lastEnd.why).toBe('fine');
        expect(w.profile.money).toBe(5000 - POL.POLICE.fine[2]);
        const w3 = quietWorld(32);
        playerCar(w3);
        const c3 = parkedCop(w3, X0 - 70);
        initLaneAI(c3, 7, 3, 1, w3.rnd);
        setStars(w3.wanted, 3);
        run(w3, 12, { ...IDLE, handbrake: true });
        expect(w3.state).toBe('busted');
        expect(w3.profile.cityBusted).toEqual({ stars: 3 });
    });

    it('sågs du gå in är platsen känd: sökningen står still inne, och de väntar utanför', () => {
        POL.POLICE.patrol = 0;
        const w = quietWorld(33);
        const club = city.markers.stripclub, o = club.door;
        // Utanför dörren (åt gatan till) och en polisbil längre ut som ser dig
        w.player.x = o.x - DX[o.side] * 26; w.player.y = o.y - DY[o.side] * 26;
        const cop = parkedCop(w, o.x - DX[o.side] * 160, o.y - DY[o.side] * 160);
        expect(w.copSees()).toBe(true);
        w.crime('assault', { witnessed: true });
        w.crime('copAssault', { witnessed: true });   // nivå 3
        expect(w.police.level).toBe(3);
        expect(w.enterInterior('stripclub', club)).toBe(true);
        expect(w.police.known).toBeTruthy();
        const t0 = w.police.searchT;
        run(w, 20);
        expect(w.police.level).toBe(3);
        expect(w.police.searchT).toBe(t0);              // klockan står: de väntar utanför
        expect(POL.policeStatus(w.police).action).toBe('Väntar utanför – de såg dig gå in');
        w.exitInterior();
        expect(w.police.phase).toBe('chase');            // ut genom dörren: de ser dig direkt
        expect(cop.driver).toBe('cop');
    });

    it('personalen ringde polisen: de väntar utanför och vill prata när du kommer ut (ingen eskalering inne)', () => {
        const w = quietWorld(39);
        const club = city.markers.stripclub, o = club.door;
        w.player.x = o.x - DX[o.side] * 26; w.player.y = o.y - DY[o.side] * 26;
        expect(w.enterInterior('stripclub', club)).toBe(true);
        w.crime('brawlCall', { at: w.interior.door, known: true });
        expect(w.police.level).toBe(1);
        expect(w.police.phase).toBe('stop');
        run(w, 30);
        expect(w.police.level).toBe(1);
        expect(POL.policeStatus(w.police).action).toBe('Polisen väntar utanför – de vill prata');
        w.exitInterior();
        expect(w.police.known).toBe(null);
        expect(w.police.phase).toBe('stop');
        expect(w.police.stop.t).toBeGreaterThanOrEqual(POL.POLICE.stopWindow);
    });

    it('gick du in osedd kan tiden inne få sökningen att ta slut', () => {
        POL.POLICE.patrol = 0;
        const w = quietWorld(34);
        const club = city.markers.stripclub, o = club.door;
        w.player.x = o.x - DX[o.side] * 26; w.player.y = o.y - DY[o.side] * 26;
        setStars(w.wanted, 2);
        w.update(STEP, IDLE);
        expect(w.enterInterior('stripclub', club)).toBe(true);   // ingen snut i närheten såg det
        expect(w.police.known).toBe(null);
        run(w, 30);
        expect(w.police.level).toBe(0);
    });

    it('läget sparas i profilen: menyer, HEM och omladdning nollställer inget', () => {
        const profile = createPlayerState('kimit');
        const w = quietWorld(35, profile);
        playerCar(w);
        w.crime('hitPed', { witnessed: true });
        run(w, 2);
        expect(w.canGoHome()).toBe(false);               // HEM går inte mitt i en jakt
        expect(profile.cityPolice.level).toBe(2);
        // Omladdning: profilen går genom JSON (sparfilen) och en ny stad öppnas
        const saved = JSON.parse(JSON.stringify(profile));
        const w2 = quietWorld(36, saved);
        expect(w2.police.level).toBe(2);
        expect(w2.police.phase).toBe('search');           // de letar där de såg dig sist
        expect(w2.police.lastSeen).toEqual(profile.cityPolice.lastSeen);
        expect(stars(w2.wanted)).toBe(2);
        expect(w2.canGoHome()).toBe(false);
        // Sökningen tar slut: nu går det att åka hem, trycket finns kvar och avtar
        run(w2, 30);
        expect(w2.police.level).toBe(0);
        expect(w2.canGoHome()).toBe(true);
        expect(saved.cityPolice.heat).toBeGreaterThan(0);
        const h = w2.police.heat;
        run(w2, 30);
        expect(w2.police.heat).toBeLessThan(h);
    });

    it('en gripen eller död spelare får inga nya brott av kvarvarande kontakt', () => {
        const w = quietWorld(37);
        const car = playerCar(w);
        parkedCop(w, X0 + 62);
        w.wasted('test');
        run(w, 3, { ...IDLE, throttle: 1 });
        expect(w.police.incidents.length).toBe(0);
        expect(w.crime('shot')).toBe(null);
        expect(car.x).toBeGreaterThan(X0 - 1);
    });

    it('förstärkningar: högst en ny i taget, aldrig över taket, utom synhåll och inte framför bilen', () => {
        const w = quietWorld(38);
        const car = playerCar(w);
        car.vx = 200;
        w.update(STEP, IDLE);
        w.crime('copKill', { witnessed: true });   // nivå 4: fyra bilar
        const spawned = [], joined = [];
        const seen = new Set(), inUnit = new Set();
        run(w, 12, () => cruise(car, 200, 0.7), (w2, t) => {
            for (const v of cops(w2)) {
                if (!seen.has(v.id)) {
                    seen.add(v.id);
                    const dx = v.x - w2.player.x, dy = v.y - w2.player.y, d = Math.hypot(dx, dy);
                    spawned.push({ d, ahead: (dx * car.vx + dy * car.vy) / (d * Math.hypot(car.vx, car.vy) || 1) });
                }
                if (units(w2).includes(v) && !inUnit.has(v.id)) { inUnit.add(v.id); joined.push(t); }
            }
            expect(units(w2).length).toBeLessThanOrEqual(POL.carCap(w2.police.level));
            expect(cops(w2).length).toBeLessThanOrEqual(POL.POLICE.totalCars);
        });
        expect(spawned.length).toBeGreaterThan(1);
        for (const s of spawned) {
            expect(s.d).toBeGreaterThanOrEqual(495);            // syns inte dyka upp
            if (s.d < 1400) expect(s.ahead).toBeLessThan(0.36); // inte framför bilen
        }
        expect(joined.length).toBeGreaterThan(1);
        for (let i = 1; i < joined.length; i++) expect(joined[i] - joined[i - 1]).toBeGreaterThanOrEqual(POL.POLICE.reinforceGap[4] - 0.3);
    });
});

// ── Rättningar efter granskningen av etapp 0 ──
describe('Polisen: rättningar efter granskningen', () => {
    // Kamerabyte ändrar BARA presentationen (kontraktet avsnitt 1). index.js sätter viewExtra/viewDense
    // i 3D (följkamera 800/1,45). Förut räknade dispatchern patruller inom fasta 1800 px men skapade dem
    // på far(800..1400) = 1600–2200 px: i följkamera fylldes stan med 8 polisbilar och insatsen fick inga enheter.
    it('kameraläget (viewExtra 0 eller 800) ändrar inte antalet polisbilar eller hur fort insatsen kommer', () => {
        const scene = (extra, dense, seed) => {
            const w = new World(city, createPlayerState('kimit'), { round: 2, rnd: mulberry32(seed) });
            w.viewExtra = extra; w.viewDense = dense;
            w.vehicles = []; w.peds = [];
            // Den riktiga manageSpawns körs; trafik och folk plockas bort efteråt (bara polisen mäts)
            const strip = w2 => { w2.vehicles = w2.vehicles.filter(v => v.driver === 'cop'); w2.peds = w2.peds.filter(o => o.cop); };
            let sum = 0, n = 0, max = 0;
            run(w, 40, IDLE, (w2, t) => { strip(w2); if (Math.round(t / STEP) % 30 === 0) { const c = cops(w2).length; sum += c; n++; max = Math.max(max, c); } });
            w.crime('hitPed', { witnessed: true });   // nivå 2: jakt
            let nearT = null;
            run(w, 12, IDLE, (w2, t) => { strip(w2); if (nearT === null && units(w2).some(v => Math.hypot(v.x - w2.player.x, v.y - w2.player.y) < 300)) nearT = t; });
            return { avg: sum / n, max, nearT };
        };
        for (const seed of [1, 2]) {
            const top = scene(0, 1, seed), chase = scene(800, 1.45, seed);
            expect(top.avg).toBeLessThan(POL.patrolTarget(POL.createPolice()) + 1);
            expect(chase.avg).toBeLessThan(POL.patrolTarget(POL.createPolice()) + 1);
            expect(chase.max).toBeLessThan(POL.POLICE.totalCars);
            expect(top.nearT).not.toBe(null);
            expect(chase.nearT).not.toBe(null);    // insatsen får sina enheter även i följkamera
        }
    });

    // physics.js räknar bilarna som i kontakt redan inom 2 px. Förut blev det steget (utan smäll)
    // kontaktens början: en hård krock bedömdes med smällen 0 och blev "Lätt krock" + varning,
    // beroende på var bilen råkade starta.
    it('samma hårda krock ger samma händelse och samma bot oavsett startpunkt (0–5 px)', () => {
        const out = [];
        for (const off of [0, 1, 2, 3, 4, 5]) {
            const w = quietWorld(9);
            const car = playerCar(w, X0 + off);
            car.vx = 320;
            const cop = parkedCop(w, X0 + 260);
            const hp0 = cop.hp;
            for (let i = 0; i < 72 && !w.police.incidents.length; i++) { w.update(STEP, { ...IDLE, throttle: 1 }); w.events.length = 0; }
            run(w, 0.5);
            const o = POL.stopOutcome(w.police, 100000);
            out.push({ kinds: w.police.incidents.map(e => e.kind).join(','), level: w.police.level, logged: Math.round(w.police.incident?.copDamage || 0), dmg: Math.round(hp0 - cop.hp), total: o.total });
        }
        for (const r of out) {
            expect(r.kinds).toBe('crash');
            expect(r.level).toBe(2);
            expect(r.logged).toBe(r.dmg);           // polisbilens skada kommer med i reparationen
            expect(r.total).toBe(out[0].total);
        }
        expect(out[0].total).toBeGreaterThan(POL.POLICE.fine[2]);
    });

    it('en explosion ger inte spelaren skulden för en bil hen rörde för en minut sedan', () => {
        const w = quietWorld(5);
        w.player.x = X0 - 400; w.player.y = ROAD_Y;   // står en bit bort och gör ingenting
        const A = parkedCop(w, X0), B = parkedCop(w, X0 + 60);
        w.time = 100; w.damageVehicle(A, 5, 'player');   // spelaren buckade till A
        w.time = 160;
        B.hp = 30;
        w.damageVehicle(A, 999, null);                   // A kvaddas av något annat en minut senare
        run(w, 5);
        expect(A.exploded).toBe(true);
        expect(B.wrecked).toBe(true);                     // explosionen tog B
        expect(B.lastHitBy).not.toBe('player');
        expect(w.police.incidents.length).toBe(0);
        expect(w.police.level).toBe(0);
    });

    it('en trafikolycka räknas en gång: vraket som brinner ut ger inte ett nytt "Sprängde en bil"', () => {
        const w = quietWorld(3);
        const car = playerCar(w);
        const civ = createVehicle('volvo', X0 + 300, ROAD_Y, 0);
        civ.driver = 'traffic'; civ.hp = 15;
        w.vehicles.push(civ);
        parkedCop(w, X0 - 250);                           // en polisbil ser det
        let hit = false;
        run(w, 12, () => {
            if (!hit && Math.abs(civ.x - car.x) < 50) hit = true;
            return { ...IDLE, throttle: !hit && forwardSpeed(car) < 300 ? 1 : 0, handbrake: hit };
        });
        expect(civ.exploded).toBe(true);
        expect(kinds(w, 'wreck')).toBe(1);
        expect(kinds(w, 'explosion')).toBe(0);
        expect(w.police.level).toBe(2);                   // inte nivå 3 (gripande) för samma olycka
    });

    it('omladdning inne på ett känt ställe: ute vid HQ visar HUD:en nedräkningen, inte "väntar utanför"', () => {
        const club = city.markers.stripclub, o = club.door;
        // Stopp: personalen ringde medan man var inne
        const prof = createPlayerState('kimit');
        const w = quietWorld(39, prof);
        w.player.x = o.x - DX[o.side] * 26; w.player.y = o.y - DY[o.side] * 26;
        expect(w.enterInterior('stripclub', club)).toBe(true);
        w.crime('brawlCall', { at: w.interior.door, known: true });
        run(w, 3);
        const w2 = quietWorld(40, JSON.parse(JSON.stringify(prof)));
        expect(w2.interior).toBeFalsy();
        expect(w2.police.known).toBe(null);
        let st = POL.policeStatus(w2.police);
        expect(st.phase).toBe('stop');
        expect(st.action).toBe('Polisen vill prata – stanna på en säker plats');
        expect(st.countdown).toBeGreaterThanOrEqual(POL.POLICE.stopWindow - 0.1);
        // Sökning: de såg dig gå in
        POL.POLICE.patrol = 0;
        const prof3 = createPlayerState('kimit');
        const w3 = quietWorld(41, prof3);
        w3.player.x = o.x - DX[o.side] * 26; w3.player.y = o.y - DY[o.side] * 26;
        parkedCop(w3, o.x - DX[o.side] * 160, o.y - DY[o.side] * 160);
        w3.crime('copAssault', { witnessed: true });
        expect(w3.enterInterior('stripclub', club)).toBe(true);
        expect(w3.police.known).toBeTruthy();
        run(w3, 2);
        const w4 = quietWorld(42, JSON.parse(JSON.stringify(prof3)));
        st = POL.policeStatus(w4.police);
        expect(st.phase).toBe('search');
        expect(st.action).toBe('SÖKER där du sågs senast');
        expect(st.countdown).toBeGreaterThan(0);
    });

    it('taket för snutar till fots håller även när polisbilar kvaddas och förarna kastas ut', () => {
        const w = quietWorld(5);
        w.player.x = X0; w.player.y = ROAD_Y + 40;
        setStars(w.wanted, 3, 'test');
        for (let i = 0; i < 6; i++) {
            const v = parkedCop(w, X0 + 120 + i * 70);
            v.pol = { task: 'chase', role: 'tail', side: 1 };
            w.damageVehicle(v, 999, null);
        }
        expect(w.peds.filter(o => o.cop).length).toBe(6);              // alla sex förarna kom ut
        expect(w.footCops()).toBe(POL.footCap(3));                     // men bara taket anfaller
    });
});

// ── Standardiserad flyktsimulering ──
// Försök med startbilen (Morsans Volvo) från fem fasta platser i stan, två frön per plats. Föraren är
// ett enkelt skript som en ny spelare: följer vägarna mot ett mål bort från polisen, bromsar inför
// svängar, styr förbi en polisbil rakt framför och backar loss om den fastnar. Ingen trafik eller folk,
// men stan har levt 15 s innan (patrullerna finns redan runt spelaren när det händer).
// Lyckat = polisen ger upp (nivå 0) inom 120 s utan att man blivit gripen eller fått bot.
// Kalibrering (samma förare, 12 frön × 5 platser = 60 försök per nivå): nivå 1 51/60, nivå 2 50/60 (40 inom
// 60 s, sökningen slut ~20 s efter tappad kontakt), nivå 3 0/60, nivå 4 0/60. Med trafik och folk (30 försök):
// nivå 2 18/30, nivå 4 0/30. Trösklarna nedan tål små ändringar i fysiken (prövat med ändrat grepp och styrning).
const road = (x, y) => tileAt(city, x, y) === T.ROAD;
function roadPath(from, to) {
    const W = city.w, prev = new Int32Array(W * city.h).fill(-2), q = [from[1] * W + from[0]];
    prev[q[0]] = -1;
    for (let h = 0; h < q.length; h++) {
        const i = q[h], x = i % W, y = (i / W) | 0;
        if (x === to[0] && y === to[1]) break;
        for (let d = 0; d < 4; d++) {
            const nx = x + DX[d], ny = y + DY[d], ni = ny * W + nx;
            if (road(nx, ny) && prev[ni] === -2) { prev[ni] = i; q.push(ni); }
        }
    }
    const ti = to[1] * W + to[0];
    if (prev[ti] === -2) return null;
    const out = [];
    for (let i = ti; i !== -1; i = prev[i]) out.push([i % W, (i / W) | 0]);
    return out.reverse();
}
function fleeDriver(w, car, rnd) {
    const D = { path: null, k: 0, stuck: 0, rev: 0, revSteer: 1 };
    const newGoal = () => {
        let best = null, bs = -1;
        for (let n = 0; n < 12; n++) {
            const [tx, ty] = city.laneTiles[Math.floor(rnd() * city.laneTiles.length)];
            const dMe = Math.hypot(tx * TILE - car.x, ty * TILE - car.y);
            if (dMe < 900 || dMe > 2200) continue;
            const dCop = Math.min(1e9, ...cops(w).map(c => Math.hypot(tx * TILE - c.x, ty * TILE - c.y)));
            if (dCop > bs) { bs = dCop; best = [tx, ty]; }
        }
        let cur = [Math.floor(car.x / TILE), Math.floor(car.y / TILE)];
        if (!road(...cur)) {
            let bd = 9;
            for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (road(cur[0] + dx, cur[1] + dy) && Math.abs(dx) + Math.abs(dy) < bd) { bd = Math.abs(dx) + Math.abs(dy); cur = [cur[0] + dx, cur[1] + dy]; }
        }
        D.path = best && road(...cur) ? roadPath(cur, best) : null;
        D.k = 0;
    };
    return () => {
        if (D.rev > 0) { D.rev -= STEP; if (D.rev <= 0) newGoal(); return { ...IDLE, throttle: -1, steer: D.revSteer }; }
        D.stuck = Math.hypot(car.vx, car.vy) < 40 ? D.stuck + STEP : 0;
        if (D.stuck > 0.6) { D.stuck = 0; D.rev = 0.9; D.revSteer = rnd() < 0.5 ? -1 : 1; return { ...IDLE, throttle: -1, steer: D.revSteer }; }
        if (!D.path || D.k >= D.path.length - 2) newGoal();
        if (!D.path) return { ...IDLE, throttle: 0.5 };
        const cx = Math.floor(car.x / TILE), cy = Math.floor(car.y / TILE);
        for (let j = D.k; j < Math.min(D.path.length, D.k + 6); j++) if (D.path[j][0] === cx && D.path[j][1] === cy) D.k = j;
        const look = D.path[Math.min(D.path.length - 1, D.k + 2)];
        let diff = angleDiff(car.angle, Math.atan2(look[1] * TILE + 32 - car.y, look[0] * TILE + 32 - car.x));
        const fx = Math.cos(car.angle), fy = Math.sin(car.angle);
        for (const c of cops(w)) {
            const dx = c.x - car.x, dy = c.y - car.y, along = dx * fx + dy * fy, side = -dx * fy + dy * fx;
            if (along > 0 && along < 140 && Math.abs(side) < 30) { diff += side > 0 ? -0.6 : 0.6; break; }
        }
        let turn = false;
        for (let j = D.k + 1; j < Math.min(D.path.length - 1, D.k + 4); j++) {
            const a = D.path[j - 1], b = D.path[j], c = D.path[j + 1];
            if (b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1]) { turn = true; break; }
        }
        const fwd = forwardSpeed(car), target = Math.abs(diff) > 0.5 ? 130 : turn ? 190 : 345;
        return { ...IDLE, throttle: fwd < target - 10 ? 1 : fwd > target + 25 ? -1 : 0, steer: Math.max(-1, Math.min(1, diff * 2.8)) };
    };
}
const START_POINTS = [[10, 3], [24, 13], [44, 12], [30, 34], [12, 46]];
const STARTS = START_POINTS.map(([px, py]) => {
    let best = null;
    for (const [tx, ty] of city.laneTiles) {
        const m = laneDirs(city, tx, ty);
        for (let d = 0; d < 4; d++) {
            if (!(m & (1 << d)) || !road(tx + DX[d], ty + DY[d]) || !road(tx + 2 * DX[d], ty + 2 * DY[d])) continue;
            const s = Math.hypot(tx - px, ty - py);
            if (!best || s < best.s) best = { s, v: [tx, ty, d] };
        }
    }
    return best.v;
});
function escapeAttempt(i, kind, k = 0) {
    const w = quietWorld(100 + i + k * 1000);
    const [tx, ty, dir] = STARTS[i];
    const car = playerCar(w, tx * TILE + 32, ty * TILE + 32, DIR_ANGLE[dir]);
    car.spec.name = 'Morsans Volvo';
    // Stan lever en stund först: dispatcherns patruller finns runt spelaren
    for (let n = 0; n < 15 * 60; n++) { car.vx = car.vy = 0; w.update(STEP, { ...IDLE, handbrake: true }); w.events.length = 0; }
    car.vx = Math.cos(car.angle) * 150; car.vy = Math.sin(car.angle) * 150;
    // En polisbil 110 px bakom såg det hända
    const cop = createVehicle('police', car.x - Math.cos(car.angle) * 110, car.y - Math.sin(car.angle) * 110, car.angle);
    cop.driver = 'cop'; initLaneAI(cop, tx - DX[dir], ty - DY[dir], dir, w.rnd); cop.vx = car.vx; cop.vy = car.vy;
    w.vehicles.push(cop);
    const drive = fleeDriver(w, car, mulberry32(7 + i + k * 31));
    w.update(STEP, IDLE);
    w.crime(kind, { witnessed: true });
    const level = w.police.level;
    let t = 0, maxUnits = 0, end = 'tid slut';
    for (; t < 120; t += STEP) {
        w.update(STEP, drive());
        w.events.length = 0;
        maxUnits = Math.max(maxUnits, units(w).length);
        if (w.state !== 'play') { end = w.state; break; }
        if (w.police.level === 0) { end = w.police.ended?.why || 'slut'; break; }
    }
    return { level, escaped: end === 'lost', end, t: Math.round(t), maxUnits };
}

describe('Polisen: standardiserad flykt med startbilen', () => {
    it('låg efterlysning går att undkomma i de flesta försök inom ungefär en minut; grovt våld ger tydligt större motstånd', () => {
        const runs = kind => [0, 1].flatMap(k => [0, 1, 2, 3, 4].map(i => escapeAttempt(i, kind, k)));
        const low = runs('hitPed');    // nivå 2: Efterlysning
        const high = runs('copKill');  // nivå 4: Väpnat hot
        const okLow = low.filter(r => r.escaped).length, okHigh = high.filter(r => r.escaped).length;
        const fastLow = low.filter(r => r.escaped && r.t <= 70).length;
        console.log(`[flykt] nivå 2: ${okLow}/${low.length} undkom (${fastLow} inom 70 s) ${JSON.stringify(low)}`);
        console.log(`[flykt] nivå 4: ${okHigh}/${high.length} undkom ${JSON.stringify(high)}`);
        expect(low.every(r => r.level === 2)).toBe(true);
        expect(high.every(r => r.level === 4)).toBe(true);
        expect(okLow).toBeGreaterThanOrEqual(6);        // majoriteten (uppmätt 50/60)
        expect(fastLow).toBeGreaterThanOrEqual(5);      // ...och oftast inom ungefär en minut
        expect(okHigh).toBeLessThanOrEqual(2);          // nivå 4 förblir svårt (uppmätt 0/60)
        const avg = a => a.reduce((s, r) => s + r.maxUnits, 0) / a.length;
        expect(avg(high)).toBeGreaterThan(avg(low));
        for (const r of low) expect(r.maxUnits).toBeLessThanOrEqual(POL.carCap(3));   // aldrig en vägg av bilar
    });
});
