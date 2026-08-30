import { z } from 'zod'

export const resumeLocaleSchema = z.enum(['zh', 'en'])

export const resumeSourceSchema = z.enum(['sample', 'upload', 'paste', 'boss', 'ai-generated', 'ai-chat'])
export const TRUSTED_RESUME_SOURCES = ['paste', 'upload', 'boss'] as const

const linkSchema = z.object({
  label: z.string().default(''),
  url: z.string().default('')
})

const profileSchema = z.object({
  name: z.string().default(''),
  englishName: z.string().optional(),
  title: z.string().default(''),
  location: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  github: z.string().optional(),
  blog: z.string().optional(),
  links: z.array(linkSchema).default([]),
  summary: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([])
})

const skillGroupSchema = z.object({
  group: z.string().default(''),
  items: z.array(z.string()).default([])
})

const experienceSchema = z.object({
  company: z.string().default(''),
  role: z.string().default(''),
  period: z.string().default(''),
  location: z.string().optional(),
  tags: z.array(z.string()).default([]),
  bullets: z.array(z.string()).default([])
})

const projectSchema = z.object({
  id: z.string().default(''),
  name: z.string().default(''),
  type: z.string().default(''),
  tags: z.array(z.string()).default([]),
  summary: z.string().default(''),
  highlights: z.array(z.string()).default([])
})

const educationSchema = z.object({
  school: z.string().default(''),
  degree: z.string().optional(),
  major: z.string().optional(),
  period: z.string().optional(),
  details: z.array(z.string()).default([])
})

const metadataSchema = z.object({
  source: resumeSourceSchema.default('sample'),
  locale: resumeLocaleSchema.default('zh'),
  updatedAt: z.string().default(() => new Date().toISOString())
})

export const resumeDataSchema = z.object({
  profile: profileSchema.default(() => ({} as z.infer<typeof profileSchema>)),
  targetRole: z.string().optional(),
  skills: z.array(skillGroupSchema).default([]),
  experiences: z.array(experienceSchema).default([]),
  projects: z.array(projectSchema).default([]),
  education: z.array(educationSchema).default([]),
  certifications: z.array(z.string()).default([]),
  awards: z.array(z.string()).default([]),
  languages: z.array(z.string()).default([]),
  openSource: z.array(z.string()).default([]),
  metadata: metadataSchema.default(() => ({} as z.infer<typeof metadataSchema>))
})

export type ResumeLocale = z.infer<typeof resumeLocaleSchema>
export type ResumeSource = z.infer<typeof resumeSourceSchema>
export type ResumeData = z.infer<typeof resumeDataSchema>

export function isTrustedResumeSource(source: ResumeSource | string | undefined): source is typeof TRUSTED_RESUME_SOURCES[number] {
  return TRUSTED_RESUME_SOURCES.includes(source as typeof TRUSTED_RESUME_SOURCES[number])
}

export type ResumeSnapshot = {
  id: string
  createdAt: string
  reason: 'manual' | 'agent-change'
  data: ResumeData
}

export type ResumeDraft = {
  id: string
  name: string
  source: ResumeSource
  createdAt: string
  updatedAt: string
  data: ResumeData
  snapshots: ResumeSnapshot[]
}

export type ResumeDraftState = {
  activeDraftId: string | null
  drafts: ResumeDraft[]
}

let fallbackIdSequence = 0

export function createResumeId(prefix: string) {
  try {
    const uuid = globalThis.crypto?.randomUUID?.()
    if (uuid) return uuid
  } catch {
    // Fall through when Web Crypto is unavailable or blocked.
  }

  fallbackIdSequence += 1
  const random = Math.random().toString(36).slice(2, 10)
  return `${prefix}-${Date.now()}-${fallbackIdSequence}-${random}`
}

export function normalizeResumeData(
  input: unknown,
  options: {
    source?: ResumeSource
    locale?: ResumeLocale
    now?: string
  } = {}
) {
  const parsed = resumeDataSchema.parse(input)
  const source = options.source ?? parsed.metadata.source
  const locale = options.locale ?? parsed.metadata.locale
  const updatedAt = options.now ?? parsed.metadata.updatedAt ?? new Date().toISOString()

  return resumeDataSchema.parse({
    ...parsed,
    profile: {
      ...parsed.profile,
      links: normalizeLinks(parsed.profile)
    },
    metadata: {
      source,
      locale,
      updatedAt
    }
  })
}

function normalizeLinks(profile: ResumeData['profile']) {
  const links = [...(profile.links ?? [])]

  if (profile.github && !links.some((link) => link.url === profile.github)) {
    links.push({ label: 'GitHub', url: profile.github })
  }

  if (profile.blog && !links.some((link) => link.url === profile.blog)) {
    links.push({ label: 'Blog', url: profile.blog })
  }

  return links.filter((link) => link.url)
}

export function createResumeDraft(
  data: ResumeData,
  options: {
    id?: string
    name?: string
    source?: ResumeSource
    now?: string
  } = {}
): ResumeDraft {
  const now = options.now ?? new Date().toISOString()
  const source = options.source ?? data.metadata.source
  const normalizedData = normalizeResumeData(data, {
    source,
    locale: data.metadata.locale,
    now
  })
  const requestedId = options.id?.trim()

  return {
    id: requestedId || createResumeId('draft'),
    name: options.name ?? defaultDraftName(normalizedData),
    source,
    createdAt: now,
    updatedAt: now,
    data: normalizedData,
    snapshots: []
  }
}

export function defaultDraftName(data: ResumeData) {
  const name = data.profile.name || 'Untitled Resume'
  const title = data.targetRole || data.profile.title
  return title ? `${name} - ${title}` : name
}
