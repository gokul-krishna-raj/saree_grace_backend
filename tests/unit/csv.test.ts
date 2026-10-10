import {
  CsvParseError,
  escapeFormula,
  parseCsv,
  serializeCsv,
  unescapeFormula,
} from '../../src/utils/csv';

describe('parseCsv', () => {
  it('parses plain rows', () => {
    expect(parseCsv('a,b,c\n1,2,3\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
    ]);
  });

  it('handles quoted fields with commas, escaped quotes and embedded newlines', () => {
    const text = 'name,description\n"Saree, silk","She said ""wow""\nsecond line"\n';
    expect(parseCsv(text)).toEqual([
      ['name', 'description'],
      ['Saree, silk', 'She said "wow"\nsecond line'],
    ]);
  });

  it('handles CRLF, lone CR and a missing final newline', () => {
    expect(parseCsv('a,b\r\n1,2\r3,4')).toEqual([
      ['a', 'b'],
      ['1', '2'],
      ['3', '4'],
    ]);
  });

  it('keeps CRLF inside a quoted cell as-is', () => {
    expect(parseCsv('a\r\n"x\r\ny"\r\n')).toEqual([['a'], ['x\r\ny']]);
  });

  it('strips a leading UTF-8 BOM and keeps non-ASCII text intact', () => {
    expect(parseCsv('﻿name,price\nகாஞ்சிபுரம் பட்டு,₹2499\n')).toEqual([
      ['name', 'price'],
      ['காஞ்சிபுரம் பட்டு', '₹2499'],
    ]);
  });

  it('drops trailing blank lines but keeps empty cells and blank lines in the middle', () => {
    expect(parseCsv('a,b\n,\n\n1,\n\n\n,,\n')).toEqual([['a', 'b'], ['', ''], [''], ['1', '']]);
  });

  it('treats a stray quote inside an unquoted field literally', () => {
    expect(parseCsv('a\n5" border\n')).toEqual([['a'], ['5" border']]);
  });

  it('rejects an unterminated quoted cell with the row it started on', () => {
    expect(() => parseCsv('a,b\n1,"oops\n2,3\n')).toThrow(CsvParseError);
    expect(() => parseCsv('a,b\n1,"oops\n2,3\n')).toThrow(/Row 2/);
  });

  it('returns no rows for empty input', () => {
    expect(parseCsv('')).toEqual([]);
    expect(parseCsv('﻿\n\n')).toEqual([]);
  });
});

describe('serializeCsv', () => {
  it('quotes only cells that need it and ends rows with CRLF', () => {
    expect(serializeCsv([['a', 'b,c', 'say "hi"', 'x\ny', ' padded', 5, true, null]])).toBe(
      'a,"b,c","say ""hi""","x\ny"," padded",5,true,\r\n',
    );
  });

  it('prepends a BOM on request', () => {
    expect(serializeCsv([['a']], { bom: true })).toBe('﻿a\r\n');
  });

  it('round-trips through parseCsv', () => {
    const rows = [
      ['handle', 'description', 'price'],
      ['silk-saree', 'Line one\nLine "two", with comma', '2499'],
      ['tamil', 'காஞ்சிபுரம் பட்டுப் புடவை', ''],
      ['', '', ''],
      ['last', '  leading and trailing  ', '0'],
    ];
    expect(parseCsv(serializeCsv(rows, { bom: true }))).toEqual(rows);
  });
});

describe('formula escaping', () => {
  it.each(['=SUM(A1:A2)', '+91 98765', '-cmd', '@import', '=HYPERLINK("http://x")'])(
    'escapes %s and unescapes it again',
    (value) => {
      const escaped = escapeFormula(value);
      expect(escaped).toBe(`'${value}`);
      expect(unescapeFormula(escaped)).toBe(value);
    },
  );

  it('leaves negative numbers and ordinary text alone', () => {
    expect(escapeFormula('-5')).toBe('-5');
    expect(escapeFormula('-12.50')).toBe('-12.50');
    expect(escapeFormula('Silk saree')).toBe('Silk saree');
    expect(unescapeFormula("'quoted text")).toBe("'quoted text");
  });

  it('escapes string cells when serializing with escapeFormulas, but not numbers', () => {
    expect(serializeCsv([['=1+1', -5, '-5', '@x']], { escapeFormulas: true })).toBe(
      "'=1+1,-5,-5,'@x\r\n",
    );
  });

  it('round-trips escaped formulas through serialize → parse → unescape', () => {
    const rows = [['=cmd|calc', 'plain']];
    const parsed = parseCsv(serializeCsv(rows, { escapeFormulas: true }));
    expect(parsed.map((row) => row.map(unescapeFormula))).toEqual(rows);
  });
});
