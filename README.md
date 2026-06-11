# Auto Taxatie (Car Valuator)

Een database-app voor voertuigen: voer een kenteken in, de app haalt automatisch
de RDW-gegevens op en geeft op verzoek een indicatie van de **marktwaarde**
(vergelijkbare advertenties) én de **liquidatiewaarde** (veilingresultaten) via
Claude met live websearch.

## Wat het doet

- **Invoer** — kenteken intypen (of handmatig merk/model/bouwjaar voor niet-NL voertuigen).
- **RDW** — merk, model, uitvoering, bouwjaar, brandstof, APK-vervaldatum, catalogusprijs en massa worden direct opgehaald via de gratis, openbare RDW Open Data API.
- **Kilometerstand** — handmatig invoerbaar per auto. Laat je het leeg, dan wordt de stand geschat op basis van CBS-cijfers (verslagjaar 2024) per voertuigsoort, brandstof en leeftijd.
- **Waardering** — knop "Waarde bepalen": Claude zoekt met websearch naar vergelijkbare aanbiedingen (Gaspedaal, AutoScout24, Marktplaats, dealers) en recente veilingresultaten (BVA, Troostwijk, Vavato) en geeft een markt- en liquidatiewaarde-range met onderbouwing en bronnen.
- **Database** — alle auto's worden bewaard in een lokale SQLite-database, zodat je lijst tussen sessies behouden blijft. Bewerken en verwijderen kan.
- **Export** — exporteer de complete lijst naar Excel (.xlsx).

> De waardering is een **indicatie**, geen formele taxatie. Jij beoordeelt het eindresultaat.

## Installatie

Vereist: [Node.js](https://nodejs.org/) versie 20 of hoger.

```bash
npm install
cp .env.example .env
# open .env en vul je ANTHROPIC_API_KEY in
npm start
```

Open daarna <http://localhost:3000> in je browser (werkt ook prima op mobiel
binnen hetzelfde netwerk).

## Configuratie

In `.env`:

| Variabele           | Vereist | Omschrijving                                                      |
| ------------------- | ------- | ---------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | ja\*    | Sleutel voor de AI-waardering. Via <https://console.anthropic.com/>. |
| `APP_PIN`           | aanbevolen | Pincode om login te vereisen. Leeg = app is open (geen login). |
| `SESSION_SECRET`    | nee     | Geheim voor sessiecookies (wordt anders automatisch gegenereerd). |
| `PORT`              | nee     | Poort (standaard 3000).                                          |
| `CLAUDE_MODEL`      | nee     | Ander Claude-model (standaard `claude-opus-4-8`).               |

\* Alleen nodig voor de waardering. RDW ophalen, opslaan en exporteren werkt
ook zonder API-sleutel.

## Beveiliging

De app heeft twee beveiligingslagen die je kunt combineren:

### 1. Pincode-login (in de app)

Zet `APP_PIN` in je `.env` (bijv. `APP_PIN=4821`). Dan verschijnt er een
inlogscherm en zijn alle gegevens en acties afgeschermd achter die pincode.
De sessie blijft 30 dagen geldig (cookie), met een "Uitloggen"-knop rechtsboven.
Online draait dit altijd over HTTPS, dus de pincode gaat versleuteld over de lijn.
Laat je `APP_PIN` leeg, dan is de app open.

> Tip: kies een pincode van minimaal 5–6 tekens. Voor een online-app is dit je
> belangrijkste slot.

### 2. VPN — alleen jouw eigen apparaten (netwerklaag)

Een echte VPN zit niet *in* de app-code maar is een netwerklaag eromheen. De
makkelijkste moderne oplossing is **[Tailscale](https://tailscale.com)**: een
privé-netwerk waarbij alleen jouw eigen apparaten (laptop, telefoon) de app
kunnen bereiken — de buitenwereld ziet niets.

Aanpak op een eigen server/VPS:

```bash
# 1. Installeer Tailscale op de server en op je telefoon, log op beide in
#    op hetzelfde account: https://tailscale.com/download
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up

# 2. Draai de app zoals normaal (npm start of via Docker).
# 3. Benader de app op je telefoon via het Tailscale-adres van de server,
#    bijv. http://100.x.y.z:3000 of de MagicDNS-naam http://server:3000
```

Zo is de app **alleen** bereikbaar binnen jouw Tailscale-netwerk én daarachter
nog eens afgeschermd met de pincode. Dit is de meest privacyvriendelijke opzet
voor gebruik op locatie.

## Online zetten (mobiel gebruik op locatie)

Wil je de app vanaf je telefoon gebruiken zonder je laptop, zet hem dan online.
Er zit een `Dockerfile` bij (werkt op elk platform: Render, Railway, een eigen
VPS) plus een kant-en-klare `fly.toml` voor [Fly.io](https://fly.io), dat goed
omgaat met de SQLite-database en goedkoop is voor één gebruiker.

**Met Fly.io:**

```bash
# eenmalig: installeer flyctl en log in
fly auth login

# pas in fly.toml de regel app = "..." aan naar een unieke naam, daarna:
fly launch --copy-config --no-deploy   # maakt de app + het volume aan
fly secrets set ANTHROPIC_API_KEY=sk-ant-...
fly deploy
```

De `[mounts]`-sectie in `fly.toml` zorgt dat je auto-lijst (`data/cars.db`)
bewaard blijft tussen herstarts. Beveilig de URL eventueel met een wachtwoord/VPN
voordat je hem publiek deelt — er zit geen ingebouwde login op.

## Hoe het werkt

| Onderdeel        | Bron                                                                 |
| ---------------- | ------------------------------------------------------------------- |
| Voertuiggegevens | RDW Open Data (`opendata.rdw.nl`) — openbaar, geen sleutel nodig.   |
| Km-schatting     | CBS gemiddeld jaarkilometrage 2024, per voertuigsoort en leeftijd.  |
| Markt-/liquidatiewaarde | Claude (`claude-opus-4-8`) met de web_search-tool.           |

De gegevens staan lokaal in `data/cars.db` (wordt automatisch aangemaakt en
staat in `.gitignore`).

## Projectstructuur

```
server/
  index.js      Express-server + API-routes
  db.js         SQLite-opslag (better-sqlite3)
  rdw.js        RDW Open Data ophalen en combineren
  cbs.js        Kilometerschatting op basis van CBS-cijfers
  valuation.js  AI-waardering via Claude + websearch
  export.js     Excel-export
public/
  index.html    Interface
  styles.css    Styling (mobielvriendelijk)
  app.js        Frontend-logica
```
