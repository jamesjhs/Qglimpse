import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickglimpse-test-'))
process.env.QUICKGLIMPSE_DB_PATH = path.join(tempDir, 'quickglimpse.db')
process.env.QUICKGLIMPSE_DATA_DIR = tempDir
process.env.QUICKGLIMPSE_BASE_URL = 'http://localhost:3000'

const services = await import('../dist/services.js')

test('bootstrap seeds demographics and aggregate dashboard data', () => {
  const bootstrap = services.buildBootstrapPayload()
  assert.equal(bootstrap.demographics.length, 5)
  assert.equal(bootstrap.rootOverview.trendlinesEnabled, false)
  assert.equal(bootstrap.authOptions.length, 2)
})

test('kiosk mode toggle persists per institution', () => {
  const [institution] = services.listInstitutions()
  const updated = services.toggleInstitutionKioskMode(institution.id, false)
  assert.equal(updated.kioskModeEnabled, 0)
})

test('smtp settings keep required fields only', () => {
  const updated = services.updateSmtpSettings({
    username: 'mailer',
    password: 'topsecret',
    sendAddress: 'notify@example.com',
    serverAddress: 'smtp.example.com',
    port: 465,
    secureLoginType: 'ssl',
  })

  assert.equal(updated.username, 'mailer')
  assert.equal(updated.serverAddress, 'smtp.example.com')
  assert.equal(updated.passwordSet, true)
})

test('magic link preview is generated for cross-device sign in', () => {
  const challenge = services.createLoginChallenge('user@example.com', 'magic_link')
  assert.match(challenge.preview.magicLink, /\/auth\/magic-link\?token=/)
})
