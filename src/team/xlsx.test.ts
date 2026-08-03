import { describe, expect, it } from 'vitest'
import { buildWorkbook, columnName, sheetName } from './xlsx'

const decoder = new TextDecoder()
const text = (bytes: Uint8Array) => decoder.decode(bytes)

describe('spreadsheet column names', () => {
  it('runs past the end of the alphabet correctly', () => {
    expect(columnName(0)).toBe('A')
    expect(columnName(25)).toBe('Z')
    expect(columnName(26)).toBe('AA')
    expect(columnName(27)).toBe('AB')
    expect(columnName(51)).toBe('AZ')
    expect(columnName(52)).toBe('BA')
  })
})

describe('sheet names', () => {
  it('strips the characters Excel refuses and clips to 31', () => {
    const taken = new Set<string>()
    expect(sheetName('a/b[c]d:e*f?g\\h', taken)).toBe('a b c d e f g h')
    expect(sheetName('x'.repeat(60), taken)).toHaveLength(31)
  })

  it('never repeats a name, because Excel rejects duplicates', () => {
    const taken = new Set<string>()
    const first = sheetName('Rowan', taken)
    const second = sheetName('Rowan', taken)
    const third = sheetName('rowan', taken)

    expect(first).toBe('Rowan')
    expect(second).not.toBe(first)
    expect(third).not.toBe(first)
    expect(third).not.toBe(second)
  })

  it('falls back rather than producing a blank name', () => {
    expect(sheetName('', new Set())).toBe('Sheet')
    expect(sheetName('///', new Set())).toBe('Sheet')
  })

  it('keeps a deduplicated long name within the limit', () => {
    const taken = new Set<string>()
    sheetName('y'.repeat(31), taken)
    expect(sheetName('y'.repeat(31), taken).length).toBeLessThanOrEqual(31)
  })
})

describe('workbook file', () => {
  const workbook = () => buildWorkbook([
    { name: 'Summary', rows: [['Player', 'Score'], ['Ada', 120.5]] },
    { name: 'Rounds', rows: [['Round'], [1]] },
  ], new Date('2026-08-02T10:00:00Z'))

  it('starts with the ZIP signature an xlsx must have', () => {
    const bytes = workbook()
    expect([...bytes.slice(0, 4)]).toEqual([0x50, 0x4B, 0x03, 0x04])
  })

  it('ends with the central directory record', () => {
    const bytes = workbook()
    const tail = bytes.slice(-22)
    expect([...tail.slice(0, 4)]).toEqual([0x50, 0x4B, 0x05, 0x06])
    // Four fixed parts plus one per sheet.
    expect(new DataView(tail.buffer, tail.byteOffset).getUint16(10, true)).toBe(6)
  })

  it('contains every part Excel looks for', () => {
    const body = text(workbook())
    for (const part of [
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]) {
      expect(body).toContain(part)
    }
  })

  it('writes numbers as numbers and text as inline strings', () => {
    const body = text(workbook())
    expect(body).toContain('<v>120.5</v>')
    expect(body).toContain('<is><t xml:space="preserve">Ada</t></is>')
  })

  it('escapes characters that would otherwise break the XML', () => {
    const body = text(buildWorkbook([
      { name: 'S', rows: [['Ada & "Ace" <Lovelace>']] },
    ]))

    expect(body).toContain('Ada &amp; &quot;Ace&quot; &lt;Lovelace&gt;')
    expect(body).not.toContain('<Lovelace>')
  })

  it('drops control characters rather than producing a file Excel rejects', () => {
    const body = text(buildWorkbook([
      { name: 'S', rows: [[`bad\u0000char\u001F`]] },
    ]))

    expect(body).toContain('badchar')
  })

  it('skips empty cells instead of writing hollow ones', () => {
    const body = text(buildWorkbook([
      { name: 'S', rows: [['A', null, undefined, '', 'E']] },
    ]))

    expect(body).toContain('r="A1"')
    expect(body).toContain('r="E1"')
    expect(body).not.toContain('r="B1"')
  })

  it('refuses a workbook with no sheets', () => {
    expect(() => buildWorkbook([])).toThrow(/at least one sheet/)
  })

  it('is byte-identical for the same input, so downloads are reproducible', () => {
    const when = new Date('2026-08-02T10:00:00Z')
    const first = buildWorkbook([{ name: 'S', rows: [['a', 1]] }], when)
    const second = buildWorkbook([{ name: 'S', rows: [['a', 1]] }], when)

    expect([...first]).toEqual([...second])
  })
})
