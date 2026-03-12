import { BLACK_MARKET_DEALS, CHARACTERS } from '../data/gameData.js';
import { gameState, currentPlayer, formatNum } from '../game/state.js';
import { playSound, spawnParticles, showToast } from '../utils/effects.js';
import { updateHUD } from '../game/core.js';
import { syncState } from '../multiplayer/sync.js';

// ══════════════════════════════
//  BLACK MARKET
// ══════════════════════════════
export function renderMarket() {
    const p = currentPlayer();
    const el = document.getElementById('market-list');
    if (!el) return;
    el.innerHTML = BLACK_MARKET_DEALS.map(d => {
        const afford = p.money >= d.cost;
        let risk = d.risk;
        if (p.char?.ability === 'market_luck') risk = Math.max(5, risk - Math.floor(d.risk * p.char.abilityVal));
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
    let risk = deal.risk;
    if (p.char?.ability === 'market_luck') risk = Math.max(5, risk - Math.floor(deal.risk * p.char.abilityVal));
    if (Math.random() * 100 < risk) {
        p.inJail = true; p.jailRoundsLeft = 2 + Math.floor(Math.random() * 2);
        p.jailReason = deal.name; p.jailRecord.push({ deal: deal.name, round: gameState.round });
        const fine = Math.floor(200 + Math.random() * 500);
        p.money = Math.max(0, p.money - fine);
        showToast(`🚔 GRIPEN! ${deal.name}! -${formatNum(fine)} 💰`);
        playSound('jail'); renderJail();
    } else {
        const reward = Math.floor(deal.reward[0] + Math.random() * (deal.reward[1] - deal.reward[0]));
        p.money += reward; showToast(`${deal.icon} ${deal.name} lyckades! +${formatNum(reward)} 💰`);
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
    if (!el) return;
    if (p.inJail) {
        const bail = Math.floor(500 + Math.random() * 1000);
        el.innerHTML = `<div style="text-align:center;padding:20px;">
            <div style="font-size:60px;">🔒</div>
            <h3 style="color:var(--danger);margin:12px 0;">Du sitter i häktet!</h3>
            <p>Gripen för: <strong>${p.jailReason}</strong></p>
            <p>${p.jailRoundsLeft} rundor kvar</p>
            <button class="btn-buy" onclick="window.game.payBail(${bail})" ${p.money >= bail ? '' : 'disabled'} style="margin-top:16px;">
                💰 Betala borgen — ${formatNum(bail)} 💰</button>
        </div>`;
    } else {
        el.innerHTML = `<div style="text-align:center;padding:30px;color:rgba(255,255,255,0.3);">
            <div style="font-size:40px;margin-bottom:10px;">✅</div><p>Du är fri! Håll dig borta från trubbel...</p>
            ${p.jailRecord.length > 0 ? `<div style="margin-top:16px;text-align:left;"><h5 style="color:rgba(255,255,255,0.4);margin-bottom:8px;">📋 Brottsregister</h5>
                ${p.jailRecord.map(r => `<div style="font-size:12px;padding:4px 0;">Runda ${r.round}: ${r.deal}</div>`).join('')}</div>` : ''}
        </div>`;
    }
}

export function payBail(amount) {
    const p = currentPlayer();
    if (p.money < amount) return;
    p.money -= amount; p.inJail = false; p.jailRoundsLeft = 0;
    playSound('coin'); showToast('🔓 Borgen betald!'); updateHUD(); renderJail();
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

function addChatMsg(icon, name, text, type) {
    const el = document.getElementById('chat-messages');
    if (!el) return;
    const d = document.createElement('div');
    d.className = 'chat-msg ' + (type === 'bot' ? 'bot' : 'user');
    d.innerHTML = `<div class="bot-name" style="${type === 'user' ? 'text-align:right;' : ''}color:${type === 'user' ? currentPlayer().char.color : 'rgba(255,255,255,0.5)'};">${icon} ${name}</div>${text}`;
    el.appendChild(d); el.scrollTop = el.scrollHeight;
}

export function sendRoastChat() {
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    const p = currentPlayer();
    addChatMsg(p.char.icon, p.char.name, text, 'user');
    // Sync chat message if online
    if (gameState.isOnline) syncState();
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
    if (text.includes('hej') || text.includes('tja')) return `Yo! Vad händer min bror? ${bot.icon}`;
    return bot.responses[Math.floor(Math.random() * bot.responses.length)];
}

// ══════════════════════════════
//  CBD FLOATING LEAVES
// ══════════════════════════════
export function initCBDLeaves() {
    for (let i = 0; i < 6; i++) {
        const leaf = document.createElement('div'); leaf.className = 'cbd-leaf'; leaf.textContent = '🍃';
        leaf.style.left = Math.random() * 100 + 'vw'; leaf.style.fontSize = (14 + Math.random() * 16) + 'px';
        leaf.style.animationDuration = (8 + Math.random() * 12) + 's';
        leaf.style.animationDelay = Math.random() * 5 + 's';
        document.body.appendChild(leaf);
    }
}
