import { Pool } from "pg";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function main() {
    try {
        const sql = fs.readFileSync(path.join(__dirname, "alter-tables.sql"), "utf-8");
        await pool.query(sql);
        console.log("Alter tables script executed successfully!");
    } catch (e) {
        console.error("Error executing schema:", e);
    } finally {
        await pool.end();
    }
}

main();
