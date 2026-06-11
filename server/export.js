import ExcelJS from 'exceljs';
import { categorieen, restwaarde } from './depreciation.js';

const JAREN = 15; // aantal leeftijdsjaren in de referentietabel

function voegReferentietabelToe(wb) {
  const ws = wb.addWorksheet('Afschrijvingscurves');

  ws.mergeCells(1, 1, 1, JAREN + 3);
  ws.getCell('A1').value = 'Afschrijvingscurves — restwaarde als % van de catalogusprijs per leeftijdsjaar';
  ws.getCell('A1').font = { bold: true, size: 12 };

  const headers = ['Categorie', 'Basis (bron)', 'Nieuw'];
  for (let j = 1; j <= JAREN; j++) headers.push(`${j} jr`);
  headers.push('Verlies na 5 jr');
  const headerRow = ws.addRow(headers);
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F2937' } };
  });

  for (const cat of categorieen) {
    const rij = [cat.naam, cat.bron, '100%'];
    for (let j = 1; j <= JAREN; j++) rij.push(`${Math.round(restwaarde(cat, j) * 100)}%`);
    rij.push(`${Math.round((1 - restwaarde(cat, 5)) * 100)}%`);
    ws.addRow(rij);
  }

  ws.getColumn(1).width = 30;
  ws.getColumn(2).width = 42;
  for (let c = 3; c <= JAREN + 3; c++) ws.getColumn(c).width = 8;

  ws.addRow([]);
  const noot = ws.addRow(['Degressieve afschrijving (sneller in de eerste jaren); bestel/vracht lineair. Indicatie op basis van ANWB/BOVAG, iSeeCars, Belastingdienst en marktdata.']);
  ws.mergeCells(noot.number, 1, noot.number, JAREN + 3);
  noot.getCell(1).font = { italic: true, color: { argb: 'FF6B7280' } };
}

export async function bouwExcel(cars) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Car Valuator';
  wb.created = new Date();
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
    { header: 'Waardering datum', key: 'waardering_datum', width: 20 },
    { header: 'Notities', key: 'notities', width: 30 },
  ];

  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF1F2937' },
  };
  ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  for (const car of cars) {
    ws.addRow({
      ...car,
      waardering_datum: car.waardering_datum
        ? new Date(car.waardering_datum).toLocaleString('nl-NL')
        : '',
    });
  }

  voegReferentietabelToe(wb);

  return wb.xlsx.writeBuffer();
}
