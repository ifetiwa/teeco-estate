import { BRAND, legalFooter } from '@/config/brand'

export interface EmailMessage {
    to: string
    subject: string
    html: string
    text: string
}

export interface EmailProvider {
    readonly name: string
    send (message: EmailMessage): Promise<{ id: string }>
}

/** Development provider: records messages in memory and logs them instead of sending. */
export class ConsoleEmailProvider implements EmailProvider {
    readonly name = 'console'
    readonly sent: EmailMessage[] = []

    async send (message: EmailMessage) {
        this.sent.push(message)
        if (process.env.NODE_ENV !== 'test') console.log(`[email] to=${message.to} subject="${message.subject}"`)
        return { id: `console-${this.sent.length}` }
    }
}

let provider: EmailProvider = new ConsoleEmailProvider()

export function getEmailProvider (): EmailProvider {
    return provider
}

export function setEmailProvider (p: EmailProvider): void {
    provider = p
}

function escapeHtml (s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Wraps body paragraphs in the branded layout. `estateName`, when given, is shown as the sender
 * with Teeco as the platform. Body lines are plain text and are escaped.
 */
export function renderEmail (opts: { subject: string, heading: string, lines: string[], estateName?: string, action?: { label: string, url: string } }): EmailMessage & { to: '' } {
    const { subject, heading, lines, estateName, action } = opts
    const sender = estateName ? `${estateName} via ${BRAND.productName}` : BRAND.productName
    const footer = legalFooter()
    const html = `<!doctype html><html><body style="margin:0;background:#f8fafc;font-family:Arial,Helvetica,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="100%" style="max-width:560px;background:#ffffff;border-radius:8px;overflow:hidden">
<tr><td style="background:${BRAND.colors.primary};color:#ffffff;padding:16px 24px;font-size:18px;font-weight:bold">${escapeHtml(sender)}</td></tr>
<tr><td style="padding:24px">
<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>
${lines.map(l => `<p style="margin:0 0 12px;line-height:1.5">${escapeHtml(l)}</p>`).join('\n')}
${action ? `<p style="margin:20px 0"><a href="${escapeHtml(action.url)}" style="background:${BRAND.colors.primary};color:#ffffff;padding:10px 18px;border-radius:6px;text-decoration:none">${escapeHtml(action.label)}</a></p>` : ''}
</td></tr>
<tr><td style="padding:16px 24px;font-size:12px;color:#64748b;border-top:1px solid #e2e8f0">${escapeHtml(footer)}</td></tr>
</table></td></tr></table></body></html>`
    const text = [sender, '', heading, '', ...lines, ...(action ? ['', `${action.label}: ${action.url}`] : []), '', footer].join('\n')
    return { to: '', subject, html, text }
}
