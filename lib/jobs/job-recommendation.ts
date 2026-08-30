import {
  createJobInputFingerprint,
  createStableJobDomainId,
  jobRecommendationSchema,
  type JobPosting,
  type JobSearchProfile
} from './job-domain'

export const JOB_RELEVANCE_RUBRIC_VERSION = 'job-seeker-agent-job-relevance-v1' as const

export type RecommendationCareerFact = {
  id: string
  tags: string[]
  updatedAt: string
}

export function scoreJobRecommendation(input: {
  posting: JobPosting
  profile: JobSearchProfile
  sourceDraftId: string
  facts: readonly RecommendationCareerFact[]
  now: string
}) {
  const text = normalizeSearchText(`${input.posting.title}\n${input.posting.description}`)
  const exclusion = exclusionReason(input.posting, input.profile, text, input.now)
  const unknown = hasUnknownHardPreference(input.posting, input.profile)
  const { createdAt: _profileCreatedAt, updatedAt: _profileUpdatedAt, ...profileConfiguration } = input.profile
  const fingerprint = createJobInputFingerprint({
    posting: {
      id: input.posting.id,
      contentHash: input.posting.contentHash,
      status: input.posting.status
    },
    profile: profileConfiguration,
    sourceDraftId: input.sourceDraftId,
    facts: [...input.facts]
      .map((fact) => ({ id: fact.id, tags: [...fact.tags].sort(compareStrings), updatedAt: fact.updatedAt }))
      .sort((left, right) => compareStrings(left.id, right.id))
  })
  const base = {
    id: createStableJobDomainId('recommendation', [
      input.posting.id,
      input.profile.id,
      input.sourceDraftId
    ]),
    postingId: input.posting.id,
    searchProfileId: input.profile.id,
    sourceDraftId: input.sourceDraftId,
    rubricVersion: JOB_RELEVANCE_RUBRIC_VERSION,
    inputFingerprint: fingerprint,
    decision: 'new' as const,
    createdAt: input.now,
    updatedAt: input.now
  }
  if (exclusion) {
    return jobRecommendationSchema.parse({
      ...base,
      eligibility: 'excluded',
      reasons: [{ code: exclusion, contribution: -100, evidenceRefs: [] }]
    })
  }

  const titleContribution = round(titleRelevance(input.posting.title, input.profile) * 0.4)
  const matchedFacts = input.facts.filter((fact) => fact.tags.some((tag) => includesTerm(text, tag)))
  const taggedFacts = input.facts.filter((fact) => fact.tags.length > 0)
  const factRatio = taggedFacts.length === 0 ? 0 : matchedFacts.length / taggedFacts.length
  const evidenceContribution = round(Math.min(1, factRatio) * 30)
  const preferenceContribution = round(softPreferenceFit(input.posting, input.profile, text) * 0.2)
  const freshnessContribution = round(freshnessScore(input.posting, input.profile, input.now) * 0.1)
  const reasons = [
    { code: 'title-role-relevance', contribution: titleContribution, evidenceRefs: [] },
    {
      code: 'career-fact-tag-overlap',
      contribution: evidenceContribution,
      evidenceRefs: matchedFacts.map((fact) => fact.id).sort(compareStrings)
    },
    { code: 'soft-preference-fit', contribution: preferenceContribution, evidenceRefs: [] },
    { code: 'posting-freshness', contribution: freshnessContribution, evidenceRefs: [] }
  ]
  return jobRecommendationSchema.parse({
    ...base,
    eligibility: unknown ? 'unknown' : 'eligible',
    preliminaryScore: round(reasons.reduce((total, reason) => total + reason.contribution, 0)),
    reasons
  })
}

function exclusionReason(
  posting: JobPosting,
  profile: JobSearchProfile,
  text: string,
  now: string
) {
  if (posting.status === 'closed' || posting.status === 'stale') return 'posting-not-open'
  if (freshnessAgeDays(posting, now) > profile.maximumAgeDays) return 'posting-too-old'
  if (profile.excludedTerms.some((term) => includesTerm(text, term))) return 'excluded-term'
  if (profile.blockedCompanies?.some((company) => sameText(company, posting.company))) return 'blocked-company'
  if (profile.requiredTerms.some((term) => !includesTerm(text, term))) return 'required-term-missing'
  if (
    posting.location
    && profile.excludedLocations.some((location) => sameText(location, posting.location!))
  ) return 'excluded-location'
  if (
    posting.workplaceType
    && profile.workplaceTypes.length > 0
    && !profile.workplaceTypes.includes(posting.workplaceType)
  ) return 'workplace-type-mismatch'
  if (
    posting.employmentType
    && profile.employmentTypes.length > 0
    && !profile.employmentTypes.includes(posting.employmentType)
  ) return 'employment-type-mismatch'
  if (
    profile.minimumMonthlySalary !== undefined
    && posting.compensation?.maximum !== undefined
    && posting.compensation.maximum < profile.minimumMonthlySalary
  ) return 'salary-below-minimum'
  if (
    profile.maximumMonthlySalary !== undefined
    && posting.compensation?.minimum !== undefined
    && posting.compensation.minimum > profile.maximumMonthlySalary
  ) return 'salary-above-maximum'
  return null
}

function hasUnknownHardPreference(posting: JobPosting, profile: JobSearchProfile) {
  return (profile.workplaceTypes.length > 0 && !posting.workplaceType)
    || (profile.employmentTypes.length > 0 && !posting.employmentType)
    || (profile.locations.length > 0 && !posting.location)
    || ((profile.minimumMonthlySalary !== undefined || profile.maximumMonthlySalary !== undefined) && !posting.compensation)
}

function titleRelevance(title: string, profile: JobSearchProfile) {
  const primary = Math.max(...profile.titles.map((candidate) => textSimilarity(title, candidate)), 0)
  const adjacent = Math.max(
    ...profile.adjacentTitles.map((candidate) => textSimilarity(title, candidate) * 0.8),
    0
  )
  return Math.max(primary, adjacent)
}

function softPreferenceFit(posting: JobPosting, profile: JobSearchProfile, text: string) {
  const signals: number[] = []
  if (profile.locations.length > 0 && posting.location) {
    signals.push(profile.locations.some((location) => sameText(location, posting.location!)) ? 100 : 0)
  }
  if (profile.preferredTerms.length > 0) {
    const matches = profile.preferredTerms.filter((term) => includesTerm(text, term)).length
    signals.push((matches / profile.preferredTerms.length) * 100)
  }
  if ((profile.preferredCompanies?.length ?? 0) > 0) {
    signals.push(profile.preferredCompanies!.some((company) => sameText(company, posting.company)) ? 100 : 0)
  }
  for (const terms of [
    profile.experienceLevels,
    profile.educationLevels,
    profile.industries,
    profile.companySizes,
    profile.financingStages
  ]) {
    if ((terms?.length ?? 0) > 0) {
      signals.push(terms!.some((term) => includesTerm(text, term)) ? 100 : 0)
    }
  }
  return signals.length === 0 ? 0 : signals.reduce((total, value) => total + value, 0) / signals.length
}

function freshnessScore(posting: JobPosting, profile: JobSearchProfile, now: string) {
  return Math.max(0, 100 * (1 - freshnessAgeDays(posting, now) / profile.maximumAgeDays))
}

function freshnessAgeDays(posting: JobPosting, now: string) {
  const timestamp = posting.sourceUpdatedAt ?? posting.firstSeenAt
  return Math.max(0, (Date.parse(now) - Date.parse(timestamp)) / 86_400_000)
}

function textSimilarity(left: string, right: string) {
  const normalizedLeft = normalizeSearchText(left)
  const normalizedRight = normalizeSearchText(right)
  if (normalizedLeft === normalizedRight) return 100
  if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) return 85
  const leftTokens = searchTokens(normalizedLeft)
  const rightTokens = searchTokens(normalizedRight)
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length
  const union = new Set([...leftTokens, ...rightTokens]).size
  return union === 0 ? 0 : (intersection / union) * 100
}

function includesTerm(text: string, term: string) {
  return text.includes(normalizeSearchText(term))
}

function sameText(left: string, right: string) {
  return normalizeSearchText(left) === normalizeSearchText(right)
}

function normalizeSearchText(value: string) {
  return value.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ')
}

function searchTokens(value: string) {
  return new Set(value.match(/[\p{L}\p{N}+#.]+/gu) ?? [])
}

function round(value: number) {
  return Math.round((value + Number.EPSILON) * 10_000) / 10_000
}

function compareStrings(left: string, right: string) {
  return left < right ? -1 : left > right ? 1 : 0
}
