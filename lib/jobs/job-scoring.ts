import { careerEvidenceSourceId } from '@/lib/agent/career-evidence'
import type { IndexedDbDomainStore } from '@/lib/agent/domain-store'
import type { JobSearchProfile } from './job-domain'
import { scoreJobRecommendation } from './job-recommendation'

export async function scoreCurrentJobPostings(input: {
  store: IndexedDbDomainStore
  profile: JobSearchProfile
  sourceDraftId: string
  now?: string
}) {
  const [postings, facts] = await Promise.all([
    input.store.list('jobPostings'),
    input.store.list('careerFacts')
  ])
  const evidenceSourceId = careerEvidenceSourceId(input.sourceDraftId)
  const relevantFacts = facts.filter((fact) => fact.evidenceRefs.includes(evidenceSourceId))
  const now = input.now ?? new Date().toISOString()
  await input.store.transaction(['jobRecommendations'], 'readwrite', async (transaction) => {
    for (const posting of postings) {
      const recommendation = scoreJobRecommendation({
        posting,
        profile: input.profile,
        sourceDraftId: input.sourceDraftId,
        facts: relevantFacts,
        now
      })
      const existing = await transaction.get('jobRecommendations', recommendation.id)
      await transaction.put('jobRecommendations', {
        ...recommendation,
        decision: existing?.decision ?? recommendation.decision,
        analyzedTargetJobId: existing?.analyzedTargetJobId,
        createdAt: existing?.createdAt ?? recommendation.createdAt
      })
    }
  })
}
