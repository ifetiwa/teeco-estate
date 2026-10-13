// Nigerian mobile numbers: 11 digits locally (0 + network prefix 70x/80x/81x/90x/91x + 7 digits),
// stored in E.164 as +234XXXXXXXXXX.
const NG_MOBILE_NATIONAL = /^[789][01]\d{8}$/

export class InvalidPhoneError extends Error {
    constructor (input: string) {
        super(`"${input}" is not a valid Nigerian mobile number`)
        this.name = 'InvalidPhoneError'
    }
}

/** Returns the E.164 form (+234…) of a Nigerian mobile number, or null if invalid. */
export function normalizeNigerianPhone (input: string): string | null {
    if (typeof input !== 'string') return null
    let digits = input.trim().replace(/[\s\-().]/g, '')
    if (digits.startsWith('+234')) digits = digits.slice(4)
    else if (digits.startsWith('00234')) digits = digits.slice(5)
    else if (digits.startsWith('234') && digits.length === 13) digits = digits.slice(3)
    else if (digits.startsWith('0') && digits.length === 11) digits = digits.slice(1)
    if (!/^\d+$/.test(digits) || !NG_MOBILE_NATIONAL.test(digits)) return null
    return `+234${digits}`
}

export function requireNigerianPhone (input: string): string {
    const phone = normalizeNigerianPhone(input)
    if (!phone) throw new InvalidPhoneError(input)
    return phone
}

/** +2348031234567 -> 0803 123 4567 (how Nigerians write numbers). */
export function formatNigerianPhone (e164: string): string {
    const national = normalizeNigerianPhone(e164)
    if (!national) return e164
    const local = '0' + national.slice(4)
    return `${local.slice(0, 4)} ${local.slice(4, 7)} ${local.slice(7)}`
}
