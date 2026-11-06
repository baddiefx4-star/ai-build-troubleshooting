import { execFile } from 'node:child_process'
import { readdir, stat, unlink } from 'node:fs/promises'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'

const execFileAsync = promisify(execFile)
const root = process.cwd()
const archivePath = resolve(root, '.sandbox-workspace.tar.gz')
const sourceDirectories = ['app', 'components', 'lib', 'public']
const rootFiles = [
  'package.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'tsconfig.json',
  'components.json',
  'next.config.mjs',
  'postcss.config.mjs',
]
const excludedDirectories = new Set(['.git', '.next', '.vercel', '.turbo', 'node_modules', 'coverage', 'dist', 'build', 'out', '.cache', 'credentials', 'secrets', 'private'])
const excludedFiles = new Set(['.npmrc', '.yarnrc.yml'])
const maxFiles = 5000
const maxArchiveBytes = 50 * 1024 * 1024

function isSensitiveFile(name) {
  const lower = name.toLowerCase()
  return (
    lower === '.env' ||
    lower.startsWith('.env.') ||
    excludedFiles.has(lower) ||
    /secret|credential|token/i.test(lower) ||
    /\.(pem|key|p12|pfx|crt|cer|sqlite|db|log)$/i.test(lower)
  )
}

async function collectFiles(directory, relativeDirectory = '') {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = []

  for (const entry of entries) {
    if (entry.isSymbolicLink() || isSensitiveFile(entry.name)) continue
    if (entry.isDirectory() && excludedDirectories.has(entry.name)) continue

    const relativePath = join(relativeDirectory, entry.name)
    if (entry.isDirectory()) {
      files.push(...await collectFiles(join(directory, entry.name), relativePath))
    } else if (entry.isFile()) {
      files.push(relativePath)
    }
  }

  return files
}

const files = []
for (const directory of sourceDirectories) {
  try {
    const info = await stat(join(root, directory))
    if (info.isDirectory()) files.push(...await collectFiles(join(root, directory), directory))
  } catch {
    continue
  }
}

for (const file of rootFiles) {
  try {
    const info = await stat(join(root, file))
    if (info.isFile() && !isSensitiveFile(file)) files.push(file)
  } catch {
    continue
  }
}

if (!files.length || files.length > maxFiles) {
  throw new Error(`The sandbox source snapshot contains an invalid number of files (${files.length}).`)
}

await unlink(archivePath).catch(() => undefined)
await execFileAsync('tar', ['-czf', archivePath, '--', ...files], { cwd: root, maxBuffer: 1024 * 1024 })
const archiveInfo = await stat(archivePath)

if (archiveInfo.size > maxArchiveBytes) {
  await unlink(archivePath).catch(() => undefined)
  throw new Error('The sandbox source snapshot is larger than the 50 MB limit.')
}

console.log(`Created source-only sandbox snapshot (${(archiveInfo.size / 1024 / 1024).toFixed(1)} MB).`)
