const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env.local' });

// We already extracted these from `env`:
const url = "https://heoarxriyxlrqbowtnsb.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhlb2FyeHJpeXhscnFib3d0bnNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MDM1ODYsImV4cCI6MjEwMjE3OTU4Nn0.uyaW9w8KOHVBUSnpPyxKGZnvEkU7CXgicxn62uYUkBM";

const supabase = createClient(url, key);

async function check() {
  const { data, error } = await supabase
    .from('anyo_performances')
    .select('status, checked_in_at')
    .limit(1);
    
  if (error) {
    console.error('Error selecting checked_in_at:', error.message);
  } else {
    console.log('Success selecting checked_in_at:', data);
  }

  const { data: data2, error: error2 } = await supabase
    .from('system_audit_logs')
    .select('actor_role')
    .limit(1);

  if (error2) {
    console.error('Error system_audit_logs:', error2.message);
  } else {
    console.log('Success system_audit_logs:', data2);
  }
}
check();
