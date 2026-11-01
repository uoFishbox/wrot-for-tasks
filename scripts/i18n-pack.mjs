import esbuild from "esbuild";
import path from "path";

// esbuild plugin: each locale becomes a value array in ja.ts key order, with the key list shipped once, so the bundle carries the keys one time. Sources stay as they are.

const KEYS_MODULE = "wr-i18n-keys";
// Go regex syntax (no lookahead): index.ts is skipped inside the handler instead.
const I18N_FILE = /src[\\/]i18n[\\/][\w-]+\.ts$/;

// Bundles one locale file on its own (en-GB pulls in en) and evaluates it to the object.
async function evalDict(file) {
  const result = await esbuild.build({
    entryPoints: [file],
    bundle: true,
    write: false,
    format: "cjs",
    platform: "node",
    metafile: true,
    logLevel: "silent",
  });
  const mod = { exports: {} };
  new Function("module", "exports", result.outputFiles[0].text)(mod, mod.exports);
  return {
    dict: mod.exports.default,
    watchFiles: Object.keys(result.metafile.inputs).map((file) => path.resolve(file)),
  };
}

export function i18nPackPlugin() {
  return {
    name: "wr-i18n-pack",
    setup(build) {
      const i18nDir = path.resolve(build.initialOptions.absWorkingDir ?? process.cwd(), "src/i18n");
      const jaFile = path.join(i18nDir, "ja.ts");
      const dicts = new Map();
      // A watch context reuses this plugin. Only share evaluations within one build.
      build.onStart(() => dicts.clear());
      const dictOf = (file) => {
        if (!dicts.has(file)) dicts.set(file, evalDict(file));
        return dicts.get(file);
      };

      build.onResolve({ filter: new RegExp(`^${KEYS_MODULE}$`) }, () => ({
        path: KEYS_MODULE,
        namespace: "wr-i18n",
      }));

      build.onLoad({ filter: /.*/, namespace: "wr-i18n" }, async () => {
        const { dict, watchFiles } = await dictOf(jaFile);
        const keys = Object.keys(dict);
        return {
          contents:
            `export const K=${JSON.stringify(keys)};` +
            // Values sit in a function body the engine only skims; the object is built on first lookup.
            `export const D=(f)=>{let o=null;return new Proxy({},{get:(_,k)=>{if(o===null){const v=f();o={};for(let i=0;i<K.length;i++)o[K[i]]=v[i];}return o[k];}});};`,
          loader: "js",
          watchFiles,
        };
      });

      build.onLoad({ filter: I18N_FILE }, async (args) => {
        if (path.basename(args.path) === "index.ts") return undefined;
        const [ja, locale] = await Promise.all([dictOf(jaFile), dictOf(args.path)]);
        const keys = Object.keys(ja.dict);
        const dict = locale.dict;
        const own = Object.keys(dict);
        const missing = keys.filter((k) => !(k in dict));
        const extra = own.filter((k) => !keys.includes(k));
        if (missing.length || extra.length) {
          throw new Error(
            `${path.basename(args.path)}: keys differ from ja.ts` +
              (missing.length ? ` (missing: ${missing.join(", ")})` : "") +
              (extra.length ? ` (extra: ${extra.join(", ")})` : "")
          );
        }
        const values = keys.map((k) => dict[k]);
        return {
          contents:
            `import {D} from "${KEYS_MODULE}";` +
            `export default D(()=>${JSON.stringify(values)});`,
          loader: "js",
          // Include transitive imports (en-GB imports en) as well as the key order.
          watchFiles: [...new Set([...ja.watchFiles, ...locale.watchFiles])],
        };
      });
    },
  };
}
