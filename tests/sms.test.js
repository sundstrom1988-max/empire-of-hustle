import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    initSms, smsIncoming, smsAck, smsUnread, onSmsChange, renderSmsApp,
    openSmsOverlay, closeSmsOverlay, isSmsOverlayOpen,
    sendSms, retrySms, markSmsRead, blockSmsContact, unblockSmsContact, isSmsBlocked,
    getSmsConversation, getSmsConversations, formatSmsTime, refreshSms, SMS_LIMITS
} from '../src/features/sms.js';

// ── Hjälpare ──
function memoryStorage() {
    const m = new Map();
    return {
        getItem: k => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: k => m.delete(k),
        clear: () => m.clear(),
        keys: () => [...m.keys()]
    };
}

// En låtsas-koppling till nätverket. state ändras mellan anrop precis som spelets riktiga värden.
function makeApi(over = {}) {
    const state = {
        me: 'kimit', room: 'KEBAB42', account: null,
        players: [
            { id: 'mehmet', name: 'Mehmet', icon: '🥙', online: true },
            { id: 'gargamel', name: 'Gargamel', icon: '🧙', online: false }
        ]
    };
    return {
        state,
        myId: () => state.me,
        players: () => state.players,
        send: vi.fn(() => true),
        accountKey: () => state.account,
        roomId: () => state.room,
        notify: vi.fn(),
        ...over
    };
}

const sec = ms => vi.advanceTimersByTime(ms);
const offs = [];
const listen = fn => { const off = onSmsChange(fn); offs.push(off); return off; }; // avregistreras efter varje test
const lastMsg = id => { const l = getSmsConversation(id); return l[l.length - 1]; };
const sentId = api => api.send.mock.calls.at(-1)[2];
let api, storage;

beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 9, 22, 12, 0, 0));
    storage = memoryStorage();
    globalThis.localStorage = storage;
    api = makeApi();
    initSms(api);
});

afterEach(() => {
    closeSmsOverlay();
    offs.splice(0).forEach(off => off());
    initSms(null);
    vi.useRealTimers();
    delete globalThis.localStorage;
});

// ══════════════════════════════════════════
//  Skicka
// ══════════════════════════════════════════
describe('skicka SMS', () => {
    it('skapar ett SMS som väntar och lämnar över det till nätverket', () => {
        const res = sendSms('mehmet', 'Hej Mehmet!');
        expect(res.ok).toBe(true);
        expect(res.msg.state).toBe('pending');
        expect(api.send).toHaveBeenCalledTimes(1);
        const [to, text, id] = api.send.mock.calls[0];
        expect([to, text]).toEqual(['mehmet', 'Hej Mehmet!']);
        expect(id).toBe(res.msg.id);
        expect(getSmsConversation('mehmet')).toHaveLength(1);
        expect(lastMsg('mehmet')).toMatchObject({ dir: 'out', text: 'Hej Mehmet!', state: 'pending' });
    });

    it('visar aldrig "levererat" utan ack', () => {
        sendSms('mehmet', 'hej');
        expect(lastMsg('mehmet').state).toBe('pending');
        sec(5000);
        expect(lastMsg('mehmet').state).toBe('pending');
    });

    it('trimmar texten och gör radbrytningar till mellanslag', () => {
        sendSms('mehmet', '  hej\n\nhopp\t ');
        expect(lastMsg('mehmet').text).toBe('hej hopp');
    });

    it('vägrar tomt SMS', () => {
        for (const t of ['', '   ', '\n\t', undefined, null, 42]) {
            const res = sendSms('mehmet', t);
            expect(res).toMatchObject({ ok: false, error: 'empty' });
            expect(res.message).toMatch(/\S/);
        }
        expect(api.send).not.toHaveBeenCalled();
        expect(getSmsConversation('mehmet')).toEqual([]);
    });

    it('tillåter 280 tecken men inte 281', () => {
        expect(SMS_LIMITS.maxLength).toBe(280);
        expect(sendSms('mehmet', 'x'.repeat(281))).toMatchObject({ ok: false, error: 'toolong' });
        expect(api.send).not.toHaveBeenCalled();
        expect(sendSms('mehmet', 'x'.repeat(280)).ok).toBe(true);
        expect(api.send).toHaveBeenCalledTimes(1);
    });

    it('räknar längden efter trim (blanksteg runt texten räknas inte)', () => {
        expect(sendSms('mehmet', '  ' + 'x'.repeat(280) + '  ').ok).toBe(true);
    });

    it('send() som ger false → misslyckat direkt', () => {
        api.send.mockReturnValue(false);
        const res = sendSms('mehmet', 'hej');
        expect(res.ok).toBe(true);
        expect(lastMsg('mehmet')).toMatchObject({ state: 'failed', reason: 'offline' });
        // och ingen timer lämnas kvar som kan ändra det
        sec(20000);
        expect(lastMsg('mehmet')).toMatchObject({ state: 'failed', reason: 'offline' });
    });

    it('send() som kastar fel → misslyckat', () => {
        api.send.mockImplementation(() => { throw new Error('nät'); });
        sendSms('mehmet', 'hej');
        expect(lastMsg('mehmet').state).toBe('failed');
    });

    it('en ack som kommer medan send() körs hanteras (synkron loopback)', () => {
        api.send.mockImplementation((to, text, id) => { smsAck({ id, status: 'delivered' }); return true; });
        sendSms('mehmet', 'hej');
        expect(lastMsg('mehmet').state).toBe('delivered');
        sec(20000);
        expect(lastMsg('mehmet').state).toBe('delivered');
    });

    it('kräver att jag är med i ett rum', () => {
        api.state.me = null;
        expect(sendSms('mehmet', 'hej')).toMatchObject({ ok: false, error: 'offline' });
        expect(api.send).not.toHaveBeenCalled();
    });

    it('vägrar skicka till mig själv eller till inget id', () => {
        expect(sendSms('kimit', 'hej').error).toBe('invalid');
        expect(sendSms('', 'hej').error).toBe('invalid');
        expect(sendSms(undefined, 'hej').error).toBe('invalid');
        expect(api.send).not.toHaveBeenCalled();
    });

    it('vägrar skicka till någon jag blockerat', () => {
        blockSmsContact('mehmet');
        expect(sendSms('mehmet', 'hej')).toMatchObject({ ok: false, error: 'blocked' });
        unblockSmsContact('mehmet');
        expect(sendSms('mehmet', 'hej').ok).toBe(true);
    });

    it('fungerar inte före initSms men kraschar inte', () => {
        initSms(null);
        expect(sendSms('mehmet', 'hej').ok).toBe(false);
        expect(smsUnread()).toBe(0);
        expect(getSmsConversations()).toEqual([]);
        expect(smsIncoming({ from: 'mehmet', text: 'hej', id: 'a' })).toBe('blocked');
        expect(() => smsAck({ id: 'a', status: 'delivered' })).not.toThrow();
    });
});

// ══════════════════════════════════════════
//  Hastighetsgräns
// ══════════════════════════════════════════
describe('hastighetsgräns', () => {
    it('minst 1 s mellan två SMS', () => {
        expect(sendSms('mehmet', 'ett').ok).toBe(true);
        const res = sendSms('mehmet', 'två');
        expect(res).toMatchObject({ ok: false, error: 'rate' });
        expect(res.message).toMatch(/sekund/i);
        expect(api.send).toHaveBeenCalledTimes(1);
        sec(999);
        expect(sendSms('mehmet', 'två').ok).toBe(false);
        sec(1);
        expect(sendSms('mehmet', 'två').ok).toBe(true);
    });

    it('högst 5 SMS per 10 s', () => {
        for (let i = 0; i < 5; i++) {
            expect(sendSms('mehmet', `sms ${i}`).ok).toBe(true);
            sec(1000);
        }
        // Fem skickade de senaste 5 sekunderna (t=0..4) och nu är det t=5
        const res = sendSms('mehmet', 'sex');
        expect(res).toMatchObject({ ok: false, error: 'rate' });
        expect(res.message).toMatch(/5 SMS/);
        expect(api.send).toHaveBeenCalledTimes(5);
        // Det första SMS:et (t=0) lämnar fönstret vid t=10
        sec(4000);
        expect(sendSms('mehmet', 'sex').error).toBe('rate'); // t=9
        sec(1000);
        expect(sendSms('mehmet', 'sex').ok).toBe(true); // t=10
    });

    it('nekade SMS räknas inte mot gränsen och hamnar inte i samtalet', () => {
        sendSms('mehmet', 'ett');
        for (let i = 0; i < 20; i++) sendSms('mehmet', 'spam'); // alla nekas av 1 s-regeln
        expect(getSmsConversation('mehmet')).toHaveLength(1);
        sec(1000);
        expect(sendSms('mehmet', 'två').ok).toBe(true);
    });

    it('"Försök igen" räknas också', () => {
        api.send.mockReturnValueOnce(false);
        sendSms('mehmet', 'hej');
        expect(retrySms(lastMsg('mehmet').id)).toMatchObject({ ok: false, error: 'rate' });
        sec(1000);
        expect(retrySms(lastMsg('mehmet').id).ok).toBe(true);
    });
});

// ══════════════════════════════════════════
//  Ack
// ══════════════════════════════════════════
describe('ack', () => {
    it('ack "delivered" → levererat', () => {
        sendSms('mehmet', 'hej');
        smsAck({ id: sentId(api), status: 'delivered' });
        expect(lastMsg('mehmet').state).toBe('delivered');
    });

    it('en levererad ack stoppar tidsgränsen', () => {
        sendSms('mehmet', 'hej');
        smsAck({ id: sentId(api), status: 'delivered' });
        sec(60000);
        expect(lastMsg('mehmet').state).toBe('delivered');
    });

    it('ack "failed" → misslyckat med orsak', () => {
        sendSms('mehmet', 'hej');
        smsAck({ id: sentId(api), status: 'failed', reason: 'blocked' });
        expect(lastMsg('mehmet')).toMatchObject({ state: 'failed', reason: 'blocked' });
    });

    it('okänd orsak sparas inte (men SMS:et blir ändå misslyckat)', () => {
        sendSms('mehmet', 'hej');
        smsAck({ id: sentId(api), status: 'failed', reason: '<script>' });
        const m = lastMsg('mehmet');
        expect(m.state).toBe('failed');
        expect(m.reason).toBeUndefined();
    });

    it('orsaker som råkar heta som objektets egna fält ("constructor" …) räknas som okända', () => {
        for (const reason of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
            sendSms('mehmet', 'hej ' + reason);
            smsAck({ id: sentId(api), status: 'failed', reason });
            expect(lastMsg('mehmet')).toMatchObject({ state: 'failed' });
            expect(lastMsg('mehmet').reason).toBeUndefined();
            sec(1000);
        }
        initSms(makeApi()); // och inte heller efter inläsning
        expect(getSmsConversation('mehmet').every(m => m.reason === 'restart' || m.reason === undefined)).toBe(true);
    });

    it('ingen ack inom 10 s → misslyckat', () => {
        expect(SMS_LIMITS.ackTimeoutMs).toBe(10000);
        sendSms('mehmet', 'hej');
        sec(9999);
        expect(lastMsg('mehmet').state).toBe('pending');
        sec(1);
        expect(lastMsg('mehmet')).toMatchObject({ state: 'failed', reason: 'timeout' });
    });

    it('en ack för okänt id ignoreras', () => {
        sendSms('mehmet', 'hej');
        const listener = vi.fn();
        listen(listener);
        smsAck({ id: 'finns-inte', status: 'delivered' });
        smsAck({ id: undefined, status: 'delivered' });
        smsAck({ status: 'failed' });
        smsAck(null);
        smsAck('skräp');
        expect(listener).not.toHaveBeenCalled();
        expect(lastMsg('mehmet').state).toBe('pending');
    });

    it('en ack med konstig status ändrar ingenting', () => {
        sendSms('mehmet', 'hej');
        smsAck({ id: sentId(api), status: 'ok' });
        smsAck({ id: sentId(api) });
        expect(lastMsg('mehmet').state).toBe('pending');
    });

    it('en ack kan inte "leverera" ett inkommande SMS', () => {
        smsIncoming({ from: 'mehmet', text: 'hallå', id: 'in-1' });
        smsAck({ id: 'in-1', status: 'delivered' });
        smsAck({ id: 'in-1', status: 'failed', reason: 'offline' });
        expect(lastMsg('mehmet')).toEqual(expect.objectContaining({ dir: 'in', text: 'hallå' }));
        expect(lastMsg('mehmet').state).toBeUndefined();
    });

    it('levererat är slutgiltigt: senare "failed" och tidsgräns ändrar inget', () => {
        sendSms('mehmet', 'hej');
        const id = sentId(api);
        smsAck({ id, status: 'delivered' });
        smsAck({ id, status: 'failed', reason: 'rate' });
        expect(lastMsg('mehmet').state).toBe('delivered');
    });

    it('en försenad "delivered" efter tidsgräns rättar till misslyckat', () => {
        sendSms('mehmet', 'hej');
        const id = sentId(api);
        sec(10000);
        expect(lastMsg('mehmet').state).toBe('failed');
        smsAck({ id, status: 'delivered' });
        expect(lastMsg('mehmet')).toMatchObject({ state: 'delivered' });
        expect(lastMsg('mehmet').reason).toBeUndefined();
    });

    it('"Försök igen" använder samma id och väntar på ny ack', () => {
        sendSms('mehmet', 'hej');
        const id = sentId(api);
        sec(10000);
        sec(1000);
        const res = retrySms(id);
        expect(res.ok).toBe(true);
        expect(api.send).toHaveBeenCalledTimes(2);
        expect(api.send.mock.calls[1]).toEqual(['mehmet', 'hej', id]);
        expect(getSmsConversation('mehmet')).toHaveLength(1);
        expect(lastMsg('mehmet')).toMatchObject({ state: 'pending' });
        expect(lastMsg('mehmet').reason).toBeUndefined();
        // gamla tidsgränsen får inte döda den nya sändningen
        sec(9000);
        expect(lastMsg('mehmet').state).toBe('pending');
        sec(1000);
        expect(lastMsg('mehmet').state).toBe('failed');
    });

    it('bara misslyckade SMS kan skickas igen', () => {
        sendSms('mehmet', 'hej');
        const id = sentId(api);
        sec(1000);
        expect(retrySms(id)).toMatchObject({ ok: false, error: 'invalid' });
        expect(retrySms('finns-inte').ok).toBe(false);
    });
});

// ══════════════════════════════════════════
//  Ta emot
// ══════════════════════════════════════════
describe('inkommande SMS', () => {
    it('sparas, ökar olästa och ger "delivered"', () => {
        expect(smsUnread()).toBe(0);
        const res = smsIncoming({ from: 'mehmet', text: 'Tja!', id: 'm1', ts: 123 });
        expect(res).toBe('delivered');
        expect(smsUnread()).toBe(1);
        expect(getSmsConversation('mehmet')).toEqual([{ id: 'm1', dir: 'in', text: 'Tja!', ts: Date.now() }]);
        sec(1000);
        smsIncoming({ from: 'mehmet', text: 'Hallå?', id: 'm2' });
        sec(1000);
        smsIncoming({ from: 'gargamel', text: 'Yo', id: 'g1' });
        expect(smsUnread()).toBe(3);
        const list = getSmsConversations();
        expect(list.map(c => [c.id, c.unread])).toEqual([['gargamel', 1], ['mehmet', 2]]);
        expect(list.find(c => c.id === 'mehmet')).toMatchObject({ name: 'Mehmet', icon: '🥙', unread: 2 });
    });

    it('avsändarens ts används inte (ordningen i samtalet ska vara stabil)', () => {
        smsIncoming({ from: 'mehmet', text: 'a', id: '1', ts: 1 });
        smsIncoming({ from: 'mehmet', text: 'b', id: '2', ts: 9e15 });
        expect(getSmsConversation('mehmet').map(m => m.ts)).toEqual([Date.now(), Date.now()]);
    });

    it('att öppna/markera som läst nollar olästa', () => {
        smsIncoming({ from: 'mehmet', text: 'a', id: '1' });
        smsIncoming({ from: 'mehmet', text: 'b', id: '2' });
        smsIncoming({ from: 'gargamel', text: 'c', id: '3' });
        markSmsRead('mehmet');
        expect(smsUnread()).toBe(1);
        expect(getSmsConversations().find(c => c.id === 'mehmet').unread).toBe(0);
        markSmsRead('gargamel');
        markSmsRead('finns-inte');
        expect(smsUnread()).toBe(0);
    });

    it('markera som läst när inget är olästa gör inget och meddelar ingen', () => {
        const listener = vi.fn();
        listen(listener);
        markSmsRead('mehmet');
        expect(listener).not.toHaveBeenCalled();
    });

    it('ringer notisljudet för nya SMS', () => {
        smsIncoming({ from: 'mehmet', text: 'a', id: '1' });
        expect(api.notify).toHaveBeenCalledTimes(1);
    });

    it('fungerar utan notify i api:t', () => {
        initSms(makeApi({ notify: undefined }));
        expect(smsIncoming({ from: 'mehmet', text: 'a', id: '1' })).toBe('delivered');
    });

    it('en dubblett (samma id) sparas inte två gånger men bekräftas', () => {
        expect(smsIncoming({ from: 'mehmet', text: 'a', id: 'x' })).toBe('delivered');
        expect(smsIncoming({ from: 'mehmet', text: 'a', id: 'x' })).toBe('delivered');
        expect(getSmsConversation('mehmet')).toHaveLength(1);
        expect(smsUnread()).toBe(1);
        expect(api.notify).toHaveBeenCalledTimes(1);
    });

    it('samma id från två olika avsändare är två olika SMS', () => {
        smsIncoming({ from: 'mehmet', text: 'a', id: 'x' });
        smsIncoming({ from: 'gargamel', text: 'b', id: 'x' });
        expect(smsUnread()).toBe(2);
    });

    it('ett inkommande SMS med samma id som mitt påverkar inte mitt SMS eller dess ack', () => {
        sendSms('mehmet', 'hej');
        const id = sentId(api);
        smsIncoming({ from: 'gargamel', text: 'fusk', id });
        smsAck({ id, status: 'delivered' });
        expect(lastMsg('mehmet')).toMatchObject({ dir: 'out', state: 'delivered', text: 'hej' });
        expect(lastMsg('gargamel')).toMatchObject({ dir: 'in', text: 'fusk' });
    });

    it('skräp nekas ("blocked") och sparas inte', () => {
        const bad = [
            undefined, null, 'text', {},
            { from: '', text: 'a' },
            { from: 42, text: 'a' },
            { from: 'x'.repeat(65), text: 'a' },
            { from: 'kimit', text: 'jag skickar till mig själv' },
            { from: 'mehmet', text: '' },
            { from: 'mehmet', text: '   \n  ' },
            { from: 'mehmet', text: 123 },
            { from: 'mehmet', text: { toString: () => 'x' } }
        ];
        for (const b of bad) expect(smsIncoming(b)).toBe('blocked');
        expect(smsUnread()).toBe(0);
        expect(getSmsConversations()).toEqual([]);
        expect(api.notify).not.toHaveBeenCalled();
    });

    it('rensar text från andra: styrtecken, textriktning och överlånga SMS', () => {
        smsIncoming({ from: 'mehmet', text: 'a\u0000b\nc\u202Ed', id: '1' });
        expect(lastMsg('mehmet').text).toBe('a b cd');
        smsIncoming({ from: 'mehmet', text: 'y'.repeat(500), id: '2' });
        expect(lastMsg('mehmet').text).toHaveLength(280);
    });

    it('klipper inte mitt i en emoji', () => {
        smsIncoming({ from: 'mehmet', text: 'x'.repeat(279) + '😀', id: '1' });
        const t = lastMsg('mehmet').text;
        expect(t).toBe('x'.repeat(279));
        expect(t.charCodeAt(t.length - 1)).toBeLessThan(0xd800);
    });

    it('ett id från nätverket som inte är en sträng ersätts med ett eget', () => {
        smsIncoming({ from: 'mehmet', text: 'a', id: { evil: true } });
        smsIncoming({ from: 'mehmet', text: 'b' });
        const [a, b] = getSmsConversation('mehmet');
        expect(typeof a.id).toBe('string');
        expect(a.id).not.toBe(b.id);
    });

    it('ett konstigt id som "__proto__" gör ingen skada', () => {
        expect(smsIncoming({ from: '__proto__', text: 'hej', id: '1' })).toBe('delivered');
        expect(smsIncoming({ from: 'constructor', text: 'hej', id: '1' })).toBe('delivered');
        expect({}.polluted).toBeUndefined();
        expect(smsUnread()).toBe(2);
        initSms(api); // och det klarar en omstart
        expect(smsUnread()).toBe(2);
        expect(getSmsConversation('__proto__')).toHaveLength(1);
    });

    it('max 200 SMS per samtal – äldsta släpps', () => {
        for (let i = 0; i < 205; i++) smsIncoming({ from: 'mehmet', text: `m${i}`, id: `i${i}` });
        const list = getSmsConversation('mehmet');
        expect(list).toHaveLength(200);
        expect(list[0].text).toBe('m5');
        expect(list.at(-1).text).toBe('m204');
        expect(smsUnread()).toBe(200); // fler olästa än sparade SMS finns inte
    });

    it('max 200 gäller även mina egna SMS', () => {
        for (let i = 0; i < 203; i++) {
            expect(sendSms('mehmet', `s${i}`).ok).toBe(true);
            smsAck({ id: sentId(api), status: 'delivered' });
            sec(2000);
        }
        const list = getSmsConversation('mehmet');
        expect(list).toHaveLength(200);
        expect(list[0].text).toBe('s3');
    });
});

// ══════════════════════════════════════════
//  Blockera
// ══════════════════════════════════════════
describe('blockera', () => {
    it('SMS från en blockerad ger "blocked", sparas inte och väcker ingen notis', () => {
        blockSmsContact('mehmet');
        expect(isSmsBlocked('mehmet')).toBe(true);
        const listener = vi.fn();
        listen(listener);
        expect(smsIncoming({ from: 'mehmet', text: 'spam', id: 's1' })).toBe('blocked');
        expect(getSmsConversation('mehmet')).toEqual([]);
        expect(smsUnread()).toBe(0);
        expect(api.notify).not.toHaveBeenCalled();
        expect(listener).not.toHaveBeenCalled();
        // andra kommer fram som vanligt
        expect(smsIncoming({ from: 'gargamel', text: 'hej', id: 'g1' })).toBe('delivered');
    });

    it('avblockera släpper in SMS igen', () => {
        blockSmsContact('mehmet');
        expect(unblockSmsContact('mehmet')).toBe(true);
        expect(isSmsBlocked('mehmet')).toBe(false);
        expect(smsIncoming({ from: 'mehmet', text: 'hej', id: '1' })).toBe('delivered');
        expect(unblockSmsContact('mehmet')).toBe(false);
    });

    it('att blockera nollar olästa från den personen och historiken ligger kvar', () => {
        smsIncoming({ from: 'mehmet', text: 'hej', id: '1' });
        smsIncoming({ from: 'gargamel', text: 'yo', id: '2' });
        blockSmsContact('mehmet');
        expect(smsUnread()).toBe(1);
        expect(getSmsConversation('mehmet')).toHaveLength(1);
        expect(getSmsConversations().find(c => c.id === 'mehmet').blocked).toBe(true);
    });

    it('blockeringen överlever en omstart', () => {
        blockSmsContact('mehmet');
        initSms(makeApi());
        expect(isSmsBlocked('mehmet')).toBe(true);
        expect(smsIncoming({ from: 'mehmet', text: 'hej', id: '1' })).toBe('blocked');
    });

    it('ogiltiga id:n går inte att blockera', () => {
        expect(blockSmsContact('')).toBe(false);
        expect(blockSmsContact(undefined)).toBe(false);
    });
});

// ══════════════════════════════════════════
//  Lagring
// ══════════════════════════════════════════
describe('lagring', () => {
    it('sparar under hustle_sms_v1_<konto>_<rum>', () => {
        sendSms('mehmet', 'hej');
        expect(storage.keys()).toEqual(['hustle_sms_v1_guest_KEBAB42']);
        api.state.account = 'kimit';
        api.state.room = null;
        sec(1000); // hastighetsgränsen gäller över rumsbyten
        expect(sendSms('mehmet', 'hej igen').ok).toBe(true);
        expect(storage.keys()).toContain('hustle_sms_v1_kimit_local');
    });

    it('historiken finns kvar efter omstart med samma nycklar', () => {
        smsIncoming({ from: 'mehmet', text: 'tja', id: 'm1' });
        sendSms('mehmet', 'hej själv');
        smsAck({ id: sentId(api), status: 'delivered' });
        blockSmsContact('gargamel');

        initSms(makeApi()); // "ladda om sidan"
        expect(getSmsConversation('mehmet').map(m => [m.dir, m.text, m.state])).toEqual([
            ['in', 'tja', undefined], ['out', 'hej själv', 'delivered']
        ]);
        expect(smsUnread()).toBe(1);
        expect(isSmsBlocked('gargamel')).toBe(true);
        expect(getSmsConversations()).toHaveLength(1);
    });

    it('väntande SMS från förra sessionen blir misslyckade', () => {
        sendSms('mehmet', 'hej');
        expect(lastMsg('mehmet').state).toBe('pending');
        const fresh = makeApi();
        initSms(fresh);
        expect(lastMsg('mehmet')).toMatchObject({ state: 'failed', reason: 'restart' });
        // och inget hittar på att leverera det
        sec(60000);
        expect(lastMsg('mehmet').state).toBe('failed');
        expect(fresh.send).not.toHaveBeenCalled();
    });

    it('en försenad ack efter omstart kan fortfarande rätta till SMS:et', () => {
        sendSms('mehmet', 'hej');
        const id = sentId(api);
        initSms(makeApi());
        smsAck({ id, status: 'delivered' });
        expect(lastMsg('mehmet').state).toBe('delivered');
    });

    it('olika rum och konton har egna historiker', () => {
        smsIncoming({ from: 'mehmet', text: 'rum 1', id: '1' });
        initSms(Object.assign(makeApi(), { roomId: () => 'ANNAT7' }));
        expect(getSmsConversation('mehmet')).toEqual([]);
        expect(smsUnread()).toBe(0);
        smsIncoming({ from: 'mehmet', text: 'rum 2', id: '2' });
        initSms(makeApi({ accountKey: () => 'kimit' }));
        expect(getSmsConversation('mehmet')).toEqual([]);
        initSms(makeApi());
        expect(getSmsConversation('mehmet').map(m => m.text)).toEqual(['rum 1']);
    });

    it('byter historik när rum eller konto ändras utan ny initSms', () => {
        smsIncoming({ from: 'mehmet', text: 'rum 1', id: '1' });
        const listener = vi.fn();
        listen(listener);
        api.state.room = 'NYTT99';
        expect(smsUnread()).toBe(0);
        expect(listener).toHaveBeenCalled();
        api.state.room = 'KEBAB42';
        expect(smsUnread()).toBe(1);
    });

    it('återställer inget om lagringen är trasig (ogiltig JSON, fel typer)', () => {
        for (const raw of ['{not json', 'null', '42', '"text"', '[]', '{"convos":42}', '{"convos":{"mehmet":"fel"}}']) {
            storage.setItem('hustle_sms_v1_guest_KEBAB42', raw);
            expect(() => initSms(makeApi())).not.toThrow();
            expect(getSmsConversations()).toEqual([]);
            expect(smsUnread()).toBe(0);
        }
    });

    it('granskar sparad data som om den kom utifrån', () => {
        storage.setItem('hustle_sms_v1_guest_KEBAB42', JSON.stringify({
            convos: {
                mehmet: [
                    { id: 'a', dir: 'in', text: 'ok', ts: 5 },
                    { id: 'b', dir: 'in', text: 'z'.repeat(999), ts: 6 },
                    { id: 'c', dir: 'sidledes', text: 'fel riktning', ts: 7 },
                    { id: 'd', dir: 'out', text: 'ingen tid', ts: 'imorgon' },
                    { id: 'e', dir: 'out', text: 'levererat', ts: 8, state: 'delivered' },
                    { id: 'f', dir: 'out', text: 'tvivel', ts: 9, state: 'påhittat' },
                    { id: 'g', dir: 'out', text: 'väntade', ts: 10, state: 'pending' },
                    { id: 'h', dir: 'out', text: 'fel orsak', ts: 11, state: 'failed', reason: '<b>x</b>' },
                    { id: 12, dir: 'in', text: 'nummer som id', ts: 12 },
                    null, 'sträng', 42
                ]
            },
            unread: { mehmet: 9999, gargamel: 5 },
            blocked: ['gargamel', 42, '', null],
            meta: { mehmet: { name: 'N'.repeat(100), icon: 7 }, '': { name: 'x' } }
        }));
        initSms(makeApi());
        const list = getSmsConversation('mehmet');
        expect(list.map(m => m.id)).toEqual(['a', 'b', 'e', 'f', 'g', 'h']);
        expect(list[1].text).toHaveLength(280);
        expect(list.map(m => m.state)).toEqual([undefined, undefined, 'delivered', 'failed', 'failed', 'failed']);
        expect(list[4].reason).toBe('restart');
        expect(list[5].reason).toBeUndefined();
        expect(smsUnread()).toBe(2); // aldrig fler än de inkommande SMS som finns
        expect(isSmsBlocked('gargamel')).toBe(true);
    });

    it('max 200 SMS per samtal gäller även vid inläsning', () => {
        const msgs = Array.from({ length: 300 }, (_, i) => ({ id: `i${i}`, dir: 'in', text: `m${i}`, ts: i }));
        storage.setItem('hustle_sms_v1_guest_KEBAB42', JSON.stringify({ convos: { mehmet: msgs } }));
        initSms(makeApi());
        const list = getSmsConversation('mehmet');
        expect(list).toHaveLength(200);
        expect(list[0].text).toBe('m100');
    });

    it('klarar att localStorage kastar fel', () => {
        const angry = {
            getItem: () => { throw new Error('blockerad'); },
            setItem: () => { throw new Error('full'); }
        };
        globalThis.localStorage = angry;
        expect(() => initSms(makeApi())).not.toThrow();
        expect(smsIncoming({ from: 'mehmet', text: 'hej', id: '1' })).toBe('delivered');
        expect(sendSms('mehmet', 'svar').ok).toBe(true);
        expect(getSmsConversation('mehmet')).toHaveLength(2);
        expect(smsUnread()).toBe(1);
    });

    it('klarar att localStorage saknas helt', () => {
        delete globalThis.localStorage;
        expect(() => initSms(makeApi())).not.toThrow();
        expect(smsIncoming({ from: 'mehmet', text: 'hej', id: '1' })).toBe('delivered');
        expect(smsUnread()).toBe(1);
    });

    it('klarar att api-funktioner kastar fel eller saknas', () => {
        initSms({ myId: () => { throw new Error('x'); }, players: () => { throw new Error('y'); } });
        expect(smsIncoming({ from: 'mehmet', text: 'hej', id: '1' })).toBe('blocked');
        expect(sendSms('mehmet', 'hej').ok).toBe(false);
        initSms({ myId: () => 'kimit', send: () => true }); // ingen players/accountKey/roomId
        expect(smsIncoming({ from: 'mehmet', text: 'hej', id: '1' })).toBe('delivered');
        expect(storage.keys()).toContain('hustle_sms_v1_guest_local');
        expect(getSmsConversations()[0]).toMatchObject({ id: 'mehmet', name: 'Okänd spelare' });
    });
});

// ══════════════════════════════════════════
//  Kontakter och samtalslista
// ══════════════════════════════════════════
describe('samtalslistan', () => {
    it('senaste samtalet först, med senaste SMS och olästa', () => {
        smsIncoming({ from: 'gargamel', text: 'först', id: '1' });
        sec(5000);
        smsIncoming({ from: 'mehmet', text: 'sist', id: '2' });
        const [a, b] = getSmsConversations();
        expect([a.id, b.id]).toEqual(['mehmet', 'gargamel']);
        expect(a).toMatchObject({ name: 'Mehmet', icon: '🥙', online: true, unread: 1, last: { text: 'sist', dir: 'in' } });
        expect(b).toMatchObject({ name: 'Gargamel', online: false });
    });

    it('minns namn och ikon på spelare som lämnat rummet', () => {
        smsIncoming({ from: 'mehmet', text: 'hej', id: '1' });
        api.state.players = [];
        initSms(api);
        expect(getSmsConversations()[0]).toMatchObject({ id: 'mehmet', name: 'Mehmet', icon: '🥙', online: false, present: false });
    });

    it('lär sig namnet på en avsändare som inte fanns i spelarlistan när SMS:et kom', () => {
        api.state.players = []; // ingen i listan än
        smsIncoming({ from: 'nyss', text: 'hej', id: '1' });
        expect(getSmsConversations()[0]).toMatchObject({ name: 'Okänd spelare', icon: '👤' });
        api.state.players = [{ id: 'nyss', name: 'Nyss', icon: '🆕', online: true }];
        expect(getSmsConversations()[0]).toMatchObject({ name: 'Nyss', icon: '🆕', online: true });
        api.state.players = []; // lämnar rummet
        markSmsRead('nyss'); // ändring → sparas
        initSms(api); // omstart
        expect(getSmsConversations()[0]).toMatchObject({ name: 'Nyss', icon: '🆕', online: false, present: false });
    });

    it('ändringar i resultatet påverkar inte lagrade SMS', () => {
        sendSms('mehmet', 'hej');
        getSmsConversation('mehmet')[0].text = 'ändrad';
        getSmsConversations()[0].last.text = 'ändrad';
        expect(lastMsg('mehmet').text).toBe('hej');
    });
});

describe('onSmsChange', () => {
    it('meddelar vid skicka, ta emot, ack, läst och block – och kan avregistreras', () => {
        const cb = vi.fn();
        const off = listen(cb);
        sendSms('mehmet', 'hej');
        const n1 = cb.mock.calls.length;
        expect(n1).toBeGreaterThan(0);
        smsAck({ id: sentId(api), status: 'delivered' });
        const n2 = cb.mock.calls.length;
        expect(n2).toBeGreaterThan(n1);
        smsIncoming({ from: 'mehmet', text: 'svar', id: '1' });
        const n3 = cb.mock.calls.length;
        expect(n3).toBeGreaterThan(n2);
        markSmsRead('mehmet');
        const n4 = cb.mock.calls.length;
        expect(n4).toBeGreaterThan(n3);
        blockSmsContact('mehmet');
        expect(cb.mock.calls.length).toBeGreaterThan(n4);
        off();
        const before = cb.mock.calls.length;
        unblockSmsContact('mehmet');
        expect(cb.mock.calls.length).toBe(before);
    });

    it('en lyssnare som kastar fel stoppar inte de andra eller SMS:et', () => {
        const spy = vi.spyOn(console, 'warn').mockImplementation(() => { });
        listen(() => { throw new Error('trasig'); });
        const ok = vi.fn();
        listen(ok);
        expect(smsIncoming({ from: 'mehmet', text: 'hej', id: '1' })).toBe('delivered');
        expect(ok).toHaveBeenCalled();
        expect(smsUnread()).toBe(1);
        spy.mockRestore();
    });

    it('ignorerar något som inte är en funktion', () => {
        const off = listen(null);
        expect(() => off()).not.toThrow();
    });

    it('en lyssnare kan fråga smsUnread() medan den meddelas', () => {
        let seen = -1;
        listen(() => { seen = smsUnread(); });
        smsIncoming({ from: 'mehmet', text: 'hej', id: '1' });
        expect(seen).toBe(1);
    });
});

describe('tid', () => {
    it('visar klockslag idag och datum annars', () => {
        const now = new Date(2026, 9, 22, 14, 5).getTime();
        expect(formatSmsTime(new Date(2026, 9, 22, 9, 3).getTime(), now)).toBe('09:03');
        expect(formatSmsTime(new Date(2026, 9, 21, 23, 59).getTime(), now)).toBe('21 okt');
        expect(formatSmsTime(new Date(2026, 0, 5, 8, 0).getTime(), now)).toBe('5 jan');
        expect(formatSmsTime(new Date(2025, 11, 24, 8, 0).getTime(), now)).toBe('24 dec 2025');
        expect(formatSmsTime(NaN, now)).toBe('');
    });
});

// ══════════════════════════════════════════
//  Gränssnittet (liten låtsas-DOM; vitest körs utan webbläsare)
// ══════════════════════════════════════════
function installFakeDom() {
    const textNode = text => ({ nodeType: 3, text, parent: null });

    // Händelser som i riktiga DOM: capture uppifrån, mål, sedan bubbla uppåt. stopPropagation stoppar vidare färd.
    function dispatch(target, ev) {
        const path = [];
        for (let n = target; n; n = n.parent) path.push(n);
        const e = Object.assign({ type: ev.type }, ev, {
            target, defaultPrevented: false, stopped: false,
            preventDefault() { this.defaultPrevented = true; },
            stopPropagation() { this.stopped = true; }
        });
        const call = (node, phase) => {
            e.currentTarget = node;
            for (const l of [...(node.listeners || [])]) {
                if (l.type === e.type && (phase === null || l.capture === phase)) l.fn.call(node, e);
            }
        };
        for (let i = path.length - 1; i > 0 && !e.stopped; i--) call(path[i], true);
        if (!e.stopped) call(target, null);
        for (let i = 1; i < path.length && !e.stopped; i++) call(path[i], false);
        return e;
    }

    const targetMethods = {
        addEventListener(type, fn, opts) {
            const capture = opts === true || !!(opts && opts.capture);
            (this.listeners ||= []).push({ type, fn, capture });
        },
        removeEventListener(type, fn, opts) {
            const capture = opts === true || !!(opts && opts.capture);
            this.listeners = (this.listeners || []).filter(l => !(l.type === type && l.fn === fn && l.capture === capture));
        },
        dispatchEvent(ev) { return dispatch(this, ev); }
    };

    const win = { parent: null, listeners: [], visualViewport: undefined, matchMedia: () => ({ matches: true }), ...targetMethods };
    const doc = { nodeType: 9, parent: win, listeners: [], activeElement: null, visibilityState: 'visible', hidden: false, ...targetMethods };

    function createElement(tag) {
        const el = {
            nodeType: 1, tagName: tag.toUpperCase(), parent: null, children: [], attrs: {}, className: '', value: '',
            disabled: false, style: {}, scrollTop: 0, scrollHeight: 0, clientHeight: 0, listeners: [],
            ...targetMethods,
            setAttribute(k, v) { this.attrs[k] = String(v); },
            getAttribute(k) { return this.attrs[k] ?? null; },
            append(...items) {
                for (const it of items) {
                    // Som i riktiga DOM: allt som inte är en nod blir text ("null", "undefined" …)
                    const node = it && it.nodeType ? it : textNode(String(it));
                    if (node.parent) node.parent.children = node.parent.children.filter(c => c !== node);
                    node.parent = this;
                    this.children.push(node);
                }
            },
            appendChild(node) { this.append(node); return node; },
            replaceChildren(...items) {
                for (const c of this.children) c.parent = null;
                this.children = [];
                this.append(...items);
            },
            remove() { if (this.parent) { this.parent.children = this.parent.children.filter(c => c !== this); this.parent = null; } },
            contains(other) { for (let n = other; n; n = n.parent) if (n === this) return true; return false; },
            get isConnected() { let n = this; while (n.parent) n = n.parent; return n === win; },
            getClientRects() { return this.isConnected ? [{}] : []; },
            focus() { doc.activeElement = this; },
            click() { return dispatch(this, { type: 'click' }); },
            querySelectorAll() {
                const out = [];
                const walk = n => { for (const c of n.children || []) { if (c.nodeType === 1) { if ((c.tagName === 'BUTTON' || c.tagName === 'INPUT') && !c.disabled) out.push(c); walk(c); } } };
                walk(this);
                return out;
            },
            get textContent() { return this.children.map(c => (c.nodeType === 3 ? c.text : c.textContent)).join(''); },
            set textContent(v) { this.replaceChildren(String(v)); }
        };
        return el;
    }

    doc.createElement = createElement;
    doc.body = createElement('body');
    doc.body.parent = doc;
    globalThis.window = win;
    globalThis.document = doc;
    return { win, doc, dispatch };
}

describe('gränssnitt', () => {
    let dom, mounts;

    // Hjälpare som letar i den låtsade DOM:en
    const walk = (el, out = []) => { for (const c of el.children || []) { out.push(c); walk(c, out); } return out; };
    const els = (root, cls) => walk(root).filter(n => n.nodeType === 1 && n.className.split(/\s+/).includes(cls));
    const one = (root, cls) => els(root, cls)[0];
    const mount = () => {
        const box = dom.doc.createElement('div');
        dom.doc.body.append(box);
        const handle = renderSmsApp(box);
        mounts.push(handle);
        return box;
    };
    const press = (target, key, extra = {}) => dom.dispatch(target, { type: 'keydown', key, ...extra });
    const type = (input, text) => { input.value = text; dom.dispatch(input, { type: 'input' }); };
    const openChatWith = (box, name) => {
        const row = els(box, 'sms-row').find(r => r.textContent.includes(name));
        row.click();
        return one(box, 'sms-input');
    };

    beforeEach(() => {
        dom = installFakeDom();
        mounts = [];
    });

    afterEach(() => {
        closeSmsOverlay();
        for (const m of mounts) m && m.destroy();
        delete globalThis.window;
        delete globalThis.document;
    });

    it('visar ett vänligt tomt läge när jag inte är med i ett rum eller ingen annan finns', () => {
        api.state.me = null;
        let box = mount();
        expect(box.textContent).toContain('Spela online för att skicka SMS till andra spelare');
        api.state.me = 'kimit';
        api.state.players = [];
        box = mount();
        expect(box.textContent).toContain('Spela online för att skicka SMS till andra spelare');
        expect(els(box, 'sms-input')).toHaveLength(0);
    });

    it('kraschar inte om appen ritas innan initSms körts, och fylls i när den körs', () => {
        initSms(null);
        const box = mount();
        expect(box.textContent).toContain('Spela online för att skicka SMS till andra spelare');
        initSms(api);
        expect(els(box, 'sms-row').map(r => one(r, 'sms-name').textContent)).toEqual(['Mehmet', 'Gargamel']);
    });

    it('visar spelarna med online först och offline nedtonade när det inte finns samtal än', () => {
        api.state.players = [
            { id: 'a', name: 'Anna', icon: '👩', online: false },
            { id: 'b', name: 'Bosse', icon: '👨', online: true },
            { id: 'c', name: 'Cia', icon: '🧑', online: true }
        ];
        const rows = els(mount(), 'sms-row');
        expect(rows.map(r => one(r, 'sms-name').textContent)).toEqual(['Bosse', 'Cia', 'Anna']);
        expect(rows.map(r => r.className.includes(' off'))).toEqual([false, false, true]);
    });

    it('listar samtal med senaste SMS, klockslag och olästmärke', () => {
        smsIncoming({ from: 'mehmet', text: 'Hallå där', id: '1' });
        smsIncoming({ from: 'mehmet', text: 'Är du där?', id: '2' });
        const rows = els(mount(), 'sms-row');
        expect(rows).toHaveLength(1);
        expect(one(rows[0], 'sms-name').textContent).toBe('Mehmet');
        expect(one(rows[0], 'sms-preview').textContent).toBe('Är du där?');
        expect(one(rows[0], 'sms-time').textContent).toBe('12:00');
        expect(one(rows[0], 'sms-badge').textContent).toBe('2');
    });

    it('nytt SMS: välj mottagare och skriv', () => {
        smsIncoming({ from: 'mehmet', text: 'hej', id: '1' });
        const box = mount();
        els(box, 'sms-chip-btn').find(b => b.textContent.includes('Nytt')).click();
        expect(box.textContent).toContain('Välj mottagare');
        const input = openChatWith(box, 'Gargamel');
        expect(input).toBeTruthy();
        expect(box.textContent).toContain('Gargamel');
    });

    it('skriver aldrig ut "null" eller "undefined" i någon vy', () => {
        smsIncoming({ from: 'mehmet', text: 'hej', id: '1' });
        const box = mount();
        const bad = /null|undefined|NaN|\[object/;
        expect(box.textContent).not.toMatch(bad);
        els(box, 'sms-chip-btn').find(b => b.textContent.includes('Nytt')).click();
        expect(box.textContent).not.toMatch(bad);
        openChatWith(box, 'Mehmet');
        expect(box.textContent).not.toMatch(bad);
        sendSms('mehmet', 'svar');
        sec(10000);
        expect(box.textContent).toContain('Misslyckades');
        expect(box.textContent).not.toMatch(bad);
        els(box, 'sms-chip-btn').find(b => b.textContent.includes('Blockera')).click();
        expect(box.textContent).not.toMatch(bad);
        openSmsOverlay('gargamel');
        expect(one(dom.doc.body, 'sms-overlay').textContent).not.toMatch(bad);
    });

    it('text från andra läggs som text — aldrig som HTML', () => {
        const evil = '<img src=x onerror="alert(1)"><b>fet</b> &amp; <script>x()</script>';
        smsIncoming({ from: 'mehmet', text: evil, id: '1' });
        api.state.players = [{ id: 'mehmet', name: '<i>Meh</i>"met"', icon: '<u>🥙</u>', online: true }];
        const box = mount();
        // listan
        expect(one(box, 'sms-name').textContent).toBe('<i>Meh</i>"met"');
        expect(one(box, 'sms-preview').children.every(c => c.nodeType === 3)).toBe(true);
        // samtalet
        one(box, 'sms-row').click();
        const bubble = one(box, 'sms-bubble');
        expect(bubble.textContent).toBe(evil);
        expect(bubble.children).toHaveLength(1);
        expect(bubble.children[0].nodeType).toBe(3);
        // inga element alls har skapats av texten
        expect(walk(box).filter(n => n.nodeType === 1 && ['IMG', 'SCRIPT', 'B', 'I', 'U'].includes(n.tagName))).toEqual([]);
    });

    it('sändande: skicka med Enter, tomt fält töms, räknare och skicka-knapp följer texten', () => {
        const box = mount();
        const input = openChatWith(box, 'Mehmet');
        const send = one(box, 'sms-send');
        const count = one(box, 'sms-count');
        expect(count.textContent).toBe('0/280');
        expect(send.disabled).toBe(true);
        type(input, 'Tjena');
        expect(count.textContent).toBe('5/280');
        expect(send.disabled).toBe(false);
        const ev = press(input, 'Enter');
        expect(ev.defaultPrevented).toBe(true); // annars skickar formuläret en gång till
        expect(api.send).toHaveBeenCalledWith('mehmet', 'Tjena', expect.any(String));
        expect(input.value).toBe('');
        expect(one(box, 'sms-count').textContent).toBe('0/280');
        const bubble = one(box, 'sms-msg');
        expect(bubble.className).toContain('out');
        expect(bubble.className).toContain('pending');
        expect(bubble.textContent).toContain('⏳ Skickas');
    });

    it('Enter under pågående IME-inmatning skickar inte', () => {
        const input = openChatWith(mount(), 'Mehmet');
        type(input, 'こんにちは');
        press(input, 'Enter', { isComposing: true });
        press(input, 'Enter', { keyCode: 229 });
        expect(api.send).not.toHaveBeenCalled();
    });

    it('formuläret kan skicka själv (mobilens skicka-knapp) och knappen funkar', () => {
        const box = mount();
        const input = openChatWith(box, 'Mehmet');
        type(input, 'ett');
        dom.dispatch(one(box, 'sms-compose'), { type: 'submit' });
        expect(api.send).toHaveBeenCalledTimes(1);
        sec(1000);
        type(input, 'två');
        one(box, 'sms-send').click();
        expect(api.send).toHaveBeenCalledTimes(2);
    });

    it('visar fel inline och behåller texten när gränsen nås', () => {
        const box = mount();
        const input = openChatWith(box, 'Mehmet');
        type(input, 'ett');
        press(input, 'Enter');
        type(input, 'två');
        press(input, 'Enter'); // för snabbt
        expect(one(box, 'sms-error').textContent).toMatch(/Vänta en sekund/);
        expect(input.value).toBe('två');
        expect(api.send).toHaveBeenCalledTimes(1);
        type(input, 'tre');
        expect(one(box, 'sms-error').textContent).toBe(''); // felet försvinner när man skriver
        // för långt
        type(input, 'x'.repeat(281));
        expect(one(box, 'sms-count').className).toContain('over');
        expect(one(box, 'sms-send').disabled).toBe(true);
        sec(1000);
        press(input, 'Enter');
        expect(one(box, 'sms-error').textContent).toMatch(/Max 280/);
        expect(api.send).toHaveBeenCalledTimes(1);
    });

    it('visar SMS-status: skickas, levererat och misslyckat med "Försök igen"', () => {
        const box = mount();
        const input = openChatWith(box, 'Mehmet');
        type(input, 'hej');
        press(input, 'Enter');
        const id = sentId(api);
        expect(one(box, 'sms-msg').textContent).toContain('⏳ Skickas');
        smsAck({ id, status: 'delivered' });
        expect(one(box, 'sms-msg').textContent).toContain('✓ Levererat');
        sec(1000);
        type(input, 'igen');
        press(input, 'Enter');
        const id2 = sentId(api);
        smsAck({ id: id2, status: 'failed', reason: 'offline' });
        const failed = els(box, 'sms-msg')[1];
        expect(failed.textContent).toContain('⚠️ Misslyckades');
        expect(failed.textContent).toContain('Spelaren är offline');
        sec(1000);
        els(failed, 'sms-retry')[0].click();
        expect(api.send).toHaveBeenLastCalledWith('mehmet', 'igen', id2);
        expect(els(box, 'sms-msg')[1].textContent).toContain('⏳ Skickas');
        expect(els(box, 'sms-retry')).toHaveLength(0);
    });

    it('tangenter i skrivfältet når aldrig window (Stan lyssnar där)', () => {
        const box = mount();
        const input = openChatWith(box, 'Mehmet');
        const seen = [];
        for (const t of ['keydown', 'keyup', 'keypress']) dom.win.addEventListener(t, e => seen.push(e.type));
        for (const t of ['keydown', 'keyup', 'keypress']) {
            for (const key of ['w', 'a', 's', 'd', ' ', 'e', 'Enter', 'Escape', 'ArrowUp']) dom.dispatch(input, { type: t, key });
        }
        expect(seen).toEqual([]);
        // …men utanför appen går de fram som vanligt
        dom.dispatch(dom.doc.body, { type: 'keydown', key: 'w' });
        expect(seen).toEqual(['keydown']);
    });

    it('blockera från samtalets topp: skrivfältet byts mot en notis och SMS nekas', () => {
        const box = mount();
        openChatWith(box, 'Mehmet');
        els(box, 'sms-chip-btn').find(b => b.textContent.includes('Blockera')).click();
        expect(isSmsBlocked('mehmet')).toBe(true);
        expect(els(box, 'sms-input')).toHaveLength(0);
        expect(box.textContent).toContain('Du har blockerat Mehmet');
        expect(smsIncoming({ from: 'mehmet', text: 'hej', id: '1' })).toBe('blocked');
        els(box, 'sms-chip-btn').find(b => b.textContent.includes('Avblockera')).click();
        expect(isSmsBlocked('mehmet')).toBe(false);
        expect(els(box, 'sms-input')).toHaveLength(1);
    });

    it('ett misslyckat SMS till någon jag blockerat har ingen "Försök igen"-knapp', () => {
        const box = mount();
        openChatWith(box, 'Mehmet');
        sendSms('mehmet', 'hej');
        sec(10000);
        expect(els(box, 'sms-retry')).toHaveLength(1);
        blockSmsContact('mehmet');
        expect(els(box, 'sms-retry')).toHaveLength(0);
        unblockSmsContact('mehmet');
        expect(els(box, 'sms-retry')).toHaveLength(1);
    });

    it('blockerade kontakter märks i samtalslistan', () => {
        smsIncoming({ from: 'mehmet', text: 'hemligt', id: '1' });
        blockSmsContact('mehmet');
        const row = els(mount(), 'sms-row')[0];
        expect(one(row, 'sms-preview').textContent).toBe('🚫 Blockerad');
        expect(row.textContent).not.toContain('hemligt');
    });

    it('nya SMS i ett öppet samtal visas direkt, utan olästmärke eller notis', () => {
        const box = mount();
        openChatWith(box, 'Mehmet');
        expect(smsIncoming({ from: 'mehmet', text: 'live!', id: '1' })).toBe('delivered');
        expect(one(box, 'sms-msg').textContent).toContain('live!');
        expect(smsUnread()).toBe(0);
        expect(api.notify).not.toHaveBeenCalled();
        expect(dom.doc.body.children.filter(c => c.className === 'sms-toast')).toHaveLength(0);
    });

    it('SMS från andra medan jag läser ett annat samtal ger olästmärke och notis', () => {
        const box = mount();
        openChatWith(box, 'Mehmet');
        smsIncoming({ from: 'gargamel', text: 'psst', id: '1' });
        expect(smsUnread()).toBe(1);
        expect(api.notify).toHaveBeenCalledTimes(1);
        expect(els(dom.doc.body, 'sms-toast')).toHaveLength(1);
    });

    it('ett samtal i en dold telefon räknas inte som öppet', () => {
        const box = mount();
        openChatWith(box, 'Mehmet');
        box.style.display = 'none';
        box.getClientRects = () => []; // display:none ger inga rutor
        walk(box).forEach(n => { if (n.nodeType === 1) n.getClientRects = () => []; });
        smsIncoming({ from: 'mehmet', text: 'missar du?', id: '1' });
        expect(smsUnread()).toBe(1);
    });

    it('appen uppdateras när spelare går online utan att något SMS skickats', () => {
        api.state.players[1].online = false;
        const box = mount();
        expect(els(box, 'sms-row').map(r => r.className.includes(' off'))).toEqual([false, true]);
        api.state.players[1].online = true;
        sec(2100);
        expect(els(box, 'sms-row').map(r => r.className.includes(' off'))).toEqual([false, false]);
        api.state.players = [];
        refreshSms();
        expect(box.textContent).toContain('Spela online för att skicka SMS');
    });

    it('en bortbytt app (telefonen byter skärm) städas bort av sig själv', () => {
        const box = mount();
        box.replaceChildren('annan app');
        // utan att krascha: nästa händelse rensar ut den döda vyn
        expect(() => smsIncoming({ from: 'mehmet', text: 'hej', id: '1' })).not.toThrow();
        expect(smsUnread()).toBe(1);
    });

    describe('notis', () => {
        const toasts = () => els(dom.doc.body, 'sms-toast');

        it('visar avsändare och förhandsvisning, försvinner efter 4 s', () => {
            smsIncoming({ from: 'mehmet', text: 'Kom till kebaben nu!', id: '1' });
            expect(toasts()).toHaveLength(1);
            const t = toasts()[0];
            expect(one(t, 'sms-toast-icon').textContent).toBe('🥙');
            expect(one(t, 'sms-toast-name').textContent).toBe('Mehmet');
            expect(one(t, 'sms-toast-text').textContent).toBe('Kom till kebaben nu!');
            expect(api.notify).toHaveBeenCalledTimes(1);
            sec(3999);
            expect(toasts()).toHaveLength(1);
            sec(1);
            expect(toasts()).toHaveLength(0);
        });

        it('kortar långa förhandsvisningar och lägger text som text', () => {
            smsIncoming({ from: 'mehmet', text: '<b>' + 'ö'.repeat(100), id: '1' });
            const preview = one(toasts()[0], 'sms-toast-text');
            expect(preview.textContent.length).toBeLessThanOrEqual(61);
            expect(preview.textContent.startsWith('<b>')).toBe(true);
            expect(preview.children.every(c => c.nodeType === 3)).toBe(true);
        });

        it('en ny notis ersätter den gamla (bara en syns)', () => {
            smsIncoming({ from: 'mehmet', text: 'ett', id: '1' });
            smsIncoming({ from: 'gargamel', text: 'två', id: '2' });
            expect(toasts()).toHaveLength(1);
            expect(one(toasts()[0], 'sms-toast-name').textContent).toBe('Gargamel');
            sec(4000);
            expect(toasts()).toHaveLength(0);
        });

        it('klick öppnar overlayen direkt i samtalet och döljer notisen', () => {
            smsIncoming({ from: 'gargamel', text: 'psst', id: '1' });
            expect(isSmsOverlayOpen()).toBe(false);
            toasts()[0].click();
            expect(toasts()).toHaveLength(0);
            expect(isSmsOverlayOpen()).toBe(true);
            const overlay = one(dom.doc.body, 'sms-overlay');
            expect(one(overlay, 'sms-name').textContent).toBe('Gargamel');
            expect(one(overlay, 'sms-bubble').textContent).toBe('psst');
            expect(smsUnread()).toBe(0); // läst nu
        });

        it('ingen notis för blockerade; ny notis visas efter att den förra försvunnit', () => {
            blockSmsContact('mehmet');
            smsIncoming({ from: 'mehmet', text: 'spam', id: '1' });
            expect(toasts()).toHaveLength(0);
            smsIncoming({ from: 'gargamel', text: 'a', id: '2' });
            sec(4000);
            smsIncoming({ from: 'gargamel', text: 'b', id: '3' });
            expect(toasts()).toHaveLength(1);
            sec(4000);
        });

        it('läggs efter overlayen i body (z-index 3100 mot 3000 testas mot css-filen längst ner)', () => {
            openSmsOverlay();
            smsIncoming({ from: 'mehmet', text: 'hej', id: '1' });
            const kids = dom.doc.body.children;
            expect(kids.indexOf(toasts()[0])).toBeGreaterThan(kids.indexOf(one(dom.doc.body, 'sms-overlay')));
        });
    });

    describe('overlay', () => {
        it('öppnas och stängs med knapp, Esc och klick på bakgrunden', () => {
            expect(isSmsOverlayOpen()).toBe(false);
            openSmsOverlay();
            expect(isSmsOverlayOpen()).toBe(true);
            const overlay = one(dom.doc.body, 'sms-overlay');
            expect(overlay.parent).toBe(dom.doc.body);
            expect(one(overlay, 'sms-panel').attrs.role).toBe('dialog');
            one(overlay, 'sms-close').click();
            expect(isSmsOverlayOpen()).toBe(false);
            expect(els(dom.doc.body, 'sms-overlay')).toHaveLength(0);

            openSmsOverlay();
            press(dom.doc.body, 'Escape');
            expect(isSmsOverlayOpen()).toBe(false);

            openSmsOverlay();
            one(dom.doc.body, 'sms-backdrop').click();
            expect(isSmsOverlayOpen()).toBe(false);
        });

        it('Esc i skrivfältet stänger overlayen men når inte Stan', () => {
            openSmsOverlay('mehmet');
            const input = one(dom.doc.body, 'sms-input');
            const seen = [];
            dom.win.addEventListener('keydown', e => seen.push(e.key));
            dom.win.addEventListener('keyup', e => seen.push('up' + e.key));
            const ev = press(input, 'Escape');
            expect(ev.defaultPrevented).toBe(true);
            expect(isSmsOverlayOpen()).toBe(false);
            expect(seen).toEqual([]);
        });

        it('medan den är öppen når inga tangenter Stan, inte ens utanför rutan; efteråt gör de det igen', () => {
            openSmsOverlay();
            const seen = [];
            for (const t of ['keydown', 'keyup', 'keypress']) dom.win.addEventListener(t, e => seen.push(e.type + ':' + e.key));
            for (const t of ['keydown', 'keyup', 'keypress']) dom.dispatch(dom.doc.body, { type: t, key: 'w' });
            expect(seen).toEqual([]);
            closeSmsOverlay();
            dom.dispatch(dom.doc.body, { type: 'keydown', key: 'w' });
            dom.dispatch(dom.doc.body, { type: 'keyup', key: 'w' });
            expect(seen).toEqual(['keydown:w', 'keyup:w']);
        });

        it('Esc stänger inte när man skriver med IME', () => {
            openSmsOverlay();
            press(dom.doc.body, 'Escape', { isComposing: true });
            expect(isSmsOverlayOpen()).toBe(true);
        });

        it('öppna två gånger ger en overlay; med id hoppar den till samtalet', () => {
            openSmsOverlay();
            openSmsOverlay('gargamel');
            expect(els(dom.doc.body, 'sms-overlay')).toHaveLength(1);
            expect(one(dom.doc.body, 'sms-overlay').textContent).toContain('Gargamel');
            closeSmsOverlay();
            closeSmsOverlay(); // dubbelstängning är ofarlig
            expect(isSmsOverlayOpen()).toBe(false);
        });

        it('släpper Stans hållna tangenter när den öppnas (window blur)', () => {
            const blur = vi.fn();
            dom.win.addEventListener('blur', blur);
            openSmsOverlay();
            expect(blur).toHaveBeenCalledTimes(1);
        });

        it('Tab hålls kvar inuti overlayen', () => {
            openSmsOverlay('mehmet');
            const overlay = one(dom.doc.body, 'sms-overlay');
            const items = overlay.querySelectorAll();
            items.at(-1).focus();
            const ev = press(items.at(-1), 'Tab');
            expect(ev.defaultPrevented).toBe(true);
            expect(dom.doc.activeElement).toBe(items[0]);
            const back = press(items[0], 'Tab', { shiftKey: true });
            expect(back.defaultPrevented).toBe(true);
            expect(dom.doc.activeElement).toBe(items.at(-1));
        });

        it('tomt läge fungerar också i overlayen, med stäng-knapp', () => {
            api.state.me = null;
            openSmsOverlay();
            const overlay = one(dom.doc.body, 'sms-overlay');
            expect(overlay.textContent).toContain('Spela online för att skicka SMS till andra spelare');
            expect(one(overlay, 'sms-close')).toBeTruthy();
        });

        it('overlayen och telefonen kan vara öppna samtidigt och visar samma data', () => {
            const box = mount();
            smsIncoming({ from: 'mehmet', text: 'delat', id: '1' });
            openSmsOverlay();
            expect(one(box, 'sms-preview').textContent).toBe('delat');
            expect(one(one(dom.doc.body, 'sms-overlay'), 'sms-preview').textContent).toBe('delat');
        });
    });
});

// ══════════════════════════════════════════
//  Källkod och stilar
// ══════════════════════════════════════════
describe('källkod och stilar', () => {
    const read = async rel => (await import('node:fs')).readFileSync(new URL(rel, import.meta.url), 'utf8');

    it('sms.js bygger gränssnittet utan innerHTML och liknande', async () => {
        const src = (await read('../src/features/sms.js'))
            .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
        expect(src).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/);
    });

    it('overlayen ligger på z-index 3000 och notisen på 3100 (över Stans overlay på 1000)', async () => {
        const css = await read('../src/styles/sms.css');
        const z = sel => Number(new RegExp(`\\n${sel}\\s*\\{[^}]*?z-index:\\s*(\\d+)`).exec(css)?.[1]);
        expect(z('\\.sms-overlay')).toBe(3000);
        expect(z('\\.sms-toast')).toBe(3100);
        expect(css).toMatch(/\.sms-overlay\s*\{[^}]*position:\s*fixed/);
        expect(css).toMatch(/\.sms-toast\s*\{[^}]*position:\s*fixed/);
    });
});
