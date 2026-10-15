'use client'

import { useState } from 'react'

import { formatNigerianPhone, normalizeNigerianPhone } from '@/lib/phone'

/** Phone field with +234 prefix and live Nigerian-number validation. */
export function PhoneInput ({ name, defaultValue = '', required = true, autoFocus }: { name: string, defaultValue?: string, required?: boolean, autoFocus?: boolean }) {
    const [value, setValue] = useState(defaultValue ? formatNigerianPhone(defaultValue) : '')
    const [touched, setTouched] = useState(false)
    const valid = normalizeNigerianPhone(value) !== null
    const showError = touched && value.length > 0 && !valid
    return (
        <div className='flex flex-col gap-1'>
            <div className='flex'>
                <span className='inline-flex items-center rounded-l-lg border border-r-0 border-slate-300 bg-slate-50 px-3 text-sm font-semibold whitespace-nowrap text-slate-600'>+234</span>
                <input
                    id={name}
                    name={name}
                    type='tel'
                    inputMode='tel'
                    autoComplete='tel-national'
                    placeholder='0803 123 4567'
                    required={required}
                    autoFocus={autoFocus}
                    value={value}
                    onChange={(e) => setValue(e.target.value)}
                    onBlur={() => setTouched(true)}
                    aria-invalid={showError}
                    className={`w-full min-w-0 rounded-l-none ${showError ? 'border-red-500 focus:border-red-500 focus:ring-red-100' : ''}`}
                />
            </div>
            {showError && <p className='text-xs text-red-700'>Enter a Nigerian mobile number, e.g. 0803 123 4567</p>}
        </div>
    )
}
