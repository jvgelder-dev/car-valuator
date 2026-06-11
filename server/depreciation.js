// Afschrijvingsprofielen per categorie (voertuigtype + brandstof + prijssegment),
// op basis van ANWB/BOVAG, iSeeCars, Belastingdienst en marktdata (Auto1/Gaspedaal).
// Gedeeld door de Excel-referentietabel; het rekenmodel in de demo gebruikt
// dezelfde waarden.

export const categorieen = [
  { naam: 'A-segment (stadsauto)', type: 'degressief', rates: [0.18, 0.13, 0.10, 0.07],
    bron: 'ANWB Koerslijst: ~10%/jr, meest waardevast' },
  { naam: 'B/C-segment (compact/gezins)', type: 'degressief', rates: [0.20, 0.15, 0.11, 0.08],
    bron: 'ANWB/AutoRAI: 10–15%/jr, hoge occasionvraag' },
  { naam: 'D-segment (hogere middenklasse)', type: 'degressief', rates: [0.24, 0.17, 0.13, 0.09],
    bron: 'iSeeCars: 15–18%/jr, bovengemiddeld verlies' },
  { naam: 'E/F-segment (premium/luxe)', type: 'degressief', rates: [0.22, 0.16, 0.10, 0.08],
    bron: 'iSeeCars: luxe ~48% verlies in 5 jr' },
  { naam: 'Personenauto (gemiddeld)', type: 'degressief', rates: [0.25, 0.18, 0.13, 0.09],
    bron: 'ANWB/Univé/iSeeCars: gemiddeld 10–20%/jr' },
  { naam: 'Hybride', type: 'degressief', rates: [0.12, 0.10, 0.07, 0.05],
    bron: 'iSeeCars/Auto1: waardevast, ~35% verlies in 5 jr' },
  { naam: 'Elektrisch (BEV)', type: 'degressief', rates: [0.24, 0.18, 0.12, 0.10],
    bron: 'iSeeCars/Gaspedaal: ~49–57% verlies in 5 jr; markt daalt sinds 2023' },
  { naam: 'Bestel-/bedrijfsauto', type: 'lineair', perJaar: 0.18, vloer: 0.08,
    bron: 'Rabobank/Univé: ~18%/jr lineair, na 5 jr ~10% restwaarde' },
  { naam: 'Vrachtauto/trekker', type: 'lineair', perJaar: 0.12, vloer: 0.10,
    bron: 'Commerciële schatting (intensief gebruik)' },
];

// Restwaarde als fractie van de catalogusprijs (degressief of lineair).
export function restwaarde(profiel, leeftijd) {
  if (leeftijd <= 0) return 1;
  if (profiel.type === 'lineair') return Math.max(profiel.vloer, 1 - profiel.perJaar * leeftijd);
  let r = 1;
  for (let j = 1; j <= leeftijd; j++) {
    const d = j === 1 ? profiel.rates[0]
      : j === 2 ? profiel.rates[1]
        : j <= 5 ? profiel.rates[2]
          : profiel.rates[3];
    r *= (1 - d);
  }
  return Math.max(0.05, r);
}
