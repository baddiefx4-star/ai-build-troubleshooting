import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Sandbox } from '@vercel/sandbox'
import { and, eq, gt, lt, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { ctechSandboxRuns } from '@/lib/db/schema'
import { isOwnerEmail } from '@/lib/owner'

const MAX_RUNS_PER_HOUR = 10
const MAX_OUTPUT_CHARS = 10_000
const RUN_TIMEOUT_SECONDS = 18
const MAX_SANDBOX_AGE_MS = 45_000

export type SandboxTerminalResult = {
  command: string
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
}

export class SandboxRateLimitError extends Error {
  constructor() {
    super('You have reached the limit of 10 sandbox runs per hour. Try again later.')
    this.name = 'SandboxRateLimitError'
  }
}

export class SandboxUnavailableError extends Error {
  constructor(message = 'The isolated command service is unavailable in this preview. Publish the app to Vercel to enable sandbox runs.') {
    super(message)
    this.name = 'SandboxUnavailableError'
  }
}

export function isSandboxAvailable() {
  // Vercel injects OIDC in some runtimes and a scoped Vercel token in others.
  // The Sandbox SDK can resolve the current project from the deployment context.
  return Boolean(process.env.VERCEL_OIDC_TOKEN || process.env.VERCEL_TOKEN)
}

async function reserveRun(userId: string) {
  const now = new Date()
  const windowStart = new Date(now.getTime() - 60 * 60 * 1000)
  const retentionStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  await db.transaction(async (transaction) => {
    await transaction.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${userId}, 0))`)
    await transaction
      .delete(ctechSandboxRuns)
      .where(and(eq(ctechSandboxRuns.userId, userId), lt(ctechSandboxRuns.createdAt, retentionStart)))

    const [usage] = await transaction
      .select({ count: sql<number>`count(*)::int` })
      .from(ctechSandboxRuns)
      .where(and(eq(ctechSandboxRuns.userId, userId), gt(ctechSandboxRuns.createdAt, windowStart)))

    if ((usage?.count ?? 0) >= MAX_RUNS_PER_HOUR) throw new SandboxRateLimitError()

    await transaction.insert(ctechSandboxRuns).values({ id: randomUUID(), userId, createdAt: now })
  })
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function truncate(value: string) {
  return value.length > MAX_OUTPUT_CHARS ? `${value.slice(0, MAX_OUTPUT_CHARS)}\n…output truncated` : value
}

export async function runSandboxTerminalCommand(userId: string, userEmail: string, command: string): Promise<SandboxTerminalResult> {
  if (!isSandboxAvailable()) throw new SandboxUnavailableError()

  let workspaceArchive: Buffer
  try {
    workspaceArchive = await readFile(join(process.cwd(), '.sandbox-workspace.tar.gz'))
  } catch {
    throw new SandboxUnavailableError('The project snapshot is not ready yet. Refresh the page and try again.')
  }

  if (!isOwnerEmail(userEmail)) await reserveRun(userId)

  const runId = randomUUID().replaceAll('-', '')
  const runDirectory = `/tmp/ctech-${runId}`
  const archivePath = `${runDirectory}/workspace.tar.gz`
  const commandPath = `${runDirectory}/command.sh`
  const stdoutPath = `${runDirectory}/stdout.txt`
  const stderrPath = `${runDirectory}/stderr.txt`
  const marker = `__CTECH_${runId}__`
  let sandbox: Awaited<ReturnType<typeof Sandbox.create>> | undefined

  try {
    sandbox = await Sandbox.create({
      image: 'vercel/sandbox/node:22',
      networkPolicy: 'deny-all',
      resources: { vcpus: 1 },
      timeout: MAX_SANDBOX_AGE_MS,
      persistent: false,
    })

    await sandbox.runCommand('mkdir', ['-p', runDirectory])
    await sandbox.writeFiles([
      { path: archivePath, content: workspaceArchive },
      { path: commandPath, content: Buffer.from(command, 'utf8') },
    ])

    const script = [
      'set +e',
      `tar -xzf ${shellQuote(archivePath)} -C ${shellQuote(runDirectory)}`,
      'extract_status=$?',
      'if [ "$extract_status" -ne 0 ]; then exit "$extract_status"; fi',
      `cd ${shellQuote(runDirectory)}`,
      `ulimit -t ${RUN_TIMEOUT_SECONDS}`,
      'ulimit -f 1024',
      `timeout --signal=TERM --kill-after=2s ${RUN_TIMEOUT_SECONDS}s bash ${shellQuote(commandPath)} > ${shellQuote(stdoutPath)} 2> ${shellQuote(stderrPath)}`,
      'command_status=$?',
      `printf '\\n${marker}EXIT:%s\\n' "$command_status"`,
      `printf '${marker}STDOUT\\n'`,
      `head -c ${MAX_OUTPUT_CHARS} ${shellQuote(stdoutPath)} 2>/dev/null || true`,
      `printf '\\n${marker}STDERR\\n'`,
      `head -c ${MAX_OUTPUT_CHARS} ${shellQuote(stderrPath)} 2>/dev/null || true`,
      'printf "\\n"',
      'exit "$command_status"',
    ].join('\n')

    const result = await sandbox.runCommand('bash', ['-lc', script])
    const rawStdout = await result.stdout()
    const rawStderr = await result.stderr()
    const exitMarkerIndex = rawStdout.lastIndexOf(`${marker}EXIT:`)
    const stdoutMarker = `${marker}STDOUT\n`
    const stderrMarker = `${marker}STDERR\n`
    const stdoutStart = rawStdout.lastIndexOf(stdoutMarker)
    const stderrStart = rawStdout.lastIndexOf(stderrMarker)

    if (exitMarkerIndex < 0 || stdoutStart < 0 || stderrStart < 0) {
      const exitCode = result.exitCode ?? 1
      return {
        command,
        exitCode,
        stdout: truncate(rawStdout),
        stderr: truncate(rawStderr),
        timedOut: exitCode === 124 || exitCode === 137,
      }
    }

    const exitLine = rawStdout.slice(exitMarkerIndex + `${marker}EXIT:`.length).split('\n', 1)[0]
    const exitCode = Number.parseInt(exitLine, 10)
    const stdout = rawStdout.slice(stdoutStart + stdoutMarker.length, stderrStart).replace(/\n$/, '')
    const stderr = rawStdout.slice(stderrStart + stderrMarker.length).replace(/\n$/, '')

    return {
      command,
      exitCode: Number.isFinite(exitCode) ? exitCode : (result.exitCode ?? 1),
      stdout: truncate(stdout),
      stderr: truncate([stderr, rawStderr].filter(Boolean).join('\n')),
      timedOut: exitCode === 124 || exitCode === 137,
    }
  } finally {
    if (sandbox) await sandbox.stop().catch(() => undefined)
  }
}
