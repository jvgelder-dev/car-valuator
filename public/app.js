const $ = (id) => document.getElementById(id);

const euro = (n) =>
  n == null ? null : '€ ' + Number(n).toLocaleString('nl-NL');
const km = (n) => (n == null ? '—' : Number(n).toLocaleString('nl-NL') + ' km');

function setStatus(msg, isError = false) {
  const el = $('status');
  el.textContent = msg || '';
  el.classList.toggle('error', isError);
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  if (res.status === 401) {
    window.location.href = '/login';
    throw new Error('Niet ingelogd');
  }
  if (!res.ok) {
    let msg = `Fout ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* leeg */ }
    throw new Error(msg);
  }
  return res.status === 204 ? null : res.json();
}

// --- RDW ophalen voor preview ---
$('rdwBtn').addEventListener('click', async () => {
  const kenteken = $('kenteken').value.trim();
  if (!kenteken) return setStatus('Vul eerst een kenteken in.', true);
  const btn = $('rdwBtn');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span>';
  setStatus('');
  try {
    const d = await api(`/api/rdw/${encodeURIComponent(kenteken)}`);
    $('merk').value = d.merk || '';
    $('handelsbenaming').value = d.handelsbenaming || '';
    $('brandstof').value = d.brandstof || '';
    $('bouwjaar').value = d.bouwjaar || '';
    if (d.voertuigsoort) $('voertuigsoort').value = matchSoort(d.voertuigsoort);
    const preview = $('rdwPreview');
    preview.classList.remove('hidden');
    preview.innerHTML = `
      <b>${d.merk || ''} ${d.handelsbenaming || ''}</b><br>
      ${d.voertuigsoort || ''} · ${d.brandstof || 'onbekende brandstof'} · bouwjaar ${d.bouwjaar || '?'}<br>
      ${d.catalogusprijs ? 'Cat.prijs € ' + Number(d.catalogusprijs).toLocaleString('nl-NL') + ' · ' : ''}
      APK tot ${d.apk_vervaldatum || 'onbekend'}
    `;
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'RDW ophalen';
  }
});

function matchSoort(soort) {
  const s = soort.toLowerCase();
  if (s.includes('bedrijf') || s.includes('bestel')) return 'Bedrijfsauto';
  if (s.includes('vracht')) return 'Vrachtauto';
  if (s.includes('trekker')) return 'Trekker';
  return 'Personenauto';
}

// --- Auto toevoegen ---
$('addForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const payload = {
    kenteken: $('kenteken').value.trim() || null,
    merk: $('merk').value.trim() || null,
    handelsbenaming: $('handelsbenaming').value.trim() || null,
    voertuigsoort: $('voertuigsoort').value || null,
    brandstof: $('brandstof').value.trim() || null,
    bouwjaar: $('bouwjaar').value ? parseInt($('bouwjaar').value, 10) : null,
    km_stand: $('km_stand').value || null,
  };
  if (!payload.kenteken && !payload.merk) {
    return setStatus('Vul een kenteken in of voer handmatig merk/model in.', true);
  }
  setStatus('Toevoegen…');
  try {
    await api('/api/cars', { method: 'POST', body: JSON.stringify(payload) });
    e.target.reset();
    $('rdwPreview').classList.add('hidden');
    setStatus('Toegevoegd.');
    await laadCars();
  } catch (err) {
    setStatus(err.message, true);
  }
});

// --- Lijst laden en renderen ---
async function laadCars() {
  const cars = await api('/api/cars');
  $('count').textContent = cars.length;
  const body = $('carsBody');
  body.innerHTML = '';
  $('empty').classList.toggle('hidden', cars.length > 0);

  for (const car of cars) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>
        <div class="voertuig-naam">${esc(car.merk || '?')} ${esc(car.handelsbenaming || '')}</div>
        <div class="voertuig-sub">${esc(car.kenteken || 'handmatig')} · ${esc(car.brandstof || '')}</div>
      </td>
      <td>${car.bouwjaar || '—'}</td>
      <td>${km(car.km_stand)}<div class="km-bron">${car.km_bron === 'cbs-schatting' ? 'schatting' : car.km_bron || ''}</div></td>
      <td>${waardeCel(car.marktwaarde_min, car.marktwaarde_max, 'markt')}</td>
      <td>${waardeCel(car.liquidatiewaarde_min, car.liquidatiewaarde_max, 'liq')}</td>
      <td class="acties"></td>
    `;
    const acties = tr.querySelector('.acties');

    const valBtn = document.createElement('button');
    valBtn.className = 'primary';
    valBtn.textContent = car.waardering_datum ? 'Herwaardeer' : 'Waarde bepalen';
    valBtn.onclick = () => waardeer(car.id, valBtn);
    acties.appendChild(valBtn);

    if (car.waardering_datum) {
      const infoBtn = document.createElement('button');
      infoBtn.className = 'secondary';
      infoBtn.textContent = 'Details';
      infoBtn.onclick = () => toonDetails(car);
      acties.appendChild(infoBtn);
    }

    const delBtn = document.createElement('button');
    delBtn.className = 'secondary';
    delBtn.textContent = 'Verwijder';
    delBtn.onclick = () => verwijder(car.id);
    acties.appendChild(delBtn);

    body.appendChild(tr);
  }
}

function waardeCel(min, max, klasse) {
  if (min == null && max == null) return '<span class="geen-waarde">—</span>';
  const tekst = min === max ? euro(min) : `${euro(min)} – ${euro(max)}`;
  return `<span class="bedrag ${klasse}">${tekst}</span>`;
}

async function waardeer(id, btn) {
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Zoeken…';
  setStatus('AI zoekt vergelijkbare advertenties en veilingresultaten… dit kan even duren.');
  try {
    await api(`/api/cars/${id}/valuate`, { method: 'POST' });
    setStatus('Waardering bijgewerkt.');
    await laadCars();
  } catch (err) {
    setStatus('Waardering mislukt: ' + err.message, true);
    btn.disabled = false;
    btn.textContent = 'Waarde bepalen';
  }
}

async function verwijder(id) {
  if (!confirm('Deze auto verwijderen?')) return;
  try {
    await api(`/api/cars/${id}`, { method: 'DELETE' });
    await laadCars();
  } catch (err) {
    setStatus(err.message, true);
  }
}

function toonDetails(car) {
  const bronnen = (car.waardering_bronnen || [])
    .map((b) => `<li>${esc(typeof b === 'string' ? b : JSON.stringify(b))}</li>`)
    .join('');
  $('modalContent').innerHTML = `
    <h3>${esc(car.merk || '')} ${esc(car.handelsbenaming || '')}</h3>
    <dl>
      <dt>Kenteken</dt><dd>${esc(car.kenteken || '—')}</dd>
      <dt>Bouwjaar</dt><dd>${car.bouwjaar || '—'}</dd>
      <dt>Km-stand</dt><dd>${km(car.km_stand)} (${car.km_bron || '—'})</dd>
      <dt>Marktwaarde</dt><dd>${waardeCel(car.marktwaarde_min, car.marktwaarde_max, 'markt')}</dd>
      <dt>Liquidatiewaarde</dt><dd>${waardeCel(car.liquidatiewaarde_min, car.liquidatiewaarde_max, 'liq')}</dd>
      <dt>Bepaald op</dt><dd>${car.waardering_datum ? new Date(car.waardering_datum).toLocaleString('nl-NL') : '—'}</dd>
    </dl>
    <p><b>Toelichting</b><br>${esc(car.waardering_toelichting || '—')}</p>
    ${bronnen ? `<p><b>Bronnen</b></p><ul class="bronnen">${bronnen}</ul>` : ''}
    <p class="hint">Dit is een indicatie, geen formele taxatie.</p>
  `;
  $('detailModal').classList.remove('hidden');
}

$('modalClose').addEventListener('click', () => $('detailModal').classList.add('hidden'));
$('detailModal').addEventListener('click', (e) => {
  if (e.target === $('detailModal')) $('detailModal').classList.add('hidden');
});

$('exportBtn').addEventListener('click', () => {
  window.location.href = '/api/export';
});

$('valuateAllBtn').addEventListener('click', async () => {
  const cars = await api('/api/cars');
  const teDoen = cars.filter((c) => !c.waardering_datum);
  if (!cars.length) return setStatus('Nog geen voertuigen in de lijst.', true);
  if (!teDoen.length) return setStatus('Alle voertuigen zijn al gewaardeerd. Gebruik "Herwaardeer" per auto om opnieuw te bepalen.');
  if (!confirm(`${teDoen.length} voertuig(en) waarderen met AI. Dit kost een paar tientjes seconden per auto en verbruikt API-tegoed. Doorgaan?`)) return;

  const btn = $('valuateAllBtn'); btn.disabled = true;
  let ok = 0; const mislukt = [];
  for (let i = 0; i < teDoen.length; i++) {
    setStatus(`Waarderen: ${i + 1}/${teDoen.length} (${teDoen[i].merk || teDoen[i].kenteken || '?'})…`);
    try {
      await api(`/api/cars/${teDoen[i].id}/valuate`, { method: 'POST' });
      ok++;
      await laadCars();
    } catch (err) {
      mislukt.push(teDoen[i].merk || teDoen[i].kenteken || teDoen[i].id);
    }
  }
  btn.disabled = false;
  setStatus(`Klaar: ${ok} gewaardeerd${mislukt.length ? `, ${mislukt.length} mislukt (${mislukt.join(', ')})` : ''}.`, mislukt.length > 0);
  await laadCars();
});

$('clearAllBtn').addEventListener('click', async () => {
  const cars = await api('/api/cars');
  if (!cars.length) return setStatus('De lijst is al leeg.');
  if (!confirm(`Weet je zeker dat je alle ${cars.length} auto's wilt wissen? Dit kan niet ongedaan worden gemaakt.`)) return;
  try {
    await api('/api/cars', { method: 'DELETE' });
    setStatus('Lijst gewist.');
    await laadCars();
  } catch (err) {
    setStatus(err.message, true);
  }
});

function esc(s) {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}

// Toon de uitlog-knop alleen als er een pincode is ingesteld.
fetch('/api/me').then((r) => r.json()).then((s) => {
  if (s.pinRequired) $('logoutBtn').classList.remove('hidden');
}).catch(() => {});

$('logoutBtn').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' });
  window.location.href = '/login';
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

  let ok = 0; const mislukt = [];
  for (let i = 0; i < kentekens.length; i++) {
    const k = kentekens[i];
    st.textContent = `Bezig: ${i + 1}/${kentekens.length} (${k})…`;
    try {
      await api('/api/cars', { method: 'POST', body: JSON.stringify({ kenteken: k, requireRdw: true }) });
      ok++;
    } catch (err) {
      mislukt.push(k);
    }
  }

  $('importBtn').disabled = false;
  $('importText').value = ''; $('importFile').value = '';
  st.textContent = `Klaar: ${ok} toegevoegd${mislukt.length ? `, ${mislukt.length} niet gevonden (${mislukt.join(', ')})` : ''}.`;
  st.classList.toggle('error', mislukt.length > 0);
  await laadCars();
});

laadCars().catch((err) => setStatus(err.message, true));
