import type { MiddlewareHandler } from 'hono';

const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOCAL_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

/**
 * The server can start Claude agents, so a web page open in the browser must not
 * be able to call it. Allow only requests whose Host and Origin are local.
 * This also blocks DNS rebinding, where a remote name resolves to 127.0.0.1.
 */
export const localOnly: MiddlewareHandler = async (c, next) => {
  const host = c.req.header('host') ?? '';
  const origin = c.req.header('origin');
  if (!LOCAL_HOST.test(host)) return c.json({ error: 'Host no permitido' }, 403);
  if (origin && !LOCAL_ORIGIN.test(origin)) return c.json({ error: 'Origin no permitido' }, 403);
  const site = c.req.header('sec-fetch-site');
  if (c.req.method !== 'GET' && site && site !== 'same-origin' && site !== 'same-site' && site !== 'none') {
    return c.json({ error: 'Request cross-site no permitido' }, 403);
  }
  await next();
};
