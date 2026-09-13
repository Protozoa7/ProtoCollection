import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeft, BookOpen, Camera, Check, ChevronRight, Download, FileUp,
  Grid3X3, Layers3, LoaderCircle, LogIn, LogOut, Minus, Plus, Search,
  Settings, Sparkles, X
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { createWorker } from 'tesseract.js'
import { auth, firebaseConfigured, onAuthStateChanged, signIn, signOut } from './firebase'
import { addCard, setQuantity, subscribeCollection } from './collectionStore'
import {
  assetImage, candidatesFromOcr, cardImage, getSet, getSets, hydrateCard, searchCards
} from './tcgdex'

const tabs = [
  { id: 'collection', label: 'Binder', icon: BookOpen },
  { id: 'sets', label: 'Sets', icon: Layers3 },
  { id: 'scan', label: 'Scan', icon: Camera, primary: true },
  { id: 'search', label: 'Search', icon: Search },
  { id: 'more', label: 'More', icon: Settings }
]

function useCollection(user) {
  const [items, setItems] = useState({})
  useEffect(() => subscribeCollection(user, setItems), [user])
  return [items, setItems]
}

function quantityOf(items, id) {
  return Number(items[id]?.quantity || 0)
}

function CardTile({ card, items, user, onOpen, compact = false }) {
  const qty = quantityOf(items, card.id || card.cardId)
  const [busy, setBusy] = useState(false)

  async function quickAdd(e) {
    e.stopPropagation()
    setBusy(true)
    try {
      const full = card.setName ? card : await hydrateCard(card)
      await addCard(user, full, 1)
    } finally {
      setBusy(false)
    }
  }

  const img = cardImage(card, compact ? 'low' : 'low')
  return (
    <article className={`card-tile ${qty ? 'owned' : ''}`} onClick={() => onOpen?.(card)}>
      <div className="card-image-shell">
        {img ? <img src={img} alt={card.name} loading="lazy" /> : <div className="image-placeholder">No image</div>}
        {qty > 0 && <span className="owned-badge"><Check size={13}/> {qty}</span>}
      </div>
      <div className="card-tile-body">
        <div className="card-name">{card.name}</div>
        <div className="card-sub">#{card.localId}{card.setName ? ` · ${card.setName}` : ''}</div>
        <button className={`quick-add ${qty ? 'has' : ''}`} onClick={quickAdd} disabled={busy}>
          {busy ? <LoaderCircle className="spin" size={16}/> : <Plus size={17}/>}
          {qty ? 'Add another' : 'Add'}
        </button>
      </div>
    </article>
  )
}

function CardSheet({ card, items, user, onClose }) {
  const id = card?.id || card?.cardId
  const current = items[id] || card
  const qty = quantityOf(items, id)
  const [full, setFull] = useState(card)

  useEffect(() => {
    let alive = true
    hydrateCard(card).then(v => alive && setFull(v))
    return () => { alive = false }
  }, [id])

  if (!card) return null
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" onClick={e => e.stopPropagation()}>
        <button className="icon-btn close" onClick={onClose}><X/></button>
        <img className="sheet-card-image" src={cardImage(full, 'high')} alt={full.name}/>
        <div className="sheet-content">
          <span className="eyebrow">{full.set?.name || full.setName || current?.setName || 'Pokémon TCG'}</span>
          <h2>{full.name}</h2>
          <p className="muted">Collector #{full.localId}</p>
          <div className="qty-control">
            <button onClick={() => setQuantity(user, { ...current, ...full, cardId: id }, Math.max(0, qty - 1))}><Minus/></button>
            <div><strong>{qty}</strong><span>owned</span></div>
            <button onClick={async () => addCard(user, await hydrateCard(full), 1)}><Plus/></button>
          </div>
        </div>
      </div>
    </div>
  )
}

function CollectionView({ items, user, onOpen }) {
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState('name')
  const list = useMemo(() => {
    const q = query.toLowerCase().trim()
    let out = Object.values(items).filter(x =>
      !q || x.name?.toLowerCase().includes(q) || x.setName?.toLowerCase().includes(q) || String(x.localId).toLowerCase().includes(q)
    )
    out.sort((a, b) => {
      if (sort === 'qty') return (b.quantity || 0) - (a.quantity || 0) || a.name.localeCompare(b.name)
      if (sort === 'set') return (a.setName || '').localeCompare(b.setName || '') || a.name.localeCompare(b.name)
      return a.name.localeCompare(b.name)
    })
    return out
  }, [items, query, sort])
  const total = Object.values(items).reduce((s, x) => s + Number(x.quantity || 0), 0)

  return (
    <>
      <section className="hero">
        <div>
          <span className="eyebrow">MY DIGITAL BINDER</span>
          <h1>ProtoCollection</h1>
          <p>{list.length === Object.keys(items).length ? Object.keys(items).length : list.length} unique · {total} total cards</p>
        </div>
        <div className="hero-orb"><Sparkles/></div>
      </section>
      <div className="searchbar">
        <Search size={19}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search your binder…" />
      </div>
      <div className="toolbar">
        <span>{list.length} cards</span>
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="name">Name</option><option value="set">Set</option><option value="qty">Quantity</option>
        </select>
      </div>
      {!list.length ? (
        <Empty icon={BookOpen} title="Your binder is empty" text="Browse a set, search for a card, or use Scan to start adding cards."/>
      ) : (
        <div className="card-grid">
          {list.map(card => <CardTile key={card.cardId} card={{...card, id: card.cardId}} items={items} user={user} onOpen={onOpen}/>)}
        </div>
      )}
    </>
  )
}

function SetsView({ items, user, onOpen }) {
  const [sets, setSets] = useState([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState(null)
  const [setData, setSetData] = useState(null)
  const [cardQuery, setCardQuery] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getSets().then(setSets).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!selected) { setSetData(null); return }
    setSetData(null)
    getSet(selected.id).then(setSetData)
  }, [selected?.id])

  if (selected) {
    const cards = (setData?.cards || []).filter(c => {
      const q = cardQuery.toLowerCase().trim()
      return !q || c.name.toLowerCase().includes(q) || String(c.localId).toLowerCase().includes(q)
    }).map(c => ({ ...c, setId: selected.id, setName: selected.name }))
    return (
      <>
        <button className="back-link" onClick={() => setSelected(null)}><ArrowLeft size={18}/> All sets</button>
        <section className="set-header">
          {setData?.logo && <img src={assetImage(setData.logo)} alt=""/>}
          <div>
            <span className="eyebrow">{setData?.serie?.name || 'Pokémon TCG'}</span>
            <h1>{selected.name}</h1>
            <p>{setData?.releaseDate || `${selected.cardCount?.total || ''} cards`}</p>
          </div>
        </section>
        <div className="searchbar">
          <Search size={19}/><input value={cardQuery} onChange={e => setCardQuery(e.target.value)} placeholder={`Search ${selected.name}…`} />
        </div>
        {!setData ? <Loading text="Opening binder…"/> :
          <div className="card-grid">{cards.map(c => <CardTile key={c.id} card={c} items={items} user={user} onOpen={onOpen}/>)}</div>
        }
      </>
    )
  }

  const filtered = sets.filter(s => s.name.toLowerCase().includes(query.toLowerCase()))
  return (
    <>
      <PageTitle eyebrow="CARD CATALOG" title="Browse Sets" subtitle="Open any set and add cards straight to your binder."/>
      <div className="searchbar"><Search size={19}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search sets…" /></div>
      {loading ? <Loading text="Loading sets…"/> :
        <div className="set-list">
          {filtered.map(set => (
            <button key={set.id} className="set-row" onClick={() => setSelected(set)}>
              <div className="set-logo-box">{set.logo ? <img src={assetImage(set.logo)} alt=""/> : <Layers3/>}</div>
              <div className="set-row-copy"><strong>{set.name}</strong><span>{set.cardCount?.total || '?'} cards</span></div>
              <ChevronRight/>
            </button>
          ))}
        </div>
      }
    </>
  )
}

function SearchView({ items, user, onOpen }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (q.trim().length < 2) { setResults([]); return }
    const timer = setTimeout(async () => {
      setLoading(true)
      try { setResults(await searchCards(q)) } finally { setLoading(false) }
    }, 350)
    return () => clearTimeout(timer)
  }, [q])

  return (
    <>
      <PageTitle eyebrow="ALL CARDS" title="Find a Card" subtitle="Search by Pokémon name or collector number."/>
      <div className="searchbar big"><Search size={20}/><input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Charizard, Pikachu, 199/165…" /></div>
      {loading && <Loading text="Searching cards…"/>}
      {!loading && q.length >= 2 && !results.length && <Empty icon={Search} title="No matches" text="Try the card name or collector number."/>}
      <div className="card-grid">{results.map(c => <CardTile key={c.id} card={c} items={items} user={user} onOpen={onOpen}/>)}</div>
    </>
  )
}

function ScannerView({ items, user, onOpen }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
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
      const ctx = canvas.getContext('2d')
      ctx.drawImage(video, 0, 0, w, h)

      setProgress('Reading card text…')
      const worker = await createWorker('eng', 1, {
        logger: m => {
          if (m.status === 'recognizing text') setProgress(`Reading card… ${Math.round((m.progress || 0) * 100)}%`)
        }
      })
      const { data } = await worker.recognize(canvas)
      await worker.terminate()
      const text = data.text || ''
      setRawText(text)

      setProgress('Matching card…')
      const found = await candidatesFromOcr(text)
      setCandidates(found)
      if (!found.length) setProgress('No confident match. Try closer, brighter, and flatter.')
      else setProgress('')
    } catch (e) {
      setProgress(`Scan failed: ${e.message}`)
    } finally {
      setWorking(false)
    }
  }

  async function choose(card) {
    const full = await hydrateCard(card)
    await addCard(user, full, 1)
    setLastAdded(`${full.name} · #${full.localId}`)
    if (rapid) {
      setCandidates([])
      setRawText('')
      setProgress('Added. Ready for the next card.')
      setTimeout(() => setProgress(''), 1600)
    } else {
      onOpen(full)
    }
  }

  return (
    <>
      <PageTitle eyebrow="V1 CAMERA SCANNER" title="Rapid Scan" subtitle="Center one card in the frame. We read its text and match it to the catalog."/>
      <div className="rapid-toggle">
        <div><strong>Rapid mode</strong><span>Stay in camera after each add</span></div>
        <button className={rapid ? 'toggle on' : 'toggle'} onClick={() => setRapid(!rapid)}><i/></button>
      </div>
      <div className="scanner">
        <video ref={videoRef} playsInline muted className={active ? '' : 'hidden'} />
        {!active && <div className="camera-empty"><Camera size={44}/><p>Use your rear camera to identify a card.</p><button className="primary" onClick={startCamera}><Camera size={18}/> Open camera</button></div>}
        {active && <div className="scan-frame"><span/><span/><span/><span/></div>}
        {active && <button className="camera-close" onClick={stopCamera}><X/></button>}
        {active && <button className="shutter" onClick={scanFrame} disabled={working}><span>{working ? <LoaderCircle className="spin"/> : <Camera/>}</span></button>}
      </div>
      <canvas ref={canvasRef} className="hidden"/>
      {lastAdded && <div className="success-toast"><Check/> Added {lastAdded}</div>}
      {progress && <div className="scan-status">{working && <LoaderCircle className="spin" size={18}/>} {progress}</div>}
      {candidates.length > 0 && (
        <section className="scan-results">
          <div className="section-heading"><div><span className="eyebrow">LIKELY MATCHES</span><h2>Tap the correct card</h2></div><span>{candidates.length}</span></div>
          <div className="candidate-grid">
            {candidates.map(c => (
              <button key={c.id} onClick={() => choose(c)}>
                <img src={cardImage(c, 'low')} alt={c.name}/><strong>{c.name}</strong><span>#{c.localId}</span>
              </button>
            ))}
          </div>
          <details className="ocr-details"><summary>Show OCR text</summary><pre>{rawText}</pre></details>
        </section>
      )}
      <div className="scanner-tip"><Sparkles/><div><strong>Scanner tip</strong><span>Bright, even lighting and a flat card work best. Collector numbers near the bottom of the card are especially useful.</span></div></div>
    </>
  )
}

function MoreView({ items, user }) {
  const fileRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [importStatus, setImportStatus] = useState('')

  function exportCollection() {
    const rows = Object.values(items).map(x => ({
      'Card Name': x.name,
      'Set': x.setName,
      'Card Number': x.localId,
      'Quantity': x.quantity
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Collection')
    XLSX.writeFile(wb, `ProtoCollection-${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  async function findMatch(row) {
    const name = row['Card Name'] ?? row['Name'] ?? row['Product Name'] ?? row['Product'] ?? ''
    const setName = row['Set'] ?? row['Set Name'] ?? row['Expansion'] ?? ''
    const number = row['Card Number'] ?? row['Number'] ?? row['Collector Number'] ?? ''
    const quantity = Number(row['Quantity'] ?? row['Qty'] ?? 1) || 1

    if (setName) {
      const sets = await getSets()
      const set = sets.find(s => s.name.toLowerCase() === String(setName).trim().toLowerCase())
        || sets.find(s => s.name.toLowerCase().includes(String(setName).trim().toLowerCase()))
      if (set) {
        const data = await getSet(set.id)
        const card = data.cards?.find(c => String(c.localId).toLowerCase() === String(number).replace(/^#/, '').toLowerCase())
          || data.cards?.find(c => c.name.toLowerCase() === String(name).trim().toLowerCase())
        if (card) return { card: { ...card, setId: set.id, setName: set.name }, quantity }
      }
    }
    const found = await searchCards(number || name)
    const exactName = found.find(c => c.name.toLowerCase() === String(name).trim().toLowerCase())
    return found.length ? { card: exactName || found[0], quantity } : null
  }

  async function handleImport(file) {
    if (!file) return
    setImporting(true); setImportStatus('Reading spreadsheet…')
    try {
      const data = await file.arrayBuffer()
      const wb = XLSX.read(data)
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      let added = 0, missed = 0
      for (let i = 0; i < rows.length; i++) {
        setImportStatus(`Matching ${i + 1} of ${rows.length}…`)
        const match = await findMatch(rows[i])
        if (match) {
          const full = await hydrateCard(match.card)
          await addCard(user, full, match.quantity)
          added += match.quantity
        } else missed++
      }
      setImportStatus(`Import complete: ${added} cards added${missed ? ` · ${missed} rows need manual review` : ''}.`)
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
          <span className="settings-icon"><FileUp/></span><div><strong>Import collection</strong><span>CSV or XLSX, including common TCGplayer column names</span></div><ChevronRight/>
        </button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => handleImport(e.target.files?.[0])}/>
        <button className="settings-row" onClick={exportCollection}>
          <span className="settings-icon"><Download/></span><div><strong>Export collection</strong><span>Download your binder as an Excel spreadsheet</span></div><ChevronRight/>
        </button>
        {firebaseConfigured && user && <button className="settings-row" onClick={signOut}>
          <span className="settings-icon"><LogOut/></span><div><strong>Sign out</strong><span>{user.email}</span></div><ChevronRight/>
        </button>}
      </div>
      {importStatus && <div className="import-status">{importing && <LoaderCircle className="spin"/>}{importStatus}</div>}
      {!firebaseConfigured && <div className="setup-card"><strong>Local test mode</strong><p>Firebase has not been configured yet. Your binder is currently saved only in this browser. Follow README_FIRST.md to turn on cross-device sync.</p></div>}
      {firebaseConfigured && <div className="setup-card good"><strong>Cloud sync enabled</strong><p>Firestore is configured. Collection changes use Firebase offline persistence and synchronize when connectivity returns.</p></div>}
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
      <p>One Pokémon collection, synchronized across your phone and computer.</p>
      <button className="primary auth-btn" disabled={busy} onClick={async () => { setBusy(true); try { await signIn() } finally { setBusy(false) } }}>
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
        <button className="brand" onClick={() => setTab('collection')}><span className="brand-mark"><Grid3X3/></span><span>ProtoCollection</span></button>
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

export default App
