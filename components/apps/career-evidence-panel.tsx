'use client'

import { Check, Database, Pencil, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'
import { DomainStoreError, type CareerFact, type EvidenceSource } from '@/lib/agent/domain-store'
import type { CareerEvidenceService } from '@/lib/agent/career-evidence'
import type { ResumeDraft } from '@/lib/resume-model'

type EvidenceState = {
  draftId: string
  refreshVersion: number
  source: EvidenceSource | null
  facts: CareerFact[]
}

const EMPTY_STATE: EvidenceState = {
  draftId: '',
  refreshVersion: -1,
  source: null,
  facts: []
}

export function CareerEvidencePanel({
  draft,
  service,
  refreshVersion,
  notice,
  setNotice
}: {
  draft: ResumeDraft | null
  service: CareerEvidenceService
  refreshVersion: number
  notice: string
  setNotice: Dispatch<SetStateAction<string>>
}) {
  const t = useTranslations('studio.careerEvidence')
  const [state, setState] = useState<EvidenceState>(EMPTY_STATE)
  const [pendingFactId, setPendingFactId] = useState('')
  const [editingFactId, setEditingFactId] = useState('')
  const [editingText, setEditingText] = useState('')
  const [retryPending, setRetryPending] = useState(false)
  const isTrustedDraft = draft?.source === 'paste' || draft?.source === 'upload'
  const stateIsCurrent = Boolean(
    draft
    && state.draftId === draft.id
    && state.refreshVersion === refreshVersion
  )
  const loading = Boolean(draft && isTrustedDraft && !stateIsCurrent)
  const source = stateIsCurrent ? state.source : null
  const facts = stateIsCurrent ? state.facts : []

  useEffect(() => {
    if (!draft || !isTrustedDraft) return

    let active = true
    void service.listForDraft(draft.id).then((evidence) => {
      if (!active) return
      setState({ draftId: draft.id, refreshVersion, ...evidence })
    }).catch(() => {
      if (!active) return
      setState({
        draftId: draft.id,
        refreshVersion,
        source: null,
        facts: []
      })
      setNotice(t('storageError'))
    })
    return () => { active = false }
  }, [draft, isTrustedDraft, refreshVersion, service, setNotice, t])

  async function confirmFact(fact: CareerFact) {
    setPendingFactId(fact.id)
    setNotice('')
    try {
      const confirmed = await service.confirmFact(fact.id)
      setState((current) => ({
        ...current,
        facts: current.facts.map((item) => item.id === confirmed.id ? confirmed : item)
      }))
    } catch {
      setNotice(t('updateError'))
    } finally {
      setPendingFactId('')
    }
  }

  async function retryImport() {
    if (!draft || !isTrustedDraft) return
    setRetryPending(true)
    setNotice('')
    try {
      await service.importResume({ draftId: draft.id, label: draft.name, data: draft.data })
      const evidence = await service.listForDraft(draft.id)
      setState({ draftId: draft.id, refreshVersion, ...evidence })
    } catch {
      setNotice(t('retryError'))
    } finally {
      setRetryPending(false)
    }
  }

  async function deleteFact(fact: CareerFact) {
    setPendingFactId(fact.id)
    setNotice('')
    try {
      await service.deleteFact(fact.id)
      setState((current) => ({
        ...current,
        facts: current.facts.filter((item) => item.id !== fact.id)
      }))
    } catch (error) {
      setNotice(error instanceof DomainStoreError && error.code === 'DELETE_RESTRICTED'
        ? t('deleteRestricted')
        : t('updateError'))
    } finally {
      setPendingFactId('')
    }
  }

  async function updateFact(fact: CareerFact) {
    const correctedText = editingText.trim()
    if (!correctedText) return
    setPendingFactId(fact.id)
    setNotice('')
    try {
      const updated = await service.updateFact(fact.id, correctedText)
      setState((current) => ({
        ...current,
        facts: current.facts.map((item) => item.id === updated.id ? updated : item)
      }))
      setEditingFactId('')
      setEditingText('')
    } catch {
      setNotice(t('updateError'))
    } finally {
      setPendingFactId('')
    }
  }

  return (
    <section className="resume-studio__evidence" aria-label={t('title')} aria-busy={loading || retryPending}>
      <header>
        <span><Database aria-hidden="true" size={14} />{t('eyebrow')}</span>
        <h2>{t('title')}</h2>
        <p>{t('description')}</p>
      </header>

      {notice ? <p className="resume-studio__evidence-error" role="alert">{notice}</p> : null}
      {!draft ? <p className="resume-studio__evidence-empty">{t('noDraft')}</p> : null}
      {draft && !isTrustedDraft ? (
        <p className="resume-studio__evidence-empty">{t('excluded')}</p>
      ) : null}
      {draft && isTrustedDraft && loading ? (
        <p className="resume-studio__evidence-empty" role="status">{t('loading')}</p>
      ) : null}
      {draft && isTrustedDraft && !loading && !source ? (
        <div className="resume-studio__evidence-empty-action">
          <p className="resume-studio__evidence-empty">{t('empty')}</p>
          <button type="button" disabled={retryPending} onClick={() => void retryImport()}>
            <RefreshCw aria-hidden="true" size={13} />{retryPending ? t('retrying') : t('retryImport')}
          </button>
        </div>
      ) : null}

      {source ? (
        <div className="resume-studio__evidence-source">
          <strong>{source.label}</strong>
          <span>{t('factCount', { count: facts.length })}</span>
        </div>
      ) : null}

      {facts.length ? (
        <ul className="resume-studio__fact-list">
          {facts.map((fact) => (
            <li key={fact.id}>
              <div className="resume-studio__fact-meta">
                <span>{t(`kinds.${fact.kind}`)}</span>
                <span data-verification={fact.verification}>
                  {t(`verification.${fact.verification}`)}
                </span>
              </div>
              {editingFactId === fact.id ? (
                <label className="resume-studio__fact-editor">
                  <span>{t('editFactLabel')}</span>
                  <textarea
                    value={editingText}
                    disabled={pendingFactId === fact.id}
                    onChange={(event) => setEditingText(event.target.value)}
                  />
                </label>
              ) : <p>{fact.text}</p>}
              {fact.context ? (
                <small>{[fact.context.role, fact.context.company, fact.context.project].filter(Boolean).join(' · ')}</small>
              ) : null}
              <div className="resume-studio__fact-actions">
                {editingFactId === fact.id ? (
                  <>
                    <button
                      type="button"
                      disabled={Boolean(pendingFactId) || !editingText.trim()}
                      aria-label={t('saveFact', { fact: fact.text })}
                      onClick={() => void updateFact(fact)}
                    >
                      <Save aria-hidden="true" size={13} />{t('save')}
                    </button>
                    <button
                      type="button"
                      disabled={Boolean(pendingFactId)}
                      aria-label={t('cancelEditFact', { fact: fact.text })}
                      onClick={() => { setEditingFactId(''); setEditingText('') }}
                    >
                      <X aria-hidden="true" size={13} />{t('cancel')}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    disabled={Boolean(pendingFactId)}
                    aria-label={t('editFact', { fact: fact.text })}
                    onClick={() => { setEditingFactId(fact.id); setEditingText(fact.text) }}
                  >
                    <Pencil aria-hidden="true" size={13} />{t('edit')}
                  </button>
                )}
                {fact.verification === 'imported' ? (
                  <button
                    type="button"
                    disabled={Boolean(pendingFactId)}
                    aria-label={t('confirmFact', { fact: fact.text })}
                    onClick={() => void confirmFact(fact)}
                  >
                    <Check aria-hidden="true" size={13} />
                    {t('confirm')}
                  </button>
                ) : null}
                <button
                  type="button"
                  className="resume-studio__danger"
                  disabled={Boolean(pendingFactId)}
                  aria-label={t('deleteFact', { fact: fact.text })}
                  onClick={() => void deleteFact(fact)}
                >
                  <Trash2 aria-hidden="true" size={13} />
                  {t('delete')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  )
}
