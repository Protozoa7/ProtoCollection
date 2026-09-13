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

function normalizeEntry(card, quantity = 1) {
  return {
    cardId: card.id,
    name: card.name || '',
    localId: card.localId || '',
    image: card.image || '',
    setId: card.setId || card.set?.id || '',
    setName: card.setName || card.set?.name || '',
    quantity,
    language: 'en'
  }
}

export function subscribeCollection(user, callback) {
  if (firebaseConfigured && db && user) {
    const ref = collection(db, 'users', user.uid, 'collection')
    return onSnapshot(ref, snap => {
      const data = {}
      snap.forEach(d => { data[d.id] = { ...d.data(), cardId: d.id } })
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

export async function addCard(user, card, amount = 1) {
  if (!card?.id || amount <= 0) return
  if (firebaseConfigured && db && user) {
    const ref = doc(db, 'users', user.uid, 'collection', card.id)
    const entry = normalizeEntry(card, amount)
    await setDoc(ref, {
      ...entry,
      quantity: increment(amount),
      updatedAt: serverTimestamp()
    }, { merge: true })
    return
  }

  const data = readLocal()
  const existing = data[card.id]
  data[card.id] = normalizeEntry(card, (existing?.quantity || 0) + amount)
  writeLocal(data)
}

export async function setQuantity(user, card, quantity) {
  if (!card?.cardId && !card?.id) return
  const id = card.cardId || card.id
  if (quantity <= 0) {
    if (firebaseConfigured && db && user) {
      await deleteDoc(doc(db, 'users', user.uid, 'collection', id))
    } else {
      const data = readLocal()
      delete data[id]
      writeLocal(data)
    }
    return
  }

  if (firebaseConfigured && db && user) {
    await setDoc(doc(db, 'users', user.uid, 'collection', id), {
      ...normalizeEntry({ ...card, id }, quantity),
      quantity,
      updatedAt: serverTimestamp()
    }, { merge: true })
  } else {
    const data = readLocal()
    data[id] = normalizeEntry({ ...card, id }, quantity)
    writeLocal(data)
  }
}
