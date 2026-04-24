import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
dotenv.config();

const sql = neon(process.env.DATABASE_URL!);

async function checkColumns() {
  try {
    const result = await sql`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'employees'
    `;
    console.log("Columns in 'employees' table:", result.map(r => r.column_name));
  } catch (error) {
    console.error("Error checking columns:", error);
  }
}

checkColumns();
