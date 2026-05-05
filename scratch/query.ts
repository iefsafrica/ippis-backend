import { Pool } from "pg";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
    const query = process.argv[2];
    if (!query) {
        console.error("Please provide a query as an argument.");
        process.exit(1);
    }
    try {
        const result = await pool.query(query);
        console.log(JSON.stringify(result.rows, null, 2));
    } catch (e) {
        console.error("Error executing query:", e);
    } finally {
        await pool.end();
    }
}

main();
