# wafelbak

Humoristische en aantrekkelijke eventsite voor de **Vliegende Wafelbak** en het
**Belgisch Kampioenschap Eland Balken**.

## Lokaal draaien

Gebruik Postgres via `DATABASE_URL`:

```bash
python3 -m pip install -r requirements.txt
export DATABASE_URL='postgresql://wafelbak:wafelbak@127.0.0.1:5432/wafelbak'
python3 server.py
```

Open daarna:

`http://127.0.0.1:4173`

Inschrijvingen en gedeelde opnames worden bewaard in Postgres. Bij start past de
server de SQL-bestanden in `migrations/` toe. Cursor Apps voorziet
`DATABASE_URL` automatisch via `cursor-app.json`.

Een sessiecookie koppelt de browser 30 dagen aan de inschrijving. Gedeelde
opnames zijn zichtbaar voor deelnemers met een geldige inschrijving.

Laat deelnemers voor gedeeld gebruik dezelfde server openen via HTTPS. Draai de
server achter een HTTPS-proxy met `--secure-cookie`.

Bij inschrijving kies je een wachtwoord. Terugkerende deelnemers melden zich aan
met e-mailadres én wachtwoord. Wie zo aanmeldt kan alleen opnames verwijderen
die in de huidige browsersessie zijn gedeeld.

Er geldt een maximum van **100 inschrijvingen** en **3 gedeelde opnames per
deelnemer**.

## Tests

```bash
node --test tests/wafelbak.test.js
```

## Geluid

`assets/elandroep.wav` bevat 2,2 seconden uit
[Moose on the Daisy Farm Trail](https://www.nps.gov/isro/learn/wildlife-soundscape.htm),
een veldopname van de National Park Service in Isle Royale National Park.
