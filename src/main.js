// ═══════════════════════════════════════════
//  EMPIRE OF HUSTLE — Main Entry Point
// ═══════════════════════════════════════════

import './styles/base.css';
import './styles/components.css';

import { CHARACTERS, SHOPS, STREET_CRED } from './data/gameData.js';
import { gameState, createPlayerState, currentPlayer, formatNum, saveGame, loadGame } from './game/state.js';
import { renderEmpire, renderShop, buyShop, upgradeBiz, sellBiz, confirmSellBiz, showStashModal, doStash, policeRaid, doPitch, rollDice, endTurn, updateHUD, updateTurnBar, switchTab, calcIncome } from './game/core.js';
import { renderMarket, doMarketDeal, renderJail, payBail, addRoastWelcome, sendRoastChat, initCBDLeaves } from './features/features.js';
import { initMinigames, playDiceBattle, playGuessNumber, playSlotMachine, playCoinFlip } from './features/minigames.js';
import { showPhoneToggle, togglePhone, phoneOpenSMS, phoneOpenChat, sendPhoneSMS, phoneOpenDeals, doPhoneDeal, phoneOpenCars, buyCar, phoneOpenWallet, phoneOpenStatus, renderDashboard } from './features/phone.js';
import { initFirebase, isFirebaseConfigured, createRoom, joinRoom, syncState, startOnlineGame } from './multiplayer/sync.js';
import { playSound, toggleMusic, toggleSfx, showToast, spawnParticles, startMusic } from './utils/effects.js';
import { showHeistButton, selectHeistTarget, doHeist, sweepEvidence } from './features/gargamel.js';
import { renderGarage, buyGarageCar, pimpCar } from './features/garage.js';

// ── Expose functions to window for onclick handlers ──
window.game = {
    switchTab, upgradeBiz, buyShop, doPitch, rollDice, endTurn,
    doMarketDeal, payBail, sendRoastChat,
    playDiceBattle, playGuessNumber, playSlotMachine, playCoinFlip, initMinigames,
    togglePhone, phoneOpenSMS, phoneOpenChat, sendPhoneSMS,
    phoneOpenDeals, doPhoneDeal, phoneOpenCars, buyCar, phoneOpenWallet, phoneOpenStatus,
    renderDashboard, toggleMusic, toggleSfx,
    refreshUI() { updateHUD(); renderEmpire(); renderShop(); renderMarket(); renderJail(); },
    selectHeistTarget, doHeist, sweepEvidence,
    renderGarage, buyGarageCar, pimpCar
};

// ── Auth helpers ──
function simpleHash(str) { let h = 0; for (let i = 0; i < str.length; i++) { h = ((h << 5) - h) + str.charCodeAt(i); h |= 0; } return h.toString(36); }
function getAccounts() { try { return JSON.parse(localStorage.getItem('empire_accounts') || '{}'); } catch (e) { return {}; } }
function saveAccounts(a) { localStorage.setItem('empire_accounts', JSON.stringify(a)); }
function getStreetCred(money) { let c = STREET_CRED[0]; for (const s of STREET_CRED) { if (money >= s.min) c = s; } return c; }

let selectedChar = null;
let selectedMode = 'single';
let currentAccount = null;

// ── Render App ──
function renderApp() {
    const app = document.getElementById('app');
    app.innerHTML = `
    <!-- LOGIN -->
    <div id="screen-login" style="display:none;">
        <h1>Empire of Hustle</h1>
        <p class="sub">🔒 Välj ditt konto eller skapa nytt</p>
        <div class="login-accounts" id="login-accounts"></div>
        <div style="display:flex;gap:12px;flex-wrap:wrap;justify-content:center;">
            <button class="btn-guest" id="btn-guest-play" style="max-width:200px;">🎮 Gäst-läge</button>
            ${isFirebaseConfigured() ? '<button class="btn-guest" id="btn-join-room" style="max-width:200px;">🌐 Gå med i Rum</button>' : ''}
        </div>
    </div>
    <div class="login-modal" id="login-modal"></div>

    <!-- CHARACTER SELECT -->
    <div id="screen-select">
        <h1>Empire of Hustle</h1>
        <p class="sub">🔥 Välj din karaktär och bygg ditt imperium</p>
        <div class="char-cards" id="char-cards"></div>
        <div class="mode-row" id="mode-row">
            <button class="mode-btn active" id="mode-single" onclick="window.setMode('single')">🎮 Solo</button>
            <button class="mode-btn" id="mode-multi2" onclick="window.setMode('multi2')">👥 2 Spelare</button>
            <button class="mode-btn" id="mode-multi3" onclick="window.setMode('multi3')">👥 3 Spelare</button>
            <button class="mode-btn" id="mode-ai" onclick="window.setMode('ai')">🤖 vs AI</button>
            ${isFirebaseConfigured() ? '<button class="mode-btn" id="mode-online" onclick="window.setMode(\'online\')">🌐 Online</button>' : ''}
        </div>
        <div class="join-section" id="join-section">
            <p style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:8px;">🌐 Har du en rumskod? Gå med i en kompis lobby!</p>
            <div style="display:flex;gap:8px;align-items:center;justify-content:center;">
                <input type="text" id="join-code-input" placeholder="Skriv rumskod..." style="padding:10px 16px;border-radius:10px;border:1px solid rgba(255,255,255,0.15);background:rgba(255,255,255,0.05);color:white;font-family:'Outfit';font-weight:700;font-size:14px;text-transform:uppercase;width:160px;text-align:center;" maxlength="10">
                <button class="mode-btn" onclick="window.joinOnlineRoom(document.getElementById('join-code-input').value)" style="background:linear-gradient(135deg,#22c55e,#16a34a);border:none;color:white;">🌐 GÅ MED</button>
            </div>
        </div>
        <button class="btn-start" id="btn-start">⚡ STARTA</button>
    </div>

    <!-- GAME -->
    <div id="screen-game">
        <div class="hud">
            <div class="hud-stats">
                <span id="hud-name"></span><span id="hud-money"></span><span id="hud-rep"></span>
                <span id="hud-round"></span><span id="hud-biz"></span>
            </div>
            <div class="hud-controls">
                <button class="hud-btn" id="btn-music" onclick="window.game.toggleMusic()">🎵</button>
                <button class="hud-btn" id="btn-sfx" onclick="window.game.toggleSfx()">🔔</button>
                <button class="hud-btn" onclick="window.doSave()">💾</button>
                <button class="hud-btn" onclick="window.game.endTurn()">⏭️ Avsluta tur</button>
            </div>
        </div>
        <div class="turn-indicator" id="turn-indicator"></div>
        <div class="tab-bar">
            <button class="tab-btn active" onclick="window.game.switchTab('empire',this)">🏢 Imperium</button>
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
        <div class="panel" id="panel-empire"><h2 style="font-family:'Outfit';font-weight:900;font-size:24px;margin-bottom:16px;">🏢 Ditt Imperium</h2><div id="empire-list"></div></div>
        <div class="panel" id="panel-pitch"><div class="pitch-area"><h2>💡 Pitcha din idé</h2><p class="sub">Övertyga investerarna!</p><button class="btn-pitch" onclick="window.game.doPitch()">🎤 PITCHA!</button><div id="pitch-result" style="margin-top:20px;"></div></div></div>
        <div class="panel" id="panel-events"><div class="dice-area"><h2>🎲 Slumpmässiga Events</h2><p class="sub">Rulla tärningen!</p><button class="btn-dice" onclick="window.game.rollDice()">🎲 RULLA!</button><div id="dice-result" style="margin-top:20px;"></div></div></div>
        <div class="panel" id="panel-shop"><h2 style="font-family:'Outfit';font-weight:900;font-size:24px;margin-bottom:16px;">🛒 Butik</h2><div class="shop-grid" id="shop-grid"></div></div>
        <div class="panel" id="panel-market"><h2 style="font-family:'Outfit';font-weight:900;font-size:24px;margin-bottom:16px;">🕶️ Svarta Marknaden</h2><div id="market-list"></div></div>
        <div class="panel" id="panel-jail"><h2 style="font-family:'Outfit';font-weight:900;font-size:24px;margin-bottom:16px;">🔒 Häktet</h2><div id="jail-content"></div></div>
        <div class="panel" id="panel-garage"><div id="garage-content"></div></div>
        <div class="panel" id="panel-minigames"><h2 style="font-family:'Outfit';font-weight:900;font-size:24px;margin-bottom:16px;">🎮 Mini-Spel</h2><div class="mini-grid" id="minigames-grid"></div><div id="minigame-result" style="margin-top:20px;text-align:center;"></div></div>
        <div class="panel" id="panel-roast">
            <h2 style="font-family:'Outfit';font-weight:900;font-size:24px;margin-bottom:16px;">💬 Gatan Snackar</h2>
            <div class="chat-area"><div class="chat-messages" id="chat-messages"></div><div id="typing-indicator" style="display:none;padding:4px 12px;font-size:12px;color:rgba(255,255,255,0.3);">skriver...</div>
            <div class="chat-bar"><input type="text" id="chat-input" placeholder="Skriv något sjukt..." onkeydown="if(event.key==='Enter')window.game.sendRoastChat()"><button onclick="window.game.sendRoastChat()">💬</button></div></div>
        </div>
        <div class="panel" id="panel-dashboard"><h2 style="font-family:'Outfit';font-weight:900;font-size:24px;margin-bottom:16px;">📊 Dashboard</h2><div class="dash-grid" id="dash-grid"></div></div>
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
    // Guest button
    document.getElementById('btn-guest-play')?.addEventListener('click', () => {
        currentAccount = null;
        document.getElementById('screen-login').style.display = 'none';
        document.getElementById('screen-select').style.display = 'flex';
    });

    // Join room
    document.getElementById('btn-join-room')?.addEventListener('click', () => {
        const code = prompt('Ange rum-kod:');
        if (code) window.joinOnlineRoom(code.toUpperCase());
    });

    // Character cards
    renderCharCards();


    // Start button
    document.getElementById('btn-start')?.addEventListener('click', startGame);
}

// ── Render character cards with lock state ──
function renderCharCards() {
    const charContainer = document.getElementById('char-cards');
    if (!charContainer) return;
    charContainer.innerHTML = '';
    const accounts = getAccounts();
    Object.entries(CHARACTERS).forEach(([key, ch]) => {
        const isLocked = !!accounts[key];
        const card = document.createElement('div');
        card.className = 'char-card' + (isLocked ? ' locked' : '') + (selectedChar === key ? ' selected' : '');
        card.style.setProperty('--char-color', ch.color);
        card.innerHTML = `
            ${isLocked ? '<div class="char-lock-badge">🔒</div>' : ''}
            <div class="char-icon">${ch.img ? `<img src="${ch.img}" onerror="this.parentNode.textContent='${ch.icon}'">` : ch.icon}</div>
            <div class="char-name" style="color:${ch.color}">${ch.name}</div>
            <div class="char-desc">${ch.desc}</div>
            ${isLocked
                ? `<button class="btn-char-unlock" style="--char-color:${ch.color}" onclick="event.stopPropagation();window.showCharUnlock('${key}')">🔓 Lås upp</button>`
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
    showToast(`🔓 ${CHARACTERS[charKey].name} upplåst!`);
    // Check for saved game
    const saved = loadGame(charKey);
    if (saved) {
        showGameScreen();
        showToast(`🔓 Välkommen tillbaka, ${CHARACTERS[charKey].name}!`);
    } else {
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
};

// ── Start Game ──
function startGame() {
    if (!selectedChar) { showToast('Välj en karaktär! 🎭'); return; }
    gameState.mode = selectedMode;
    gameState.players = [createPlayerState(selectedChar)];
    gameState.currentPlayerIdx = 0; gameState.round = 1;

    if (selectedMode === 'multi2' || selectedMode === 'multi3') {
        const numExtra = selectedMode === 'multi2' ? 1 : 2;
        const available = Object.keys(CHARACTERS).filter(k => k !== selectedChar);
        for (let i = 0; i < numExtra; i++) {
            const key = prompt(`Spelare ${i + 2}: Välj karaktär (${available.join(', ')})`);
            if (key && CHARACTERS[key]) { gameState.players.push(createPlayerState(key)); available.splice(available.indexOf(key), 1); }
        }
    } else if (selectedMode === 'ai') {
        const aiKeys = Object.keys(CHARACTERS).filter(k => k !== selectedChar);
        const aiKey = aiKeys[Math.floor(Math.random() * aiKeys.length)];
        const aiPlayer = createPlayerState(aiKey);
        aiPlayer.isAI = true;
        gameState.players.push(aiPlayer);
    } else if (selectedMode === 'online') {
        startOnlineMode();
        return;
    }

    showGameScreen();
}

async function startOnlineMode() {
    if (!initFirebase()) { showToast('Firebase inte konfigurerat!'); return; }
    const player = createPlayerState(selectedChar);
    const roomId = await createRoom(player);
    showToast(`🌐 Rum skapat: ${roomId}`);
    // Show lobby
    document.getElementById('screen-select').innerHTML = `
        <div class="lobby-box">
            <h2>🌐 Online Lobby</h2>
            <p class="sub">Dela denna kod med dina kompisar!</p>
            <div class="room-code">${roomId}</div>
            <div class="lobby-players" id="lobby-players"><div class="lobby-player">${CHARACTERS[selectedChar].icon} ${CHARACTERS[selectedChar].name} (Värd)</div></div>
            <button class="btn-start" onclick="window.startOnlineMatch()" style="margin-top:20px;">⚡ STARTA MATCH</button>
        </div>`;
}

window.startOnlineMatch = async function () {
    gameState.players = [createPlayerState(selectedChar)];
    await startOnlineGame();
    showGameScreen();
};

window.joinOnlineRoom = async function (code) {
    if (!initFirebase()) { showToast('Firebase inte konfigurerat!'); return; }
    if (!selectedChar) { showToast('Välj en karaktär först!'); return; }
    const player = createPlayerState(selectedChar);
    const ok = await joinRoom(code, player);
    if (ok) { showToast(`🌐 Gick med i rum ${code}!`); showGameScreen(); }
    else { showToast('❌ Kunde inte gå med — kolla koden!'); }
};

function showGameScreen() {
    document.getElementById('screen-login').style.display = 'none';
    document.getElementById('screen-select').style.display = 'none';
    document.getElementById('screen-game').style.display = 'flex';
    updateHUD(); renderEmpire(); renderShop(); renderMarket(); renderJail();
    initCBDLeaves(); addRoastWelcome(); showPhoneToggle();
    startMusic();
    showHeistButton(); // Show secret Gargamel button if applicable
    if (gameState.players.length > 1) updateTurnBar();
    spawnParticles([currentPlayer().char.icon, '🔥', '💰'], 12);
    showToast(`${currentPlayer().char.icon} ${currentPlayer().char.name} startar sitt imperium!`);
}

window.doSave = function () { saveGame(currentAccount); showToast('💾 Sparat!'); };

// ── Login System ──
function renderLoginScreen() {
    const accounts = getAccounts();
    const container = document.getElementById('login-accounts');
    if (!container) return;
    container.innerHTML = '';
    Object.entries(CHARACTERS).forEach(([key, ch]) => {
        const acc = accounts[key];
        const saved = acc ? (() => { try { return JSON.parse(localStorage.getItem('empire_save_' + key)); } catch (e) { return null; } })() : null;
        const money = saved?.players?.[0]?.money || 0;
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
    const saved = loadGame(charKey);
    if (saved) { showGameScreen(); showToast(`🔓 Välkommen tillbaka, ${CHARACTERS[charKey].name}!`); }
    else { document.getElementById('screen-login').style.display = 'none'; document.getElementById('screen-select').style.display = 'flex'; }
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

// ── Init ──
renderApp();
const hasAccounts = Object.keys(getAccounts()).length > 0;
if (hasAccounts) {
    document.getElementById('screen-login').style.display = 'flex';
    document.getElementById('screen-select').style.display = 'none';
    renderLoginScreen();
} else {
    document.getElementById('screen-login').style.display = 'none';
    document.getElementById('screen-select').style.display = 'flex';
}
