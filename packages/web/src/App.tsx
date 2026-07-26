import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { Navigate, NavLink, Route, Routes, useSearchParams } from './router'

type Institution = {
  id: number
  name: string
  slug: string
  timezone: string
  kioskModeEnabled: number
  colorScheme: 'ocean' | 'emerald' | 'sunset' | 'violet'
  createdAt: string
}

type Demographic = {
  templateKey: string
  questionType: string
  prompt: string
  options: string[]
}

type Question = {
  id: number
  institutionId: number
  templateKey: string | null
  questionType: 'single' | 'multiple' | 'text' | 'scale' | 'boolean' | 'star'
  prompt: string
  options: string[]
  isActive: boolean
  includeInKiosk: boolean
  isDemographic: boolean
  displayOrder: number
  scheduleDays: number[]
  scheduleStartTime: string | null
  scheduleEndTime: string | null
  createdAt: string
}

type BootstrapPayload = {
  app: {
    name: string
    version: string
    readyz: string
    baseUrl: string
  }
  authOptions: Array<{ id: 'email_code' | 'magic_link'; label: string; description: string }>
  institutions: Institution[]
  demographics: Demographic[]
  foundationChecklist: string[]
  roadmapSnapshot: {
    currentStep: string
    nextStep: string
    questionBankSeeded: number
  }
  authCore: {
    supportedRoles: Array<'root' | 'institution_admin' | 'institution_user'>
    userStatuses: Array<'active' | 'suspended' | 'deactivated'>
    turnstileSiteKey: string
    devBypassTokenHint: string | null
  }
  questionTypes: string[]
}

type RootOverview = {
  institutionCount: number
  institutionUserCount: number
  demographicQuestionCount: number
  responseCount: number
  totalResponseCount: number
  kioskEnabledCount: number
  totalActiveQuestions: number
  kioskSessionsTotal: number
  kioskSessionsToday: number
  trendlinesEnabled: boolean
}

type AnalyticsData = {
  totalResponses: number
  responsesByQuestion: Array<{
    questionKey: string
    prompt: string
    questionType: string
    responses: Array<{ answer: string; count: number }>
  }>
  responsesPerDay: Array<{ date: string; count: number }>
  demographicBreakdown: Array<{
    questionKey: string
    prompt: string
    responses: Array<{ answer: string; count: number }>
  }>
}

type SmtpSettings = {
  username: string
  sendAddress: string
  serverAddress: string
  port: number
  secureLoginType: 'none' | 'ssl' | 'starttls'
  passwordSet: boolean
}

type SmtpFormState = {
  username: string
  password: string
  sendAddress: string
  serverAddress: string
  port: string
  secureLoginType: 'none' | 'ssl' | 'starttls'
}

type TwoFaPending = {
  challengePending: true
  email: string
  expiresAt: string
  preview: { otpCode: string }
}

type LoginResult =
  | TwoFaPending
  | { token: string; user: AuthUser; mustChangePassword: boolean }

type AuthUser = {
  id: number
  email: string
  role: 'root' | 'institution_admin' | 'institution_user'
  status: 'active' | 'suspended' | 'deactivated'
  institutionId: number | null
}

type TurnstileWidgetId = string | number

declare global {
  interface Window {
    turnstile?: {
      render: (
        container: HTMLElement,
        options: {
          sitekey: string
          theme?: 'light' | 'dark' | 'auto'
          callback?: (token: string) => void
          'expired-callback'?: () => void
          'error-callback'?: () => void
        },
      ) => TurnstileWidgetId
      remove: (widgetId: TurnstileWidgetId) => void
      reset: (widgetId?: TurnstileWidgetId) => void
    }
  }
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium transition ${
    isActive
      ? 'bg-[var(--brand-700)] text-white shadow-lg shadow-[color:var(--brand-shadow)]'
      : 'text-slate-600 hover:bg-[var(--brand-100)] hover:text-[var(--brand-900)]'
  }`

const statCardClass =
  'rounded-3xl border border-[var(--brand-100)] bg-white/95 p-5 shadow-sm shadow-[color:var(--brand-shadow)] ring-1 ring-white/60'

const institutionColorSchemes = {
  ocean: {
    label: 'Ocean',
    style: {
      '--brand-50': '#eff6ff',
      '--brand-100': '#dbeafe',
      '--brand-500': '#3b82f6',
      '--brand-600': '#2563eb',
      '--brand-700': '#1d4ed8',
      '--brand-900': '#1e3a8a',
      '--brand-shadow': 'rgba(37, 99, 235, 0.18)',
    },
  },
  emerald: {
    label: 'Emerald',
    style: {
      '--brand-50': '#ecfdf5',
      '--brand-100': '#d1fae5',
      '--brand-500': '#10b981',
      '--brand-600': '#059669',
      '--brand-700': '#047857',
      '--brand-900': '#064e3b',
      '--brand-shadow': 'rgba(5, 150, 105, 0.2)',
    },
  },
  sunset: {
    label: 'Sunset',
    style: {
      '--brand-50': '#fff7ed',
      '--brand-100': '#ffedd5',
      '--brand-500': '#f97316',
      '--brand-600': '#ea580c',
      '--brand-700': '#c2410c',
      '--brand-900': '#7c2d12',
      '--brand-shadow': 'rgba(194, 65, 12, 0.2)',
    },
  },
  violet: {
    label: 'Violet',
    style: {
      '--brand-50': '#f5f3ff',
      '--brand-100': '#ede9fe',
      '--brand-500': '#8b5cf6',
      '--brand-600': '#7c3aed',
      '--brand-700': '#6d28d9',
      '--brand-900': '#4c1d95',
      '--brand-shadow': 'rgba(109, 40, 217, 0.22)',
    },
  },
} as const

type InstitutionColorScheme = keyof typeof institutionColorSchemes

function TurnstileWidget({
  id,
  resetSignal,
  siteKey,
  onTokenChange,
}: {
  id: string
  resetSignal: number
  siteKey: string
  onTokenChange: (token: string) => void
}) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const widgetIdRef = useRef<TurnstileWidgetId | null>(null)

  useEffect(() => {
    let cancelled = false
    const scriptId = 'quickglimpse-turnstile-script'
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script')
      script.id = scriptId
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      document.head.appendChild(script)
    }

    const renderWidget = () => {
      if (cancelled || widgetIdRef.current !== null || !window.turnstile || !containerRef.current) {
        return Boolean(widgetIdRef.current)
      }
      widgetIdRef.current = window.turnstile.render(containerRef.current, {
        sitekey: siteKey,
        theme: 'light',
        callback: (token) => onTokenChange(token),
        'expired-callback': () => onTokenChange(''),
        'error-callback': () => onTokenChange(''),
      })
      return true
    }

    const interval = window.setInterval(() => {
      if (renderWidget()) {
        window.clearInterval(interval)
      }
    }, 100)
    renderWidget()

    return () => {
      cancelled = true
      window.clearInterval(interval)
      if (widgetIdRef.current !== null && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current)
        widgetIdRef.current = null
      }
    }
  }, [onTokenChange, siteKey])

  useEffect(() => {
    if (widgetIdRef.current !== null && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current)
      onTokenChange('')
    }
  }, [onTokenChange, resetSignal])

  return <div className="min-h-16" id={id} ref={containerRef} />
}

function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [passwordResetMessage, setPasswordResetMessage] = useState<string | null>(null)
  const [savingSmtp, setSavingSmtp] = useState(false)
  const [authToken, setAuthToken] = useState('')
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null)
  const [rootOverview, setRootOverview] = useState<RootOverview | null>(null)
  const [smtpSettings, setSmtpSettings] = useState<SmtpSettings | null>(null)
  const [pendingTwoFa, setPendingTwoFa] = useState<TwoFaPending | null>(null)
  const [mustChangePw, setMustChangePw] = useState(false)
  const [institutionList, setInstitutionList] = useState<Institution[]>([])
  const [turnstileToken, setTurnstileToken] = useState('dev-turnstile-pass')
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0)
  const [interestTurnstileToken, setInterestTurnstileToken] = useState('dev-turnstile-pass')
  const [interestTurnstileResetSignal, setInterestTurnstileResetSignal] = useState(0)
  const [interestMessage, setInterestMessage] = useState<string | null>(null)
  const [smtpForm, setSmtpForm] = useState<SmtpFormState>({
    username: '',
    password: '',
    sendAddress: '',
    serverAddress: '',
    port: '587',
    secureLoginType: 'starttls',
  })
  const [institutionQuestions, setInstitutionQuestions] = useState<Question[]>([])
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null)
  const [analyticsFrom, setAnalyticsFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [analyticsTo, setAnalyticsTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [smtpTestAddress, setSmtpTestAddress] = useState('')
  const [smtpTestResult, setSmtpTestResult] = useState<string | null>(null)
  const [savingColorSchemeFor, setSavingColorSchemeFor] = useState<number | null>(null)
  const [kioskState, setKioskState] = useState<'landing' | 'questions' | 'demographics' | 'thankyou'>('landing')
  const [kioskSessionToken, setKioskSessionToken] = useState<string | null>(null)
  const [kioskQuestions, setKioskQuestions] = useState<Question[]>([])
  const [kioskCurrentIdx, setKioskCurrentIdx] = useState(0)
  const [kioskCurrentAnswer, setKioskCurrentAnswer] = useState<string>('')
  const [kioskStarValue, setKioskStarValue] = useState(0)
  const [kioskSliderValue, setKioskSliderValue] = useState(5)
  const [kioskMultiAnswers, setKioskMultiAnswers] = useState<string[]>([])
  const [kioskDemoIdx, setKioskDemoIdx] = useState(0)
  const [kioskDemoAnswers, setKioskDemoAnswers] = useState<Record<string, string>>({})
  const [kioskCountdown, setKioskCountdown] = useState(10)
  const [kioskLoading, setKioskLoading] = useState(false)
  const [crossTabPrimary, setCrossTabPrimary] = useState('')
  const [crossTabDemo, setCrossTabDemo] = useState('')
  const [crossTabData, setCrossTabData] = useState<Array<{ primaryAnswer: string; demoAnswer: string; count: number | '< 5' }> | null>(null)
  const kioskPromptQuestions = useMemo(() => kioskQuestions.filter((q) => !q.isDemographic), [kioskQuestions])
  const kioskDemographicQuestions = useMemo(() => kioskQuestions.filter((q) => q.isDemographic), [kioskQuestions])
  const requiresTurnstileWidget = Boolean(bootstrap?.authCore.turnstileSiteKey && !bootstrap.authCore.devBypassTokenHint)

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/bootstrap')
        if (!response.ok) throw new Error('Unable to load bootstrap data.')
        const payload = (await response.json()) as BootstrapPayload
        setBootstrap(payload)
        setTurnstileToken(payload.authCore.devBypassTokenHint ?? '')
        setInterestTurnstileToken(payload.authCore.devBypassTokenHint ?? '')
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [])

  useEffect(() => {
    if (kioskState !== 'thankyou') return
    if (kioskCountdown <= 0) return
    const timer = setTimeout(() => {
      if (kioskCountdown === 1) {
        setKioskState('landing')
        setKioskSessionToken(null)
        setKioskDemoAnswers({})
        setKioskCountdown(10)
      } else {
        setKioskCountdown((c) => c - 1)
      }
    }, 1000)
    return () => clearTimeout(timer)
  }, [kioskState, kioskCountdown])

  const selectedInstitution = useMemo(() => {
    if (!bootstrap?.institutions?.length) {
      return null
    }
    if (sessionUser?.institutionId) {
      return bootstrap.institutions.find((institution) => institution.id === sessionUser.institutionId) ?? bootstrap.institutions[0]
    }
    return bootstrap.institutions[0]
  }, [bootstrap, sessionUser])
  const localTime = useMemo(() => {
    if (!selectedInstitution) return 'Unavailable'
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: selectedInstitution.timezone,
    }).format(new Date())
  }, [selectedInstitution])
  const activeColorScheme = (selectedInstitution?.colorScheme ?? 'ocean') as InstitutionColorScheme
  const appThemeStyle = useMemo(
    () =>
      ({
        ...institutionColorSchemes[activeColorScheme].style,
      }) as CSSProperties,
    [activeColorScheme],
  )

  const toggleKioskMode = async (institution: Institution) => {
    if (!authToken) {
      setError('Login first to manage kiosk mode.')
      return
    }

    setError(null)
    try {
      const response = await fetch(`/api/institutions/${institution.id}/kiosk-mode`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ enabled: institution.kioskModeEnabled === 0 }),
      })

      if (!response.ok) {
        throw new Error('Unable to update kiosk mode.')
      }

      const updated = (await response.json()) as Institution
      setBootstrap((current) => {
        if (!current) {
          return current
        }

        const institutions = current.institutions.map((item) => (item.id === updated.id ? updated : item))
        return {
          ...current,
          institutions,
        }
      })
      setRootOverview((current) =>
        current
          ? {
              ...current,
              kioskEnabledCount: Math.max(0, current.kioskEnabledCount + updated.kioskModeEnabled - institution.kioskModeEnabled),
            }
          : current,
      )
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to update kiosk mode.')
    }
  }

  const updateInstitutionColorScheme = async (institution: Institution, colorScheme: InstitutionColorScheme) => {
    if (!authToken) {
      setError('Login first to manage institutional colour scheme.')
      return
    }
    setError(null)
    setSavingColorSchemeFor(institution.id)
    try {
      const response = await fetch(`/api/institutions/${institution.id}/color-scheme`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ colorScheme }),
      })
      if (!response.ok) {
        const result = (await response.json()) as { error?: string }
        throw new Error(result.error ?? 'Unable to update colour scheme.')
      }
      const updated = (await response.json()) as Institution
      setBootstrap((current) => {
        if (!current) return current
        return {
          ...current,
          institutions: current.institutions.map((item) => (item.id === updated.id ? updated : item)),
        }
      })
      setInstitutionList((current) => current.map((item) => (item.id === updated.id ? updated : item)))
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to update colour scheme.')
    } finally {
      setSavingColorSchemeFor(null)
    }
  }

  const loadRootOverview = async (token: string) => {
    const response = await fetch('/api/root/overview', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to load root overview.')
    }
    setRootOverview((await response.json()) as RootOverview)
  }

  const loadSmtpSettings = async (token: string) => {
    const response = await fetch('/api/settings/smtp', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to load SMTP settings.')
    }
    const settings = (await response.json()) as SmtpSettings
    setSmtpSettings(settings)
    setSmtpForm({
      username: settings.username,
      password: '',
      sendAddress: settings.sendAddress,
      serverAddress: settings.serverAddress,
      port: `${settings.port}`,
      secureLoginType: settings.secureLoginType,
    })
  }

  const saveSmtpSettings = async (event: FormEvent<HTMLFormElement>) => {
    if (!authToken) {
      setError('Administrator access is required to manage SMTP settings.')
      return
    }
    if (sessionUser?.role !== 'root') {
      setError('Administrator access is required to manage SMTP settings.')
      return
    }

    event.preventDefault()
    setSavingSmtp(true)
    setError(null)
    try {
      const response = await fetch('/api/settings/smtp', {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${authToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...smtpForm,
          port: Number(smtpForm.port),
        }),
      })

      if (!response.ok) {
        throw new Error('Unable to save SMTP settings.')
      }

      const updatedSmtpSettings = (await response.json()) as SmtpSettings
      setSmtpSettings(updatedSmtpSettings)
      setSmtpForm((current) => ({ ...current, password: '' }))
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to save SMTP settings.')
    } finally {
      setSavingSmtp(false)
    }
  }

  const requestPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setPasswordResetMessage(null)
    try {
      const formData = new FormData(event.currentTarget)
      const email = String(formData.get('email') ?? '')
      const response = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      if (!response.ok) {
        throw new Error('Unable to request password reset.')
      }

      setPasswordResetMessage('If the account exists, password reset instructions will be sent.')
      event.currentTarget.reset()
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to request password reset.')
    }
  }

  const submitInstitutionInterest = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    setInterestMessage(null)
    const form = event.currentTarget
    const formData = new FormData(form)
    const response = await fetch('/api/institution-interest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        institutionName: String(formData.get('institutionName') ?? ''),
        contactName: String(formData.get('contactName') ?? ''),
        email: String(formData.get('email') ?? ''),
        notes: String(formData.get('notes') ?? ''),
        turnstileToken: interestTurnstileToken,
      }),
    })

    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      setInterestTurnstileResetSignal((current) => current + 1)
      throw new Error(result.error ?? 'Unable to register interest.')
    }

    setInterestMessage('Thank you. Your interest has been received.')
    form.reset()
    setInterestTurnstileResetSignal((current) => current + 1)
  }

  const loginAuthUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const formData = new FormData(event.currentTarget)
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: String(formData.get('email') ?? ''),
        password: String(formData.get('password') ?? ''),
        turnstileToken,
      }),
    })

    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      setTurnstileResetSignal((current) => current + 1)
      throw new Error(result.error ?? 'Unable to login.')
    }

    const result = (await response.json()) as LoginResult
    if ('challengePending' in result && result.challengePending) {
      setPendingTwoFa(result)
      return
    }
    const session = result as { token: string; user: AuthUser; mustChangePassword: boolean }
    setAuthToken(session.token)
    setSessionUser(session.user)
    if (session.mustChangePassword) {
      setMustChangePw(true)
    }
    if (session.user.role === 'root') {
      await Promise.all([loadRootOverview(session.token), loadSmtpSettings(session.token), loadInstitutionList(session.token)])
    }
  }

  const verify2FA = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!pendingTwoFa) return
    setError(null)
    const formData = new FormData(event.currentTarget)
    const response = await fetch('/api/auth/challenges/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: pendingTwoFa.email, code: String(formData.get('code') ?? '') }),
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'OTP verification failed.')
    }
    const result = (await response.json()) as { token: string; user: AuthUser; mustChangePassword: boolean }
    setPendingTwoFa(null)
    setAuthToken(result.token)
    setSessionUser(result.user)
    if (result.mustChangePassword) setMustChangePw(true)
    if (result.user.role === 'root') {
      await Promise.all([loadRootOverview(result.token), loadSmtpSettings(result.token), loadInstitutionList(result.token)])
    }
  }

  const toggle2FA = async (userId: number, enabled: boolean) => {
    if (!authToken) return
    const response = await fetch(`/api/auth/users/${userId}/2fa`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled }),
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to toggle 2FA.')
    }
  }

  const changePassword = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!authToken) return
    setError(null)
    const formData = new FormData(event.currentTarget)
    const response = await fetch('/api/auth/profile/password', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: String(formData.get('currentPassword') ?? ''),
        newPassword: String(formData.get('newPassword') ?? ''),
      }),
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to change password.')
    }
    setMustChangePw(false)
    event.currentTarget.reset()
  }

  const loadInstitutionList = async (token: string) => {
    const response = await fetch('/api/institutions', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return
    const result = (await response.json()) as { institutions: Institution[] }
    setInstitutionList(result.institutions)
  }

  const createInstitution = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!authToken) return
    setError(null)
    const formData = new FormData(event.currentTarget)
    const response = await fetch('/api/institutions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: String(formData.get('name') ?? '') }),
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to create institution.')
    }
    const inst = (await response.json()) as Institution
    setInstitutionList((current) => [...current, inst])
    event.currentTarget.reset()
  }

  const deleteInstitution = async (id: number) => {
    if (!authToken) return
    setError(null)
    const response = await fetch(`/api/institutions/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to delete institution.')
    }
    setInstitutionList((current) => current.filter((inst) => inst.id !== id))
  }

  const loadInstitutionQuestions = async (institutionId: number, token: string) => {
    const response = await fetch(`/api/institutions/${institutionId}/questions`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return
    const result = (await response.json()) as { questions: Question[] }
    setInstitutionQuestions(result.questions)
  }

  const toggleQuestionKiosk = async (question: Question) => {
    if (!authToken) return
    const response = await fetch(`/api/institutions/${question.institutionId}/questions/${question.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ includeInKiosk: !question.includeInKiosk }),
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to update question.')
    }
    const updated = (await response.json()) as Question
    setInstitutionQuestions((current) => current.map((q) => (q.id === updated.id ? updated : q)))
  }

  const createCustomQuestion = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!authToken) return
    setError(null)
    const formData = new FormData(event.currentTarget)
    const institutionId = selectedInstitution?.id
    if (!institutionId) return
    const optionsRaw = String(formData.get('options') ?? '')
    const options = optionsRaw ? optionsRaw.split(',').map((s) => s.trim()).filter(Boolean) : []
    const scheduleDaysRaw = String(formData.get('scheduleDays') ?? '')
    const scheduleDays = scheduleDaysRaw ? scheduleDaysRaw.split(',').map(Number).filter((n) => !isNaN(n) && n >= 0 && n <= 6) : []
    const response = await fetch(`/api/institutions/${institutionId}/questions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionType: String(formData.get('questionType') ?? 'text'),
        prompt: String(formData.get('prompt') ?? ''),
        options,
        includeInKiosk: formData.get('includeInKiosk') === 'true',
        isDemographic: formData.get('isDemographic') === 'true',
        displayOrder: Number(formData.get('displayOrder') ?? 0),
        scheduleDays,
        scheduleStartTime: String(formData.get('scheduleStartTime') ?? '') || null,
        scheduleEndTime: String(formData.get('scheduleEndTime') ?? '') || null,
      }),
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to create question.')
    }
    const created = (await response.json()) as Question
    setInstitutionQuestions((current) => [...current, created])
    event.currentTarget.reset()
  }

  const deleteQuestion = async (question: Question) => {
    if (!authToken) return
    setError(null)
    const response = await fetch(`/api/institutions/${question.institutionId}/questions/${question.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to delete question.')
    }
    setInstitutionQuestions((current) => current.filter((q) => q.id !== question.id))
  }

  const loadAnalytics = async (institutionId: number, token: string) => {
    const params = new URLSearchParams()
    if (analyticsFrom) params.set('from', analyticsFrom)
    if (analyticsTo) params.set('to', analyticsTo)
    const response = await fetch(`/api/institutions/${institutionId}/analytics?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return
    setAnalyticsData((await response.json()) as AnalyticsData)
  }

  const loadCrossTab = async () => {
    if (!authToken || !selectedInstitution) return
    const params = new URLSearchParams({ primaryKey: crossTabPrimary, demographicKey: crossTabDemo })
    const response = await fetch(`/api/institutions/${selectedInstitution.id}/analytics/cross-tab?${params.toString()}`, {
      headers: { Authorization: `Bearer ${authToken}` },
    })
    if (!response.ok) return
    const data = (await response.json()) as { cells: Array<{ primaryAnswer: string; demoAnswer: string; count: number | '< 5' }> }
    setCrossTabData(data.cells)
  }

  const sendSmtpTestEmail = async () => {
    if (!authToken || !smtpTestAddress) return
    setError(null)
    setSmtpTestResult(null)
    try {
      const response = await fetch('/api/settings/smtp/test', {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ toAddress: smtpTestAddress }),
      })
      const result = (await response.json()) as { message?: string; error?: string }
      if (!response.ok) throw new Error(result.error ?? 'Test email failed.')
      setSmtpTestResult(result.message ?? 'Test email sent.')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Test email failed.')
    }
  }

  const startKiosk = async () => {
    setKioskLoading(true)
    setError(null)
    try {
      const slug = selectedInstitution?.slug
      if (!slug) return
      const response = await fetch(`/api/kiosk/${slug}/session`, { method: 'POST' })
      if (!response.ok) {
        const result = (await response.json()) as { error?: string }
        throw new Error(result.error ?? 'Unable to start kiosk session.')
      }
      const data = (await response.json()) as { sessionToken: string; questions: Question[] }
      const hasPromptQuestions = data.questions.some((question) => !question.isDemographic)
      const hasDemographicQuestions = data.questions.some((question) => question.isDemographic)
      setKioskSessionToken(data.sessionToken)
      setKioskQuestions(data.questions)
      setKioskCurrentIdx(0)
      setKioskCurrentAnswer('')
      setKioskStarValue(0)
      setKioskSliderValue(5)
      setKioskMultiAnswers([])
      setKioskDemoAnswers({})
      setKioskDemoIdx(0)
      setKioskState(hasPromptQuestions ? 'questions' : hasDemographicQuestions ? 'demographics' : 'thankyou')
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to start kiosk session.')
    } finally {
      setKioskLoading(false)
    }
  }

  const submitKioskAnswer = async () => {
    const question = kioskPromptQuestions[kioskCurrentIdx]
    if (!question || !kioskSessionToken) return
    setKioskLoading(true)
    try {
      let answer: unknown = kioskCurrentAnswer
      if (question.questionType === 'star') answer = kioskStarValue
      else if (question.questionType === 'scale') answer = kioskSliderValue
      else if (question.questionType === 'multiple') answer = kioskMultiAnswers
      else if (question.questionType === 'boolean') answer = kioskCurrentAnswer === 'yes'
      const qKey = question.templateKey ?? `iq-${question.id}`
      await fetch('/api/kiosk/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: kioskSessionToken, questionKey: qKey, answer }),
      })
      const nextIdx = kioskCurrentIdx + 1
      if (nextIdx < kioskPromptQuestions.length) {
        setKioskCurrentIdx(nextIdx)
        setKioskCurrentAnswer('')
        setKioskStarValue(0)
        setKioskSliderValue(5)
        setKioskMultiAnswers([])
      } else {
        if (kioskDemographicQuestions.length > 0) {
          setKioskState('demographics')
          setKioskDemoIdx(0)
        } else {
          await completeKiosk({})
        }
      }
    } finally {
      setKioskLoading(false)
    }
  }

  const advanceKioskDemographic = async (skip: boolean) => {
    if (!kioskSessionToken) return
    const currentDemo = kioskDemographicQuestions[kioskDemoIdx]
    if (!currentDemo) {
      await completeKiosk(kioskDemoAnswers)
      return
    }

    const questionKey = currentDemo.templateKey ?? `iq-${currentDemo.id}`
    const answer = kioskDemoAnswers[questionKey]

    if (!skip && answer) {
      await fetch('/api/kiosk/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: kioskSessionToken, questionKey, answer }),
      })
    }

    if (kioskDemoIdx + 1 < kioskDemographicQuestions.length) {
      setKioskDemoIdx((i) => i + 1)
    } else {
      await completeKiosk(kioskDemoAnswers)
    }
  }

  const completeKiosk = async (demoData: Record<string, string>) => {
    if (!kioskSessionToken) return
    await fetch('/api/kiosk/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: kioskSessionToken, demographicData: demoData }),
    })
    setKioskState('thankyou')
    setKioskCountdown(10)
  }

  if (loading) {
    return <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">Loading Quick Glimpse…</div>
  }

  if (!bootstrap) {
    return <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">{error ?? 'Bootstrap data unavailable.'}</div>
  }

  return (
    <Routes>
      <Route path="/kiosk" element={sessionUser ? <KioskFullScreen
        institution={selectedInstitution}
        colorScheme={activeColorScheme}
        kioskState={kioskState}
        kioskLoading={kioskLoading}
        kioskQuestions={kioskQuestions}
        kioskCurrentIdx={kioskCurrentIdx}
        kioskCurrentAnswer={kioskCurrentAnswer}
        kioskStarValue={kioskStarValue}
        kioskSliderValue={kioskSliderValue}
        kioskMultiAnswers={kioskMultiAnswers}
        kioskDemoIdx={kioskDemoIdx}
        kioskDemoAnswers={kioskDemoAnswers}
        kioskCountdown={kioskCountdown}
        error={error}
        onStart={() => void startKiosk()}
        onAnswer={setKioskCurrentAnswer}
        onStarChange={setKioskStarValue}
        onSliderChange={setKioskSliderValue}
        onMultiToggle={(opt) => setKioskMultiAnswers((current) => current.includes(opt) ? current.filter((o) => o !== opt) : [...current, opt])}
        onSubmitAnswer={() => void submitKioskAnswer()}
        onDemoAnswer={(key, val) => setKioskDemoAnswers((current) => ({ ...current, [key]: val }))}
        onComplete={() => void completeKiosk(kioskDemoAnswers)}
        onDemoSkip={() => void advanceKioskDemographic(true)}
        onDemoNext={() => void advanceKioskDemographic(false)}
      /> : <Navigate to="/auth-core" replace />} />
      <Route path="*" element={
    <div className="min-h-screen bg-gradient-to-b from-[var(--brand-50)] via-white to-slate-50 text-slate-900" style={appThemeStyle}>
      <header className="border-b border-[var(--brand-100)] bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--brand-700)]">Visitor feedback platform</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{bootstrap.app.name}</h1>
            <p className="mt-3 max-w-3xl text-slate-600">
              Quick Glimpse helps organizations capture in-person feedback quickly with kiosk surveys, secure sign-in, and easy analytics.
            </p>
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-6xl gap-2 overflow-x-auto px-6 pb-6">
          {!sessionUser ? (
            <>
              <NavLink className={navClass} to="/">Home</NavLink>
              <NavLink className={navClass} to="/auth-core">Sign in</NavLink>
            </>
          ) : (
            <>
              <NavLink className={navClass} to="/">Overview</NavLink>
              <NavLink className={navClass} to="/auth-core">Auth core</NavLink>
              <NavLink className={navClass} to="/profile">Profile</NavLink>
              <NavLink className={navClass} to="/institutions">Institutions</NavLink>
              <NavLink className={navClass} to="/kiosk">Kiosk preview</NavLink>
              <NavLink className={navClass} to="/questions">Questions</NavLink>
              <NavLink className={navClass} to="/analytics">Analytics</NavLink>
              {sessionUser.role === 'root' ? (
                <>
                  <NavLink className={navClass} to="/root">Root</NavLink>
                  <NavLink className={navClass} to="/smtp">SMTP</NavLink>
                </>
              ) : null}
            </>
          )}
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 md:px-6">
        {error ? <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">{error}</div> : null}
        <Routes>
          {!sessionUser ? (
            <>
              <Route path="/institutions" element={<Navigate to="/auth-core" replace />} />
              <Route path="/kiosk" element={<Navigate to="/auth-core" replace />} />
              <Route path="/root" element={<Navigate to="/auth-core" replace />} />
              <Route path="/questions" element={<Navigate to="/auth-core" replace />} />
              <Route path="/analytics" element={<Navigate to="/auth-core" replace />} />
              <Route path="/profile" element={<Navigate to="/auth-core" replace />} />
              <Route path="/smtp" element={<Navigate to="/auth-core" replace />} />
            </>
          ) : null}
          <Route
            path="/"
            element={
              !sessionUser ? (
                <div className="grid gap-8">
                  <section className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
                    <div className="py-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-700)]">Visitor feedback for institutions</p>
                      <h2 className="mt-4 max-w-3xl text-4xl font-semibold leading-tight tracking-tight text-slate-950 md:text-5xl">
                        Understand your visitors in the moment.
                      </h2>
                      <p className="mt-5 max-w-2xl text-lg leading-8 text-slate-700">
                        Quick Glimpse is a lightweight web app that helps institutions collect simple feedback,
                        understand their audience, and share useful information through tablets, kiosks, or QR-code links.
                      </p>
                      <div className="mt-7 flex flex-wrap items-center gap-3">
                        <NavLink
                          className="rounded-full bg-[var(--brand-700)] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[color:var(--brand-shadow)]"
                          to="/auth-core"
                        >
                          Sign in
                        </NavLink>
                      </div>
                    </div>
                    <form
                      className="rounded-2xl border border-[var(--brand-100)] bg-white p-5 shadow-sm shadow-[color:var(--brand-shadow)]"
                      onSubmit={(event) => void submitInstitutionInterest(event).catch((caughtError: unknown) => setError(caughtError instanceof Error ? caughtError.message : 'Interest registration failed.'))}
                    >
                      <h3 className="text-lg font-semibold text-slate-950">Register institutional interest</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        Leave a placeholder enquiry for a school, health service, venue, or public-facing team.
                      </p>
                      <div className="mt-5 grid gap-3">
                        <input className="rounded-xl border border-slate-300 px-3 py-2" name="institutionName" placeholder="Institution name" required type="text" />
                        <input className="rounded-xl border border-slate-300 px-3 py-2" name="contactName" placeholder="Contact name" required type="text" />
                        <input className="rounded-xl border border-slate-300 px-3 py-2" name="email" placeholder="Email address" required type="email" />
                        <textarea
                          className="min-h-28 rounded-xl border border-slate-300 px-3 py-2"
                          name="notes"
                          placeholder="Where would you use Quick Glimpse?"
                        />
                        {requiresTurnstileWidget && bootstrap.authCore.turnstileSiteKey ? (
                          <TurnstileWidget
                            id="quickglimpse-interest-turnstile"
                            resetSignal={interestTurnstileResetSignal}
                            siteKey={bootstrap.authCore.turnstileSiteKey}
                            onTokenChange={setInterestTurnstileToken}
                          />
                        ) : null}
                        <button
                          className="w-fit rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300"
                          disabled={requiresTurnstileWidget && !interestTurnstileToken}
                          type="submit"
                        >
                          Register interest
                        </button>
                      </div>
                      {interestMessage ? (
                        <p className="mt-3 text-sm text-emerald-700">{interestMessage}</p>
                      ) : null}
                    </form>
                  </section>
                  <section className="grid gap-4 md:grid-cols-4">
                    <article className={statCardClass}>
                      <h3 className="text-base font-semibold">Ask short questions</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-700">Invite visitors to answer quick prompts while the experience is still fresh.</p>
                    </article>
                    <article className={statCardClass}>
                      <h3 className="text-base font-semibold">Use tablets or QR codes</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-700">Run it on a shared device or let people respond on their own phone.</p>
                    </article>
                    <article className={statCardClass}>
                      <h3 className="text-base font-semibold">Share information</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-700">Give visitors useful guidance alongside the questions you need answered.</p>
                    </article>
                    <article className={statCardClass}>
                      <h3 className="text-base font-semibold">See simple patterns</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-700">Help staff understand who is visiting and what people are telling them.</p>
                    </article>
                  </section>
                </div>
              ) : (
                <div className="grid gap-6">
                  <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                    <article className={statCardClass}>
                      <p className="text-sm font-medium text-slate-500">Institutions</p>
                      <p className="mt-3 text-3xl font-semibold">{bootstrap.institutions.length}</p>
                      <p className="mt-2 text-sm text-slate-600">Institution-local timezone support starts with the seeded sample institution.</p>
                    </article>
                    <article className={statCardClass}>
                      <p className="text-sm font-medium text-slate-500">Kiosk-enabled</p>
                      <p className="mt-3 text-3xl font-semibold">{bootstrap.institutions.filter((item) => item.kioskModeEnabled).length}</p>
                      <p className="mt-2 text-sm text-slate-600">Institutional users can toggle kiosk mode without escalation to platform administration.</p>
                    </article>
                    <article className={statCardClass}>
                      <p className="text-sm font-medium text-slate-500">Demographic prompts</p>
                      <p className="mt-3 text-3xl font-semibold">{bootstrap.demographics.length}</p>
                      <p className="mt-2 text-sm text-slate-600">Seeded from the confirmed question bank.</p>
                    </article>
                    <article className={statCardClass}>
                      <p className="text-sm font-medium text-slate-500">Question formats</p>
                      <p className="mt-3 text-xl font-semibold">{(bootstrap.questionTypes ?? ['single', 'multiple', 'text', 'scale', 'boolean', 'star']).length}</p>
                      <p className="mt-2 text-sm text-slate-600">Configured feedback styles available for live kiosks.</p>
                    </article>
                  </section>
                  <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                    <article className={statCardClass}>
                      <h2 className="text-xl font-semibold">Platform capabilities</h2>
                      <ul className="mt-4 grid gap-3 text-sm text-slate-700">
                        {bootstrap.foundationChecklist.map((item) => (
                          <li key={item} className="flex gap-3 rounded-xl bg-slate-50 px-3 py-3">
                            <span className="mt-0.5 text-emerald-600">●</span>
                            <span>{item}</span>
                          </li>
                        ))}
                      </ul>
                    </article>
                    <article className={statCardClass}>
                      <h2 className="text-xl font-semibold">Auth delivery choices</h2>
                      <div className="mt-4 grid gap-3 text-sm text-slate-700">
                        {bootstrap.authOptions.map((option) => (
                          <div key={option.id} className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <div className="font-medium text-slate-900">{option.label}</div>
                            <p className="mt-1">{option.description}</p>
                          </div>
                        ))}
                      </div>
                    </article>
                  </section>
                </div>
              )
            }
          />
          <Route
            path="/auth-core"
            element={
              <section className="mx-auto grid w-full max-w-5xl gap-8 py-4 lg:grid-cols-[0.9fr_1.1fr] lg:items-center lg:py-10">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-700)]">Account access</p>
                  <h2 className="mt-4 text-4xl font-semibold leading-tight tracking-tight text-slate-950 md:text-5xl">
                    Sign in to Quick Glimpse.
                  </h2>
                  <p className="mt-5 max-w-md text-base leading-7 text-slate-600">
                    Use your institutional account to continue to the right workspace for your role.
                  </p>
                  <NavLink className="mt-7 inline-flex text-sm font-semibold text-[var(--brand-700)] underline underline-offset-4" to="/">
                    Back to home
                  </NavLink>
                </div>
                <article className="rounded-2xl border border-[var(--brand-100)] bg-white p-6 shadow-sm shadow-[color:var(--brand-shadow)]">
                  <h3 className="text-xl font-semibold text-slate-950">Login</h3>
                  <form className="mt-5 grid gap-3" onSubmit={(event) => void loginAuthUser(event).catch((caughtError: unknown) => setError(caughtError instanceof Error ? caughtError.message : 'Login failed.'))}>
                    <input className="rounded-xl border border-slate-300 px-3 py-2" name="email" placeholder="Email address" required type="email" />
                    <input className="rounded-xl border border-slate-300 px-3 py-2" name="password" placeholder="Password" required type="password" />
                    {requiresTurnstileWidget && bootstrap.authCore.turnstileSiteKey ? (
                      <TurnstileWidget
                        id="quickglimpse-login-turnstile"
                        resetSignal={turnstileResetSignal}
                        siteKey={bootstrap.authCore.turnstileSiteKey}
                        onTokenChange={setTurnstileToken}
                      />
                    ) : null}
                    <button
                      className="w-fit rounded-full bg-[var(--brand-700)] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[color:var(--brand-shadow)] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
                      disabled={requiresTurnstileWidget && !turnstileToken}
                      type="submit"
                    >
                      Sign in
                    </button>
                  </form>
                  <details className="mt-5 border-t border-slate-200 pt-5">
                    <summary className="cursor-pointer text-sm font-semibold text-slate-700">Forgot password?</summary>
                    <form className="mt-4 grid gap-3" onSubmit={(event) => void requestPasswordReset(event)}>
                      <input className="rounded-xl border border-slate-300 px-3 py-2" name="email" placeholder="Email address" required type="email" />
                      <button className="w-fit rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white" type="submit">
                        Request reset
                      </button>
                    </form>
                    {passwordResetMessage ? (
                      <p className="mt-3 text-sm text-emerald-700">{passwordResetMessage}</p>
                    ) : null}
                  </details>
                    {pendingTwoFa ? (
                      <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-4 text-sm">
                        <div className="font-semibold text-sky-900">2FA required</div>
                        <div className="mt-1 text-sky-700">Enter the OTP sent to {pendingTwoFa.email}</div>
                        {pendingTwoFa.preview.otpCode ? <div className="mt-1 font-mono text-sky-800">One-time code: {pendingTwoFa.preview.otpCode}</div> : null}
                        <form className="mt-3 flex gap-2" onSubmit={(event) => void verify2FA(event).catch((err: unknown) => setError(err instanceof Error ? err.message : '2FA failed.'))}>
                          <input className="rounded-xl border border-slate-300 px-3 py-2 font-mono" name="code" placeholder="000000" required />
                          <button className="rounded-full bg-sky-700 px-4 py-2 text-sm font-semibold text-white" type="submit">Verify</button>
                        </form>
                      </div>
                    ) : null}
                    {mustChangePw ? (
                      <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-4 text-sm">
                        <div className="font-semibold text-amber-900">Password change required</div>
                        <p className="mt-1 text-amber-700">Your account requires a password change before you can continue.</p>
                        <form className="mt-3 grid gap-2" onSubmit={(event) => void changePassword(event).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Password change failed.'))}>
                          <input className="rounded-xl border border-slate-300 px-3 py-2" name="currentPassword" placeholder="Current password" required type="password" />
                          <input className="rounded-xl border border-slate-300 px-3 py-2" name="newPassword" placeholder="New password (min 10 chars)" required type="password" />
                          <button className="w-fit rounded-full bg-amber-700 px-4 py-2 text-sm font-semibold text-white" type="submit">Change password</button>
                        </form>
                      </div>
                    ) : null}
                </article>
              </section>
            }
          />
          <Route
            path="/institutions"
            element={
              <section className="grid gap-6">
                {sessionUser?.role === 'root' ? (
                  <article className={statCardClass}>
                    <h2 className="text-xl font-semibold">Manage institutions (administrator-only)</h2>
                    <form className="mt-4 flex gap-3" onSubmit={(event) => void createInstitution(event).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed.'))}>
                      <input className="flex-1 rounded-xl border border-slate-300 px-3 py-2" name="name" placeholder="Institution name" required />
                      <button className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white" type="submit">Create</button>
                    </form>
                    <div className="mt-4 grid gap-3 text-sm">
                      {institutionList.map((inst) => (
                        <div className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-4 py-3" key={inst.id}>
                          <div>
                            <div className="font-medium text-slate-900">{inst.name}</div>
                            <div className="text-slate-500">{inst.slug} · {inst.timezone}</div>
                          </div>
                          <button className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-300" onClick={() => void deleteInstitution(inst.id).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed.'))} type="button">Delete</button>
                        </div>
                      ))}
                    </div>
                  </article>
                ) : null}
                <div className="grid gap-4 md:grid-cols-2">
                  {bootstrap.institutions.map((institution) => (
                    <article className={statCardClass} key={institution.id}>
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-700)]">Institution</p>
                          <h2 className="mt-2 text-xl font-semibold">{institution.name}</h2>
                          <p className="mt-2 text-sm text-slate-600">Slug: {institution.slug}</p>
                          <p className="mt-1 text-sm text-slate-600">Timezone: {institution.timezone}</p>
                          <p className="mt-1 text-sm text-slate-600">Theme: {institutionColorSchemes[institution.colorScheme]?.label ?? institution.colorScheme}</p>
                        </div>
                        <button
                          className={`rounded-full px-4 py-2 text-sm font-semibold ${institution.kioskModeEnabled ? 'bg-[var(--brand-600)] text-white' : 'bg-slate-200 text-slate-900'}`}
                          onClick={() => void toggleKioskMode(institution)}
                          type="button"
                        >
                          {institution.kioskModeEnabled ? 'Kiosk on' : 'Kiosk off'}
                        </button>
                      </div>
                      {sessionUser?.role === 'root' || (sessionUser?.role === 'institution_admin' && sessionUser.institutionId === institution.id) ? (
                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <label className="text-sm font-medium text-slate-700">Institution colour scheme</label>
                          <select
                            className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
                            disabled={savingColorSchemeFor === institution.id}
                            value={institution.colorScheme}
                            onChange={(event) => void updateInstitutionColorScheme(institution, event.target.value as InstitutionColorScheme)}
                          >
                            {Object.entries(institutionColorSchemes).map(([value, scheme]) => (
                              <option key={value} value={value}>
                                {scheme.label}
                              </option>
                            ))}
                          </select>
                        </div>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>
            }
          />
          <Route
            path="/kiosk"
            element={
              <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Kiosk preview</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Use the full-screen kiosk at <code>/kiosk</code>. Below is a preview of kiosk status for the selected institution.
                  </p>
                  {selectedInstitution ? (
                    <div className="mt-5 grid gap-3 text-sm text-slate-700">
                      <div className="rounded-xl bg-slate-50 px-4 py-3">
                        <div className="font-medium text-slate-900">Institution</div>
                        <div>{selectedInstitution.name}</div>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-4 py-3">
                        <div className="font-medium text-slate-900">Kiosk mode</div>
                        <div>{selectedInstitution.kioskModeEnabled ? 'Enabled' : 'Disabled'}</div>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-4 py-3">
                        <div className="font-medium text-slate-900">Current local time</div>
                        <div>{localTime}</div>
                      </div>
                    </div>
                  ) : null}
                </article>
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Launch kiosk</h2>
                  <div className="mt-4 rounded-2xl bg-slate-950 px-5 py-6 text-sm text-slate-200">
                    <div className="font-semibold text-emerald-300">/kiosk</div>
                    <p className="mt-2">Navigate to the kiosk route for the full-screen patient feedback experience.</p>
                  </div>
                  <a
                    href="/kiosk"
                    className="mt-4 inline-block rounded-full bg-[var(--brand-700)] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[color:var(--brand-shadow)]"
                  >
                    Open full-screen kiosk
                  </a>
                </article>
              </section>
            }
          />
          <Route
            path="/root"
            element={
              <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Aggregate-only platform dashboard</h2>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="text-sm text-slate-500">Institution users</div>
                      <div className="mt-2 text-3xl font-semibold">{rootOverview?.institutionUserCount ?? '—'}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="text-sm text-slate-500">Total responses</div>
                      <div className="mt-2 text-3xl font-semibold">{rootOverview?.totalResponseCount ?? rootOverview?.responseCount ?? '—'}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="text-sm text-slate-500">Kiosk-enabled institutions</div>
                      <div className="mt-2 text-3xl font-semibold">{rootOverview?.kioskEnabledCount ?? '—'}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="text-sm text-slate-500">Active questions</div>
                      <div className="mt-2 text-3xl font-semibold">{rootOverview?.totalActiveQuestions ?? '—'}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="text-sm text-slate-500">Kiosk sessions today</div>
                      <div className="mt-2 text-3xl font-semibold">{rootOverview?.kioskSessionsToday ?? '—'}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="text-sm text-slate-500">Kiosk sessions total</div>
                      <div className="mt-2 text-3xl font-semibold">{rootOverview?.kioskSessionsTotal ?? '—'}</div>
                    </div>
                  </div>
                </article>
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Institution health</h2>
                  {!rootOverview ? (
                    <p className="mt-3 text-sm text-amber-700">Administrator access is required to load aggregate metrics.</p>
                  ) : (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-sm text-slate-700">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <th className="pb-2 pr-4">Institution</th>
                            <th className="pb-2 pr-4">Kiosk</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {bootstrap.institutions.map((inst) => (
                            <tr key={inst.id}>
                              <td className="py-2 pr-4 font-medium">{inst.name}</td>
                              <td className="py-2 pr-4">
                                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${inst.kioskModeEnabled ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>
                                  {inst.kioskModeEnabled ? 'On' : 'Off'}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="mt-4 text-sm text-slate-500">
                    Administrative access sees high-level counts only. Trendlines disabled by requirement.
                  </p>
                </article>
              </section>
            }
          />
          <Route
            path="/questions"
            element={
              <section className="grid gap-6">
                <div className="flex items-center justify-between">
                  <h2 className="text-xl font-semibold">Institution questions</h2>
                  {selectedInstitution && authToken ? (
                    <button
                      className="rounded-full bg-[var(--brand-700)] px-4 py-2 text-sm font-semibold text-white"
                      onClick={() => void loadInstitutionQuestions(selectedInstitution.id, authToken)}
                      type="button"
                    >
                      Reload
                    </button>
                  ) : null}
                </div>
                {!authToken ? (
                  <p className="text-sm text-amber-700">Login required to manage questions.</p>
                ) : (
                  <>
                    {institutionQuestions.length === 0 && selectedInstitution ? (
                      <button
                        className="w-fit rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white"
                        onClick={() => void loadInstitutionQuestions(selectedInstitution.id, authToken)}
                        type="button"
                      >
                        Load questions
                      </button>
                    ) : null}
                    <div className="grid gap-3">
                      {institutionQuestions.map((question) => (
                        <article className={statCardClass} key={question.id}>
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-semibold text-slate-900">{question.prompt}</span>
                                <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-sky-800">{question.questionType}</span>
                                {question.isDemographic ? (
                                  <span className="rounded-full bg-purple-100 px-2 py-0.5 text-xs font-semibold text-purple-800">Demographic</span>
                                ) : null}
                                {question.includeInKiosk ? (
                                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-semibold text-emerald-800">In kiosk</span>
                                ) : null}
                              </div>
                              {question.options.length > 0 ? (
                                <ul className="mt-2 flex flex-wrap gap-1 text-xs text-slate-600">
                                  {question.options.map((opt) => (
                                    <li className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5" key={opt}>{opt}</li>
                                  ))}
                                </ul>
                              ) : null}
                            </div>
                            <div className="flex gap-2">
                              <button
                                className="rounded-full bg-slate-200 px-3 py-1.5 text-xs font-semibold text-slate-700"
                                onClick={() => void toggleQuestionKiosk(question).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Update failed.'))}
                                type="button"
                              >
                                {question.includeInKiosk ? 'Remove from kiosk' : 'Add to kiosk'}
                              </button>
                              {!question.templateKey || question.templateKey.startsWith('custom-') ? (
                                <button
                                  className="rounded-full bg-red-100 px-3 py-1.5 text-xs font-semibold text-red-700"
                                  onClick={() => void deleteQuestion(question).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Delete failed.'))}
                                  type="button"
                                >
                                  Delete
                                </button>
                              ) : null}
                            </div>
                          </div>
                        </article>
                      ))}
                    </div>
                    <article className={statCardClass}>
                      <h2 className="text-lg font-semibold">Create custom question</h2>
                      <form className="mt-4 grid gap-4" onSubmit={(event) => void createCustomQuestion(event).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Create failed.'))}>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <label className="grid gap-2 text-sm font-medium">
                            Type
                            <select className="rounded-xl border border-slate-300 px-3 py-2" name="questionType">
                              {(bootstrap.questionTypes ?? ['text', 'single', 'multiple', 'scale', 'boolean', 'star']).map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>
                          </label>
                          <label className="grid gap-2 text-sm font-medium">
                            Display order
                            <input className="rounded-xl border border-slate-300 px-3 py-2" defaultValue="0" name="displayOrder" type="number" />
                          </label>
                        </div>
                        <label className="grid gap-2 text-sm font-medium">
                          Prompt
                          <input className="rounded-xl border border-slate-300 px-3 py-2" name="prompt" placeholder="Enter the question text" required />
                        </label>
                        <label className="grid gap-2 text-sm font-medium">
                          Options (comma-separated, for single/multiple types)
                          <input className="rounded-xl border border-slate-300 px-3 py-2" name="options" placeholder="Option A, Option B, Option C" />
                        </label>
                        <div className="flex gap-6 text-sm">
                          <label className="flex items-center gap-2 font-medium">
                            <input name="includeInKiosk" type="hidden" value="false" />
                            <input name="includeInKiosk" type="checkbox" value="true" />
                            Include in kiosk
                          </label>
                          <label className="flex items-center gap-2 font-medium">
                            <input name="isDemographic" type="hidden" value="false" />
                            <input name="isDemographic" type="checkbox" value="true" />
                            Demographic
                          </label>
                        </div>
                        <details className="rounded-xl border border-slate-200 px-4 py-3 text-sm">
                          <summary className="cursor-pointer font-medium">Schedule (optional)</summary>
                          <div className="mt-3 grid gap-3 sm:grid-cols-3">
                            <label className="grid gap-2 font-medium">
                              Days (0=Sun…6=Sat, comma-sep)
                              <input className="rounded-xl border border-slate-300 px-3 py-2" name="scheduleDays" placeholder="0,1,2,3,4,5,6" />
                            </label>
                            <label className="grid gap-2 font-medium">
                              Start time (HH:MM)
                              <input className="rounded-xl border border-slate-300 px-3 py-2" name="scheduleStartTime" placeholder="08:00" type="time" />
                            </label>
                            <label className="grid gap-2 font-medium">
                              End time (HH:MM)
                              <input className="rounded-xl border border-slate-300 px-3 py-2" name="scheduleEndTime" placeholder="18:00" type="time" />
                            </label>
                          </div>
                        </details>
                        <button className="w-fit rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white" type="submit">Create question</button>
                      </form>
                    </article>
                  </>
                )}
              </section>
            }
          />
          <Route
            path="/smtp"
            element={
              <section className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">SMTP settings</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Only the confirmed fields are stored: username, password, send address, server address, port, and secure login type.
                  </p>
                   <form className="mt-5 grid gap-4" onSubmit={(event) => void saveSmtpSettings(event)}>
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="grid gap-2 text-sm font-medium">
                        Username
                        <input className="rounded-xl border border-slate-300 px-3 py-2" value={smtpForm.username} onChange={(event) => setSmtpForm((current) => ({ ...current, username: event.target.value }))} />
                      </label>
                      <label className="grid gap-2 text-sm font-medium">
                        Password
                        <input className="rounded-xl border border-slate-300 px-3 py-2" type="password" value={smtpForm.password} onChange={(event) => setSmtpForm((current) => ({ ...current, password: event.target.value }))} placeholder={smtpSettings?.passwordSet ? 'Stored password kept unless replaced' : ''} />
                      </label>
                      <label className="grid gap-2 text-sm font-medium">
                        Send address
                        <input className="rounded-xl border border-slate-300 px-3 py-2" value={smtpForm.sendAddress} onChange={(event) => setSmtpForm((current) => ({ ...current, sendAddress: event.target.value }))} />
                      </label>
                      <label className="grid gap-2 text-sm font-medium">
                        Server address
                        <input className="rounded-xl border border-slate-300 px-3 py-2" value={smtpForm.serverAddress} onChange={(event) => setSmtpForm((current) => ({ ...current, serverAddress: event.target.value }))} />
                      </label>
                      <label className="grid gap-2 text-sm font-medium">
                        Port
                        <input className="rounded-xl border border-slate-300 px-3 py-2" type="number" value={smtpForm.port} onChange={(event) => setSmtpForm((current) => ({ ...current, port: event.target.value }))} />
                      </label>
                      <label className="grid gap-2 text-sm font-medium">
                        Secure login type
                        <select className="rounded-xl border border-slate-300 px-3 py-2" value={smtpForm.secureLoginType} onChange={(event) => setSmtpForm((current) => ({ ...current, secureLoginType: event.target.value as SmtpFormState['secureLoginType'] }))}>
                          <option value="none">None</option>
                          <option value="ssl">SSL/TLS</option>
                          <option value="starttls">STARTTLS</option>
                        </select>
                      </label>
                    </div>
                    <button className="w-fit rounded-full bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-sky-700/20" disabled={savingSmtp} type="submit">
                      {savingSmtp ? 'Saving…' : 'Save SMTP settings'}
                    </button>
                    {sessionUser?.role !== 'root' ? (
                      <p className="text-sm text-amber-700">Administrator access is required to view or edit SMTP settings.</p>
                    ) : null}
                  </form>
                  <div className="mt-6 border-t border-slate-200 pt-5">
                    <h3 className="text-base font-semibold">Send test email</h3>
                    <div className="mt-3 flex flex-wrap gap-3">
                      <input
                        className="min-w-48 flex-1 rounded-xl border border-slate-300 px-3 py-2 text-sm"
                        placeholder="recipient@example.com"
                        type="email"
                        value={smtpTestAddress}
                        onChange={(event) => setSmtpTestAddress(event.target.value)}
                      />
                      <button
                        className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                        disabled={!smtpTestAddress}
                        onClick={() => void sendSmtpTestEmail()}
                        type="button"
                      >
                        Send test
                      </button>
                    </div>
                    {smtpTestResult ? (
                      <p className="mt-2 text-sm text-emerald-700">{smtpTestResult}</p>
                    ) : null}
                  </div>
                </article>
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Current status</h2>
                  <dl className="mt-4 grid gap-3 text-sm text-slate-700">
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <dt className="font-medium text-slate-900">Username</dt>
                      <dd>{smtpSettings?.username || 'Not set'}</dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <dt className="font-medium text-slate-900">Server</dt>
                      <dd>{smtpSettings?.serverAddress || 'Not set'}</dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <dt className="font-medium text-slate-900">Send address</dt>
                      <dd>{smtpSettings?.sendAddress || 'Not set'}</dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <dt className="font-medium text-slate-900">Secure login</dt>
                      <dd>{smtpSettings?.secureLoginType ?? 'Not set'}</dd>
                    </div>
                  </dl>
                </article>
              </section>
            }
          />
          <Route
            path="/analytics"
            element={
              <section className="grid gap-6">
                <article className={statCardClass}>
                  <div className="flex flex-wrap items-end justify-between gap-4">
                    <h2 className="text-xl font-semibold">Analytics</h2>
                    <div className="flex flex-wrap items-end gap-3">
                      <label className="grid gap-1 text-xs font-medium text-slate-600">
                        From
                        <input
                          className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
                          type="date"
                          value={analyticsFrom}
                          onChange={(event) => setAnalyticsFrom(event.target.value)}
                        />
                      </label>
                      <label className="grid gap-1 text-xs font-medium text-slate-600">
                        To
                        <input
                          className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm"
                          type="date"
                          value={analyticsTo}
                          onChange={(event) => setAnalyticsTo(event.target.value)}
                        />
                      </label>
                      {selectedInstitution && authToken ? (
                        <button
                          className="rounded-full bg-sky-700 px-4 py-2 text-sm font-semibold text-white"
                          onClick={() => void loadAnalytics(selectedInstitution.id, authToken)}
                          type="button"
                        >
                          Refresh
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {!authToken ? (
                    <p className="mt-4 text-sm text-amber-700">Login required to view analytics.</p>
                  ) : !analyticsData ? (
                    selectedInstitution && authToken ? (
                      <button
                        className="mt-4 w-fit rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white"
                        onClick={() => void loadAnalytics(selectedInstitution.id, authToken)}
                        type="button"
                      >
                        Load analytics
                      </button>
                    ) : null
                  ) : (
                    <div className="mt-5 grid gap-6">
                      <div className="grid gap-4 sm:grid-cols-3">
                        <div className="rounded-xl bg-slate-50 px-4 py-4">
                          <div className="text-sm text-slate-500">Total responses</div>
                          <div className="mt-2 text-3xl font-semibold">{analyticsData.totalResponses}</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 px-4 py-4">
                          <div className="text-sm text-slate-500">Questions with data</div>
                          <div className="mt-2 text-3xl font-semibold">{analyticsData.responsesByQuestion.length}</div>
                        </div>
                        <div className="rounded-xl bg-slate-50 px-4 py-4">
                          <div className="text-sm text-slate-500">Days with activity</div>
                          <div className="mt-2 text-3xl font-semibold">{analyticsData.responsesPerDay.length}</div>
                        </div>
                      </div>
                      {analyticsData.responsesPerDay.length > 0 ? (
                        <div>
                          <h3 className="text-sm font-semibold text-slate-700">Responses per day</h3>
                          <div className="mt-3 flex items-end gap-1" style={{ height: '120px' }}>
                            {(() => {
                              const maxCount = Math.max(...analyticsData.responsesPerDay.map((d) => d.count), 1)
                              return analyticsData.responsesPerDay.map((day) => (
                                <div key={day.date} className="flex flex-1 flex-col items-center gap-1" title={`${day.date}: ${day.count}`}>
                                  <div
                                    className="w-full rounded-t bg-sky-500"
                                    style={{ height: `${(day.count / maxCount) * 100}px` }}
                                  />
                                  <span className="hidden text-[10px] text-slate-400 sm:block" style={{ writingMode: 'vertical-lr', transform: 'rotate(180deg)', maxHeight: '32px', overflow: 'hidden' }}>
                                    {day.date.slice(5)}
                                  </span>
                                </div>
                              ))
                            })()}
                          </div>
                        </div>
                      ) : null}
                      {analyticsData.responsesByQuestion.map((qData) => (
                        <details className="rounded-xl border border-slate-200 px-4 py-3" key={qData.questionKey}>
                          <summary className="cursor-pointer font-medium text-slate-900">
                            {qData.prompt} <span className="ml-2 text-xs text-slate-400">{qData.questionType}</span>
                          </summary>
                          <div className="mt-3">
                            {qData.responses.map((resp) => {
                              const maxR = Math.max(...qData.responses.map((r) => r.count), 1)
                              return (
                                <div className="mt-2 grid grid-cols-[1fr_3fr_auto] items-center gap-3 text-sm" key={resp.answer}>
                                  <span className="truncate text-slate-700">{resp.answer}</span>
                                  <div className="h-4 rounded-full bg-slate-100">
                                    <div
                                      className="h-full rounded-full bg-sky-500 transition-all"
                                      style={{ width: `${(resp.count / maxR) * 100}%` }}
                                    />
                                  </div>
                                  <span className="text-xs text-slate-500">{resp.count}</span>
                                </div>
                              )
                            })}
                          </div>
                        </details>
                      ))}
                      {analyticsData.demographicBreakdown.length > 0 ? (
                        <div>
                          <h3 className="mb-3 text-sm font-semibold text-slate-700">Demographic breakdown</h3>
                          {analyticsData.demographicBreakdown.map((demo) => (
                            <details className="rounded-xl border border-slate-200 px-4 py-3" key={demo.questionKey}>
                              <summary className="cursor-pointer font-medium text-slate-900">{demo.prompt}</summary>
                              <ul className="mt-2 flex flex-wrap gap-2 text-sm">
                                {demo.responses.map((r) => (
                                  <li className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1" key={r.answer}>
                                    {r.answer}: <strong>{r.count}</strong>
                                  </li>
                                ))}
                              </ul>
                            </details>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  )}
                </article>
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Cross-tabulation</h2>
                  <p className="mt-2 text-sm text-slate-500">Counts under 5 are hidden for privacy.</p>
                  <div className="mt-4 grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-2 text-sm font-medium">
                      Primary question key
                      <input
                        className="rounded-xl border border-slate-300 px-3 py-2"
                        placeholder="e.g. overall-experience"
                        value={crossTabPrimary}
                        onChange={(event) => setCrossTabPrimary(event.target.value)}
                      />
                    </label>
                    <label className="grid gap-2 text-sm font-medium">
                      Demographic key
                      <input
                        className="rounded-xl border border-slate-300 px-3 py-2"
                        placeholder="e.g. age-group"
                        value={crossTabDemo}
                        onChange={(event) => setCrossTabDemo(event.target.value)}
                      />
                    </label>
                  </div>
                  <button
                    className="mt-3 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                    disabled={!crossTabPrimary || !crossTabDemo}
                    onClick={() => void loadCrossTab()}
                    type="button"
                  >
                    Run cross-tab
                  </button>
                  {crossTabData ? (
                    <div className="mt-4 overflow-x-auto">
                      <table className="w-full text-sm text-slate-700">
                        <thead>
                          <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                            <th className="pb-2 pr-4">Primary answer</th>
                            <th className="pb-2 pr-4">Demographic</th>
                            <th className="pb-2">Count</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {crossTabData.map((cell, index) => (
                            <tr key={index}>
                              <td className="py-2 pr-4">{cell.primaryAnswer}</td>
                              <td className="py-2 pr-4">{cell.demoAnswer}</td>
                              <td className="py-2">{cell.count}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : null}
                </article>
              </section>
            }
          />
          <Route
            path="/profile"
            element={
              <section className="grid gap-6 lg:grid-cols-2">
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Change password</h2>
                  {!sessionUser ? (
                    <p className="mt-3 text-sm text-amber-700">Login required.</p>
                  ) : (
                    <form className="mt-4 grid gap-3" onSubmit={(event) => void changePassword(event).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed.'))}>
                      <input className="rounded-xl border border-slate-300 px-3 py-2" name="currentPassword" placeholder="Current password" required type="password" />
                      <input className="rounded-xl border border-slate-300 px-3 py-2" name="newPassword" placeholder="New password (min 10 chars)" required type="password" />
                      <button className="w-fit rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white" type="submit">Update password</button>
                    </form>
                  )}
                </article>
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Two-factor authentication</h2>
                  <p className="mt-2 text-sm text-slate-600">Enable or disable OTP-based 2FA for your account.</p>
                  {sessionUser ? (
                    <div className="mt-4 flex gap-3">
                      <button className="rounded-full bg-sky-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => void toggle2FA(sessionUser.id, true).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed.'))} type="button">Enable 2FA</button>
                      <button className="rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-900" onClick={() => void toggle2FA(sessionUser.id, false).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed.'))} type="button">Disable 2FA</button>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-amber-700">Login required.</p>
                  )}
                </article>
              </section>
            }
          />
          <Route
            path="/help"
            element={
              <section className="grid gap-6">
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Help</h2>
                  <p className="mt-2 text-sm text-slate-700">
                    Use this page as the central quick-help reference for staff and administrators.
                  </p>
                  <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-700">
                    <li>Sign in from <code>/auth-core</code> using your institutional account.</li>
                    <li>Enable kiosk mode from the Institutions view if visitor collection is paused.</li>
                    <li>Use Analytics for date-range response summaries and demographic cross-tab views.</li>
                    <li>Use Profile to update password and 2FA.</li>
                    <li>Platform administrators can manage SMTP settings and institution lifecycle controls.</li>
                  </ul>
                </article>
              </section>
            }
          />
          <Route
            path="/privacy"
            element={
              <section className="grid gap-6">
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Privacy policy</h2>
                  <p className="mt-2 text-sm text-slate-700">
                    Quick Glimpse is designed for anonymous visitor feedback. Visitor names, direct contact details,
                    and other direct identifiers are not required in normal kiosk use.
                  </p>
                  <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-700">
                    <li>Institution and account administration data is stored for service operation.</li>
                    <li>Visitor feedback responses are stored with anonymous session linkage for analytics only.</li>
                    <li>Demographic questions are optional and category-based.</li>
                    <li>Institution administrators control question configuration and display behavior.</li>
                  </ul>
                </article>
              </section>
            }
          />
          <Route
            path="/dpia"
            element={
              <section className="grid gap-6">
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Data Protection Impact Assessment (DPIA) summary</h2>
                  <p className="mt-2 text-sm text-slate-700">
                    Quick Glimpse minimises data processing by separating administrator account data from anonymous
                    visitor response data and limiting privileged visibility to aggregate metrics.
                  </p>
                  <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-700">
                    <li>Purpose limitation: service-quality measurement and operational insight.</li>
                    <li>Data minimisation: no required direct identifiers for kiosk respondents.</li>
                    <li>Access controls: role-based authorization and institution scoping.</li>
                    <li>Security controls: CSP, HSTS, CORP/COOP, session expiry, and rate limiting.</li>
                  </ul>
                </article>
              </section>
            }
          />
          <Route
            path="/magic-link"
            element={<MagicLinkHandler onSession={(token, user) => { setAuthToken(token); setSessionUser(user) }} />}
          />
        </Routes>
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-6 py-6 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>©J Rowson {new Date().getFullYear()} | jahosi.co.uk</span>
          <div className="flex flex-wrap items-center gap-3">
            <NavLink className="underline underline-offset-2" to="/help">Help</NavLink>
            <NavLink className="underline underline-offset-2" to="/privacy">Privacy policy</NavLink>
            <NavLink className="underline underline-offset-2" to="/dpia">DPIA</NavLink>
            <span>Version {bootstrap.app.version}</span>
          </div>
        </div>
      </footer>
    </div>
      } />
    </Routes>
  )
}

function MagicLinkHandler({ onSession }: { onSession: (token: string, user: AuthUser) => void }) {
  const [searchParams] = useSearchParams()
  const tokenParam = searchParams.get('token')
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>(() => (tokenParam ? 'loading' : 'error'))
  const [message, setMessage] = useState(() => (tokenParam ? '' : 'Missing magic link token.'))

  useEffect(() => {
    if (!tokenParam) {
      return
    }
    fetch(`/api/auth/magic-link?token=${encodeURIComponent(tokenParam)}`)
      .then(async (response) => {
        if (!response.ok) {
          const result = (await response.json()) as { error?: string }
          throw new Error(result.error ?? 'Invalid or expired magic link.')
        }
        return response.json() as Promise<{ token: string; user: AuthUser }>
      })
      .then((result) => {
        onSession(result.token, result.user)
        setStatus('success')
        setMessage(`Signed in as ${result.user.email}`)
      })
      .catch((err: unknown) => {
        setStatus('error')
        setMessage(err instanceof Error ? err.message : 'Magic link failed.')
      })
  }, [tokenParam, onSession])

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
      {status === 'loading' ? <p className="text-slate-600">Verifying magic link…</p> : null}
      {status === 'success' ? <p className="text-emerald-700 font-medium">{message}</p> : null}
      {status === 'error' ? <p className="text-red-700 font-medium">{message}</p> : null}
    </div>
  )
}

export default App

type KioskFullScreenProps = {
  institution: Institution | null
  colorScheme: InstitutionColorScheme
  kioskState: 'landing' | 'questions' | 'demographics' | 'thankyou'
  kioskLoading: boolean
  kioskQuestions: Question[]
  kioskCurrentIdx: number
  kioskCurrentAnswer: string
  kioskStarValue: number
  kioskSliderValue: number
  kioskMultiAnswers: string[]
  kioskDemoIdx: number
  kioskDemoAnswers: Record<string, string>
  kioskCountdown: number
  error: string | null
  onStart: () => void
  onAnswer: (val: string) => void
  onStarChange: (val: number) => void
  onSliderChange: (val: number) => void
  onMultiToggle: (opt: string) => void
  onSubmitAnswer: () => void
  onDemoAnswer: (key: string, val: string) => void
  onComplete: () => void
  onDemoSkip: () => void
  onDemoNext: () => void
}

function KioskFullScreen(props: KioskFullScreenProps) {
  const {
    institution, kioskState, kioskLoading, kioskQuestions, kioskCurrentIdx,
    colorScheme,
    kioskCurrentAnswer, kioskStarValue, kioskSliderValue, kioskMultiAnswers,
    kioskDemoIdx, kioskDemoAnswers, kioskCountdown, error,
    onStart, onAnswer, onStarChange, onSliderChange, onMultiToggle,
    onSubmitAnswer, onDemoAnswer, onComplete, onDemoSkip, onDemoNext,
  } = props

  const promptQuestions = kioskQuestions.filter((q) => !q.isDemographic)
  const currentQuestion = promptQuestions[kioskCurrentIdx] ?? null
  const demoQuestions = kioskQuestions.filter((q) => q.isDemographic)
  const currentDemoQ = demoQuestions[kioskDemoIdx] ?? null

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-[var(--brand-900)] px-6 text-white" style={institutionColorSchemes[colorScheme].style as CSSProperties}>
      {kioskLoading ? (
        <div className="flex flex-col items-center gap-4">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-[var(--brand-500)] border-t-transparent" />
          <p className="text-slate-300">Please wait…</p>
        </div>
      ) : kioskState === 'landing' ? (
        <div className="flex flex-col items-center gap-8 text-center">
          <div>
              <p className="text-sm font-semibold uppercase tracking-[0.2em] text-[var(--brand-100)]">Patient feedback</p>
            <h1 className="mt-3 text-4xl font-semibold tracking-tight md:text-5xl">{institution?.name ?? 'Quick Glimpse'}</h1>
            <p className="mt-4 max-w-md text-lg text-slate-300">Share your experience with us. Your feedback helps us improve our service.</p>
          </div>
          {error ? (
            <p className="rounded-xl border border-amber-500 bg-amber-900/40 px-4 py-3 text-amber-200">{error}</p>
          ) : null}
          <button
            className="rounded-full bg-[var(--brand-600)] px-10 py-4 text-xl font-semibold shadow-2xl shadow-[color:var(--brand-shadow)] transition hover:bg-[var(--brand-500)]"
            onClick={onStart}
            type="button"
          >
            Start feedback
          </button>
          <a href="/" className="text-sm text-slate-500 underline underline-offset-4">Return to dashboard</a>
        </div>
      ) : kioskState === 'questions' && currentQuestion ? (
        <div className="w-full max-w-xl">
          <div className="mb-6 text-center text-sm text-slate-400">
            Question {kioskCurrentIdx + 1} of {promptQuestions.length}
          </div>
          <div className="rounded-3xl bg-slate-800 px-8 py-8">
            <h2 className="text-2xl font-semibold leading-snug">{currentQuestion.prompt}</h2>
            <div className="mt-6">
              {currentQuestion.questionType === 'star' ? (
                <div className="flex gap-3">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                    className={`text-4xl transition ${kioskStarValue >= star ? 'text-amber-400' : 'text-slate-600'}`}
                      onClick={() => onStarChange(star)}
                      type="button"
                    >
                      ★
                    </button>
                  ))}
                </div>
              ) : currentQuestion.questionType === 'scale' ? (
                <div>
                  <input
                    className="w-full accent-[var(--brand-500)]"
                    max="10"
                    min="0"
                    type="range"
                    value={kioskSliderValue}
                    onChange={(event) => onSliderChange(Number(event.target.value))}
                  />
                  <div className="mt-2 flex justify-between text-sm text-slate-400">
                    <span>0 — Poor</span>
                    <span className="text-2xl font-semibold text-white">{kioskSliderValue}</span>
                    <span>10 — Excellent</span>
                  </div>
                </div>
              ) : currentQuestion.questionType === 'boolean' ? (
                <div className="flex gap-4">
                  {['yes', 'no'].map((opt) => (
                    <button
                      key={opt}
                      className={`flex-1 rounded-2xl py-4 text-lg font-semibold transition ${kioskCurrentAnswer === opt ? 'bg-[var(--brand-600)] text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}
                      onClick={() => onAnswer(opt)}
                      type="button"
                    >
                      {opt === 'yes' ? 'Yes' : 'No'}
                    </button>
                  ))}
                </div>
              ) : currentQuestion.questionType === 'multiple' ? (
                <div className="flex flex-wrap gap-3">
                  {currentQuestion.options.map((opt) => (
                    <button
                      key={opt}
                      className={`rounded-full px-5 py-2.5 font-medium transition ${kioskMultiAnswers.includes(opt) ? 'bg-[var(--brand-600)] text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}
                      onClick={() => onMultiToggle(opt)}
                      type="button"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : currentQuestion.questionType === 'single' ? (
                <div className="flex flex-col gap-3">
                  {currentQuestion.options.map((opt) => (
                    <button
                      key={opt}
                      className={`rounded-2xl px-5 py-3 text-left font-medium transition ${kioskCurrentAnswer === opt ? 'bg-[var(--brand-600)] text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}
                      onClick={() => onAnswer(opt)}
                      type="button"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : (
                <textarea
                  className="w-full rounded-2xl bg-slate-700 px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--brand-500)]"
                  placeholder="Type your answer here…"
                  rows={4}
                  value={kioskCurrentAnswer}
                  onChange={(event) => onAnswer(event.target.value)}
                />
              )}
            </div>
            <div className="mt-6 flex justify-end">
              <button
                className="rounded-full bg-[var(--brand-600)] px-8 py-3 font-semibold transition hover:bg-[var(--brand-500)]"
                onClick={onSubmitAnswer}
                type="button"
              >
                {kioskCurrentIdx + 1 < promptQuestions.length ? 'Next →' : 'Continue'}
              </button>
            </div>
          </div>
        </div>
      ) : kioskState === 'demographics' && currentDemoQ ? (
        <div className="w-full max-w-xl">
          <div className="mb-6 text-center text-sm text-slate-400">
            About you — {kioskDemoIdx + 1} of {demoQuestions.length}
          </div>
          <div className="rounded-3xl bg-slate-800 px-8 py-8">
            <h2 className="text-2xl font-semibold leading-snug">{currentDemoQ.prompt}</h2>
            <div className="mt-6">
              {currentDemoQ.questionType === 'single' || currentDemoQ.options.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {currentDemoQ.options.map((opt) => (
                    <button
                      key={opt}
                       className={`rounded-2xl px-5 py-3 text-left font-medium transition ${kioskDemoAnswers[currentDemoQ.templateKey ?? `iq-${currentDemoQ.id}`] === opt ? 'bg-[var(--brand-600)] text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}
                      onClick={() => onDemoAnswer(currentDemoQ.templateKey ?? `iq-${currentDemoQ.id}`, opt)}
                      type="button"
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : (
                <input
                  className="w-full rounded-2xl bg-slate-700 px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--brand-500)]"
                  placeholder="Your answer"
                  value={kioskDemoAnswers[currentDemoQ.templateKey ?? `iq-${currentDemoQ.id}`] ?? ''}
                  onChange={(event) => onDemoAnswer(currentDemoQ.templateKey ?? `iq-${currentDemoQ.id}`, event.target.value)}
                />
              )}
            </div>
            <div className="mt-6 flex justify-between">
              <button
                className="rounded-full bg-slate-700 px-6 py-3 font-semibold transition hover:bg-slate-600"
                onClick={onDemoSkip}
                type="button"
              >
                Skip
              </button>
              <button
                className="rounded-full bg-[var(--brand-600)] px-8 py-3 font-semibold transition hover:bg-[var(--brand-500)]"
                onClick={onDemoNext}
                type="button"
              >
                {kioskDemoIdx + 1 < demoQuestions.length ? 'Next →' : 'Finish'}
              </button>
            </div>
          </div>
        </div>
      ) : kioskState === 'thankyou' ? (
        <div className="flex flex-col items-center gap-6 text-center">
          <div className="flex h-24 w-24 items-center justify-center rounded-full bg-emerald-900/50 text-5xl">✓</div>
          <h1 className="text-3xl font-semibold">Thank you!</h1>
          <p className="max-w-sm text-slate-300">Your feedback has been recorded. This screen will reset in {kioskCountdown} second{kioskCountdown !== 1 ? 's' : ''}.</p>
          <button
            className="mt-2 rounded-full bg-slate-700 px-6 py-2.5 text-sm font-semibold transition hover:bg-slate-600"
            onClick={onComplete}
            type="button"
          >
            Done now
          </button>
        </div>
      ) : null}
    </div>
  )
}
