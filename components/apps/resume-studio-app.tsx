'use client'

import {
  BriefcaseBusiness,
  ClipboardPaste,
  FileText,
  LoaderCircle,
  Save,
  Trash2,
  Upload,
  WandSparkles
} from 'lucide-react'
import { useLocale, useTranslations } from 'next-intl'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
  type ReactNode
} from 'react'
import { CareerEvidencePanel } from './career-evidence-panel'
import { useResumeDraft } from '@/components/resume-draft-provider'
import { aiFetch } from '@/lib/agent/browser-config'
import {
  createCareerEvidenceService,
  type CareerEvidenceService
} from '@/lib/agent/career-evidence'
import { DomainStoreError } from '@/lib/agent/domain-store'
import { AgentOutputError } from '@/lib/agent/json'
import { readAiProviderPreference } from '@/lib/agent/provider-preference'
import {
  ChromeBuiltInAiError,
  ChromeBuiltInAiProvider,
  ProviderRoutingError,
  localLanguagePolicyForLocale,
  runPreferredProviderTask,
  type StructuredTaskInput,
  type StructuredTaskResult
} from '@/lib/agent/providers'
import {
  buildGenerateResumePrompt,
  buildParseResumePrompt
} from '@/lib/agent/resume-prompts'
import {
  RESUME_TASK_JSON_SCHEMA,
  validateDemoResumeTaskOutput,
  validateParsedResumeTaskOutput,
  type DemoResumeTaskInput
} from '@/lib/agent/resume-tasks'
import { collectBossResumeSnapshot } from '@/lib/jobs/browser-agent-protocol'
import type { AppId } from '@/lib/desktop/types'
import type { Locale } from '@/i18n/routing'
import { parseRetryAfter } from '@/lib/retry-after'
import { getSampleResumeData } from '@/lib/resume-sample'
import {
  defaultDraftName,
  normalizeResumeData,
  type ResumeData,
  type ResumeSource
} from '@/lib/resume-model'

type SourceMode = 'boss' | 'paste' | 'upload' | 'generate'
type Seniority = 'junior' | 'mid' | 'senior' | 'lead'
type PendingAction = 'parse' | 'upload' | 'generate' | null
type CooldownBucket = 'extract' | 'parse' | 'generate'
type Cooldowns = Record<CooldownBucket, number>

type CloudResumeResult = { data?: unknown; model?: unknown }

const SOURCE_MODES: SourceMode[] = ['boss', 'paste', 'upload', 'generate']
const EMPTY_COOLDOWNS: Cooldowns = { extract: 0, parse: 0, generate: 0 }
const LOCALIZED_ERROR_CODES = new Set([
  'AI_PUBLIC_ACCESS_DISABLED',
  'AI_ACCESS_MISCONFIGURED',
  'FORBIDDEN',
  'RATE_LIMITED',
  'PAYLOAD_TOO_LARGE',
  'INVALID_REQUEST',
  'CONTENT_LENGTH_REQUIRED',
  'FILE_REQUIRED',
  'UNEXPECTED_MULTIPART',
  'UNSUPPORTED_FILE',
  'INVALID_FILE_SIGNATURE',
  'EMPTY_TEXT',
  'EXTRACTION_LIMIT',
  'EXTRACTION_FAILED',
  'AI_NOT_CONFIGURED',
  'AI_UNAVAILABLE',
  'AI_OUTPUT_INVALID',
  'AI_OUTPUT_TOO_LARGE',
  'REQUEST_ABORTED',
  'LOCAL_MODEL_UNAVAILABLE',
  'CLOUD_FALLBACK_NOT_ALLOWED',
  'USER_ACTIVATION_REQUIRED',
  'CONTEXT_LIMIT_EXCEEDED'
])

class ApiRequestError extends Error {
  constructor(
    readonly code: string,
    readonly bucket: CooldownBucket,
    readonly retryAfterSeconds = 0
  ) {
    super(code)
    this.name = 'ApiRequestError'
  }
}

export function ResumeStudioApp({
  evidenceService: evidenceServiceOverride
}: {
  appId?: AppId
  evidenceService?: CareerEvidenceService
} = {}) {
  const t = useTranslations('studio')
  const locale = useLocale() as Locale
  const {
    state,
    activeDraft,
    createDraft,
    setActiveDraft,
    renameDraft,
    deleteDraft
  } = useResumeDraft()
  const [mode, setMode] = useState<SourceMode>('paste')
  const [pasteText, setPasteText] = useState('')
  const [bossResumeText, setBossResumeText] = useState('')
  const [bossResumeReady, setBossResumeReady] = useState(false)
  const [uploadText, setUploadText] = useState('')
  const [uploadName, setUploadName] = useState('')
  const [uploadReady, setUploadReady] = useState(false)
  const [targetRole, setTargetRole] = useState('')
  const [seniority, setSeniority] = useState<Seniority>('mid')
  const [background, setBackground] = useState('')
  const [draftNameEdit, setDraftNameEdit] = useState({ draftId: '', value: '' })
  const [pending, setPending] = useState<PendingAction>(null)
  const [error, setError] = useState('')
  const [model, setModel] = useState('')
  const [streamingResume, setStreamingResume] = useState<ResumeData | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState('')
  const [deletePending, setDeletePending] = useState(false)
  const [evidenceNotice, setEvidenceNotice] = useState('')
  const [evidenceRefreshVersion, setEvidenceRefreshVersion] = useState(0)
  const [evidenceService] = useState(
    () => evidenceServiceOverride ?? createCareerEvidenceService()
  )
  const [cooldowns, setCooldowns] = useState<Cooldowns>(EMPTY_COOLDOWNS)
  const mountedRef = useRef(false)
  const requestGenerationRef = useRef(0)
  const activeControllerRef = useRef<AbortController | null>(null)
  const tabRefs = useRef<Record<SourceMode, HTMLButtonElement | null>>({
    boss: null,
    paste: null,
    upload: null,
    generate: null
  })
  const tabGroupId = useId()

  const busy = pending !== null
  const hasCooldown = Object.values(cooldowns).some((seconds) => seconds > 0)
  const draftName = activeDraft && draftNameEdit.draftId === activeDraft.id
    ? draftNameEdit.value
    : activeDraft?.name ?? ''

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      requestGenerationRef.current += 1
      activeControllerRef.current?.abort()
      activeControllerRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!hasCooldown) return
    const timer = window.setInterval(() => {
      setCooldowns((current) => ({
        extract: Math.max(0, current.extract - 1),
        parse: Math.max(0, current.parse - 1),
        generate: Math.max(0, current.generate - 1)
      }))
    }, 1_000)
    return () => window.clearInterval(timer)
  }, [hasCooldown])

  function beginOperation(action: Exclude<PendingAction, null>) {
    activeControllerRef.current?.abort()
    const controller = new AbortController()
    const generation = requestGenerationRef.current + 1
    requestGenerationRef.current = generation
    activeControllerRef.current = controller
    setPending(action)
    setError('')
    setDownloadProgress(null)
    return { controller, generation }
  }

  function isCurrentRequest(generation: number, controller: AbortController) {
    return mountedRef.current
      && requestGenerationRef.current === generation
      && !controller.signal.aborted
  }

  function finishOperation(generation: number, controller: AbortController) {
    if (!isCurrentRequest(generation, controller)) return
    activeControllerRef.current = null
    setPending(null)
    setDownloadProgress(null)
  }

  function cancelActiveOperation() {
    requestGenerationRef.current += 1
    activeControllerRef.current?.abort()
    activeControllerRef.current = null
    setPending(null)
    setStreamingResume(null)
    setDownloadProgress(null)
  }

  function localizedRequestError(requestError: unknown, fallback: string) {
    const providerCode = providerErrorCode(requestError)
    if (providerCode) return t(`errors.${providerCode}`)
    if (requestError instanceof AgentOutputError) return t(`errors.${requestError.code}`)
    if (requestError instanceof ApiRequestError && LOCALIZED_ERROR_CODES.has(requestError.code)) {
      if (requestError.code === 'RATE_LIMITED' && requestError.retryAfterSeconds > 0) {
        setCooldowns((current) => ({
          ...current,
          [requestError.bucket]: Math.max(current[requestError.bucket], requestError.retryAfterSeconds)
        }))
        return t('errors.RATE_LIMITED_RETRY', { seconds: requestError.retryAfterSeconds })
      }
      return t(`errors.${requestError.code}`)
    }
    return fallback
  }

  async function parseResume(
    text: string,
    source: Extract<ResumeSource, 'paste' | 'upload' | 'boss'>,
    signal: AbortSignal
  ) {
    const request = { text, locale, source }
    const prompt = buildParseResumePrompt(text, locale)
    const taskInput: StructuredTaskInput<ResumeData> = {
      task: {
        kind: 'parse-resume',
        expectedInputLanguages: [locale],
        expectedOutputLanguages: [locale],
        localLanguagePolicy: localLanguagePolicyForLocale(locale)
      },
      system: prompt.system,
      prompt: prompt.user,
      jsonSchema: RESUME_TASK_JSON_SCHEMA,
      validate: (value) => validateParsedResumeTaskOutput(value, { locale, source }),
      signal,
      onDownloadProgress: (progress) => {
        if (activeControllerRef.current?.signal === signal && !signal.aborted) {
          setDownloadProgress(progress)
        }
      }
    }
    const result = await runPreferredProviderTask({
      preference: readAiProviderPreference(),
      localProvider: new ChromeBuiltInAiProvider(),
      input: taskInput,
      runCloudTask: async () => {
        const cloud = await requestJson<CloudResumeResult>(
          '/api/resume/parse',
          request,
          signal,
          'parse'
        )
        return cloudTaskResult(
          validateParsedResumeTaskOutput(cloud.data, { locale, source }),
          cloud.model,
          'parse'
        )
      }
    })
    return { data: result.value, model: result.model }
  }

  async function createFromPaste() {
    const text = pasteText.trim()
    if (!text) {
      setError(t('sourceRequired'))
      return
    }

    const operation = beginOperation('parse')
    try {
      const result = await parseResume(text, 'paste', operation.controller.signal)
      if (!isCurrentRequest(operation.generation, operation.controller)) return
      await createDraftWithEvidence(result.data, { source: 'paste' })
      if (!isCurrentRequest(operation.generation, operation.controller)) return
      setModel(result.model)
    } catch (requestError) {
      if (isCurrentRequest(operation.generation, operation.controller)) {
        setError(localizedRequestError(requestError, t('parseError')))
      }
    } finally {
      finishOperation(operation.generation, operation.controller)
    }
  }

  async function collectFromBoss() {
    const operation = beginOperation('parse')
    setBossResumeText('')
    setBossResumeReady(false)
    try {
      const response = await collectBossResumeSnapshot({
        window,
        timeoutMs: 15_000
      })
      if (!isCurrentRequest(operation.generation, operation.controller)) return
      if (!response.ok || !response.resumeSnapshot) throw new TypeError('BOSS resume unavailable')
      setBossResumeText(response.resumeSnapshot.text)
      setBossResumeReady(true)
    } catch {
      if (isCurrentRequest(operation.generation, operation.controller)) {
        setError(t('bossImportError'))
      }
    } finally {
      finishOperation(operation.generation, operation.controller)
    }
  }

  async function importBossResume() {
    const text = bossResumeText.trim()
    if (!bossResumeReady || !text) {
      setError(t('sourceRequired'))
      return
    }
    const operation = beginOperation('parse')
    try {
      const result = await parseResume(text, 'boss', operation.controller.signal)
      if (!isCurrentRequest(operation.generation, operation.controller)) return
      await createDraftWithEvidence(result.data, {
        source: 'boss',
        name: t('bossDraftName')
      })
      if (!isCurrentRequest(operation.generation, operation.controller)) return
      setModel(result.model)
    } catch (requestError) {
      if (isCurrentRequest(operation.generation, operation.controller)) {
        setError(localizedRequestError(requestError, t('parseError')))
      }
    } finally {
      finishOperation(operation.generation, operation.controller)
    }
  }

  async function uploadResume(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return

    const input = event.currentTarget
    const operation = beginOperation('upload')
    setUploadText('')
    setUploadName('')
    setUploadReady(false)
    try {
      const form = new FormData()
      form.set('file', file)
      const extracted = await requestJson<{ text: string; fileName: string; mimeType: string }>(
        '/api/resume/extract-text',
        form,
        operation.controller.signal,
        'extract'
      )
      if (!isCurrentRequest(operation.generation, operation.controller)) return
      setUploadText(extracted.text)
      setUploadName(extracted.fileName)
      setUploadReady(true)
      const result = await parseResume(extracted.text, 'upload', operation.controller.signal)
      if (!isCurrentRequest(operation.generation, operation.controller)) return
      await createDraftWithEvidence(result.data, { source: 'upload', name: extracted.fileName })
      if (!isCurrentRequest(operation.generation, operation.controller)) return
      setModel(result.model)
    } catch (requestError) {
      if (isCurrentRequest(operation.generation, operation.controller)) {
        setError(localizedRequestError(requestError, t('uploadError')))
      }
    } finally {
      finishOperation(operation.generation, operation.controller)
      input.value = ''
    }
  }

  async function parseExtractedResume() {
    const text = uploadText.trim()
    if (!uploadReady || !text) {
      setError(t('sourceRequired'))
      return
    }

    const operation = beginOperation('parse')
    try {
      const result = await parseResume(text, 'upload', operation.controller.signal)
      if (!isCurrentRequest(operation.generation, operation.controller)) return
      await createDraftWithEvidence(result.data, {
        source: 'upload',
        ...(uploadName ? { name: uploadName } : {})
      })
      if (!isCurrentRequest(operation.generation, operation.controller)) return
      setModel(result.model)
    } catch (requestError) {
      if (isCurrentRequest(operation.generation, operation.controller)) {
        setError(localizedRequestError(requestError, t('parseError')))
      }
    } finally {
      finishOperation(operation.generation, operation.controller)
    }
  }

  async function generateResume() {
    const role = targetRole.trim()
    if (!role) {
      setError(t('roleRequired'))
      return
    }

    const operation = beginOperation('generate')
    setStreamingResume(null)
    try {
      const request: DemoResumeTaskInput = {
        locale,
        targetRole: role,
        seniority,
        ...(background.trim() ? { background: background.trim() } : {})
      }
      const prompt = buildGenerateResumePrompt(request)
      const taskInput: StructuredTaskInput<ResumeData> = {
        task: {
          kind: 'generate-demo-resume',
          expectedInputLanguages: [locale],
          expectedOutputLanguages: [locale],
          localLanguagePolicy: localLanguagePolicyForLocale(locale)
        },
        system: prompt.system,
        prompt: prompt.user,
        jsonSchema: RESUME_TASK_JSON_SCHEMA,
        validate: (value) => validateDemoResumeTaskOutput(value, request),
        signal: operation.controller.signal,
        onDownloadProgress: (progress) => {
          if (isCurrentRequest(operation.generation, operation.controller)) {
            setDownloadProgress(progress)
          }
        }
      }
      const result = await runPreferredProviderTask({
        preference: readAiProviderPreference(),
        localProvider: new ChromeBuiltInAiProvider(),
        input: taskInput,
        runCloudTask: async () => {
          const cloud = await requestResumeStream(
            '/api/resume/generate',
            request,
            operation.controller.signal,
            (data) => {
              if (!isCurrentRequest(operation.generation, operation.controller)) return
              try {
                setStreamingResume(validateDemoResumeTaskOutput(data, request))
              } catch {
                // Partial streamed objects may be incomplete between validated snapshots.
              }
            },
            (activeModel) => {
              if (isCurrentRequest(operation.generation, operation.controller)) setModel(activeModel)
            }
          )
          return cloudTaskResult(
            validateDemoResumeTaskOutput(cloud.data, request),
            cloud.model,
            'generate'
          )
        }
      })
      if (!isCurrentRequest(operation.generation, operation.controller)) return
      createDraft(result.value, { source: 'ai-generated' })
      setModel(result.model)
      setStreamingResume(null)
    } catch (requestError) {
      if (isCurrentRequest(operation.generation, operation.controller)) {
        setStreamingResume(null)
        setError(localizedRequestError(requestError, t('generateError')))
      }
    } finally {
      finishOperation(operation.generation, operation.controller)
    }
  }

  function loadAnonymousSample() {
    const sampleName = t('sampleDraftName')
    const existing = state.drafts.find((draft) => (
      draft.source === 'sample'
      && draft.name === sampleName
      && draft.data.metadata.locale === locale
    ))
    if (existing) {
      setActiveDraft(existing.id)
    } else {
      createDraft(getSampleResumeData(locale), { source: 'sample', name: sampleName })
    }
    setError('')
    setStreamingResume(null)
  }

  function selectMode(nextMode: SourceMode) {
    if (nextMode === mode) return
    cancelActiveOperation()
    setError('')
    setMode(nextMode)
  }

  function handleTabKey(event: KeyboardEvent<HTMLButtonElement>, currentMode: SourceMode) {
    const currentIndex = SOURCE_MODES.indexOf(currentMode)
    let nextIndex: number | undefined

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % SOURCE_MODES.length
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + SOURCE_MODES.length) % SOURCE_MODES.length
    if (event.key === 'Home') nextIndex = 0
    if (event.key === 'End') nextIndex = SOURCE_MODES.length - 1
    if (nextIndex === undefined) return

    event.preventDefault()
    const nextMode = SOURCE_MODES[nextIndex]
    selectMode(nextMode)
    queueMicrotask(() => tabRefs.current[nextMode]?.focus())
  }

  function saveDraftName() {
    if (activeDraft && draftName.trim()) {
      renameDraft(activeDraft.id, draftName)
      setDraftNameEdit({ draftId: '', value: '' })
    }
  }

  function openDraft(draftId: string) {
    setDeleteConfirmId('')
    setEvidenceNotice('')
    setActiveDraft(draftId)
  }

  async function confirmDeleteDraft() {
    if (!activeDraft || deleteConfirmId !== activeDraft.id) return
    const draftId = activeDraft.id
    setDeletePending(true)
    setEvidenceNotice('')
    try {
      await evidenceService.assertSourceDraftCanBeDeleted(draftId)
      deleteDraft(draftId)
      setDeleteConfirmId('')
      setDraftNameEdit({ draftId: '', value: '' })
    } catch (deleteError) {
      setEvidenceNotice(
        deleteError instanceof DomainStoreError && deleteError.code === 'DELETE_RESTRICTED'
          ? t('careerEvidence.deleteDraftBlocked')
          : t('careerEvidence.storageError')
      )
    } finally {
      setDeletePending(false)
    }
  }

  async function createDraftWithEvidence(
    data: ResumeData,
    options: { source: Extract<ResumeSource, 'paste' | 'upload' | 'boss'>; name?: string }
  ) {
    const importedData = normalizeResumeData(data, { source: options.source, locale })
    const draftId = createDraft(importedData, options)
    setEvidenceNotice('')
    try {
      await evidenceService.importResume({
        draftId,
        label: options.name ?? defaultDraftName(importedData),
        data: importedData
      })
      setEvidenceRefreshVersion((version) => version + 1)
    } catch {
      setEvidenceNotice(t('careerEvidence.importStorageError'))
    }
    return draftId
  }

  return (
    <section className="desktop-app-content resume-studio" aria-label={t('title')} aria-busy={busy || deletePending}>
      <aside className="resume-studio__drafts" aria-label={t('drafts')}>
        <div className="resume-studio__section-heading">
          <FileText aria-hidden="true" size={16} />
          <h2>{t('drafts')}</h2>
          <span>{state.drafts.length}</span>
        </div>
        <div className="resume-studio__draft-list">
          {state.drafts.length ? state.drafts.map((draft) => (
            <button
              key={draft.id}
              type="button"
              className="resume-studio__draft"
              data-active={draft.id === activeDraft?.id}
              aria-pressed={draft.id === activeDraft?.id}
              aria-label={t('openDraft', { name: draft.name })}
              onClick={() => openDraft(draft.id)}
            >
              <strong>{draft.name}</strong>
              <span>{t(`sources.${draft.source}`)}</span>
            </button>
          )) : <p className="resume-studio__empty">{t('noDrafts')}</p>}
        </div>

        <div className="resume-studio__draft-actions">
          <label htmlFor="studio-draft-name">{t('draftName')}</label>
          <input
            id="studio-draft-name"
            value={draftName}
            disabled={!activeDraft || busy}
            onChange={(event) => setDraftNameEdit({ draftId: activeDraft?.id ?? '', value: event.target.value })}
          />
          {activeDraft && deleteConfirmId === activeDraft.id ? (
            <div role="group" aria-label={t('deleteConfirmation')}>
              <button type="button" className="resume-studio__danger" disabled={busy || deletePending} onClick={() => void confirmDeleteDraft()}>
                <Trash2 aria-hidden="true" size={14} />
                {t('confirmDelete')}
              </button>
              <button type="button" disabled={busy || deletePending} onClick={() => setDeleteConfirmId('')}>
                {t('cancelDelete')}
              </button>
            </div>
          ) : (
            <div>
              <button type="button" disabled={!activeDraft || busy || !draftName.trim()} onClick={saveDraftName}>
                <Save aria-hidden="true" size={14} />
                {t('saveName')}
              </button>
              <button
                type="button"
                className="resume-studio__danger"
                disabled={!activeDraft || busy}
                onClick={() => activeDraft && setDeleteConfirmId(activeDraft.id)}
              >
                <Trash2 aria-hidden="true" size={14} />
                {t('deleteDraft')}
              </button>
            </div>
          )}
        </div>

      </aside>

      <main className="resume-studio__workspace">
        <header className="resume-studio__toolbar">
          <div role="tablist" aria-label={t('sourceMode')}>
            <ModeTab
              id={`${tabGroupId}-tab-boss`}
              panelId={`${tabGroupId}-panel-boss`}
              mode="boss"
              current={mode}
              label={t('bossImport')}
              icon={<BriefcaseBusiness size={15} />}
              buttonRef={(button) => { tabRefs.current.boss = button }}
              onKeyDown={handleTabKey}
              onSelect={selectMode}
            />
            <ModeTab
              id={`${tabGroupId}-tab-paste`}
              panelId={`${tabGroupId}-panel-paste`}
              mode="paste"
              current={mode}
              label={t('paste')}
              icon={<ClipboardPaste size={15} />}
              buttonRef={(button) => { tabRefs.current.paste = button }}
              onKeyDown={handleTabKey}
              onSelect={selectMode}
            />
            <ModeTab
              id={`${tabGroupId}-tab-upload`}
              panelId={`${tabGroupId}-panel-upload`}
              mode="upload"
              current={mode}
              label={t('upload')}
              icon={<Upload size={15} />}
              buttonRef={(button) => { tabRefs.current.upload = button }}
              onKeyDown={handleTabKey}
              onSelect={selectMode}
            />
            <ModeTab
              id={`${tabGroupId}-tab-generate`}
              panelId={`${tabGroupId}-panel-generate`}
              mode="generate"
              current={mode}
              label={t('generate')}
              icon={<WandSparkles size={15} />}
              buttonRef={(button) => { tabRefs.current.generate = button }}
              onKeyDown={handleTabKey}
              onSelect={selectMode}
            />
          </div>
          {model ? <p>{t('model')}: <strong>{model}</strong></p> : null}
          {downloadProgress !== null ? <p role="status">{t('localModelDownload', {
            progress: Math.round(downloadProgress * 100)
          })}</p> : null}
        </header>

        <div
          className="resume-studio__editor"
          id={`${tabGroupId}-panel-boss`}
          role="tabpanel"
          aria-labelledby={`${tabGroupId}-tab-boss`}
          hidden={mode !== 'boss'}
          tabIndex={mode === 'boss' ? 0 : -1}
        >
          <div className="resume-studio__sample-card">
            <div><strong>{t('bossImportTitle')}</strong><p>{t('bossImportDescription')}</p></div>
            <button type="button" disabled={busy} onClick={() => void collectFromBoss()}><BriefcaseBusiness aria-hidden="true" size={16} />{t('bossCollect')}</button>
          </div>
          <label htmlFor="studio-boss-resume-text">{t('bossExtractedText')}</label>
          <textarea
            id="studio-boss-resume-text"
            value={bossResumeText}
            disabled={busy}
            maxLength={40_000}
            placeholder={t('bossExtractedPlaceholder')}
            onChange={(event) => setBossResumeText(event.target.value)}
          />
          <button type="button" className="resume-studio__primary" disabled={busy || !bossResumeReady || !bossResumeText.trim()} onClick={() => void importBossResume()}>
            {pending === 'parse' ? <LoaderCircle className="resume-studio__spinner" aria-hidden="true" size={16} /> : <BriefcaseBusiness aria-hidden="true" size={16} />}
            {pending === 'parse' ? t('creating') : t('bossCreateDraft')}
          </button>
          {mode === 'boss' && error ? <p className="resume-studio__error" role="alert">{error}</p> : null}
        </div>

        <div
          className="resume-studio__editor"
          id={`${tabGroupId}-panel-paste`}
          role="tabpanel"
          aria-labelledby={`${tabGroupId}-tab-paste`}
          hidden={mode !== 'paste'}
          tabIndex={mode === 'paste' ? 0 : -1}
        >
          <label htmlFor="studio-source-text">{t('resumeText')}</label>
          <textarea
            id="studio-source-text"
            value={pasteText}
            disabled={busy}
            placeholder={t('resumeTextPlaceholder')}
            onChange={(event) => setPasteText(event.target.value)}
          />
          <button type="button" className="resume-studio__primary" disabled={busy || cooldowns.parse > 0} onClick={createFromPaste}>
            {pending === 'parse' ? <LoaderCircle className="resume-studio__spinner" aria-hidden="true" size={16} /> : <ClipboardPaste aria-hidden="true" size={16} />}
            {pending === 'parse' ? t('creating') : t('createDraft')}
          </button>
          {mode === 'paste' && error ? <p className="resume-studio__error" role="alert">{error}</p> : null}
        </div>

        <div
          className="resume-studio__editor"
          id={`${tabGroupId}-panel-upload`}
          role="tabpanel"
          aria-labelledby={`${tabGroupId}-tab-upload`}
          hidden={mode !== 'upload'}
          tabIndex={mode === 'upload' ? 0 : -1}
        >
          <label className="resume-studio__file-picker" htmlFor="studio-file">
            <Upload aria-hidden="true" size={18} />
            <span>{pending === 'upload' ? t('uploading') : t('chooseFile')}</span>
            <small>{t('fileHint')}</small>
          </label>
          <input
            className="sr-only"
            id="studio-file"
            type="file"
            accept=".pdf,.docx,.txt,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
            aria-label={t('uploadFile')}
            disabled={busy || cooldowns.extract > 0}
            onChange={uploadResume}
          />
          <label htmlFor="studio-extracted-text">{t('extractedText')}</label>
          <textarea
            id="studio-extracted-text"
            value={uploadText}
            disabled={busy}
            placeholder={uploadName || t('extractedPlaceholder')}
            onChange={(event) => setUploadText(event.target.value)}
          />
          <button type="button" className="resume-studio__primary" disabled={busy || cooldowns.parse > 0 || !uploadReady || !uploadText.trim()} onClick={parseExtractedResume}>
            {pending === 'parse' ? <LoaderCircle className="resume-studio__spinner" aria-hidden="true" size={16} /> : <FileText aria-hidden="true" size={16} />}
            {pending === 'parse' ? t('parsingExtracted') : t('parseExtracted')}
          </button>
          {mode === 'upload' && error ? <p className="resume-studio__error" role="alert">{error}</p> : null}
        </div>

        <div
          className="resume-studio__editor"
          id={`${tabGroupId}-panel-generate`}
          role="tabpanel"
          aria-labelledby={`${tabGroupId}-tab-generate`}
          hidden={mode !== 'generate'}
          tabIndex={mode === 'generate' ? 0 : -1}
        >
          <div className="resume-studio__generation">
            <div className="resume-studio__sample-card">
              <div>
                <strong>{t('sampleTitle')}</strong>
                <p>{t('sampleDescription')}</p>
              </div>
              <button type="button" disabled={busy} onClick={loadAnonymousSample}>
                <FileText aria-hidden="true" size={16} />
                {t('loadSample')}
              </button>
            </div>
            <label htmlFor="studio-role">{t('targetRole')}</label>
            <input id="studio-role" value={targetRole} disabled={busy} onChange={(event) => setTargetRole(event.target.value)} />
            <label htmlFor="studio-seniority">{t('seniority')}</label>
            <select id="studio-seniority" value={seniority} disabled={busy} onChange={(event) => setSeniority(event.target.value as Seniority)}>
              <option value="junior">{t('seniorityLevels.junior')}</option>
              <option value="mid">{t('seniorityLevels.mid')}</option>
              <option value="senior">{t('seniorityLevels.senior')}</option>
              <option value="lead">{t('seniorityLevels.lead')}</option>
            </select>
            <label htmlFor="studio-background">{t('background')}</label>
            <textarea id="studio-background" value={background} disabled={busy} onChange={(event) => setBackground(event.target.value)} />
            <p>{t('providerRoutingHint')}</p>
            <button type="button" className="resume-studio__primary" disabled={busy || cooldowns.generate > 0} onClick={generateResume}>
              {pending === 'generate' ? <LoaderCircle className="resume-studio__spinner" aria-hidden="true" size={16} /> : <WandSparkles aria-hidden="true" size={16} />}
              {pending === 'generate' ? t('generating') : t('generateResume')}
            </button>
          </div>
          {mode === 'generate' && error ? <p className="resume-studio__error" role="alert">{error}</p> : null}
        </div>
      </main>

      <div className="resume-studio__inspector">
        <CareerEvidencePanel
          draft={activeDraft}
          service={evidenceService}
          refreshVersion={evidenceRefreshVersion}
          notice={evidenceNotice}
          setNotice={setEvidenceNotice}
        />
        <ResumePreview
          data={streamingResume ?? activeDraft?.data ?? null}
          sample={!streamingResume && activeDraft?.source === 'sample'}
          streaming={Boolean(streamingResume)}
        />
      </div>
    </section>
  )
}

function ModeTab({
  id,
  panelId,
  mode,
  current,
  label,
  icon,
  buttonRef,
  onKeyDown,
  onSelect
}: {
  id: string
  panelId: string
  mode: SourceMode
  current: SourceMode
  label: string
  icon: ReactNode
  buttonRef(button: HTMLButtonElement | null): void
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>, mode: SourceMode): void
  onSelect(mode: SourceMode): void
}) {
  return (
    <button
      ref={buttonRef}
      id={id}
      type="button"
      role="tab"
      aria-selected={current === mode}
      aria-controls={panelId}
      tabIndex={current === mode ? 0 : -1}
      onClick={() => onSelect(mode)}
      onKeyDown={(event) => onKeyDown(event, mode)}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </button>
  )
}

function ResumePreview({ data, sample, streaming }: { data: ResumeData | null; sample: boolean; streaming: boolean }) {
  const t = useTranslations('studio')
  if (!data) {
    return (
      <aside className="resume-studio__preview" data-streaming="false" role="region" aria-label={t('preview')}>
        <div className="resume-app-empty-state">
          <FileText aria-hidden="true" size={28} />
          <h2>{t('emptyPreviewTitle')}</h2>
          <p>{t('emptyPreviewDescription')}</p>
        </div>
      </aside>
    )
  }

  return (
    <aside className="resume-studio__preview" data-streaming={streaming} role="region" aria-label={t('preview')}>
      <header>
        <span>{streaming ? t('streamingPreview') : sample ? t('samplePreview') : t('activePreview')}</span>
        <h2>{data.profile.name || t('untitled')}</h2>
        <p>{data.targetRole || data.profile.title}</p>
      </header>
      <section>
        <h3>{t('summary')}</h3>
        {data.profile.summary.map((item) => <p key={item}>{item}</p>)}
      </section>
      <section>
        <h3>{t('skills')}</h3>
        {data.skills.map((group) => (
          <div className="resume-studio__skill-row" key={group.group}>
            <strong>{group.group}</strong>
            <span>{group.items.join(' · ')}</span>
          </div>
        ))}
      </section>
      <section>
        <h3>{t('experience')}</h3>
        {data.experiences.map((experience) => (
          <article key={`${experience.company}-${experience.period}`}>
            <strong>{experience.role}</strong>
            <span>{experience.company} · {experience.period}</span>
            {experience.bullets.map((bullet) => <p key={bullet}>{bullet}</p>)}
          </article>
        ))}
      </section>
      <section>
        <h3>{t('projects')}</h3>
        {data.projects.map((project) => (
          <article key={project.id || project.name}>
            <strong>{project.name}</strong>
            <p>{project.summary}</p>
          </article>
        ))}
      </section>
      {data.education.length ? (
        <section>
          <h3>{t('education')}</h3>
          {data.education.map((item) => <p key={`${item.school}-${item.period}`}>{item.school} {item.degree}</p>)}
        </section>
      ) : null}
    </aside>
  )
}

async function requestResumeStream(
  url: string,
  body: object,
  signal: AbortSignal,
  onPartial: (data: unknown) => void,
  onModel: (model: string) => void
): Promise<CloudResumeResult> {
  const response = await aiFetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/x-ndjson',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal
  })

  if (!response.ok) throw await responseApiError(response, 'generate')
  if (!response.body || !response.headers.get('Content-Type')?.includes('application/x-ndjson')) {
    return await response.json() as CloudResumeResult
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let completed: CloudResumeResult | null = null

  const consumeLine = (line: string) => {
    if (!line.trim()) return
    let event: { type?: string; data?: unknown; model?: unknown; code?: unknown }
    try {
      event = JSON.parse(line) as typeof event
    } catch {
      throw new ApiRequestError('AI_OUTPUT_INVALID', 'generate')
    }

    if (event.type === 'start') {
      if (typeof event.model === 'string' && event.model.trim()) onModel(event.model)
      if (event.data !== undefined) onPartial(event.data)
    }
    if (event.type === 'partial' && event.data !== undefined) onPartial(event.data)
    if (
      event.type === 'result'
      && event.data !== undefined
      && typeof event.model === 'string'
      && event.model.trim()
    ) {
      completed = { data: event.data, model: event.model }
    }
    if (event.type === 'error') {
      throw new ApiRequestError(
        typeof event.code === 'string' ? event.code : 'AI_UNAVAILABLE',
        'generate'
      )
    }
  }

  while (true) {
    const { done, value } = await reader.read()
    buffer += decoder.decode(value, { stream: !done })
    let newline = buffer.indexOf('\n')
    while (newline >= 0) {
      consumeLine(buffer.slice(0, newline))
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
    }
    if (done) break
  }
  consumeLine(buffer)

  if (!completed) throw new ApiRequestError('AI_OUTPUT_INVALID', 'generate')
  return completed
}

async function requestJson<T>(
  url: string,
  body: FormData | object,
  signal: AbortSignal,
  bucket: CooldownBucket
): Promise<T> {
  const request = body instanceof FormData ? fetch : aiFetch
  const response = await request(url, body instanceof FormData
    ? { method: 'POST', body, signal }
    : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal })
  const payload = await response.json().catch(() => ({})) as {
    code?: unknown
    error?: { code?: unknown; message?: unknown } | string
  }

  if (!response.ok) {
    throw apiRequestError(payload, response, bucket)
  }

  return payload as T
}

function cloudTaskResult<T>(
  value: T,
  model: unknown,
  bucket: CooldownBucket
): StructuredTaskResult<T> {
  if (typeof model !== 'string' || !model.trim()) {
    throw new ApiRequestError('AI_OUTPUT_INVALID', bucket)
  }
  return {
    value,
    provider: 'OpenAI-compatible',
    model
  }
}

function providerErrorCode(error: unknown) {
  if (error instanceof ProviderRoutingError) return 'CLOUD_FALLBACK_NOT_ALLOWED'
  if (!(error instanceof ChromeBuiltInAiError)) return null

  switch (error.code) {
    case 'MODEL_UNAVAILABLE':
      return 'LOCAL_MODEL_UNAVAILABLE'
    case 'USER_ACTIVATION_REQUIRED':
      return 'USER_ACTIVATION_REQUIRED'
    case 'CONTEXT_LIMIT_EXCEEDED':
      return 'CONTEXT_LIMIT_EXCEEDED'
    case 'INVALID_MODEL_OUTPUT':
      return 'AI_OUTPUT_INVALID'
  }
}

async function responseApiError(response: Response, bucket: CooldownBucket) {
  const payload = await response.json().catch(() => ({})) as {
    code?: unknown
    error?: { code?: unknown; message?: unknown } | string
  }
  return apiRequestError(payload, response, bucket)
}

function apiRequestError(
  payload: { code?: unknown; error?: { code?: unknown; message?: unknown } | string },
  response: Response,
  bucket: CooldownBucket
) {
  const nestedCode = typeof payload.error === 'object' && payload.error !== null
    ? payload.error.code
    : undefined
  const code = typeof payload.code === 'string' ? payload.code : nestedCode
  return new ApiRequestError(
    typeof code === 'string' ? code : 'UNKNOWN',
    bucket,
    parseRetryAfter(response.headers?.get('Retry-After'))
  )
}
