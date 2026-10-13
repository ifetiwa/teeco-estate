import { describe, expect, it } from 'vitest'

import { BRAND, legalFooter } from '@/config/brand'
import { PLATFORM_DEFAULTS, resolveEstateSettings } from '@/config/defaults'
import { formatAddress } from '@/lib/address'
import { renderEmail } from '@/lib/email'
import { formatDateTime, formatNaira, formatTime, parseNairaToKobo } from '@/lib/format'
import { formatNigerianPhone, normalizeNigerianPhone, requireNigerianPhone } from '@/lib/phone'

describe('Nigerian phone numbers', () => {
    it.each([
        ['08031234567', '+2348031234567'],
        ['0803 123 4567', '+2348031234567'],
        ['+234 803 123 4567', '+2348031234567'],
        ['2348031234567', '+2348031234567'],
        ['002348031234567', '+2348031234567'],
        ['07061234567', '+2347061234567'],
        ['09151234567', '+2349151234567'],
        ['0812-345-6789', '+2348123456789'],
    ])('normalises %s', (input, expected) => {
        expect(normalizeNigerianPhone(input)).toBe(expected)
    })

    it.each([
        '0803123456', // too short
        '080312345678', // too long
        '06031234567', // not a mobile prefix
        '+14155552671', // US number
        '+79161234567', // Russian number
        '0803123456a',
        '',
    ])('rejects %s', (input) => {
        expect(normalizeNigerianPhone(input)).toBeNull()
    })

    it('throws a readable error from requireNigerianPhone', () => {
        expect(() => requireNigerianPhone('12345')).toThrow('not a valid Nigerian mobile number')
    })

    it('formats for display the Nigerian way', () => {
        expect(formatNigerianPhone('+2348031234567')).toBe('0803 123 4567')
    })
})

describe('Naira amounts', () => {
    it('formats kobo as NGN with the naira sign', () => {
        expect(formatNaira(1500000)).toBe('₦15,000.00')
        expect(formatNaira(50)).toBe('₦0.50')
        expect(formatNaira(BigInt(250000000))).toBe('₦2,500,000.00')
    })

    it('parses user input into kobo', () => {
        expect(parseNairaToKobo('15,000')).toBe(1500000)
        expect(parseNairaToKobo('₦15,000.5')).toBe(1500050)
        expect(parseNairaToKobo('NGN 200.25')).toBe(20025)
        expect(parseNairaToKobo('abc')).toBeNull()
        expect(parseNairaToKobo('1.234')).toBeNull()
        expect(parseNairaToKobo('-5')).toBeNull()
    })
})

describe('Lagos time', () => {
    it('shows UTC instants in West Africa Time (UTC+1, no DST)', () => {
        const instant = new Date('2026-07-01T22:30:00Z')
        expect(formatTime(instant)).toBe('23:30')
        expect(formatDateTime(instant)).toBe('1 Jul 2026, 23:30')
        expect(formatTime(new Date('2026-01-15T05:00:00Z'))).toBe('06:00')
    })
})

describe('estate settings', () => {
    it('defaults to en-NG, NGN, Africa/Lagos and +234', () => {
        const s = resolveEstateSettings()
        expect(s.locale).toBe('en-NG')
        expect(s.currency).toBe('NGN')
        expect(s.timezone).toBe('Africa/Lagos')
        expect(s.phoneCountryCode).toBe('+234')
    })

    it('merges estate overrides deeply without touching other defaults', () => {
        const s = resolveEstateSettings({ visitors: { curfew: { enabled: true } } })
        expect(s.visitors.curfew).toEqual({ enabled: true, start: '23:00', end: '05:00' })
        expect(s.visitors.maxPassesPerResidentPerDay).toBe(PLATFORM_DEFAULTS.visitors.maxPassesPerResidentPerDay)
    })

    it('replaces arrays instead of merging them', () => {
        expect(resolveEstateSettings({ levies: { reminderDaysBeforeDue: [3] } }).levies.reminderDaysBeforeDue).toEqual([3])
    })

    it('rejects invalid overrides, including a foreign currency', () => {
        expect(() => resolveEstateSettings({ currency: 'RUB' })).toThrow()
        expect(() => resolveEstateSettings({ visitors: { maxPassesPerResidentPerDay: 0 } })).toThrow()
    })
})

describe('address and branding', () => {
    it('formats a Nigerian estate address', () => {
        expect(formatAddress({ flat: '2', houseOrBlock: '14', street: '5th Avenue', estate: 'Sunshine Estate', district: 'Lokogoma', city: 'Abuja', state: 'FCT' }))
            .toBe('Flat 2, House 14, 5th Avenue, Sunshine Estate, Lokogoma, Abuja, FCT')
        expect(formatAddress({ houseOrBlock: 'Block C', street: 'Crescent 3', estate: 'Gwarinpa Gardens', city: 'Abuja', state: 'FCT' }))
            .toBe('Block C, Crescent 3, Gwarinpa Gardens, Abuja, FCT')
    })

    it('legal footer names Teeco Enterprise Limited in full', () => {
        expect(legalFooter(2026)).toBe('© 2026 Teeco Enterprise Limited (RC 8211994). All rights reserved.')
    })

    it('emails carry the estate name, Teeco as platform, the legal footer, and escape input', () => {
        const email = renderEmail({ subject: 'Hi', heading: 'Levy due', lines: ['Pay <now>'], estateName: 'Sunshine Estate' })
        expect(email.html).toContain(`Sunshine Estate via ${BRAND.productName}`)
        expect(email.html).toContain('Teeco Enterprise Limited')
        expect(email.html).toContain('Pay &lt;now&gt;')
        expect(email.text).toContain('Teeco Enterprise Limited')
    })
})
