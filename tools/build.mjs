// src/ から dist/ を作るビルド。外部ライブラリなし。
//
// HTML 内の次のタグを中身で置き換えて、1ファイルにまとめる：
//   <link rel="stylesheet" href="x.css" data-inline>
//   <script src="x.js" data-inline></script>
//   <script type="application/octet-stream" id="..." data-embed="path/to/file.bin"></script>
//     → ファイルを base64 にして埋め込む（模型のメッシュ用。パスはリポジトリのルートから）
// どのファイルでも __VERSION__ は版の文字列に置き換える。
// __PUSH_URL__ / __PUSH_KEY__ は休憩通知のサーバーの場所と公開鍵（push-server/client.json。なければ空＝通知なし）。

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src");
const DIST = path.join(ROOT, "dist");

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
// 版：package.json の版＋ビルド日時（JST）。SW のキャッシュ名にも使う。
const stamp = new Date(Date.now() + 9 * 3600e3).toISOString().replace(/[-:T]/g, "").slice(0, 12);
const VERSION = `${pkg.version}-${stamp}`;

function read(p) {
  if (!fs.existsSync(p)) throw new Error(`見つかりません: ${path.relative(ROOT, p)}`);
  return fs.readFileSync(p, "utf8");
}

const pushFile = path.join(ROOT, "push-server/client.json");
const PUSH = fs.existsSync(pushFile) ? JSON.parse(fs.readFileSync(pushFile, "utf8")) : {};

function stamped(text) {
  return text.replaceAll("__VERSION__", VERSION).replaceAll("__PUSH_URL__", PUSH.url || "").replaceAll("__PUSH_KEY__", PUSH.key || "");
}

function bundleHtml(file) {
  const dir = path.dirname(file);
  let html = read(file);
  html = html.replace(/<link\s+rel="stylesheet"\s+href="([^"]+)"\s+data-inline\s*\/?>/g,
    (_, href) => `<style>\n${read(path.resolve(dir, href))}\n</style>`);
  html = html.replace(/<script\s+src="([^"]+)"\s+data-inline\s*><\/script>/g,
    // </script> が中身に現れると途中で閉じるので逃がす
    (_, src) => `<script>\n${read(path.resolve(dir, src)).replace(/<\/script/gi, "<\\/script")}\n</script>`);
  html = html.replace(/<script([^>]*?)\s+data-embed="([^"]+)"\s*><\/script>/g, (_, attrs, src) => {
    const p = path.join(ROOT, src);
    if (!fs.existsSync(p)) throw new Error(`埋め込むファイルがありません: ${src}`);
    return `<script${attrs}>${fs.readFileSync(p).toString("base64")}</script>`;
  });
  const left = html.match(/data-(inline|embed)/);
  if (left) throw new Error(`${path.relative(ROOT, file)}: 置き換えられなかったタグがあります（${left[0]}）`);
  return stamped(html);
}

function write(rel, content) {
  const p = path.join(DIST, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content);
  return rel;
}

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(DIST, { recursive: true });

const out = [];

// 模型のメッシュ：中身のハッシュを名前に入れて dist/data/ に置く。
// 中身が変わらなければ名前も変わらないので、アプリの版が上がっても再ダウンロードしない。
const MESH = path.join(ROOT, "data/bodyparts3d");
const meshFiles = {};
for (const [key, suffix] of [["normal", ""], ["mobile", "-mobile"]]) {
  const bin = fs.readFileSync(path.join(MESH, `body${suffix}.bin`));
  const hash = crypto.createHash("sha256").update(bin).digest("hex").slice(0, 10);
  const rel = `data/body${suffix}.${hash}.bin`;
  out.push(write(rel, bin));
  meshFiles[key] = { bin: rel, manifest: JSON.parse(read(path.join(MESH, `manifest${suffix}.json`))) };
}
meshFiles.joints = JSON.parse(read(path.join(MESH, "joints.json")));
out.push(write("data/README.md", read(path.join(MESH, "README.md"))));
const meshList = [meshFiles.normal.bin, meshFiles.mobile.bin];

out.push(write("index.html", bundleHtml(path.join(SRC, "app/index.html"))));
out.push(write("model.html", bundleHtml(path.join(SRC, "model/model.html"))
  .replace("/*__MESH_FILES__*/", `const MESH_FILES = ${JSON.stringify(meshFiles)};`)));
out.push(write("check.html", bundleHtml(path.join(SRC, "check/check.html"))));
out.push(write("sw.js", stamped(read(path.join(SRC, "pwa/sw.js"))).replace("__MESH_FILES__", JSON.stringify(meshList))));
out.push(write("manifest.webmanifest", read(path.join(SRC, "pwa/manifest.webmanifest"))));
for (const f of fs.readdirSync(path.join(SRC, "pwa/icons"))) {
  out.push(write(`icons/${f}`, fs.readFileSync(path.join(SRC, "pwa/icons", f))));
}
// GitHub Pages で Jekyll の処理を止める
out.push(write(".nojekyll", ""));

console.log(`ビルド完了 版 ${VERSION}`);
for (const rel of out) {
  const kb = (fs.statSync(path.join(DIST, rel)).size / 1024).toFixed(1);
  console.log(`  dist/${rel.padEnd(28)} ${kb.padStart(9)} KB`);
}
