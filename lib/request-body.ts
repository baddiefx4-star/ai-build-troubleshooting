export class RequestBodyTooLargeError extends Error {
  constructor() {
    super('Request body is too large.')
    this.name = 'RequestBodyTooLargeError'
  }
}

export async function readJsonRequest(request: Request, maxBytes: number): Promise<unknown> {
  const declaredLength = Number(request.headers.get('content-length') || 0)
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestBodyTooLargeError()
  }

  const reader = request.body?.getReader()
  if (!reader) throw new SyntaxError('Request body is empty.')

  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new RequestBodyTooLargeError()
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const body = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }

  try {
    return JSON.parse(new TextDecoder().decode(body)) as unknown
  } catch {
    throw new SyntaxError('Request body is not valid JSON.')
  }
}
