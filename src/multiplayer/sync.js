// ═══════════════════════════════════════════
//  EMPIRE OF HUSTLE — P2P Multiplayer (PeerJS)
//  Ingen server behövs. Värden (host) är navet:
//  gäster skickar sitt state till värden, värden
//  slår ihop och skickar vidare till alla andra.
// ═══════════════════════════════════════════

import Peer from 'peerjs';
import { CHARACTERS } from '../data/gameData.js';
import { gameState, LOCAL_KEYS, mergeRemoteState, normalizePlayer, isMyTurn, myPlayer, applyPlayerDelta } from '../game/state.js';

const PEER_CONFIG = {
    config: {
        iceServers: [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' }
        ]
    }
};
const MAX_PLAYERS = 6;

let peer = null;
let connections = [];
let isHost = false;
let pendingJoin = null;
const callbacks = { playerJoined: null, chat: null, stateApplied: null, peerLeft: null, hostLost: null, effect: null };
// Andra moduler (staden, SMS) registrerar egna meddelandetyper: fn(data, fromId, conn)
const handlers = new Map();
const closeHooks = new Set();

// ── Generate room code ──
function genRoomCode() {
    const words = ['KEBAB', 'HUSTLE', 'EMPIRE', 'BLOCK', 'GRIND', 'ROYAL', 'TACO', 'BEATS', 'LAMBO', 'ROLLS'];
    return words[Math.floor(Math.random() * words.length)] + Math.floor(10 + Math.random() * 90);
}

// PeerJS behöver ingen konfiguration — behåller namnen för bakåtkompatibilitet.
export function isOnlineAvailable() { return true; }
export function initOnline() { return true; }
export const isFirebaseConfigured = isOnlineAvailable;
export const initFirebase = initOnline;

export function isRoomHost() { return isHost; }

function snapshot() {
    const data = JSON.parse(JSON.stringify(gameState));
    for (const k of LOCAL_KEYS) delete data[k];
    return data;
}

function broadcast(msg, except = null) {
    connections.forEach(conn => {
        if (conn !== except && conn.open) {
            try { conn.send(msg); } catch (e) { console.warn('Kunde inte skicka till peer', e); }
        }
    });
}

// ── Create a room (you are the host) ──
export function createRoom(playerData, attempt = 0) {
    const roomId = genRoomCode();
    return new Promise((resolve, reject) => {
        peer = new Peer('empire-' + roomId, PEER_CONFIG);
        peer.on('open', () => {
            isHost = true;
            gameState.roomId = roomId;
            gameState.isOnline = true;
            gameState.hostId = playerData.charKey;
            gameState.myCharKey = playerData.charKey;
            resolve(roomId);
        });
        peer.on('connection', (conn) => {
            connections.push(conn);
            setupConnection(conn);
            startHeartbeat();
        });
        peer.on('error', (err) => {
            console.error('PeerJS error:', err);
            if (err.type === 'unavailable-id' && attempt < 5) {
                peer.destroy();
                createRoom(playerData, attempt + 1).then(resolve).catch(reject);
            } else if (!gameState.roomId) {
                reject(err);
            }
        });
    });
}

// ── Join someone's room ── resolves { ok, reason }
export function joinRoom(roomId, playerData) {
    // Ett andra klick medan vi ansluter skulle annars lämna en gammal timer
    // som kopplar ner den lyckade anslutningen tio sekunder senare.
    if (pendingJoin) return Promise.resolve({ ok: false, reason: 'Ansluter redan...' });
    if (peer && gameState.isOnline) return Promise.resolve({ ok: false, reason: 'Du är redan i ett rum' });
    return new Promise((resolve) => {
        let done = false;
        const finish = (result) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            pendingJoin = null;
            if (!result.ok) leaveRoom();
            resolve(result);
        };
        const timer = setTimeout(() => finish({ ok: false, reason: 'Ingen svarade — kolla koden' }), 10000);
        pendingJoin = finish;

        peer = new Peer(undefined, PEER_CONFIG);
        peer.on('open', () => {
            const conn = peer.connect('empire-' + roomId, { reliable: true });
            conn.on('open', () => {
                connections.push(conn);
                setupConnection(conn);
                startHeartbeat();
                conn.send({ type: 'join', player: { charKey: playerData.charKey } });
            });
            conn.on('error', () => finish({ ok: false, reason: 'Anslutningsfel' }));
        });
        peer.on('error', (err) => {
            console.error('PeerJS error:', err);
            finish({ ok: false, reason: err.type === 'peer-unavailable' ? 'Rummet finns inte' : 'Nätverksfel' });
        });
        isHost = false;
        gameState.myCharKey = playerData.charKey;
        gameState.pendingRoomId = roomId;
    });
}

// ── Host: handle a join request ──
function handleJoin(conn, player) {
    const deny = (reason) => { try { conn.send({ type: 'denied', reason }); } catch (e) { /* ignore */ } };
    if (!player || !CHARACTERS[player.charKey]) return deny('Ogiltig karaktär');
    const existing = gameState.players.find(p => p.charKey === player.charKey);
    if (existing && !existing.disconnected) return deny(`${CHARACTERS[player.charKey].name} är redan tagen — välj en annan`);
    if (!existing && gameState.players.length >= MAX_PLAYERS) return deny('Rummet är fullt');

    let np;
    if (existing) {
        // Återanslutning: ta tillbaka kontrollen från AI:n
        existing.disconnected = false;
        existing.isAI = false;
        existing.peerId = conn.peer;
        np = existing;
    } else {
        np = normalizePlayer({ charKey: player.charKey });
        np.peerId = conn.peer;
        gameState.players.push(np);
    }
    conn.charKey = player.charKey;
    gameState._lastUpdate = Date.now();
    conn.send({ type: 'welcome', gameState: snapshot() });
    broadcast({ type: 'state', gameState: snapshot() }, conn);
    if (callbacks.playerJoined) callbacks.playerJoined(np);
}

// ── Handle messages from connected peers ──
function setupConnection(conn) {
    conn.on('data', (data) => {
        if (!data || typeof data !== 'object') return;
        conn.lastSeen = Date.now();
        switch (data.type) {
            case 'ping':
                break;
            case 'bye':
                handleConnClosed(conn);
                break;
            case 'welcome':
                if (!isHost && pendingJoin) {
                    gameState.roomId = gameState.pendingRoomId;
                    gameState.isOnline = true;
                    mergeRemoteState(data.gameState, { protect: false });
                    pendingJoin({ ok: true });
                }
                break;
            case 'denied':
                if (pendingJoin) pendingJoin({ ok: false, reason: String(data.reason || 'Nekad') });
                break;
            case 'state':
                if (data.gameState && data.gameState._lastUpdate !== gameState._lastUpdate) {
                    // Värden tar bara turläget och avsändarens egen spelare från en gäst
                    if (isHost) mergeRemoteState(data.gameState, { onlyPlayer: conn.charKey, fromHost: false });
                    else mergeRemoteState(data.gameState);
                    if (isHost) broadcast({ type: 'state', gameState: snapshot() }, conn);
                    if (callbacks.stateApplied) callbacks.stateApplied();
                }
                break;
            case 'me':
                // En gäst skickar sin egen spelare (t.ex. efter stan, mellan turerna)
                if (isHost && data.player && data.player.charKey === conn.charKey) {
                    mergeRemoteState({ players: [data.player] }, { onlyPlayer: conn.charKey, fromHost: false });
                    gameState._lastUpdate = Date.now();
                    broadcast({ type: 'state', gameState: snapshot() }, conn);
                    if (callbacks.stateApplied) callbacks.stateApplied();
                }
                break;
            case 'effect':
                if (isHost) routeEffect(data.target, data.delta, conn.charKey);
                else if (data.target === gameState.myCharKey) applyEffectToMe(data.delta);
                break;
            case 'join':
                if (isHost) handleJoin(conn, data.player);
                break;
            case 'chat':
                if (data.msg && typeof data.msg === 'object') {
                    if (isHost) broadcast({ type: 'chat', msg: data.msg }, conn);
                    if (callbacks.chat) callbacks.chat(data.msg);
                }
                break;
            default: {
                // Avsändaren är den anslutningen värden kopplat till en karaktär — aldrig vad meddelandet påstår
                const h = handlers.get(data.type);
                if (h) h(data, isHost ? conn.charKey : null, conn);
            }
        }
    });
    conn.lastSeen = Date.now();
    conn.on('close', () => handleConnClosed(conn));
    conn.on('error', () => handleConnClosed(conn));
}

// En anslutning är borta: stängd, sa hejdå eller tyst för länge.
function handleConnClosed(conn) {
    if (conn._closedHandled) return;
    conn._closedHandled = true;
    connections = connections.filter(c => c !== conn);
    try { conn.close(); } catch (e) { /* redan stängd */ }
    closeHooks.forEach(fn => { try { fn(conn.charKey); } catch (e) { console.warn(e); } });
    if (isHost) {
        const p = gameState.players.find(pl => pl.charKey === conn.charKey);
        if (p) {
            p.disconnected = true;
            p.isAI = true; // AI:n tar över tills spelaren kommer tillbaka
            syncState(true);
            if (callbacks.peerLeft) callbacks.peerLeft(p);
        }
    } else if (gameState.isOnline) {
        // Värden försvann — fortsätt offline mot AI
        gameState.isOnline = false;
        stopHeartbeat();
        gameState.players.forEach(p => { if (p.charKey !== gameState.myCharKey) p.isAI = true; });
        if (callbacks.hostLost) callbacks.hostLost();
    }
}

// ── Hjärtslag: PeerJS märker inte alltid när en flik försvinner ──
const PING_MS = 3000;
const TIMEOUT_MS = 20000;
let heartbeat = null;

function startHeartbeat() {
    if (heartbeat) return;
    heartbeat = setInterval(() => {
        broadcast({ type: 'ping' });
        const now = Date.now();
        connections.slice().forEach(conn => {
            if (conn.open && now - (conn.lastSeen || now) > TIMEOUT_MS) handleConnClosed(conn);
        });
    }, PING_MS);
}

function stopHeartbeat() {
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
}

// Anropas när fliken stängs så att de andra slipper vänta på timeout.
export function sayGoodbye() {
    if (!peer) return;
    broadcast({ type: 'bye' });
}

// ── Sync state to all connected peers ──
// Bara den som har turen skickar state (force = värden måste meddela något ändå).
export function syncState(force = false) {
    if (!peer || connections.length === 0) return;
    if (!force && !isMyTurn()) return;
    gameState._lastUpdate = Date.now();
    broadcast({ type: 'state', gameState: snapshot() });
}

// Min egen spelare ändrades mellan turerna (t.ex. i stan): skicka bara den
export function syncMe() {
    if (!peer || !gameState.isOnline) return;
    if (isHost) { syncState(true); return; }
    const me = myPlayer();
    if (!me) return;
    sendToHost({ type: 'me', player: JSON.parse(JSON.stringify(me)) });
}

// Något jag gjorde mot en annan spelare: den som äger spelaren lägger på ändringen
export function sendEffect(target, delta) {
    if (!gameState.isOnline || !peer) return false;
    if (isHost) routeEffect(target, delta, gameState.myCharKey);
    else sendToHost({ type: 'effect', target, delta });
    return true;
}

function applyEffectToMe(delta) {
    const me = myPlayer();
    if (!me) return;
    applyPlayerDelta(me, delta);
    if (callbacks.effect) callbacks.effect(delta);
    syncMe();
}

function routeEffect(target, delta, from) {
    const p = gameState.players.find(pl => pl.charKey === target);
    if (!p || !delta || typeof delta !== 'object') return;
    if (target === gameState.myCharKey) { applyEffectToMe(delta); return; }
    const conn = connections.find(c => c.charKey === target && c.open);
    if (conn && !p.isAI) { try { conn.send({ type: 'effect', target, delta, from }); } catch (e) { /* ignore */ } return; }
    // AI eller frånkopplad spelare: värden äger dem
    applyPlayerDelta(p, delta);
    syncState(true);
}

// ── Kanaler för andra moduler ──
export function onMessage(type, fn) { handlers.set(type, fn); }
export function onConnectionClosed(fn) { closeHooks.add(fn); return () => closeHooks.delete(fn); }
export function sendToHost(msg) {
    const conn = connections[0];
    if (isHost || !conn || !conn.open) return false;
    try { conn.send(msg); return true; } catch (e) { return false; }
}
export function sendToPlayer(charKey, msg) {
    const conn = connections.find(c => c.charKey === charKey && c.open);
    if (!conn) return false;
    try { conn.send(msg); return true; } catch (e) { return false; }
}
export function broadcastAll(msg) { broadcast(msg); }
export function connectedIds() {
    // Värden vet vilka gäster som är anslutna just nu
    return connections.filter(c => c.open && c.charKey).map(c => c.charKey);
}
export function onEffect(cb) { callbacks.effect = cb; }

// ── Send chat message to all peers ──
export function sendChatOnline(msg) {
    if (!peer) return;
    broadcast({ type: 'chat', msg });
}

// ── Leave room ──
export function leaveRoom() {
    stopHeartbeat();
    connections.forEach(c => { c._closedHandled = true; try { c.close(); } catch (e) { /* ignore */ } });
    connections = [];
    if (peer) { try { peer.destroy(); } catch (e) { /* ignore */ } peer = null; }
    gameState.roomId = null;
    gameState.isOnline = false;
    isHost = false;
}

// ── Callbacks ──
export function onPlayerJoin(cb) { callbacks.playerJoined = cb; }
export function onChat(cb) { callbacks.chat = cb; }
export function onSync(cb) { callbacks.stateApplied = cb; }
export function onPeerLeft(cb) { callbacks.peerLeft = cb; }
export function onHostLost(cb) { callbacks.hostLost = cb; }

export function listRoomPlayers() { return gameState.players || []; }
export function startOnlineGame() {
    gameState.started = true;
    syncState(true);
}
