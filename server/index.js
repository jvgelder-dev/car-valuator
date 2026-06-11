import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listCars, getCar, createCar, updateCar, deleteCar } from './db.js';
import { fetchRdw } from './rdw.js';
import { schatKilometerstand } from './cbs.js';
import { bepaalWaardering } from './valuation.js';
import { bouwExcel } from './export.js';
import {
  pinRequired, pinMatches, setAuthCookie, clearAuthCookie, isAuthed, requireAuth,
} from './auth.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Laad .env (indien aanwezig) via de ingebouwde Node-loader, zonder extra dependency.
try {
  process.loadEnvFile(join(__dirname, '..', '.env'));
} catch {
  // Geen .env-bestand — variabelen komen dan uit de omgeving zelf.
}

const app = express();
app.set('trust proxy', true); // nodig achter de https-proxy van Fly/Render
app.use(express.json());

const publicDir = join(__dirname, '..', 'public');
const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Onbekende fout' });
});

// --- Authenticatie (publieke routes) ---
app.get('/login', (_req, res) => res.sendFile(join(publicDir, 'login.html')));

app.get('/api/me', (req, res) => {
  res.json({ pinRequired: pinRequired(), authed: isAuthed(req) });
});

app.post('/api/login', (req, res) => {
  if (!pinRequired()) return res.json({ ok: true }); // geen pincode ingesteld
  if (pinMatches((req.body || {}).pin)) {
    setAuthCookie(req, res);
    return res.json({ ok: true });
  }
  return res.status(401).json({ error: 'Onjuiste pincode' });
});

app.post('/api/logout', (_req, res) => {
  clearAuthCookie(res);
  res.json({ ok: true });
});

// Statische assets (css/js) zijn niet gevoelig; alle data zit achter /api.
app.use(express.static(publicDir, { index: false }));

// Hoofdpagina zit achter de login.
app.get(['/', '/index.html'], requireAuth, (_req, res) => {
  res.sendFile(join(publicDir, 'index.html'));
});

// --- RDW ophalen (zonder opslaan) ---
app.get('/api/rdw/:kenteken', requireAuth, wrap(async (req, res) => {
  const { normalized, raw } = await fetchRdw(req.params.kenteken);
  res.json({ ...normalized, rdw_raw: raw });
}));

// --- Auto's CRUD ---
app.get('/api/cars', requireAuth, wrap(async (_req, res) => {
  res.json(listCars());
}));

app.post('/api/cars', requireAuth, wrap(async (req, res) => {
  const body = req.body || {};
  let data = { ...body };

  // Als een kenteken is opgegeven maar geen RDW-data, haal die alsnog op.
  if (data.kenteken && !data.merk) {
    try {
      const { normalized, raw } = await fetchRdw(data.kenteken);
      data = { ...normalized, ...data, rdw_raw: raw };
    } catch (err) {
      if (err.status !== 404) throw err; // 404: handmatige invoer toestaan
    }
  }

  // Kilometerstand: handmatig of CBS-schatting.
  if (data.km_stand != null && data.km_stand !== '') {
    data.km_stand = parseInt(data.km_stand, 10);
    data.km_bron = 'handmatig';
  } else {
    data.km_stand = schatKilometerstand(data);
    data.km_bron = data.km_stand != null ? 'cbs-schatting' : null;
  }

  res.status(201).json(createCar(data));
}));

app.put('/api/cars/:id', requireAuth, wrap(async (req, res) => {
  const body = req.body || {};
  const data = { ...body };
  if (data.km_stand != null && data.km_stand !== '') {
    data.km_stand = parseInt(data.km_stand, 10);
    data.km_bron = 'handmatig';
  }
  const car = updateCar(req.params.id, data);
  if (!car) return res.status(404).json({ error: 'Auto niet gevonden' });
  res.json(car);
}));

app.delete('/api/cars/:id', requireAuth, wrap(async (req, res) => {
  if (!deleteCar(req.params.id)) return res.status(404).json({ error: 'Auto niet gevonden' });
  res.status(204).end();
}));

// --- Waardering bepalen (AI + websearch) ---
app.post('/api/cars/:id/valuate', requireAuth, wrap(async (req, res) => {
  const car = getCar(req.params.id);
  if (!car) return res.status(404).json({ error: 'Auto niet gevonden' });
  const waardering = await bepaalWaardering(car);
  res.json(updateCar(car.id, waardering));
}));

// --- Excel-export ---
app.get('/api/export', requireAuth, wrap(async (_req, res) => {
  const buffer = await bouwExcel(listCars());
  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
  res.setHeader('Content-Disposition', `attachment; filename="autos-${Date.now()}.xlsx"`);
  res.end(Buffer.from(buffer));
}));

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Car Valuator draait op http://localhost:${port}`);
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('Let op: ANTHROPIC_API_KEY niet gezet — de AI-waardering werkt dan niet.');
  }
});
