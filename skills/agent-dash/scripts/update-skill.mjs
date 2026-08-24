#!/usr/bin/env node

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const SOURCE = 'Prajeevan/agent-dash'
const NAME = 'agent-dash'
const dryRun = process.argv.includes('--dry-run')
const requestedScope = process.argv.includes('--scope')
  ? process.argv[process.argv.indexOf('--scope') + 1]
  : null
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'

function findInstall() {
  if (requestedScope === 'project' || requestedScope === 'global') {
    return {
      scope: requestedScope,
      root: requestedScope === 'global' ? join(homedir(), '.agents') : null,
    }
  }

  let current = resolve(dirname(fileURLToPath(import.meta.url)))
  const filesystemRoot = parse(current).root
  while (current !== filesystemRoot) {
    if (current.endsWith(join('.agents'))) {
      const lock = join(current, '.skill-lock.json')
      if (existsSync(lock)) {
        return {
          scope: current === join(homedir(), '.agents') ? 'global' : 'project',
          root: current,
        }
      }
    }
    current = dirname(current)
  }
  return null
}

const install = findInstall()
if (!install) {
  console.error(
    `This Agent Dash copy is not managed by the skills CLI. Install the managed skill with:\n  npx skills add ${SOURCE} --global --agent claude-code --skill ${NAME} --yes`,
  )
  process.exit(1)
}

const flag = install.scope === 'global' ? '--global' : '--project'
const args = ['--yes', 'skills', 'update', NAME, flag, '--yes']
console.log(`Updating Agent Dash (${install.scope})…`)

if (dryRun) {
  console.log(`Would run: npx ${args.slice(1).join(' ')}`)
  console.log(`Agent Dash skill update dry run passed for ${install.scope} scope.`)
  process.exit(0)
}

const result = spawnSync(npx, args, { cwd: process.cwd(), stdio: 'inherit' })
if (result.status !== 0) {
  console.error(`Agent Dash ${install.scope} update failed. No other skills were changed.`)
  process.exit(result.status ?? 1)
}

const lockPath = install.root ? join(install.root, '.skill-lock.json') : null
const skillPath = install.root ? join(install.root, 'skills', NAME, 'SKILL.md') : null
try {
  if (!lockPath || !skillPath || !existsSync(lockPath) || !existsSync(skillPath)) {
    throw new Error('managed skill files were not found after update')
  }
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  if (lock?.skills?.[NAME]?.source !== SOURCE) {
    throw new Error('the installed source is not Prajeevan/agent-dash')
  }
  if (!readFileSync(skillPath, 'utf8').includes('/agent-dash update')) {
    throw new Error('the downloaded skill does not include the self-update action')
  }
} catch (error) {
  console.error(`Update finished but verification failed: ${error.message}`)
  process.exit(1)
}

console.log(`Agent Dash skill updated and verified (${install.scope}).`)
console.log(
  'Invoke /agent-dash again in a new conversation if this session still has the previous instructions loaded.',
)
