// Node 22 loader hook: add a ".ts" extension to extensionless relative imports so the
// in-tree TypeScript files can be loaded directly. Used only by the import-pipeline test
// harness — production code still goes through Parcel, which handles extensions on its own.
import { stat } from "node:fs/promises"
import { fileURLToPath, pathToFileURL } from "node:url"

export async function resolve(specifier, context, nextResolve) {
	if ((specifier.startsWith("./") || specifier.startsWith("../")) && !/\.(ts|mjs|js|cjs|json)$/.test(specifier)) {
		const parentPath = fileURLToPath(context.parentURL ?? import.meta.url)
		const base = new URL(specifier, pathToFileURL(parentPath))
		// Convert the resolved URL back to an OS path before stat() — on Windows, base.pathname
		// is "/C:/..." which stat() rejects, but fileURLToPath gives the correct "C:\..." form.
		const candidate = fileURLToPath(base) + ".ts"
		try {
			await stat(candidate)
			return nextResolve(specifier + ".ts", context)
		} catch {
			// fall through to default resolution
		}
	}
	return nextResolve(specifier, context)
}
