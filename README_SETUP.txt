ProtoCollection V1.2 — Scanner + Safe Imports
=============================================

WHAT CHANGED
------------
1. Imports no longer write to your binder immediately.
   Upload -> automatic matching -> in-app review queue -> explicit Confirm Import.

2. Manual Review Queue is now inside the app.
   For every unresolved row you can:
   - see the original card/set/number/language
   - choose a suggested card image
   - change the language
   - manually search the selected language catalog
   - skip the row

3. Entire V1.2 imports can be reversed.
   More -> Import History -> Reverse
   The app records the exact quantity added to each binder entry and subtracts that import as one operation.

IMPORTANT: imports performed before V1.2 were not recorded with import history, so V1.2 cannot safely reverse an old V1/V1.1 import automatically.

4. Scanner was rebuilt.
   - only the NAME region is OCR'd for the card name
   - only the lower card region is OCR'd for the collector number
   - collector number is weighted heavily
   - optional Set Lock restricts matches to one set
   - likely matches are then ranked using a lightweight artwork similarity comparison when browser CORS permits it
   - Rapid Scan remains available

SET LOCK
--------
For best scanner accuracy:
1. Open Scan.
2. Choose card language.
3. Choose the set under Set Lock whenever you know it.
4. Center the physical card inside the guide.
5. Keep the collector number at the bottom sharp and glare-free.
6. Tap the shutter button.

UPDATE YOUR EXISTING GITHUB REPOSITORY
--------------------------------------
Use the UPDATE-ONLY ZIP.

Replace these files/folders in your existing repo:
- src/App.jsx
- src/collectionStore.js
- src/tcgdex.js
- src/styles.css
- package.json
- vite.config.js
- .github/workflows/deploy.yml

Your existing files that are NOT in the update package should stay in place, especially:
- src/firebaseConfig.js
- src/firebase.js
- src/languages.js
- firestore.rules
- public icons

DO NOT replace your configured src/firebaseConfig.js with a blank config.

After committing the replacements to main, GitHub Actions should rebuild automatically.

IMPORT WORKFLOW
---------------
More -> Import collection

The app first stages the spreadsheet. Nothing is written to Firestore during staging.

If rows need review, the Review Queue opens. Resolve each row by selecting the correct suggested card, searching manually, changing language, or explicitly skipping it.

The Confirm Import button stays disabled while unresolved rows remain.

When all rows are either resolved or skipped, press Confirm Import. A final confirmation prompt appears before anything is added to the binder.

REVERSING AN IMPORT
-------------------
More -> Import History -> Reverse

V1.2 stores the exact card/quantity deltas for each confirmed import. Reverse subtracts those quantities from the current binder and marks the import Reversed.

For safety, one reversible import supports up to 450 unique binder entries. Larger files should be split into two imports.

V1.2 does not attempt to reconstruct or reverse imports that happened in V1/V1.1 because those older versions did not store import provenance.

FIREBASE
--------
No Firestore rule changes are required from V1.1.
The current rule matching /users/{userId}/{document=**} already covers the new /imports subcollection.

LOCAL TEST MODE
---------------
The same staged/confirm/reverse workflow works locally if Firebase is not configured. Local data remains browser-specific.
