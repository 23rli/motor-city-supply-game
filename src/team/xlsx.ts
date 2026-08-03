/**
 * Minimal multi-sheet .xlsx writer. An xlsx is a ZIP of XML parts, so this builds those
 * directly rather than pulling in a spreadsheet library for a handful of tables.
 */

export type CellValue = string | number | null | undefined

export interface Sheet {
  name: string
  rows: CellValue[][]
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let index = 0; index < 256; index += 1) {
    let value = index
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xEDB88320 ^ (value >>> 1) : value >>> 1
    }
    table[index] = value >>> 0
  }
  return table
})()

const crc32 = (bytes: Uint8Array) => {
  let crc = 0xFFFFFFFF
  for (const byte of bytes) {
    crc = CRC_TABLE[(crc ^ byte) & 0xFF] ^ (crc >>> 8)
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Excel rejects control characters outright, so drop the ones XML cannot carry.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')

/** A1, B1 ... Z1, AA1. */
export const columnName = (index: number) => {
  let name = ''
  let remaining = index
  while (remaining >= 0) {
    name = String.fromCharCode(65 + (remaining % 26)) + name
    remaining = Math.floor(remaining / 26) - 1
  }
  return name
}

const FORBIDDEN_SHEET_CHARS = /[[\]:*?/\\]/g

/** Excel refuses names over 31 characters, containing []:*?/\, blank, or duplicated. */
export function sheetName(raw: string, taken: Set<string>) {
  let base = (raw || 'Sheet').replace(FORBIDDEN_SHEET_CHARS, ' ').trim().slice(0, 31)
  if (!base) base = 'Sheet'
  let candidate = base
  let suffix = 2
  while (taken.has(candidate.toLowerCase())) {
    const tail = ` (${suffix})`
    candidate = `${base.slice(0, 31 - tail.length)}${tail}`
    suffix += 1
  }
  taken.add(candidate.toLowerCase())
  return candidate
}

const sheetXml = (rows: CellValue[][]) => {
  const body = rows.map((row, rowIndex) => {
    const cells = row.map((value, columnIndex) => {
      if (value === null || value === undefined || value === '') return ''
      const reference = `${columnName(columnIndex)}${rowIndex + 1}`
      if (typeof value === 'number' && Number.isFinite(value)) {
        return `<c r="${reference}"><v>${value}</v></c>`
      }
      return `<c r="${reference}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`
    }).join('')
    return `<row r="${rowIndex + 1}">${cells}</row>`
  }).join('')

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">`
    + `<sheetData>${body}</sheetData></worksheet>`
}

const encoder = new TextEncoder()

interface Entry {
  path: string
  data: Uint8Array
}

const dosStamp = (date: Date) => ({
  time: (date.getHours() << 11) | (date.getMinutes() << 5) | (Math.floor(date.getSeconds() / 2)),
  date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
})

/** Store-only ZIP: no compression, so no deflate implementation is needed. */
function zip(entries: Entry[], now = new Date()): Uint8Array<ArrayBuffer> {
  const stamp = dosStamp(now)
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const entry of entries) {
    const nameBytes = encoder.encode(entry.path)
    const checksum = crc32(entry.data)
    const size = entry.data.length

    const local = new Uint8Array(30 + nameBytes.length + size)
    const localView = new DataView(local.buffer)
    localView.setUint32(0, 0x04034B50, true)
    localView.setUint16(4, 20, true)
    localView.setUint16(6, 0, true)
    localView.setUint16(8, 0, true)
    localView.setUint16(10, stamp.time, true)
    localView.setUint16(12, stamp.date, true)
    localView.setUint32(14, checksum, true)
    localView.setUint32(18, size, true)
    localView.setUint32(22, size, true)
    localView.setUint16(26, nameBytes.length, true)
    localView.setUint16(28, 0, true)
    local.set(nameBytes, 30)
    local.set(entry.data, 30 + nameBytes.length)
    locals.push(local)

    const central = new Uint8Array(46 + nameBytes.length)
    const centralView = new DataView(central.buffer)
    centralView.setUint32(0, 0x02014B50, true)
    centralView.setUint16(4, 20, true)
    centralView.setUint16(6, 20, true)
    centralView.setUint16(8, 0, true)
    centralView.setUint16(10, 0, true)
    centralView.setUint16(12, stamp.time, true)
    centralView.setUint16(14, stamp.date, true)
    centralView.setUint32(16, checksum, true)
    centralView.setUint32(20, size, true)
    centralView.setUint32(24, size, true)
    centralView.setUint16(28, nameBytes.length, true)
    centralView.setUint16(30, 0, true)
    centralView.setUint16(32, 0, true)
    centralView.setUint16(34, 0, true)
    centralView.setUint16(36, 0, true)
    centralView.setUint32(38, 0, true)
    centralView.setUint32(42, offset, true)
    central.set(nameBytes, 46)
    centrals.push(central)

    offset += local.length
  }

  const centralSize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const endView = new DataView(end.buffer)
  endView.setUint32(0, 0x06054B50, true)
  endView.setUint16(8, entries.length, true)
  endView.setUint16(10, entries.length, true)
  endView.setUint32(12, centralSize, true)
  endView.setUint32(16, offset, true)

  const total = offset + centralSize + end.length
  const output = new Uint8Array(total)
  let cursor = 0
  for (const part of [...locals, ...centrals, end]) {
    output.set(part, cursor)
    cursor += part.length
  }
  return output
}

export function buildWorkbook(sheets: Sheet[], now = new Date()): Uint8Array<ArrayBuffer> {
  if (sheets.length === 0) {
    throw new Error('A workbook needs at least one sheet.')
  }
  const taken = new Set<string>()
  const named = sheets.map((sheet) => ({
    name: sheetName(sheet.name, taken),
    rows: sheet.rows,
  }))

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`
    + `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`
    + `<Default Extension="xml" ContentType="application/xml"/>`
    + named.map((_, index) =>
      `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
    ).join('')
    + `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`
    + `</Types>`

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>`
    + `</Relationships>`

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"`
    + ` xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>`
    + named.map((sheet, index) =>
      `<sheet name="${escapeXml(sheet.name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`,
    ).join('')
    + `</sheets></workbook>`

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`
    + `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">`
    + named.map((_, index) =>
      `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`,
    ).join('')
    + `</Relationships>`

  const entries: Entry[] = [
    { path: '[Content_Types].xml', data: encoder.encode(contentTypes) },
    { path: '_rels/.rels', data: encoder.encode(rootRels) },
    { path: 'xl/workbook.xml', data: encoder.encode(workbook) },
    { path: 'xl/_rels/workbook.xml.rels', data: encoder.encode(workbookRels) },
    ...named.map((sheet, index) => ({
      path: `xl/worksheets/sheet${index + 1}.xml`,
      data: encoder.encode(sheetXml(sheet.rows)),
    })),
  ]

  return zip(entries, now)
}
