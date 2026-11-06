export function isSameOriginRequest(request: Request) {
  const requestUrl = new URL(request.url)
  const allowedOrigins = new Set([requestUrl.origin])
  const hosts = [request.headers.get('x-forwarded-host'), request.headers.get('host')]
    .flatMap((header) => (header ?? '').split(','))
    .map((host) => host.trim())
    .filter(Boolean)
  const protocols = [request.headers.get('x-forwarded-proto'), requestUrl.protocol]
    .flatMap((header) => (header ?? '').split(','))
    .map((protocol) => protocol.trim().replace(/:$/, ''))
    .filter((protocol) => protocol === 'http' || protocol === 'https')

  for (const host of hosts) {
    for (const protocol of protocols) {
      allowedOrigins.add(`${protocol}://${host}`)
    }
  }

  const origin = request.headers.get('origin')
  if (origin && origin !== 'null') {
    try {
      if (allowedOrigins.has(new URL(origin).origin)) return true
    } catch {
      return false
    }
  }

  const referer = request.headers.get('referer')
  if (referer) {
    try {
      if (allowedOrigins.has(new URL(referer).origin)) return true
    } catch {
      return false
    }
  }

  return request.headers.get('sec-fetch-site') === 'same-origin'
}
