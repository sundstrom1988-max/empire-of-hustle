import { describe, it, expect, beforeAll } from 'vitest';

// ═══════════════════════════════════════════
//  BUSTED + omladdning (masterprompt avsnitt 21: spara och återuppta straffstatus).
//  p.cityBusted sparas vid pagehide under BUSTED-skärmen. Förut verkställdes gripandet
//  först nästa gång man åkte till stan: man kunde spela vidare i Imperium utan häkte,
//  böter eller beslag. Nu verkställer main.js det direkt efter loadGame (applyPendingBust).
//  Online: en AI-tur fastnade när värden hade stan öppen (endTurn(true) stoppades av spärren
//  "Åk hem från stan först!", som bara ska gälla den som själv är i stan).
// ═══════════════════════════════════════════

let S, ST, CORE;
beforeAll(async () => {
    // Minsta möjliga DOM: stan.js uppdaterar HUD och toasts, inget av det ska synas här
    globalThis.window ??= { addEventListener() { } };
    globalThis.document ??= { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [], addEventListener() { }, hidden: false };
    const store = new Map();
    globalThis.localStorage ??= { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) };
    ST = await import('../src/game/state.js');
    S = await import('../src/features/stan.js');
    CORE = await import('../src/game/core.js');
});

describe('BUSTED före omladdning', () => {
    it('gripandet verkställs när sparfilen laddas, även om det är en AI:s tur', () => {
        const { gameState, createPlayerState, resetGameState } = ST;
        resetGameState();
        const me = createPlayerState('kimit');
        const ai = createPlayerState('mehmet');
        ai.isAI = true;
        Object.assign(gameState, { players: [me, ai], currentPlayerIdx: 1, isOnline: false, musicMuted: true, round: 4 });
        me.money = 10000;
        me.weapons = ['pistol']; me.weapon = 'pistol'; me.ammo = { pistol: 12 };
        me.cityBusted = { stars: 3 };
        expect(S.applyPendingBust()).toBe(true);
        expect(me.inJail).toBe(true);
        expect(me.money).toBe(8500);                 // 15 % av saldot vid gripandet
        expect(me.weapons).toEqual([]);              // beslag
        expect(me.weapon).toBe('fists');
        expect(me.cityBusted).toBeUndefined();
        expect(ai.inJail).toBeFalsy();
        // En gång: inget dubbelt straff om den körs igen
        expect(S.applyPendingBust()).toBe(false);
        expect(me.money).toBe(8500);
    });

    it('utan väntande gripande händer ingenting', () => {
        const { gameState, createPlayerState, resetGameState } = ST;
        resetGameState();
        const me = createPlayerState('kimit');
        Object.assign(gameState, { players: [me], currentPlayerIdx: 0, isOnline: false, musicMuted: true });
        me.money = 5000;
        expect(S.applyPendingBust()).toBe(false);
        expect(me.inJail).toBeFalsy();
        expect(me.money).toBe(5000);
    });
});

describe('AI-tur medan stan är öppen', () => {
    it('AI:n avslutar sin tur även när stan är öppen; spelaren själv måste åka hem först', () => {
        const { gameState, createPlayerState, resetGameState } = ST;
        resetGameState();
        const me = createPlayerState('kimit');
        const ai = createPlayerState('mehmet');
        ai.isAI = true;
        Object.assign(gameState, { players: [me, ai], currentPlayerIdx: 1, isOnline: false, musicMuted: true, round: 3 });
        globalThis.window.city = { isOpen: () => true };   // värden är ute i stan
        try {
            CORE.endTurn(true);                            // AI:n är klar med sitt drag
            expect(gameState.currentPlayerIdx).toBe(0);    // turen gick vidare (förut: stod still)
            expect(gameState.round).toBe(4);
            CORE.endTurn(false);                           // spelaren försöker avsluta inifrån stan
            expect(gameState.currentPlayerIdx).toBe(0);    // spärren gäller fortfarande
        } finally {
            delete globalThis.window.city;
        }
    });
});
