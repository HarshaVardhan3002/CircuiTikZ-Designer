// tests/vision/register.mjs
import { register } from "node:module"
// Reuse the ts-resolver shipped under tests/import/.
register("../import/ts-resolver.mjs", import.meta.url)
