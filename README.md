# Picture Voting (Netlify)
1. `npm install -g netlify-cli` then `npm install`
2. `netlify login` and `netlify init` (create/link a site)
3. Set env var: `netlify env:set ADMIN_PASSWORD "<strong password>"` (optional `EXPORT_TZ`, e.g. Asia/Riyadh)
4. `netlify deploy --prod` (the database and migration are provisioned automatically)
5. Open `/admin.html`, sign in, click "Generate 400 codes", then export the codes.
Voters use the site root `/`.
