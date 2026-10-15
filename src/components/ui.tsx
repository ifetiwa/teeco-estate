import type { LucideIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'

export function PageHeader ({ title, description, actions, back }: { title: ReactNode, description?: ReactNode, actions?: ReactNode, back?: { href: string, label: string } }) {
    return (
        <div className='mb-6'>
            {back && <Link href={back.href} className='mb-2 inline-flex items-center gap-1 text-sm font-medium text-brand-700 hover:underline'>← {back.label}</Link>}
            <div className='flex flex-wrap items-end justify-between gap-3'>
                <div className='min-w-0'>
                    <h1 className='text-2xl font-bold text-slate-900 sm:text-3xl'>{title}</h1>
                    {description && <p className='mt-1 text-slate-600'>{description}</p>}
                </div>
                {actions && <div className='flex flex-wrap gap-2'>{actions}</div>}
            </div>
        </div>
    )
}

export function SectionCard ({ title, description, icon: Icon, actions, children, className = '' }: {
    title?: ReactNode, description?: ReactNode, icon?: LucideIcon, actions?: ReactNode, children: ReactNode, className?: string
}) {
    return (
        <section className={`card ${className}`}>
            {(title || actions) && (
                <div className='mb-4 flex flex-wrap items-start justify-between gap-3'>
                    <div className='flex min-w-0 items-start gap-3'>
                        {Icon && <span className='grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-700'><Icon className='h-5 w-5' aria-hidden /></span>}
                        <div className='min-w-0'>
                            {title && <h2 className='text-base font-semibold text-slate-900'>{title}</h2>}
                            {description && <p className='text-sm text-slate-500'>{description}</p>}
                        </div>
                    </div>
                    {actions}
                </div>
            )}
            {children}
        </section>
    )
}

const STAT_TONES = {
    brand: 'bg-brand-50 text-brand-700',
    accent: 'bg-accent-50 text-accent-600',
    slate: 'bg-slate-100 text-slate-600',
    red: 'bg-red-50 text-red-600',
} as const

export function StatCard ({ label, value, icon: Icon, tone = 'brand', href, hint }: {
    label: string, value: ReactNode, icon: LucideIcon, tone?: keyof typeof STAT_TONES, href?: string, hint?: string
}) {
    const body = (
        <div className='flex items-start justify-between gap-3'>
            <div>
                <p className='text-sm font-medium text-slate-500'>{label}</p>
                <p className='mt-1 text-3xl font-bold text-slate-900'>{value}</p>
                {hint && <p className='mt-1 text-xs text-slate-500'>{hint}</p>}
            </div>
            <span className={`grid h-11 w-11 place-items-center rounded-xl ${STAT_TONES[tone]}`}><Icon className='h-5 w-5' aria-hidden /></span>
        </div>
    )
    return href ? <Link href={href} className='card card-link'>{body}</Link> : <div className='card'>{body}</div>
}

const BADGE_TONES = {
    green: 'bg-brand-50 text-brand-700 ring-brand-200',
    amber: 'bg-accent-50 text-accent-600 ring-accent-100',
    red: 'bg-red-50 text-red-700 ring-red-200',
    slate: 'bg-slate-100 text-slate-600 ring-slate-200',
    blue: 'bg-sky-50 text-sky-700 ring-sky-200',
} as const
export type BadgeTone = keyof typeof BADGE_TONES

export function Badge ({ children, tone = 'slate' }: { children: ReactNode, tone?: BadgeTone }) {
    return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset ${BADGE_TONES[tone]}`}>{children}</span>
}

export function EmptyState ({ icon: Icon, title, children }: { icon: LucideIcon, title: string, children?: ReactNode }) {
    return (
        <div className='flex flex-col items-center rounded-xl border border-dashed border-slate-300 px-4 py-8 text-center'>
            <span className='grid h-12 w-12 place-items-center rounded-full bg-slate-100 text-slate-500'><Icon className='h-6 w-6' aria-hidden /></span>
            <p className='mt-3 font-medium text-slate-700'>{title}</p>
            {children && <div className='mt-1 text-sm text-slate-500'>{children}</div>}
        </div>
    )
}

export function Avatar ({ name, size = 'md' }: { name: string, size?: 'sm' | 'md' | 'lg' }) {
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?'
    const dims = size === 'sm' ? 'h-8 w-8 text-xs' : size === 'lg' ? 'h-14 w-14 text-lg' : 'h-10 w-10 text-sm'
    return <span aria-hidden className={`grid shrink-0 place-items-center rounded-full bg-brand-100 font-semibold text-brand-800 ${dims}`}>{initials}</span>
}

export function ActionTile ({ href, icon: Icon, title, description, tone = 'brand' }: { href: string, icon: LucideIcon, title: string, description?: string, tone?: keyof typeof STAT_TONES }) {
    return (
        <Link href={href} className='card-link flex items-center gap-4'>
            <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-xl ${STAT_TONES[tone]}`}><Icon className='h-6 w-6' aria-hidden /></span>
            <span className='min-w-0'>
                <span className='block font-semibold text-slate-900'>{title}</span>
                {description && <span className='block text-sm text-slate-500'>{description}</span>}
            </span>
        </Link>
    )
}

/** Badge colour for each visit status. */
export const VISIT_STATUS_TONE: Record<string, BadgeTone> = {
    checked_in: 'green', checked_out: 'slate', awaiting_resident: 'amber', approved: 'blue', declined: 'red', denied: 'red', cancelled: 'slate',
}
