export type QuestionTemplate = {
  key: string
  type: 'single' | 'multiple' | 'text' | 'scale' | 'boolean' | 'star'
  prompt: string
  options: string[]
  isDemographic?: boolean
}

export const demographicsTemplates: QuestionTemplate[] = [
  {
    key: 'age-group',
    type: 'single',
    prompt: 'What is your current age group?',
    options: ['Under 18', '18 to 24', '25 to 34', '35 to 44', '45 to 54', '55 to 64', '65 and older'],
    isDemographic: true,
  },
  {
    key: 'travel-distance',
    type: 'single',
    prompt: 'How far did you travel to reach our location today?',
    options: ['Less than 5 miles', '5 to 15 miles', '16 to 30 miles', '31 to 50 miles', 'Over 50 miles'],
    isDemographic: true,
  },
  {
    key: 'visit-description',
    type: 'single',
    prompt: 'Which of the following best describes your visit?',
    options: ['First-time visitor', 'Returning visitor', 'Frequent or regular visitor', 'Accompanying companion'],
    isDemographic: true,
  },
  {
    key: 'visit-duration',
    type: 'single',
    prompt: 'Approximately how long was your total visit today?',
    options: ['Less than 15 minutes', '15 to 30 minutes', '30 minutes to 1 hour', '1 to 2 hours', 'More than 2 hours'],
    isDemographic: true,
  },
  {
    key: 'visit-purpose',
    type: 'multiple',
    prompt: 'What was the purpose of your visit today? [Select all that apply]',
    options: ['Consultation', 'Checkup', 'Vaccination', 'Prescription', 'Blood Test', 'Accompanying', 'Administration'],
    isDemographic: true,
  },
]

export const insightTemplates: QuestionTemplate[] = [
  {
    key: 'overall-experience',
    type: 'star',
    prompt: 'How would you rate your overall experience today?',
    options: [],
    isDemographic: false,
  },
  {
    key: 'wait-time-acceptable',
    type: 'boolean',
    prompt: 'Was the wait time acceptable?',
    options: [],
    isDemographic: false,
  },
  {
    key: 'staff-friendliness',
    type: 'scale',
    prompt: 'Rate staff friendliness from 0 to 10',
    options: [],
    isDemographic: false,
  },
  {
    key: 'main-feedback',
    type: 'text',
    prompt: 'Any additional feedback or suggestions?',
    options: [],
    isDemographic: false,
  },
  {
    key: 'recommend-likelihood',
    type: 'single',
    prompt: 'How likely are you to recommend us?',
    options: ['Very unlikely', 'Unlikely', 'Neutral', 'Likely', 'Very likely'],
    isDemographic: false,
  },
  {
    key: 'services-used',
    type: 'multiple',
    prompt: 'Which services did you use today?',
    options: ['Reception', 'Consultation', 'Pharmacy', 'Lab', 'Other'],
    isDemographic: false,
  },
]

export const foundationChecklist = [
  'TypeScript/React/Tailwind front end scaffolded',
  'Express API and SQLite persistence wired',
  'PWA shell and readiness probe exposed',
  'Institution-local timezone and kiosk mode foundation in place',
  'Root dashboard restricted to aggregate counts',
  'SMTP settings limited to username, password, send address, server, port, and secure type',
  'Password login with bcrypt, bearer sessions, and account lifecycle management',
  'Must-change-password flag and self-service password change endpoint',
  'Password-reset and email-verification flows (preview-mode tokens)',
  'Email OTP 2FA and magic-link challenge/verify flows',
  'Institution CRUD with root-only write access',
  'Delegated user management for institution admins',
  'Question system with 6 types, scheduling, and institution copies',
  'Kiosk runtime flow with session tracking and demographic capture',
  'Institution analytics with privacy-guardrailed cross-tabulation',
  'SMTP test-send capability and root aggregate health dashboard',
  'Full documentation pack (install, technical, simple-guide, legal)',
  'Security hardening: CSP, HSTS, CORP, COOP headers',
]

export const authMethodOptions = [
  {
    id: 'email_code',
    label: 'Email one-time code',
    description: 'Good for same-device sign in when the email inbox is nearby.',
  },
  {
    id: 'magic_link',
    label: 'Magic link',
    description: 'Supports cross-device sign in by opening the emailed link elsewhere.',
  },
]
