import { describe, it, expect, beforeEach } from 'vitest';
import {
    gameState, createPlayerState, normalizePlayer, saveGame, loadGame,
    formatNum, mergeRemoteState, jailPlayer, isMyTurn, canAct, resetGameState
} from '../src/game/state.js';
import { escapeHtml } from '../src/utils/html.js';

function memoryStorage() {
    const m = new Map();
    return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k),
        clear: () => m.clear()
    };
}

beforeEach(() => {
    globalThis.localStorage = memoryStorage();
    resetGameState();
});

describe('formatNum', () => {
    it('formats numbers with Swedish grouping', () => {
        expect(formatNum(1234567).replace(/\s/g, ' ')).toBe('1 234 567');
    });
    it('never throws on garbage', () => {
        expect(formatNum(undefined)).toBe('0');
        expect(formatNum(NaN)).toBe('0');
        expect(formatNum(null)).toBe('0');
    });
});

describe('escapeHtml', () => {
    it('escapes markup characters', () => {
        expect(escapeHtml('<img src=x onerror="a()">&\'')).toBe('&lt;img src=x onerror=&quot;a()&quot;&gt;&amp;&#39;');
    });
    it('handles non-strings', () => {
        expect(escapeHtml(undefined)).toBe('');
        expect(escapeHtml(42)).toBe('42');
    });
});

describe('normalizePlayer', () => {
    it('fills in fields that old saves lack', () => {
        const old = { charKey: 'mehmet', money: 5000, rep: 3, owned: ['kebab'], levels: { kebab: 2 } };
        const p = normalizePlayer(old);
        expect(p.money).toBe(5000);
        expect(p.char.name).toBe('Mehmet');
        expect(p.respect).toEqual({ kebab: 0, orden: 0, taco: 0 });
        expect(p.cars).toEqual([]);
        expect(p.jailRecord).toEqual([]);
        expect(p.missionsThisRound).toBe(0);
    });
    it('repairs broken numeric fields', () => {
        const p = normalizePlayer({ charKey: 'juan', money: 'abc', rep: null });
        expect(p.money).toBe(0);
        expect(p.rep).toBe(0);
    });
});

describe('save / load', () => {
    it('saves to the account slot from gameState.accountKey', () => {
        gameState.players = [createPlayerState('kimit')];
        gameState.accountKey = 'kimit';
        saveGame();
        expect(localStorage.getItem('empire_save_kimit')).toBeTruthy();
        expect(localStorage.getItem('empire_hustle_save')).toBeNull();
    });
    it('round-trips and migrates players', () => {
        localStorage.setItem('empire_save_juan', JSON.stringify({
            players: [{ charKey: 'juan', money: 777, owned: [], levels: {} }], currentPlayerIdx: 0, round: 4
        }));
        expect(loadGame('juan')).toBe(true);
        expect(gameState.round).toBe(4);
        expect(gameState.players[0].money).toBe(777);
        expect(gameState.players[0].char.name).toBe('Juan');
        expect(gameState.players[0].respect.taco).toBe(0);
    });
    it('rejects corrupt saves without touching state', () => {
        gameState.round = 9;
        localStorage.setItem('empire_hustle_save', '{not json');
        expect(loadGame()).toBe(false);
        localStorage.setItem('empire_hustle_save', JSON.stringify({ players: [] }));
        expect(loadGame()).toBe(false);
        expect(gameState.round).toBe(9);
    });
    it('does not resume a finished game', () => {
        localStorage.setItem('empire_save_kimit', JSON.stringify({
            players: [{ charKey: 'kimit', money: 1200000 }], gameOver: true
        }));
        expect(loadGame('kimit')).toBe(false);
        expect(localStorage.getItem('empire_save_kimit')).toBeNull();
    });
    it('clamps a bad currentPlayerIdx', () => {
        localStorage.setItem('empire_hustle_save', JSON.stringify({
            players: [{ charKey: 'kimit' }], currentPlayerIdx: 7
        }));
        loadGame();
        expect(gameState.currentPlayerIdx).toBe(0);
    });
});

describe('mergeRemoteState', () => {
    it('keeps local-only settings', () => {
        gameState.sfxMuted = true;
        gameState.musicMuted = true;
        gameState.myCharKey = 'mehmet';
        gameState.accountKey = 'mehmet';
        mergeRemoteState({
            sfxMuted: false, musicMuted: false, myCharKey: 'kimit', accountKey: 'kimit',
            round: 3, players: [{ charKey: 'kimit', money: 10 }, { charKey: 'mehmet', money: 20 }]
        });
        expect(gameState.sfxMuted).toBe(true);
        expect(gameState.musicMuted).toBe(true);
        expect(gameState.myCharKey).toBe('mehmet');
        expect(gameState.accountKey).toBe('mehmet');
        expect(gameState.round).toBe(3);
        expect(gameState.players[1].char.name).toBe('Mehmet');
    });
    it('never overwrites my own player during my online turn (e.g. while I am in the city)', () => {
        const me = createPlayerState('kimit');
        me.money = 6000; me.missionsThisRound = 3;
        gameState.isOnline = true;
        gameState.myCharKey = 'kimit';
        gameState.players = [me, createPlayerState('juan')];
        gameState.currentPlayerIdx = 0;
        mergeRemoteState({ currentPlayerIdx: 0, players: [{ charKey: 'kimit', money: 1000, missionsThisRound: 0 }, { charKey: 'juan', money: 5 }, { charKey: 'mehmet' }] });
        expect(gameState.players[0]).toBe(me);
        expect(me.money).toBe(6000);
        expect(me.missionsThisRound).toBe(3);
        expect(gameState.players[1].money).toBe(5);
        expect(gameState.players).toHaveLength(3);
    });
    it('updates existing player objects in place', () => {
        const me = createPlayerState('kimit');
        gameState.players = [me];
        mergeRemoteState({ players: [{ charKey: 'kimit', money: 4242 }, { charKey: 'juan', money: 1 }] });
        expect(gameState.players[0]).toBe(me);
        expect(me.money).toBe(4242);
        expect(gameState.players[1].charKey).toBe('juan');
    });
});

describe('turn ownership', () => {
    it('everyone can act offline', () => {
        gameState.players = [createPlayerState('kimit'), createPlayerState('juan')];
        gameState.currentPlayerIdx = 1;
        expect(isMyTurn()).toBe(true);
    });
    it('online you can only act on your own turn', () => {
        gameState.isOnline = true;
        gameState.myCharKey = 'kimit';
        gameState.players = [createPlayerState('kimit'), createPlayerState('juan')];
        gameState.currentPlayerIdx = 1;
        expect(isMyTurn()).toBe(false);
        gameState.currentPlayerIdx = 0;
        expect(isMyTurn()).toBe(true);
    });
    it('nobody acts while the AI thinks or after game over', () => {
        gameState.players = [createPlayerState('kimit')];
        gameState.aiThinking = true;
        expect(canAct()).toBe(false);
        gameState.aiThinking = false;
        gameState.gameOver = true;
        expect(canAct()).toBe(false);
    });
});

describe('jailPlayer', () => {
    it('sets a fixed bail once', () => {
        const p = createPlayerState('kimit');
        jailPlayer(p, 'Test', 2);
        expect(p.inJail).toBe(true);
        expect(p.jailRoundsLeft).toBe(2);
        expect(p.jailRecord).toHaveLength(1);
        expect(p.bail).toBeGreaterThanOrEqual(500);
        expect(p.bail).toBeLessThan(1500);
    });
});
