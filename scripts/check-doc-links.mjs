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

const artifacts = [
  {
    label: 'facilitator guide',
    source: 'facilitator-guide.html',
    artifact: 'Motor-City-Facilitator-Guide.pdf',
    manifest: 'Motor-City-Facilitator-Guide.manifest.json',
    validPages: (pages) => pages === 6,
    expectedPages: '6',
  },
  {
    label: 'facilitator SOP',
    source: 'FACILITATOR_SOP.md',
    artifact: 'Motor-City-Facilitator-SOP.pdf',
    manifest: 'Motor-City-Facilitator-SOP.manifest.json',
    validPages: (pages) => pages >= 6 && pages <= 30,
    expectedPages: '6-30',
  },
]

for (const item of artifacts) {
  const sourcePath = join(docsRoot, item.source)
  const artifactPath = join(docsRoot, item.artifact)
  const manifestPath = join(docsRoot, item.manifest)
  const artifactBytes = existsSync(artifactPath) ? readFileSync(artifactPath) : null
  let pages = 0
  if (!artifactBytes || artifactBytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    broken.push(`docs/${item.artifact} -> missing or invalid PDF`)
  } else {
    pages = artifactBytes.toString('latin1').match(/\/Type\s*\/Page\b/g)?.length ?? 0
    if (!item.validPages(pages)) {
      broken.push(`docs/${item.artifact} -> expected ${item.expectedPages} pages, found ${pages}`)
    }
  }
  if (!existsSync(manifestPath) || !existsSync(sourcePath)) {
    broken.push(`${item.label} -> missing integrity manifest or source`)
    continue
  }
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const source = readFileSync(sourcePath, 'utf8').replace(/\r\n?/g, '\n')
    const sourceHash = createHash('sha256').update(source).digest('hex')
    const artifactHash = artifactBytes
      ? createHash('sha256').update(artifactBytes).digest('hex')
      : null
    if (
      manifest.version !== 1
      || manifest.source !== item.source
      || manifest.artifact !== item.artifact
      || manifest.pages !== pages
      || manifest.sourceSha256 !== sourceHash
      || manifest.artifactSha256 !== artifactHash
    ) {
      broken.push(`${item.label} -> artifact is stale or altered; run npm run docs:pdf`)
    }
  } catch {
    broken.push(`${item.label} -> integrity manifest is invalid JSON`)
  }
}

if (broken.length) {
  console.error(broken.join('\n'))
  process.exitCode = 1
} else {
  console.log(`Checked ${files.length} Markdown files; all local links resolve.`)
}
