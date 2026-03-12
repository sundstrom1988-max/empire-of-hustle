import { CARS, PHONE_DEALS, CHARACTERS, SHOPS } from '../data/gameData.js';
import { gameState, currentPlayer, formatNum } from '../game/state.js';
import { playSound, spawnParticles, showToast } from '../utils/effects.js';
import { updateHUD } from '../game/core.js';
import { generateBotReply } from '../features/features.js';
import { syncState } from '../multiplayer/sync.js';

// ── Phone State ──
let phoneOpen = false, phoneScreen = 'home', phoneSmsTarget = null;
const smsInbox = {};
function smsKey(a, b) { return [a, b].sort().join('_'); }
function getConvo(a, b) { const k = smsKey(a, b); if (!smsInbox[k]) smsInbox[k] = []; return smsInbox[k]; }
function countUnread(myKey) { let t = 0; for (const [k, msgs] of Object.entries(smsInbox)) { if (!k.includes(myKey)) continue; msgs.forEach(m => { if (m.from !== myKey && (!m.read || !m.read[myKey])) t++; }); } return t; }
function countUnreadFrom(a, b) { return getConvo(a, b).filter(m => m.from !== a && (!m.read || !m.read[a])).length; }

export function showPhoneToggle() { const el = document.getElementById('phone-toggle'); if (el) el.style.display = 'block'; }

export function togglePhone() {
    phoneOpen = !phoneOpen;
    const ui = document.getElementById('phone-ui');
    if (phoneOpen) { ui.classList.add('open'); phoneGoHome(); }
    else { ui.classList.remove('open'); }
}

function phoneGoHome() {
    phoneScreen = 'home';
    const myKey = currentPlayer().charKey;
    const unread = countUnread(myKey);
    document.getElementById('phone-toggle').classList.toggle('has-notif', unread > 0);
    document.getElementById('phone-header').innerHTML = '<span class="ph-title">📱 Telefon</span>';
    document.getElementById('phone-body').innerHTML = `<div class="phone-apps">
        <div class="phone-app" onclick="window.game.phoneOpenSMS()"><div class="app-icon">💬</div>${unread > 0 ? `<span class="app-badge">${unread}</span>` : ''}<div class="app-name">SMS</div></div>
        <div class="phone-app" onclick="window.game.phoneOpenDeals()"><div class="app-icon">🕶️</div><div class="app-name">Deals</div></div>
        <div class="phone-app" onclick="window.game.phoneOpenCars()"><div class="app-icon">🚗</div><div class="app-name">Gärri</div></div>
        <div class="phone-app" onclick="window.game.phoneOpenWallet()"><div class="app-icon">💰</div><div class="app-name">Plånbok</div></div>
        <div class="phone-app" onclick="window.game.phoneOpenStatus()"><div class="app-icon">📊</div><div class="app-name">Status</div></div>
    </div>`;
}

function setHeader(title, backFn) {
    document.getElementById('phone-header').innerHTML = `<button class="ph-back" onclick="${backFn || 'window.game.togglePhone();window.game.togglePhone()'}">←</button><span class="ph-title">${title}</span>`;
}

// SMS
export function phoneOpenSMS() {
    phoneScreen = 'sms'; setHeader('💬 SMS', 'window.game.togglePhone();window.game.togglePhone()');
    const myKey = currentPlayer().charKey;
    document.getElementById('phone-body').innerHTML = Object.entries(CHARACTERS).filter(([k]) => k !== myKey).map(([key, ch]) => {
        const unread = countUnreadFrom(myKey, key);
        const convo = getConvo(myKey, key);
        const last = convo.length > 0 ? convo[convo.length - 1] : null;
        const preview = last ? `${CHARACTERS[last.from].icon} ${last.text.length > 22 ? last.text.slice(0, 22) + '...' : last.text}` : 'Inget ännu...';
        const isPlayer = gameState.players.some(p => p.charKey === key && !p.isAI);
        return `<div class="phone-contact" onclick="window.game.phoneOpenChat('${key}')">
            <div class="pc-icon">${ch.icon}</div>
            <div style="flex:1;"><div class="pc-name">${ch.name}${unread > 0 ? ` <span style="background:var(--danger);color:white;font-size:10px;padding:1px 6px;border-radius:8px;">${unread}</span>` : ''}</div>
            <div class="pc-status">${preview}</div></div>
            <div style="font-size:10px;color:rgba(255,255,255,0.2);">${isPlayer ? '🟢' : '🤖'}</div></div>`;
    }).join('');
}

export function phoneOpenChat(charKey) {
    phoneScreen = 'chat'; phoneSmsTarget = charKey;
    const myKey = currentPlayer().charKey;
    getConvo(myKey, charKey).forEach(m => { if (!m.read) m.read = {}; m.read[myKey] = true; });
    setHeader(`${CHARACTERS[charKey].icon} ${CHARACTERS[charKey].name}`, 'window.game.phoneOpenSMS()');
    renderChat();
}

function renderChat() {
    const myKey = currentPlayer().charKey;
    const convo = getConvo(myKey, phoneSmsTarget);
    document.getElementById('phone-body').innerHTML = `<div class="phone-sms">
        <div class="phone-sms-messages" id="phone-sms-msgs">${convo.map(m => {
        const isMe = m.from === myKey; const ch = CHARACTERS[m.from];
        return `<div class="chat-msg ${isMe ? 'user' : 'bot'}">${!isMe ? `<div class="bot-name">${ch.icon} ${ch.name}</div>` : ''}${m.text}</div>`;
    }).join('')}</div>
        <div class="phone-sms-input"><input type="text" id="phone-sms-input" placeholder="Skriv SMS..." onkeydown="if(event.key==='Enter')window.game.sendPhoneSMS()">
        <button onclick="window.game.sendPhoneSMS()">📨</button></div></div>`;
    setTimeout(() => { const el = document.getElementById('phone-sms-msgs'); if (el) el.scrollTop = el.scrollHeight; }, 50);
}

export function sendPhoneSMS() {
    const input = document.getElementById('phone-sms-input'); const text = input.value.trim(); if (!text) return; input.value = '';
    const myKey = currentPlayer().charKey; const convo = getConvo(myKey, phoneSmsTarget);
    const rd = {}; rd[myKey] = true; rd[phoneSmsTarget] = false;
    convo.push({ from: myKey, text, read: rd }); renderChat();
    const isRealPlayer = gameState.players.some(p => p.charKey === phoneSmsTarget && !p.isAI);
    if (!isRealPlayer) {
        setTimeout(() => {
            const bot = { responses: ['Bra sagt!', 'Intressant...', 'Haha!'] };
            const reply = generateBotReply(bot, text.toLowerCase());
            const rd2 = {}; rd2[phoneSmsTarget] = true; rd2[myKey] = false;
            convo.push({ from: phoneSmsTarget, text: reply, read: rd2 });
            if (phoneScreen === 'chat') renderChat();
        }, 800 + Math.random() * 1500);
    }
    if (gameState.isOnline) syncState();
}

// Phone Deals
export function phoneOpenDeals() {
    phoneScreen = 'deals'; setHeader('🕶️ Telefon-Deals'); const p = currentPlayer();
    document.getElementById('phone-body').innerHTML = `<p style="font-size:11px;color:rgba(255,255,255,0.3);margin-bottom:12px;">Affärer via telefon. Diskret. 🤫</p>` +
        PHONE_DEALS.map(d => {
            const afford = p.money >= d.cost;
            return `<div class="phone-deal"><h5>${d.name}</h5><div class="pd-desc">${d.desc}</div>
            <div style="display:flex;justify-content:space-between;font-size:11px;margin:6px 0;">
                <span style="color:#ef4444;">⚠️ ${d.risk}%</span>${d.reward[1] > 0 ? `<span style="color:var(--gold);">💰 ${formatNum(d.reward[0])}–${formatNum(d.reward[1])}</span>` : '<span style="color:var(--mehmet);">✨ Special</span>'}
            </div><button class="btn-phone-deal" onclick="window.game.doPhoneDeal('${d.id}')" ${!afford || p.inJail ? 'disabled' : ''}>${p.inJail ? '🔒' : afford ? `📱 Deal${d.cost > 0 ? ` — ${formatNum(d.cost)} 💰` : ''}` : '🔒'}</button></div>`;
        }).join('');
}

export function doPhoneDeal(id) {
    const p = currentPlayer(); const deal = PHONE_DEALS.find(d => d.id === id); if (p.money < deal.cost || p.inJail) return;
    p.money -= deal.cost;
    if (Math.random() < deal.risk / 100) { const fine = Math.floor(200 + Math.random() * 600); p.money = Math.max(0, p.money - fine); showToast(`📱 Misslyckades! -${formatNum(fine)} 💰`); }
    else if (deal.reward[1] > 0) { const rw = Math.floor(deal.reward[0] + Math.random() * (deal.reward[1] - deal.reward[0])); p.money += rw; showToast(`📱 ${deal.name} lyckades! +${formatNum(rw)} 💰`); playSound('coin'); }
    else { showToast(`📱 ${deal.name} fixat!`); }
    updateHUD(); phoneOpenDeals(); if (gameState.isOnline) syncState();
}

// Cars / Gärri
export function phoneOpenCars() {
    phoneScreen = 'cars'; setHeader('🚗 Fixa Gärri'); const p = currentPlayer(); if (!p.cars) p.cars = [];
    document.getElementById('phone-body').innerHTML = `<p style="font-size:11px;color:rgba(255,255,255,0.3);margin-bottom:12px;">Köp gärri — bonus-inkomst!</p>
        <div class="car-grid">${CARS.map(c => {
        const owned = p.cars.includes(c.id), afford = p.money >= c.price;
        return `<div class="car-card"><div class="car-emoji">${c.emoji}</div><h5>${c.name}</h5>
            <div class="car-price">${formatNum(c.price)} 💰</div><div class="car-boost">${c.boost}</div>
            <button class="btn-car" onclick="window.game.buyCar('${c.id}')" ${owned || !afford ? 'disabled' : ''}>${owned ? '✅' : '🚗 Köp'}</button></div>`;
    }).join('')}</div>
        ${p.cars.length > 0 ? `<div class="my-garage"><h5>🔧 Garage</h5>${p.cars.map(id => { const c = CARS.find(x => x.id === id); return `<div class="garage-car">${c.emoji} <strong>${c.name}</strong> — ${c.boost}</div>`; }).join('')}</div>` : ''}`;
}

export function buyCar(id) {
    const p = currentPlayer(); if (!p.cars) p.cars = []; const car = CARS.find(c => c.id === id);
    if (p.money < car.price || p.cars.includes(id)) return;
    p.money -= car.price; p.cars.push(id); playSound('coin'); updateHUD();
    showToast(`${car.emoji} Köpte ${car.name}!`); spawnParticles([car.emoji, '🔥'], 8); phoneOpenCars();
    if (gameState.isOnline) syncState();
}

// Wallet & Status
export function phoneOpenWallet() {
    const p = currentPlayer(); setHeader('💰 Plånbok');
    document.getElementById('phone-body').innerHTML = `<div style="text-align:center;padding:20px 0;">
        <div style="font-size:40px;">💰</div><div style="font-family:'Outfit';font-weight:900;font-size:32px;color:var(--gold);">${formatNum(p.money)}</div>
        </div><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
        <div class="dash-stat"><label>Rykte</label><div class="val pink">⭐ ${p.rep}</div></div>
        <div class="dash-stat"><label>Företag</label><div class="val">${p.owned.length}</div></div>
        <div class="dash-stat"><label>Gärri</label><div class="val">${(p.cars || []).length}</div></div>
        <div class="dash-stat"><label>Runda</label><div class="val">${gameState.round}</div></div></div>`;
}

export function phoneOpenStatus() {
    const p = currentPlayer(); setHeader('📊 Status');
    document.getElementById('phone-body').innerHTML = `<div style="padding:10px 0;">
        <div class="dash-stat" style="margin-bottom:8px;"><label>Karaktär</label><div class="val">${p.char.desc}</div></div>
        <div class="dash-stat"><label>Häktningar</label><div class="val" style="color:var(--danger);">${p.jailRecord.length}</div></div></div>`;
}

// Dashboard
export function renderDashboard() {
    const grid = document.getElementById('dash-grid'); if (!grid) return;
    const p = currentPlayer();
    const sorted = [...gameState.players].sort((a, b) => b.money - a.money);
    const myRank = sorted.findIndex(pl => pl === p) + 1;
    const ranks = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣'];

    // Calculate total income
    let totalIncome = 0;
    p.owned.forEach(id => {
        const biz = SHOPS.find(s => s.id === id);
        if (biz) totalIncome += biz.income * (p.levels[id] || 1);
    });

    // Sabotage warning
    const sabotaged = p.sabotagedRounds > 0;

    // Next affordable shop
    const nextShop = SHOPS.filter(s => !p.owned.includes(s.id) && p.money >= s.price).sort((a, b) => a.price - b.price)[0];
    const almostShop = !nextShop ? SHOPS.filter(s => !p.owned.includes(s.id)).sort((a, b) => a.price - b.price)[0] : null;

    grid.innerHTML = `
        <!-- OVERVIEW -->
        <div class="dash-card dash-overview" style="grid-column: 1 / -1;">
            <div class="dash-rank">${ranks[myRank - 1] || '🏅'}</div>
            <div class="dash-header">
                <div class="dash-avatar" style="border-color:${p.char.color};background:${p.char.color}22;">${p.char.icon}</div>
                <div>
                    <div class="dash-name" style="color:${p.char.color}">${p.char.name}</div>
                    <div style="font-size:11px;color:rgba(255,255,255,0.4);">Plats ${myRank} av ${gameState.players.length} · Runda ${gameState.round}</div>
                </div>
            </div>
            <div class="dash-stats" style="grid-template-columns: repeat(4, 1fr);">
                <div class="dash-stat"><label>Pengar</label><div class="val gold">${formatNum(p.money)}</div></div>
                <div class="dash-stat"><label>Rykte</label><div class="val pink">⭐ ${p.rep}</div></div>
                <div class="dash-stat"><label>Inkomst/runda</label><div class="val" style="color:var(--mehmet);">${sabotaged ? '⚠️ ' : ''}${formatNum(totalIncome)}${sabotaged ? ' (saboterad!)' : ''}</div></div>
                <div class="dash-stat"><label>Häktningar</label><div class="val" style="color:var(--danger);">${p.jailRecord.length}</div></div>
            </div>
        </div>

        <!-- MONEY GRAPH -->
        <div class="dash-card" style="grid-column: 1 / -1;">
            <h4 class="dash-section-title">📈 Pengakurva</h4>
            <canvas id="money-graph" width="800" height="200" style="width:100%;height:180px;border-radius:10px;"></canvas>
        </div>

        <!-- EMPIRE MANAGEMENT -->
        <div class="dash-card" style="grid-column: 1 / -1;">
            <h4 class="dash-section-title">🏢 Hantera Imperium</h4>
            ${p.owned.length === 0
            ? '<p style="color:rgba(255,255,255,0.3);text-align:center;padding:16px;">Inga företag ännu! Köp via Butik 🛒</p>'
            : p.owned.map(id => {
                const biz = SHOPS.find(s => s.id === id);
                const lv = p.levels[id] || 1;
                const income = biz.income * lv;
                const upgCost = Math.floor(biz.price * lv * 0.6);
                const afford = p.money >= upgCost;
                return `<div class="dash-biz">
                        <span class="dash-biz-icon">${biz.icon}</span>
                        <div class="dash-biz-info">
                            <strong>${biz.name}</strong>
                            <small>Lvl ${lv} · ${formatNum(income)} 💰/runda</small>
                        </div>
                        <button class="btn-upgrade" onclick="window.game.upgradeBiz('${id}');window.game.renderDashboard()" ${afford ? '' : 'disabled'}>⬆️ ${formatNum(upgCost)}</button>
                    </div>`;
            }).join('')
        }
        </div>

        <!-- QUICK BUY -->
        ${nextShop || almostShop ? `<div class="dash-card">
            <h4 class="dash-section-title">🛒 Snabbköp</h4>
            ${nextShop ? `<div class="dash-quickbuy">
                <div class="dqb-icon">${nextShop.icon}</div>
                <div><strong>${nextShop.name}</strong><br><small style="color:var(--gold);">${formatNum(nextShop.price)} 💰 · +${formatNum(nextShop.income)}/runda</small></div>
                <button class="btn-buy" onclick="window.game.buyShop('${nextShop.id}');window.game.renderDashboard()">🛒 KÖP</button>
            </div>` : `<div class="dash-quickbuy">
                <div class="dqb-icon">${almostShop.icon}</div>
                <div><strong>${almostShop.name}</strong><br><small style="color:rgba(255,255,255,0.3);">Behöver ${formatNum(almostShop.price)} 💰</small></div>
                <button class="btn-buy" disabled>🔒 Inte råd</button>
            </div>`}
        </div>` : ''}

        <!-- RANKING -->
        <div class="dash-card">
            <h4 class="dash-section-title">🏆 Ranking</h4>
            ${sorted.map((pl, i) => {
            const isYou = pl === p;
            let plIncome = 0;
            pl.owned.forEach(id => { const b = SHOPS.find(s => s.id === id); if (b) plIncome += b.income * (pl.levels[id] || 1); });
            return `<div class="dash-rank-row ${isYou ? 'you' : ''}" style="--rc:${pl.char.color}">
                    <span class="drr-pos">${ranks[i] || ''}</span>
                    <span class="drr-icon">${pl.char.icon}</span>
                    <span class="drr-name" style="color:${pl.char.color}">${pl.char.name}${isYou ? ' (du)' : ''}${pl.isAI ? ' 🤖' : ''}</span>
                    <span class="drr-money">💰 ${formatNum(pl.money)}</span>
                    <span class="drr-extra">⭐${pl.rep} · 🏢${pl.owned.length} · 🚗${(pl.cars || []).length}</span>
                </div>`;
        }).join('')}
        </div>

        <!-- QUICK ACTIONS -->
        <div class="dash-card" style="grid-column: 1 / -1;">
            <h4 class="dash-section-title">⚡ Snabbåtgärder</h4>
            <div class="dash-actions">
                <button class="dash-action-btn" onclick="window.game.doPitch();window.game.renderDashboard()" ${p.pitchesThisRound >= gameState.maxPitchesPerRound || p.inJail ? 'disabled' : ''}>
                    💡 Pitcha <small>${gameState.maxPitchesPerRound - p.pitchesThisRound} kvar</small>
                </button>
                <button class="dash-action-btn" onclick="window.game.rollDice();window.game.renderDashboard()" ${p.rollsThisRound >= gameState.maxRollsPerRound ? 'disabled' : ''}>
                    🎲 Rulla <small>${gameState.maxRollsPerRound - p.rollsThisRound} kvar</small>
                </button>
                <button class="dash-action-btn" onclick="window.game.switchTab('market',document.querySelectorAll('.tab-btn')[4])">
                    🕶️ Svarta Marknaden
                </button>
                <button class="dash-action-btn" onclick="window.game.endTurn()">
                    ⏭️ Avsluta tur
                </button>
            </div>
        </div>

        <!-- STATS -->
        <div class="dash-card" style="grid-column: 1 / -1;">
            <h4 class="dash-section-title">📋 Statistik</h4>
            <div class="dash-stats" style="grid-template-columns: repeat(3, 1fr);">
                <div class="dash-stat"><label>Totalt tjänat</label><div class="val gold">${formatNum(p.totalEarned || 0)}</div></div>
                <div class="dash-stat"><label>Totalt spenderat</label><div class="val" style="color:var(--danger);">${formatNum(p.totalSpent || 0)}</div></div>
                <div class="dash-stat"><label>Lyckade deals</label><div class="val" style="color:var(--mehmet);">${p.successfulDeals || 0}</div></div>
            </div>
        </div>
    `;

    // Draw money graph
    drawMoneyGraph();
}

function drawMoneyGraph() {
    const canvas = document.getElementById('money-graph');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = 180 * dpr;
    ctx.scale(dpr, dpr);
    const w = canvas.offsetWidth;
    const h = 180;

    // Collect all money histories
    const allHistories = gameState.players.map(p => ({
        history: p.moneyHistory || [p.money],
        color: p.char.color,
        name: p.char.name,
        isCurrent: p === currentPlayer()
    }));

    // Find max value and max length
    let maxVal = 1000;
    let maxLen = 1;
    allHistories.forEach(h => {
        h.history.forEach(v => { if (v > maxVal) maxVal = v; });
        if (h.history.length > maxLen) maxLen = h.history.length;
    });
    maxVal *= 1.1; // padding

    // Background
    ctx.fillStyle = 'rgba(255,255,255,0.02)';
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = 'rgba(255,255,255,0.06)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
        const y = h - (h * i / 4);
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.2)';
        ctx.font = '10px Outfit';
        ctx.fillText(formatNum(Math.floor(maxVal * i / 4)), 4, y - 4);
    }

    // Draw each player's line
    allHistories.forEach(({ history, color, isCurrent }) => {
        if (history.length < 2) return;
        ctx.beginPath();
        ctx.strokeStyle = color;
        ctx.lineWidth = isCurrent ? 3 : 1.5;
        ctx.globalAlpha = isCurrent ? 1 : 0.4;
        const stepX = w / Math.max(maxLen - 1, 1);
        history.forEach((val, i) => {
            const x = i * stepX;
            const y = h - (val / maxVal * h);
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        });
        ctx.stroke();

        // Glow for current player
        if (isCurrent) {
            ctx.shadowColor = color;
            ctx.shadowBlur = 8;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }
        ctx.globalAlpha = 1;
    });

    // Legend
    let legendX = 10;
    allHistories.forEach(({ color, name }) => {
        ctx.fillStyle = color;
        ctx.fillRect(legendX, h - 16, 10, 10);
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = '10px Outfit';
        ctx.fillText(name, legendX + 14, h - 7);
        legendX += ctx.measureText(name).width + 28;
    });
}
