// Registers the TypeScript resolver for `node --test`.
import { register } from "node:module";

register("./resolve-ts.mjs", import.meta.url);
