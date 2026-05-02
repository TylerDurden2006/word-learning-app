const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { URL } = require('node:url');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function convexUrl() {
  const value = String(
    process.env.CONVEX_HTTP_URL
    || process.env.WORDFORGE_CONVEX_URL
    || process.env.CONVEX_URL
    || ''
  ).trim();
  return value.replace(/\/+$/, '');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(JSON.stringify(payload));
}

function sendError(res, statusCode, code, message) {
  sendJson(res, statusCode, {
    error: {
      code,
      message,
      details: null
    }
  });
}

function serveStaticFile(res, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.join(PUBLIC_DIR, requestedPath);
  const normalized = path.normalize(filePath);

  if (!normalized.startsWith(PUBLIC_DIR)) {
    return false;
  }

  if (!fs.existsSync(normalized) || fs.statSync(normalized).isDirectory()) {
    const indexPath = path.join(PUBLIC_DIR, 'index.html');
    if (!fs.existsSync(indexPath)) return false;
    res.writeHead(200, { 'content-type': MIME_TYPES['.html'] });
    res.end(renderIndex(indexPath));
    return true;
  }

  const ext = path.extname(normalized).toLowerCase();
  res.writeHead(200, { 'content-type': MIME_TYPES[ext] || 'application/octet-stream' });
  if (path.basename(normalized) === 'index.html') {
    res.end(renderIndex(normalized));
    return true;
  }
  fs.createReadStream(normalized).pipe(res);
  return true;
}

function renderIndex(indexPath) {
  const configuredConvexUrl = convexUrl();
  const html = fs.readFileSync(indexPath, 'utf8');
  if (!configuredConvexUrl) return html;
  return html.replace(
    /<meta name="wordforge-api-base" content="[^"]*" \/>/,
    `<meta name="wordforge-api-base" content="${configuredConvexUrl}" />`
  );
}

async function proxyApiRequest(req, res, url) {
  const targetBase = convexUrl();
  if (!targetBase) {
    sendError(
      res,
      503,
      'CONVEX_NOT_CONFIGURED',
      'Set CONVEX_URL or WORDFORGE_CONVEX_URL so WordForge can use Convex as its database.'
    );
    return true;
  }

  const target = new URL(`${url.pathname}${url.search}`, targetBase);
  const headers = new Headers(req.headers);
  headers.delete('host');
  headers.delete('connection');
  headers.delete('content-length');

  const response = await fetch(target, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : req,
    duplex: 'half'
  });

  const responseHeaders = Object.fromEntries(response.headers.entries());
  delete responseHeaders['content-encoding'];
  delete responseHeaders['content-length'];
  delete responseHeaders['transfer-encoding'];
  res.writeHead(response.status, responseHeaders);
  if (!response.body) {
    res.end();
    return true;
  }

  const reader = response.body.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(Buffer.from(value));
    }
    res.end();
  } catch (error) {
    res.destroy(error);
  }
  return true;
}

function createServer() {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname.startsWith('/api/')) {
        await proxyApiRequest(req, res, url);
        return;
      }
      if (serveStaticFile(res, url.pathname)) return;
      sendError(res, 404, 'NOT_FOUND', 'Not found.');
    } catch (error) {
      sendError(res, 500, 'SERVER_ERROR', error.message || 'Unexpected server error.');
    }
  });
}

if (require.main === module) {
  createServer().listen(PORT, () => {
    const target = convexUrl() || 'not configured';
    console.log(`WordForge running on http://localhost:${PORT}`);
    console.log(`Convex API target: ${target}`);
  });
}

module.exports = {
  createServer
};
