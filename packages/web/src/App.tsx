import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { NavLink, Route, Routes } from 'react-router-dom'

type Institution = {
  id: number
  name: string
  slug: string
  timezone: string
  kioskModeEnabled: number
  createdAt: string
}

type Demographic = {
  templateKey: string
  questionType: string
  prompt: string
  options: string[]
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
}

type RootOverview = {
  institutionCount: number
  institutionUserCount: number
  demographicQuestionCount: number
  responseCount: number
  kioskEnabledCount: number
  trendlinesEnabled: boolean
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

type ChallengePreview = {
  email: string
  method: 'email_code' | 'magic_link'
  expiresAt: string
  preview: {
    otpCode?: string
    magicLink?: string
  }
}

type AuthUser = {
  id: number
  email: string
  role: 'root' | 'institution_admin' | 'institution_user'
  status: 'active' | 'suspended' | 'deactivated'
  institutionId: number | null
}

const navClass = ({ isActive }: { isActive: boolean }) =>
  `whitespace-nowrap rounded-full px-3 py-2 text-sm font-medium transition ${
    isActive ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-200 hover:text-slate-900'
  }`

const statCardClass =
  'rounded-2xl border border-slate-200 bg-white p-5 shadow-sm shadow-slate-200/50 ring-1 ring-white/60'

function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapPayload | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [challenge, setChallenge] = useState<ChallengePreview | null>(null)
  const [savingSmtp, setSavingSmtp] = useState(false)
  const [authToken, setAuthToken] = useState('')
  const [sessionUser, setSessionUser] = useState<AuthUser | null>(null)
  const [authUsers, setAuthUsers] = useState<AuthUser[]>([])
  const [rootOverview, setRootOverview] = useState<RootOverview | null>(null)
  const [smtpSettings, setSmtpSettings] = useState<SmtpSettings | null>(null)
  const [turnstileToken, setTurnstileToken] = useState('dev-turnstile-pass')
  const [smtpForm, setSmtpForm] = useState<SmtpFormState>({
    username: '',
    password: '',
    sendAddress: '',
    serverAddress: '',
    port: '587',
    secureLoginType: 'starttls',
  })

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/bootstrap')
        if (!response.ok) throw new Error('Unable to load bootstrap data.')
        const payload = (await response.json()) as BootstrapPayload
        setBootstrap(payload)
        setTurnstileToken(payload.authCore.devBypassTokenHint ?? '')
      } catch (caughtError) {
        setError(caughtError instanceof Error ? caughtError.message : 'Unknown error')
      } finally {
        setLoading(false)
      }
    }

    void load()
  }, [])

  const selectedInstitution = bootstrap?.institutions[0] ?? null
  const localTime = useMemo(() => {
    if (!selectedInstitution) return 'Unavailable'
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'full',
      timeStyle: 'short',
      timeZone: selectedInstitution.timezone,
    }).format(new Date())
  }, [selectedInstitution])

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
      setError('Root session required to manage SMTP settings.')
      return
    }
    if (sessionUser?.role !== 'root') {
      setError('Root session required to manage SMTP settings.')
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

  const createChallenge = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    try {
      const formData = new FormData(event.currentTarget)
      const email = String(formData.get('email') ?? '')
      const method = String(formData.get('method') ?? 'email_code') as 'email_code' | 'magic_link'
      const response = await fetch('/api/auth/challenges', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, method }),
      })

      if (!response.ok) {
        throw new Error('Unable to create login challenge.')
      }

      setChallenge((await response.json()) as ChallengePreview)
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to create login challenge.')
    }
  }

  const registerAuthUser = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError(null)
    const formData = new FormData(event.currentTarget)
    const payload = {
      email: String(formData.get('email') ?? ''),
      password: String(formData.get('password') ?? ''),
      role: String(formData.get('role') ?? 'institution_user'),
      institutionId: formData.get('institutionId') ? Number(formData.get('institutionId')) : null,
      turnstileToken,
    }

    const response = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to register user.')
    }
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
      throw new Error(result.error ?? 'Unable to login.')
    }

    const result = (await response.json()) as { token: string; user: AuthUser }
    setAuthToken(result.token)
    setSessionUser(result.user)
    if (result.user.role === 'root') {
      await Promise.all([loadRootOverview(result.token), loadSmtpSettings(result.token)])
    }
  }

  const fetchSession = async () => {
    if (!authToken) {
      setError('Login first to fetch session state.')
      return
    }

    const response = await fetch('/api/auth/session', {
      headers: { Authorization: `Bearer ${authToken}` },
    })

    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to fetch session.')
    }

    const result = (await response.json()) as { user: AuthUser }
    setSessionUser(result.user)
    if (result.user.role === 'root') {
      await Promise.all([loadRootOverview(authToken), loadSmtpSettings(authToken)])
    }
  }

  const logoutAuthUser = async () => {
    if (!authToken) {
      return
    }

    await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${authToken}` },
    })
    setAuthToken('')
    setSessionUser(null)
    setAuthUsers([])
    setRootOverview(null)
    setSmtpSettings(null)
  }

  const loadAuthUsers = async () => {
    if (!authToken) {
      setError('Root session required to list users.')
      return
    }

    const response = await fetch('/api/auth/users', {
      headers: { Authorization: `Bearer ${authToken}` },
    })
    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to list users.')
    }

    const result = (await response.json()) as { users: AuthUser[] }
    setAuthUsers(result.users)
  }

  const setUserStatus = async (id: number, status: AuthUser['status']) => {
    if (!authToken) {
      setError('Root session required to update user status.')
      return
    }

    const response = await fetch(`/api/auth/users/${id}/status`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${authToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ status }),
    })

    if (!response.ok) {
      const result = (await response.json()) as { error?: string }
      throw new Error(result.error ?? 'Unable to update user status.')
    }

    const result = (await response.json()) as { user: AuthUser }
    setAuthUsers((current) => current.map((item) => (item.id === result.user.id ? result.user : item)))
  }

  if (loading) {
    return <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">Loading foundation scaffold…</div>
  }

  if (!bootstrap) {
    return <div className="mx-auto flex min-h-screen max-w-6xl items-center justify-center px-6">{error ?? 'Bootstrap data unavailable.'}</div>
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-6 py-6 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[0.2em] text-sky-700">Foundation scaffold</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight md:text-4xl">{bootstrap.app.name}</h1>
            <p className="mt-3 max-w-3xl text-slate-600">
              PWA shell, Docker baseline, readiness probe, kiosk controls, demographics question bank, and aggregate-only root analytics.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-sm text-slate-100 shadow-lg shadow-slate-900/10">
            <div>Version {bootstrap.app.version}</div>
            <div>Current step: {bootstrap.roadmapSnapshot.currentStep}</div>
          </div>
        </div>
        <div className="mx-auto flex w-full max-w-6xl gap-2 overflow-x-auto px-6 pb-6">
          <NavLink className={navClass} to="/">Overview</NavLink>
          <NavLink className={navClass} to="/auth-core">Auth core</NavLink>
          <NavLink className={navClass} to="/institutions">Institutions</NavLink>
          <NavLink className={navClass} to="/kiosk">Kiosk</NavLink>
          <NavLink className={navClass} to="/root">Root</NavLink>
          <NavLink className={navClass} to="/demographics">Demographics</NavLink>
          <NavLink className={navClass} to="/smtp">SMTP</NavLink>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-4 py-8 md:px-6">
        {error ? <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">{error}</div> : null}
        <Routes>
          <Route
            path="/"
            element={
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
                    <p className="mt-2 text-sm text-slate-600">Institutional users can toggle kiosk mode without involving root.</p>
                  </article>
                  <article className={statCardClass}>
                    <p className="text-sm font-medium text-slate-500">Demographic prompts</p>
                    <p className="mt-3 text-3xl font-semibold">{bootstrap.demographics.length}</p>
                    <p className="mt-2 text-sm text-slate-600">Seeded from the confirmed question bank.</p>
                  </article>
                  <article className={statCardClass}>
                    <p className="text-sm font-medium text-slate-500">Readiness endpoint</p>
                    <p className="mt-3 text-xl font-semibold">{bootstrap.app.readyz}</p>
                    <p className="mt-2 text-sm text-slate-600">Used by Docker and production health checks.</p>
                  </article>
                </section>
                <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
                  <article className={statCardClass}>
                    <h2 className="text-xl font-semibold">Foundation checklist</h2>
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
            }
          />
          <Route
            path="/auth-core"
            element={
              <section className="grid gap-6">
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Turnstile + auth core controls</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Step 2 adds registration, password login, bearer sessions, root-seeded accounts, and account lifecycle status updates.
                  </p>
                  <label className="mt-4 grid gap-2 text-sm font-medium md:max-w-lg">
                    Turnstile token (dev bypass in local mode)
                    <input className="rounded-xl border border-slate-300 px-3 py-2" value={turnstileToken} onChange={(event) => setTurnstileToken(event.target.value)} />
                  </label>
                </article>
                <div className="grid gap-6 lg:grid-cols-2">
                  <article className={statCardClass}>
                    <h2 className="text-xl font-semibold">Register user</h2>
                    <form className="mt-4 grid gap-3" onSubmit={(event) => void registerAuthUser(event).catch((caughtError: unknown) => setError(caughtError instanceof Error ? caughtError.message : 'Registration failed.'))}>
                      <input className="rounded-xl border border-slate-300 px-3 py-2" name="email" placeholder="new-user@example.com" required type="email" />
                      <input className="rounded-xl border border-slate-300 px-3 py-2" name="password" placeholder="Password (min 10 chars)" required type="password" />
                      <select className="rounded-xl border border-slate-300 px-3 py-2" name="role" defaultValue="institution_user">
                        <option value="institution_user">institution_user</option>
                        <option value="institution_admin">institution_admin</option>
                      </select>
                      <input className="rounded-xl border border-slate-300 px-3 py-2" name="institutionId" placeholder="Institution ID (required for non-root)" defaultValue={bootstrap.institutions[0]?.id ?? ''} />
                      <button className="w-fit rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white" type="submit">Register</button>
                    </form>
                  </article>
                  <article className={statCardClass}>
                    <h2 className="text-xl font-semibold">Login + session</h2>
                    <form className="mt-4 grid gap-3" onSubmit={(event) => void loginAuthUser(event).catch((caughtError: unknown) => setError(caughtError instanceof Error ? caughtError.message : 'Login failed.'))}>
                      <input className="rounded-xl border border-slate-300 px-3 py-2" name="email" placeholder="root@quickglimpse.local" required type="email" />
                      <input className="rounded-xl border border-slate-300 px-3 py-2" name="password" placeholder="Password" required type="password" />
                      <button className="w-fit rounded-full bg-sky-700 px-5 py-2.5 text-sm font-semibold text-white" type="submit">Login</button>
                    </form>
                    <div className="mt-4 flex flex-wrap gap-2">
                      <button className="rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold" onClick={() => void fetchSession().catch((caughtError: unknown) => setError(caughtError instanceof Error ? caughtError.message : 'Session check failed.'))} type="button">Check session</button>
                      <button className="rounded-full bg-slate-200 px-4 py-2 text-sm font-semibold" onClick={() => void logoutAuthUser().catch((caughtError: unknown) => setError(caughtError instanceof Error ? caughtError.message : 'Logout failed.'))} type="button">Logout</button>
                    </div>
                    <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                      <div className="font-medium text-slate-900">Current session</div>
                      <div>{sessionUser ? `${sessionUser.email} (${sessionUser.role})` : 'No active session loaded'}</div>
                    </div>
                  </article>
                </div>
                <div className="grid gap-6 lg:grid-cols-2">
                  <article className={statCardClass}>
                    <h2 className="text-xl font-semibold">Account lifecycle (root only)</h2>
                    <button className="mt-4 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white" onClick={() => void loadAuthUsers().catch((caughtError: unknown) => setError(caughtError instanceof Error ? caughtError.message : 'Unable to load users.'))} type="button">
                      Load users
                    </button>
                    <div className="mt-4 grid gap-2 text-sm">
                      {authUsers.map((user) => (
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3" key={user.id}>
                          <div className="font-medium text-slate-900">{user.email}</div>
                          <div className="text-slate-600">{user.role} · {user.status}</div>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {bootstrap.authCore.userStatuses.map((status) => (
                              <button className="rounded-full bg-white px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-300" key={status} onClick={() => void setUserStatus(user.id, status).catch((caughtError: unknown) => setError(caughtError instanceof Error ? caughtError.message : 'Unable to update status.'))} type="button">
                                {status}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </article>
                  <article className={statCardClass}>
                    <h2 className="text-xl font-semibold">Email 2FA delivery demo</h2>
                    <form className="mt-4 grid gap-3" onSubmit={(event) => void createChallenge(event)}>
                      <input className="rounded-xl border border-slate-300 px-3 py-2" name="email" placeholder="visitor@example.com" required type="email" />
                      <fieldset className="grid gap-2 text-sm">
                        {bootstrap.authOptions.map((option, index) => (
                          <label key={option.id} className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
                            <input defaultChecked={index === 0} name="method" type="radio" value={option.id} />
                            <span>
                              <span className="block font-medium text-slate-900">{option.label}</span>
                              <span className="text-slate-600">{option.description}</span>
                            </span>
                          </label>
                        ))}
                      </fieldset>
                      <button className="w-fit rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white" type="submit">Create preview</button>
                    </form>
                    {challenge ? (
                      <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-700">
                        <div className="font-medium text-slate-900">{challenge.method === 'magic_link' ? 'Magic link' : 'One-time code'} preview</div>
                        <div className="mt-2 break-all">{challenge.preview.magicLink ?? challenge.preview.otpCode}</div>
                      </div>
                    ) : null}
                  </article>
                </div>
              </section>
            }
          />
          <Route
            path="/institutions"
            element={
              <section className="grid gap-4 md:grid-cols-2">
                {bootstrap.institutions.map((institution) => (
                  <article className={statCardClass} key={institution.id}>
                    <div className="flex flex-wrap items-start justify-between gap-4">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-sky-700">Institution</p>
                        <h2 className="mt-2 text-xl font-semibold">{institution.name}</h2>
                        <p className="mt-2 text-sm text-slate-600">Slug: {institution.slug}</p>
                        <p className="mt-1 text-sm text-slate-600">Timezone: {institution.timezone}</p>
                      </div>
                      <button
                        className={`rounded-full px-4 py-2 text-sm font-semibold ${institution.kioskModeEnabled ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-900'}`}
                        onClick={() => void toggleKioskMode(institution)}
                        type="button"
                      >
                        {institution.kioskModeEnabled ? 'Kiosk on' : 'Kiosk off'}
                      </button>
                    </div>
                  </article>
                ))}
              </section>
            }
          />
          <Route
            path="/kiosk"
            element={
              <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Kiosk foundation</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    The public kiosk path is reserved for institution-local scheduling and question flow. The seeded institution already carries its own timezone and kiosk flag.
                  </p>
                  {selectedInstitution ? (
                    <div className="mt-5 grid gap-3 text-sm text-slate-700">
                      <div className="rounded-xl bg-slate-50 px-4 py-3">
                        <div className="font-medium text-slate-900">Institution</div>
                        <div>{selectedInstitution.name}</div>
                      </div>
                      <div className="rounded-xl bg-slate-50 px-4 py-3">
                        <div className="font-medium text-slate-900">Current local time</div>
                        <div>{localTime}</div>
                      </div>
                    </div>
                  ) : null}
                </article>
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Reserved route</h2>
                  <div className="mt-4 rounded-2xl bg-slate-950 px-5 py-6 text-sm text-slate-200">
                    <div className="font-semibold text-emerald-300">/kiosk</div>
                    <p className="mt-2">Ready for the institution-scoped kiosk experience in the next implementation steps.</p>
                  </div>
                </article>
              </section>
            }
          />
          <Route
            path="/root"
            element={
              <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Aggregate-only root dashboard</h2>
                  <div className="mt-5 grid gap-4 sm:grid-cols-2">
                    <div className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="text-sm text-slate-500">Institution users</div>
                      <div className="mt-2 text-3xl font-semibold">{rootOverview?.institutionUserCount ?? '—'}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="text-sm text-slate-500">Responses</div>
                      <div className="mt-2 text-3xl font-semibold">{rootOverview?.responseCount ?? '—'}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="text-sm text-slate-500">Kiosk-enabled institutions</div>
                      <div className="mt-2 text-3xl font-semibold">{rootOverview?.kioskEnabledCount ?? '—'}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="text-sm text-slate-500">Trendlines</div>
                      <div className="mt-2 text-lg font-semibold text-slate-700">Disabled by requirement</div>
                    </div>
                  </div>
                </article>
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Privacy guardrail</h2>
                   <p className="mt-3 text-sm text-slate-600">
                     Root sees high-level counts only. Institution-level detail and trendlines stay out of this dashboard until requirements change.
                   </p>
                   {!rootOverview ? (
                     <p className="mt-3 text-sm text-amber-700">Root login is required to load aggregate metrics.</p>
                   ) : null}
                </article>
              </section>
            }
          />
          <Route
            path="/demographics"
            element={
              <section className="grid gap-4">
                {bootstrap.demographics.map((question) => (
                  <article className={statCardClass} key={question.templateKey}>
                    <div className="flex flex-wrap items-center gap-3">
                      <h2 className="text-xl font-semibold">{question.prompt}</h2>
                      <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-sky-800">
                        {question.questionType}
                      </span>
                    </div>
                    <ul className="mt-4 flex flex-wrap gap-2 text-sm text-slate-700">
                      {question.options.map((option) => (
                        <li className="rounded-full border border-slate-200 bg-slate-50 px-3 py-2" key={option}>
                          {option}
                        </li>
                      ))}
                    </ul>
                  </article>
                ))}
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
                      <p className="text-sm text-amber-700">Root login is required to view or edit SMTP settings.</p>
                    ) : null}
                  </form>
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
        </Routes>
      </main>

      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-6 text-sm text-slate-600 sm:flex-row sm:items-center sm:justify-between">
          <span>Quick Glimpse foundation scaffold</span>
          <span>Version {bootstrap.app.version}</span>
        </div>
      </footer>
    </div>
  )
}

export default App
