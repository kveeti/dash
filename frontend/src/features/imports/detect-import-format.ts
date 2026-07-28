export type ImportFormat = "nordea" | "op" | "revolut";

type Header = {
  format: ImportFormat;
  delimiter: string;
  columns: ReadonlyArray<string>;
};

const headers: ReadonlyArray<Header> = [
  {
    format: "nordea",
    delimiter: ";",
    columns: [
      "Kirjauspäivä",
      "Määrä",
      "Maksaja",
      "Maksunsaaja",
      "Nimi",
      "Otsikko",
      "Viesti",
      "Viitenumero",
      "Saldo",
      "Valuutta",
    ],
  },
  {
    format: "op",
    delimiter: ";",
    columns: [
      "Kirjauspäivä",
      "Arvopäivä",
      "Määrä EUROA",
      "Laji",
      "Selitys",
      "Saaja/Maksaja",
      "Saajan tilinumero",
      "Saajan pankin BIC",
      "Viite",
      "Viesti",
      "Arkistointitunnus",
    ],
  },
  {
    format: "revolut",
    delimiter: ",",
    columns: [
      "Type",
      "Product",
      "Started Date",
      "Completed Date",
      "Description",
      "Amount",
      "Fee",
      "Currency",
      "State",
      "Balance",
    ],
  },
];

function parseCsvRow(row: string, delimiter: string) {
  const columns: string[] = [];
  let column = "";
  let quoted = false;

  for (let index = 0; index < row.length; index++) {
    const character = row[index];
    if (character === '"') {
      if (quoted && row[index + 1] === '"') {
        column += '"';
        index++;
      } else {
        quoted = !quoted;
      }
    } else if (character === delimiter && !quoted) {
      columns.push(column.trim());
      column = "";
    } else if (character !== "\r" && character !== "\n") {
      column += character;
    }
  }

  if (quoted) return null;
  columns.push(column.trim());
  return columns;
}

export async function detectImportFormat(
  file: File,
): Promise<ImportFormat | null> {
  const bytes = new Uint8Array(await file.slice(0, 8192).arrayBuffer());
  const newline = bytes.indexOf(10);
  const headerBytes = newline === -1 ? bytes : bytes.subarray(0, newline + 1);
  let header: string;
  try {
    header = new TextDecoder("utf-8", { fatal: true }).decode(headerBytes);
  } catch {
    header = new TextDecoder("iso-8859-1").decode(headerBytes);
  }
  header = header.replace(/^\ufeff/, "");

  for (const expected of headers) {
    const columns = parseCsvRow(header, expected.delimiter);
    if (
      columns &&
      expected.columns.every((column, index) => columns[index] === column)
    ) {
      return expected.format;
    }
  }
  return null;
}
