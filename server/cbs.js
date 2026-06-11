// Schatting van de kilometerstand op basis van CBS-cijfers (verslagjaar 2024)
// wanneer de gebruiker geen specifieke kilometerstand invult.
//
// Bronnen (CBS, 2024):
// - Personenauto's: gemiddeld 12,3 dzd km/jaar. Benzine ~11,1 dzd;
//   diesel/elektrisch ~18.000–25.000 km (zakelijk gebruik).
// - Bestelauto's: gemiddeld 16,4 dzd; 1 jr ~25,1 dzd, 5 jr ~19,8 dzd, 9+ jr ~12,4 dzd.
// - Vrachtauto's (bakwagen): ~33.000 km/jaar.
// - Trekkers (voor oplegger): ~70.000 km/jaar.
//
// Het jaarkilometrage daalt naarmate het voertuig ouder wordt; we modelleren
// dat met ankerpunten per voertuigsoort en interpoleren ertussen.

const HUIDIG_JAAR = new Date().getFullYear();

// Lineaire interpolatie/extrapolatie over ankerpunten [leeftijd, km].
function interpoleer(punten, leeftijd) {
  const sorted = [...punten].sort((a, b) => a[0] - b[0]);
  if (leeftijd <= sorted[0][0]) return sorted[0][1];
  if (leeftijd >= sorted[sorted.length - 1][0]) return sorted[sorted.length - 1][1];
  for (let i = 0; i < sorted.length - 1; i++) {
    const [x0, y0] = sorted[i];
    const [x1, y1] = sorted[i + 1];
    if (leeftijd >= x0 && leeftijd <= x1) {
      const t = (leeftijd - x0) / (x1 - x0);
      return y0 + t * (y1 - y0);
    }
  }
  return sorted[sorted.length - 1][1];
}

function jaarkilometrage(voertuigsoort, brandstof, leeftijd) {
  const soort = (voertuigsoort || '').toLowerCase();
  const fuel = (brandstof || '').toLowerCase();

  if (soort.includes('bedrijfsauto') || soort.includes('bestel')) {
    return interpoleer([[1, 25100], [5, 19800], [9, 12400], [15, 9000]], leeftijd);
  }
  if (soort.includes('vracht')) {
    return interpoleer([[1, 40000], [5, 33000], [10, 28000], [15, 22000]], leeftijd);
  }
  if (soort.includes('trekker') || soort.includes('oplegger')) {
    return interpoleer([[1, 80000], [5, 70000], [10, 55000], [15, 40000]], leeftijd);
  }

  // Personenauto's: startwaarde afhankelijk van brandstof, daalt met leeftijd.
  let start = 12300;
  if (fuel.includes('diesel')) start = 20000;
  else if (fuel.includes('elektr')) start = 21000;
  else if (fuel.includes('benzine')) start = 11100;
  else if (fuel.includes('hybride') || fuel.includes('lpg') || fuel.includes('cng')) start = 13000;

  // Daalt richting ~70% van startwaarde op 9 jaar en ~50% op 15+ jaar.
  return interpoleer(
    [[1, start * 1.05], [5, start], [9, start * 0.75], [15, start * 0.55]],
    leeftijd,
  );
}

/**
 * Schat de totale kilometerstand: sommeer het (dalende) jaarkilometrage
 * over de levensjaren van het voertuig.
 */
export function schatKilometerstand({ voertuigsoort, brandstof, bouwjaar }) {
  if (!bouwjaar) return null;
  const leeftijd = Math.max(0, HUIDIG_JAAR - bouwjaar);
  if (leeftijd === 0) return Math.round(jaarkilometrage(voertuigsoort, brandstof, 1) / 2);
  let totaal = 0;
  for (let jaar = 1; jaar <= leeftijd; jaar++) {
    totaal += jaarkilometrage(voertuigsoort, brandstof, jaar);
  }
  return Math.round(totaal / 500) * 500; // afronden op 500 km
}
