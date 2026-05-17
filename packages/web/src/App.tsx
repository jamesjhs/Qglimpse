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
  rootOverview: {
    institutionCount: number
    institutionUserCount: number
    demographicQuestionCount: number
    responseCount: number
    kioskEnabledCount: number
    trendlinesEnabled: boolean
  }
  smtpSettings: {
    username: string
    sendAddress: string
    serverAddress: string
    port: number
    secureLoginType: 'none' | 'ssl' | 'starttls'
    passwordSet: boolean
  }
  foundationChecklist: string[]
  roadmapSnapshot: {
    currentStep: string
    nextStep: string
    questionBankSeeded: number
  }
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

const navClass = ({ isActive }: { isActive: boolean }) =>
  `rounded-full px-3 py-2 text-sm font-medium transition ${
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
        setSmtpForm({
          username: payload.smtpSettings.username,
          password: '',
          sendAddress: payload.smtpSettings.sendAddress,
          serverAddress: payload.smtpSettings.serverAddress,
          port: `${payload.smtpSettings.port}`,
          secureLoginType: payload.smtpSettings.secureLoginType,
        })
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
    setError(null)
    try {
      const response = await fetch(`/api/institutions/${institution.id}/kiosk-mode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
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
          rootOverview: {
            ...current.rootOverview,
            kioskEnabledCount: institutions.filter((item) => item.kioskModeEnabled).length,
          },
        }
      })
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to update kiosk mode.')
    }
  }

  const saveSmtpSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSavingSmtp(true)
    setError(null)
    try {
      const response = await fetch('/api/settings/smtp', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...smtpForm,
          port: Number(smtpForm.port),
        }),
      })

      if (!response.ok) {
        throw new Error('Unable to save SMTP settings.')
      }

      const smtpSettings = (await response.json()) as BootstrapPayload['smtpSettings']
      setBootstrap((current) => (current ? { ...current, smtpSettings } : current))
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
            <h1 className="mt-2 text-4xl font-semibold tracking-tight">{bootstrap.app.name}</h1>
            <p className="mt-3 max-w-3xl text-slate-600">
              PWA shell, Docker baseline, readiness probe, kiosk controls, demographics question bank, and aggregate-only root analytics.
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-slate-950 px-4 py-3 text-sm text-slate-100 shadow-lg shadow-slate-900/10">
            <div>Version {bootstrap.app.version}</div>
            <div>Current step: {bootstrap.roadmapSnapshot.currentStep}</div>
          </div>
        </div>
        <div className="mx-auto flex max-w-6xl flex-wrap gap-2 px-6 pb-6">
          <NavLink className={navClass} to="/">Overview</NavLink>
          <NavLink className={navClass} to="/login-demo">Login demo</NavLink>
          <NavLink className={navClass} to="/institutions">Institutions</NavLink>
          <NavLink className={navClass} to="/kiosk">Kiosk</NavLink>
          <NavLink className={navClass} to="/root">Root</NavLink>
          <NavLink className={navClass} to="/demographics">Demographics</NavLink>
          <NavLink className={navClass} to="/smtp">SMTP</NavLink>
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl gap-6 px-6 py-8">
        {error ? <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">{error}</div> : null}
        <Routes>
          <Route
            path="/"
            element={
              <div className="grid gap-6">
                <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
                  <article className={statCardClass}>
                    <p className="text-sm font-medium text-slate-500">Institutions</p>
                    <p className="mt-3 text-3xl font-semibold">{bootstrap.rootOverview.institutionCount}</p>
                    <p className="mt-2 text-sm text-slate-600">Institution-local timezone support starts with the seeded sample institution.</p>
                  </article>
                  <article className={statCardClass}>
                    <p className="text-sm font-medium text-slate-500">Kiosk-enabled</p>
                    <p className="mt-3 text-3xl font-semibold">{bootstrap.rootOverview.kioskEnabledCount}</p>
                    <p className="mt-2 text-sm text-slate-600">Institutional users can toggle kiosk mode without involving root.</p>
                  </article>
                  <article className={statCardClass}>
                    <p className="text-sm font-medium text-slate-500">Demographic prompts</p>
                    <p className="mt-3 text-3xl font-semibold">{bootstrap.rootOverview.demographicQuestionCount}</p>
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
            path="/login-demo"
            element={
              <section className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Email 2FA delivery demo</h2>
                  <p className="mt-2 text-sm text-slate-600">
                    Users can choose a one-time code or a magic link. The magic link supports cross-device login.
                  </p>
                  <form className="mt-5 grid gap-4" onSubmit={(event) => void createChallenge(event)}>
                    <label className="grid gap-2 text-sm font-medium">
                      Email address
                      <input
                        required
                        name="email"
                        type="email"
                        className="rounded-xl border border-slate-300 bg-white px-3 py-2 outline-none ring-sky-500 transition focus:ring"
                        placeholder="visitor@example.com"
                      />
                    </label>
                    <fieldset className="grid gap-2 text-sm">
                      <legend className="font-medium">Delivery method</legend>
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
                    <button className="w-fit rounded-full bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/15" type="submit">
                      Create preview
                    </button>
                  </form>
                </article>
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Preview</h2>
                  {challenge ? (
                    <div className="mt-4 grid gap-3 text-sm text-slate-700">
                      <div>
                        <div className="font-medium text-slate-900">Recipient</div>
                        <div>{challenge.email}</div>
                      </div>
                      <div>
                        <div className="font-medium text-slate-900">Expires</div>
                        <div>{new Date(challenge.expiresAt).toLocaleString()}</div>
                      </div>
                      {challenge.preview.otpCode ? (
                        <div>
                          <div className="font-medium text-slate-900">One-time code</div>
                          <div className="mt-1 rounded-xl bg-slate-950 px-4 py-3 font-mono text-lg text-emerald-300">{challenge.preview.otpCode}</div>
                        </div>
                      ) : null}
                      {challenge.preview.magicLink ? (
                        <div>
                          <div className="font-medium text-slate-900">Magic link</div>
                          <a className="mt-1 block break-all rounded-xl bg-slate-100 px-4 py-3 text-sky-700" href={challenge.preview.magicLink}>
                            {challenge.preview.magicLink}
                          </a>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <p className="mt-4 text-sm text-slate-600">Submit a demo request to preview the emailed 2FA content.</p>
                  )}
                </article>
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
                      <div className="mt-2 text-3xl font-semibold">{bootstrap.rootOverview.institutionUserCount}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="text-sm text-slate-500">Responses</div>
                      <div className="mt-2 text-3xl font-semibold">{bootstrap.rootOverview.responseCount}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-4">
                      <div className="text-sm text-slate-500">Kiosk-enabled institutions</div>
                      <div className="mt-2 text-3xl font-semibold">{bootstrap.rootOverview.kioskEnabledCount}</div>
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
                        <input className="rounded-xl border border-slate-300 px-3 py-2" type="password" value={smtpForm.password} onChange={(event) => setSmtpForm((current) => ({ ...current, password: event.target.value }))} placeholder={bootstrap.smtpSettings.passwordSet ? 'Stored password kept unless replaced' : ''} />
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
                  </form>
                </article>
                <article className={statCardClass}>
                  <h2 className="text-xl font-semibold">Current status</h2>
                  <dl className="mt-4 grid gap-3 text-sm text-slate-700">
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <dt className="font-medium text-slate-900">Username</dt>
                      <dd>{bootstrap.smtpSettings.username || 'Not set'}</dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <dt className="font-medium text-slate-900">Server</dt>
                      <dd>{bootstrap.smtpSettings.serverAddress || 'Not set'}</dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <dt className="font-medium text-slate-900">Send address</dt>
                      <dd>{bootstrap.smtpSettings.sendAddress || 'Not set'}</dd>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-4 py-3">
                      <dt className="font-medium text-slate-900">Secure login</dt>
                      <dd>{bootstrap.smtpSettings.secureLoginType}</dd>
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
