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
