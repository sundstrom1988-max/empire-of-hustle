import { describe, it, expect } from 'vitest';
import { Hud } from '../src/city/hud.js';
import { World } from '../src/city/world.js';
import { generateCity } from '../src/city/map.js';
import { mulberry32 } from '../src/city/rng.js';
import { createPlayerState } from '../src/game/state.js';
import { createVehicle } from '../src/city/vehicles.js';

const city = generateCity(1337);

// En 2D-kontext som sväljer alla anrop — vi vill bara veta att HUD:en inte kastar
function fakeCtx() {
    const noop = () => { };
    const gradient = { addColorStop: noop };
    return new Proxy({}, {
        get(target, key) {
            if (key in target) return target[key];
            if (key === 'measureText') return t => ({ width: String(t).length * 8 });
            if (key === 'createRadialGradient' || key === 'createLinearGradient') return () => gradient;
            return noop;
        },
        set(target, key, value) { target[key] = value; return true; }
    });
}

function fakeRenderer(world, w = 1280, h = 800) {
    return { w, h, dpr: 1, worldToScreen: (x, y) => ({ x: x - world.player.x + w / 2, y: y - world.player.y + h / 2 }) };
}

function makeWorld() {
    const profile = createPlayerState('kimit');
    profile.weapons = ['pistol']; profile.ammo = { pistol: 3 }; profile.weapon = 'pistol';
    return new World(city, profile, { round: 2, rnd: mulberry32(5) });
}

describe('HUD', () => {
    it('ritar alla lägen på dator och mobil utan att krascha', () => {
        const w = makeWorld();
        const hud = new Hud();
        hud.onEvent({ type: 'big', text: 'TRIPPEL!', color: '#f472b6', sub: '3 i rad!' });
        hud.onEvent({ type: 'district', id: 'orten', own: false, hostile: true });
        hud.onEvent({ type: 'radio', name: 'HUSTLE FM', tag: 'Trap' });
        hud.onEvent({ type: 'msg', text: 'Ett meddelande som är långt nog för att brytas över flera rader i personsökaren' });
        const views = [[1280, 800, false], [390, 844, true]];
        const states = [
            () => { },
            () => { w.mission = { title: 'Leverans', target: { x: w.player.x + 3000, y: w.player.y + 2000, label: 'Mål' }, timeLeft: 10, timeLimit: 60 }; },
            () => {
                const car = createVehicle('rolls', w.player.x, w.player.y, 0);
                w.vehicles.push(car); car.driver = 'player'; w.player.vehicle = car;
                w.date = { name: 'Moa', mood: 30, dest: { x: w.player.x - 2500, y: w.player.y + 900 }, vehicle: car, hpLast: car.hp, t: 5, limit: 90 };
                w.player.nitro = 3;
            },
            () => { w.fade = { t: 1, dur: 3.2, text: '🌙 Några timmar senare...', sub: 'Ring mig' }; w.player.hurtT = 0.2; },
            () => { w.hint = 'R — Råna · SPACE — Slå'; w.state = 'wasted'; w.stateT = 1; }
        ];
        for (const setup of states) {
            setup();
            for (const [W, H, touch] of views) {
                expect(() => hud.draw(fakeCtx(), w, fakeRenderer(w, W, H), { touch })).not.toThrow();
            }
            hud.update(0.5);
        }
    });
});
