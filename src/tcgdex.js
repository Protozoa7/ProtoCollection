import { languageInfo } from './languages'

const ROOT = 'https://api.tcgdex.net/v2'
const cache = new Map()

function api(lang = 'en') {
  return `${ROOT}/${encodeURIComponent(lang)}`
}

async function getJson(url) {
  if (cache.has(url)) return cache.get(url)
  const promise = fetch(url).then(async (res) => {
    if (!res.ok) throw new Error(`TCGdex request failed (${res.status})`)
    return res.json()
  }).catch((err) => {
    cache.delete(url)
    throw err
  })
  cache.set(url, promise)
  return promise
}

export function cardImage(card, quality = 'low') {
  if (!card?.image) return ''
  if (/\.(png|jpg|jpeg|webp)$/i.test(card.image)) return card.image
  return `${card.image}/${quality}.webp`
}

export function assetImage(url) {
  if (!url) return ''
  if (/\.(png|jpg|jpeg|webp)$/i.test(url)) return url
  return `${url}.webp`
}

export async function getSets(lang = 'en') {
  return getJson(`${api(lang)}/sets?sort:field=releaseDate&sort:order=DESC`)
}

export async function getSet(id, lang = 'en') {
  return getJson(`${api(lang)}/sets/${encodeURIComponent(id)}`)
}

export async function getCard(id, lang = 'en') {
  return getJson(`${api(lang)}/cards/${encodeURIComponent(id)}`)
}

export async function searchCards(term, lang = 'en') {
  const q = String(term || '').trim()
  if (!q) return []
  const numberish = q.match(/^#?\s*([A-Za-z]{0,8}\d{1,5}(?:\.\d+)?)\s*(?:\/\s*[A-Za-z]{0,8}\d{1,5})?$/)
  const url = numberish
    ? `${api(lang)}/cards?localId=${encodeURIComponent(numberish[1])}`
    : `${api(lang)}/cards?name=${encodeURIComponent(q)}`
  const results = await getJson(url)
  return Array.isArray(results) ? results.slice(0, 150).map(c => ({ ...c, language: lang })) : []
}

export async function searchByLocalId(localId, lang = 'en') {
  if (!localId) return []
  const results = await getJson(`${api(lang)}/cards?localId=${encodeURIComponent(localId)}`)
  return Array.isArray(results) ? results.map(c => ({ ...c, language: lang })) : []
}

export async function hydrateCard(card, languageOverride) {
  if (!card?.id) return card
  const lang = languageOverride || card.language || 'en'
  try {
    const full = await getCard(card.id, lang)
    return {
      ...card,
      ...full,
      language: lang,
      setId: full?.set?.id || card.setId || '',
      setName: full?.set?.name || card.setName || ''
    }
  } catch {
    return { ...card, language: lang }
  }
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function normalizeCollectorNumber(value) {
  const raw = String(value || '').trim().replace(/^#\s*/, '')
  if (!raw) return ''
  if (/^no\.\s*/i.test(raw)) return raw
  return raw.split('/')[0].trim()
}

export async function candidatesFromOcr(rawText, lang = 'en') {
  const text = String(rawText || '')
  const clean = norm(text)

  const ratio = text.match(/\b([A-Z]{0,8}\s*\d{1,5}(?:\.\d+)?)\s*[\/|\\]\s*([A-Z]{0,8}\s*\d{1,5})\b/i)
  const standaloneMatches = [...text.matchAll(/\b([A-Z]{0,8}\d{1,5}(?:\.\d+)?)\b/gi)]
  const candidateNumbers = []

  if (ratio?.[1]) candidateNumbers.push(ratio[1].replace(/\s+/g, ''))
  for (const match of standaloneMatches) {
    const v = match[1].replace(/\s+/g, '')
    if (!candidateNumbers.includes(v)) candidateNumbers.push(v)
  }

  let candidates = []
  for (const localId of candidateNumbers.slice(0, 6)) {
    try {
      const found = await searchByLocalId(localId, lang)
      candidates.push(...found)
    } catch {}
  }

  const unique = new Map()
  for (const card of candidates) unique.set(card.id, card)
  candidates = [...unique.values()]

  if (!candidates.length) {
    const lines = text.split(/\n+/)
      .map(v => v.trim())
      .filter(v => v.length >= 2 && v.length <= 45)
      .filter(v => !/\b(hp|basic|stage|trainer|energy|illus|weakness|resistance|retreat)\b/i.test(v))
      .filter(v => !/^\W*\d+\W*$/.test(v))

    for (const line of lines.slice(0, 5)) {
      try {
        const found = await searchCards(line.replace(/[^\p{L}\p{N} .'-]/gu, '').trim(), lang)
        if (found.length) {
          candidates = found
          break
        }
      } catch {}
    }
  }

  return candidates
    .map(card => {
      const name = norm(card.name)
      let score = 0
      if (name && clean.includes(name)) score += 14
      const cardNum = norm(card.localId)
      if (candidateNumbers.some(n => norm(n) === cardNum)) score += 10
      const words = name.split(' ').filter(w => w.length > 2)
      score += words.filter(w => clean.includes(w)).length * 2
      return { ...card, language: lang, _scanScore: score }
    })
    .sort((a, b) => b._scanScore - a._scanScore || String(a.name).localeCompare(String(b.name)))
    .slice(0, 24)
}

function compactText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[^\p{L}\p{N}]+/gu, '')
}

function parseSetCode(source) {
  const text = String(source || '')
  const parenthetical = [...text.matchAll(/\(([^)]+)\)/g)].map(m => m[1].trim()).reverse()
  for (const value of parenthetical) {
    if (/^[A-Za-z]{1,6}\d[A-Za-z0-9-]*$/i.test(value)) return value
  }
  const loose = text.match(/\b([A-Za-z]{1,6}\d[A-Za-z0-9-]{0,8})\b/)
  return loose?.[1] || ''
}

export async function findSetForImport(setText, lang = 'en') {
  const query = String(setText || '').trim()
  if (!query) return null
  const sets = await getSets(lang)
  const q = compactText(query)
  const code = parseSetCode(query).toLowerCase()

  if (code) {
    const byId = sets.find(s => String(s.id || '').toLowerCase() === code)
    if (byId) return byId
  }

  const exact = sets.find(s => compactText(s.name) === q)
  if (exact) return exact

  const withoutNotes = query.split(' — ')[0].trim()
  const simple = compactText(withoutNotes.replace(/\s*\([^)]*\)\s*$/g, ''))
  const fuzzy = sets.find(s => compactText(s.name) === simple)
    || sets.find(s => simple.length > 4 && compactText(s.name).includes(simple))
    || sets.find(s => simple.length > 4 && simple.includes(compactText(s.name)))

  return fuzzy || null
}

export async function findCardForImport({ name, setName, number, lang = 'en' }) {
  const localId = normalizeCollectorNumber(number)

  if (setName) {
    try {
      const set = await findSetForImport(setName, lang)
      if (set) {
        const fullSet = await getSet(set.id, lang)
        const cards = fullSet?.cards || []
        const byNumber = localId
          ? cards.filter(c => compactText(c.localId) === compactText(localId))
          : []

        if (byNumber.length === 1) {
          return { ...byNumber[0], language: lang, setId: set.id, setName: set.name }
        }

        if (byNumber.length > 1 && name) {
          const exact = byNumber.find(c => compactText(c.name) === compactText(name))
          if (exact) return { ...exact, language: lang, setId: set.id, setName: set.name }
        }

        if (name) {
          const byName = cards.find(c => compactText(c.name) === compactText(name))
          if (byName) return { ...byName, language: lang, setId: set.id, setName: set.name }
        }
      }
    } catch {}
  }

  if (localId) {
    try {
      const found = await searchByLocalId(localId, lang)
      if (found.length === 1) return found[0]
      if (found.length > 1 && name) {
        const exact = found.find(c => compactText(c.name) === compactText(name))
        if (exact) return exact
      }
    } catch {}
  }

  if (name) {
    try {
      const found = await searchCards(name, lang)
      const exact = found.find(c => compactText(c.name) === compactText(name))
      if (exact) return exact
      if (found.length === 1) return found[0]
    } catch {}
  }

  return null
}

export function scannerOcrLanguage(lang = 'en') {
  return languageInfo(lang).ocr
}

function editDistance(a, b) {
  const x = compactText(a)
  const y = compactText(b)
  if (!x) return y.length
  if (!y) return x.length
  const prev = Array.from({ length: y.length + 1 }, (_, i) => i)
  for (let i = 1; i <= x.length; i++) {
    let last = prev[0]
    prev[0] = i
    for (let j = 1; j <= y.length; j++) {
      const saved = prev[j]
      const cost = x[i - 1] === y[j - 1] ? 0 : 1
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, last + cost)
      last = saved
    }
  }
  return prev[y.length]
}

function textSimilarity(a, b) {
  const x = compactText(a)
  const y = compactText(b)
  if (!x || !y) return 0
  if (x === y) return 1
  if (x.includes(y) || y.includes(x)) return Math.min(x.length, y.length) / Math.max(x.length, y.length)
  const d = editDistance(x, y)
  return Math.max(0, 1 - d / Math.max(x.length, y.length))
}

export function extractCollectorCandidates(value) {
  const text = String(value || '').toUpperCase().replace(/[|\\]/g, '/')
  const out = []
  const add = v => {
    const cleaned = String(v || '')
      .replace(/\s+/g, '')
      .replace(/[Oo](?=\d)/g, '0')
      .replace(/[Il](?=\d)/g, '1')
      .replace(/[^A-Z0-9.-]/g, '')
    if (cleaned && !out.includes(cleaned)) out.push(cleaned)
  }

  for (const match of text.matchAll(/\b([A-Z]{0,8}\s*\d{1,5}(?:\.\d+)?)\s*\/\s*([A-Z]{0,8}\s*\d{1,5})\b/g)) add(match[1])
  for (const match of text.matchAll(/\b([A-Z]{1,8}\d{1,5}(?:\.\d+)?)\b/g)) add(match[1])
  for (const match of text.matchAll(/\b(\d{1,4})\b/g)) {
    const n = Number(match[1])
    if (n > 0 && n < 1000) add(match[1])
  }
  return out.slice(0, 10)
}

function likelyNameLines(text) {
  return String(text || '').split(/\n+/)
    .map(v => v.trim())
    .filter(v => v.length >= 2 && v.length <= 45)
    .filter(v => !/^\W*\d+\W*$/.test(v))
    .filter(v => !/\b(hp|basic|stage|trainer|energy|illus|weakness|resistance|retreat)\b/i.test(v))
    .slice(0, 8)
}

export async function findCardSuggestionsForImport({ name, setName, number, lang = 'en', limit = 12 }) {
  const candidates = new Map()
  const localId = normalizeCollectorNumber(number)
  let resolvedSet = null

  if (setName) {
    try {
      resolvedSet = await findSetForImport(setName, lang)
      if (resolvedSet) {
        const fullSet = await getSet(resolvedSet.id, lang)
        for (const card of fullSet?.cards || []) {
          let score = 0
          if (localId && compactText(card.localId) === compactText(localId)) score += 30
          if (name) score += textSimilarity(card.name, name) * 18
          if (score >= 7) candidates.set(card.id, {
            ...card, language: lang, setId: resolvedSet.id, setName: resolvedSet.name, _reviewScore: score
          })
        }
      }
    } catch {}
  }

  if (localId) {
    try {
      const found = await searchByLocalId(localId, lang)
      for (const card of found) {
        const prior = candidates.get(card.id)
        const score = 24 + (name ? textSimilarity(card.name, name) * 14 : 0)
        candidates.set(card.id, { ...prior, ...card, language: lang, _reviewScore: Math.max(prior?._reviewScore || 0, score) })
      }
    } catch {}
  }

  if (name) {
    try {
      const found = await searchCards(name, lang)
      for (const card of found.slice(0, 25)) {
        const prior = candidates.get(card.id)
        const score = textSimilarity(card.name, name) * 20
        if (score >= 5) candidates.set(card.id, { ...prior, ...card, language: lang, _reviewScore: Math.max(prior?._reviewScore || 0, score) })
      }
    } catch {}
  }

  const ranked = [...candidates.values()]
    .sort((a, b) => (b._reviewScore || 0) - (a._reviewScore || 0))
    .slice(0, limit)

  return Promise.all(ranked.map(async c => {
    const full = await hydrateCard(c, lang)
    return { ...c, ...full, language: lang, _reviewScore: c._reviewScore }
  }))
}

export async function scanCandidatesFromRegions({ nameText = '', numberText = '', lang = 'en', setId = '', limit = 16 }) {
  const numberCandidates = extractCollectorCandidates(numberText)
  const nameLines = likelyNameLines(nameText)
  const cleanNameText = norm(nameText)
  const map = new Map()

  function add(card, score, setName = '') {
    if (!card?.id) return
    const old = map.get(card.id)
    const row = {
      ...old,
      ...card,
      language: lang,
      setId: card.setId || card.set?.id || setId || old?.setId || '',
      setName: card.setName || card.set?.name || setName || old?.setName || '',
      _scanScore: Math.max(old?._scanScore || 0, score),
      _numberMatch: Boolean(old?._numberMatch)
    }
    map.set(card.id, row)
  }

  if (setId) {
    const set = await getSet(setId, lang)
    const cards = set?.cards || []
    for (const card of cards) {
      let score = 0
      const local = compactText(card.localId)
      const exactNumber = numberCandidates.some(n => compactText(n) === local)
      const nearNumber = !exactNumber && numberCandidates.some(n => editDistance(n, card.localId) <= 1)
      if (exactNumber) score += 42
      else if (nearNumber) score += 20

      let bestName = 0
      for (const line of nameLines) bestName = Math.max(bestName, textSimilarity(card.name, line))
      if (!bestName && cleanNameText) {
        const n = norm(card.name)
        if (n && cleanNameText.includes(n)) bestName = 1
      }
      score += bestName * 24

      if (score >= 8) {
        add({ ...card, setId: set.id, setName: set.name }, score, set.name)
        const saved = map.get(card.id)
        if (saved) saved._numberMatch = exactNumber
      }
    }
  } else {
    for (const number of numberCandidates.slice(0, 5)) {
      try {
        const found = await searchByLocalId(number, lang)
        for (const card of found) {
          let score = 28
          let bestName = 0
          for (const line of nameLines) bestName = Math.max(bestName, textSimilarity(card.name, line))
          score += bestName * 18
          add(card, score)
          const saved = map.get(card.id)
          if (saved) saved._numberMatch = compactText(card.localId) === compactText(number)
        }
      } catch {}
    }

    for (const line of nameLines.slice(0, 3)) {
      try {
        const found = await searchCards(line, lang)
        for (const card of found.slice(0, 20)) add(card, textSimilarity(card.name, line) * 24)
      } catch {}
    }
  }

  return [...map.values()]
    .filter(c => (c._scanScore || 0) >= 6)
    .sort((a, b) => (b._scanScore || 0) - (a._scanScore || 0))
    .slice(0, limit)
}
