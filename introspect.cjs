const { Client } = require('pg');
const url = "postgresql://postgres.heoarxriyxlrqbowtnsb:uyaW9w8KOHVBUSnpPyxKGZnvEkU7CXgicxn62uYUkBM@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres";

async function run() {
  const client = new Client({ connectionString: url });
  await client.connect();

  console.log("=== ENUMS ===");
  const enums = await client.query(`
    SELECT t.typname, e.enumlabel
    FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname IN ('anyo_performance_status', 'anyo_session_status')
    ORDER BY t.typname, e.enumsortorder;
  `);
  console.log(enums.rows);

  console.log("=== COLUMNS ===");
  const cols = await client.query(`
    SELECT column_name, data_type, is_nullable
    FROM information_schema.columns
    WHERE table_name = 'anyo_performances' AND column_name IN ('checked_in_at', 'checked_in_by');
  `);
  console.log(cols.rows);

  console.log("=== FOREIGN KEYS ===");
  const fks = await client.query(`
    SELECT
        tc.table_schema, 
        tc.constraint_name, 
        tc.table_name, 
        kcu.column_name, 
        ccu.table_schema AS foreign_table_schema,
        ccu.table_name AS foreign_table_name,
        ccu.column_name AS foreign_column_name 
    FROM 
        information_schema.table_constraints AS tc 
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_name='anyo_performances';
  `);
  console.log(fks.rows);
  
  console.log("=== AUDIT TABLE ===");
  const audit_table = await client.query(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'system_audit_logs';
  `);
  console.log(audit_table.rows);

  console.log("=== RPCs ===");
  const rpcs = await client.query(`
    SELECT proname, prosrc 
    FROM pg_proc 
    WHERE proname IN ('mark_anyo_performer_checked_in', 'call_anyo_performer')
      AND pronamespace = (SELECT oid FROM pg_namespace WHERE nspname = 'public');
  `);
  rpcs.rows.forEach(r => {
    console.log(`\n--- RPC: ${r.proname} ---`);
    console.log(r.prosrc);
  });

  await client.end();
}
run().catch(console.error);
