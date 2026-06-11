// Demo-versie die volledig in de browser draait (geschikt voor GitHub Pages).
// - RDW: rechtstreeks vanuit de browser (echte data); valt terug op handmatig.
// - Km-schatting: CBS-model (zelfde logica als de server).
// - Waardering: transparant rekenmodel o.b.v. catalogusprijs + leeftijd + km
//   (geen server/API-sleutel nodig). De volledige app vervangt dit door AI.
// - Opslag: localStorage (per browser).

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'autotaxatie_demo_cars';
const HUIDIG_JAAR = new Date().getFullYear();

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
function rekenWaardering(car) {
  const cat = car.catalogusprijs;
  if (!cat) {
    return {
      toelichting: 'Geen catalogusprijs bekend — vul handmatig een richtprijs in of gebruik de volledige app met AI-waardering.',
    };
  }
  const leeftijd = Math.max(0, HUIDIG_JAAR - (car.bouwjaar || HUIDIG_JAAR));
  // Afschrijvingscurve: ~18% bij aanschaf, daarna ~14%/jaar, vloer 8%.
  const behoud = Math.max(0.08, 0.82 * Math.pow(0.86, leeftijd));

  // Km-correctie t.o.v. verwachte stand.
  const verwacht = schatKilometerstand(car) || 1;
  const km0 = car.km_stand || verwacht;
  let kmFactor = 1 + ((verwacht - km0) / verwacht) * 0.15;
  kmFactor = Math.min(1.15, Math.max(0.75, kmFactor));

  const markt = cat * behoud * kmFactor;
  const marktMin = markt * 0.9;
  const marktMax = markt * 1.1;
  return {
    marktwaarde_min: Math.round(marktMin / 50) * 50,
    marktwaarde_max: Math.round(marktMax / 50) * 50,
    // Liquidatiewaarde = marktwaarde gedeeld door 1,35 (hoog) tot 1,45 (laag).
    liquidatiewaarde_min: Math.round((marktMin / 1.45) / 50) * 50,
    liquidatiewaarde_max: Math.round((marktMax / 1.35) / 50) * 50,
    toelichting: `Rekenmodel-indicatie: catalogusprijs € ${Number(cat).toLocaleString('nl-NL')} × waardebehoud ${(behoud * 100).toFixed(0)}% (leeftijd ${leeftijd} jr) × km-correctie ${(kmFactor * 100).toFixed(0)}%. Liquidatiewaarde = marktwaarde ÷ 1,35–1,45. Indicatie, geen taxatie.`,
    waardering_bronnen: ['Rekenmodel op basis van RDW-catalogusprijs en CBS-kilometrage'],
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
    <p><b>Toelichting</b><br>${esc(car.waardering_toelichting || '—')}</p>
    ${bronnen ? `<p><b>Bronnen</b></p><ul class="bronnen">${bronnen}</ul>` : ''}
    <p class="hint">Demo-indicatie via rekenmodel. De volledige app gebruikt AI met live markt- en veilingdata.</p>`;
  $('detailModal').classList.remove('hidden');
}
$('modalClose').addEventListener('click', () => $('detailModal').classList.add('hidden'));
$('detailModal').addEventListener('click', (e) => { if (e.target === $('detailModal')) $('detailModal').classList.add('hidden'); });

// CSV-export in de browser.
$('exportBtn').addEventListener('click', () => {
  const cars = load();
  if (!cars.length) return setStatus('Nog niets om te exporteren.', true);
  const kols = ['kenteken', 'merk', 'handelsbenaming', 'voertuigsoort', 'brandstof', 'bouwjaar', 'apk_vervaldatum', 'km_stand', 'km_bron', 'catalogusprijs', 'marktwaarde_min', 'marktwaarde_max', 'liquidatiewaarde_min', 'liquidatiewaarde_max', 'waardering_toelichting'];
  const esc2 = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv = [kols.join(';'), ...cars.map((c) => kols.map((k) => esc2(c[k])).join(';'))].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = `autos-${Date.now()}.csv`; a.click();
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
