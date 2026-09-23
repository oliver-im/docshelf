import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHmac, randomBytes } from 'node:crypto';
import path from 'node:path';
import { parse, serialize, type DefaultTreeAdapterTypes } from 'parse5';
import { ASSET_TYPES } from './catalog';
import { readBoundedFile } from './files';
import { MAX_ASSET_BYTES, MAX_DOCUMENT_BYTES, artifactRoots, type Artifact, type Catalog } from './types';

export class DocumentServer {
  private server: Server | null = null;
  private token = randomBytes(32).toString('hex');
  private catalog: Catalog | null = null;
  private scripts = true;
  origin = '';

  setCatalog(catalog: Catalog | null, scripts = true): void { this.catalog = catalog; this.scripts = scripts; }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((request, response) => { void this.handle(request, response); });
    this.server = server;
    server.requestTimeout = 10_000;
    server.headersTimeout = 10_000;
    server.maxHeadersCount = 40;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Could not start the document viewer.');
    this.origin = `http://127.0.0.1:${address.port}`;
  }

  async close(): Promise<void> {
    const server = this.server;
    this.server = null;
    this.catalog = null;
    this.origin = '';
    if (!server) return;
    await new Promise<void>(resolve => { server.close(() => resolve()); server.closeAllConnections(); });
  }

  documentUrl(artifact: Artifact): string {
    return `${this.origin}/${this.capability('read', artifact.id)}/d/${artifact.id}/${encodeURIComponent(path.basename(artifact.sourcePath || 'index.html'))}`;
  }

  assetUrl(artifact: Artifact, asset: string): string {
    return `${this.origin}/${this.capability('read', artifact.id)}/d/${artifact.id}/${asset.split('/').map(encodeURIComponent).join('/')}`;
  }

  navigationUrl(artifact: Artifact, hash = ''): string {
    return `${this.origin}/${this.capability('open', artifact.id)}/open/${artifact.id}${hash}`;
  }

  // Report URLs grant access to just that document and its registered assets.
  // Navigation links carry a different capability and never grant file reads.
  private capability(kind: 'read' | 'open', id: string): string {
    return createHmac('sha256', this.token).update(`${kind}:${id}`).digest('hex');
  }

  navigationTarget(url: string): { artifact: Artifact; hash: string } | null {
    let parsed: URL;
    try { parsed = new URL(url); } catch { return null; }
    if (parsed.origin !== this.origin) return null;
    const match = /^\/([a-f0-9]{64})\/open\/([a-f0-9]{24})$/.exec(parsed.pathname);
    if (!match || match[1] !== this.capability('open', match[2])) return null;
    const artifact = this.catalog?.artifacts.find(item => item.id === match[2]);
    return artifact ? { artifact, hash: parsed.hash } : null;
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const finish = (status: number, body: string) => {
      response.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : body);
    };
    try {
      if (!this.origin || request.headers.host !== new URL(this.origin).host) { finish(403, 'Forbidden'); return; }
      if (!['GET', 'HEAD'].includes(request.method || '')) { finish(405, 'Read-only server'); return; }
      if (request.headers.origin && request.headers.origin !== this.origin) { finish(403, 'Forbidden'); return; }
      const url = new URL(request.url || '/', this.origin);
      if (url.origin !== this.origin) { finish(404, 'Not found'); return; }
      const navigation = this.navigationTarget(url.href);
      if (navigation) { finish(200, 'Opening registered document…'); return; }
      const match = /^\/([a-f0-9]{64})\/d\/([a-f0-9]{24})\/(.+)$/.exec(url.pathname);
      if (!match || match[1] !== this.capability('read', match[2])) { finish(404, 'Not found'); return; }
      const catalog = this.catalog;
      const artifact = catalog?.artifacts.find(item => item.id === match[2]);
      if (!artifact?.sourcePath || !catalog || !match) { finish(404, 'Not found'); return; }
      const relative = decodeURIComponent(match[3]);
      const document = relative === path.basename(artifact.sourcePath);
      if (!document && !artifact.assets?.includes(relative)) { finish(404, 'Asset is not registered'); return; }
      if (document && artifact.kind !== 'html') { finish(404, 'Not an HTML document'); return; }
      const sourcePath = document ? artifact.sourcePath : path.resolve(path.dirname(artifact.sourcePath), relative);
      const content = await readBoundedFile(sourcePath, artifactRoots(artifact, catalog.roots), document ? MAX_DOCUMENT_BYTES : MAX_ASSET_BYTES);
      const body = document ? Buffer.from(this.rewriteHtml(content.toString('utf8'), artifact, catalog)) : content;
      const type = document ? 'text/html; charset=utf-8' : ASSET_TYPES[path.extname(relative).toLowerCase()];
      response.writeHead(200, {
        'Content-Type': type || 'application/octet-stream', 'Content-Length': body.byteLength,
        'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': document ? reportCsp(this.scripts) : "default-src 'none'; sandbox",
        'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), payment=()',
      });
      response.end(request.method === 'HEAD' ? undefined : body);
    } catch {
      if (!response.headersSent) finish(404, 'Source unavailable or outside the permitted workspace.');
      else response.destroy();
    }
  }

  private rewriteHtml(source: string, artifact: Artifact, catalog: Catalog): string {
    const document = parse(source);
    const visit = (node: DefaultTreeAdapterTypes.Node) => {
      if ('childNodes' in node) {
        node.childNodes = node.childNodes.filter(child => !('tagName' in child) || child.tagName !== 'base' && !(child.tagName === 'meta' && child.attrs.some(attr => attr.name === 'http-equiv' && attr.value.toLowerCase() === 'refresh')));
      }
      if ('tagName' in node && node.tagName === 'a') {
        // Keep authored new-tab links on the same guarded navigation path.
        // Script-created popups remain disabled by the webview and CSP.
        node.attrs = node.attrs.filter(attr => attr.name !== 'target');
        const href = node.attrs.find(attr => attr.name === 'href');
        if (href && !/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(href.value)) {
          try {
            const reference = new URL(href.value, `https://docshelf.invalid/${encodeURIComponent(path.basename(artifact.sourcePath!))}`);
            const rawPath = href.value.split(/[?#]/)[0];
            const candidate = path.resolve(path.dirname(artifact.sourcePath!), decodeURIComponent(rawPath));
            const target = catalog.artifacts.find(item => item.sourcePath === candidate || item.canonicalPath === candidate);
            if (target) href.value = this.navigationUrl(target, reference.hash);
          } catch { /* An invalid authored link stays unavailable. */ }
        }
      }
      if ('childNodes' in node) for (const child of node.childNodes) visit(child);
    };
    visit(document);
    return serialize(document);
  }
}

export function reportCsp(scripts: boolean): string {
  return [
    `sandbox${scripts ? ' allow-scripts' : ''} allow-same-origin`,
    "default-src 'none'", `script-src ${scripts ? "'self' 'unsafe-inline' https:" : "'none'"}`,
    "style-src 'self' 'unsafe-inline' https:", "img-src 'self' https: data: blob:",
    "font-src 'self' https: data:", "connect-src 'self' https:", "media-src 'self' https: blob:",
    "object-src 'none'", "frame-src 'none'", "worker-src 'none'", "base-uri 'none'", "form-action 'none'", "frame-ancestors 'none'",
  ].join('; ');
}
