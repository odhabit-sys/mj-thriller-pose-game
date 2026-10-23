import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, type Plugin } from "vite";

/** Copyrighted music kept on the development machine (see docs/CREDITS.md). Served by `vite` dev, never shipped. */
const LOCAL_ONLY_FILES = ["audio/local/thriller.mp3"];

/**
 * Vite copies everything in public/ into the build output. This removes the
 * local-only files from every production build automatically, so they can stay
 * in public/ for development without ever reaching dist/.
 */
function excludeLocalOnlyFiles(): Plugin {
  let outDir = "";
  return {
    name: "exclude-local-only-files",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const file of LOCAL_ONLY_FILES) rmSync(resolve(outDir, file), { force: true });
      rmSync(resolve(outDir, "audio/local/README.md"), { force: true });
    },
  };
}

export default defineConfig({
  plugins: [excludeLocalOnlyFiles()],
});
