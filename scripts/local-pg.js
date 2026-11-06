// Menyalakan PostgreSQL sementara di folder temp, untuk pengujian dan untuk
// membuat data contoh tanpa puluhan ribu query lewat internet ke Supabase.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');

const freePort = () => new Promise((resolve) => {
  const s = net.createServer().listen(0, () => {
    const { port } = s.address();
    s.close(() => resolve(port));
  });
});

async function startLocalPg() {
  const { default: EmbeddedPostgres } = await import('embedded-postgres');
  const databaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kelolatoko-pg-'));
  const port = await freePort();
  const pg = new EmbeddedPostgres({ databaseDir, port, user: 'postgres', password: 'postgres', persistent: false, onLog() {}, onError() {} });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase('kelolatoko');
  return {
    url: `postgres://postgres:postgres@localhost:${port}/kelolatoko`,
    stop: async () => {
      await pg.stop();
      fs.rmSync(databaseDir, { recursive: true, force: true });
    },
  };
}

module.exports = { startLocalPg };
