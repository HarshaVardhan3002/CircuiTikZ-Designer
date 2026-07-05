// Parcel `url:` imports resolve an asset to its bundled URL string (handled by
// @parcel/packager-raw-url). This declaration teaches tsc about the scheme so
// `import x from "url:..."` type-checks. Used to self-host MathJax (offline-capable).
declare module "url:*" {
	const url: string
	export default url
}

// Side-effect CSS imports (self-hosted @fontsource / material-symbols, etc.).
declare module "*.css" {}
