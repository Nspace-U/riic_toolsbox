import { readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PRTS_BASE_URL = 'https://prts.wiki'
const PRTS_API_URL = `${PRTS_BASE_URL}/api.php`
const PRTS_OPERATOR_LIST_URL = `${PRTS_BASE_URL}/w/%E5%B9%B2%E5%91%98%E4%B8%80%E8%A7%88`
const CHARACTER_TABLE_PATH = 'public/assets/gamedata/latest/excel/character_table.json'
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const characterTablePath = resolve(projectRoot, CHARACTER_TABLE_PATH)

const PRTS_HEADERS = {
  accept: 'text/html,application/xhtml+xml,application/json',
  'accept-language': 'zh-CN,zh;q=0.9',
  'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/148 Safari/537.36',
}

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
    const response = await fetch(`${PRTS_API_URL}?${params}`, { headers: PRTS_HEADERS })
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

async function fetchOperatorListPage() {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(PRTS_OPERATOR_LIST_URL, { headers: PRTS_HEADERS })
    if (response.ok) {
      return response.text()
    }
    if (attempt < 3) {
      await sleep(attempt * 500)
    }
  }

  throw new Error('PRTS 干员一览读取失败，请检查 PRTS 访问状态')
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
}

function htmlAttribute(tag, name) {
  const match = tag.match(new RegExp(`\\bdata-${name}="([^"]*)"`))
  return match ? decodeHtmlEntities(match[1]) : ''
}

function parsePrtsOperatorOrder(html) {
  const operatorDataTags = [...html.matchAll(
    /<div\b(?=[^>]*\bdata-zh=")(?=[^>]*\bdata-id=")(?=[^>]*\bdata-sortid=")[^>]*>/g,
  )]
  const orderByName = new Map()

  operatorDataTags.forEach((match) => {
    const tag = match[0]
    const name = htmlAttribute(tag, 'zh')
    const order = Number(htmlAttribute(tag, 'sortid'))
    if (!name || !Number.isInteger(order)) {
      return
    }

    if (orderByName.has(name)) {
      throw new Error(`PRTS 干员一览存在重复名称：${name}`)
    }
    orderByName.set(name, order)
  })

  if (orderByName.size < 400) {
    throw new Error(`PRTS 干员一览解析结果异常（仅得到 ${orderByName.size} 条）`)
  }
  return orderByName
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

function parseBranch(content) {
  const value = templateValue(content, '分支')
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
  const implementationOrderByName = parsePrtsOperatorOrder(await fetchOperatorListPage())
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
      const branch = parseBranch(content)
      const implementationOrder = implementationOrderByName.get(character.name)
      if (!content || pageOperatorId !== operatorId || !implementationDate || !implementationOrder) {
        failures.push(`${character.name}（${operatorId}）`)
      } else {
        nextCharacterTable[operatorId].implementationDate = implementationDate
        nextCharacterTable[operatorId].implementationOrder = implementationOrder
      }
      if (content && pageOperatorId === operatorId && branch) {
        nextCharacterTable[operatorId].branch = branch
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