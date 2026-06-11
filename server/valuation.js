import Anthropic from '@anthropic-ai/sdk';

const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';

let client;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) {
    const err = new Error(
      'ANTHROPIC_API_KEY ontbreekt. Zet deze in je .env-bestand om de waardering te gebruiken.',
    );
    err.status = 400;
    throw err;
  }
  if (!client) client = new Anthropic();
  return client;
}

function bouwPrompt(auto) {
  const regels = [
    `Merk: ${auto.merk || 'onbekend'}`,
    `Model/uitvoering: ${auto.handelsbenaming || 'onbekend'}`,
    `Voertuigsoort: ${auto.voertuigsoort || 'onbekend'}`,
    `Brandstof: ${auto.brandstof || 'onbekend'}`,
    `Bouwjaar: ${auto.bouwjaar || 'onbekend'}`,
    `Eerste toelating: ${auto.datum_eerste_toelating || 'onbekend'}`,
    `Kilometerstand: ${auto.km_stand != null ? `${auto.km_stand} km` : 'onbekend'}${
      auto.km_bron === 'cbs-schatting' ? ' (geschat op basis van CBS-gemiddelden)' : ''
    }`,
    auto.catalogusprijs ? `Oorspronkelijke catalogusprijs: € ${auto.catalogusprijs}` : null,
    auto.kenteken ? `Kenteken: ${auto.kenteken}` : null,
  ].filter(Boolean);

  return `Je bent een ervaren taxateur van voertuigen in Nederland. Bepaal voor onderstaand voertuig een indicatieve marktwaarde én liquidatiewaarde (veiling/gedwongen verkoop).

Voertuiggegevens:
${regels.join('\n')}

Gebruik websearch om actuele, vergelijkbare gegevens te vinden:
- Marktwaarde: vergelijkbare advertenties op sites als Gaspedaal.nl, AutoScout24, Marktplaats en bij dealers. Let op bouwjaar, kilometerstand, uitvoering en brandstof.
- Liquidatiewaarde: recente veilingresultaten/biedingen bij o.a. BVA Auctions, Troostwijk Auctions, Vavato en vergelijkbare zakelijke veilingen.

Bepaal de liquidatiewaarde door de marktwaarde te delen door een factor tussen 1,35 en 1,45 (afhankelijk van de auto: courante, gewilde auto's dichter bij 1,35; minder courante dichter bij 1,45). Dus: liquidatiewaarde = marktwaarde ÷ 1,35 tot 1,45. Gebruik de veilingresultaten als toets/onderbouwing, maar houd deze deler aan. Dit is een indicatie, geen formele taxatie.

Houd bij je inschatting rekening met de afschrijvingskarakteristiek per categorie (degressief verloop): kleine stadsauto's (A-segment) en hybrides/pick-ups zijn waardevast (~10%/jr); B/C-gezinsauto's gemiddeld (10–15%/jr); D-segment en premium/luxe schrijven sneller af (15–20%/jr); volledig elektrische auto's verliezen momenteel het meest (~49–57% in 5 jaar, markt daalt sinds 2023); bestelauto's volgen de zakelijke vuistregel (~18%/jr lineair, na 5 jaar nog ~10%). Gebruik dit als toets op je gevonden advertentieprijzen.

Geef je redenering kort weer. Sluit je antwoord AF met exact één JSON-blok in dit formaat (bedragen in hele euro's, zonder punten of valutateken):

\`\`\`json
{
  "marktwaarde_min": 0,
  "marktwaarde_max": 0,
  "liquidatiewaarde_min": 0,
  "liquidatiewaarde_max": 0,
  "grondslag": "kort: waarop is de waardering gestoeld (aantal/spreiding vergelijkbare advertenties, eventuele veilingdata, segment en afschrijvingskarakteristiek)",
  "toelichting": "korte onderbouwing in het Nederlands",
  "bronnen": ["url of omschrijving", "..."]
}
\`\`\``;
}

function parseLaatsteJson(tekst) {
  // Pak het laatste ```json ... ``` blok, of de laatste { ... } in de tekst.
  const fences = [...tekst.matchAll(/```json\s*([\s\S]*?)```/gi)];
  let kandidaat = fences.length ? fences[fences.length - 1][1] : null;
  if (!kandidaat) {
    const start = tekst.lastIndexOf('{');
    const eind = tekst.lastIndexOf('}');
    if (start !== -1 && eind > start) kandidaat = tekst.slice(start, eind + 1);
  }
  if (!kandidaat) throw new Error('Geen JSON-waardering gevonden in het antwoord.');
  return JSON.parse(kandidaat.trim());
}

/**
 * Vraagt Claude (met websearch) om een markt- en liquidatiewaarde te bepalen.
 */
export async function bepaalWaardering(auto) {
  const anthropic = getClient();
  const prompt = bouwPrompt(auto);

  const messages = [{ role: 'user', content: prompt }];
  let response;
  const maxRondes = 6;

  for (let ronde = 0; ronde < maxRondes; ronde++) {
    response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 4000,
      thinking: { type: 'adaptive' },
      tools: [{ type: 'web_search_20260209', name: 'web_search' }],
      messages,
    });

    // Server-side websearch kan pauzeren; dan opnieuw insturen om door te gaan.
    if (response.stop_reason === 'pause_turn') {
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }
    break;
  }

  const tekst = response.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('\n');

  const data = parseLaatsteJson(tekst);

  const toInt = (n) => {
    const v = parseInt(String(n).replace(/[^0-9-]/g, ''), 10);
    return Number.isFinite(v) ? v : null;
  };

  return {
    marktwaarde_min: toInt(data.marktwaarde_min),
    marktwaarde_max: toInt(data.marktwaarde_max),
    liquidatiewaarde_min: toInt(data.liquidatiewaarde_min),
    liquidatiewaarde_max: toInt(data.liquidatiewaarde_max),
    waardering_toelichting: data.toelichting || null,
    waardering_grondslag: data.grondslag || null,
    waardering_bronnen: Array.isArray(data.bronnen) ? data.bronnen : [],
    waardering_datum: new Date().toISOString(),
  };
}
