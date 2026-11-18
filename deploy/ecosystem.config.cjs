// pm2 processes for Quick Spicy (new.quickspicy.in / api-new.quickspicy.in).
//
//   pm2 start deploy/ecosystem.config.cjs && pm2 save
//
// The server's system Node is 20 (the older Quick Spicy app runs on it) and
// this backend needs Node >= 22, so every process names its interpreter
// explicitly. That also means fork mode: cluster mode ignores `interpreter`
// and would run under pm2's own Node 20.
//
// The file name matters: pm2 only reads a process list from *.config.cjs;
// any other name is started as a plain script.
const path = require('node:path')

const BACKEND = path.join(__dirname, '..', 'Backend')
const NODE22 = process.env.QS_NODE || '/opt/node22/bin/node'
const common = { cwd: BACKEND, interpreter: NODE22, exec_mode: 'fork', instances: 1, autorestart: true }

module.exports = {
  apps: [
    {
      ...common,
      name: 'nq-api',
      script: 'server.js',
      max_memory_restart: '500M',
      env: {
        PORT: 5100,
        SOCKET_PORT: 5101,
        // The scheduler process owns cron jobs; the API must not run them too.
        SERVER_BACKGROUND_JOBS_ENABLED: 'false',
        SERVER_QUEUE_BOOTSTRAP_ENABLED: 'false',
      },
    },
    {
      ...common,
      name: 'nq-socket',
      script: 'socket-server.js',
      max_memory_restart: '350M',
      env: { SOCKET_PORT: 5101 },
    },
    {
      ...common,
      name: 'nq-scheduler',
      script: 'scripts/run-scheduled-jobs.js',
      max_memory_restart: '300M',
    },
    {
      // Runs the delayed order jobs: a rider's offer running out (next rider
      // gets it) and a restaurant not accepting in time. Needs
      // BULLMQ_ENABLED=true in Backend/.env. Without it those jobs are never
      // queued and only the scheduler's 5-minute watchdog moves stuck orders.
      ...common,
      name: 'nq-worker',
      script: 'src/queues/workers/order.worker.js',
      max_memory_restart: '300M',
    },
  ],
}
