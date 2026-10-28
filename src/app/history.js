"use strict";
// 履歴タブ：今週の部位別セット数、直近40回の記録、バックアップ

const BACKUP_APP = "saijo-training-log"; // 現行の書き出しファイルと互換を保つため、この値のまま
const BACKUP_FORMAT = 1;
const BACKUP_REMIND_DAYS = 14;
const WEEK_TARGET = [12, 16];

function renderHistory(root) {
  const workouts = sortedWorkouts(db.get(db.collection("workouts")));
  const today = todayYmd();
  let h = `<h2 class="tab-title">履歴</h2>`;

  // バックアップの促し
  const lastExport = lastExportAt();
  const since = lastExport ? daysBetween(lastExport.slice(0, 10), today) : null;
  if (workouts.length && (since == null || since >= BACKUP_REMIND_DAYS)) {
    h += `<div class="notice">${since == null ? "まだバックアップを書き出していません。" : `最後の書き出しから${since}日たちました。`}
      <a href="#backup" data-jump="backup">書き出す ↓</a></div>`;
  }

  h += deloadNotice(workouts, today, false);

  // 今週の部位別セット数
  const vol = weekVolume(workouts, today);
  const max = Math.max(20, ...Object.values(vol));
  const ws = weekStart(today);
  h += `<section class="card"><h3 class="sub">今週のセット数 <small>${esc(fmtDate(ws))}〜　目安 ${WEEK_TARGET[0]}〜${WEEK_TARGET[1]}</small></h3>
    <div class="vol">`;
  for (const m of MUSCLES) {
    if (m === "有酸素") continue;
    const n = vol[m] || 0;
    const cls = n >= WEEK_TARGET[0] && n <= WEEK_TARGET[1] ? "in" : n > WEEK_TARGET[1] ? "over" : "";
    h += `<div class="vol-row ${cls}"><span class="vol-name">${esc(m)}</span>
      <span class="vol-bar"><span class="band" style="left:${WEEK_TARGET[0] / max * 100}%;width:${(WEEK_TARGET[1] - WEEK_TARGET[0]) / max * 100}%"></span>
      <span class="fill" style="width:${n / max * 100}%"></span></span>
      <span class="vol-n">${n}</span></div>`;
  }
  h += `</div></section>`;

  // 週ごとの部位別セット数の推移（直近8週）
  const weeks = weeklyVolumes(workouts, today, 8);
  h += `<section class="card"><h3 class="sub">部位別セット数の推移 <small>直近8週・緑は目安 ${WEEK_TARGET[0]}〜${WEEK_TARGET[1]} の範囲</small></h3>
    <div class="trend"><table><colgroup><col class="m">${weeks.map(() => "<col>").join("")}</colgroup><thead><tr><th></th>${weeks.map((w, k) => `<th>${k === weeks.length - 1 ? "今週" : esc(fmtMD(w.start))}</th>`).join("")}</tr></thead><tbody>`;
  for (const m of MUSCLES) {
    if (m === "有酸素") continue;
    h += `<tr><th>${esc(m)}</th>${weeks.map((w, k) => {
      const n = w.vol[m] || 0;
      const cls = n === 0 ? "z" : n >= WEEK_TARGET[0] && n <= WEEK_TARGET[1] ? "in" : n > WEEK_TARGET[1] ? "over" : "";
      return `<td class="${cls}${k === weeks.length - 1 ? " now" : ""}">${n || "·"}</td>`;
    }).join("")}</tr>`;
  }
  h += `</tbody></table></div></section>`;

  // 直近40回
  h += `<h3 class="sub">直近の記録</h3>`;
  if (!workouts.length) h += `<div class="empty"><p>まだ記録がありません。</p></div>`;
  for (const w of workouts.slice(0, 40)) {
    const exs = (w.exercises || []).filter((e) => (e.sets || []).some(setHasData));
    h += `<button class="card hist" data-open="${esc(w.date)}" data-day="${esc(w.dayKey)}">
      <div class="hist-head"><b>${esc(fmtDate(w.date))}</b><span>${esc(w.title || "")}</span></div>
      <ul>${exs.map((e) => `<li><span>${esc(e.name)}</span><span class="muted">${(e.sets || []).filter(setHasData).map((s) => esc(fmtSet(s, e))).join(" ")}</span></li>`).join("")}</ul>
    </button>`;
  }

  // バックアップ
  h += `<section class="card backup" id="backup">
    <h3 class="sub">バックアップ</h3>
    <p class="muted">記録はこの端末のブラウザの中だけにあります。ときどき書き出して、ファイルを保存しておいてください。</p>
    <p>最後の書き出し：${lastExport ? esc(fmtDateY(lastExport.slice(0, 10))) : "なし"}</p>
    <div class="row-btns">
      <button class="primary" data-act="export">書き出す（JSON）</button>
      <label class="button">読み込む<input type="file" id="import-file" accept="application/json,.json" hidden></label>
    </div>
    <p class="muted small">読み込むと、いまの記録はすべてファイルの内容に置き換わります。</p>
  </section>`;
  root.innerHTML = h;
}

async function exportBackup() {
  const payload = { app: BACKUP_APP, format: BACKUP_FORMAT, exportedAt: new Date().toISOString(), data: db.exportData() };
  const name = `training-log-${todayYmd()}.json`;
  const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
  const file = new File([blob], name, { type: "application/json" });
  // iOS では共有シートから「ファイルに保存」できる
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: name });
      uiSet("lastexport", payload.exportedAt);
      return true;
    } catch (e) {
      if (e.name === "AbortError") return false;
    }
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  uiSet("lastexport", payload.exportedAt);
  return true;
}

// 最後に書き出した日時。現行版は tlog-lastbackup に入れていたので、なければそちらを見る
function lastExportAt() {
  const v = uiGet("lastexport", null);
  if (v) return v;
  try { return localStorage.getItem("tlog-lastbackup"); } catch (e) { return null; }
}

// 読み込んだファイルを確かめて data を返す。だめなら Error。
// 現行版と同じく、{app, format, data} で包まれていないデータ（program/workouts/bodyweight を直接持つ）も受け付ける
function parseBackup(text) {
  let o;
  try { o = JSON.parse(text); } catch (e) { throw new Error("JSON として読めません"); }
  if (!o || typeof o !== "object") throw new Error("このアプリのバックアップではありません");
  if (o.app != null && o.app !== BACKUP_APP) throw new Error("このアプリのバックアップではありません");
  if (o.format != null && o.format !== BACKUP_FORMAT) throw new Error(`対応していない形式です（format ${o.format}）`);
  const d = o.data && typeof o.data === "object" ? o.data : o;
  if (!(d.program || d.workouts || d.bodyweight)) throw new Error("記録が入っていません");
  return normalizeData({ program: d.program || {}, workouts: d.workouts || {}, bodyweight: d.bodyweight || {} });
}

function bindHistory(root) {
  root.addEventListener("click", async (e) => {
    const jump = e.target.closest("[data-jump]");
    if (jump) { e.preventDefault(); $("#backup").scrollIntoView({ behavior: "smooth" }); return; }
    const open = e.target.closest("[data-open]");
    if (open) {
      Today.date = open.dataset.open;
      Today.chosen[Today.date] = open.dataset.day;
      showTab("today");
      return;
    }
    const b = e.target.closest("[data-act='export']");
    if (b) { if (await exportBackup()) renderHistory(root); }
  });
  root.addEventListener("change", async (e) => {
    if (e.target.id !== "import-file") return;
    const f = e.target.files[0];
    e.target.value = "";
    if (!f) return;
    try {
      const data = parseBackup(await f.text());
      const nW = Object.keys(data.workouts).length, nB = Object.keys(data.bodyweight).length;
      const nD = (data.program.current && data.program.current.days || []).length;
      if (!confirm(`「${f.name}」を読み込みます。\nルーティン ${nD}件・記録 ${nW}件・体重 ${nB}件\n\nいまの記録はすべて置き換わります。よろしいですか？`)) return;
      flushToday();
      db.replaceAll(data);
      Routine.draft = null;
      alert("読み込みました。");
    } catch (err) {
      alert(`読み込めませんでした：${err.message}`);
    }
  });
}
