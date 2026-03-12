// ═══════════════════════════════════════════
//  GARAGE — Visuellt garage med pimpa-system
// ═══════════════════════════════════════════

import { CARS } from '../data/gameData.js';
import { gameState, currentPlayer, formatNum } from '../game/state.js';
import { updateHUD, calcIncome } from '../game/core.js';
import { playSound, showToast, spawnParticles } from '../utils/effects.js';
import { syncState } from '../multiplayer/sync.js';

const BASE_PATH = import.meta.env.BASE_URL || '/';

// ── Render Garage Tab ──
export function renderGarage() {
    const el = document.getElementById('garage-content');
    if (!el) return;
    const p = currentPlayer();
    if (!p.cars) p.cars = [];
    if (!p.carPimps) p.carPimps = {};

    // Owned cars section
    const ownedCars = p.cars.map(id => CARS.find(c => c.id === id)).filter(Boolean);

    el.innerHTML = `
        <div class="garage-wrapper">
            ${ownedCars.length > 0 ? `
                <h3 class="garage-title">🔧 Ditt Garage</h3>
                <p class="garage-sub">Pimpa dina rides och visa upp dem!</p>

                <div class="garage-grid">
                    ${ownedCars.map(car => {
        const pimpLevel = p.carPimps[car.id] || 0;
        const tierNames = ['Bas', '⭐ Street', '🔥 Boss', '💎 Legend'];
        const totalBonus = calcCarBonus(car, pimpLevel);
        const nextPimp = car.pimps && car.pimps[pimpLevel];
        const afford = nextPimp ? p.money >= nextPimp.cost : false;

        return `<div class="garage-car-card" style="--gc:${getCarColor(car.id)}">
                            <div class="gcc-image-wrap">
                                <img src="${BASE_PATH}${car.img}" alt="${car.name}" class="gcc-image" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
                                <div class="gcc-emoji-fallback" style="display:none;">${car.emoji}</div>
                                <div class="gcc-tier-badge">${tierNames[pimpLevel]}</div>
                            </div>
                            <div class="gcc-info">
                                <h4 class="gcc-name">${car.emoji} ${car.name}</h4>
                                <div class="gcc-boost">+${Math.round(totalBonus * 100)}% inkomst</div>
                                <div class="gcc-pimps">
                                    ${car.pimps ? car.pimps.map((pimp, i) => {
            const done = i < pimpLevel;
            const next = i === pimpLevel;
            return `<div class="gcc-pimp ${done ? 'done' : ''} ${next ? 'next' : ''}">
                                            <span class="gp-dot">${done ? '✅' : next ? '🔧' : '🔒'}</span>
                                            <span class="gp-name">${pimp.name}</span>
                                            <span class="gp-desc">${pimp.desc}</span>
                                            ${next ? `<button class="btn-pimp" onclick="window.game.pimpCar('${car.id}')" ${afford ? '' : 'disabled'}>
                                                🔧 ${formatNum(pimp.cost)} 💰
                                            </button>` : ''}
                                            ${done ? '<span class="gp-bonus" style="color:var(--mehmet);">+' + Math.round(pimp.bonus * 100) + '%</span>' : ''}
                                        </div>`;
        }).join('') : ''}
                                </div>
                            </div>
                        </div>`;
    }).join('')}
                </div>

            ` : '<div class="garage-empty"><div class="ge-icon">🅿️</div><h3>Tomt garage!</h3><p>Köp din första gärri via telefonen 📱</p></div>'}

            <h3 class="garage-title" style="margin-top:30px;">🏪 Bilhandlare</h3>
            <p class="garage-sub">Köp nya fordon till ditt garage</p>

            <div class="garage-shop-grid">
                ${CARS.map(car => {
        const owned = p.cars.includes(car.id);
        const afford = p.money >= car.price;
        return `<div class="garage-shop-card ${owned ? 'owned' : ''}">
                        <div class="gsc-image-wrap">
                            <img src="${BASE_PATH}${car.img}" alt="${car.name}" class="gsc-image" onerror="this.style.display='none';this.nextElementSibling.style.display='block';">
                            <div class="gsc-emoji-fallback" style="display:none;">${car.emoji}</div>
                            ${owned ? '<div class="gsc-owned-badge">✅ ÄGER</div>' : ''}
                        </div>
                        <h5 class="gsc-name">${car.emoji} ${car.name}</h5>
                        <div class="gsc-price">${formatNum(car.price)} 💰</div>
                        <div class="gsc-boost">${car.boost}</div>
                        <button class="btn-buy-car" onclick="window.game.buyGarageCar('${car.id}')" ${owned || !afford ? 'disabled' : ''}>
                            ${owned ? '✅ Äger' : afford ? '🛒 KÖP' : '🔒 Inte råd'}
                        </button>
                    </div>`;
    }).join('')}
            </div>
        </div>
    `;
}

// ── Köp bil ──
export function buyGarageCar(id) {
    const p = currentPlayer();
    const car = CARS.find(c => c.id === id);
    if (!car || p.money < car.price || p.cars.includes(id)) return;
    if (!p.cars) p.cars = [];
    p.money -= car.price;
    p.totalSpent = (p.totalSpent || 0) + car.price;
    p.cars.push(id);
    playSound('coin');
    showToast(`${car.emoji} Köpte ${car.name}!`);
    spawnParticles([car.emoji, '🔥', '💰'], 10);
    updateHUD();
    renderGarage();
    if (gameState.isOnline) syncState();
}

// ── Pimpa bil ──
export function pimpCar(carId) {
    const p = currentPlayer();
    if (!p.carPimps) p.carPimps = {};
    const car = CARS.find(c => c.id === carId);
    if (!car || !car.pimps) return;

    const currentLevel = p.carPimps[carId] || 0;
    const nextPimp = car.pimps[currentLevel];
    if (!nextPimp || p.money < nextPimp.cost) return;

    p.money -= nextPimp.cost;
    p.totalSpent = (p.totalSpent || 0) + nextPimp.cost;
    p.carPimps[carId] = currentLevel + 1;

    playSound('coin');
    showToast(`🔧 ${car.name} pimpad! ${nextPimp.name}!`);
    spawnParticles([car.emoji, '🔧', '✨', '🔥'], 12);
    updateHUD();
    renderGarage();
    if (gameState.isOnline) syncState();
}

// ── Beräkna total bonus för en bil ──
function calcCarBonus(car, pimpLevel) {
    let bonus = car.val || 0;
    if (car.pimps) {
        for (let i = 0; i < pimpLevel && i < car.pimps.length; i++) {
            bonus += car.pimps[i].bonus;
        }
    }
    return bonus;
}

// ── Färg per fordonstyp ──
function getCarColor(carId) {
    const colors = {
        cykel: '#06b6d4',
        moped: '#f97316',
        bmw: '#3b82f6',
        mercedes: '#ef4444',
        lambo: '#eab308',
        rolls: '#a855f7'
    };
    return colors[carId] || '#ffffff';
}
