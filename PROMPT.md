# Prompts voor je AI-assistent

Gebruik deze prompts in een assistent die met MCP AI Bridge is verbonden, zoals Claude Desktop of Claude Code op een computer in hetzelfde netwerk als je Homey. Open de assistent in deze map, zodat hij `dist/homey-dashboard.html` kan lezen.

De sleutel waarmee de assistent verbonden is, moet dashboards mogen schrijven. Dat is permissie **Control and change** of hoger.

---

## 1. Dashboard op de bridge zetten

```text
Je bent via MCP AI Bridge verbonden met mijn Homey Pro. Zet het bestand
dist/homey-dashboard.html uit deze map als eigen HTML-dashboard op de bridge.

1. Zoek de tool van MCP AI Bridge waarmee je een dashboard opslaat dat de bridge
   zelf serveert op http://<homey-ip>:52199/dashboard. Dus niet de
   homey_dashboards_* tools; die zijn voor de dashboards in de Homey-app.
2. Lees de beschrijving en het invoerschema van die tool en kies de HTML-modus,
   niet de gestructureerde config-modus.
3. Neem de HTML ongewijzigd over, byte voor byte. Vervang alleen de inhoud van
   <script type="application/json" id="hd-config">{}</script> door
   {"endpoint":"/mcp","homeName":"Thuis"}.
4. Noem het dashboard "thuis" en maak het het standaarddashboard.
5. Vertel me op welke URL het draait. Zegt de toolbeschrijving dat scripts in
   een HTML-dashboard worden geblokkeerd? Meld dat dan en stop. Dan gebruik ik
   prompt 2.
```

Daarna open je `http://<homey-ip>:52199/dashboard/thuis` en vul je onder **Instellingen** een API-sleutel met permissie **Control only** in. Die sleutel blijft in die browser.

---

## 2. Plan B: hetzelfde dashboard in de gestructureerde modus van de bridge

Gebruik dit als de bridge geen scripts toestaat in een HTML-dashboard. De bridge tekent het dashboard dan zelf, met zijn eigen bediening, in dezelfde indeling.

```text
Bouw met de dashboard-tool van MCP AI Bridge, in de gestructureerde config-modus,
een dashboard "thuis" met ALLE apparaten van mijn Homey, ingedeeld per categorie.

Haal eerst de echte lijst op (alle pagina's, ook onbereikbare apparaten) en de
ruimtes. Maak één tab per categorie, in deze volgorde, en laat lege tabs weg:

- Verlichting: klasse light, of een apparaat met dim of light_hue
- Klimaat: thermostat, heater, radiator, airconditioning, fan, airpurifier,
  dehumidifier, humidifier, boiler, heatpump, fireplace, waterheater, plus sensoren
  die vooral temperatuur, luchtvochtigheid of CO2 meten
- Stekkers & schakelaars: socket, button, remote, en overige apparaten met alleen onoff
- Zonwering & gordijnen: windowcoverings, blinds, curtain, sunshade, shutterblinds, awning
- Media: speaker, tv, amplifier, mediaplayer, settopbox, gameconsole
- Beveiliging: lock, homealarm, camera, doorbell, smokealarm, garagedoor, en sensoren
  met alarm_smoke, alarm_co of alarm_heat
- Sensoren: bewegings-, deur/raam-, water- en trillingssensoren
- Energie: solarpanel, battery, evcharger, de slimme meter, gas- en watermeters
- Huishouden: wasmachine, droger, vaatwasser, stofzuiger, oven, koffiemachine,
  koelkast, grasmaaier en andere apparaten
- Overig: alles wat nergens anders past

Regels:
- Elk apparaat staat er precies één keer in. Sla niets over.
- Sorteer binnen een tab op ruimte en dan op naam, en zet de ruimte bij elk apparaat.
- Geef elk apparaat de bediening die bij zijn capabilities past: aan/uit, een
  dimmer, een thermostaat met doeltemperatuur, een schuif voor rolluiken, play,
  pauze en volume voor media, vergrendelen voor sloten.
- Begin met een overzichtskaart: hoeveel lampen aan, gemiddelde binnentemperatuur,
  actueel verbruik van de slimme meter en de opwek van de zonnepanelen.
- Voeg kaarten toe die alleen verschijnen als er iets is: een open deur of raam,
  een actief alarm, een batterij onder 15% of een apparaat dat niet bereikbaar is.
- Zet de sferen (moods) als knoppen bovenaan.

Tel daarna na: het aantal apparaten op het dashboard moet gelijk zijn aan het
aantal apparaten in Homey. Noem de URL en meld elk verschil.
```

---

## 3. Controleren wat het dashboard ziet

```text
Gebruik MCP AI Bridge om te controleren of mijn dashboard compleet is:
1. Hoeveel apparaten heeft mijn Homey, per Homey-klasse?
2. Welke apparaten zijn onbereikbaar of hebben een batterij onder 15%?
3. Welke tools krijgt de API-sleutel met de naam "dashboard" te zien, en zitten
   daar een tool bij om apparaten op te halen, een capability te zetten, ruimtes
   op te halen en sferen aan te zetten?
```
