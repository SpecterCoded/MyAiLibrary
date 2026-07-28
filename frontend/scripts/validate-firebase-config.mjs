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

const quoted = requiredVariables.filter((name) => {
  const value = process.env[name].trim()
  return (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  )
})

if (quoted.length > 0) {
  console.error(`Firebase build configuration must not include wrapping quotes: ${quoted.join(', ')}`)
  process.exit(1)
}

if (!/^AIza[A-Za-z0-9_-]{35}$/.test(process.env.VITE_FIREBASE_API_KEY.trim())) {
  console.error('VITE_FIREBASE_API_KEY does not look like a valid Firebase web API key.')
  process.exit(1)
}

console.log('Firebase release configuration is present.')
