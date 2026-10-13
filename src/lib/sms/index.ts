import { appendFileSync } from 'node:fs'

export interface SmsMessage {
    to: string // E.164
    body: string
}

export interface SmsResult {
    id: string
    /** Provider-reported cost in kobo, when known (used for per-estate SMS billing). */
    costKobo?: number
}

export interface SmsProvider {
    readonly name: string
    send (message: SmsMessage): Promise<SmsResult>
}

/** Development provider: keeps messages in memory and logs them instead of sending. */
export class ConsoleSmsProvider implements SmsProvider {
    readonly name = 'console'
    readonly sent: SmsMessage[] = []

    async send (message: SmsMessage) {
        this.sent.push(message)
        if (process.env.NODE_ENV !== 'test') console.log(`[sms] to=${message.to} body="${message.body}"`)
        // Local development/e2e only (never set DEV_SMS_OUTBOX in production): append to an outbox file so tests can read codes
        if (process.env.DEV_SMS_OUTBOX) appendFileSync(process.env.DEV_SMS_OUTBOX, JSON.stringify(message) + '\n')
        return { id: `console-${this.sent.length}`, costKobo: 0 }
    }

    lastTo (phone: string): SmsMessage | undefined {
        return [...this.sent].reverse().find(m => m.to === phone)
    }
}

const globalForSms = globalThis as unknown as { teecoSms?: SmsProvider }

export function getSmsProvider (): SmsProvider {
    if (!globalForSms.teecoSms) globalForSms.teecoSms = new ConsoleSmsProvider()
    return globalForSms.teecoSms
}

export function setSmsProvider (p: SmsProvider): void {
    globalForSms.teecoSms = p
}
