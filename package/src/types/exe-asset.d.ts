// `import x from "./foo.exe" with { type: "file" }` is Bun's compile-time
// asset embedding (https://bun.sh/docs/bundler/executables#embedding-files) —
// the import resolves to a real extracted file path at runtime in a compiled
// binary. TypeScript has no built-in model for import attributes, so this
// just tells it the resulting binding is a string.
declare module "*.exe" {
	const path: string;
	export default path;
}
