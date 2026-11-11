# wafelbak

Humoristische en aantrekkelijke eventsite voor de **Vliegende Wafelbak** en het
**Belgisch Kampioenschap Eland Balken**.

## Lokaal draaien

```bash
npm install
npm start
```

Open daarna `http://127.0.0.1:4173`.

Zonder `DATABASE_URL` gebruikt de server in-memory PGlite (sample data). Met
Postgres (lokaal of via Cursor Apps) zet je:

```bash
export DATABASE_URL='postgresql://USER:PASSWORD@127.0.0.1:5432/wafelbak'
npm run build   # past migrations/*.sql toe
npm start
```

Cursor Apps voorziet `DATABASE_URL` automatisch via `cursor-app.json` en draait
`npm run build` vóór de deploy.

Een sessiecookie koppelt de browser 30 dagen aan de inschrijving. Gedeelde
opnames zijn zichtbaar voor deelnemers met een geldige inschrijving.

Bij inschrijving kies je een wachtwoord. Terugkerende deelnemers melden zich aan
met e-mailadres én wachtwoord. Wie zo aanmeldt kan alleen opnames verwijderen
die in de huidige browsersessie zijn gedeeld.

Er geldt een maximum van **100 inschrijvingen** en **3 gedeelde opnames per
deelnemer**. Inschrijven en aanmelden zijn rate-limited. Sessietokens worden
als SHA-256-hash bewaard. Deelnemers kunnen hun inschrijving zelf verwijderen.

## Tests

```bash
npm test
```

## Geluid

`assets/elandroep.wav` bevat 2,2 seconden uit
[Moose on the Daisy Farm Trail](https://www.nps.gov/isro/learn/wildlife-soundscape.htm),
een veldopname van de National Park Service in Isle Royale National Park.
