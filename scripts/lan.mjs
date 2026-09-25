import { execSync } from 'node:child_process';
import net from 'node:net';
import os from 'node:os';

const port = Number(process.env.PORT ?? 4000);

function lanHostname() {
  if (process.platform === 'darwin') {
    try {
      const name = execSync('scutil --get LocalHostName', { encoding: 'utf8' }).trim();
      if (name) return `${name}.local`;
    } catch {
      // fall through
    }
  }
  const hostname = os.hostname();
  return hostname.includes('.') ? hostname.split('.')[0] : `${hostname}.local`;
}

function lanIp() {
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (name.toLowerCase().startsWith('lo')) continue;
    for (const a of addrs ?? []) {
      if (a.family === 'IPv4' && !a.internal) return a.address;
    }
  }
  return null;
}

function isListening() {
  return new Promise((resolve) => {
    const socket = net.connect({ host: '127.0.0.1', port }, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
    socket.setTimeout(600, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

const hostname = lanHostname();
const ip = lanIp();
const up = await isListening();

console.log('MatchCorePH — LAN access URLs');
console.log(`  Laptop:   http://localhost:${port}/`);
console.log(`  Phones:   http://${hostname}:${port}/   (works with any router/IP)`);
if (ip) console.log(`  Fallback: http://${ip}:${port}/   (changes if the IP changes)`);
console.log('');
if (up) {
  console.log(`✔ Server is listening on port ${port}.`);
} else {
  console.log(`✖ Nothing is listening on port ${port}. Start it with:`);
  console.log(`    npm run start`);
}