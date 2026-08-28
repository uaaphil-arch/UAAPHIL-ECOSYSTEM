const https = require('https');
const url = "https://heoarxriyxlrqbowtnsb.supabase.co/rest/v1/?apikey=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhlb2FyeHJpeXhscnFib3d0bnNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MDM1ODYsImV4cCI6MjEwMjE3OTU4Nn0.uyaW9w8KOHVBUSnpPyxKGZnvEkU7CXgicxn62uYUkBM";

https.get(url, (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const schemas = json.definitions || (json.components && json.components.schemas) || {};
    
    console.log("=== ENUMS ===");
    if(schemas.anyo_performances) {
       console.log("anyo_performance_status enum:", schemas.anyo_performances.properties.status.enum);
       console.log("checked_in_at:", !!schemas.anyo_performances.properties.checked_in_at);
       console.log("checked_in_by:", !!schemas.anyo_performances.properties.checked_in_by);
    }
    
    if(schemas.anyo_category_sessions) {
       console.log("anyo_session_status enum:", schemas.anyo_category_sessions.properties.status.enum);
    }

    console.log("=== RPCS ===");
    if (json.paths) {
      console.log("mark_anyo_performer_checked_in:", !!json.paths['/rpc/mark_anyo_performer_checked_in']);
      console.log("call_anyo_performer:", !!json.paths['/rpc/call_anyo_performer']);
    }
  });
});
