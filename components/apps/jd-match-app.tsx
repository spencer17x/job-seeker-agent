'use client'

import {
  BriefcaseBusiness,
  CircleStop,
  ScanSearch,
  Settings2,
  TriangleAlert
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useRef, useState } from 'react'
import { useResumeDraft } from '@/components/resume-draft-provider'
import {
  reviseRequirementMatrix,
  type RequirementRevision
} from '@/lib/agent/agent-workflow'
import { aiFetch } from '@/lib/agent/browser-config'
import { createDomainStore } from '@/lib/agent/domain-store'
import {
  buildJDRequirementAnalysis,
  JD_MATCH_REPORT_JSON_SCHEMA,
  jdMatchReportSchema,
  jdRequirementAnalysisSchema,
  type JDMatchReport,
  type JDRequirementAnalysis
} from '@/lib/agent/jd-report'
import { buildJDMatchPrompt } from '@/lib/agent/prompt'
import { readAiProviderPreference } from '@/lib/agent/provider-preference'
import { scoreRequirementMatrix } from '@/lib/agent/requirement-matrix'
import { scoreResumeStructure } from '@/lib/agent/resume-structure-score'
import {
  ACTIVE_WORKFLOW_CHANGED_EVENT,
  fingerprintWorkflowContext,
  loadActiveWorkflowSummary,
  persistAnalysisAsOptimizationRun,
  persistRequirementRevision,
  persistRunInputChange,
  saveActiveWorkflowPreference
} from '@/lib/agent/workflow-persistence'
import type {
  ActiveWorkflowPreference,
  ActiveWorkflowSummary
} from '@/lib/agent/workflow-persistence'
import type { AppId } from '@/lib/desktop/types'
import {
  clearJobPromotionIntent,
  completeJobPromotion,
  loadBrowserJobPromotion,
  type JobPromotionIntent
} from '@/lib/jobs/job-promotion'
import { loadBossCandidateAnalysis } from '@/lib/jobs/boss-agent'
import { createStableJobDomainId, type JobPosting } from '@/lib/jobs/job-domain'
import { createResumeId, type ResumeData } from '@/lib/resume-model'
import {
  ChromeBuiltInAiError,
  ChromeBuiltInAiProvider,
  ProviderRoutingError,
  localLanguagePolicyForLocale,
  runPreferredProviderTask,
  type StructuredTaskInput
} from '@/lib/agent/providers'

type ReportState = {
  sections: JDMatchReport
  analysis?: JDRequirementAnalysis
  provider: string
  model: string
  context: string
  workflowPreference?: ActiveWorkflowPreference
  queuedRunId?: string
}

type ProviderMatchResult = {
  sections: JDMatchReport
  analysis?: JDRequirementAnalysis
}

export type JDMatchWorkflowPersistence = (input: {
  analysis: JDRequirementAnalysis
  sourceDraftId: string
  locale: 'zh' | 'en'
  now: string
  runId?: string
}) => Promise<{ targetJobId: string; optimizationRunId: string }>

export type JDMatchRequirementPersistence = (input: {
  preference: ActiveWorkflowPreference
  analysis: JDRequirementAnalysis
  requirementId: string
  now: string
}) => Promise<void>

export type JDMatchStalePersistence = (input: {
  preference: ActiveWorkflowPreference
  currentFingerprint: string
  now: string
}) => Promise<void>

export type JDMatchWorkflowSummaryLoader = () => Promise<ActiveWorkflowSummary | null>
export type JDMatchPromotionLoader = (activeDraft: { id: string; source: string; data: ResumeData }) => Promise<{
  intent: JobPromotionIntent
  posting: JobPosting
  closed: boolean
  analysis?: JDRequirementAnalysis
  optimizationRunId?: string
} | null>
export type JDMatchPromotionCompletion = (input: {
  intent: JobPromotionIntent
  targetJobId: string
  now: string
}) => Promise<void>

export function JDMatchApp({
  workflowPersistence = persistWorkflow,
  requirementPersistence = persistRequirementCorrection,
  stalePersistence = persistStaleWorkflow,
  workflowSummaryLoader = loadActiveWorkflowSummary,
  promotionLoader = loadPromotion,
  promotionCompletion = persistPromotionCompletion
}: {
  appId?: AppId
  workflowPersistence?: JDMatchWorkflowPersistence
  requirementPersistence?: JDMatchRequirementPersistence
  stalePersistence?: JDMatchStalePersistence
  workflowSummaryLoader?: JDMatchWorkflowSummaryLoader
  promotionLoader?: JDMatchPromotionLoader
  promotionCompletion?: JDMatchPromotionCompletion
} = {}) {
  const locale = useLocale() as 'zh' | 'en'
  const t = useTranslations('jdMatch')
  const { activeDraft } = useResumeDraft()
  const [jd, setJd] = useState('')
  const [reportState, setReportState] = useState<ReportState | null>(null)
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  const [cooldown, setCooldown] = useState(0)
  const [persistenceMessage, setPersistenceMessage] = useState('')
  const [correctingRequirementId, setCorrectingRequirementId] = useState('')
  const [workflowSaving, setWorkflowSaving] = useState(false)
  const [promotion, setPromotion] = useState<{ intent: JobPromotionIntent; posting: JobPosting; closed: boolean } | null>(null)
  const stalePersistenceRef = useRef('')
  const promotionLoadRef = useRef(0)
  const workflowRefreshSequenceRef = useRef(0)
  const requestRef = useRef<{ id: number; controller: AbortController; context: string } | null>(null)
  const activeRef = useRef(activeDraft)
  const inputContext = matchContext(jd, activeDraft)
  const reportIsStale = Boolean(reportState && reportState.context !== inputContext)
  const visibleReport = reportIsStale ? null : reportState?.sections ?? null
  const visibleAnalysis = reportIsStale ? null : reportState?.analysis ?? null
  const visibleExecution = reportIsStale || !reportState
    ? null
    : { provider: reportState.provider, model: reportState.model }
  const visibleError = reportIsStale ? t('stale') : error
  const status = pending ? t('analyzing') : visibleError ? '' : visibleReport ? t('complete') : ''
  const sandboxDraft = ['sample', 'ai-generated', 'ai-chat'].includes(activeDraft?.source ?? '')

  useEffect(() => () => requestRef.current?.controller.abort(), [])
  useEffect(() => { activeRef.current = activeDraft }, [activeDraft])
  useEffect(() => {
    const request = requestRef.current
    if (request && request.context !== inputContext) request.controller.abort()
  }, [inputContext])
  useEffect(() => {
    if (cooldown <= 0) return
    const timer = window.setTimeout(() => setCooldown((value) => Math.max(0, value - 1)), 1_000)
    return () => window.clearTimeout(timer)
  }, [cooldown])
  useEffect(() => {
    const preference = reportState?.workflowPreference
    if (!reportIsStale || !preference) return
    const marker = `${preference.optimizationRunId}:${inputContext}`
    if (stalePersistenceRef.current === marker) return
    stalePersistenceRef.current = marker
    void stalePersistence({
      preference,
      currentFingerprint: fingerprintWorkflowContext(inputContext),
      now: new Date().toISOString()
    }).then(() => saveActiveWorkflowPreference(preference)).catch(() => undefined)
  }, [inputContext, reportIsStale, reportState?.workflowPreference, stalePersistence])
  useEffect(() => {
    const preference = reportState?.workflowPreference
    if (!preference || reportIsStale) return
    let active = true
    const refresh = () => {
      const sequence = ++workflowRefreshSequenceRef.current
      void workflowSummaryLoader().then((summary) => {
        if (!active || sequence !== workflowRefreshSequenceRef.current || !summary) return
        if (
          summary.preference.targetJobId !== preference.targetJobId
          || summary.preference.optimizationRunId !== preference.optimizationRunId
          || summary.run.id !== preference.optimizationRunId
          || summary.run.targetJobId !== preference.targetJobId
        ) return
        setReportState((current) => {
          const draft = activeRef.current
          if (
            !current?.analysis
            || current.context !== inputContext
            || current.workflowPreference?.targetJobId !== preference.targetJobId
            || current.workflowPreference.optimizationRunId !== preference.optimizationRunId
            || current.analysis.targetJob.id !== summary.targetJob.id
            || summary.run.sourceDraftId !== draft?.id
          ) return current
          const matrix = {
            ...current.analysis.matrix,
            matches: summary.run.requirementMatches
          }
          const analysis = jdRequirementAnalysisSchema.safeParse({
            ...current.analysis,
            matrix,
            score: scoreRequirementMatrix(matrix)
          })
          return analysis.success ? { ...current, analysis: analysis.data } : current
        })
      }).catch(() => undefined)
    }
    window.addEventListener(ACTIVE_WORKFLOW_CHANGED_EVENT, refresh)
    return () => {
      active = false
      window.removeEventListener(ACTIVE_WORKFLOW_CHANGED_EVENT, refresh)
    }
  }, [
    inputContext,
    reportIsStale,
    reportState?.workflowPreference,
    workflowSummaryLoader
  ])
  useEffect(() => {
    if (!activeDraft) return
    const sequence = ++promotionLoadRef.current
    let active = true
    void promotionLoader(activeDraft).then((value) => {
      if (!active || sequence !== promotionLoadRef.current || !value) return
      setPromotion(value)
      setJd(value.posting.description)
      if (value.analysis) {
        setReportState({
          sections: {
            jobTitle: value.analysis.targetJob.title,
            company: value.analysis.targetJob.company ?? value.posting.company,
            requirements: value.analysis.matrix.requirements.map((requirement) => ({
              text: requirement.text,
              category: requirement.category,
              priority: requirement.priority,
              weight: requirement.weight,
              keywords: requirement.keywords
            })),
            resumeEmphasis: [],
            interviewPrep: []
          },
          analysis: value.analysis,
          provider: 'BOSS Job Agent',
          model: 'queued-analysis',
          context: matchContext(value.posting.description, activeDraft),
          queuedRunId: value.optimizationRunId
        })
      }
      setPersistenceMessage(value.closed ? t('promotionClosed') : t('promotionLoaded', {
        title: value.posting.title,
        company: value.posting.company
      }))
    }).catch(() => {
      if (active && sequence === promotionLoadRef.current) setError(t('promotionInvalid'))
    })
    return () => { active = false }
  }, [activeDraft, promotionLoader, t])

  if (!activeDraft) {
    return (
      <div className="resume-app-empty-state">
        <BriefcaseBusiness size={24} /><h2>{t('createFirst')}</h2><p>{t('createFirstDescription')}</p>
        <a href={`/${locale}/jobs/profile`}>{t('openStudio')}</a>
      </div>
    )
  }

  async function analyze() {
    const draft = activeRef.current
    if (!draft || !jd.trim() || pending || cooldown > 0) {
      if (!jd.trim()) setError(t('required'))
      return
    }
    requestRef.current?.controller.abort()
    const controller = new AbortController()
    const id = (requestRef.current?.id ?? 0) + 1
    const context = matchContext(jd, draft)
    requestRef.current = { id, controller, context }
    const fingerprint = JSON.stringify(draft.data)
    setPending(true)
    setDownloadProgress(null)
    setError('')
    setPersistenceMessage('')

    try {
      const jobDescription = jd.trim()
      const prompt = buildJDMatchPrompt(jobDescription, locale)
      const taskInput: StructuredTaskInput<ProviderMatchResult> = {
        task: {
          kind: 'extract-job-requirements',
          expectedInputLanguages: [locale],
          expectedOutputLanguages: [locale],
          localLanguagePolicy: localLanguagePolicyForLocale(locale)
        },
        system: prompt.system,
        prompt: prompt.user,
        jsonSchema: JD_MATCH_REPORT_JSON_SCHEMA,
        validate(value) {
          const parsed = jdMatchReportSchema.safeParse(value)
          if (!parsed.success) throw new MatchError('AI_OUTPUT_INVALID')
          return {
            sections: parsed.data,
            analysis: buildJDRequirementAnalysis({
              report: parsed.data,
              jobDescription,
              locale,
              resume: draft.data,
              targetIdentity: promotion?.posting.id
            })
          }
        },
        signal: controller.signal,
        onDownloadProgress(progress) {
          if (requestRef.current?.id === id) setDownloadProgress(progress)
        }
      }
      const result = await runPreferredProviderTask({
        preference: readAiProviderPreference(),
        localProvider: new ChromeBuiltInAiProvider(),
        input: taskInput,
        runCloudTask: async () => requestCloudAnalysis({
          jobDescription,
          locale,
          resume: draft.data,
          targetIdentity: promotion?.posting.id,
          signal: controller.signal,
          onCooldown: setCooldown
        })
      })
      if (requestRef.current?.id !== id) return
      const current = activeRef.current
      if (!current || current.id !== draft.id || JSON.stringify(current.data) !== fingerprint) {
        setError(t('stale'))
        return
      }
      setReportState({
        sections: result.value.sections,
        analysis: result.value.analysis,
        provider: result.provider,
        model: result.model,
        context
      })
    } catch (caught) {
      if (controller.signal.aborted || requestRef.current?.id !== id) return
      setError(matchError(caught, t))
    } finally {
      if (requestRef.current?.id === id) {
        setPending(false)
        setDownloadProgress(null)
      }
    }
  }

  function cancelAnalysis() {
    requestRef.current?.controller.abort()
  }

  async function saveRequirementCorrection(
    requirementId: string,
    revision: RequirementRevision
  ) {
    const current = reportState
    if (!current?.analysis || reportIsStale) return
    setCorrectingRequirementId(requirementId)
    try {
      const matrix = reviseRequirementMatrix(current.analysis.matrix, requirementId, revision)
      const analysis = jdRequirementAnalysisSchema.parse({
        ...current.analysis,
        matrix,
        score: scoreRequirementMatrix(matrix)
      })
      if (current.workflowPreference) {
        await requirementPersistence({
          preference: current.workflowPreference,
          analysis,
          requirementId,
          now: new Date().toISOString()
        })
      }
      setReportState({ ...current, analysis })
      setPersistenceMessage(current.workflowPreference
        ? t('requirementSaved')
        : t('requirementConfirmedLocally'))
      if (current.workflowPreference) saveActiveWorkflowPreference(current.workflowPreference)
    } catch {
      setPersistenceMessage(t('requirementSaveFailed'))
    } finally {
      setCorrectingRequirementId('')
    }
  }

  async function createConfirmedWorkflow() {
    const current = reportState
    const draft = activeRef.current
    if (!current?.analysis || current.workflowPreference || reportIsStale || !draft) return

    const matrix = current.analysis.matrix
    if (matrix.requirements.some((requirement) => !requirement.userConfirmed)) return

    const analysis = jdRequirementAnalysisSchema.parse({
      ...current.analysis,
      matrix,
      score: scoreRequirementMatrix(matrix)
    })
    const context = current.context
    setWorkflowSaving(true)
    setPersistenceMessage('')
    try {
      const preference = await workflowPersistence({
        analysis,
        sourceDraftId: draft.id,
        locale,
        now: new Date().toISOString(),
        runId: current.queuedRunId
      })
      const latest = activeRef.current
      if (!latest || latest.id !== draft.id || matchContext(jd, latest) !== context) {
        setError(t('stale'))
        return
      }
      saveActiveWorkflowPreference(preference)
      setReportState({ ...current, analysis, workflowPreference: preference })
      if (promotion) {
        try {
          await promotionCompletion({
            intent: promotion.intent,
            targetJobId: preference.targetJobId,
            now: new Date().toISOString()
          })
          clearJobPromotionIntent()
          setPromotion(null)
          setPersistenceMessage(t('savedPromotedWorkflow'))
        } catch {
          setPersistenceMessage(t('promotionLinkFailed'))
        }
      } else {
        setPersistenceMessage(t('savedWorkflow'))
      }
    } catch {
      setPersistenceMessage(t('localSaveFailed'))
    } finally {
      setWorkflowSaving(false)
    }
  }

  async function retryPromotionLink() {
    const preference = reportState?.workflowPreference
    if (!promotion || !preference || workflowSaving) return
    setWorkflowSaving(true)
    setPersistenceMessage('')
    try {
      await promotionCompletion({
        intent: promotion.intent,
        targetJobId: preference.targetJobId,
        now: new Date().toISOString()
      })
      clearJobPromotionIntent()
      setPromotion(null)
      setPersistenceMessage(t('savedPromotedWorkflow'))
    } catch {
      setPersistenceMessage(t('promotionLinkFailed'))
    } finally {
      setWorkflowSaving(false)
    }
  }

  const labels = t.raw('sections') as string[]
  const guidance = visibleReport ? [
    { title: labels[4], content: visibleReport.resumeEmphasis },
    { title: labels[5], content: visibleReport.interviewPrep }
  ] : []

  return (
    <main className="jd-match-app">
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      <section className="jd-match-app__input" aria-labelledby="jd-match-title">
        <header className="resume-app-heading">
          <span><BriefcaseBusiness size={15} />{t('draft')}</span>
          <h2 id="jd-match-title">{activeDraft.name}</h2>
          <p>{activeDraft.data.profile.name} · {activeDraft.data.targetRole || activeDraft.data.profile.title}</p>
        </header>
        {sandboxDraft ? (
          <aside className="resume-app-sandbox-warning" role="note">
            <TriangleAlert size={15} aria-hidden="true" />
            <div>
              <strong>{t('sandboxWarningTitle')}</strong>
              <p>{t('sandboxWarningDescription')}</p>
              <a href={`/${locale}/jobs/profile`}>{t('sandboxWarningAction')}</a>
            </div>
          </aside>
        ) : null}
        {promotion ? <aside className="resume-app-sandbox-warning" role="note">
          <BriefcaseBusiness size={15} aria-hidden="true" />
          <div>
            <strong>{t('promotionTitle')}</strong>
            <p>{promotion.closed
              ? t('promotionClosed')
              : t('promotionLoaded', { title: promotion.posting.title, company: promotion.posting.company })}</p>
            {reportState?.workflowPreference ? <button type="button" disabled={workflowSaving} onClick={() => void retryPromotionLink()}>{t('promotionRetry')}</button> : null}
          </div>
        </aside> : null}
        <label htmlFor="jd-match-input">{t('jobDescription')}</label>
        <textarea
          id="jd-match-input"
          value={jd}
          onChange={(event) => { setJd(event.target.value); setError('') }}
          placeholder={t('jobPlaceholder')}
        />
        <button
          className="resume-app-primary"
          onClick={() => pending ? cancelAnalysis() : void analyze()}
          disabled={!pending && cooldown > 0}
        >
          {pending ? <CircleStop size={15} /> : <ScanSearch size={15} />}
          {pending ? t('cancelAnalysis') : t('analyze')}
        </button>
        {downloadProgress !== null ? <div className="resume-app-download" role="status">
          <span>{t('localModelDownload', { percentage: Math.round(downloadProgress * 100) })}</span>
          <progress aria-label={t('localModelDownloadLabel')} value={downloadProgress} max={1} />
          <a href={`/${locale}/settings`}><Settings2 size={13} aria-hidden="true" />{t('openSettings')}</a>
        </div> : null}
        {visibleError ? (
          <div className="resume-app-error-block">
            <p className="resume-app-error" role="alert">{visibleError}</p>
            <a href={`/${locale}/settings`}><Settings2 size={13} aria-hidden="true" />{t('openSettings')}</a>
          </div>
        ) : null}
      </section>
      <section className="jd-match-app__report" aria-label={t('report')} aria-busy={pending}>
        <div className="resume-app-section-title">
          <h2>{t('report')}</h2>
          {visibleExecution ? <span>{t('providerUsed', visibleExecution)}</span> : null}
        </div>
        {visibleReport && persistenceMessage ? (
          <p className="jd-match-app__persistence" data-warning={
            persistenceMessage === t('localSaveFailed')
            || persistenceMessage === t('requirementSaveFailed')
          }>
            {persistenceMessage}
          </p>
        ) : null}
        {!visibleReport ? <p className="resume-app-empty">{t('emptyReport')}</p> : (
          <>
            {visibleAnalysis && <RequirementAssessment
              analysis={visibleAnalysis}
              workflowSaved={Boolean(reportState?.workflowPreference)}
              workflowSaving={workflowSaving}
              correctingRequirementId={correctingRequirementId}
              onRevise={saveRequirementCorrection}
              onCreateWorkflow={createConfirmedWorkflow}
            />}
            <div className="jd-match-app__sections">
              {guidance.map(({ title, content }) => (
                <article key={title}><h3>{title}</h3>{renderContent(content)}</article>
              ))}
            </div>
          </>
        )}
      </section>
    </main>
  )
}

async function persistWorkflow(input: Parameters<JDMatchWorkflowPersistence>[0]) {
  const store = createDomainStore()
  const optimizationRunId = input.runId ?? createResumeId('run')
  try {
    const result = await persistAnalysisAsOptimizationRun({
      store,
      analysis: input.analysis,
      sourceDraftId: input.sourceDraftId,
      runId: optimizationRunId,
      locale: input.locale,
      now: input.now
    })
    return {
      targetJobId: result.run.targetJobId,
      optimizationRunId: result.run.id
    }
  } finally {
    await store.close()
  }
}

async function loadPromotion(activeDraft: { id: string; source: string; data: ResumeData }) {
  const store = createDomainStore()
  try {
    const promotion = await loadBrowserJobPromotion({ activeDraft, store })
    if (!promotion) return null
    const applicationId = createStableJobDomainId('application', [promotion.posting.id, activeDraft.id])
    const queued = await loadBossCandidateAnalysis({ store, applicationId, resume: activeDraft.data })
    return {
      ...promotion,
      ...(queued ? { analysis: queued.analysis, optimizationRunId: queued.optimizationRunId } : {})
    }
  } finally {
    await store.close()
  }
}

async function persistPromotionCompletion(input: Parameters<JDMatchPromotionCompletion>[0]) {
  const store = createDomainStore()
  try {
    await completeJobPromotion({ store, ...input })
  } finally {
    await store.close()
  }
}

async function persistRequirementCorrection(
  input: Parameters<JDMatchRequirementPersistence>[0]
) {
  const store = createDomainStore()
  try {
    const requirement = input.analysis.matrix.requirements.find(
      (item) => item.id === input.requirementId
    )
    if (!requirement) throw new TypeError('The corrected requirement does not exist.')
    await persistRequirementRevision({
      store,
      optimizationRunId: input.preference.optimizationRunId,
      requirement,
      currentFingerprint: input.analysis.matrix.inputFingerprint,
      now: input.now
    })
  } finally {
    await store.close()
  }
}

async function persistStaleWorkflow(input: Parameters<JDMatchStalePersistence>[0]) {
  const store = createDomainStore()
  try {
    await persistRunInputChange({
      store,
      optimizationRunId: input.preference.optimizationRunId,
      currentFingerprint: input.currentFingerprint,
      now: input.now
    })
  } finally {
    await store.close()
  }
}

function RequirementAssessment({
  analysis,
  workflowSaved,
  workflowSaving,
  correctingRequirementId,
  onRevise,
  onCreateWorkflow
}: {
  analysis: JDRequirementAnalysis
  workflowSaved: boolean
  workflowSaving: boolean
  correctingRequirementId: string
  onRevise: (requirementId: string, revision: RequirementRevision) => Promise<void>
  onCreateWorkflow: () => Promise<void>
}) {
  const t = useTranslations('jdMatch.assessment')
  const locale = useLocale()
  const matches = new Map(analysis.matrix.matches.map((match) => [match.requirementId, match]))
  const confirmedCount = analysis.matrix.requirements.filter((requirement) => requirement.userConfirmed).length
  const unconfirmedCount = analysis.matrix.requirements.length - confirmedCount
  const evidenceReviewStarted = analysis.matrix.matches.some(
    (match) => match.factIds.length > 0 || match.status !== 'gap'
  )

  return (
    <section className="jd-match-app__analysis" aria-labelledby="jd-match-analysis-title">
      <header>
        <div>
          <h3 id="jd-match-analysis-title">{t('title')}</h3>
          <p>{t('description')}</p>
        </div>
        <span>{workflowSaved
          ? t('workflowSaved')
          : t('confirmationProgress', {
              confirmed: confirmedCount,
              total: analysis.matrix.requirements.length
            })}</span>
      </header>
      <p className="jd-match-app__evidence-policy">{t('evidencePolicy')}</p>
      {!workflowSaved ? <div className="jd-match-app__confirmation-gate" role="group" aria-label={t('confirmationGate')}>
        <div>
          <strong>{t('confirmationTitle')}</strong>
          <p>{t('confirmationDescription')}</p>
        </div>
        <button
          type="button"
          disabled={workflowSaving || unconfirmedCount > 0}
          onClick={() => void onCreateWorkflow()}
        >
          {workflowSaving
            ? t('savingWorkflow')
            : unconfirmedCount > 0
              ? t('reviewRemaining', { count: unconfirmedCount })
              : t('createWorkflow')}
        </button>
      </div> : null}
      <div className="jd-match-app__scores" aria-label={t('scoreSummary')}>
        <article>
          <span>{t('coverage')}</span>
          <strong>{evidenceReviewStarted
            ? formatPercentage(analysis.score.requirementCoverage, locale)
            : t('pendingEvidence')}</strong>
          <p>{t('coverageHelp')}</p>
        </article>
        <article>
          <span>{t('evidenceScore')}</span>
          <strong>{evidenceReviewStarted
            ? formatPercentage(analysis.score.evidenceCompleteness, locale)
            : t('pendingEvidence')}</strong>
          <p>{t('evidenceHelp')}</p>
        </article>
        <article>
          <span>{t('structureScore')}</span>
          <strong>{formatPercentage(analysis.structureScore.score, locale)}</strong>
          <p>{t('structureHelp')}</p>
        </article>
      </div>
      <div className="jd-match-app__rubrics">
        <span>{t('alignmentRubric', { value: analysis.score.rubricVersion })}</span>
        <span>{t('structureRubric', { value: analysis.structureScore.rubricVersion })}</span>
        <span>{t('inputFingerprint', { value: analysis.matrix.inputFingerprint })}</span>
      </div>
      <details className="jd-match-app__rules">
        <summary>{t('structureRules')}</summary>
        <ul>{analysis.structureScore.rules.map((rule) => (
          <li key={rule.id}>
            <strong>{t(`rules.${rule.id}`)}</strong>
            <span>{t('rulePoints', { points: rule.points, weight: rule.weight })}</span>
            <small>{rule.resumePaths.join(', ') || '—'}</small>
          </li>
        ))}</ul>
      </details>
      <div className="jd-match-app__requirement-list" role="list" aria-label={t('requirements')}>
        {analysis.matrix.requirements.map((requirement) => {
          const match = matches.get(requirement.id)
          const status = match?.status ?? 'gap'
          const factIds = match?.factIds ?? []
          return (
            <article key={requirement.id} role="listitem" data-status={status}>
              <header>
                <span>{t(`status.${status}`)}</span>
                <h4>{requirement.text}</h4>
              </header>
              <dl className="jd-match-app__requirement-meta">
                <div><dt>{t('category')}</dt><dd>{t(`categories.${requirement.category}`)}</dd></div>
                <div><dt>{t('priority')}</dt><dd>{t(`priorities.${requirement.priority}`)}</dd></div>
                <div><dt>{t('weight')}</dt><dd>{requirement.weight}</dd></div>
                <div><dt>{t('keywords')}</dt><dd>{requirement.keywords.join(', ') || t('noKeywords')}</dd></div>
              </dl>
              <p><b>{t('rationale')}</b>{match?.rationale ?? t('noAssessment')}</p>
              <p className="jd-match-app__evidence" data-missing={factIds.length === 0}>
                <b>{t('evidence')}</b>
                {factIds.length > 0
                  ? t('linkedEvidence', { count: factIds.length })
                  : t('missingEvidence')}
              </p>
              <RequirementCorrection
                key={`${requirement.id}:${analysis.matrix.inputFingerprint}`}
                requirement={requirement}
                pending={correctingRequirementId === requirement.id || workflowSaving}
                onSave={(revision) => onRevise(requirement.id, revision)}
              />
            </article>
          )
        })}
      </div>
    </section>
  )
}

function RequirementCorrection({
  requirement,
  pending,
  onSave
}: {
  requirement: JDRequirementAnalysis['matrix']['requirements'][number]
  pending: boolean
  onSave: (revision: RequirementRevision) => Promise<void>
}) {
  const t = useTranslations('jdMatch.assessment')
  const [text, setText] = useState(requirement.text)
  const [category, setCategory] = useState(requirement.category)
  const [priority, setPriority] = useState(requirement.priority)
  const [weight, setWeight] = useState(String(requirement.weight))
  const [keywords, setKeywords] = useState(requirement.keywords.join(', '))

  const parsedWeight = Number(weight)
  const parsedKeywords = [...new Set(keywords.split(',').map((value) => value.trim()).filter(Boolean))]
  const valid = text.trim().length > 0
    && Number.isFinite(parsedWeight)
    && parsedWeight > 0
    && parsedWeight <= 10
    && parsedKeywords.length <= 50
    && parsedKeywords.every((value) => value.length <= 120)

  return (
    <form className="jd-match-app__correction" onSubmit={(event) => {
      event.preventDefault()
      if (!valid || pending) return
      void onSave({
        text: text.trim(),
        category,
        priority,
        weight: parsedWeight,
        keywords: parsedKeywords,
        userConfirmed: true
      })
    }}>
      <label>
        <span>{t('requirementText')}</span>
        <input value={text} onChange={(event) => setText(event.target.value)} disabled={pending} />
      </label>
      <label>
        <span>{t('category')}</span>
        <select value={category} onChange={(event) => setCategory(event.target.value as typeof category)} disabled={pending}>
          {(['skill', 'experience', 'domain', 'education', 'responsibility'] as const).map((value) => (
            <option key={value} value={value}>{t(`categories.${value}`)}</option>
          ))}
        </select>
      </label>
      <label>
        <span>{t('priority')}</span>
        <select value={priority} onChange={(event) => setPriority(event.target.value as typeof priority)} disabled={pending}>
          {(['must', 'preferred', 'signal'] as const).map((value) => (
            <option key={value} value={value}>{t(`priorities.${value}`)}</option>
          ))}
        </select>
      </label>
      <label>
        <span>{t('weight')}</span>
        <input type="number" min="0.1" max="10" step="0.1" value={weight} onChange={(event) => setWeight(event.target.value)} disabled={pending} />
      </label>
      <label className="jd-match-app__keywords-field">
        <span>{t('keywords')}</span>
        <input value={keywords} onChange={(event) => setKeywords(event.target.value)} disabled={pending} placeholder={t('keywordsPlaceholder')} />
      </label>
      <button type="submit" disabled={!valid || pending}>
        {pending ? t('savingCorrection') : requirement.userConfirmed ? t('saveCorrection') : t('confirmRequirement')}
      </button>
    </form>
  )
}

function renderContent(content: string | string[] | undefined) {
  const values = Array.isArray(content) ? content : content ? [content] : []
  if (values.length === 0) return <p>—</p>
  return values.map((value, index) => <p key={`${index}-${value}`}>{value}</p>)
}

function formatPercentage(value: number, locale: string) {
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 2 }).format(value)}%`
}

function matchContext(jd: string, draft: ReturnType<typeof useResumeDraft>['activeDraft']) {
  return `${jd}\u0000${draft ? `${draft.id}:${JSON.stringify(draft.data)}` : 'none'}`
}

class MatchError extends Error {
  constructor(readonly code?: string, readonly retryAfter = 0) { super(code) }
}

async function requestCloudAnalysis(input: {
  jobDescription: string
  locale: 'zh' | 'en'
  resume: NonNullable<ReturnType<typeof useResumeDraft>['activeDraft']>['data']
  targetIdentity?: string
  signal: AbortSignal
  onCooldown: (seconds: number) => void
}) {
  const response = await aiFetch('/api/jd-match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jd: input.jobDescription,
      locale: input.locale,
      resume: input.resume,
      targetIdentity: input.targetIdentity
    }),
    signal: input.signal
  })
  const body = await response.json() as {
    sections?: unknown
    targetJob?: unknown
    matrix?: unknown
    score?: unknown
    structureScore?: unknown
    model?: unknown
    code?: string
  }
  if (!response.ok) {
    const seconds = readRetryAfter(response)
    if (seconds > 0) input.onCooldown(seconds)
    throw new MatchError(body.code, seconds)
  }

  const parsed = jdMatchReportSchema.safeParse(body.sections)
  if (!parsed.success) throw new MatchError('AI_OUTPUT_INVALID')
  const hasExtendedAnalysis = body.targetJob !== undefined
    || body.matrix !== undefined
    || body.score !== undefined
    || body.structureScore !== undefined
  let analysis: JDRequirementAnalysis | undefined
  if (hasExtendedAnalysis) {
    const parsedAnalysis = jdRequirementAnalysisSchema.safeParse({
      targetJob: body.targetJob,
      matrix: body.matrix,
      score: body.score,
      structureScore: body.structureScore
    })
    if (!parsedAnalysis.success) throw new MatchError('AI_OUTPUT_INVALID')
    const expectedAnalysis = buildJDRequirementAnalysis({
      report: parsed.data,
      jobDescription: input.jobDescription,
      locale: input.locale,
      resume: input.resume,
      targetIdentity: input.targetIdentity,
      timestamp: parsedAnalysis.data.targetJob.createdAt
    })
    const legacyAnalysis = input.targetIdentity ? buildJDRequirementAnalysis({
      report: parsed.data,
      jobDescription: input.jobDescription,
      locale: input.locale,
      resume: input.resume,
      timestamp: parsedAnalysis.data.targetJob.createdAt
    }) : expectedAnalysis
    const serverAnalysisMatches = [expectedAnalysis, legacyAnalysis].some((expected) => (
      JSON.stringify(parsedAnalysis.data.targetJob) === JSON.stringify(expected.targetJob)
      && JSON.stringify(parsedAnalysis.data.matrix) === JSON.stringify(expected.matrix)
      && JSON.stringify(parsedAnalysis.data.score) === JSON.stringify(expected.score)
    ))
    if (
      !serverAnalysisMatches
      || JSON.stringify(parsedAnalysis.data.structureScore) !== JSON.stringify(scoreResumeStructure(input.resume))
    ) {
      throw new MatchError('AI_OUTPUT_INVALID')
    }
    analysis = expectedAnalysis
  }

  return {
    value: { sections: parsed.data, analysis },
    provider: 'OpenAI-compatible',
    model: typeof body.model === 'string' && body.model.trim() ? body.model : 'configured-model'
  }
}

function matchError(error: unknown, t: ReturnType<typeof useTranslations<'jdMatch'>>) {
  if (error instanceof ProviderRoutingError) {
    return t('errors.CLOUD_FALLBACK_NOT_ALLOWED')
  }
  if (error instanceof ChromeBuiltInAiError) {
    const code = error.code === 'MODEL_UNAVAILABLE'
      ? 'LOCAL_MODEL_UNAVAILABLE'
      : error.code === 'INVALID_MODEL_OUTPUT'
        ? 'AI_OUTPUT_INVALID'
        : error.code
    return t(`errors.${code}` as 'errors.LOCAL_MODEL_UNAVAILABLE')
  }
  if (error instanceof MatchError) {
    if (error.code === 'RATE_LIMITED' && error.retryAfter > 0) return t('errors.RATE_LIMITED_RETRY', { seconds: error.retryAfter })
    if (error.code && ['RATE_LIMITED', 'PAYLOAD_TOO_LARGE', 'INVALID_REQUEST', 'AI_NOT_CONFIGURED', 'AI_UNAVAILABLE', 'AI_OUTPUT_INVALID', 'AI_OUTPUT_TOO_LARGE', 'REQUEST_ABORTED'].includes(error.code)) {
      return t(`errors.${error.code}` as 'errors.RATE_LIMITED')
    }
  }
  return t('errors.AI_UNAVAILABLE')
}

function readRetryAfter(response: Response) {
  const value = Number(response.headers.get('Retry-After'))
  return Number.isFinite(value) && value > 0 ? Math.min(Math.ceil(value), 300) : 0
}
