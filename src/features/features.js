import { BLACK_MARKET_DEALS } from '../data/gameData.js';
import { gameState, currentPlayer, formatNum, jailPlayer } from '../game/state.js';
import { playSound, spawnParticles, showToast } from '../utils/effects.js';
import { updateHUD } from '../game/core.js';
import { syncState, sendChatOnline } from '../multiplayer/sync.js';
import { escapeHtml } from '../utils/html.js';

// ══════════════════════════════
//  BLACK MARKET
// ══════════════════════════════
function marketRisk(p, deal) {
    let risk = deal.risk;
    if (p.char?.ability === 'market_luck') risk = Math.max(5, risk - Math.floor(deal.risk * p.char.abilityVal));
    return risk;
}

export function renderMarket() {
    const p = currentPlayer();
    const el = document.getElementById('market-list');
    if (!el || !p) return;
    el.innerHTML = BLACK_MARKET_DEALS.map(d => {
        const afford = p.money >= d.cost;
        const risk = marketRisk(p, d);
        return `<div class="deal-card">
            <div class="deal-icon">${d.icon}</div>
            <div class="deal-info"><h4>${d.name}</h4><p>${d.desc}</p>
                <div style="display:flex;gap:12px;font-size:12px;margin-top:4px;">
                    <span style="color:#ef4444;">⚠️ ${risk}%</span>
                    <span style="color:var(--gold);">💰 ${formatNum(d.reward[0])}–${formatNum(d.reward[1])}</span>
                </div></div>
            <button class="btn-buy" onclick="window.game.doMarketDeal('${d.id}')" ${!afford || p.inJail || p.dealsThisRound >= 2 ? 'disabled' : ''}>
                ${p.inJail ? '🔒' : afford ? `${formatNum(d.cost)} 💰` : '🔒 Inte råd'}</button>
        </div>`;
    }).join('');
}

export function doMarketDeal(id) {
    const p = currentPlayer();
    const deal = BLACK_MARKET_DEALS.find(d => d.id === id);
    if (!deal || p.money < deal.cost || p.inJail || p.dealsThisRound >= 2) return;
    p.money -= deal.cost; p.dealsThisRound++;
    p.totalSpent = (p.totalSpent || 0) + deal.cost;
    if (Math.random() * 100 < marketRisk(p, deal)) {
        jailPlayer(p, deal.name, 2 + Math.floor(Math.random() * 2));
        p.failedDeals = (p.failedDeals || 0) + 1;
        const fine = Math.floor(200 + Math.random() * 500);
        p.money = Math.max(0, p.money - fine);
        showToast(`🚔 GRIPEN! ${deal.name}! -${formatNum(fine)} 💰`);
        playSound('jail'); renderJail();
    } else {
        const reward = Math.floor(deal.reward[0] + Math.random() * (deal.reward[1] - deal.reward[0]));
        p.money += reward;
        p.totalEarned = (p.totalEarned || 0) + reward;
        p.successfulDeals = (p.successfulDeals || 0) + 1;
        showToast(`${deal.icon} ${deal.name} lyckades! +${formatNum(reward)} 💰`);
        playSound('coin'); spawnParticles([deal.icon, '💰'], 8);
    }
    updateHUD(); renderMarket();
    if (gameState.isOnline) syncState();
}

// ══════════════════════════════
//  JAIL
// ══════════════════════════════
export function renderJail() {
    const p = currentPlayer();
    const el = document.getElementById('jail-content');
    if (!el || !p) return;
    if (p.inJail) {
        // Borgen sätts när man åker in — gamla sparfiler får ett värde här
        if (!p.bail) p.bail = Math.floor(500 + Math.random() * 1000);
        const bail = p.bail;
        el.innerHTML = `<div style="text-align:center;padding:20px;">
            <div style="font-size:60px;">🔒</div>
            <h3 style="color:var(--danger);margin:12px 0;">Du sitter i häktet!</h3>
            <p>Gripen för: <strong>${escapeHtml(p.jailReason)}</strong></p>
            <p>${p.jailRoundsLeft} rundor kvar</p>
            <button class="btn-buy" onclick="window.game.payBail()" ${p.money >= bail ? '' : 'disabled'} style="margin-top:16px;">
                💰 Betala borgen — ${formatNum(bail)} 💰</button>
        </div>`;
    } else {
        el.innerHTML = `<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.3);">
            <div style="font-size:40px;margin-bottom:10px;">✅</div><p>Du är fri! Håll dig borta från trubbel...</p>
            ${p.jailRecord.length > 0 ? `<div style="margin-top:16px;text-align:left;"><h5 style="color:rgba(255,255,255,0.4);margin-bottom:8px;">📋 Brottsregister</h5>
                ${p.jailRecord.map(r => `<div style="font-size:12px;padding:4px 0;">Runda ${r.round}: ${escapeHtml(r.deal)}</div>`).join('')}</div>` : ''}
        </div>`;
    }
}

export function payBail() {
    const p = currentPlayer();
    if (!p.inJail) return;
    const amount = p.bail || 0;
    if (p.money < amount) return;
    p.money -= amount; p.inJail = false; p.jailRoundsLeft = 0; p.bail = 0;
    p.totalSpent = (p.totalSpent || 0) + amount;
    playSound('coin'); showToast('🔓 Borgen betald!'); updateHUD(); renderJail();
    window.game?.refreshUI?.();
    if (gameState.isOnline) syncState();
}

// ══════════════════════════════
//  ROAST CHAT WITH BOTS
// ══════════════════════════════
const ROAST_BOTS = [
    { name: 'Dr. KimIT', icon: '👨‍⚕️', style: 'perrongen', responses: ['IKONISKT bram!', 'Rocket fuel!', 'Du påminner mig om mitt gamla jag...', 'Det där var FETT ÄKTA!', 'Perrongen väntar inte, grabben!'] },
    { name: 'Gargamel', icon: '🧙‍♂️', style: 'dark', responses: ['*blixtar i bakgrunden*', 'Smurfarna hade mer stil...', 'Mörka krafter...', 'Du har potential... för att misslyckas.', 'Min katt är smartare.'] },
    { name: 'Mehmet', icon: '🥙', style: 'hustle', responses: ['JALLA mannen!', 'Extra allt eller inget!', 'Min vitsås > din affärsplan', 'Helt sjukt wallah!', 'Kebab löser allt bram!'] }
];

export function addRoastWelcome() {
    const el = document.getElementById('chat-messages');
    if (!el) return;
    const bot = ROAST_BOTS[Math.floor(Math.random() * ROAST_BOTS.length)];
    addChatMsg(bot.icon, bot.name, bot.responses[Math.floor(Math.random() * bot.responses.length)], 'bot');
}

function addChatMsg(icon, name, text, type, color) {
    const el = document.getElementById('chat-messages');
    if (!el) return;
    const d = document.createElement('div');
    d.className = 'chat-msg ' + (type === 'bot' ? 'bot' : 'user');
    const nameColor = color || (type === 'user' ? currentPlayer()?.char?.color : 'rgba(255,255,255,0.5)');
    d.innerHTML = `<div class="bot-name" style="${type === 'user' ? 'text-align:right;' : ''}color:${escapeHtml(nameColor)};">${escapeHtml(icon)} ${escapeHtml(name)}</div>${escapeHtml(text)}`;
    el.appendChild(d); el.scrollTop = el.scrollHeight;
}

// Chattmeddelande från en annan spelare online
export function receiveOnlineChat(msg) {
    addChatMsg(msg.icon, msg.name, String(msg.text || '').slice(0, 300), 'bot', msg.color);
}

export function sendRoastChat() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim().slice(0, 300);
    if (!text) return;
    input.value = '';
    const me = gameState.isOnline ? (gameState.players.find(pl => pl.charKey === gameState.myCharKey) || currentPlayer()) : currentPlayer();
    addChatMsg(me.char.icon, me.char.name, text, 'user', me.char.color);
    if (gameState.isOnline) {
        sendChatOnline({ icon: me.char.icon, name: me.char.name, text, color: me.char.color });
        return; // Riktiga spelare svarar själva
    }
    // Bot auto-reply
    const typing = document.getElementById('typing-indicator');
    if (typing) typing.style.display = 'block';
    setTimeout(() => {
        if (typing) typing.style.display = 'none';
        const bot = ROAST_BOTS[Math.floor(Math.random() * ROAST_BOTS.length)];
        const reply = generateBotReply(bot, text.toLowerCase());
        addChatMsg(bot.icon, bot.name, reply, 'bot');
    }, 1000 + Math.random() * 2000);
}

export function generateBotReply(bot, text) {
    if (text.includes('kebab') || text.includes('mat')) return 'JALLA! Kebab löser ALLT! 🥙🔥';
    if (text.includes('pengar') || text.includes('rik')) return 'Pengar? Pffft, jag tvättar mina i vitsås! 💰🧄';
    if (text.includes('vinn') || text.includes('bäst')) return 'Du? Vinna mot MIG? Bram, drömmer du? 😂';
    if (text.includes('hej') || text.includes('tja')) return `Yo! Vad händer min bror? ${bot.icon || '😎'}`;
    if (text.includes('snut') || text.includes('polis')) return 'Snuten? Kör till Lackverkstan bram, då ser de dig inte! 🎨🚔';
    if (text.includes('bil') || text.includes('gärri')) return 'Sno en Lambo i Centrum och dumpa den på Bilskroten. Ez money! 🏎️';
    return bot.responses[Math.floor(Math.random() * bot.responses.length)];
}

// ══════════════════════════════
//  CBD FLOATING LEAVES
// ══════════════════════════════
let leavesStarted = false;
export function initCBDLeaves() {
    if (leavesStarted) return; // annars dubbleras löven vid varje omstart
    leavesStarted = true;
    for (let i = 0; i < 6; i++) {
        const leaf = document.createElement('div'); leaf.className = 'cbd-leaf'; leaf.textContent = '🍃';
        leaf.style.left = Math.random() * 100 + 'vw'; leaf.style.fontSize = (14 + Math.random() * 16) + 'px';
        leaf.style.animationDuration = (8 + Math.random() * 12) + 's';
        leaf.style.animationDelay = Math.random() * 5 + 's';
        document.body.appendChild(leaf);
    }
}
