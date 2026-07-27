import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickglimpse-test-'))
process.env.QUICKGLIMPSE_DB_PATH = path.join(tempDir, 'quickglimpse.db')
process.env.QUICKGLIMPSE_DATA_DIR = tempDir
process.env.QUICKGLIMPSE_BASE_URL = 'http://localhost:3000'
process.env.TURNSTILE_SITE_KEY = ''
process.env.TURNSTILE_SECRET_KEY = ''
process.env.QUICKGLIMPSE_ROOT_SEED_PASSWORD = 'ChangeMeRoot123!'
process.env.QUICKGLIMPSE_INSTITUTION_SEED_PASSWORD = 'ChangeMeInstitution123!'

const services = await import('../dist/services.js')
const { getDb } = await import('../dist/db.js')

test('bootstrap seeds demographics and aggregate dashboard data', () => {
  const bootstrap = services.buildBootstrapPayload()
  assert.equal(bootstrap.demographics.length, 5)
  assert.equal(bootstrap.authOptions.length, 2)
})

test('root overview remains aggregate-only', () => {
  const overview = services.getRootOverview()
  assert.equal(overview.trendlinesEnabled, false)
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

test('magic link challenge stores a single active token without exposing it', async () => {
  const challenge = await services.createLoginChallenge('user@example.com', 'magic_link')
  assert.equal(challenge.method, 'magic_link')
  assert.equal('preview' in challenge, false)
  const db = getDb()
  const active = db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM login_challenges
       WHERE email = ? AND method = 'magic_link' AND consumed_at IS NULL`,
    )
    .get('user@example.com')
  assert.equal(active.count, 1)
})

test('kiosk status includes active questions payload', () => {
  const [institution] = services.listInstitutions()
  const status = services.getKioskStatus(institution.slug)
  assert.ok(status)
  assert.equal(Array.isArray(status.questions), true)
})

test('custom questions persist scheduling fields', () => {
  const [institution] = services.listInstitutions()
  const created = services.createCustomQuestion(institution.id, {
    questionType: 'multiple',
    prompt: 'Scheduled custom question',
    options: ['A', 'B'],
    includeInKiosk: true,
    isDemographic: false,
    displayOrder: 999,
    scheduleDays: [1, 2, 3],
    scheduleStartTime: '09:00',
    scheduleEndTime: '17:00',
  })
  assert.ok(created)
  assert.deepEqual(created.scheduleDays, [1, 2, 3])
  assert.equal(created.scheduleStartTime, '09:00')
  assert.equal(created.scheduleEndTime, '17:00')
})

test('kiosk scheduling respects institution timezone', () => {
  const [institution] = services.listInstitutions()
  const db = getDb()
  db.prepare('UPDATE institutions SET timezone = ? WHERE id = ?').run('Pacific/Kiritimati', institution.id)

  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Pacific/Kiritimati',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
  const parts = fmt.formatToParts(new Date())
  const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Sun'
  const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0')
  const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0')
  const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  const targetDay = dayMap[weekday] ?? 0
  const minuteBefore = (hour * 60 + minute + 1439) % 1440
  const minuteAfter = (hour * 60 + minute + 1) % 1440
  const toTime = (mins) => `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`

  const questions = services.getInstitutionQuestions(institution.id).filter((q) => !q.isDemographic)
  assert.ok(questions.length > 0)
  for (const q of questions) {
    services.updateInstitutionQuestion(institution.id, q.id, { includeInKiosk: false })
  }

  const target = questions[0]
  services.updateInstitutionQuestion(institution.id, target.id, {
    includeInKiosk: true,
    scheduleDays: [targetDay],
    scheduleStartTime: toTime(minuteBefore),
    scheduleEndTime: toTime(minuteAfter),
  })

  const active = services.getActiveKioskQuestions(institution.id)
  assert.equal(active.some((q) => q.id === target.id), true)
})

test('single-question mode assigns one feedback question with optional demographics', () => {
  const db = getDb()
  const institution = services.createInstitution({
    name: 'Single Question Pilot',
    slug: 'single-question-pilot',
    timezone: 'UTC',
    singleQuestionModeEnabled: true,
  })
  services.toggleInstitutionKioskMode(institution.id, true)

  const first = services.createCustomQuestion(institution.id, {
    questionType: 'multiple',
    prompt: 'How was check-in?',
    options: ['Poor', 'Good'],
    includeInKiosk: true,
    isDemographic: false,
    displayOrder: 1,
  })
  const second = services.createCustomQuestion(institution.id, {
    questionType: 'star',
    prompt: 'Rate the waiting area.',
    options: [],
    includeInKiosk: true,
    isDemographic: false,
    displayOrder: 2,
  })
  const demo = services.createCustomQuestion(institution.id, {
    questionType: 'multiple',
    prompt: 'Which visit type best applies?',
    options: ['New', 'Returning'],
    includeInKiosk: true,
    isDemographic: true,
    displayOrder: 3,
  })
  assert.ok(first)
  assert.ok(second)
  assert.ok(demo)

  const session = services.startKioskSession(institution.id)
  const promptQuestions = session.questions.filter((q) => !q.isDemographic)
  const demographicQuestions = session.questions.filter((q) => q.isDemographic)
  assert.equal(promptQuestions.length, 1)
  assert.equal(promptQuestions[0].id, first.id)
  assert.equal(demographicQuestions.length, 1)

  assert.throws(
    () => services.submitKioskAnswer(session.sessionToken, second.templateKey, JSON.stringify(3)),
    /Question is not assigned/,
  )

  db.prepare('UPDATE institution_questions SET prompt = ?, question_version = question_version + 1 WHERE id = ?').run(
    'This changed after the session started.',
    first.id,
  )

  services.submitKioskAnswer(session.sessionToken, first.templateKey, JSON.stringify(['Good']))
  services.submitKioskAnswer(session.sessionToken, demo.templateKey, JSON.stringify(['New']))
  services.completeKioskSession(session.sessionToken, {})

  const stored = db
    .prepare('SELECT question_prompt AS questionPrompt, question_version AS questionVersion FROM responses WHERE question_key = ?')
    .get(first.templateKey)
  assert.equal(stored.questionPrompt, 'How was check-in?')
  assert.equal(stored.questionVersion, 1)
})

test('kiosk answer validation enforces question type and options', () => {
  const institution = services.createInstitution({
    name: 'Validation Pilot',
    slug: 'validation-pilot',
    timezone: 'UTC',
  })
  services.toggleInstitutionKioskMode(institution.id, true)

  const question = services.createCustomQuestion(institution.id, {
    questionType: 'multiple',
    prompt: 'Choose a valid option.',
    options: ['One', 'Two'],
    includeInKiosk: true,
    isDemographic: false,
    displayOrder: 1,
  })
  assert.ok(question)

  const session = services.startKioskSession(institution.id)
  assert.throws(
    () => services.submitKioskAnswer(session.sessionToken, question.templateKey, JSON.stringify(['Three'])),
    /Answer is not valid/,
  )
  assert.deepEqual(services.submitKioskAnswer(session.sessionToken, question.templateKey, JSON.stringify(['One'])), {
    recorded: true,
  })
})

test('scale and star questions can store endpoint labels', () => {
  const institution = services.createInstitution({
    name: 'Endpoint Label Pilot',
    slug: 'endpoint-label-pilot',
    timezone: 'UTC',
  })

  const scaleQuestion = services.createCustomQuestion(institution.id, {
    questionType: 'scale',
    prompt: 'How easy was this?',
    options: ['Difficult', 'Easy'],
    includeInKiosk: true,
    isDemographic: false,
    displayOrder: 1,
  })
  const starQuestion = services.createCustomQuestion(institution.id, {
    questionType: 'star',
    prompt: 'Rate your visit.',
    options: ['Poor', 'Excellent'],
    includeInKiosk: true,
    isDemographic: false,
    displayOrder: 2,
  })

  assert.deepEqual(scaleQuestion?.options, ['Difficult', 'Easy'])
  assert.deepEqual(starQuestion?.options, ['Poor', 'Excellent'])
})
