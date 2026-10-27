import { spawn } from 'node:child_process';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { validateNumberedHymnMapping } from './hymn-catalog-lib.mjs';

export const ADMIN_PATH = '/admin/hymns';
const mappingsPath = fileURLToPath(new URL('./hymn-number-mappings.json', import.meta.url));
const pagePath = fileURLToPath(new URL('./hymn-admin.html', import.meta.url));
const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const HYMNALS = ['unmapped', 'UMH1989', 'TFWS2000'];
const TASKS = {
  'rescan': 'scripts/find-hymn-candidates.mjs',
  'update-catalog': 'scripts/update-hymns.mjs',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Serializes read-modify-write cycles so concurrent saves cannot clobber each other.
let queue = Promise.resolve();
const exclusive = task => (queue = queue.then(task, task));

const readMappings = async () => JSON.parse(await readFile(mappingsPath, 'utf8'));

export async function listUnmapped() {
  return (await readMappings()).filter(row => row.hymnal === 'unmapped')
    .map(({ reference, title, tune, number }) => ({ reference, title, tune: tune ?? '', number: number ?? '' }));
}

export function saveMapping(input) {
  return exclusive(async () => {
    const field = name => (typeof input?.[name] === 'string' ? input[name].trim() : '');
    const [reference, hymnal, number, tune, title] = ['reference', 'hymnal', 'number', 'tune', 'title'].map(field);
    if (!HYMNALS.includes(hymnal)) throw new HttpError(400, `Unsupported hymnal "${hymnal}".`);
    if (!title) throw new HttpError(400, 'Title is required.');
    const mappings = await readMappings();
    const row = mappings.find(item => item.hymnal === 'unmapped' && String(item.reference) === reference);
    if (!row) throw new HttpError(404, `No unmapped hymn with source reference ${reference}.`);
    if (hymnal !== 'unmapped') {
      try { validateNumberedHymnMapping({ hymnal, number, reference, title, tune }); }
      catch (error) { throw new HttpError(400, error.message); }
      if (mappings.some(item => item !== row && item.hymnal === hymnal && item.number === number))
        throw new HttpError(409, `${hymnal} ${number} is already mapped.`);
    } else if (number) throw new HttpError(400, 'Choose UMH1989 or TFWS2000 to save a hymn number.');
    Object.assign(row, { hymnal, number, tune, title });
    const temporary = `${mappingsPath}.tmp`;
    await writeFile(temporary, JSON.stringify(mappings, null, 2) + '\n', 'utf8');
    await rename(temporary, mappingsPath);
    return { saved: row };
  });
}

let running = null;
function runTask(name) {
  if (running) throw new HttpError(409, `"${running}" is still running.`);
  running = name;
  return new Promise(resolve => {
    let output = '';
    const child = spawn(process.execPath, [TASKS[name]], { cwd: projectRoot });
    const timer = setTimeout(() => child.kill(), 5 * 60 * 1000);
    const collect = chunk => { output = (output + chunk).slice(-20000); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    const finish = (ok, extra = '') => { clearTimeout(timer); running = null; resolve({ ok, output: output + extra }); };
    child.on('error', error => finish(false, String(error)));
    child.on('close', code => finish(code === 0));
  });
}

const sendJSON = (response, status, body) => {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.end(JSON.stringify(body));
};

const readBody = request => new Promise((resolve, reject) => {
  let body = '';
  request.on('data', chunk => { body += chunk; if (body.length > 100000) request.destroy(); });
  request.on('end', () => { try { resolve(body ? JSON.parse(body) : {}); } catch { reject(new HttpError(400, 'Invalid JSON.')); } });
  request.on('error', reject);
});

// The API writes project files and runs scripts, so only accept same-origin requests from localhost.
function assertLocalRequest(request) {
  const local = value => /^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(value ?? '');
  const origin = request.headers.origin;
  if (!local(request.headers.host) || (origin && !local(origin.replace(/^https?:\/\//, ''))))
    throw new HttpError(403, 'The hymn editor accepts only local requests.');
}

export async function handleAdminRequest(request, response) {
  try {
    assertLocalRequest(request);
    const route = new URL(request.url, 'http://localhost').pathname.slice(ADMIN_PATH.length).replace(/\/+$/, '');
    if (request.method === 'GET' && route === '') {
      response.setHeader('Content-Type', 'text/html; charset=utf-8');
      return response.end(await readFile(pagePath, 'utf8'));
    }
    if (request.method === 'GET' && route === '/api/unmapped') return sendJSON(response, 200, { hymns: await listUnmapped(), busy: running });
    if (request.method === 'POST' && route === '/api/save') return sendJSON(response, 200, await saveMapping(await readBody(request)));
    const task = route.match(/^\/api\/(rescan|update-catalog)$/)?.[1];
    if (request.method === 'POST' && task) return sendJSON(response, 200, await runTask(task));
    throw new HttpError(404, 'Not found.');
  } catch (error) {
    sendJSON(response, error.status ?? 500, { error: error.message });
  }
}

// Dev-server only: the production build stays fully static.
export function hymnAdminPlugin() {
  return {
    name: 'hymn-admin',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = request.url?.split('?')[0] ?? '';
        if (path === ADMIN_PATH || path.startsWith(`${ADMIN_PATH}/`)) {
          if (path === ADMIN_PATH) { response.statusCode = 302; response.setHeader('Location', `${ADMIN_PATH}/`); return response.end(); }
          return handleAdminRequest(request, response);
        }
        next();
      });
    },
  };
}
