const https = require('https');
https.get("https://heoarxriyxlrqbowtnsb.supabase.co/rest/v1/?apikey=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhlb2FyeHJpeXhscnFib3d0bnNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MDM1ODYsImV4cCI6MjEwMjE3OTU4Nn0.uyaW9w8KOHVBUSnpPyxKGZnvEkU7CXgicxn62uYUkBM", (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    const schemas = json.definitions || (json.components && json.components.schemas);
    if(schemas) {
      if(schemas.anyo_performances) {
         console.log("anyo_performances status:", schemas.anyo_performances.properties.status.enum);
         console.log("checked_in_at exists:", !!schemas.anyo_performances.properties.checked_in_at);
         console.log("checked_in_by exists:", !!schemas.anyo_performances.properties.checked_in_by);
      }
      if(schemas.anyo_category_sessions) {
         console.log("anyo_category_sessions status:", schemas.anyo_category_sessions.properties.status.enum);
      }
      if(schemas.system_audit_logs) {
         console.log("system_audit_logs columns:", Object.keys(schemas.system_audit_logs.properties));
      }
      if (json.paths) {
        console.log("Paths contain mark_anyo_performer_checked_in:", !!json.paths['/rpc/mark_anyo_performer_checked_in']);
        console.log("Paths contain call_anyo_performer:", !!json.paths['/rpc/call_anyo_performer']);
      }
    } else {
      console.log("No schemas object found.", Object.keys(json));
    }
  });
});
