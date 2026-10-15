'use client'

import { type ReactNode, createContext, useActionState, useContext, useEffect, useRef } from 'react'
import { useFormStatus } from 'react-dom'

import type { ActionState } from '@/lib/actions'

type Action = (state: ActionState, formData: FormData) => Promise<ActionState>

const FieldErrorsContext = createContext<Record<string, string> | undefined>(undefined)

/** Form bound to a server action; shows the error/success message and resets after success. */
export function ActionForm ({ action, children, className, resetOnSuccess = true, confirm }: {
    action: Action
    children: ReactNode
    className?: string
    resetOnSuccess?: boolean
    confirm?: string
}) {
    const [state, formAction] = useActionState(action, {})
    const ref = useRef<HTMLFormElement>(null)
    useEffect(() => {
        if (state.ok && resetOnSuccess) ref.current?.reset()
    }, [state.nonce, state.ok, resetOnSuccess])
    return (
        <form
            ref={ref}
            action={formAction}
            className={className}
            onSubmit={confirm ? (e) => { if (!window.confirm(confirm)) e.preventDefault() } : undefined}
        >
            <FieldErrorsContext.Provider value={state.fieldErrors}>
                {children}
            </FieldErrorsContext.Provider>
            {state.error && <p role='alert' className='mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm font-medium text-red-700 ring-1 ring-red-200'>{state.error}</p>}
            {state.ok && state.message && <p role='status' className='mt-3 rounded-lg bg-brand-50 px-3 py-2 text-sm font-medium text-brand-800 ring-1 ring-brand-200'>{state.message}</p>}
        </form>
    )
}

export function Field ({ label, name, hint, children }: { label: string, name: string, hint?: string, children: ReactNode }) {
    const errors = useContext(FieldErrorsContext)
    const error = errors?.[name]
    return (
        <div className='flex flex-col gap-1.5'>
            <label htmlFor={name}>{label}</label>
            {children}
            {hint && !error && <p className='text-xs text-slate-500'>{hint}</p>}
            {error && <p className='text-xs font-medium text-red-600'>{error}</p>}
        </div>
    )
}

// Written out in full so Tailwind generates each class
const VARIANT_CLASS = { primary: 'btn-primary', secondary: 'btn-secondary', danger: 'btn-danger' } as const

export function SubmitButton ({ children, variant = 'primary', className = '' }: { children: ReactNode, variant?: 'primary' | 'secondary' | 'danger', className?: string }) {
    const { pending } = useFormStatus()
    return (
        <button type='submit' disabled={pending} className={`${VARIANT_CLASS[variant]} ${className}`}>
            {pending ? 'Please wait…' : children}
        </button>
    )
}
