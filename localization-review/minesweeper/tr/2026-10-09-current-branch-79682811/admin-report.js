(function() {
  const reportCore = window.LocalizationReviewKitAdminReport;
  const backendConfig = window.LRK_BACKEND_CONFIG || {};
  let reviewData = null;
  let lastExport = null;

  function setStatus(message, kind) {
    const status = document.getElementById("admin-status");
    status.textContent = message || "";
    status.className = "submit-status" + (message && kind ? " " + kind : "");
  }

  function setSummary(report) {
    const campaign = document.getElementById("admin-campaign");
    const summary = document.getElementById("admin-summary");
    if (!report) {
      campaign.textContent = "Localization Review Results";
      summary.textContent = "";
      return;
    }

    campaign.textContent = report.campaignId + " / " + report.localeCode;
    summary.textContent =
      report.submissionCount + " reviewers, " +
      report.noteCount + " notes, " +
      report.correctionCount + " suggestions";
  }

  async function loadReviewData() {
    if (reviewData) {
      return reviewData;
    }

    const response = await fetch("review-data.json", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("review-data.json could not be loaded");
    }

    reviewData = await response.json();
    setSummary({
      campaignId: reviewData.campaignId,
      localeCode: reviewData.localeCode,
      submissionCount: 0,
      noteCount: 0,
      correctionCount: 0
    });
    return reviewData;
  }

  async function loadExport() {
    const data = await loadReviewData();
    const token = document.getElementById("admin-token").value.trim();
    if (!token) {
      throw new Error("Enter the admin token first.");
    }

    if (!backendConfig.apiBaseUrl) {
      throw new Error("Backend endpoint is not configured for this package.");
    }

    const url = backendConfig.apiBaseUrl.replace(/\/$/, "") +
      "/admin/export?campaignId=" +
      encodeURIComponent(data.campaignId);
    const response = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: { authorization: "Bearer " + token }
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || "Admin export could not be loaded.");
    }

    lastExport = body;
    document.getElementById("download-export").disabled = false;
    return body;
  }

  function renderReport(report) {
    const root = document.getElementById("admin-report");
    root.innerHTML = "";
    setSummary(report);

    const overview = document.createElement("section");
    overview.className = "admin-card admin-overview";
    overview.innerHTML =
      "<h1>Review Results</h1>" +
      "<div class=\"admin-metrics\">" +
      "<span><strong>" + report.submissionCount + "</strong> reviewers</span>" +
      "<span><strong>" + report.screenCount + "</strong> screenshots</span>" +
      "<span><strong>" + report.noteCount + "</strong> notes</span>" +
      "<span><strong>" + report.correctionCount + "</strong> suggestions</span>" +
      "</div>";
    root.appendChild(overview);

    if (report.screens.length === 0) {
      const empty = document.createElement("section");
      empty.className = "admin-card";
      empty.textContent = "No notes or correction suggestions were submitted.";
      root.appendChild(empty);
      return;
    }

    report.screens.forEach(screen => {
      const card = document.createElement("section");
      card.className = "admin-card";
      const title = document.createElement("h2");
      title.textContent = screen.screenNumber + ". " + screen.screenName;
      card.appendChild(title);

      if (screen.notes.length > 0) {
        card.appendChild(sectionTitle("Notes"));
        card.appendChild(notesTable(screen.notes));
      }

      if (screen.corrections.length > 0) {
        card.appendChild(sectionTitle("Correction Suggestions"));
        card.appendChild(correctionsTable(screen.corrections));
      }

      root.appendChild(card);
    });
  }

  function sectionTitle(text) {
    const title = document.createElement("h3");
    title.textContent = text;
    return title;
  }

  function notesTable(rows) {
    const table = createTable(["Reviewer", "Notes"]);
    rows.forEach(row => {
      appendRow(table, [row.reviewerName, row.note]);
    });
    return table;
  }

  function correctionsTable(rows) {
    const table = createTable(["#", "Key", "English", "Current", "Reviewer", "Suggested"]);
    rows.forEach(row => {
      appendRow(table, [
        String(row.itemNumber),
        row.key,
        row.englishValue,
        row.localizedValue,
        row.reviewerName,
        row.correction
      ]);
    });
    return table;
  }

  function createTable(headers) {
    const table = document.createElement("table");
    const thead = document.createElement("thead");
    const tr = document.createElement("tr");
    headers.forEach(header => {
      const th = document.createElement("th");
      th.textContent = header;
      tr.appendChild(th);
    });
    thead.appendChild(tr);
    table.appendChild(thead);
    table.appendChild(document.createElement("tbody"));
    return table;
  }

  function appendRow(table, values) {
    const tr = document.createElement("tr");
    values.forEach(value => {
      const td = document.createElement("td");
      td.textContent = value || "";
      tr.appendChild(td);
    });
    table.querySelector("tbody").appendChild(tr);
  }

  function downloadExport() {
    if (!lastExport) {
      return;
    }

    const blob = new Blob([JSON.stringify(lastExport, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = (lastExport.campaignId || "localization-review") + "-export.json";
    document.body.appendChild(link);
    link.click();
    URL.revokeObjectURL(link.href);
    link.remove();
  }

  async function loadAndRender() {
    const button = document.getElementById("load-results");
    button.disabled = true;
    setStatus("Loading review results...", "info");
    try {
      const data = await loadReviewData();
      const exportData = await loadExport();
      const report = reportCore.buildReport(data, exportData);
      renderReport(report);
      setStatus("Review results loaded.", "success");
    } catch (error) {
      setStatus(error.message || "Review results could not be loaded.", "error");
    } finally {
      button.disabled = false;
    }
  }

  document.getElementById("load-results").addEventListener("click", loadAndRender);
  document.getElementById("download-export").addEventListener("click", downloadExport);
  document.getElementById("admin-token").addEventListener("keydown", event => {
    if (event.key === "Enter") {
      loadAndRender();
    }
  });

  loadReviewData().catch(error => {
    setStatus(error.message || "The review package could not be loaded.", "error");
  });
})();
