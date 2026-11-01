// The page's inline startup code: the early-reading source, bundled into the
// <script> in index.html's <head>, where it runs before the app's code loads.
import { resolve } from "node:path";
import { build, type Plugin, type Rollup } from "vite";

export const EARLY_READING_SOURCE = "src/features/reader/earlyReading.ts";
/** Where index.html places the early-reading script. */
export const EARLY_READING_MARKER = "__EARLY_READING__";
const ENTRY = "\0early-reading-entry";

/**
 * Bundle startEarlyReading() as one classic script with the build's data
 * versions inlined: no imports, nothing else of the app. The modules it uses
 * are read for their exports only, so their other code is left out.
 */
export async function bundleEarlyReading(
  root: string,
  versions: Record<string, string>,
) {
  const source = resolve(root, EARLY_READING_SOURCE);
  const output = (await build({
    configFile: false,
    root,
    logLevel: "silent",
    publicDir: false,
    define: { __DATA_VERSIONS__: JSON.stringify(versions) },
    plugins: [
      {
        name: "early-reading-entry",
        resolveId: (id) => (id === ENTRY ? id : undefined),
        load: (id) =>
          id === ENTRY
            ? `import { startEarlyReading } from ${JSON.stringify(source)};\nstartEarlyReading();`
            : undefined,
      },
    ],
    build: {
      write: false,
      emptyOutDir: false,
      copyPublicDir: false,
      modulePreload: false,
      rollupOptions: {
        input: ENTRY,
        treeshake: { moduleSideEffects: false },
        output: { format: "iife" },
      },
    },
  })) as Rollup.RollupOutput;
  const [chunk, ...rest] = output.output;
  if (chunk.type !== "chunk" || rest.length)
    throw new Error("The early-reading script must be one chunk");
  const code = chunk.code.trim();
  if (/<\/script|<!--/i.test(code))
    throw new Error("The early-reading script cannot be inlined as it is");
  return { code, modules: chunk.moduleIds.filter((id) => id !== ENTRY) };
}

/** Put the bundled script in place of index.html's marker. */
export function inlineEarlyReading(html: string, code: string) {
  const marker = new RegExp(
    `<script>\\s*${EARLY_READING_MARKER};?\\s*</script>`,
  );
  if (!marker.test(html))
    throw new Error(`index.html has no <script>${EARLY_READING_MARKER}`);
  return html.replace(marker, () => `<script>${code}</script>`);
}

/**
 * Inline the early-reading script into index.html, in builds and on the dev
 * server (rebundled when one of its modules changes).
 */
export function inlineStartup(versions: Record<string, string>): Plugin {
  let root = process.cwd();
  let bundled: ReturnType<typeof bundleEarlyReading> | undefined;
  return {
    name: "inline-startup",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.watcher.on("change", (file) => {
        void bundled?.then(({ modules }) => {
          if (modules.includes(resolve(file))) bundled = undefined;
        });
      });
    },
    transformIndexHtml: {
      order: "pre",
      async handler(html) {
        bundled ??= bundleEarlyReading(root, versions);
        const { code } = await bundled.catch((error: unknown) => {
          bundled = undefined;
          throw error;
        });
        return inlineEarlyReading(html, code);
      },
    },
  };
}
