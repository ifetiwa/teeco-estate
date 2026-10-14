import type { Metadata } from 'next'
import Link from 'next/link'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { unitType, zoneKind } from '@/db/schema'
import { listZonesWithUnits } from '@/lib/structure'

import { addUnitsAction, createZoneAction } from '../actions'
import { loadStaffEstate } from '../context'

export const metadata: Metadata = { title: 'Streets & units' }

export default async function UnitsPage ({ params }: { params: Promise<{ estateId: string }> }) {
    const { estateId } = await params
    const { actor, estate, isAdmin, can } = await loadStaffEstate(estateId)
    const zones = await listZonesWithUnits(actor, estate.id)
    const canOpenUnit = can('residents.read')

    return (
        <div className='grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_320px]'>
            <section className='space-y-4'>
                <h1 className='text-xl font-semibold'>Streets & units</h1>
                {zones.length === 0 && <p className='text-slate-600'>No streets or blocks yet.</p>}
                {zones.map(z => (
                    <div key={z.id} className='card'>
                        <h2 className='font-semibold'>{z.name} <span className='text-sm font-normal text-slate-500'>· <span className='capitalize'>{z.kind}</span> · {z.units.length} units</span></h2>
                        <ul className='mt-3 flex flex-wrap gap-2'>
                            {z.units.map(u => {
                                const cls = `inline-block rounded-md border px-3 py-1 text-sm ${u.isActive ? (u.occupantCount ? 'border-brand-600 bg-brand-50' : 'border-slate-300') : 'border-dashed border-slate-300 text-slate-400'}`
                                const label = <>{u.label}{u.occupantCount > 0 && <span className='ml-1 text-xs text-brand-700'>({u.occupantCount})</span>}</>
                                return (
                                    <li key={u.id}>
                                        {canOpenUnit ? <Link href={`/estate/${estate.id}/units/${u.id}`} className={`${cls} hover:border-brand-700`}>{label}</Link> : <span className={cls}>{label}</span>}
                                    </li>
                                )
                            })}
                        </ul>
                    </div>
                ))}
                <p className='text-xs text-slate-500'>Numbers in brackets are current residents. Dashed units are inactive.</p>
            </section>

            {isAdmin && (
                <aside className='space-y-4'>
                    <div className='card'>
                        <h2 className='font-semibold'>Add a street or block</h2>
                        <ActionForm action={createZoneAction.bind(null, estate.id)} className='mt-3 flex flex-col gap-3'>
                            <Field label='Name' name='name'><input id='name' name='name' placeholder='e.g. 3rd Avenue or Block C' required /></Field>
                            <Field label='Type' name='kind'>
                                <select id='kind' name='kind' defaultValue='street' className='capitalize'>
                                    {zoneKind.enumValues.map(k => <option key={k} value={k}>{k}</option>)}
                                </select>
                            </Field>
                            <SubmitButton>Add</SubmitButton>
                        </ActionForm>
                    </div>
                    {zones.length > 0 && (
                        <div className='card'>
                            <h2 className='font-semibold'>Add houses or flats</h2>
                            <ActionForm action={addUnitsAction.bind(null, estate.id)} className='mt-3 flex flex-col gap-3'>
                                <Field label='Street or block' name='zoneId'>
                                    <select id='zoneId' name='zoneId' required>
                                        {zones.map(z => <option key={z.id} value={z.id}>{z.name}</option>)}
                                    </select>
                                </Field>
                                <Field label='Numbers' name='labels' hint='Ranges and lists: 1-20, 22, 24A or B1-B8'>
                                    <input id='labels' name='labels' placeholder='1-20' required />
                                </Field>
                                <Field label='Type' name='type'>
                                    <select id='type' name='type' defaultValue='house' className='capitalize'>
                                        {unitType.enumValues.map(t => <option key={t} value={t}>{t}</option>)}
                                    </select>
                                </Field>
                                <SubmitButton>Add units</SubmitButton>
                            </ActionForm>
                        </div>
                    )}
                </aside>
            )}
        </div>
    )
}
