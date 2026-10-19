// Emergency numbers shown on every distress alert after the estate's own police division.
// The FCT Police Command lines are the ones the Command has repeated in its public statements (2022 to 2026);
// 112 is Nigeria's national emergency number and 199 the emergency line listed for Abuja.
// Re-check them with the FCT Police Command before pilot launch.
export const EMERGENCY_LINES = [
    { label: 'FCT Police Command emergency', number: '+2348032003913' },
    { label: 'FCT Police Command emergency (2)', number: '+2348061581938' },
    { label: 'National emergency', number: '112' },
    { label: 'Abuja emergency (police)', number: '199' },
] as const

/** How many nearby police stations a distress alert shows (the estate's own division counts as one). */
export const NEAREST_STATIONS_SHOWN = 3

/** Distress alerts one person can raise per hour (stops repeated presses from texting the estate over and over). */
export const MAX_ALERTS_PER_USER_PER_HOUR = 5
