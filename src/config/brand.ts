// Single place for product naming and branding. "MyEstateapp" is the product name (docs/DECISIONS.md).
export const BRAND = {
    productName: 'MyEstateapp',
    legalName: 'Teeco Enterprise Limited',
    rcNumber: 'RC 8211994',
    supportEmail: 'teeco2010@gmail.com',
    colors: {
        primary: '#0f5132',
        primaryDark: '#0a3622',
        accent: '#d4a017',
    },
} as const

export function legalFooter (year: number = new Date().getFullYear()): string {
    return `© ${year} ${BRAND.legalName} (${BRAND.rcNumber}). All rights reserved.`
}
