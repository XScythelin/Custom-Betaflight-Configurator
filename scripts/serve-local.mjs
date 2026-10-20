import http from 'node:http';
import { createReadStream, existsSync, realpathSync, statSync } from 'node:fs';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = realpathSync(fileURLToPath(new URL('../src/dist/', import.meta.url)));
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2', '.wasm': 'application/wasm' };
http.createServer((req, res) => {
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
