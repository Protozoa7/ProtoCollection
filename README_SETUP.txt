ProtoCollection V1.1 — Multilingual Update
===========================================

WHAT CHANGED
------------
V1.1 makes language part of your collection identity and card lookup.

Added:
- English
- Japanese
- Simplified Chinese
- Traditional Chinese
- Korean
- Thai
- French
- Spanish
- German
- Italian
- Portuguese (Brazil)
- Indonesian

The TCGdex API recognizes additional languages too, but completion varies by language.

IMPORTANT IF YOU ALREADY CONFIGURED FIREBASE
---------------------------------------------
DO NOT overwrite your working src/firebaseConfig.js with the blank file from this ZIP.

When updating the existing GitHub repo:
1. Keep your current src/firebaseConfig.js.
2. Replace the other V1 files with the V1.1 files.
3. Add the new src/languages.js file.
4. Commit to main.
5. GitHub Actions will redeploy automatically.

FILES THAT CHANGED / NEED TO BE REPLACED
----------------------------------------
src/App.jsx
src/collectionStore.js
src/tcgdex.js
src/styles.css

NEW FILE
--------
src/languages.js

You can also replace:
package.json
vite.config.js
.github/workflows/deploy.yml

The included workflow does NOT require package-lock.json.

MULTILINGUAL IMPORT
-------------------
The importer now looks for a Language column (or LANG / Lang).

Examples it understands:
ENG / EN / English -> en
JPN / JAP / JA / Japanese -> ja
CHN / Chinese -> zh-cn
CHT / Traditional Chinese -> zh-tw
KOR / Korean -> ko
THAI -> th
FRE / French -> fr
SPN / Spanish -> es
GER / German -> de
ITA / Italian -> it

If Language is blank, the importer assumes English.

Your full cleaned master CSV can now be used:
ProtoCollection_Master_FULL_Cleaned.csv

For ambiguous or unavailable cards, the importer does NOT force a match.
It shows how many rows need review and gives you a button to download those
unmatched rows as an Excel review file.

CHINESE NOTE
------------
The source collection files use CHN. V1.1 maps CHN to Simplified Chinese (zh-cn),
which is appropriate for the Chinese set codes in the supplied collection
(CBB / CSV / CS-style releases).

CARD IDENTITY
-------------
V1 used the catalog card ID alone.

V1.1 stores language + card ID + variant + condition for multilingual/detailed
entries. Default English / unspecified entries keep the original V1 document ID,
so existing English cards remain compatible after the update.

This means an English card and Japanese card can both exist in your binder
without overwriting one another. Imported Holo / Reverse Holo entries can also
remain distinct.

BROWSING / SEARCH
-----------------
Sets:
Choose Catalog Language, then browse that language's set catalog.

Search:
Choose Search Language, then search by name or collector number.

Binder:
Filter by language. Each card shows a language badge.

SCAN
----
Choose Card Language before scanning.

V1.1 loads a matching OCR model:
English -> English OCR
Japanese -> Japanese + English OCR
Simplified Chinese -> Simplified Chinese + English OCR
Traditional Chinese -> Traditional Chinese + English OCR
Korean -> Korean + English OCR
Thai -> Thai + English OCR
etc.

Collector number is still the strongest free recognition signal, especially
for Asian-language cards.

TCGDEX AVAILABILITY
-------------------
TCGdex is multilingual but different language databases have different levels
of completion. If a card is not available in the selected language database,
ProtoCollection leaves it unmatched instead of assigning the wrong card.

AFTER DEPLOYING
---------------
1. Open ProtoCollection.
2. Go to Sets and switch between English / Japanese / Chinese.
3. Confirm set browsing loads.
4. Go to Search and test a collector number in each language.
5. Go to More > Import multilingual collection.
6. Upload ProtoCollection_Master_FULL_Cleaned.csv.
7. Download the unmatched review file if any rows remain.
