// Database connection with type assertion
const pg = require('pg')

if (!process.env.DATABASE_URL) {
  console.error('❌ ERROR: DATABASE_URL environment variable is missing!')
  console.error('Please ensure it is set in your Render dashboard environment variables.')
}

export const pool = new (pg as any).Pool({
  connectionString: process.env.DATABASE_URL,
})

export default pool
