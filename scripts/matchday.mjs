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

const host = lanHostname();
const ip = lanIp();
const listening = await isListening();
const shared = Boolean(ip && (ip.startsWith('192.168.2.') || ip.startsWith('172.20.10.')));

console.log('MatchCorePH — Match Day Check');
console.log('─'.repeat(40));

if (listening) {
  console.log(`✔ Server is listening on port ${port}.`);
} else {
  console.log(`✖ Nothing is listening on port ${port}. Start it first:`);
  console.log(`    npm run start`);
  console.log('');
  process.exitCode = 1;
}

if (shared) {
  console.log(`✔ Laptop is hosting the network (Internet Sharing) at ${ip}.`);
  console.log('  Phones:  join your shared Wi-Fi → open:');
  console.log(`  http://${ip}:${port}/`);
} else {
  console.log(`Network IP: ${ip ?? 'not found'}`);
  console.log(`  Phones:  http://${host}:${port}/   (hostname — works on any router)`);
  console.log(`  Phones:  http://${ip}:${port}/   (IP — use this if a phone can't resolve .local)`);
}

console.log('─'.repeat(40));
console.log('Match-day reminders:');
console.log('  1. Mobile data OFF on every scoring phone — a no-internet Wi-Fi otherwise');
console.log('     silently falls back to cellular and can never reach this laptop.');
console.log('  2. Phones and laptop must be on the SAME Wi-Fi (same Surf2Sawa SSID or hotspot).');
console.log('  3. If a phone cannot load the page: macOS System Settings → Network →');
console.log('     Firewall → allow incoming for node.');
console.log('  4. Keep the laptop awake and plugged in:  caffeinate -s');