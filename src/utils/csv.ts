/**
 * Minimal, dependency-free RFC 4180 CSV parser/serializer — used by the
 * admin product import/export (src/modules/product/product-io.service.ts).
 *
 * Parsing handles quoted fields, escaped quotes (""), embedded commas and
 * newlines, CRLF/LF/CR line endings, a leading UTF-8 BOM and trailing blank
 * lines. It is deliberately lenient about stray quotes inside unquoted
 * fields (treated as literal characters, the way Excel/Sheets do) and only
 * rejects an unterminated quoted field, which would otherwise silently
 * swallow the rest of the file.
 */

export class CsvParseError extends Error {
  constructor(
    message: string,
    public readonly row: number,
  ) {
    super(message);
    this.name = 'CsvParseError';
  }
}

const BOM = '﻿';

export function parseCsv(input: string): string[][] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let quotedFieldStartRow = 0;
  let i = 0;

  const endField = () => {
    row.push(field);
    field = '';
  };
  const endRow = () => {
    endField();
    rows.push(row);
    row = [];
  };

  while (i < text.length) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      field += char;
      i += 1;
      continue;
    }

    if (char === '"' && field === '') {
      inQuotes = true;
      quotedFieldStartRow = rows.length + 1;
      i += 1;
    } else if (char === ',') {
      endField();
      i += 1;
    } else if (char === '\r') {
      endRow();
      i += text[i + 1] === '\n' ? 2 : 1;
    } else if (char === '\n') {
      endRow();
      i += 1;
    } else {
      field += char;
      i += 1;
    }
  }

  if (inQuotes) {
    throw new CsvParseError(
      `Row ${quotedFieldStartRow}: a quoted cell is never closed (missing ")`,
      quotedFieldStartRow,
    );
  }
  // A file that doesn't end in a newline still has a final record pending.
  if (field !== '' || row.length > 0) {
    endRow();
  }

  // Trailing blank lines (common when a spreadsheet pads the export).
  while (rows.length > 0 && isBlankRow(rows[rows.length - 1] as string[])) {
    rows.pop();
  }
  return rows;
}

export function isBlankRow(row: string[]): boolean {
  return row.every((cell) => cell.trim() === '');
}

// A cell beginning with one of these is interpreted as a formula by
// Excel/Sheets ("CSV injection") — e.g. =HYPERLINK(...) in a product name.
const FORMULA_PREFIX_RE = /^[=+\-@]/;
// ...but a plain negative number is just a number.
const NEGATIVE_NUMBER_RE = /^-\d+(\.\d+)?$/;

/** Prefixes a formula-like cell with `'` so spreadsheets show it as text. */
export function escapeFormula(value: string): string {
  if (FORMULA_PREFIX_RE.test(value) && !NEGATIVE_NUMBER_RE.test(value)) {
    return `'${value}`;
  }
  return value;
}

/** Reverses escapeFormula() on import. */
export function unescapeFormula(value: string): string {
  if (value.length > 1 && value.startsWith("'") && FORMULA_PREFIX_RE.test(value.slice(1))) {
    return value.slice(1);
  }
  return value;
}

export type CsvCell = string | number | boolean | null | undefined;

function serializeCell(cell: CsvCell, escapeFormulas: boolean): string {
  if (cell === null || cell === undefined) return '';
  let value = typeof cell === 'string' ? cell : String(cell);
  if (escapeFormulas && typeof cell === 'string') {
    value = escapeFormula(value);
  }
  if (/[",\r\n]/.test(value) || value !== value.trim()) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export interface SerializeCsvOptions {
  /** Prepend a UTF-8 BOM so Excel detects the encoding (₹, Tamil text). */
  bom?: boolean;
  /** Escape formula-like string cells (see escapeFormula). */
  escapeFormulas?: boolean;
}

export function serializeCsv(rows: CsvCell[][], options: SerializeCsvOptions = {}): string {
  const body = rows
    .map((row) => row.map((cell) => serializeCell(cell, options.escapeFormulas ?? false)).join(','))
    .join('\r\n');
  return `${options.bom ? BOM : ''}${body}\r\n`;
}
