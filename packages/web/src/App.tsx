import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, FormEvent, ReactNode } from 'react'
import QRCode from 'qrcode'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate, useSearchParams } from './router'

type Institution = {
  id: number
  name: string
  slug: string
  timezone: string
  status: 'active' | 'suspended' | 'deactivated'
  kioskModeEnabled: number
  singleQuestionModeEnabled: number
  qrModeEnabled: number
  retentionDays: number
  kioskIdleResetSeconds: number
  kioskCompletionMessage: string
  colorScheme: 'ocean' | 'emerald' | 'sunset' | 'violet'
  deactivatedAt: string | null
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

type GuestQuestion = {
  id: number
  questionKey: string
  questionType: Question['questionType']
  prompt: string
  options: string[]
  isDemographic: boolean
}

type KioskQrToken = {
  token: string
  url: string
  expiresAt: string
}

type GuestQrPayload = {
  institution: {
    id: number
    name: string
    slug: string
    colorScheme: InstitutionColorScheme
    kioskCompletionMessage: string
  }
  expiresAt: string
  questions: GuestQuestion[]
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
    supportedRoles: Array<'root' | 'institution_admin' | 'institution_user' | 'institution_kiosk'>
    userStatuses: Array<'active' | 'suspended' | 'deactivated'>
    turnstileSiteKey: string
    turnstileRequired: boolean
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
}

type LoginResult =
  | TwoFaPending
  | { token: string; user: AuthUser; mustChangePassword: boolean; redirectPath?: string }

type AuthUser = {
  id: number
  email: string
  role: 'root' | 'institution_admin' | 'institution_user' | 'institution_kiosk'
  status: 'active' | 'suspended' | 'deactivated'
  institutionId: number | null
}

type ManagedUser = AuthUser & {
  createdAt: string
  lastLoginAt: string | null
  deactivatedAt: string | null
  twoFaEnabled?: number
  mustChangePassword?: number
}

type TurnstileWidgetId = string | number

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

type PasswordInputProps = {
  autoComplete: 'current-password' | 'new-password'
  name: string
  placeholder: string
}

const publicPaths = new Set(['/', '/login', '/auth-core', '/help', '/privacy', '/dpia', '/magic-link'])
const authStorageKey = 'qglimpse-auth'
const routeAliases: Record<string, string> = {
  '/app': '/',
  '/institution': '/institutions',
}

function sanitizeRedirectPath(value: string | null) {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return '/'
  }
  const target = new URL(value, window.location.origin)
  if (target.origin !== window.location.origin || target.pathname === '/login' || target.pathname === '/auth-core') {
    return '/'
  }
  const aliasedPathname = routeAliases[target.pathname] ?? target.pathname
  return `${aliasedPathname}${target.search}${target.hash}`
}

function friendlyDisplayError(message: string) {
  if (message === 'Invalid user payload.') {
    return 'Please check the new user details. The email, temporary password, role, and institution all need valid values.'
  }

  return message
}

function friendlyHttpStatusMessage(status: number, fallback: string) {
  if (status === 400) return 'Please check the form and try again.'
  if (status === 401) return 'Your sign-in details were not accepted. Please check them and try again.'
  if (status === 403) return 'You do not have permission to do that.'
  if (status === 404) return 'That item could not be found. It may have been moved or deleted.'
  if (status === 409) return 'That change conflicts with existing data. Please refresh and try again.'
  if (status === 429) return 'Too many requests. Please wait a few minutes and try again.'
  if (status >= 500) return 'The server hit a problem. Please try again shortly.'
  return fallback
}

function friendlyPlainTextResponse(text: string, fallback: string) {
  const trimmed = text.trim()
  if (!trimmed) return fallback
  if (/too many/i.test(trimmed)) return 'Too many requests. Please wait a few minutes and try again.'
  if (/rate/i.test(trimmed) && /limit/i.test(trimmed)) return 'Too many requests. Please wait a few minutes and try again.'
  if (/cannot\s+(get|post|put|patch|delete)/i.test(trimmed)) return 'The requested server endpoint is not available.'
  if (/<!doctype html|<html/i.test(trimmed)) return 'The server returned a web page instead of app data. Please refresh and try again.'
  return trimmed.length > 180 ? fallback : trimmed
}

function getQuestionKey(question: { id: number; templateKey?: string | null; questionKey?: string }) {
  return question.questionKey ?? question.templateKey ?? `iq-${question.id}`
}

function defaultOptionRowsForType(questionType: Question['questionType']) {
  if (questionType === 'boolean') return ['Yes', 'No']
  if (questionType === 'scale') return ['Poor', 'Excellent']
  if (questionType === 'star') return ['Low', 'High']
  if (questionType === 'single' || questionType === 'multiple') return ['', '']
  return []
}

function questionNeedsListOptions(questionType: Question['questionType']) {
  return questionType === 'single' || questionType === 'multiple'
}

function questionNeedsEndpointLabels(questionType: Question['questionType']) {
  return questionType === 'boolean' || questionType === 'scale' || questionType === 'star'
}

async function readJsonBody<T>(response: Response, fallback: string): Promise<T> {
  const text = await response.text()
  if (!text.trim()) {
    throw new Error(fallback)
  }
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(friendlyPlainTextResponse(text, fallback))
  }
}

async function responseErrorMessage(response: Response, fallback: string) {
  const statusFallback = friendlyHttpStatusMessage(response.status, fallback)
  try {
    const text = await response.text()
    if (!text.trim()) {
      return statusFallback
    }
    try {
      const payload = JSON.parse(text) as { error?: unknown; message?: unknown }
      const message = typeof payload.error === 'string' ? payload.error : typeof payload.message === 'string' ? payload.message : ''
      return message || statusFallback
    } catch {
      return friendlyPlainTextResponse(text, statusFallback)
    }
  } catch {
    return statusFallback
  }
}

const fallbackTimezones = [
  'UTC',
  'Europe/London',
  'Europe/Dublin',
  'Europe/Paris',
  'Europe/Berlin',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
  'Pacific/Auckland',
]

const capitalTimezoneNames: Record<string, string> = {
  'Africa/Abidjan': 'Yamoussoukro',
  'Africa/Accra': 'Accra',
  'Africa/Addis_Ababa': 'Addis Ababa',
  'Africa/Algiers': 'Algiers',
  'Africa/Cairo': 'Cairo',
  'Africa/Casablanca': 'Rabat',
  'Africa/Johannesburg': 'Pretoria',
  'Africa/Lagos': 'Abuja',
  'Africa/Nairobi': 'Nairobi',
  'America/Anchorage': 'Juneau',
  'America/Argentina/Buenos_Aires': 'Buenos Aires',
  'America/Bogota': 'Bogota',
  'America/Caracas': 'Caracas',
  'America/Chicago': 'Chicago',
  'America/Denver': 'Denver',
  'America/Guatemala': 'Guatemala City',
  'America/Halifax': 'Halifax',
  'America/Havana': 'Havana',
  'America/Lima': 'Lima',
  'America/Los_Angeles': 'Los Angeles',
  'America/Mexico_City': 'Mexico City',
  'America/New_York': 'Washington DC',
  'America/Phoenix': 'Phoenix',
  'America/Santiago': 'Santiago',
  'America/Sao_Paulo': 'Brasilia',
  'America/St_Johns': "St John's",
  'America/Toronto': 'Ottawa',
  'Asia/Amman': 'Amman',
  'Asia/Baghdad': 'Baghdad',
  'Asia/Baku': 'Baku',
  'Asia/Bangkok': 'Bangkok',
  'Asia/Beirut': 'Beirut',
  'Asia/Dhaka': 'Dhaka',
  'Asia/Dubai': 'Abu Dhabi',
  'Asia/Hong_Kong': 'Hong Kong',
  'Asia/Jakarta': 'Jakarta',
  'Asia/Jerusalem': 'Jerusalem',
  'Asia/Kabul': 'Kabul',
  'Asia/Kathmandu': 'Kathmandu',
  'Asia/Kolkata': 'New Delhi',
  'Asia/Manila': 'Manila',
  'Asia/Riyadh': 'Riyadh',
  'Asia/Seoul': 'Seoul',
  'Asia/Shanghai': 'Beijing',
  'Asia/Singapore': 'Singapore',
  'Asia/Taipei': 'Taipei',
  'Asia/Tehran': 'Tehran',
  'Asia/Tokyo': 'Tokyo',
  'Asia/Yerevan': 'Yerevan',
  'Atlantic/Reykjavik': 'Reykjavik',
  'Australia/Adelaide': 'Adelaide',
  'Australia/Brisbane': 'Brisbane',
  'Australia/Darwin': 'Darwin',
  'Australia/Perth': 'Perth',
  'Australia/Sydney': 'Canberra',
  'Europe/Amsterdam': 'Amsterdam',
  'Europe/Athens': 'Athens',
  'Europe/Berlin': 'Berlin',
  'Europe/Brussels': 'Brussels',
  'Europe/Bucharest': 'Bucharest',
  'Europe/Budapest': 'Budapest',
  'Europe/Copenhagen': 'Copenhagen',
  'Europe/Dublin': 'Dublin',
  'Europe/Helsinki': 'Helsinki',
  'Europe/Istanbul': 'Ankara',
  'Europe/Lisbon': 'Lisbon',
  'Europe/London': 'London',
  'Europe/Madrid': 'Madrid',
  'Europe/Oslo': 'Oslo',
  'Europe/Paris': 'Paris',
  'Europe/Prague': 'Prague',
  'Europe/Rome': 'Rome',
  'Europe/Stockholm': 'Stockholm',
  'Europe/Vienna': 'Vienna',
  'Europe/Warsaw': 'Warsaw',
  'Pacific/Auckland': 'Wellington',
  'Pacific/Honolulu': 'Honolulu',
}

function getSupportedTimezones() {
  const supported =
    typeof Intl.supportedValuesOf === 'function'
      ? Intl.supportedValuesOf('timeZone')
      : fallbackTimezones
  return Array.from(new Set(['UTC', ...supported, ...fallbackTimezones])).sort((a, b) => a.localeCompare(b))
}

function getTimezoneOffsetMinutes(timezone: string) {
  try {
    const date = new Date()
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: timezone,
      hour12: false,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date)
    const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
    const asUtc = Date.UTC(
      Number(values.year),
      Number(values.month) - 1,
      Number(values.day),
      Number(values.hour),
      Number(values.minute),
      Number(values.second),
    )
    return Math.round((asUtc - date.getTime()) / 60000)
  } catch {
    return 0
  }
}

function formatUtcOffset(minutes: number) {
  if (minutes === 0) {
    return 'UTC+00:00'
  }
  const sign = minutes >= 0 ? '+' : '-'
  const absolute = Math.abs(minutes)
  const hours = Math.floor(absolute / 60)
  const mins = absolute % 60
  return `UTC${sign}${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`
}

function getTimezonePlaceName(timezone: string) {
  if (timezone === 'UTC') {
    return 'Coordinated Universal Time'
  }
  return (
    capitalTimezoneNames[timezone] ??
    (timezone
      .split('/')
      .slice(1)
      .join(' / ')
      .replaceAll('_', ' ') ||
    timezone
    )
  )
}

function formatTimezoneLabel(timezone: string) {
  const offsetMinutes = getTimezoneOffsetMinutes(timezone)
  const region = timezone.includes('/') ? timezone.split('/')[0].replaceAll('_', ' ') : ''
  const place = getTimezonePlaceName(timezone)
  return `${formatUtcOffset(offsetMinutes)} - ${place}${region ? ` (${timezone})` : ''}`
}

const timezoneChoices = getSupportedTimezones()
  .map((value) => {
    const offsetMinutes = getTimezoneOffsetMinutes(value)
    return {
      value,
      label: formatTimezoneLabel(value),
      offsetLabel: formatUtcOffset(offsetMinutes),
      offsetMinutes,
      place: getTimezonePlaceName(value),
    }
  })
  .sort((a, b) => a.offsetMinutes - b.offsetMinutes || a.place.localeCompare(b.place) || a.value.localeCompare(b.value))

const timezoneChoiceGroups = Array.from(
  timezoneChoices
    .reduce((groups, choice) => {
      const group = groups.get(choice.offsetLabel) ?? {
        label: choice.offsetLabel,
        offsetMinutes: choice.offsetMinutes,
        choices: [] as typeof timezoneChoices,
      }
      group.choices.push(choice)
      groups.set(choice.offsetLabel, group)
      return groups
    }, new Map<string, { label: string; offsetMinutes: number; choices: typeof timezoneChoices }>())
    .values(),
).sort((a, b) => a.offsetMinutes - b.offsetMinutes)

function formatTimezoneGroupLabel(group: { label: string; choices: typeof timezoneChoices }) {
  const capitalNames = group.choices
    .filter((choice) => capitalTimezoneNames[choice.value] || choice.value === 'UTC')
    .map((choice) => choice.place)
    .filter((place, index, places) => places.indexOf(place) === index)
    .slice(0, 4)
  return capitalNames.length > 0 ? `${group.label} - ${capitalNames.join(', ')}` : group.label
}

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
  `inline-flex min-h-11 w-full shrink-0 items-center justify-center whitespace-nowrap rounded-full px-4 py-2 text-sm font-medium transition sm:w-auto ${
    isActive
      ? 'bg-[var(--brand-700)] text-white shadow-lg shadow-[color:var(--brand-shadow)]'
      : 'text-slate-600 hover:bg-[var(--brand-100)] hover:text-[var(--brand-900)]'
  }`
const installButtonClass =
  'inline-flex min-h-11 w-full shrink-0 items-center justify-center whitespace-nowrap rounded-full bg-[var(--brand-700)] px-4 py-2 text-sm font-semibold text-white shadow-lg shadow-[color:var(--brand-shadow)] transition hover:bg-[var(--brand-600)] sm:w-auto'

const statCardClass =
  'rounded-xl border border-[var(--brand-100)] bg-white/95 p-4 shadow-sm shadow-[color:var(--brand-shadow)] ring-1 ring-white/60 sm:p-5'

function isRunningAsInstalledApp() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    window.matchMedia('(display-mode: minimal-ui)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true ||
    document.referrer.startsWith('android-app://')
  )
}

function QglimpseLogo({ className }: { className: string }) {
  return <img alt="" aria-hidden="true" className={className} src="/icon-192.svg" />
}

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

function PasswordInput({ autoComplete, name, placeholder }: PasswordInputProps) {
  const [visible, setVisible] = useState(false)

  return (
    <div className="relative">
      <input
        autoComplete={autoComplete}
        className="w-full rounded-xl border border-slate-300 px-3 py-2 pr-20"
        name={name}
        placeholder={placeholder}
        required
        type={visible ? 'text' : 'password'}
      />
      <button
        aria-label={visible ? `Hide ${placeholder.toLowerCase()}` : `Show ${placeholder.toLowerCase()}`}
        className="absolute inset-y-1.5 right-1.5 rounded-lg px-3 text-xs font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-[var(--brand-500)]"
        onClick={() => setVisible((current) => !current)}
        type="button"
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  )
}

function App() {
  const location = useLocation()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [restoringSession, setRestoringSession] = useState(true)
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
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([])
  const [turnstileToken, setTurnstileToken] = useState('')
  const [turnstileResetSignal, setTurnstileResetSignal] = useState(0)
  const [interestTurnstileToken, setInterestTurnstileToken] = useState('')
  const [interestTurnstileResetSignal, setInterestTurnstileResetSignal] = useState(0)
  const [interestMessage, setInterestMessage] = useState<string | null>(null)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [installPromptEvent, setInstallPromptEvent] = useState<BeforeInstallPromptEvent | null>(null)
  const [installHelpOpen, setInstallHelpOpen] = useState(false)
  const [runningAsInstalledApp, setRunningAsInstalledApp] = useState(() => isRunningAsInstalledApp())
  const [smtpForm, setSmtpForm] = useState<SmtpFormState>({
    username: '',
    password: '',
    sendAddress: '',
    serverAddress: '',
    port: '587',
    secureLoginType: 'starttls',
  })
  const [institutionQuestions, setInstitutionQuestions] = useState<Question[]>([])
  const [customQuestionType, setCustomQuestionType] = useState<Question['questionType']>('text')
  const [customQuestionOptions, setCustomQuestionOptions] = useState<string[]>([])
  const [analyticsData, setAnalyticsData] = useState<AnalyticsData | null>(null)
  const [analyticsFrom, setAnalyticsFrom] = useState(() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [analyticsTo, setAnalyticsTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [smtpTestAddress, setSmtpTestAddress] = useState('')
  const [smtpTestResult, setSmtpTestResult] = useState<string | null>(null)
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
  const [kioskFeedbackMessage, setKioskFeedbackMessage] = useState('Your feedback has been recorded.')
  const [kioskQrToken, setKioskQrToken] = useState<KioskQrToken | null>(null)
  const [kioskQrImage, setKioskQrImage] = useState('')
  const [kioskQrLoading, setKioskQrLoading] = useState(false)
  const [offline, setOffline] = useState(() => !window.navigator.onLine)
  const [crossTabPrimary, setCrossTabPrimary] = useState('')
  const [crossTabDemo, setCrossTabDemo] = useState('')
  const [crossTabData, setCrossTabData] = useState<Array<{ primaryAnswer: string; demoAnswer: string; count: number | '< 5' }> | null>(null)
  const sessionRestoreChecked = useRef(false)
  const accountMenuRef = useRef<HTMLDivElement | null>(null)
  const kioskPromptQuestions = useMemo(() => kioskQuestions.filter((q) => !q.isDemographic), [kioskQuestions])
  const kioskDemographicQuestions = useMemo(() => kioskQuestions.filter((q) => q.isDemographic), [kioskQuestions])
  const requiresTurnstileWidget = Boolean(bootstrap?.authCore.turnstileSiteKey && bootstrap.authCore.turnstileRequired)
  const currentPath = `${location.pathname}${location.search}`
  const requestedRedirectPath = sanitizeRedirectPath(searchParams.get('next'))
  const authRedirectPath = `/login?next=${encodeURIComponent(currentPath)}`
  const isPublicPath = publicPaths.has(location.pathname)
  const isGuestQrPath = location.pathname.startsWith('/guest/qr/')
  const isLoginPath = location.pathname === '/login'
  const canOfferInstall = !runningAsInstalledApp

  const upsertDisplayedInstitution = (institution: Institution) => {
    setBootstrap((current) => {
      if (!current) return current
      const exists = current.institutions.some((item) => item.id === institution.id)
      return {
        ...current,
        institutions: exists
          ? current.institutions.map((item) => (item.id === institution.id ? institution : item))
          : [...current.institutions, institution],
      }
    })
    setInstitutionList((current) => {
      const exists = current.some((item) => item.id === institution.id)
      return exists ? current.map((item) => (item.id === institution.id ? institution : item)) : [...current, institution]
    })
  }

  const removeDisplayedInstitution = (institutionId: number) => {
    setBootstrap((current) =>
      current
        ? {
            ...current,
            institutions: current.institutions.filter((institution) => institution.id !== institutionId),
          }
        : current,
    )
    setInstitutionList((current) => current.filter((institution) => institution.id !== institutionId))
    setInstitutionQuestions((current) => current.filter((question) => question.institutionId !== institutionId))
  }

  const clearAuthenticatedSession = () => {
    window.localStorage.removeItem(authStorageKey)
    setAuthToken('')
    setSessionUser(null)
    setMustChangePw(false)
    setPendingTwoFa(null)
    setRootOverview(null)
    setSmtpSettings(null)
    setManagedUsers([])
  }

  const promptPwaInstall = async () => {
    if (!installPromptEvent) {
      setInstallHelpOpen(true)
      return
    }

    await installPromptEvent.prompt()
    const choice = await installPromptEvent.userChoice
    if (choice.outcome !== 'dismissed') {
      setInstallPromptEvent(null)
      setInstallHelpOpen(false)
    }
  }

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/bootstrap')
        if (!response.ok) throw new Error('Unable to load bootstrap data.')
        const payload = (await response.json()) as BootstrapPayload
        setBootstrap(payload)
        setTurnstileToken('')
        setInterestTurnstileToken('')
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

  useEffect(() => {
    if (!accountMenuOpen) return

    const closeAccountMenu = (event: MouseEvent | KeyboardEvent) => {
      if (event instanceof KeyboardEvent) {
        if (event.key === 'Escape') {
          setAccountMenuOpen(false)
        }
        return
      }

      if (accountMenuRef.current && !accountMenuRef.current.contains(event.target as Node)) {
        setAccountMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', closeAccountMenu)
    document.addEventListener('keydown', closeAccountMenu)
    return () => {
      document.removeEventListener('mousedown', closeAccountMenu)
      document.removeEventListener('keydown', closeAccountMenu)
    }
  }, [accountMenuOpen])

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPromptEvent(event as BeforeInstallPromptEvent)
    }
    const handleAppInstalled = () => {
      setInstallPromptEvent(null)
      setInstallHelpOpen(false)
      setRunningAsInstalledApp(true)
    }

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [])

  useEffect(() => {
    const updateOnlineState = () => setOffline(!window.navigator.onLine)
    window.addEventListener('online', updateOnlineState)
    window.addEventListener('offline', updateOnlineState)
    return () => {
      window.removeEventListener('online', updateOnlineState)
      window.removeEventListener('offline', updateOnlineState)
    }
  }, [])

  const selectedInstitution = useMemo(() => {
    if (!bootstrap?.institutions?.length) {
      return null
    }
    if (sessionUser?.institutionId) {
      return bootstrap.institutions.find((institution) => institution.id === sessionUser.institutionId) ?? bootstrap.institutions[0]
    }
    return bootstrap.institutions[0]
  }, [bootstrap, sessionUser])
  const activeColorScheme = (selectedInstitution?.colorScheme ?? 'ocean') as InstitutionColorScheme
  const appThemeStyle = useMemo(
    () =>
      ({
        ...institutionColorSchemes[activeColorScheme].style,
      }) as CSSProperties,
    [activeColorScheme],
  )

  const renderRequiredPasswordChange = () => (
    <div className="min-h-screen bg-gradient-to-b from-[var(--brand-50)] via-white to-slate-50 px-4 py-6 text-slate-900 md:px-6 md:py-10" style={appThemeStyle}>
      <main className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-5xl items-center">
        <section className="mx-auto grid w-full max-w-4xl gap-6 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--brand-700)] sm:tracking-[0.2em]">Account setup</p>
            <h1 className="mt-4 text-3xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-4xl md:text-5xl">
              Set a new password.
            </h1>
            <p className="mt-5 max-w-md text-base leading-7 text-slate-600">
              {sessionUser?.email} needs a password update before the workspace opens.
            </p>
          </div>
          <article className="rounded-xl border border-[var(--brand-100)] bg-white p-4 shadow-sm shadow-[color:var(--brand-shadow)] sm:p-6">
            <h2 className="text-xl font-semibold text-slate-950">Password change required</h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              Choose a new password with at least 10 characters.
            </p>
            <form className="mt-5 grid gap-3" onSubmit={(event) => void changePassword(event).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Password change failed.'))}>
              <PasswordInput autoComplete="current-password" name="currentPassword" placeholder="Old password" />
              <PasswordInput autoComplete="new-password" name="newPassword" placeholder="New password (min 10 chars)" />
              <PasswordInput autoComplete="new-password" name="confirmPassword" placeholder="Verify new password" />
              <button className="w-full rounded-full bg-[var(--brand-700)] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[color:var(--brand-shadow)] sm:w-fit" type="submit">
                Update password
              </button>
            </form>
            {error ? <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">{error}</p> : null}
          </article>
        </section>
      </main>
    </div>
  )

  const requireSession = (element: ReactNode) => (sessionUser ? element : <Navigate to={authRedirectPath} replace />)

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
      upsertDisplayedInstitution(updated)
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

  const saveInstitutionSettings = async (event: FormEvent<HTMLFormElement>, institution: Institution) => {
    event.preventDefault()
    if (!authToken) return
    setError(null)
    const formData = new FormData(event.currentTarget)
    const payload = {
      name: String(formData.get('name') ?? institution.name),
      slug: String(formData.get('slug') ?? institution.slug),
      timezone: String(formData.get('timezone') ?? institution.timezone),
      colorScheme: String(formData.get('colorScheme') ?? institution.colorScheme),
      singleQuestionModeEnabled: formData.get('singleQuestionModeEnabled') === 'true',
      qrModeEnabled: formData.get('qrModeEnabled') === 'true',
      retentionDays: Number(formData.get('retentionDays') ?? institution.retentionDays),
      kioskIdleResetSeconds: Number(formData.get('kioskIdleResetSeconds') ?? institution.kioskIdleResetSeconds),
      kioskCompletionMessage: String(formData.get('kioskCompletionMessage') ?? institution.kioskCompletionMessage),
    }
    const response = await fetch(`/api/institutions/${institution.id}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to save institution settings.')
    }
    const updated = (await response.json()) as Institution
    upsertDisplayedInstitution(updated)
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

  const loadInstitutionList = async (token: string) => {
    const response = await fetch('/api/institutions', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return
    const result = (await response.json()) as { institutions: Institution[] }
    setInstitutionList(result.institutions)
    setBootstrap((current) => (current ? { ...current, institutions: result.institutions } : current))
  }

  const loadManagedUsers = async (token: string) => {
    const response = await fetch('/api/auth/users', {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!response.ok) return
    const result = (await response.json()) as { users: ManagedUser[] }
    setManagedUsers(result.users)
  }

  const loadAuthenticatedWorkspace = async (token: string, user: AuthUser) => {
    if (user.role === 'root') {
      await Promise.all([loadRootOverview(token), loadSmtpSettings(token), loadInstitutionList(token), loadManagedUsers(token)])
    }
  }

  const defaultRedirectForRole = (role: AuthUser['role']) => {
    if (role === 'institution_kiosk') return '/kiosk'
    if (role === 'root') return '/root'
    return '/'
  }

  const applyAuthenticatedSession = async (session: { token: string; user: AuthUser; mustChangePassword: boolean; redirectPath?: string }) => {
    setAuthToken(session.token)
    setSessionUser(session.user)
    setMustChangePw(session.mustChangePassword)
    window.localStorage.setItem(authStorageKey, JSON.stringify({ token: session.token }))
    if (session.mustChangePassword) {
      return
    }
    await loadAuthenticatedWorkspace(session.token, session.user)
    const redirectPath =
      session.user.role === 'institution_kiosk'
        ? '/kiosk'
        : requestedRedirectPath === '/'
          ? (session.redirectPath ?? defaultRedirectForRole(session.user.role))
          : requestedRedirectPath
    navigate(redirectPath, { replace: true })
  }

  const logout = async () => {
    const token = authToken
    setAccountMenuOpen(false)
    clearAuthenticatedSession()
    if (token) {
      await fetch('/api/auth/logout', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      }).catch(() => undefined)
    }
    navigate('/login', { replace: true })
  }

  useEffect(() => {
    if (loading || sessionRestoreChecked.current) return
    sessionRestoreChecked.current = true

    const restoreSession = async () => {
      const stored = window.localStorage.getItem(authStorageKey)
      if (!stored) {
        setRestoringSession(false)
        return
      }

      try {
        const parsed = JSON.parse(stored) as { token?: unknown }
        const token = typeof parsed.token === 'string' ? parsed.token : ''
        if (!token) {
          throw new Error('Stored session is missing a token.')
        }

        const response = await fetch('/api/auth/session', {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!response.ok) {
          throw new Error('Stored session is invalid or expired.')
        }

        const session = await readJsonBody<{
          token?: string
          expiresAt: string
          user: AuthUser
          mustChangePassword?: boolean
          redirectPath?: string
        }>(response, 'Unable to restore your previous session.')
        const restoredToken = session.token ?? token
        setAuthToken(restoredToken)
        setSessionUser(session.user)
        setMustChangePw(Boolean(session.mustChangePassword))
        window.localStorage.setItem(authStorageKey, JSON.stringify({ token: restoredToken }))
        if (!session.mustChangePassword) {
          await loadAuthenticatedWorkspace(restoredToken, session.user)
        }
      } catch {
        clearAuthenticatedSession()
      } finally {
        setRestoringSession(false)
      }
    }

    void restoreSession()
    // Session restore is a guarded one-shot; rerunning it when loader helpers are recreated would be noisy.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading])

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
        throw new Error(await responseErrorMessage(response, 'Unable to request password reset.'))
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
    const email = String(formData.get('email') ?? '')
    const password = String(formData.get('password') ?? '')
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        password,
        turnstileToken,
      }),
    })

    if (!response.ok) {
      setTurnstileResetSignal((current) => current + 1)
      throw new Error(await responseErrorMessage(response, 'Unable to sign in.'))
    }

    const result = await readJsonBody<LoginResult>(response, 'The server returned an invalid sign-in response.')
    if ('challengePending' in result && result.challengePending) {
      setPendingTwoFa(result)
      return
    }
    const session = result as { token: string; user: AuthUser; mustChangePassword: boolean; redirectPath?: string }
    await applyAuthenticatedSession(session)
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
      throw new Error(await responseErrorMessage(response, 'OTP verification failed.'))
    }
    const result = await readJsonBody<{ token: string; user: AuthUser; mustChangePassword: boolean; redirectPath?: string }>(
      response,
      'The server returned an invalid verification response.',
    )
    setPendingTwoFa(null)
    await applyAuthenticatedSession(result)
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
    const form = event.currentTarget
    const formData = new FormData(form)
    const currentPassword = String(formData.get('currentPassword') ?? '')
    const newPassword = String(formData.get('newPassword') ?? '')
    const confirmPassword = formData.has('confirmPassword') ? String(formData.get('confirmPassword') ?? '') : null
    const wasRequiredPasswordChange = mustChangePw
    if (confirmPassword !== null && newPassword !== confirmPassword) {
      throw new Error('New passwords do not match.')
    }
    const response = await fetch('/api/auth/profile/password', {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(currentPassword ? { currentPassword } : {}),
        newPassword,
      }),
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to change password.')
    }
    form.reset()
    setMustChangePw(false)
    if (sessionUser) {
      await loadAuthenticatedWorkspace(authToken, sessionUser)
    }
    if (wasRequiredPasswordChange) {
      navigate(requestedRedirectPath, { replace: true })
    }
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
    upsertDisplayedInstitution(inst)
    await loadRootOverview(authToken)
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
    removeDisplayedInstitution(id)
    await loadRootOverview(authToken)
  }

  const createManagedUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!authToken) return
    setError(null)
    const form = event.currentTarget
    const formData = new FormData(form)
    const institutionId = Number(formData.get('institutionId') ?? 0)
    const response = await fetch(`/api/institutions/${institutionId}/users`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: String(formData.get('email') ?? ''),
        password: String(formData.get('password') ?? ''),
        role: String(formData.get('role') ?? 'institution_user'),
      }),
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(friendlyDisplayError(result.error ?? 'Unable to create user.'))
    }
    await loadManagedUsers(authToken)
    await loadRootOverview(authToken)
    form.reset()
  }

  const updateManagedUser = async (event: FormEvent<HTMLFormElement>, user: ManagedUser) => {
    event.preventDefault()
    if (!authToken) return
    setError(null)
    const formData = new FormData(event.currentTarget)
    const rawInstitutionId = String(formData.get('institutionId') ?? '')
    const response = await fetch(`/api/auth/users/${user.id}`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: String(formData.get('email') ?? user.email),
        role: String(formData.get('role') ?? user.role),
        institutionId: rawInstitutionId ? Number(rawInstitutionId) : null,
        status: String(formData.get('status') ?? user.status),
      }),
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to update user.')
    }
    const result = (await response.json()) as { user: ManagedUser }
    setManagedUsers((current) => current.map((item) => (item.id === result.user.id ? result.user : item)))
    await loadRootOverview(authToken)
  }

  const deleteManagedUser = async (user: ManagedUser) => {
    if (!authToken) return
    setError(null)
    const response = await fetch(`/api/auth/users/${user.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${authToken}` },
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to delete user.')
    }
    setManagedUsers((current) => current.filter((item) => item.id !== user.id))
    await loadRootOverview(authToken)
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
    const questionType = String(formData.get('questionType') ?? 'text') as Question['questionType']
    const options = formData.getAll('options').map((value) => String(value).trim()).filter(Boolean)
    const scheduleDaysRaw = String(formData.get('scheduleDays') ?? '')
    const scheduleDays = scheduleDaysRaw ? scheduleDaysRaw.split(',').map(Number).filter((n) => !isNaN(n) && n >= 0 && n <= 6) : []
    const response = await fetch(`/api/institutions/${institutionId}/questions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        questionType,
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
    setCustomQuestionType('text')
    setCustomQuestionOptions([])
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
      const response = await fetch(`/api/kiosk/${slug}/session`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      })
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
      const qKey = getQuestionKey(question)
      const response = await fetch('/api/kiosk/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: kioskSessionToken, questionKey: qKey, answer }),
      })
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response, 'Unable to record answer.'))
      }
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

    const questionKey = getQuestionKey(currentDemo)
    const answer = kioskDemoAnswers[questionKey]

    if (!skip && answer) {
      const response = await fetch('/api/kiosk/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionToken: kioskSessionToken, questionKey, answer }),
      })
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response, 'Unable to record answer.'))
      }
    }

    if (kioskDemoIdx + 1 < kioskDemographicQuestions.length) {
      setKioskDemoIdx((i) => i + 1)
    } else {
      await completeKiosk(kioskDemoAnswers)
    }
  }

  const completeKiosk = async (demoData: Record<string, string>) => {
    if (!kioskSessionToken) return
    const response = await fetch('/api/kiosk/complete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionToken: kioskSessionToken, demographicData: demoData }),
    })
    if (!response.ok) {
      throw new Error(await responseErrorMessage(response, 'Unable to complete feedback.'))
    }
    const result = await readJsonBody<{ feedbackMessage?: string }>(response, 'Unable to complete feedback.')
    setKioskFeedbackMessage(result.feedbackMessage ?? selectedInstitution?.kioskCompletionMessage ?? 'Your feedback has been recorded.')
    setKioskState('thankyou')
    setKioskCountdown(selectedInstitution?.kioskIdleResetSeconds ?? 10)
  }

  const refreshKioskQrToken = async () => {
    if (!authToken || !selectedInstitution?.slug || !selectedInstitution.qrModeEnabled) {
      setKioskQrToken(null)
      setKioskQrImage('')
      return
    }
    setKioskQrLoading(true)
    try {
      const response = await fetch(`/api/kiosk/${selectedInstitution.slug}/qr-token`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      })
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response, 'Unable to create QR link.'))
      }
      const token = await readJsonBody<KioskQrToken>(response, 'Unable to create QR link.')
      setKioskQrToken(token)
      setKioskQrImage(await QRCode.toDataURL(token.url, { margin: 1, width: 256 }))
    } catch (caughtError) {
      setKioskQrToken(null)
      setKioskQrImage('')
      setError(caughtError instanceof TypeError ? 'The kiosk is offline. QR submission is unavailable.' : caughtError instanceof Error ? caughtError.message : 'Unable to create QR link.')
    } finally {
      setKioskQrLoading(false)
    }
  }

  const resetKioskToLanding = () => {
    setKioskState('landing')
    setKioskSessionToken(null)
    setKioskQuestions([])
    setKioskCurrentIdx(0)
    setKioskCurrentAnswer('')
    setKioskStarValue(0)
    setKioskSliderValue(5)
    setKioskMultiAnswers([])
    setKioskDemoIdx(0)
    setKioskDemoAnswers({})
    setKioskCountdown(selectedInstitution?.kioskIdleResetSeconds ?? 10)
    setError(null)
  }

  useEffect(() => {
    if (sessionUser?.role !== 'institution_kiosk' || kioskState !== 'landing' || !selectedInstitution?.qrModeEnabled) {
      return
    }

    const initialTimer = window.setTimeout(() => {
      void refreshKioskQrToken()
    }, 0)
    const interval = window.setInterval(() => {
      void refreshKioskQrToken()
    }, 4 * 60 * 1000)
    return () => {
      window.clearTimeout(initialTimer)
      window.clearInterval(interval)
    }
    // QR refresh intentionally follows kiosk landing identity/settings only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUser?.role, kioskState, selectedInstitution?.id, selectedInstitution?.qrModeEnabled])

  useEffect(() => {
    if (sessionUser?.role !== 'institution_kiosk' || kioskState === 'landing' || kioskState === 'thankyou') {
      return
    }
    const idleMs = Math.max(5, selectedInstitution?.kioskIdleResetSeconds ?? 10) * 1000
    let timer = window.setTimeout(resetKioskToLanding, idleMs)
    const resetTimer = () => {
      window.clearTimeout(timer)
      timer = window.setTimeout(resetKioskToLanding, idleMs)
    }
    const events = ['pointerdown', 'keydown', 'touchstart']
    events.forEach((eventName) => window.addEventListener(eventName, resetTimer, { passive: true }))
    return () => {
      window.clearTimeout(timer)
      events.forEach((eventName) => window.removeEventListener(eventName, resetTimer))
    }
    // The reset function only clears kiosk-local state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionUser?.role, kioskState, selectedInstitution?.kioskIdleResetSeconds])

  if (loading || restoringSession) {
    return <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">Loading Qglimpse...</div>
  }

  if (!bootstrap) {
    return <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">{error ?? 'Bootstrap data unavailable.'}</div>
  }

  if (sessionUser && mustChangePw) {
    return renderRequiredPasswordChange()
  }

  if (isGuestQrPath) {
    return <GuestQrPage appVersion={bootstrap.app.version} offline={offline} />
  }

  if (sessionUser?.role === 'institution_kiosk' && location.pathname !== '/kiosk') {
    return <Navigate to="/kiosk" replace />
  }

  return (
    <Routes>
      <Route path="/kiosk" element={sessionUser?.role === 'institution_kiosk' ? <KioskFullScreen
        appVersion={bootstrap.app.version}
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
        kioskFeedbackMessage={kioskFeedbackMessage}
        kioskQrImage={kioskQrImage}
        kioskQrToken={kioskQrToken}
        kioskQrLoading={kioskQrLoading}
        offline={offline}
        error={error}
        onStart={() => void startKiosk()}
        onAnswer={setKioskCurrentAnswer}
        onStarChange={setKioskStarValue}
        onSliderChange={setKioskSliderValue}
        onMultiToggle={(opt) => setKioskMultiAnswers((current) => current.includes(opt) ? current.filter((o) => o !== opt) : [...current, opt])}
        onSubmitAnswer={() => void submitKioskAnswer().catch((err: unknown) => setError(err instanceof Error ? err.message : 'Unable to submit answer.'))}
        onDemoAnswer={(key, val) => setKioskDemoAnswers((current) => ({ ...current, [key]: val }))}
        onComplete={resetKioskToLanding}
        onDemoSkip={() => void advanceKioskDemographic(true).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Unable to continue.'))}
        onDemoNext={() => void advanceKioskDemographic(false).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Unable to continue.'))}
        onRefreshQr={() => void refreshKioskQrToken()}
      /> : <Navigate to={sessionUser ? '/' : authRedirectPath} replace />} />
      <Route path="*" element={
    <div className="min-h-screen bg-gradient-to-b from-[var(--brand-50)] via-white to-slate-50 text-slate-900" style={appThemeStyle}>
      <header className="border-b border-[var(--brand-100)] bg-white/90 backdrop-blur">
        <div className={`mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 sm:px-6 ${sessionUser ? 'py-4 sm:py-6' : 'pb-5 pt-20 sm:pt-6'}`}>
          <div className="flex min-w-0 items-start gap-3 sm:gap-4">
            <QglimpseLogo className="mt-1 h-12 w-12 shrink-0 sm:h-16 sm:w-16" />
            <div className="min-w-0">
              {!isLoginPath ? <p className="text-xs font-semibold uppercase text-[var(--brand-700)] sm:text-sm">Visitor feedback platform</p> : null}
              <h1 className={`${isLoginPath ? '' : 'mt-2'} text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl md:text-4xl`}>{bootstrap.app.name}</h1>
              {!sessionUser && !isLoginPath ? <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600 sm:text-base">
                Qglimpse helps organizations capture anonymous in-person feedback quickly with logged-in kiosks, secure sign-in, and easy analytics.
              </p> : null}
            </div>
          </div>
          {sessionUser && sessionUser.role !== 'institution_kiosk' ? (
            <button
              aria-controls="mobile-primary-navigation"
              aria-expanded={mobileNavOpen}
              aria-label={mobileNavOpen ? 'Close navigation menu' : 'Open navigation menu'}
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[var(--brand-100)] bg-white text-slate-800 shadow-sm shadow-[color:var(--brand-shadow)] hover:bg-[var(--brand-50)] md:hidden"
              onClick={() => setMobileNavOpen((current) => !current)}
              type="button"
            >
              <span className="grid gap-1" aria-hidden="true">
                <span className={`block h-0.5 w-5 rounded-full bg-current transition ${mobileNavOpen ? 'translate-y-1.5 rotate-45' : ''}`} />
                <span className={`block h-0.5 w-5 rounded-full bg-current transition ${mobileNavOpen ? 'opacity-0' : ''}`} />
                <span className={`block h-0.5 w-5 rounded-full bg-current transition ${mobileNavOpen ? '-translate-y-1.5 -rotate-45' : ''}`} />
              </span>
            </button>
          ) : null}
          {sessionUser && sessionUser.role !== 'institution_kiosk' ? (
            <div className="relative hidden md:block" ref={accountMenuRef}>
              <button
                aria-expanded={accountMenuOpen}
                aria-haspopup="menu"
                className="flex max-w-sm items-center gap-2 rounded-full border border-[var(--brand-100)] bg-white px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-[var(--brand-50)]"
                onClick={() => setAccountMenuOpen((current) => !current)}
                type="button"
              >
                <span className="max-w-64 truncate">{sessionUser.email}</span>
                <span aria-hidden="true" className="text-xs text-slate-500">{accountMenuOpen ? 'Close' : 'Menu'}</span>
              </button>
              {accountMenuOpen ? (
                <div className="absolute right-0 z-20 mt-2 grid min-w-56 overflow-hidden rounded-xl border border-slate-200 bg-white py-2 text-sm shadow-xl shadow-slate-200/70" role="menu">
                  <NavLink
                    className="px-4 py-2 font-medium text-slate-700 hover:bg-[var(--brand-50)] hover:text-[var(--brand-900)]"
                    onClick={() => setAccountMenuOpen(false)}
                    role="menuitem"
                    to="/profile"
                  >
                    Edit profile
                  </NavLink>
                  <button
                    className="px-4 py-2 text-left font-medium text-red-700 hover:bg-red-50"
                    onClick={() => void logout()}
                    role="menuitem"
                    type="button"
                  >
                    Logout
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
        <nav aria-label="Primary" className={`mx-auto w-full max-w-6xl px-4 pb-4 sm:px-6 sm:pb-6 ${sessionUser ? 'hidden md:flex md:flex-wrap md:gap-2' : 'grid grid-cols-2 gap-2 sm:flex sm:flex-wrap'}`}>
          {!sessionUser ? (
            <>
              <NavLink className={navClass} to="/">Home</NavLink>
              <NavLink className={navClass} to="/login">Sign in</NavLink>
              {canOfferInstall ? (
                <button className={installButtonClass} onClick={() => void promptPwaInstall()} type="button">
                  Install app
                </button>
              ) : null}
            </>
          ) : (
            <>
              <NavLink className={navClass} to="/">Overview</NavLink>
              {sessionUser.role === 'institution_kiosk' ? <NavLink className={navClass} to="/kiosk">Kiosk</NavLink> : null}
              {sessionUser.role !== 'institution_kiosk' ? (
                <>
                  <NavLink className={navClass} to="/institutions">Institutions</NavLink>
                  <NavLink className={navClass} to="/questions">Questions</NavLink>
                  <NavLink className={navClass} to="/analytics">Analytics</NavLink>
                </>
              ) : null}
              {sessionUser.role === 'root' ? (
                <>
                  <NavLink className={navClass} to="/root">Root</NavLink>
                  <NavLink className={navClass} to="/users">Users</NavLink>
                  <NavLink className={navClass} to="/smtp">SMTP</NavLink>
                </>
              ) : null}
              {canOfferInstall ? (
                <button className={installButtonClass} onClick={() => void promptPwaInstall()} type="button">
                  Install app
                </button>
              ) : null}
            </>
          )}
        </nav>
        {sessionUser && sessionUser.role !== 'institution_kiosk' && mobileNavOpen ? (
          <nav
            aria-label="Mobile primary"
            className="mx-4 mb-4 grid gap-2 rounded-xl border border-[var(--brand-100)] bg-white p-3 shadow-lg shadow-[color:var(--brand-shadow)] md:hidden"
            id="mobile-primary-navigation"
          >
            <p className="truncate px-2 pb-1 text-xs font-semibold uppercase text-slate-500">{sessionUser.email}</p>
            <NavLink className={navClass} onClick={() => setMobileNavOpen(false)} to="/">Overview</NavLink>
            <NavLink className={navClass} onClick={() => setMobileNavOpen(false)} to="/institutions">Institutions</NavLink>
            <NavLink className={navClass} onClick={() => setMobileNavOpen(false)} to="/questions">Questions</NavLink>
            <NavLink className={navClass} onClick={() => setMobileNavOpen(false)} to="/analytics">Analytics</NavLink>
            {sessionUser.role === 'root' ? (
              <>
                <NavLink className={navClass} onClick={() => setMobileNavOpen(false)} to="/root">Root</NavLink>
                <NavLink className={navClass} onClick={() => setMobileNavOpen(false)} to="/users">Users</NavLink>
                <NavLink className={navClass} onClick={() => setMobileNavOpen(false)} to="/smtp">SMTP</NavLink>
              </>
            ) : null}
            {canOfferInstall ? (
              <button
                className={installButtonClass}
                onClick={() => {
                  setMobileNavOpen(false)
                  void promptPwaInstall()
                }}
                type="button"
              >
                Install app
              </button>
            ) : null}
            <div className="mt-1 grid gap-2 border-t border-slate-200 pt-3">
              <NavLink className={navClass} onClick={() => setMobileNavOpen(false)} to="/profile">Edit profile</NavLink>
              <button
                className="inline-flex min-h-11 w-full items-center justify-center rounded-full px-4 py-2 text-sm font-semibold text-red-700 hover:bg-red-50"
                onClick={() => void logout()}
                type="button"
              >
                Logout
              </button>
            </div>
          </nav>
        ) : null}
      </header>

      {installHelpOpen ? (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 px-4 py-6" role="dialog" aria-modal="true" aria-labelledby="install-help-title">
          <section className="w-full max-w-md rounded-xl border border-[var(--brand-100)] bg-white p-5 shadow-2xl shadow-slate-900/20">
            <div className="flex items-start gap-4">
              <QglimpseLogo className="h-12 w-12 shrink-0" />
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-950" id="install-help-title">Install Qglimpse</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">
                  If your browser does not open an install prompt, use the browser menu and choose Install app, Add to home screen, or Apps.
                </p>
              </div>
            </div>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:justify-end">
              <button
                className="inline-flex min-h-11 items-center justify-center rounded-full bg-[var(--brand-700)] px-4 py-2 text-sm font-semibold text-white hover:bg-[var(--brand-600)]"
                onClick={() => setInstallHelpOpen(false)}
                type="button"
              >
                Done
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <main className="mx-auto grid max-w-6xl gap-5 px-4 py-5 sm:gap-6 sm:py-8 md:px-6">
        {error ? <div className="rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">{error}</div> : null}
        <Routes>
          <Route
            path="/"
            element={
              !sessionUser ? (
                <div className="grid gap-8">
                  <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
                    <div className="py-2 sm:py-4">
                      <p className="text-xs font-semibold uppercase text-[var(--brand-700)] sm:tracking-[0.2em]">Visitor feedback for institutions</p>
                      <h2 className="mt-4 max-w-3xl text-3xl font-semibold leading-tight tracking-tight text-slate-950 sm:text-4xl md:text-5xl">
                        Understand your visitors in the moment.
                      </h2>
                      <p className="mt-4 max-w-2xl text-base leading-7 text-slate-700 sm:mt-5 sm:text-lg sm:leading-8">
                        Qglimpse is a lightweight web app that helps institutions collect one active anonymous feedback answer,
                        understand their audience, and share useful information through logged-in kiosks and single-use QR links.
                      </p>
                      <div className="mt-7 flex flex-wrap items-center gap-3">
                        <NavLink
                          className="inline-flex min-h-11 w-full items-center justify-center rounded-full bg-[var(--brand-700)] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[color:var(--brand-shadow)] sm:w-auto"
                          to="/login"
                        >
                          Sign in
                        </NavLink>
                      </div>
                    </div>
                    <form
                      className="rounded-xl border border-[var(--brand-100)] bg-white p-4 shadow-sm shadow-[color:var(--brand-shadow)] sm:p-5"
                      onSubmit={(event) => void submitInstitutionInterest(event).catch((caughtError: unknown) => setError(caughtError instanceof Error ? caughtError.message : 'Interest registration failed.'))}
                    >
                      <h3 className="text-lg font-semibold text-slate-950">Register institutional interest</h3>
                      <p className="mt-2 text-sm leading-6 text-slate-600">
                        Register interest for a school, health service, venue, or public-facing team.
                      </p>
                      <div className="mt-5 grid gap-3">
                        <input className="rounded-xl border border-slate-300 px-3 py-2" name="institutionName" placeholder="Institution name" required type="text" />
                        <input className="rounded-xl border border-slate-300 px-3 py-2" name="contactName" placeholder="Contact name" required type="text" />
                        <input className="rounded-xl border border-slate-300 px-3 py-2" name="email" placeholder="Email address" required type="email" />
                        <textarea
                          className="min-h-28 rounded-xl border border-slate-300 px-3 py-2"
                          name="notes"
                          placeholder="Where would you use Qglimpse?"
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
                          className="w-full rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:bg-slate-300 sm:w-fit"
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
                      <p className="mt-2 text-sm text-slate-600">Institution admins can toggle kiosk mode for their own institution.</p>
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
            path="/login"
            element={
              sessionUser ? (
                <Navigate to={requestedRedirectPath} replace />
              ) : (
                <section className="mx-auto grid w-full max-w-lg gap-4 py-2 sm:py-8">
                <article className="rounded-xl border border-[var(--brand-100)] bg-white p-4 shadow-sm shadow-[color:var(--brand-shadow)] sm:p-6">
                  <form className="grid gap-3" onSubmit={(event) => void loginAuthUser(event).catch((caughtError: unknown) => setError(caughtError instanceof TypeError ? 'Unable to reach the server. Please check your connection and try again.' : caughtError instanceof Error ? caughtError.message : 'Login failed.'))}>
                    <input autoComplete="username" className="rounded-xl border border-slate-300 px-3 py-2" name="email" placeholder="Email address" required type="email" />
                    <PasswordInput autoComplete="current-password" name="password" placeholder="Password" />
                    {requiresTurnstileWidget && bootstrap.authCore.turnstileSiteKey ? (
                      <TurnstileWidget
                        id="quickglimpse-login-turnstile"
                        resetSignal={turnstileResetSignal}
                        siteKey={bootstrap.authCore.turnstileSiteKey}
                        onTokenChange={setTurnstileToken}
                      />
                    ) : null}
                    <button
                      className="w-full rounded-full bg-[var(--brand-700)] px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[color:var(--brand-shadow)] disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none sm:w-fit"
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
                      <button className="w-full rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white sm:w-fit" type="submit">
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
                        <div className="mt-1 text-sky-700">Enter the one-time code sent to {pendingTwoFa.email}.</div>
                        <form className="mt-3 grid gap-2 sm:flex" onSubmit={(event) => void verify2FA(event).catch((err: unknown) => setError(err instanceof TypeError ? 'Unable to reach the server. Please check your connection and try again.' : err instanceof Error ? err.message : '2FA failed.'))}>
                          <input className="rounded-xl border border-slate-300 px-3 py-2 font-mono" name="code" placeholder="000000" required />
                          <button className="rounded-full bg-sky-700 px-4 py-2 text-sm font-semibold text-white" type="submit">Verify</button>
                        </form>
                      </div>
                    ) : null}
                </article>
                <NavLink className="justify-self-start text-sm font-semibold text-[var(--brand-700)] underline underline-offset-4" to="/">
                  Back to home
                </NavLink>
              </section>
              )
            }
          />
          <Route
            path="/auth-core"
            element={<Navigate to="/login" replace />}
          />
          <Route
            path="/institution"
            element={requireSession(<Navigate to="/institutions" replace />)}
          />
          <Route
            path="/institutions"
            element={requireSession(
              <section className="grid gap-6">
                {sessionUser?.role === 'root' ? (
                  <article className={statCardClass}>
                    <h2 className="text-xl font-semibold">Manage institutions (administrator-only)</h2>
                    <form className="mt-4 grid gap-3 sm:flex" onSubmit={(event) => void createInstitution(event).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed.'))}>
                      <input className="flex-1 rounded-xl border border-slate-300 px-3 py-2" name="name" placeholder="Institution name" required />
                      <button className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white" type="submit">Create</button>
                    </form>
                    <div className="mt-4 grid gap-3 text-sm">
                      {institutionList.map((inst) => (
                        <div className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 sm:flex sm:items-center sm:justify-between" key={inst.id}>
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900">{inst.name}</div>
                            <div className="break-words text-slate-500">{inst.slug} · {inst.timezone}</div>
                          </div>
                          <button className="rounded-full bg-red-100 px-3 py-1 text-xs font-semibold text-red-700 ring-1 ring-red-300 sm:w-auto" onClick={() => void deleteInstitution(inst.id).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed.'))} type="button">Delete</button>
                        </div>
                      ))}
                    </div>
                  </article>
                ) : null}
                <div className="grid gap-4 xl:grid-cols-2">
                  {bootstrap.institutions.map((institution) => (
                    <article
                      className={statCardClass}
                      key={`${institution.id}:${institution.name}:${institution.slug}:${institution.timezone}:${institution.colorScheme}:${institution.retentionDays}:${institution.kioskIdleResetSeconds}:${institution.kioskCompletionMessage}:${institution.singleQuestionModeEnabled}:${institution.qrModeEnabled}`}
                    >
                      <div className="grid gap-4 sm:flex sm:flex-wrap sm:items-start sm:justify-between">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand-700)]">Institution</p>
                          <h2 className="mt-2 text-xl font-semibold">{institution.name}</h2>
                          <p className="mt-2 text-sm text-slate-600">Slug: {institution.slug}</p>
                          <p className="mt-1 text-sm text-slate-600">Timezone: {institution.timezone}</p>
                          <p className="mt-1 text-sm text-slate-600">Status: {institution.status}</p>
                          <p className="mt-1 text-sm text-slate-600">Theme: {institutionColorSchemes[institution.colorScheme]?.label ?? institution.colorScheme}</p>
                          <p className="mt-1 text-sm text-slate-600">Retention: {institution.retentionDays} days</p>
                          <p className="mt-1 text-sm text-slate-600">Single question: {institution.singleQuestionModeEnabled ? 'On' : 'Off'} · QR: {institution.qrModeEnabled ? 'On' : 'Off'}</p>
                        </div>
                        <button
                          className={`w-full rounded-full px-4 py-2 text-sm font-semibold sm:w-auto ${institution.kioskModeEnabled ? 'bg-[var(--brand-600)] text-white' : 'bg-slate-200 text-slate-900'}`}
                          onClick={() => void toggleKioskMode(institution)}
                          type="button"
                        >
                          {institution.kioskModeEnabled ? 'Kiosk on' : 'Kiosk off'}
                        </button>
                      </div>
                      {sessionUser?.role === 'root' || (sessionUser?.role === 'institution_admin' && sessionUser.institutionId === institution.id) ? (
                        <form className="mt-4 grid gap-3 border-t border-slate-100 pt-4" onSubmit={(event) => void saveInstitutionSettings(event, institution).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Save failed.'))}>
                          <div className="grid gap-3 lg:grid-cols-2">
                            <label className="grid gap-1 text-sm font-medium">
                              Name
                              <input className="rounded-xl border border-slate-300 px-3 py-2" defaultValue={institution.name} name="name" required />
                            </label>
                            <label className="grid gap-1 text-sm font-medium">
                              Slug
                              <input className="rounded-xl border border-slate-300 px-3 py-2" defaultValue={institution.slug} name="slug" required />
                            </label>
                            <label className="grid gap-1 text-sm font-medium">
                              Timezone
                              <select
                                className="rounded-xl border border-slate-300 px-3 py-2"
                                defaultValue={institution.timezone}
                                name="timezone"
                                required
                              >
                                {timezoneChoiceGroups.map((group) => (
                                  <optgroup key={group.label} label={formatTimezoneGroupLabel(group)}>
                                    {group.choices.map((timezone) => (
                                      <option key={timezone.value} value={timezone.value}>{timezone.label}</option>
                                    ))}
                                  </optgroup>
                                ))}
                              </select>
                            </label>
                            <label className="grid gap-1 text-sm font-medium">
                              Theme
                              <select className="rounded-xl border border-slate-300 px-3 py-2" defaultValue={institution.colorScheme} name="colorScheme">
                                {Object.entries(institutionColorSchemes).map(([value, scheme]) => (
                                  <option key={value} value={value}>{scheme.label}</option>
                                ))}
                              </select>
                            </label>
                            <label className="grid gap-1 text-sm font-medium">
                              Retention days
                              <input className="rounded-xl border border-slate-300 px-3 py-2" defaultValue={institution.retentionDays} max="90" min="1" name="retentionDays" type="number" />
                            </label>
                            <label className="grid gap-1 text-sm font-medium">
                              Kiosk reset seconds
                              <input className="rounded-xl border border-slate-300 px-3 py-2" defaultValue={institution.kioskIdleResetSeconds} max="300" min="5" name="kioskIdleResetSeconds" type="number" />
                            </label>
                          </div>
                          <label className="grid gap-1 text-sm font-medium">
                            Completion message
                            <input className="rounded-xl border border-slate-300 px-3 py-2" defaultValue={institution.kioskCompletionMessage} maxLength={240} name="kioskCompletionMessage" />
                          </label>
                          <div className="flex flex-wrap gap-4 text-sm">
                            <label className="flex items-center gap-2 font-medium">
                              <input name="singleQuestionModeEnabled" type="hidden" value="false" />
                              <input defaultChecked={Boolean(institution.singleQuestionModeEnabled)} name="singleQuestionModeEnabled" type="checkbox" value="true" />
                              Single-question mode
                            </label>
                            <label className="flex items-center gap-2 font-medium">
                              <input name="qrModeEnabled" type="hidden" value="false" />
                              <input defaultChecked={Boolean(institution.qrModeEnabled)} name="qrModeEnabled" type="checkbox" value="true" />
                              QR mode
                            </label>
                          </div>
                          <button className="w-full rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white sm:w-fit" type="submit">Save settings</button>
                        </form>
                      ) : null}
                    </article>
                  ))}
                </div>
              </section>,
            )}
          />
          <Route
            path="/users"
            element={requireSession(
              sessionUser?.role === 'root' ? (
                <section className="grid gap-6">
                  <article className={statCardClass}>
                    <h2 className="text-xl font-semibold">Create institution user</h2>
                    <form className="mt-4 grid gap-4 md:grid-cols-[1fr_1fr_1fr_1fr_auto]" onSubmit={(event) => void createManagedUser(event).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Create failed.'))}>
                      <input className="rounded-xl border border-slate-300 px-3 py-2" name="email" placeholder="Email" required type="email" />
                      <label className="grid gap-1">
                        <span className="sr-only">Temporary password</span>
                        <input className="rounded-xl border border-slate-300 px-3 py-2" minLength={10} name="password" placeholder="Temporary password" required type="password" />
                        <span className="text-xs text-slate-500">At least 10 characters.</span>
                      </label>
                      <select className="rounded-xl border border-slate-300 px-3 py-2" name="role" defaultValue="institution_user">
                        <option value="institution_admin">Institution admin</option>
                        <option value="institution_user">Institution user</option>
                        <option value="institution_kiosk">Kiosk user</option>
                      </select>
                      <select className="rounded-xl border border-slate-300 px-3 py-2" name="institutionId" required>
                        <option value="">Institution</option>
                        {bootstrap.institutions.map((institution) => (
                          <option key={institution.id} value={institution.id}>{institution.name}</option>
                        ))}
                      </select>
                      <button className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white" type="submit">Create</button>
                    </form>
                  </article>
                  <article className={statCardClass}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <h2 className="text-xl font-semibold">Users</h2>
                      {authToken ? (
                        <button className="rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-700" onClick={() => void loadManagedUsers(authToken)} type="button">Reload</button>
                      ) : null}
                    </div>
                    <div className="mt-4 grid gap-3">
                      {managedUsers.map((user) => (
                        <form className="grid gap-3 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4 lg:grid-cols-[1.5fr_1fr_1fr_1fr_auto_auto]" key={`${user.id}:${user.email}:${user.role}:${user.institutionId ?? 'none'}:${user.status}`} onSubmit={(event) => void updateManagedUser(event, user).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Update failed.'))}>
                          <input className="rounded-xl border border-slate-300 px-3 py-2" defaultValue={user.email} name="email" type="email" />
                          <select className="rounded-xl border border-slate-300 px-3 py-2" defaultValue={user.role} disabled={user.role === 'root'} name="role">
                            <option value="root">Root</option>
                            <option value="institution_admin">Institution admin</option>
                            <option value="institution_user">Institution user</option>
                            <option value="institution_kiosk">Kiosk user</option>
                          </select>
                          <select className="rounded-xl border border-slate-300 px-3 py-2" defaultValue={user.institutionId ?? ''} disabled={user.role === 'root'} name="institutionId">
                            <option value="">Unassigned</option>
                            {bootstrap.institutions.map((institution) => (
                              <option key={institution.id} value={institution.id}>{institution.name}</option>
                            ))}
                          </select>
                          <select className="rounded-xl border border-slate-300 px-3 py-2" defaultValue={user.status} disabled={user.role === 'root'} name="status">
                            <option value="active">Active</option>
                            <option value="suspended">Suspended</option>
                            <option value="deactivated">Deactivated</option>
                          </select>
                          <button className="rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white" type="submit">Save</button>
                          <button
                            className="rounded-full bg-red-100 px-4 py-2 text-sm font-semibold text-red-700 ring-1 ring-red-300 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={user.role === 'root'}
                            onClick={() => void deleteManagedUser(user).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Delete failed.'))}
                            type="button"
                          >
                            Delete
                          </button>
                        </form>
                      ))}
                    </div>
                  </article>
                </section>
              ) : (
                <Navigate to="/" replace />
              ),
            )}
          />
          <Route
            path="/root"
            element={requireSession(
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
              </section>,
            )}
          />
          <Route
            path="/questions"
            element={requireSession(
              <section className="grid gap-6">
                <div className="grid gap-3 sm:flex sm:items-center sm:justify-between">
                  <h2 className="text-xl font-semibold">Institution questions</h2>
                  {selectedInstitution && authToken ? (
                    <button
                      className="w-full rounded-full bg-[var(--brand-700)] px-4 py-2 text-sm font-semibold text-white sm:w-auto"
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
                          <div className="grid gap-3 sm:flex sm:flex-wrap sm:items-start sm:justify-between">
                            <div className="min-w-0 flex-1">
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
                            <div className="grid gap-2 sm:flex">
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
                            <select
                              className="rounded-xl border border-slate-300 px-3 py-2"
                              name="questionType"
                              value={customQuestionType}
                              onChange={(event) => {
                                const nextType = event.target.value as Question['questionType']
                                setCustomQuestionType(nextType)
                                setCustomQuestionOptions(defaultOptionRowsForType(nextType))
                              }}
                            >
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
                        {questionNeedsListOptions(customQuestionType) ? (
                          <fieldset className="grid gap-3 rounded-xl border border-slate-200 px-4 py-3">
                            <legend className="px-1 text-sm font-semibold text-slate-900">
                              {customQuestionType === 'single' ? 'Single-choice options' : 'Multiple-choice options'}
                            </legend>
                            <div className="grid gap-2">
                              {customQuestionOptions.map((option, index) => (
                                <div className="grid gap-2 sm:grid-cols-[auto_1fr_auto] sm:items-center" key={`option-${index}`}>
                                  <span className="text-sm font-medium text-slate-600">Option {index + 1}</span>
                                  <input
                                    className="rounded-xl border border-slate-300 px-3 py-2"
                                    name="options"
                                    placeholder={`Option ${index + 1}`}
                                    required
                                    value={option}
                                    onChange={(event) =>
                                      setCustomQuestionOptions((current) => current.map((item, itemIndex) => (itemIndex === index ? event.target.value : item)))
                                    }
                                  />
                                  <button
                                    className="rounded-full bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={customQuestionOptions.length <= 2}
                                    onClick={() => setCustomQuestionOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}
                                    type="button"
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button
                              className="w-fit rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
                              onClick={() => setCustomQuestionOptions((current) => [...current, ''])}
                              type="button"
                            >
                              Add option
                            </button>
                          </fieldset>
                        ) : null}
                        {questionNeedsEndpointLabels(customQuestionType) ? (
                          <fieldset className="grid gap-3 rounded-xl border border-slate-200 px-4 py-3">
                            <legend className="px-1 text-sm font-semibold text-slate-900">
                              {customQuestionType === 'boolean' ? 'Button labels' : 'Endpoint labels'}
                            </legend>
                            <div className="grid gap-3 sm:grid-cols-2">
                              <label className="grid gap-2 text-sm font-medium">
                                {customQuestionType === 'boolean' ? 'True / positive value' : 'Low end'}
                                <input
                                  className="rounded-xl border border-slate-300 px-3 py-2"
                                  name="options"
                                  required
                                  value={customQuestionOptions[0] ?? ''}
                                  onChange={(event) => setCustomQuestionOptions((current) => [event.target.value, current[1] ?? ''])}
                                />
                              </label>
                              <label className="grid gap-2 text-sm font-medium">
                                {customQuestionType === 'boolean' ? 'False / negative value' : 'High end'}
                                <input
                                  className="rounded-xl border border-slate-300 px-3 py-2"
                                  name="options"
                                  required
                                  value={customQuestionOptions[1] ?? ''}
                                  onChange={(event) => setCustomQuestionOptions((current) => [current[0] ?? '', event.target.value])}
                                />
                              </label>
                            </div>
                          </fieldset>
                        ) : null}
                        <div className="grid gap-3 text-sm sm:flex sm:gap-6">
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
                        <button className="w-full rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white sm:w-fit" type="submit">Create question</button>
                      </form>
                    </article>
                  </>
                )}
              </section>,
            )}
          />
          <Route
            path="/smtp"
            element={requireSession(
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
              </section>,
            )}
          />
          <Route
            path="/analytics"
            element={requireSession(
              <section className="grid gap-6">
                <article className={statCardClass}>
                  <div className="grid gap-4 lg:flex lg:flex-wrap lg:items-end lg:justify-between">
                    <h2 className="text-xl font-semibold">Analytics</h2>
                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
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
                                <div className="mt-2 grid grid-cols-[minmax(5rem,1fr)_minmax(7rem,3fr)_auto] items-center gap-3 text-sm" key={resp.answer}>
                                  <span className="min-w-0 truncate text-slate-700">{resp.answer}</span>
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
              </section>,
            )}
          />
          <Route
            path="/profile"
            element={requireSession(
              <section className="grid gap-6 lg:grid-cols-2">
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Change password</h2>
                  {!sessionUser ? (
                    <p className="mt-3 text-sm text-amber-700">Login required.</p>
                  ) : (
                    <form className="mt-4 grid gap-3" onSubmit={(event) => void changePassword(event).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed.'))}>
                      <PasswordInput autoComplete="current-password" name="currentPassword" placeholder="Old password" />
                      <PasswordInput autoComplete="new-password" name="newPassword" placeholder="New password (min 10 chars)" />
                      <PasswordInput autoComplete="new-password" name="confirmPassword" placeholder="Verify new password" />
                      <button className="w-full rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white sm:w-fit" type="submit">Update password</button>
                    </form>
                  )}
                </article>
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Two-factor authentication</h2>
                  <p className="mt-2 text-sm text-slate-600">Enable or disable OTP-based 2FA for your account.</p>
                  {sessionUser ? (
                    <div className="mt-4 grid gap-3 sm:flex">
                      <button className="rounded-full bg-sky-700 px-4 py-2 text-sm font-semibold text-white" onClick={() => void toggle2FA(sessionUser.id, true).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed.'))} type="button">Enable 2FA</button>
                      <button className="rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-900" onClick={() => void toggle2FA(sessionUser.id, false).catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed.'))} type="button">Disable 2FA</button>
                    </div>
                  ) : (
                    <p className="mt-3 text-sm text-amber-700">Login required.</p>
                  )}
                </article>
              </section>,
            )}
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
                    <li>Sign in from <code>/login</code> using your institutional account.</li>
                    <li>Enable kiosk mode from the Institutions view if visitor collection is paused.</li>
                    <li>Use Analytics for date-range response summaries and demographic cross-tab views.</li>
                    <li>Use the account menu at the top-right to update password and 2FA.</li>
                    <li>Root users can manage SMTP settings, retention controls, and institution lifecycle controls.</li>
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
                    Qglimpse is designed for anonymous visitor feedback. Visitor names, direct contact details,
                    and other direct identifiers are banned in guest feedback.
                  </p>
                  <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-700">
                    <li>Institution and account administration data is stored for service operation.</li>
                    <li>Visitor feedback responses are stored with anonymous session linkage for analytics only.</li>
                    <li>Demographic questions are optional and category-based.</li>
                    <li>Raw feedback, kiosk sessions, QR tokens, demographic payloads, and direct analytics inputs use 90-day default retention.</li>
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
                    Qglimpse minimises data processing by separating administrator account data from anonymous
                    visitor response data and limiting privileged visibility to aggregate metrics.
                  </p>
                  <ul className="mt-4 list-disc space-y-2 pl-5 text-sm text-slate-700">
                    <li>Purpose limitation: service-quality measurement and operational insight.</li>
                    <li>Data minimisation: no required direct identifiers for kiosk respondents.</li>
                    <li>Access controls: role-based authorization and institution scoping.</li>
                    <li>Retention controls: raw guest data expires after 90 days by default.</li>
                    <li>Security controls: CSP, HSTS, CORP/COOP, session expiry, and rate limiting.</li>
                  </ul>
                </article>
              </section>
            }
          />
          <Route
            path="/magic-link"
            element={<MagicLinkHandler onSession={(session) => void applyAuthenticatedSession(session)} />}
          />
          <Route
            path="*"
            element={!sessionUser && !isPublicPath ? <Navigate to={authRedirectPath} replace /> : <Navigate to="/" replace />}
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

function MagicLinkHandler({ onSession }: { onSession: (session: { token: string; user: AuthUser; mustChangePassword: boolean; redirectPath?: string }) => void }) {
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
        return response.json() as Promise<{ token: string; user: AuthUser; mustChangePassword?: boolean; redirectPath?: string }>
      })
      .then((result) => {
        onSession({ ...result, mustChangePassword: Boolean(result.mustChangePassword) })
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

function GuestQrPage({ appVersion, offline }: { appVersion: string; offline: boolean }) {
  const location = useLocation()
  const token = decodeURIComponent(location.pathname.replace(/^\/guest\/qr\//, ''))
  const [payload, setPayload] = useState<GuestQrPayload | null>(null)
  const [answers, setAnswers] = useState<Record<string, unknown>>({})
  const [status, setStatus] = useState<'loading' | 'ready' | 'submitting' | 'complete' | 'error'>('loading')
  const [message, setMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      if (!token) {
        setStatus('error')
        setMessage('This QR link is missing its token.')
        return
      }
      try {
        const response = await fetch(`/api/guest/qr/${encodeURIComponent(token)}`)
        if (!response.ok) {
          throw new Error(await responseErrorMessage(response, 'This QR link is no longer available.'))
        }
        const result = await readJsonBody<GuestQrPayload>(response, 'This QR link is no longer available.')
        if (!cancelled) {
          setPayload(result)
          setStatus('ready')
        }
      } catch (caughtError) {
        if (!cancelled) {
          setStatus('error')
          setMessage(caughtError instanceof TypeError ? 'You appear to be offline. Please reconnect and scan a fresh QR code.' : caughtError instanceof Error ? caughtError.message : 'This QR link is unavailable.')
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [token])

  const updateAnswer = (question: GuestQuestion, value: unknown) => {
    setAnswers((current) => ({ ...current, [getQuestionKey(question)]: value }))
  }

  const submit = async () => {
    if (!payload || offline) return
    setStatus('submitting')
    setMessage('')
    const answerList = payload.questions
      .filter((question) => {
        const value = answers[getQuestionKey(question)]
        if (Array.isArray(value)) return value.length > 0
        if (typeof value === 'string') return value.trim().length > 0
        return value !== undefined && value !== null
      })
      .map((question) => ({ questionKey: getQuestionKey(question), answer: answers[getQuestionKey(question)] }))
    const hasPromptAnswer = payload.questions.some((question) => !question.isDemographic && answerList.some((answer) => answer.questionKey === getQuestionKey(question)))
    if (!hasPromptAnswer) {
      setStatus('ready')
      setMessage('Please answer the feedback question before submitting.')
      return
    }

    try {
      const response = await fetch(`/api/guest/qr/${encodeURIComponent(token)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers: answerList, demographicData: {} }),
      })
      if (!response.ok) {
        throw new Error(await responseErrorMessage(response, 'Unable to submit feedback.'))
      }
      const result = await readJsonBody<{ feedbackMessage?: string }>(response, 'Unable to submit feedback.')
      setMessage(result.feedbackMessage ?? payload.institution.kioskCompletionMessage)
      setStatus('complete')
    } catch (caughtError) {
      setStatus('ready')
      setMessage(caughtError instanceof TypeError ? 'Unable to reach the server. Please check your connection and try again.' : caughtError instanceof Error ? caughtError.message : 'Unable to submit feedback.')
    }
  }

  const colorScheme = (payload?.institution.colorScheme ?? 'ocean') as InstitutionColorScheme
  const themeStyle = institutionColorSchemes[colorScheme].style as CSSProperties

  return (
    <div className="min-h-screen bg-[var(--brand-900)] px-4 py-6 text-white" style={themeStyle}>
      <main className="mx-auto grid min-h-[calc(100vh-5rem)] max-w-2xl content-center gap-5">
        <div className="text-center">
          <QglimpseLogo className="mx-auto h-14 w-14" />
          <p className="mt-4 text-xs font-semibold uppercase text-[var(--brand-100)]">Guest feedback</p>
          <h1 className="mt-2 text-3xl font-semibold">{payload?.institution.name ?? 'Qglimpse'}</h1>
        </div>
        {offline ? (
          <p className="rounded-xl border border-amber-500 bg-amber-900/40 px-4 py-3 text-center text-amber-100">
            You are offline. Reconnect before submitting.
          </p>
        ) : null}
        {status === 'loading' ? (
          <p className="rounded-xl bg-slate-800 px-4 py-5 text-center text-slate-200">Loading feedback form...</p>
        ) : null}
        {status === 'error' ? (
          <p className="rounded-xl border border-amber-500 bg-amber-900/40 px-4 py-5 text-center text-amber-100">{message}</p>
        ) : null}
        {status === 'complete' ? (
          <section className="rounded-xl bg-slate-800 px-5 py-8 text-center">
            <div className="mx-auto grid h-20 w-20 place-items-center rounded-full bg-emerald-900/60 text-4xl">✓</div>
            <h2 className="mt-5 text-2xl font-semibold">Thank you</h2>
            <p className="mt-3 text-slate-200">{message}</p>
          </section>
        ) : null}
        {(status === 'ready' || status === 'submitting') && payload ? (
          <form
            className="grid gap-4"
            onSubmit={(event) => {
              event.preventDefault()
              void submit()
            }}
          >
            {payload.questions.map((question) => (
              <GuestQuestionField
                key={getQuestionKey(question)}
                question={question}
                value={answers[getQuestionKey(question)]}
                onChange={(value) => updateAnswer(question, value)}
              />
            ))}
            {message ? <p className="rounded-xl border border-amber-500 bg-amber-900/40 px-4 py-3 text-amber-100">{message}</p> : null}
            <button
              className="w-full rounded-full bg-[var(--brand-600)] px-6 py-3 text-base font-semibold text-white shadow-lg shadow-[color:var(--brand-shadow)] disabled:cursor-not-allowed disabled:bg-slate-600"
              disabled={offline || status === 'submitting'}
              type="submit"
            >
              {status === 'submitting' ? 'Submitting...' : 'Submit feedback'}
            </button>
          </form>
        ) : null}
      </main>
      <footer className="pointer-events-none fixed bottom-4 right-4 flex max-w-[calc(100vw-2rem)] items-center justify-end gap-2 text-right text-[0.7rem] font-medium text-slate-300/80">
        <span>Qglimpse {appVersion}</span>
        <QglimpseLogo className="h-8 w-8 shrink-0 opacity-90" />
      </footer>
    </div>
  )
}

function GuestQuestionField({
  question,
  value,
  onChange,
}: {
  question: GuestQuestion
  value: unknown
  onChange: (value: unknown) => void
}) {
  const stringValue = typeof value === 'string' ? value : ''
  const multiValue = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
  return (
    <section className="rounded-xl bg-slate-800 px-4 py-5">
      <h2 className="text-lg font-semibold leading-snug">{question.prompt}</h2>
      {question.isDemographic ? <p className="mt-1 text-xs text-slate-400">Optional</p> : null}
      <div className="mt-4 grid gap-3">
        {question.questionType === 'single' ? (
          question.options.map((option) => (
            <button
              key={option}
              className={`rounded-xl px-4 py-3 text-left font-medium ${stringValue === option ? 'bg-[var(--brand-600)] text-white' : 'bg-slate-700 text-slate-100'}`}
              onClick={() => onChange(option)}
              type="button"
            >
              {option}
            </button>
          ))
        ) : question.questionType === 'multiple' ? (
          question.options.map((option) => (
            <button
              key={option}
              className={`rounded-xl px-4 py-3 text-left font-medium ${multiValue.includes(option) ? 'bg-[var(--brand-600)] text-white' : 'bg-slate-700 text-slate-100'}`}
              onClick={() => onChange(multiValue.includes(option) ? multiValue.filter((item) => item !== option) : [...multiValue, option])}
              type="button"
            >
              {option}
            </button>
          ))
        ) : question.questionType === 'boolean' ? (
          <div className="grid grid-cols-2 gap-3">
            <button className={`rounded-xl px-4 py-3 font-semibold ${value === true ? 'bg-[var(--brand-600)]' : 'bg-slate-700'}`} onClick={() => onChange(true)} type="button">
              {question.options[0] ?? 'Yes'}
            </button>
            <button className={`rounded-xl px-4 py-3 font-semibold ${value === false ? 'bg-[var(--brand-600)]' : 'bg-slate-700'}`} onClick={() => onChange(false)} type="button">
              {question.options[1] ?? 'No'}
            </button>
          </div>
        ) : question.questionType === 'scale' ? (
          <div>
            <input className="w-full accent-[var(--brand-500)]" max="10" min="0" type="range" value={typeof value === 'number' ? value : 5} onChange={(event) => onChange(Number(event.target.value))} />
            <div className="mt-2 grid grid-cols-[1fr_auto_1fr] gap-2 text-sm text-slate-400">
              <span>{question.options[0] ?? '0'}</span>
              <span className="text-2xl font-semibold text-white">{typeof value === 'number' ? value : 5}</span>
              <span className="text-right">{question.options[1] ?? '10'}</span>
            </div>
          </div>
        ) : question.questionType === 'star' ? (
          <div>
            <div className="flex justify-between gap-2">
              {[1, 2, 3, 4, 5].map((star) => (
                <button key={star} className={`min-h-12 min-w-12 text-4xl ${typeof value === 'number' && value >= star ? 'text-amber-400' : 'text-slate-600'}`} onClick={() => onChange(star)} type="button">★</button>
              ))}
            </div>
            <div className="mt-2 flex justify-between gap-4 text-sm text-slate-400">
              <span>{question.options[0] ?? 'Low'}</span>
              <span className="text-right">{question.options[1] ?? 'High'}</span>
            </div>
          </div>
        ) : (
          <textarea className="min-h-28 rounded-xl bg-slate-700 px-4 py-3 text-white placeholder-slate-400" maxLength={1000} placeholder="Type your answer here" value={stringValue} onChange={(event) => onChange(event.target.value)} />
        )}
      </div>
    </section>
  )
}

export default App

type KioskFullScreenProps = {
  appVersion: string
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
  kioskFeedbackMessage: string
  kioskQrImage: string
  kioskQrToken: KioskQrToken | null
  kioskQrLoading: boolean
  offline: boolean
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
  onRefreshQr: () => void
}

function KioskFullScreen(props: KioskFullScreenProps) {
  const {
    institution, kioskState, kioskLoading, kioskQuestions, kioskCurrentIdx,
    appVersion,
    colorScheme,
    kioskCurrentAnswer, kioskStarValue, kioskSliderValue, kioskMultiAnswers,
    kioskDemoIdx, kioskDemoAnswers, kioskCountdown, kioskFeedbackMessage, kioskQrImage, kioskQrToken, kioskQrLoading, offline, error,
    onStart, onAnswer, onStarChange, onSliderChange, onMultiToggle,
    onSubmitAnswer, onDemoAnswer, onComplete, onDemoSkip, onDemoNext, onRefreshQr,
  } = props

  const promptQuestions = kioskQuestions.filter((q) => !q.isDemographic)
  const currentQuestion = promptQuestions[kioskCurrentIdx] ?? null
  const demoQuestions = kioskQuestions.filter((q) => q.isDemographic)
  const currentDemoQ = demoQuestions[kioskDemoIdx] ?? null

  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center bg-[var(--brand-900)] px-4 py-6 text-white sm:px-6" style={institutionColorSchemes[colorScheme].style as CSSProperties}>
      {kioskLoading ? (
        <div className="flex flex-col items-center gap-4">
              <div className="h-12 w-12 animate-spin rounded-full border-4 border-[var(--brand-500)] border-t-transparent" />
          <p className="text-slate-300">Please wait…</p>
        </div>
      ) : kioskState === 'landing' ? (
        <div className="flex w-full max-w-xl flex-col items-center gap-6 text-center sm:gap-8">
          <div>
            <p className="text-xs font-semibold uppercase text-[var(--brand-100)] sm:text-sm sm:tracking-[0.2em]">Patient feedback</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl md:text-5xl">{institution?.name ?? 'Qglimpse'}</h1>
            <p className="mt-4 max-w-md text-base text-slate-300 sm:text-lg">Share your experience with us. Your feedback helps us improve our service.</p>
          </div>
          {offline ? (
            <p className="rounded-xl border border-amber-500 bg-amber-900/40 px-4 py-3 text-amber-100">
              The kiosk is offline. Feedback submission and QR links will resume when the connection returns.
            </p>
          ) : null}
          {error ? (
            <p className="rounded-xl border border-amber-500 bg-amber-900/40 px-4 py-3 text-amber-200">{error}</p>
          ) : null}
          <button
            className="w-full rounded-full bg-[var(--brand-600)] px-10 py-4 text-lg font-semibold shadow-2xl shadow-[color:var(--brand-shadow)] transition hover:bg-[var(--brand-500)] disabled:cursor-not-allowed disabled:bg-slate-600 sm:w-auto sm:text-xl"
            disabled={offline}
            onClick={onStart}
            type="button"
          >
            Start feedback
          </button>
          {institution?.qrModeEnabled ? (
            <section className="grid w-full gap-3 rounded-xl bg-slate-800/80 p-4 text-center shadow-2xl shadow-black/20">
              <div>
                <h2 className="text-lg font-semibold">Use your own phone</h2>
                <p className="mt-1 text-sm text-slate-300">Scan this single-use link to answer privately.</p>
              </div>
              {kioskQrImage ? (
                <img alt="Single-use guest feedback QR code" className="mx-auto h-56 w-56 rounded-xl bg-white p-2" src={kioskQrImage} />
              ) : (
                <div className="mx-auto grid h-56 w-56 place-items-center rounded-xl bg-slate-700 px-4 text-sm text-slate-300">
                  {kioskQrLoading ? 'Preparing QR link...' : 'QR link unavailable'}
                </div>
              )}
              <div className="grid gap-2 text-xs text-slate-300">
                {kioskQrToken ? <span>Expires {new Date(kioskQrToken.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span> : null}
                <button
                  className="mx-auto rounded-full bg-slate-700 px-4 py-2 text-sm font-semibold text-white transition hover:bg-slate-600 disabled:cursor-not-allowed disabled:bg-slate-700/50"
                  disabled={offline || kioskQrLoading}
                  onClick={onRefreshQr}
                  type="button"
                >
                  Refresh QR
                </button>
              </div>
            </section>
          ) : null}
        </div>
      ) : kioskState === 'questions' && currentQuestion ? (
        <div className="w-full max-w-xl">
          <div className="mb-6 text-center text-sm text-slate-400">
            Question {kioskCurrentIdx + 1} of {promptQuestions.length}
          </div>
          <div className="rounded-xl bg-slate-800 px-4 py-5 sm:px-8 sm:py-8">
            <h2 className="text-xl font-semibold leading-snug sm:text-2xl">{currentQuestion.prompt}</h2>
            <div className="mt-6">
              {currentQuestion.questionType === 'star' ? (
                <div>
                  <div className="flex justify-between gap-2 sm:justify-start sm:gap-3">
                    {[1, 2, 3, 4, 5].map((star) => (
                      <button
                        key={star}
                      className={`min-h-12 min-w-12 text-4xl transition ${kioskStarValue >= star ? 'text-amber-400' : 'text-slate-600'}`}
                        onClick={() => onStarChange(star)}
                        type="button"
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 flex justify-between gap-4 text-sm text-slate-400">
                    <span>{currentQuestion.options[0] ?? 'Low'}</span>
                    <span className="text-right">{currentQuestion.options[1] ?? 'High'}</span>
                  </div>
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
                  <div className="mt-2 grid grid-cols-[1fr_auto_1fr] gap-2 text-sm text-slate-400">
                    <span>{currentQuestion.options[0] ?? '0 - Poor'}</span>
                    <span className="text-2xl font-semibold text-white">{kioskSliderValue}</span>
                    <span className="text-right">{currentQuestion.options[1] ?? '10 - Excellent'}</span>
                  </div>
                </div>
              ) : currentQuestion.questionType === 'boolean' ? (
                <div className="flex gap-4">
                  {[
                    { value: 'yes', label: currentQuestion.options[0] ?? 'Yes' },
                    { value: 'no', label: currentQuestion.options[1] ?? 'No' },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      className={`flex-1 rounded-2xl py-4 text-lg font-semibold transition ${kioskCurrentAnswer === opt.value ? 'bg-[var(--brand-600)] text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}
                      onClick={() => onAnswer(opt.value)}
                      type="button"
                    >
                      {opt.label}
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
                className="w-full rounded-full bg-[var(--brand-600)] px-8 py-3 font-semibold transition hover:bg-[var(--brand-500)] sm:w-auto"
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
          <div className="rounded-xl bg-slate-800 px-4 py-5 sm:px-8 sm:py-8">
            <h2 className="text-xl font-semibold leading-snug sm:text-2xl">{currentDemoQ.prompt}</h2>
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
          <p className="max-w-sm text-slate-300">{kioskFeedbackMessage} This screen will reset in {kioskCountdown} second{kioskCountdown !== 1 ? 's' : ''}.</p>
          <button
            className="mt-2 rounded-full bg-slate-700 px-6 py-2.5 text-sm font-semibold transition hover:bg-slate-600"
            onClick={onComplete}
            type="button"
          >
            Done now
          </button>
        </div>
      ) : null}
      <footer className="pointer-events-none fixed bottom-4 right-4 flex max-w-[calc(100vw-2rem)] items-center justify-end gap-2 text-right text-[0.7rem] font-medium text-slate-300/80 sm:bottom-5 sm:right-6 sm:text-xs">
        <span>Built using Qglimpse visitor feedback platform, version {appVersion}</span>
        <QglimpseLogo className="h-8 w-8 shrink-0 opacity-90 sm:h-10 sm:w-10" />
      </footer>
    </div>
  )
}
