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
