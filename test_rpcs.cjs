const { createClient } = require('@supabase/supabase-js');
const url = "https://heoarxriyxlrqbowtnsb.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhlb2FyeHJpeXhscnFib3d0bnNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MDM1ODYsImV4cCI6MjEwMjE3OTU4Nn0.uyaW9w8KOHVBUSnpPyxKGZnvEkU7CXgicxn62uYUkBM";
const supabase = createClient(url, key);

async function run() {
  console.log("Testing mark_anyo_performer_checked_in via RPC...");
  const rpc1 = await supabase.rpc('mark_anyo_performer_checked_in', { p_performance_id: '00000000-0000-0000-0000-000000000000' });
  console.log("RPC 1 Response:", rpc1.error ? rpc1.error.message : rpc1.data);

  console.log("Testing call_anyo_performer via RPC...");
  const rpc2 = await supabase.rpc('call_anyo_performer', { p_performance_id: '00000000-0000-0000-0000-000000000000' });
  console.log("RPC 2 Response:", rpc2.error ? rpc2.error.message : rpc2.data);
}
run();
