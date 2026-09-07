import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const TORAPPU_URL = 'https://torappu.prts.wiki'
const SOURCE_URL = `${TORAPPU_URL}/diff`
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const publicAssetsRoot = resolve(projectRoot, 'public/assets')

const DATA_FILES = [
  {
    name: 'character_table',
    path: 'gamedata/latest/excel/character_table.json',
  },
  {
    name: 'building_data',
    path: 'gamedata/latest/excel/building_data.json',
  },
]

async function fetchResponse(url, label) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const response = await fetch(url)
    if (response.ok || response.status === 404 || attempt === 3) {
      return response
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, attempt * 250))
  }

  throw new Error(`${label}读取失败`)
}

async function fetchJson(url, label) {
  const response = await fetchResponse(url, label)
  if (!response.ok) {
    throw new Error(`${label}读取失败（HTTP ${response.status}）`)
  }
  return response.json()
}

async function writeJson(relativePath, value) {
  const targetPath = resolve(publicAssetsRoot, relativePath)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function downloadAsset(directory, fileName) {
  const sourceUrl = `${TORAPPU_URL}/assets/${directory}/${encodeURIComponent(fileName)}`
  const response = await fetchResponse(sourceUrl, `${directory}/${fileName}`)
  if (response.status === 404) {
    return false
  }
  if (!response.ok) {
    throw new Error(`${directory}/${fileName}读取失败（HTTP ${response.status}）`)
  }

  const content = Buffer.from(await response.arrayBuffer())
  if (content.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') {
    throw new Error(`${directory}/${fileName}不是有效的 PNG 文件`)
  }

  const targetPath = resolve(publicAssetsRoot, `raw/${directory}/${fileName}`)
  await mkdir(dirname(targetPath), { recursive: true })
  await writeFile(targetPath, content)
  return true
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

// Keep the local snapshot limited to fields consumed by the app and asset sync.
function selectCharacterTable(
  characterTable,
  buildingCharacters,
  operatorIds,
  previousCharacterTable = {},
) {
  return Object.fromEntries(
    operatorIds.map((operatorId) => {
      const character = characterTable[operatorId]
      const buildingCharacter = buildingCharacters[operatorId]
      const implementationDate = previousCharacterTable[operatorId]?.implementationDate
      const implementationOrder = previousCharacterTable[operatorId]?.implementationOrder
      const branch = previousCharacterTable[operatorId]?.branch
      return [operatorId, {
        name: character.name,
        rarity: character.rarity,
        profession: character.profession,
        subProfessionId: character.subProfessionId,
        phaseCount: Array.isArray(character.phases) ? character.phases.length : 0,
        buffChar: (buildingCharacter?.buffChar ?? []).map((slotData) => ({
          buffData: (slotData.buffData ?? []).map((buffData) => ({
            buffId: buffData.buffId,
            ...(buffData.cond
              ? {
                  cond: {
                    phase: buffData.cond.phase,
                    level: buffData.cond.level,
                  },
                }
              : {}),
          })),
        })),
        ...(implementationDate ? { implementationDate } : {}),
        ...(Number.isFinite(implementationOrder) ? { implementationOrder } : {}),
        ...(branch ? { branch } : {}),
      }]
    }),
  )
}

async function readExistingCharacterTable() {
  try {
    const filePath = resolve(publicAssetsRoot, 'gamedata/latest/excel/character_table.json')
    return JSON.parse(await readFile(filePath, 'utf8'))
  } catch {
    return {}
  }
}

function selectBuildingData(buildingData, operatorIds) {
  const buffIds = new Set(
    operatorIds.flatMap((operatorId) =>
      (buildingData.chars?.[operatorId]?.buffChar ?? []).flatMap((slotData) =>
        slotData.buffData.map((buffData) => buffData.buffId).filter(Boolean),
      ),
    ),
  )
  const buffs = Object.fromEntries(
    [...buffIds].map((buffId) => {
      const buff = buildingData.buffs[buffId]
      return [buffId, {
        buffName: buff.buffName,
        skillIcon: buff.skillIcon,
        roomType: buff.roomType,
        description: buff.description,
      }]
    }),
  )

  return { buffs }
}

function avatarNames(operatorId, character) {
  const names = [`${operatorId}.png`]
  const phaseCount = character?.phaseCount ?? 0
  if (phaseCount >= 2) {
    names.push(`${operatorId}_1+.png`)
  }
  if (phaseCount >= 3) {
    names.push(`${operatorId}_2.png`)
  }
  return names
}

async function main() {
  const versions = await fetchJson(`${TORAPPU_URL}/api/v1/version`, 'Torappu 版本列表')
  const latest = versions
    .filter((version) => version.isReady && version.assetMappingStatus === 'ready')
    .at(-1)
  if (!latest) {
    throw new Error('Torappu 没有可用的已完成版本')
  }

  const rawData = {}
  for (const dataFile of DATA_FILES) {
    rawData[dataFile.name] = await fetchJson(`${TORAPPU_URL}/${dataFile.path}`, `Torappu ${dataFile.name}`)
  }

  const previousCharacterTable = await readExistingCharacterTable()

  const operatorIds = Object.keys(rawData.building_data.chars ?? {}).filter(
    (operatorId) => operatorId.startsWith('char_') && rawData.character_table[operatorId]?.name,
  )
  const data = {
    character_table: selectCharacterTable(
      rawData.character_table,
      rawData.building_data.chars ?? {},
      operatorIds,
      previousCharacterTable,
    ),
    building_data: selectBuildingData(rawData.building_data, operatorIds),
  }
  for (const dataFile of DATA_FILES) {
    await writeJson(dataFile.path, data[dataFile.name])
  }

  const characterTable = data.character_table
  const buildingData = data.building_data
  const skillIcons = new Set(
    Object.values(buildingData.buffs ?? {})
      .map((buff) => buff.skillIcon)
      .filter(Boolean)
      .map((icon) => `${icon}.png`),
  )
  const avatarTasks = operatorIds.flatMap((operatorId) =>
    avatarNames(operatorId, characterTable[operatorId]).map((fileName) => ({
      directory: 'char_avatar',
      fileName,
    })),
  )
  const iconTasks = [...skillIcons].map((fileName) => ({
    directory: 'build_skill_icon',
    fileName,
  }))
  const missingAvatars = []
  let completed = 0
  const imageTasks = [...avatarTasks, ...iconTasks]
  await runPool(imageTasks, 12, async (task) => {
    const downloaded = await downloadAsset(task.directory, task.fileName)
    if (!downloaded && task.directory === 'char_avatar') {
      missingAvatars.push(task.fileName)
    }
    completed += 1
    if (completed % 100 === 0 || completed === imageTasks.length) {
      console.log(`资源同步进度：${completed}/${imageTasks.length}`)
    }
  })

  await writeJson('gamedata/latest/torappu-meta.json', {
    source: 'Torappu',
    sourceUrl: SOURCE_URL,
    versionId: latest.id,
    clientVersion: latest.clientVersion,
    resVersion: latest.resVersion,
    syncedAt: new Date().toISOString(),
    missingAvatars,
    paths: {
      characterTable: 'gamedata/latest/excel/character_table.json',
      buildingData: 'gamedata/latest/excel/building_data.json',
      avatars: 'raw/char_avatar',
      skillIcons: 'raw/build_skill_icon',
    },
  })

  console.log(`Torappu 同步完成：${latest.clientVersion} / ${latest.resVersion}`)
  console.log(`干员：${operatorIds.length}，基建图标：${skillIcons.size}，缺失阶段头像：${missingAvatars.length}`)
  if (missingAvatars.length > 0) {
    console.log(`缺失头像：${missingAvatars.join(', ')}`)
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
