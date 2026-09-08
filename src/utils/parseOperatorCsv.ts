import type { Operator, OperatorAvatars, OperatorSkill } from '@/types/baseData'

type CsvRow = string[]

function parseCsv(text: string): CsvRow[] {
  const rows: CsvRow[] = []
  let row: string[] = []
  let value = ''
  let inQuotes = false

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]
    if (character === undefined) {
      continue
    }

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          value += '"'
          index += 1
        } else {
          inQuotes = false
        }
      } else {
        value += character
      }
      continue
    }

    if (character === '"') {
      inQuotes = true
    } else if (character === ',') {
      row.push(value)
      value = ''
    } else if (character === '\n' || character === '\r') {
      if (character === '\r' && text[index + 1] === '\n') {
        index += 1
      }
      row.push(value)
      value = ''
      if (row.some((cell) => cell !== '')) {
        rows.push(row)
      }
      row = []
    } else {
      value += character
    }
  }

  if (value !== '' || row.length > 0) {
    row.push(value)
    if (row.some((cell) => cell !== '')) {
      rows.push(row)
    }
  }

  return rows
}

function cell(row: CsvRow, columns: Map<string, number>, name: string): string {
  const index = columns.get(name)
  return index === undefined ? '' : (row[index] ?? '').trim()
}

function rarityValue(value: string): number {
  const match = value.match(/^\d+/)
  return match ? Number(match[0]) : 0
}

function buildAvatars(row: CsvRow, columns: Map<string, number>): OperatorAvatars {
  return {
    elite0: cell(row, columns, '精0头像'),
    elite1: cell(row, columns, '精1头像'),
    elite2: cell(row, columns, '精2头像'),
  }
}

function buildSkill(row: CsvRow, columns: Map<string, number>): OperatorSkill {
  return {
    slot: cell(row, columns, '技能槽位'),
    unlockCondition: cell(row, columns, '解锁条件'),
    name: cell(row, columns, '技能名称'),
    replacement: cell(row, columns, '替换关系'),
    skillChain: cell(row, columns, '同槽位技能链'),
    facility: cell(row, columns, '所处房间'),
    iconFile: cell(row, columns, '图标文件名'),
    iconStatus: cell(row, columns, '图标状态'),
    description: cell(row, columns, '技能描述'),
    termReferences: [],
  }
}

export function parseOperatorCsv(text: string): Operator[] {
  const rows = parseCsv(text.replace(/^\uFEFF/, ''))
  const header = rows[0]
  if (!header) {
    return []
  }

  const columns = new Map(header.map((name, index) => [name.trim(), index]))
  const operators = new Map<string, Operator>()

  for (const row of rows.slice(1)) {
    const id = cell(row, columns, '干员ID')
    const name = cell(row, columns, '干员名称')
    if (!id || !name) {
      continue
    }

    let operator = operators.get(id)
    if (!operator) {
      operator = {
        id,
        name,
        profession: cell(row, columns, '职业'),
        branch: cell(row, columns, '分支'),
        rarity: rarityValue(cell(row, columns, '稀有度')),
        avatars: buildAvatars(row, columns),
        skills: [],
      }
      operators.set(id, operator)
    }

    const skill = buildSkill(row, columns)
    if (skill.name) {
      operator.skills.push(skill)
    }
  }

  return [...operators.values()]
}
