const { createClient } = require('@supabase/supabase-js');
const url = "https://heoarxriyxlrqbowtnsb.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhlb2FyeHJpeXhscnFib3d0bnNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MDM1ODYsImV4cCI6MjEwMjE3OTU4Nn0.uyaW9w8KOHVBUSnpPyxKGZnvEkU7CXgicxn62uYUkBM";
const supabase = createClient(url, key);

async function run() {
  console.log("Testing anyo_performance_status = CHECKED_IN...");
  const p1 = await supabase.from('anyo_performances').select('id, status, checked_in_at, checked_in_by').eq('status', 'CHECKED_IN').limit(1);
  if (p1.error) {
    console.log("Error querying CHECKED_IN:", p1.error.message);
  } else {
    console.log("Success! Columns exist and CHECKED_IN is a valid enum.");
  }

  console.log("Testing invalid anyo_session_status = COMPLETED...");
  const s1 = await supabase.from('anyo_category_sessions').select('id, status').eq('status', 'COMPLETED').limit(1);
  if (s1.error) {
    console.log("Error querying COMPLETED:", s1.error.message);
  } else {
    console.log("COMPLETED is valid?!", s1.data);
  }
}
run();
