# Etappplan 1-5

Skrivet 2026-10-23 av spår D. Bygger på masterpromptens avsnitt 20 ("Genomförande i etapper"), 21 (tekniska krav) och 22, på `nulage.md` (teknik, multiplayer, felkarta F1-F17) och `tidsmodell.md` (Steg 0-6) i samma katalog, samt på `docs/levels.md` (nivåmodulen).

**Så ska siffrorna läsas.**
- Omfattning anges i **arbetsdagar för en utvecklare som känner kodbasen**, som spann. Det är bedömningar, inte mätningar. Ett AI-stött arbetssätt kan skriva kod flera gånger snabbare, men speltest, användartest, verifiering på riktiga enheter och nätverk tar riktig tid och ingår i spannen.
- Osäkerhet: **låg** (ungefär +/-20 %), **medel** (+/-35 %), **hög** (+/-50 % eller mer), **mycket hög** (kan skilja en faktor två).
- Alla speltider, tal och belöningar i masterprompten är designförslag att speltesta. Det gäller även här.
- Förstaperson följer med genom alla etapper. En plats räknas som klar först när den klarat godkännandet i `forstaperson-checklista.md` (gå in, orientera, gå runt, interagera, byt kamera och tillbaka, gå ut, återvänd, med kontroll av kollision, position, blickriktning, utrustning, sparning och synk).

## 1. Läget efter etapp 0

Efter etapp 0 finns (enligt spårens rapporter och `nulage.md`, ännu inte slutverifierat): blickriktad gång, tre kameralägen med nyp och hjul, 3D-rum för tio interiörer, responsiv körning med säker avstigning, graderad polis med flyktmöjlighet, 786 gröna tester. **Det som kvarstår från etapp 0** (2-4 arbetsdagar, låg osäkerhet):

| Kvarstår | Källa |
|---|---|
| Slutverifiering av alla rader i `forstaperson-checklista.md` (43 rader: 29 platser, 8 paneler, 6 ej byggda eller ej inkopplade, plus 15 fordon) | masterprompt 21 |
| Speltest av polisens flykt: nivå 1-2 ska gå att undkomma med startbilen (i enhetstestet 3 av 5 på nivå 2) | F1 |
| Två snabba fel i onlinevägen: AI-turen som fastnar när värden har stan öppen (F7) och profilsynken som räknas i simuleringstid (F12) | `nulage.md` |
| Sparfilsversion och migreringskedja (tidsmodell Steg 0) måste finnas innan någon etapp lägger till fält | F14 |
| Behåll en sparfil från `etapp0-start` som regressionsunderlag för alla senare migreringar | U12 |

## 2. Byggda men ej inkopplade moduler

| Modul | Vad den är | Var den hör hemma | Beroenden och vad som måste göras |
|---|---|---|---|
| **`src/game/levels.js`** + `docs/levels.md` + `tests/levels.test.js` (79 tester) | Nivå 1-100 med titelband från Springpojke (1-5) till Gudfadern (100), XP-kurva, upplåsningar i fas 1 och 2, spärrar, skadeformler, respekt, hinkar mot farmning. Importeras bara av sitt test. Spår E ändrar fortfarande bandens gränser och upplåsningarnas antal (vid skrivande 12 band och 88 upplåsningar, 83 i fas 1 och 5 i fas 2), så siffror och avsnittsnummer här följer `docs/levels.md` som det står när etapp 1 startar. | **Etapp 1:** motorn och nivå 1-10 (`docs/levels.md` 9.6 steg 1-4: `career.js`, fält i `state.js`, XP-krokar i stan och Imperiet, XP-rad i HUD, spärrar). **Etapp 2:** spärrar och perks för bilar, pimp, svarta marknaden, garderob. **Etapp 3:** Advokaten (nivå 63) och Kåkens krokar (rymnings-XP). **Etapp 4:** PvP-skalning, `rank`-meddelanden, mentorbonus. | (1) Ranktabellen 1-100 i data är klar (spår E). (2) Hinkarna räknar på väggklocka (`Date.now`, injicerbar `now`). Det är **realtidsspärrar** och ska vara det även efter tidsmodellen (`tidsmodell.md` 4.1). Uppdragens och dygnets tid är speltid. (3) Nivåspärrar på pengar använder `raceLevel` när två människor spelar. Ägaren ska bekräfta de två besluten i `docs/levels.md` avsnitt 0. (4) Krokarna i `world.js` (9.3) måste läggas **efter** polisens och körningens ändringar i samma fil, och efter Kåkens. |
| **`src/city/interiors-prison.js`** (Kåken) + `tests/interiors-prison.test.js` (18 tester) | Gångbart fängelse 32x24 rutor: cellblock A med sex celler, vaktrum, matsal, rastgård med basket, gym och vakttorn, besöksrum, direktörens kontor, port och sluss. Interaktioner: borgen, direktör, träna, langare, tunnel, telefon, vakt. Larm, upplopp och slagsmål styrs av världen. Importeras bara av sitt test. | **Etapp 3.** | (1) Tidsmodell Steg 4-5: straffet sitts av i speltid. (2) BUSTED-flödet byts: i dag `onCityClosed` -> `jailPlayer` -> Häktet-fliken -> räknas ner per `Avsluta tur`. Ska bli arrest -> häkte -> rättegång -> Kåken. (3) `world.enterInterior('prison')`, spawn och utgång, spelarens cell, `lockCells`. (4) 3D: `room.js` ger okända möbeltecken en höjd via teckenförklaringens namn (`furnitureHeight`), så rummet bör gå att resa, men det är **inte verifierat** för Kåkens egna tecken. (5) Brawl i fängelse (`brawl.js` `canBrawl`). (6) Krokar för XP (rymning) och Advokaten. |

## 3. Miljömigrering: plats, beroende, leveransetapp

Masterprompten kräver att planen namnger plats, beroende och leveransetapp för befintliga miljöer som ännu inte migrerats. Detaljer per plats finns i `forstaperson-checklista.md`.

| Plats eller funktion | Nuläge | Beroende | Etapp |
|---|---|---|---|
| Startboende (ett av sex gömställen) | Meny vid dörren | Ny interiör efter mallen i `interiors-biz-a.js`, 3D via `room.js`, vila via Sov (tidsmodell Steg 2) | **1** |
| Övriga fem gömställen, lager, bostadsbehörigheter, gäster | Meny | Transaktionslager (Steg 3), inventarium | **2** |
| Stadsbanken | Meny med bankrån | Egen interiör (valv, vakter), ledger för rånets utbetalning | **2** |
| Garage, bilhandlare, verkstad | Flik i Imperiet + Lackverkstan (körs in) + Skroten | Showroom-interiör, fordonsklasser, förhandsvisning, `garage.js` granskas ("fordonskort som visar inkomstbonus") | **2** |
| Svarta marknaden | Flik | Plats och inventarium | **2** |
| Passagerare i fordon | Saknas helt | Sittplatser, NPC och spelare, synk | **2** (garage) och **4** (social) |
| Häktet | Flik | Kåken och domstol | **3** |
| Domstol | Finns inte | Ny interiör | **3** |
| Kåken | Modul, ej inkopplad | Se avsnitt 2 | **3** |
| Imperiets mobil, stans telefon, SMS | Overlay (får ligga ovanpå spelet) | Kameran får inte återställas, utveckling i etapp 4 | **4** |
| Minispel (4 st) | Flik | Event i klubbens rum | **4** |
| Klubbevent (Nattklubben VIP, Club Diamant) | Rum finns | Eventlogik, inträde till belöning | **4** |
| De 24 uppdragsplatserna (Torget, Perrongen ...) | Bara mål på kartan | Görs till riktiga miljöer per kapitel | **4-5** |
| Fler stadsdelar | Finns inte | Världsbyggnad, strömning, NPC-tak | **5** |
| Kebab, frisör, gym, studio, nattklubb VIP, tech, skyskrapa, RocketFuel, Club Diamant, Pang-Pelle | Rum i 2D och 3D | Slutverifiering i etapp 0, sedan regressionsunderlag | **0** |

## 4. Översikt

| Etapp | Mål (masterprompt 20) | Omfattning | Osäkerhet | Största risk |
|---|---|---|---|---|
| 0 (kvar) | Gör stan bra att spela | 2-4 d | låg | Slutverifieringen hittar fler fel |
| 1 | En komplett första halvtimme | 32-54 d | medel | Onboardingens speldesign och användartestets utfall |
| 2 | Ägande, identitet, vuxen atmosfär | 48-80 d | hög | Innehållsmängd (bilar, kläder, effekter) och transaktionslagret |
| 3 | Häkte och fängelse som spelbara miljöer | 28-45 d | medel-hög | Flödet och tiden online |
| 4 | Social värld, klubb, fler kapitel | 40-70 d | hög | Nätverk mellan riktiga enheter, innehåll |
| 5 | Skala innehåll och testa spridning | 60-120+ d | mycket hög | Serverbeslut, kapacitet, återkomst |

Summa etapp 1-5: ca 210-370 arbetsdagar. Spannet är brett med flit: etapp 4-5 beror på vad användartest och verklig multiplayer visar.

## 5. Felkartan: när åtgärdas vad

| Fel (`nulage.md`) | Åtgärdas | Hur |
|---|---|---|
| F1 Polisklungan | Etapp 0 (verifiera) | Spår B har åtgärdat. Speltest i slutverifieringen. |
| F2 Rundor är gratis, F3 timers tickar för alla | Etapp 1 | Tidsmodell Steg 2 |
| F4 lokal klocka, F5 kvoter på ägarens knapp | Etapp 1 (solo), etapp 3 (online) | Steg 1-2 respektive Steg 4 |
| F6 klientägd ekonomi | Etapp 2 | Steg 3 |
| F7 AI-tur som fastnar, F12 synk i simuleringstid | Före etapp 1 (snabbfix), därefter borta med Steg 4 | Anropa `ensureAITurn()` när stan stängs och låt AI:ns `endTurn` gå förbi spärren. Räkna synkintervallet i väggklocka. |
| F8 ingen tidsgräns på tur | Etapp 3 | Steg 4 tar bort turerna online |
| F9 onlineprofil och F10 gästsparning | Etapp 2 | Steg 3, plus beslut om onlineprofil (`tidsmodell.md` avsnitt 9.5) |
| F11 uppdrag utan utfall | Etapp 1 (solo), 3 (online) | Uppdragskontrakt, Steg 2-3 |
| F13 hus och bank som menyer | Etapp 1-4 | Avsnitt 3 ovan |
| F14 ingen sparfilsversion | Etapp 0-1 | Steg 0 |
| F15 karaktär kan övertas, F17 | Etapp 4 | Identitet vid anslutning |
| F16 värden som enda felpunkt | Etapp 5 | Steg 6 (valfritt) |

---

## Etapp 1: en komplett första halvtimme

**Mål.** Samma sparade karaktär kan spela mot ett tydligt mål, köpa eller använda en belöning, gå hem, umgås och sedan återuppta karriären. Alla ingående platser och övergångar fungerar i förstaperson.

**Prioriterat innehåll.**

| Prio | Innehåll |
|---|---|
| P1 | **Tidsmodell Steg 0-2** (sparfilsversion, klockan, dagsavräkning, Sov). Utan den är kvoter och "nästa runda" obegripliga för en ny spelare. |
| P1 | **Nivå 1-10** enligt `docs/levels.md` 9.6 steg 1-4: `career.js`, fält i `state.js`, XP-krokar, XP-rad, spärrar. Ranktabell 1-100 i data är redan gjord. |
| P1 | **Onboarding-kedjan:** personligt startställe (startboende i förstaperson), en kontakt (NPC med dialog), tre korta förlåtande uppdrag, första belöning, ett köp som märkbart förbättrar spelet, en bil att prova, vägledning med ett aktivt huvudmål. |
| P1 | **Val "Följ karriären" eller "Fritt stadsliv"**: ett fält per karaktär, kan bytas utan ny karaktär, styr vägledning och frivilliga uppdrag men aldrig regler mitt i en konflikt (pågående efterlysning, skuld, uppdrag består). |
| P2 | Ett gängs introduktion (`JOIN_RESPECT`, nivåspärren) och ett enkelt träningsmoment (Hustle Gym finns, `train` ger +1 styrka). |
| P2 | Minst två fria aktiviteter utan krav på våld: långning, dejt, gym, disslåt, dansa, radio och körning finns redan. De behöver lyftas fram, inte byggas. |
| P3 | Separata ljudnivåer (musik, dialog, effekter), textstorlek. |

**Berörda delar.**

| Del | Vad |
|---|---|
| `src/game/state.js` | `saveVersion`, migreringskedja, `xp`, `xpOnce`, `lvSeen`, `mode` (karriär/fritt), `clock`, `quotaDay`, onboardingens steg |
| `src/game/clock.js`, `economy.js` (nya) | Klocka, `settleDay`, sömnvillkor |
| `src/game/career.js` (ny), `levels.js` | Lagring och XP |
| `src/game/core.js`, `main.js` | `endTurn` -> Sov, HUD med Dag/klocka/nivå, val av läge vid start, HUD-markup |
| `src/features/stan.js` | Skickar kvoter från nivå, `onCityClosed`, `pagehide` |
| `src/city/world.js` | XP-krokar, onboarding-tillstånd, kontaktens händelser, klockan |
| `src/city/missions.js` | Tre korta uppdragsmallar med utrymme för fel (förlåtande), uppdragskontrakt |
| `src/city/map.js`, `interiors*.js`, `render3d/room.js` | Kvarteret, kontaktens plats, startboende som nytt rum i 2D och 3D |
| `src/city/hud.js`, `index.js` | Vägledning, XP-rad, mål, nivå-upp-kö |
| `tests/` | `time.test.js`, `career.test.js`, onboarding, migrering, utökade `state`, `world`, `net` |

**Beroenden.** Etapp 0 slutverifierad. Tidsmodell Steg 0-2. Spår E:s rangdata. Ägarens beslut om dygnets längd, sömnspärr (`tidsmodell.md` 9.1-9.2) och nivåspärrarnas påverkan på verksamheter (`docs/levels.md` avsnitt 0).

**Omfattning: 32-54 arbetsdagar, osäkerhet medel.**

| Del | Dagar |
|---|---|
| Tidsmodell Steg 0-2 | 10-17 |
| Nivåmotorn i spelet (steg 2-4) och `career.js` | 6-10 |
| Onboarding, kontakt, tre uppdrag, vägledning, val av läge | 6-10 |
| Startboende i förstaperson | 4-7 |
| Träning, belöningar, gängintro | 3-5 |
| Användartest och justering | 3-5 |

**Spelbart godkännandetest** (tiderna är designmål för en ny spelare, inte krav):

1. Ny spelare utan sparfil väljer namn och utseende och har kontroll över figuren i förstaperson vid sitt startboende inom ca 2 minuter.
2. Ett kort möte med kontakten lär ut att gå, sikta, interagera och öppna mobilen, inom ca 5 minuter.
3. Första uppdraget är valt inom ca 10 minuter. Det klaras (eller misslyckas förlåtande) och ger en tydlig belöning.
4. Inom ca 20 minuter har spelaren köpt eller använt något som märkbart förbättrar spelandet och provkört en tillgänglig bil.
5. Inom ca 35 minuter har spelaren mött ett gäng, kommit in i sitt boende och sett nästa större möjlighet.
6. Hem, Sov, ny dag: kvoter nollställs, inkomst betalas en gång, ingenting räknas dubbelt (tidsmodell A1-A3).
7. Byt till Fritt stadsliv och tillbaka utan ny karaktär. Mål, ägande och konsekvenser består.
8. Spara, ladda om och fortsätt mitt i: nivå, kläder/bil, kvoter och polisläge kvar.
9. Kameran byts aldrig av dörr, dialog, uppdrag eller menyer. Alla platser i kedjan klarar checklistans godkännande.
10. **Användartest:** minst 5 personer som inte sett spelet. Mät tid till kontroll, tid till första belöning, andel som förklarar nästa mål, var de fastnar, hur ofta de byter kamera. Resultatet avgör etapp 2:s omfattning. Det är en **hypotes** att tiderna ovan går att nå, tills testet är gjort.

**Risker.** Onboarding som styr för hårt mot friheten i sandlådan. Sömnspärren känns som tvång för den som bara vill spela brädspelet. Nivåspärrar på gammalt innehåll kan uppfattas som urholkning (`docs/levels.md` 10.4).

---

## Etapp 2: ägande, identitet och vuxen atmosfär

**Mål.** Köp och effekter syns, fungerar, sparas och ger meningsfulla val. Affärer testas med två riktiga klienter om multiplayer ingår.

**Prioriterat innehåll.**

| Prio | Innehåll |
|---|---|
| P1 | **Transaktionslager (tidsmodell Steg 3):** all ändring av pengar och ägande går genom ett lager med värdvalidering, bekräftelse och idempotens. Onlineprofil (beslut 9.5). |
| P1 | **Inventarium** och användbara köp. Ett saldo, ett inventarium, en sparväg. Inga parallella system per vy. |
| P1 | **Fler bilar i klasser** (småbil, kombi, sedan, transportbil, SUV, muskelbil, sportbil) som skiljer sig i acceleration, toppfart, broms, grepp och utrymme. Dagens 6 garagebilar och 15 fordonstyper behålls. Garage-showroom som riktig plats med vridbar förhandsvisning. Granska fordonskortens inkomstbonus. |
| P1 | **Modifieringar** (lack, fälgar, dekaler, karossdetaljer, prestanda) som syns och fungerar i alla kameralägen, sparas och synkas. Ett fordon får inte kunna dupliceras genom att växla mellan telefon, garage och stan. |
| P1 | **Garderob och kläder** som syns i förstaperson (ärmar, händer, utrustning) och i följkamera. |
| P2 | Bostadsbehörigheter, lager, affärsbord, gäster. Fördjupat gym och gängprogression. |
| P2 | Stadsbanken som riktigt rum. Svarta marknaden som plats. |
| P3 | En eller två stiliserade påverkanseffekter med anpassbar presentation. Styrningen ska fungera med och utan visuellt filter. |
| P3 | Passagerare i fordon (en bestämd ledig plats, föraren behåller kontrollen). |

**Berörda delar.**

| Del | Vad |
|---|---|
| `economy.js`, `authority.js`, `citynet.js`, `sync.js` | Transaktioner, `validateTx`, delta-meddelanden i stället för hela spelarposter |
| `state.js` | `inventory`, `outfit`, `garage`, `txLog`, migrering |
| `src/features/garage.js`, `phone.js` | Garage och bilköp som en väg |
| `src/city/vehicles.js`, `physics.js` | Fordonsklasser och egenskaper (spår C:s `DRIVE` är utgångspunkten) |
| `src/city/render3d/actors.js`, `viewmodel.js`, `engine.js` | Kläder, utrustning, fordonsdetaljer, effekter |
| `src/city/interiors*.js`, `render3d/room.js` | Klädbutik, garage-showroom, bank, bostäder |
| `src/city/world.js`, `hud.js` | Köp i stan, inventariepanel |
| `docs/levels.md` | Spärrar för bilar, pimp och svarta marknaden (9.5) |

**Beroenden.** Etapp 1 (klocka, dag, nivåmotor). Tidsmodell Steg 3. Ägarens beslut om onlineprofil.

**Omfattning: 48-80 arbetsdagar, osäkerhet hög.** Transaktionslagret 10-16 d, inventarium 5-8, fordonsklasser och garage 14-22, modifieringar 8-12, garderob 6-10, bostäder/bank/behörigheter 8-14 d (plus påverkanseffekter 4-8 om de tas med). Innehåll (modeller, färger, texter) är det som sväller.

**Spelbart godkännandetest.**

1. Gå in i bilhandlarens showroom i förstaperson, vrid en bil, prova lack och fälgar innan köp. Köp via värden: "väntar på bekräftelse" syns, sedan "köpt".
2. Bilen står hos spelarens hem, syns i stan med sina ändringar, beter sig enligt sin klass och sparas. Online syns den för andra.
3. Dubbelklick och omladdning ger inget dubbelköp och ingen dubbel dragning. En bil finns på ett ställe.
4. Köp kläder. De syns i förstaperson och följkamera och består efter omladdning.
5. Flytta in i en bostad: lager, gäst, vila. Behörigheterna stämmer.
6. Aktivera och avsluta en effekt med och utan filter. Styrningen går att använda hela tiden.
7. **Två riktiga klienter:** köp, överlåtelse eller affär ger samma saldo hos båda. Gästens påstådda saldo påverkar ingenting.

**Risker.** Mängden innehåll. Att transaktionslagret rör ca 77 ställen i 8 filer (47 direkta `.money`-rader och 30 anrop av `addMoney`/`spend`) och därför bör införas med regressionstester och en flagga per område. Onlineprofilens tillit (inga vattentäta garantier i P2P).

---

## Etapp 3: häkte och fängelse som spelbara miljöer

**Mål.** En spelare kan spela hela förloppet utan att fastna, kringgå straffet via menyer eller förlora sparade värden. Varken karriärvägledning eller världstid får gå sönder.

**Prioriterat innehåll.**

| Prio | Innehåll |
|---|---|
| P1 | **Tidsmodell Steg 4-5:** kontinuerlig klocka online utan turer, straff på klockan. |
| P1 | **Kedjan arrest, häkte, rättegång, dom, Kåken, frigivning.** Ersätter dagens `onCityClosed` -> `jailPlayer` -> flik. |
| P1 | **Kåken inkopplad** (avsnitt 2): celler, matsal, rastgård, gym, besöksrum, direktör, port. Förstaperson i alla delar. |
| P1 | Fängelseaktiviteter/rundor (träna, äta, basket, arbeta, ringa crewet), frigivning, handel mellan stan och fängelset (besök, paket, langare, tunnel som rymning). |
| P2 | Domstol som ny interiör. Advokaten (nivå 63). Beslag av vapen enligt regel och återlämning vid frigivning. |
| P2 | AFK- och AI-stopp borta (F7, F8). |

**Berörda delar.**

| Del | Vad |
|---|---|
| `src/city/interiors-prison.js`, nytt domstolsrum, `render3d/room.js` | Inkoppling, 3D, spawn och utgång |
| `src/city/world.js` | `busted()`, interiörläget för `prison`, larm/upplopp/`lockCells`, brawl i fängelse |
| `src/features/stan.js`, `core.js`, `features.js` | Straffkedjan, Häktet-fliken som spegel av spelvärlden, borgen via lagret |
| `src/city/police.js` | Arrest och påföljd efter nivå (`arrestMeans`) |
| `authority.js`, `citynet.js`, `sync.js` | `Sanction`, klockan online, avräkning av frånkopplade |
| `docs/levels.md` | Rymnings-XP, Advokaten |

**Beroenden.** Etapp 2 (inventarium, transaktioner, progression) och tidsmodell Steg 4-5, som masterprompten anger. Beslut om straffens längd i speltid (9.7).

**Omfattning: 28-45 arbetsdagar, osäkerhet medel-hög.** Kåken som rum finns och är testad. Det nya är flödet, domstolen, tiden online och förstaperson-verifieringen av ett stort rum.

| Del | Dagar |
|---|---|
| Tidsmodell Steg 4 | 8-14 |
| Tidsmodell Steg 5 | 5-8 |
| Kåken inkopplad, förstaperson, aktiviteter | 8-12 |
| Rättegång och domstolsrum | 4-7 |
| Handel/besök/rymning, beslag och återlämning | 3-4 |

**Spelbart godkännandetest.**

1. Bli gripen på nivå 3 i stan. Spelet går till häkte (cell i förstaperson), sedan rättegång med dom i speltid.
2. Avtjäna i Kåken (äta, träna, spela basket, ta emot besök, ringa crewet) eller betala borgen via lagret. Frigivning vid porten.
3. Straffet går inte att kringgå via menyer, `Sov` eller tidshopp online. Häktet-fliken visar samma nedräkning som spelvärlden.
4. Sparade värden finns kvar efter frigivningen (beslag och återlämning enligt regel). Omladdning mitt i straffet återupptar det.
5. Rymningsförsök (tunnel) har ett definierat utfall.
6. Två klienter ser samma dom och samma klocka. Frånkoppling och återanslutning ändrar inte straffet.
7. Karriärvägledning och världstid fungerar efter frigivningen.

**Risker.** Online-tiden är den största nyheten (Steg 4). Kåkens 3D är ej verifierad. Rättegångens design (ska den vara spelbar eller en kort scen?) är ett ägarbeslut.

---

## Etapp 4: social värld, klubb och fler kapitel

**Mål.** Två klienter får samma utfall av inbjudan, träff och affär. Fria aktiviteter och karriär kan användas sida vid sida. Klubbeventet fungerar från inträde till belöning.

**Prioriterat innehåll.**

| Prio | Innehåll |
|---|---|
| P1 | **Verifierad multiplayer mellan riktiga enheter:** TURN (i dag bara STUN), olika nätverk, iOS och Android, 3-6 klienter, återanslutning, identitet vid anslutning (F15). |
| P1 | Utvecklad mobil: meddelanden (SMS finns), marknadsplats, gängträffar, **accepterade gängutmaningar** (PvP-status får inte kunna slås av efter ett angrepp). Inbjudan, träff och affär med samma utfall hos båda. |
| P1 | Klubbinteriör med **komplett event och minispel** (klubbens rum finns, minispelen är flikar i dag). |
| P2 | Fler kapitel när uppdragsmallen och grundloopen fungerar. Gängträffar. |
| P3 | Antydda intima möten (masterprompt 17) när kontakt- och interiörsystemen är stabila. |

**Berörda delar.** `phone.js`, `sms.js`, `citynet.js`, `sync.js` (TURN, återanslutning), `authority.js`, `missions.js` (kapitelmall och kontakter), `minigames.js` till klubbens rum, `interiors-biz-b.js` (`club`), `world.js`, `hud.js`, en testrigg för flera klienter.

**Beroenden.** Etapp 3. Stabila spelaridentiteter, positioner och tid. Verifierad multiplayer (masterprompt 20).

**Omfattning: 40-70 arbetsdagar, osäkerhet hög.** Nätverksdelen 10-18 d (inklusive TURN-drift och enhetstest), mobil/marknad/utmaningar 12-20, klubbevent 8-14, nytt kapitel 10-18.

**Spelbart godkännandetest.**

1. Två klienter på **olika nätverk** (en på mobildata): bjud in, acceptera, träffas på platsen och gör en affär. Samma utfall hos båda.
2. Fria aktiviteter och karriär pågår samtidigt för olika spelare i samma rum.
3. Klubbeventet från inträde till belöning, i förstaperson.
4. En gängutmaning accepteras av båda. PvP-läget går inte att slå av efter första slaget.
5. Marknadsplatsköp bekräftas av värden. Dubbelklick ger inget dubbelköp.
6. iPhone och Android Chrome klarar kedjan gata -> dörr -> rum -> gata -> fordon.

**Risker.** NAT utan TURN, iOS Safari och WebRTC i bakgrunden, PeerJS:s publika signalering som beroende. Ett nytt kapitel kan inte ligga före en fungerande uppdragsmall.

---

## Etapp 5: skala innehåll och testa spridning

**Mål.** Kapacitet, sparning och faktisk återkomst motiverar en större publik. Ange vad som återstår innan bred lansering.

**Prioriterat innehåll.**

| Prio | Innehåll |
|---|---|
| P1 | **Beslut om dedikerad server** (tidsmodell Steg 6) utifrån etapp 4:s data: samtidiga spelare, nätverk, värdbortfall. |
| P1 | Fördjupade bostäder, fler stadsdelar, uppdragskapitel mot nivå 100, fler sociala aktiviteter. Nivå 61-100 enligt kapitelbågen i masterprompten. |
| P1 | **Testbart demo** med representativa klipp. |
| P2 | Kapacitet: NPC-tak, strömning av världen, minnesbudget, ljudkällor. Sparning: kvot, flera enheter, serverlagring om servern införs. |
| P2 | Återkomst: mät D1 och D7 på en liten grupp. |

**Berörda delar.** `map.js` och `constants.js` (en större stad), `render3d/*` (strömning, prestanda), `world.js` (tak), `state.js` och sparväg, en server om den införs, verktyg för innehåll.

**Beroenden.** Etapp 4 och användardata.

**Omfattning: 60-120+ arbetsdagar, osäkerhet mycket hög.** Servern ensam är 15-30+ dagar. Innehåll mot nivå 100 är den stora okända.

**Spelbart godkännandetest.**

1. En 30-minuterssession på tre olika enheter, med mätning av bildfrekvens (p99, inte bara medel), minne och nätverk.
2. Hundra omladdningar och avbrott utan förlorade eller dubblerade värden.
3. En liten testgrupp spelar över flera dagar. Återkomst mäts, inte antas.
4. Skriftlig lista över **vad som återstår innan bred lansering** (ex. juridik, plattformsregler, moderering, åldersgräns, drift).

**Risker.** Att skala innan etapp 1:s användartest och etapp 4:s nätverksdata visat att grundloopen bär.

---

## 6. Tvärgående

| Område | Plan |
|---|---|
| Tester | Varje etapp lägger till enhetstester för ren logik och minst ett webbläsarskript för kedjan gata -> dörr -> rum -> gata -> fordon (A2:s `chain.cjs` är mallen). Flerklientstester med PeerJS körs som skript, inte i vitest. Lägg Playwright som utvecklingsberoende (finns inte i `package.json` i dag). |
| Prestanda | Mät på en riktig bärbar dator och en mellanklasstelefon varje etapp. Redovisa p99 och ryck, inte bara snitt. Fallback: ÖVERBLICK utan WebGL2 finns. |
| Sparfiler | Ingen etapp lägger fält utan `saveVersion`, standardvärden och en migrering med test mot en riktig gammal fil. |
| Dokumentation | Platsens rad i `forstaperson-checklista.md` uppdateras när platsen levereras. |
| Tillgänglighet | Separata ljudnivåer, textstorlek och kamerarörelse-val finns i etapp 1 (P3). |
