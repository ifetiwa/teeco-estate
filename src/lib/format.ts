import { PLATFORM_DEFAULTS } from '@/config/defaults'

const { locale, currency, timezone } = PLATFORM_DEFAULTS

const nairaFormatter = new Intl.NumberFormat(locale, { style: 'currency', currency })

/** Amounts are stored as integer kobo (1 NGN = 100 kobo). */
export function formatNaira (kobo: number | bigint): string {
    const value = typeof kobo === 'bigint' ? Number(kobo) : kobo
    return nairaFormatter.format(value / 100)
}

/** Parses user input such as "15,000" or "₦15,000.50" into kobo. Returns null if invalid. */
export function parseNairaToKobo (input: string): number | null {
    const cleaned = input.trim().replace(/[₦,\s]/g, '').replace(/^NGN/i, '')
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null
    const [whole, frac = ''] = cleaned.split('.')
    return Number(whole) * 100 + Number(frac.padEnd(2, '0'))
}

export function formatDateTime (date: Date, tz: string = timezone): string {
    return new Intl.DateTimeFormat(locale, { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export function formatDate (date: Date, tz: string = timezone): string {
    return new Intl.DateTimeFormat(locale, { timeZone: tz, dateStyle: 'medium' }).format(date)
}

export function formatTime (date: Date, tz: string = timezone): string {
    return new Intl.DateTimeFormat(locale, { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
}

// Africa/Lagos is UTC+1 all year (no daylight saving), so conversions are exact.
const LAGOS_OFFSET_MS = 60 * 60_000

/** "2026-10-14T18:30" entered in Lagos time (e.g. a datetime-local input) -> the UTC instant. Null if invalid. */
export function parseLagosDateTime (local: string): Date | null {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim())
    if (!m) return null
    const [, y, mo, d, h, mi] = m.map(Number)
    const utc = Date.UTC(y, mo - 1, d, h, mi) - LAGOS_OFFSET_MS
    const check = new Date(utc + LAGOS_OFFSET_MS)
    if (check.getUTCFullYear() !== y || check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null
    return new Date(utc)
}

/** UTC instant -> "YYYY-MM-DDTHH:mm" in Lagos time, for datetime-local inputs. */
export function toLagosInputValue (date: Date): string {
    return new Date(date.getTime() + LAGOS_OFFSET_MS).toISOString().slice(0, 16)
}

/** Minutes since Lagos midnight for an instant (0..1439). */
export function lagosMinutesOfDay (date: Date): number {
    const shifted = new Date(date.getTime() + LAGOS_OFFSET_MS)
    return shifted.getUTCHours() * 60 + shifted.getUTCMinutes()
}

/** The UTC instant of the most recent Lagos midnight. */
export function startOfLagosDay (date: Date = new Date()): Date {
    const shifted = new Date(date.getTime() + LAGOS_OFFSET_MS)
    shifted.setUTCHours(0, 0, 0, 0)
    return new Date(shifted.getTime() - LAGOS_OFFSET_MS)
}

/** Whether `date` falls inside a daily window like 23:00-05:00 (Lagos time; wraps past midnight). */
export function isWithinDailyWindow (date: Date, start: string, end: string): boolean {
    const toMin = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))
    const now = lagosMinutesOfDay(date)
    const s = toMin(start)
    const e = toMin(end)
    if (s === e) return false
    return s < e ? now >= s && now < e : now >= s || now < e
}
