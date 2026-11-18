export interface CsvSection {
  name: string;
  columns: string[];
  units: string[];
  rows: string[][];
  keyValue: boolean;
}

function detectDelimiter(text: string): string {
  let quoted = false;
  let semicolons = 0;
  let commas = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && (char === "\n" || char === "\r")) {
      if (semicolons || commas) return semicolons ? ";" : ",";
    } else if (!quoted && char === ";") semicolons++;
    else if (!quoted && char === ",") commas++;
  }
  return semicolons || !commas ? ";" : ",";
}

function readRows(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let closedQuote = false;

  const endField = () => {
    row.push(field);
    field = "";
    closedQuote = false;
  };
  const endRow = () => {
    endField();
    if (row.length > 1 || row[0].trim()) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
      if (!quoted) closedQuote = true;
    } else if (char === delimiter) endField();
    else if (char === "\r" || char === "\n") {
      if (char === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else if (char === '"' && field === "" && !closedQuote) quoted = true;
    else if (closedQuote || char === '"') throw new Error("Invalid quoted CSV field");
    else field += char;
  }
  if (quoted) throw new Error("Unterminated quoted CSV field");
  if (field || row.length || closedQuote) endRow();
  return rows;
}

function isUnitRow(row: string[], allowEmpty = false): boolean {
  const cells = row.map((value) => value.trim());
  return cells.every((value) => !value || value === "-" || /^\[.+\]$/.test(value)) &&
    (cells.some((value) => /^\[.+\]$/.test(value)) || (allowEmpty && cells.every((value) => !value)));
}

function makeSection(name: string, rows: string[][], forcedTable = false): CsvSection {
  const hasUnits = rows.length > 1 && isUnitRow(rows[1], forcedTable);
  const sectionNameIsHeader = rows[0]?.[0]?.trim().toLowerCase() === name.toLowerCase() &&
    rows[0].filter((value) => value.trim()).length > 2;
  const keyValue = name !== "Data" && !forcedTable && !hasUnits && !sectionNameIsHeader;
  if (keyValue) {
    const width = rows.reduce((max, row) => Math.max(max, row.length), 2);
    return {
      name, keyValue, units: [], rows,
      columns: Array.from({ length: width }, (_, index) =>
        index === 0 ? "Field" : index === 1 ? "Value" : `Value ${index}`,
      ),
    };
  }
  const [header = [], ...data] = rows;
  const units = hasUnits ? data.shift()! : [];
  let width = data.reduce((max, row) => Math.max(max, row.length), Math.max(header.length, units.length));
  while (width > 0 && !header[width - 1]?.trim() && !units[width - 1]?.trim() &&
         data.every((row) => !row[width - 1]?.trim())) width--;
  const columns = Array.from({ length: width }, (_, index) => header[index] || `Column ${index + 1}`);
  return { name, keyValue, columns, units, rows: data };
}

export function parseCsvReport(text: string): CsvSection[] {
  const source = text.replace(/^\uFEFF/, "");
  const rows = readRows(source, detectDelimiter(source));
  const sections: CsvSection[] = [];
  let name = "Data";
  let sectionRows: string[][] = [];
  let table = false;
  let sectionHasBlock = false;
  const structured = rows[0]?.length === 1 && /^\[(Header|Results|Measurement)\]$/i.test(rows[0][0].trim());
  const flush = () => {
    if (!sectionRows.length) return;
    const section = makeSection(name, sectionRows, table);
    if (table && sectionHasBlock) section.name = `${name} — Table`;
    sections.push(section);
    sectionRows = [];
    sectionHasBlock = true;
  };
  for (const row of rows) {
    const marker = structured && row.length === 1 ? /^\[([^\[\]]+)\]$/.exec(row[0].trim()) : null;
    if (marker) {
      flush();
      name = marker[1];
      table = false;
      sectionHasBlock = false;
    } else if (structured && row.length === 1 && row[0].trim() === "$Table") {
      flush();
      table = true;
    } else sectionRows.push(row);
  }
  flush();
  if (!sections.length) throw new Error("CSV file is empty");
  return sections;
}
