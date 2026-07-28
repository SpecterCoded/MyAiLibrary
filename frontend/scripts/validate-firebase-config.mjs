const requiredVariables = [
  'VITE_FIREBASE_API_KEY',
  'VITE_FIREBASE_AUTH_DOMAIN',
  'VITE_FIREBASE_PROJECT_ID',
  'VITE_FIREBASE_STORAGE_BUCKET',
  'VITE_FIREBASE_MESSAGING_SENDER_ID',
  'VITE_FIREBASE_APP_ID',
]

const missing = requiredVariables.filter((name) => {
  const value = process.env[name]?.trim()
  return !value || value === 'undefined' || value === 'null'
})

if (missing.length > 0) {
  console.error(`Missing required Firebase build configuration: ${missing.join(', ')}`)
  process.exit(1)
}

if (process.env.VITE_FIREBASE_API_KEY.trim().length < 20) {
  console.error('VITE_FIREBASE_API_KEY does not look like a valid Firebase web API key.')
  process.exit(1)
}

console.log('Firebase release configuration is present.')
