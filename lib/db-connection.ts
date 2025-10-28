
const pg = require('pg')

export const pool = new (pg as any).Pool({
  connectionString: process.env.DATABASE_URL,
})

export default pool
