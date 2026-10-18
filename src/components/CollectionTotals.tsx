import { formatNaira } from '@/lib/format'
import type { YearTotals } from '@/lib/levies'
import { shortMonthName } from '@/lib/periods'

/** Money received per year, and per month of the chosen year (security levy, service charge and total). */
export function CollectionTotals ({ totals, year, yearHref }: { totals: YearTotals[], year: number, yearHref: (y: number) => string }) {
    const selected = totals.find(t => t.year === year)
    const naira = (k: number) => (k ? formatNaira(k) : <span className='text-slate-400'>₦0</span>)
    // Phones show only the total column, with the split by charge underneath
    const wide = 'hidden text-right whitespace-nowrap sm:table-cell'
    const split = (t: { securityKobo: number, serviceKobo: number } | undefined) => (t && (t.securityKobo || t.serviceKobo)
        ? <span className='block text-xs font-normal whitespace-normal text-slate-500 sm:hidden'>Levy {formatNaira(t.securityKobo)} · Service {formatNaira(t.serviceKobo)}</span>
        : null)
    return (
        <div className='space-y-6'>
            <section>
                <h3 className='mb-2 font-semibold'>By year</h3>
                <div className='table-wrap'>
                    <table className='data-table'>
                        <thead><tr><th>Year</th><th className={wide}>Security levy</th><th className={wide}>Service charge</th><th className='text-right'>Total</th><th className={wide}>Payments</th></tr></thead>
                        <tbody>
                            {totals.map(t => (
                                <tr key={t.year} className={t.year === year ? 'bg-brand-50/60' : ''}>
                                    <td><a href={yearHref(t.year)} className='font-semibold text-brand-700 hover:underline'>{t.year}</a></td>
                                    <td className={wide}>{naira(t.securityKobo)}</td>
                                    <td className={wide}>{naira(t.serviceKobo)}</td>
                                    <td className='text-right font-semibold whitespace-nowrap'>{naira(t.totalKobo)}{split(t)}</td>
                                    <td className={wide}>{t.count}</td>
                                </tr>
                            ))}
                            {totals.length === 0 && <tr><td colSpan={5} className='text-slate-500'>No payments yet.</td></tr>}
                        </tbody>
                    </table>
                </div>
            </section>
            <section>
                <h3 className='mb-2 font-semibold'>By month, {year}</h3>
                <div className='table-wrap'>
                    <table className='data-table'>
                        <thead><tr><th>Month</th><th className={wide}>Security levy</th><th className={wide}>Service charge</th><th className='text-right'>Total</th></tr></thead>
                        <tbody>
                            {Array.from({ length: 12 }, (_, i) => {
                                const m = selected?.months[i]
                                return (
                                    <tr key={i}>
                                        <td className='whitespace-nowrap'>{shortMonthName(i + 1)} {year}</td>
                                        <td className={wide}>{naira(m?.securityKobo ?? 0)}</td>
                                        <td className={wide}>{naira(m?.serviceKobo ?? 0)}</td>
                                        <td className='text-right font-semibold whitespace-nowrap'>{naira(m?.totalKobo ?? 0)}{split(m)}</td>
                                    </tr>
                                )
                            })}
                            <tr className='bg-slate-50 font-semibold'>
                                <td className='whitespace-nowrap'>Total {year}</td>
                                <td className={wide}>{naira(selected?.securityKobo ?? 0)}</td>
                                <td className={wide}>{naira(selected?.serviceKobo ?? 0)}</td>
                                <td className='text-right whitespace-nowrap'>{naira(selected?.totalKobo ?? 0)}{split(selected)}</td>
                            </tr>
                        </tbody>
                    </table>
                </div>
                <p className='mt-1 text-xs text-slate-500'>By the date money was received. Voided payments are not counted.</p>
            </section>
        </div>
    )
}
