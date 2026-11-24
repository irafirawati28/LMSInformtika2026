import ExcelJS from "exceljs";

type SpreadsheetCell = string | number | Date | null;

export async function createExcelWorkbook(
  sheetName: string,
  headers: string[],
  rows: SpreadsheetCell[][],
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "KANAL INFORMATIKA IBU IRA";
  workbook.created = new Date();
  const worksheet = workbook.addWorksheet(sheetName);
  worksheet.columns = headers.map((header, index) => ({
    header,
    key: `column${index}`,
    width: Math.min(Math.max(header.length + 3, 14), 36),
  }));
  worksheet.views = [{ state: "frozen", ySplit: 1 }];
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: headers.length },
  };
  worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  worksheet.getRow(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF173B5E" },
  };

  for (const row of rows) {
    worksheet.addRow(row.map((cell) =>
      typeof cell === "string" && /^[\s]*[=+\-@]/.test(cell)
        ? `'${cell}`
        : cell,
    ));
  }

  return Buffer.from(await workbook.xlsx.writeBuffer());
}
