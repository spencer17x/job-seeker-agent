import { careerEvidenceSourceId } from '@/lib/agent/career-evidence'
import type {
  BossConversationMessage,
  BossConversationThread,
  IndexedDbDomainStore
} from '@/lib/agent/domain-store'
import { isTrustedResumeSource, type ResumeDraft } from '@/lib/resume-model'
import { prepareReadyBossApplicationPackets, type ApplicationPacket } from './application-record'
import type {
  ApplicationRecord,
  JobPosting,
  JobRecommendation,
  JobSearchProfile,
  JobSource
} from './job-domain'

export type JobWorkspaceSnapshot = {
  sources: JobSource[]
  profiles: JobSearchProfile[]
  postings: JobPosting[]
  recommendations: JobRecommendation[]
  applications: ApplicationRecord[]
  packets: ApplicationPacket[]
  conversationThreads: BossConversationThread[]
  conversationMessages: BossConversationMessage[]
  evidenceReady: boolean
}

export async function loadJobWorkspaceSnapshot(input: {
  store: IndexedDbDomainStore
  activeDraft: ResumeDraft | null
  now?: () => string
}): Promise<JobWorkspaceSnapshot> {
  const { store, activeDraft } = input
  const trustedDraftSource = Boolean(activeDraft && isTrustedResumeSource(activeDraft.source))
  const sourceDraftId = trustedDraftSource ? activeDraft!.id : ''
  const [sources, profiles, postings, recommendations, initialApplications, evidenceSource] = await Promise.all([
    store.list('jobSources'),
    store.list('jobSearchProfiles'),
    store.list('jobPostings'),
    sourceDraftId
      ? store.listByIndex('jobRecommendations', 'bySourceDraftId', sourceDraftId)
      : Promise.resolve([]),
    sourceDraftId
      ? store.listByIndex('applicationRecords', 'bySourceDraftId', sourceDraftId)
      : Promise.resolve([]),
    sourceDraftId
      ? store.get('evidenceSources', careerEvidenceSourceId(sourceDraftId))
      : Promise.resolve(undefined)
  ])
  const evidenceReady = Boolean(evidenceSource)
  const automatic = evidenceReady && activeDraft
    ? await prepareReadyBossApplicationPackets({
        store,
        sourceDraftId: activeDraft.id,
        resume: activeDraft.data,
        now: input.now ?? (() => new Date().toISOString())
      })
    : { packets: [] as ApplicationPacket[], preparedIds: [] as string[] }
  const applications = automatic.preparedIds.length > 0
    ? await store.listByIndex('applicationRecords', 'bySourceDraftId', sourceDraftId)
    : initialApplications
  const conversationThreads = (await Promise.all(applications.map((application) => (
    store.listByIndex('bossConversationThreads', 'byApplicationId', application.id)
  )))).flat()
  const conversationMessages = (await Promise.all(conversationThreads.map((thread) => (
    store.listByIndex('bossConversationMessages', 'byThreadId', thread.id)
  )))).flat()

  return {
    sources: sources.sort(byUpdatedAt),
    profiles: profiles.sort(byUpdatedAt),
    postings: postings.sort((left, right) => right.lastCheckedAt.localeCompare(left.lastCheckedAt)),
    recommendations,
    applications,
    packets: automatic.packets,
    conversationThreads: conversationThreads.sort(byUpdatedAt),
    conversationMessages: conversationMessages.sort(byUpdatedAt),
    evidenceReady
  }
}

function byUpdatedAt(left: { updatedAt: string }, right: { updatedAt: string }) {
  return right.updatedAt.localeCompare(left.updatedAt)
}
