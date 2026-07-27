import { build } from "vite";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { copyFileSync, mkdirSync, rmSync, existsSync, watch as fsWatch, cpSync } from "node:fs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const outDir = resolve(root, "dist");

/** @typedef {{ entry: string; outFile: string; format: 'es' | 'iife'; globalName?: string }} Entry */

/** @type {Entry[]} */
const entries = [
  {
    entry: "src/background.ts",
    outFile: "background.js",
    format: "es",
  },
  {
    entry: "src/content/bridge.ts",
    outFile: "bridge.js",
    format: "iife",
    globalName: "SseDevtoolsBridge",
  },
  {
    entry: "src/content/inject-main.ts",
    outFile: "inject-main.js",
    format: "iife",
    globalName: "SseDevtoolsInject",
  },
  {
    entry: "src/devtools/devtools.ts",
    outFile: "devtools/devtools.js",
    format: "es",
  },
  {
    entry: "src/panel/panel.ts",
    outFile: "panel/panel.js",
    format: "es",
  },
  {
    entry: "src/options/options.ts",
    outFile: "options/options.js",
    format: "es",
  },
];

/**
 * @param {Entry} e
 * @returns {import('vite').InlineConfig}
 */
function entryConfig(e) {
  return {
    configFile: false,
    root,
    build: {
      outDir,
      emptyOutDir: false,
      sourcemap: true,
      target: "es2022",
      lib: {
        entry: resolve(root, e.entry),
        name: e.globalName,
        formats: [e.format],
        fileName: () => e.outFile.replace(/\.js$/, ""),
      },
      rollupOptions: {
        output: {
          inlineDynamicImports: true,
          entryFileNames: e.outFile,
          assetFileNames: (info) => {
            if (info.name?.endsWith(".css")) {
              // panel.ts and options.ts both emit CSS; keep filenames distinct
              if (e.outFile.startsWith("options/")) return "options/options.css";
              return "panel/panel.css";
            }
            return "assets/[name][extname]";
          },
        },
      },
    },
  };
}

function copyStatic() {
  mkdirSync(resolve(outDir, "devtools"), { recursive: true });
  mkdirSync(resolve(outDir, "panel"), { recursive: true });
  mkdirSync(resolve(outDir, "options"), { recursive: true });
  copyFileSync(resolve(root, "manifest.json"), resolve(outDir, "manifest.json"));
  copyFileSync(
    resolve(root, "src/devtools/devtools.html"),
    resolve(outDir, "devtools/devtools.html"),
  );
  copyFileSync(resolve(root, "src/panel/panel.html"), resolve(outDir, "panel/panel.html"));
  copyFileSync(resolve(root, "src/options/options.html"), resolve(outDir, "options/options.html"));
  cpSync(resolve(root, "_locales"), resolve(outDir, "_locales"), { recursive: true });
}

async function buildAll() {
  if (existsSync(outDir)) {
    rmSync(outDir, { recursive: true, force: true });
  }
  mkdirSync(outDir, { recursive: true });

  for (const e of entries) {
    await build(entryConfig(e));
  }
  copyStatic();
  console.log("Build complete → dist/");
}

const watchMode = process.argv.includes("--watch");

if (watchMode) {
  await buildAll();
  console.log("Watching src/ …");

  let timer = null;
  const trigger = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      buildAll().catch(console.error);
    }, 200);
  };

  fsWatch(resolve(root, "src"), { recursive: true }, trigger);
  fsWatch(resolve(root, "manifest.json"), trigger);
  fsWatch(resolve(root, "_locales"), { recursive: true }, trigger);
} else {
  await buildAll();
}
