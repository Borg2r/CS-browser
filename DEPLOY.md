# Spill med venner over nettet

Spillerne trenger ingen konto. De åpner den samme HTTPS-lenken, skriver et
kallenavn og velger lag. Spillet er laget for datamaskin med tastatur og mus.
Én server har én felles kamp med opptil 10 spillere; boter fyller ledige plasser.
Lenken gir adgang til kampen, men er ikke et privat eller passordbeskyttet rom.

## Enkel hosting på Render

Kun den som eier serveren trenger en hostingkonto. Oppsettet ligger i
`render.yaml` på branchen `codex/playable-online`.

1. Logg inn på Render og velg **New → Blueprint**.
2. Koble til GitHub-repoet `Borg2r/CS-browser` og velg
   `codex/playable-online` som blueprint-branch. Gi Render lesetilgang til
   repoet hvis det er privat.
3. Kontroller oppsettet og opprett tjenesten. Docker bygger både spillserveren
   og WASM-klienten fra samme kode. Helsekontrollen bruker `/healthz`.
4. Når tjenesten er **Live**, åpner du HTTPS-adressen som Render viser.
   Trykk **Copy invite link** i spillmenyen og send lenken til vennene dine.

Blueprinten velger gratisplanen for utprøving. Gratis hosting kan sovne når
ingen bruker spillet; første besøk kan derfor ta tid. Kampen nullstilles ved
omstart eller ny utrulling. For en server som alltid er tilgjengelig, velg en
betalt plan som ikke går i dvale. Se aktuell pris hos Render før du bekrefter.
Behold **én instans**; flere instanser vil gi separate kamper.

Ingen API-nøkler eller innlogging skal legges inn i selve spillet. Render
ordner HTTPS, og klienten bruker automatisk sikker WebSocket (`wss://`).

## Andre verter / egen server

Docker-oppsettet kan kjøres hos andre verter som støtter langvarige prosesser
og WebSockets. Sett `PORT` hvis verten krever en annen port. Standard er 8080.

```sh
docker build -t breachpoint .
docker run -d --name breachpoint --restart unless-stopped \
  -p 127.0.0.1:8080:8080 -e TEAM_SIZE=5 breachpoint
```

På en VPS må en HTTPS-proxy peke til port 8080, inkludert WebSocket-ruten
`/ws`. Bindingen over er lokal med vilje: en offentlig reverse proxy skal
håndtere innkommende trafikk. Serveren lagrer ingen kontoer eller kampdata
på disk og trenger ingen database. Statisk hosting alene kan ikke kjøre den.

## Sjekk før deling

Med Node.js 22 eller nyere kan du teste den faktiske offentlige adressen:

```sh
node scripts/smoke.mjs https://ADRESSEN-FRA-VERTEN
```

Testen kobler til to gjestespillere uten innlogging og kontrollerer at de
deler kamp, mottar spilloppdateringer og kan sende chat til hverandre. Kjør
den helst før venner spiller, siden den bruker to plasser midlertidig.
Åpne også lenken i et privat nettleservindu og velg et lag.

Ved problemer: se serverloggene, sjekk `/healthz`, og kontroller at verten
tillater `/ws`. Klienten viser en feilmelding hvis spillmodulen ikke kan
lastes, og lagknappene aktiveres først når både spillet og serveren er klare.
