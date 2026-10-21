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

export const GANGS = [
    { id: 'kebab', name: 'Kebabmaffian', icon: '🥙', color: '#22c55e', district: 'orten', boss: 'Mehmet', bossIcon: '🥙' },
    { id: 'orden', name: 'Mörka Orden', icon: '🧙', color: '#a855f7', district: 'centrum', boss: 'Gargamel', bossIcon: '🧙‍♂️' },
    { id: 'taco', name: 'Tacokartellen', icon: '🌮', color: '#f97316', district: 'hamnen', boss: 'Juan', bossIcon: '🌮' }
];

export const DISTRICTS = {
    orten: { id: 'orten', name: 'ORTEN', gang: 'kebab' },
    centrum: { id: 'centrum', name: 'CENTRUM', gang: 'orden' },
    hamnen: { id: 'hamnen', name: 'HAMNEN', gang: 'taco' }
};

export const PLACE_NAMES = {
    orten: ['Kebabgatan', 'Perrongen', 'Fritidsgården', 'Pizzerian', 'Tunnelbanan', 'Tvättstugan'],
    centrum: ['Torget', 'Banken', 'Stadshuset', 'Gallerian', 'Operan', 'Hotell Royal'],
    hamnen: ['Kajen', 'Fiskhallen', 'Containerplanen', 'Färjeläget', 'Lagret', 'Varvet']
};

export const HOSTILE_RESPECT = -25;
export const RESPECT_MIN = -100;
export const RESPECT_MAX = 100;
