const { createClient } = require('@supabase/supabase-js');
const url = "https://heoarxriyxlrqbowtnsb.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhlb2FyeHJpeXhscnFib3d0bnNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MDM1ODYsImV4cCI6MjEwMjE3OTU4Nn0.uyaW9w8KOHVBUSnpPyxKGZnvEkU7CXgicxn62uYUkBM";
const supabase = createClient(url, key);

async function check() {
  const { data, error } = await supabase
    .from('anyo_category_sessions')
    .select('status')
    .limit(1);
    
  if (error) {
    console.error(`Error:`, error.message);
  } else {
    console.log(`Success:`, data);
  }
}
check();
