// Reusable form pieces: switches, segmented controls, path pickers, log view, task follower.
import { api } from "./api.js";
import { h, btn, clear, toastError } from "./dom.js";
import { icon } from "./icons.js";

let NATIVE = false;
export const setNative = (v) => { NATIVE = !!v; };

export function switchEl(checked, onchange, label = "") {
  const inp = h("input", { type: "checkbox", checked: !!checked, onchange: (e) => onchange(e.target.checked) });
  return h("label.switch", inp, h("span.track"), label ? h("span.txt", label) : null);
}

export function checkEl(checked, onchange, label) {
  return h("label.check", h("input", { type: "checkbox", checked: !!checked, onchange: (e) => onchange(e.target.checked) }), label);
}

export function seg(options, value, onchange) {
  const wrap = h("div.seg");
  const render = (v) => {
    wrap.replaceChildren(...options.map(([val, label, ic]) =>
      h("button", { class: val === v ? "on" : "", type: "button", onclick: () => { render(val); onchange(val); } }, ic ? icon(ic) : null, label)));
  };
  render(value);
  return wrap;
}

export function rangeEl(value, min, max, step, oninput) {
  const r = h("input", { type: "range", min, max, step, value });
  const paint = () => r.style.setProperty("--fill", `${((r.value - min) / (max - min)) * 100}%`);
  r.addEventListener("input", () => { paint(); oninput(Number(r.value)); });
  paint();
  return r;
}

// Example paths are written Windows-style; show Linux-style ones on Linux.
export function examplePath(p) {
  if (document.documentElement.dataset.platform === "windows" || !p.startsWith("C:/")) return p;
  return p.replace(/^C:\/Users\/you\//, "/home/you/").replace(/^C:\/(AI|datasets)\//, "/home/you/$1/").replace(/^C:\//, "/home/you/");
}

export function pathInput(value, onchange, { folder = false, kind = "any", placeholder = "" } = {}) {
  const inp = h("input.input.mono", { value: value ?? "", placeholder: examplePath(placeholder || (folder ? "C:/path/to/folder" : "C:/path/to/file")),
    onchange: (e) => onchange(e.target.value.trim().replace(/^"(.*)"$/, "$1")) });
  const browse = btn("", { icon: "folder", title: "Browse", onclick: async () => {
    try {
      const p = folder ? await api.pick_folder() : await api.pick_file(kind);
      if (p) { inp.value = p; onchange(p); }
    } catch (e) { toastError(e); }
  } });
  return h("div.input-wrap", inp, NATIVE ? browse : null);
}

/** Scrolling log with a pinned progress line. */
export function logView(height = 320) {
  const el = h("div.log", { style: { height: height + "px" } });
  const body = h("div");
  const prog = h("div.prog.hidden");
  el.append(body, prog);
  let stick = true;
  el.addEventListener("scroll", () => { stick = el.scrollTop + el.clientHeight >= el.scrollHeight - 30; });
  const cls = (l) => (/^(>>|\$ )/.test(l) ? "ln-cmd" : /(error|traceback|exception|failed)/i.test(l) ? "ln-err" : /(saved|finished with exit code 0|up to date|all set)/i.test(l) ? "ln-ok" : "");
  return {
    el,
    append(lines) {
      if (!lines?.length) return;
      const frag = document.createDocumentFragment();
      for (const l of lines) frag.append(h("div", { class: cls(l) }, l || " "));
      body.append(frag);
      while (body.childNodes.length > 4000) body.firstChild.remove();
      if (stick) el.scrollTop = el.scrollHeight;
    },
    progress(line) {
      prog.classList.toggle("hidden", !line);
      prog.textContent = line || "";
      if (stick) el.scrollTop = el.scrollHeight;
    },
    clear() { body.replaceChildren(); prog.classList.add("hidden"); },
  };
}

/** Follow a backend Task (update, install...) into a log view. Resolves with the final snapshot. */
export function followTask(taskId, log, onDone) {
  let since = 0;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      const t = await api.task(taskId, since);
      if (!t) return;
      log.append(t.lines);
      since = t.total;
      if (t.status === "running") setTimeout(tick, 600);
      else onDone?.(t);
    } catch (e) { toastError(e); }
  };
  tick();
  return () => { stopped = true; };
}
