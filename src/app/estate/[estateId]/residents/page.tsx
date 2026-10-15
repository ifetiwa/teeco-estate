import { Search, UserCheck, Users } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ActionForm, SubmitButton } from '@/components/ActionForm'
import { Avatar, Badge, EmptyState, PageHeader, SectionCard } from '@/components/ui'
import { formatDateTime } from '@/lib/format'
import { formatNigerianPhone } from '@/lib/phone'
import { listPendingResidents, listResidents } from '@/lib/residents'

import { approveResidentAction, rejectResidentAction } from '../actions'
import { loadStaffEstate } from '../context'

export const metadata: Metadata = { title: 'Residents' }

const RELATION: Record<string, string> = { owner: 'Owner', tenant: 'Tenant', household: 'Household' }

export default async function ResidentsPage ({ params, searchParams }: { params: Promise<{ estateId: string }>, searchParams: Promise<{ q?: string, past?: string }> }) {
    const { estateId } = await params
    const { q, past } = await searchParams
    const { actor, estate, isAdmin, can } = await loadStaffEstate(estateId)
    if (!can('residents.read')) notFound()
    const [residents, pending] = await Promise.all([
        listResidents(actor, estate.id, { search: q, includePast: past === '1' }),
        isAdmin ? listPendingResidents(actor, estate.id) : Promise.resolve([]),
    ])

    return (
        <div className='space-y-6'>
            <PageHeader title='Residents' description='Everyone living in the estate. To add someone, open their house under Streets & units.' />

            {isAdmin && (
                <section id='approvals'>
                    <SectionCard title={`Waiting for approval (${pending.length})`} icon={UserCheck} className={pending.length ? 'border-accent-400' : ''}>
                        {pending.length === 0 && <p className='text-sm text-slate-500'>No requests waiting.</p>}
                        <ul className='divide-y divide-slate-100'>
                            {pending.map(p => (
                                <li key={p.id} className='flex flex-wrap items-center justify-between gap-3 py-3'>
                                    <div className='flex min-w-0 items-center gap-3'>
                                        <Avatar name={p.name} />
                                        <div className='min-w-0'>
                                            <p className='font-semibold'>{p.name}</p>
                                            <p className='text-sm text-slate-500'>
                                                {p.unitLabel}, {p.zoneName} · {RELATION[p.relation]} · {formatNigerianPhone(p.phone)} · asked {formatDateTime(p.createdAt)}
                                            </p>
                                        </div>
                                    </div>
                                    <div className='flex flex-wrap items-center gap-2'>
                                        <ActionForm action={approveResidentAction.bind(null, estate.id, p.id)}>
                                            <SubmitButton className='px-4 py-2'>Approve</SubmitButton>
                                        </ActionForm>
                                        <ActionForm action={rejectResidentAction.bind(null, estate.id, p.id)} className='flex items-center gap-2'>
                                            <input name='reason' placeholder='Reason' required minLength={3} aria-label='Reason for declining' className='w-32 py-2 text-sm' />
                                            <SubmitButton variant='danger' className='px-4 py-2'>Decline</SubmitButton>
                                        </ActionForm>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </SectionCard>
                </section>
            )}

            <section>
                <div className='mb-3 flex flex-wrap items-end justify-between gap-3'>
                    <h2 className='text-lg font-semibold'>Residents ({residents.length})</h2>
                    <form className='flex w-full flex-wrap items-center gap-2 sm:w-auto'>
                        <div className='relative min-w-0 flex-1'>
                            <Search className='pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400' aria-hidden />
                            <input name='q' defaultValue={q} placeholder='Name, house, street or phone' aria-label='Search residents' className='w-full py-2 pl-9 sm:w-64' />
                        </div>
                        <label className='flex items-center gap-1.5 text-sm'><input type='checkbox' name='past' value='1' defaultChecked={past === '1'} /> Include moved out</label>
                        <button className='btn-secondary'>Search</button>
                    </form>
                </div>
                {residents.length === 0
                    ? <EmptyState icon={Users} title='No residents found' />
                    : (
                        <div className='table-wrap'>
                            <table className='data-table'>
                                <thead>
                                    <tr><th>Name</th><th>Unit</th><th>Relation</th><th>Phone</th><th>Status</th></tr>
                                </thead>
                                <tbody>
                                    {residents.map(r => (
                                        <tr key={r.id}>
                                            <td>
                                                <span className='flex items-center gap-2 font-medium'>
                                                    <Avatar name={r.name} size='sm' /> {r.name}
                                                    {r.isPrimary && <Badge tone='green'>Primary</Badge>}
                                                </span>
                                            </td>
                                            <td><Link className='font-medium text-brand-700 hover:underline' href={`/estate/${estate.id}/units/${r.unitId}`}>{r.unitLabel}, {r.zoneName}</Link></td>
                                            <td>{RELATION[r.relation]}</td>
                                            <td className='whitespace-nowrap'>{formatNigerianPhone(r.phone)}</td>
                                            <td>{r.status === 'active' ? <Badge tone='green'>Current</Badge> : <Badge>Moved out</Badge>}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
            </section>
        </div>
    )
}
