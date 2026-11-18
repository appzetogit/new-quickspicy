# Deploying Quick Spicy

| Host | Serves | Backed by |
| --- | --- | --- |
| `new.quickspicy.in` | web app (SPA) | static build in `/srv/new-quick/web` |
| `api-new.quickspicy.in` | API, Socket.IO, uploads | pm2 `nq-api` (5100), `nq-socket` (5101), `nq-scheduler`, `nq-worker` |

Same server as the older Quick Spicy app (`ssh quickspicy-srv`). The two share
nginx and Redis and nothing else: this one has its own PostgreSQL database
(`newquick`), its own Node 22 in `/opt/node22`, its own folder
(`/var/www/new-quick`) and its own pm2 names (`nq-*`).

DNS: A records `new` and `api-new` → the server, in Hostinger hPanel.

**Database time zone must be UTC for the app's role.** This server's
PostgreSQL runs in `Asia/Kolkata`; Prisma stores times as UTC, and raw SQL read
fresh rider GPS as 5½ hours old, so auto dispatch offered orders to nobody.
Set once per server (done here 2026-11-18), then restart the API:

    sudo -u postgres psql -c "ALTER ROLE newquick SET timezone TO 'UTC';"

The API logs an error at startup if the session is not UTC.

## Before every deploy

GitHub repositories in this organisation have repeatedly had a loader pushed
into `Frontend/vite.config.js`, plus `Backend/init` / `Frontend/init` and a
`node init &&` prefix on the npm scripts. The build runs it. Check first:

    git grep -nE "_0x[0-9a-f]{4,}|node init|\(global, ?require\)" -- . ; echo "exit $? (1 = clean)"
    ls Backend/init Frontend/init 2>/dev/null

## Backend

    cd /var/www/new-quick/Backend
    PATH=/opt/node22/bin:$PATH npm ci
    PATH=/opt/node22/bin:$PATH npm run db:migrate     # all three steps, never just `migrate deploy`
    pm2 reload nq-api nq-socket nq-scheduler nq-worker

First time only: `pm2 start /var/www/new-quick/deploy/ecosystem.config.cjs && pm2 save`.

`Backend/.env` needs `BULLMQ_ENABLED=true` (Redis is already on through
`REDIS_URL`). `nq-worker` runs the delayed order jobs: a rider offer that runs
out goes to the next rider within seconds instead of waiting for the 5-minute
watchdog.

`Backend/.env` lives on the server only. Production mode (`NODE_ENV=production`)
refuses to start without Razorpay, SMS and Firebase credentials. Each can be
an env var or saved in the admin panel instead: 3rd Party → Razorpay (key id,
secret, webhook secret, switched on), 3rd Party → SMS India Hub or Twilio, and
the Firebase page (service account + Realtime Database URL, which also turns on
server-side live tracking). Until those exist it runs as `NODE_ENV=staging`,
where every OTP is 1234. Going live: save the keys, set `NODE_ENV=production`
and `USE_DEFAULT_OTP=false`, then `pm2 reload nq-api nq-socket nq-scheduler nq-worker --update-env`.

## Frontend

`Frontend/.env.production` (server only):

    VITE_API_BASE_URL=https://api-new.quickspicy.in/api/v1
    VITE_UPLOAD_BASE_URL=https://api-new.quickspicy.in/uploads

Then:

    PATH=/opt/node22/bin:$PATH deploy/scripts/deploy-frontend.sh

It keeps the previous build's hashed chunks so tabs that are already open
don't break on their next lazy route.

## nginx

`deploy/nginx/new-quick.conf` → `/etc/nginx/sites-available/`, symlinked into
`sites-enabled`, then `certbot --nginx -d new.quickspicy.in -d api-new.quickspicy.in`.

## Apt on this server

Use `NEEDRESTART_MODE=l apt-get install …`. A plain install lets needrestart
restart services, including the older app's MongoDB.
