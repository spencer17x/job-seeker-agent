import type { JobEmploymentType, JobWorkplaceType } from './job-domain'

const knownCities = [
  '北京', '上海', '广州', '深圳', '杭州', '成都', '武汉', '南京', '苏州',
  '西安', '重庆', '长沙', '天津', '厦门', '宁波', '郑州', '青岛', '合肥'
] as const

const knownTitles = [
  'AI Agent工程师', 'AI应用工程师', 'AI全栈工程师', '全栈工程师',
  '高级前端工程师', '前端开发工程师', '前端工程师', '后端开发工程师',
  '后端工程师', '大模型应用工程师', '算法工程师', '产品经理'
] as const

export type AnalyzedJobGoal = {
  titles: string[]
  locations: string[]
  minimumSalary?: number
  maximumSalary?: number
  experienceLevels: string[]
  workplaceTypes: JobWorkplaceType[]
  employmentTypes: JobEmploymentType[]
  preferredTerms: string[]
  excludedTerms: string[]
}

export function analyzeJobGoalDescription(description: string): AnalyzedJobGoal {
  const text = description.normalize('NFKC').trim().slice(0, 5_000)
  const compact = text.replace(/\s+/gu, '')
  const titles = knownTitles.filter((title) => compact.toLocaleLowerCase().includes(
    title.replace(/\s+/gu, '').toLocaleLowerCase()
  ))
  if (/AI\s*Agent(?:\s*(?:岗位|职位|工程师))?/iu.test(text)) titles.push('AI Agent工程师')
  if (/AI\s*全栈(?:\s*(?:岗位|职位|工程师))?/iu.test(text)) titles.push('AI全栈工程师')
  if (/(前端|front[- ]?end)/iu.test(text)) titles.push('前端工程师')
  if (/(全栈|full[- ]?stack)/iu.test(text)) titles.push('全栈工程师')
  if (/(后端|back[- ]?end)/iu.test(text)) titles.push('后端工程师')
  const locations = knownCities.filter((city) => compact.includes(city))
  const workplaceTypes: JobWorkplaceType[] = []
  if (/(远程|remote|居家办公)/iu.test(text)) workplaceTypes.push('remote')
  if (/(混合办公|hybrid)/iu.test(text)) workplaceTypes.push('hybrid')
  if (/(现场办公|坐班|onsite)/iu.test(text)) workplaceTypes.push('onsite')
  const employmentTypes: JobEmploymentType[] = []
  if (/(全职|full[- ]?time)/iu.test(text)) employmentTypes.push('full-time')
  if (/(兼职|part[- ]?time)/iu.test(text)) employmentTypes.push('part-time')
  const excludesOutsourcing = /(?:不考虑|不要|排除|拒绝|不接受|no|exclude|without)\s*(?:任何)?\s*(?:外包|outsourc(?:e|ing)?)/iu.test(text)
  const excludedOutsourcingTerm = /外包/u.test(text) ? '外包' : 'outsourcing'
  if (/(合同制|contract)/iu.test(text) && !excludesOutsourcing) employmentTypes.push('contract')
  if (/(实习|intern)/iu.test(text)) employmentTypes.push('internship')
  const salary = parseSalaryRange(text)
  const experienceLevels = parseExperienceLevels(text)
  const preferredTerms = [
    'AI Agent', 'RAG', 'LangGraph', 'TypeScript', 'React', 'Next.js',
    'React Native', 'Node.js', '远程', '交易系统', '支付', '钱包'
  ].filter((term) => compact.toLocaleLowerCase().includes(term.replace(/\s+/gu, '').toLocaleLowerCase()))
  return {
    titles: [...new Set(titles)],
    locations: [...new Set(locations)],
    ...salary,
    experienceLevels,
    workplaceTypes,
    employmentTypes,
    preferredTerms,
    excludedTerms: excludesOutsourcing ? [excludedOutsourcingTerm] : []
  }
}

function parseSalaryRange(text: string): Pick<AnalyzedJobGoal, 'minimumSalary' | 'maximumSalary'> {
  const prefixedRange = /(?:月薪|薪资|工资|monthly\s+salary|salary)\s*(\d{1,3}(?:\.\d+)?)\s*(k|千|万)?\s*(?:-|到|至|~|～)\s*(\d{1,3}(?:\.\d+)?)\s*(k|千|万)?/iu.exec(text)
  const unitRange = /(\d{1,3}(?:\.\d+)?)\s*(k|千|万)\s*(?:-|到|至|~|～)\s*(\d{1,3}(?:\.\d+)?)\s*(k|千|万)?/iu.exec(text)
  const range = prefixedRange ?? unitRange
  if (range) {
    const minimumSalary = salaryValue(range[1], range[2] || range[4])
    const maximumSalary = salaryValue(range[3], range[4] || range[2])
    if (!minimumSalary || !maximumSalary || maximumSalary < minimumSalary) return {}
    return { minimumSalary, maximumSalary }
  }

  const minimum = /(?:月薪|薪资|工资|monthly\s+salary|salary)?\s*(?:至少|不低于|最低|起薪|at\s+least|minimum)\s*(\d{1,3}(?:\.\d+)?)\s*(k|千|万)/iu.exec(text)
    ?? /(?:月薪|薪资|工资|monthly\s+salary|salary)\s*(\d{1,3}(?:\.\d+)?)\s*(k|千|万)\s*(?:起|以上|\+)?/iu.exec(text)
  if (minimum) {
    const minimumSalary = salaryValue(minimum[1], minimum[2])
    return minimumSalary ? { minimumSalary } : {}
  }
  return {}
}

function parseExperienceLevels(text: string) {
  const range = /(\d{1,2})\s*(?:-|到|至|~|～)\s*(\d{1,2})\s*(?:年|years?)\s*(?:经验|experience)?/iu.exec(text)
  if (range && Number(range[2]) >= Number(range[1])) return [`${range[1]}-${range[2]} 年`]
  const minimum = /(?:至少|不低于|minimum|at\s+least)\s*(\d{1,2})\s*(?:年|years?)\s*(?:经验|experience)?/iu.exec(text)
  return minimum ? [`${minimum[1]} 年以上`] : []
}

function salaryValue(raw: string, unit: string | undefined) {
  const value = Number(raw)
  if (!Number.isFinite(value) || value <= 0) return undefined
  if (/万/u.test(unit ?? '')) return Math.round(value * 10_000)
  if (/(k|千)/iu.test(unit ?? '')) return Math.round(value * 1_000)
  return Math.round(value)
}
