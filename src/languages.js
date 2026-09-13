export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN', aliases: ['ENG', 'EN', 'ENGLISH'], ocr: 'eng' },
  { code: 'ja', label: 'Japanese', short: 'JA', aliases: ['JPN', 'JAP', 'JA', 'JP', 'JAPANESE'], ocr: 'jpn+eng' },
  { code: 'zh-cn', label: 'Chinese (Simplified)', short: 'ZH-CN', aliases: ['CHN', 'ZHCN', 'ZH-CN', 'CHINESE', 'SIMPLIFIED CHINESE'], ocr: 'chi_sim+eng' },
  { code: 'zh-tw', label: 'Chinese (Traditional)', short: 'ZH-TW', aliases: ['CHT', 'ZHTW', 'ZH-TW', 'TRADITIONAL CHINESE'], ocr: 'chi_tra+eng' },
  { code: 'ko', label: 'Korean', short: 'KO', aliases: ['KOR', 'KO', 'KOREAN'], ocr: 'kor+eng' },
  { code: 'th', label: 'Thai', short: 'TH', aliases: ['THAI', 'TH', 'THA'], ocr: 'tha+eng' },
  { code: 'fr', label: 'French', short: 'FR', aliases: ['FRE', 'FRA', 'FR', 'FRENCH'], ocr: 'fra+eng' },
  { code: 'es', label: 'Spanish', short: 'ES', aliases: ['SPN', 'SPA', 'ESP', 'ES', 'SPANISH'], ocr: 'spa+eng' },
  { code: 'de', label: 'German', short: 'DE', aliases: ['GER', 'DEU', 'DE', 'GERMAN'], ocr: 'deu+eng' },
  { code: 'it', label: 'Italian', short: 'IT', aliases: ['ITA', 'IT', 'ITALIAN'], ocr: 'ita+eng' },
  { code: 'pt-br', label: 'Portuguese (Brazil)', short: 'PT-BR', aliases: ['PT-BR', 'PTBR', 'BRAZILIAN PORTUGUESE'], ocr: 'por+eng' },
  { code: 'pt-pt', label: 'Portuguese (Portugal)', short: 'PT-PT', aliases: ['PT-PT', 'PTPT', 'PORTUGUESE'], ocr: 'por+eng' },
  { code: 'id', label: 'Indonesian', short: 'ID', aliases: ['IND', 'ID', 'INDONESIAN'], ocr: 'ind+eng' },
  { code: 'nl', label: 'Dutch', short: 'NL', aliases: ['DUT', 'NLD', 'NL', 'DUTCH'], ocr: 'nld+eng' },
  { code: 'pl', label: 'Polish', short: 'PL', aliases: ['POL', 'PL', 'POLISH'], ocr: 'pol+eng' },
  { code: 'ru', label: 'Russian', short: 'RU', aliases: ['RUS', 'RU', 'RUSSIAN'], ocr: 'rus+eng' }
]

const byCode = new Map(LANGUAGES.map(l => [l.code, l]))

export function languageInfo(code = 'en') {
  return byCode.get(String(code).toLowerCase()) || byCode.get('en')
}

export function parseLanguage(value, fallback = 'en') {
  const raw = String(value || '').trim()
  if (!raw) return fallback
  const lower = raw.toLowerCase()
  if (byCode.has(lower)) return lower

  const upper = raw.toUpperCase()
  for (const language of LANGUAGES) {
    if (language.aliases.some(alias => alias.toUpperCase() === upper)) return language.code
  }
  return null
}

export function languageLabel(code) {
  return languageInfo(code).label
}

export function languageShort(code) {
  return languageInfo(code).short
}
