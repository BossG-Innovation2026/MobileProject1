const fs = require('fs');
const PAT = process.env.SUPABASE_PAT || 'YOUR_PAT_HERE';
const URL = 'https://api.supabase.com/v1/projects/fhtmvstalbankfurfiei/database/query';
const sqlFile = process.argv[2];
const sql = fs.readFileSync(sqlFile, 'utf8');

fetch(URL, {
  method: 'POST',
  headers: { Authorization: `Bearer ${PAT}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: sql }),
}).then(async (r) => {
  const text = await r.text();
  console.log(`HTTP ${r.status}`);
  if (text) console.log(text.slice(0, 2000));
  process.exit(r.status === 200 || r.status === 201 ? 0 : 1);
}).catch((e) => { console.error(e.message); process.exit(1); });