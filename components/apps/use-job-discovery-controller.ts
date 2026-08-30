'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocale, useTranslations } from 'next-intl'
import { careerEvidenceSourceId } from '@/lib/agent/career-evidence'
import type { IndexedDbDomainStore } from '@/lib/agent/domain-store'
import type { ResumeDraft } from '@/lib/resume-model'
import {
  analyzeBossCandidateQueue,
  prepareBossCandidateResumeVariants,
  queueBossCandidates,
  upsertBossBrowserJobs
} from '@/lib/jobs/boss-agent'
import { requestBossCandidateAnalysis } from '@/lib/jobs/boss-analysis-client'
import {
  collectBossBrowserJobs,
  collectBossJobDetail,
  searchBossBrowserJobs,
  type BrowserBossJob
} from '@/lib/jobs/browser-agent-protocol'
import {
  createJobInputFingerprint,
  createStableJobDomainId,
  type ApplicationRecord,
  type JobPosting,
  type JobRecommendation,
  type JobSearchProfile,
  type JobSource
} from '@/lib/jobs/job-domain'
import type { JobAgentPreferences } from '@/lib/jobs/job-agent-policy'
import { parseJobClipboardText } from '@/lib/jobs/job-clipboard-import'
import { refreshSelectedJobMarket } from '@/lib/jobs/job-market-search'
import { importMarketplaceJob } from '@/lib/jobs/manual-job-import'
import { createJobPromotionIntent, saveJobPromotionIntent } from '@/lib/jobs/job-promotion'
import { scoreJobRecommendation } from '@/lib/jobs/job-recommendation'
import { refreshJobSource } from '@/lib/jobs/job-refresh'
import { scoreCurrentJobPostings } from '@/lib/jobs/job-scoring'
import { createSameOriginJobSourceAdapter, JobSourceError, type JobSourceAdapter } from '@/lib/jobs/sources'
import { PRIMARY_JOB_MARKETPLACE_IDS, type JobMarketplaceId } from '@/lib/jobs/job-marketplace'
import { splitJobSearchTerms } from './use-job-search-profile-controller'

type SourceKind = Extract<JobSource['kind'], 'greenhouse' | 'lever'>
export type JobOpportunityFilter = 'all' | 'new' | 'saved' | 'needs-analysis' | 'ready' | 'applied' | 'ignored' | 'closed'

type DiscoveryInput = {
  store: IndexedDbDomainStore
  activeDraft: ResumeDraft | null
  trustedDraft: boolean
  browserAgentAvailable: boolean
  sources: JobSource[]
  profiles: JobSearchProfile[]
  postings: JobPosting[]
  recommendations: JobRecommendation[]
  applications: ApplicationRecord[]
  preferences: JobAgentPreferences
  selectedPlatforms: JobMarketplaceId[]
  titles: string
  saveProfile: (announce?: boolean) => Promise<JobSearchProfile | null>
  reload: () => Promise<void>
  navigate: (href: string) => void
  setError: (message: string) => void
  setNotice: (message: string) => void
  createAdapter?: (kind: SourceKind) => JobSourceAdapter
}

export function useJobDiscoveryController(input: DiscoveryInput) {
  const t = useTranslations('jobRadar')
  const locale = useLocale()
  const inputRef = useRef(input)
  const translationsRef = useRef(t)
  const localeRef = useRef(locale)
  inputRef.current = input
  translationsRef.current = t
  localeRef.current = locale
  const [importPlatform, setImportPlatform] = useState<JobMarketplaceId>('boss')
  const [clipboardJobText, setClipboardJobText] = useState('')
  const [importUrl, setImportUrl] = useState('')
  const [importTitle, setImportTitle] = useState('')
  const [importCompany, setImportCompany] = useState('')
  const [importLocation, setImportLocation] = useState('')
  const [importDescription, setImportDescription] = useState('')
  const [filter, setFilter] = useState<JobOpportunityFilter>('all')
  const [selectedPostingId, setSelectedPostingId] = useState('')
  const [busySourceId, setBusySourceId] = useState('')
  const [marketProgress, setMarketProgress] = useState('')
  const controllerRef = useRef<AbortController | null>(null)
  const generationRef = useRef(0)

  const cancel = useCallback(() => controllerRef.current?.abort(), [])
  useEffect(() => cancel, [cancel])

  const searchMarket = useCallback(async (options: { managed?: boolean } = {}) => {
    const current = inputRef.current
    const t = translationsRef.current
    const activeDraft = current.activeDraft
    if (!activeDraft || !current.trustedDraft) {
      current.setError(t('errors.resumeRequired'))
      return
    }
    if (current.selectedPlatforms.length === 0) {
      current.setError(t('errors.platformRequired'))
      return
    }
    controllerRef.current?.abort()
    const controller = new AbortController()
    const generation = generationRef.current + 1
    generationRef.current = generation
    controllerRef.current = controller
    setBusySourceId('market')
    setMarketProgress(t('marketStarting'))
    current.setError('')
    current.setNotice('')
    try {
      const profile = await current.saveProfile(false)
      if (!profile || controller.signal.aborted || generationRef.current !== generation) return
      let discoveredBossJobs = 0
      if (current.browserAgentAvailable) {
        const jobsByExternalId = new Map<string, BrowserBossJob>()
        for (const title of profile.titles.slice(0, 3)) {
          const searchResult = await searchBossBrowserJobs({ window, query: title, timeoutMs: 15_000 })
          for (const job of searchResult.jobs ?? []) jobsByExternalId.set(job.externalId, job)
          if (controller.signal.aborted || generationRef.current !== generation) return
        }
        if (jobsByExternalId.size === 0) {
          const existingResult = await collectBossBrowserJobs({ window, timeoutMs: 3_000 })
          for (const job of existingResult.jobs ?? []) jobsByExternalId.set(job.externalId, job)
        }
        if (jobsByExternalId.size > 0) {
          discoveredBossJobs = (await upsertBossBrowserJobs({
            store: current.store,
            jobs: [...jobsByExternalId.values()].slice(0, 100),
            now: new Date().toISOString()
          })).length
        }
      }
      const result = await refreshSelectedJobMarket({
        platforms: current.selectedPlatforms,
        existingSources: current.sources,
        store: current.store,
        createAdapter: current.createAdapter ?? createSameOriginJobSourceAdapter,
        signal: controller.signal,
        onProgress(completed, total, source) {
          if (generationRef.current === generation) {
            setMarketProgress(t('marketProgress', { completed, total, source: source.label }))
          }
        }
      })
      if (generationRef.current !== generation) return
      await scoreCurrentJobPostings({ store: current.store, profile, sourceDraftId: activeDraft.id })
      const queueResult = await queueBossCandidates({
        store: current.store,
        sourceDraftId: activeDraft.id,
        minimumScore: current.preferences.minimumMatchScore,
        maximumCandidates: current.preferences.dailyContactLimit,
        now: new Date().toISOString()
      })
      const analysisResult = await analyzeBossCandidateQueue({
        store: current.store,
        sourceDraftId: activeDraft.id,
        maximumCandidates: 10,
        signal: controller.signal,
        now: () => new Date().toISOString(),
        runAnalysis: (posting, signal) => requestBossCandidateAnalysis({
          posting,
          resume: activeDraft.data,
          locale: localeRef.current === 'zh' ? 'zh' : 'en',
          signal
        })
      })
      if (options.managed || current.preferences.autonomy === 'autopilot') {
        await prepareBossCandidateResumeVariants({
          store: current.store,
          sourceDraftId: activeDraft.id,
          resume: activeDraft.data,
          maximumCandidates: 50,
          now: () => new Date().toISOString()
        })
      }
      const totals = result.summaries.reduce((summary, source) => ({
        added: summary.added + source.newCount,
        updated: summary.updated + source.updatedCount,
        closed: summary.closed + source.closedCount,
        warnings: summary.warnings + source.warningCount
      }), { added: 0, updated: 0, closed: 0, warnings: 0 })
      current.setNotice(analysisResult.prepared.length > 0
        ? t('jobAgent.preparedCandidates', { count: analysisResult.prepared.length })
        : queueResult.queued.length > 0
          ? t('jobAgent.queuedCandidates', { count: queueResult.queued.length })
          : discoveredBossJobs > 0
            ? t('jobAgent.discoveredCandidates', { count: discoveredBossJobs })
            : result.sourceCount === 0
              ? t('marketManualOnly')
              : t('marketComplete', {
                  sources: result.sourceCount,
                  added: totals.added,
                  updated: totals.updated,
                  failures: result.failures.length,
                  skipped: result.skippedCount
                }))
      await current.reload()
    } catch (caught) {
      if (generationRef.current !== generation) return
      if (controller.signal.aborted || (caught instanceof DOMException && caught.name === 'AbortError')) {
        current.setNotice(t('refreshCancelled'))
      } else {
        current.setError(t('errors.refresh'))
      }
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setBusySourceId('')
        setMarketProgress('')
      }
    }
  }, [])

  const refreshSource = useCallback(async (source: JobSource) => {
    const current = inputRef.current
    const t = translationsRef.current
    if (source.kind === 'manual' || !current.activeDraft || !current.trustedDraft) {
      current.setError(!current.trustedDraft ? t('errors.resumeRequired') : t('errors.invalidSource'))
      return
    }
    controllerRef.current?.abort()
    const controller = new AbortController()
    const generation = generationRef.current + 1
    generationRef.current = generation
    controllerRef.current = controller
    setBusySourceId(source.id)
    current.setError('')
    try {
      const summary = await refreshJobSource({
        source,
        adapter: (current.createAdapter ?? createSameOriginJobSourceAdapter)(source.kind),
        store: current.store,
        signal: controller.signal
      })
      if (generationRef.current !== generation) return
      const profile = current.profiles[0]
      if (profile) {
        await scoreCurrentJobPostings({
          store: current.store,
          profile,
          sourceDraftId: current.activeDraft.id
        })
      }
      current.setNotice(t(summary.completeness === 'partial' || summary.warningCount > 0
        ? 'refreshPartial'
        : 'refreshComplete', {
        added: summary.newCount,
        updated: summary.updatedCount,
        closed: summary.closedCount,
        warnings: summary.warningCount
      }))
      await current.reload()
    } catch (error) {
      if (generationRef.current !== generation) return
      if (controller.signal.aborted) current.setNotice(t('refreshCancelled'))
      else current.setError(error instanceof JobSourceError
        ? t(`errors.${error.code}`)
        : t('errors.refresh'))
    } finally {
      if (controllerRef.current === controller) {
        controllerRef.current = null
        setBusySourceId('')
      }
    }
  }, [])

  const decide = useCallback(async (recommendation: JobRecommendation, decision: 'saved' | 'ignored') => {
    const current = inputRef.current
    const now = new Date().toISOString()
    await current.store.put('jobRecommendations', { ...recommendation, decision, updatedAt: now })
    if (decision === 'saved' && current.activeDraft) {
      const id = createStableJobDomainId('application', [recommendation.postingId, current.activeDraft.id])
      const existing = current.applications.find((application) => application.id === id)
      await current.store.put('applicationRecords', existing ?? {
        id,
        postingId: recommendation.postingId,
        sourceDraftId: current.activeDraft.id,
        status: 'saved',
        notes: '',
        createdAt: now,
        updatedAt: now
      })
    }
    await current.reload()
  }, [])

  const analyzePosting = useCallback(async (posting: JobPosting, recommendation: JobRecommendation) => {
    const current = inputRef.current
    const t = translationsRef.current
    if (!current.activeDraft || !current.trustedDraft) {
      current.setError(t('errors.resumeRequired'))
      return
    }
    try {
      let promotionPosting = posting
      let promotionRecommendation = recommendation
      if (posting.sourceId === 'job-source-boss-browser') {
        const response = await collectBossJobDetail({ window, url: posting.canonicalUrl, timeoutMs: 15_000 })
        const detail = response.jobDetail
        if (!response.ok || !detail || detail.externalId !== posting.externalId) {
          current.setError(t('errors.jobDetail'))
          return
        }
        const now = new Date().toISOString()
        promotionPosting = {
          ...posting,
          description: detail.description,
          canonicalUrl: detail.url,
          applyUrl: detail.url,
          lastCheckedAt: now,
          detailFetchedAt: now,
          contentHash: createJobInputFingerprint({
            title: posting.title,
            company: posting.company,
            description: detail.description,
            location: posting.location,
            compensation: posting.compensation
          })
        }
        const profile = current.profiles[0]
        if (!profile) {
          current.setError(t('errors.invalidProfile'))
          return
        }
        const evidenceSourceId = careerEvidenceSourceId(current.activeDraft.id)
        const facts = (await current.store.list('careerFacts'))
          .filter((fact) => fact.evidenceRefs.includes(evidenceSourceId))
        promotionRecommendation = {
          ...scoreJobRecommendation({
            posting: promotionPosting,
            profile,
            sourceDraftId: current.activeDraft.id,
            facts,
            now
          }),
          decision: recommendation.decision,
          createdAt: recommendation.createdAt
        }
        await current.store.transaction(['jobPostings', 'jobRecommendations'], 'readwrite', async (transaction) => {
          await transaction.put('jobPostings', promotionPosting)
          await transaction.put('jobRecommendations', promotionRecommendation)
        })
      }
      saveJobPromotionIntent(createJobPromotionIntent({
        posting: promotionPosting,
        recommendation: promotionRecommendation,
        sourceDraftId: current.activeDraft.id
      }))
      await decide(promotionRecommendation, 'saved')
      current.navigate('/jobs/target-job')
    } catch {
      current.setError(t('errors.promotion'))
    }
  }, [decide])

  const importAndAnalyze = useCallback(async () => {
    const current = inputRef.current
    const t = translationsRef.current
    if (!current.activeDraft || !current.trustedDraft) {
      current.setError(t('errors.resumeRequired'))
      return
    }
    current.setError('')
    current.setNotice('')
    try {
      const profile = await current.saveProfile(false)
      if (!profile) return
      const evidenceSourceId = careerEvidenceSourceId(current.activeDraft.id)
      const facts = (await current.store.list('careerFacts'))
        .filter((fact) => fact.evidenceRefs.includes(evidenceSourceId))
      const imported = await importMarketplaceJob({
        store: current.store,
        platform: importPlatform,
        url: importUrl,
        title: importTitle,
        company: importCompany,
        description: importDescription,
        location: importLocation,
        locale: localeRef.current === 'zh' ? 'zh' : 'en',
        profile,
        sourceDraftId: current.activeDraft.id,
        facts
      })
      saveJobPromotionIntent(createJobPromotionIntent({
        posting: imported.posting,
        recommendation: imported.recommendation,
        sourceDraftId: current.activeDraft.id
      }))
      setImportUrl('')
      setImportTitle('')
      setImportCompany('')
      setImportLocation('')
      setImportDescription('')
      current.navigate('/jobs/target-job')
    } catch {
      current.setError(t('errors.importJob'))
    }
  }, [importCompany, importDescription, importLocation, importPlatform, importTitle, importUrl])

  const prefillFromClipboard = useCallback(() => {
    const current = inputRef.current
    const t = translationsRef.current
    current.setError('')
    current.setNotice('')
    try {
      const parsed = parseJobClipboardText(clipboardJobText)
      if (parsed.platform && PRIMARY_JOB_MARKETPLACE_IDS.includes(parsed.platform as typeof PRIMARY_JOB_MARKETPLACE_IDS[number])) {
        setImportPlatform(parsed.platform)
      }
      if (parsed.url) setImportUrl(parsed.url)
      if (parsed.title) setImportTitle(parsed.title)
      if (parsed.company) setImportCompany(parsed.company)
      if (parsed.location) setImportLocation(parsed.location)
      if (parsed.description) setImportDescription(parsed.description)
      current.setNotice(t('clipboardParsed'))
    } catch {
      current.setError(t('errors.clipboardJob'))
    }
  }, [clipboardJobText])

  const prepareManagedVariants = useCallback(async () => {
    const current = inputRef.current
    if (!current.activeDraft || !current.trustedDraft || current.preferences.autonomy !== 'autopilot') return
    await prepareBossCandidateResumeVariants({
      store: current.store,
      sourceDraftId: current.activeDraft.id,
      resume: current.activeDraft.data,
      maximumCandidates: 50,
      now: () => new Date().toISOString()
    })
    await current.reload()
  }, [])

  const recommendationByPosting = useMemo(
    () => new Map(input.recommendations.map((item) => [item.postingId, item])),
    [input.recommendations]
  )
  const applicationByPosting = useMemo(
    () => new Map(input.applications.map((item) => [item.postingId, item])),
    [input.applications]
  )
  const visible = useMemo(() => input.postings.filter((posting) => {
    const decision = recommendationByPosting.get(posting.id)?.decision ?? 'new'
    const application = applicationByPosting.get(posting.id)
    if (filter === 'closed') return posting.status === 'closed'
    if (posting.status === 'closed') return filter === 'all'
    if (filter === 'needs-analysis') return Boolean(application && ['saved', 'analyzing', 'preparing'].includes(application.status))
    if (filter === 'ready') return application?.status === 'ready-to-apply'
    if (filter === 'applied') return Boolean(application && ['applied', 'interviewing', 'offered', 'rejected', 'withdrawn', 'archived'].includes(application.status))
    return filter === 'all' || decision === filter
  }).sort((left, right) => {
    const leftScore = recommendationByPosting.get(left.id)?.preliminaryScore ?? -1
    const rightScore = recommendationByPosting.get(right.id)?.preliminaryScore ?? -1
    return rightScore - leftScore || right.lastCheckedAt.localeCompare(left.lastCheckedAt)
  }), [applicationByPosting, filter, input.postings, recommendationByPosting])
  const selectedPosting = visible.find((posting) => posting.id === selectedPostingId) ?? visible[0] ?? null
  const selectedRecommendation = selectedPosting ? recommendationByPosting.get(selectedPosting.id) : undefined
  const officialSearchPlatforms = input.selectedPlatforms.filter((platform): platform is Extract<JobMarketplaceId, 'boss' | '51job' | 'lagou' | 'liepin' | '58'> => (
    platform === 'boss' || platform === '51job' || platform === 'lagou' || platform === 'liepin' || platform === '58'
  ))

  return {
    busySourceId, marketProgress, cancel, searchMarket, refreshSource, decide, analyzePosting, prepareManagedVariants,
    filter, setFilter, selectedPostingId, setSelectedPostingId, visible,
    recommendationByPosting, applicationByPosting,
    selectedPosting, selectedRecommendation, officialSearchPlatforms,
    primaryTitle: splitJobSearchTerms(input.titles)[0],
    importPlatform, setImportPlatform,
    clipboardJobText, setClipboardJobText,
    importUrl, setImportUrl, importTitle, setImportTitle,
    importCompany, setImportCompany, importLocation, setImportLocation,
    importDescription, setImportDescription,
    prefillFromClipboard, importAndAnalyze
  }
}
