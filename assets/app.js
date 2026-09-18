// ---------- helpers ----------

function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 1) return [];
  const headers = splitCSVLine(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitCSVLine(lines[i]);
    const row = {};
    headers.forEach((h, idx) => (row[h] = cells[idx] ?? ""));
    rows.push(row);
  }
  return rows;
}

function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function secToClock(sec) {
  sec = Math.round(sec);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

async function loadCSV(path) {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) return [];
  return parseCSV(await res.text());
}

// ---------- stat cards ----------

const METRICS = [
  {
    key: "vo2",
    title: "VO₂max",
    file: "data/vo2.csv",
    valueKey: "vo2max",
    format: (v) => `${v.toFixed(1)} mL/kg/min`,
  },
  {
    key: "bodyweight",
    title: "Body weight",
    file: "data/bodyweight.csv",
    valueKey: "lbs",
    format: (v) => `${v.toFixed(1)} lb`,
  },
  {
    key: "css",
    title: "CSS (swim, 100yd pace)",
    file: "data/css.csv",
    valueKey: "seconds_per_100yd",
    format: (v) => `${secToClock(v)}/100yd`,
  },
  {
    key: "ftp",
    title: "FTP (bike)",
    file: "data/ftp.csv",
    valueKey: "watts",
    format: (v) => `${Math.round(v)} W`,
  },
  {
    key: "run5k",
    title: "5K run",
    file: "data/run5k.csv",
    valueKey: "seconds",
    format: (v) => secToClock(v),
  },
];

function formatGap(metric, target, latestVal) {
  if (latestVal == null) return { text: "no data yet", good: false };
  const diff = target.direction === "down" ? latestVal - target.value : target.value - latestVal;
  if (diff <= 0) {
    return { text: "target reached", good: true };
  }
  let text;
  if (target.unit === "sec/100yd" || target.unit === "sec") {
    text = `${secToClock(diff)} to go`;
  } else {
    text = `${diff.toFixed(1)} ${target.unit} to go`;
  }
  return { text, good: false };
}

function formatProgress(first, latest, target) {
  if (!first || !latest) return null;
  const denom = target.value - first.value;
  if (denom === 0) return null;
  const pct = ((latest.value - first.value) / denom) * 100;
  const rounded = Math.round(pct);
  return { text: `${rounded}% to target`, good: rounded >= 100 };
}

let currentTargets = null;
const metricRowsCache = {};

async function renderStats(targets) {
  currentTargets = targets;
  const grid = document.getElementById("stat-grid");
  grid.innerHTML = "";

  for (const m of METRICS) {
    const rows = await loadCSV(m.file);
    const target = targets[m.key];
    const parsed = rows
      .map((r) => ({ date: r.date, value: parseFloat(r[m.valueKey]), notes: r.notes }))
      .filter((r) => r.date && !Number.isNaN(r.value))
      .sort((a, b) => a.date.localeCompare(b.date));

    metricRowsCache[m.key] = parsed;
    const latest = parsed[parsed.length - 1] || null;
    const first = parsed[0] || null;
    const gap = formatGap(m, target, latest ? latest.value : null);
    const progress = formatProgress(first, latest, target);

    const card = document.createElement("div");
    card.className = "stat-card";

    const currentText = latest ? m.format(latest.value) : "—";
    const targetText = target.label + (target.range_label ? ` (${target.range_label})` : "");

    card.innerHTML = `
      <div class="stat-head">
        <div class="stat-title-row">
          <h3>${m.title}${progress ? ` &mdash; <span class="${progress.good ? "gap-good" : "stat-progress-inline"}">${progress.text}</span>` : ""}</h3>
          <button class="stat-add-btn" data-key="${m.key}">+ Add entry</button>
        </div>
        <div class="stat-current">${currentText}</div>
      </div>
      <div class="stat-row">
        <span>Target: ${targetText}</span>
        <span class="${gap.good ? "gap-good" : ""}">${gap.text}</span>
      </div>
      <div class="chart-box ${parsed.length ? "" : "empty"}" id="chart-${m.key}"></div>
      ${target.note ? `<p class="stat-note">${target.note}</p>` : ""}
    `;
    grid.appendChild(card);

    const box = card.querySelector(`#chart-${m.key}`);
    if (!parsed.length) {
      box.textContent = "No tests logged yet";
      continue;
    }
    const canvas = document.createElement("canvas");
    box.appendChild(canvas);
    drawChart(canvas, parsed, target);
  }

  refreshAddButtonsVisibility();
}

const BLOCK_START = "2026-08-17"; // W1D1
const RACE_DAY = "2027-08-01"; // W50D7

function daysBetween(a, b) {
  return Math.round((new Date(b + "T00:00:00") - new Date(a + "T00:00:00")) / 86400000);
}

function dayIndexToLabel(dayIndex) {
  const d = new Date(BLOCK_START + "T00:00:00");
  d.setDate(d.getDate() + dayIndex);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

// Draws the "today" divider and shades the compressed race-day gap region
// so the axis break reads as intentional rather than a rendering glitch.
const gapShadePlugin = {
  id: "gapShade",
  beforeDatasetsDraw(chart) {
    const cfg = chart.options.plugins && chart.options.plugins.gapShade;
    if (!cfg) return;
    const { ctx, chartArea, scales } = chart;
    const xScale = scales.x;
    const shadePx = xScale.getPixelForValue(cfg.shadeStart);
    ctx.save();
    ctx.fillStyle = cfg.shadeColor;
    ctx.fillRect(shadePx, chartArea.top, chartArea.right - shadePx, chartArea.bottom - chartArea.top);
    const todayPx = xScale.getPixelForValue(cfg.todayX);
    ctx.strokeStyle = cfg.lineColor;
    ctx.setLineDash([3, 3]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(todayPx, chartArea.top);
    ctx.lineTo(todayPx, chartArea.bottom);
    ctx.stroke();
    ctx.restore();
  },
};
Chart.register(gapShadePlugin);

function drawChart(canvas, parsed, target) {
  const styles = getComputedStyle(document.documentElement);
  const seriesColor = styles.getPropertyValue("--series-1").trim();
  const mutedColor = styles.getPropertyValue("--text-muted").trim();
  const gridColor = styles.getPropertyValue("--gridline").trim();
  const surfaceColor = styles.getPropertyValue("--surface-1").trim();

  const isClock = target.unit === "sec/100yd" || target.unit === "sec";

  // x = actual elapsed days since block start (linear, day1 -> today).
  const points = parsed.map((r) => ({ x: daysBetween(BLOCK_START, r.date), y: r.value, date: r.date }));
  const lastPoint = points[points.length - 1];
  const todayX = daysBetween(BLOCK_START, new Date().toISOString().slice(0, 10));

  // Race day sits far beyond "today" on a true date scale (up to 350 days out).
  // Compressing that stretch to a fixed fraction of the history width keeps
  // the historical trend readable instead of squashed into a sliver.
  const historyWidth = Math.max(todayX, 1);
  const gapWidth = Math.max(10, historyWidth * 0.25);
  const gapStart = Math.max(todayX, lastPoint.x);
  const targetX = gapStart + gapWidth;
  const chartMax = targetX + gapWidth * 0.15;

  const tickValues = Array.from(new Set([0, ...points.map((p) => p.x), todayX, targetX])).sort((a, b) => a - b);

  new Chart(canvas.getContext("2d"), {
    type: "line",
    data: {
      datasets: [
        {
          label: "measured",
          data: points,
          borderColor: seriesColor,
          backgroundColor: seriesColor,
          borderWidth: 2,
          pointRadius: 3,
          pointHoverRadius: 5,
          tension: 0,
        },
        {
          label: "target (race day)",
          data: [
            { x: lastPoint.x, y: lastPoint.y },
            { x: targetX, y: target.value },
          ],
          borderColor: mutedColor,
          borderDash: [4, 4],
          borderWidth: 1.5,
          pointRadius: [0, 6],
          pointStyle: "rectRot",
          pointBorderColor: seriesColor,
          pointBackgroundColor: surfaceColor,
          pointBorderWidth: 2,
          fill: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: {
        legend: { display: false },
        gapShade: {
          shadeStart: todayX,
          todayX,
          shadeColor: "color-mix(in srgb, " + mutedColor + " 8%, transparent)",
          lineColor: mutedColor,
        },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const v = ctx.parsed.y;
              const shown = isClock ? secToClock(v) : v;
              return `${ctx.dataset.label}: ${shown}`;
            },
          },
        },
      },
      scales: {
        x: {
          type: "linear",
          min: 0,
          max: chartMax,
          grid: { display: false },
          afterBuildTicks: (axis) => {
            axis.ticks = tickValues.map((v) => ({ value: v }));
          },
          ticks: {
            color: mutedColor,
            maxRotation: 0,
            font: { size: 10 },
            callback: (value) => {
              if (Math.abs(value - targetX) < 0.5) return "Race day";
              if (Math.abs(value - todayX) < 0.5) return "Today";
              return dayIndexToLabel(value);
            },
          },
        },
        y: {
          grid: { color: gridColor },
          ticks: {
            color: mutedColor,
            font: { size: 10 },
            callback: (v) => (isClock ? secToClock(v) : v),
          },
        },
      },
    },
  });
}

// ---------- calendar ----------

function unescapeICS(s) {
  return (s || "")
    .replace(/\\n/g, "\n")
    .replace(/\\,/g, ",")
    .replace(/\\;/g, ";")
    .replace(/\\\\/g, "\\");
}

function parseICS(text) {
  const lines = text.split(/\r?\n/);
  const events = [];
  let cur = null;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { cur = {}; continue; }
    if (line === "END:VEVENT") { if (cur) events.push(cur); cur = null; continue; }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const rawKey = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const key = rawKey.split(";")[0];
    if (key === "DTSTART") {
      const m = value.match(/(\d{4})(\d{2})(\d{2})/);
      if (m) cur.date = `${m[1]}-${m[2]}-${m[3]}`;
    } else if (key === "SUMMARY") {
      cur.summary = unescapeICS(value);
    } else if (key === "DESCRIPTION") {
      cur.description = unescapeICS(value);
    }
  }
  return events;
}

async function loadAllEvents() {
  const eventsByDate = {};
  let manifest;
  try {
    manifest = await (await fetch("calendar/manifest.json", { cache: "no-store" })).json();
  } catch {
    return eventsByDate;
  }
  for (const file of manifest.files || []) {
    try {
      const text = await (await fetch(`calendar/${file}`, { cache: "no-store" })).text();
      for (const ev of parseICS(text)) {
        if (!ev.date) continue;
        (eventsByDate[ev.date] ||= []).push(ev);
      }
    } catch {
      /* skip unreadable file */
    }
  }
  return eventsByDate;
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function renderCalendar(eventsByDate, cursor) {
  const grid = document.getElementById("cal-grid");
  const label = document.getElementById("cal-label");
  grid.innerHTML = "";

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  label.textContent = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  DOW.forEach((d) => {
    const el = document.createElement("div");
    el.className = "cal-dow";
    el.textContent = d;
    grid.appendChild(el);
  });

  const firstOfMonth = new Date(year, month, 1);
  // Monday-start offset
  const startOffset = (firstOfMonth.getDay() + 6) % 7;
  const gridStart = new Date(year, month, 1 - startOffset);

  const todayStr = new Date().toISOString().slice(0, 10);

  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const dateStr = d.toISOString().slice(0, 10);
    const inMonth = d.getMonth() === month;
    const dayEvents = eventsByDate[dateStr] || [];

    const cell = document.createElement("div");
    cell.className = "cal-cell" + (inMonth ? "" : " out") + (dateStr === todayStr ? " today" : "") + (dayEvents.length ? " has-event" : "");
    cell.innerHTML = `<div class="cal-date">${d.getDate()}</div>`;
    if (dayEvents.length) {
      const chip = document.createElement("div");
      chip.className = "cal-event-chip";
      chip.textContent = dayEvents.map((e) => e.summary).join(" / ");
      cell.appendChild(chip);
      cell.addEventListener("click", () => showDetail(dateStr, dayEvents));
    }
    grid.appendChild(cell);
  }
}

function showDetail(dateStr, dayEvents) {
  const detail = document.getElementById("cal-detail");
  detail.classList.add("open");
  const niceDate = new Date(dateStr + "T00:00:00").toLocaleDateString(undefined, {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  detail.innerHTML = `<h4>${niceDate}</h4>` + dayEvents
    .map((e) => `<strong>${e.summary}</strong>\n${e.description || ""}`)
    .join("\n\n");
}

async function initCalendar() {
  const eventsByDate = await loadAllEvents();

  // default to the month containing the earliest upcoming/most-recent event, else today
  const allDates = Object.keys(eventsByDate).sort();
  const todayStr = new Date().toISOString().slice(0, 10);
  const anchorDate = allDates.includes(todayStr) || allDates.some((d) => d >= todayStr)
    ? new Date(todayStr + "T00:00:00")
    : new Date((allDates[allDates.length - 1] || todayStr) + "T00:00:00");

  let cursor = new Date(anchorDate.getFullYear(), anchorDate.getMonth(), 1);

  renderCalendar(eventsByDate, cursor);
  document.getElementById("cal-prev").addEventListener("click", () => {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1);
    renderCalendar(eventsByDate, cursor);
  });
  document.getElementById("cal-next").addEventListener("click", () => {
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
    renderCalendar(eventsByDate, cursor);
  });

  // manifest links list
  try {
    const manifest = await (await fetch("calendar/manifest.json", { cache: "no-store" })).json();
    const list = document.getElementById("cal-files");
    list.innerHTML = "Published schedule files: " + (manifest.files || [])
      .map((f) => `<a href="calendar/${f}">${f}</a>`)
      .join(", ");
  } catch { /* ignore */ }
}

// ---------- countdown ----------

function renderCountdown() {
  const todayStr = new Date().toISOString().slice(0, 10);
  const daysLeft = daysBetween(todayStr, RACE_DAY);
  const dayIndex = daysBetween(BLOCK_START, todayStr); // 0-based, W1D1 = 0
  const week = Math.floor(dayIndex / 7) + 1;
  const dayInWeek = (((dayIndex % 7) + 7) % 7) + 1;

  document.getElementById("countdown-days").textContent = daysLeft >= 0 ? daysLeft : 0;
  document.getElementById("countdown-week").textContent = `W${week}D${dayInWeek}`;
}

// ---------- editing (owner-only, via GitHub Contents API) ----------

const OWNER = "bjwxh";
const REPO = "tri_sub60";
const BRANCH = "main";
const TOKEN_KEY = "tri60_gh_pat";

function getToken() {
  try {
    return localStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

function setToken(token) {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    /* ignore */
  }
}

function clearToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

function refreshAddButtonsVisibility() {
  const unlocked = !!getToken();
  document.querySelectorAll(".stat-add-btn").forEach((btn) => btn.classList.toggle("visible", unlocked));
}

function updateLockUI() {
  const token = getToken();
  const toggle = document.getElementById("lock-toggle");
  toggle.textContent = token ? "✓ Editing unlocked (manage token)" : "Owner? Unlock editing";
  toggle.classList.toggle("unlocked", !!token);
  refreshAddButtonsVisibility();
}

function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function b64DecodeUtf8(b64) {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function csvField(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCSV(headers, rows) {
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => csvField(r[h] ?? "")).join(","));
  }
  return lines.join("\n") + "\n";
}

async function commitEntry(metric, dateStr, value, notes) {
  const token = getToken();
  if (!token) throw new Error("Unlock editing first (see header).");

  const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${metric.file}?ref=${BRANCH}`;
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  const getRes = await fetch(apiUrl, { headers: authHeaders });
  if (!getRes.ok) {
    if (getRes.status === 401) throw new Error("Invalid or expired token.");
    if (getRes.status === 403) throw new Error("Token lacks permission for this repo.");
    throw new Error(`Could not read ${metric.file} (${getRes.status}).`);
  }
  const fileData = await getRes.json();
  const text = b64DecodeUtf8(fileData.content);
  const headers = splitCSVLine(text.trim().split(/\r?\n/)[0]);
  const rows = parseCSV(text);

  if (rows.some((r) => r.date === dateStr)) {
    throw new Error(`An entry for ${dateStr} already exists. Delete it first, then add the new value.`);
  }

  const numStr = Number.isInteger(value) ? String(value) : value.toFixed(1);
  const row = { date: dateStr };
  headers.forEach((h) => {
    if (h !== "date") row[h] = "";
  });
  row[metric.valueKey] = numStr;
  row.notes = notes || "";
  rows.push(row);
  rows.sort((a, b) => a.date.localeCompare(b.date));

  const newContent = buildCSV(headers, rows);
  const putRes = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Log ${metric.title}: ${numStr} on ${dateStr}`,
      content: b64EncodeUtf8(newContent),
      sha: fileData.sha,
      branch: BRANCH,
    }),
  });
  if (!putRes.ok) {
    const body = await putRes.json().catch(() => ({}));
    throw new Error(body.message || `Save failed (${putRes.status}).`);
  }
}

async function deleteEntry(metric, dateStr) {
  const token = getToken();
  if (!token) throw new Error("Unlock editing first (see header).");

  const apiUrl = `https://api.github.com/repos/${OWNER}/${REPO}/contents/${metric.file}?ref=${BRANCH}`;
  const authHeaders = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
  };

  const getRes = await fetch(apiUrl, { headers: authHeaders });
  if (!getRes.ok) {
    if (getRes.status === 401) throw new Error("Invalid or expired token.");
    if (getRes.status === 403) throw new Error("Token lacks permission for this repo.");
    throw new Error(`Could not read ${metric.file} (${getRes.status}).`);
  }
  const fileData = await getRes.json();
  const text = b64DecodeUtf8(fileData.content);
  const headers = splitCSVLine(text.trim().split(/\r?\n/)[0]);
  const rows = parseCSV(text);

  const remaining = rows.filter((r) => r.date !== dateStr);
  if (remaining.length === rows.length) {
    throw new Error(`No entry found for ${dateStr} — it may have already been deleted.`);
  }

  const newContent = buildCSV(headers, remaining);
  const putRes = await fetch(apiUrl, {
    method: "PUT",
    headers: { ...authHeaders, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: `Delete ${metric.title} entry for ${dateStr}`,
      content: b64EncodeUtf8(newContent),
      sha: fileData.sha,
      branch: BRANCH,
    }),
  });
  if (!putRes.ok) {
    const body = await putRes.json().catch(() => ({}));
    throw new Error(body.message || `Delete failed (${putRes.status}).`);
  }
}

function clockToSeconds(str) {
  const m = str.trim().match(/^(\d+):([0-5]\d)$/);
  if (!m) return NaN;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

let activeMetricKey = null;

function isClockMetric(target) {
  return target.unit === "sec/100yd" || target.unit === "sec";
}

function renderExistingEntries(key) {
  const metric = METRICS.find((m) => m.key === key);
  const rows = metricRowsCache[key] || [];
  const list = document.getElementById("entry-list");
  if (!rows.length) {
    list.innerHTML = `<div class="entry-empty">No entries logged yet.</div>`;
    return;
  }
  list.innerHTML = rows
    .slice()
    .reverse()
    .map((r) => {
      const valueText = metric.format(r.value);
      const notesText = r.notes ? ` — ${r.notes}` : "";
      return `
        <div class="entry-row" data-date="${r.date}">
          <span class="entry-row-main">${r.date}: ${valueText}<span class="entry-row-notes">${notesText}</span></span>
          <button class="entry-delete-btn" data-date="${r.date}">Delete</button>
        </div>`;
    })
    .join("");
}

function checkDateConflict() {
  const target = currentTargets[activeMetricKey];
  const metric = METRICS.find((m) => m.key === activeMetricKey);
  const dateStr = document.getElementById("entry-date").value;
  const warnEl = document.getElementById("entry-warning");
  const saveBtn = document.getElementById("entry-save");
  const rows = metricRowsCache[activeMetricKey] || [];
  const existing = rows.find((r) => r.date === dateStr);

  document.querySelectorAll("#entry-list .entry-row").forEach((el) => {
    el.classList.toggle("highlight", el.dataset.date === dateStr && !!existing);
  });

  if (existing) {
    warnEl.textContent = `An entry for ${dateStr} already exists (${metric.format(existing.value)}). Delete it below before adding a new value.`;
    warnEl.classList.add("visible");
    saveBtn.disabled = true;
  } else {
    warnEl.textContent = "";
    warnEl.classList.remove("visible");
    saveBtn.disabled = false;
  }
}

function openEntryModal(key) {
  const metric = METRICS.find((m) => m.key === key);
  const target = currentTargets[key];
  if (!metric || !target) return;
  activeMetricKey = key;

  const isClock = isClockMetric(target);
  document.getElementById("entry-modal-title").textContent = `Add entry — ${metric.title}`;
  document.getElementById("entry-value-label").textContent = isClock ? "Value (m:ss)" : `Value (${target.unit})`;
  const valueInput = document.getElementById("entry-value");
  valueInput.placeholder = isClock ? "1:52" : target.unit;
  valueInput.value = "";
  document.getElementById("entry-date").value = new Date().toISOString().slice(0, 10);
  document.getElementById("entry-notes").value = "";
  document.getElementById("entry-error").textContent = "";
  renderExistingEntries(key);
  checkDateConflict();
  document.getElementById("entry-modal").classList.add("open");
}

function closeEntryModal() {
  document.getElementById("entry-modal").classList.remove("open");
  activeMetricKey = null;
}

async function handleEntrySave() {
  const metric = METRICS.find((m) => m.key === activeMetricKey);
  const target = currentTargets[activeMetricKey];
  const errorEl = document.getElementById("entry-error");
  errorEl.textContent = "";

  const dateStr = document.getElementById("entry-date").value;
  const rawValue = document.getElementById("entry-value").value;
  const notes = document.getElementById("entry-notes").value;
  const isClock = isClockMetric(target);

  if (!dateStr) { errorEl.textContent = "Date is required."; return; }
  const rows = metricRowsCache[activeMetricKey] || [];
  if (rows.some((r) => r.date === dateStr)) {
    errorEl.textContent = `An entry for ${dateStr} already exists. Delete it first.`;
    return;
  }
  const value = isClock ? clockToSeconds(rawValue) : parseFloat(rawValue);
  if (!Number.isFinite(value)) {
    errorEl.textContent = isClock ? "Enter a time like 1:52." : "Enter a numeric value.";
    return;
  }

  const saveBtn = document.getElementById("entry-save");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";
  try {
    await commitEntry(metric, dateStr, value, notes);
    closeEntryModal();
    await renderStats(currentTargets);
  } catch (err) {
    errorEl.textContent = err.message || "Save failed.";
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = "Save to GitHub";
  }
}

async function handleEntryDelete(dateStr) {
  const metric = METRICS.find((m) => m.key === activeMetricKey);
  const errorEl = document.getElementById("entry-error");
  errorEl.textContent = "";
  if (!confirm(`Delete the ${metric.title} entry for ${dateStr}? This can't be undone.`)) return;

  try {
    await deleteEntry(metric, dateStr);
    await renderStats(currentTargets);
    renderExistingEntries(activeMetricKey);
    checkDateConflict();
  } catch (err) {
    errorEl.textContent = err.message || "Delete failed.";
  }
}

function initEditing() {
  updateLockUI();

  document.getElementById("lock-toggle").addEventListener("click", () => {
    document.getElementById("lock-panel").classList.toggle("open");
  });
  document.getElementById("token-save").addEventListener("click", () => {
    const val = document.getElementById("token-input").value.trim();
    if (val) {
      setToken(val);
      document.getElementById("token-input").value = "";
      updateLockUI();
    }
  });
  document.getElementById("token-clear").addEventListener("click", () => {
    clearToken();
    document.getElementById("token-input").value = "";
    updateLockUI();
  });

  document.getElementById("stat-grid").addEventListener("click", (e) => {
    const btn = e.target.closest(".stat-add-btn");
    if (btn) openEntryModal(btn.dataset.key);
  });
  document.getElementById("entry-cancel").addEventListener("click", closeEntryModal);
  document.getElementById("entry-save").addEventListener("click", handleEntrySave);
  document.getElementById("entry-date").addEventListener("change", checkDateConflict);
  document.getElementById("entry-list").addEventListener("click", (e) => {
    const btn = e.target.closest(".entry-delete-btn");
    if (btn) handleEntryDelete(btn.dataset.date);
  });
  document.getElementById("entry-modal").addEventListener("click", (e) => {
    if (e.target.id === "entry-modal") closeEntryModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeEntryModal();
  });
}

// ---------- boot ----------

(async function main() {
  const targets = await (await fetch("data/targets.json", { cache: "no-store" })).json();
  renderCountdown();
  initEditing();
  await renderStats(targets);
  await initCalendar();
})();
