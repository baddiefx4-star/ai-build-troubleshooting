import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { load } from 'cheerio'

const MAX_HTML_BYTES = 1_500_000
const MAX_EXTRACTED_CHARS = 18_000
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

function isPrivateAddress(address: string) {
  const normalized = address.toLowerCase().split('%')[0]
  const family = isIP(normalized)

  if (family === 4) {
    const parts = normalized.split('.').map(Number)
    const [first, second, third] = parts
    return first === 0 || first === 10 || first === 127 || first >= 224 ||
      (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && (second === 0 || second === 168)) ||
      (first === 192 && second === 88 && third === 99) ||
      (first === 198 && (second === 18 || second === 19 || (second === 51 && third === 100))) ||
      (first === 203 && second === 0 && third === 113)
  }

  if (family === 6) {
    return normalized === '::' || normalized === '::1' || normalized.startsWith('::ffff:') ||
      normalized.startsWith('fc') || normalized.startsWith('fd') ||
      /^fe[89ab]/.test(normalized) || normalized.startsWith('ff')
  }

  return true
}

async function assertPublicUrl(url: URL) {
  if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error('Only public HTTP and HTTPS pages can be analyzed.')
  if (url.username || url.password) throw new Error('Remove credentials from the URL before analyzing the site.')
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('Only standard web ports can be analyzed.')
  if ([...url.searchParams.keys()].some((key) => /token|secret|password|session|authorization|api[_-]?key/i.test(key))) {
    throw new Error('Remove sensitive URL parameters before analyzing the site.')
  }

  const hostname = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname
  if (!hostname || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    throw new Error('Only publicly reachable websites can be analyzed.')
  }

  const addresses = isIP(hostname)
    ? [{ address: hostname }]
    : await lookup(hostname, { all: true, verbatim: true })
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error('Only publicly reachable websites can be analyzed.')
  }
}

async function readBoundedText(response: Response) {
  const reader = response.body?.getReader()
  if (!reader) return ''

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      const remaining = MAX_HTML_BYTES - totalBytes
      if (remaining <= 0) {
        await reader.cancel().catch(() => undefined)
        break
      }
      const chunk = value.byteLength > remaining ? value.subarray(0, remaining) : value
      chunks.push(chunk)
      totalBytes += chunk.byteLength
      if (chunk.byteLength < value.byteLength) {
        await reader.cancel().catch(() => undefined)
        break
      }
    }
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

export async function analyzePublicWebsite(input: string) {
  if (input.length > 2_048) throw new Error('The website URL is too long.')

  let currentUrl: URL
  try {
    currentUrl = new URL(input)
  } catch {
    throw new Error('Provide a complete public website URL, including https://.')
  }

  currentUrl.hash = ''
  let response: Response | undefined
  for (let redirectCount = 0; redirectCount <= 3; redirectCount += 1) {
    await assertPublicUrl(currentUrl)
    response = await fetch(currentUrl, {
      cache: 'no-store',
      redirect: 'manual',
      headers: {
        Accept: 'text/html,application/xhtml+xml,text/plain;q=0.8',
        'User-Agent': 'CTECH-AI-Site-Analyzer/1.0',
      },
      signal: AbortSignal.timeout(12_000),
    })

    if (!REDIRECT_STATUSES.has(response.status)) break
    const location = response.headers.get('location')
    await response.body?.cancel().catch(() => undefined)
    if (!location || redirectCount === 3) throw new Error('The site redirected too many times.')
    currentUrl = new URL(location, currentUrl)
  }

  if (!response?.ok) throw new Error(`The website returned an error (${response?.status ?? 'unknown'}).`)
  const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase()
  if (!['text/html', 'application/xhtml+xml', 'text/plain'].includes(contentType ?? '')) {
    await response.body?.cancel().catch(() => undefined)
    throw new Error('That URL did not return a readable web page.')
  }

  const source = currentUrl.toString()
  const html = await readBoundedText(response)
  if (contentType === 'text/plain') {
    return {
      source,
      title: currentUrl.hostname,
      description: '',
      headings: [],
      extractedText: html.replace(/\s+/g, ' ').trim().slice(0, MAX_EXTRACTED_CHARS),
      links: [],
    }
  }

  const $ = load(html)
  const title = $('title').first().text().replace(/\s+/g, ' ').trim().slice(0, 300)
  const description = $('meta[name="description"]').attr('content')?.replace(/\s+/g, ' ').trim().slice(0, 500) ?? ''
  const headings = $('h1, h2, h3')
    .map((_, element) => $(element).text().replace(/\s+/g, ' ').trim())
    .get()
    .filter(Boolean)
    .slice(0, 24)

  $('script, style, noscript, svg, iframe, canvas, form, nav, footer, [aria-hidden="true"]').remove()
  const extractedText = $('body').text().replace(/\s+/g, ' ').trim().slice(0, MAX_EXTRACTED_CHARS)
  const links = $('a[href]')
    .map((_, element) => {
      const label = $(element).text().replace(/\s+/g, ' ').trim()
      const href = $(element).attr('href')
      if (!href || !label) return null
      try {
        const target = new URL(href, currentUrl)
        return target.protocol === 'https:' || target.protocol === 'http:'
          ? { label: label.slice(0, 120), url: target.toString() }
          : null
      } catch {
        return null
      }
    })
    .get()
    .filter(Boolean)
    .slice(0, 12)

  return { source, title, description, headings, extractedText, links }
}
