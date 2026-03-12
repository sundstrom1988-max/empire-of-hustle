// Game data constants
export const CHARACTERS = {
    kimit: { name: 'Dr. KimIT', icon: '👨‍⚕️', img: '1207.png', color: '#ff4fd8', ability: 'income_boost', abilityVal: 0.20, desc: '+20% inkomst' },
    gargamel: { name: 'Gargamel', icon: '🧙‍♂️', img: null, color: '#7c3aed', ability: 'steal', abilityVal: 0.10, desc: 'Stjäl 10% var 5:e runda' },
    mehmet: { name: 'Mehmet', icon: '🥙', img: null, color: '#22c55e', ability: 'pitch_boost', abilityVal: 0.15, desc: '+15% pitch-chans' },
    juan: { name: 'Juan', icon: '🌮', img: null, color: '#f97316', ability: 'market_luck', abilityVal: 0.15, desc: '-15% risk svarta marknaden' },
    knansen: { name: 'Knansen', icon: '🎤', img: null, color: '#06b6d4', ability: 'event_boost', abilityVal: 0.25, desc: '+25% belöning från events' },
    herrman: { name: 'Herrman', icon: '🎩', img: null, color: '#eab308', ability: 'save_money', abilityVal: 0.20, desc: '-20% på alla förluster' }
};

export const SHOPS = [
    { id: 'kebab', icon: '🥙', name: 'Mehmets Kebab', desc: 'Ortens bästa kebab med riktig vitsås', price: 500, income: 80 },
    { id: 'barber', icon: '💈', name: 'Frisören på hörnet', desc: 'Fade, skägg, allt du behöver bram', price: 1200, income: 180 },
    { id: 'gym', icon: '🏋️', name: 'Hustle Gym', desc: 'Gör gains medan du gör pengar', price: 3000, income: 400 },
    { id: 'studio', icon: '🎵', name: 'Beat Studio', desc: 'Producera hits, sälj beats', price: 5000, income: 700 },
    { id: 'club', icon: '🍾', name: 'Nattklubben VIP', desc: 'Ingång 200, bord 5000, vibes — ovärderliga', price: 12000, income: 1500 },
    { id: 'tech', icon: '💻', name: 'KimIT Tech AB', desc: 'IT-konsulter, appar, och rocket fuel', price: 25000, income: 3200 },
    { id: 'tower', icon: '🏗️', name: 'Skyskrapan', desc: 'Ditt eget imperium i betong och glas', price: 60000, income: 7500 },
    { id: 'rocket', icon: '🚀', name: 'RocketFuel Industries', desc: 'Globalt brand — du ÄR imperiet', price: 150000, income: 20000 }
];

export const EVENTS = [
    { title: '💰 Skatteåterbäring!', desc: 'Staten ger tillbaka pengar', minAmt: 200, maxAmt: 800, type: 'gain' },
    { title: '🔥 Viral TikTok!', desc: 'Din business blev viral', minAmt: 500, maxAmt: 2000, type: 'gain' },
    { title: '📉 Börscrash!', desc: 'Marknaden rasar, du förlorar cash', minAmt: 300, maxAmt: 1200, type: 'loss' },
    { title: '🎰 Lotterivinst!', desc: 'Du hittade en skraplott!', minAmt: 1000, maxAmt: 5000, type: 'gain' },
    { title: '👮 Inspektion!', desc: 'Kommunen kräver böter', minAmt: 200, maxAmt: 1500, type: 'loss' },
    { title: '🤝 Sponsordeal!', desc: 'Ett stort varumärke vill sponsra dig', minAmt: 800, maxAmt: 3000, type: 'gain' },
    { title: '🌪️ Storm!', desc: 'En storm skadar dina lokaler', minAmt: 500, maxAmt: 2000, type: 'loss' },
    { title: '⭐ Ryktesboost!', desc: 'Folk älskar dig, rykte stiger!', minAmt: 2, maxAmt: 8, type: 'rep' },
    { title: '🧙 Gargamels Förbannelse', desc: 'Mörk magi kostar pengar', minAmt: 400, maxAmt: 1800, type: 'loss' },
    { title: '🥙 Mehmets Vitsås-Deal', desc: 'Mehmet bjuder på en lukrativ deal', minAmt: 600, maxAmt: 2500, type: 'gain' },
    { title: '💎 Mystisk Skatt!', desc: 'Du hittade en gömd skatt!', minAmt: 2000, maxAmt: 8000, type: 'gain' },
    { title: '😤 Troll på nätet!', desc: 'Ditt rykte tar en smäll', minAmt: 1, maxAmt: 5, type: 'rep_loss' }
];

export const BLACK_MARKET_DEALS = [
    { id: 'fake_id', icon: '🪪', name: 'Falska ID-kort', desc: 'Sälj premium-fejk till studenterna', cost: 200, reward: [600, 1500], risk: 25 },
    { id: 'bootleg', icon: '📀', name: 'Piratkopierade beats', desc: 'Stolen beats, stora vinster', cost: 100, reward: [300, 800], risk: 15 },
    { id: 'smuggle', icon: '📦', name: 'Smuggelgods', desc: 'Ingen vet vad som är i lådan...', cost: 500, reward: [1200, 3500], risk: 35 },
    { id: 'crypto_scam', icon: '🪙', name: 'Shady Crypto-deal', desc: 'Pump and dump, klassikern', cost: 800, reward: [2000, 6000], risk: 40 },
    { id: 'vitsas', icon: '🧄', name: 'Mehmets "Special" Vitsås', desc: 'Hemlig ingrediens, under bordet', cost: 150, reward: [500, 2000], risk: 10 },
    { id: 'hack', icon: '💻', name: 'Hacka konkurrenten', desc: 'Stjäl deras kundregister', cost: 1000, reward: [3000, 8000], risk: 50 },
    { id: 'counterfeit', icon: '💵', name: 'Falska sedlar', desc: 'Ser ut som riktiga...', cost: 600, reward: [1800, 5000], risk: 45 },
    { id: 'insider', icon: '📊', name: 'Insider-tips', desc: 'Börs-info ingen annan har', cost: 1500, reward: [4000, 12000], risk: 30 }
];

export const PITCH_SUCCESS = [
    { verdict: '🔥 FETT ÄKTA!', text: 'Investerarna kastar pengar på dig!', color: '#22c55e' },
    { verdict: '💎 SEXY MILJONER!', text: 'Den idén är guld värd!', color: '#fbbf24' },
    { verdict: '🚀 IKONISK!', text: 'Du är nästa Elon, fast snyggare!', color: '#ff4fd8' },
    { verdict: '⭐ BRILLIANT!', text: 'Perrongmagi på hög nivå!', color: '#7c3aed' }
];

export const PITCH_FAIL = [
    { verdict: '😂 TOTAL BLUFF!', text: 'Mehmets vitsås är mer äkta!' },
    { verdict: '🗑️ SOPOR!', text: 'Den idén hör hemma i containern.' },
    { verdict: '💀 DÖD IDÉ!', text: 'R.I.P. din affärsplan.' }
];

export const CARS = [
    { id: 'cykel', emoji: '🚲', name: 'Cykel', price: 300, boost: 'Gratis transport', boostType: 'none' },
    { id: 'moped', emoji: '🛵', name: 'Moped EPA', price: 1500, boost: '+5% inkomst', boostType: 'income', val: 0.05 },
    { id: 'bmw', emoji: '🚗', name: 'BMW E46', price: 5000, boost: '+10% inkomst', boostType: 'income', val: 0.10 },
    { id: 'mercedes', emoji: '🚙', name: 'Mercedes AMG', price: 15000, boost: '+15% inkomst', boostType: 'income', val: 0.15 },
    { id: 'lambo', emoji: '🏎️', name: 'Lamborghini', price: 50000, boost: '+20% inkomst', boostType: 'income', val: 0.20 },
    { id: 'rolls', emoji: '🚘', name: 'Rolls Royce', price: 100000, boost: '+25% inkomst + VIP', boostType: 'income', val: 0.25 }
];

export const SOUNDS = {
    bgMusic: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-8.mp3',
    laugh: 'https://www.myinstants.com/media/sounds/sitcom-laughing-sound-effect.mp3',
    coin: 'https://www.myinstants.com/media/sounds/coins.mp3',
    dice: 'https://www.myinstants.com/media/sounds/shake-and-roll-dice.mp3',
    jail: 'https://www.myinstants.com/media/sounds/metal-pipe.mp3',
    win: 'https://www.myinstants.com/media/sounds/tada-fanfare-a.mp3'
};

export const PHONE_DEALS = [
    { id: 'tip', name: 'Insider-tips via SMS', desc: 'Anonym källa skickar börs-info', cost: 400, reward: [800, 2500], risk: 15 },
    { id: 'fence', name: 'Sälj stöldgods', desc: 'Nån vill köpa "saker" ingen frågar om', cost: 0, reward: [500, 2000], risk: 30 },
    { id: 'launder', name: 'Tvätta pengar', desc: 'Putsa dina smutsiga pengar', cost: 1000, reward: [1500, 4000], risk: 20 },
    { id: 'bribe', name: 'Muta inspektören', desc: 'Slipper böter nästa runda', cost: 800, reward: [0, 0], risk: 10 }
];

export const SLOT_SYMBOLS = ['🍒', '🍋', '🔔', '💎', '7️⃣', '🍀'];

export const STREET_CRED = [
    { min: 0, title: 'Nybörjare', color: 'rgba(255,255,255,0.3)', emoji: '🐣' },
    { min: 1000, title: 'Gatans Lansen', color: '#22c55e', emoji: '🌱' },
    { min: 5000, title: 'Kebab-Mogul', color: '#f97316', emoji: '🥙' },
    { min: 15000, title: 'Hustle King', color: 'var(--gold)', emoji: '👑' },
    { min: 50000, title: 'Block Boss', color: 'var(--kimit)', emoji: '🔥' },
    { min: 100000, title: 'Imperiet', color: '#a855f7', emoji: '💎' },
    { min: 500000, title: 'Legendar', color: '#ef4444', emoji: '🏆' },
    { min: 1000000, title: 'IKONISK', color: '#ff4fd8', emoji: '⚡' }
];
