AquaSight / Ya Xian Zhi

## Local
Need Node 20+.
npm test
node src/run.js --once
python3 -m http.server 8765
Open http://127.0.0.1:8765/web/
node src/run.js --once --dry-run
Copy .env.example to .env. BARK_KEY in env only.

## GitHub Secret (Bark)
Settings -> Secrets and variables -> Actions
New secret BARK_KEY (device key only). Do not put the key in the repo.
Workflow every 20 minutes + workflow_dispatch.

## GitHub Pages
Run collect workflow once (pushes gh-pages).
Settings -> Pages -> Deploy from a branch.
Branch gh-pages, folder /.
https://toolazytoname.github.io/AquaSight/
Page reads ./events.json copied from data/events.json, not the embedded sample.
