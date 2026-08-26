import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = resolve(root, 'docs', 'facilitator-guide.html')
const output = resolve(root, 'docs', 'Motor-City-Facilitator-Guide.pdf')
const manifestOutput = resolve(root, 'docs', 'Motor-City-Facilitator-Guide.manifest.json')
const canonicalSource = () => readFileSync(source, 'utf8').replace(/\r\n?/g, '\n')
const candidates = [
  process.env.BROWSER_BIN,
  process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  process.env.ProgramFiles && join(process.env.ProgramFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
  '/usr/bin/microsoft-edge',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

const browser = candidates.find((candidate) => existsSync(candidate))
if (!browser) {
  throw new Error('No supported Edge/Chrome browser found. Set BROWSER_BIN to its executable.')
}
if (!existsSync(source)) throw new Error(`Guide source is missing: ${source}`)

const profile = mkdtempSync(join(tmpdir(), 'motor-city-guide-'))
try {
  const result = spawnSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--user-data-dir=${profile}`,
    `--print-to-pdf=${output}`,
    pathToFileURL(source).href,
  ], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0 || !existsSync(output)) {
    throw new Error(result.stderr || result.stdout || `Browser exited ${result.status}`)
  }
  const pdf = readFileSync(output)
  const signature = pdf.subarray(0, 5).toString('ascii')
  if (signature !== '%PDF-') throw new Error('Generated artifact is not a PDF.')
  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0
  if (pages !== 6) throw new Error(`Expected 6 PDF pages, generated ${pages}.`)
  const sourceHash = createHash('sha256').update(canonicalSource()).digest('hex')
  const pdfHash = createHash('sha256').update(pdf).digest('hex')
  writeFileSync(manifestOutput, `${JSON.stringify({
    version: 1,
    source: 'facilitator-guide.html',
    sourceSha256: sourceHash,
    artifact: 'Motor-City-Facilitator-Guide.pdf',
    artifactSha256: pdfHash,
    pages,
  }, null, 2)}\n`)
  console.log(`Generated ${output}`)
} finally {
  rmSync(profile, { recursive: true, force: true })
}
