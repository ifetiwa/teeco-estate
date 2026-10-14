'use client'

import { useState } from 'react'

export function CopyButton ({ text, label = 'Copy' }: { text: string, label?: string }) {
    const [copied, setCopied] = useState(false)
    return (
        <button
            type='button'
            className='btn-secondary'
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(text)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                } catch {
                    window.prompt('Copy this message:', text)
                }
            }}
        >
            {copied ? 'Copied' : label}
        </button>
    )
}
