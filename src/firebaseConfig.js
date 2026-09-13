// Firebase's web config is not a private secret. Firestore Security Rules protect your data.
// Paste the config object from Firebase Console > Project Settings > Your apps > Web app.
export const firebaseConfig = {
  apiKey: "",
  authDomain: "",
  projectId: "",
  storageBucket: "",
  messagingSenderId: "",
  appId: ""
}

export const firebaseConfigured =
  Boolean(firebaseConfig.apiKey && firebaseConfig.authDomain && firebaseConfig.projectId && firebaseConfig.appId)
