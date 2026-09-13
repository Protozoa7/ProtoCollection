import { initializeApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut as firebaseSignOut,
  onAuthStateChanged
} from 'firebase/auth'
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from 'firebase/firestore'
import { firebaseConfig, firebaseConfigured } from './firebaseConfig'

let app = null
let auth = null
let db = null

if (firebaseConfigured) {
  app = initializeApp(firebaseConfig)
  auth = getAuth(app)
  db = initializeFirestore(app, {
    localCache: persistentLocalCache({
      tabManager: persistentMultipleTabManager()
    })
  })
}

export { auth, db, firebaseConfigured, onAuthStateChanged }

export async function signIn() {
  if (!auth) return
  const provider = new GoogleAuthProvider()
  await signInWithPopup(auth, provider)
}

export async function signOut() {
  if (!auth) return
  await firebaseSignOut(auth)
}
