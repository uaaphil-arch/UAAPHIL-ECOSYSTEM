const https = require('https');
https.get("https://heoarxriyxlrqbowtnsb.supabase.co/rest/v1/?apikey=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhlb2FyeHJpeXhscnFib3d0bnNiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY2MDM1ODYsImV4cCI6MjEwMjE3OTU4Nn0.uyaW9w8KOHVBUSnpPyxKGZnvEkU7CXgicxn62uYUkBM", (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const json = JSON.parse(data);
    console.log("== Definitions keys ==");
    if(json.definitions) {
      console.log(Object.keys(json.definitions).filter(k => k.includes('anyo')));
      if(json.definitions.anyo_performances) {
         console.log("anyo_performances:", json.definitions.anyo_performances.properties.status.enum);
         console.log("checked_in_at:", !!json.definitions.anyo_performances.properties.checked_in_at);
      }
      if(json.definitions.anyo_category_sessions) {
         console.log("anyo_category_sessions:", json.definitions.anyo_category_sessions.properties.status.enum);
      }
    } else {
      console.log("No definitions object found.");
    }
  });
});
