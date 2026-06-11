import ExcelJS from 'exceljs';

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

  return wb.xlsx.writeBuffer();
}
