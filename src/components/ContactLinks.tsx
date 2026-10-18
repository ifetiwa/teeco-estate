import { MessageCircle, MessageSquareText, Phone } from 'lucide-react'

import { formatNigerianPhone } from '@/lib/phone'

/** Call, SMS and WhatsApp buttons for an E.164 Nigerian number. `text` pre-fills the SMS and WhatsApp message. */
export function ContactLinks ({ phone, text, compact = false }: { phone: string, text?: string, compact?: boolean }) {
    const body = text ? encodeURIComponent(text) : ''
    const link = 'inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold ring-1 ring-inset transition'
    return (
        <span className='inline-flex flex-wrap items-center gap-1'>
            {!compact && <span className='mr-1 font-mono text-xs text-slate-600'>{formatNigerianPhone(phone)}</span>}
            <a href={`tel:${phone}`} className={`${link} bg-white text-slate-700 ring-slate-200 hover:bg-slate-50`} aria-label={`Call ${formatNigerianPhone(phone)}`}>
                <Phone className='h-3.5 w-3.5' aria-hidden /> Call
            </a>
            <a href={`sms:${phone}${body ? `?body=${body}` : ''}`} className={`${link} bg-white text-slate-700 ring-slate-200 hover:bg-slate-50`} aria-label={`Text ${formatNigerianPhone(phone)}`}>
                <MessageSquareText className='h-3.5 w-3.5' aria-hidden /> SMS
            </a>
            <a href={`https://wa.me/${phone.replace(/^\+/, '')}${body ? `?text=${body}` : ''}`} target='_blank' rel='noreferrer'
                className={`${link} bg-emerald-50 text-emerald-700 ring-emerald-200 hover:bg-emerald-100`} aria-label={`WhatsApp ${formatNigerianPhone(phone)}`}>
                <MessageCircle className='h-3.5 w-3.5' aria-hidden /> WhatsApp
            </a>
        </span>
    )
}
