# Tidsmodell: realtid i stan, rundor i Imperiet och vägen till en gemensam spelklocka

Skrivet 2026-10-23 av spår D. Underlag: koden i arbetskopian (`d11c230` plus ocommittade ändringar från spåren A1, A2, B och C), masterpromptens avsnitt 1 ("Innan implementation"), "Gemensam tid och gemensamt tillstånd", 20, 21 och 22, samt mätningar i webbläsare. Belägg märks som i `nulage.md`: [K] läst i koden, [B] körd i webbläsare av D, [T] enhetstest, [G] git. Förslag är förslag. Siffror för dygnets längd och sömnspärr är **designförslag att speltesta**, inte verifierade egenskaper.

## 0. Sammanfattning

- Spelet har i dag **två tider som inte hänger ihop**: stadens klocka (sekunder, lokal, nollställs för varje besök) och Imperiets rundor (heltal som bara `Avsluta tur` ändrar). Dessutom är nivåmodulens hinkar planerade på väggklockan, som redan används av värden för takt och återkomst.
- **En spelares knapp avancerar inkomster, kvoter och straff.** I solo kostar det ingenting: 40 klick gav 1 000 000 kr och avgjorde spelet på 37 ms [B]. I hotseat och online ändrar en spelares knapp dessutom andra spelares nedräkningar [B].
- Online finns **ingen gemensam klocka och ingen auktoritativ ekonomi**. Värden validerar träffar, upplockning, klubbköp och SMS. Pengar, uppdrag och straff avgörs av varje klient själv.
- Förslaget: **en spelklocka** (ren modul, värden är auktoritet online) där **en runda är en spelad dag** (576 klocksekunder, dygnsbyte 06:00). Inkomst, kvoter och straff avräknas **av dygnsbytet**, en gång per spelare och dag. Knappen blir en begäran (Sov) som auktoriteten får neka. Pengar, ägande och straff går genom ett **transaktionslager** med värdvalidering.
- Migreringen sker i sex steg (avsnitt 7). Under hela vägen finns **en betalväg i taget**, så att samma inkomst eller straffdag aldrig räknas två gånger. Det befintliga turläget får finnas kvar som ett tydligt avgränsat **klassiskt läge** och blandas aldrig ihop med realtidsrummet.

---

## 1. Dagens tidskällor

| Källa | Enhet och takt | Var den lever | Vad som avancerar den | Sparas? | Används till |
|---|---|---|---|---|---|
| **Stadens simuleringstid** `World.time` | Sekunder av simulerad tid. 24 s är en spelad timme, 576 s ett dygn. Startar på 0 vid klockan 19:30 (`CLOCK_START`) **för varje besök i stan**. | Per klient. Nollställs när en ny `World` skapas. | Fasta steg om 1/60 s från bildloopen. Står still bakom menyer och när fliken är dold. Hoppar fram vid taxi (+12 s), vila i gömställe (+24), gömma sig (+48), lyckad dejt (+72) och samhällstjänst (+24 x timmar). | Nej | `hour()` (mörker, Nattklubben öppen 20-05, kundflöde), uppdragens tidsgränser, kassornas fyllning, polisens sökning, strid, utslängning, dejtens gräns, återkomst efter PvP |
| **Runda och tur** `gameState.round`, `currentPlayerIdx`, `turnSeq` | Heltal | Delat i Imperiet (online via synk) | **Bara** `endTurn()` | Ja | Inkomst, kvoter (`missionsThisRound`, `fencedThisRound`, `goodsBoughtThisRound`, `dateThisRound`, `cityDone`, `cityCollected`, `cityPickupsTaken`), häkte (`jailRoundsLeft`), `heistCooldown`, `sabotagedRounds`, bevis (`roundsLeft`), belöningsskalning (`round` i `rewardFor`, pickups, bankrån), frö för pickups och crew-kandidater, vinstkontroll |
| **Väggklocka** `Date.now()` | Millisekunder | Värden för det delade: föremål kommer tillbaka efter 180 s, träffar högst 14 per sekund, 15 s fönster för PvP-vinst, SMS-takt, hjärtslag 3 s och 20 s, position gammal efter 6 s | Alltid | Delvis (SMS-historik) | Takt- och spamskydd, nät. Planerat i `docs/levels.md`: XP-hinkar och spärrar. |
| **Bildloopen** `requestAnimationFrame` | Bilder | Klient | Alltid | Nej | Driver simuleringsstegen. Under ca 12 bilder/s går simuleringstiden långsammare än väggklockan. |

Det finns ingen regel för vilken av dem som gäller när något är "tidsbegränsat". Uppdrag räknar simuleringstid, föremål väggklocka, straff rundor.

---

## 2. Hur det hänger ihop i dag

Alla svar är kontrollerade i koden och, där det står [B], körda i webbläsare.

| Fråga | Solo | Hotseat och mot AI | Online |
|---|---|---|---|
| **Vem avancerar rundan?** | Spelarens knapp `Avsluta tur`. `round` +1 vid varje klick (en spelare). [B] | Den som är på tur. `round` +1 när turen går runt till spelare 0. AI-turen tar ca 1,4 s och avslutas av AI själv. [K] Hotseat är körd i webbläsare. [B] | Den som har turen, även en gäst. Värden kör AI-turer för frånkopplade. **Ingen tidsgräns.** Värden kontrollerar inte att avsändaren har turen. [K] |
| **Kan stan vara öppen?** | `Avsluta tur` nekas när stan är öppen ("Åk hem från stan först!"). [B] | Samma. Spärren gäller även AI:ns `endTurn`. | Samma, lokalt. Stan är gemensam och öppen för alla även mellan turerna, men den som är på tur med stan öppen kan inte avsluta. En AI-tur kan **fastna** medan värden har stan öppen. [B] |
| **Inkomst** | Betalas vid `endTurn` till den som trycker: verksamheter (`calcIncome`), bilbonus, Club Diamant. [B] | Samma, bara till den som trycker. | Samma, bara till den som trycker. Inget betalas i realtid. |
| **Kvoter** (uppdrag, skrotning, varor, dejt, pickups, gym/studio/bank per runda) | Nollställs vid `endTurn`. [B] | Bara för den som trycker. | Bara för den som trycker, när hen trycker. Två spelare i samma stad har kvoter som nollställs vid olika tillfällen. [B] |
| **Häkte** | `jailRoundsLeft` minskar med 1 per `endTurn`. Stan är spärrad. [B] Borgen kan betalas när som helst. [K] | Minskar bara för den som trycker. | Samma. Straffet räknas i den egna spelarens turer, alltså i andras väntetid. |
| **Nedräkningar** (`heistCooldown`, `sabotagedRounds`, bevis) | Tickar vid `endTurn`. | **Tickar för alla spelare vid varje spelares `endTurn`** (`checkEvidence` loopar `gameState.players`). [B] | Samma lokalt, men värden tar bara emot avsändarens egen post, så klienterna **glider isär**. [B] |
| **Stadens klocka** | Startar 19:30 vid varje besök, står still bakom menyer, sparas inte. [B] | Samma. | Varje klient har egen klocka och egna fotgängare, bilar och polis. Pausar en spelare står bara hens klocka. Hen markeras `prot` för andra. [B] |
| **Uppdrag** | Tidsgräns i simuleringssekunder, pausar bakom meny. Finns bara i `World`. Kvoten förbrukas vid start. Hem mitt i ett jobb: misslyckat, -5 respekt. Omladdning: uppdraget försvinner utan utfall. [K] | Samma. | Samma, per klient. |
| **Tidshopp** (taxi, vila, gömma sig, dejt, samhällstjänst) | Flyttar `World.time`, ändrar hur klockan ser ut och låter polisens sökning "gå" i sekundsteg. [K] | Samma. | Samma, men bara i den egna klientens värld. Inget delat ändras. |
| **Vinst** | Kontrolleras när en tur avslutas: 1 000 000 kr. | Samma. | Samma. |
| **Sparning** | Efter varje `endTurn` och när stan stängs. Vid `pagehide` om stan är öppen. Bara låsta konton kan läsas in igen. [K] | Samma. | Skrivs till gästplatsen men läses aldrig in. Resultatet av en onlinematch finns inte efter att värden stängt. [K] |
| **AI** | Mot AI: AI-spelaren köper, rullar tärning och avslutar sin tur utan att åka till stan. | Samma. | Samma, körs av värden. |

---

## 3. Problem mot designkärnan

Masterprompten säger att en spelares knapp inte får "godtyckligt hoppa fram tiden, betala ut inkomster eller avtjäna straff åt hela servern", att inkomster, kontrakt, straff och effekter ska använda rätt gemensam tidskälla, att uppdrag ska ha definierat utfall vid avbrott och frånkoppling, och att samma inkomst eller straffdag inte får räknas flera gånger.

| ID | Problem | Belägg | Allvar | Hör till |
|---|---|---|---|---|
| P1 | **Knappen är en tidsmaskin.** `Avsluta tur` betalar, nollställer kvoter, räknar ner häkte och höjer `round` utan kostnad. `round` höjer i sin tur uppdragsbelöning (`rewardFor`: +6 % per runda till 30), pickups och bankrån (+5 % per runda). | [B] 40 klick på 37 ms gav 1 000 000 kr och `gameOver` (med RocketFuel tilldelad i testet) | Hög | F2 |
| P2 | **En spelares knapp rör andras tillstånd.** `checkEvidence()` minskar alla spelares nedräkningar. `round` är delad. | [B] hotseat: spelare 2:s `heistCooldown` 3 till 2 av spelare 1:s klick | Medel | F3 |
| P3 | **Ingen gemensam klocka.** Varje klient har egen tid, egna NPC:er, egen polis. | [B] | Hög | F4 |
| P4 | **Kvoter och straff hänger på ägarens knapp**, inte på tid. Online nollställs de vid olika tillfällen för olika spelare. | [B] | Medel | F5 |
| P5 | **Sekventiella turer i ett delat rum** utan tidsgräns. En passiv spelare stoppar alla. En AI-tur kan fastna när värden har stan öppen. | [K], [B] | Medel | F7, F8 |
| P6 | **Klientägd ekonomi.** Belöningar, köp, straff och slump avgörs lokalt. Värden räknar `data.money` från klienten. Gästens hela spelarpost ersätter värdens. | [K] | Hög mot avsnitt 21 | F6 |
| P7 | **Tre tidsbegrepp utan koppling.** Uppdragens sekunder, rundornas heltal och väggklockans hinkar (planerade i nivåmodulen) saknar gemensam definition. | [K], `docs/levels.md` avsnitt 4.1 | Medel | |
| P8 | **Avbrott saknar utfall.** Uppdraget försvinner vid omladdning, kvoten är förbrukad. | [K] | Medel | F11 |
| P9 | **Tidshopp är lokala och obegränsade.** Online ändrar de bara klientens bild av tiden. | [K] | Låg | |
| P10 | **Tiden sparas inte, onlineläget sparas inte och sparfilen saknar version.** | [K] | Medel | F9, F14 |

Det som **inte** är ett problem: att inkomst och häktesräkning bara gäller den som trycker. Det är rätt i sig. Felet är att trycket inte kostar tid och att timers och runda delas.

---

## 4. Målbild: en spelklocka

### 4.1 Tre sorters tid, med tydliga gränser

| Sort | Definition | Auktoritet | Används till |
|---|---|---|---|
| **Speltid** (spelklockan) | `clock.t` i klocksekunder. En spelad timme är 24 klocksekunder (som i dag), ett dygn 576. Dygnsbytet ligger kl. 06:00. | Online: **värden**. Offline: den lokala klockan, som i sin tur är "värden". | Tid på dygnet, öppettider och kundflöde, **dagsavräkning** (inkomst, kvoter, nedräkningar), straffens längd, **uppdragsdeadlines** |
| **Simuleringstid** | `World.time` som i dag. Oförändrad och lokal. | Klienten | Rörelse, strid, polisens sökning, animationer, utslängning från rum, spawnskydd, dejtens gräns. Allt som är kosmetiskt eller lokalt. |
| **Realtidsspärr** | Väggklocka via värden (`Date.now`) | Värden | Takt- och spamskydd, SMS, föremålens återkomst, nivåmodulens XP-hinkar. Aldrig för det som ska hänga ihop med dygnet. |

### 4.2 Invarianter

1. Inkomst, kvoter, straff och deadlines avgörs av `clock.day` och `clock.t`, **aldrig av vem som tryckt på vad**.
2. Varje avräkning har en nyckel (spelare, dag) och görs **högst en gång**. Den som kör avräkningen ser att dagen redan är avräknad.
3. En knapp kan bara **be** om något ("Sov", "Redo"). Auktoriteten beslutar.
4. Tid går inte bakåt. Ett tidshopp är en händelse som avräknar **alla** dagar det passerar.
5. Bara auktoriteten ändrar pengar, ägande och straff. Klienten visar förväntat resultat som "väntar på bekräftelse" och säger aldrig "sparat" innan det är bekräftat.
6. Frånvaro ger varken ruin eller kassaskåp: inga löpande kostnader för den som är borta, och högst `CATCHUP_DAYS` (förslag 3) dagars inkomst vid återkomst.
7. Under migreringen gäller **en betalväg i taget** (flaggan `gameState.timeModel`: `'turn'` eller `'clock'`).

### 4.3 Skiss av klockmodulen (ren logik, `src/game/clock.js`)

```js
export const SECONDS_PER_HOUR = 24;            // som world.hour() i dag
export const DAY_SECONDS = 576;                // 24 x 24
export const CLOCK_START_HOUR = 19.5;          // ny match börjar 19:30 som i dag
export const DAY_BOUNDARY_HOUR = 6;            // dygnsbyte: avräkning
// clock = { v: 1, t, rate: 1, mode: 'local' | 'hosted' }
export const hourOf  = t => (CLOCK_START_HOUR + t / SECONDS_PER_HOUR) % 24;       // samma formel som i dag
export const dayOf   = t => Math.floor((CLOCK_START_HOUR + t / SECONDS_PER_HOUR - DAY_BOUNDARY_HOUR) / 24);   // 0 vid matchstart
export const roundOf = t => dayOf(t) + 1;      // gameState.round blir en härledd visning
// advance(clock, dt), skip(clock, toT, reason) -> händelse, syncFromHost(clock, { t, at }, nowMs)
```

Online skickar värden `{ t, at }` i `welcome` och var 2:a sekund (eller i `cityAll`). Klienten extrapolerar med `performance.now()` och justerar mjukt vid avvikelse över ca 0,25 s. Ingen jämförelse av väggklockor mellan datorer.

---

## 5. Vad en "runda" betyder under migreringen

| Fas | "Runda" betyder | Vad avancerar den | Knappen "Avsluta tur" | Etapp |
|---|---|---|---|---|
| **Nu** (`etapp0-start`) | Ett varv knapptryck: en tur per spelare, `round` +1 när alla gått | Spelarens knapp | Betalar, nollställer, räknar ner häkte | |
| **Steg 0-1** | Som nu. `hour()` läser klockan. "Runda N" visas som förut. | Knappen | Oförändrad | 1 |
| **Steg 2, solo** | **En spelad dag**: 576 klocksekunder, dygnsbyte 06:00. `round = dag + 1`. Alla räknare som heter "rundor kvar" betyder "dagar kvar". | **Klockan.** Den går i stan i realtid och står still i Imperiet. Sov hoppar framåt. | Heter **Sov**. Begäran: hoppa till nästa 06:00. Betalar inget själv, dygnsbytet avräknar. Villkor i avsnitt 8. | 1 |
| **Klassiskt läge** (hotseat, mot AI) | Som nu, men **per spelare**: varje spelares tur är en egen dag med egen avräkning. Stan startar 19:30 som i dag. | Den spelarens knapp, men bara för den spelarens räknare | `Avsluta tur` kvar. Den rör aldrig andra spelares timers. | 1 (beskrivs, kvar tills hotseat får klockan) |
| **Steg 4, online** | Bara en etikett: "Dag N". Inga turer. | Värdens klocka | Finns inte. | 3 |

Det klassiska läget är ett **uttryckligt, avgränsat läge** enligt masterprompten ("om befintligt turbaserat läge behöver finnas kvar under migrering ska det beskrivas tydligt och inte blandas ihop med en realtidsserver"). Det visas som "Klassiskt turläge" i lobbyn och kan inte hostas som realtidsrum.

---

## 6. Ansvarsfördelning: värd eller server mot klient

"Värd" är i dag en spelares webbläsare (P2P). Det skyddar mot misstag och mot fusk från gäster, **inte mot värden**. En dedikerad server är ett senare steg (Steg 6). Rena moduler (`clock`, `economy`, `authority`, `police`) skrivs så att de kan köras både i värdens webbläsare och i en Node-server.

| Område | I dag | Mål | Beslutar | Klienten gör |
|---|---|---|---|---|
| Klockan | Lokal per klient | Värden publicerar `{ t, at }` | **Värd** | Extrapolerar, visar |
| Dagsavräkning (inkomst, kvoter, nedräkningar, häktesdag) | Spelarens knapp, klientens räkning | `settleDay(spelare, dag)` i värden för **alla** spelarposter, även frånkopplade och AI | **Värd** | Visar resultatet |
| Köp (verksamhet, bil, vapen, bostad) | Klienten drar pengar direkt | Förfrågan med id till värden, svar `ok/nej + ny post`, UI visar "väntar" | **Värd** | Skickar, väntar, visar |
| Uppdrag | Klienten skapar, spelar och betalar | Värden **utfärdar kontrakt** (id, typ, frö, belöningstak, deadline i speltid, kvot). Klienten spelar. **Krav på belöning** valideras mot kontraktet (deadline, tak, en gång). | **Värd** (kontrakt, betalning), **klient** (spelar) | Simulerar och rapporterar mål nått |
| Straff, böter, häkte | Klienten kallar `jailPlayer` | Klienten rapporterar händelsen ("arresterad, nivå 3"). Värden bestämmer påföljd (längd i speltid, bot i procent med tak) och sätter `jailUntil`. | **Värd** | Rapporterar, visar |
| Slump (pitch, tärning, svarta marknaden) | `Math.random` i klienten | Värdens slump (frö per transaktion) | **Värd** | Visar utfall |
| Polis, trafik, folk, rummens NPC:er | Lokal simulering | **Oförändrat lokalt.** Kosmetiskt per klient. Händelser som får följder rapporteras som typ + nivå och beskärs av värden. | **Klient** | Simulerar |
| Position, träffar, upplockning, klubbköp, SMS | Värd validerar | Oförändrat | **Värd** | |
| PvP-utfall | Offret rapporterar belopp | Värden räknar från offrets post: min(10 %, 5 000) | **Värd** | |
| Sparning | localStorage på klienten, värdens minne för rummet | Värden sparar rummets post per karaktär. Klienten sparar sin karriär lokalt. | **Båda** | |
| Idempotens | Ingen | `txLog` i spelarposten och nyckeln `settle:<tecken>:<dag>` | **Värd** | |

**Ärlig gräns:** polisen och NPC:erna simuleras per klient, så värden kan inte bevisa att ett uppdrag "verkligen" slutfördes. Värden kontrollerar **plausibilitet och tak** (deadline, belöningstak, kvot, avstånd mellan kontrollpunkter), inte omspelning. Det är bra nog för kompisrum och ska redovisas så, inte som server-auktoritet.

---

## 7. Migrering i steg

Storlekar är bedömningar för en utvecklare som känner kodbasen: arbetsdagar med spann. De är inte mätningar.

| Steg | Mål | Ändringar | Bevarad progression | Godkännande | Omfattning | Etapp |
|---|---|---|---|---|---|---|
| **0. Mät och skydd** | Låsa dagens beteende innan något ändras | Karakteriseringstester för `endTurn` (inkomst, kvoter, häkte, `checkEvidence`, vinst). `saveVersion: 1` i `gameState` och en migreringskedja i `state.js` (`migrations[]`, en per version). Spara en sparfil från `etapp0-start` som testunderlag. | Inget ändras | `tests/time.test.js` gröna. Sparfilen laddas med samma pengar, runda, kvoter. | 1-2 d, låg osäkerhet | 1 |
| **1. Klockan som modul** | En klocka, ingen ny betalväg | `src/game/clock.js`. `gameState.clock`. `World.hour()` läser klockan. `World.update` kallar `clock.advance(dt)`. Taxi, vila, dejt och samhällstjänst anropar `clock.skip(...)` i stället för `World.time +=`. `World.time` blir ren simuleringstid. Klockan sparas. | Gamla filer: `clock.t = 576 x (round - 1)` (klockan 19:30 dag `round - 1`). Stan startar nu där klockan står, inte alltid 19:30. | Klockan går vidare mellan två stanbesök. Nattklubbens öppettid följer klockan. Gammal sparfil ger 19:30 vid första besöket. `endTurn` betalar exakt som förut. | 3-5 d, låg-medel | 1 |
| **2. Dagsavräkning, solo och klassiskt läge** | Knappen slutar vara tidsmaskin | `settleDay(p, dag)` (ren, idempotent) i `src/game/economy.js`: inkomst, kvoter, `heistCooldown`, `sabotagedRounds`, bevis, häktesdag. `gameState.timeModel = 'clock'` för solo. `endTurn` blir `sleep()` (begäran, villkor i avsnitt 8). `checkEvidence` ersätts av avräkning per spelare. Kvoter får `quotaDay` och nollställs när `quotaDay !== idag`. HUD visar "Dag N 21:40". Klassiskt läge: `settleDay` bara för den som trycker. | `*ThisRound`-fälten behåller namn och betydelse ("per dag"). Mitt i en runda sparade kvoter lever kvar (`quotaDay = idag`). "Rundor kvar" blir "dagar kvar". Gamla `moneyHistory` oförändrad. | 40 x Sov ger inkomst för högst så många dagar som klockan passerat. Dubbelavräkning omöjlig (kör `settleDay` två gånger, och avbryt mitt i). Hotseat: spelare 1:s knapp rör inte spelare 2. Sparfil från `etapp0-start` läses in. | 6-10 d, medel | 1 |
| **3. Transaktionslager och värdvalidering** | Pengar, ägande och straff i ett lager med auktoritet | `applyTx(post, tx)` med id, källa, belopp, tak. Ersätter ca 47 direkta `.money`-rader i 8 filer och ca 30 anrop av `addMoney`/`spend`. `txLog` (ringbuffert) i spelarposten. `authority.js` får `validateTx`. Uppdragskontrakt (utfärda, kräva, förfalla). Slump flyttas till värden där utfallet ger pengar. `buyProp` slutar ta `data.money`. Onlineprofil: värden äger rummets post per karaktär och tar emot **meddelanden**, inte hela spelarposter (`me`/`state` slutar ersätta posten). | Offline är man sin egen värd: samma kod, samma regler. Sparade karaktärer läses in som förut. | Dubbelklick och omladdning ger inte dubbla uttag eller belöningar. Två klienter får samma saldo efter köp, uppdrag och PvP. "Väntar på bekräftelse" syns. Gästens `data.money` påverkar inget. | 10-16 d, medel-hög | 2 |
| **4. Online: kontinuerlig klocka, inga turer** | Ett rum med en klocka | Värden publicerar `{ t, at }` i `welcome` och periodiskt. `settleDay` för alla poster, även frånkopplade och AI (`aiDay` ersätter `runAITurn`). `isMyTurn`-spärren tas bort ur Imperiets paneler online. `Avsluta tur` göms. Uppdragsdeadlines i speltid, pausmeny pausar inget. Kvoter per dag. | Onlinerummets poster behåller `quotaDay`, `settledDay`. | Två klienter visar samma `hour()` (inom 0,5 s) och dag. Gästen kan inte höja dagen. Frånkopplad spelares kontrakt förfaller på deadline. Inget AI-stopp (F7), inget AFK-stopp (F8). | 8-14 d, medel-hög | 3 |
| **5. Straff på klockan** | Häkte och fängelse som speltid | `Sanction { kind, untilT, bail, reason }`. BUSTED: klienten rapporterar, värden bestämmer längd (nivå till klocksekunder) och bot. Kåken (etapp 3) är platsen där tiden sitts av. Häktet-fliken visar nedräkning i speltid. Samhällstjänst blir en skuld i transaktionslagret online (ingen klockhopp). | `jailRoundsLeft` räknas om till `untilT` vid migrering (dagar x 576 från nu). | Straffet går inte att kringgå via menyer. Borgen går genom lagret. Världstiden går sönder inte. | 5-8 d, medel (utöver Kåken) | 3 |
| **6. Dedikerad server (valfritt)** | Slippa värden som enda felpunkt, få en klocka som lever utan spelare | Node + WebSocket kör de rena modulerna. Persistens. Ersätter P2P-värden. Löser NAT eftersom servern är mitt i. | Rummets poster flyttas | Beslut efter etapp 4 med användningsdata | 15-30+ d, **hög osäkerhet** | 5 |

Summa steg 0-5: ca 33-55 arbetsdagar. Större delen av osäkerheten ligger i steg 3 (antalet ställen som ändrar pengar och hur mycket onlineprofilen ska bära) och steg 4 (tester med flera klienter).

### 7.1 Så passerar gamla värden genom migreringen

| Fält | Före | Efter |
|---|---|---|
| `round` | Heltal som knappen höjer | Härledd: `dayOf(clock.t) + 1`. Gamla filer: `clock.t = 576 x (round - 1)`. |
| `missionsThisRound`, `fencedThisRound`, `goodsBoughtThisRound`, `dateThisRound`, `cityDone`, `cityCollected`, `cityPickupsTaken`, `dealsThisRound`, `rollsThisRound`, `pitchesThisRound` | Nollställs av ägarens knapp | Samma fält. Nollställs när `quotaDay` är en annan dag än dagens. Gamla filer: `quotaDay = dayOf(t)`. |
| `jailRoundsLeft`, `inJail`, `bail` | Räknas ner per knapp | Steg 2: dagar kvar, minskar vid dygnsbyte. Steg 5: `untilT`. |
| `heistCooldown`, `sabotagedRounds`, `pendingEvidence[].roundsLeft` | Alla spelare tickar vid varje knapp | Dagar. Minskar för **varje spelare vid hens egen avräkning**. |
| `moneyHistory` | Ett värde per tur | Ett värde per dag |
| `cityPolice`, `cityBusted` (spår B) | Sparas i profilen | Oförändrat. Polisen är lokal simuleringstid och ändras inte av klockan. |
| Sparfil | Ingen version | `saveVersion` och migreringskedja (Steg 0) |

---

## 8. Regler för särfall

| Situation | Regel (förslag) |
|---|---|
| **Sov i solo** | Tillåten när (1) spelaren är hemma eller inne i ett eget gömställe/bostad, (2) ingen polisinsats pågår och inget uppdrag eller dejt är aktivt, (3) minst **12 spelade timmar (288 klocksekunder)** gått sedan förra sömnen. Klockan hoppar till nästa 06:00, alla passerade dygn avräknas, hälsan fylls. När knappen är spärrad visar den varför och hur länge. Speltest avgör 12-timmarsgränsen. **Konsekvens:** den som bara vill klicka runt i Imperiet måste låta klockan gå i stan (eller vänta) för att få nästa dags inkomst. Det är avsiktligt, och just det som ägaren ska ta ställning till (avsnitt 9.2 och 9.3). |
| **Sov online** | Inget klockhopp. Vila är en lokal paus med nedtoning där hälsan fylls efter en kort väntan och spelaren är skyddad medan hen vilar. Klockan går. |
| **Klockan i Imperiet (solo)** | Står still. Imperiets paneler (butik, pitch, tärning, marknad) är tidsfria åtgärder med dagskvoter. |
| **Uppdrag** | Sparas som kontrakt `{ id, gäng, typ, frö, acceptedT, deadlineT, tillstånd }`. Deadline i speltid. Vid inläsning: har `deadlineT` passerat är uppdraget **misslyckat** (respekt -5, ett definierat utfall). Annars återupptas det och mål och fordon återskapas ur fröet. Hem mitt i jobbet är fortsatt misslyckat. |
| **Frånkoppling och omladdning** | Speltid, kontrakt och räknare sparas vid `pagehide` och vid varje avräkning. Online avräknas även frånkopplade spelare, men utan straff utöver förfallna kontrakt. |
| **Karriär som pausas** | Inga löpande kostnader för den som är borta. Vid återkomst högst `CATCHUP_DAYS = 3` dagars inkomst. Ingen förlorad svit eller ruin. |
| **Pausmeny** | Solo: pausar klockan. Online: pausar inget. Spelaren är skyddad (`prot`, som i dag), men uppdragsdeadlines fortsätter. |
| **Tidsbegränsade saker** | Uppdrag, kontrakt och straff: speltid. Öppettider och kundflöde: speltid (`hourOf`). Föremålens återkomst (180 s): oförändrad väggklocka via värden. Polisens sökning, spawnskydd, utslängning från rum, dejtens gräns: simuleringstid, oförändrat. XP-hinkar och SMS-takt: realtidsspärr. |
| **Taxi, dejt, samhällstjänst** | Solo: `clock.skip` med fade. Online: fade utan hopp. Samhällstjänst blir en skuld i transaktionslagret. |
| **Värden försvinner** | Dagens beteende: gästerna fortsätter ensamma mot AI. Klockan fortsätter från senast mottagna `t`. Spelarposten finns kvar hos gästen. (Verklig värdflytt hör till Steg 6.) |
| **AI** | Agerar vid dygnsbytet (`aiDay`), inte på "tur". I solo mot AI betyder det att tiden inte är gratis: varje hoppad dag ger AI:n sin dag. |

---

## 9. Beslut som ägaren behöver ta

1. **Dygnets längd.** 576 s (9,6 min) följer dagens klocka. Räcker det för "3 uppdrag per dag" och första halvtimmen (tre dygn)? Speltestas.
2. **Pris på tid i solo.** Förslaget är 12 timmar vaken mellan sömnerna. Alternativ: fri sömn men dagligt underhåll och att rivaler (AI) spelar sin dag, eller en nedkylning i riktig tid. Utan något av dem finns kvar "40 klick till vinst" i ny form.
3. **Ska klockan stå still i Imperiet i solo?** Förslaget: ja, så att brädspelsdelen förblir lugn. Alternativ: långsam klocka även där.
4. **Hotseat.** Klassiskt läge tills vidare (förslaget) eller klockan för alla?
5. **Onlineprofil.** Ska en sparad karaktär få tas med in i ett rum? Hur mycket ska värden lita på den (tak efter nivå och speltid)? Alternativ: ren onlinekarriär per rum eller server.
6. **När beslutas dedikerad server?** Förslag: efter etapp 4, med verkliga uppgifter om hur många som spelar samtidigt och över vilka nätverk.
7. **Straffets längd i speltid.** Hur länge är ett fängelsedygn? Kopplas till etapp 3 och Kåken.
8. **Pausmeny online.** Fri paus med skydd (dagens) eller att deadlines fortsätter (förslaget).

---

## 10. Godkännandetest för tidsmodellen

| # | Test | Steg |
|---|---|---|
| A1 | `settleDay` två gånger för samma spelare och dag ger samma pengar | 2 |
| A2 | Omladdning och avbrott mitt i en avräkning ger ingen dubbel utbetalning | 2 |
| A3 | 40 x Sov i följd ger inkomst för högst så många dagar som klockan faktiskt passerat | 2 |
| A4 | Hotseat: spelare 1:s knapp ändrar inte spelare 2:s timers, kvoter eller häkte | 2 |
| A5 | Gammal sparfil från `etapp0-start` laddar: samma pengar, runda blir dag, kvoter kvar | 0-2 |
| A6 | Två klienter: samma `hour()` (+/- 0,5 s) och dag, bara värden höjer dagen | 4 |
| A7 | Frånkopplad spelares kontrakt förfaller på deadline. Återkomst ger högst 3 dagars inkomst. | 4 |
| A8 | Dubbelklick och omladdning på köp, uppdrag och bot ger inte dubbla uttag eller belöningar | 3 |
| A9 | Häktesdagar minskar bara med klockan. Häktet-fliken och borgen går genom lagret. | 5 |

---

## 11. Så togs underlaget fram

Skript och loggar ligger i `/tmp/claude-0/-home-user-empire-of-hustle/a5ab78d5-7ccb-5b2f-9c97-cf55acd2a25c/scratchpad/etapp0/D/`:
`tid-solo.cjs` (+ `tid-solo.log`), `tid-extra.cjs` (+ `tid-extra.log`), `tid-online.cjs` (+ `tid-online.log`), `tid-ai-stall.cjs` (+ `tid-ai-stall.log`), `reconnect-d.cjs`, `repro-polis.mjs`. Beskrivning i `nulage.md`, avsnitt 4.
