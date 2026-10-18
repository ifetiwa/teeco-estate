// Emergency numbers shown on every distress alert, whatever the police station list holds.
// 112 is Nigeria's national emergency number; 199 is the emergency line listed for Abuja.
// Re-check both with the FCT Police Command before pilot launch.
export const EMERGENCY_LINES = [
    { label: 'National emergency', number: '112' },
    { label: 'Abuja emergency (police)', number: '199' },
] as const

/** How many nearby police stations a distress alert shows. */
export const NEAREST_STATIONS_SHOWN = 3

/** Distress alerts one person can raise per hour (stops repeated presses from texting the estate over and over). */
export const MAX_ALERTS_PER_USER_PER_HOUR = 5
