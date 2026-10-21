# Empire of Hustle — "Stan" (GTA1/GTA2-läge) + stabilitet

Datum: 2026-10-21

## Mål

1. Gör spelet stabilare: fixa kraschande knappar, felaktig autosparning, trasig online-lobby och beroenden till externa ljudfiler.
2. Gör spelet episkt i GTA1/GTA2-stil: ett fritt top-down-läge där du kör runt i en stad, snor bilar, gör gänguppdrag och flyr från snuten — kopplat till spelets ekonomi.

## Valt angreppssätt

Tre alternativ övervägdes:

- **A. Bara ny grafik (CSS-reskin).** Billigt men inte GTA.
- **B. Nytt canvas-läge "Stan" som integreras med befintlig ekonomi + GTA-reskin av UI:t.** ← valt
- **C. Skriv om allt som en GTA-klon.** Slänger allt som redan finns.

B behåller turordningsspelet (imperium, butik, svarta marknaden, häktet) och lägger till en fri stad som påverkar samma pengar, rykte och häkte.

## Stan — spelmekanik

- **Karta:** 64×64 rutor à 64 px, seedad generering. Ringväg runt kanten, rutnät av tvåfiliga gator (högertrafik), trottoarer, kvarter med hus, parker med träd, vatten i söder/öster.
- **Distrikt och gäng (GTA2-respekt):**
  - Orten (väst) — 🥙 Kebabmaffian
  - Centrum (nordost) — 🧙 Mörka Orden
  - Hamnen (sydost) — 🌮 Tacokartellen
  - Respekt −100…100 per gäng. Uppdrag för ett gäng ger +respekt hos det och −respekt hos rivalerna. Låg respekt (≤ −25) gör gängets bilar fientliga och stänger deras telefon.
- **Grafik:** GTA2-perspektiv där hustak skalas ut från kamerans mitt så husen ser 3D ut. Kameran zoomar ut med farten. Dag/natt-cykel med strålkastare, gatlampor och blåljus.
- **Spelaren:** går till fots eller kör. E/Enter = in/ur bil (snor bilen om någon sitter i). Ägda bilar från garaget står parkerade vid Högkvarteret.
- **Fordon:** cykel, moped, BMW, Mercedes, Lambo, Rolls (spelarens), plus Volvo, taxi, skåpbil, snutbil och gängbilar. Pimp-nivåer ger mer fart och tålighet.
- **Efterlyst (1–5 snutar):** brott höjer nivån, den sjunker när ingen snut är nära. Fler och snabbare snutbilar jagar via flödesfält (BFS) på gatunätet.
  - **BUSTED:** stå still nära snut → häktet i huvudspelet + böter.
  - **WASTED:** bilen exploderar med dig i, eller du blir överkörd → sjukhusräkning, tillbaka till imperiet.
- **Telefonkiosker (☎️):** en per gäng. Uppdragstyper: leverans, stöld av bil, fly från snuten, krossa rivalbilar, VIP-skjuts. Max 3 uppdrag per runda.
- **Platser:** Lackverkstan (rensar efterlysning, reparerar), Bilskroten (sälj snodda bilar, max 3 per runda), dina företag (hämta ut kassan en gång per runda).
- **Pickups:** 💰 cash, 🔧 reparation, ⚡ nitro, 👮 mutning, ❤️ hälsa. Nya varje runda.
- **Radio (GTA-stil):** procedurellt syntad musik i bilen, tre kanaler, byt med R.
- **Hem:** du kan bara åka hem (Esc / 🏠) när ingen snut är efter dig.
- **Kontroller:** WASD/pilar, Space = handbroms, E = in/ur, R = radio, H = tuta, Esc = hem. Touchknappar på mobil.

## Integration med huvudspelet

- Pengar i stan = spelarens pengar. Respekt, uppdrag per runda, sålda bilar och tagna pickups sparas på spelaren.
- Ny flik "🗺️ Stan" med statuskort och knapp "ÅK UT PÅ STAN". Spärrad i häktet, under AI:ns tur och när det inte är din tur online.
- Rundbaserade gränser nollställs i `endTurn`.

## Stabilitet

- Exponera `sellBiz`, `confirmSellBiz`, `showStashModal`, `doStash` på `window.game`.
- Autosparning skriver till rätt konto (`gameState.accountKey`).
- Gamla sparfiler migreras med standardvärden för nya fält.
- AI-turen låser input; spelet slutar efter vinst (inga fler AI-turer).
- Borgen bestäms när man åker in, inte vid varje rendering.
- Chatt och SMS escapas (ingen trasig HTML/XSS).
- Online: värden lägger till spelare som går med, lobbyn uppdateras, matchstart raderar inte spelare, värden vidarebefordrar state, lokala ljudinställningar synkas inte, du kan bara agera på din tur.
- Ljud och musik genereras med Web Audio i stället för hotlänkade MP3:or.
- Spelloopen i Stan har fast tidssteg, pausar när fliken är dold och fångar fel per frame.

## Testning

- Vitest-enhetstester för ren logik: kartgenerering (deterministisk, sammanhängande gatunät), fysik (inga NaN, hastighetstak, kollision), efterlysning, uppdrag/respekt, sparmigrering, HTML-escape, online-sammanslagning.
- Röktest i headless Chromium: starta spelet, åk ut på stan, kör runt, inga sidfel, skärmdumpar.
