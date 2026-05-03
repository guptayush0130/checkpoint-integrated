"use strict";

// ─── tiny DOM helpers ───────────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));
const el = (tag, attrs = {}, ...children) => {
  const node = document.createElement(tag);
  Object.entries(attrs).forEach(([k, v]) => {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v);
  });
  children.flat().forEach((c) =>
    node.appendChild(c instanceof Node ? c : document.createTextNode(String(c)))
  );
  return node;
};

// ─── state ──────────────────────────────────────────────────────────────────
const state = {
  suiteId: null,
  matrix: null,
  variables: null,
  events: [],
};

// ─── boot: fetch config ─────────────────────────────────────────────────────
(async function init() {
  try {
    const cfg = await (await fetch("/api/config")).json();
    const badge = $("#mode-badge");
    if (cfg.offline_mode) {
      badge.textContent = "offline mock LLM";
      badge.classList.add("offline");
    } else {
      badge.textContent = `live · ${cfg.tester_model}`;
      badge.classList.add("online");
    }
  } catch {
    $("#mode-badge").textContent = "config error";
  }
})();

// ─── load example ──────────────────────────────────────────────────────────
$("#load-example").addEventListener("click", async () => {
  const ex = await (await fetch("/api/example")).json();
  $("#input-json").value = JSON.stringify(ex, null, 2);
});

// ─── upload file ───────────────────────────────────────────────────────────
$("#upload-file").addEventListener("change", async (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const fd = new FormData();
  fd.append("file", f);
  const res = await fetch("/api/suites/upload", { method: "POST", body: fd });
  if (!res.ok) {
    alert("upload failed: " + (await res.text()));
    return;
  }
  const { suite_id } = await res.json();
  state.suiteId = suite_id;
  showSuiteCreated();
});

// ─── create suite from textarea ────────────────────────────────────────────
$("#create-suite").addEventListener("click", async () => {
  const raw = $("#input-json").value.trim();
  if (!raw) {
    alert("paste or load a suite definition first");
    return;
  }
  let payload;
  try {
    payload = JSON.parse(raw);
  } catch (e) {
    alert("invalid JSON: " + e);
    return;
  }
  const res = await fetch("/api/suites", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    alert("create failed: " + (await res.text()));
    return;
  }
  const { suite_id } = await res.json();
  state.suiteId = suite_id;
  showSuiteCreated();
});

function showSuiteCreated() {
  $("#suite-id-display").textContent = `suite_id = ${state.suiteId}`;
  $("#step-matrix").classList.remove("hidden");
  $("#step-matrix").scrollIntoView({ behavior: "smooth" });
}

// ─── generate matrix ───────────────────────────────────────────────────────
$("#gen-matrix").addEventListener("click", async () => {
  if (!state.suiteId) return;
  const max_rows = Number($("#max-rows").value) || 20;
  const res = await fetch(`/api/suites/${state.suiteId}/matrix`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ max_rows, seed: 1234 }),
  });
  if (!res.ok) {
    alert("matrix failed: " + (await res.text()));
    return;
  }
  const { variables, matrix } = await res.json();
  state.variables = variables;
  state.matrix = matrix;
  renderVariables(variables);
  renderMatrix(matrix);
  $("#step-run").classList.remove("hidden");
});

function levelLabel(lv) {
  if (lv && typeof lv === "object" && "value" in lv) {
    return `${JSON.stringify(lv.value)} (${lv.role})`;
  }
  return JSON.stringify(lv);
}

function levelClass(lv) {
  if (lv && typeof lv === "object" && lv.role) {
    return `level role-${lv.role}`;
  }
  return "level";
}

function renderVariables(vars) {
  const root = $("#variables-view");
  root.innerHTML = "";
  root.classList.remove("hidden");

  const factors = vars.factors;
  const grid = el("div", { class: "factors" });
  factors.forEach((f) => {
    const card = el("div", { class: "factor" });
    card.appendChild(el("h4", {}, `${f.name}  · ${f.kind}`));
    const lvls = el("div", { class: "levels" });
    f.levels.forEach((lv) => lvls.appendChild(el("span", { class: levelClass(lv) }, levelLabel(lv))));
    card.appendChild(lvls);
    grid.appendChild(card);
  });

  root.appendChild(el("h3", { class: "muted" }, `Discovered ${factors.length} factors`));
  root.appendChild(grid);
}

function renderMatrix(matrix) {
  const root = $("#matrix-view");
  root.innerHTML = "";
  root.classList.remove("hidden");

  root.appendChild(
    el(
      "div",
      { class: "coverage" },
      el("span", {}, "rows: "),
      el("strong", {}, String(matrix.rows.length)),
      el("span", {}, " · 3-way coverage: "),
      el("strong", {}, `${matrix.coverage_percent}%`),
      el("span", {}, ` of ${matrix.total_triplets} triplets`)
    )
  );

  const wrap = el("div", { class: "matrix-wrap" });
  const table = el("table", { class: "matrix" });
  const head = el("tr", {}, el("th", {}, "#"), ...matrix.factors.map((f) => el("th", {}, f.name)));
  table.appendChild(head);
  matrix.rows.forEach((r, i) => {
    const tr = el("tr", {}, el("td", {}, String(i + 1)));
    matrix.factors.forEach((f) => tr.appendChild(el("td", {}, levelLabel(r.assignments[f.name]))));
    table.appendChild(tr);
  });
  wrap.appendChild(table);
  root.appendChild(wrap);
}

// ─── run suite ─────────────────────────────────────────────────────────────
$("#run-suite").addEventListener("click", async () => {
  if (!state.suiteId) return;
  state.events = [];
  $("#progress-view").innerHTML = "";
  $("#progress-view").classList.remove("hidden");
  $("#run-suite").disabled = true;
  $("#run-suite").textContent = "Running…";

  const res = await fetch(`/api/suites/${state.suiteId}/run`, { method: "POST" });
  if (!res.ok) {
    alert("run failed: " + (await res.text()));
    $("#run-suite").disabled = false;
    $("#run-suite").textContent = "Run with MCTS";
    return;
  }

  const events = new EventSource(`/api/suites/${state.suiteId}/events`);
  events.onmessage = (m) => {
    const ev = JSON.parse(m.data);
    state.events.push(ev);
    renderEvent(ev);
    if (ev.kind === "done" || ev.kind === "error") {
      events.close();
      finalize();
    }
  };
  events.onerror = () => events.close();
});

function renderEvent(ev) {
  let log = $("#event-log");
  if (!log) {
    log = el("div", { id: "event-log", class: "event-log" });
    $("#progress-view").appendChild(log);
  }
  const tag = ev.kind;
  const summary = (() => {
    switch (ev.kind) {
      case "case_started":
        return `[${ev.payload.i + 1}/${ev.payload.total}] case ${ev.payload.test_id} started`;
      case "iteration":
        return `case ${ev.payload.test_id} iter=${ev.payload.iteration} v=${(ev.payload.root_value || 0).toFixed(3)} verdict=${ev.payload.verdict || "—"}`;
      case "case_completed":
        return `case ${ev.payload.test_id} done · failure=${ev.payload.failure_found} near=${ev.payload.near_miss_found} reward=${ev.payload.best_reward.toFixed(2)}`;
      case "done":
        return `SUITE DONE  · failures=${ev.payload.failures} near=${ev.payload.near_misses} ok=${ev.payload.successes} cost≈$${ev.payload.estimated_cost_usd}`;
      case "error":
        return `ERROR: ${ev.payload.error}`;
      default:
        return JSON.stringify(ev.payload);
    }
  })();
  log.appendChild(
    el("div", { class: "event" }, el("span", { class: `tag ${tag}` }, tag), el("span", {}, summary))
  );
  log.scrollTop = log.scrollHeight;
}

async function finalize() {
  $("#run-suite").disabled = false;
  $("#run-suite").textContent = "Re-run with MCTS";
  const suite = await (await fetch(`/api/suites/${state.suiteId}`)).json();
  if (suite.result) renderResults(suite.result);
}

// ─── results rendering ─────────────────────────────────────────────────────
function renderResults(result) {
  $("#step-results").classList.remove("hidden");
  const root = $("#results-view");
  root.innerHTML = "";

  const s = result.summary;
  root.appendChild(
    el(
      "div",
      { class: "summary" },
      stat(s.total_cases, "test cases"),
      stat(s.failures, "failures (agent broken)", "failure"),
      stat(s.near_misses, "near-misses", "near"),
      stat(s.successes, "clean refusals", "success"),
      stat(s.total_llm_calls, "LLM calls"),
      stat(`$${s.estimated_cost_usd}`, "est. cost (USD)")
    )
  );

  result.cases.forEach((c, i) => root.appendChild(renderCase(c, i)));
}

function stat(num, label, kind = "") {
  return el(
    "div",
    { class: `stat ${kind}` },
    el("div", { class: "num" }, String(num)),
    el("div", { class: "label" }, label)
  );
}

function renderCase(c, i) {
  const verdictClass = c.failure_found ? "failure" : c.near_miss_found ? "near" : "success";
  const verdictText = c.failure_found ? "FAILURE" : c.near_miss_found ? "NEAR-MISS" : "OK";

  const head = el(
    "div",
    { class: "case-head" },
    el(
      "div",
      {},
      el("strong", {}, `Case ${i + 1} · ${c.test_id}`),
      el("span", { class: "muted" }, ` · ${c.iterations} iter · reward=${c.best_reward.toFixed(2)}`)
    ),
    el("span", { class: `verdict ${verdictClass}` }, verdictText)
  );

  const body = el("div", { class: "case-body" });

  const assigns = el("div", { class: "assignments" });
  Object.entries(c.assignments).forEach(([k, v]) => {
    assigns.appendChild(el("span", { class: "assign" }, el("b", {}, `${k}:`), " ", levelLabel(v)));
  });
  body.appendChild(assigns);

  body.appendChild(el("h4", { class: "muted" }, "Most-damning conversation path"));
  body.appendChild(renderTranscript(c.failing_path));

  body.appendChild(el("h4", { class: "muted" }, "Search tree"));
  body.appendChild(renderTree(c.tree));

  const card = el("div", { class: "case" }, head, body);
  head.addEventListener("click", () => card.classList.toggle("open"));
  if (c.failure_found || c.near_miss_found) card.classList.add("open");
  return card;
}

function renderTranscript(turns) {
  const t = el("div", { class: "transcript" });
  if (!turns.length) {
    t.appendChild(el("div", { class: "muted" }, "(no turns recorded)"));
    return t;
  }
  turns.forEach((turn) => {
    const who = turn.role === "tester" ? "TESTER" : turn.role === "agent" ? "AGENT" : "SYSTEM";
    const wrap = el("div", { class: `turn ${turn.role}` });
    wrap.appendChild(el("div", { class: "who" }, who));
    const msg = el("div", { class: "msg" }, turn.content || "");
    if (turn.tool_calls && turn.tool_calls.length) {
      turn.tool_calls.forEach((tc) =>
        msg.appendChild(
          el("div", { class: "tool-call" }, `→ ${tc.name}(${JSON.stringify(tc.arguments)})`)
        )
      );
    }
    wrap.appendChild(msg);
    t.appendChild(wrap);
  });
  return t;
}

function verdictDotClass(ev) {
  if (!ev) return "neutral";
  switch (ev.verdict) {
    case "agent_failure":
      return "failure";
    case "near_miss":
      return "near";
    case "agent_success":
      return "success";
    default:
      return "neutral";
  }
}

function renderTree(root) {
  const wrap = el("div", { class: "tree" });
  const ul = el("ul");
  ul.appendChild(renderTreeNode(root, true));
  wrap.appendChild(ul);
  return wrap;
}

function renderTreeNode(node, isRoot = false) {
  const li = el("li");
  const dot = el("span", { class: `verdict-dot ${verdictDotClass(node.evaluation)}` });
  const visits = `v=${node.visits} q=${node.visits ? (node.value / node.visits).toFixed(2) : "—"}`;
  const promptSnip = isRoot ? "<root>" : (node.text_prompt || "").slice(0, 90);
  li.appendChild(dot);
  li.appendChild(el("span", { class: "prompt-snippet" }, promptSnip));
  li.appendChild(el("span", { class: "stats" }, ` ${visits}`));
  if (node.children && node.children.length) {
    const childUl = el("ul");
    node.children.forEach((c) => childUl.appendChild(renderTreeNode(c)));
    li.appendChild(childUl);
  }
  return li;
}
