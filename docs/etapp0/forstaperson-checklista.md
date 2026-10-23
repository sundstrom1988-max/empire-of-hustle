# Förstapersonschecklista: varje besökbar plats och fordonstyp

Skrivet 2026-10-23 av spår D. Underlag: koden i arbetskopian (`HEAD d11c230` plus ocommittade ändringar från etapp 0), läst i `map.js`, `world.js` (`doors`, `specialDoors`, `enterInterior`, `enterPlace`, `updateInteractions`), `interiors.js`, `interiors-biz-a.js`, `interiors-biz-b.js`, `interiors-prison.js`, `vehicles.js`, `render3d/*`. Raderna beskriver vad koden är byggd för. **Status är "ej verifierad" överallt.** Slutverifieringen fyller i status, datum och vem som körde.

**Det här dokumentet är en checklista, inte ett resultat.** Ingen rad betyder att något fungerar i förstaperson. Det som redan körts av andra spår listas sist under "Underlag", och räknas inte som slutverifiering.

## 1. Så används checklistan

**Godkännande per plats** (masterprompt avsnitt 3 och 21). Gå in i förstaperson (läge FÖRSTAPERSON valt före dörren), orientera dig, gå runt, interagera med relevanta objekt, byt kamera (V/C, hjulet, nyp, kameraknappen på touch) och tillbaka, gå ut, återvänd. Kontrollera under tiden:

| Kontroll | Vad som ska gälla |
|---|---|
| Kollision | Man går inte genom väggar, möbler eller hus, fastnar inte i dörröppningen och ser inte genom väggen. |
| Position | In- och utgång lägger spelaren på en fri plats vid rätt dörr. Kamerabyte, meny och minispel flyttar inte figuren. |
| Blickriktning | W går dit man tittar, även efter flera hela varv. A/D är sidsteg. Blicken efter dörren är rimlig. |
| Kamerabyte | Dörr, dialog, uppdrag, meny, bil och omladdning byter aldrig läge. Spelarens eget byte är snabbt och ändrar inte räckvidder, träffregler eller interaktionsavstånd. |
| Utrustning | Händer, vapen, kläder och bilens instrument syns och stämmer med vad spelaren har. |
| Sparning | Köp, nivå och läge finns kvar efter omladdning på platsen. |
| Synk | Online syns spelaren på rätt plats för de andra (inomhus vid dörren på kartan). |

**Standardkontroller** som tabellerna hänvisar till:

| Kod | Vad som ska hända |
|---|---|
| **RUM-IN** | Till fots: gå in i dörrzonen (20 px) eller tryck E inom 46 px från dörren. Inte från bil (kliv ur först). Spelaren hamnar vid rummets `spawn` med blicken norrut, crewet följer med. Kameraläget är kvar. Är polisen efter dig och såg dig gå in väntar de utanför. |
| **RUM-UT** | Gå in i utgångsrutan (`exit`, radie 22 px) efter att ha gått en bit in (annars studsar man inte ut direkt). Spelaren står utanför dörren, vänd från huset. Läget är kvar. Zonen är låst tills man gått bort, så man går inte in igen på en gång. |
| **RUM-RÖR** | `footStep` och `collideInterior` (väggar, bord, soffor, bardiskar, hyllor är solida). Ögat får inte komma närmare ett hinder än spelarens radie. Uthållighet vid spring. |
| **MENY** | E vid en interaktionspunkt öppnar en modal. Pekarlåset släpps, världen pausar. När den stängs: samma läge, samma plats, och ett klick tar låset igen utan att slå eller skjuta. |
| **BRÅK** | Slag (Space eller vänsterklick) mot gäster drar igång ett barbråk. Inomhus dör man inte: man slängs ut och dörren är stängd en stund. Gäller alla rum utom Pang-Pelle. |

---

## 2. Utomhus och stadsfunktioner (10 rader)

| # | Plats | Typ | Hur man kommer in | Förstaperson in/ut | Rörelse/kollision | Interaktion | Kamerabyte | Status |
|---|---|---|---|---|---|---|---|---|
| 1 | **Gatunätet** (sex stadsdelar: Västerort, Centrum, Skogsbacken, Orten, Industrin, Hamnen) | Utomhus, 64x64 rutor | Startar vid HQ. Online har varje spelare egen startplats. | Läget från sparad inställning. Taxi och HEM-knappen byter aldrig läge. | Hus, vatten, träd och murar solida (`collideCircleWithMap`). Till fots 115 px/s, spring 175 (uthållighet). Bil: se fordonsavsnittet. | E (föremål, dörr, bil), R råna, Space/vänsterklick slå eller skjut, Q byt vapen, M karta, T telefon, 1-3 crew, H tuta | V/C, hjulet, nyp, kameraknappen | ej verifierad |
| 2 | **HQ och hemparkering** (spawn, 10 p-platser, ägda bilar, gängets bil eller HD) | Utomhus, plats | Spawn. Ägda bilar står parkerade här. | Ut: HEM-knappen eller "Åk hem" i pausmenyn. Esc släpper pekarlåset och ger pausmenyn i 3D (i ÖVERBLICK åker Esc hem). Spärrad med polisen efter dig. | Samma som gatan. | HEM, byta bil, ladda om | Läget kvar efter HEM och ny start | ej verifierad |
| 3 | **Langaren** (ryggsäcksikon, bakom HQ) | Interaktionspunkt, modal | Till fots, inom 36 px | Modal över spelet. Ingen rumsövergång. | Gatan | Köp 5 eller 10 varor (120 kr), stå still för att sälja. Max 10 per dag/runda. | Läget kvar | ej verifierad |
| 4 | **Rekryteraren** (gruppikon, vid HQ) | Interaktionspunkt, modal | Till fots, inom 34 px | Modal | Gatan | Anställ eller säg upp crew (tak 4, order 1/2/3) | Läget kvar | ej verifierad |
| 5 | **Gängens telefonkiosker** (6 st, en per turf) | Interaktionspunkt, modal | Inom 54 px, till fots eller i bil under 170 px/s | Modal | Gatan | Uppdrag (5 typer), gå med i gäng, lämna gäng, kvoten 3 per dag/runda | Läget kvar. Pågående uppdrag syns i 3D (pilar, mål, tid). | ej verifierad |
| 6 | **Lackverkstan** (färgburksikon, Orten och Skogsbacken) | Körzon | Kör in i bil under 280 px/s, inom 66 px | Ingen övergång. Automatisk lackering och reparation (150 kr + 200 per stjärna). | Bilfysik | Ny lack, rensar efterlysning | Läget kvar | ej verifierad |
| 7 | **Bilskroten** (skiftnyckelikon, Hamnen) | Körzon | Kör in under 280 px/s, inom 72 px | Ingen övergång. Automatisk försäljning av stulen bil. Nekas för egen bil eller uppdragsbil. | Bilfysik | Sälj bil (max 3 per dag/runda), polisbil ger brott | Läget kvar | ej verifierad |
| 8 | **Föremål på marken** (60 platser, 24 per pass) och vapen på marken | Utomhus, föremål | Gå över pickups (26 px, 36 i bil). Vapen: E. | Inget bytte. Online värd-validerat (70 px, inte inomhus). | Gatan | Cash, reparation, nitro, mutor, hälsa. Vapen med ammo. | Läget kvar. E-markeringen i 3D ska visa rätt mål. | ej verifierad |
| 9 | **Dejtzonen vid Nattklubben** (champagneikon, Centrum) | Körzon, minispel i bil | Bil, inom 70 px, under 220 px/s, klockan 20-05, ingen efterlysning | Ingen övergång. Passageraren är bara en text och en mål-pil. | Bilfysik | Kör henne hem utan krockar. +5 rykte, full hälsa, 3 timmar fram (`fade`). | Läget kvar | ej verifierad |
| 10 | **Uppdragsplatserna** (24 st: Torget, Banken, Gallerian, Hotell Royal, Perrongen ...) | Mål på kartan | Går inte att gå in på | Ingen rumsövergång. De är bara mål för leverans, upphämtning och VIP-skjuts. | Gatan | Uppdragets steg | Läget kvar | ej verifierad |

---

## 3. Interiörer som rum (11 rader)

Alla rum är 2D-rutnät om 32 px, ritade i 3D av `render3d/room.js` (golvtextur från rummets målning, möbler som lådor). Alla har RUM-IN, RUM-UT, RUM-RÖR och MENY enligt avsnitt 1. De tre sista kolumnerna anger vad som är särskilt för rummet.

| # | Plats | Typ | Hur man kommer in | Förstaperson in/ut | Rörelse/kollision | Interaktion | Kamerabyte | Status |
|---|---|---|---|---|---|---|---|---|
| 11 | **Mehmets Kebab** (Orten, id `kebab`, 18x14 rutor) | Företagsrum | Dörr 0 (till fots, 20 px / E) | RUM-IN, RUM-UT | RUM-RÖR. Disken, grillen och kylen är solida. | Disken ("E: köp stället, kassan, råna"): köp 500 kr, töm kassan (1 per dag/runda), råna, **Ät kebabtallrik** (60 kr, +40 hälsa, gratis för ägaren). BRÅK. | Spelarens val kvar inne | ej verifierad |
| 12 | **Frisören på hörnet** (Orten, `barber`, 18x13) | Företagsrum | Dörr 1 | RUM-IN, RUM-UT | RUM-RÖR | Disken: köp 1 200 kr, kassa, råna, **Ny frisyr** (300 kr, -2 stjärnor, inte om polisen såg dig gå in). BRÅK. | Kvar | ej verifierad |
| 13 | **Hustle Gym** (Västerort, `gym`, 20x15) | Företagsrum | Dörr 2 | RUM-IN, RUM-UT | RUM-RÖR | Receptionen: köp 3 000 kr, kassa, råna, **Träna** (250 kr, gratis för ägaren, +1 styrka och +10 max- och aktuell hälsa, 1 per dag/runda, styrka max 5). BRÅK. | Kvar | ej verifierad |
| 14 | **Beat Studio** (Industrin, `studio`, 22x15) | Företagsrum | Dörr 3 | RUM-IN, RUM-UT | RUM-RÖR | Receptionen: köp 5 000 kr, kassa, råna, **Spela in disslåt** (400 kr, +3 rykte, 1 per dag/runda). BRÅK. | Kvar | ej verifierad |
| 15 | **Nattklubben VIP** (Centrum, `club`, 24x16), via företagsdörren | Företagsrum, musik | Dörr 4 | RUM-IN, RUM-UT. Musik inne ("Diamant"). | RUM-RÖR | Kassan ("inträde, ägande, intäkter"): köp 12 000 kr, kassa, råna, **VIP-bord** (1 000 kr, +40 hälsa, +2 rykte, 1 per dag/runda). BRÅK. | Kvar | ej verifierad |
| 16 | **Nattklubbens entré** (champagneikon, Centrum), samma rum som rad 15 | Annan väg in | Till fots, 26 px från markören (trappan, `club-foot`), eller E | RUM-IN, men `kind: nightclub`. Utgången leder ut vid nattklubbens entré, inte vid företagsdörren. | RUM-RÖR | Samma kassa och tjänster som rad 15. Dejten kräver bil (rad 9) och klockan 20-05. Rummet har ingen öppettidskontroll vid inträde (kundflödet följer klockan). Menyvarianten, som används om rummet saknas, är stängd före 20:00. | Kvar | ej verifierad |
| 17 | **KimIT Tech AB** (Centrum, `tech`, 24x16) | Företagsrum | Dörr 5 | RUM-IN, RUM-UT | RUM-RÖR | Receptionen: köp 25 000 kr, kassa, råna, **Hacka polisens register** (2 000 kr, rensar efterlysningen). BRÅK. | Kvar | ej verifierad |
| 18 | **Skyskrapan** (Centrum, `tower`, 26x16) | Företagsrum | Dörr 6 | RUM-IN, RUM-UT | RUM-RÖR | Receptionen ("hyra, ägande, intäkter"): köp 60 000 kr, kassa, råna. Ingen tjänst. BRÅK. | Kvar | ej verifierad |
| 19 | **RocketFuel Industries** (Hamnen, `rocket`, 26x16) | Företagsrum | Dörr 7 | RUM-IN, RUM-UT | RUM-RÖR | Försäljningen: köp 150 000 kr, kassa, råna. Ingen tjänst. BRÅK. | Kvar | ej verifierad |
| 20 | **Club Diamant** (Hamnen, `stripclub`, 30x22) | Specialrum, musik | Specialdörr (20 px / E), neonskylt | RUM-IN, RUM-UT. Musik inne. | RUM-RÖR. Scen, catwalk, bar, VIP och kontor. Vakten släpper inte in utslängda en stund. | Bartendern (drink 150 kr), vakten (anställ livvakt 3 500 kr), managern (köp eller ta över klubben, **värd-validerat online**), scenen (regna sedlar 300 kr). Crewet vilar i VIP om man äger. BRÅK. | Kvar | ej verifierad |
| 21 | **Pang-Pelles Vapen** (Industrin, `gunshop`, 16x12) | Specialrum | Specialdörr (20 px / E) | RUM-IN, RUM-UT | RUM-RÖR. Vapenväggen och montrarna är solida. | Pang-Pelle vid disken: köp vapen och ammo, skyddsväst (800 kr). **Inga bråk** (`NO_BRAWL`). | Kvar | ej verifierad |

---

## 4. Menyplatser utan rum (8 rader)

Dessa öppnar en modal vid dörren (`enterPlace`). Det finns inget rum att gå omkring i. Masterprompten kräver fysiskt besökbara platser, så de är **kända luckor**. Planen för dem finns i `plan.md` avsnitt 3.

| # | Plats | Typ | Hur man kommer in | Förstaperson in/ut | Rörelse/kollision | Interaktion | Kamerabyte | Status |
|---|---|---|---|---|---|---|---|---|
| 22 | **Stadsbanken** (Centrum) | Menyplats | Dörr (20 px / E) | Modal vid dörren, ingen övergång. Går bort via "Gå ut". | Ingen (man står kvar utanför i världen) | Råna banken (kräver laddat skjutvapen, 3 000-8 000 kr x (1 + 0,05 x runda), larm nivå 3, 1 per dag/runda) | Läget kvar | ej verifierad |
| 23 | **Lägenheten i Orten** (gömställe, 9 000 kr) | Menyplats | Dörr | Modal | Ingen | Köp. Ägd: vila, vänta ut snuten ("Ingen såg dig gå in"). | Läget kvar | ej verifierad |
| 24 | **Radhuset i Västerort** (14 000 kr) | Menyplats | Dörr | Modal | Ingen | Som rad 23 | Läget kvar | ej verifierad |
| 25 | **Loftet i Industrin** (12 000 kr) | Menyplats | Dörr | Modal | Ingen | Som rad 23 | Läget kvar | ej verifierad |
| 26 | **Takvåningen i Centrum** (30 000 kr) | Menyplats | Dörr | Modal | Ingen | Som rad 23 | Läget kvar | ej verifierad |
| 27 | **Villan i Skogsbacken** (24 000 kr) | Menyplats | Dörr | Modal | Ingen | Som rad 23 | Läget kvar | ej verifierad |
| 28 | **Sjöboden i Hamnen** (11 000 kr) | Menyplats | Dörr | Modal | Ingen | Som rad 23 | Läget kvar | ej verifierad |
| 29 | **Gömställets garage** (ägda hus, alla sex) | Körzon + meny | Kör in i bil under 220 px/s, inom 52 px | Bilen står stilla, modal | Bilfysik fram till dörren | Laga bilen, vila, vänta ut snuten, kör ut | Läget kvar | ej verifierad |

---

## 5. Paneler och overlays (8 rader)

Får ligga ovanpå spelvyn men får inte ersätta en plats som ska vara fysiskt besökbar. Kontrollera att de inte ändrar kameraläge, position eller tillstånd, och att fokus och pekarlås återställs.

| # | Panel | Typ | Hur man kommer in | Förstaperson in/ut | Rörelse/kollision | Interaktion | Kamerabyte | Status |
|---|---|---|---|---|---|---|---|---|
| 30 | **Telefonen i stan** | Modal | T eller telefonknappen | Pausar världen, släpper pekarlåset, tillbaka med samma läge | Ingen | SMS (online), doktorn, taxi, polisraden, crew-order 1/2/3 | Läget kvar | ej verifierad |
| 31 | **SMS-appen** | DOM-overlay | Telefonen, "SMS till andra spelare" | Pekarlåset släpps. Skrivande styr inte gubben. | Ingen | Skicka och ta emot SMS med kvitto, blockera | Läget kvar | ej verifierad |
| 32 | **Imperiets flikar**: Imperium, Stan, Pitch, Events, Butik, Stats, Chatt | DOM (hemskärmen, inte i stan) | Flikfältet | Stan är stängd. Flikarna är inte en plats. | Ingen | Köp, uppgradera, stash, pitch, tärning | Kameravalet bevaras till nästa stan (localStorage) | ej verifierad |
| 33 | **Svarta marknaden** (flik) | DOM, ingen plats | Fliken | Som rad 32 | Ingen | Åtta affärer med risk, max 2 per dag/runda | Som rad 32 | ej verifierad |
| 34 | **Häktet** (flik) | DOM, ingen plats | Fliken. Stan spärrad medan man sitter. | Som rad 32 | Ingen | Borgen, brottsregister, rundor kvar | Som rad 32 | ej verifierad |
| 35 | **Garage** (flik) | DOM, ingen plats | Fliken | Som rad 32 | Ingen | Köp av 6 bilar, pimp i tre steg, inkomstbonus | Som rad 32 | ej verifierad |
| 36 | **Minispel** (flik: tärningsduell, gissa talet, slots, slantsingling) | DOM, ingen plats | Fliken | Som rad 32. Efter minispel: samma läge, ingen flyttad figur. | Ingen | Insats och utfall | Som rad 32 | ej verifierad |
| 37 | **Imperiets telefon** (HustleOS, SMS, Deals, Gärri, Plånbok, Status) | DOM | Telefonknappen på hemskärmen | Som rad 32 | Ingen | Deals, bilköp, plånbok | Som rad 32 | ej verifierad |

---

## 6. Ej inkopplat eller ej byggt (6 rader)

| # | Plats | Läge i koden | Hur man kommer in | Förstaperson in/ut | Rörelse/kollision | Interaktion | Kamerabyte | Status | Leveransetapp |
|---|---|---|---|---|---|---|---|---|---|
| 38 | **Kåken** (celler, korridor, vaktrum, matsal, rastgård, gym, vakttorn, besöksrum, direktör, port) | Modul `interiors-prison.js` (32x24), 18 tester, **importeras inte av spelet** | Finns ingen dörr. Inget BUSTED-flöde leder dit. | 3D-stöd för rummets egna möbeltecken är **inte verifierat** | Finns i modulen (`collideInterior`) | Borgen, direktör, träna, langare, tunnel, telefon, vakt | | ej verifierad | 3 |
| 39 | **Domstol** | Finns inte | | | | | | ej verifierad (ej byggd) | 3 |
| 40 | **Garage-showroom, bilhandlare, verkstad** | Finns inte som plats (Garage är en flik, Lackverkstan en körzon) | | | | | | ej verifierad (ej byggd) | 2 |
| 41 | **Startboende, lägenhet, hyrt rum, crew-lokal** | Finns inte som rum (gömställena är menyer) | | | | | | ej verifierad (ej byggd) | 1-2 |
| 42 | **Klädbutik** | Finns inte | | | | | | ej verifierad (ej byggd) | 2 |
| 43 | **Eventlokal med minispel** | Klubbens rum finns, eventet och minispelet i rummet finns inte | | | | | | ej verifierad (ej byggd) | 4 |

---

## 7. Fordonstyper (15 rader)

Alla fordon ritas i FÖRSTAPERSON från förarplatsen: **bil** (`kind: car`) med instrumentbräda, ratt, huv, stolpar och backspegel (ögonhöjd 16), **cykel, moped och HD** (`kind: bike`) med styre (ögonhöjd 27). Fri blick vrider bara bilden (musen eller fingret) och styr aldrig fordonet. Enligt A2 fjädrar den tillbaka efter ca 1,2 s. Det finns **inga passagerare** och inga fler sittplatser.

| # | Fordon (id) | Typ och värden | Hur man får eller kommer in | Förstaperson in/ut | Rörelse/kollision | Interaktion | Kamerabyte | Status |
|---|---|---|---|---|---|---|---|---|
| F1 | **Cykel** (`cykel`) | Cykel. 250 px/s, accel 320, hp 40, massa 0,35 | Garage (300 kr). Står vid HQ. E inom 38 px. | E in och ut, styre, ut på giltig plats | Karta, fordon, folk (påkörning). Lätt. | Radio (R) och tuta (H) enligt koden för alla fordon. Cykelns ljud (`engine: 0`) ska kontrolleras. | Läget kvar | ej verifierad |
| F2 | **Moped EPA** (`moped`) | Moped. 310 px/s, hp 60 | Garage (1 500 kr). Även i trafik i Västerort, Orten. | Som F1 | Som F1 | Radio (R), tuta | Läget kvar | ej verifierad |
| F3 | **Volvo 240 / Morsans Volvo** (`volvo`) | Bil. 350 px/s, accel 240, hp 100. **Startbilen** (alla börjar med den). | Står vid HQ för alla. Vanligast i trafiken. | E in och ut, instrumentbräda och ratt | Karta, fordon, folk | Radio, tuta, handbroms | Läget kvar | ej verifierad |
| F4 | **Taxi** (`taxi`) | Bil. 360 px/s, gul | Trafik (Centrum mest). Carjack. | Som F3 | Som F3 | Som F3. Föraren slängs ut och gör ett brott. | Läget kvar | ej verifierad |
| F5 | **Skåpbil** (`van`) | Bil. 300 px/s, hp 160, massa 1,7, längd 54 | Trafik (Industrin, Hamnen mest). Carjack. | Som F3 | Som F3 (större, tyngre) | Som F3 | Läget kvar | ej verifierad |
| F6 | **BMW E46** (`bmw`) | Bil. 430 px/s, accel 340 | Garage (5 000 kr). Trafik. Uppdraget "Bilstöld". | Som F3 | Som F3 | Som F3. Pimp ger +5 % topp och +7 % acceleration per steg. | Läget kvar | ej verifierad |
| F7 | **Audi RS6** (`audi`) | Bil. 455 px/s, accel 375 | Trafik. Carjack. Ej i Garaget. | Som F3 | Som F3 | Som F3 | Läget kvar | ej verifierad |
| F8 | **HD Chopper** (`hd`) | Cykel (`chopper`). 410 px/s, accel 380 | Egen hoj vid HQ för medlem i ett MC-gäng. Annars jagande opps och mål i uppdraget "Krossa rivalerna". Carjack ger -5 respekt hos gänget. | E in och ut, styre | Som F1 | Radio, tuta | Läget kvar | ej verifierad |
| F9 | **Mercedes AMG** (`mercedes`) | Bil. 470 px/s, hp 140 | Garage (15 000 kr). Trafik. | Som F3 | Som F3 | Som F3 | Läget kvar | ej verifierad |
| F10 | **Lamborghini** (`lambo`) | Bil, sport. 590 px/s, accel 490 | Garage (50 000 kr). Sällsynt i trafik. | Som F3 | Som F3 | Som F3 | Läget kvar | ej verifierad |
| F11 | **Rolls Royce** (`rolls`) | Bil. 450 px/s, hp 230, massa 1,9, längd 56 | Garage (100 000 kr). Sällsynt i trafik. | Som F3 | Som F3 | Som F3 | Läget kvar | ej verifierad |
| F12 | **Snutbil** (`police`) | Bil, siren. 460 px/s, hp 170 | Går att stjäla (`stealCop`, stort brott). Polisens jakt, stopp och sökning. | Som F3. Sirenen hörs. | Som F3 | Som F3. Att ta en polisbil är ett brott som höjer polisens nivå. | Läget kvar | ej verifierad |
| F13 | **Maffia-BMW** (`gang_kebab`) | Bil, Kebabmaffian. 420 px/s | Egen bil vid HQ för medlem. Annars jagande opps och mål i "Krossa rivalerna". Carjack ger -5 respekt hos gänget. | Som F3 | Som F3 | Som F3 | Läget kvar | ej verifierad |
| F14 | **Mörk Limousin** (`gang_orden`) | Bil, Mörka Orden. 420 px/s, längd 52 | Som F13 | Som F3 | Som F3 | Som F3 | Läget kvar | ej verifierad |
| F15 | **Lowrider** (`gang_taco`) | Bil, Tacokartellen. 410 px/s | Som F13 | Som F3 | Som F3 | Som F3 | Läget kvar | ej verifierad |

**Gemensamt för alla fordon** (kontrolleras på minst en bil och en tvåhjuling, och på startbilen vid varje kameraläge):

| Kontroll | Vad som ska gälla | Status |
|---|---|---|
| In och ut | E inom 38 px, samma ordning som E-tipset (föremål, dörr, bil). Avstigning på en giltig, fri plats (`exitSpot`), blick som bilens. Ingen fri plats: man stannar i bilen med besked. Ett brinnande vrak släpper alltid ut. | ej verifierad |
| Styrning | W gas, S broms och back när bilen nästan står, A/D sväng utan sidsteg, Space handbroms. Musens blick styr inte färdriktningen. Joystick på touch kör dit man drar. | ej verifierad |
| Fysik i alla lägen | Samma hastighet, kollision, skada och uppgradering i FÖRSTAPERSON, FÖLJKAMERA och ÖVERBLICK. Byte under körning ändrar inget. | ej verifierad |
| Skada och brand | Skada per kontakt (inte per bildruta), brand och explosion, vraket i förstaperson. | ej verifierad |
| Radio och tuta | R byter kanal (till fots betyder R rån), H tutar. | ej verifierad |
| Polisen | Mindre krock ger trafikstopp, inte klunga. Flykt är möjlig på låg nivå. Se `nulage.md` F1. | ej verifierad |
| Passagerare | Saknas. En bestämd sittplats för NPC eller annan spelare är ett senare krav (etapp 2 och 4). | ej verifierad (ej byggd) |
| Hus-garage och Lackverkstan | Körs in i bil, ingen övergång till rum. | ej verifierad |

---

## 8. Underlag som redan finns (inte slutverifiering)

Det här är körningar som andra spår gjort. De ger en fingervisning om vad som sannolikt fungerar, men raderna ovan förblir **ej verifierade** tills slutverifieringen kört dem.

| Skript (spår A2, `scratchpad/etapp0/A2/`) | Resultatfil | Vad det visar |
|---|---|---|
| `chain.cjs` | `c-results.json` (29 av 29 ok) | Förstaperson: gata, mot dörren med musen, E in i **Mehmets Kebab**, disken, menyn och tillbaka, ut, E in i **Volvon**, kör, fri blick, ut. Spelet byter aldrig läge självt. |
| `club.cjs` | `k-results.json` (10 av 10) | **Club Diamant** i förstaperson och följkamera, baren, bartendern. |
| `mobile.cjs` | `m-results.json` (24 av 24) | Mobil 390x844: joystick, look-finger, nyp mellan lägena, E-knappen in i kebaben, disken. |
| `mobilecar.cjs` | `mc-results.json` (9 av 9) | Mobil: in i bilen i förstaperson, fri blick, följkamera, ur. |
| `dirtest.cjs` | `d-results.json` (39 av 39) | Blickriktning efter 2-8 hela varv, W/S/A/D, kamerabyte ändrar inte position eller blick. |
| `fallback.cjs` | `f-results.json` (9 av 9) | Utan WebGL2: ÖVERBLICK med besked, valet sparas inte. |
| `misc.cjs` | `x-results.json` (16 av 16) | Pausmeny, inställningar, omladdning bevarar läget. |

Alltså: **Kebaben, Club Diamant och startbilen** har körts i förstaperson av spår A2. Ingen annan rad har körts.

## 9. Så kör man checklistan

- Starta dev-server utan HMR: `cd /home/user/empire-of-hustle && npx vite --config <scratchpad>/etapp0/vite.nohmr.config.mjs --port <port> --strictPort` (scratchpad = `/tmp/claude-0/-home-user-empire-of-hustle/a5ab78d5-7ccb-5b2f-9c97-cf55acd2a25c/scratchpad`).
- Chromium: `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`. Node-skript med `NODE_PATH=$(npm root -g)`.
- Starta stan: klicka `.char-card >> nth=1`, `#btn-start`, kör `window.game.goToCity()`, klicka `.city-go[data-act="start"]`. Sätt läge i förväg med `localStorage.setItem('hustle_city_cam', 'fps')`.
- Dev-krokar: `window.__stan()` ger `{ world, renderer, input, ... }`, `window.__gs` ger `gameState`.
- Platsernas lägen: `world.city.markers` har `home`, `dealer`, `recruit`, `phones[i]`, `sprays[i]`, `fence`, `club`, `guns`, `stripclub`, `bank`, `houses[i]`, `businesses[slot]` (dörrar i `.door`). Att ställa spelaren vid dörren och sedan **gå in med riktig input** (musen, W, E) räknas som verifiering. Att anropa `enterInterior()` direkt räknas inte, det prövar bara att rummet går att ladda.
- Online: `reconnect-d.cjs`-flödet (två flikar) för synk av position inomhus (`r.in`, dörrens `ox`/`oy`).
