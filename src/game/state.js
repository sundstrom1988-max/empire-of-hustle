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
        gameOver: false,
        turnSeq: 0,             // räknas upp vid varje turbyte — äldre turlägen ignoreras
        cityOwners: {}          // delade fastigheter i stan (stripklubben) — bara värden ändrar
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
        strength: 0,                // gymmet: hårdare slag och mer hälsa (0–5)
        cityHouses: [],             // köpta gömställen
        crew: [],                   // anställda: { id, name, role, trait, hp, dmg, speed, cost }
        armor: 0,                   // skyddsväst 0–100
        cityDone: [],               // saker som bara går en gång per runda (rån, gym...)
        missionsThisRound: 0, fencedThisRound: 0,
        cityPickupsTaken: [], cityCollected: [],
        cityStats: { missions: 0, wrecks: 0, busted: 0, wasted: 0, fenced: 0, sold: 0, opps: 0, robbed: 0, knockouts: 0, dates: 0, copsDown: 0, heists: 0, pvpWins: 0, pvpLosses: 0 }
    };
}

const NUMERIC_FIELDS = ['money', 'rep', 'stash', 'jailRoundsLeft', 'bail', 'dealsThisRound', 'rollsThisRound',
    'pitchesThisRound', 'totalEarned', 'totalSpent', 'successfulDeals', 'failedDeals', 'heistCooldown',
    'sabotagedRounds', 'missionsThisRound', 'fencedThisRound', 'cityGoods', 'goodsBoughtThisRound', 'strength', 'armor'];
const ARRAY_FIELDS = ['owned', 'cars', 'jailRecord', 'moneyHistory', 'pendingEvidence', 'cityPickupsTaken', 'cityCollected', 'weapons', 'cityHouses', 'cityDone', 'crew'];
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
    p.strength = Math.max(0, Math.min(5, Math.floor(p.strength)));
    p.armor = Math.max(0, Math.min(100, p.armor));
    // Crew från en sparfil eller en annan spelare: bara giltiga roller, högst fyra
    p.crew = p.crew.filter(m => m && typeof m === 'object' && ['guard', 'gunner', 'scout'].includes(m.role) && typeof m.name === 'string')
        .slice(0, 4).map(m => ({ id: String(m.id), name: m.name.slice(0, 20), role: m.role, trait: String(m.trait || '').slice(0, 40),
            hp: Math.max(1, Math.min(200, Number(m.hp) || 60)), dmg: Array.isArray(m.dmg) ? m.dmg.slice(0, 2).map(v => Math.max(1, Math.min(40, Number(v) || 10))) : [10, 14],
            speed: Math.max(80, Math.min(260, Number(m.speed) || 160)), cost: Number(m.cost) || 0 }));
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
// Online äger varje klient sin egen spelare: min data skrivs bara av mig (även
// mellan turerna, t.ex. när jag är i stan). Den som har turen bestämmer turläget,
// och bara värden bestämmer delade saker (HOST_KEYS) och vem som är AI/frånkopplad.
// Spelarobjekt uppdateras på plats så att referenser (t.ex. i Stan) håller.
export const HOST_KEYS = ['cityOwners'];
const HOST_PLAYER_FIELDS = ['disconnected', 'isAI', 'peerId'];

function assignPlayer(existing, fresh) {
    for (const key of Object.keys(existing)) if (!(key in fresh)) delete existing[key];
    return Object.assign(existing, fresh);
}

// opts.protect: skydda min egen spelare (av bara vid första välkomsten)
// opts.fromHost: får sätta HOST_KEYS
// opts.onlyPlayer: värden tar bara emot avsändarens egen spelare från en gäst
export function mergeRemoteState(remote, opts = {}) {
    if (!remote || typeof remote !== 'object') return false;
    const { protect = true, fromHost = true, onlyPlayer = null } = opts;
    const protectKey = protect && gameState.isOnline ? gameState.myCharKey : null;
    const staleTurn = (Number(remote.turnSeq) || 0) < (Number(gameState.turnSeq) || 0);
    for (const [k, v] of Object.entries(remote)) {
        if (LOCAL_KEYS.includes(k) || k === 'players') continue;
        if (HOST_KEYS.includes(k)) { if (fromHost) gameState[k] = v; continue; }
        if (staleTurn) continue; // ett äldre turläge än vårt
        gameState[k] = v;
    }
    if (Array.isArray(remote.players)) {
        if (onlyPlayer) {
            const rp = remote.players.find(p => p && p.charKey === onlyPlayer);
            const existing = gameState.players.find(p => p.charKey === onlyPlayer);
            if (rp && existing) {
                const keep = Object.fromEntries(HOST_PLAYER_FIELDS.map(f => [f, existing[f]]));
                assignPlayer(existing, Object.assign(normalizePlayer(rp), keep));
            }
        } else {
            const old = new Map(gameState.players.map(p => [p.charKey, p]));
            gameState.players = remote.players.map(rp => {
                const fresh = normalizePlayer(rp);
                const existing = old.get(fresh.charKey);
                if (!existing) return fresh;
                if (fresh.charKey === protectKey) {
                    for (const f of HOST_PLAYER_FIELDS) existing[f] = fresh[f];
                    return existing;
                }
                return assignPlayer(existing, fresh);
            });
        }
    }
    if (!(gameState.currentPlayerIdx >= 0 && gameState.currentPlayerIdx < gameState.players.length)) gameState.currentPlayerIdx = 0;
    return true;
}

// Min egen spelare (online), annars den som har turen
export function myPlayer() {
    if (!gameState.isOnline) return currentPlayer();
    return gameState.players.find(p => p.charKey === gameState.myCharKey) || null;
}

// Något någon annan gjorde mot en spelare (t.ex. Gargamels stöld): läggs på av den som äger spelaren
export function applyPlayerDelta(p, delta) {
    if (!p || !delta || typeof delta !== 'object') return false;
    for (const [k, v] of Object.entries(delta)) {
        if (!['money', 'rep', 'sabotagedRounds'].includes(k)) continue;
        const n = Number(v);
        if (!Number.isFinite(n)) continue;
        p[k] = Math.max(0, (Number(p[k]) || 0) + n);
    }
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
    if (!gameState.cityOwners || typeof gameState.cityOwners !== 'object') gameState.cityOwners = {};
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
