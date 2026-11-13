// Features & scaling: fix a character's features that don't grow with level. A class's scale values (Exploit
// Die: d6 at 2, d8 at 7…) and every feature's uses and formulas, read live from Foundry, with one-click fixes for
// the usual import breakages. Every change can be undone.
import { api } from "../api.js";
import { h, btn, card, clear, empty, toast, toastError, modal, confirmBox } from "../dom.js";
import { icon } from "../icons.js";
import { seg } from "../components.js";

const TYPES = [["dice", "Die"], ["number", "Number"], ["string", "Text"]];

export async function featuresView(ctx, root, p) {
  root.append(ctx.header({ title: `${p.character || "Character"}: features & scaling`,
    subtitle: "Make dice and uses grow with level. Read live from their Foundry sheet; every fix can be undone.", icon: "sliders",
    actions: [btn("Back", { icon: "left", kind: "ghost", onclick: () => ctx.go("party", { id: p.id }) })] }));
  const body = h("div.stack");
  root.append(body);
  clear(body, h("p.muted", "Reading the sheet from Foundry…"));
  let data;
  try { data = await api.party_features(p.id); } catch (e) {
    clear(body, card(null, empty("alert", "Couldn't read the sheet", String(e.message || e), btn("Try again", { icon: "refresh", onclick: () => ctx.reload() }))));
    return;
  }
  let undoCount = (p.features_backup || []).length;
  let filter = "attention";
  const showUses = new Set();

  const apply = async (changes, msg) => {
    try {
      const r = await api.party_features_fix(p.id, changes);
      data = r; undoCount = r.undo; draw();
      toast(msg || "Fixed on the sheet", "Undo puts it back.", "good", "check", 3000);
      return true;
    } catch (e) { toastError(e); return false; }
  };

  function draw() {
    const c = data.counts || {};
    const fixable = data.features.flatMap((f) => f.issues.filter((i) => i.fix).map((i) => ({ ...i, feature: f.name })));
    const top = h("div.row.wrap", { style: { gap: "8px" } },
      c.problem ? h("span.chip.warn", icon("alert"), `${c.problem} problem${c.problem === 1 ? "" : "s"}`) : h("span.chip.good", icon("check"), "No broken links"),
      c.suggestion ? h("span.chip.info", icon("info"), `${c.suggestion} suggestion${c.suggestion === 1 ? "" : "s"}`) : null,
      h("div.spacer"),
      undoCount ? btn("Undo last fix", { icon: "rollback", size: "sm", kind: "ghost", onclick: async () => {
        if (!await confirmBox("Undo the last fix?", "Lore Studio puts back what was on the Foundry sheet before it.", "Undo")) return;
        try { const r = await api.party_features_undo(p.id); data = r; undoCount = r.undo; draw(); toast("Undone", "", "good", "rollback"); } catch (e) { toastError(e); }
      } }) : null,
      btn("Read again", { icon: "refresh", size: "sm", kind: "ghost", onclick: () => ctx.reload() }),
      fixable.length ? btn(`Apply ${fixable.length} suggested fix${fixable.length === 1 ? "" : "es"}`, { icon: "check", size: "sm", kind: "primary", onclick: async () => {
        const ok = await modal("Apply every suggested fix?", h("div.stack.sm",
          h("p.small.muted", { style: { margin: 0 } }, "These change the Foundry sheet. Undo puts them all back at once."),
          h("ul.small", { style: { margin: 0, paddingLeft: "18px" } }, fixable.map((i) => h("li", h("b", i.feature), ": ", i.fix_label.replace(/^Use /, "use "))))),
        [{ label: "Cancel", kind: "ghost", value: false }, { label: "Apply them", kind: "primary", icon: "check", value: true }]);
        if (!ok) return;
        apply(fixable.flatMap((i) => i.fix), `Applied ${fixable.length} fixes`);
      } }) : null);

    clear(body, top, scalesCard(), featuresCard());
  }

  // ---- scale values -----------------------------------------------------------------------------
  function scalesCard() {
    const rows = data.scales.map((s) => h("div.sf-scale",
      h("div.grow",
        h("div.row.wrap", { style: { gap: "8px" } }, h("b", s.title), h("span.tiny.faint", s.item_name),
          s.current ? h("span.chip.accent", `now ${s.current}`) : null,
          s.used_by ? h("span.tiny.faint", `used by ${s.used_by} formula${s.used_by === 1 ? "" : "s"}`) : h("span.tiny.faint", "not used by any feature")),
        h("div.row.wrap", { style: { gap: "6px", marginTop: "4px" } },
          h("button.tag.click.mono", { title: "Copy", onclick: () => { navigator.clipboard?.writeText(s.ref); toast("Copied", s.ref, "", "copy", 1500); } }, s.ref),
          h("span.small.muted", Object.entries(s.scale).sort((a, b) => a[0] - b[0]).map(([lv, v]) => `${lv}: ${v}`).join(" · ") || "no levels")),
        s.issues.map((i) => h("div.small", { class: i.level === "problem" ? "warn-text" : "muted" }, icon("alert"), " ", i.text))),
      btn("", { icon: "edit", size: "sm", kind: "ghost", title: "Edit", onclick: () => editScale(s) }),
      btn("", { icon: "trash", size: "sm", kind: "ghost", title: "Delete", onclick: async () => {
        if (!await confirmBox(`Delete ${s.title}?`, s.used_by ? `${s.used_by} formula${s.used_by === 1 ? "" : "s"} use it and would count it as 0.` : "Nothing uses it.", "Delete", true)) return;
        apply([{ op: "scale_delete", item: s.item, adv_id: s.adv_id }], "Scale value deleted");
      } })));
    return card({ title: "Scale values", actions: btn("Add a scale value", { icon: "plus", size: "sm", onclick: () => editScale(null) }) },
      h("p.small.muted", { style: { margin: "0 0 10px" } }, "What something is at each level, kept on the class or subclass. Features use them in formulas as ",
        h("code", "@scale.class.name"), ", so they grow when the character levels up."),
      rows.length ? h("div.sf-list", rows) : h("p.small.faint", "This sheet has no scale values yet."));
  }

  async function editScale(s, hint = {}) {
    const classes = data.classes || [];
    if (!classes.length) return toast("No class on this sheet", "Scale values live on a class or subclass.", "warn", "alert");
    const pick = classes.find((c) => c.id === (s?.item || hint.item)) || classes.find((c) => c.identifier === hint.class_identifier) || classes.find((c) => c.type === "class") || classes[0];
    const cls = h("select.select", { disabled: !!s }, classes.map((c) => h("option", { value: c.id, selected: c.id === pick.id }, `${c.name}${c.type === "subclass" ? " (subclass)" : ""}`)));
    const title = h("input.input", { value: s?.title || hint.title || "", placeholder: "Exploit Die" });
    const ident = h("input.input.mono", { value: s?.identifier || hint.identifier || "", placeholder: "exploit-die" });
    let type = s?.type || (/die|dice/i.test(hint.identifier || "") ? "dice" : "number");
    const ref = h("code");
    const slug = (x) => x.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    const showRef = () => { const c = classes.find((x) => x.id === cls.value); ref.textContent = `@scale.${c?.identifier}.${slug(ident.value || title.value) || "name"}`; };
    let identTouched = !!(s || hint.identifier);
    title.oninput = () => { if (!identTouched) ident.value = slug(title.value); showRef(); };
    ident.oninput = () => { identTouched = true; showRef(); };
    cls.onchange = showRef;
    const cells = {};
    const grid = h("div.sf-levels", Array.from({ length: 20 }, (_, i) => {
      const lv = String(i + 1);
      cells[lv] = h("input.input", { value: s?.scale?.[lv] ?? "", placeholder: "" });
      return h("label", h("span.tiny.faint", lv), cells[lv]);
    }));
    const ph = () => { const first = Object.values(cells).find((c) => !c.value) ; Object.values(cells).forEach((c) => (c.placeholder = "")); if (first && !s) first.placeholder = type === "dice" ? "d6" : type === "number" ? "2" : ""; };
    ph(); showRef();
    const r = await modal(s ? `Edit ${s.title}` : "Add a scale value", h("div.stack",
      h("div.grid.c2", h("div.field", h("label", "On"), cls), h("div.field", h("label", "Kind"), seg(TYPES, type, (v) => { type = v; ph(); }))),
      h("div.grid.c2", h("div.field", h("label", "Name"), title), h("div.field", h("label", "Identifier"), ident)),
      h("div.small.muted", "Features use it as ", ref, s ? ". Renaming the identifier breaks formulas that use the old one." : "."),
      h("div.field", h("label", "Value by level"), grid,
        h("div.help", "Only fill in the levels where it changes; it carries on until the next one. Dice like d6 or 2d6."))),
    [{ label: "Cancel", kind: "ghost", value: false }, { label: "Save to Foundry", kind: "primary", icon: "check", value: true }], { wide: true });
    if (!r) return;
    const scale = {};
    for (const [lv, c] of Object.entries(cells)) if (c.value.trim()) scale[lv] = c.value.trim();
    if (!Object.keys(scale).length) return toast("No values", "Fill in at least one level.", "warn", "alert");
    apply([{ op: "scale", item: cls.value, adv_id: s?.adv_id, scale: { title: title.value.trim(), identifier: ident.value.trim() || title.value.trim(), type, scale } }],
      s ? "Scale value saved" : "Scale value added");
  }

  // ---- features -----------------------------------------------------------------------------------
  function featuresCard() {
    const list = data.features.filter((f) => filter === "all" || f.issues.length);
    const refs = data.scales.map((s) => s.ref);
    return card({ title: "Features", actions: seg([["attention", "Needs a look"], ["all", `All (${data.features.length})`]], filter, (v) => { filter = v; draw(); }) },
      list.length ? h("div.sf-list", list.map((f) => featureRow(f, refs)))
        : h("p.small.faint", filter === "all" ? "No features on this sheet." : "Nothing needs a look. Switch to All to see and edit every feature."));
  }

  function formulaInput(value, refs, onSave, resolved) {
    const inp = h("input.input.mono", { value });
    const save = btn("Save", { size: "sm", onclick: () => onSave(inp.value.trim()) });
    save.style.visibility = "hidden";
    inp.oninput = () => (save.style.visibility = inp.value !== value ? "visible" : "hidden");
    const ins = refs.length ? h("select.select.sf-ins", { title: "Insert a scale value", onchange: (e) => {
      const v = e.target.value; e.target.value = "";
      if (!v) return;
      const at = inp.selectionStart ?? inp.value.length;
      inp.value = inp.value.slice(0, at) + v + inp.value.slice(inp.selectionEnd ?? at);
      inp.dispatchEvent(new Event("input")); inp.focus();
    } }, h("option", { value: "" }, "@ Insert…"), refs.map((r) => h("option", { value: r }, r))) : null;
    return h("div.row.nowrap", { style: { gap: "6px" } }, inp, ins, resolved != null && resolved !== value ? h("span.small.faint.sf-res", { title: resolved }, "= " + resolved) : null, save);
  }

  function featureRow(f, refs) {
    const periodSel = h("select.select", { style: { width: "auto" } }, h("option", { value: "" }, "no recovery"),
      Object.entries(data.periods).map(([k, l]) => h("option", { value: k, selected: k === f.uses_period }, `per ${l}`)));
    periodSel.onchange = () => apply([{ op: "uses", item: f.id, max: f.uses_max, period: periodSel.value }], "Recovery saved");
    return h("div.sf-feature",
      h("div.row.nowrap", { style: { gap: "8px" } }, f.img ? h("img.sf-img", { src: f.img.startsWith("http") ? f.img : "", alt: "", onerror: (e) => e.target.remove() }) : null,
        h("b.grow", f.name), h("span.tiny.faint", f.type)),
      f.issues.map((i) => h("div.sf-issue", { class: i.level },
        icon(i.level === "problem" ? "alert" : "info"), h("span.grow", i.text),
        i.fix ? btn(i.fix_label, { size: "sm", kind: i.level === "problem" ? "primary" : "", onclick: () => apply(i.fix) }) : null,
        !i.fix && i.scale_hint ? btn(i.scale_hint.adv_id ? "Edit the scale value" : "Add the scale value", { size: "sm", onclick: () => {
          const s = data.scales.find((x) => x.adv_id === i.scale_hint.adv_id);
          editScale(s || null, i.scale_hint);
        } }) : null)),
      h("div.sf-formulas",
        f.uses_max || showUses.has(f.id) ? h("div.sf-f", h("span.small.muted", "Uses"),
          h("div.row.nowrap", { style: { gap: "6px" } },
            formulaInput(f.uses_max, refs, (v) => apply([{ op: "uses", item: f.id, max: v, ...(f.uses_max ? {} : { period: "lr" }) }], "Uses saved"), f.uses_total != null ? String(f.uses_total) : null),
            f.uses_max ? periodSel : null)) : null,
        f.formulas.map((x) => h("div.sf-f", h("span.small.muted", x.label.startsWith(f.name + ": ") ? x.label.slice(f.name.length + 2).replace(/^./, (c) => c.toUpperCase()) : x.label),
          formulaInput(x.formula, refs, (v) => apply([{ op: "formula", item: f.id, key: x.key, formula: v }], "Formula saved"), x.resolved))),
        !f.uses_max && !showUses.has(f.id) ? h("button.linkish.small", { style: { justifySelf: "start" }, onclick: () => { showUses.add(f.id); draw(); } }, "+ Give it limited uses") : null,
        !f.formulas.length && f.uses_max ? null : null));
  }

  draw();
}
