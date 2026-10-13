// Single place for product naming and branding. "Teeco Estate" is a working name (docs/DECISIONS.md).
export const BRAND = {
    productName: 'Teeco Estate',
    legalName: 'Teeco Enterprise Limited',
    rcNumber: 'RC 8211994',
    supportEmail: 'support@teeco.example',
    colors: {
        primary: '#0f5132',
        primaryDark: '#0a3622',
        accent: '#d4a017',
    },
} as const

export function legalFooter (year: number = new Date().getFullYear()): string {
    return `© ${year} ${BRAND.legalName} (${BRAND.rcNumber}). All rights reserved.`
}
