import http from 'node:http';
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const root = realpathSync(fileURLToPath(new URL('../src/dist/', import.meta.url)));
let gyroRunning = false;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
http.createServer((req, res) => {
    if (req.url === '/__local_tools/gyro') {
        const origin = 'http://127.0.0.1:8080';
        if (req.method !== 'POST' || req.headers.origin !== origin || req.headers.host !== '127.0.0.1:8080' || req.headers['x-local-tool'] !== 'gyro-monitor') {
            res.writeHead(403).end();
            return;
        }
        if (process.platform !== 'win32') { res.writeHead(400).end('Gyro monitor requires Windows.'); return; }
        if (gyroRunning) { res.writeHead(409).end('Gyro monitor is already running.'); return; }
        const cwd = fileURLToPath(new URL('../tools/gyro-monitor/', import.meta.url));
        gyroRunning = true;
        const command = "$p = Start-Process -FilePath $env:ComSpec -ArgumentList '/d', '/c', 'launch.cmd' -PassThru -Wait; exit $p.ExitCode";
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { cwd, windowsHide: true, stdio: 'ignore' });
        child.once('error', () => { gyroRunning = false; if (!res.headersSent) res.writeHead(500).end('Cannot launch gyro monitor.'); });
        child.once('exit', code => { gyroRunning = false; if (!res.headersSent) res.writeHead(code === 0 ? 200 : 500, { 'Cache-Control': 'no-store' }).end(); });
        return;
    }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405).end(); return; }
    let file;
    try {
        const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
        file = resolve(root, '.' + (pathname === '/' || pathname === '/__local_build' ? '/index.html' : pathname));
        if (!file.startsWith(root + sep) || !existsSync(file)) { res.writeHead(404).end(); return; }
        file = realpathSync(file);
        if (!file.startsWith(root + sep) || !statSync(file).isFile()) { res.writeHead(404).end(); return; }
    } catch { res.writeHead(400).end(); return; }
    res.writeHead(200, { 'Content-Type': types[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
}).listen(8080, '127.0.0.1', () => console.log('Betaflight: http://127.0.0.1:8080/'));
