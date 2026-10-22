import { neon } from "@neondatabase/serverless";
import dotenv from "dotenv";
import bcrypt from "bcryptjs";

dotenv.config();

const sql = neon(process.env.DATABASE_URL);

async function main() {
  const password = "ippisproject";
  const salt = await bcrypt.genSalt(10);
  const passwordHash = await bcrypt.hash(password, salt);

  console.log("Password hash generated successfully.");

  // 1. Update registration IPPIS-0169 to approved
  await sql`
    UPDATE registrations 
    SET status = 'approved', approved_at = NOW(), current_step = 'completed'
    WHERE registration_id = 'IPPIS-0169'
  `;
  console.log("Registration IPPIS-0169 set to approved.");

  // 2. Update EMP66538 in employees
  await sql`
    UPDATE employees 
    SET name = 'Chukwuebuka Akpu',
        status = 'active',
        registration_id = 'IPPIS-0169',
        department = 'Finance',
        position = 'Full Stack Developer',
        updated_at = NOW()
    WHERE id = 'EMP66538'
  `;
  console.log("Updated employee EMP66538.");

  // 3. Upsert employee IPPIS-0169 with email samxsalve$1@gmail.com
  await sql`
    INSERT INTO employees (id, name, email, department, position, status, join_date, registration_id, created_at, updated_at)
    VALUES ('IPPIS-0169', 'Chukwuebuka Akpu', 'samxsalve$1@gmail.com', 'Finance', 'Full Stack Developer', 'active', '2025-08-25', 'IPPIS-0169', NOW(), NOW())
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name,
      email = EXCLUDED.email,
      department = EXCLUDED.department,
      position = EXCLUDED.position,
      status = 'active',
      registration_id = 'IPPIS-0169',
      updated_at = NOW()
  `;
  console.log("Upserted employee IPPIS-0169.");

  // 4. Employee accounts for both EMP66538 and IPPIS-0169
  for (const empId of ['EMP66538', 'IPPIS-0169']) {
    await sql`
      INSERT INTO employee_accounts (employee_id, password_hash, status, token_version, created_at, updated_at)
      VALUES (${empId}, ${passwordHash}, 'active', 0, NOW(), NOW())
      ON CONFLICT (employee_id) DO UPDATE SET
        password_hash = EXCLUDED.password_hash,
        status = 'active',
        updated_at = NOW()
    `;
    console.log(`Upserted employee_accounts for ${empId}.`);
  }

  // 5. Admin users for both samxsalve$1@gmail.com and samxsalve1@gmail.com
  for (const email of ['samxsalve$1@gmail.com', 'samxsalve1@gmail.com']) {
    const staffId = email.includes('$') ? 'IPPIS-0169' : 'EMP66538';
    
    // Check if already in admin_users
    const existing = await sql`SELECT id FROM admin_users WHERE email = ${email}`;
    let adminId;
    if (existing.length > 0) {
      adminId = existing[0].id;
      await sql`
        UPDATE admin_users 
        SET password_hash = ${passwordHash},
            role = 'admin',
            is_active = true,
            status = 'active',
            staff_id = ${staffId},
            full_name = 'Chukwuebuka Akpu',
            updated_at = NOW()
        WHERE id = ${adminId}
      `;
      console.log(`Updated admin_users for ${email} (ID: ${adminId}).`);
    } else {
      const ins = await sql`
        INSERT INTO admin_users (username, email, password_hash, full_name, role, is_active, status, staff_id, created_at, updated_at)
        VALUES (${email}, ${email}, ${passwordHash}, 'Chukwuebuka Akpu', 'admin', true, 'active', ${staffId}, NOW(), NOW())
        RETURNING id
      `;
      adminId = ins[0].id;
      console.log(`Inserted admin_users for ${email} (ID: ${adminId}).`);
    }

    // Assign role_id 16 (employee) and role_id 3 (admin)
    for (const rId of [16, 3]) {
      await sql`
        INSERT INTO user_roles (user_id, role_id, scope_level, assigned_at)
        VALUES (${String(adminId)}, ${rId}, 'self', NOW())
        ON CONFLICT DO NOTHING
      `;
    }
  }

  console.log("All accounts created / updated successfully!");
}

main().catch(console.error);
