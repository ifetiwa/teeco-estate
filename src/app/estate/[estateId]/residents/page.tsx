import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { ActionForm, SubmitButton } from '@/components/ActionForm'
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
    const { actor, estate, isAdmin, access } = await loadStaffEstate(estateId)
    if (!isAdmin && !access.staffRoles.includes('finance_officer')) notFound()
    const [residents, pending] = await Promise.all([
        listResidents(actor, estate.id, { search: q, includePast: past === '1' }),
        isAdmin ? listPendingResidents(actor, estate.id) : Promise.resolve([]),
    ])

    return (
        <div className='space-y-6'>
            {isAdmin && (
                <section id='approvals' className='card'>
                    <h2 className='font-semibold'>Waiting for approval ({pending.length})</h2>
                    {pending.length === 0 && <p className='mt-2 text-sm text-slate-600'>No requests waiting.</p>}
                    <ul className='mt-2 divide-y divide-slate-100'>
                        {pending.map(p => (
                            <li key={p.id} className='flex flex-wrap items-center justify-between gap-3 py-3'>
                                <div>
                                    <p className='font-medium'>{p.name}</p>
                                    <p className='text-sm text-slate-600'>
                                        {p.unitLabel}, {p.zoneName} · {RELATION[p.relation]} · {formatNigerianPhone(p.phone)} · asked {formatDateTime(p.createdAt)}
                                    </p>
                                </div>
                                <div className='flex flex-wrap items-center gap-2'>
                                    <ActionForm action={approveResidentAction.bind(null, estate.id, p.id)}>
                                        <SubmitButton className='px-3 py-1 text-sm'>Approve</SubmitButton>
                                    </ActionForm>
                                    <ActionForm action={rejectResidentAction.bind(null, estate.id, p.id)} className='flex items-center gap-2'>
                                        <input name='reason' placeholder='Reason' required minLength={3} aria-label='Reason for declining' className='py-1 text-sm' />
                                        <SubmitButton variant='danger' className='px-3 py-1 text-sm'>Decline</SubmitButton>
                                    </ActionForm>
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            )}

            <section>
                <div className='flex flex-wrap items-end justify-between gap-3'>
                    <h1 className='text-xl font-semibold'>Residents ({residents.length})</h1>
                    <form className='flex items-center gap-2'>
                        <input name='q' defaultValue={q} placeholder='Name, house, street or phone' aria-label='Search residents' className='py-1' />
                        <label className='flex items-center gap-1 text-sm'><input type='checkbox' name='past' value='1' defaultChecked={past === '1'} /> Include moved out</label>
                        <button className='btn-secondary px-3 py-1'>Search</button>
                    </form>
                </div>
                <div className='mt-3 overflow-x-auto rounded-lg border border-slate-200 bg-white'>
                    <table className='w-full text-left text-sm'>
                        <thead className='bg-slate-50 text-slate-600'>
                            <tr><th className='p-3'>Name</th><th className='p-3'>Unit</th><th className='p-3'>Relation</th><th className='p-3'>Phone</th><th className='p-3'>Status</th></tr>
                        </thead>
                        <tbody>
                            {residents.map(r => (
                                <tr key={r.id} className='border-t border-slate-100'>
                                    <td className='p-3 font-medium'>{r.name}{r.isPrimary && <span className='ml-1 text-xs text-brand-700'>(primary)</span>}</td>
                                    <td className='p-3'><Link className='underline' href={`/estate/${estate.id}/units/${r.unitId}`}>{r.unitLabel}, {r.zoneName}</Link></td>
                                    <td className='p-3'>{RELATION[r.relation]}</td>
                                    <td className='p-3 whitespace-nowrap'>{formatNigerianPhone(r.phone)}</td>
                                    <td className='p-3'>{r.status === 'active' ? 'Current' : 'Moved out'}</td>
                                </tr>
                            ))}
                            {residents.length === 0 && <tr><td colSpan={5} className='p-3 text-slate-500'>No residents found.</td></tr>}
                        </tbody>
                    </table>
                </div>
                {isAdmin && <p className='mt-2 text-xs text-slate-500'>To add a resident, open their house from Streets & units.</p>}
            </section>
        </div>
    )
}
