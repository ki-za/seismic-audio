import { join, normalize, relative } from "node:path";

export function createStaticAppResponder(appDir: string) {
	return async function respond(url: URL): Promise<Response | undefined> {
		const pathname = decodeURIComponent(url.pathname);
		const relativePath = pathname === "/" ? "index.html" : pathname.slice(1);
		const candidate = normalize(join(appDir, relativePath));
		if (relative(appDir, candidate).startsWith("..")) return undefined;

		const file = Bun.file(candidate);
		if (await file.exists()) {
			return new Response(file, { headers: { "content-type": contentType(candidate) } });
		}

		const index = Bun.file(join(appDir, "index.html"));
		if (await index.exists()) {
			return new Response(index, { headers: { "content-type": "text/html; charset=utf-8" } });
		}
	};
}

function contentType(path: string) {
	if (path.endsWith(".html")) return "text/html; charset=utf-8";
	if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
	if (path.endsWith(".css")) return "text/css; charset=utf-8";
	if (path.endsWith(".svg")) return "image/svg+xml";
	if (path.endsWith(".json")) return "application/json; charset=utf-8";
	if (path.endsWith(".wasm")) return "application/wasm";
	return "application/octet-stream";
}
