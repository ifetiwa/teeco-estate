// Renders the launcher icon and splash screen sources (assets/*.png) from the Teeco logo, for @capacitor/assets.
import sharp from 'sharp'

const GREEN = '#0f5132'
const house = (fill, dot) => `<path d="M14 32 32 16l18 16v18H38V38H26v12H14z" fill="${fill}"/><circle cx="32" cy="29" r="4" fill="${dot}"/>`
const svg = (size, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">${body}</svg>`)

// Full icon (legacy launchers): green rounded square with the white house
await sharp(svg(1024, `<rect width="64" height="64" fill="${GREEN}"/>${house('#ffffff', '#d4a017')}`)).png().toFile('assets/icon-only.png')
// Adaptive icon: house only on a transparent layer (kept inside the safe zone), plus a plain green background layer
await sharp(svg(1024, `<g transform="translate(14 14) scale(0.5625)">${house('#ffffff', '#d4a017')}</g>`)).png().toFile('assets/icon-foreground.png')
await sharp(svg(1024, `<rect width="64" height="64" fill="${GREEN}"/>`)).png().toFile('assets/icon-background.png')
// Splash: logo centred on green
const logo = await sharp(svg(600, `<rect width="64" height="64" rx="14" fill="#ffffff"/>${house(GREEN, '#d4a017')}`)).png().toBuffer()
for (const name of ['splash.png', 'splash-dark.png']) {
    await sharp({ create: { width: 2732, height: 2732, channels: 4, background: GREEN } })
        .composite([{ input: logo, gravity: 'center' }]).png().toFile(`assets/${name}`)
}
console.log('icons written to assets/')
