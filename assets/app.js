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

async function renderStats(targets) {
  const grid = document.getElementById("stat-grid");

  for (const m of METRICS) {
    const rows = await loadCSV(m.file);
    const target = targets[m.key];
    const parsed = rows
      .map((r) => ({ date: r.date, value: parseFloat(r[m.valueKey]), notes: r.notes }))
      .filter((r) => r.date && !Number.isNaN(r.value))
      .sort((a, b) => a.date.localeCompare(b.date));

    const latest = parsed[parsed.length - 1] || null;
    const gap = formatGap(m, target, latest ? latest.value : null);

    const card = document.createElement("div");
    card.className = "stat-card";

    const currentText = latest ? m.format(latest.value) : "—";
    const targetText = target.label + (target.range_label ? ` (${target.range_label})` : "");

    card.innerHTML = `
      <div class="stat-head">
        <h3>${m.title}</h3>
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

// ---------- boot ----------

(async function main() {
  const targets = await (await fetch("data/targets.json", { cache: "no-store" })).json();
  await renderStats(targets);
  await initCalendar();
})();
