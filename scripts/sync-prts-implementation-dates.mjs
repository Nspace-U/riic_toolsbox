import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRTS_API_URL = 'https://prts.wiki/api.php'
const CHARACTER_TABLE_PATH = 'public/assets/gamedata/latest/excel/character_table.json'
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const characterTablePath = resolve(projectRoot, CHARACTER_TABLE_PATH)

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds))
}

async function fetchWikitext(title) {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'revisions',
    rvprop: 'content',
    rvslots: 'main',
    titles: title,
  })

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(`${PRTS_API_URL}?${params}`, {
      headers: { 'user-agent': 'riic-tools implementation date sync' },
    })
    if (response.ok) {
      const data = await response.json()
      const page = data.query?.pages?.[0]
      const content = page?.revisions?.[0]?.slots?.main?.content
      if (typeof content === 'string') {
        return content
      }
      return ''
    }
    if (attempt < 3) {
      await sleep(attempt * 500)
    }
  }

  throw new Error(`HTTP 请求失败（${title}）`)
}

async function fetchOperatorWikitext(name) {
  for (const title of [`干员/${name}`, name]) {
    const content = await fetchWikitext(title)
    if (content) {
      return content
    }
  }
  return ''
}

function templateValue(content, fieldName) {
  const pattern = new RegExp(`^\\s*\\|\\s*${fieldName}\\s*=\\s*([^\\r\\n|]+)`, 'm')
  return content.match(pattern)?.[1]?.trim() ?? ''
}

function parseImplementationDate(content) {
  const value = templateValue(content, '上线时间')
  return value || undefined
}

function parseOperatorId(content) {
  return templateValue(content, '干员id')
}

async function runPool(items, concurrency, worker) {
  let cursor = 0
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor
      cursor += 1
      await worker(items[index], index)
    }
  }

  await Promise.all(Array.from({ length: concurrency }, runWorker))
}

async function main() {
  const characterTable = JSON.parse(await readFile(characterTablePath, 'utf8'))
  const operatorEntries = Object.entries(characterTable).filter(([, character]) => character?.name)
  const nextCharacterTable = Object.fromEntries(
    operatorEntries.map(([operatorId, character]) => [operatorId, { ...character }]),
  )
  const failures = []
  let completed = 0

  await runPool(operatorEntries, 4, async ([operatorId, character]) => {
    try {
      const content = await fetchOperatorWikitext(character.name)
      const pageOperatorId = parseOperatorId(content)
      const implementationDate = parseImplementationDate(content)
      if (!content || pageOperatorId !== operatorId || !implementationDate) {
        failures.push(`${character.name}（${operatorId}）`)
      } else {
        nextCharacterTable[operatorId].implementationDate = implementationDate
      }
    } catch {
      failures.push(`${character.name}（${operatorId}）`)
    } finally {
      completed += 1
      if (completed % 20 === 0 || completed === operatorEntries.length) {
        console.log(`PRTS 实装时间同步进度：${completed}/${operatorEntries.length}`)
      }
    }
  })

  await writeFile(characterTablePath, `${JSON.stringify(nextCharacterTable, null, 2)}\n`, 'utf8')
  console.log(`PRTS 实装时间同步完成：成功 ${operatorEntries.length - failures.length}，失败 ${failures.length}`)
  if (failures.length > 0) {
    console.log(`未更新干员：${failures.join('、')}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})