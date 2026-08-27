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
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { marked } from 'marked'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docsRoot = resolve(root, 'docs')
const source = resolve(docsRoot, 'FACILITATOR_SOP.md')
const output = resolve(docsRoot, 'Motor-City-Facilitator-SOP.pdf')
const manifestOutput = resolve(docsRoot, 'Motor-City-Facilitator-SOP.manifest.json')
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
if (!existsSync(source)) throw new Error(`SOP source is missing: ${source}`)

const markdown = canonicalSource()
const content = await marked.parse(markdown, { gfm: true })
const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<base href="${pathToFileURL(`${docsRoot}${sep}`).href}">
<title>Motor City Facilitator Training and Classroom SOP</title>
<style>
  @page {
    size:letter;
    margin:0.58in 0.62in 0.68in;
    @bottom-center {
      content:"Motor City Facilitator SOP  |  " counter(page);
      color:#687773;
      font:8px Arial, sans-serif;
    }
  }
  :root { --ink:#17201e; --green:#176f60; --gold:#b98a10; --line:#cbd4d0; --soft:#eef3f1; --red:#8f3029; }
  * { box-sizing:border-box; }
  html { color:var(--ink); font-family:Georgia, "Times New Roman", serif; font-size:11.5px; line-height:1.42; }
  body { margin:0; }
  article { max-width:7.25in; margin:0 auto; }
  h1, h2, h3 { color:var(--green); font-family:Arial, sans-serif; break-after:avoid-page; }
  h1 { margin:0 0 18px; padding:18px 20px; color:#fff; background:var(--ink); border-bottom:6px solid var(--gold); font-size:28px; line-height:1.12; text-transform:uppercase; }
  h2 { margin:22px 0 8px; padding-bottom:4px; border-bottom:2px solid var(--green); font-size:20px; }
  h3 { margin:14px 0 5px; font-size:15px; }
  p { margin:5px 0 8px; orphans:3; widows:3; }
  h2 + p, h3 + p { break-after:avoid-page; }
  ul, ol { margin:6px 0 10px; padding-left:24px; break-inside:avoid-page; }
  li { margin:3px 0; }
  a { color:#0b5f84; text-decoration:none; }
  strong { color:#101816; }
  blockquote { margin:10px 0; padding:9px 13px; background:#fff8df; border-left:5px solid var(--gold); }
  blockquote p { margin:0; }
  table { width:100%; margin:9px 0 13px; border-collapse:collapse; break-inside:auto; }
  thead { display:table-header-group; }
  tr { break-inside:avoid; }
  th, td { padding:6px 8px; border:1px solid var(--line); vertical-align:top; text-align:left; }
  th { background:var(--soft); font-family:Arial, sans-serif; }
  code { padding:1px 3px; background:var(--soft); font:10.5px Consolas, monospace; }
  hr { margin:18px 0; border:0; border-top:2px solid var(--line); }
  h1 + p, h1 + p + p, h1 + p + p + p { font-size:12.5px; }
  h2:first-of-type { margin-top:16px; }
  h2:last-of-type { break-before:page; }
  h2:last-of-type + p + table { break-inside:avoid-page; }
</style>
</head>
<body><article>${content}</article></body>
</html>`

const profile = mkdtempSync(join(tmpdir(), 'motor-city-sop-'))
try {
  const rendered = join(profile, 'facilitator-sop.html')
  writeFileSync(rendered, html)
  const result = spawnSync(browser, [
    '--headless=new',
    '--disable-gpu',
    '--no-pdf-header-footer',
    `--user-data-dir=${profile}`,
    `--print-to-pdf=${output}`,
    pathToFileURL(rendered).href,
  ], { encoding: 'utf8', windowsHide: true })
  if (result.status !== 0 || !existsSync(output)) {
    throw new Error(result.stderr || result.stdout || `Browser exited ${result.status}`)
  }
  const pdf = readFileSync(output)
  const signature = pdf.subarray(0, 5).toString('ascii')
  if (signature !== '%PDF-') throw new Error('Generated SOP artifact is not a PDF.')
  const pages = pdf.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0
  if (pages < 6 || pages > 30) {
    throw new Error(`Expected a 6-30 page SOP, generated ${pages}.`)
  }
  const sourceHash = createHash('sha256').update(markdown).digest('hex')
  const pdfHash = createHash('sha256').update(pdf).digest('hex')
  writeFileSync(manifestOutput, `${JSON.stringify({
    version: 1,
    source: 'FACILITATOR_SOP.md',
    sourceSha256: sourceHash,
    artifact: 'Motor-City-Facilitator-SOP.pdf',
    artifactSha256: pdfHash,
    pages,
  }, null, 2)}\n`)
  console.log(`Generated ${output} (${pages} pages)`)
} finally {
  rmSync(profile, { recursive: true, force: true })
}