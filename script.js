const PLATFORM_ORDER = ["LAZADA", "SHOPEE", "TIKTOK", "ZALORA"];
const PLATFORM_LABEL = {
  LAZADA: "Lazada",
  SHOPEE: "Shopee",
  TIKTOK: "TikTok",
  ZALORA: "Zalora",
};

let DATA = null;
let currentView = "platform";
let activeFilters = { platform: null, region: null };
let searchTerm = "";

const app = document.getElementById("app");
const filterRail = document.getElementById("filterRail");
const searchInput = document.getElementById("searchInput");

fetch("data/extracted.json")
  .then((r) => {
    if (!r.ok) throw new Error("Could not load data/extracted.json");
    return r.json();
  })
  .then((data) => {
    DATA = data;
    setPageTitle(data);
    buildFilterRail(data);
    render();
  })
  .catch((err) => {
    app.innerHTML = `<div class="empty">Couldn't load updates.<br>${escapeHtml(err.message)}<br><br>If you're opening this file directly (file://), run a local server instead — see README.</div>`;
  });

function setPageTitle(data) {
  const ranges = data.regions.map((r) => r.date_range).filter(Boolean);
  const label = ranges.length ? ranges[0] : "";
  document.getElementById("pageTitle").textContent = "Platform Updates";
  if (label) {
    const eyebrow = document.querySelector(".topbar__eyebrow");
    eyebrow.textContent = `Company Newsletter · ${label}`;
  }
}

function badgeClass(platform) {
  const known = PLATFORM_ORDER.includes(platform);
  return known ? `badge--${platform.toLowerCase()}` : "badge--unknown";
}

function badgeInitial(platform) {
  return (PLATFORM_LABEL[platform] || platform || "?").charAt(0);
}

function buildFilterRail(data) {
  const platforms = new Set();
  const regions = [];
  data.regions.forEach((r) => {
    if (r.updates.length) regions.push(r.region);
    r.updates.forEach((u) => platforms.add(u.platform));
  });

  const orderedPlatforms = PLATFORM_ORDER.filter((p) => platforms.has(p)).concat(
    [...platforms].filter((p) => !PLATFORM_ORDER.includes(p))
  );

  filterRail.innerHTML = "";
  orderedPlatforms.forEach((p) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = PLATFORM_LABEL[p] || p;
    chip.dataset.platform = p;
    chip.addEventListener("click", () => {
      activeFilters.platform = activeFilters.platform === p ? null : p;
      syncChipStates();
      render();
    });
    filterRail.appendChild(chip);
  });

  regions.forEach((r) => {
    const chip = document.createElement("button");
    chip.className = "chip";
    chip.textContent = r;
    chip.dataset.region = r;
    chip.addEventListener("click", () => {
      activeFilters.region = activeFilters.region === r ? null : r;
      syncChipStates();
      render();
    });
    filterRail.appendChild(chip);
  });
}

function syncChipStates() {
  [...filterRail.children].forEach((chip) => {
    const isActive =
      (chip.dataset.platform && chip.dataset.platform === activeFilters.platform) ||
      (chip.dataset.region && chip.dataset.region === activeFilters.region);
    chip.classList.toggle("is-active", !!isActive);
  });
}

document.querySelectorAll(".viewtoggle__btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    currentView = btn.dataset.view;
    document.querySelectorAll(".viewtoggle__btn").forEach((b) => {
      b.classList.toggle("is-active", b === btn);
      b.setAttribute("aria-selected", b === btn ? "true" : "false");
    });
    render();
  });
});

searchInput.addEventListener("input", (e) => {
  searchTerm = e.target.value.trim().toLowerCase();
  render();
});

function matchesFilters(update, regionName) {
  if (activeFilters.platform && update.platform !== activeFilters.platform) return false;
  if (activeFilters.region && regionName !== activeFilters.region) return false;
  if (searchTerm) {
    const haystack = (
      update.title +
      " " +
      regionName +
      " " +
      update.body.map((b) => b.text || "").join(" ")
    ).toLowerCase();
    if (!haystack.includes(searchTerm)) return false;
  }
  return true;
}

function render() {
  if (!DATA) return;
  app.innerHTML = "";
  if (currentView === "platform") renderPlatformView();
  else renderRegionView();
}

function renderPlatformView() {
  const grouped = {};
  DATA.regions.forEach((region) => {
    region.updates.forEach((u) => {
      if (!matchesFilters(u, region.region)) return;
      grouped[u.platform] = grouped[u.platform] || [];
      grouped[u.platform].push({ ...u, region: region.region });
    });
  });

  const platforms = PLATFORM_ORDER.filter((p) => grouped[p]).concat(
    Object.keys(grouped).filter((p) => !PLATFORM_ORDER.includes(p))
  );

  if (!platforms.length) {
    app.innerHTML = `<div class="empty">No updates match your filters.</div>`;
    return;
  }

  platforms.forEach((platform) => {
    const updates = grouped[platform];
    const section = document.createElement("section");
    section.className = "platform-section";

    section.innerHTML = `
      <div class="platform-section__head">
        <span class="badge ${badgeClass(platform)}">${badgeInitial(platform)}</span>
        <h2>${escapeHtml(PLATFORM_LABEL[platform] || platform)}</h2>
        <span class="platform-section__count">${updates.length} update${updates.length === 1 ? "" : "s"}</span>
      </div>
      <div class="card-grid"></div>
    `;

    const grid = section.querySelector(".card-grid");
    updates.forEach((u, idx) => grid.appendChild(renderCard(u, `${platform}-${idx}`)));
    app.appendChild(section);
  });
}

function renderCard(update, id) {
  const card = document.createElement("article");
  card.className = "card";

  const linkHtml = update.link
    ? `<a class="card__link" href="${escapeAttr(update.link)}" target="_blank" rel="noopener">View source ↗</a>`
    : "";

  card.innerHTML = `
    <div class="card__meta"><span>${escapeHtml(update.region)}</span></div>
    <h3 class="card__title">${escapeHtml(update.title)}</h3>
    ${linkHtml}
    <button class="card__toggle" type="button">Show details</button>
    <div class="card__body">${renderBody(update.body)}</div>
  `;

  const toggle = card.querySelector(".card__toggle");
  toggle.addEventListener("click", () => {
    const expanded = card.classList.toggle("is-expanded");
    toggle.textContent = expanded ? "Hide details" : "Show details";
  });

  return card;
}

function renderBody(blocks) {
  let html = "";
  let inList = false;

  const closeList = () => {
    if (inList) {
      html += "</ul>";
      inList = false;
    }
  };

  blocks.forEach((b) => {
    if (b.type === "bullet") {
      if (!inList) {
        html += "<ul>";
        inList = true;
      }
      html += `<li>${escapeHtml(b.text)}</li>`;
    } else {
      closeList();
      if (b.type === "header") {
        html += `<h4>${escapeHtml(b.text)}</h4>`;
      } else if (b.type === "para") {
        html += `<p>${escapeHtml(b.text)}</p>`;
      } else if (b.type === "image") {
        html += `<img src="images/${encodeURIComponent(b.file)}" alt="Screenshot from source slide" loading="lazy">`;
      } else if (b.type === "table") {
        html += renderTable(b.rows);
      }
    }
  });
  closeList();
  return html;
}

function renderTable(rows) {
  if (!rows || !rows.length) return "";
  const [header, ...rest] = rows;
  let html = "<table><thead><tr>";
  header.forEach((c) => (html += `<th>${escapeHtml(c)}</th>`));
  html += "</tr></thead><tbody>";
  rest.forEach((row) => {
    html += "<tr>";
    row.forEach((c) => (html += `<td>${escapeHtml(c)}</td>`));
    html += "</tr>";
  });
  html += "</tbody></table>";
  return html;
}

function renderRegionView() {
  const regions = DATA.regions.filter((r) =>
    r.updates.some((u) => matchesFilters(u, r.region))
  );

  if (!regions.length) {
    app.innerHTML = `<div class="empty">No updates match your filters.</div>`;
    return;
  }

  regions.forEach((region) => {
    const updates = region.updates.filter((u) => matchesFilters(u, region.region));
    if (!updates.length) return;

    const section = document.createElement("section");
    section.className = "region-section";
    section.innerHTML = `
      <div class="region-section__head">
        <h2>${escapeHtml(region.region)}</h2>
        <span class="region-section__date">${escapeHtml(region.date_range || "")}</span>
      </div>
    `;

    updates.forEach((u) => {
      const brief = document.createElement("div");
      brief.className = "brief";
      brief.innerHTML = `
        <span class="badge brief__badge ${badgeClass(u.platform)}">${badgeInitial(u.platform)}</span>
        <div class="brief__content">
          <h3>${escapeHtml(PLATFORM_LABEL[u.platform] || u.platform)} — ${escapeHtml(u.title)}</h3>
          <p>${escapeHtml(briefFor(u))}</p>
          ${u.link ? `<a href="${escapeAttr(u.link)}" target="_blank" rel="noopener">Read more ↗</a>` : ""}
        </div>
      `;
      section.appendChild(brief);
    });

    app.appendChild(section);
  });
}

function briefFor(update) {
  const para = update.body.find((b) => b.type === "para");
  if (para) {
    const sentences = para.text.split(/(?<=[.!?])\s+/);
    return sentences.slice(0, 2).join(" ");
  }
  const header = update.body.find((b) => b.type === "header");
  return header ? header.text : "See source for details.";
}

function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return escapeHtml(str).replace(/"/g, "&quot;");
}
