# ProtoCollection V1 — setup first

This project is ready to run in **Local Test Mode** immediately.  
To get the feature you actually want — one collection synchronized between phone and desktop — complete the Firebase steps below.

## 1. Create a GitHub repository

Suggested repository name:

`protocollection`

Upload every file/folder from this project to the **main** branch.

In GitHub:
- **Settings**
- **Pages**
- Under **Build and deployment**, choose **GitHub Actions**

The included workflow will build and publish the app on every push to `main`.

## 2. Create the free Firebase project

1. Go to Firebase Console.
2. Create a project, e.g. `protocollection`.
3. Add a **Web App**.
4. Firebase will show a `firebaseConfig` object.
5. Open `src/firebaseConfig.js`.
6. Replace the blank values with your Firebase Web App config.

The Firebase web config is designed to be present in browser code. Your data is protected by Authentication + Firestore Security Rules, not by hiding this config.

## 3. Turn on Google sign-in

Firebase Console:
- **Authentication**
- **Sign-in method**
- Enable **Google**

After GitHub Pages gives you the final site domain, make sure that domain is allowed under Firebase Authentication's authorized domains if it is not already present.

## 4. Create Firestore

Firebase Console:
- **Firestore Database**
- Create database
- Use a U.S. region appropriate for you

Then open Firestore **Rules** and replace them with the contents of `firestore.rules`.

Those rules mean a logged-in user can only read/write documents under their own Firebase UID.

## 5. Deploy

Commit the edited `src/firebaseConfig.js` to `main`.

GitHub Actions will automatically rebuild the site.

When the site opens, you should now see **Continue with Google** instead of Local Test Mode.

## V1 navigation

### Binder
Your actual personal collection. Shows unique cards and total quantity.

### Sets
Search the Pokémon TCG set catalog, open a set, search within it, and tap **Add** directly from the visual card grid.

### Scan
Rear-camera OCR scanner.
- Rapid Mode stays open after adding a card.
- It reads the photographed card and returns likely TCGdex matches.
- Tap the correct result to add it.
- This V1 scanner intentionally asks for confirmation rather than silently creating bad matches.

### Search
Global TCGdex search by card name or collector number.

### More
- CSV/XLSX import
- Excel export
- Firebase account/logout
- Sync status

## Spreadsheet import columns

The importer recognizes common variants of:

- `Card Name`, `Name`, `Product Name`, `Product`
- `Set`, `Set Name`, `Expansion`
- `Card Number`, `Number`, `Collector Number`
- `Quantity`, `Qty`

The more of **Set + Card Number + Card Name** your sheet contains, the more reliable automatic matching will be.

TCGplayer exports vary by tool/export type. V1 recognizes common TCGplayer-style column names, but save a copy of the original spreadsheet so we can tune the parser against your actual Level 4 export if needed.

## Important V1 scanner notes

The scanner is free/on-device OCR, not a paid computer-vision service.

Best results:
- rear camera
- one card at a time
- card centered and nearly filling the guide
- bright, even lighting
- avoid sleeve glare
- keep the bottom collector number readable

The next scanner improvement should be cropping/processing the title and collector-number regions separately, followed by visual ranking of the candidate card images.

## What V1 intentionally does NOT track

- acquisition cost
- acquisition date
- collection value/pricing
- grading
- sale/trade status
- binder/storage location
- set completion goals

ProtoCollection is a **personal digital binder**, not sales inventory software.

## Local development (optional)

Requires Node.js 20+:

```bash
npm install
npm run dev
```

Production test:

```bash
npm run build
npm run preview
```
