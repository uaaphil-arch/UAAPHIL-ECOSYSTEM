const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.VITE_SUPABASE_URL,
  process.env.VITE_SUPABASE_ANON_KEY
);

async function check() {
  const { data, error } = await supabase
    .from('anyo_performances')
    .select('status, checked_in_at')
    .limit(1);
    
  if (error) {
    console.error('Error:', error.message);
  } else {
    console.log('Success:', data);
  }
}
check();
