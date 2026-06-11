import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = join(__dirname, '..', 'data');
mkdirSync(dataDir, { recursive: true });

const db = new Database(join(dataDir, 'cars.db'));
db.pragma('journal_mode = WAL');

// Eén tabel met alle auto's. De ruwe RDW-respons en de waardering worden
// als JSON-tekst bewaard zodat de lijst tussen sessies behouden blijft.
db.exec(`
  CREATE TABLE IF NOT EXISTS cars (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    kenteken TEXT,
    merk TEXT,
    handelsbenaming TEXT,
    voertuigsoort TEXT,
    brandstof TEXT,
    bouwjaar INTEGER,
    datum_eerste_toelating TEXT,
    catalogusprijs INTEGER,
    massa_ledig INTEGER,
    apk_vervaldatum TEXT,
    km_stand INTEGER,
    km_bron TEXT,                 -- 'handmatig' of 'cbs-schatting'
    marktwaarde_min INTEGER,
    marktwaarde_max INTEGER,
    liquidatiewaarde_min INTEGER,
    liquidatiewaarde_max INTEGER,
    waardering_toelichting TEXT,
    waardering_bronnen TEXT,      -- JSON array
    waardering_datum TEXT,
    rdw_raw TEXT,                 -- JSON
    notities TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );
`);

function parseRow(row) {
  if (!row) return row;
  return {
    ...row,
    waardering_bronnen: row.waardering_bronnen ? JSON.parse(row.waardering_bronnen) : [],
    rdw_raw: row.rdw_raw ? JSON.parse(row.rdw_raw) : null,
  };
}

export function listCars() {
  return db.prepare('SELECT * FROM cars ORDER BY created_at DESC').all().map(parseRow);
}

export function getCar(id) {
  return parseRow(db.prepare('SELECT * FROM cars WHERE id = ?').get(id));
}

export function createCar(data) {
  const stmt = db.prepare(`
    INSERT INTO cars (
      kenteken, merk, handelsbenaming, voertuigsoort, brandstof, bouwjaar,
      datum_eerste_toelating, catalogusprijs, massa_ledig, apk_vervaldatum,
      km_stand, km_bron, rdw_raw, notities
    ) VALUES (
      @kenteken, @merk, @handelsbenaming, @voertuigsoort, @brandstof, @bouwjaar,
      @datum_eerste_toelating, @catalogusprijs, @massa_ledig, @apk_vervaldatum,
      @km_stand, @km_bron, @rdw_raw, @notities
    )
  `);
  const info = stmt.run(normalize(data));
  return getCar(info.lastInsertRowid);
}

export function updateCar(id, data) {
  const current = db.prepare('SELECT * FROM cars WHERE id = ?').get(id);
  if (!current) return null;
  const merged = { ...current, ...normalize(data), updated_at: new Date().toISOString() };
  db.prepare(`
    UPDATE cars SET
      kenteken=@kenteken, merk=@merk, handelsbenaming=@handelsbenaming,
      voertuigsoort=@voertuigsoort, brandstof=@brandstof, bouwjaar=@bouwjaar,
      datum_eerste_toelating=@datum_eerste_toelating, catalogusprijs=@catalogusprijs,
      massa_ledig=@massa_ledig, apk_vervaldatum=@apk_vervaldatum,
      km_stand=@km_stand, km_bron=@km_bron,
      marktwaarde_min=@marktwaarde_min, marktwaarde_max=@marktwaarde_max,
      liquidatiewaarde_min=@liquidatiewaarde_min, liquidatiewaarde_max=@liquidatiewaarde_max,
      waardering_toelichting=@waardering_toelichting, waardering_bronnen=@waardering_bronnen,
      waardering_datum=@waardering_datum, rdw_raw=@rdw_raw, notities=@notities,
      updated_at=@updated_at
    WHERE id=@id
  `).run({ ...merged, id });
  return getCar(id);
}

export function deleteCar(id) {
  return db.prepare('DELETE FROM cars WHERE id = ?').run(id).changes > 0;
}

export function deleteAllCars() {
  return db.prepare('DELETE FROM cars').run().changes;
}

// Zet objecten/arrays om naar JSON-tekst voor opslag en vul ontbrekende velden.
function normalize(data) {
  const out = { ...data };
  if (out.rdw_raw && typeof out.rdw_raw !== 'string') out.rdw_raw = JSON.stringify(out.rdw_raw);
  if (out.waardering_bronnen && typeof out.waardering_bronnen !== 'string') {
    out.waardering_bronnen = JSON.stringify(out.waardering_bronnen);
  }
  const fields = [
    'kenteken', 'merk', 'handelsbenaming', 'voertuigsoort', 'brandstof', 'bouwjaar',
    'datum_eerste_toelating', 'catalogusprijs', 'massa_ledig', 'apk_vervaldatum',
    'km_stand', 'km_bron', 'marktwaarde_min', 'marktwaarde_max', 'liquidatiewaarde_min',
    'liquidatiewaarde_max', 'waardering_toelichting', 'waardering_bronnen',
    'waardering_datum', 'rdw_raw', 'notities',
  ];
  for (const f of fields) if (out[f] === undefined) out[f] = null;
  return out;
}

export default db;
