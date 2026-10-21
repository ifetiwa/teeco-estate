'use client'

import { CheckCircle2, Clock, DoorOpen, LogOut, ShieldAlert, ThumbsUp, UserPlus, XCircle } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { type ReactNode, useActionState, useCallback, useEffect, useRef, useState } from 'react'

import { ActionForm, Field, SubmitButton } from '@/components/ActionForm'
import { PhoneInput } from '@/components/PhoneInput'
import { QrScanner } from '@/components/QrScanner'

import { type VerifyState, admitPassAction, admitWalkInAction, checkOutAction, denyPassAction, verifyCodeAction, walkInAction } from './actions'

export interface BoardRow {
    id: string
    visitorName: string
    purpose: string
    vehiclePlate: string | null
    gate: number
    unit: string
    time: string
    note: string | null
}

export function GateConsole ({ estateId, gateCount, units, waiting, approved, declined, inside }: {
    estateId: string
    gateCount: number
    units: Array<{ id: string, label: string }>
    waiting: BoardRow[]
    approved: BoardRow[]
    declined: BoardRow[]
    inside: BoardRow[]
}) {
    const router = useRouter()
    const [gate, setGate] = useState(1)
    const [verify, verifyAction, verifying] = useActionState<VerifyState, FormData>(verifyCodeAction.bind(null, estateId), {})
    const [showWalkIn, setShowWalkIn] = useState(false)
    const [dismissed, setDismissed] = useState<number | undefined>()
    const codeRef = useRef<HTMLInputElement>(null)
    const formRef = useRef<HTMLFormElement>(null)
    // A scanned QR fills the code box and checks it straight away
    const onScan = useCallback((text: string) => {
        if (codeRef.current) codeRef.current.value = text
        formRef.current?.requestSubmit()
    }, [])

    useEffect(() => {
        try {
            const saved = Number(localStorage.getItem(`gate:${estateId}`))
            if (saved >= 1 && saved <= gateCount) setGate(saved)
        } catch { /* storage unavailable */ }
    }, [estateId, gateCount])

    // Keep the board fresh: resident answers and other guards' check-ins
    useEffect(() => {
        const t = setInterval(() => router.refresh(), 10_000)
        return () => clearInterval(t)
    }, [router])

    const chooseGate = (g: number) => {
        setGate(g)
        try { localStorage.setItem(`gate:${estateId}`, String(g)) } catch { /* ignore */ }
    }
    const showResult = verify.nonce !== undefined && verify.nonce !== dismissed
    const done = () => {
        setDismissed(verify.nonce)
        if (codeRef.current) codeRef.current.value = ''
        codeRef.current?.focus()
    }
    const gateInput = <input type='hidden' name='gate' value={gate} />

    return (
        <div className='space-y-5'>
            {gateCount > 1 && (
                <div className='flex items-center gap-2' role='group' aria-label='Gate'>
                    <span className='text-sm font-medium text-slate-600'>Gate</span>
                    {Array.from({ length: gateCount }, (_, i) => i + 1).map(g => (
                        <button key={g} type='button' onClick={() => chooseGate(g)} aria-pressed={gate === g}
                            className={`h-12 w-12 rounded-xl text-lg font-bold transition ${gate === g ? 'bg-brand-700 text-white shadow-sm' : 'bg-white text-slate-700 ring-1 ring-slate-300'}`}>{g}</button>
                    ))}
                </div>
            )}

            <form ref={formRef} action={verifyAction} className='card space-y-3'>
                <label htmlFor='code' className='text-base font-semibold'>Visitor code</label>
                <input ref={codeRef} id='code' name='code' inputMode='numeric' autoComplete='off' placeholder='6-digit code' required
                    className='w-full py-4 text-center font-mono text-4xl tracking-[0.3em] placeholder:font-sans placeholder:text-xl placeholder:tracking-normal' />
                <button type='submit' disabled={verifying} className='btn-primary w-full py-4 text-xl'>{verifying ? 'Checking…' : 'Check code'}</button>
                <QrScanner onResult={onScan} />
                {verify.error && <p role='alert' className='rounded-lg bg-red-50 px-3 py-2 font-medium text-red-700'>{verify.error}</p>}
            </form>

            {showResult && verify.miss && (
                <div role='alert' className='rounded-2xl bg-red-600 p-5 text-white shadow-(--shadow-raised)'>
                    <p className='flex items-center gap-2 text-2xl font-extrabold'><XCircle className='h-7 w-7' aria-hidden /> Do not admit</p>
                    <p className='mt-2 text-lg'>{verify.miss.message}</p>
                    <button type='button' className='btn mt-4 w-full bg-white py-3 text-red-700 hover:bg-red-50' onClick={done}>OK</button>
                </div>
            )}

            {showResult && verify.hit && (
                <div className='rounded-2xl bg-white p-5 shadow-(--shadow-raised) ring-2 ring-brand-500'>
                    <p className='flex items-center gap-2 text-xl font-extrabold text-brand-700'><CheckCircle2 className='h-7 w-7' aria-hidden /> Valid pass</p>
                    <p className='mt-3 text-2xl font-bold'>{verify.hit.visitorName}</p>
                    <p className='text-lg'>To: {verify.hit.unitLabel}, {verify.hit.zoneName}{verify.hit.residentName ? ` (${verify.hit.residentName})` : ''}</p>
                    {verify.hit.purpose && <p className='text-slate-600'>Purpose: {verify.hit.purpose}</p>}
                    {verify.hit.vehiclePlate && <p className='text-slate-600'>Vehicle: <span className='font-mono font-semibold'>{verify.hit.vehiclePlate}</span></p>}
                    <p className='mt-1 text-sm text-slate-500'>{verify.hit.usage === 'single' ? 'One entry' : 'Many entries'} · valid until {verify.hit.validUntil}</p>
                    <div className='mt-5 grid grid-cols-2 gap-3'>
                        <ActionForm action={admitPassAction.bind(null, estateId, verify.hit.passId)}>
                            {gateInput}
                            <SubmitButton className='w-full py-4 text-lg'>Allow in</SubmitButton>
                        </ActionForm>
                        <ActionForm action={denyPassAction.bind(null, estateId, verify.hit.passId)} className='space-y-2'>
                            {gateInput}
                            <SubmitButton variant='danger' className='w-full py-4 text-lg'>Deny</SubmitButton>
                            <input name='reason' placeholder='Reason (optional)' aria-label='Reason for denying' className='w-full py-2 text-sm' />
                        </ActionForm>
                    </div>
                    <button type='button' className='mt-3 w-full text-sm font-medium text-slate-600 underline' onClick={done}>Next visitor</button>
                </div>
            )}

            <div className='card'>
                <button type='button' className='btn-secondary w-full py-3 text-lg' onClick={() => setShowWalkIn(v => !v)} aria-expanded={showWalkIn}>
                    <UserPlus className='h-5 w-5' aria-hidden /> {showWalkIn ? 'Close walk-in form' : 'Visitor without a code'}
                </button>
                {showWalkIn && (
                    <ActionForm action={walkInAction.bind(null, estateId)} className='mt-4 space-y-3'>
                        {gateInput}
                        <Field label='Going to house' name='unitId'>
                            <select id='unitId' name='unitId' required defaultValue=''>
                                <option value='' disabled>Choose…</option>
                                {units.map(u => <option key={u.id} value={u.id}>{u.label}</option>)}
                            </select>
                        </Field>
                        <Field label='Visitor name' name='visitorName'><input id='visitorName' name='visitorName' required /></Field>
                        <Field label='Visitor phone (optional)' name='visitorPhone'><PhoneInput name='visitorPhone' required={false} /></Field>
                        <Field label='Purpose' name='purpose'><input id='purpose' name='purpose' placeholder='e.g. Delivery' /></Field>
                        <Field label='Vehicle plate (optional)' name='vehiclePlate'><input id='vehiclePlate' name='vehiclePlate' className='uppercase' /></Field>
                        <SubmitButton className='w-full py-3 text-lg'>Ask the resident</SubmitButton>
                    </ActionForm>
                )}
            </div>

            <Board title='Approved by resident: let in' icon={<ThumbsUp className='h-5 w-5 text-brand-600' aria-hidden />} rows={approved} empty='None' action={r => (
                <ActionForm action={admitWalkInAction.bind(null, estateId, r.id)}><SubmitButton className='shrink-0 px-3 py-3 whitespace-nowrap'>Check in</SubmitButton></ActionForm>
            )} />
            <Board title='Waiting for resident' icon={<Clock className='h-5 w-5 text-accent-500' aria-hidden />} rows={waiting} empty='None' />
            <Board title='Declined by resident: do not admit' icon={<ShieldAlert className='h-5 w-5 text-red-600' aria-hidden />} rows={declined} empty='None' tone='danger' />
            <Board title={`Inside now (${inside.length})`} icon={<DoorOpen className='h-5 w-5 text-brand-600' aria-hidden />} rows={inside} empty='Nobody checked in' action={r => (
                <ActionForm action={checkOutAction.bind(null, estateId, r.id)}><SubmitButton variant='secondary' className='shrink-0 px-3 py-3 whitespace-nowrap'><LogOut className='h-4 w-4' aria-hidden />Check out</SubmitButton></ActionForm>
            )} />
        </div>
    )
}

function Board ({ title, icon, rows, empty, action, tone }: { title: string, icon: ReactNode, rows: BoardRow[], empty: string, action?: (r: BoardRow) => ReactNode, tone?: 'danger' }) {
    return (
        <section className='card'>
            <h2 className={`flex items-center gap-2 font-semibold ${tone === 'danger' ? 'text-red-700' : ''}`}>{icon}{title}</h2>
            {rows.length === 0 && <p className='mt-1 text-sm text-slate-500'>{empty}</p>}
            <ul className='mt-2 divide-y divide-slate-100'>
                {rows.map(r => (
                    <li key={r.id} className='flex items-center justify-between gap-3 py-3'>
                        <div className='min-w-0'>
                            <p className='font-semibold'>{r.visitorName} <span className='text-sm font-normal text-slate-500'>→ {r.unit}</span></p>
                            <p className='text-sm text-slate-500'>{r.time} · gate {r.gate}{r.vehiclePlate ? ` · ${r.vehiclePlate}` : ''}{r.note ? ` · ${r.note}` : ''}</p>
                        </div>
                        {action?.(r)}
                    </li>
                ))}
            </ul>
        </section>
    )
}
