// Node only resolves extensionless relative imports through a bundler. The
// tests run the TypeScript sources directly, so retry with ".ts" — the same
// resolution the Next.js build uses for "@/lib/*".
const extensions = [".ts", ".tsx", "/index.ts"];

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      for (const extension of extensions) {
        try {
          return await next(`${specifier}${extension}`, context);
        } catch {
          // try the next extension
        }
      }
    }
    throw error;
  }
}
