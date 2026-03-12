import { CHARACTERS } from '../data/gameData.js';

// ── Game State ──
export const gameState = {
    players: [],
    currentPlayerIdx: 0,
    round: 1,
    mode: 'single',
    numPlayers: 1,
    maxRollsPerRound: 2,
    maxPitchesPerRound: 2,
    musicMuted: false,
    sfxMuted: false,
    winAmount: 1000000,
    roomId: null,
    isOnline: false,
    hostId: null
};

export function createPlayerState(charKey) {
    return {
        charKey, char: charKey ? CHARACTERS[charKey] : null,
        money: 1000, rep: 0, owned: [], levels: {}, cars: [],
        inJail: false, jailRoundsLeft: 0, jailReason: '', jailRecord: [],
        dealsThisRound: 0, rollsThisRound: 0, pitchesThisRound: 0,
        isAI: false, peerId: null
    };
}

export function currentPlayer() { return gameState.players[gameState.currentPlayerIdx]; }
export function formatNum(n) { return n.toLocaleString('sv-SE'); }

// ── Save/Load ──
export function saveGame(accountKey) {
    const key = accountKey ? 'empire_save_' + accountKey : 'empire_hustle_save';
    localStorage.setItem(key, JSON.stringify(gameState));
}

export function loadGame(accountKey) {
    const key = accountKey ? 'empire_save_' + accountKey : 'empire_hustle_save';
    const raw = localStorage.getItem(key);
    if (!raw) return false;
    try {
        Object.assign(gameState, JSON.parse(raw));
        gameState.players.forEach(p => { p.char = CHARACTERS[p.charKey]; });
        return true;
    } catch (e) { return false; }
}

export function deleteSave() { localStorage.removeItem('empire_hustle_save'); }
export function hasSave() { return !!localStorage.getItem('empire_hustle_save'); }
