# Nivåsystemet i Empire of Hustle: från Springpojke till Gudfadern

Det här är den slutliga designen för nivåerna. Den ersätter de tre tidigare förslagen. Radnumren gäller koden som den såg ut när designen skrevs och flyttar sig när filerna ändras, så leta på funktionsnamnet.

Den rena logiken finns i `src/game/levels.js` och testas i `tests/levels.test.js`. Avsnitt 11 visar vad modulen exporterar och var koden avviker från texten nedan.

---

## 0. Beslut i korthet

**Grunden är Förslag 1.** Det har tre fördelar framför de andra:

- **Bäst skydd mot farmning.** XP-hinkar och spärrar i realtid fungerar även i solo, där en ny runda bara kostar ett klick på Avsluta tur.
- **Rättvisast PvP.** Värden räknar skadan, och nivån ändrar den bara mellan ×0,9 och ×1,1.
- **Kontrollerad kurva.** Kurvan bygger på spelets riktiga XP-källor, och alla siffror i tabellerna är omräknade.

**Från Förslag 3 tar vi:**
- presentationen i stan: XP-raden överst i vänsterspalten och en kö för nivå-upp som väntar tills "UPPDRAG KLART!" har visats
- en egen ruta för nivå-upp i imperiet
- fältet `p.lvSeen`, så att samma nivå inte firas två gånger
- regeln att "låst" visas före "inte råd"
- lånade vapen från marken
- kritiska träffar, så att den högre skadan märks
- Torpedslaget
- att respektändringar syns i HUD:en

**Från Förslag 2 tar vi:**
- fasindelningen: fas 1 är motorn plus spärrar på det som redan finns, fas 2 är nytt innehåll
- märkningen befintligt / nytt / bonus / kosmetiskt
- titelbonusen i respekt
- rabatten hos Pang-Pelle
- nivåkontrollen i `validateBuy`
- en enda funktion för all XP (`awardXp` i `levels.js`)

**Här avviker designen från alla tre förslagen:** verksamheterna i Butik (`SHOPS`) spärras inte av nivån.
- Imperiet är racet till 1 000 000 kr.
- AI:n åker aldrig till stan, och en del spelare kör bara brädspelet.
- Online skulle en veteran kunna köpa Skyskrapan direkt när pengarna räcker. Då avgörs racet av hur många timmar man spelat tidigare, inte av hur man spelar nu.

Nivån styr därför allt i stan: vapen, crew, uppdrag, brott, gömställen och Club Diamant. I imperiet styr den sidosakerna, som påverkar racet mindre: bilar, pimp, svarta marknaden och telefondeals. **Ägaren bör bekräfta det här beslutet.** Vill hen ändå spärra verksamheter föreslås kebab 1, frisör 2, gym 4, studio 6, nattklubb 9, tech 12, skyskrapa 16 och RocketFuel 20.

**Nivån följer karaktären mellan matcher (karriär).** `loadGame` raderar ett avgjort spel, så utan karriär går nivå 85–100 aldrig att nå.

---

## 1. Titelband

| Nivå | Titel | Emoji | Färg |
|---|---|---|---|
| 1–5 | Springpojke | 🛴 | `#9ca3af` |
| 6–10 | Hangaround | 👀 | `#a3e635` |
| 11–15 | Langare | 🎒 | `#22c55e` |
| 16–22 | Hustlare | 💸 | `#2dd4bf` |
| 23–30 | Torped | 🔨 | `#38bdf8` |
| 31–40 | Gängsoldat | 🪖 | `#6366f1` |
| 41–50 | Kvartersboss | 🏙️ | `#a855f7` |
| 51–62 | Kapo | 🎩 | `#ec4899` |
| 63–74 | Consigliere | 🍷 | `#f97316` |
| 75–84 | Underboss | 🥃 | `#ef4444` |
| 85–100 | Gudfadern | 🌹 | `#ffd23f` |

- Det blir 11 band. De är korta i början, så att titlarna kommer tätt, och längre mot slutet.
- Gudfadern får spelets befintliga guldfärg (`#ffd23f`, samma som pengarna i HUD:en).
- Nivå, titel och färg räknas alltid fram ur `p.xp`, så sparfiler och avrundningar kan aldrig hamna i osynk. `p.level` finns bara som en cache som `awardXp` och `normalizeLevelFields` skriver, och den används aldrig för att avgöra en spärr.
- Den pengabaserade `STREET_CRED` finns kvar men blir en liten rad, "Förmögenhet: Kebab-Mogul". Då konkurrerar inte två titlar med varandra.

---

## 2. XP-kurva

### Formel

```
need(L)  = 5 · round((30 + 15·L + 0,004·L³) / 5)     XP från nivå L till L+1, L = 1..99
XP_TOTAL[1] = 0,  XP_TOTAL[L] = Σ need(1..L−1)
nivå     = största L ≤ 100 där XP_TOTAL[L] ≤ p.xp
```

- Den linjära termen styr nivå 1–30. Där tar varje nivå 2–6 minuter, och det första jobbet ger nivå 2 direkt.
- Den kubiska termen börjar märkas efter nivå 40 och gör nivå 85–100 till ett långsiktigt mål.
- XP per handling är fast, så ingen inflation. Takten ökar ändå lite med nivån, eftersom nya källor låses upp (bankrån, butiksrån, fler uppdrag, Kapo-jobb).

### Nyckelnivåer

Kurvan är kontrollräknad i testerna: `need` är strikt växande och `XP_TOTAL[100] = 175 220`.

| Nivå | Total XP för att nå nivån | XP till nästa nivå | Ungefärlig aktiv speltid |
|---|---|---|---|
| 2 | 45 | 60 | 2 min |
| 5 | 270 | 105 | 10 min |
| **6 Hangaround** | 375 | 120 | 15 min |
| 10 | 950 | 185 | 35 min |
| **11 Langare** | 1 135 | 200 | 40 min |
| **16 Hustlare** | 2 305 | 285 | 1 h 20 min |
| 20 | 3 560 | 360 | 2 h |
| **23 Torped** | 4 705 | 425 | 2,5 h |
| 30 | 8 155 | 590 | 4 h (en hel kväll) |
| **31 Gängsoldat** | 8 745 | 615 | 4,3 h |
| **41 Kvartersboss** | 16 190 | 920 | 7,5 h |
| **51 Kapo** | 27 125 | 1 325 | 12 h |
| 60 | 40 840 | 1 795 | 17,5 h |
| **63 Consigliere** | 46 405 | 1 975 | 20 h |
| **75 Underboss** | 74 645 | 2 845 | 31 h |
| **85 Gudfadern** | 107 045 | 3 760 | 43 h |
| 100 | 175 220 | – | 70 h |

Det ursprungliga förslaget angav 75 som "XP till nästa nivå" på nivå 2, men formeln ger 60 (75 gäller nivå 3). Tabellen ovan följer formeln.

**Speltidsmodellen:** en aktiv runda i stan består av 3 uppdrag (varav 2,5 lyckas), 10 langningar, 1–2 skrotade bilar, lite gatubrott och några klick i imperiet. Det ger ungefär:
- 21 XP/min på nivå 1–5
- 31 XP/min på nivå 6–19
- 38 XP/min på nivå 20–49
- 43 XP/min från nivå 50

Engångsmilstolparna ger ungefär 80 XP extra under den första kvarten, så de första nivåerna går ännu fortare.

**Exempel, första kvarten:**

| Handling | XP | Total |
|---|---|---|
| Köp kebaben (10 + första verksamheten 20) | 30 | 30 |
| Första leveransen (50 + första jobbet 30) | 80 | 110 = nivå 3 |
| 5 rån (+10 för första rånet) | 40 | 150 |
| 5 langningar (+10 för första) | 35 | 185 |
| VIP-skjuts | 55 | 240 |
| Bilstöld | 65 | 305 = nivå 5 |
| Skrota bilen (15 + första gången 20) | 35 | 340 |
| Ett uppdrag till | | nivå 6 (Hangaround) vid cirka 15 min |

**Efter nivå 100:** XP räknas vidare. Varje 25 000 XP över nivå 100 ger en Legend-stjärna, som bara är kosmetisk (fas 2). `p.xp` kapas vid 10 000 000.

---

## 3. Karriär och lagring

**I spelaren** (`gameState.players[i]`), som synkas som alla andra fält:

| Fält | Typ | Vad det är |
|---|---|---|
| `xp` | heltal | Total XP |
| `xpOnce` | array med strängar | Nycklar för XP som bara ges en gång per match, t.ex. `buy:kebab`, `join`, `resp:kebab:30`, `car:bmw`, `weapon:uzi`, `house:house-orten` |
| `lvSeen` | heltal | Högsta nivå som redan firats |
| `level` | heltal | Cache av `levelOf(xp)`. Skrivs av `awardXp` och `normalizeLevelFields`, men spärrarna läser den aldrig. |

**Karriären** sparas per karaktär och enhet i localStorage, under nyckeln `empire_career_<charKey>`. Kontona i `main.js` är redan per `charKey`. Formen kommer från `createCareer()` och `normalizeCareer()` i `levels.js`:

```js
{ v: 1, xp, milestones: [], buckets: { street: { v, t }, office: { v, t } },
  lastBankXp: 0, lastWinXp: 0, migrated: false }
```

**Regler:**

- **Vid ny match, inladdning och anslutning online** anropas `applyCareer(p, { newGame })`. Den sätter `p.xp = max(p.xp, career.xp)` och `p.lvSeen = max(p.lvSeen, nivå)`, så att redan uppnådda nivåer inte firas igen. Vid `newGame` sätts också startrespekten (`startRespect(L)`, se avsnitt 7).
- **Varje XP-utdelning** sparar `career.xp = max(career.xp, p.xp)` direkt (`awardXp` gör det i karriärobjektet, och `career.js` sparar det). Man tappar aldrig XP: BUSTED, WASTED, razzia och förlust i PvP rör inte `p.xp`.
- **Online** skapar värden en gästs spelare med `normalizePlayer({ charKey })`, alltså med xp 0. Gästen kör därför `applyCareer(myPlayer())` direkt efter `welcome` och anropar sedan `syncMe()`. Värden kör `applyCareer` på sin egen spelare när rummet skapas.
- **Hotseat:** varje mänsklig spelare laddar sin egen karriär via sin `charKey`. Två personer som spelar samma karaktär på samma enhet delar alltså karriär. Det går att leva med.
- **AI:** AI-spelare har ingen karriär. De startar på `aiStartXp(värdens nivå)` = `XP_TOTAL[max(1, värdens nivå − 5)]` och får `AI_TURN_XP` = +120 XP per AI-tur. Det används bara för att visa nivån, eftersom spärrarna aldrig rör AI:ns köp (`isUnlocked` returnerar alltid sant för `isAI`, och `awardXp` ger AI:n 0).
- **Migrering av gamla sparfiler** görs första gången, när `career.migrated` saknas. `retroXp(p)` räknar ut retroaktiv XP och kapar den vid `XP_TOTAL[30] = 8 155`, så att ingen blir Gudfader direkt. Formeln är
  `60·missions + 18·fenced + 5·sold + 15·heists + 35·dates + 40·pvpWins + 4·robbed` plus köp-XP (`bizXp`) för de verksamheter man äger.
  Allt man redan äger får man behålla. Spärrarna gäller bara nya köp.

---

## 4. XP-källor

Alla källor finns i `XP_SOURCES` i `levels.js` och delas ut med `awardXp(player, källa, opts, now)`. Källor med variabel XP får beloppet i `opts.amount` från en hjälpfunktion (`missionXp`, `bizXp`, `carXp`, `upgradeXp`, `shopRobXp`, `fenceXp`, `chaseXp`, `pvpXp`, `respMilestoneXp`).

### 4.1 Hinkar mot farmning

Allt som kan spammas på några sekunder går genom en hink som fylls på i **realtid** (`Date.now`). Det går inte att använda `world.time`, eftersom den nollställs vid varje besök i stan. Hinkarna sparas i karriären, så det hjälper inte att ladda om sidan.

| Hink | Tak | Påfyllning | Täcker |
|---|---|---|---|
| **Gatukassan** (`street`) | 120 | +4/min | Småbrott i stan: rån av folk, knockouts, kvaddade bilar, skaka av snuten, knockouts i barbråk |
| **Kontoret** (`office`) | 200 | +4/min | Klick i imperiet och köp: verksamheter, uppgraderingar, pitch, deals, bilar, kassor, tjänster, första köp, rundbonus |

- En ny karriär börjar med båda hinkarna fulla.
- En utdelning tar det som finns i hinken, vilket kan bli mindre än det man skulle ha fått (`capped: true`).
- Om klockan går bakåt fylls hinken inte på. En stämpel som ligger mer än ett dygn fram i tiden räknas som trasig, och då blir hinken full igen.
- När hinken är tom (`blocked: 'bucket'`) visar stan en grå "+0 XP (gatan är het)" högst var 20:e sekund, plus ett meddelande i personsökaren en gång. Imperiet lägger "(Kontoret har stängt för idag)" i toasten.

Uppdrag, langning, skrotning, bankrån och dejter ligger **utanför** hinkarna. De tar riktig tid och har redan gränser per runda.

### 4.2 Stan: handlingar som tar riktig tid (ingen hink)

| Handling | XP | Källa | Var | Spärr |
|---|---|---|---|---|
| Uppdrag klart | Leverans 50 · VIP-skjuts 55 · Bilstöld 65 · Krossa rivalerna 70 · Fly från snuten 75 · Indrivning 70 (fas 2). +20 % om minst 40 % av tiden var kvar. +20 % för jobb åt det egna gänget. ×2 för Kapo-jobb. Avrundas till närmaste 5 (`missionXp`). | `mission.<typ>` | `world.updateMissionState`, grenen `success` | `missionCap(L)` per runda. Ett jobb tar 1–3 min. Misslyckat eller avbrutet ger 0. |
| Langning, sålt till en kund | 5, eller 8 på rivalgängets turf | `sell` / `sellRival` | `world.sellTo`, efter `p.cityGoods--` | `goodsCap(L)` per runda. Varorna kostar 120 kr styck, och en ny kund kommer var 2,5–5 s. |
| Skrota en bil | 15, +5 om `fenceValue ≥ 2 500` (`fenceXp`) | `fence` | `world.fenceVehicle`, efter kontrollen mot `maxFence` | `fenceCap(L)` per runda |
| Butiksrån (töm kassan där du inte är ägare) | 10 + 2·(slot+1): kebab 12 … RocketFuel 26 (`shopRobXp`) | `shopRob` | `placeAction('rob')`, bara när rånet lyckades (inte när man slängs ut) | 1 per butik och runda (`cityDone rob:slot`) |
| Bankrån | 120. Betalas först när stjärnorna är nere på 0 och man är i spelläge. BUSTED eller WASTED ger 0. | `bank` | `placeAction('robbank')` sätter `this.pendingHeistXp = XP.bank`. Betalas i `update()` när `stars === 0`. Nollas i `busted()` och `wasted()`. | 1 per runda, och minst 10 min realtid mellan två utbetalda bankrån (`COOLDOWNS.bank`, stämplas i `career.lastBankXp` först när XP:n betalas) |
| Hålla stånd mot opps (beefen tar slut utan BUSTED eller WASTED) | 25 | `opps` | `spawnOpps` sätter `this.oppsWatch[g] = true`. I `update()`, när `beef[g]` går från >0 till 0 och `state === 'play'`. | Högst 2 per runda (`cityDone opps1/opps2`). Beefen från `leaveGang` räknas inte. |
| Lyckad dejt | 35 | `date` | `world.endDate(true)` | 1 per runda (`dateThisRound`) |
| Vinna ett barbråk (sista man stående, inte utslängd) | 20 | `brawlWin` | `brawl.js`, när bråket lugnar sig (`calmDown`) och spelaren var med | 1 per rum och runda (`cityDone 'brawl:'+id`) |
| Rymma från Kåken | 75 | `escapeJail` | Fängelseflödet, som byggs nu | 1 per fängelsevistelse. Att sitta av tiden ger 0, annars kan man farma genom att bli BUSTED med flit. |
| PvP-seger | `40 · clamp(1 + (Loffer − Ldu)/20, 0,25, 2)`, avrundat, alltså 10–80 (`pvpXp`). 0 om offret ligger 30 eller fler nivåer under dig. 0 om offret har nybörjarskydd. | `pvp` | Värden räknar i `citynet hostHandle('down')` och skickar `xp` i `pvp`-eventet. Det läggs på i `world.onNet case 'pvp'` när `killer === me`. | Samma mördare och offer högst 1 gång per 10 min, och högst 6 PvP-belöningar per timme och spelare (`pvpXpGate`). Ingen mentorbonus. |
| Gå med i ett gäng | 100 | `join` | `world.joinGang` | 1 per match (once-nyckeln `join` är standard för källan) |
| Respekt-milstolpe hos ett gäng: +30, +60, +100 | 40 / 60 / 100 (`respMilestoneXp`) | `respMilestone` | `world.setRespect(r)`, en ny funktion som alla respektändringar i världen går genom. Den jämför värdena före och efter (`respectMilestones`). | 1 per gäng och steg per match (`once: 'resp:<gang>:<steg>'`) |

### 4.3 Gatukassan (hink: tak 120, +4/min)

| Handling | XP | Källa | Var | Spärr |
|---|---|---|---|---|
| Råna en person (R) | 6 om det lyckas, 3 för att länsa någon som ligger | `rob` / `loot` | `world.tryRob` | Redan 1 gång per person (`ped.robbed`) |
| Knockout med slag, skott eller påkörning | Civil eller metro 2 · tuff 4 · gängmedlem eller opps 5 · snut 6 · rånare 15 | `koSource(ped)` → `ko.civ`, `ko.metro`, `ko.tough`, `ko.gang`, `ko.cop`, `ko.mugger` | `world.hitPed` (`ped.hp <= 0 && mine`) och `world.knockPed` (`v.driver === 'player'`) | 1 gång per person (`ped.xpKO = true`). Folk reser sig efter 4–6 s, så utan flaggan kunde man slå ner samma person om och om igen. |
| Kvadda en bil | 2, snutbil 5 | `wreck` / `wreckCop` | `world.damageVehicle`, där `wrecked` sätts och `lastHitBy === 'player'` | – |
| Skaka av snuten | 8 · högsta antal stjärnor under jakten, alltså 16–40 (`chaseXp`) | `chase` | `world.updateWantedState`: spara `this.chaseMax` och betala när `after === 0`, `before ≥ 2` och `lostTrack`. Frisyr, lack, hack och gömställe nollställer `chaseMax`. | Kräver minst 2 stjärnor |
| Knockout i barbråk | Gäst 3, vakt 8 | `brawlKo.guest` / `brawlKo.guard` | `brawl.js knockOut`, när `by === 'player'` eller en i ditt crew | 1 gång per NPC (`n.xpKO`) |

### 4.4 Kontoret (hink: tak 200, +4/min)

| Handling | XP | Källa | Var | Spärr |
|---|---|---|---|---|
| Köpa en verksamhet | `10 + round(pris/1 500)`: kebab 10, frisör 11, gym 12, studio 13, nattklubb 18, tech 27, skyskrapa 50, RocketFuel 110 (`bizXp`) | `buyBiz` | `core.buyShop` och `placeAction('buy')` | 1 per verksamhet och match (`once: 'buy:<id>'`), så köp–sälj–köp ger inget |
| Uppgradera en verksamhet | `5 + round(kostnad/2 000)`: kebab 1→2 ger 5, RocketFuel 1→2 ger 50 (`upgradeXp`) | `upgrade` | `core.upgradeBiz` | – |
| Lyckad pitch | 6 | `pitch` | `core.doPitch` | Max pitchar per runda, som i dag |
| Lyckad affär på svarta marknaden | 8 | `market` | `features.doMarketDeal` | Gripen ger 0 |
| Lyckad telefondeal | 5 | `phoneDeal` | `phone.doPhoneDeal` | – |
| Köpa en bil | `10 + round(pris/2 000)`: cykel 10, moped 11, BMW 13, AMG 18, Lambo 35, Rolls 60 (`carXp`) | `buyCar` | `garage.buyGarageCar` och `phone.buyCar` | 1 per bil och match (`once: 'car:<id>'`) |
| Pimpa en bil | 5 | `pimp` | `garage.pimpCar` | – |
| Tömma kassan i en egen verksamhet | 4 | `collect` | `world.collectBusiness` | Redan 1 per runda |
| Tjänster | Träna 20, disslåt 15, VIP-bord 10 | `service.train` / `service.track` / `service.vip` / `service.nightvip` | `placeAction('train' / 'track' / 'vip' / 'nightvip')` | Redan 1 per runda |
| Första köpet | Ett vapen av en ny sort 10 · en ny crewmedlem 15 · ett gömställe 20 · Club Diamant 60 | `weapon` / `recruit` / `house` / `stripclub` | `buyFromGunShop` (kind `'weapon'`), `recruit` och `hireBouncer`, `placeAction('buyhouse')`, `onNet buyRes ok` | Per sak och match (`once: 'weapon:<id>'`, `'recruit:<id>'`, `'house:<id>'`; `prop:stripclub` är standard för `stripclub`) |
| Rundbonus, avsluta tur | 10 | `roundBonus` | `core.endTurn` (bara mänskliga spelare) | – |

### 4.5 Engångs per karriär (aldrig igen, inte ens i ett nytt spel)

Första jobbet 30 · första langningen 10 · första rånet 10 · första skrotade bilen 20 · första egna verksamheten 20 · första vapnet 10 · första crewmedlemmen 30 · första dejten 30 · första gänget 50 · första bankrånet 100 · första PvP-segern 50.

De finns i `MILESTONES` och sparas i `career.milestones`. Varje källa har sin milstolpe som standard (`mission.*` → `firstMission`, `sell` → `firstSale` och så vidare), och `opts.milestone = null` stänger av den. Milstolparna går inte genom någon hink och ger ingen mentorbonus. Totalt blir det 360 XP.

### 4.6 Matchen

- **Vinna** (1 000 000 kr): 300 i solo (`winSolo`), 600 om minst 2 mänskliga spelare var med online (`winOnline`).
- **Delta i en onlinematch till slutet** (övriga mänskliga spelare): 100 (`finish`).
- Högst en sådan belöning per 2 timmar realtid (`COOLDOWNS.win`, `career.lastWinXp`). Annars kan man klicka sig till en vinst i solo.
- **Var:** vinnaren får XP i `core.endTurn`, vid vinstkontrollen. Övriga får den i `showWin` när de får `gameOver` via synken.

### 4.7 Mentorbonus

Gäller bara online. Spelaren får **+2,5 % per nivå under rummets högsta mänskliga spelare, högst +75 %** (`mentorMult(minNivå, rummetsMax)`, skickas som `opts.mentor`). Den gäller XP enligt 4.2–4.4 men inte PvP, milstolpar eller match-XP. Hinken begränsar basen, och mentorbonusen läggs på det man fick. Mentorbonusen gör att en nybörjare hinner ikapp under kvällen. I HUD:en visas den som `×1,25` efter XP-stapeln.

### 4.8 Noll XP

Tärning och events, minispel och kasino, inkomst per runda, sälja en verksamhet, stash, chatt och SMS, sitta i häktet, misslyckade och avbrutna uppdrag, plocka upp saker från marken och allt AI:n gör.

---

## 5. Upplåsningar nivå för nivå

**Regler:**

1. **Allt syns, men låst.** Låsta saker gömmer man aldrig, och "låst" visas före "inte råd".
2. **Det man redan äger behåller man** (gamla sparfiler, vapen, crew över taket, bilar). Spärrarna gäller nya köp. Ammo till ett vapen man äger får man alltid köpa.
3. **Vapen på marken går alltid att plocka upp.** Ett vapen som är låst för spelaren blir **lånat** under det här stadsbesöket. Varken ammolådor eller Pang-Pelle fyller på det, och det försvinner när man åker hem. Floatern säger "🔫 Uzi (lånad), din från nivå 16". Det är en smakbit, inte en genväg.
4. **Verksamheterna i Butik spärras inte.** Där räcker pengarna som spärr. Tjänsterna inne i dem spärras, men ägaren får alltid använda tjänsten i sin egen verksamhet.

**Kolumnen Status:** *befintligt* betyder att innehållet redan finns i koden och bara får en spärr. *Nytt* betyder att det måste byggas. *Bonus* betyder att en siffra ändras. *Kosmetiskt* betyder utseende. **Fas 1** är motorn plus allt som är billigt, **fas 2** är nytt innehåll som kräver grafik eller ny logik.

| Nv | Upplåsning | Typ | Status | Fas |
|---|---|---|---|---|
| 1 | **Start:** nävar · uppdragen Leverans och VIP-skjuts · langning 10 varor per runda · råna folk · taxi, doktor, lackering · Ät en kebabtallrik · dansa på Nattklubben · alla verksamheter i Butik · cykel · svarta marknaden: Piratkopierade beats, Mehmets Special-vitsås, Falska ID-kort · telefondeals: Insider-tips via SMS, Sälj stöldgods · pimp-steg 1 | start | befintligt | 1 |
| 2 | Basebollträ hos Pang-Pelle (400 kr) · Moped EPA i garaget | vapen, bil | befintligt | 1 |
| 3 | Uppdraget Bilstöld · Skroten (sälja snodda bilar) | uppdrag | befintligt | 1 |
| 4 | Tjänsten Ny frisyr (−2 stjärnor) hos Frisören | tjänst | befintligt | 1 |
| 5 | Uppdraget Fly från snuten · svarta marknaden: Smuggelgods | uppdrag | befintligt | 1 |
| **6** | **👀 HANGAROUND:** Pistol (1 500 kr) · gå med i ett gäng (kräver fortfarande +30 respekt) · Träna på gymmet · BMW E46 | titel | befintligt | 1 |
| 7 | Skyddsväst hos Pang-Pelle (800 kr) · telefondeal: Tvätta pengar | utrustning | befintligt | 1 |
| 8 | Crewplats 1 (Livvakt eller Spanare) · pimp-steg 2 | crew | befintligt | 1 |
| 9 | Uppdraget Krossa rivalerna · svarta marknaden: Falska sedlar | uppdrag | befintligt | 1 |
| 10 | Dejter vid Nattklubben · spela in en disslåt i studion · kritiska träffar mot NPC:er börjar (1 %) | aktivitet | befintligt | 1 |
| **11** | **🎒 LANGARE:** butiksrån (råna kassan i verksamheter du inte äger) | titel | befintligt | 1 |
| 12 | Gömstället Lägenheten i Orten · Mercedes AMG · telefondeal: Muta inspektören | fastighet | befintligt | 1 |
| 13 | VIP-bord (tjänsten i Nattklubben VIP och nattklubbens VIP-bord) · svarta marknaden: Shady Crypto-deal | tjänst | befintligt | 1 |
| 14 | Crewplats 2 · gömstället Sjöboden i Hamnen | crew | befintligt | 1 |
| 15 | 4 uppdrag per runda | gräns | bonus | 1 |
| **16** | **💸 HUSTLARE:** Uzi (4 000 kr) · gömstället Loftet i Industrin · pimp-steg 3 | titel | befintligt | 1 |
| 17 | Svarta marknaden: Hacka konkurrenten | svarta marknaden | befintligt | 1 |
| 18 | Skytt-rollen hos Rekryteraren · gömstället Radhuset i Västerort | crew | befintligt | 1 |
| 20 | Bankrån (kräver fortfarande ett laddat skjutvapen) · tjänsten Hacka polisens register · Lamborghini | brott | befintligt | 1 |
| 21 | Svarta marknaden: Insider-tips | svarta marknaden | befintligt | 1 |
| 22 | Crewplats 3 · gömstället Villan i Skogsbacken | crew | befintligt | 1 |
| **23** | **🔨 TORPED:** Hagelgevär (6 000 kr) · Torpedslaget: dina slag knuffar folk 25 % längre | titel | befintligt + bonus | 1 |
| 25 | Gömstället Takvåningen i Centrum · Pang-Pelle −10 % på vapen, ammo och väst | fastighet | befintligt + bonus | 1 |
| 26 | Ny uppdragstyp Indrivning: hitta gäldenären, spöa honom och hämta skulden | uppdrag | nytt | 2 |
| 28 | Club Diamant går att köpa och ta över · anställa Stora Sven · Rolls Royce | fastighet | befintligt | 1 |
| 30 | Crewplats 4 (max). Allt som finns i spelet i dag är nu upplåst. | crew | befintligt | 1 |
| **31** | **🪖 GÄNGSOLDAT:** Ring backup i telefonen: 2 från ditt gäng slåss för dig i 60 s (1 gång per runda, kräver gäng) | titel | nytt (enkelt) | 1 |
| 33 | Skrota 4 bilar per runda | gräns | bonus | 1 |
| 35 | Langning 15 varor per runda · Muta snuten i telefonen: −1 stjärna, 1 000 kr per stjärna, 1 gång per runda | gräns, tjänst | bonus + nytt (enkelt) | 1 |
| 38 | Pang-Pelle −20 % | bonus | bonus | 1 |
| 40 | 5 uppdrag per runda | gräns | bonus | 1 |
| **41** | **🏙️ KVARTERSBOSS:** veteraner hos Rekryteraren (+20 % hälsa och skada) · respekt ≥ 80 ger ×1,45 i uppdragslön | titel | nytt (litet) + bonus | 1 |
| 45 | Guldpistol och kromad uzi (samma skada, bara utseende) | kosmetiskt | nytt | 2 |
| 48 | Din gängbil vid HQ är bepansrad (+50 % hp) | bonus | bonus | 1 |
| **51** | **🎩 KAPO:** Kapo-jobbet, ett jobb per runda från din egen boss med dubbel lön och dubbel XP | titel | nytt (litet) | 1 |
| 55 | Crewet reser sig efter 12 s i stället för 25 | bonus | bonus | 1 |
| 60 | Langning 20 varor per runda och +20 % pris på ditt gängs turf | bonus | bonus | 1 |
| **63** | **🍷 CONSIGLIERE:** Advokaten (BUSTED ger 1 runda kortare häkte, dock minst 1, och halva böterna) · misslyckade jobb kostar ingen respekt | titel | bonus | 1 |
| 65 | Elitrekryter hos Rekryteraren (+40 % hälsa och skada) | crew | nytt (litet) | 1 |
| 70 | Privatchaufför: taxin är gratis och kör även med 1 stjärna | tjänst | bonus | 1 |
| **75** | **🥃 UNDERBOSS:** Familjens skydd: respekten hos ditt gäng går aldrig under +50, och rivalens opps kommer hälften så ofta | titel | bonus | 1 |
| 80 | Gatans legend: vanligt folk (civila och metro) slåss aldrig emot när du rånar dem | bonus | bonus | 1 |
| **85** | **🌹 GUDFADERN:** "Ett erbjudande man inte kan tacka nej till": alla gängbossar svarar och ger jobb, även rivalen · guldnamn och krona i stan, på kartan och i listorna · Gudfaderns svarta Rolls står vid HQ | titel | nytt | 1 (guldfälgarna fas 2) |
| 90 | Rosen på kavajen och ett gyllene basebollträ | kosmetiskt | nytt | 2 |
| 95 | Staty av dig vid HQ som alla online ser | kosmetiskt | nytt | 2 |
| 100 | Don-stjärna med guldaura · valfri Prestige: börja om som Springpojke med en ⭐, och kosmetiken finns kvar | prestige | nytt | 2 |

**Upplåsnings-id:n** i koden (`UNLOCKS` i `levels.js`). Allt som inte står i listan kräver nivå 1 (`requiredLevel` returnerar 1), till exempel `svc:eat`, `car:cykel` och uppdragen `delivery` och `vip`.

```
weapon:bat 2 · weapon:pistol 6 · weapon:uzi 16 · weapon:shotgun 23 · armor 7
mission:steal 3 · mission:escape 5 · mission:smash 9 · mission:collect 26
fence 3 · gang:join 6 · date 10 · rob:shop 11 · rob:bank 20
svc:look 4 · svc:train 6 · svc:track 10 · svc:vip 13 · svc:hack 20   (eat: 1)
house:house-orten 12 · house:house-hamnen 14 · house:house-industrin 16
house:house-vasterort 18 · house:house-skogsbacken 22 · house:house-centrum 25
crew:slot1 8 · crew:slot2 14 · crew:slot3 22 · crew:slot4 30 · crew:gunner 18
crew:bouncer 28 · crew:veteran 41 · crew:elite 65 · prop:stripclub 28
car:moped 2 · car:bmw 6 · car:mercedes 12 · car:lambo 20 · car:rolls 28   (cykel: 1)
pimp:2 8 · pimp:3 16
bm:smuggle 5 · bm:counterfeit 9 · bm:crypto_scam 13 · bm:hack 17 · bm:insider 21
deal:launder 7 · deal:bribe 12
perk:torpedo 23 · perk:backup 31 · perk:bribecop 35 · perk:kapo 51 · perk:lawyer 63
perk:chauffeur 70 · perk:family 75 · perk:legend 80 · perk:offer 85 · perk:godcar 85
```

Listan har också poster för bonusarna, så att nivå-upp-rutan och Karriär-kortet kan visa dem:

```
perk:crit 10 · cap:missions4 15 · perk:discount10 25 · cap:fence4 33 · cap:goods15 35
perk:discount20 38 · cap:missions5 40 · perk:paytier 41 · cosm:goldguns 45 (fas 2)
perk:armoredride 48 · perk:fastrecover 55 · cap:goods20 60 · perk:turfprice 60
perk:nofailloss 63 · cosm:goldname 85 · cosm:rose 90 (fas 2) · cosm:statue 95 (fas 2)
prestige 100 (fas 2)
```

**Gränser som funktioner av nivån.** De ersätter de globala `gameState.max*PerRound`, som blir basvärden:

```
missionCap(L) = 3 + (L ≥ 15) + (L ≥ 40)
goodsCap(L)   = L ≥ 60 ? 20 : L ≥ 35 ? 15 : 10
fenceCap(L)   = L ≥ 33 ? 4 : 3
crewMax(L)    = L ≥ 30 ? 4 : L ≥ 22 ? 3 : L ≥ 14 ? 2 : L ≥ 8 ? 1 : 0
crewRecover(L)= L ≥ 55 ? 12 : 25
gunDiscount(L)= L ≥ 38 ? 0.8 : L ≥ 25 ? 0.9 : 1
```

---

## 6. Skada

### 6.1 Mot NPC:er

```
dmgMult(L) = min(1,5, 1 + 0,005·(L − 1))      +0 % på nivå 1, +25 % på 51, +49,5 % på 100
närstrid   = (vapnets slumpskada + styrka·3) · dmgMult(L)        meleeBase(roll, styrka) · dmgMult(L)
skott      = WEAPONS[id].dmg · dmgMult(L)
```

- **Kritiska träffar** (spelaren mot NPC:er, aldrig i PvP): från nivå 10 är chansen `L/1000`, alltså 1 % till 10 % (`critChance`). En kritisk träff gör ×1,5 skada (`CRIT_MULT`) och visar en orange floater "KRITISK!" (`#fb923c`) med dubbel gnista. `npcDamage(bas, L, rnd)` returnerar `{ dmg, crit }`.
- **Torpedslaget** (från nivå 23): knuffen när spelaren slår i `hitPed` blir 200 px/s i stället för 160 (`knockMult` = 1,25).
- **Crewet** (mot NPC:er): `crewDmgMult(L) = 1 + 0,0025·(L − 1)`, högst +25 %. Veteraner (×1,2) och elit (×1,4) får sin bonus inbakad i hälsa och skada redan när de rekryteras.
- **Påkörning med bil skalas inte**, så fysiken är oförändrad.

| Nivå | Mult. | Nävar 15–21 | Trä 28–38 | Trä + styrka 5 (43–53) | Pistol 24 | Uzi 12 | Hagel 6×11 |
|---|---|---|---|---|---|---|---|
| 1 | 1,00 | 15–21 | 28–38 | 43–53 | 24 | 12 | 66 |
| 23 | 1,11 | 17–23 | 31–42 | 48–59 | 26,6 | 13,3 | 73 |
| 51 | 1,25 | 19–26 | 35–48 | 54–66 | 30 | 15 | 83 |
| 85 | 1,42 | 21–30 | 40–54 | 61–75 | 34 | 17 | 94 |
| 100 | 1,495 | 22–31 | 42–57 | 64–79 | 36 | 18 | 99 |

### 6.2 Motvikt, så att gatan aldrig blir trivial

| Vad | Formel | Nivå 1 → nivå 100 |
|---|---|---|
| Antal opps (`spawnOpps`) | `oppsCount(L) = min(7, 4 + floor(L/30))` | 4 → 7 |
| Beväpnade opps | `oppsArmed(L, hasGun) = min(antal, (hasGun ? 2 : 0) + floor(L/40))` | +1 från nivå 40, +2 från nivå 80 |
| Opps-hp | `35 · npcHpMult(L)`, där `npcHpMult(L) = 1 + L/300` | 35 → 47 |
| Snutar till fots (`copGetsOut`) | `40 · npcHpMult(L)` | 40 → 53 |

- Vakter och gäster i barbråken skalas **inte**. Det ska gå att slänga ut dem.
- Spelaren blir ungefär 1,5 gånger starkare, medan motståndet blir ungefär 1,33 gånger tuffare. Man känner sig starkare men blir aldrig odödlig.
- Pistolen sänker aldrig opps på ett skott: 36 i skada mot 47 hp på nivå 100 (testat).
- Spelarens hälsa skalas **inte** med nivån. Annars skulle PvP-kompressionen nedan inte hålla.

### 6.3 PvP: rättvisa online

1. Klienten skickar alltid **basskadan** (vapen plus styrka, utan nivå och utan kritisk träff) i `hit`-requesten:
   - `world.melee` mot spelare och crew skickar redan basskada.
   - Kulor sparar både `b.base` och `b.dmg`, och `bulletHitRemote` skickar `b.base`.
   - Crewets träffar skickar sin bas (`crewMelee` och `crewShoot`).
2. Värden räknar i `citynet hostHandle('hit')` med `pvpDamage(bas, HIT_RULES[kind].max, Lanfallare, Lmål, { aggro })`:
   ```
   dmg     = min(HIT_RULES[kind].max, bas) · pvpMult(Lanfallare, Lmål) · sköld
   pvpMult = 1 + 0,005 · clamp(Lanfallare − Lmål, −20, 20)          alltså 0,90–1,10
   ```
   Multiplikatorn läggs på **efter** taket. I dag kapas trä plus styrka 5 (53) till 45, och då skulle nivåbonusen annars försvinna. Nivån läses från värdens bild, alltså `lv` i den tvättade positionen och i andra hand `gameState.players`. Klienten kan aldrig skicka med sin nivå i själva träffen.
3. **Nybörjarskydd** (`newbieShield`): om målet är på nivå 5 eller lägre och anfallaren ligger minst 10 nivåer över gäller `sköld = 0,5`. Offret tappar då inga pengar (`lost = 0` i `pvpDefeat`, och värden kapar `amount` till 0), och anfallaren får 0 i PvP-XP. Skyddet försvinner i 30 s om nybörjaren själv slog den anfallaren först (`host.aggro` med nyckeln `'nybörjare>anfallare'`, skickas som `aggro`).
4. **Resultat:** nivå 100 mot nivå 1 ger högst +10 %, och samma nivå ger exakt dagens skada. PvP avgörs av vapen, väst, crew och skicklighet, inte av timmar. Det finns inga kritiska träffar i PvP.

---

## 7. Respekt

Spelet har två sorters respekt, och båda växer med nivån.

**Gängrespekt**, `profile.respect[gang]` från −100 till 100:

1. **Snabbare vinst:** alla positiva ändringar multipliceras med
   `respGain(L) = 1 + (L − 1)/100`, avrundat och minst +1 (`scaleRespectDelta`).
   - Ett lyckat uppdrag ger +12 på nivå 1, +15 på nivå 26, +18 på nivå 51 och +24 på nivå 100.
   - Langning på eget turf ger +1, och +2 från nivå 51.
   - Det läggs in i `applyRespect` och `adjustRespect` som en ny parameter `level`.
2. **Förlusterna är oförändrade:** rivalen −10, misslyckat jobb −5, fiendens turf −3, slag −4 eller −3. Gängkriget och valet av gäng ska fortfarande betyda något. Undantag: från nivå 63 kostar ett misslyckat jobb ingen respekt (`failRespect`).
3. **Ryktet går före dig:** ett nytt spel startar med respekt `floor(L/5)` hos alla sex gäng, alltså +6 på nivå 30 och +20 på nivå 100 (`startRespect`). Det görs i `applyCareer(p, { newGame: true })`.
4. **Ordet sprids:** vid varje ny titel får man +5 respekt (`TITLE_RESPECT`) hos alla gäng som inte är rival till ens eget gäng. `awardXp` lägger på det via `levelUpRewards`. I stan skickar `world.gainXp` `applyRespect: false` och lägger deltan genom `setRespect`, så att respekt-milstolparna räknas.
5. **Nytt lönesteg:** från nivå 41 ger respekt ≥ 80 ×1,45 i `rewardFor` (`respectPayMult`). Dagens steg är ×1,15 vid 20 och ×1,3 vid 50.
6. **Perks:**
   - Nivå 75: det egna gängets respekt går aldrig under +50 (`respectFloor`; golvet läggs i `world.setRespect`).
   - Nivå 85: `phoneAccess` returnerar alltid sant, så även rivalen svarar.

**Gaturespekt**, alltså att folk fruktar dig:

- Chansen att någon slåss emot vid rån (`fight` i `tryRob`) multipliceras med `fearMult(L) = 1 − (L − 1)/250`, alltså ×0,6 på nivå 100. Från nivå 80 är den 0 för civila och metro (`robFightChance`).
- Risken att bli utslängd vid ett obeväpnat butiksrån blir `0,5 · fearMult(L)` (`shopRobKickChance`).
- Nattens rånare kommer mer sällan: `muggerT = 80 + rnd·60 + 0,6·L` sekunder (`muggerInterval`).

**Rykte** (`p.rep`, påverkar dejtchansen): +1 per nivå och +5 per ny titel, så befordringar syns i ⭐ (`levelUpRewards`).

Inget av detta påverkar skadan i PvP. Respekten ger pengar, tillgång och lugn, inte styrka mot andra spelare.

---

## 8. Presentation

### 8.1 Stan (`hud.js`, `render.js`, `index.js`)

**XP-raden** blir en ny rad 0 i vänsterspalten, vid y=16, i samma stil som respektraderna:
- svart ruta med 60 % opacitet
- en cirkel (r=8) i bandets färg med nivåsiffran
- en stapel från x=32 med bredden `bw`, fylld i bandets färg

Respektraderna flyttas till `y = 38 + i·22`, och hälsan till `hy = 16 + 4·22 + 6`. På mobil flyttas `.city-topbar` i `city.css` från `top:196px` till `218px`.

När man får XP:
- Raden blinkar vitt i 0,15 s.
- Den vidgas i 3 s och visar `NIVÅ 23 TORPED · 1 240/2 320`.
- Från 90 % mot nästa nivå pulserar stapeln.
- Mentorbonusen visas som `×1,25`.

**XP-floaters:** "+65 XP" i violett (`#a78bfa`), 14 px över pengafloatern.
- Floaters inom 0,8 s slås ihop och räknas upp, på samma sätt som `comboFloater`.
- 100 XP eller mer: större text och en kort pop.
- Tom hink: grå floater, se 4.1.
- Undertexten till de stora texterna får XP: "UPPDRAG KLART! · +1 260 kr · +65 XP · +respekt hos Kebabmaffian". Samma gäller SKROTAD!, BANKRÅN!, SEGER! och ❤️ SCORE!.

**Nivå-upp** är ett eget event, `{ type: 'levelUp', from, to, rankChanged, rank, unlocks }`, med en egen kö i Hud (`this.lvl`). Det skriver aldrig över `this.big`, utan väntar tills `big` saknas eller `big.life < 0,5`.

| Fall | Hur det visas |
|---|---|
| Vanlig nivå (2,6 s) | "NIVÅ 24" i bandets färg, titeln under, och 1–2 rader "Upplåst: Uzi hos Pang-Pelle" plus "+1 till, se 📱". Ljudet `mission`. Partiklar med bandets emoji. |
| Ny titel (4 s, blockerar inget) | Större text och en ton i bandets färg (15 %) över skärmen. Bandets emoji över titeln och raden "Ryktet sprider sig...". Klienten skickar dessutom `rank` till värden, som sprider det i flödet. |
| Gudfadern (alla online) | Banner "👑 MEHMET ÄR GUDFADERN" hos alla, via `rank` med band 10. |
| Mitt i ett uppdrag eller en jakt | Kompakt variant högre upp (y = H·0,22, 44 px). Den stora tonen skjuts upp tills uppdraget är slut eller stjärnorna är 0, dock högst 20 s. |
| Flera nivåer på en gång | "NIVÅ 23 → 25" med alla upplåsningar samlade. |

Vid nivå-upp i stan uppdaterar `world` direkt `maxMissions`, `maxGoods` och `maxFence` till de nya gränserna.

**Namnskyltar** (`render.drawTags`, och motsvarande i 3D-vyn):
- en ruta "[23]" i bandets färg före namnet
- från nivå 85 guldnamn (`#ffd23f`) och 👑 ovanför
- på minikartan får Gudfadern guldkant

**Flödet:** "⬆️ Mehmet blev Torped (Nv 23)" när någon passerar ett titelband, och "💀 [85] Mehmet sänkte [12] Juan".

**Respekt som syns:** "+15" i gängets färg bredvid respektraden i 2 s. I dag syns ändringen inte alls.

**Skada som syns:**
- Pang-Pelle visar "din skada" per vapen, till exempel "Pistol · din skada 30".
- Karriärkortet visar procenten.
- Kritiska träffar får en egen floater.

### 8.2 Låsta saker i stan

Texterna kommer från `lockLabel(id)` och `lockInfo(spelare, id)`.

- **Knappen** säger "🔒 Nivå 16 · Hustlare". Den är `disabled`, har mörk bakgrund och 1 px kant i färgen för det band som krävs. Under står i liten text "du: Nv 9 · 7 nivåer kvar".
- **Pang-Pelle (`showGuns`):** låsta rader visar ändå statistiken. Pelle säger: "Psst... den säljer jag bara till folk med namn. Kom tillbaka som Hustlare."
- **Rekryteraren (`showRecruit`):** "👥 1/1 · 🔒 plats 2 på nivå 14". Kandidater med låst roll eller nivå visar "🔒 Nivå 18 · Skytt".
- **Gängtelefonen (`showPhone`):** sista raden blir "🔒 Fler jobb på nivå 9: Krossa rivalerna". Har man respekt men för låg nivå säger bossen: "Kom tillbaka på nivå 6, Springpojke."
- **Platsmenyerna (`placeInfo`):** `disabled` och noten "Låses upp på nivå 20 · Hustlare". Det gäller butiksrån, tjänster, gömställen, banken och nattklubbens VIP-bord.

### 8.3 Imperiet (DOM, `core.js`, `main.js`, `stan.js`)

- **HUD:**
  - Ett nytt första chip, `#hud-level`: "🔨 23 Torped" i bandets färg (`levelBadge`).
  - En 4 px XP-stapel, `#hud-xp`, längs `.hud`:s underkant med titeln "1 240 / 2 320 XP till nivå 24".
  - Ett tryck på chipet öppnar Karriär-kortet (`window.game.showCareer()`).
- **Toasts** får XP på slutet: "🥙 Köpte Mehmets Kebab! · +30 XP".
- **Nivå-upp hemma:** toasten "⬆️ Nivå 7!" och `spawnParticles([emoji, '⬆️', '💰'], 16)`.
  - Vid ny titel visas ett **nytt element, `#overlay-level`**. `#overlay-event` används inte, eftersom razzia, sälj och vinst redan använder det.
  - Kortet heter "BEFORDRAN! Du är nu Hangaround", är i bandets färg och listar det som just låstes upp.
  - Kortet visas bara för nivåer över `p.lvSeen` (`unseenLevels`), och därefter sätts `lvSeen` (`markLevelSeen`).
- **Befordran i stan** visas som overlay först när man kommer hem (`onCityClosed`). I stan visas den aldrig mitt i en jakt.
- **Karriär-kortet** blir första kortet i Stan-panelen och är samma ruta som chipet öppnar. Det innehåller:
  - ett 64 px-märke, titeln och XP-stapeln med siffror
  - raden "Skada +11 % · Kritisk 2,3 % · Respektvinst +22 %"
  - hinkarna, "Gatukassan 45/120 (+4/min) · Kontoret 160/200 (+4/min)" (`bucketPeek`), så att man förstår varför ett rån gav 0 XP
  - "Nästa: Nivå 16 · Uzi hos Pang-Pelle (2 nivåer kvar)" för de 3 nästa upplåsningarna (`nextUnlocks`)
  - titelstegen med alla 11 band: avklarade med ✔ och färg, det nuvarande lysande, kommande gråa med 2 nyckelupplåsningar var
- **Panelens siffror** ("Uppdrag kvar 2/4" och så vidare) använder `missionCap(L)`, `goodsCap(L)` och `fenceCap(L)` i stället för `gameState.max*PerRound`.
- **Inloggningskorten** (`renderLoginScreen`) visar karriärens "🔨 Torped · Nv 23" som huvudrad, med en mindre rad "Förmögenhet: Kebab-Mogul" under.
- **Övrigt:**
  - Turindikatorn: "🔨23 Mehmets tur".
  - Dashboarden (`renderDashboard`): "Nv 23 · ⭐ 41".
  - Lobbyn: nivå och titel per spelare.
- **Låsta saker i imperiet:**
  - Garaget, Gärri-appen, svarta marknaden och telefondeals får samma låsknapp som i stan.
  - Garaget visar dessutom bilen som siluett (`filter: brightness(0); opacity:.6`).
  - Butik får inga lås, eftersom verksamheterna inte spärras.

---

## 9. Integrationsplan

### 9.1 Nya filer

**`src/game/levels.js`** (klar, se avsnitt 11) innehåller ren logik: ingen DOM och ingen lagring. Den importerar bara data utan sidoeffekter: `GANGS` och respektgränserna från `src/city/constants.js` (för titelrespekten) och `SHOPS` från `src/data/gameData.js` (för `retroXp`). Det gör filen enkel att testa.

**`src/game/career.js`** (nästa steg) sköter lagringen. Den går genom ett utbytbart lager: `globalThis.localStorage` i webbläsaren och ett minneslager i testerna. Alla anrop ligger i try/catch.

```js
export function loadCareer(charKey)              // normalizeCareer(JSON.parse(...))
export function saveCareer(charKey, c)
export function applyCareer(p, { newGame = false } = {})
//   normalizeLevelFields(p); migrering (retroXp) om !career.migrated;
//   p.xp = max(p.xp, career.xp); p.lvSeen = max(p.lvSeen, nivå);
//   vid newGame: startRespect(L) hos alla gäng
export function grantXp(p, source, opts = {})
//   tunt omslag: const c = loadCareer(p.charKey);
//   const r = awardXp(p, source, { ...opts, career: c, mentor: <mentorMult om online> });
//   saveCareer(p.charKey, c); return r;
//   Mentorbonusen läser gameState (isOnline och players).
```

### 9.2 `src/game/state.js`

- `createPlayerState` får `xp: 0, xpOnce: [], lvSeen: 1`.
- `normalizePlayer` anropar `normalizeLevelFields(p)` sist:
  - `p.xp` blir ett heltal mellan 0 och 10 000 000.
  - `p.lvSeen` hålls mellan 1 och 100 (saknas det blir det den nuvarande nivån, så gammal progress inte firas).
  - `p.xpOnce` filtreras till unika strängar på högst 40 tecken, högst 300 stycken.
  - `p.level` sätts till `levelOf(p.xp)`.
  - Crewet kapas fortfarande till 4. `CREW_MAX` är det absoluta taket och `crewMax(L)` taket för nya rekryter.
- Nivån räknas alltid med `levelOf(p.xp)` eller `playerLevel(p)`. `p.level` är bara en cache för visning.

### 9.3 `src/city/world.js`

**Nya fält och hjälpare:**
- I konstruktorn: `pendingHeistXp`, `chaseMax`, `oppsWatch = {}`, `borrowed = new Set()`, `levelUps = []`, `xpFloater` och `heatMsgT`.
- `level()` returnerar `levelOf(this.profile.xp)`.
- `gainXp(source, opts)` anropar `grantXp(this.profile, source, { ...opts, applyRespect: false })`, visar floatern och emitterar `{type:'xp'}`. Titelrespekten i `r.rewards.respect` läggs på genom `setRespect`. Vid nivå-upp emitterar den `{type:'levelUp', ...}`, lägger resultatet i `levelUps`, uppdaterar `maxMissions`, `maxGoods` och `maxFence` och skickar `net.request('rank', { lv })` om titeln ändrades (`r.rankUp`).
- `setRespect(r)` lägger på Familjens skydd (`respectFloor`) och delar ut XP för respekt-milstolpar (`respectMilestones` + källan `respMilestone`). Den ersätter alla direkta `this.profile.respect = ...` i `provoke`, `sellTo`, `joinGang`, `leaveGang`, `updateMissionState`, `busted`, `wasted` och `abandonMission`.

| Funktion (ungefärlig rad i dag) | Ändring |
|---|---|
| `update` (249) | Efter nedräkningen av `beef`: XP för opps när en bevakad beef går till 0. Betala `pendingHeistXp` med `gainXp('bank')` när `stars === 0` och `state === 'play'`; spärren på 10 min ligger i källan. |
| `netSnapshot` (322) | Nytt fält `lv: this.level()` |
| `onNet 'pvp'` (348) | Om `killer === me && e.xp` körs `gainXp('pvp', { amount: e.xp })` (ingen mentorbonus, milstolpen `firstPvp` är standard). Ny gren `'rank'` som skriver i flödet och visar Gudfader-bannern. |
| `damageVehicle` (762) | `gainXp('wreck' / 'wreckCop')` i grenen `lastHitBy === 'player'` |
| `melee` (936) | Mot NPC:er (968): `npcDamage(meleeBase(...), L)` med kritisk träff. Mot spelare (960): oförändrad basskada. |
| `shoot` (973) | `b.base = w.dmg`, `b.dmg = w.dmg × dmgMult(L)` |
| `bulletHitPed` (1053) | Chans till kritisk träff när `b.from === 'player'` |
| `bulletHitRemote` (1995) | Skicka `b.base ?? b.dmg` |
| `hitPed` (1091) | Knuff `× knockMult(L)` när spelaren slår. `gainXp(koSource(ped))` vid `ped.hp <= 0 && mine && !ped.xpKO`. |
| `knockPed` (1539) | XP för knockout när `v.driver === 'player'` (en gång per person) |
| `tryRob` (1183) | `fight = robFightChance(fight, L, ped.type)`. `gainXp('rob')` eller `gainXp('loot')`. |
| `updateMuggers` (1236) | `this.muggerT = muggerInterval(L, this.rnd())` |
| `buyFromGunShop` (1284) | `weaponPurchase(prof, id, kind, { level, borrowed: this.borrowed })`. `gainXp('weapon', { once: 'weapon:'+id })`. |
| `buyArmor` (2107) | Spärr `armor` (nivå 7). Pris `800 × gunDiscount(L)`. |
| `applyGain` (1951) | Ett låst vapen läggs i `this.borrowed` och floatern får "(lånad)" |
| `visitClub` (1305) | Spärr `date` (nivå 10) |
| `endDate(true)` (1343) | `gainXp('date')` |
| `sellTo` (1415) | `gainXp(rivalTurf ? 'sellRival' : 'sell')`. Pris +20 % på eget turf från nivå 60. Opps-chansen ×0,5 för rivalen från nivå 75. `adjustRespect(..., level)`. |
| `spawnOpps` (1451) | `oppsCount`, `oppsArmed`, `hp: 35 × npcHpMult(L)`, `this.oppsWatch[gang] = true` |
| `joinGang` (1510) | Nivåspärren ligger i `canJoin`. `gainXp('join')`. |
| `answerPhone` (1797) | `phoneAccess(profile, gang, level)`. `createMission` får `types` (de upplåsta), `level` och `kapo` (eget gäng, nivå 51 eller mer, inte gjort denna runda; räknas inte mot `missionCap`). Saknade typer skickas med i eventet så att telefonen kan visa nästa. |
| `fenceVehicle` (1834) | Spärr `fence` (nivå 3) och `fenceCap`. `gainXp('fence', { amount: fenceXp(value) })`. |
| `collectBusiness` (1851) | `gainXp('collect')` |
| `recruitOffers` / `recruit` / `hireBouncer` (1864 / 1866 / 2263) | Skicka `level` till `crewCandidates` och `canRecruit`. Sven har spärren `crew:bouncer`. `gainXp('recruit', { once: 'recruit:'+id })`. |
| `hurtCrew` (1913) | `CREW_RECOVER` byts mot `crewRecover(L)` |
| `taxi` (2077) | Från nivå 70 (`perk:chauffeur`) är priset 0 och taxin kör även med 1 stjärna |
| `buyProperty` (2126) | Spärr `prop:stripclub`. `netAsk('buy', 'buyProp', { prop, money, lv })`. |
| `placeInfo` (2413) | `rob` kräver `rob:shop`. Tjänsterna kräver `svc:*` om man inte äger verksamheten. `buyhouse` kräver `house:<id>`. `robbank` kräver `rob:bank`. `nightvip` kräver `svc:vip`. Låsta knappar får `disabled` och noten `lockLabel`. |
| `placeAction` (2478) | XP för `buy` (`buyBiz`), `rob` (`shopRob`), tjänsterna (`service.*`) och `buyhouse` (`house`). `robbank` sätter `pendingHeistXp = XP.bank`. |
| `updateMissionState` (2586) | `gainXp('mission.'+m.type, { amount: missionXp(m, { member, kapo }) })`. `rewardFor` och `applyRespect` får `level`. |
| `copGetsOut` (2624) | `hp: 40 × npcHpMult(L)` |
| `updateWantedState` (2645) | Följ `chaseMax` och betala `gainXp('chase', { amount: chaseXp(chaseMax) })`. `respray`, frisyren, hacket och `hide` nollställer `chaseMax`. |
| `busted` / `wasted` (2666 / 2677) | `pendingHeistXp = 0` och `applyRespect(..., false, level)` |
| `pvpDefeat` (2036) | `lost = 0` om `newbieShield(lastAttacker-nivå, min nivå)` |
| Nya: `callBackup()` (nivå 31), `bribeCops()` (nivå 35) | `callBackup`: 2 peds från det egna gänget (`gangPedOpts`) med `ped.ally = true` och 60 s livslängd. De går på närmaste ped som anfaller dig, annars följer de dig (en liten gren i `updatePeds`). `bribeCops`: `setStars(s − 1)` för 1 000 kr per stjärna. Båda högst 1 gång per runda (`cityDone`). |
| `spawnGangRide` | `maxHp × 1,5` från nivå 48 (`perk:armoredride`) |
| `setupOwnedCars` | Från nivå 85 en svart Rolls (`color '#0b0b0f'`, `v.godfather = true`) vid HQ |

### 9.4 Övriga filer i stan

- **`missions.js`:**
  - `rewardFor(type, round, respect, member, level = 1, kapo = false)` använder `respectPayMult(respect, level)` och ×2 för Kapo-jobb.
  - `applyRespect(respect, gang, success, level = 1)`: vinst via `scaleRespectDelta`. Vid misslyckande `failRespect(level)`.
  - `adjustRespect(respect, gang, delta, level = 1)`: positiva värden skalas med `scaleRespectDelta`.
  - `canJoin(profile, gang)` kräver dessutom `isUnlocked(profile, 'gang:join')`.
  - `phoneAccess(profile, gang, level)` returnerar alltid sant från nivå 85 (`perk:offer`).
  - `createMission` väljer typ ur `ctx.types ?? MISSION_TYPES`.
  - Standardvärdena gör att de befintliga anropen och testerna fortsätter fungera.
- **`weapons.js`:** `weaponPurchase(profile, id, kind, { level = 100, borrowed } = {})`.
  - Ett låst vapen ger `{ ok: false, locked: true, reason: lockLabel('weapon:'+id) }`.
  - Ammo till ett lånat vapen nekas.
  - `cost × gunDiscount(level)`.
- **`crew.js`:**
  - `crewCandidates(charKey, round, level = 1)`: nivån bestämmer om kandidaterna är veteraner (×1,2, kostnad ×1,5, namnprefixet "Veteran", `crew:veteran`) eller elit (×1,4, kostnad ×2, "Elit", `crew:elite`).
  - `canRecruit(profile, cand, level = 100)` kontrollerar `crewMax(level)`, `crew:gunner` och `crew:bouncer`. Felmeddelandet är `lockLabel`.
- **`items.js`:** `itemGain(profile, type, armor, borrowed)`. Ammolådor och vapen man redan har ger ingen ammo till lånade vapen.
- **`brawl.js`** (byggs nu, så lägg in efter den grenen):
  - `playerPunch` får `npcDamage` (dmgMult och kritisk träff).
  - `knockOut` ger `brawlKo.guest` / `brawlKo.guard` när `by === 'player'` eller en i crewet (`n.xpKO`).
  - `calmDown` ger `brawlWin`.
- **`hud.js`:** XP-raden, flyttade rader, kön för nivå-upp (`onEvent('levelUp')` och `onEvent('xp')`), "+N" vid respekten och bannern för ny titel.
- **`render.js`:** `drawTags` får nivårutan, guld och krona (nivån tas från `remote.lv` och hos dig själv från `world.level()`). `drawFloaters` får `f.size`. Samma namnskyltar i `render3d` när den grenen är klar.
- **`minimap.js`:** guldkant och krona för nivå 85 och uppåt (fas 1, enkelt).
- **`index.js`:**
  - `openCity` tar emot gränserna från `stan.js`.
  - `showGuns`, `showRecruit` och `showPhone` får låsta rader enligt 8.2.
  - `showCityPhone` får knapparna "📞 Ring backup" och "👮 Muta snuten" (de visas låsta under sin nivå).
  - `handleEvents` skickar `levelUp` och `xp` vidare till hud.
  - `close()` tar bort `world.borrowed` från `profile.weapons` och `profile.ammo` och lägger `levelUps` i `result`.

### 9.5 Imperiet och huvudfilerna

- **`core.js`:**
  - Ny hjälpare `giveXp(p, source, opts)` (inte `awardXp`, så att namnet inte krockar med `levels.js`). Den anropar `grantXp`, sätter ihop XP-texten till toasten och anropar `celebrate(p, r)`, som visar toast och partiklar, visar `#overlay-level` vid ny titel och sätter `lvSeen`.
  - Den kopplas in i `buyShop` (288, `buyBiz` med `once: 'buy:'+id`), `upgradeBiz` (91, `upgrade`), `doPitch` (301, vid lyckad pitch) och `endTurn` (360: `roundBonus`, och `winSolo`/`winOnline` med spärren på 2 h).
  - `showWin` (448) ger `finish` till övriga mänskliga spelare.
  - `updateHUD` (9) fyller `#hud-level` och `#hud-xp` med `levelFromXp(p.xp)`.
  - `updateTurnBar` (429) får nivån.
  - `runAITurn` (467) ger `p.xp += AI_TURN_XP`.
- **`features.js`:** `renderMarket` och `doMarketDeal` får spärrarna `bm:*` och källan `market`.
- **`garage.js`:** `renderGarage`, `buyGarageCar` och `pimpCar` får spärrarna `car:*` och `pimp:*`, siluetten och källorna `buyCar` (`carXp`, `once: 'car:'+id`) och `pimp`.
- **`phone.js`:**
  - `phoneOpenDeals` och `doPhoneDeal` får spärrarna `deal:*` och källan `phoneDeal`.
  - `phoneOpenCars` och `buyCar` får samma spärrar som garaget.
  - `renderDashboard` får nivån.
- **`stan.js`:**
  - `renderStanPanel` får Karriär-kortet först och gränser som räknas från nivån.
  - `goToCity` skickar `maxMissions: missionCap(L)`, `maxGoods: goodsCap(L)` och `maxFence: fenceCap(L)`.
  - `onCityClosed` lägger på Advokaten (nivå 63), visar BEFORDRAN för `result.levelUps` med titelbyte, sätter `lvSeen` och kör sedan `saveGame` och synk som i dag.
- **`main.js`:**
  - HUD-markupen (rad 123–125) får `#hud-level` och `#hud-xp` och elementet `#overlay-level`.
  - `startGame` kör `applyCareer(p, { newGame: true })` för mänskliga spelare och sätter AI:ns startnivå (`aiStartXp`).
  - Efter `loadGame` (261, 538) körs `applyCareer(p)` med migrering.
  - Onlinevärden kör `applyCareer` på sin egen spelare.
  - `renderLoginScreen` visar karriärens titel.
  - `renderLobby` visar nivåerna.
  - Nytt `window.game.showCareer`.
- **`sync.js`:** i `case 'welcome'` (196), efter `mergeRemoteState`, körs `applyCareer(myPlayer(), { newGame: true })` och sedan `syncMe()`.
- **`authority.js`:**
  - `validateHit(att, tgt, kind, dmg, now, log, attackerId, mult = 1)` returnerar `dmg: min(rule.max, n) × mult`.
  - `PROPERTIES.stripclub.minLevel = requiredLevel('prop:stripclub')` (28).
  - `validateBuy(owners, prop, buyer, money, level = 100)` nekar med "Kräver nivå 28 · Torped".
- **`citynet.js`:**
  - `sanitizePos` får `lv: clampLevel(p.lv)`.
  - Ny hjälpare `lvOf(id)`: `host.players.get(id)?.lv`, i andra hand `levelOf(gameState.players…xp)`.
  - `hit` får `mult = pvpMult(...) × (newbieShield(...) ? NEWBIE_SHIELD : 1)`, och `host.aggro` uppdateras vid varje träff.
  - `down` räknar `pvpXp` med `pvpXpGate(host.pvpXp, killer, victim, now)`, skickar `xp` i `pvp` och kapar `amount` till 0 vid nybörjarskydd.
  - `buyProp` skickar `lvOf(from)` till `validateBuy`.
  - Ny typ `rank`: kräver att `lv` ligger mellan 1 och 100 och är högre än förra kända, högst 1 gång per 5 s, och sprids med `toAll({ type: 'rank', id, lv, name })`. Den läggs i listan med `onMessage`-typer (rad 222).
  - `playerInfo` får `lv`.
  - `_resetCityNet` nollställer de nya maparna.
- **CSS:** chipet, stapeln, låsknappen (`.lock-badge` med `--band`), `#overlay-level` och mobilens topbar.

### 9.6 Arbetsordning

| Steg | Innehåll | Fas |
|---|---|---|
| 1 | `levels.js` och dess tester (**klart**), `career.js` och dess tester | 1 |
| 2 | Fälten i `state.js`, `applyCareer` och migrering i `main.js` och `sync.js` | 1 |
| 3 | Alla XP-krokar i stan och imperiet, XP-raden i stan och chipet i imperiet. Spelbart här. | 1 |
| 4 | Spärrar av befintligt innehåll och låst-UI | 1 |
| 5 | Formler för skada och respekt, opps- och snutskalning, PvP-ändringarna hos värden | 1 |
| 6 | Nivå-upp-ceremonier, `rank` i flödet, namnskyltar, Karriär-kortet, inloggning och lobby | 1 |
| 7 | Perks för nivå 31–85: backup, muta snuten, Kapo, veteraner och elit, advokat, chaufför, familjen, legenden, erbjudandet, Gudfaderns bil | 1 |
| 8 | Indrivning, skins, rosen, statyn, Prestige och Legend-stjärnor | 2 |

### 9.7 Tester

- **`tests/levels.test.js`** (klar, 63 tester):
  - `XP_TOTAL[100] === 175 220`, strikt växande `need` i femsteg och designens nyckelnivåer.
  - `levelFromXp` vid gränserna (44 ger 1, 45 ger 2, 175 220 ger 100), nivå 100 som tak och rundtur mot `xpForLevel`.
  - Titelbanden täcker 1–100 utan luckor eller överlapp och har rätt titlar i ändarna.
  - `UNLOCKS` är sorterade, unika, har giltiga nivåer och följer designens id-lista.
  - Gränsfunktionerna stämmer med upplåsningslistan.
  - `pvpMult` håller sig inom 0,9–1,1, `dmgMult(100) ≤ 1,5`, kritiska träffar och skadetabellen.
  - `scaleRespectDelta` (förluster oförändrade) och de andra respektformlerna.
  - `bucketTake`: påfyllning, tak, delutdelning, klockan bakåt.
  - `awardXp`: nivå-upp med upplåsningar, rykte och titelrespekt, once, milstolpar, hinkar, spärrar för bankrån (10 min) och vinst (2 h), mentorbonus, AI och trasiga belopp.
  - `pvpXp`: 0 vid 30 nivåers skillnad och vid nybörjarskydd. `pvpXpGate`: par och timme.
  - `normalizeLevelFields`, `normalizeCareer` och `retroXp` (taket vid `XP_TOTAL[30]`).
- **Ny `tests/career.test.js`:** med minneslagring.
  - `grantXp` sparar hinkar och milstolpar mellan anrop (omladdning hjälper inte).
  - Mentorbonusen från `gameState`.
  - `applyCareer` tar max av spelarens och karriärens XP, sätter `lvSeen` och startrespekten.
  - Migreringen körs en gång.
- **Uppdatera:**
  - `missions.test`: typerna filtreras på nivå, `respGain`, `canJoin` kräver nivå 6, steget ×1,45.
  - `net.test`: `validateHit` med `mult`, `sanitizePos` med `lv`, `xp` i `pvp`, gränserna per par och timme, `validateBuy` med nivå.
  - `state.test`: `normalizePlayer` kapar `xp`, `lvSeen` och `xpOnce`.
  - `world.test`: profiler som köper vapen, går med i gäng eller rånar banken behöver en hjälpare som sätter `xp = XP_TOTAL[100]`. Lägg dessutom till tester för spärrarna på låg nivå och för lånade vapen.

---

## 10. Risker och öppna frågor

1. **Karriär mot racet till 1 miljon.** Mot veteraner skyddar fyra saker:
   - Verksamheterna spärras inte.
   - Imperiets spärrar ligger lågt (allt senast på nivå 28).
   - PvP-skadan ligger mellan 0,9 och 1,1, och nybörjare har skydd.
   - Mentorbonusen upp till +75 %.

   Valfritt i fas 2: en rumsinställning "Lika villkor" som stänger av nivåspärrarna i en match.
2. **Solorundor är gratis.** Därför finns hinkarna och spärrarna i realtid. Allt måste räknas på `Date.now()`, aldrig på `world.time`.
3. **Fusk.** XP ligger i klientens egen spelare och i localStorage, precis som pengarna. Värden räknar PvP-skada och PvP-XP, och nivån kan högst ge ±10 % i PvP. Värden kan dessutom logga orimliga hopp, till exempel mer än 3 000 XP mellan två synkar. För ett kompisspel räcker det. `awardXp` kapar dessutom varje enskild utdelning vid `MAX_AWARD` (1 000).
4. **Nya spärrar på gammalt innehåll.** I dag kan alla köpa pistol och anställa crew direkt. Nya spelare får vänta 10–30 minuter, vilket är meningen. Det finns något nytt på nästan varje nivå upp till 23, och vapen på marken går alltid att låna. Gamla sparfiler behåller allt de äger.
5. **Spelare som bara kör brädspelet** levlar långsamt (Kontoret ger 240 XP i timmen). Det är medvetet, eftersom nivåerna hör hemma i stan, och racet påverkas inte.
6. **Skalningen** av opps och snutar mot `dmgMult` behöver speltestas runt nivå 40–60. Taket i `HIT_RULES` ska läggas **före** `pvpMult` (`pvpDamage` gör det).
7. **Pågående arbete:** `git status` visar ändringar i `render3d/*` och de nya filerna `interiors-prison.js` och `render3d.js`, och barbråken byggs i `brawl.js`. Lägg krokarna för Kåken (rymnings-XP, och Advokaten som påverkar straffet), för barbråken (XP för knockout och vinst) och 3D-namnskyltarna **efter** de grenarna.
8. **Nivå-upp mitt i strid:** i stan används bara kön och den kompakta varianten. Den stora BEFORDRAN-rutan visas först hemma.
9. **Ett beslut ägaren behöver bekräfta:** att verksamheterna i Butik inte spärras, se avsnitt 0.

---

## 11. `src/game/levels.js`: API och avvikelser

### Exporter

| Grupp | Exporter |
|---|---|
| Konstanter | `MAX_LEVEL` (100), `XP_MAX` (10 000 000), `LEGEND_STAR_XP` (25 000), `MAX_AWARD` (1 000), `AI_TURN_XP` (120) |
| Band | `RANKS` (11 frysta band `{ from, to, id, title, emoji, color, index }`), `rankOf(L)`, `rankIndex(L)`, `ranksBetween(from, to)`, `levelBadge(L)` → `"🔨 23 Torped"` |
| Kurva | `XP_TOTAL` (index 1..100), `xpToNext(L)`, `xpForLevel(L)`, `levelOf(xp)` → heltal, `levelFromXp(xp)` → `{ xp, level, rank, rankIndex, title, emoji, color, xpInto, xpNeeded, xpLeft, progress, maxed, legendStars }` (alias `progress`), `legendStars(xp)`, `clampLevel(n)`, `cleanXp(xp)`, `playerLevel(spelare \| nivå)` |
| Upplåsningar | `UNLOCKS` (`{ id, level, kind, label, status, fas }`), `getUnlock(id)`, `requiredLevel(id)` (alias `unlockLevel`), `isUnlocked(spelare \| nivå, id)`, `unlocksAt(L)`, `unlocksBetween(from, to)`, `nextUnlocks(L, n = 3)`, `lockLabel(id)`, `lockInfo(spelare \| nivå, id)` → `{ locked, need, rank, label, left, hint }` |
| Gränser | `missionCap(L, base = 3)`, `goodsCap(L)`, `fenceCap(L)`, `crewMax(L)`, `crewRecover(L)`, `gunDiscount(L)` |
| Skada | `dmgMult(L)` (alias `damageMultiplier`), `critChance(L)`, `npcDamage(bas, L, rnd)` → `{ dmg, crit }`, `meleeBase(roll, styrka)`, `crewDmgMult(L)`, `knockMult(L)`, `pvpMult(a, t)`, `newbieShield(a, t, aggro)`, `pvpDamage(bas, max, a, t, { aggro })`, `oppsCount(L)`, `oppsArmed(L, hasGun)`, `npcHpMult(L)`, samt `DMG_MULT_MAX`, `CRIT_MULT`, `CRIT_FROM`, `NEWBIE_SHIELD`, `PVP_LEVEL_SPREAD` |
| Respekt | `respGain(L)` (alias `respectMultiplier`), `scaleRespectDelta(delta, L)`, `failRespect(L, base)`, `startRespect(L)`, `respectFloor(L, eget)`, `respectPayMult(respekt, L)`, `respectMilestones(före, efter)`, `fearMult(L)`, `robFightChance(bas, L, pedTyp)`, `shopRobKickChance(L)`, `muggerInterval(L, r)`, samt `TITLE_RESPECT`, `REP_PER_LEVEL`, `REP_PER_RANK`, `RESP_MILESTONES` |
| XP-tabeller | `XP` (designens tabell), `XP_SOURCES` (alla källor med `xp`, `bucket`, `label`, `mentor`, `milestone`, `once`, `cooldown`), `MILESTONES`, `BUCKETS`, `COOLDOWNS` |
| Variabel XP | `missionXp(m, { member, kapo })`, `bizXp(pris)`, `upgradeXp(kostnad)`, `carXp(pris)`, `shopRobXp(slot)`, `fenceXp(värde)`, `chaseXp(maxStjärnor)`, `respMilestoneXp(steg)`, `koSource(ped)`, `pvpXp(k, v, skyddad)`, `pvpXpGate(state, mördare, offer, now)`, `mentorMult(min, rummetsMax)`, `aiStartXp(värdensNivå)` |
| Hinkar och karriär | `bucketTake(b, want, now, def)` → `{ got, b }` (ren), `bucketPeek(b, now, def)`, `cooldownOk(career, fält, ms, now)`, `createCareer(now)`, `normalizeCareer(raw, now)` |
| Utdelning | `awardXp(spelare, källa, opts, now)`, `levelUpRewards(spelare, from, to, { applyRespect })` |
| Sparfiler och firande | `normalizeLevelFields(spelare)`, `unseenLevels(spelare)`, `markLevelSeen(spelare)`, `retroXp(spelare)` |

### `awardXp(player, source, opts = {}, now = Date.now())`

Det här är den enda vägen för XP. Ordningen:

1. AI-spelare (`blocked: 'ai'`) och okända källor utan `opts.amount` (`'unknown'`) får 0.
2. Beloppet är `opts.amount` eller källans `xp`, ett heltal mellan 0 och `MAX_AWARD`.
3. **Once:** en nyckel som redan finns i `player.xpOnce` ger 0 (`'once'`).
4. **Spärr:** källans `cooldown` (eller `opts.cooldown`) kontrolleras med `cooldownOk` och stämplas bara när den godkänns (`'cooldown'`).
5. **Hink:** källans hink (eller `opts.bucket`) tar det som finns (`capped`). Är hinken tom blir det `'bucket'`.
6. **Mentorbonus:** `opts.mentor` (1..1,75) läggs på det hinken gav, men inte för källor med `mentor: false`.
7. **Milstolpe:** källans `milestone` (eller `opts.milestone`, där `null` stänger av) ges en gång per karriär, utanför hinken och utan mentorbonus.
8. `player.xp` (kapad vid `XP_MAX`), `player.level` (cache), `player.xpOnce` och `career.xp` uppdateras.
9. Vid nivå-upp anropas `levelUpRewards`: +1 ⭐ per nivå, +5 ⭐ och +5 respekt per ny titel hos alla gäng utom rivalen. `opts.levelRewards = false` stänger av det, och `opts.applyRespect = false` returnerar respekten utan att lägga på den.

Resultatet är `{ gained, base, bonus, from, to, levelsGained, unlocked, rankUp, rank, ranks, capped, blocked, milestone, rewards, source }`.

Utan `opts.career` håller modulen en karriär i minnet per spelarobjekt (en `WeakMap`), vilket räcker i tester. I spelet skickar `career.js` alltid in den sparade karriären.

### Avvikelser från texten ovan

- **`levelFromXp` returnerar ett objekt**, som uppdraget för det här steget angav. Designens `levelFromXp(xp) → nivå` heter `levelOf(xp)`, och designens `progress(xp)` är ett alias för `levelFromXp`. Integrationsplanen ovan använder de nya namnen.
- **`awardXp` ligger i `levels.js`** och tar en källa (`source`) i stället för ett belopp. Designens `grantXp(p, amount, reason, opts)` i `career.js` blir ett tunt omslag som laddar och sparar karriären. Hjälparen i `core.js` heter `giveXp`, så att namnet inte krockar.
- **`p.level` skrivs** av `awardXp` och `normalizeLevelFields`, som uppdraget angav. Designens regel gäller ändå: spärrar och nivåer läses alltid ur `p.xp` (`isUnlocked({ xp: 0, level: 100 }, 'rob:bank')` är `false`).
- **Bankrånets spärr på 10 min** ligger i källan `bank` och stämplas först när XP:n betalas ut. Ett bankrån som slutar med BUSTED eller WASTED förbrukar alltså inte spärren. `world` sätter `pendingHeistXp` varje gång.
- **Knockout-källorna** följer `ped.type` i koden: `ko.civ` i stället för "civil". `ko.opps` finns som alias (5), men `koSource` ger `ko.gang` för opps, eftersom de är gängpeds.
- **Extra upplåsningsposter** för bonusar och kosmetik (`perk:crit`, `cap:*`, `perk:discount10/20`, `perk:paytier`, `perk:armoredride`, `perk:fastrecover`, `perk:turfprice`, `perk:nofailloss`, `cosm:*`, `prestige`), så att nivå-upp-rutan kan visa allt i tabellen i avsnitt 5.
- **Tabellen i avsnitt 2:** nivå 2 → nästa är 60, inte 75 (se kommentaren under tabellen).
- **Importer:** utöver `src/city/constants.js` importerar modulen `SHOPS` från `src/data/gameData.js` för `retroXp`. Båda är ren data utan DOM.
