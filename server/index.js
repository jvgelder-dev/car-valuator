import express from 'express';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { listCars, getCar, createCar, updateCar, deleteCar } from './db.js';
import { fetchRdw } from './rdw.js';
import { schatKilometerstand } from './cbs.js';
import { bepaalWaardering } from './valuation.js';
import { bouwExcel } from './export.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Laad .env (indien aanwezig) via de ingebouwde Node-loader, zonder extra dependency.
try {
  process.loadEnvFile(join(__dirname, '..', '.env'));
} catch {
  // Geen .env-bestand — variabelen komen dan uit de omgeving zelf.
}

const app = express();
app.use(express.json());
app.use(express.static(join(__dirname, '..', 'public')));

const wrap = (fn) => (req, res) => fn(req, res).catch((err) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Onbekende fout' });
});

// --- RDW ophalen (zonder opslaan) ---
app.get('/api/rdw/:kenteken', wrap(async (req, res) => {
  const { normalized, raw } = await fetchRdw(req.params.kenteken);
  res.json({ ...normalized, rdw_raw: raw });
}));

// --- Auto's CRUD ---
app.get('/api/cars', wrap(async (_req, res) => {
  res.json(listCars());
}));

app.post('/api/cars', wrap(async (req, res) => {
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

app.put('/api/cars/:id', wrap(async (req, res) => {
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

app.delete('/api/cars/:id', wrap(async (req, res) => {
  if (!deleteCar(req.params.id)) return res.status(404).json({ error: 'Auto niet gevonden' });
  res.status(204).end();
}));

// --- Waardering bepalen (AI + websearch) ---
app.post('/api/cars/:id/valuate', wrap(async (req, res) => {
  const car = getCar(req.params.id);
  if (!car) return res.status(404).json({ error: 'Auto niet gevonden' });
  const waardering = await bepaalWaardering(car);
  res.json(updateCar(car.id, waardering));
}));

// --- Excel-export ---
app.get('/api/export', wrap(async (_req, res) => {
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
