import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const docsRoot = join(root, 'docs')
const files = [join(root, 'README.md')]

const visit = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) visit(path)
    else if (extname(entry.name).toLowerCase() === '.md') files.push(path)
  }
}
visit(docsRoot)

const broken = []
const markdownLink = /\[[^\]]*\]\(([^)]+)\)/g
for (const file of files) {
  const content = readFileSync(file, 'utf8')
  for (const match of content.matchAll(markdownLink)) {
    const raw = match[1].trim().replace(/^<|>$/g, '')
    if (/^(?:https?:|mailto:|#)/i.test(raw)) continue
    const target = decodeURIComponent(raw.split('#', 1)[0])
    if (!target) continue
    const resolved = resolve(dirname(file), target)
    if (!existsSync(resolved)) {
      broken.push(`${relative(root, file)} -> ${target}`)
    }
  }
}

const pdf = join(docsRoot, 'Motor-City-Facilitator-Guide.pdf')
const manifestPath = join(docsRoot, 'Motor-City-Facilitator-Guide.manifest.json')
const guideSource = join(docsRoot, 'facilitator-guide.html')
const pdfBytes = existsSync(pdf) ? readFileSync(pdf) : null
let pages = 0
if (!pdfBytes || pdfBytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
  broken.push('docs/Motor-City-Facilitator-Guide.pdf -> missing or invalid PDF')
} else {
  pages = pdfBytes.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0
  if (pages !== 6) broken.push(`docs/Motor-City-Facilitator-Guide.pdf -> expected 6 pages, found ${pages}`)
}
if (!existsSync(manifestPath) || !existsSync(guideSource)) {
  broken.push('facilitator guide -> missing integrity manifest or HTML source')
} else {
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const sourceHash = createHash('sha256').update(readFileSync(guideSource)).digest('hex')
    const artifactHash = pdfBytes
      ? createHash('sha256').update(pdfBytes).digest('hex')
      : null
    if (
      manifest.version !== 1
      || manifest.source !== 'facilitator-guide.html'
      || manifest.artifact !== 'Motor-City-Facilitator-Guide.pdf'
      || manifest.pages !== pages
      || manifest.sourceSha256 !== sourceHash
      || manifest.artifactSha256 !== artifactHash
    ) {
      broken.push('facilitator guide -> artifact is stale or altered; run npm run docs:pdf')
    }
  } catch {
    broken.push('facilitator guide -> integrity manifest is invalid JSON')
  }
}

if (broken.length) {
  console.error(broken.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Checked ${files.length} Markdown files; all local links resolve.`)
}
