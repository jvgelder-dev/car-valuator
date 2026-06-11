// RDW Open Data — gratis, openbaar, geen sleutel nodig.
// We combineren het basisvoertuig-dataset met het brandstof-dataset.
// Docs: https://opendata.rdw.nl/

const BASIS = 'https://opendata.rdw.nl/resource/m9d7-ebf2.json';
const BRANDSTOF = 'https://opendata.rdw.nl/resource/8ys7-d773.json';

function cleanKenteken(kenteken) {
  return (kenteken || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`RDW gaf status ${res.status}`);
  return res.json();
}

function bouwjaarVan(datum) {
  // RDW levert datum_eerste_toelating als 'YYYYMMDD'
  if (!datum) return null;
  const jaar = parseInt(String(datum).slice(0, 4), 10);
  return Number.isFinite(jaar) ? jaar : null;
}

function formatDatum(datum) {
  if (!datum) return null;
  const s = String(datum);
  if (s.length === 8) return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
  return s;
}

/**
 * Haalt en combineert RDW-gegevens voor een kenteken.
 * Geeft een genormaliseerd object terug plus de ruwe respons.
 */
export async function fetchRdw(kentekenInput) {
  const kenteken = cleanKenteken(kentekenInput);
  if (!kenteken) throw new Error('Geen geldig kenteken opgegeven');

  const basis = await fetchJson(`${BASIS}?kenteken=${kenteken}`);
  if (!basis.length) {
    const err = new Error(`Geen RDW-gegevens gevonden voor kenteken ${kenteken}`);
    err.status = 404;
    throw err;
  }
  const v = basis[0];

  let brandstof = null;
  try {
    const bf = await fetchJson(`${BRANDSTOF}?kenteken=${kenteken}`);
    brandstof = bf.map((b) => b.brandstof_omschrijving).filter(Boolean).join(' / ') || null;
  } catch {
    // Brandstof is optioneel; ga door zonder als dit dataset faalt.
  }

  return {
    normalized: {
      kenteken,
      merk: v.merk || null,
      handelsbenaming: v.handelsbenaming || null,
      voertuigsoort: v.voertuigsoort || null,
      brandstof,
      bouwjaar: bouwjaarVan(v.datum_eerste_toelating),
      datum_eerste_toelating: formatDatum(v.datum_eerste_toelating),
      catalogusprijs: v.catalogusprijs ? parseInt(v.catalogusprijs, 10) : null,
      massa_ledig: v.massa_ledig_voertuig ? parseInt(v.massa_ledig_voertuig, 10) : null,
      apk_vervaldatum: formatDatum(v.vervaldatum_apk),
    },
    raw: { basis: v, brandstof },
  };
}
