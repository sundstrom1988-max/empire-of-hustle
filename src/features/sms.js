// ═══════════════════════════════════════════
//  SMS — meddelanden mellan riktiga spelare (online)
//  Logiken (lagring, ack, gränser, block) rör aldrig DOM och
//  testas i tests/sms.test.js. Nätverket (sync.js) pratar med
//  den här filen via initSms(api), smsIncoming och smsAck.
//  Ingen text från andra spelare går någonsin via innerHTML.
// ═══════════════════════════════════════════

import '../styles/sms.css';

// ── Gränser ──
export const SMS_LIMITS = Object.freeze({
    maxLength: 280,        // tecken per SMS
    maxPerChat: 200,       // äldsta släpps först
    ackTimeoutMs: 10000,   // utan ack räknas SMS:et som misslyckat
    minGapMs: 1000,        // minst så lång tid mellan två SMS
    burstMax: 5,           // högst så många SMS ...
    burstWindowMs: 10000,  // ... på så här lång tid
    toastMs: 4000          // hur länge notisen syns
});
const L = SMS_LIMITS;
const MAX_UNREAD = 999;

const REASONS = {
    offline: 'Spelaren är offline',
    blocked: 'Spelaren tar inte emot SMS från dig',
    rate: 'Du skickar för fort',
    invalid: 'Ogiltigt SMS',
    timeout: 'Ingen bekräftelse',
    restart: 'Avbröts när sidan stängdes'
};
// Orsaken kommer från nätverket: bara våra egna nycklar duger ("constructor" ska inte bli en text)
const knownReason = r => typeof r === 'string' && Object.prototype.hasOwnProperty.call(REASONS, r);

// ── Tillstånd ──
let api = null;            // nätverkskopplingen från initSms
let loadedKey = null;      // lagringsnyckeln som datan hör till
let data = emptyData();
let sendLog = [];          // när jag skickade de senaste SMS:en (hastighetsgräns)
let idSeq = 0;
const ackTimers = new Map();   // SMS-id → timeout som väntar på ack
const listeners = new Set();   // onSmsChange
const views = new Set();       // monterade appar (telefonen och/eller overlayen)
const mounted = new WeakMap(); // container → vy

// Maps/Sets i stället för objekt: ett id från nätverket får aldrig bli t.ex. "__proto__"
function emptyData() {
    return { convos: new Map(), unread: new Map(), blocked: new Set(), meta: new Map() };
}

// ── Små hjälpare ──
function safe(fn, fallback) { try { return fn(); } catch (e) { return fallback; } }
const isId = v => typeof v === 'string' && v.length > 0 && v.length <= 64;
const pad2 = n => String(n).padStart(2, '0');

// Radbrytningar och andra styrtecken blir mellanslag; tecken som vänder textriktning tas bort
const CTRL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
const BIDI = /[\u202a-\u202e\u2066-\u2069]/g;
function cleanText(value) {
    if (typeof value !== 'string') return '';
    return value.replace(BIDI, '').replace(CTRL, ' ').replace(/ {2,}/g, ' ').trim();
}

function clip(text, max) {
    if (text.length <= max) return text;
    let end = max;
    const c = text.charCodeAt(end - 1);
    if (c >= 0xd800 && c <= 0xdbff) end--; // dela inte ett surrogatpar (emoji)
    return text.slice(0, end).trimEnd();
}
const shortText = (v, max) => (typeof v === 'string' ? clip(cleanText(v), max) : '');

function makeId() {
    return Date.now().toString(36) + (idSeq++).toString(36) + Math.random().toString(36).slice(2, 8);
}

function myId() {
    const v = safe(() => api.myId(), null);
    return isId(v) ? v : null;
}

// ── Tid ──
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
const clock = ts => { const d = new Date(ts); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
function startOfDay(ts) { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime(); }
const dayDiff = (ts, now) => Math.round((startOfDay(now) - startOfDay(ts)) / 86400000);
function dateLabel(ts, now) {
    const d = new Date(ts);
    const year = d.getFullYear() !== new Date(now).getFullYear() ? ' ' + d.getFullYear() : '';
    return `${d.getDate()} ${MONTHS[d.getMonth()]}${year}`;
}
// "14:32" idag, annars datum ("12 okt")
export function formatSmsTime(ts, now = Date.now()) {
    if (!Number.isFinite(ts)) return '';
    return dayDiff(ts, now) <= 0 ? clock(ts) : dateLabel(ts, now);
}
function dayLabel(ts, now = Date.now()) {
    const diff = dayDiff(ts, now);
    return diff <= 0 ? 'Idag' : diff === 1 ? 'Igår' : dateLabel(ts, now);
}

// ── Lagring ──
// Nyckeln räknas om vid varje anrop: byter konto eller rum följer historiken med.
function keyFor() {
    const acc = safe(() => api.accountKey(), null);
    const room = safe(() => api.roomId(), null);
    return `hustle_sms_v1_${acc || 'guest'}_${room || 'local'}`;
}

function storage() { try { return globalThis.localStorage || null; } catch (e) { return null; } }

function incomingCount(list) { let n = 0; for (const m of list) if (m.dir === 'in') n++; return n; }

// Ett sparat SMS granskas som om det kom utifrån (filen kan vara trasig eller ändrad)
function cleanStored(m) {
    if (!m || typeof m !== 'object' || !isId(m.id) || (m.dir !== 'in' && m.dir !== 'out')) return null;
    const text = clip(cleanText(m.text), L.maxLength);
    const ts = Number(m.ts);
    if (!text || !Number.isFinite(ts)) return null;
    const msg = { id: m.id, dir: m.dir, text, ts };
    if (m.dir === 'out') {
        // Väntade på ack när sidan stängdes → vi vet inte om det kom fram, alltså misslyckat
        msg.state = m.state === 'delivered' ? 'delivered' : 'failed';
        if (msg.state === 'failed') msg.reason = m.state === 'pending' ? 'restart' : (knownReason(m.reason) ? m.reason : undefined);
        if (msg.reason === undefined) delete msg.reason;
    }
    return msg;
}

function parse(raw) {
    const out = emptyData();
    let p = null;
    try { p = JSON.parse(raw); } catch (e) { return out; }
    if (!p || typeof p !== 'object') return out;
    const obj = v => (v && typeof v === 'object' && !Array.isArray(v) ? v : {});
    for (const [id, list] of Object.entries(obj(p.convos))) {
        if (!isId(id) || !Array.isArray(list)) continue;
        const msgs = list.map(cleanStored).filter(Boolean).slice(-L.maxPerChat);
        if (msgs.length) out.convos.set(id, msgs);
    }
    for (const [id, n] of Object.entries(obj(p.unread))) {
        const list = out.convos.get(id);
        const count = Math.min(Math.floor(Number(n)), MAX_UNREAD, list ? incomingCount(list) : 0);
        if (count > 0) out.unread.set(id, count);
    }
    if (Array.isArray(p.blocked)) for (const id of p.blocked) if (isId(id)) out.blocked.add(id);
    for (const [id, m] of Object.entries(obj(p.meta))) {
        if (!isId(id)) continue;
        const name = shortText(m && m.name, 24), icon = shortText(m && m.icon, 16);
        if (name || icon) out.meta.set(id, { name, icon });
    }
    return out;
}

function persist() {
    if (!loadedKey) return;
    try {
        storage()?.setItem(loadedKey, JSON.stringify({
            v: 1,
            convos: Object.fromEntries(data.convos),
            unread: Object.fromEntries(data.unread),
            blocked: [...data.blocked],
            meta: Object.fromEntries(data.meta)
        }));
    } catch (e) { /* lagringen full eller blockerad: vi kör vidare i minnet */ }
}

// Gör sig redo (och byter historik om konto/rum ändrats). false = initSms har inte körts.
function ensure() {
    if (!api) return false;
    const key = keyFor();
    if (key !== loadedKey) {
        clearAckTimers();
        hideToast();
        loadedKey = key;
        const raw = safe(() => storage()?.getItem(key), null);
        data = raw ? parse(raw) : emptyData();
        notify();
    }
    return true;
}

function commit() { persist(); notify(); }

function notify() {
    for (const cb of [...listeners]) {
        try { cb(); } catch (e) { console.warn('SMS-lyssnare kastade fel', e); }
    }
    refreshViews();
}

// ── Kontakter ──
function players() {
    const list = safe(() => api.players(), []);
    const me = myId();
    const seen = new Set();
    const out = [];
    for (const p of Array.isArray(list) ? list : []) {
        if (!p || !isId(p.id) || p.id === me || seen.has(p.id)) continue;
        seen.add(p.id);
        out.push({ id: p.id, name: shortText(p.name, 24) || 'Spelare', icon: shortText(p.icon, 16) || '👤', online: !!p.online });
    }
    return out;
}

// Online först, sedan i bokstavsordning
function sortedPlayers() {
    return players().sort((a, b) => (b.online - a.online) || a.name.localeCompare(b.name, 'sv'));
}

// Vem är det? Lämnade spelare minns vi från sparat namn.
function contactInfo(id) {
    const p = players().find(x => x.id === id);
    if (p) {
        const saved = data.meta.get(id);
        if (!saved || saved.name !== p.name || saved.icon !== p.icon) data.meta.set(id, { name: p.name, icon: p.icon }); // sparas vid nästa ändring
        return { ...p, present: true };
    }
    const m = data.meta.get(id);
    return { id, name: (m && m.name) || 'Okänd spelare', icon: (m && m.icon) || '👤', online: false, present: false };
}

function rememberContact(id) {
    const p = players().find(x => x.id === id);
    if (p) data.meta.set(id, { name: p.name, icon: p.icon });
}

// ── Samtal ──
function push(id, msg) {
    let list = data.convos.get(id);
    if (!list) { list = []; data.convos.set(id, list); }
    list.push(msg);
    while (list.length > L.maxPerChat) clearAckTimer(list.shift().id);
}

function findOutgoing(id) {
    if (!isId(id)) return null;
    for (const [contactId, list] of data.convos) {
        for (let i = list.length - 1; i >= 0; i--) {
            if (list[i].dir === 'out' && list[i].id === id) return { contactId, msg: list[i] };
        }
    }
    return null;
}

export function getSmsConversation(contactId) {
    if (!ensure()) return [];
    return (data.convos.get(contactId) || []).map(m => ({ ...m }));
}

export function getSmsConversations() {
    if (!ensure()) return [];
    const out = [];
    for (const [id, list] of data.convos) {
        const last = list[list.length - 1];
        if (!last) continue;
        out.push({ ...contactInfo(id), last: { ...last }, unread: data.unread.get(id) || 0, blocked: data.blocked.has(id) });
    }
    return out.sort((a, b) => b.last.ts - a.last.ts);
}

export function smsUnread() {
    if (!ensure()) return 0;
    let n = 0;
    for (const v of data.unread.values()) n += v;
    return n;
}

export function markSmsRead(contactId) {
    if (!ensure() || !(data.unread.get(contactId) > 0)) return;
    data.unread.delete(contactId);
    commit();
}

// ── Block ──
export function isSmsBlocked(contactId) { return ensure() && data.blocked.has(contactId); }

export function blockSmsContact(contactId) {
    if (!ensure() || !isId(contactId)) return false;
    if (!data.blocked.has(contactId)) {
        data.blocked.add(contactId);
        data.unread.delete(contactId);
        commit();
    }
    return true;
}

export function unblockSmsContact(contactId) {
    if (!ensure() || !data.blocked.has(contactId)) return false;
    data.blocked.delete(contactId);
    commit();
    return true;
}

// ── Skicka ──
const fail = (error, message) => ({ ok: false, error, message });

// Hastighetsgräns i klienten (värden kontrollerar också). Returnerar felmeddelande eller null.
function rateGate(now) {
    sendLog = sendLog.filter(t => now - t < L.burstWindowMs);
    const last = sendLog[sendLog.length - 1];
    if (last !== undefined && now - last < L.minGapMs) return 'Vänta en sekund innan nästa SMS';
    if (sendLog.length >= L.burstMax) {
        const wait = Math.max(1, Math.ceil((L.burstWindowMs - (now - sendLog[0])) / 1000));
        return `Max ${L.burstMax} SMS per ${L.burstWindowMs / 1000} sekunder – vänta ${wait} s`;
    }
    return null;
}

function clearAckTimer(id) {
    const t = ackTimers.get(id);
    if (t !== undefined) { clearTimeout(t); ackTimers.delete(id); }
}
function clearAckTimers() { for (const t of ackTimers.values()) clearTimeout(t); ackTimers.clear(); }

function startAckTimer(id) {
    clearAckTimer(id);
    ackTimers.set(id, setTimeout(() => {
        ackTimers.delete(id);
        const f = findOutgoing(id);
        if (f && f.msg.state === 'pending') settle(f.msg, 'failed', 'timeout');
    }, L.ackTimeoutMs));
}

function settle(msg, state, reason) {
    msg.state = state;
    if (state === 'failed' && knownReason(reason)) msg.reason = reason; else delete msg.reason;
    clearAckTimer(msg.id);
    commit();
}

// Lämna över till nätverket. "Levererat" sätts bara av smsAck, aldrig här.
function dispatch(to, msg) {
    msg.state = 'pending';
    delete msg.reason;
    sendLog.push(Date.now());
    commit(); // ⏳ syns direkt
    let ok;
    try { ok = api.send(to, msg.text, msg.id); } catch (e) { ok = false; }
    if (msg.state !== 'pending') return; // ack hann före (synkron loopback)
    if (ok === false) settle(msg, 'failed', 'offline');
    else startAckTimer(msg.id);
}

// Skicka ett SMS. { ok: true, msg } när det lagts i samtalet (msg.state kan redan vara 'failed'
// om nätverket inte kunde skicka), annars { ok: false, error, message } med svensk text.
export function sendSms(to, text) {
    if (!ensure() || !myId()) return fail('offline', 'Spela online för att skicka SMS');
    if (!isId(to) || to === myId()) return fail('invalid', 'Välj vem du vill skicka till');
    if (data.blocked.has(to)) return fail('blocked', `Du har blockerat ${contactInfo(to).name}`);
    const clean = cleanText(text);
    if (!clean) return fail('empty', 'Skriv något först');
    if (clean.length > L.maxLength) return fail('toolong', `Max ${L.maxLength} tecken (du har ${clean.length})`);
    const wait = rateGate(Date.now());
    if (wait) return fail('rate', wait);
    rememberContact(to);
    const msg = { id: makeId(), dir: 'out', text: clean, ts: Date.now(), state: 'pending' };
    push(to, msg);
    dispatch(to, msg);
    return { ok: true, msg: { ...msg } };
}

// "Försök igen": samma id, så att mottagaren kan sålla bort en dubblett om första gången kom fram
export function retrySms(msgId) {
    if (!ensure() || !myId()) return fail('offline', 'Spela online för att skicka SMS');
    const f = findOutgoing(msgId);
    if (!f || f.msg.state !== 'failed') return fail('invalid', 'Det här SMS:et går inte att skicka igen');
    if (data.blocked.has(f.contactId)) return fail('blocked', `Du har blockerat ${contactInfo(f.contactId).name}`);
    const wait = rateGate(Date.now());
    if (wait) return fail('rate', wait);
    dispatch(f.contactId, f.msg);
    return { ok: true, msg: { ...f.msg } };
}

// ── Ta emot ──
// Nätverket skickar vidare ackar. Svar: 'delivered' eller 'blocked' (även för skräp).
export function smsIncoming(input) {
    if (!ensure()) return 'blocked';
    const me = myId();
    const from = input && input.from;
    if (!me || !isId(from) || from === me || data.blocked.has(from)) return 'blocked';
    // Texten kommer från en annan webbläsare: rensa och korta även om värden redan gjort det.
    // Avsändarens ts används inte (klockor går olika och ordningen i samtalet ska vara stabil).
    const text = clip(cleanText(input.text), L.maxLength);
    if (!text) return 'blocked';
    const id = isId(input.id) ? input.id : makeId();
    const list = data.convos.get(from) || [];
    if (list.some(m => m.dir === 'in' && m.id === id)) return 'delivered'; // dubblett (omsändning)

    rememberContact(from);
    push(from, { id, dir: 'in', text, ts: Date.now() });
    const viewing = isViewing(from);
    if (!viewing) {
        const mine = data.convos.get(from);
        data.unread.set(from, Math.min((data.unread.get(from) || 0) + 1, MAX_UNREAD, incomingCount(mine)));
    }
    commit();
    if (!viewing) {
        safe(() => api.notify && api.notify(), null);
        safe(() => showToast(from, text), null);
    }
    return 'delivered';
}

// Svar från nätverket på något jag skickat. Okänt id ignoreras.
export function smsAck(ack) {
    if (!ensure() || !ack || typeof ack !== 'object') return;
    const f = findOutgoing(ack.id);
    if (!f) return;
    const { msg } = f;
    if (msg.state === 'delivered') return; // levererat är slutgiltigt
    if (ack.status === 'delivered') settle(msg, 'delivered');
    else if (ack.status === 'failed') settle(msg, 'failed', ack.reason);
}

export function onSmsChange(cb) {
    if (typeof cb !== 'function') return () => { };
    const entry = () => cb();
    listeners.add(entry);
    return () => { listeners.delete(entry); };
}

// Starta om lyssnandet och läs in historiken för aktuellt konto och rum.
// Anropas när du gått med i (eller lämnat) ett rum.
export function initSms(newApi) {
    api = newApi && typeof newApi === 'object' ? newApi : null;
    sendLog = [];
    loadedKey = null;
    if (!api) { clearAckTimers(); hideToast(); data = emptyData(); notify(); return; }
    ensure();
}

// Be öppna vyer rita om (t.ex. när spelarlistan eller online-status ändrats)
export function refreshSms() { ensure(); refreshViews(); }

// ══════════════════════════════════════════════
//  UI — bara DOM-API:er i funktionerna nedan
// ══════════════════════════════════════════════

// All text läggs som textnoder/textContent — aldrig som HTML
function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
        if (v === undefined || v === null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : String(v));
    }
    for (const kid of kids.flat()) {
        if (kid === undefined || kid === null || kid === false) continue;
        el.append(typeof kid === 'object' ? kid : String(kid));
    }
    return el;
}

const finePointer = () => safe(() => window.matchMedia('(pointer: fine)').matches, false);

function viewVisible(view) {
    const el = view.root;
    if (!el.isConnected) return false;
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return false;
    return typeof el.getClientRects !== 'function' || el.getClientRects().length > 0;
}

// Tittar jag på det här samtalet just nu? (då behövs varken olästmärke eller notis)
function isViewing(contactId) {
    for (const v of views) {
        if (v.shown === 'chat' && v.shownContact === contactId && !v.dead && viewVisible(v)) return true;
    }
    return false;
}

function refreshViews() {
    for (const v of [...views]) {
        if (!v.alive()) { v.destroy(); continue; }
        try { v.update(); } catch (e) { console.warn('SMS-vyn kunde inte ritas om', e); }
    }
}

// Spelare kommer och går utan att något SMS skickas: kolla då och då om listan ändrats
let pollTimer = null, lastSig = '';
function presenceSig() { return [myId(), ...players().map(p => `${p.id}|${p.name}|${p.icon}|${p.online ? 1 : 0}`)].join(';'); }
function pollTick() {
    for (const v of [...views]) if (!v.alive()) v.destroy();
    if (!views.size) return;
    if (typeof document !== 'undefined' && document.hidden) return;
    if (!ensure()) return;
    const sig = presenceSig();
    if (sig !== lastSig) { lastSig = sig; refreshViews(); }
}
function startPoll() { if (!pollTimer) { lastSig = presenceSig(); pollTimer = setInterval(pollTick, 2000); } }
function stopPollIfIdle() { if (!views.size && pollTimer) { clearInterval(pollTimer); pollTimer = null; } }

const STATE_LABEL = {
    pending: ['⏳ Skickas', 'wait'],
    delivered: ['✓ Levererat', 'ok'],
    failed: ['⚠️ Misslyckades', 'bad']
};

// Ligger rutan (nästan) längst ner? Då ska den följa med när innehållet eller höjden ändras.
const nearBottom = box => box.scrollHeight - box.scrollTop - box.clientHeight < 80;

function avatar(c, small) {
    return h('span', { class: `sms-avatar${small ? ' sms-avatar-sm' : ''} ${c.online ? 'on' : 'off'}` }, c.icon, h('span', { class: 'sms-dot' }));
}

// Renderar hela appen i en container. Telefonen (renderSmsApp) och overlayen delar den här.
function mountApp(container, opts = {}) {
    if (!container || typeof document === 'undefined') return null;
    const prev = mounted.get(container);
    if (prev) prev.destroy();
    for (const v of [...views]) if (!v.alive()) v.destroy();

    const root = h('div', { class: 'sms-app ' + (opts.overlay ? 'sms-in-overlay' : 'sms-embedded') });
    const view = {
        root, opts, screen: 'list', contactId: null, shown: '', shownContact: null,
        dead: false, wasConnected: false, stick: true, drafts: new Map(), errTimer: 0,
        headEl: null, headSig: '', msgsEl: null, msgSig: '', footEl: null, footBlocked: false,
        input: null, countEl: null, sendBtn: null, errEl: null, blockBtn: null, scroller: null
    };

    // ── Navigering ──
    function go(screen) {
        view.screen = screen;
        view.contactId = null;
        render();
    }
    function openChat(id) {
        if (!isId(id)) return;
        view.screen = 'chat';
        view.contactId = id;
        view.stick = true;
        render();
        markSmsRead(id);
        if (view.input && finePointer()) view.input.focus();
    }

    function modeOf() {
        if (!api || !myId()) return 'empty';
        if (!players().length && !data.convos.size) return 'empty';
        if (view.screen === 'chat' && view.contactId) return 'chat';
        return view.screen === 'new' ? 'new' : 'list';
    }

    // ── Gemensamma delar ──
    const closeBtn = () => opts.onClose
        ? h('button', { class: 'sms-icon-btn sms-close', type: 'button', 'aria-label': 'Stäng', onclick: opts.onClose }, '✕')
        : null;
    const backBtn = target => h('button', { class: 'sms-icon-btn sms-back', type: 'button', 'aria-label': 'Tillbaka', onclick: () => go(target) }, '←');

    function title(text) {
        return h('div', { class: 'sms-head-main' }, h('div', { class: 'sms-title', text }));
    }

    // extra = samtalsrad (tid, olästa). Utan extra är det en kontaktrad: offline tonas ner.
    function contactRow(c, onOpen, line, extra) {
        const cls = `sms-row ${c.online ? 'on' : 'off'}${extra ? '' : ' contact'}${extra && extra.unread ? ' unread' : ''}`;
        return h('button', { class: cls, type: 'button', onclick: onOpen },
            avatar(c),
            h('span', { class: 'sms-row-main' },
                h('span', { class: 'sms-row-top' },
                    h('span', { class: 'sms-name', text: c.name }),
                    extra && extra.time ? h('span', { class: 'sms-time', text: extra.time }) : null),
                h('span', { class: 'sms-row-bottom' },
                    h('span', { class: 'sms-preview' + (!extra && c.online ? ' on' : ''), text: line }),
                    extra && extra.unread ? h('span', { class: 'sms-badge', text: extra.unread > 99 ? '99+' : String(extra.unread) }) : null)));
    }

    const playerStatus = c => (c.online ? 'Online' : 'Offline');

    // ── Skärmar ──
    function buildEmpty() {
        return [
            h('header', { class: 'sms-head' }, title(opts.overlay ? 'SMS' : 'Meddelanden'), closeBtn()),
            h('div', { class: 'sms-empty' },
                h('div', { class: 'sms-empty-icon' }, '💬'),
                h('strong', {}, 'Spela online för att skicka SMS till andra spelare'),
                h('p', {}, 'Skapa ett rum eller gå med i en kompis rum, så kan ni skicka SMS till varandra.'))
        ];
    }

    function buildList() {
        const convos = getSmsConversations();
        const body = h('div', { class: 'sms-body' });
        for (const c of convos) {
            const l = c.last;
            const line = c.blocked ? '🚫 Blockerad' : (l.dir === 'out' ? (l.state === 'failed' ? '⚠️ ' : 'Du: ') : '') + l.text;
            body.append(contactRow(c, () => openChat(c.id), line, { time: formatSmsTime(l.ts), unread: c.unread }));
        }
        if (!convos.length) {
            // Inga samtal än: visa direkt vilka man kan skriva till
            body.append(h('div', { class: 'sms-caption', text: 'Skriv till någon' }));
            const list = sortedPlayers();
            for (const c of list) body.append(contactRow(c, () => openChat(c.id), playerStatus(c)));
            if (!list.length) body.append(h('div', { class: 'sms-hint' }, 'Inga andra spelare i rummet just nu.'));
        }
        view.scroller = body;
        return [
            h('header', { class: 'sms-head' },
                title(opts.overlay ? 'SMS' : 'Samtal'),
                h('button', { class: 'sms-chip-btn', type: 'button', 'aria-label': 'Nytt SMS', onclick: () => go('new') }, '✏️ Nytt'),
                closeBtn()),
            body
        ];
    }

    function buildNew() {
        const body = h('div', { class: 'sms-body' }, h('div', { class: 'sms-caption', text: 'Välj mottagare' }));
        const list = sortedPlayers();
        for (const c of list) body.append(contactRow(c, () => openChat(c.id), playerStatus(c)));
        if (!list.length) body.append(h('div', { class: 'sms-hint' }, 'Inga andra spelare i rummet just nu.'));
        view.scroller = body;
        return [
            h('header', { class: 'sms-head' }, backBtn('list'), title('Nytt SMS'), closeBtn()),
            body
        ];
    }

    // ── Samtalsvyn ──
    function statusOf(c, blocked) {
        return blocked ? 'Blockerad' : !c.present ? 'Inte i rummet' : c.online ? 'Online' : 'Offline';
    }

    function fillHead() {
        const c = contactInfo(view.contactId);
        const blocked = isSmsBlocked(view.contactId);
        const status = statusOf(c, blocked);
        const sig = [c.name, c.icon, status, c.online].join('|');
        if (sig === view.headSig) return;
        view.headSig = sig;
        const refocus = view.blockBtn && document.activeElement === view.blockBtn;
        view.blockBtn = h('button', {
            class: 'sms-chip-btn' + (blocked ? ' on' : ''), type: 'button',
            'aria-label': blocked ? `Avblockera ${c.name}` : `Blockera ${c.name}`, onclick: toggleBlock
        }, blocked ? '✅ Avblockera' : '🚫 Blockera');
        // replaceChildren(null) skulle skriva ut texten "null": ta bara med det som finns
        view.headEl.replaceChildren(...[
            backBtn('list'),
            avatar(c, true),
            h('div', { class: 'sms-head-main' },
                h('div', { class: 'sms-name', text: c.name }),
                h('div', { class: 'sms-sub', text: status })),
            view.blockBtn,
            closeBtn()
        ].filter(Boolean));
        if (refocus) view.blockBtn.focus();
    }

    function toggleBlock() {
        const id = view.contactId;
        if (isSmsBlocked(id)) unblockSmsContact(id); else blockSmsContact(id);
    }

    function bubble(m, blocked) {
        if (m.dir === 'in') {
            return h('div', { class: 'sms-msg in' },
                h('div', { class: 'sms-bubble', text: m.text }),
                h('div', { class: 'sms-meta' }, h('span', { text: clock(m.ts) })));
        }
        const [label, tone] = STATE_LABEL[m.state] || STATE_LABEL.failed;
        const why = m.state === 'failed' ? (knownReason(m.reason) ? REASONS[m.reason] : 'Kunde inte skickas') : '';
        return h('div', { class: `sms-msg out ${m.state}` },
            h('div', { class: 'sms-bubble', text: m.text }),
            h('div', { class: 'sms-meta' },
                h('span', { text: clock(m.ts) }),
                h('span', { class: `sms-state ${tone}`, text: label }),
                m.state === 'failed' ? h('span', { class: 'sms-why', text: why }) : null,
                m.state === 'failed' && !blocked ? h('button', { class: 'sms-retry', type: 'button', onclick: () => retry(m.id) }, 'Försök igen') : null));
    }

    function fillMessages(force) {
        const box = view.msgsEl;
        const list = getSmsConversation(view.contactId);
        const blocked = isSmsBlocked(view.contactId);
        const sig = blocked + list.map(m => `${m.id}:${m.state || ''}:${m.reason || ''}`).join(',');
        if (!force && sig === view.msgSig) return;
        view.msgSig = sig;
        const stick = view.stick || nearBottom(box);
        view.stick = false;
        const kids = [];
        if (!list.length) kids.push(h('div', { class: 'sms-hint' }, 'Inga SMS än – skriv något!'));
        let day = '';
        for (const m of list) {
            const label = dayLabel(m.ts);
            if (label !== day) { kids.push(h('div', { class: 'sms-day', text: label })); day = label; }
            kids.push(bubble(m, blocked));
        }
        box.replaceChildren(...kids);
        if (stick) box.scrollTop = box.scrollHeight;
    }

    function flashError(text) {
        clearTimeout(view.errTimer);
        if (view.errEl) view.errEl.textContent = text || '';
        if (text) view.errTimer = setTimeout(() => flashError(''), 4000);
    }

    function retry(id) {
        view.stick = true;
        const res = retrySms(id);
        if (!res.ok) flashError(res.message);
    }

    // Räknare och skicka-knapp följer det som står i rutan
    function syncCompose() {
        if (!view.input) return;
        const len = cleanText(view.input.value).length;
        view.drafts.set(view.contactId, view.input.value);
        view.countEl.textContent = `${len}/${L.maxLength}`;
        view.countEl.className = 'sms-count' + (len > L.maxLength ? ' over' : len >= L.maxLength - 30 ? ' warn' : '');
        view.sendBtn.disabled = len === 0 || len > L.maxLength;
    }

    function submit() {
        if (!view.input) return;
        view.stick = true;
        const res = sendSms(view.contactId, view.input.value);
        if (!res.ok) {
            if (res.error !== 'empty') flashError(res.message); // tomt rutan ignoreras tyst
            return;
        }
        view.input.value = '';
        view.drafts.delete(view.contactId);
        flashError('');
        syncCompose();
        view.input.focus();
    }

    function fillFoot() {
        const id = view.contactId;
        view.footBlocked = isSmsBlocked(id);
        if (view.footBlocked) {
            view.input = view.countEl = view.sendBtn = view.errEl = null;
            view.footEl.className = 'sms-foot sms-foot-blocked';
            view.footEl.replaceChildren(
                h('span', { class: 'sms-blocked-text', text: `Du har blockerat ${contactInfo(id).name}. Inga SMS kommer fram.` }),
                h('button', { class: 'sms-chip-btn', type: 'button', onclick: toggleBlock }, 'Avblockera'));
            return;
        }
        view.footEl.className = 'sms-foot';
        const input = h('input', {
            class: 'sms-input', type: 'text', placeholder: 'Skriv ett SMS...', autocomplete: 'off',
            autocapitalize: 'sentences', enterkeyhint: 'send', 'aria-label': 'Meddelande'
        });
        input.value = view.drafts.get(id) || '';
        // Tangenter i rutan får aldrig nå Stan (som lyssnar på window): bara Enter skickar
        const isolate = e => e.stopPropagation();
        input.addEventListener('keyup', isolate);
        input.addEventListener('keypress', isolate);
        input.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); submit(); }
        });
        input.addEventListener('input', () => { if (view.errEl && view.errEl.textContent) flashError(''); syncCompose(); });
        view.input = input;
        view.errEl = h('span', { class: 'sms-error', role: 'alert' });
        view.countEl = h('span', { class: 'sms-count' });
        view.sendBtn = h('button', {
            class: 'sms-send', type: 'button', 'aria-label': 'Skicka',
            onmousedown: e => e.preventDefault(), // behåll fokus i rutan på dator
            onclick: submit
        }, '➤');
        view.footEl.replaceChildren(
            h('div', { class: 'sms-foot-row' }, view.errEl, view.countEl),
            h('form', { class: 'sms-compose', novalidate: true, onsubmit: e => { e.preventDefault(); submit(); } }, input, view.sendBtn));
        syncCompose();
    }

    function buildChat() {
        view.headEl = h('header', { class: 'sms-head' });
        view.headSig = '';
        view.msgsEl = h('div', { class: 'sms-msgs' });
        view.msgSig = '';
        view.scroller = view.msgsEl;
        view.footEl = h('footer', { class: 'sms-foot' });
        return [view.headEl, view.msgsEl, view.footEl];
    }

    // Kör fn (som kan ändra rutans höjd) och håll samtalet längst ner om det låg där
    function keepBottom(fn) {
        const box = view.msgsEl;
        const pinned = !!box && nearBottom(box);
        fn();
        if (pinned && view.msgsEl === box) box.scrollTop = box.scrollHeight;
    }

    function updateChat() {
        fillHead();
        if (isSmsBlocked(view.contactId) !== view.footBlocked) {
            keepBottom(() => {
                const focused = view.input && document.activeElement === view.input;
                fillFoot();
                if (focused && view.input) view.input.focus();
            });
        }
        fillMessages(false);
    }

    // ── Rita ──
    function render() {
        if (view.dead) return;
        const m = modeOf();
        const keep = view.scroller ? view.scroller.scrollTop : 0;
        const same = view.shown === m;
        view.shown = m;
        view.shownContact = view.contactId;
        view.scroller = view.input = view.errEl = view.countEl = view.sendBtn = null;
        view.headEl = view.msgsEl = view.footEl = view.blockBtn = null;
        flashError('');
        const parts = m === 'empty' ? buildEmpty() : m === 'new' ? buildNew() : m === 'chat' ? buildChat() : buildList();
        root.replaceChildren(...parts);
        if (m === 'chat') { fillHead(); fillFoot(); fillMessages(true); } // foten först: den tar plats av SMS-rutan
        else if (same && view.scroller) view.scroller.scrollTop = keep; // behåll scrollen när listan ritas om
        if (root.isConnected) view.wasConnected = true;
    }

    function update() {
        if (view.dead) return;
        if (root.isConnected) view.wasConnected = true;
        const m = modeOf();
        if (m === 'chat' && view.shown === 'chat' && view.shownContact === view.contactId) updateChat();
        else render();
    }

    // Tangentbordet i appen stannar i appen (Stan lyssnar på keydown/keyup på window)
    for (const type of ['keydown', 'keyup', 'keypress']) root.addEventListener(type, e => e.stopPropagation());
    root.addEventListener('keydown', e => {
        if (e.key === 'Escape' && opts.onClose && !e.isComposing) { e.preventDefault(); opts.onClose(); }
    });

    view.update = update;
    view.openChat = openChat;
    view.keepBottom = keepBottom;
    view.alive = () => !view.dead && (view.root.isConnected || !view.wasConnected);
    view.destroy = () => {
        if (view.dead) return;
        view.dead = true;
        clearTimeout(view.errTimer);
        views.delete(view);
        if (mounted.get(container) === view) mounted.delete(container);
        stopPollIfIdle();
    };

    container.replaceChildren(root);
    mounted.set(container, view);
    views.add(view);
    render();
    startPoll();
    return view;
}

// Appen inuti en container, t.ex. #phone-body i imperie-telefonen.
// Returnerar { destroy, openChat } — kan ignoreras (en vy städar själv när containern töms).
export function renderSmsApp(el) {
    ensure();
    const view = mountApp(el, {});
    return view ? { destroy: view.destroy, openChat: view.openChat } : null;
}

// ── Overlay (för Stan och andra helskärmsvyer) ──
let overlay = null; // { root, view, vv }

export function isSmsOverlayOpen() { return !!overlay; }

// Ligger ovanför allt; medan den är öppen får inga tangenter nå spelet bakom.
function onWinKey(e) {
    if (!overlay) return;
    if (e.type === 'keydown') {
        if (e.key === 'Escape' && !e.isComposing) { e.preventDefault(); e.stopPropagation(); closeSmsOverlay(); return; }
        if (e.key === 'Tab') trapTab(e);
    }
    const t = e.target;
    const inside = !!(t && t.nodeType && overlay.root.contains(t));
    if (!inside) e.stopPropagation(); // inuti stoppas de av appen själv, så att skrivandet funkar
}

function trapTab(e) {
    const items = [...overlay.root.querySelectorAll('button:not([disabled]), input:not([disabled])')];
    if (!items.length) return;
    const first = items[0], last = items[items.length - 1];
    const active = document.activeElement;
    if (!active || !overlay.root.contains(active)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && active === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus(); }
}

// Mobilens tangentbord krymper den synliga ytan: följ den så att skrivrutan syns
function fitOverlay() {
    const vv = typeof window !== 'undefined' && window.visualViewport;
    if (!vv || !overlay) return;
    const apply = () => {
        const s = overlay.root.style;
        s.top = vv.offsetTop + 'px';
        s.height = vv.height + 'px';
        s.bottom = 'auto';
    };
    if (overlay.view) overlay.view.keepBottom(apply); else apply();
}

export function openSmsOverlay(contactId) {
    if (typeof document === 'undefined' || !document.body) return;
    if (overlay) { if (isId(contactId)) overlay.view.openChat(contactId); return; }
    ensure();
    hideToast();
    const panel = h('div', { class: 'sms-panel', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'SMS' });
    const root = h('div', { class: 'sms-overlay' }, h('div', { class: 'sms-backdrop', onclick: () => closeSmsOverlay() }), panel);
    document.body.appendChild(root); // först i DOM, sedan montera: scrollen behöver mått
    const view = mountApp(panel, { overlay: true, onClose: () => closeSmsOverlay() });
    overlay = { root, view, vv: window.visualViewport || null };
    for (const type of ['keydown', 'keyup', 'keypress']) window.addEventListener(type, onWinKey, true);
    if (overlay.vv) { overlay.vv.addEventListener('resize', fitOverlay); overlay.vv.addEventListener('scroll', fitOverlay); }
    fitOverlay();
    if (isId(contactId)) view.openChat(contactId);
    // Stan släpper alla hållna tangenter när fönstret tappar fokus. Det som hölls när rutan
    // öppnades får annars aldrig sitt keyup (det stoppas här) och bilen rullar vidare på egen hand.
    safe(() => window.dispatchEvent(new Event('blur')), null);
}

export function closeSmsOverlay() {
    if (!overlay) return;
    const o = overlay;
    overlay = null;
    for (const type of ['keydown', 'keyup', 'keypress']) window.removeEventListener(type, onWinKey, true);
    if (o.vv) { o.vv.removeEventListener('resize', fitOverlay); o.vv.removeEventListener('scroll', fitOverlay); }
    o.view.destroy();
    o.root.remove();
}

// ── Notis (liten, diskret, ovanför Stans overlay) ──
let toastEl = null, toastTimer = 0, toastFor = null;

function hideToast() {
    clearTimeout(toastTimer);
    toastTimer = 0;
    toastFor = null;
    if (toastEl) { toastEl.remove(); toastEl = null; }
}

function showToast(contactId, text) {
    if (typeof document === 'undefined' || !document.body) return;
    const c = contactInfo(contactId);
    hideToast();
    toastFor = contactId;
    toastEl = h('div', {
        class: 'sms-toast', role: 'status',
        onclick: () => { const id = toastFor; hideToast(); openSmsOverlay(id); }
    },
        h('span', { class: 'sms-toast-icon', text: c.icon }),
        h('span', { class: 'sms-toast-body' },
            h('span', { class: 'sms-toast-name', text: c.name }),
            h('span', { class: 'sms-toast-text', text: text.length > 60 ? clip(text, 59) + '…' : text })));
    document.body.appendChild(toastEl);
    toastTimer = setTimeout(hideToast, L.toastMs);
}
