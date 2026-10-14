import { Pool } from 'pg'

/**
 * Ensures the application role named in appUrl exists and can use the schema, but is not a superuser,
 * does not own tables and cannot bypass row-level security. Run with the owner connection after migrations.
 */
export async function ensureAppRole (ownerUrl: string, appUrl: string): Promise<void> {
    const app = new URL(appUrl)
    const owner = new URL(ownerUrl)
    const role = decodeURIComponent(app.username)
    const password = decodeURIComponent(app.password)
    if (!role || role === decodeURIComponent(owner.username)) throw new Error('The app must connect as its own role, not the owner (see .env.example)')
    if (!/^[a-z_][a-z0-9_]*$/.test(role)) throw new Error(`Unsafe role name: ${role}`)
    const ident = `"${role}"`
    const lit = (s: string) => `'${s.replace(/'/g, "''")}'`

    const pool = new Pool({ connectionString: ownerUrl, max: 1 })
    try {
        const { rows } = await pool.query<{ rolsuper: boolean, rolbypassrls: boolean }>('select rolsuper, rolbypassrls from pg_roles where rolname = $1', [role])
        if (rows.length === 0) {
            await pool.query(`create role ${ident} login password ${lit(password)} nosuperuser nocreatedb nocreaterole nobypassrls`)
        } else {
            // Managed hosts (e.g. Neon) only let real superusers touch SUPERUSER/BYPASSRLS, so verify instead of re-asserting
            if (rows[0].rolsuper || rows[0].rolbypassrls) throw new Error(`Role ${role} must not be a superuser or bypass row-level security`)
            await pool.query(`alter role ${ident} login password ${lit(password)}`)
        }
        const db = (await pool.query('select current_database() as db')).rows[0].db as string
        await pool.query(`grant connect on database "${db}" to ${ident}`)
        await pool.query(`grant usage on schema public to ${ident}`)
        await pool.query(`grant select, insert, update, delete on all tables in schema public to ${ident}`)
        await pool.query(`grant usage, select on all sequences in schema public to ${ident}`)
        await pool.query(`grant execute on all functions in schema public to ${ident}`)
        await pool.query(`alter default privileges in schema public grant select, insert, update, delete on tables to ${ident}`)
        await pool.query(`alter default privileges in schema public grant usage, select on sequences to ${ident}`)
    } finally {
        await pool.end()
    }
}
