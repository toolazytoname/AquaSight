import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { isIP } from "node:net";

// Only used by the Node server's import/RSS path. Preserve the original Host
// and TLS SNI while preventing a second DNS lookup (DNS rebinding).
export function fetchPinned(url, init = {}) {
  const addresses = (init.validatedAddresses || []).filter(address => isIP(address));
  if (!addresses.length) return Promise.reject(new Error("validated addresses required"));
  const target = new URL(url);
  const transport = target.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = transport(target, {
      method: "GET",
      headers: init.headers,
      signal: init.signal,
      agent: false,
      maxHeaderSize: 16 * 1024,
      lookup(_host, options, callback) {
        const candidates = addresses.map(address => ({ address, family: isIP(address) }))
          .filter(row => !options.family || row.family === options.family);
        if (!candidates.length) return callback(new Error("no validated address for family"));
        if (options.all) callback(null, candidates);
        else callback(null, candidates[0].address, candidates[0].family);
      },
    }, res => {
      if (res.statusCode < 200 || res.statusCode > 599) {
        res.destroy();
        reject(Object.assign(new Error("unsupported HTTP status"), { code: "IMPORT_HTTP" }));
        return;
      }
      const headers = new Headers();
      for (let i = 0; i < res.rawHeaders.length; i += 2) headers.append(res.rawHeaders[i], res.rawHeaders[i + 1]);
      const noBody = [204, 205, 304].includes(res.statusCode);
      if (noBody) res.resume();
      resolve(new Response(noBody ? null : Readable.toWeb(res), { status: res.statusCode, headers }));
    });
    req.on("error", reject);
    req.end();
  });
}
