#!/usr/bin/env node
// Checks that the Atlas Markdown conformance corpus is internally consistent with SPEC.md.
// It does not parse Markdown: it checks the expected outputs against each other, so a
// hand-edited case can't drift from the spec's tree shape, extraction or resolution rules.
//
//   node specs/atlas-markdown/check.mjs
//
// No dependencies, so it runs anywhere Node 20+ does.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const CORPUS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'corpus')
const errors = []
const fail = (where, msg) => errors.push(`${where}: ${msg}`)

// ---- §3, §4: node shapes -------------------------------------------------
// Every key a node of each type must carry (besides `type`); optional mdast fields are
// written explicitly as null.
const SHAPES = {
  root: ['children'],
  paragraph: ['children', 'blockId'],
  heading: ['depth', 'children'],
  thematicBreak: [],
  blockquote: ['children', 'blockId'],
  list: ['ordered', 'start', 'spread', 'children', 'blockId'],
  listItem: ['checked', 'spread', 'children'],
  code: ['lang', 'meta', 'value', 'blockId'],
  html: ['value'],
  table: ['align', 'children', 'blockId'],
  tableRow: ['children'],
  tableCell: ['children'],
  definition: ['identifier', 'label', 'url', 'title'],
  footnoteDefinition: ['identifier', 'label', 'children'],
  text: ['value'],
  emphasis: ['children'],
  strong: ['children'],
  delete: ['children'],
  inlineCode: ['value'],
  break: [],
  link: ['url', 'title', 'children'],
  image: ['url', 'title', 'alt'],
  linkReference: ['identifier', 'label', 'referenceType', 'children'],
  imageReference: ['identifier', 'label', 'referenceType', 'alt'],
  footnoteReference: ['identifier', 'label'],
  yaml: ['value'],
  wikiLink: ['target', 'heading', 'blockId', 'alias'],
  embed: ['target', 'heading', 'blockId', 'alias'],
  tag: ['name'],
  highlight: ['children'],
  callout: ['calloutType', 'fold', 'title', 'children', 'blockId'],
  inlineMath: ['value'],
  math: ['meta', 'value', 'blockId'],
}
const TAG = /^[\p{L}\p{M}\p{Nd}_-]+(?:\/[\p{L}\p{M}\p{Nd}_-]+)*$/u
const BLOCK_ID = /^[A-Za-z0-9-]+$/

function checkNode(n, where, parentType) {
  const shape = SHAPES[n.type]
  if (!shape) return fail(where, `unknown node type "${n.type}"`)
  const keys = Object.keys(n).filter((k) => k !== 'type')
  for (const k of shape) if (!(k in n)) fail(where, `${n.type} is missing "${k}" (write null explicitly)`)
  for (const k of keys) if (!shape.includes(k)) fail(where, `${n.type} has unexpected key "${k}"`)
  if (n.type === 'text' && n.value === '') fail(where, 'empty text node')
  if (n.type === 'yaml' && parentType !== 'root') fail(where, 'yaml must be a child of root')
  if ('blockId' in n && n.type !== 'wikiLink' && n.type !== 'embed' && n.blockId !== null && !BLOCK_ID.test(n.blockId)) {
    fail(where, `invalid blockId "${n.blockId}"`)
  }
  if (n.type === 'tag' && !(TAG.test(n.name) && /[^\p{Nd}/]/u.test(n.name))) fail(where, `"${n.name}" is not a valid tag (§4.4)`)
  if ((n.type === 'wikiLink' || n.type === 'embed')) {
    for (const k of ['target', 'heading', 'alias']) {
      const v = n[k]
      if (v !== null && v !== v.trim()) fail(where, `${n.type}.${k} must be trimmed`)
      if (k !== 'target' && v === '') fail(where, `${n.type}.${k} must be null, not ""`)
    }
    if (n.target === '' && n.heading === null && n.blockId === null) fail(where, 'empty target needs a heading or block reference')
  }
  if (n.type === 'callout' && ![null, '+', '-'].includes(n.fold)) fail(where, `invalid fold ${JSON.stringify(n.fold)}`)
  if (n.type === 'callout' && n.title !== null) {
    if (!Array.isArray(n.title) || n.title.length === 0) fail(where, 'callout.title is null or a non-empty array of inline nodes')
    else checkChildren(n.title, `${where}.title`, n.type)
  }
  checkChildren(n.children ?? [], where, n.type)
}

function checkChildren(kids, where, parentType) {
  kids.forEach((c, i) => {
    if (i > 0 && c.type === 'text' && kids[i - 1].type === 'text') fail(where, 'adjacent text nodes must be merged')
    checkNode(c, `${where} > ${c.type}[${i}]`, parentType)
  })
}

// ---- §6: extraction --------------------------------------------------------
const fold = (s) => s.normalize('NFC').toLowerCase()

function plainText(n) {
  switch (n.type) {
    case 'text': case 'inlineCode': case 'inlineMath': return n.value
    case 'wikiLink': case 'embed': return n.alias ?? n.target
    case 'tag': return '#' + n.name
    case 'image': return n.alt
    case 'break': return ' '
    default: return (n.children ?? []).map(plainText).join('')
  }
}

function markdownLink(url) {
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(url) || /^(\/|#)/.test(url)) return null
  const hash = url.indexOf('#')
  const p = decodeURIComponent(hash < 0 ? url : url.slice(0, hash))
  const frag = hash < 0 ? null : decodeURIComponent(url.slice(hash + 1))
  if (!/\.md$/i.test(p)) return null
  const isBlock = frag?.startsWith('^')
  return { kind: 'markdown', target: p.slice(0, -3), heading: frag && !isBlock ? frag : null, blockId: isBlock ? frag.slice(1) : null, alias: null }
}

function extract(ast) {
  const x = { links: [], embeds: [], tags: [], aliases: [], headings: [], blockIds: [] }
  const seenTags = new Set()
  const walk = (n) => {
    if (n.type === 'wikiLink') x.links.push({ kind: 'wiki', target: n.target, heading: n.heading, blockId: n.blockId, alias: n.alias })
    if (n.type === 'link') { const l = markdownLink(n.url); if (l) x.links.push(l) }
    if (n.type === 'embed') x.embeds.push({ target: n.target, heading: n.heading, blockId: n.blockId, alias: n.alias })
    if (n.type === 'tag' && !seenTags.has(fold(n.name))) { seenTags.add(fold(n.name)); x.tags.push(n.name) }
    if (n.type === 'heading') x.headings.push({ depth: n.depth, text: plainText(n).trim() })
    if (n.blockId != null && n.type !== 'wikiLink' && n.type !== 'embed') x.blockIds.push(n.blockId)
    if (n.type === 'callout' && n.title) n.title.forEach(walk)
    ;(n.children ?? []).forEach(walk)
  }
  walk(ast)
  return x
}

// ---- §7: resolution --------------------------------------------------------
const norm = (s) => s.normalize('NFC').toLowerCase()
const segments = (p) => p.split('/').length
const hasExt = (name) => /\.[^./]+$/.test(name) && !/\.md$/i.test(name)

function resolve(files, from, target) {
  if (target === '') return from
  let t = norm(target.replace(/^\.\//, ''))
  const attachment = hasExt(t.split('/').pop())
  if (!attachment) t = t.replace(/\.md$/, '')
  const keyOf = (f) => (attachment ? norm(f) : norm(f).replace(/\.md$/, ''))
  const pool = files.filter((f) => (attachment ? !/\.md$/i.test(f) : /\.md$/i.test(f)))
  const hits = pool.filter((f) => { const k = keyOf(f); return k === t || k.endsWith('/' + t) })
  if (hits.length === 0) return null
  const exact = hits.find((f) => keyOf(f) === t)
  if (exact) return exact
  return hits.sort((a, b) => segments(a) - segments(b) || (norm(a) < norm(b) ? -1 : norm(a) > norm(b) ? 1 : 0))[0]
}

function writeTarget(files, file) {
  const parts = (/\.md$/i.test(file) ? file.slice(0, -3) : file).split('/')
  for (let n = 1; n <= parts.length; n++) {
    const candidate = parts.slice(-n).join('/')
    if (resolve(files, '', candidate) === file) return candidate
  }
  return null
}

// ---- run -------------------------------------------------------------------
const read = (...p) => fs.readFileSync(path.join(CORPUS, ...p), 'utf8')
const manifest = JSON.parse(read('manifest.json'))
if (!/^1\.\d+\.\d+(-[\w.]+)?$/.test(manifest.specVersion)) fail('manifest.json', `bad specVersion ${manifest.specVersion}`)

const onDisk = []
const casesDir = path.join(CORPUS, 'cases')
for (const area of fs.readdirSync(casesDir)) {
  for (const name of fs.readdirSync(path.join(casesDir, area))) onDisk.push(`${area}/${name}`)
}
const listed = manifest.cases.map((c) => c.id)
for (const id of onDisk) if (!listed.includes(id)) fail(`cases/${id}`, 'not listed in manifest.json')
for (const id of listed) if (!onDisk.includes(id)) fail(`manifest.json`, `lists missing case ${id}`)

for (const { id, description } of manifest.cases) {
  if (!onDisk.includes(id)) continue
  const where = `cases/${id}`
  if (!description) fail(where, 'needs a description in manifest.json')
  const dir = path.join(casesDir, id)
  const files = fs.readdirSync(dir)
  for (const f of files) if (!['input.md', 'ast.json', 'extract.json', 'canonical.md'].includes(f)) fail(where, `unexpected file ${f}`)
  for (const f of ['input.md', 'ast.json', 'extract.json']) if (!files.includes(f)) fail(where, `missing ${f}`)
  if (files.length < 3) continue

  const ast = JSON.parse(read('cases', id, 'ast.json'))
  if (ast.type !== 'root') fail(where, 'ast.json must be a root node')
  checkNode(ast, `${where}/ast.json`, null)

  // The file that serves as canonical output must be canonical at the byte level (§5, §8.3).
  const input = read('cases', id, 'input.md')
  const canonicalFile = files.includes('canonical.md') ? 'canonical.md' : 'input.md'
  const canonical = canonicalFile === 'canonical.md' ? read('cases', id, 'canonical.md') : input
  if (canonicalFile === 'canonical.md' && canonical === input) fail(where, 'canonical.md is identical to input.md; delete it')
  if (canonical.startsWith('﻿')) fail(`${where}/${canonicalFile}`, 'canonical output never has a BOM')
  if (canonical.includes('\r')) fail(`${where}/${canonicalFile}`, 'canonical output uses LF only')
  if (!canonical.endsWith('\n') || canonical.endsWith('\n\n')) fail(`${where}/${canonicalFile}`, 'canonical output ends with exactly one newline')
  if (/[ \t]\n/.test(canonical.replace(/```[\s\S]*?```/g, ''))) fail(`${where}/${canonicalFile}`, 'trailing whitespace outside code')

  // extract.json must be what §6 derives from ast.json. Frontmatter-derived tags and
  // aliases need a YAML parser, so for pages with frontmatter only the rest is derived.
  const expected = JSON.parse(read('cases', id, 'extract.json'))
  const derived = extract(ast)
  const hasYaml = ast.children[0]?.type === 'yaml'
  for (const key of ['links', 'embeds', 'tags', 'aliases', 'headings', 'blockIds']) {
    if (!(key in expected)) { fail(`${where}/extract.json`, `missing "${key}"`); continue }
    if (hasYaml && key === 'aliases') continue
    let want = expected[key]
    if (hasYaml && key === 'tags') {
      // Which tags came from the frontmatter needs YAML, so check what can be checked
      // without it: every inline tag is present, none twice, and all are valid.
      const folded = want.map(fold)
      for (const t of derived.tags) if (!folded.includes(fold(t))) fail(`${where}/extract.json`, `tags: missing inline tag "${t}"`)
      if (new Set(folded).size !== folded.length) fail(`${where}/extract.json`, 'tags: duplicates (case-insensitive)')
      for (const t of want) if (!(TAG.test(t) && /[^\p{Nd}/]/u.test(t))) fail(`${where}/extract.json`, `tags: "${t}" is not a valid tag`)
      continue
    }
    if (JSON.stringify(want) !== JSON.stringify(derived[key])) {
      fail(`${where}/extract.json`, `${key} should be ${JSON.stringify(derived[key])} per §6, not ${JSON.stringify(want)}`)
    }
  }
}

for (const name of manifest.resolve ?? []) {
  const where = `resolve/${name}.json`
  const fx = JSON.parse(read('resolve', `${name}.json`))
  for (const c of fx.resolve) {
    const got = resolve(fx.files, c.from, c.target)
    if (got !== c.expect) fail(where, `${JSON.stringify(c.target)} from ${c.from} resolves to ${got} per §7, fixture says ${c.expect}`)
  }
  for (const c of fx.write) {
    const got = writeTarget(fx.files, c.file)
    if (got !== c.expect) fail(where, `a link to ${c.file} is written ${JSON.stringify(got)} per §7, fixture says ${JSON.stringify(c.expect)}`)
  }
}

if (errors.length) {
  console.error(errors.join('\n'))
  console.error(`\n${errors.length} problem(s) in the Atlas Markdown corpus`)
  process.exit(1)
}
console.log(`Atlas Markdown corpus OK: ${manifest.cases.length} cases, ${(manifest.resolve ?? []).length} resolve fixture(s), spec ${manifest.specVersion}`)
