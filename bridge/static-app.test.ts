import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStaticAppResponder } from "./static-app";

describe("createStaticAppResponder", () => {
	test("serves index.html for the app root", async () => {
		const dir = await mkdtemp(join(tmpdir(), "seismic-static-"));
		try {
			await writeFile(join(dir, "index.html"), "<h1>Seismic Audio</h1>");
			const respond = createStaticAppResponder(dir);

			const response = await respond(new URL("http://127.0.0.1:8787/"));

			expect(response?.status).toBe(200);
			expect(await response?.text()).toBe("<h1>Seismic Audio</h1>");
			expect(response?.headers.get("content-type")).toContain("text/html");
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
