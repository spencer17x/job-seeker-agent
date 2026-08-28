'use client'

import { CalendarClock, CheckCircle2, Plus, Sparkles, XCircle } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState } from 'react'
import type { IndexedDbDomainStore } from '@/lib/agent/domain-store'
import type { ApplicationRecord, JobPosting } from '@/lib/jobs/job-domain'
import {
  interviewQuestionSchema,
  recordInterviewOutcome,
  type InterviewQuestion,
  type InterviewReview,
  type InterviewSession
} from '@/lib/jobs/interview-domain'
import { registerInterviewInvitation } from '@/lib/jobs/interview-service'
import { requestInterviewReview } from '@/lib/jobs/interview-review-client'
import { createStableJobDomainId } from '@/lib/jobs/job-domain'

export function InterviewWorkspace({
  store,
  applications,
  postings,
  locale,
  onChanged
}: {
  store: IndexedDbDomainStore
  applications: ApplicationRecord[]
  postings: JobPosting[]
  locale: string
  onChanged: () => Promise<void>
}) {
  const t = useTranslations('jobRadar.workspace.interview')
  const eligible = applications.filter((item) => item.targetJobId && ['applied', 'interviewing'].includes(item.status))
  const [sessions, setSessions] = useState<InterviewSession[]>([])
  const [questions, setQuestions] = useState<InterviewQuestion[]>([])
  const [reviews, setReviews] = useState<InterviewReview[]>([])
  const [applicationId, setApplicationId] = useState('')
  const [format, setFormat] = useState<InterviewSession['format']>('video')
  const [scheduledAt, setScheduledAt] = useState('')
  const [selectedSessionId, setSelectedSessionId] = useState('')
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState('')
  const [notes, setNotes] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async () => {
    const [nextSessions, nextQuestions, nextReviews] = await Promise.all([
      store.list('interviewSessions'),
      store.list('interviewQuestions'),
      store.list('interviewReviews')
    ])
    setSessions(nextSessions.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)))
    setQuestions(nextQuestions.sort((left, right) => left.createdAt.localeCompare(right.createdAt)))
    setReviews(nextReviews.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)))
    setSelectedSessionId((current) => current || nextSessions[0]?.id || '')
  }

  useEffect(() => { void load().catch(() => setError(t('storageError'))) }, [store, t])
  useEffect(() => { if (!applicationId && eligible[0]) setApplicationId(eligible[0].id) }, [applicationId, eligible])

  const selected = sessions.find((item) => item.id === selectedSessionId)
  const selectedQuestions = questions.filter((item) => item.sessionId === selected?.id)
  const selectedReview = reviews.find((item) => item.sessionId === selected?.id)
  const postingByApplication = useMemo(() => new Map(applications.flatMap((application) => {
    const posting = postings.find((item) => item.id === application.postingId)
    return posting ? [[application.id, posting] as const] : []
  })), [applications, postings])

  const addSession = async () => {
    if (!applicationId) return
    setBusy(true); setError('')
    try {
      const round = sessions.filter((item) => item.applicationId === applicationId).length + 1
      const session = await registerInterviewInvitation({
        store, applicationId, round, format,
        ...(scheduledAt ? { scheduledAt: new Date(scheduledAt).toISOString() } : {}),
        now: new Date().toISOString()
      })
      await load(); await onChanged(); setSelectedSessionId(session.id); setScheduledAt('')
    } catch { setError(t('saveError')) } finally { setBusy(false) }
  }

  const addQuestion = async () => {
    if (!selected || !question.trim()) return
    setBusy(true); setError('')
    try {
      const now = new Date().toISOString()
      const value = interviewQuestionSchema.parse({
        id: createStableJobDomainId('interview-question', [selected.id, now, question]),
        sessionId: selected.id,
        question,
        userAnswer: answer,
        suggestedAnswer: '',
        feedback: '',
        tags: [],
        createdAt: now,
        updatedAt: now
      })
      await store.put('interviewQuestions', value)
      setQuestion(''); setAnswer(''); await load()
    } catch { setError(t('saveError')) } finally { setBusy(false) }
  }

  const saveNotes = async () => {
    if (!selected) return
    setBusy(true); setError('')
    try {
      await store.put('interviewSessions', { ...selected, notes: notes.trim(), updatedAt: new Date().toISOString() })
      await load(); setNotes('')
    } catch { setError(t('saveError')) } finally { setBusy(false) }
  }

  const review = async () => {
    if (!selected) return
    const application = applications.find((item) => item.id === selected.applicationId)
    const posting = application ? postingByApplication.get(application.id) : undefined
    if (!posting) return
    setBusy(true); setError('')
    try {
      const next = await requestInterviewReview({
        locale: locale === 'en' ? 'en' : 'zh',
        job: { title: posting.title, company: posting.company, description: posting.description },
        session: selected,
        questions: selectedQuestions
      })
      await store.put('interviewReviews', next)
      await load()
    } catch { setError(t('reviewError')) } finally { setBusy(false) }
  }

  const reportOutcome = async (outcome: 'passed' | 'failed') => {
    if (!selected) return
    setBusy(true); setError('')
    try {
      await store.put('interviewSessions', recordInterviewOutcome({
        session: selected, outcome, now: new Date().toISOString(), explicitUserReport: true
      }))
      await load()
    } catch { setError(t('saveError')) } finally { setBusy(false) }
  }

  return <div className="job-interviews">
    <section className="job-interviews__create">
      <header><h2>{t('newTitle')}</h2><p>{t('newHelp')}</p></header>
      {eligible.length ? <div className="job-interviews__form">
        <label>{t('application')}<select value={applicationId} onChange={(event) => setApplicationId(event.target.value)}>{eligible.map((application) => { const posting = postingByApplication.get(application.id); return <option value={application.id} key={application.id}>{posting ? `${posting.company} · ${posting.title}` : application.id}</option> })}</select></label>
        <label>{t('format')}<select value={format} onChange={(event) => setFormat(event.target.value as InterviewSession['format'])}>{(['phone', 'video', 'onsite', 'take-home', 'other'] as const).map((value) => <option key={value} value={value}>{t(`formats.${value}`)}</option>)}</select></label>
        <label>{t('scheduledAt')}<input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} /></label>
        <button className="job-button job-button--primary" type="button" onClick={() => void addSession()} disabled={busy}><Plus size={15} />{t('add')}</button>
      </div> : <div className="job-workspace__empty-state"><p>{t('requiresApplied')}</p><a className="job-button job-button--primary" href={`/${locale}/jobs/applications`}>{t('viewApplications')}</a></div>}
    </section>
    {error ? <p className="job-workspace__alert" data-tone="error" role="alert">{error}</p> : null}
    <div className="job-interviews__body">
      <aside><h3>{t('rounds')}</h3>{sessions.length ? <ul>{sessions.map((session) => { const posting = postingByApplication.get(session.applicationId); return <li key={session.id}><button type="button" data-selected={session.id === selectedSessionId} onClick={() => setSelectedSessionId(session.id)}><CalendarClock size={16} /><span><strong>{posting?.company ?? t('unknownCompany')} · {t('round', { round: session.round })}</strong><small>{session.scheduledAt ? new Date(session.scheduledAt).toLocaleString(locale) : t(`stages.${session.stage}`)}</small></span></button></li>})}</ul> : <p>{t('empty')}</p>}</aside>
      <section>{selected ? <>
        <header><div><h2>{t('detailTitle', { round: selected.round })}</h2><p>{t(`stages.${selected.stage}`)}</p></div><div><button type="button" className="job-button job-button--secondary" onClick={() => void reportOutcome('passed')} disabled={busy}><CheckCircle2 size={15} />{t('passed')}</button><button type="button" className="job-button job-button--secondary" onClick={() => void reportOutcome('failed')} disabled={busy}><XCircle size={15} />{t('failed')}</button></div></header>
        <label>{t('notes')}<textarea value={notes} placeholder={selected.notes || t('notesPlaceholder')} onChange={(event) => setNotes(event.target.value)} rows={4} /></label><button type="button" className="job-button job-button--secondary" onClick={() => void saveNotes()} disabled={busy || !notes.trim()}>{t('saveNotes')}</button>
        <section className="job-interviews__qa"><h3>{t('qaTitle')}</h3>{selectedQuestions.map((item) => <article key={item.id}><strong>{item.question}</strong><p>{item.userAnswer || t('noAnswer')}</p></article>)}<div><label>{t('question')}<textarea value={question} onChange={(event) => setQuestion(event.target.value)} rows={2} /></label><label>{t('answer')}<textarea value={answer} onChange={(event) => setAnswer(event.target.value)} rows={3} /></label><button type="button" className="job-button job-button--secondary" onClick={() => void addQuestion()} disabled={busy || !question.trim()}><Plus size={15} />{t('addQa')}</button></div></section>
        <section className="job-interviews__review"><header><div><h3>{t('reviewTitle')}</h3><p>{t('reviewHelp')}</p></div><button type="button" className="job-button job-button--primary" onClick={() => void review()} disabled={busy || (!selected.notes && selectedQuestions.length === 0)}><Sparkles size={15} />{t('generateReview')}</button></header>{selectedReview ? <div><strong>{selectedReview.summary}</strong><p>{t('prediction', { probability: Math.round(selectedReview.prediction.passProbability * 100) })}</p><ul>{selectedReview.suggestions.map((item) => <li key={item}>{item}</li>)}</ul><small>{selectedReview.prediction.disclaimer}</small></div> : null}</section>
      </> : <p className="job-workspace__empty">{t('selectRound')}</p>}</section>
    </div>
  </div>
}
