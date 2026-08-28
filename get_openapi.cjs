const https = require('https');
https.get("https://heoarxriyxlrqbowtnsb.supabase.co/rest/v1/?apikey=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhlb2FyeHJpeXhscnFib3d0bnNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MDM1ODYsImV4cCI6MjEwMjE3OTU4Nn0.uyaW9w8KOHVBUSnpPyxKGZnvEkU7CXgicxn62uYUkBM", (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    console.log("== anyo_performances properties ==");
    console.log(Object.keys(json.definitions.anyo_performances.properties));
    console.log("== system_audit_logs properties ==");
    console.log(Object.keys(json.definitions.system_audit_logs.properties));
    console.log("== Enums ==");
    const props = json.definitions.anyo_performances.properties;
    console.log("anyo_performances.status enum:", props.status.enum);
    console.log("anyo_category_sessions.status enum:", json.definitions.anyo_category_sessions.properties.status.enum);
  });
});
