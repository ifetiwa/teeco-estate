// Billing periods for estate charges. Months are handled as a single integer (year * 12 + month - 1) so ranges,
// overlaps and spreading a payment across months are plain arithmetic.

export type Frequency = 'monthly' | 'quarterly' | 'yearly'

export const FREQUENCY_LABEL: Record<Frequency, string> = { monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' }
const PER_YEAR: Record<Frequency, number> = { monthly: 12, quarterly: 4, yearly: 1 }
const MONTHS_IN: Record<Frequency, number> = { monthly: 1, quarterly: 3, yearly: 12 }

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const SHORT = MONTH_NAMES.map(m => m.slice(0, 3))

/** "2026-10" or "2026-10-01" -> month index; null if invalid. */
export function parseMonth (v: string): number | null {
    const m = /^(\d{4})-(\d{2})(?:-01)?$/.exec(v.trim())
    if (!m) return null
    const year = Number(m[1])
    const month = Number(m[2])
    if (month < 1 || month > 12 || year < 2000 || year > 2100) return null
    return year * 12 + month - 1
}

export const yearOf = (mi: number) => Math.floor(mi / 12)
export const monthOf = (mi: number) => (mi % 12) + 1 // 1..12
export const monthKey = (mi: number) => `${yearOf(mi)}-${String(monthOf(mi)).padStart(2, '0')}`
/** Postgres date for the first day of the month. */
export const monthDate = (mi: number) => `${monthKey(mi)}-01`
export const monthName = (mi: number) => `${MONTH_NAMES[mi % 12]} ${yearOf(mi)}`
export const shortMonthName = (month1to12: number) => SHORT[month1to12 - 1]

/** The month (in Lagos time) that an instant falls in. */
export function lagosMonth (now: Date = new Date()): number {
    const d = new Date(now.getTime() + 60 * 60_000)
    return d.getUTCFullYear() * 12 + d.getUTCMonth()
}

/** Human label for a covered range: "October 2026", "Q4 2026", "2026", "Jul to Sep 2026", "Nov 2026 to Feb 2027". */
export function rangeLabel (from: number, to: number): string {
    if (from === to) return monthName(from)
    const sameYear = yearOf(from) === yearOf(to)
    if (sameYear && monthOf(from) === 1 && monthOf(to) === 12) return String(yearOf(from))
    if (sameYear && to - from === 2 && from % 3 === 0) return `Q${from % 12 / 3 + 1} ${yearOf(from)}`
    if (sameYear) return `${SHORT[from % 12]} to ${SHORT[to % 12]} ${yearOf(from)}`
    return `${SHORT[from % 12]} ${yearOf(from)} to ${SHORT[to % 12]} ${yearOf(to)}`
}

/** The billing period containing a month, e.g. monthly "2026-10", quarterly "2026-Q4", yearly "2026". */
export function periodKeyFor (freq: Frequency, mi: number): string {
    if (freq === 'monthly') return monthKey(mi)
    if (freq === 'quarterly') return `${yearOf(mi)}-Q${Math.floor((mi % 12) / 3) + 1}`
    return String(yearOf(mi))
}

/** First and last month of a period key; null if the key doesn't match the frequency. */
export function periodRange (freq: Frequency, key: string): { from: number, to: number } | null {
    if (freq === 'monthly') {
        const mi = parseMonth(key)
        return mi === null ? null : { from: mi, to: mi }
    }
    if (freq === 'quarterly') {
        const m = /^(\d{4})-Q([1-4])$/.exec(key)
        if (!m) return null
        const from = Number(m[1]) * 12 + (Number(m[2]) - 1) * 3
        return { from, to: from + 2 }
    }
    const m = /^(\d{4})$/.exec(key)
    if (!m) return null
    return { from: Number(m[1]) * 12, to: Number(m[1]) * 12 + 11 }
}

export function periodLabel (freq: Frequency, key: string): string {
    const r = periodRange(freq, key)
    return r ? rangeLabel(r.from, r.to) : key
}

/** Recent periods for a picker, newest first: the next period, the current one and the previous ones (about a year back, or 4 years for yearly charges). */
export function recentPeriods (freq: Frequency, now: Date = new Date()): Array<{ key: string, label: string }> {
    const step = MONTHS_IN[freq]
    const count = freq === 'yearly' ? 5 : PER_YEAR[freq] + 1
    const current = lagosMonth(now)
    const out: Array<{ key: string, label: string }> = []
    for (let i = -1; i < count; i++) {
        const key = periodKeyFor(freq, current - i * step)
        if (!out.some(p => p.key === key)) out.push({ key, label: periodLabel(freq, key) })
    }
    return out
}

/** Expected amount for one period of a charge whose amount is set per period. */
export function monthsInPeriod (freq: Frequency): number {
    return MONTHS_IN[freq]
}

/**
 * How much of a payment counts towards a range of months. A payment covering several months is spread evenly over
 * them, so ₦120,000 for the whole of 2026 counts ₦30,000 towards each quarter.
 */
export function amountTowards (payment: { amountKobo: number, from: number, to: number }, rangeFrom: number, rangeTo: number): number {
    const overlap = Math.min(payment.to, rangeTo) - Math.max(payment.from, rangeFrom) + 1
    if (overlap <= 0) return 0
    const months = payment.to - payment.from + 1
    return Math.round(payment.amountKobo * overlap / months)
}
