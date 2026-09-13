const API = 'https://api.tcgdex.net/v2/en'

const cache = new Map()

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

export async function getSets() {
  return getJson(`${API}/sets?sort:field=releaseDate&sort:order=DESC`)
}

export async function getSet(id) {
  return getJson(`${API}/sets/${encodeURIComponent(id)}`)
}

export async function getCard(id) {
  return getJson(`${API}/cards/${encodeURIComponent(id)}`)
}

export async function searchCards(term) {
  const q = String(term || '').trim()
  if (!q) return []
  const numberish = q.match(/^#?\s*([A-Za-z]{0,4}\d{1,4}(?:\.\d+)?)\s*(?:\/\s*\d{1,4})?$/)
  const url = numberish
    ? `${API}/cards?localId=${encodeURIComponent(numberish[1])}`
    : `${API}/cards?name=${encodeURIComponent(q)}`
  const results = await getJson(url)
  return Array.isArray(results) ? results.slice(0, 120) : []
}

export async function searchByLocalId(localId) {
  if (!localId) return []
  const results = await getJson(`${API}/cards?localId=${encodeURIComponent(localId)}`)
  return Array.isArray(results) ? results : []
}

export async function hydrateCard(card) {
  if (!card?.id) return card
  try {
    const full = await getCard(card.id)
    return {
      ...card,
      ...full,
      setId: full?.set?.id || card.setId || '',
      setName: full?.set?.name || card.setName || ''
    }
  } catch {
    return card
  }
}

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function candidatesFromOcr(rawText) {
  const text = String(rawText || '')
  const clean = norm(text)
  const ratio = text.match(/\b([A-Z]{0,4}\s*\d{1,4}(?:\.\d+)?)\s*[\/|\\]\s*(\d{2,4})\b/i)
  const standalone = text.match(/\b([A-Z]{0,4}\d{1,4}(?:\.\d+)?)\b/i)
  const localId = (ratio?.[1] || standalone?.[1] || '').replace(/\s+/g, '')
  let candidates = localId ? await searchByLocalId(localId) : []

  // If the number OCR missed, use likely name lines.
  if (!candidates.length) {
    const lines = text.split(/\n+/)
      .map(v => v.trim())
      .filter(v => v.length >= 3 && v.length <= 35)
      .filter(v => !/\b(hp|basic|stage|trainer|energy|illus|weakness|resistance|retreat)\b/i.test(v))
      .filter(v => !/^\W*\d+\W*$/.test(v))
    for (const line of lines.slice(0, 4)) {
      const found = await searchCards(line.replace(/[^\w .'-]/g, '').trim())
      if (found.length) {
        candidates = found
        break
      }
    }
  }

  const scored = candidates.map(card => {
    const name = norm(card.name)
    let score = 0
    if (localId && norm(card.localId) === norm(localId)) score += 8
    if (name && clean.includes(name)) score += 12
    const words = name.split(' ').filter(w => w.length > 2)
    score += words.filter(w => clean.includes(w)).length * 2
    return { ...card, _scanScore: score }
  })

  return scored
    .sort((a, b) => b._scanScore - a._scanScore || a.name.localeCompare(b.name))
    .slice(0, 18)
}
