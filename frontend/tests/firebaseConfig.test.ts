import { describe, expect, it } from 'vitest'
import { normalizeFirebaseConfigValue } from '../src/firebase'

describe('Firebase configuration normalization', () => {
  it('removes matching dotenv quotes and surrounding whitespace', () => {
    expect(normalizeFirebaseConfigValue('  "AIza-example"  ')).toBe('AIza-example')
    expect(normalizeFirebaseConfigValue("  'project-id'  ")).toBe('project-id')
  })

  it('preserves unquoted values and does not strip mismatched quotes', () => {
    expect(normalizeFirebaseConfigValue('project-id')).toBe('project-id')
    expect(normalizeFirebaseConfigValue('"project-id')).toBe('"project-id')
  })

  it('returns undefined for non-string values', () => {
    expect(normalizeFirebaseConfigValue(undefined)).toBeUndefined()
    expect(normalizeFirebaseConfigValue(null)).toBeUndefined()
  })
})
