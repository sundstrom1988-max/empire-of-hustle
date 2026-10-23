// ═══════════════════════════════════════════
//  EMPIRE OF HUSTLE — Main Entry Point
// ═══════════════════════════════════════════

import './styles/base.css';
import './styles/components.css';
import './styles/gta.css';
import './styles/city.css';

import { CHARACTERS, STREET_CRED } from './data/gameData.js';
import { gameState, createPlayerState, normalizePlayer, currentPlayer, formatNum, saveGame, loadGame, canAct } from './game/state.js';
import { renderEmpire, renderShop, buyShop, upgradeBiz, sellBiz, confirmSellBiz, showStashModal, doStash, doPitch, rollDice, endTurn, updateHUD, updateTurnBar, updateTurnLock, switchTab, ensureAITurn, showWinIfOver } from './game/core.js';
import { renderMarket, doMarketDeal, renderJail, payBail, addRoastWelcome, sendRoastChat, receiveOnlineChat, initCBDLeaves } from './features/features.js';
import { initMinigames, playDiceBattle, playGuessNumber, playSlotMachine, playCoinFlip } from './features/minigames.js';
import { showPhoneToggle, togglePhone, phoneOpenSMS, phoneOpenChat, sendPhoneSMS, phoneOpenDeals, doPhoneDeal, phoneOpenCars, buyCar, phoneOpenWallet, phoneOpenStatus, renderDashboard } from './features/phone.js';
import { createRoom, joinRoom, startOnlineGame, onPlayerJoin, onChat, onSync, onPeerLeft, onHostLost, sayGoodbye, leaveRoom, syncMe } from './multiplayer/sync.js';
import { toggleMusic, toggleSfx, showToast, spawnParticles, startMusic } from './utils/effects.js';
import { unlockAudio, sfx } from './utils/audio.js';
import { initSms, smsIncoming, smsAck, closeSmsOverlay, refreshSms } from './features/sms.js';
import { smsSend, smsContacts, onSmsIncoming, onSmsStatus } from './multiplayer/citynet.js';
import { showHeistButton, selectHeistTarget, doHeist, sweepEvidence } from './features/gargamel.js';
import { renderGarage, buyGarageCar, pimpCar } from './features/garage.js';
import { renderStanPanel, goToCity, applyPendingBust } from './features/stan.js';
import { isCityOpen } from './city/index.js';
import { escapeHtml } from './utils/html.js';
import { BUILD, watchForUpdates } from './utils/version.js';

// ── Åtgärder som ändrar spelet kräver att det är din tur ──
function guarded(fn) {
    return (...args) => {
        if (!canAct()) {
            showToast(gameState.gameOver ? '🏁 Spelet är slut!' : '⏳ Vänta på din tur!');
            return;
        }
        return fn(...args);
    };
}

const actions = {
    upgradeBiz, sellBiz, confirmSellBiz, showStashModal, doStash, buyShop, doPitch, rollDice,
    endTurn: () => endTurn(false),
    doMarketDeal, payBail,
    playDiceBattle, playGuessNumber, playSlotMachine, playCoinFlip,
    doPhoneDeal, buyCar, buyGarageCar, pimpCar,
    selectHeistTarget, doHeist, sweepEvidence
};
const guardedActions = Object.fromEntries(Object.entries(actions).map(([k, fn]) => [k, guarded(fn)]));

function refreshUI() {
    updateHUD(); renderEmpire(); renderShop(); renderMarket(); renderJail(); renderStanPanel();
    updateTurnBar(); updateTurnLock(); showHeistButton();
}

// ── Expose functions to window for onclick handlers ──
window.game = {
    ...guardedActions,
    goToCity, // har egna kontroller: online är stan öppen även mellan turerna
    switchTab, sendRoastChat, initMinigames,
    togglePhone, phoneOpenSMS, phoneOpenChat, sendPhoneSMS,
    phoneOpenDeals, phoneOpenCars, phoneOpenWallet, phoneOpenStatus,
    renderDashboard, toggleMusic, toggleSfx, renderGarage, renderStanPanel,
    refreshUI
};
window.city = { isOpen: isCityOpen };
// Endast i dev-läge: spelets state åtkomligt för felsökning och röktester
if (import.meta.env?.DEV) window.__gs = gameState;

// ── Auth helpers ──
function simpleHash(str) { let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; } return h.toString(36); }
function getAccounts() { try { return JSON.parse(localStorage.getItem('empire_accounts') || '{}') || {}; } catch (e) { return {}; } }
function saveAccounts(a) { try { localStorage.setItem('empire_accounts', JSON.stringify(a)); } catch (e) { showToast('⚠️ Kunde inte spara kontot'); } }
function getStreetCred(money) { let c = STREET_CRED[0]; for (const s of STREET_CRED) { if (money >= s.min) c = s; } return c; }

let selectedChar = null;
let selectedMode = 'single';
let currentAccount = null;

const LOGO = `<div class="gta-logo-wrap"><div class="gta-presents">Dr. KimIT presenterar</div><h1 class="gta-logo"><span>EMPIRE</span><small>of</small><span>HUSTLE</span></h1></div>`;

// ── Render App ──
function renderApp() {
    const app = document.getElementById('app');
    app.innerHTML = `
    <!-- LOGIN -->
    <div id="screen-login" style="display:none;">
        ${LOGO}
        <p class="sub">🔒 Välj ditt konto eller skapa nytt</p>
        <div class="login-accounts" id="login-accounts"></div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">
            <button class="btn-guest" id="btn-guest-play" style="max-width:200px;">🎮 Gäst-läge</button>
            <button class="btn-guest" id="btn-join-room" style="max-width:200px;">🌐 Gå med i Rum</button>
        </div>
        <p class="app-version">Version ${BUILD}</p>
    </div>
    <div class="login-modal" id="login-modal"></div>

    <!-- CHARACTER SELECT -->
    <div id="screen-select">
        ${LOGO}
        <p class="sub">🔥 Välj din karaktär och bygg ditt imperium</p>
        <div class="char-cards" id="char-cards"></div>
        <div class="mode-row" id="mode-row">
            <button class="mode-btn active" id="mode-single" onclick="window.setMode('single')">🎮 Solo</button>
            <button class="mode-btn" id="mode-multi2" onclick="window.setMode('multi2')">👥 2 Spelare</button>
            <button class="mode-btn" id="mode-multi3" onclick="window.setMode('multi3')">👥 3 Spelare</button>
            <button class="mode-btn" id="mode-ai" onclick="window.setMode('ai')">🤖 vs AI</button>
            <button class="mode-btn" id="mode-online" onclick="window.setMode('online')">🌐 Online</button>
        </div>
        <div class="join-section" id="join-section">
            <p style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:8px;">🌐 Har du en rumskod? Gå med i en kompis lobby!</p>
            <div style="display:flex;gap:8px;align-items:center;justify-content:center;">
                <input type="text" id="join-code-input" placeholder="Skriv rumskod..." class="join-input" maxlength="10">
                <button class="mode-btn join-btn" onclick="window.joinOnlineRoom(document.getElementById('join-code-input').value)">🌐 GÅ MED</button>
            </div>
        </div>
        <button class="btn-start" id="btn-start">⚡ STARTA</button>
        <p class="app-version">Version ${BUILD}</p>
    </div>

    <!-- GAME -->
    <div id="screen-game">
        <div class="hud">
            <div class="hud-stats">
                <span id="hud-name"></span><span id="hud-money"></span><span id="hud-rep"></span>
                <span id="hud-round"></span><span id="hud-biz"></span>
            </div>
            <div class="hud-controls">
                <button class="hud-btn hud-city" onclick="window.game.goToCity()">🚗 STAN</button>
                <button class="hud-btn" id="btn-music" onclick="window.game.toggleMusic()">🎵</button>
                <button class="hud-btn" id="btn-sfx" onclick="window.game.toggleSfx()">🔔</button>
                <button class="hud-btn" onclick="window.doSave()">💾</button>
                <button class="hud-btn" onclick="window.game.endTurn()">⏭️ Avsluta tur</button>
            </div>
        </div>
        <div class="turn-indicator" id="turn-indicator"></div>
        <div class="wait-banner" id="wait-banner" style="display:none;"></div>
        <div class="tab-bar">
            <button class="tab-btn active" onclick="window.game.switchTab('empire',this)">🏢 Imperium</button>
            <button class="tab-btn tab-stan" onclick="window.game.switchTab('stan',this);window.game.renderStanPanel()">🗺️ Stan</button>
            <button class="tab-btn" onclick="window.game.switchTab('pitch',this)">💡 Pitch</button>
            <button class="tab-btn" onclick="window.game.switchTab('events',this)">🎲 Events</button>
            <button class="tab-btn" onclick="window.game.switchTab('shop',this)">🛒 Butik</button>
            <button class="tab-btn" onclick="window.game.switchTab('market',this)">🕶️ Svarta</button>
            <button class="tab-btn" onclick="window.game.switchTab('jail',this)">🔒 Häktet</button>
            <button class="tab-btn" onclick="window.game.switchTab('garage',this);window.game.renderGarage()">🚗 Garage</button>
            <button class="tab-btn" onclick="window.game.switchTab('minigames',this);window.game.initMinigames()">🎮 Spel</button>
            <button class="tab-btn" onclick="window.game.switchTab('roast',this)">💬 Chatt</button>
            <button class="tab-btn" onclick="window.game.switchTab('dashboard',this);window.game.renderDashboard()">📊 Stats</button>
        </div>

        <!-- PANELS -->
        <div class="panel" id="panel-empire"><h2 class="panel-title">🏢 Ditt Imperium</h2><div id="empire-list"></div></div>
        <div class="panel" id="panel-stan"><div id="stan-content"></div></div>
        <div class="panel" id="panel-pitch"><div class="pitch-area"><h2>💡 Pitcha din idé</h2><p class="sub">Övertyga investerarna!</p><button class="btn-pitch" onclick="window.game.doPitch()">🎤 PITCHA!</button><div id="pitch-result" style="margin-top:20px;"></div></div></div>
        <div class="panel" id="panel-events"><div class="dice-area"><h2>🎲 Slumpmässiga Events</h2><p class="sub">Rulla tärningen!</p><button class="btn-dice" onclick="window.game.rollDice()">🎲 RULLA!</button><div id="dice-result" style="margin-top:20px;"></div></div></div>
        <div class="panel" id="panel-shop"><h2 class="panel-title">🛒 Butik</h2><div class="shop-grid" id="shop-grid"></div></div>
        <div class="panel" id="panel-market"><h2 class="panel-title">🕶️ Svarta Marknaden</h2><div id="market-list"></div></div>
        <div class="panel" id="panel-jail"><h2 class="panel-title">🔒 Häktet</h2><div id="jail-content"></div></div>
        <div class="panel" id="panel-garage"><div id="garage-content"></div></div>
        <div class="panel" id="panel-minigames"><h2 class="panel-title">🎮 Mini-Spel</h2><div class="mini-grid" id="minigames-grid"></div><div id="minigame-result" style="margin-top:20px;text-align:center;"></div></div>
        <div class="panel" id="panel-roast">
            <h2 class="panel-title">💬 Gatan Snackar</h2>
            <div class="chat-area"><div class="chat-messages" id="chat-messages"></div><div id="typing-indicator" style="display:none;padding:4px 12px;font-size:12px;color:rgba(255,255,255,0.3);">skriver...</div>
            <div class="chat-bar"><input type="text" id="chat-input" placeholder="Skriv något sjukt..." maxlength="300" onkeydown="if(event.key==='Enter')window.game.sendRoastChat()"><button onclick="window.game.sendRoastChat()">💬</button></div></div>
        </div>
        <div class="panel" id="panel-dashboard"><h2 class="panel-title">📊 Dashboard</h2><div class="dash-grid" id="dash-grid"></div></div>
    </div>

    <!-- PHONE -->
    <button class="phone-toggle" id="phone-toggle" onclick="window.game.togglePhone()">📱</button>
    <div class="phone-ui" id="phone-ui">
        <div class="phone-status-bar"><span>🍃 HustleOS</span><span id="phone-time">13:37</span><span>🔋 87%</span></div>
        <div class="phone-header" id="phone-header"><span class="ph-title">📱 Telefon</span></div>
        <div class="phone-body" id="phone-body"></div>
    </div>

    <!-- OVERLAYS -->
    <div class="overlay" id="overlay-event"></div>
    <div class="toast-container" id="toast-container"></div>`;

    setupEvents();
}

function setupEvents() {
    document.getElementById('btn-guest-play')?.addEventListener('click', () => {
        currentAccount = null;
        document.getElementById('screen-login').style.display = 'none';
        document.getElementById('screen-select').style.display = 'flex';
    });
    document.getElementById('btn-join-room')?.addEventListener('click', () => {
        document.getElementById('screen-login').style.display = 'none';
        document.getElementById('screen-select').style.display = 'flex';
        window.setMode('online');
        showToast('🎭 Välj karaktär och skriv rumskoden nedanför!');
    });
    renderCharCards();
    document.getElementById('btn-start')?.addEventListener('click', startGame);
}

// ── Render character cards with lock state ──
function renderCharCards() {
    const charContainer = document.getElementById('char-cards');
    if (!charContainer) return;
    charContainer.innerHTML = '';
    const accounts = getAccounts();
    Object.entries(CHARACTERS).forEach(([key, ch]) => {
        const isLocked = !!accounts[key] && currentAccount !== key;
        const card = document.createElement('div');
        card.className = 'char-card' + (isLocked ? ' locked' : '') + (selectedChar === key ? ' selected' : '');
        card.style.setProperty('--char-color', ch.color);
        card.innerHTML = `
            ${isLocked ? '<div class="char-lock-badge">🔒</div>' : ''}
            <div class="char-icon">${ch.img ? `<img src="${ch.img}" alt="" onerror="this.parentNode.textContent='${ch.icon}'">` : ch.icon}</div>
            <div class="char-name" style="color:${ch.color}">${ch.name}</div>
            <div class="char-desc">${ch.desc}</div>
            ${isLocked
                ? `<button class="btn-char-unlock" style="--char-color:${ch.color}" onclick="event.stopPropagation();window.showCharUnlock('${key}')">🔓 Lås upp</button>`
                : accounts[key] ? '<div class="char-desc" style="color:var(--mehmet)">✅ Upplåst</div>'
                    : `<button class="btn-char-lock" onclick="event.stopPropagation();window.showCharLock('${key}')">🔐 Lås karaktär</button>`
            }`;
        if (!isLocked) {
            card.addEventListener('click', () => {
                document.querySelectorAll('.char-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                selectedChar = key;
            });
        }
        charContainer.appendChild(card);
    });
}

// ── Unlock character (enter password) ──
window.showCharUnlock = function (charKey) {
    const ch = CHARACTERS[charKey];
    const modal = document.getElementById('login-modal');
    modal.innerHTML = `<div class="login-modal-box">
        <div style="font-size:50px;margin-bottom:10px;">${ch.icon}</div>
        <h3 style="color:${ch.color}">${ch.name}</h3>
        <p class="lm-sub">🔒 Denna karaktär är låst — ange kod för att spela</p>
        <div class="login-error" id="login-error">Fel kod! 🚫</div>
        <input type="password" id="unlock-pass" placeholder="Ange din kod..." onkeydown="if(event.key==='Enter')window.doCharUnlock('${charKey}')">
        <button class="btn-login" style="background:linear-gradient(135deg,${ch.color},${ch.color}88);" onclick="window.doCharUnlock('${charKey}')">🔓 LÅS UPP & VÄLJ</button>
        <button class="btn-guest" onclick="document.getElementById('login-modal').classList.remove('open')">Avbryt</button>
    </div>`;
    modal.classList.add('open');
    setTimeout(() => document.getElementById('unlock-pass')?.focus(), 100);
};

window.doCharUnlock = function (charKey) {
    const pass = document.getElementById('unlock-pass').value;
    const accs = getAccounts();
    if (!accs[charKey] || simpleHash(pass) !== accs[charKey].password) {
        const err = document.getElementById('login-error');
        err.textContent = 'Fel kod! 🚫';
        err.style.display = 'block';
        return;
    }
    currentAccount = charKey;
    selectedChar = charKey;
    document.getElementById('login-modal').classList.remove('open');
    if (loadGame(charKey)) {
        showGameScreen();
        showToast(`🔓 Välkommen tillbaka, ${CHARACTERS[charKey].name}!`);
        applyPendingBust();   // gripen i stan precis innan sidan laddades om
    } else {
        showToast(`🔓 ${CHARACTERS[charKey].name} upplåst!`);
        renderCharCards();
    }
};

// ── Lock character (set password) ──
window.showCharLock = function (charKey) {
    const ch = CHARACTERS[charKey];
    const modal = document.getElementById('login-modal');
    modal.innerHTML = `<div class="login-modal-box">
        <div style="font-size:50px;margin-bottom:10px;">${ch.icon}</div>
        <h3 style="color:${ch.color}">Lås ${ch.name}</h3>
        <p class="lm-sub">🔐 Välj en kod så bara du kan spela denna karaktär</p>
        <div class="login-error" id="login-error"></div>
        <input type="password" id="lock-pass" placeholder="Välj kod (minst 3 tecken)..." onkeydown="if(event.key==='Enter')window.doCharLock('${charKey}')">
        <input type="password" id="lock-pass2" placeholder="Bekräfta kod..." onkeydown="if(event.key==='Enter')window.doCharLock('${charKey}')">
        <button class="btn-login" style="background:linear-gradient(135deg,${ch.color},${ch.color}88);" onclick="window.doCharLock('${charKey}')">🔐 LÅS KARAKTÄR</button>
        <button class="btn-guest" onclick="document.getElementById('login-modal').classList.remove('open')">Avbryt</button>
    </div>`;
    modal.classList.add('open');
    setTimeout(() => document.getElementById('lock-pass')?.focus(), 100);
};

window.doCharLock = function (charKey) {
    const pass = document.getElementById('lock-pass').value;
    const pass2 = document.getElementById('lock-pass2').value;
    const err = document.getElementById('login-error');
    if (pass.length < 3) { err.textContent = 'Minst 3 tecken!'; err.style.display = 'block'; return; }
    if (pass !== pass2) { err.textContent = 'Koderna matchar inte!'; err.style.display = 'block'; return; }
    const accs = getAccounts();
    accs[charKey] = { password: simpleHash(pass), created: Date.now() };
    saveAccounts(accs);
    currentAccount = charKey;
    selectedChar = charKey;
    document.getElementById('login-modal').classList.remove('open');
    showToast(`🔐 ${CHARACTERS[charKey].name} är nu låst med din kod!`);
    renderCharCards();
    renderLoginScreen();
};

// ── Mode Selection ──
window.setMode = function (mode) {
    selectedMode = mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    document.getElementById('mode-' + mode)?.classList.add('active');
    document.getElementById('join-section')?.classList.toggle('show', mode === 'online');
};

// Välj en karaktär till lokal multiplayer. Ogiltigt svar = slumpad karaktär.
function pickLocalCharacter(playerNo, available) {
    const names = available.map(k => `${k} (${CHARACTERS[k].name})`).join(', ');
    const raw = (prompt(`Spelare ${playerNo}: Välj karaktär\n${names}`) || '').trim().toLowerCase();
    const byKey = available.find(k => k === raw);
    const byName = available.find(k => CHARACTERS[k].name.toLowerCase().includes(raw) && raw.length >= 3);
    const key = byKey || byName || available[Math.floor(Math.random() * available.length)];
    if (!byKey && !byName) showToast(`🎲 Spelare ${playerNo} fick ${CHARACTERS[key].name}`);
    return key;
}

// ── Start Game ──
function startGame() {
    unlockAudio();
    if (!selectedChar) { showToast('Välj en karaktär! 🎭'); return; }
    if (selectedMode === 'online') { startOnlineMode(); return; }
    gameState.mode = selectedMode;
    gameState.players = [createPlayerState(selectedChar)];
    gameState.currentPlayerIdx = 0; gameState.round = 1;
    gameState.gameOver = false; gameState.aiThinking = false;
    gameState.isOnline = false;
    gameState.accountKey = currentAccount;

    if (selectedMode === 'multi2' || selectedMode === 'multi3') {
        const numExtra = selectedMode === 'multi2' ? 1 : 2;
        const available = Object.keys(CHARACTERS).filter(k => k !== selectedChar);
        for (let i = 0; i < numExtra; i++) {
            const key = pickLocalCharacter(i + 2, available);
            gameState.players.push(createPlayerState(key));
            available.splice(available.indexOf(key), 1);
        }
    } else if (selectedMode === 'ai') {
        const aiKeys = Object.keys(CHARACTERS).filter(k => k !== selectedChar);
        const aiPlayer = createPlayerState(aiKeys[Math.floor(Math.random() * aiKeys.length)]);
        aiPlayer.isAI = true;
        gameState.players.push(aiPlayer);
    }
    showGameScreen();
}

function renderLobby() {
    const el = document.getElementById('lobby-players');
    if (!el) return;
    el.innerHTML = gameState.players.map((p, i) =>
        `<div class="lobby-player" style="border-color:${p.char.color}">${p.char.icon} ${escapeHtml(p.char.name)}${i === 0 ? ' (Värd)' : ''}</div>`).join('');
    const btn = document.getElementById('btn-start-match');
    if (btn) btn.textContent = gameState.players.length > 1 ? `⚡ STARTA MATCH (${gameState.players.length} spelare)` : '⚡ STARTA ÄNDÅ (bara du)';
}

// ── SMS mellan riktiga spelare: appen pratar med värden via citynet ──
onSmsIncoming(smsIncoming);
onSmsStatus(smsAck);
function setupSms() {
    initSms({
        myId: () => (gameState.isOnline ? gameState.myCharKey : null),
        players: smsContacts,
        send: smsSend,
        accountKey: () => gameState.accountKey,
        roomId: () => gameState.roomId,
        notify: () => sfx('phone', 0.5)
    });
}

async function startOnlineMode() {
    const player = normalizePlayer({ charKey: selectedChar });
    let roomId;
    try {
        roomId = await createRoom(player);
    } catch (e) {
        showToast('❌ Kunde inte skapa rum — kolla nätet');
        return;
    }
    gameState.mode = 'online';
    gameState.players = [player];
    gameState.currentPlayerIdx = 0; gameState.round = 1;
    gameState.gameOver = false; gameState.accountKey = null;
    setupSms();
    showToast(`🌐 Rum skapat: ${roomId}`);
    document.getElementById('screen-select').innerHTML = `
        <div class="lobby-box">
            <h2>🌐 Online Lobby</h2>
            <p class="sub">Dela denna kod med dina kompisar!</p>
            <div class="room-code">${escapeHtml(roomId)}</div>
            <div class="lobby-players" id="lobby-players"></div>
            <button class="btn-start" id="btn-start-match" onclick="window.startOnlineMatch()" style="margin-top:20px;">⚡ STARTA MATCH</button>
        </div>`;
    renderLobby();
}

window.startOnlineMatch = function () {
    startOnlineGame();
    showGameScreen();
};

let joining = false;
window.joinOnlineRoom = async function (code) {
    const room = String(code || '').trim().toUpperCase();
    if (!room) { showToast('Skriv en rumskod!'); return; }
    if (!selectedChar) { showToast('Välj en karaktär först! 🎭'); return; }
    if (joining) return;
    joining = true;
    const btn = document.querySelector('.join-btn');
    if (btn) btn.disabled = true;
    showToast(`🌐 Ansluter till ${room}...`);
    const res = await joinRoom(room, { charKey: selectedChar });
    joining = false;
    if (btn) btn.disabled = false;
    if (res.ok) {
        gameState.mode = 'online';
        gameState.accountKey = null;
        setupSms();
        showToast(`🌐 Gick med i rum ${room}!`);
        showGameScreen();
    } else {
        showToast(`❌ ${res.reason || 'Kunde inte gå med'}`);
    }
};

// ── Online-händelser ──
onPlayerJoin((p) => {
    refreshSms();
    showToast(`🟢 ${p.char.icon} ${p.char.name} gick med!`);
    renderLobby();
    refreshUI();
});
onChat((msg) => receiveOnlineChat(msg));
onSync(() => {
    refreshSms(); // vem som är online kan ha ändrats
    if (document.getElementById('screen-game')?.style.display === 'flex') refreshUI();
    showWinIfOver();
    ensureAITurn();
});
onPeerLeft((p) => {
    refreshSms();
    showToast(`🔴 ${p.char.name} lämnade — AI:n tar över`);
    refreshUI();
    ensureAITurn(); // även om den som lämnade höll på med en AI-tur
});
onHostLost(() => {
    showToast('🔴 Värden kopplade ner — du spelar vidare mot AI');
    refreshUI();
    ensureAITurn();
});

function showGameScreen() {
    document.getElementById('screen-login').style.display = 'none';
    document.getElementById('screen-select').style.display = 'none';
    document.getElementById('screen-game').style.display = 'flex';
    const btnMusic = document.getElementById('btn-music');
    if (btnMusic) btnMusic.textContent = gameState.musicMuted ? '🔇' : '🎵';
    refreshUI();
    initCBDLeaves(); addRoastWelcome(); showPhoneToggle();
    startMusic();
    const me = currentPlayer();
    if (me) {
        spawnParticles([me.char.icon, '🔥', '💰'], 12);
        showToast(`${me.char.icon} ${me.char.name} startar sitt imperium!`);
    }
    ensureAITurn();
}

window.doSave = function () {
    if (gameState.isOnline) { showToast('🌐 Onlinematcher sparas inte'); return; }
    showToast(saveGame(gameState.accountKey) ? '💾 Sparat!' : '⚠️ Kunde inte spara');
};

// ── Login System ──
function renderLoginScreen() {
    const accounts = getAccounts();
    const container = document.getElementById('login-accounts');
    if (!container) return;
    container.innerHTML = '';
    Object.entries(CHARACTERS).forEach(([key, ch]) => {
        const acc = accounts[key];
        const saved = acc ? (() => { try { return JSON.parse(localStorage.getItem('empire_save_' + key)); } catch (e) { return null; } })() : null;
        const money = Number(saved?.players?.[0]?.money) || 0;
        const cred = getStreetCred(money);
        const card = document.createElement('div');
        card.className = 'login-card ' + (acc ? 'registered' : 'available');
        card.innerHTML = `<div class="lc-lock">${acc ? '🔒' : '➕'}</div>
            <div class="lc-avatar">${ch.icon}</div><div class="lc-name" style="color:${ch.color}">${ch.name}</div>
            ${acc ? `<div class="street-cred" style="background:${cred.color}22;color:${cred.color};">${cred.emoji} ${cred.title}</div><div class="lc-rank">💰 ${formatNum(money)}</div>` : '<div class="lc-rank">Ledig</div>'}`;
        card.addEventListener('click', () => acc ? showLogin(key) : showRegister(key));
        container.appendChild(card);
    });
}

function showLogin(charKey) {
    const ch = CHARACTERS[charKey];
    const modal = document.getElementById('login-modal');
    modal.innerHTML = `<div class="login-modal-box">
        <div style="font-size:50px;margin-bottom:10px;">${ch.icon}</div>
        <h3 style="color:${ch.color}">${ch.name}</h3><p class="lm-sub">Ange lösenord</p>
        <div class="login-error" id="login-error">Fel lösenord!</div>
        <input type="password" id="login-pass" placeholder="Lösenord..." onkeydown="if(event.key==='Enter')window.doLogin('${charKey}')">
        <button class="btn-login" style="background:linear-gradient(135deg,${ch.color},${ch.color}88);" onclick="window.doLogin('${charKey}')">🔓 LOGGA IN</button>
        <button class="btn-guest" onclick="document.getElementById('login-modal').classList.remove('open')">Avbryt</button>
    </div>`;
    modal.classList.add('open');
    setTimeout(() => document.getElementById('login-pass')?.focus(), 100);
}

function showRegister(charKey) {
    const ch = CHARACTERS[charKey];
    const modal = document.getElementById('login-modal');
    modal.innerHTML = `<div class="login-modal-box">
        <div style="font-size:50px;margin-bottom:10px;">${ch.icon}</div>
        <h3 style="color:${ch.color}">Registrera ${ch.name}</h3><p class="lm-sub">Välj ett lösenord</p>
        <div class="login-error" id="login-error"></div>
        <input type="password" id="reg-pass" placeholder="Lösenord (min 3 tecken)..." onkeydown="if(event.key==='Enter')window.doRegister('${charKey}')">
        <input type="password" id="reg-pass2" placeholder="Bekräfta lösenord..." onkeydown="if(event.key==='Enter')window.doRegister('${charKey}')">
        <button class="btn-login" style="background:linear-gradient(135deg,${ch.color},${ch.color}88);" onclick="window.doRegister('${charKey}')">🔐 SKAPA KONTO</button>
        <button class="btn-guest" onclick="document.getElementById('login-modal').classList.remove('open')">Avbryt</button>
    </div>`;
    modal.classList.add('open');
}

window.doLogin = function (charKey) {
    const pass = document.getElementById('login-pass').value;
    const accs = getAccounts();
    if (!accs[charKey] || simpleHash(pass) !== accs[charKey].password) {
        const err = document.getElementById('login-error'); err.textContent = 'Fel lösenord! 🚫'; err.style.display = 'block'; return;
    }
    currentAccount = charKey; selectedChar = charKey;
    document.getElementById('login-modal').classList.remove('open');
    if (loadGame(charKey)) { showGameScreen(); showToast(`🔓 Välkommen tillbaka, ${CHARACTERS[charKey].name}!`); applyPendingBust(); }
    else {
        document.getElementById('screen-login').style.display = 'none';
        document.getElementById('screen-select').style.display = 'flex';
        renderCharCards();
    }
};

window.doRegister = function (charKey) {
    const pass = document.getElementById('reg-pass').value;
    const pass2 = document.getElementById('reg-pass2').value;
    const err = document.getElementById('login-error');
    if (pass.length < 3) { err.textContent = 'Minst 3 tecken!'; err.style.display = 'block'; return; }
    if (pass !== pass2) { err.textContent = 'Matchar inte!'; err.style.display = 'block'; return; }
    const accs = getAccounts();
    accs[charKey] = { password: simpleHash(pass), created: Date.now() };
    saveAccounts(accs);
    document.getElementById('login-modal').classList.remove('open');
    showToast(`🔐 ${CHARACTERS[charKey].name} registrerad!`);
    renderLoginScreen();
};

// ── Stabilitet: fånga oväntade fel istället för att spelet tyst dör ──
let lastErrorToast = 0;
function reportError(err) {
    console.error(err);
    if (Date.now() - lastErrorToast > 8000) {
        lastErrorToast = Date.now();
        showToast('⚠️ Något gick snett — spelet fortsätter');
    }
}
window.addEventListener('error', (e) => reportError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));
['pointerdown', 'keydown'].forEach(ev => window.addEventListener(ev, unlockAudio, { once: true, passive: true }));
// Säg hejdå när fliken stängs så att de andra inte väntar på en spelare som är borta
// Stängs fliken: skicka det senaste (t.ex. köp i stan) till värden innan vi säger hejdå
window.addEventListener('pagehide', () => { if (gameState.isOnline) { closeSmsOverlay(); syncMe(); sayGoodbye(); leaveRoom(); } });

// En nyare version har publicerats: erbjud omladdning (onlinerummet går att gå med i igen med samma kod)
function showUpdateBanner() {
    if (document.getElementById('update-banner')) return;
    const b = document.createElement('button');
    b.id = 'update-banner';
    b.className = 'update-banner';
    b.textContent = '🔄 Ny version av spelet — tryck här för att ladda om';
    b.addEventListener('click', () => location.reload());
    document.body.appendChild(b);
}

// ── Init ──
renderApp();
watchForUpdates(showUpdateBanner);
const hasAccounts = Object.keys(getAccounts()).length > 0;
if (hasAccounts) {
    document.getElementById('screen-login').style.display = 'flex';
    document.getElementById('screen-select').style.display = 'none';
    renderLoginScreen();
} else {
    document.getElementById('screen-login').style.display = 'none';
    document.getElementById('screen-select').style.display = 'flex';
}
