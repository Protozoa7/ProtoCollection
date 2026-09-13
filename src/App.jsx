import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, ArrowLeft, BookOpen, Camera, Check, CheckCircle2, ChevronRight, Download, FileUp,
  Grid3X3, Layers3, LoaderCircle, Lock, LogIn, LogOut, Minus, Plus, RotateCcw, Search,
  Settings, ShieldCheck, SkipForward, Sparkles, Undo2, Unlock, X
} from 'lucide-react'
import * as XLSX from 'xlsx'
import { createWorker } from 'tesseract.js'
import { auth, firebaseConfigured, onAuthStateChanged, signIn, signOut } from './firebase'
import {
  addCard, catalogQuantity, commitImport, rollbackImport, setCardLocked, setQuantity,
  subscribeCollection, subscribeImports, updateEntry
} from './collectionStore'
import {
  assetImage, cardImage, findCardForImport, findCardSuggestionsForImport, getSet, getSets,
  hydrateCard, scannerOcrLanguage, scanCandidatesFromRegions, searchCards
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

function LanguageSelect({ value, onChange, includeAll = false, className = '', disabled = false }) {
  return (
    <select className={`language-select ${className}`} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>
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


const HOLO_VARIANTS = [
  'Unspecified',
  'Non-Holo',
  'Holo',
  'Normal Holo',
  'Reverse Holo',
  'Rev-Holo',
  'Reverse Type Holo',
  'Cosmos Holo',
  'Poké Ball',
  'Master Ball',
  'Full Art Holo',
  'Gold / Ultra Rare Holo',
  'CAMEO'
]

function InlineTextField({ value, onSave, disabled, placeholder = '—', className = '' }) {
  const [draft, setDraft] = useState(value || '')
  useEffect(() => setDraft(value || ''), [value])

  async function commit() {
    const next = String(draft || '').trim()
    if (next === String(value || '').trim()) return
    await onSave(next)
  }

  return (
    <input
      className={`binder-inline-input ${className}`}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={e => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === 'Enter') e.currentTarget.blur()
        if (e.key === 'Escape') { setDraft(value || ''); e.currentTarget.blur() }
      }}
    />
  )
}

function HoloVariantField({ value, onSave, disabled }) {
  const current = value && value !== 'Unspecified' ? value : ''
  const [draft, setDraft] = useState(current)
  useEffect(() => setDraft(current), [current])

  async function commit() {
    const next = String(draft || '').trim() || 'Unspecified'
    if (next === (value || 'Unspecified')) return
    await onSave(next)
  }

  return (
    <>
      <input
        className="binder-inline-input holo-edit"
        list="protocollection-holo-variants"
        value={draft}
        disabled={disabled}
        placeholder="Standard / Non-Holo / Holo…"
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { setDraft(current); e.currentTarget.blur() }
        }}
      />
      <datalist id="protocollection-holo-variants">
        {HOLO_VARIANTS.filter(v => v !== 'Unspecified').map(v => <option value={v} key={v}/>)}
      </datalist>
    </>
  )
}

function BinderVariantRow({ entry, user, locked, onCleared }) {
  const [busy, setBusy] = useState(false)
  const qty = Number(entry.quantity || 0)

  async function adjust(delta) {
    if (locked || busy) return
    setBusy(true)
    try {
      if (delta > 0) {
        await addCard(user, entry, 1, {
          language: entry.language || 'en',
          variant: entry.variant || 'Unspecified',
          condition: entry.condition || 'Unspecified',
          year: entry.year,
          rarity: entry.rarity,
          note: entry.note
        })
      } else {
        const next = Math.max(0, qty - 1)
        if (next === 0) onCleared?.({ ...entry, quantity: qty })
        await setQuantity(user, entry, next)
      }
    } finally {
      setBusy(false)
    }
  }

  async function patch(changes) {
    if (locked || busy) return
    setBusy(true)
    try { await updateEntry(user, entry, changes) }
    finally { setBusy(false) }
  }

  return (
    <div className={`binder-variant-row ${locked ? 'is-locked' : ''}`}>
      <label className="variant-field">
        <span>LANG</span>
        <LanguageSelect
          value={entry.language || 'en'}
          onChange={language => patch({ language })}
          className="binder-language-select"
          disabled={locked || busy}
        />
      </label>

      <label className="variant-field holo-field">
        <span>HOLO / VARIANT</span>
        <HoloVariantField
          value={entry.variant}
          disabled={locked || busy}
          onSave={variant => patch({ variant })}
        />
      </label>

      <label className="variant-field small-field">
        <span>YEAR</span>
        <InlineTextField value={entry.year} disabled={locked || busy} onSave={year => patch({ year })}/>
      </label>

      <label className="variant-field rarity-field">
        <span>RARITY</span>
        <InlineTextField value={entry.rarity} disabled={locked || busy} onSave={rarity => patch({ rarity })}/>
      </label>

      <label className="variant-field note-field">
        <span>NOTE</span>
        <InlineTextField value={entry.note} disabled={locked || busy} onSave={note => patch({ note })}/>
      </label>

      <div className="variant-field qty-field">
        <span>QTY</span>
        <div className="binder-qty">
          <button onClick={() => adjust(-1)} disabled={locked || busy} aria-label={`Remove one ${entry.name}`}>
            {busy ? <LoaderCircle className="spin" size={14}/> : <Minus size={15}/>}
          </button>
          <strong>{qty}</strong>
          <button onClick={() => adjust(1)} disabled={locked || busy} aria-label={`Add one ${entry.name}`}>
            {busy ? <LoaderCircle className="spin" size={14}/> : <Plus size={15}/>}
          </button>
        </div>
      </div>
    </div>
  )
}

function BinderCardGroup({ entries, user, onOpen, onCleared }) {
  const primary = entries[0]
  const [lockBusy, setLockBusy] = useState(false)
  const locked = entries.some(entry => Boolean(entry.locked))
  const copies = entries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0)

  async function toggleLock() {
    if (lockBusy) return
    if (locked && !window.confirm(`Unlock ${primary.name}? Quantity, language, holo/variant, year, rarity, and notes will become editable again.`)) return
    setLockBusy(true)
    try { await setCardLocked(user, entries, !locked) }
    finally { setLockBusy(false) }
  }

  return (
    <article className={`binder-card-group ${locked ? 'locked-card' : ''}`}>
      <div className="binder-card-visual">
        <button className="binder-large-thumb" onClick={() => onOpen?.(primary)} aria-label={`Open ${primary.name}`}>
          {cardImage(primary, 'high')
            ? <img src={cardImage(primary, 'high')} alt={primary.name} loading="lazy"/>
            : <span>No image</span>}
        </button>
        <div className="binder-card-title">
          <strong>{primary.name}</strong>
          <span>{primary.setName || 'Unknown set'}</span>
          <span className="binder-number">#{primary.localId || '—'} · {copies} {copies === 1 ? 'copy' : 'copies'}</span>
        </div>
        <button
          className={`card-lock-btn ${locked ? 'locked' : ''}`}
          onClick={toggleLock}
          disabled={lockBusy}
          title={locked ? 'Unlock this entire card' : 'Lock this entire card'}
        >
          {lockBusy ? <LoaderCircle className="spin"/> : locked ? <Lock/> : <Unlock/>}
          <span>{locked ? 'Locked' : 'Lock card'}</span>
        </button>
      </div>

      <div className="binder-variant-head">
        <span>LANG</span><span>HOLO / VARIANT</span><span>YEAR</span><span>RARITY</span><span>NOTE</span><span>QTY</span>
      </div>

      <div className="binder-variant-list">
        {entries
          .slice()
          .sort((a, b) =>
            String(a.language || 'en').localeCompare(String(b.language || 'en')) ||
            String(a.variant || '').localeCompare(String(b.variant || ''))
          )
          .map(entry => (
            <BinderVariantRow
              key={entry.identityKey}
              entry={entry}
              user={user}
              locked={locked}
              onCleared={onCleared}
            />
          ))}
      </div>

      {locked && <div className="locked-note"><Lock size={13}/> This card is protected from accidental edits.</div>}
    </article>
  )
}

function CardSheet({ card, items, user, onClose, onCleared }) {
  const isEntry = Boolean(card.identityKey)
  const lang = card.language || 'en'
  const [full, setFull] = useState(card)
  const currentEntry = isEntry ? items[card.identityKey] : null
  const qty = isEntry
    ? Number(currentEntry?.quantity || card.quantity || 0)
    : catalogQuantity(items, card, lang)
  const locked = isEntry && Boolean(currentEntry?.locked ?? card.locked)

  useEffect(() => {
    let alive = true
    hydrateCard(card, lang).then(v => alive && setFull(v))
    return () => { alive = false }
  }, [card.cardId, card.id, lang])

  async function addOne() {
    if (locked) return
    await addCard(user, full, 1, {
      language: lang,
      variant: isEntry ? card.variant : 'Unspecified',
      condition: isEntry ? card.condition : 'Unspecified'
    })
  }

  async function removeOne() {
    if (locked) return
    if (isEntry) {
      const snapshot = currentEntry || card
      if (qty === 1) onCleared?.({ ...snapshot, quantity: qty })
      await setQuantity(user, snapshot, Math.max(0, qty - 1))
      return
    }
    const matching = Object.values(items).find(x =>
      x.cardId === (card.cardId || card.id) &&
      (x.language || 'en') === lang
    )
    if (matching && !matching.locked) await setQuantity(user, matching, Math.max(0, Number(matching.quantity || 0) - 1))
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
            {locked && <span><Lock size={12}/> Locked</span>}
          </div>
          <span className="eyebrow">{full.set?.name || full.setName || card.setName || 'Pokémon TCG'}</span>
          <h2>{full.name}</h2>
          <p className="muted">Collector #{full.localId}</p>
          <div className="qty-control">
            <button onClick={removeOne} disabled={locked}><Minus/></button>
            <div><strong>{qty}</strong><span>owned</span></div>
            <button onClick={addOne} disabled={locked}><Plus/></button>
          </div>
          {locked && <p className="sheet-note">Unlock this card from the Binder before changing its quantity.</p>}
          {!isEntry && qty > 0 && (
            <p className="sheet-note">Quantity shown is the total for this card in {languageLabel(lang)} across variants/conditions.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function CollectionView({ items, user, onOpen, onCleared }) {
  const [query, setQuery] = useState('')
  const [lang, setLang] = useState('all')
  const [sort, setSort] = useState('name')

  const groups = useMemo(() => {
    const q = query.toLowerCase().trim()
    const grouped = new Map()

    for (const entry of Object.values(items)) {
      const languageOk = lang === 'all' || (entry.language || 'en') === lang
      const searchable = [
        entry.name, entry.setName, entry.localId, entry.variant, entry.rarity,
        entry.note, entry.year, languageShort(entry.language || 'en')
      ].join(' ').toLowerCase()
      if (!languageOk || (q && !searchable.includes(q))) continue

      const key = entry.cardId || entry.identityKey
      if (!grouped.has(key)) grouped.set(key, [])
      grouped.get(key).push(entry)
    }

    const out = [...grouped.values()]
    out.sort((a, b) => {
      const A = a[0], B = b[0]
      const qtyA = a.reduce((s, x) => s + Number(x.quantity || 0), 0)
      const qtyB = b.reduce((s, x) => s + Number(x.quantity || 0), 0)
      if (sort === 'qty') return qtyB - qtyA || String(A.name).localeCompare(String(B.name))
      if (sort === 'set') return String(A.setName || '').localeCompare(String(B.setName || '')) || String(A.name).localeCompare(String(B.name))
      if (sort === 'year') return String(A.year || '').localeCompare(String(B.year || '')) || String(A.name).localeCompare(String(B.name))
      if (sort === 'lang') return String(A.language || 'en').localeCompare(String(B.language || 'en')) || String(A.name).localeCompare(String(B.name))
      return String(A.name || '').localeCompare(String(B.name || '')) || String(A.setName || '').localeCompare(String(B.setName || ''))
    })
    return out
  }, [items, query, lang, sort])

  const allEntries = Object.values(items)
  const total = allEntries.reduce((s, x) => s + Number(x.quantity || 0), 0)
  const uniqueCards = new Set(allEntries.map(x => x.cardId || x.identityKey)).size

  return (
    <>
      <section className="hero compact-hero">
        <div>
          <span className="eyebrow">MY DIGITAL BINDER</span>
          <h1>ProtoCollection</h1>
          <p>{uniqueCards} cards · {allEntries.length} language/variant rows · {total} total copies</p>
        </div>
        <div className="hero-orb"><Sparkles/></div>
      </section>

      <div className="searchbar">
        <Search size={19}/>
        <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search card, set, number, language, holo…" />
      </div>

      <div className="filter-row">
        <LanguageSelect value={lang} onChange={setLang} includeAll/>
        <select value={sort} onChange={e => setSort(e.target.value)}>
          <option value="name">Sort: Card</option>
          <option value="set">Sort: Set</option>
          <option value="year">Sort: Year</option>
          <option value="qty">Sort: Quantity</option>
          <option value="lang">Sort: Language</option>
        </select>
      </div>

      <div className="toolbar">
        <span>{groups.length} cards shown</span>
        <span className="binder-hint">Language + holo are editable · lock protects the whole card</span>
      </div>

      {!groups.length ? (
        <Empty icon={BookOpen} title="No cards here yet" text="Browse a set, search, scan, or import your collection."/>
      ) : (
        <section className="binder-card-list" aria-label="Pokémon collection binder">
          {groups.map(entries => (
            <BinderCardGroup
              key={entries[0].cardId || entries[0].identityKey}
              entries={entries}
              user={user}
              onOpen={onOpen}
              onCleared={onCleared}
            />
          ))}
        </section>
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

function makeRegionCanvas(source, x, y, w, h, scale = 2) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(source.width * w * scale))
  canvas.height = Math.max(1, Math.round(source.height * h * scale))
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(
    source,
    source.width * x, source.height * y, source.width * w, source.height * h,
    0, 0, canvas.width, canvas.height
  )
  return canvas
}

function captureGuideCard(video, canvas) {
  const shell = video.parentElement
  const rect = shell.getBoundingClientRect()
  const cw = rect.width
  const ch = rect.height
  const guideW = Math.min(cw * 0.73, 340)
  const guideH = guideW * (3.5 / 2.5)
  const guideX = (cw - guideW) / 2
  const guideY = ch * 0.46 - guideH / 2

  const scale = Math.max(cw / video.videoWidth, ch / video.videoHeight)
  const displayW = video.videoWidth * scale
  const displayH = video.videoHeight * scale
  const offsetX = (cw - displayW) / 2
  const offsetY = (ch - displayH) / 2

  let sx = (guideX - offsetX) / scale
  let sy = (guideY - offsetY) / scale
  let sw = guideW / scale
  let sh = guideH / scale
  sx = Math.max(0, Math.min(video.videoWidth - 1, sx))
  sy = Math.max(0, Math.min(video.videoHeight - 1, sy))
  sw = Math.max(1, Math.min(video.videoWidth - sx, sw))
  sh = Math.max(1, Math.min(video.videoHeight - sy, sh))

  canvas.width = 700
  canvas.height = 980
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
  return canvas
}

function dHashFromCanvas(source) {
  const c = document.createElement('canvas')
  c.width = 9; c.height = 14
  const ctx = c.getContext('2d', { willReadFrequently: true })
  ctx.drawImage(source, 0, 0, 9, 14)
  const data = ctx.getImageData(0, 0, 9, 14).data
  const gray = []
  for (let i = 0; i < data.length; i += 4) gray.push(data[i] * .299 + data[i + 1] * .587 + data[i + 2] * .114)
  const bits = []
  for (let y = 0; y < 14; y++) for (let x = 0; x < 8; x++) bits.push(gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1 : 0)
  return bits
}

async function dHashFromUrl(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      try {
        const c = document.createElement('canvas')
        c.width = 245; c.height = 337
        c.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, c.width, c.height)
        resolve(dHashFromCanvas(c))
      } catch (e) { reject(e) }
    }
    img.onerror = reject
    img.src = url
  })
}

function hashSimilarity(a, b) {
  if (!a?.length || !b?.length || a.length !== b.length) return null
  let same = 0
  for (let i = 0; i < a.length; i++) if (a[i] === b[i]) same++
  return same / a.length
}

async function rankScanByArtwork(candidates, capturedCanvas) {
  const sourceHash = dHashFromCanvas(capturedCanvas)
  const ranked = await Promise.all(candidates.slice(0, 14).map(async card => {
    try {
      const url = cardImage(card, 'low')
      if (!url) return card
      const similarity = hashSimilarity(sourceHash, await dHashFromUrl(url))
      if (similarity == null) return card
      return {
        ...card,
        _visualScore: similarity,
        _combinedScore: Number(card._scanScore || 0) + similarity * 22
      }
    } catch {
      return card
    }
  }))
  return ranked.sort((a, b) =>
    Number(b._combinedScore ?? b._scanScore ?? 0) - Number(a._combinedScore ?? a._scanScore ?? 0)
  )
}

function ScannerView({ items, user, onOpen }) {
  const videoRef = useRef(null)
  const canvasRef = useRef(null)
  const streamRef = useRef(null)
  const [lang, setLang] = useState('en')
  const [sets, setSets] = useState([])
  const [setLock, setSetLock] = useState('')
  const [active, setActive] = useState(false)
  const [working, setWorking] = useState(false)
  const [progress, setProgress] = useState('')
  const [candidates, setCandidates] = useState([])
  const [ocr, setOcr] = useState({ name: '', number: '' })
  const [rapid, setRapid] = useState(true)
  const [lastAdded, setLastAdded] = useState('')

  useEffect(() => () => stopCamera(), [])
  useEffect(() => {
    let live = true
    setSetLock('')
    getSets(lang).then(v => live && setSets(v || [])).catch(() => live && setSets([]))
    return () => { live = false }
  }, [lang])

  async function startCamera() {
    setCandidates([]); setOcr({ name: '', number: '' }); setLastAdded('')
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
    setWorking(true); setCandidates([]); setProgress('Capturing card frame…')
    try {
      const cardCanvas = captureGuideCard(video, canvas)
      const nameCrop = makeRegionCanvas(cardCanvas, .04, .02, .92, .23, 2.2)
      const numberCrop = makeRegionCanvas(cardCanvas, .02, .72, .96, .27, 2.6)

      setProgress(`Reading ${languageLabel(lang)} card name…`)
      const worker = await createWorker(scannerOcrLanguage(lang), 1, {
        logger: m => {
          if (m.status === 'recognizing text') setProgress(`Reading card… ${Math.round((m.progress || 0) * 100)}%`)
        }
      })

      await worker.setParameters({ tessedit_pageseg_mode: '6', preserve_interword_spaces: '1' })
      const nameResult = await worker.recognize(nameCrop)

      setProgress('Reading collector number…')
      await worker.setParameters({
        tessedit_pageseg_mode: '6',
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789/.-',
        preserve_interword_spaces: '1'
      })
      const numberResult = await worker.recognize(numberCrop)
      await worker.terminate()

      const nameText = nameResult.data.text || ''
      const numberText = numberResult.data.text || ''
      setOcr({ name: nameText, number: numberText })

      setProgress(setLock ? 'Matching inside the locked set…' : `Matching ${languageLabel(lang)} catalog…`)
      let found = await scanCandidatesFromRegions({ nameText, numberText, lang, setId: setLock })

      if (found.length > 1) {
        setProgress('Comparing card artwork…')
        found = await rankScanByArtwork(found, cardCanvas)
      }

      setCandidates(found)
      setProgress(found.length ? '' : 'No reliable match. Try Set Lock, reduce glare, and keep the bottom collector number sharp.')
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
      setCandidates([]); setOcr({ name: '', number: '' })
      setProgress('Added. Ready for the next card.')
      setTimeout(() => setProgress(''), 1500)
    } else onOpen(full)
  }

  return (
    <>
      <PageTitle eyebrow="V1.2 SCANNER REBUILD" title="Rapid Scan" subtitle="Targeted name + collector-number OCR, optional Set Lock, then artwork ranking."/>
      <div className="scanner-controls">
        <label><span>Card language</span><LanguageSelect value={lang} onChange={setLang}/></label>
        <label><span>Set Lock <b>recommended</b></span>
          <select value={setLock} onChange={e => setSetLock(e.target.value)}>
            <option value="">Any set</option>
            {sets.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      </div>
      <div className="rapid-toggle">
        <div><strong>Rapid mode</strong><span>Stay in camera after each add</span></div>
        <button className={rapid ? 'toggle on' : 'toggle'} onClick={() => setRapid(!rapid)}><i/></button>
      </div>
      <div className="scanner">
        <video ref={videoRef} playsInline muted className={active ? '' : 'hidden'} />
        {!active && <div className="camera-empty"><Camera size={44}/><p>Center one card tightly inside the frame.</p><button className="primary" onClick={startCamera}><Camera size={18}/> Open camera</button></div>}
        {active && <div className="scan-frame"><span/><span/><span/><span/></div>}
        {active && <div className="scan-zone-label name-zone">NAME</div>}
        {active && <div className="scan-zone-label number-zone">COLLECTOR #</div>}
        {active && <button className="camera-close" onClick={stopCamera}><X/></button>}
        {active && <button className="shutter" onClick={scanFrame} disabled={working}><span>{working ? <LoaderCircle className="spin"/> : <Camera/>}</span></button>}
      </div>
      <canvas ref={canvasRef} className="hidden"/>
      {lastAdded && <div className="success-toast"><Check/> Added {lastAdded}</div>}
      {progress && <div className="scan-status">{working && <LoaderCircle className="spin" size={18}/>} {progress}</div>}
      {candidates.length > 0 && (
        <section className="scan-results">
          <div className="section-heading"><div><span className="eyebrow">RANKED MATCHES</span><h2>Tap the correct card</h2></div><span>{candidates.length}</span></div>
          <div className="candidate-grid">
            {candidates.map((c, i) => (
              <button key={`${lang}-${c.id}`} onClick={() => choose(c)} className={i === 0 ? 'top-candidate' : ''}>
                {cardImage(c, 'low') && <img src={cardImage(c, 'low')} alt={c.name}/>}<strong>{c.name}</strong>
                <span>#{c.localId}{c.setName ? ` · ${c.setName}` : ''}</span>
                {i === 0 && <em>Best match</em>}
              </button>
            ))}
          </div>
          <details className="ocr-details"><summary>Scanner diagnostics</summary><pre>NAME REGION:\n{ocr.name}\n\nNUMBER REGION:\n{ocr.number}</pre></details>
        </section>
      )}
      <div className="scanner-tip"><Sparkles/><div><strong>Use Set Lock whenever you can</strong><span>It turns a whole-catalog search into a small candidate pool. The scanner now reads only the name and bottom collector-number regions instead of OCRing the whole card.</span></div></div>
    </>
  )
}

function parseImportSourceRow(row) {
  const name = row['Card Name'] ?? row['CARD'] ?? row['Name'] ?? row['Product Name'] ?? row['Product'] ?? ''
  const setName = row['Set'] ?? row['SET'] ?? row['Set Name'] ?? row['Expansion'] ?? ''
  const number = row['Card Number'] ?? row['Number'] ?? row['Collector Number'] ?? row['#'] ?? ''
  const quantity = Math.max(1, Number(row['Quantity'] ?? row['Qty'] ?? row['QTY'] ?? 1) || 1)
  const rawLanguage = row['Language'] ?? row['LANG'] ?? row['Lang'] ?? 'ENG'
  const lang = parseLanguage(rawLanguage, 'en')
  const variant = row['Variant'] ?? row['HOLO'] ?? row['Finish'] ?? ''
  const condition = row['Condition'] ?? row['Card Condition'] ?? ''
  const year = row['Year'] ?? row['YEAR'] ?? ''
  const rarity = row['Rarity'] ?? row['RARITY'] ?? ''
  const note = row['Note'] ?? row['NOTE'] ?? row['Notes'] ?? ''
  return { name, setName, number, quantity, rawLanguage, lang, variant, condition, year, rarity, note, source: row }
}

function ImportReview({ draft, setDraft, user, onCommitted, onCancel }) {
  const [suggestions, setSuggestions] = useState([])
  const [loadingSuggestions, setLoadingSuggestions] = useState(false)
  const [manualQuery, setManualQuery] = useState('')
  const [manualResults, setManualResults] = useState([])
  const [committing, setCommitting] = useState(false)
  const [message, setMessage] = useState('')

  const unresolved = draft.rows.filter(r => r.status === 'review')
  const skipped = draft.rows.filter(r => r.status === 'skipped')
  const matched = draft.rows.filter(r => r.status === 'matched')
  const current = unresolved[0]
  const copies = matched.reduce((sum, r) => sum + Number(r.quantity || 0), 0)

  useEffect(() => {
    let live = true
    setSuggestions([]); setManualResults([]); setManualQuery('')
    if (!current) return
    setLoadingSuggestions(true)
    findCardSuggestionsForImport({
      name: current.name, setName: current.setName, number: current.number, lang: current.lang || 'en'
    }).then(v => live && setSuggestions(v)).finally(() => live && setLoadingSuggestions(false))
    return () => { live = false }
  }, [current?.rowId, current?.lang])

  function updateRow(rowId, patch) {
    setDraft(d => ({ ...d, rows: d.rows.map(r => r.rowId === rowId ? { ...r, ...patch } : r) }))
  }

  function choose(card) {
    updateRow(current.rowId, { card, status: 'matched' })
  }

  async function manualSearch() {
    if (!current || manualQuery.trim().length < 2) return
    setLoadingSuggestions(true)
    try {
      const found = await searchCards(manualQuery, current.lang || 'en')
      const hydrated = await Promise.all(found.slice(0, 16).map(c => hydrateCard(c, current.lang || 'en')))
      setManualResults(hydrated)
    } finally { setLoadingSuggestions(false) }
  }

  async function confirmImport() {
    if (unresolved.length) return
    if (!matched.length) { setMessage('No resolved rows remain to import.'); return }
    if (!window.confirm(`Add ${copies} card copies from ${matched.length} resolved rows to your binder?`)) return
    setCommitting(true); setMessage('Committing import…')
    try {
      const record = await commitImport(user, matched, { fileName: draft.fileName })
      onCommitted(record)
    } catch (e) {
      setMessage(`Import failed: ${e.message}`)
      setCommitting(false)
    }
  }

  return (
    <>
      <button className="back-link" onClick={onCancel}><ArrowLeft size={18}/> Cancel import</button>
      <PageTitle eyebrow="IMPORT STAGING" title="Review before committing" subtitle="Nothing from this file has been added to your binder yet."/>
      <div className="import-summary-grid">
        <div><strong>{draft.rows.length}</strong><span>source rows</span></div>
        <div className="good"><strong>{matched.length}</strong><span>resolved</span></div>
        <div className={unresolved.length ? 'warn' : 'good'}><strong>{unresolved.length}</strong><span>need review</span></div>
        <div><strong>{skipped.length}</strong><span>skipped</span></div>
      </div>

      {current ? (
        <section className="review-card">
          <div className="review-heading">
            <div><span className="eyebrow">REVIEW QUEUE</span><h2>{unresolved.length} remaining</h2></div>
            <AlertTriangle/>
          </div>
          <div className="source-card-info">
            <strong>{current.name || 'Unknown card name'}</strong>
            <span>{current.setName || 'Unknown set'} · #{current.number || '?'} · {languageLabel(current.lang || 'en')} · Qty {current.quantity}</span>
          </div>
          <div className="review-language">
            <span>Wrong language?</span>
            <LanguageSelect value={current.lang || 'en'} onChange={lang => updateRow(current.rowId, { lang })}/>
          </div>

          <div className="review-section-title"><strong>Suggested matches</strong><span>Tap one to resolve this row</span></div>
          {loadingSuggestions && !suggestions.length ? <Loading text="Finding likely matches…"/> : (
            suggestions.length ? <div className="review-candidates">{suggestions.map(c => (
              <button key={`${current.lang}-${c.id}`} onClick={() => choose(c)}>
                {cardImage(c, 'low') && <img src={cardImage(c, 'low')} alt={c.name}/>}<strong>{c.name}</strong>
                <span>#{c.localId}{c.setName ? ` · ${c.setName}` : ''}</span>
              </button>
            ))}</div> : <p className="muted review-no-suggest">No strong automatic suggestions. Use manual search below.</p>
          )}

          <div className="manual-review-search">
            <div className="searchbar"><Search size={18}/><input value={manualQuery} onChange={e => setManualQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && manualSearch()} placeholder="Search this language catalog…"/></div>
            <button className="secondary" onClick={manualSearch}>Search</button>
          </div>
          {manualResults.length > 0 && <div className="review-candidates manual">{manualResults.map(c => (
            <button key={`manual-${current.lang}-${c.id}`} onClick={() => choose(c)}>
              {cardImage(c, 'low') && <img src={cardImage(c, 'low')} alt={c.name}/>}<strong>{c.name}</strong>
              <span>#{c.localId}{c.setName ? ` · ${c.setName}` : ''}</span>
            </button>
          ))}</div>}

          <button className="skip-review" onClick={() => updateRow(current.rowId, { status: 'skipped' })}><SkipForward size={18}/> Skip this row</button>
        </section>
      ) : (
        <div className="review-complete"><CheckCircle2/><div><strong>Review complete</strong><span>{matched.length} resolved rows · {copies} card copies ready · {skipped.length} skipped</span></div></div>
      )}

      <div className="import-commit-bar">
        <div><strong>{copies} copies ready</strong><span>{unresolved.length ? `Resolve or skip ${unresolved.length} row${unresolved.length === 1 ? '' : 's'} first` : 'Explicit confirmation is required before anything is written'}</span></div>
        <button className="primary" disabled={Boolean(unresolved.length) || committing || !matched.length} onClick={confirmImport}>
          {committing ? <LoaderCircle className="spin"/> : <ShieldCheck/>} Confirm import
        </button>
      </div>
      {message && <div className="import-status">{message}</div>}
    </>
  )
}

function MoreView({ items, user }) {
  const fileRef = useRef(null)
  const [importing, setImporting] = useState(false)
  const [importStatus, setImportStatus] = useState('')
  const [draft, setDraft] = useState(null)
  const [imports, setImports] = useState([])
  const [rollingBack, setRollingBack] = useState('')

  useEffect(() => subscribeImports(user, setImports), [user])

  function exportCollection() {
    const rows = Object.values(items).map(x => ({
      'CARD': x.name,
      '#': x.localId,
      'LANG': languageShort(x.language || 'en'),
      'YEAR': x.year || '',
      'HOLO': x.variant === 'Unspecified' ? '' : x.variant,
      'SET': x.setName,
      'RARITY': x.rarity || '',
      'NOTE': x.note || '',
      'QTY': x.quantity
    }))
    const ws = XLSX.utils.json_to_sheet(rows)
    const wb = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(wb, ws, 'Collection')
    XLSX.writeFile(wb, `ProtoCollection-${new Date().toISOString().slice(0,10)}.xlsx`)
  }

  async function stageImport(file) {
    if (!file) return
    setImporting(true); setImportStatus('Reading spreadsheet…')
    try {
      const data = await file.arrayBuffer()
      const wb = XLSX.read(data)
      const sourceRows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' })
      const staged = []

      for (let i = 0; i < sourceRows.length; i++) {
        setImportStatus(`Staging row ${i + 1} of ${sourceRows.length}…`)
        const parsed = parseImportSourceRow(sourceRows[i])
        const rowId = `row_${i}_${Math.random().toString(36).slice(2, 7)}`
        if (!parsed.lang) {
          staged.push({ ...parsed, rowId, lang: 'en', status: 'review', reviewReason: `Unknown language: ${parsed.rawLanguage}` })
          continue
        }
        const found = await findCardForImport({ name: parsed.name, setName: parsed.setName, number: parsed.number, lang: parsed.lang })
        const card = found ? await hydrateCard(found, parsed.lang) : null
        staged.push({ ...parsed, rowId, status: card ? 'matched' : 'review', card })
      }

      setDraft({ fileName: file.name, rows: staged, createdAtMs: Date.now() })
      const review = staged.filter(r => r.status === 'review').length
      setImportStatus(`Staged ${staged.length} rows. ${review} need manual review. Nothing has been added yet.`)
    } catch (e) {
      setImportStatus(`Import staging failed: ${e.message}`)
    } finally {
      setImporting(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function undoImport(record) {
    if (record.rolledBack) return
    if (!window.confirm(`Reverse the entire import “${record.fileName}”? This will subtract exactly ${record.copiesAdded} copies that import added.`)) return
    setRollingBack(record.importId); setImportStatus('Reversing import…')
    try {
      await rollbackImport(user, record)
      setImportStatus(`Import reversed: ${record.fileName}`)
    } catch (e) {
      setImportStatus(`Rollback failed: ${e.message}`)
    } finally { setRollingBack('') }
  }

  if (draft) return <ImportReview draft={draft} setDraft={setDraft} user={user}
    onCancel={() => { setDraft(null); setImportStatus('Import canceled. Binder unchanged.') }}
    onCommitted={record => { setDraft(null); setImportStatus(`Import committed: ${record.copiesAdded} copies added. You can reverse it from Import History.`) }}/>

  return (
    <>
      <PageTitle eyebrow="TOOLS & ACCOUNT" title="More" subtitle="Imports are now staged, reviewed, confirmed, and reversible."/>
      <div className="settings-list">
        <button className="settings-row" onClick={() => fileRef.current?.click()} disabled={importing}>
          <span className="settings-icon"><FileUp/></span><div><strong>Import collection</strong><span>Stage → review → confirm → reversible</span></div><ChevronRight/>
        </button>
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={e => stageImport(e.target.files?.[0])}/>
        <button className="settings-row" onClick={exportCollection}>
          <span className="settings-icon"><Download/></span><div><strong>Export collection</strong><span>Download the current binder as Excel</span></div><ChevronRight/>
        </button>
        {firebaseConfigured && user && <button className="settings-row" onClick={signOut}>
          <span className="settings-icon"><LogOut/></span><div><strong>Sign out</strong><span>{user.email}</span></div><ChevronRight/>
        </button>}
      </div>

      {importStatus && <div className="import-status">{importing && <LoaderCircle className="spin"/>}{importStatus}</div>}

      <section className="import-history">
        <div className="section-heading"><div><span className="eyebrow">V1.2+</span><h2>Import History</h2></div><span>{imports.length}</span></div>
        {!imports.length ? <p className="muted">Imports confirmed in V1.2 will appear here and can be reversed as a whole.</p> : imports.slice(0, 12).map(record => (
          <div className={`history-row ${record.rolledBack ? 'rolled-back' : ''}`} key={record.importId}>
            <div><strong>{record.fileName || 'Collection import'}</strong><span>{record.copiesAdded || 0} copies · {record.uniqueEntries || record.changes?.length || 0} binder entries</span></div>
            {record.rolledBack ? <span className="rollback-badge"><Check/> Reversed</span> : <button className="undo-btn" onClick={() => undoImport(record)} disabled={rollingBack === record.importId}>
              {rollingBack === record.importId ? <LoaderCircle className="spin"/> : <RotateCcw/>} Reverse
            </button>}
          </div>
        ))}
      </section>

      <div className="supported-languages"><strong>Multilingual catalog</strong><div>{ACTIVE_LANGUAGES.map(l => <span key={l.code}>{l.short}</span>)}</div><p>Uncertain matches stay in the review queue instead of being forced into the binder.</p></div>
      {!firebaseConfigured && <div className="setup-card"><strong>Local test mode</strong><p>Firebase has not been configured yet. Your binder is currently saved only in this browser.</p></div>}
      {firebaseConfigured && <div className="setup-card good"><strong>Cloud sync enabled</strong><p>Confirmed V1.2 imports are recorded with exact quantity deltas so the whole import can be reversed later.</p></div>}
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
  const [undoEntry, setUndoEntry] = useState(null)
  const [undoBusy, setUndoBusy] = useState(false)
  const [items] = useCollection(user || null)

  useEffect(() => {
    if (!firebaseConfigured) return
    return onAuthStateChanged(auth, setUser)
  }, [])

  async function undoClear() {
    if (!undoEntry || undoBusy) return
    setUndoBusy(true)
    try {
      await setQuantity(user, undoEntry, Number(undoEntry.quantity || 1))
      setUndoEntry(null)
    } finally {
      setUndoBusy(false)
    }
  }

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
        {tab === 'collection' && <CollectionView items={items} user={user} onOpen={setOpenCard} onCleared={setUndoEntry}/>}
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

      {undoEntry && (
        <div className="undo-toast" role="status">
          <div>
            <strong>{undoEntry.name} removed</strong>
            <span>{languageShort(undoEntry.language || 'en')} · {undoEntry.variant || 'Standard'} was cleared from the binder.</span>
          </div>
          <button onClick={undoClear} disabled={undoBusy}>
            {undoBusy ? <LoaderCircle className="spin"/> : <Undo2/>} Undo
          </button>
          <button className="undo-dismiss" onClick={() => setUndoEntry(null)} aria-label="Dismiss undo"><X/></button>
        </div>
      )}

      {openCard && <CardSheet card={openCard} items={items} user={user} onClose={() => setOpenCard(null)} onCleared={setUndoEntry}/>}
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
