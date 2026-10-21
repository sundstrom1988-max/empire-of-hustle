// ═══════════════════════════════════════════
//  STAN — konstanter
// ═══════════════════════════════════════════

export const TILE = 64;
export const MAP_W = 64;
export const MAP_H = 64;

export const T = {
    ROAD: 0,
    SIDEWALK: 1,
    BUILDING: 2,
    GRASS: 3,
    WATER: 4,
    TREE: 5,
    PLAZA: 6,
    LOT: 7, // parkering / asfaltsplan
    WALL: 8
};

export const SOLID = new Set([T.BUILDING, T.WATER, T.TREE, T.WALL]);
export const WALKABLE = new Set([T.ROAD, T.SIDEWALK, T.GRASS, T.PLAZA, T.LOT]);

// Riktningar: N, E, S, W (bitmask 1, 2, 4, 8 i lane-kartan)
export const N = 0, E = 1, S = 2, W = 3;
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const DIR_ANGLE = [-Math.PI / 2, 0, Math.PI / 2, Math.PI];
export const OPPOSITE = [S, W, N, E];

// Gängen i stan. Namnen är parodier i GTA-anda — byt fritt här.
//  kind: 'street' kör bil, 'mc' kör HD-choppers och bär väst.
//  rival: det gäng som hatar dig när du jobbar för (eller går med i) det här.
//  cars: vilka bilar gängets medlemmar kör (MC-gäng kör 'hd').
export const GANGS = [
    { id: 'kebab', name: 'Kebabmaffian', short: 'Kebabmaffian', icon: '🥙', color: '#22c55e', district: 'orten', boss: 'Mehmet', bossIcon: '🥙', kind: 'street', rival: 'dods', cars: ['gang_kebab'] },
    { id: 'orden', name: 'Mörka Orden', short: 'Mörka Orden', icon: '🧙', color: '#a855f7', district: 'centrum', boss: 'Gargamel', bossIcon: '🧙‍♂️', kind: 'street', rival: 'taco', cars: ['gang_orden'] },
    { id: 'taco', name: 'Tacokartellen', short: 'Tacokartellen', icon: '🌮', color: '#f97316', district: 'hamnen', boss: 'Juan', bossIcon: '🌮', kind: 'street', rival: 'orden', cars: ['gang_taco'] },
    { id: 'dods', name: 'Dödsskvadronen', short: 'Dödsskvadronen', icon: '💀', color: '#e5e7eb', district: 'vasterort', boss: 'Lill-Döden', bossIcon: '💀', kind: 'street', rival: 'kebab', cars: ['bmw', 'audi', 'mercedes'], carColors: ['#0b0b0f', '#111827', '#f5f5f5'] },
    { id: 'hdmc', name: 'Heavens Djävlar MC', short: 'Heavens Djävlar', icon: '😈', color: '#dc2626', patch: '#f5f5f5', district: 'skogsbacken', boss: 'Big Bertil', bossIcon: '🧔', kind: 'mc', rival: 'bmc', cars: ['hd'] },
    { id: 'bmc', name: 'Bananidos MC', short: 'Bananidos', icon: '🍌', color: '#facc15', patch: '#dc2626', district: 'industrin', boss: 'El Bananero', bossIcon: '🤠', kind: 'mc', rival: 'hdmc', cars: ['hd'] }
];

export const GANG_IDS = GANGS.map(g => g.id);

// Sex turfs: tre kolumner × två rader
export const DISTRICTS = {
    vasterort: { id: 'vasterort', name: 'VÄSTERORT', gang: 'dods' },
    centrum: { id: 'centrum', name: 'CENTRUM', gang: 'orden' },
    skogsbacken: { id: 'skogsbacken', name: 'SKOGSBACKEN', gang: 'hdmc' },
    orten: { id: 'orten', name: 'ORTEN', gang: 'kebab' },
    industrin: { id: 'industrin', name: 'INDUSTRIN', gang: 'bmc' },
    hamnen: { id: 'hamnen', name: 'HAMNEN', gang: 'taco' }
};

export const PLACE_NAMES = {
    vasterort: ['Tunnelbanan', 'Fritidsgården', 'Gymmet', 'Solariet'],
    centrum: ['Torget', 'Banken', 'Gallerian', 'Hotell Royal'],
    skogsbacken: ['Golfklubben', 'Klubbstugan', 'Villagatan', 'Tennisbanan'],
    orten: ['Kebabgatan', 'Perrongen', 'Pizzerian', 'Tvättstugan'],
    industrin: ['Skroten', 'Verkstan', 'Fabriken', 'Bensinmacken'],
    hamnen: ['Kajen', 'Fiskhallen', 'Containerplanen', 'Färjeläget']
};

export const HOSTILE_RESPECT = -25;
export const JOIN_RESPECT = 30;
export const RESPECT_MIN = -100;
export const RESPECT_MAX = 100;
