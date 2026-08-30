'use client'

import {
  ArrowRight,
  BriefcaseBusiness,
  FileCheck2,
  Radar,
  ScanSearch,
  Settings2,
  UserRoundCheck
} from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { useResumeDraft } from '@/components/resume-draft-provider'
import { isTrustedResumeSource } from '@/lib/resume-model'
import {
  ACTIVE_WORKFLOW_CHANGED_EVENT,
  loadActiveWorkflowSummary,
  type ActiveWorkflowSummary
} from '@/lib/agent/workflow-persistence'
import { useDesktop } from './desktop-provider'

export function WorkflowOverview({ compact = false, hud = false }: { compact?: boolean; hud?: boolean }) {
  const t = useTranslations('desktop.workflow')
  const { activeDraft } = useResumeDraft()
  const { openApp } = useDesktop()
  const hasProfile = isTrustedResumeSource(activeDraft?.source)
  const hasUnverifiedDraft = Boolean(activeDraft && !hasProfile)
  const workflow = useActiveWorkflowSummary()
  const hasTarget = Boolean(
    hasProfile
    && activeDraft
    && workflow
    && workflow.run.sourceDraftId === activeDraft.id
  )
  const hasVariant = Boolean(hasTarget && workflow?.run.stage === 'applied')
  const nextApp = !hasProfile ? 'studio' : !hasTarget ? 'jobs' : !hasVariant ? 'agent' : 'classic'
  const actionLabel = !hasProfile ? t('openProfile') : !hasTarget ? t('openJobs') : !hasVariant ? t('openAgent') : t('openReview')
  const nextLabel = !hasProfile
    ? hasUnverifiedDraft ? t('nextVerifiedProfile') : t('nextProfile')
    : !hasTarget ? t('nextJobs') : !hasVariant ? t('nextAgent') : t('nextReview')

  if (hud) {
    const hudStages = [
      { number: '01', title: t('profileTitle'), state: hasProfile ? 'ready' : 'next' },
      { number: '02', title: t('jobsTitle'), state: hasTarget ? 'ready' : hasProfile ? 'next' : 'locked' },
      { number: '03', title: t('targetTitle'), state: hasTarget ? 'ready' : 'locked' },
      { number: '04', title: t('agentTitle'), state: hasVariant ? 'ready' : hasTarget ? 'next' : 'locked' },
      { number: '05', title: t('reviewTitle'), state: hasVariant ? 'next' : 'locked' },
      { number: '06', title: t('settingsTitle'), state: 'ready' }
    ] as const
    const stageStateLabels = {
      ready: t('stageStateReady'),
      next: t('stageStateNext'),
      locked: t('stageStateLocked')
    } as const

    return (
      <section
        className={`desktop-workflow desktop-workflow--hud${compact ? ' desktop-workflow--compact' : ''}`}
        data-testid={compact ? 'workflow-overview-mobile' : 'workflow-overview'}
        data-ready-stages={hudStages.filter((stage) => stage.state === 'ready').length}
        aria-labelledby={`desktop-workflow-title-hud${compact ? '-compact' : ''}`}
      >
        <header className="desktop-workflow__heading">
          <span>{t('eyebrow')}</span>
          {compact
            ? <h2 id="desktop-workflow-title-hud-compact">{t('title')}</h2>
            : <h1 id="desktop-workflow-title-hud">{t('title')}</h1>}
          <p>{nextLabel}</p>
        </header>

        <ol className="desktop-workflow__hud-stages">
          {hudStages.map((stage) => (
            <li key={stage.number} data-state={stage.state} title={stage.title}>
              <i aria-hidden="true" />
              <span aria-hidden="true">{stage.number}</span>
              <span className="sr-only">
                {t('stageLabel', { number: stage.number, title: stage.title })} · {stageStateLabels[stage.state]}
              </span>
            </li>
          ))}
        </ol>

        <button type="button" className="desktop-workflow__hud-action" onClick={() => openApp(nextApp)}>
          <span>{actionLabel}</span><ArrowRight size={14} aria-hidden="true" />
        </button>
      </section>
    )
  }

  return (
    <section
      className={`desktop-workflow${compact ? ' desktop-workflow--compact' : ''}`}
      data-testid={compact ? 'workflow-overview-mobile' : 'workflow-overview'}
      aria-labelledby={`desktop-workflow-title${compact ? '-compact' : ''}`}
    >
      <header className="desktop-workflow__heading">
        <span>{t('eyebrow')}</span>
        {compact ? (
          <h2 id="desktop-workflow-title-compact">{t('title')}</h2>
        ) : (
          <h1 id="desktop-workflow-title">{t('title')}</h1>
        )}
        <p>{t('description')}</p>
      </header>

      <div className="desktop-workflow__stages">
        <article data-state={hasProfile ? 'ready' : 'next'}>
          <UserRoundCheck size={17} aria-hidden="true" />
          <span>01</span>
          <div>
            <h2 aria-label={t('stageLabel', { number: '01', title: t('profileTitle') })}>{t('profileTitle')}</h2>
            <p>{hasProfile
              ? t('profileReady', { name: activeDraft?.name ?? '' })
              : hasUnverifiedDraft
                ? t('profileUnverified')
                : t('profileMissing')}</p>
          </div>
        </article>
        <article data-state={hasTarget ? 'ready' : hasProfile ? 'next' : 'locked'}>
          <Radar size={17} aria-hidden="true" />
          <span>02</span>
          <div>
            <h2 aria-label={t('stageLabel', { number: '02', title: t('jobsTitle') })}>{t('jobsTitle')}</h2>
            <p>{hasTarget ? t('jobsReady') : t('jobsMissing')}</p>
          </div>
        </article>
        <article data-state={hasTarget ? 'ready' : 'locked'}>
          <BriefcaseBusiness size={17} aria-hidden="true" />
          <span>03</span>
          <div>
            <h2 aria-label={t('stageLabel', { number: '03', title: t('targetTitle') })}>{t('targetTitle')}</h2>
            <p>{hasTarget ? t('targetReady', { title: workflow?.targetJob.title ?? '' }) : t('targetMissing')}</p>
          </div>
        </article>
        <article data-state={hasVariant ? 'ready' : hasTarget ? 'next' : 'locked'}>
          <FileCheck2 size={17} aria-hidden="true" />
          <span>04</span>
          <div>
            <h2 aria-label={t('stageLabel', { number: '04', title: t('agentTitle') })}>{t('agentTitle')}</h2>
            <p>{hasTarget && workflow
              ? t(`agentStages.${workflow.run.stage}`)
              : t('agentWaiting')}</p>
          </div>
        </article>
        <article data-state={hasVariant ? 'next' : 'locked'}>
          <ScanSearch size={17} aria-hidden="true" />
          <span>05</span>
          <div>
            <h2 aria-label={t('stageLabel', { number: '05', title: t('reviewTitle') })}>{t('reviewTitle')}</h2>
            <p>{hasVariant ? t('reviewReady') : t('reviewWaiting')}</p>
          </div>
        </article>
        <article data-state="ready">
          <Settings2 size={17} aria-hidden="true" />
          <span>06</span>
          <div>
            <h2 aria-label={t('stageLabel', { number: '06', title: t('settingsTitle') })}>{t('settingsTitle')}</h2>
            <p>{t('settingsReady')}</p>
          </div>
        </article>
      </div>

      {hasTarget && workflow?.run.scoreBefore ? <dl className="desktop-workflow__coverage" aria-label={t('coverageSummary')}>
        <div>
          <dt>{t('requirementCoverage')}</dt>
          <dd>{formatPercentage(workflow.run.scoreBefore.requirementCoverage)}</dd>
        </div>
        <div>
          <dt>{t('evidenceCompleteness')}</dt>
          <dd>{formatPercentage(workflow.run.scoreBefore.evidenceCompleteness)}</dd>
        </div>
        <div>
          <dt>{t('rubric')}</dt>
          <dd>{workflow.run.scoreBefore.rubricVersion}</dd>
        </div>
      </dl> : null}

      <div className="desktop-workflow__actions">
        <button type="button" onClick={() => openApp(nextApp)}>
          {actionLabel}<ArrowRight size={15} aria-hidden="true" />
        </button>
        <p>{nextLabel}</p>
      </div>
    </section>
  )
}

function formatPercentage(value: number) {
  return `${Math.round(value * 100) / 100}%`
}

function useActiveWorkflowSummary() {
  const [summary, setSummary] = useState<ActiveWorkflowSummary | null>(null)

  useEffect(() => {
    let active = true
    const refresh = async () => {
      try {
        const next = await loadActiveWorkflowSummary()
        if (active) setSummary(next)
      } catch {
        if (active) setSummary(null)
      }
    }
    void refresh()
    const handleChange = () => { void refresh() }
    window.addEventListener(ACTIVE_WORKFLOW_CHANGED_EVENT, handleChange)
    return () => {
      active = false
      window.removeEventListener(ACTIVE_WORKFLOW_CHANGED_EVENT, handleChange)
    }
  }, [])

  return summary
}
