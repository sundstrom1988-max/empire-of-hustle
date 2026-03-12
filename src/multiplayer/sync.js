// ═══════════════════════════════════════════
//  EMPIRE OF HUSTLE — P2P Multiplayer (PeerJS)
//  No server, no Firebase, no setup needed!
// ═══════════════════════════════════════════

import Peer from 'peerjs';
import { gameState, currentPlayer } from '../game/state.js';

let peer = null;
let connections = [];    // Active connections to other players
let isHost = false;
let onStateUpdate = null;
let onPlayerJoined = null;
let onChatMessage = null;

// ── Generate room code ──
function genRoomCode() {
    const words = ['KEBAB', 'HUSTLE', 'EMPIRE', 'BLOCK', 'GRIND', 'ROYAL', 'TACO', 'BEATS', 'LAMBO', 'ROLLS'];
    return words[Math.floor(Math.random() * words.length)] + Math.floor(10 + Math.random() * 90);
}

// ── Always "configured" since PeerJS needs nothing ──
export function isFirebaseConfigured() { return true; }
export function initFirebase() { return true; }

// ── Create a room (you are the host) ──
export async function createRoom(playerData) {
    const roomId = genRoomCode();
    return new Promise((resolve, reject) => {
        // Peer ID = room code (host)
        peer = new Peer('empire-' + roomId, {
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            }
        });
        peer.on('open', () => {
            isHost = true;
            gameState.roomId = roomId;
            gameState.isOnline = true;
            gameState.hostId = playerData.charKey;
            console.log('🌐 Room created:', roomId);
            resolve(roomId);
        });
        peer.on('connection', (conn) => {
            console.log('🟢 Player connected:', conn.peer);
            connections.push(conn);
            setupConnection(conn);
        });
        peer.on('error', (err) => {
            console.error('PeerJS error:', err);
            if (err.type === 'unavailable-id') {
                // Room code taken, try another
                peer.destroy();
                createRoom(playerData).then(resolve).catch(reject);
            } else {
                reject(err);
            }
        });
    });
}

// ── Join someone's room ──
export async function joinRoom(roomId, playerData) {
    return new Promise((resolve, reject) => {
        peer = new Peer(undefined, {
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            }
        });
        peer.on('open', () => {
            const conn = peer.connect('empire-' + roomId, { reliable: true });
            conn.on('open', () => {
                connections.push(conn);
                setupConnection(conn);
                gameState.roomId = roomId;
                gameState.isOnline = true;
                isHost = false;
                // Send join message
                conn.send({ type: 'join', player: playerData });
                console.log('🟢 Joined room:', roomId);
                resolve(true);
            });
            conn.on('error', (err) => {
                console.error('Connection error:', err);
                reject(err);
            });
        });
        peer.on('error', (err) => {
            console.error('PeerJS error:', err);
            resolve(false);
        });
        // Timeout
        setTimeout(() => resolve(false), 8000);
    });
}

// ── Handle messages from connected peers ──
function setupConnection(conn) {
    conn.on('data', (data) => {
        switch (data.type) {
            case 'state':
                // Full state sync from host
                if (data.gameState && data.gameState._lastUpdate !== gameState._lastUpdate) {
                    Object.assign(gameState, data.gameState);
                    if (window.game?.refreshUI) window.game.refreshUI();
                }
                break;
            case 'join':
                // New player joined (host only)
                if (isHost && data.player) {
                    if (onPlayerJoined) onPlayerJoined(data.player);
                    // Send current state to new player
                    conn.send({ type: 'state', gameState: JSON.parse(JSON.stringify(gameState)) });
                }
                break;
            case 'chat':
                // Chat message
                if (data.msg && onChatMessage) onChatMessage(data.msg);
                break;
            case 'action':
                // Player action (buy, pitch, etc.) — host processes and syncs
                if (isHost && data.action && window.game?.[data.action]) {
                    window.game[data.action](...(data.args || []));
                }
                break;
        }
    });
    conn.on('close', () => {
        connections = connections.filter(c => c !== conn);
        console.log('🔴 Player disconnected');
    });
}

// ── Sync state to all connected peers ──
export async function syncState() {
    if (!peer || connections.length === 0) return;
    gameState._lastUpdate = Date.now();
    const stateStr = JSON.parse(JSON.stringify(gameState));
    connections.forEach(conn => {
        if (conn.open) conn.send({ type: 'state', gameState: stateStr });
    });
}

// ── Send chat message to all peers ──
export async function sendChatOnline(msg) {
    if (!peer) return;
    connections.forEach(conn => {
        if (conn.open) conn.send({ type: 'chat', msg });
    });
}

// ── Leave room ──
export async function leaveRoom() {
    connections.forEach(c => c.close());
    connections = [];
    if (peer) { peer.destroy(); peer = null; }
    gameState.roomId = null;
    gameState.isOnline = false;
    isHost = false;
}

// ── Callbacks ──
export function onPlayerJoin(callback) { onPlayerJoined = callback; }
export function onChat(callback) { onChatMessage = callback; }
export function onSync(callback) { onStateUpdate = callback; }

// ── Get room info ──
export async function listRoomPlayers() { return gameState.players || []; }
export async function startOnlineGame() { await syncState(); }
