import express from 'express'
import rateLimit from 'express-rate-limit'
import path from 'node:path'
import { existsSync } from 'node:fs'
import { z } from 'zod'
import { buildBootstrapPayload, createLoginChallenge, getRootOverview, getSmtpSettings, toggleInstitutionKioskMode, updateSmtpSettings } from './services.js'
import { config } from './config.js'
import { getDb } from './db.js'

getDb()

const kioskSchema = z.object({
  enabled: z.boolean(),
})

const smtpSchema = z.object({
  username: z.string().trim(),
  password: z.string().optional(),
  sendAddress: z.string().trim(),
  serverAddress: z.string().trim(),
  port: z.coerce.number().int().min(1).max(65535),
  secureLoginType: z.enum(['none', 'ssl', 'starttls']),
})

const loginChallengeSchema = z.object({
  email: z.string().email(),
  method: z.enum(['email_code', 'magic_link']),
})

const webDistPath = path.resolve(import.meta.dirname, '../../web/dist')
const authChallengeLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
})

const spaShellLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 240,
  standardHeaders: true,
  legacyHeaders: false,
})

const fallbackLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 120,
  standardHeaders: true,
  legacyHeaders: false,
})

export function createApp() {
  const app = express()
  app.use(express.json())

  app.get('/readyz', (_req, res) => {
    res.json({ status: 'ok', version: config.version, timestamp: new Date().toISOString() })
  })

  app.get('/api/bootstrap', (_req, res) => {
    res.json(buildBootstrapPayload())
  })

  app.get('/api/root/overview', (_req, res) => {
    res.json(getRootOverview())
  })

  app.get('/api/settings/smtp', (_req, res) => {
    res.json(getSmtpSettings())
  })

  app.put('/api/settings/smtp', (req, res) => {
    const parsed = smtpSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid SMTP settings payload.' })
    }

    return res.json(updateSmtpSettings(parsed.data))
  })

  app.post('/api/institutions/:id/kiosk-mode', (req, res) => {
    const parsed = kioskSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid kiosk mode payload.' })
    }

    const institution = toggleInstitutionKioskMode(Number(req.params.id), parsed.data.enabled)
    if (!institution) {
      return res.status(404).json({ error: 'Institution not found.' })
    }

    return res.json(institution)
  })

  app.post('/api/auth/challenges', authChallengeLimiter, (req, res) => {
    const parsed = loginChallengeSchema.safeParse(req.body)
    if (!parsed.success) {
      return res.status(400).json({ error: 'Invalid login challenge request.' })
    }

    return res.status(201).json(createLoginChallenge(parsed.data.email, parsed.data.method))
  })

  if (existsSync(webDistPath)) {
    app.use(express.static(webDistPath))
    app.get('*', spaShellLimiter, (_req, res) => {
      res.sendFile(path.join(webDistPath, 'index.html'))
    })
  } else {
    app.get('*', fallbackLimiter, (_req, res) => {
      res.type('html').send(`
        <html>
          <body style="font-family: sans-serif; padding: 2rem;">
            <h1>Quick Glimpse server is running</h1>
            <p>The web bundle has not been built yet. Run <code>npm run build</code> from the repository root.</p>
          </body>
        </html>
      `)
    })
  }

  return app
}

const app = createApp()
app.listen(config.port, () => {
  console.log(`Quick Glimpse listening on http://localhost:${config.port}`)
})
