import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
    try {
        const res = await pool.query("SELECT table_name FROM information_schema.columns WHERE column_name = 'registration_id'");
        console.log("Tables with registration_id:", res.rows.map(r => r.table_name));

        const res2 = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%employee%' OR table_name LIKE '%registrations%'");
        console.log("Tables related to employee/registration:", res2.rows.map(r => r.table_name));

    } catch (e) {
        console.error("Error:", e);
    } finally {
        await pool.end();
    }
}

main();
