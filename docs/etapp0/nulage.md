# Nuläge etapp 0: teknik, multiplayer och kontrollerad lista

Skrivet 2026-10-23 av spår D (dokumentation). Inga kodändringar gjordes för det här dokumentet.

**Vilken version som beskrivs.** Arbetskopian i `/home/user/empire-of-hustle`: `HEAD` är `d11c230`, taggen `etapp0-start` pekar på `d176157`. Arbetskopian innehåller dessutom ocommittade ändringar från spåren A1 (styrning), A2 (kamera), B (polis) och C (körning). Där något bara gällde `etapp0-start` står det.

**Rader i texten är funktionsnamn, inte radnummer.** Radnummer flyttar sig när filerna ändras.

## Märkning av belägg

| Märke | Betyder |
|---|---|
| **[T]** | Enhetstest. D körde `npx vitest run` 2026-10-23: **786 av 786 gröna i 21 filer** (arbetskopian, medan andra spår fortfarande arbetade). |
| **[B]** | Webbläsarkörning av D: Chromium headless 1100x720, egen dev-server utan HMR på port 3205. Online-körningarna går via PeerJS:s publika signalering (`0.peerjs.com`) mellan två flikar på samma maskin. Skripten ligger i `scratchpad/etapp0/D/` (se sist). |
| **[K]** | Läst i koden av D. |
| **[G]** | Enligt git-historik eller commit-meddelande. Inte omkört av D. |
| **[S]** | Andra spårs skript eller resultatfiler (främst A2). Inte omkörda av D. |

Det som saknar märke ska läsas som antagande.

---

## 1. Teknikstack

| Område | Så fungerar det i dag | Filer | Belägg |
|---|---|---|---|
| Plattform och bygge | Vanilla ES-moduler, Vite 5.4 (`base: /empire-of-hustle/`), inget UI-ramverk. Beroenden: `peerjs ^1.5.4`, `three ^0.185.1`. Deploy: `gh-pages -d dist` (GitHub Pages). Produktionsbygget: huvudbundle 725 kB (247 kB gzip), `three` 735 kB (190 kB gzip) och 3D-motorn 93 kB som egna chunkar. | `package.json`, `vite.config.js` | [B] `vite build` gick bra på 2,6 s till en tempkatalog |
| Motor och spelloop | `frame()` i `index.js` körs av `requestAnimationFrame`. Fast simuleringssteg 1/60 s, högst 5 steg per bild, `dt` kapas till 0,1 s. Loopen står stilla bakom en meny och när fliken är dold. Knapptryck läses bara i bilder som kör ett steg. Följd: **under ca 12 bilder/s går världens tid långsammare än väggklockan.** | `src/city/index.js` | [K], [B] |
| Världen | `World` är all simulering, utan DOM. Den får `profile`, som är **samma objekt** som spelaren i `gameState.players`, så stan och Imperiet delar ett saldo. Händelser går ut som `events` till `index.js`. Kartan är 64x64 rutor à 64 px (4 096 px), seed 1337, sex stadsdelar som motsvarar sex gäng, och alltså **samma stad hos alla**. | `src/city/world.js` (3 117 rader), `map.js`, `constants.js` | [K] |
| Rendering 2D | Canvas 2D i GTA2-stil: markcache, hus med falskt perspektiv, mörker och blåljus. Används i läget ÖVERBLICK (`top`). Canvasen är genomskinlig så att den kan ligga över 3D och bära HUD:en. | `src/city/render.js` (1 276 rader) | [K] |
| Rendering 3D | three.js 0.185.1, kräver WebGL2, laddas först när ett 3D-läge behövs. Lägena FÖRSTAPERSON (`fps`) och FÖLJKAMERA (`chase`). Stad, folk, fordon och **rum** (rummets 2D-målning blir golvtextur, möbler reses som lådor). Egen liten scen för händer, vapen, instrumentbräda (bil) och styre (cykel/moped/HD). Utan WebGL2 stannar spelet i ÖVERBLICK med besked. | `src/city/render3d.js`, `render3d/*` (ca 3 500 rader) | [K], [S] A2 `f` 9/9 |
| HUD och menyer | HUD ritas på 2D-canvasen, projicerad över 3D (`drawWorld3D`). Stans menyer är DOM (`.city-modal`). Imperiet är DOM-flikar med inline-`onclick` mot `window.game`. | `src/city/hud.js`, `index.js`, `src/main.js`, `src/game/core.js` | [K] |
| Input | Tangentbord, mus (pekarlås i 3D, pekaren siktar i ÖVERBLICK), touch med joystick, knappar, look-finger och nyp-zoom. Uthållighet för spring. | `src/city/input.js` | [K], [T] controls 38, joystick 49 |
| Kamera | Ren logik: lägen `fps`, `chase`, `top`, hjul- och nypkedja, inställningar. Valet sparas i localStorage (`hustle_city_cam`, `hustle_city_view`, `hustle_city_zoom`, `hustle_city_chase`, `hustle_city_zoomx`). Standard för ny spelare: FÖLJKAMERA. Dörrar, bil och menyer byter aldrig läge. | `src/city/camera.js` | [T] camera 38, [S] A2 `c` 29/29 |
| Fordonsfysik | Arkadfysik: fordonet är två cirklar längs mittlinjen, grepp i sidled med gräns, drift bara med handbroms eller smäll, fast svängradie under 110 px/s. Kollision mot kartrutor och mellan fordon. Körkänslan är samlad i `DRIVE` (spår C). 15 fordonstyper i `VEHICLES`. | `physics.js`, `vehicles.js` | [T] driving 35, physics 10 |
| AI | Trafik följer filer (`laneControl`), fotgängare kastar sig undan, jakt går via ett flödesfält över gatunätet (`chaseControl`). | `src/city/ai.js` | [K] |
| Polis | Ren logik i `police.js` (spår B): nivå 0-5, faser `calm`/`stop`/`chase`/`search`, incidentlista, tak per nivå, dispatcher. `world.wanted` är samma objekt som `world.police`. Läget sparas i `profile.cityPolice`. BUSTED (fängelsekedjan) sker bara på nivå 3+. | `src/city/police.js` (526 rader), `wanted.js` | [T] police 23 |
| Interiörer | 10 registrerade rum, 2D-rutnät om 32 px med NPC-simulering, kollision och interaktionspunkter: Club Diamant, Pang-Pelles Vapen, Mehmets Kebab, Frisören, Hustle Gym, Beat Studio, Nattklubben VIP, KimIT Tech, Skyskrapan, RocketFuel. Samma rutnät byggs i 3D av `room.js`. Kåken (`interiors-prison.js`) är ett elfte rum som **inte är inkopplat**. | `interiors.js`, `interiors-biz-a.js`, `interiors-biz-b.js`, `businesses.js` | [K], [T] interiors 51, biz-a 78, biz-b 69, prison 18 |
| Ekonomi, Imperiet | Åtta verksamheter (`SHOPS`, pris 500-150 000, inkomst 80-20 000 per runda och nivå). Inkomst = `bas x nivå x (1 + bilbonus) x sabotage(0,5)`, karaktärsförmåga ovanpå. Sex bilar i Garaget med inkomstbonus och pimp-steg. Stash. Pitch, tärning/event (13 st, bl.a. razzia), svarta marknaden (8), telefondeals (4), fyra minispel. Vinst vid 1 000 000 kr, kontrolleras bara när en tur avslutas. | `src/game/core.js`, `src/data/gameData.js`, `src/features/*` | [K], [B] |
| Ekonomi, stan | Uppdrag (5 typer, 900-1 800 kr x runda x respekt x medlem), kassor i verksamheterna, pickups, rån, bankrån, långning (120 kr/st), skrotning, dejt, PvP (10 % av kontanterna, max 5 000). Allt går direkt in i `profile.money`. Belöningar skalas med `round`. | `world.js`, `missions.js` | [K] |
| Rundsystem | `gameState.round`, `currentPlayerIdx`, `turnSeq`. Lokalt är det bara `endTurn()` som ändrar dem, online även synken (se `tidsmodell.md`). Kvoter per runda: 3 uppdrag, 3 skrotningar, 10 varor, 2 pitchar, 2 tärningar, 2 svarta affärer. | `core.js`, `state.js` | [K], [B] |
| Sparning | localStorage. Låsta konton sparas som `empire_save_<karaktär>`, konton i `empire_accounts` (32-bitars hash, ingen riktig autentisering). Gäster sparas som `empire_hustle_save` men **läses aldrig in**. Hela `gameState` sparas som JSON, nya fält får standardvärden i `normalizePlayer`. Sparfilen har **inget versionsfält**. Stans världstid och uppdrag sparas inte. Polisens läge sparas (`cityPolice`, `cityBusted`). | `src/game/state.js`, `main.js`, `features/stan.js` | [K], [T] state 19, [B] |
| Multiplayer | PeerJS i ett stjärnnät med värden i mitten. Se avsnitt 2. | `src/multiplayer/*` | [K], [T] net 17, [B] |
| Ljud | Allt syntetiseras med Web Audio: SFX, tre radiokanaler, motor, siren. Musik och SFX går bara att slå av och på. | `src/utils/audio.js` | [K] |
| Byggda men ej inkopplade moduler | `interiors-prison.js` (Kåken) importeras bara av sitt test. `src/game/levels.js` (nivå 1-100, 79 tester) importeras bara av sitt test. | | [K] ingen import i `src/` |

---

## 2. Multiplayer: vad är riktigt delat

### 2.1 Arkitektur

- PeerJS med publik molnsignalering (ingen egen server). Värden skapar peer-id `empire-<KOD>`, gäster ansluter direkt till värden. Rumskoden är ett av tio ord plus två siffror (900 koder). Högst 6 spelare. **[K]**
- Bara STUN (två Googleservrar), **ingen TURN**. **[K]**
- Hjärtslag var 3:e sekund, en tyst anslutning stängs efter 20 s. Värden tar tillbaka rumskoden om signalservern tappar den. **[K]**
- Försvinner en gäst tar AI:n över hens spelare. Försvinner värden fortsätter gästerna **offline mot AI**, utan värdbyte. **[K]**
- Offline är man sin egen värd: samma kod (`citynet.js` och `authority.js`) körs lokalt. **[K]**

### 2.2 Vad värden validerar

| Vad | Hur | Belägg |
|---|---|---|
| Föremål på marken | Räckvidd 70 px, inte inomhus, ingen annan hann före, 180 s återkomst (värdens `Date.now`) | [K], [T] net |
| Träffar mellan spelare | Samma plats, räckvidd per typ (närstrid 70, skott 760, bil 110), skadetak (45/32/70), högst 14 träffar/s, skyddade nekas | [K], [T] net |
| Klubbägande (Club Diamant) | Pris, övertagning (dubbelt pris, ersättning till förra ägaren), inget dubbelköp | [K], [T] net |
| SMS | Längd 280, takt, mottagaren måste vara nåbar, kvitto | [K], [T] net, sms 110 |
| Positioner | Typtvätt och klippning av fälten. **Ingen** kontroll av hastighet, teleport eller väggar. | [K] |
| Vem som är AI eller frånkopplad | Bara värden ändrar | [K] |

### 2.3 Vad som är klientägt eller lokal simulering

| Vad | Läge | Belägg |
|---|---|---|
| **Pengar, ägodelar, crew, vapen, rykte, häkte, uppdrag** | Klientägt. En gästs egen spelarpost ersätter värdens kopia (`me`/`state` med `onlyPlayer`). Värden räknar inte om något. | [K], [T] net |
| Priset i `buyProp` | Värden jämför mot **pengar som klienten själv rapporterar** (`data.money`), inte mot sin egen kopia. | [K] |
| PvP-vinst | Värden delar ut om en träff skett inom 15 s, men beloppet rapporteras av offret (högst 5 000). | [K] |
| Tur och runda | Den som har turen skickar. Värden kontrollerar **inte** att avsändaren har turen och tar emot `round`, `currentPlayerIdx` m.fl. från gästen om `turnSeq` inte är äldre. | [K] |
| Slumpen i Imperiet (pitch, tärning, svarta marknaden, heist) | `Math.random()` i varje klient, 43 rader i `core.js` och `features/`. | [K] |
| Trafik, fotgängare, polis, gäng, opps, bråk, rummens NPC:er | **Lokal simulering per klient.** Andra spelare ser bara varandras positioner, vapen, hälsa och stjärnor. Mätt: värd och gäst hade 23 mot 6 fotgängare, 5 mot 3 polisbilar. | [B] |
| Tid på dygnet | Per klient (`World.time`, ny för varje besök i stan). | [B] |
| Kartan och föremålsplatserna | Delade genom seed 1337. | [K] |

**Slutsats:** online är i dag **delad närvaro med värdvaliderade interaktioner** (träff, upplockning, klubbköp, SMS), inte delad simulering och inte en auktoritativ ekonomi. Det går att kalla multiplayer för vänner i ett rum, men inte multiplayer med server-auktoritet i masterpromptens avsnitt 21. Planen för det finns i `tidsmodell.md`.

---

## 3. Nulägeslista

### 3.1 Verifierat fungerande

| # | Vad | Hur det är verifierat |
|---|---|---|
| V1 | Alla enhetstester | [T] 786/786, 21 filer: world 66, police 23, driving 35, camera 38, controls 38, joystick 49, net 17, state 19, missions 24, map 9, physics 10, render3d 26, interiors 51 / biz-a 78 / biz-b 69 / prison 18, brawl 23, sms 110, levels 79, hud 2, version 2. |
| V2 | Produktionsbygge | [B] `vite build` till tempkatalog, 93 moduler, 2,6 s. |
| V3 | Stan öppnas, stängs, HEM. Klockan står stilla bakom introrutan och menyer. `Avsluta tur` med stan öppen nekas ("Åk hem från stan först!"). | [B] `tid-solo.cjs` |
| V4 | Imperiets runda i solo: inkomst (80+180 = 260 kr för två verksamheter), kvoter nollställs, häktet räknas ner per tur, spelet avgörs vid 1 000 000. Sabotage halverar inkomsten. | [B] `tid-solo.cjs`, `tid-extra.cjs`, `tid-online.cjs` |
| V5 | Sparning: rundtur, trasig fil avvisas, avgjort spel återupptas inte, crew/vapen/väst/gömställen/klubbägande sparas. Sparfilen innehåller `cityPolice`. | [T] state, [B] |
| V6 | Online mellan två flikar: skapa rum, gå med, tur-spärr ("Vänta på din tur!"), turläge och runda synkas, delad stad (positioner, minikarta). En redan tagen karaktär nekas enligt koden ([K], inte körd). | [B] `two.cjs`-flöde, `tid-online.cjs`; [T] net |
| V7 | Återanslutning efter död flik: pengar, crew, vapen, väst och klubbägande tillbaka, inga dubbletter, ett köp precis före stängning når värden. | [B] `reconnect-d.cjs` (D:s kopia av `reconnect.cjs` med ÖVERBLICK för snabba bilder) |
| V8 | Förstaperson i kedjan gata, dörr, kebab, disk, ut, bil, ur (läget byts aldrig av spelet). Club Diamant, bilen, mobil, blickriktning efter 2-8 varv, utan WebGL2, paus och inställningar. | [S] A2 `c` 29/29, `k` 10/10, `mc` 9/9, `m` 24/24, `d` 39/39, `f` 9/9, `x` 16/16 |
| V9 | Styrning och joystick, körning och fysik, polisens flykttest (nivå 2: 3 av 5 undkom, nivå 4: 0 av 5). | [T] controls, joystick, driving, physics, police |
| V10 | Rummens liv (kunder, personal, kassa, bråk) | [T] interiors, biz-a, biz-b, brawl |
| V11 | SMS mellan riktiga spelare | [T] sms 110. Tre riktiga klienter enligt commit `bc5338c` ([G], `sms3.cjs` ej omkört). |

### 3.2 Verifierade fel

Allvar mäts mot designkärnan i masterprompten. "Status" gäller arbetskopian.

| ID | Fel | Belägg | Allvar | Status |
|---|---|---|---|---|
| F1 | **Polisklungan.** I `etapp0-start` gav `resolveCollisions` `addHeat(CRIME.copHit)` (+0,6) **varje sekund** (`copHitT = 1`) så länge två bilar gav en stöt över 90. `lastHitBy = 'player'` sattes på varje bil som rörde spelarens, även när snuten körde in i spelaren. Skada räknades i varje steg med stöt över 120. `copTarget(5)` = 7 bilar (minst 2 även utan efterlysning), `copSpeedFactor(5)` = 1,07. | [K] mot `git show etapp0-start:src/city/world.js`. [B] `repro-polis.mjs`, tre frön, 10 s gas mot en stillastående polisbil: **etapp0-start** 1 stjärna efter 1 s och 2 efter 6-7 s, spelarbilens HP 77 / 4 / 0 av 100. **Arbetskopian** 1 stjärna hela tiden, HP 77 i alla tre. | Hög | Åtgärdad i arbetskopian (spår B). Slutverifiering återstår. |
| F2 | **Rundor är gratis i solo.** `Avsluta tur` betalar inkomst, nollställer kvoter, räknar ner häktet och höjer `round` utan någon kostnad i tid. `round` skalar dessutom uppdragsbelöning, pickups och bankrån. | [B] `tid-extra.cjs`: 10 klick på 9 ms gav 200 000 kr med RocketFuel nivå 1 (tilldelad i testet), 40 klick på 37 ms avgjorde spelet. | Hög | Öppet. Se `tidsmodell.md`. |
| F3 | **Nedräkningar tickar för alla.** `checkEvidence()` körs i varje `endTurn()` och minskar `heistCooldown` och `sabotagedRounds` för **alla** spelare. Online blir det olika på olika klienter eftersom värden bara tar emot avsändarens egen post. | [B] Hotseat: spelare 1 trycker, spelare 2 går 3 till 2 och 2 till 1. Online: efter gästens tur står värdens `heistCooldown` på 2 hos värden men 1 hos gästen. | Medel | Öppet |
| F4 | **Stans klocka är lokal och nollställs.** `World.time` börjar på 0 (klockan 19:30) för varje besök, 24 sekunder är en spelad timme, och den sparas inte. Varje klient har egen klocka. | [K], [B]: värd 3,0 s mot gäst 0,7 s i samma rum. Pausar gästen står bara gästens klocka. | Hög | Öppet |
| F5 | **Kvoter nollställs av ägarens knapp, inte av tid.** Online har varje spelare sin egen kvot som nollställs när just hen avslutar sin tur. | [B] Värdens `missionsThisRound` 3 till 0 efter värdens tur, gästens står kvar på 3 tills gästens tur. | Medel | Öppet |
| F6 | **Klientägd ekonomi** (avsnitt 2.3): värden kontrollerar inte saldo, belöningar, uppdrag eller turägare. | [K] | Hög mot avsnitt 21, låg för ett kompisrum | Öppet, ska redovisas |
| F7 | **Online-turer kan fastna på AI-turen.** `endTurn(true)` för en AI avbryts av `window.city.isOpen()` (värdens egen stad), AI-turen avslutas inte och ingen ny `ensureAITurn()` körs när värden åker hem. | [B] `tid-ai-stall.cjs`: gästen försvinner, värden i stan under AI:ns tur, efter 9 s och 4 s efter att värden åkt hem står `currentPlayerIdx` kvar på AI:n. Enligt [K] anropas `ensureAITurn()` bara vid synk-, anslutnings- och bortfallshändelser, aldrig när stan stängs. Att en senare händelse sätter igång turen igen är läst i koden, inte körts. | Medel | Öppet |
| F8 | **Ingen tidsgräns på en tur** (inget `setTimeout` för turen). En spelare som är på tur och har stan öppen kan inte avsluta ("Åk hem först"). En ansluten men passiv spelare stoppar alla. Frånkoppling löser sig efter högst 20 s. | [K], [B] | Medel | Öppet |
| F9 | **Online-profil följer inte med.** Värd och gäst skapas med `normalizePlayer({ charKey })` (1 000 kr, tomt), en sparad karaktär kan inte tas med och onlineresultat sparas inte på riktigt. Ändå anropar `endTurn`, `onCityClosed` och `pagehide` `saveGame()` även online och skriver till gästplatsen, trots att `doSave` säger "Onlinematcher sparas inte". | [K] `main.js`, `sync.js` `handleJoin`, `stan.js` | Medel | Öppet |
| F10 | **Gästsparning är skrivskyddad.** `empire_hustle_save` skrivs men `loadGame` anropas bara med kontonycklar och `hasSave`/`deleteSave` används inte. | [K] sökning i `src/` | Låg | Öppet |
| F11 | **Uppdrag försvinner utan utfall** vid omladdning eller frånkoppling: uppdraget finns bara i `World`, kvoten (`missionsThisRound`) är redan förbrukad och ingen respektpåverkan sker. Att åka hem mitt i ett jobb ger däremot -5 respekt. | [K] | Medel | Öppet |
| F12 | **Simuleringstiden beror på bildfrekvensen.** Stans profilsynk (var 4:e sekund) räknas i simuleringstid. Med 3D i mjukvaru-GL (5-10 bilder/s) hade värden inte fått gästens köp efter 6,8 s (orsaken enligt koden är att synkräknaren går på simuleringstid, inte provat isolerat). Med ÖVERBLICK gick det. | [K], [B] `reconnect.cjs` (originalet) och `reconnect-d.cjs` | Medel på svaga enheter | Öppet |
| F13 | **Hus och bank är menyer, inte rum.** Sex gömställen och Stadsbanken öppnar en modal vid dörren. De 24 "platserna" (Torget, Banken, Perrongen ...) är bara uppdragsmål. Inga passagerare finns. Garage, bilhandlare, häkte och domstol finns som flikar i Imperiet, inte som platser. | [K] `enterPlace`, `doors()`, `PLACE_NAMES`; sökning efter "passenger" ger noll träffar | Hög mot förstapersonskravet | Öppet, se `forstaperson-checklista.md` |
| F14 | **Ingen sparfilsversion.** Migrering sker bara genom att `normalizePlayer` fyller i standardvärden. | [K] | Medel inför etapp 1+ | Öppet |
| F15 | **Karaktär kan övertas.** `handleJoin` släpper in vem som helst på en frånkopplad karaktär om hen kan rumskoden. Ingen identitet bevisas. | [K] | Låg (kompisrum) | Öppet |
| F16 | **Värden är en enda felpunkt.** Försvinner värden slutar rummet gälla och gästerna fortsätter ensamma mot AI. Rummets tillstånd finns bara i värdens minne. | [K] `handleConnClosed` | Medel | Öppet |
| F17 | Lösenord är en 32-bitars hash i localStorage och skyddar inte mot den som har enheten. Hotseat väljer extra spelare med `prompt()`. | [K] `main.js` | Låg | Öppet |

### 3.3 Ännu inte verifierat

| # | Vad | Varför det inte är gjort | Hur det ska kontrolleras |
|---|---|---|---|
| U1 | **NAT mellan olika nätverk** (hemma mot 4G, symmetrisk NAT). Bara STUN finns, ingen TURN. | Alla körningar var två flikar på samma maskin. | Två verkliga nätverk. Räkna med att vissa kombinationer misslyckas utan TURN. |
| U2 | **Riktiga telefoner.** Touch är bara provat med emulerad multitouch (CDP, 390x844). | Ingen fysisk enhet i miljön. | Android och iPhone, joystick, look-finger, nyp, E-knapp, tummen på två ställen. |
| U3 | **iOS Safari**: WebGL2, Web Audio-upplåsning, WebRTC när fliken går i bakgrunden, ingen pekarlås-API. | Ingen iOS-enhet. | Egen testrunda. |
| U4 | **60 bilder/s på riktig GPU.** Alla mätningar gjordes med mjukvaru-GL (SwiftShader), median 100-170 ms per bild. Mätt JS-tid per bild: simulering 1-1,5 ms, 3D 1,5-2 ms, HUD 0,3 ms. | Ingen GPU i miljön. | Mätning på bärbar dator och mellanklasstelefon, med p99-ryck. |
| U5 | Tre till sex samtidiga klienter i stan, långa pass (över 30 minuter), minnesutveckling. | Bara två klienter har körts i D:s mätningar. | Flerklientskript, minnesprofil. |
| U6 | Dålig nätverksprofil (latens, paketförlust), och hur länge PeerJS publika signalering består. | Inget testnät. | Strypning i devtools, `reclaim.cjs` ([S], ej omkört). |
| U7 | **Alla 43 rader i checklistan (29 platser, 8 paneler, 6 ej byggda eller ej inkopplade) och 15 fordon i förstaperson.** Endast kebaben, Club Diamant och startbilen är körda ([S] A2). | Hör till slutverifieringen. | `forstaperson-checklista.md` |
| U8 | Användartest med nya spelare. Första halvtimmen finns inte som upplevelse ännu. | Etapp 1. | Se `plan.md`. |
| U9 | Faktisk publicering (`npm run deploy`) och att "ny version finns"-bannern fungerar mot GitHub Pages. | Inte körd. | Publicera till testgren. |
| U10 | Värdens bortfall mitt i en match i praktiken (koden finns). | Inte körd av D. | Dödande av värdfliken med två gäster. |
| U11 | Tillgänglighet: textstorlek, separata ljudnivåer för musik, dialog och effekter (finns bara av/på). | Inte byggt. | Etapp 1-2. |
| U12 | Hur gamla sparfiler beter sig efter etapp 0 (nya fält: `cityPolice`, `cityBusted`, spårens kommande fält). | Ingen migreringstest mot en riktig gammal fil. | Behåll en sparfil från `etapp0-start` och läs in den. |

---

## 4. Så kördes kontrollerna

Allt körs från `/home/user/empire-of-hustle`. Dev-server utan HMR: `npx vite --config <scratchpad>/etapp0/vite.nohmr.config.mjs --port 3205 --strictPort`. Skript i `<scratchpad>/etapp0/D/` (scratchpad = `/tmp/claude-0/-home-user-empire-of-hustle/a5ab78d5-7ccb-5b2f-9c97-cf55acd2a25c/scratchpad`):

| Skript | Visar | Körs med |
|---|---|---|
| `tid-solo.cjs` | Världsklocka, introrutans paus, `endTurn` med stan öppen, inkomst, kvoter, häktesräkning, sparfilens innehåll | `NODE_PATH=$(npm root -g) node tid-solo.cjs` |
| `tid-extra.cjs` | 40 klick till vinst, hotseat där spelare 1:s knapp tickar spelare 2:s nedräkningar | samma |
| `tid-online.cjs` | Två klienter: tur-spärr, runda, inkomst, nedräkningar, lokala klockor, `endTurn` med stan öppen | `URL=http://localhost:3205/empire-of-hustle/ node tid-online.cjs` |
| `tid-ai-stall.cjs` | AI-turen som fastnar när värden har stan öppen | samma |
| `reconnect-d.cjs` | Återanslutning och köp före stängning | samma |
| `repro-polis.mjs` | Polisklungan i `etapp0-start` mot arbetskopian | `node repro-polis.mjs <katalog>` |
| `vitest.json` | Testresultat per fil | `npx vitest run --reporter=json` |
