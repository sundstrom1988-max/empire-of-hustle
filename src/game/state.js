import { CHARACTERS } from '../data/gameData.js';
import { GANG_IDS } from '../city/constants.js';
import { WEAPONS } from '../city/weapons.js';

// ── Game State ──
function defaultGameState() {
    return {
        players: [],
        currentPlayerIdx: 0,
        round: 1,
        mode: 'single',
        numPlayers: 1,
        maxRollsPerRound: 2,
        maxPitchesPerRound: 2,
        maxMissionsPerRound: 3,
        maxFencePerRound: 3,
        maxGoodsPerRound: 10,
        musicMuted: false,
        sfxMuted: false,
        winAmount: 1000000,
        roomId: null,
        isOnline: false,
        hostId: null,
        // Local-only (never synced): which account the save belongs to and who "I" am online
        accountKey: null,
        myCharKey: null,
        aiThinking: false,
        gameOver: false
    };
}

export const gameState = defaultGameState();

// Keys that belong to this browser only and must never be overwritten by a peer.
export const LOCAL_KEYS = ['musicMuted', 'sfxMuted', 'accountKey', 'myCharKey', 'aiThinking'];

export function resetGameState() {
    for (const k of Object.keys(gameState)) delete gameState[k];
    Object.assign(gameState, defaultGameState());
}

export function createPlayerState(charKey) {
    return {
        charKey, char: charKey ? CHARACTERS[charKey] : null,
        money: 1000, rep: 0, owned: [], levels: {}, cars: [], carPimps: {},
        stash: 0,
        inJail: false, jailRoundsLeft: 0, jailReason: '', jailRecord: [], bail: 0,
        dealsThisRound: 0, rollsThisRound: 0, pitchesThisRound: 0,
        isAI: false, peerId: null,
        // Dashboard stats
        moneyHistory: [1000], totalEarned: 0, totalSpent: 0,
        successfulDeals: 0, failedDeals: 0,
        // Gargamel heist
        heistCooldown: 0, pendingEvidence: [], sabotagedRounds: 0,
        // Stan (GTA-läget)
        respect: Object.fromEntries(GANG_IDS.map(id => [id, 0])),
        gang: null,                 // gänget du gått med i
        cityGoods: 0,               // varor att langa
        goodsBoughtThisRound: 0,
        weapons: [],                // köpta vapen (nävar har alla)
        ammo: {},
        weapon: 'fists',
        dateThisRound: false,
        missionsThisRound: 0, fencedThisRound: 0,
        cityPickupsTaken: [], cityCollected: [],
        cityStats: { missions: 0, wrecks: 0, busted: 0, wasted: 0, fenced: 0, sold: 0, opps: 0, robbed: 0, knockouts: 0, dates: 0 }
    };
}

const NUMERIC_FIELDS = ['money', 'rep', 'stash', 'jailRoundsLeft', 'bail', 'dealsThisRound', 'rollsThisRound',
    'pitchesThisRound', 'totalEarned', 'totalSpent', 'successfulDeals', 'failedDeals', 'heistCooldown',
    'sabotagedRounds', 'missionsThisRound', 'fencedThisRound', 'cityGoods', 'goodsBoughtThisRound'];
const ARRAY_FIELDS = ['owned', 'cars', 'jailRecord', 'moneyHistory', 'pendingEvidence', 'cityPickupsTaken', 'cityCollected', 'weapons'];
const OBJECT_FIELDS = ['levels', 'carPimps', 'respect', 'cityStats', 'ammo'];

// Make a player loaded from an old save or a peer safe to use.
export function normalizePlayer(raw) {
    const base = createPlayerState(raw && CHARACTERS[raw.charKey] ? raw.charKey : 'kimit');
    const p = Object.assign(base, raw || {});
    if (!CHARACTERS[p.charKey]) p.charKey = 'kimit';
    p.char = CHARACTERS[p.charKey];
    for (const k of NUMERIC_FIELDS) {
        const n = Number(p[k]);
        p[k] = Number.isFinite(n) ? n : 0;
    }
    const fresh = createPlayerState(p.charKey);
    for (const k of ARRAY_FIELDS) if (!Array.isArray(p[k])) p[k] = fresh[k];
    for (const k of OBJECT_FIELDS) {
        if (!p[k] || typeof p[k] !== 'object' || Array.isArray(p[k])) p[k] = fresh[k];
        else p[k] = Object.assign({}, fresh[k], p[k]);
    }
    p.inJail = !!p.inJail;
    if (!GANG_IDS.includes(p.gang)) p.gang = null;
    p.weapons = [...new Set(p.weapons.filter(id => WEAPONS[id] && id !== 'fists'))];
    if (p.weapon !== 'fists' && !p.weapons.includes(p.weapon)) p.weapon = 'fists';
    p.dateThisRound = !!p.dateThisRound;
    return p;
}

export function currentPlayer() { return gameState.players[gameState.currentPlayerIdx]; }

export function formatNum(n) {
    const v = Number(n);
    if (n === null || n === undefined || !Number.isFinite(v)) return '0';
    return Math.floor(v).toLocaleString('sv-SE');
}

// ── Turn ownership ──
export function isMyTurn() {
    if (!gameState.isOnline) return true;
    const p = currentPlayer();
    return !!p && p.charKey === gameState.myCharKey;
}

export function canAct() {
    return !gameState.gameOver && !gameState.aiThinking && isMyTurn() && !!currentPlayer();
}

// ── Jail ──
export function jailPlayer(p, reason, rounds) {
    p.inJail = true;
    p.jailRoundsLeft = rounds;
    p.jailReason = reason;
    p.bail = Math.floor(500 + Math.random() * 1000);
    if (!Array.isArray(p.jailRecord)) p.jailRecord = [];
    p.jailRecord.push({ deal: reason, round: gameState.round });
}

// ── Online merge ──
// Spelarobjekt uppdateras på plats så att referenser (t.ex. i Stan) håller.
// Under min egen online-tur är jag källan till min spelares data: en äldre
// kopia från värden (t.ex. när någon går med) får inte skriva över den.
export function mergeRemoteState(remote) {
    if (!remote || typeof remote !== 'object') return false;
    const protectKey = gameState.isOnline && isMyTurn() ? gameState.myCharKey : null;
    for (const [k, v] of Object.entries(remote)) {
        if (LOCAL_KEYS.includes(k) || k === 'players') continue;
        gameState[k] = v;
    }
    if (Array.isArray(remote.players)) {
        const old = new Map(gameState.players.map(p => [p.charKey, p]));
        gameState.players = remote.players.map(rp => {
            const fresh = normalizePlayer(rp);
            const existing = old.get(fresh.charKey);
            if (!existing) return fresh;
            if (fresh.charKey === protectKey) return existing;
            for (const key of Object.keys(existing)) if (!(key in fresh)) delete existing[key];
            return Object.assign(existing, fresh);
        });
    }
    if (!(gameState.currentPlayerIdx >= 0 && gameState.currentPlayerIdx < gameState.players.length)) gameState.currentPlayerIdx = 0;
    return true;
}

// ── Save/Load ──
function saveKey(accountKey) { return accountKey ? 'empire_save_' + accountKey : 'empire_hustle_save'; }

export function saveGame(accountKey = gameState.accountKey) {
    try {
        const data = {};
        for (const [k, v] of Object.entries(gameState)) {
            if (k === 'aiThinking') continue;
            data[k] = v;
        }
        localStorage.setItem(saveKey(accountKey), JSON.stringify(data));
        return true;
    } catch (e) {
        console.warn('Kunde inte spara:', e);
        return false;
    }
}

export function loadGame(accountKey) {
    let parsed;
    try {
        const raw = localStorage.getItem(saveKey(accountKey));
        if (!raw) return false;
        parsed = JSON.parse(raw);
    } catch (e) { return false; }
    if (!parsed || !Array.isArray(parsed.players) || parsed.players.length === 0) return false;
    // Ett avgjort spel återupptas inte — då börjar man om
    if (parsed.gameOver) {
        try { localStorage.removeItem(saveKey(accountKey)); } catch (e) { /* ignore */ }
        return false;
    }
    const keepLocal = { musicMuted: gameState.musicMuted, sfxMuted: gameState.sfxMuted };
    resetGameState();
    Object.assign(gameState, parsed, keepLocal);
    gameState.players = parsed.players.map(normalizePlayer);
    if (!(gameState.currentPlayerIdx >= 0 && gameState.currentPlayerIdx < gameState.players.length)) gameState.currentPlayerIdx = 0;
    gameState.aiThinking = false;
    gameState.gameOver = false;
    gameState.isOnline = false; // en sparfil återupptas alltid offline
    gameState.roomId = null;
    if (accountKey) gameState.accountKey = accountKey;
    return true;
}

export function deleteSave() { localStorage.removeItem('empire_hustle_save'); }
export function hasSave() {
    try { return !!localStorage.getItem('empire_hustle_save'); } catch (e) { return false; }
}
