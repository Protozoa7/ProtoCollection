// Firebase's web config is not a private secret. Firestore Security Rules protect your data.
// Paste the config object from Firebase Console > Project Settings > Your apps > Web app.
export const firebaseConfig = {
  apiKey: "AIzaSyChPHTC4w_uc368DblYaG-3YBi3dVKnihA",
  authDomain: "protocollection-3898f.firebaseapp.com",
  projectId: "protocollection-3898f",
  storageBucket: "protocollection-3898f.firebasestorage.app",
  messagingSenderId: "392168038411",
  appId: "1:392168038411:web:2d47b332e383202c3ba70e"
}

export const firebaseConfigured =
  Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId)
