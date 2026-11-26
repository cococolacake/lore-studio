// Sessions: helpers the tabs share, and the job progress rows (also used by Home and Threads).
import { api } from "../../api.js";
import { h, btn, toastError, fmtDuration } from "../../dom.js";

export const hms = (sec) => { sec = Math.max(0, Math.floor(sec || 0)); return `${String(Math.floor(sec / 3600)).padStart(2, "0")}:${String(Math.floor(sec % 3600 / 60)).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`; };

export const money = (usd) => (usd < 0.01 ? "under 1¢" : usd < 1 ? `${Math.round(usd * 100)}¢` : `$${usd.toFixed(2)}`);

export const toSec = (t) => t.split(":").reduce((a, b) => a * 60 + Number(b), 0);

const STAGES = { decode: "Reading audio", transcribe: "Transcribing", diarize: "Telling voices apart", gm: "Writing the GM recap",
  player: "Writing the player recap", threads: "Finding loose threads", scan: "Reading past recaps" };

/** A progress row for a background job. Polling updates it in place (updateJobRow), so it never flickers. */

export function jobRow(j) {
  const el = h("div.job", { "data-job": j.id },
    h("div.row.nowrap", h("span.chip.accent.live", h("span.dot"), h("span.j-stage")), h("span.small.muted.grow.ellipsis.j-title"),
      h("span.small.faint.nums.j-speed"), h("span.small.faint.nums.j-left"),
      btn("", { icon: "x", size: "sm", kind: "ghost", title: "Cancel", onclick: () => api.cancel_task(j.id).catch(toastError) })),
    h("div.progress", h("i")),
    h("div.tiny.faint.ellipsis.j-last"));
  return updateJobRow(el, j);
}

export function updateJobRow(el, j) {
  const p = j.progress || {};
  const pct = p.total ? Math.min(100, Math.round((p.done / p.total) * 100)) : null;
  const left = p.total && p.done && p.elapsed ? (p.elapsed / p.done) * (p.total - p.done) : null;
  const set = (sel, text) => { const n = el.querySelector(sel); if (n.textContent !== text) n.textContent = text; n.hidden = !text; };
  set(".j-stage", STAGES[p.stage] || (j.status === "queued" ? "Waiting in line" : "Starting"));
  set(".j-title", j.title || "");
  set(".j-speed", p.speed ? `${p.speed}× real time` : "");
  set(".j-left", left ? `${fmtDuration(left)} left` : "");
  set(".j-last", j.last || "");
  const bar = el.querySelector(".progress");
  bar.classList.toggle("idle", pct == null);
  const w = (pct ?? 8) + "%";
  if (bar.firstChild.style.width !== w) bar.firstChild.style.width = w;
  return el;
}

// ---- recap ----------------------------------------------------------------------
