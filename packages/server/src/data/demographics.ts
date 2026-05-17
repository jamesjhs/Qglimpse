export type QuestionTemplate = {
  key: string
  type: 'single' | 'multiple'
  prompt: string
  options: string[]
}

export const demographicsTemplates: QuestionTemplate[] = [
  {
    key: 'age-group',
    type: 'single',
    prompt: 'What is your current age group?',
    options: ['Under 18', '18 to 24', '25 to 34', '35 to 44', '45 to 54', '55 to 64', '65 and older'],
  },
  {
    key: 'travel-distance',
    type: 'single',
    prompt: 'How far did you travel to reach our location today?',
    options: ['Less than 5 miles', '5 to 15 miles', '16 to 30 miles', '31 to 50 miles', 'Over 50 miles'],
  },
  {
    key: 'visit-description',
    type: 'single',
    prompt: 'Which of the following best describes your visit?',
    options: ['First-time visitor', 'Returning visitor', 'Frequent or regular visitor', 'Accompanying companion'],
  },
  {
    key: 'visit-duration',
    type: 'single',
    prompt: 'Approximately how long was your total visit today?',
    options: ['Less than 15 minutes', '15 to 30 minutes', '30 minutes to 1 hour', '1 to 2 hours', 'More than 2 hours'],
  },
  {
    key: 'visit-purpose',
    type: 'multiple',
    prompt: 'What was the purpose of your visit today? [Select all that apply]',
    options: ['Consultation', 'Checkup', 'Vaccination', 'Prescription', 'Blood Test', 'Accompanying', 'Administration'],
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
