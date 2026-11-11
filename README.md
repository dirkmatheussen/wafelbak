# wafelbak

Humoristische en aantrekkelijke eventsite voor de **Vliegende Wafelbak** en het
**Belgisch Kampioenschap Eland Balken**.

## Lokaal draaien

```bash
python3 server.py
```

Open daarna:

`http://127.0.0.1:4173`

Inschrijvingen en gedeelde opnames worden bewaard in `.wafelbak/practice.sqlite3`.
Een sessiecookie koppelt de browser 30 dagen aan de inschrijving. Gedeelde opnames
zijn zichtbaar voor deelnemers met een geldige inschrijving.

Laat deelnemers voor gedeeld gebruik dezelfde server openen via HTTPS. Draai de
server achter de HTTPS-proxy van de besloten site met `--secure-cookie` en bewaar
de SQLite-database op een blijvend volume. Met `--db` kies je het bestandspad.

Terugkerende deelnemers voeren het e-mailadres van hun inschrijving in om
opnieuw te oefenen en opnames te beluisteren. De server controleert of het adres
geregistreerd is. Wie zo aanmeldt kan alleen opnames verwijderen die in de
huidige browsersessie zijn gedeeld.

## Tests

```bash
node --test tests/wafelbak.test.js
```

## Geluid

`assets/elandroep.wav` bevat 2,2 seconden uit
[Moose on the Daisy Farm Trail](https://www.nps.gov/isro/learn/wildlife-soundscape.htm),
een veldopname van de National Park Service in Isle Royale National Park.
