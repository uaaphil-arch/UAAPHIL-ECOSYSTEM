const { createClient } = require('@supabase/supabase-js');
const url = "https://heoarxriyxlrqbowtnsb.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhlb2FyeHJpeXhscnFib3d0bnNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MDM1ODYsImV4cCI6MjEwMjE3OTU4Nn0.uyaW9w8KOHVBUSnpPyxKGZnvEkU7CXgicxn62uYUkBM";
const supabase = createClient(url, key);

async function check(state) {
  const { data, error } = await supabase
    .from('anyo_category_sessions')
    .select('status')
    .eq('status', state)
    .limit(1);
    
  if (error) {
    console.error(`Error for ${state}:`, error.message);
  } else {
    console.log(`Success for ${state}`);
  }
}

async function run() {
  await check('FINALIZED');
  await check('COMPLETED');
  await check('PAUSED');
  await check('PENDING');
  await check('SCHEDULED');
  await check('IN_PROGRESS');
}
run();
