import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, BookOpen, Camera, Check, ChevronRight, Download, FileDown, FileUp,
  Grid3X3, Layers3, LoaderCircle, LogIn, LogOut, Minus, Plus, Search,
  Settings, Sparkles, X
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { createWorker } from 'tesseract.js'
import { auth, firebaseConfigured, onAuthStateChanged, signIn, signOut } from './firebase'
import { addCard, catalogQuantity, setQuantity, subscribeCollection } from './collectionStore'
import {
  assetImage, candidatesFromOcr, cardImage, findCardForImport, getSet, getSets,
  hydrateCard, scannerOcrLanguage, searchCards
} from './tcgdex'
import { LANGUAGES, languageLabel, languageShort, parseLanguage } from './languages'

const tabs = [
  { id: 'collection', label: 'Binder', icon: BookOpen },
  { id: 'sets', label: 'Sets', icon: Layers3 },
  { id: 'scan', label: 'Scan', icon: Camera, primary: true },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'more', label: 'More', icon: Settings }
]

const ACTIVE_LANGUAGES = LANGUAGES.filter(l =>
  ['en','ja','zh-cn','zh-tw','ko','th','fr','es','de','it','pt-br','id'].includes(l.code)
)

function useCollection(user) {
  const [items, setItems] = useState({})
  useEffect(() => subscribeCollection(user, setItems), [user])
  return [items, setItems]
}

function LanguageSelect({ value, onChange, includeAll = false, className = '' }) {
  return (
    <select className={`language-select ${className}`} value={value} onChange={e => onChange(e.target.value)}>
      {includeAll && <option value="all">All languages</option>}
      {ACTIVE_LANGUAGES.map(l => <option key={l.code} value={l.code}>{l.label}</option>)}
    </select>
  )
}

function CardTile({ card, items, user, onOpen, collectionEntry = false }) {
  const lang = card.language || 'en'
  const qty = collectionEntry
    ? Number(card.quantity || 0)
    : catalogQuantity(items, card, lang)
  const [busy, setBusy] = useState(false)

  async function quickAdd(e) {
    e.stopPropagation()
    setBusy(true)
    try {
      const full = card.setName && card.image ? card : await hydrateCard(card, lang)
      await addCard(user, full, 1, { language: lang })
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={`card-tile ${qty ? 'owned' : ''}`} onClick={() => onOpen?.(card)}>
      <div className="card-image-shell">
        {cardImage(card, 'low')
          ? <img src={cardImage(card, 'low')} alt={card.name} loading="lazy" />
          : <div className="image-placeholder">No image</div>}
        <span className="language-badge">{languageShort(lang)}</span>
        {qty > 0 && <span className="owned-badge"><Check size={13}/> {qty}</span>}
      </div>
      <div className="card-tile-body">
        <div className="card-name">{card.name}</div>
        <div className="card-sub">
          #{card.localId}{card.setName ? ` · ${card.setName}` : ''}
        </div>
        {collectionEntry && (
          <div className="card-meta-line">
            {card.variant && card.variant !== 'Unspecified' && <span>{card.variant}</span>}
            {card.condition && card.condition !== 'Unspecified' && <span>{card.condition}</span>}
          </div>
        )}
        {!collectionEntry && (
          <button className={`quick-add ${qty ? 'has' : ''}`} onClick={quickAdd} disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={16}/> : <Plus size={17}/>}
            {qty ? 'Add another' : 'Add'}
          </button>
        )}
      </div>
    </article>
  )
}

function CardSheet({ card, items, user, onClose }) {
  const isEntry = Boolean(card.identityKey)
  const lang = card.language || 'en'
  const [full, setFull] = useState(card)
  const currentEntry = isEntry ? items[card.identityKey] : null
  const qty = isEntry
    ? Number(currentEntry?.quantity || card.quantity || 0)
    : catalogQuantity(items, card, lang)

  useEffect(() => {
    let alive = true
    hydrateCard(card, lang).then(v => alive && setFull(v))
    return () => { alive = false }
  }, [card.cardId, card.id, lang])

  async function addOne() {
    await addCard(user, full, 1, {
      language: lang,
      variant: isEntry ? card.variant : 'Unspecified',
      condition: isEntry ? card.condition : 'Unspecified'
    })
  }

  async function removeOne() {
    if (isEntry) {
      await setQuantity(user, currentEntry || card, Math.max(0, qty - 1))
      return
    }
    const matching = Object.values(items).find(x =>
      x.cardId === (card.cardId || card.id) &&
      (x.language || 'en') === lang
    )
    if (matching) await setQuantity(user, matching, Math.max(0, Number(matching.quantity || 0) - 1))
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <button className="icon-btn close" onClick={onClose}><X/></button>
        {cardImage(full, 'high') && <img className="sheet-card-image" src={cardImage(full, 'high')} alt={full.name}/>}
        <div className="sheet-content">
          <div className="detail-badges">
            <span>{languageLabel(lang)}</span>
            {isEntry && card.variant && card.variant !== 'Unspecified' && <span>{card.variant}</span>}
            {isEntry && card.condition && card.condition !== 'Unspecified' && <span>{card.condition}</span>}
          </div>
          <span className="eyebrow">{full.set?.name || full.setName || card.setName || 'Pokémon TCG'}</span>
          <h2>{full.name}</h2>
          <p className="muted">Collector #{full.localId}</p>
          <div className="qty-control">
            <button onClick={removeOne}><Minus/></button>
            <div><strong>{qty}</strong><span>owned</span></div>
            <button onClick={addOne}><Plus/></button>
          </div>
          {!isEntry && qty > 0 && (
            <p className="sheet-note">Quantity shown is the total for this card in {languageLabel(lang)} across variants/conditions.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function CollectionView({ items, user, onOpen }) {
  const [query, setQuery] = useState('')
  const [lang, setLang] = useState('all')
  const [sort, setSort] = useState('name')

  const list = useMemo(() => {
    const q = query.toLowerCase().trim()
    let out = Object.values(items).filter(x => {
      const languageOk = lang === 'all' || (x.language || 'en') === lang
      const queryOk = !q ||
        x.name?.toLowerCase().includes(q) ||
        x.setName?.toLowerCase().includes(q) ||
        String(x.localId).toLowerCase().includes(q) ||
        String(x.variant || '').toLowerCase().includes(q)
      return languageOk && queryOk
    })
    out.sort((a, b) => {
      if (sort === 'qty') return (b.quantity || 0) - (a.quantity || 0) || a.name.localeCompare(b.name)
      if (sort === 'set') return (a.setName || '').localeCompare(b.setName || '') || a.name.localeCompare(b.name)
      if (sort === 'lang') return (a.language || 'en').localeCompare(b.language || 'en') || a.name.localeCompare(b.name)
      return a.name.localeCompare(b.name)
    })
    return out
  }, [items, query, lang, sort])

  const allEntries = Object.values(items)
  const total = allEntries.reduce((s, x) => s + Number(x.quantity || 0), 0)
  const uniqueCards = new Set(allEntries.map(x => `${x.language || 'en'}::${x.cardId}`)).size

  return (
    <>
      <section className="hero">
        <div>
          <span className="eyebrow">MY DIGITAL BINDER</span>
          <h1>ProtoCollection</h1>
          <p>{uniqueCards} unique cards · {total} total copies</p>
        </div>
        <div className="hero-orb"><Sparkles/></div>
      </section>

      <div className="searchbar">
        <Search size={19}/>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your binder…" />
      </div>

      <div className="filter-row">
        <LanguageSelect value={lang} onChange={setLang} includeAll/>
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="name">Sort: Name</option>
          <option value="set">Sort: Set</option>
          <option value="qty">Sort: Quantity</option>
          <option value="lang">Sort: Language</option>
        </select>
      </div>

      <div className="toolbar"><span>{list.length} binder entries</span></div>

      {!list.length ? (
        <Empty icon={BookOpen} title="No cards here yet" text="Browse a set, search, scan, or import your collection."/>
      ) : (
        <div className="card-grid">
          {list.map(card => (
            <CardTile key={card.identityKey} card={card} items={items} user={user}
              onOpen={onOpen} collectionEntry/>
          ))}
        </div>
      )}
    </>
  )
}

function SetsView({ items, user, onOpen }) {
  const [lang, setLang] = useState('en')
  const [sets, setSets] = useState([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [setData, setSetData] = useState(null)
  const [cardQuery, setCardQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    setLoading(true); setError(''); setSelected(null); setSetData(null)
    getSets(lang)
      .then(setSets)
      .catch(e => { setSets([]); setError(e.message) })
      .finally(() => setLoading(false))
  }, [lang])

  useEffect(() => {
    if (!selected) { setSetData(null); return }
    setSetData(null); setError('')
    getSet(selected.id, lang)
      .then(setSetData)
      .catch(e => setError(e.message))
  }, [selected?.id, lang])

  if (selected) {
    const cards = (setData?.cards || []).filter(c => {
      const q = cardQuery.toLowerCase().trim()
      return !q || c.name.toLowerCase().includes(q) || String(c.localId).toLowerCase().includes(q)
    }).map(c => ({ ...c, language: lang, setId: selected.id, setName: selected.name }))

    return (
      <>
        <button className="back-link" onClick={() => setSelected(null)}><ArrowLeft size={18}/> All sets</button>
        <section className="set-header">
          {setData?.logo && <img src={assetImage(setData.logo)} alt=""/>}
          <div>
            <span className="eyebrow">{languageLabel(lang).toUpperCase()}</span>
            <h1>{selected.name}</h1>
            <p>{setData?.releaseDate || `${selected.cardCount?.total || ''} cards`}</p>
          </div>
        </section>
        <div className="searchbar">
          <Search size={19}/>
          <input value={cardQuery} onChange={e => setCardQuery(e.target.value)} placeholder={`Search ${selected.name}…`} />
        </div>
        {error && <ErrorBox text={error}/>}
        {!setData && !error ? <Loading text="Opening set…" /> :
          <div className="card-grid">
            {cards.map(c => <CardTile key={`${lang}-${c.id}`} card={c} items={items} user={user} onOpen={onOpen}/>)}
          </div>
        }
      </>
    )
  }

  const filtered = sets.filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
  return (
    <>
      <PageTitle eyebrow="MULTILINGUAL CARD CATALOG" title="Browse Sets" subtitle="Choose a language, open a set, and add cards directly to your binder."/>
      <div className="language-toolbar">
        <span>Catalog language</span>
        <LanguageSelect value={lang} onChange={setLang}/>
      </div>
      <div className="searchbar"><Search size={19}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search sets…" /></div>
      {error && <ErrorBox text={`${languageLabel(lang)} catalog unavailable or incomplete: ${error}`}/>}
      {loading ? <Loading text={`Loading ${languageLabel(lang)} sets…`}/> :
        <div className="set-list">
          {filtered.map(set => (
            <button key={`${lang}-${set.id}`} className="set-row" onClick={() => setSelected(set)}>
              <div className="set-logo-box">{set.logo ? <img src={assetImage(set.logo)} alt=""/> : <Layers3/>}</div>
              <div className="set-row-copy"><strong>{set.name}</strong><span>{set.cardCount?.total || '?'} cards · {languageShort(lang)}</span></div>
              <ChevronRight/>
            </button>
          ))}
        </div>
      }
    </>
  )
}

function SearchView({ items, user, onOpen }) {
  const [lang, setLang] = useState('en')
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); setError(''); return }
    const timer = setTimeout(async () => {
      setLoading(true); setError('')
      try { setResults(await searchCards(q, lang)) }
      catch (e) { setResults([]); setError(e.message) }
      finally { setLoading(false) }
    }, 350)
    return () => clearTimeout(timer)
  }, [q, lang])

  return (
    <>
      <PageTitle eyebrow="ALL CARDS" title="Find a Card" subtitle="Search one language catalog at a time by card name or collector number."/>
      <div className="language-toolbar">
        <span>Search language</span><LanguageSelect value={lang} onChange={setLang}/>
      </div>
      <div className="searchbar big">
        <Search size={20}/><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Name or collector number…" />
      </div>
      {error && <ErrorBox text={error}/>}
      {loading && <Loading text={`Searching ${languageLabel(lang)} cards…`}/>}
      {!loading && !error && q.length >= 2 && !results.length && <Empty icon={Search} title="No matches" text="Try the collector number, a different spelling, or another language."/>}
      <div className="card-grid">
        {results.map(c => <CardTile key={`${lang}-${c.id}`} card={{...c, language: lang}} items={items} user={user} onOpen={onOpen}/>)}
      </div>
    </>
  )
}

function ScannerView({ items, user, onOpen }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const [lang, setLang] = useState('en')
  const [active, setActive] = useState(false)
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState('')
  const [candidates, setCandidates] = useState([])
  const [rawText, setRawText] = useState('')
  const [rapid, setRapid] = useState(true)
  const [lastAdded, setLastAdded] = useState('')

  useEffect(() => () => stopCamera(), [])

  async function startCamera() {
    setCandidates([]); setRawText(''); setLastAdded('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
      setActive(true)
    } catch (e) {
      alert(`Camera unavailable: ${e.message}`)
    }
  }

  function stopCamera() {
    streamRef.current?.getTracks()?.forEach(t => t.stop())
    streamRef.current = null
    setActive(false)
  }

  async function scanFrame() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || !video.videoWidth) return
    setWorking(true); setCandidates([]); setProgress('Capturing card…')
    try {
      const w = video.videoWidth, h = video.videoHeight
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(video, 0, 0, w, h)

      setProgress(`Loading ${languageLabel(lang)} OCR…`)
      const worker = await createWorker(scannerOcrLanguage(lang), 1, {
        logger: m => {
          if (m.status === 'recognizing text') setProgress(`Reading card… ${Math.round((m.progress || 0) * 100)}%`)
        }
      })

      const { data } = await worker.recognize(canvas)
      await worker.terminate()
      const text = data.text || ''
      setRawText(text)

      setProgress(`Matching against ${languageLabel(lang)} cards…`)
      const found = await candidatesFromOcr(text, lang)
      setCandidates(found)
      setProgress(found.length ? '' : 'No confident match. Try closer, brighter, and flatter.')
    } catch (e) {
      setProgress(`Scan failed: ${e.message}`)
    } finally {
      setWorking(false)
    }
  }

  async function choose(card) {
    const full = await hydrateCard(card, lang)
    await addCard(user, full, 1, { language: lang })
    setLastAdded(`${full.name} · #${full.localId} · ${languageShort(lang)}`)
    if (rapid) {
      setCandidates([]); setRawText('')
      setProgress('Added. Ready for the next card.')
      setTimeout(() => setProgress(''), 1600)
    } else {
      onOpen(full)
    }
  }

  return (
    <>
      <PageTitle eyebrow="MULTILINGUAL CAMERA SCANNER" title="Rapid Scan" subtitle="Choose the card language first. The scanner uses that language's catalog and OCR model."/>
      <div className="language-toolbar scanner-language">
        <span>Card language</span><LanguageSelect value={lang} onChange={setLang}/>
      </div>
      <div className="rapid-toggle">
        <div><strong>Rapid mode</strong><span>Stay in camera after each add</span></div>
        <button className={rapid ? 'toggle on' : 'toggle'} onClick={() => setRapid(!rapid)}><i/></button>
      </div>
      <div className="scanner">
        <video ref={videoRef} playsInline muted className={active ? '' : 'hidden'} />
        {!active && <div className="camera-empty"><Camera size={44}/><p>Use your rear camera to identify a {languageLabel(lang)} card.</p><button className="primary" onClick={startCamera}><Camera size={18}/> Open camera</button></div>}
        {active && <div className="scan-frame"><span/><span/><span/><span/></div>}
        {active && <button className="camera-close" onClick={stopCamera}><X/></button>}
        {active && <button className="shutter" onClick={scanFrame} disabled={working}><span>{working ? <LoaderCircle className="spin"/> : <Camera/>}</span></button>}
      </div>
      <canvas ref={canvasRef} className="hidden"/>
      {lastAdded && <div className="success-toast"><Check/> Added {lastAdded}</div>}
      {progress && <div className="scan-status">{working && <LoaderCircle className="spin" size={18}/>} {progress}</div>}
      {candidates.length > 0 && (
        <section className="scan-results">
          <div className="section-heading"><div><span className="eyebrow">LIKELY {languageShort(lang)} MATCHES</span><h2>Tap the correct card</h2></div><span>{candidates.length}</span></div>
          <div className="candidate-grid">
            {candidates.map(c => (
              <button key={`${lang}-${c.id}`} onClick={() => choose(c)}>
                {cardImage(c, 'low') && <img src={cardImage(c, 'low')} alt={c.name}/>}
                <strong>{c.name}</strong><span>#{c.localId}</span>
              </button>
            ))}
          </div>
          <details className="ocr-details"><summary>Show OCR text</summary><pre>{rawText}</pre></details>
        </section>
      )}
      <div className="scanner-tip"><Sparkles/><div><strong>Scanner tip</strong><span>For Japanese, Chinese, Korean, and Thai cards, the collector number is especially valuable. Keep the bottom of the card sharp and glare-free.</span></div></div>
    </>
  )
}

function MoreView({ items, user }) {
  const fileRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const [unmatched, setUnmatched] = useState([])

  function exportCollection() {
    const rows = Object.values(items).map(x => ({
      'Card Name': x.name,
      'Set': x.setName,
      'Card Number': x.localId,
      'Quantity': x.quantity,
      'Language': languageShort(x.language || 'en'),
      'Variant': x.variant === 'Unspecified' ? '' : x.variant,
      'Condition': x.condition === 'Unspecified' ? '' : x.condition
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Collection')
    XLSX.writeFile(wb, `ProtoCollection-${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  function downloadUnmatched() {
    if (!unmatched.length) return
    const ws = XLSX.utils.json_to_sheet(unmatched)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Needs Review')
    XLSX.writeFile(wb, `ProtoCollection-Needs-Review-${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  async function matchRow(row) {
    const name = row['Card Name'] ?? row['Name'] ?? row['Product Name'] ?? row['Product'] ?? ''
    const setName = row['Set'] ?? row['Set Name'] ?? row['Expansion'] ?? ''
    const number = row['Card Number'] ?? row['Number'] ?? row['Collector Number'] ?? row['#'] ?? ''
    const quantity = Math.max(1, Number(row['Quantity'] ?? row['Qty'] ?? 1) || 1)
    const rawLanguage = row['Language'] ?? row['LANG'] ?? row['Lang'] ?? 'ENG'
    const lang = parseLanguage(rawLanguage, 'en')
    const variant = row['Variant'] ?? row['HOLO'] ?? row['Finish'] ?? ''
    const condition = row['Condition'] ?? row['Card Condition'] ?? ''

    if (!lang) {
      return { error: `Unsupported/unknown language "${rawLanguage}"`, row }
    }

    const card = await findCardForImport({ name, setName, number, lang })
    if (!card) {
      return { error: `No confident ${languageLabel(lang)} catalog match`, row }
    }

    return { card, quantity, lang, variant, condition }
  }

  async function handleImport(file) {
    if (!file) return
    setImporting(true); setImportStatus('Reading spreadsheet…'); setUnmatched([])
    try {
      const data = await file.arrayBuffer()
      const wb = XLSX.read(data)
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      let copiesAdded = 0, matchedRows = 0
      const misses = []

      for (let i = 0; i < rows.length; i++) {
        setImportStatus(`Matching row ${i + 1} of ${rows.length}…`)
        const result = await matchRow(rows[i])
        if (result.card) {
          const full = await hydrateCard(result.card, result.lang)
          await addCard(user, full, result.quantity, {
            language: result.lang,
            variant: result.variant,
            condition: result.condition
          })
          copiesAdded += result.quantity
          matchedRows++
        } else {
          misses.push({ ...rows[i], 'ProtoCollection Review Reason': result.error })
        }
      }

      setUnmatched(misses)
      setImportStatus(`Import complete: ${copiesAdded} copies added from ${matchedRows} rows${misses.length ? ` · ${misses.length} rows need review` : ' · no review needed'}.`)
    } catch (e) {
      setImportStatus(`Import failed: ${e.message}`)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <>
      <PageTitle eyebrow="TOOLS & ACCOUNT" title="More" subtitle="Import, export, sync, and account controls."/>
      <div className="settings-list">
        <button className="settings-row" onClick={() => fileRef.current?.click()} disabled={importing}>
          <span className="settings-icon"><FileUp/></span><div><strong>Import multilingual collection</strong><span>CSV/XLSX · language-aware matching</span></div><ChevronRight/>
        </button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => handleImport(e.target.files?.[0])}/>

        <button className="settings-row" onClick={exportCollection}>
          <span className="settings-icon"><Download/></span><div><strong>Export collection</strong><span>Includes language, variant, and condition</span></div><ChevronRight/>
        </button>

        {unmatched.length > 0 && (
          <button className="settings-row review-row" onClick={downloadUnmatched}>
            <span className="settings-icon"><FileDown/></span><div><strong>Download {unmatched.length} unmatched rows</strong><span>Keep a review file instead of losing ambiguous cards</span></div><ChevronRight/>
          </button>
        )}

        {firebaseConfigured && user && <button className="settings-row" onClick={signOut}>
          <span className="settings-icon"><LogOut/></span><div><strong>Sign out</strong><span>{user.email}</span></div><ChevronRight/>
        </button>}
      </div>

      {importStatus && <div className="import-status">{importing && <LoaderCircle className="spin"/>}{importStatus}</div>}

      <div className="supported-languages">
        <strong>V1.1 catalog languages</strong>
        <div>{ACTIVE_LANGUAGES.map(l => <span key={l.code}>{l.short}</span>)}</div>
        <p>TCGdex completion varies by language. An unavailable card stays in the review file rather than being forced to the wrong match.</p>
      </div>

      {!firebaseConfigured && <div className="setup-card"><strong>Local test mode</strong><p>Firebase has not been configured yet. Your binder is currently saved only in this browser.</p></div>}
      {firebaseConfigured && <div className="setup-card good"><strong>Cloud sync enabled</strong><p>Firestore is configured. Language is now part of each collection entry, so English, Japanese, Chinese, etc. copies remain distinct.</p></div>}
    </>
  )
}

function AuthGate() {
  const [busy, setBusy] = useState(false)
  return (
    <div className="auth-screen">
      <div className="auth-logo"><Grid3X3/></div>
      <span className="eyebrow">PERSONAL DIGITAL BINDER</span>
      <h1>ProtoCollection</h1>
      <p>Your multilingual Pokémon collection synchronized across phone and computer.</p>
      <button className="primary auth-btn" disabled={busy} onClick={async () => {
        setBusy(true)
        try { await signIn() } finally { setBusy(false) }
      }}>
        {busy ? <LoaderCircle className="spin"/> : <LogIn/>} Continue with Google
      </button>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(firebaseConfigured ? undefined : null)
  const [tab, setTab] = useState('collection')
  const [openCard, setOpenCard] = useState(null)
  const [items] = useCollection(user || null)

  useEffect(() => {
    if (!firebaseConfigured) return
    return onAuthStateChanged(auth, setUser)
  }, [])

  if (firebaseConfigured && user === undefined) return <div className="splash"><LoaderCircle className="spin"/><span>Opening binder…</span></div>
  if (firebaseConfigured && !user) return <AuthGate/>

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setTab('collection')}>
          <span className="brand-mark"><Grid3X3/></span><span>ProtoCollection</span>
        </button>
        <span className={`sync-pill ${firebaseConfigured ? 'cloud' : ''}`}>{firebaseConfigured ? 'Cloud' : 'Local'}</span>
      </header>

      <main>
        {tab === 'collection' && <CollectionView items={items} user={user} onOpen={setOpenCard}/>}
        {tab === 'sets' && <SetsView items={items} user={user} onOpen={setOpenCard}/>}
        {tab === 'scan' && <ScannerView items={items} user={user} onOpen={setOpenCard}/>}
        {tab === 'search' && <SearchView items={items} user={user} onOpen={setOpenCard}/>}
        {tab === 'more' && <MoreView items={items} user={user}/>}
      </main>

      <nav className="bottom-nav">
        {tabs.map(({ id, label, icon: Icon, primary }) => (
          <button key={id} className={`${tab === id ? 'active' : ''} ${primary ? 'primary-tab' : ''}`} onClick={() => setTab(id)}>
            <span><Icon/></span><em>{label}</em>
          </button>
        ))}
      </nav>

      {openCard && <CardSheet card={openCard} items={items} user={user} onClose={() => setOpenCard(null)}/>}
    </div>
  )
}

function PageTitle({ eyebrow, title, subtitle }) {
  return <section className="page-title"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{subtitle}</p></section>
}

function Loading({ text }) {
  return <div className="loading"><LoaderCircle className="spin"/><span>{text}</span></div>
}

function Empty({ icon: Icon, title, text }) {
  return <div className="empty"><span><Icon/></span><h3>{title}</h3><p>{text}</p></div>
}

function ErrorBox({ text }) {
  return <div className="error-box">{text}</div>
}

export default App
