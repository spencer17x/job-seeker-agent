import { z } from 'zod'
import { jobMarketplaceIdSchema } from './job-marketplace'

export const JOB_SOURCE_KINDS = ['greenhouse', 'lever', 'manual'] as const
export const JOB_WORKPLACE_TYPES = ['remote', 'hybrid', 'onsite'] as const
export const JOB_EMPLOYMENT_TYPES = [
  'full-time',
  'part-time',
  'contract',
  'internship',
  'other'
] as const
export const JOB_POSTING_STATUSES = ['open', 'closed', 'stale', 'unknown'] as const
export const JOB_ELIGIBILITY_STATUSES = ['eligible', 'excluded', 'unknown'] as const
export const APPLICATION_STATUSES = [
  'saved',
  'analyzing',
  'preparing',
  'ready-to-apply',
  'applied',
  'interviewing',
  'offered',
  'rejected',
  'withdrawn',
  'archived'
] as const

export type JobWorkplaceType = typeof JOB_WORKPLACE_TYPES[number]
export type JobEmploymentType = typeof JOB_EMPLOYMENT_TYPES[number]

export const MAX_JOB_DESCRIPTION_LENGTH = 100_000
export const MAX_JOB_DOMAIN_ENTITY_BYTES = 160 * 1024

const stableIdSchema = z.string()
  .min(1)
  .max(160)
  .refine((value) => value === value.trim(), 'ID must not contain surrounding whitespace')
const timestampSchema = z.iso.datetime({ offset: true })
const boundedLabelSchema = z.string().trim().min(1).max(500)
const boundedTermSchema = z.string().trim().min(1).max(120)
const boundedTextSchema = z.string().trim().min(1).max(20_000)
const fingerprintSchema = z.string()
  .trim()
  .min(1)
  .max(256)
const sourceKeySchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9_-]*$/iu, 'Source key contains unsupported characters')
const httpsUrlSchema = z.string().trim().min(1).max(2_000).superRefine((value, context) => {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    context.addIssue({ code: 'custom', message: 'Job URL is invalid' })
    return
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    context.addIssue({
      code: 'custom',
      message: 'Job URLs must use HTTPS without embedded credentials'
    })
  }
})

const uniqueTermsSchema = (maximum: number) => z.array(boundedTermSchema).max(maximum)
  .superRefine((values, context) => addDuplicateIssues(values, context, 'Values must be unique'))

const workplaceTypeSchema = z.enum(JOB_WORKPLACE_TYPES)
const employmentTypeSchema = z.enum(JOB_EMPLOYMENT_TYPES)

export const jobSourceSchema = z.object({
  id: stableIdSchema,
  kind: z.enum(JOB_SOURCE_KINDS),
  label: boundedLabelSchema,
  sourceKey: sourceKeySchema.optional(),
  enabled: z.boolean(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((source, context) => {
  if (source.kind === 'manual' && source.sourceKey !== undefined) {
    context.addIssue({
      code: 'custom',
      path: ['sourceKey'],
      message: 'Manual sources must not have a remote source key'
    })
  }
  if (source.kind !== 'manual' && source.sourceKey === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['sourceKey'],
      message: 'Remote sources require a source key'
    })
  }
  addTimestampIssues(source, context)
  addSerializedSizeIssue(source, context)
})

export const jobSearchProfileSchema = z.object({
  id: stableIdSchema,
  name: boundedLabelSchema,
  platforms: z.array(jobMarketplaceIdSchema).min(1).max(5)
    .superRefine((values, context) => addDuplicateIssues(values, context, 'Platforms must be unique'))
    .optional(),
  titles: uniqueTermsSchema(30).min(1),
  adjacentTitles: uniqueTermsSchema(30),
  locations: uniqueTermsSchema(50),
  excludedLocations: uniqueTermsSchema(50),
  workplaceTypes: z.array(workplaceTypeSchema).max(JOB_WORKPLACE_TYPES.length)
    .superRefine((values, context) => addDuplicateIssues(values, context, 'Workplace types must be unique')),
  employmentTypes: z.array(employmentTypeSchema).max(JOB_EMPLOYMENT_TYPES.length)
    .superRefine((values, context) => addDuplicateIssues(values, context, 'Employment types must be unique')),
  requiredTerms: uniqueTermsSchema(100),
  preferredTerms: uniqueTermsSchema(100),
  excludedTerms: uniqueTermsSchema(100),
  preferredCompanies: uniqueTermsSchema(50).optional(),
  blockedCompanies: uniqueTermsSchema(100).optional(),
  experienceLevels: uniqueTermsSchema(20).optional(),
  educationLevels: uniqueTermsSchema(20).optional(),
  industries: uniqueTermsSchema(50).optional(),
  companySizes: uniqueTermsSchema(20).optional(),
  financingStages: uniqueTermsSchema(20).optional(),
  minimumMonthlySalary: z.number().finite().nonnegative().max(1_000_000).optional(),
  maximumMonthlySalary: z.number().finite().positive().max(1_000_000).optional(),
  maximumAgeDays: z.number().int().min(1).max(365),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((profile, context) => {
  if (
    profile.minimumMonthlySalary !== undefined
    && profile.maximumMonthlySalary !== undefined
    && profile.maximumMonthlySalary < profile.minimumMonthlySalary
  ) {
    context.addIssue({
      code: 'custom',
      path: ['maximumMonthlySalary'],
      message: 'Maximum salary cannot be lower than minimum salary'
    })
  }
  addTimestampIssues(profile, context)
  addSerializedSizeIssue(profile, context)
})

export const jobCompensationSchema = z.object({
  minimum: z.number().finite().nonnegative().optional(),
  maximum: z.number().finite().nonnegative().optional(),
  currency: z.string().trim().min(3).max(12),
  period: z.string().trim().min(1).max(40).optional()
}).strict().superRefine((compensation, context) => {
  if (
    compensation.minimum !== undefined
    && compensation.maximum !== undefined
    && compensation.maximum < compensation.minimum
  ) {
    context.addIssue({
      code: 'custom',
      path: ['maximum'],
      message: 'Maximum compensation cannot be lower than minimum compensation'
    })
  }
})

export const jobPostingSchema = z.object({
  id: stableIdSchema,
  sourceId: stableIdSchema,
  externalId: z.string().trim().min(1).max(300),
  canonicalUrl: httpsUrlSchema,
  applyUrl: httpsUrlSchema,
  title: z.string().trim().min(1).max(300),
  company: z.string().trim().min(1).max(300),
  description: z.string().trim().min(1).max(MAX_JOB_DESCRIPTION_LENGTH),
  locale: z.enum(['zh', 'en']),
  location: z.string().trim().min(1).max(500).optional(),
  workplaceType: workplaceTypeSchema.optional(),
  employmentType: employmentTypeSchema.optional(),
  compensation: jobCompensationSchema.optional(),
  sourceUpdatedAt: timestampSchema.optional(),
  detailFetchedAt: timestampSchema.optional(),
  firstSeenAt: timestampSchema,
  lastCheckedAt: timestampSchema,
  status: z.enum(JOB_POSTING_STATUSES),
  contentHash: fingerprintSchema
}).strict().superRefine((posting, context) => {
  if (Date.parse(posting.lastCheckedAt) < Date.parse(posting.firstSeenAt)) {
    context.addIssue({
      code: 'custom',
      path: ['lastCheckedAt'],
      message: 'Last checked timestamp cannot precede first seen timestamp'
    })
  }
  addSerializedSizeIssue(posting, context)
})

export const jobRecommendationReasonSchema = z.object({
  code: z.string().trim().min(1).max(120),
  contribution: z.number().finite().min(-100).max(100),
  evidenceRefs: z.array(stableIdSchema).max(100)
}).strict().superRefine((reason, context) => {
  addDuplicateIssues(reason.evidenceRefs, context, 'Evidence references must be unique')
})

export const jobRecommendationSchema = z.object({
  id: stableIdSchema,
  postingId: stableIdSchema,
  searchProfileId: stableIdSchema,
  sourceDraftId: stableIdSchema,
  rubricVersion: z.string().trim().min(1).max(120),
  inputFingerprint: fingerprintSchema,
  eligibility: z.enum(JOB_ELIGIBILITY_STATUSES),
  preliminaryScore: z.number().finite().min(0).max(100).optional(),
  decision: z.enum(['new', 'saved', 'ignored']).optional(),
  reasons: z.array(jobRecommendationReasonSchema).max(50),
  analyzedTargetJobId: stableIdSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((recommendation, context) => {
  if (recommendation.eligibility === 'eligible' && recommendation.preliminaryScore === undefined) {
    context.addIssue({
      code: 'custom',
      path: ['preliminaryScore'],
      message: 'Eligible recommendations require a preliminary score'
    })
  }
  addTimestampIssues(recommendation, context)
  addSerializedSizeIssue(recommendation, context)
})

export const applicationRecordSchema = z.object({
  id: stableIdSchema,
  postingId: stableIdSchema,
  sourceDraftId: stableIdSchema,
  targetJobId: stableIdSchema.optional(),
  resumeVariantId: stableIdSchema.optional(),
  postingContentHash: fingerprintSchema.optional(),
  recommendationFingerprint: fingerprintSchema.optional(),
  workflowInputFingerprint: fingerprintSchema.optional(),
  status: z.enum(APPLICATION_STATUSES),
  submittedAt: timestampSchema.optional(),
  notes: z.string().trim().max(20_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict().superRefine((record, context) => {
  if (record.resumeVariantId && !record.targetJobId) {
    context.addIssue({
      code: 'custom',
      path: ['targetJobId'],
      message: 'A resume variant requires a target job'
    })
  }
  if (
    ['applied', 'interviewing', 'offered', 'rejected'].includes(record.status)
    && !record.submittedAt
  ) {
    context.addIssue({
      code: 'custom',
      path: ['submittedAt'],
      message: 'Post-submission statuses require a submitted timestamp'
    })
  }
  if (record.submittedAt && Date.parse(record.submittedAt) < Date.parse(record.createdAt)) {
    context.addIssue({
      code: 'custom',
      path: ['submittedAt'],
      message: 'Submitted timestamp cannot precede creation'
    })
  }
  addTimestampIssues(record, context)
  addSerializedSizeIssue(record, context)
})

export type JobSource = z.infer<typeof jobSourceSchema>
export type JobSearchProfile = z.infer<typeof jobSearchProfileSchema>
export type JobPosting = z.infer<typeof jobPostingSchema>
export type JobRecommendationReason = z.infer<typeof jobRecommendationReasonSchema>
export type JobRecommendation = z.infer<typeof jobRecommendationSchema>
export type ApplicationRecord = z.infer<typeof applicationRecordSchema>

export function createStableJobDomainId(prefix: string, parts: readonly string[]) {
  const normalizedPrefix = prefix.trim().toLowerCase()
  if (!/^[a-z][a-z0-9-]{0,31}$/u.test(normalizedPrefix) || parts.length === 0) {
    throw new TypeError('Stable job IDs require a valid prefix and at least one identity part')
  }
  const normalizedParts = parts.map((part) => part.normalize('NFKC').trim().toLowerCase())
  if (normalizedParts.some((part) => !part)) {
    throw new TypeError('Stable job ID parts must not be empty')
  }
  return `${normalizedPrefix}-${fnv1a64(normalizedParts.join('\u0000'))}`
}

export function createJobInputFingerprint(input: unknown) {
  const serialized = JSON.stringify(input)
  if (serialized === undefined) throw new TypeError('Fingerprint input must be serializable')
  return `fnv1a64:${fnv1a64(serialized)}`
}

function addTimestampIssues(
  value: { createdAt: string; updatedAt: string },
  context: z.RefinementCtx
) {
  if (Date.parse(value.updatedAt) < Date.parse(value.createdAt)) {
    context.addIssue({
      code: 'custom',
      path: ['updatedAt'],
      message: 'Updated timestamp cannot precede creation'
    })
  }
}

function addSerializedSizeIssue(value: unknown, context: z.RefinementCtx) {
  const serialized = JSON.stringify(value)
  if (
    serialized === undefined
    || new TextEncoder().encode(serialized).byteLength > MAX_JOB_DOMAIN_ENTITY_BYTES
  ) {
    context.addIssue({ code: 'custom', message: 'Job domain entity is too large' })
  }
}

function addDuplicateIssues(
  values: readonly string[],
  context: z.RefinementCtx,
  message: string
) {
  const seen = new Set<string>()
  values.forEach((value, index) => {
    if (seen.has(value)) context.addIssue({ code: 'custom', path: [index], message })
    seen.add(value)
  })
}

function fnv1a64(value: string) {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte)
    hash = BigInt.asUintN(64, hash * prime)
  }
  return hash.toString(36)
}
