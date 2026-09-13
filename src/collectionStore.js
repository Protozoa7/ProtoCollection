import {
  collection,
  deleteDoc,
  doc,
  increment,
  onSnapshot,
  serverTimestamp,
  setDoc
} from 'firebase/firestore'
import { db, firebaseConfigured } from './firebase'
import { parseLanguage } from './languages'

const LOCAL_KEY = 'protocollection-local-v1'

function readLocal() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || '{}')
  } catch {
    return {}
  }
}

function writeLocal(data) {
  localStorage.setItem(LOCAL_KEY, JSON.stringify(data))
  window.dispatchEvent(new CustomEvent('protocollection-local-change'))
}

function cleanDimension(value, fallback = 'Unspecified') {
  const text = String(value || '').trim()
  return text || fallback
}

function slug(value) {
  return String(value || 'unspecified')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50) || 'unspecified'
}

export function identityKey(card, options = {}) {
  const lang = parseLanguage(options.language || card.language, 'en') || 'en'
  const variant = cleanDimension(options.variant ?? card.variant)
  const condition = cleanDimension(options.condition ?? card.condition)
  const id = card.cardId || card.id

  // Backward compatibility with ProtoCollection V1:
  // its default English records used the raw catalog card ID as the Firestore document ID.
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
    condition
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

export async function addCard(user, card, amount = 1, options = {}) {
  if (!(card?.id || card?.cardId) || amount <= 0) return
  const entry = normalizeEntry(card, amount, options)
  const key = identityKey(entry)

  if (firebaseConfigured && db && user) {
    const ref = doc(db, 'users', user.uid, 'collection', key)
    await setDoc(ref, {
      ...entry,
      quantity: increment(amount),
      updatedAt: serverTimestamp()
    }, { merge: true })
    return key
  }

  const data = readLocal()
  const existing = data[key]
  data[key] = {
    ...entry,
    identityKey: key,
    quantity: Number(existing?.quantity || 0) + amount
  }
  writeLocal(data)
  return key
}

export async function setQuantity(user, entry, quantity) {
  const key = entry.identityKey || identityKey(entry)
  if (quantity <= 0) {
    if (firebaseConfigured && db && user) {
      await deleteDoc(doc(db, 'users', user.uid, 'collection', key))
    } else {
      const data = readLocal()
      delete data[key]
      writeLocal(data)
    }
    return
  }

  const normalized = normalizeEntry(entry, quantity)
  if (firebaseConfigured && db && user) {
    await setDoc(doc(db, 'users', user.uid, 'collection', key), {
      ...normalized,
      quantity,
      updatedAt: serverTimestamp()
    }, { merge: true })
  } else {
    const data = readLocal()
    data[key] = { ...normalized, identityKey: key, quantity }
    writeLocal(data)
  }
}
