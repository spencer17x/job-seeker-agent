'use client'

import { Printer } from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import { useResumeDraft } from '@/components/resume-draft-provider'
import { isTrustedResumeSource } from '@/lib/resume-model'
import type { Locale } from '@/i18n/routing'
import {
  createDomainStore,
  type OptimizationRun,
  type ResumeVariant
} from '@/lib/agent/domain-store'
import type { ApplicationRecord } from '@/lib/jobs/job-domain'
import { scoreResumeStructure } from '@/lib/agent/resume-structure-score'
import { createProjectPresentations } from '@/lib/presentation-projects'

type ReviewVariants = {
  variants: ResumeVariant[]
  runs: OptimizationRun[]
  applications?: ApplicationRecord[]
}

export type ReviewVariantLoader = (sourceDraftId: string) => Promise<ReviewVariants>

export function ClassicResumeApp({
  variantLoader = loadReviewVariants
}: { appId?: unknown; variantLoader?: ReviewVariantLoader } = {}) {
  const locale = useLocale() as Locale
  const t = useTranslations('classic')
  const { activeDraft, activeResume } = useResumeDraft()
  const hasVerifiedDraft = isTrustedResumeSource(activeDraft?.source)
  const sourceDraftId = hasVerifiedDraft ? activeDraft.id : undefined
  const [loadedReview, setLoadedReview] = useState<ReviewVariants & { sourceDraftId: string }>({
    sourceDraftId: '', variants: [], runs: []
  })
  const [selection, setSelection] = useState({ sourceDraftId: '', variantId: 'master' })
  const review = loadedReview.sourceDraftId === sourceDraftId
    ? loadedReview
    : { variants: [], runs: [], applications: [] }
  const selectedVariantId = selection.sourceDraftId === sourceDraftId
    ? selection.variantId
    : 'master'

  useEffect(() => {
    let active = true
    if (!sourceDraftId) return () => { active = false }
    void variantLoader(sourceDraftId).then((next) => {
      if (active) setLoadedReview({ sourceDraftId, ...next })
    }).catch(() => {
      if (active) setLoadedReview({ sourceDraftId, variants: [], runs: [] })
    })
    return () => { active = false }
  }, [sourceDraftId, variantLoader])

  const selectedVariant = review.variants.find((item) => item.id === selectedVariantId)
  const selectedRun = selectedVariant
    ? review.runs.find((run) => run.appliedVariantId === selectedVariant.id)
    : undefined
  const selectedApplication = selectedVariant
    ? review.applications?.find((application) => application.resumeVariantId === selectedVariant.id)
    : undefined
  const displayedResume = selectedVariant?.data ?? activeResume
  const masterStructure = useMemo(() => scoreResumeStructure(activeResume), [activeResume])
  const displayedStructure = useMemo(() => scoreResumeStructure(displayedResume), [displayedResume])
  const { education, experiences, openSource, profile, projects, skills } = displayedResume
  const separator = locale === 'zh' ? '、' : ', '
  const colon = locale === 'zh' ? '：' : ': '
  const documentName = selectedVariant?.name ?? activeDraft?.name ?? t('sampleResume')
  const contact = [profile.location, profile.email, profile.phone].filter(Boolean)
  const presentedProjects = useMemo(() => createProjectPresentations(projects), [projects])

  if (!hasVerifiedDraft) {
    return (
      <main className="resume-app-empty-state">
        <h1>{t('importRequired')}</h1>
        <p>{t('importRequiredDescription')}</p>
        <a href={`/${locale}/studio`}>{t('openStudio')}</a>
      </main>
    )
  }

  return (
    <main className="classic-resume-app">
      <div className="classic-resume-app__toolbar">
        <span>{documentName}</span>
        <label>
          <span>{t('version')}</span>
          <select value={selectedVariantId} onChange={(event) => setSelection({
            sourceDraftId: sourceDraftId ?? '',
            variantId: event.target.value
          })}>
            <option value="master">{t('masterVersion')}</option>
            {review.variants.map((variant) => <option key={variant.id} value={variant.id}>{variant.name}</option>)}
          </select>
        </label>
        <button type="button" onClick={() => window.print()} aria-label={t('print')} title={t('print')}>
          <Printer size={15} aria-hidden="true" />
          <span>{t('print')}</span>
        </button>
      </div>
      {selectedApplication ? <p className="classic-resume-app__application-context">{t('applicationLinked', { status: selectedApplication.status })}</p> : null}
      {selectedRun?.scoreBefore && selectedRun.scoreAfter ? <dl className="classic-resume-app__quality" role="group" aria-label={t('qualityReport')}>
        <div>
          <dt>{t('requirementCoverage')}</dt>
          <dd>{t('scoreChange', {
            before: formatScore(selectedRun.scoreBefore.requirementCoverage),
            after: formatScore(selectedRun.scoreAfter.requirementCoverage)
          })}</dd>
        </div>
        <div>
          <dt>{t('evidenceCompleteness')}</dt>
          <dd>{t('scoreChange', {
            before: formatScore(selectedRun.scoreBefore.evidenceCompleteness),
            after: formatScore(selectedRun.scoreAfter.evidenceCompleteness)
          })}</dd>
        </div>
        <div>
          <dt>{t('structureReadability')}</dt>
          <dd>{t('scoreChange', {
            before: formatScore(masterStructure.score),
            after: formatScore(displayedStructure.score)
          })}</dd>
        </div>
      </dl> : null}
      <article className="classic-resume-app__document" aria-label={documentName}>
        <header>
          <p className="classic-resume-app__draft-name">{documentName}</p>
          <h1>{profile.name || t('untitled')}</h1>
          <p className="classic-resume-app__role">{profile.title || activeResume.targetRole}</p>
          {contact.length > 0 && <address>{contact.join(' · ')}</address>}
          {profile.links.length > 0 && (
            <p className="classic-resume-app__links">
              {profile.links.map((link) => link.label || link.url).join(' · ')}
            </p>
          )}
        </header>

        {profile.summary.length > 0 && (
          <ResumeSection title={t('summary')}>
            {profile.summary.map((item, index) => <p key={`summary-${index}`}>{item}</p>)}
          </ResumeSection>
        )}

        {skills.length > 0 && (
          <ResumeSection title={t('skills')}>
            <dl className="classic-resume-app__skills">
              {skills.map((group, index) => (
                <div key={`skill-group-${index}`}><dt>{group.group}{colon}</dt><dd>{group.items.join(separator)}</dd></div>
              ))}
            </dl>
          </ResumeSection>
        )}

        {experiences.length > 0 && (
          <ResumeSection title={t('experience')}>
            {experiences.map((experience, experienceIndex) => (
              <article className="classic-resume-app__item" key={`experience-${experienceIndex}`}>
                <div><h3>{experience.company} · {experience.role}</h3><time>{experience.period}</time></div>
                {experience.location && <p className="classic-resume-app__meta">{experience.location}</p>}
                <ul>{experience.bullets.map((bullet, bulletIndex) => <li key={`experience-${experienceIndex}-bullet-${bulletIndex}`}>{bullet}</li>)}</ul>
              </article>
            ))}
          </ResumeSection>
        )}

        {projects.length > 0 && (
          <ResumeSection title={t('projects')}>
            {presentedProjects.map(({ key, project }) => (
              <article className="classic-resume-app__item" key={key}>
                <div><h3>{project.name}</h3><span>{project.tags.join(separator)}</span></div>
                <p>{project.summary}</p>
                <ul>{project.highlights.map((highlight, index) => <li key={`${key}-highlight-${index}`}>{highlight}</li>)}</ul>
              </article>
            ))}
          </ResumeSection>
        )}

        {education.length > 0 && (
          <ResumeSection title={t('education')}>
            {education.map((item, index) => (
              <article className="classic-resume-app__item" key={`education-${index}`}>
                <div><h3>{item.school}</h3><time>{item.period}</time></div>
                <p>{[item.degree, item.major].filter(Boolean).join(' · ')}</p>
              </article>
            ))}
          </ResumeSection>
        )}

        {openSource.length > 0 && (
          <ResumeSection title={t('openSource')}><ul>{openSource.map((item, index) => <li key={`open-source-${index}`}>{item}</li>)}</ul></ResumeSection>
        )}
      </article>
    </main>
  )
}

async function loadReviewVariants(sourceDraftId: string): Promise<ReviewVariants> {
  const store = createDomainStore()
  try {
    const [variants, runs, applications] = await Promise.all([
      store.list('resumeVariants'),
      store.list('optimizationRuns'),
      store.list('applicationRecords')
    ])
    return {
      variants: variants
        .filter((variant) => variant.sourceDraftId === sourceDraftId)
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
      runs: runs.filter((run) => run.sourceDraftId === sourceDraftId),
      applications: applications.filter((application) => application.sourceDraftId === sourceDraftId)
    }
  } finally {
    await store.close()
  }
}

function formatScore(value: number) {
  return `${Math.round(value * 100) / 100}%`
}

function ResumeSection({ title, children }: { title: string; children: React.ReactNode }) {
  return <section><h2>{title}</h2><div className="classic-resume-app__section-body">{children}</div></section>
}
