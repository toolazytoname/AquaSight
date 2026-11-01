// Fetch same-origin public assets through the binding: a Worker subrequest to
// its own routed hostname can fail/loop. Never dispatch an imported URL to API
// handlers or forward an account's authentication headers.
export function createImportFetch(origin, assets, networkFetch = fetch) {
  return async (input, init = {}) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    const method = (init.method || 'GET').toUpperCase();
    if (url.origin === origin && assets?.fetch && (method === 'GET' || method === 'HEAD')) {
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return new Response('Not a public asset', { status: 404 });
      }
      // The import layer already enforces DNS/SSRF, timeout, redirect and size
      // limits. Only public static assets are resolved here.
      return assets.fetch(new Request(url, { method, signal: init.signal, redirect: 'manual' }));
    }
    return networkFetch(input, init);
  };
}
