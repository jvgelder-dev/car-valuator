// Demo-versie die volledig in de browser draait (geschikt voor GitHub Pages).
// - RDW: rechtstreeks vanuit de browser (echte data); valt terug op handmatig.
// - Km-schatting: CBS-model (zelfde logica als de server).
// - Waardering: transparant rekenmodel o.b.v. catalogusprijs + leeftijd + km
//   (geen server/API-sleutel nodig). De volledige app vervangt dit door AI.
// - Opslag: localStorage (per browser).

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'autotaxatie_demo_cars';
const HUIDIG_JAAR = new Date().getFullYear();

// --- Toegangscode-overlay voor de demo ---
// Let op: dit is een lichte drempel op een openbare pagina, geen harde beveiliging
// (de code is een SHA-256-hash, maar een statische publieke pagina is nooit echt
// af te schermen). Voor echte afscherming: de volledige app met server-login of VPN.
const DEMO_PIN_HASH = '8f55b929ae5e8a5247ddeba35274a1a7f206fbf21b379f9e281edbc9a33b8e4e';
async function sha256(tekst) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(tekst));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function ontgrendel() { $('pinGate')?.classList.add('hidden'); }
if (sessionStorage.getItem('demo_unlocked') === '1') ontgrendel();
$('pinForm')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const ingevoerd = (await sha256($('gatePin').value.trim())) === DEMO_PIN_HASH;
  if (ingevoerd) { sessionStorage.setItem('demo_unlocked', '1'); ontgrendel(); }
  else { $('gateError').textContent = 'Onjuiste toegangscode'; $('gatePin').value = ''; }
});

const euro = (n) => (n == null ? null : '€ ' + Number(Math.round(n)).toLocaleString('nl-NL'));
const km = (n) => (n == null ? '—' : Number(n).toLocaleString('nl-NL') + ' km');

function setStatus(msg, isError = false) {
  const el = $('status');
  el.textContent = msg || '';
  el.classList.toggle('error', isError);
}

// --- Opslag in localStorage ---
function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch { return []; }
}
function save(cars) { localStorage.setItem(STORE_KEY, JSON.stringify(cars)); }

// --- CBS-kilometerschatting (zelfde model als server/cbs.js) ---
function interpoleer(punten, leeftijd) {
  const s = [...punten].sort((a, b) => a[0] - b[0]);
  if (leeftijd <= s[0][0]) return s[0][1];
  if (leeftijd >= s[s.length - 1][0]) return s[s.length - 1][1];
  for (let i = 0; i < s.length - 1; i++) {
    const [x0, y0] = s[i]; const [x1, y1] = s[i + 1];
    if (leeftijd >= x0 && leeftijd <= x1) return y0 + ((leeftijd - x0) / (x1 - x0)) * (y1 - y0);
  }
  return s[s.length - 1][1];
}
function jaarkm(soort, brandstof, leeftijd) {
  const so = (soort || '').toLowerCase(); const fu = (brandstof || '').toLowerCase();
  if (so.includes('bedrijf') || so.includes('bestel')) return interpoleer([[1, 25100], [5, 19800], [9, 12400], [15, 9000]], leeftijd);
  if (so.includes('vracht')) return interpoleer([[1, 40000], [5, 33000], [10, 28000], [15, 22000]], leeftijd);
  if (so.includes('trekker') || so.includes('oplegger')) return interpoleer([[1, 80000], [5, 70000], [10, 55000], [15, 40000]], leeftijd);
  let start = 12300;
  if (fu.includes('diesel')) start = 20000;
  else if (fu.includes('elektr')) start = 21000;
  else if (fu.includes('benzine')) start = 11100;
  else if (fu.includes('hybride') || fu.includes('lpg') || fu.includes('cng')) start = 13000;
  return interpoleer([[1, start * 1.05], [5, start], [9, start * 0.75], [15, start * 0.55]], leeftijd);
}
function schatKilometerstand({ voertuigsoort, brandstof, bouwjaar }) {
  if (!bouwjaar) return null;
  const leeftijd = Math.max(0, HUIDIG_JAAR - bouwjaar);
  if (leeftijd === 0) return Math.round(jaarkm(voertuigsoort, brandstof, 1) / 2);
  let t = 0;
  for (let j = 1; j <= leeftijd; j++) t += jaarkm(voertuigsoort, brandstof, j);
  return Math.round(t / 500) * 500;
}

// --- Rekenmodel-waardering (zonder server) ---
// Afschrijvingsprofiel per categorie (voertuigtype + brandstof + prijssegment),
// op basis van ANWB/BOVAG, iSeeCars, Belastingdienst en marktdata (Auto1/Gaspedaal).
function afschrijvingscategorie(car) {
  const soort = (car.voertuigsoort || '').toLowerCase();
  const fuel = (car.brandstof || '').toLowerCase();
  const cat = car.catalogusprijs || 0;

  if (soort.includes('bedrijfs') || soort.includes('bestel')) {
    return { naam: 'Bestel-/bedrijfsauto', type: 'lineair', perJaar: 0.18, vloer: 0.08,
      bron: 'Rabobank/Univé: ~18%/jr lineair, na 5 jr nog ~10% restwaarde' };
  }
  if (soort.includes('vracht') || soort.includes('trekker') || soort.includes('oplegger')) {
    return { naam: 'Vrachtauto/trekker', type: 'lineair', perJaar: 0.12, vloer: 0.10,
      bron: 'Commerciële schatting (intensief gebruik)' };
  }
  if (fuel.includes('elektr')) {
    return { naam: 'Elektrisch (BEV)', type: 'degressief', rates: [0.24, 0.18, 0.12, 0.10],
      bron: 'iSeeCars/Gaspedaal: BEV ~49–57% verlies in 5 jr; markt daalt sinds 2023 ~30%' };
  }
  if (fuel.includes('hybride')) {
    return { naam: 'Hybride', type: 'degressief', rates: [0.12, 0.10, 0.07, 0.05],
      bron: 'iSeeCars/Auto1: hybride waardevast, ~35% verlies in 5 jr (+2,2% j-o-j)' };
  }
  if (cat && cat < 22000) {
    return { naam: 'A-segment (stadsauto)', type: 'degressief', rates: [0.18, 0.13, 0.10, 0.07],
      bron: 'ANWB Koerslijst: ~10%/jr, meest waardevast (~40–50% verlies in 5 jr)' };
  }
  if (cat && cat < 45000) {
    return { naam: 'B/C-segment (compact/gezins)', type: 'degressief', rates: [0.20, 0.15, 0.11, 0.08],
      bron: 'ANWB/AutoRAI: 10–15%/jr, hoge occasionvraag (~37–50% in 5 jr)' };
  }
  if (cat && cat < 60000) {
    return { naam: 'D-segment (hogere middenklasse)', type: 'degressief', rates: [0.24, 0.17, 0.13, 0.09],
      bron: 'iSeeCars: 15–18%/jr, bovengemiddeld verlies' };
  }
  if (cat && cat >= 60000) {
    return { naam: 'E/F-segment (premium/luxe)', type: 'degressief', rates: [0.22, 0.16, 0.10, 0.08],
      bron: 'iSeeCars: luxe ~48% verlies in 5 jr, hoogste absolute afschrijving' };
  }
  return { naam: 'Personenauto (gemiddeld)', type: 'degressief', rates: [0.25, 0.18, 0.13, 0.09],
    bron: 'ANWB/Univé/iSeeCars: gemiddeld 10–20%/jr, ~42% restwaarde na 5 jr' };
}

// Restwaarde als fractie van de catalogusprijs (degressief of lineair).
function restwaarde(profiel, leeftijd) {
  if (leeftijd <= 0) return 1;
  if (profiel.type === 'lineair') return Math.max(profiel.vloer, 1 - profiel.perJaar * leeftijd);
  let r = 1;
  for (let j = 1; j <= leeftijd; j++) {
    const d = j === 1 ? profiel.rates[0] : j === 2 ? profiel.rates[1] : j <= 5 ? profiel.rates[2] : profiel.rates[3];
    r *= (1 - d);
  }
  return Math.max(0.05, r);
}

function rekenWaardering(car) {
  const cat = car.catalogusprijs;
  if (!cat) {
    return {
      waardering_toelichting: 'Geen catalogusprijs bekend — vul handmatig een richtprijs in of gebruik de volledige app met AI-waardering.',
      waardering_grondslag: 'Geen catalogusprijs uit RDW beschikbaar; het rekenmodel kan geen waarde bepalen.',
      waardering_datum: new Date().toISOString(),
    };
  }
  const leeftijd = Math.max(0, HUIDIG_JAAR - (car.bouwjaar || HUIDIG_JAAR));
  const profiel = afschrijvingscategorie(car);
  const behoud = restwaarde(profiel, leeftijd);

  // Km-correctie t.o.v. verwachte stand (CBS).
  const verwacht = schatKilometerstand(car) || 1;
  const km0 = car.km_stand || verwacht;
  let kmFactor = 1 + ((verwacht - km0) / verwacht) * 0.15;
  kmFactor = Math.min(1.15, Math.max(0.75, kmFactor));

  const markt = cat * behoud * kmFactor;
  const marktMin = markt * 0.9;
  const marktMax = markt * 1.1;

  const grondslag = `Categorie: ${profiel.naam}. Afschrijving ${profiel.type}; restwaarde ${(behoud * 100).toFixed(0)}% van catalogusprijs (€ ${Number(cat).toLocaleString('nl-NL')}) na ${leeftijd} jr. Km-correctie ${(kmFactor * 100).toFixed(0)}% t.o.v. CBS-verwachting (~${Number(verwacht).toLocaleString('nl-NL')} km). Liquidatiewaarde = marktwaarde ÷ 1,35–1,45. Basis: ${profiel.bron}.`;

  return {
    marktwaarde_min: Math.round(marktMin / 50) * 50,
    marktwaarde_max: Math.round(marktMax / 50) * 50,
    liquidatiewaarde_min: Math.round((marktMin / 1.45) / 50) * 50,
    liquidatiewaarde_max: Math.round((marktMax / 1.35) / 50) * 50,
    waardering_toelichting: `Rekenmodel-indicatie voor ${profiel.naam.toLowerCase()}: catalogusprijs € ${Number(cat).toLocaleString('nl-NL')} × restwaarde ${(behoud * 100).toFixed(0)}% (leeftijd ${leeftijd} jr) × km-correctie ${(kmFactor * 100).toFixed(0)}%. Liquidatiewaarde = marktwaarde ÷ 1,35–1,45. Indicatie, geen taxatie.`,
    waardering_grondslag: grondslag,
    waardering_bronnen: ['Rekenmodel: RDW-catalogusprijs + CBS-kilometrage', profiel.bron],
    waardering_datum: new Date().toISOString(),
  };
}

// --- Echte RDW-lookup vanuit de browser ---
function cleanKenteken(k) { return (k || '').toUpperCase().replace(/[^A-Z0-9]/g, ''); }
async function fetchRdwBrowser(kentekenInput) {
  const kenteken = cleanKenteken(kentekenInput);
  if (!kenteken) throw new Error('Geen geldig kenteken');
  const basis = await (await fetch(`https://opendata.rdw.nl/resource/m9d7-ebf2.json?kenteken=${kenteken}`)).json();
  if (!basis.length) { const e = new Error(`Geen RDW-gegevens voor ${kenteken}`); e.notFound = true; throw e; }
  const v = basis[0];
  let brandstof = null;
  try {
    const bf = await (await fetch(`https://opendata.rdw.nl/resource/8ys7-d773.json?kenteken=${kenteken}`)).json();
    brandstof = bf.map((b) => b.brandstof_omschrijving).filter(Boolean).join(' / ') || null;
  } catch { /* optioneel */ }
  const jaar = v.datum_eerste_toelating ? parseInt(String(v.datum_eerste_toelating).slice(0, 4), 10) : null;
  const fmt = (d) => (d && String(d).length === 8 ? `${String(d).slice(0, 4)}-${String(d).slice(4, 6)}-${String(d).slice(6, 8)}` : d || null);
  return {
    kenteken,
    merk: v.merk || null,
    handelsbenaming: v.handelsbenaming || null,
    voertuigsoort: v.voertuigsoort || null,
    brandstof,
    bouwjaar: Number.isFinite(jaar) ? jaar : null,
    datum_eerste_toelating: fmt(v.datum_eerste_toelating),
    catalogusprijs: v.catalogusprijs ? parseInt(v.catalogusprijs, 10) : null,
    massa_ledig: v.massa_ledig_voertuig ? parseInt(v.massa_ledig_voertuig, 10) : null,
    apk_vervaldatum: fmt(v.vervaldatum_apk),
  };
}

let laatsteRdw = null;

$('rdwBtn').addEventListener('click', async () => {
  const kenteken = $('kenteken').value.trim();
  if (!kenteken) return setStatus('Vul eerst een kenteken in.', true);
  const btn = $('rdwBtn');
  btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>'; setStatus('');
  try {
    const d = await fetchRdwBrowser(kenteken);
    laatsteRdw = d;
    $('merk').value = d.merk || '';
    $('handelsbenaming').value = d.handelsbenaming || '';
    $('brandstof').value = d.brandstof || '';
    $('bouwjaar').value = d.bouwjaar || '';
    if (d.voertuigsoort) $('voertuigsoort').value = matchSoort(d.voertuigsoort);
    const p = $('rdwPreview'); p.classList.remove('hidden');
    p.innerHTML = `<b>${esc(d.merk || '')} ${esc(d.handelsbenaming || '')}</b><br>
      ${esc(d.voertuigsoort || '')} · ${esc(d.brandstof || 'onbekende brandstof')} · bouwjaar ${d.bouwjaar || '?'}<br>
      ${d.catalogusprijs ? 'Cat.prijs € ' + Number(d.catalogusprijs).toLocaleString('nl-NL') + ' · ' : ''}APK tot ${d.apk_vervaldatum || 'onbekend'}`;
  } catch (err) {
    laatsteRdw = null;
    if (err.notFound) setStatus(err.message + ' — vul de gegevens eventueel handmatig in.', true);
    else setStatus('RDW niet bereikbaar — vul de gegevens handmatig in. (' + err.message + ')', true);
    $('handmatig').open = true;
  } finally {
    btn.disabled = false; btn.textContent = 'RDW ophalen';
  }
});

function matchSoort(soort) {
  const s = soort.toLowerCase();
  if (s.includes('bedrijf') || s.includes('bestel')) return 'Bedrijfsauto';
  if (s.includes('vracht')) return 'Vrachtauto';
  if (s.includes('trekker')) return 'Trekker';
  return 'Personenauto';
}

$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const kenteken = $('kenteken').value.trim();
  const merkInput = $('merk').value.trim();

  // Eén-klik: is een kenteken ingevuld maar nog geen data opgehaald, haal dan
  // nu de RDW-gegevens op voordat we toevoegen.
  let rdw = laatsteRdw;
  if (kenteken && !rdw && !merkInput) {
    setStatus('RDW ophalen…');
    try { rdw = await fetchRdwBrowser(kenteken); }
    catch { rdw = null; } // niet gevonden of niet bereikbaar: voeg toe met alleen kenteken
  }

  const car = {
    id: Date.now(),
    kenteken: kenteken || null,
    merk: merkInput || rdw?.merk || null,
    handelsbenaming: $('handelsbenaming').value.trim() || rdw?.handelsbenaming || null,
    voertuigsoort: rdw?.voertuigsoort || $('voertuigsoort').value || null,
    brandstof: $('brandstof').value.trim() || rdw?.brandstof || null,
    bouwjaar: $('bouwjaar').value ? parseInt($('bouwjaar').value, 10) : (rdw?.bouwjaar || null),
    catalogusprijs: rdw?.catalogusprijs || null,
    apk_vervaldatum: rdw?.apk_vervaldatum || null,
  };
  if (!car.kenteken && !car.merk) return setStatus('Vul een kenteken in of voer handmatig merk/model in.', true);

  if ($('km_stand').value) { car.km_stand = parseInt($('km_stand').value, 10); car.km_bron = 'handmatig'; }
  else { car.km_stand = schatKilometerstand(car); car.km_bron = car.km_stand != null ? 'cbs-schatting' : null; }

  const cars = load(); cars.unshift(car); save(cars);
  e.target.reset(); $('rdwPreview').classList.add('hidden'); laatsteRdw = null;
  setStatus(`Toegevoegd: ${car.merk || car.kenteken}.`); render();
});

function render() {
  const cars = load();
  $('count').textContent = cars.length;
  const body = $('carsBody'); body.innerHTML = '';
  $('empty').classList.toggle('hidden', cars.length > 0);
  for (const car of cars) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><div class="voertuig-naam">${esc(car.merk || '?')} ${esc(car.handelsbenaming || '')}</div>
        <div class="voertuig-sub">${esc(car.kenteken || 'handmatig')} · ${esc(car.brandstof || '')}</div></td>
      <td>${car.bouwjaar || '—'}</td>
      <td>${km(car.km_stand)}<div class="km-bron">${car.km_bron === 'cbs-schatting' ? 'schatting' : car.km_bron || ''}</div></td>
      <td>${waardeCel(car.marktwaarde_min, car.marktwaarde_max, 'markt')}</td>
      <td>${waardeCel(car.liquidatiewaarde_min, car.liquidatiewaarde_max, 'liq')}</td>
      <td class="acties"></td>`;
    const acties = tr.querySelector('.acties');
    const valBtn = btn(car.waardering_datum ? 'Herwaardeer' : 'Waarde bepalen', 'primary', () => waardeer(car.id));
    acties.appendChild(valBtn);
    if (car.waardering_datum) acties.appendChild(btn('Details', 'secondary', () => toonDetails(car)));
    acties.appendChild(btn('Verwijder', 'secondary', () => verwijder(car.id)));
    body.appendChild(tr);
  }
}
function btn(tekst, klasse, fn) { const b = document.createElement('button'); b.className = klasse; b.textContent = tekst; b.onclick = fn; return b; }

function waardeCel(min, max, klasse) {
  if (min == null && max == null) return '<span class="geen-waarde">—</span>';
  return `<span class="bedrag ${klasse}">${min === max ? euro(min) : `${euro(min)} – ${euro(max)}`}</span>`;
}

function waardeer(id) {
  const cars = load(); const car = cars.find((c) => c.id === id); if (!car) return;
  Object.assign(car, rekenWaardering(car)); save(cars); render();
  setStatus('Waardering bijgewerkt (rekenmodel).');
}
function verwijder(id) {
  if (!confirm('Deze auto verwijderen?')) return;
  save(load().filter((c) => c.id !== id)); render();
}

function toonDetails(car) {
  const bronnen = (car.waardering_bronnen || []).map((b) => `<li>${esc(b)}</li>`).join('');
  $('modalContent').innerHTML = `
    <h3>${esc(car.merk || '')} ${esc(car.handelsbenaming || '')}</h3>
    <dl>
      <dt>Kenteken</dt><dd>${esc(car.kenteken || '—')}</dd>
      <dt>Bouwjaar</dt><dd>${car.bouwjaar || '—'}</dd>
      <dt>Km-stand</dt><dd>${km(car.km_stand)} (${car.km_bron || '—'})</dd>
      <dt>Marktwaarde</dt><dd>${waardeCel(car.marktwaarde_min, car.marktwaarde_max, 'markt')}</dd>
      <dt>Liquidatiewaarde</dt><dd>${waardeCel(car.liquidatiewaarde_min, car.liquidatiewaarde_max, 'liq')}</dd>
    </dl>
    <p><b>Grondslag</b><br>${esc(car.waardering_grondslag || '—')}</p>
    <p><b>Toelichting</b><br>${esc(car.waardering_toelichting || '—')}</p>
    ${bronnen ? `<p><b>Bronnen</b></p><ul class="bronnen">${bronnen}</ul>` : ''}
    <p class="hint">Demo-indicatie via rekenmodel. De volledige app gebruikt AI met live markt- en veilingdata.</p>`;
  $('detailModal').classList.remove('hidden');
}
$('modalClose').addEventListener('click', () => $('detailModal').classList.add('hidden'));
$('detailModal').addEventListener('click', (e) => { if (e.target === $('detailModal')) $('detailModal').classList.add('hidden'); });

// CSV-export in de browser.
// Categorieën voor het referentietabblad (zelfde waarden als het rekenmodel).
const CATEGORIEEN = [
  { naam: 'A-segment (stadsauto)', type: 'degressief', rates: [0.18, 0.13, 0.10, 0.07], voorbeeldPrijs: 18000, bron: 'ANWB Koerslijst: ~10%/jr, meest waardevast' },
  { naam: 'B/C-segment (compact/gezins)', type: 'degressief', rates: [0.20, 0.15, 0.11, 0.08], voorbeeldPrijs: 30000, bron: 'ANWB/AutoRAI: 10–15%/jr' },
  { naam: 'D-segment (hogere middenklasse)', type: 'degressief', rates: [0.24, 0.17, 0.13, 0.09], voorbeeldPrijs: 50000, bron: 'iSeeCars: 15–18%/jr' },
  { naam: 'E/F-segment (premium/luxe)', type: 'degressief', rates: [0.22, 0.16, 0.10, 0.08], voorbeeldPrijs: 80000, bron: 'iSeeCars: luxe ~48% in 5 jr' },
  { naam: 'Personenauto (gemiddeld)', type: 'degressief', rates: [0.25, 0.18, 0.13, 0.09], voorbeeldPrijs: 30000, bron: 'ANWB/Univé/iSeeCars: 10–20%/jr' },
  { naam: 'Hybride', type: 'degressief', rates: [0.12, 0.10, 0.07, 0.05], voorbeeldPrijs: 38000, bron: 'iSeeCars/Auto1: ~35% in 5 jr' },
  { naam: 'Elektrisch (BEV)', type: 'degressief', rates: [0.24, 0.18, 0.12, 0.10], voorbeeldPrijs: 42000, bron: 'iSeeCars/Gaspedaal: ~49–57% in 5 jr' },
  { naam: 'Bestel-/bedrijfsauto', type: 'lineair', perJaar: 0.18, vloer: 0.08, voorbeeldPrijs: 30000, bron: 'Rabobank/Univé: ~18%/jr lineair' },
  { naam: 'Vrachtauto/trekker', type: 'lineair', perJaar: 0.12, vloer: 0.10, voorbeeldPrijs: 90000, bron: 'Commerciële schatting' },
];
const REF_JAREN = 15;
const VOORBEELD_JAREN = [1, 3, 5, 8, 12];
const euroAf = (n) => Math.round(n / 50) * 50;

$('exportBtn').addEventListener('click', async () => {
  const cars = load();
  if (!cars.length) return setStatus('Nog niets om te exporteren.', true);
  if (typeof ExcelJS === 'undefined') return setStatus('Excel-bibliotheek nog niet geladen, probeer het zo opnieuw.', true);

  const wb = new ExcelJS.Workbook();

  // Tabblad 1: auto's
  const ws = wb.addWorksheet('Autos');
  ws.columns = [
    { header: 'Kenteken', key: 'kenteken', width: 12 },
    { header: 'Merk', key: 'merk', width: 16 },
    { header: 'Model/uitvoering', key: 'handelsbenaming', width: 24 },
    { header: 'Soort', key: 'voertuigsoort', width: 16 },
    { header: 'Brandstof', key: 'brandstof', width: 14 },
    { header: 'Bouwjaar', key: 'bouwjaar', width: 10 },
    { header: 'APK tot', key: 'apk_vervaldatum', width: 12 },
    { header: 'Km-stand', key: 'km_stand', width: 12 },
    { header: 'Km-bron', key: 'km_bron', width: 14 },
    { header: 'Cat.prijs (€)', key: 'catalogusprijs', width: 13 },
    { header: 'Marktwaarde min (€)', key: 'marktwaarde_min', width: 18 },
    { header: 'Marktwaarde max (€)', key: 'marktwaarde_max', width: 18 },
    { header: 'Liquidatie min (€)', key: 'liquidatiewaarde_min', width: 18 },
    { header: 'Liquidatie max (€)', key: 'liquidatiewaarde_max', width: 18 },
    { header: 'Grondslag', key: 'waardering_grondslag', width: 50 },
    { header: 'Toelichting', key: 'waardering_toelichting', width: 50 },
  ];
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ws.getRow(1).eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }; });
  for (const car of cars) ws.addRow(car);

  // Tabblad 2: afschrijvingscurves
  const ws2 = wb.addWorksheet('Afschrijvingscurves');
  ws2.mergeCells(1, 1, 1, REF_JAREN + 4);
  ws2.getCell('A1').value = 'Afschrijvingscurves — restwaarde als % van de catalogusprijs per leeftijdsjaar';
  ws2.getCell('A1').font = { bold: true, size: 12 };
  const head = ['Categorie', 'Basis (bron)', 'Nieuw'];
  for (let j = 1; j <= REF_JAREN; j++) head.push(`${j} jr`);
  head.push('Verlies na 5 jr');
  const hr = ws2.addRow(head);
  hr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  hr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }; });
  for (const cat of CATEGORIEEN) {
    const rij = [cat.naam, cat.bron, '100%'];
    for (let j = 1; j <= REF_JAREN; j++) rij.push(`${Math.round(restwaarde(cat, j) * 100)}%`);
    rij.push(`${Math.round((1 - restwaarde(cat, 5)) * 100)}%`);
    ws2.addRow(rij);
  }
  ws2.getColumn(1).width = 30; ws2.getColumn(2).width = 42;
  for (let c = 3; c <= REF_JAREN + 4; c++) ws2.getColumn(c).width = 8;

  // Voorbeeld in euro's per categorie.
  ws2.addRow([]);
  const t2 = ws2.addRow(['Voorbeeld in euro’s — restwaarde bij een representatieve nieuwprijs per categorie']);
  ws2.mergeCells(t2.number, 1, t2.number, REF_JAREN + 4);
  t2.getCell(1).font = { bold: true, size: 12 };
  const eh = ['Categorie', 'Voorbeeld nieuwprijs (€)'];
  for (const j of VOORBEELD_JAREN) eh.push(`na ${j} jr (€)`);
  const ehr = ws2.addRow(eh);
  ehr.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  ehr.eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } }; });
  for (const cat of CATEGORIEEN) {
    const rij = [cat.naam, euroAf(cat.voorbeeldPrijs)];
    for (const j of VOORBEELD_JAREN) rij.push(euroAf(restwaarde(cat, j) * cat.voorbeeldPrijs));
    ws2.addRow(rij);
  }

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `autos-${Date.now()}.xlsx`; a.click();
  setStatus('Geëxporteerd naar Excel.');
});

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// --- Waardeer alles (rekenmodel voor alle nog niet gewaardeerde auto's) ---
$('valuateAllBtn').addEventListener('click', () => {
  const cars = load();
  const teDoen = cars.filter((c) => !c.waardering_datum);
  if (!cars.length) return setStatus('Nog geen voertuigen in de lijst.', true);
  if (!teDoen.length) return setStatus('Alle voertuigen zijn al gewaardeerd.');
  for (const car of teDoen) Object.assign(car, rekenWaardering(car));
  save(cars); render();
  setStatus(`${teDoen.length} voertuig(en) gewaardeerd (rekenmodel).`);
});

// --- Wis alles (leegt de in de browser opgeslagen lijst) ---
$('clearAllBtn').addEventListener('click', () => {
  const aantal = load().length;
  if (!aantal) return setStatus('De lijst is al leeg.');
  if (!confirm(`Weet je zeker dat je alle ${aantal} auto's wilt wissen? Dit kan niet ongedaan worden gemaakt.`)) return;
  localStorage.removeItem(STORE_KEY);
  render();
  setStatus('Lijst gewist.');
});

// --- Meerdere kentekens importeren ---
function parseKentekens(text) {
  return [...new Set(
    text.split(/[\n,;\s]+/)
      .map((s) => s.trim().toUpperCase().replace(/[^A-Z0-9]/g, ''))
      .filter((s) => s.length >= 4 && s.length <= 8),
  )];
}

$('importFile').addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const huidig = $('importText').value.trim();
    $('importText').value = (huidig ? huidig + '\n' : '') + reader.result;
  };
  reader.readAsText(file);
});

$('importBtn').addEventListener('click', async () => {
  const kentekens = parseKentekens($('importText').value);
  const st = $('importStatus');
  if (!kentekens.length) { st.textContent = 'Geen geldige kentekens gevonden.'; st.classList.add('error'); return; }
  st.classList.remove('error');
  $('importBtn').disabled = true;

  const cars = load();
  const bestaand = new Set(cars.map((c) => (c.kenteken || '').toUpperCase()));
  let ok = 0; let overgeslagen = 0; const mislukt = [];

  for (let i = 0; i < kentekens.length; i++) {
    const k = kentekens[i];
    st.textContent = `Bezig: ${i + 1}/${kentekens.length} (${k})…`;
    if (bestaand.has(k)) { overgeslagen++; continue; }
    try {
      const d = await fetchRdwBrowser(k);
      const car = {
        id: Date.now() + i,
        kenteken: d.kenteken, merk: d.merk, handelsbenaming: d.handelsbenaming,
        voertuigsoort: d.voertuigsoort, brandstof: d.brandstof, bouwjaar: d.bouwjaar,
        catalogusprijs: d.catalogusprijs, apk_vervaldatum: d.apk_vervaldatum,
      };
      car.km_stand = schatKilometerstand(car);
      car.km_bron = car.km_stand != null ? 'cbs-schatting' : null;
      cars.unshift(car); bestaand.add(k); ok++;
    } catch {
      mislukt.push(k);
    }
  }

  save(cars); render();
  $('importBtn').disabled = false;
  $('importText').value = ''; $('importFile').value = '';
  let melding = `Klaar: ${ok} toegevoegd`;
  if (overgeslagen) melding += `, ${overgeslagen} al in lijst`;
  if (mislukt.length) melding += `, ${mislukt.length} niet gevonden (${mislukt.join(', ')})`;
  st.textContent = melding + '.';
  st.classList.toggle('error', mislukt.length > 0);
});

render();
