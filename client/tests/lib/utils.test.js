import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  cn,
  formatCurrency,
  formatDate,
  formatDateRelative,
  formatLocalDate,
  parseLocalDate,
  getDatePeriod,
} from '../../src/lib/utils'

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('px-2', 'py-1')).toBe('px-2 py-1')
  })

  it('handles conditional classes', () => {
    // eslint-disable-next-line no-constant-binary-expression -- deliberately testing conditional (cond && 'class') inputs
    expect(cn('px-2', true && 'bg-blue-500')).toBe('px-2 bg-blue-500')
    // eslint-disable-next-line no-constant-binary-expression -- deliberately testing conditional (cond && 'class') inputs
    expect(cn('px-2', false && 'bg-blue-500')).toBe('px-2')
  })

  it('resolves Tailwind conflicts', () => {
    expect(cn('px-2', 'px-4')).toBe('px-4')
  })
})

describe('formatCurrency', () => {
  it('formats Brazilian real by default', () => {
    const result = formatCurrency(1234.56)
    expect(result).toMatch(/1\.234,56/)
    expect(result).toMatch(/R\$/)
  })

  it('formats USD', () => {
    const result = formatCurrency(1234.56, 'USD')
    expect(result).toMatch(/1\.234,56/)
    expect(result).toMatch(/\$/)
  })

  it('formats Brazilian real using Brazilian locale conventions', () => {
    const result = formatCurrency(1234.56, 'BRL', 'pt')
    expect(result).toMatch(/1\.234,56/)
    expect(result).toMatch(/R\$/)
  })

  it('handles negative amounts', () => {
    const result = formatCurrency(-500)
    expect(result).toMatch(/-.*500,00/)
  })
})

describe('formatDate', () => {
  it('formats date in French locale', () => {
    expect(formatDate('2026-01-20')).toBe('20/01/2026')
  })

  it('formats date in Brazilian Portuguese locale', () => {
    expect(formatDate('2026-01-20', 'pt')).toBe('20/01/2026')
  })

  it('handles Date objects', () => {
    expect(formatDate(new Date(2026, 0, 20))).toBe('20/01/2026')
  })

  it('keeps the same day regardless of timezone (no UTC off-by-one)', () => {
    // 'new Date("2026-12-31")' parses as UTC midnight and would shift to Dec 30
    // when formatted west of UTC. parseLocalDate keeps it on Dec 31.
    expect(formatDate('2026-12-31')).toBe('31/12/2026')
  })
})

describe('parseLocalDate', () => {
  it('parses a YYYY-MM-DD string as a local date', () => {
    const d = parseLocalDate('2026-01-20')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(0)
    expect(d.getDate()).toBe(20)
    expect(d.getHours()).toBe(0)
  })

  it('passes Date objects through unchanged', () => {
    const original = new Date(2026, 5, 15)
    expect(parseLocalDate(original).getTime()).toBe(original.getTime())
  })

  it('handles ISO strings with a time component', () => {
    const d = parseLocalDate('2026-01-20T10:30:00')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getDate()).toBe(20)
  })
})

describe('formatDateRelative', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 0, 22))
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns "Aujourd\'hui" for today', () => {
    expect(formatDateRelative(new Date(2026, 0, 22))).toBe("Aujourd'hui")
  })

  it('returns "Hier" for yesterday', () => {
    expect(formatDateRelative(new Date(2026, 0, 21))).toBe('Hier')
  })

  it('returns "Il y a X jours" for recent dates', () => {
    expect(formatDateRelative(new Date(2026, 0, 19))).toBe('Il y a 3 jours')
  })

  it('returns formatted date for older dates', () => {
    expect(formatDateRelative(new Date(2026, 0, 10))).toBe('10/01/2026')
  })

  it('returns the formatted date for future dates (no "Il y a -N jours")', () => {
    expect(formatDateRelative(new Date(2026, 0, 25))).toBe('25/01/2026')
  })
})

describe('formatLocalDate', () => {
  it('formats date as YYYY-MM-DD', () => {
    const date = new Date(2026, 0, 21)
    expect(formatLocalDate(date)).toBe('2026-01-21')
  })

  it('pads single digit month and day', () => {
    const date = new Date(2026, 0, 5)
    expect(formatLocalDate(date)).toBe('2026-01-05')
  })

  it('preserves local timezone (not UTC)', () => {
    // Create a date at midnight local time
    const date = new Date(2026, 0, 1, 0, 0, 0)
    const result = formatLocalDate(date)
    // Should be Jan 1st in local time, not Dec 31st like toISOString might produce
    expect(result).toBe('2026-01-01')
  })
})

describe('getDatePeriod', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  describe('week period', () => {
    it('calculates week with Monday as first day (default)', () => {
      // Wednesday, Jan 22, 2026
      vi.setSystemTime(new Date(2026, 0, 22))
      const { startDate, endDate } = getDatePeriod('week', 1)
      expect(startDate).toBe('2026-01-19') // Monday
      expect(endDate).toBe('2026-01-22')
    })

    it('calculates week with Sunday as first day', () => {
      // Wednesday, Jan 22, 2026
      vi.setSystemTime(new Date(2026, 0, 22))
      const { startDate, endDate } = getDatePeriod('week', 0)
      expect(startDate).toBe('2026-01-18') // Sunday
      expect(endDate).toBe('2026-01-22')
    })

    it('calculates week with Saturday as first day', () => {
      // Wednesday, Jan 22, 2026
      vi.setSystemTime(new Date(2026, 0, 22))
      const { startDate, endDate } = getDatePeriod('week', 6)
      expect(startDate).toBe('2026-01-17') // Saturday
      expect(endDate).toBe('2026-01-22')
    })

    it('handles Sunday when week starts on Monday', () => {
      // Sunday, Jan 25, 2026
      vi.setSystemTime(new Date(2026, 0, 25))
      const { startDate, endDate } = getDatePeriod('week', 1)
      expect(startDate).toBe('2026-01-19') // Previous Monday
      expect(endDate).toBe('2026-01-25')
    })
  })

  describe('7days period', () => {
    it('calculates last 7 days', () => {
      vi.setSystemTime(new Date(2026, 0, 22))
      const { startDate, endDate } = getDatePeriod('7days')
      expect(startDate).toBe('2026-01-16')
      expect(endDate).toBe('2026-01-22')
    })
  })

  describe('month period', () => {
    it('calculates current month', () => {
      vi.setSystemTime(new Date(2026, 0, 22))
      const { startDate, endDate } = getDatePeriod('month')
      expect(startDate).toBe('2026-01-01')
      expect(endDate).toBe('2026-01-22')
    })
  })

  describe('30days period', () => {
    it('calculates last 30 days', () => {
      vi.setSystemTime(new Date(2026, 0, 30))
      const { startDate, endDate } = getDatePeriod('30days')
      expect(startDate).toBe('2026-01-01')
      expect(endDate).toBe('2026-01-30')
    })
  })

  describe('year period', () => {
    it('calculates current year', () => {
      vi.setSystemTime(new Date(2026, 5, 15))
      const { startDate, endDate } = getDatePeriod('year')
      expect(startDate).toBe('2026-01-01')
      expect(endDate).toBe('2026-06-15')
    })
  })

  describe('365days period', () => {
    it('calculates last 365 days', () => {
      vi.setSystemTime(new Date(2026, 0, 22))
      const { startDate, endDate } = getDatePeriod('365days')
      expect(startDate).toBe('2025-01-23')
      expect(endDate).toBe('2026-01-22')
    })
  })

  describe('invalid period', () => {
    it('returns empty startDate for unknown period', () => {
      vi.setSystemTime(new Date(2026, 0, 22))
      const { startDate, endDate } = getDatePeriod('invalid')
      expect(startDate).toBe('')
      expect(endDate).toBe('2026-01-22')
    })
  })
})
