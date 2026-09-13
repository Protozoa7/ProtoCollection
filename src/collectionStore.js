import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc,
  writeBatch
} from 'firebase/firestore'
import { db, firebaseConfigured } from './firebase'
import { parseLanguage } from './languages'

const LOCAL_KEY = 'protocollection-local-v1'
const LOCAL_IMPORTS_KEY = 'protocollection-imports-v1'

function readLocal() {
  try { return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}') } catch { return {} }
}

function writeLocal(data) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data))
  window.dispatchEvent(new CustomEvent('protocollection-local-change'))
}

function readLocalImports() {
  try { return JSON.parse(localStorage.getItem(LOCAL_IMPORTS_KEY) || '{}') } catch { return {} }
}

function writeLocalImports(data) {
  localStorage.setItem(LOCAL_IMPORTS_KEY, JSON.stringify(data))
  window.dispatchEvent(new CustomEvent('protocollection-imports-change'))
}

function cleanDimension(value, fallback = 'Unspecified') {
  const text = String(value || '').trim()
  return text || fallback
}

function slug(value) {
  return String(value || 'unspecified')
    .toLowerCase().normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'unspecified'
}

export function identityKey(card, options = {}) {
  const lang = parseLanguage(options.language || card.language, 'en') || 'en'
  const variant = cleanDimension(options.variant ?? card.variant)
  const condition = cleanDimension(options.condition ?? card.condition)
  const id = card.cardId || card.id

  // Backward compatibility with V1: default English cards used raw catalog IDs.
  if (lang === 'en' && variant === 'Unspecified' && condition === 'Unspecified') return id
  return `${lang}__${id}__${slug(variant)}__${slug(condition)}`
}

export function catalogQuantity(items, card, langOverride) {
  const id = card.cardId || card.id
  const lang = parseLanguage(langOverride || card.language, 'en') || 'en'
  return Object.values(items).reduce((sum, entry) => {
    if ((entry.cardId || '') === id && (entry.language || 'en') === lang) {
      return sum + Number(entry.quantity || 0)
    }
    return sum
  }, 0)
}

function normalizeEntry(card, quantity = 1, options = {}) {
  const language = parseLanguage(options.language || card.language, 'en') || 'en'
  const variant = cleanDimension(options.variant ?? card.variant)
  const condition = cleanDimension(options.condition ?? card.condition)
  return {
    cardId: card.cardId || card.id,
    name: card.name || '',
    localId: card.localId || '',
    image: card.image || '',
    setId: card.setId || card.set?.id || '',
    setName: card.setName || card.set?.name || '',
    quantity,
    language,
    variant,
    condition,
    year: String(options.year ?? card.year ?? card.releaseYear ?? '').trim(),
    rarity: String(options.rarity ?? card.rarity ?? '').trim(),
    note: String(options.note ?? card.note ?? card.notes ?? '').trim()
  }
}

export function subscribeCollection(user, callback) {
  if (firebaseConfigured && db && user) {
    const ref = collection(db, 'users', user.uid, 'collection')
    return onSnapshot(ref, snap => {
      const data = {}
      snap.forEach(d => {
        const row = d.data()
        data[d.id] = { ...row, identityKey: d.id, language: row.language || 'en' }
      })
      callback(data)
    })
  }

  const update = () => callback(readLocal())
  update()
  window.addEventListener('protocollection-local-change', update)
  window.addEventListener('storage', update)
  return () => {
    window.removeEventListener('protocollection-local-change', update)
    window.removeEventListener('storage', update)
  }
}

export function subscribeImports(user, callback) {
  if (firebaseConfigured && db && user) {
    const ref = collection(db, 'users', user.uid, 'imports')
    return onSnapshot(ref, snap => {
      const rows = []
      snap.forEach(d => rows.push({ ...d.data(), importId: d.id }))
      rows.sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))
      callback(rows)
    })
  }

  const update = () => {
    const rows = Object.values(readLocalImports())
      .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))
    callback(rows)
  }
  update()
  window.addEventListener('protocollection-imports-change', update)
  window.addEventListener('storage', update)
  return () => {
    window.removeEventListener('protocollection-imports-change', update)
    window.removeEventListener('storage', update)
  }
}

export async function addCard(user, card, amount = 1, options = {}) {
  if (!(card?.id || card?.cardId) || amount <= 0) return
  const entry = normalizeEntry(card, amount, options)
  const key = identityKey(entry)

  if (firebaseConfigured && db && user) {
    const ref = doc(db, 'users', user.uid, 'collection', key)
    await setDoc(ref, { ...entry, quantity: increment(amount), updatedAt: serverTimestamp() }, { merge: true })
    return key
  }

  const data = readLocal()
  const existing = data[key]
  data[key] = { ...entry, identityKey: key, quantity: Number(existing?.quantity || 0) + amount }
  writeLocal(data)
  return key
}

export async function setQuantity(user, entry, quantity) {
  const key = entry.identityKey || identityKey(entry)
  if (quantity <= 0) {
    if (firebaseConfigured && db && user) {
      await deleteDoc(doc(db, 'users', user.uid, 'collection', key))
    } else {
      const data = readLocal(); delete data[key]; writeLocal(data)
    }
    return
  }

  const normalized = normalizeEntry(entry, quantity)
  if (firebaseConfigured && db && user) {
    await setDoc(doc(db, 'users', user.uid, 'collection', key), {
      ...normalized, quantity, updatedAt: serverTimestamp()
    }, { merge: true })
  } else {
    const data = readLocal()
    data[key] = { ...normalized, identityKey: key, quantity }
    writeLocal(data)
  }
}

function aggregateImportRows(rows) {
  const grouped = new Map()
  for (const row of rows) {
    if (!row?.card || Number(row.quantity || 0) <= 0) continue
    const normalized = normalizeEntry(row.card, Number(row.quantity || 1), {
      language: row.lang || row.language,
      variant: row.variant,
      condition: row.condition,
      year: row.year,
      rarity: row.rarity,
      note: row.note
    })
    const key = identityKey(normalized)
    const current = grouped.get(key)
    if (current) current.quantity += normalized.quantity
    else grouped.set(key, { ...normalized, identityKey: key })
  }
  return [...grouped.values()]
}

export async function commitImport(user, rows, { fileName = 'Import' } = {}) {
  const changes = aggregateImportRows(rows)
  if (!changes.length) throw new Error('There are no resolved cards to import.')
  if (changes.length > 450) throw new Error('This import has more than 450 unique binder entries. Split it into two files so it can remain atomic and fully reversible.')

  const importId = `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const createdAtMs = Date.now()
  const copiesAdded = changes.reduce((sum, x) => sum + Number(x.quantity || 0), 0)
  const record = {
    importId,
    fileName,
    createdAtMs,
    copiesAdded,
    uniqueEntries: changes.length,
    rolledBack: false,
    changes: changes.map(x => ({
      identityKey: x.identityKey,
      cardId: x.cardId,
      name: x.name,
      localId: x.localId,
      setId: x.setId,
      setName: x.setName,
      image: x.image,
      language: x.language,
      variant: x.variant,
      condition: x.condition,
      year: x.year,
      rarity: x.rarity,
      note: x.note,
      quantity: x.quantity
    }))
  }

  if (firebaseConfigured && db && user) {
    const batch = writeBatch(db)
    for (const change of changes) {
      batch.set(doc(db, 'users', user.uid, 'collection', change.identityKey), {
        ...change,
        quantity: increment(change.quantity),
        updatedAt: serverTimestamp()
      }, { merge: true })
    }
    batch.set(doc(db, 'users', user.uid, 'imports', importId), {
      ...record,
      createdAt: serverTimestamp()
    })
    await batch.commit()
    return record
  }

  const collectionData = readLocal()
  for (const change of changes) {
    const existing = collectionData[change.identityKey]
    collectionData[change.identityKey] = {
      ...change,
      quantity: Number(existing?.quantity || 0) + Number(change.quantity || 0)
    }
  }
  writeLocal(collectionData)
  const imports = readLocalImports()
  imports[importId] = record
  writeLocalImports(imports)
  return record
}

export async function rollbackImport(user, importRecord) {
  if (!importRecord?.importId || importRecord.rolledBack) return
  const changes = importRecord.changes || []
  if (changes.length > 450) throw new Error('This import is too large to roll back in one operation.')

  if (firebaseConfigured && db && user) {
    // Read current values first, then commit all reversals together.
    const refs = changes.map(c => doc(db, 'users', user.uid, 'collection', c.identityKey))
    const snaps = await Promise.all(refs.map(ref => getDoc(ref)))
    const batch = writeBatch(db)
    changes.forEach((change, i) => {
      const ref = refs[i]
      const current = snaps[i].exists() ? Number(snaps[i].data()?.quantity || 0) : 0
      const next = Math.max(0, current - Number(change.quantity || 0))
      if (next <= 0) batch.delete(ref)
      else batch.set(ref, { quantity: next, updatedAt: serverTimestamp() }, { merge: true })
    })
    batch.set(doc(db, 'users', user.uid, 'imports', importRecord.importId), {
      rolledBack: true,
      rolledBackAt: serverTimestamp(),
      rolledBackAtMs: Date.now()
    }, { merge: true })
    await batch.commit()
    return
  }

  const data = readLocal()
  for (const change of changes) {
    const current = Number(data[change.identityKey]?.quantity || 0)
    const next = Math.max(0, current - Number(change.quantity || 0))
    if (next <= 0) delete data[change.identityKey]
    else data[change.identityKey] = { ...data[change.identityKey], quantity: next }
  }
  writeLocal(data)
  const imports = readLocalImports()
  if (imports[importRecord.importId]) {
    imports[importRecord.importId] = {
      ...imports[importRecord.importId],
      rolledBack: true,
      rolledBackAtMs: Date.now()
    }
    writeLocalImports(imports)
  }
}
