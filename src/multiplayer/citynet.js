// ═══════════════════════════════════════════
//  DELAD STAD ONLINE
//  Alla i rummet kan vara i stan samtidigt. Varje klient
//  skickar sin position till värden ~10 ggr/s och värden
//  skickar allas positioner till alla. Värden avgör det
//  delade: föremål på marken, träffar, ägande och SMS.
//  Offline är man sin egen värd — samma regler, samma kod.
// ═══════════════════════════════════════════

import { gameState, applyPlayerDelta } from '../game/state.js';
import { isRoomHost, onMessage, onConnectionClosed, sendToHost, sendToPlayer, broadcastAll, connectedIds, syncState } from './sync.js';
import * as A from './authority.js';
import { generateCity } from '../city/map.js';
import { cityItemDefs } from '../city/items.js';

const SEND_MS = 100;
const STALE_MS = 6000;

// Värdens bild av stan
const host = { players: new Map(), items: null, hitLog: new Map(), lastHit: new Map(), smsLog: new Map(), smsPending: new Map(), timer: null, takenKey: '' };
// Min bild av stan
const me = { id: null, inCity: false, last: 0, remotes: new Map(), taken: new Set(), listeners: new Set(), seen: new Set(), smsIn: null, smsStatus: null };

const now = () => Date.now();
const online = () => !!gameState.isOnline;
const actingHost = () => !online() || isRoomHost();
const myId = () => (online() ? gameState.myCharKey : me.id);

export function cityNetActive() { return online(); }
export function onCityNet(fn) { me.listeners.add(fn); return () => me.listeners.delete(fn); }
function emit(e) { me.listeners.forEach(fn => { try { fn(e); } catch (err) { console.error('Stad-nät:', err); } }); }

function playerInfo(id) {
    const p = gameState.players.find(x => x.charKey === id);
    return { name: p?.char?.name || String(id), icon: p?.char?.icon || '😎', color: p?.char?.color || '#ff4fd8' };
}

// Till en viss spelare: mig själv direkt, annars via nätet
function replyTo(id, msg) {
    if (id === myId()) clientHandle(msg.type, msg);
    else sendToPlayer(id, msg);
}
function toAll(msg) { broadcastAll(msg); clientHandle(msg.type, msg); }

// Skicka något till värden (eller hantera det själv om jag är värden/offline)
function request(type, data) {
    if (actingHost()) { hostHandle(type, data, myId()); return true; }
    return sendToHost({ type, ...data });
}

// ── Tvätta det en klient påstår om sin position ──
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, n = 24) => (typeof v === 'string' ? v.slice(0, n) : null);
function sanitizePos(p) {
    const crew = Array.isArray(p.crew) ? p.crew.slice(0, 8).map(c => ({ x: num(c.x), y: num(c.y), r: str(c.r, 12), hp: num(c.hp), mhp: num(c.mhp, 1), d: !!c.d, a: num(c.a) })) : [];
    return {
        x: num(p.x), y: num(p.y), a: num(p.a), v: str(p.v), vc: str(p.vc, 9), in: str(p.in),
        hp: num(p.hp), mhp: num(p.mhp, 100), dead: !!p.dead, prot: !!p.prot, w: str(p.w, 12), stars: Math.max(0, Math.min(5, num(p.stars))),
        ar: num(p.ar), crew
    };
}

// ── Värdens sida ──
function hostItems() {
    if (!host.items) {
        const city = generateCity(1337);
        host.items = new Map(cityItemDefs(city).map(d => [d.id, { ...d, takenUntil: 0 }]));
    }
    return host.items;
}

function pushItems() {
    const taken = A.takenIds(hostItems(), now());
    host.takenKey = taken.join(',');
    toAll({ type: 'items', taken });
}

function hostTick() {
    const t = now();
    const alive = new Set(connectedIds());
    for (const [id, p] of host.players) {
        if (id !== myId() && (!alive.has(id) || t - p.t > STALE_MS)) host.players.delete(id);
        else if (id === myId() && !me.inCity) host.players.delete(id);
    }
    const list = [...host.players.values()].map(p => ({ ...p, ...playerInfo(p.id) }));
    toAll({ type: 'cityAll', players: list });
    // Vapen som kommit tillbaka på marken
    if (host.items && A.takenIds(host.items, t).join(',') !== host.takenKey) pushItems();
    if (!host.players.size) { clearInterval(host.timer); host.timer = null; }
}

function ensureHostLoop() {
    if (host.timer || !online() || !isRoomHost()) return;
    host.timer = setInterval(hostTick, SEND_MS);
}

function hostHandle(type, data, from) {
    if (!from || !data || typeof data !== 'object') return;
    const t = now();
    switch (type) {
        case 'cityPos': {
            if (!data.p || typeof data.p !== 'object') return;
            const fresh = !host.players.has(from);
            host.players.set(from, { ...sanitizePos(data.p), id: from, t });
            if (fresh) replyTo(from, { type: 'items', taken: A.takenIds(hostItems(), t) });
            ensureHostLoop();
            return;
        }
        case 'cityLeave':
            host.players.delete(from);
            if (online() && isRoomHost()) hostTick();
            return;
        case 'pickup': {
            const items = hostItems();
            const res = A.validatePickup(items, data.item, host.players.get(from), t);
            if (res.ok) { A.takeItem(items, data.item, t); pushItems(); }
            replyTo(from, { type: 'pickupRes', req: data.req, item: data.item, ok: res.ok, reason: res.reason });
            return;
        }
        case 'hit': {
            const att = host.players.get(from);
            const tgt = host.players.get(data.target);
            if (!att || !tgt || data.target === from) return;
            // Den som slår kan vara ett crew-medlem (src) och målet kan vara ett crew-medlem (crew)
            const src = num(data.src, -1), crew = num(data.crew, -1);
            const attPos = src >= 0 ? (att.crew[src] ? { ...att.crew[src], in: att.in } : null) : att;
            const tgtPos = crew >= 0 ? (tgt.crew[crew] ? { ...tgt.crew[crew], in: tgt.in, dead: tgt.crew[crew].d, prot: tgt.prot } : null) : tgt;
            const res = A.validateHit(attPos, tgtPos, data.kind, data.dmg, t, host.hitLog, from);
            if (!res.ok) return;
            if (crew < 0) host.lastHit.set(data.target, { by: from, t });
            replyTo(data.target, { type: 'hurt', from, crew, dmg: res.dmg, kind: data.kind, name: playerInfo(from).name });
            return;
        }
        case 'down': {
            // Offret säger att det gick ner. Vinsten går till den som träffade sist (om det var nyss).
            const lh = host.lastHit.get(from);
            const killer = lh && t - lh.t < 15000 ? lh.by : null;
            host.lastHit.delete(from);
            const amount = killer ? Math.min(A.PVP_LOSS_MAX, Math.max(0, Math.floor(num(data.lost)))) : 0;
            toAll({ type: 'pvp', id: `${from}:${t}`, killer, victim: from, amount, killerName: killer ? playerInfo(killer).name : null, victimName: playerInfo(from).name });
            return;
        }
        case 'buyProp': {
            const owners = gameState.cityOwners || {};
            const res = A.validateBuy(owners, data.prop, from, data.money);
            if (res.ok) {
                gameState.cityOwners = { ...owners, [data.prop]: { owner: from, price: res.price, since: t } };
                if (res.prevOwner && res.refund) {
                    const prevOnline = res.prevOwner === myId() || connectedIds().includes(res.prevOwner);
                    if (prevOnline) replyTo(res.prevOwner, { type: 'reward', id: `buyout:${data.prop}:${t}`, amount: res.refund, reason: `${playerInfo(from).name} köpte ut dig från ${A.PROPERTIES[data.prop].name}` });
                    else applyPlayerDelta(gameState.players.find(p => p.charKey === res.prevOwner), { money: res.refund });
                }
                syncState(true);
            }
            replyTo(from, { type: 'buyRes', req: data.req, prop: data.prop, ok: res.ok, price: res.price, reason: res.reason });
            if (res.ok) toAll({ type: 'owners' });
            return;
        }
        case 'sms': {
            const log = host.smsLog.get(from) || [];
            host.smsLog.set(from, log);
            const fail = reason => replyTo(from, { type: 'smsStatus', id: data.id, status: 'failed', reason });
            const v = A.validateSms(data.text, log, t);
            if (!v.ok) return fail(v.reason);
            const target = gameState.players.find(p => p.charKey === data.to);
            if (!target || data.to === from) return fail('invalid');
            const reachable = data.to === myId() || connectedIds().includes(data.to);
            if (!reachable || target.disconnected) return fail('offline');
            host.smsPending.set(`${data.id}|${data.to}`, from);
            replyTo(data.to, { type: 'smsIn', from, text: v.text, id: String(data.id).slice(0, 40), ts: t });
            return;
        }
        case 'smsAck': {
            const key = `${data.id}|${from}`;
            const sender = host.smsPending.get(key);
            if (!sender) return;
            host.smsPending.delete(key);
            replyTo(sender, { type: 'smsStatus', id: data.id, status: data.status === 'delivered' ? 'delivered' : 'failed', reason: data.status === 'blocked' ? 'blocked' : undefined });
            return;
        }
    }
}

// ── Klientens sida (meddelanden från värden) ──
function clientHandle(type, data) {
    switch (type) {
        case 'cityAll': {
            const seen = new Set();
            for (const p of data.players || []) {
                if (!p || p.id === myId()) continue;
                seen.add(p.id);
                const r = me.remotes.get(p.id);
                if (r) Object.assign(r, p);
                else { me.remotes.set(p.id, { ...p, rx: p.x, ry: p.y }); emit({ type: 'joined', id: p.id, name: p.name }); }
            }
            for (const [id, r] of me.remotes) if (!seen.has(id)) { me.remotes.delete(id); emit({ type: 'left', id, name: r.name }); }
            return;
        }
        case 'items': me.taken = new Set(data.taken || []); emit({ type: 'items' }); return;
        case 'pvp':
            if (me.seen.has(data.id)) return;
            me.seen.add(data.id);
            emit({ ...data, type: 'pvp' });
            return;
        case 'reward':
            if (me.seen.has(data.id)) return;
            me.seen.add(data.id);
            emit({ ...data, type: 'reward' });
            return;
        case 'smsIn': {
            const status = me.smsIn ? me.smsIn({ from: data.from, text: String(data.text || ''), id: data.id, ts: data.ts }) : 'delivered';
            request('smsAck', { id: data.id, status: status === 'blocked' ? 'blocked' : 'delivered' });
            return;
        }
        case 'smsStatus': if (me.smsStatus) me.smsStatus({ id: data.id, status: data.status, reason: data.reason }); return;
        default: emit({ ...data, type }); // pickupRes, buyRes, hurt, owners
    }
}

// Gäster tar emot från värden, värden tar emot från gäster
['cityAll', 'items', 'pvp', 'reward', 'smsIn', 'smsStatus', 'pickupRes', 'buyRes', 'hurt',
    'cityPos', 'cityLeave', 'pickup', 'hit', 'down', 'buyProp', 'sms', 'smsAck'].forEach(type => {
    onMessage(type, (data, fromId) => {
        if (isRoomHost()) hostHandle(type, data, fromId);
        else clientHandle(type, data);
    });
});
onConnectionClosed(id => {
    if (isRoomHost()) host.players.delete(id);
    else { for (const [rid, r] of me.remotes) emit({ type: 'left', id: rid, name: r.name }); me.remotes.clear(); }
});

// ── API för stan ──
export function cityEnter(id) {
    me.id = id;
    me.inCity = true;
    me.last = 0;
}
export function cityExit() {
    if (!me.inCity) return;
    me.inCity = false;
    request('cityLeave', {});
    me.remotes.clear();
}
// Anropas varje bildruta; skickar högst ~10 ggr/s
export function cityPublish(p, force = false) {
    const t = now();
    if (!force && t - me.last < SEND_MS) return;
    me.last = t;
    request('cityPos', { p });
}
export function cityRemotes() { return me.remotes; }
export function cityTaken() { return me.taken; }
let reqSeq = 0;
export function cityRequest(type, data = {}) {
    // Svaret kan komma direkt (offline/värd), så den som frågar kan skicka med sitt eget id
    const req = data.req || `${myId()}-${++reqSeq}-${now()}`;
    const ok = request(type, { ...data, req });
    return ok ? req : null;
}

// ── SMS (appen kopplas in i main.js) ──
export function smsSend(to, text, id) {
    if (!online()) return false;
    return request('sms', { to, text, id });
}
export function onSmsIncoming(fn) { me.smsIn = fn; }
export function onSmsStatus(fn) { me.smsStatus = fn; }
// Andra riktiga spelare i rummet (inte AI)
export function smsContacts() {
    if (!online()) return [];
    return gameState.players
        .filter(p => p.charKey !== gameState.myCharKey && !(p.isAI && !p.peerId && !p.disconnected))
        .map(p => ({ id: p.charKey, name: p.char?.name || p.charKey, icon: p.char?.icon || '😎', online: !p.disconnected && !p.isAI }));
}

// Endast för tester
export function _resetCityNet() {
    host.players.clear(); host.items = null; host.hitLog.clear(); host.lastHit.clear(); host.smsLog.clear(); host.smsPending.clear();
    if (host.timer) clearInterval(host.timer);
    host.timer = null;
    me.remotes.clear(); me.taken = new Set(); me.seen.clear(); me.inCity = false; me.listeners.clear();
}
export const _hostHandle = hostHandle;
