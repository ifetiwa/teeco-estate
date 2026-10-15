import { Building, MapPin, PlusCircle } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { EmptyState, PageHeader, SectionCard } from '@/components/ui'
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
    const total = zones.reduce((n, z) => n + z.units.length, 0)

    return (
        <div>
            <PageHeader title='Streets & units' description={`${zones.length} streets or blocks · ${total} units`} />
            <div className='grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_320px]'>
                <div className='space-y-4'>
                    {zones.length === 0 && <EmptyState icon={MapPin} title='No streets or blocks yet'>{isAdmin ? 'Add your first street or block to start.' : 'The estate admin has not set up the layout yet.'}</EmptyState>}
                    {zones.map(z => (
                        <SectionCard key={z.id} icon={Building} title={z.name} description={<><span className='capitalize'>{z.kind}</span> · {z.units.length} units · {z.units.filter(u => u.occupantCount > 0).length} occupied</>}>
                            <ul className='flex flex-wrap gap-2'>
                                {z.units.map(u => {
                                    const cls = `inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm font-medium transition ${u.isActive ? (u.occupantCount ? 'border-brand-200 bg-brand-50 text-brand-800' : 'border-slate-200 bg-white text-slate-700') : 'border-dashed border-slate-300 text-slate-400'}`
                                    const label = <>{u.label}{u.occupantCount > 0 && <span className='rounded-full bg-brand-600 px-1.5 text-[10px] font-bold text-white'>{u.occupantCount}</span>}</>
                                    return (
                                        <li key={u.id}>
                                            {canOpenUnit ? <Link href={`/estate/${estate.id}/units/${u.id}`} className={`${cls} hover:border-brand-500 hover:shadow-sm`}>{label}</Link> : <span className={cls}>{label}</span>}
                                        </li>
                                    )
                                })}
                            </ul>
                        </SectionCard>
                    ))}
                    {zones.length > 0 && <p className='text-xs text-slate-500'>Green units have residents (count shown). Dashed units are inactive.</p>}
                </div>

                {isAdmin && (
                    <aside className='space-y-4'>
                        <SectionCard title='Add a street or block' icon={PlusCircle}>
                            <ActionForm action={createZoneAction.bind(null, estate.id)} className='flex flex-col gap-3'>
                                <Field label='Name' name='name'><input id='name' name='name' placeholder='e.g. 3rd Avenue or Block C' required /></Field>
                                <Field label='Type' name='kind'>
                                    <select id='kind' name='kind' defaultValue='street' className='capitalize'>
                                        {zoneKind.enumValues.map(k => <option key={k} value={k}>{k}</option>)}
                                    </select>
                                </Field>
                                <SubmitButton>Add</SubmitButton>
                            </ActionForm>
                        </SectionCard>
                        {zones.length > 0 && (
                            <SectionCard title='Add houses or flats' icon={PlusCircle}>
                                <ActionForm action={addUnitsAction.bind(null, estate.id)} className='flex flex-col gap-3'>
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
                            </SectionCard>
                        )}
                    </aside>
                )}
            </div>
        </div>
    )
}
