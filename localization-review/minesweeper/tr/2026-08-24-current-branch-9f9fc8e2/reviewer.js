(function() {
  const core = window.LocalizationReviewKitReviewer;
  const backendConfig = window.LRK_BACKEND_CONFIG || {};
  let data;
  let index = 0;
  let state = {};
  let turnstileToken = "";

  function loadState() {
    const raw = localStorage.getItem(core.storageKey(data));
    try {
      state = raw ? JSON.parse(raw) : core.createEmptyState();
    } catch (error) {
      state = core.createEmptyState();
    }

    if (!state.startedAtClientUtc) {
      state.startedAtClientUtc = new Date().toISOString();
    }

    state.imageMode = core.normalizeImageMode(state.imageMode);
  }

  function saveState() {
    localStorage.setItem(core.storageKey(data), JSON.stringify(state));
  }

  function render() {
    const screen = data.screens[index];
    const screenState = core.currentScreenState(state, screen.id);
    document.getElementById("campaign").textContent = data.campaignId + " / " + data.localeCode;
    document.getElementById("progress").textContent = (index + 1) + " of " + data.screens.length;
    document.getElementById("screen-title").textContent = screen.name;
    document.getElementById("screenshot").src = screen.screenshotPath;
    document.getElementById("screen-ok").checked = !!screenState.ok;
    document.getElementById("image-original").checked = core.normalizeImageMode(state.imageMode) === "original";
    document.getElementById("screen-notes").value = screenState.notes || "";
    document.getElementById("reviewer").value = state.reviewerName || "";
    document.getElementById("company").value = state.honeypot || "";
    document.getElementById("prev").disabled = index === 0;
    document.getElementById("next").disabled = index === data.screens.length - 1;
    renderMarkers(screen);
    renderItems(screen, screenState);
    applyImageMode(screen);
    document.getElementById("payload").textContent = "";
  }

  function applyImageMode(screen) {
    const mode = core.normalizeImageMode(state.imageMode);
    const wrap = document.getElementById("shot-wrap");
    const frame = document.getElementById("shot-frame");
    wrap.classList.toggle("fit", mode === "fit");
    wrap.classList.toggle("original", mode === "original");

    if (!screen || !screen.imageWidth || !screen.imageHeight) {
      frame.style.width = "";
      return;
    }

    if (mode === "original") {
      frame.style.width = screen.imageWidth + "px";
      return;
    }

    const styles = window.getComputedStyle(wrap);
    const paddingX = parseFloat(styles.paddingLeft || "0") + parseFloat(styles.paddingRight || "0");
    const paddingY = parseFloat(styles.paddingTop || "0") + parseFloat(styles.paddingBottom || "0");
    const availableWidth = Math.max(1, wrap.clientWidth - paddingX);
    const availableHeight = Math.max(1, wrap.clientHeight - paddingY);
    const scale = Math.min(
      availableWidth / screen.imageWidth,
      availableHeight / screen.imageHeight,
      1
    );
    frame.style.width = Math.max(1, Math.floor(screen.imageWidth * scale)) + "px";
  }

  function renderMarkers(screen) {
    const layer = document.getElementById("marker-layer");
    layer.innerHTML = "";
    screen.items.forEach(item => {
      const marker = document.createElement("div");
      const position = core.markerPositionPercent(item, screen);
      marker.className = "marker";
      marker.textContent = item.itemNumber;
      marker.style.left = position.left + "%";
      marker.style.top = position.top + "%";
      layer.appendChild(marker);
    });
  }

  function renderItems(screen, screenState) {
    const root = document.getElementById("items");
    root.innerHTML = "";
    screen.items.forEach(item => {
      const card = document.createElement("section");
      card.className = "item";
      card.dataset.itemNumber = item.itemNumber;
      card.innerHTML =
        "<h2>#" + item.itemNumber + " " + item.key + "</h2>" +
        "<div class=\"value\"><strong>English:</strong> <span></span></div>" +
        "<div class=\"value\"><strong>Current:</strong> <span></span></div>" +
        "<textarea placeholder=\"Correction only\"></textarea>";
      card.querySelectorAll("span")[0].textContent = item.englishValue;
      card.querySelectorAll("span")[1].textContent = item.localizedValue;
      const textarea = card.querySelector("textarea");
      textarea.value = screenState.corrections[item.itemNumber] || "";
      textarea.addEventListener("input", () => {
        screenState.corrections[item.itemNumber] = textarea.value;
        saveState();
      });
      root.appendChild(card);
    });
  }

  async function startBackendSession() {
    if (!backendConfig.apiBaseUrl) {
      return;
    }

    const response = await fetch(backendConfig.apiBaseUrl.replace(/\/$/, "") + "/session/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        campaignId: data.campaignId,
        manifestHash: data.manifestHash,
        localeCode: data.localeCode
      })
    });
    const body = await response.json();
    if (!response.ok) {
      throw new Error(body.error || "Session start failed");
    }

    state.sessionId = body.sessionId;
    saveState();
  }

  function renderTurnstile() {
    if (!backendConfig.turnstileSiteKey || !window.turnstile) {
      return;
    }

    window.turnstile.render("#turnstile-container", {
      sitekey: backendConfig.turnstileSiteKey,
      callback: token => {
        turnstileToken = token;
      }
    });
  }

  async function submitPayload() {
    const payload = core.buildSubmissionPayload(data, state, {
      turnstileToken: turnstileToken
    });
    const validation = core.validateSubmissionPayload(data, payload);
    if (!validation.valid) {
      document.getElementById("payload").textContent = JSON.stringify(validation, null, 2);
      return payload;
    }

    if (!backendConfig.apiBaseUrl) {
      document.getElementById("payload").textContent = JSON.stringify(payload, null, 2);
      return payload;
    }

    const response = await fetch(backendConfig.apiBaseUrl.replace(/\/$/, "") + "/submit", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    document.getElementById("payload").textContent = JSON.stringify(body, null, 2);
    return body;
  }

  document.getElementById("prev").addEventListener("click", () => { if (index > 0) { index--; render(); } });
  document.getElementById("next").addEventListener("click", () => { if (index < data.screens.length - 1) { index++; render(); } });
  document.getElementById("screen-ok").addEventListener("change", event => {
    core.currentScreenState(state, data.screens[index].id).ok = event.target.checked;
    saveState();
  });
  document.getElementById("image-original").addEventListener("change", event => {
    state.imageMode = event.target.checked ? "original" : "fit";
    saveState();
    applyImageMode(data.screens[index]);
  });
  document.getElementById("screen-notes").addEventListener("input", event => {
    core.currentScreenState(state, data.screens[index].id).notes = event.target.value;
    saveState();
  });
  document.getElementById("reviewer").addEventListener("input", event => {
    state.reviewerName = event.target.value;
    saveState();
  });
  document.getElementById("company").addEventListener("input", event => {
    state.honeypot = event.target.value;
    saveState();
  });
  document.getElementById("submit").addEventListener("click", submitPayload);
  window.addEventListener("resize", () => {
    if (data && data.screens && data.screens[index]) {
      applyImageMode(data.screens[index]);
    }
  });

  fetch("review-data.json")
    .then(response => response.json())
    .then(async json => {
      data = json;
      loadState();
      renderTurnstile();
      await startBackendSession();
      render();
    })
    .catch(error => {
      document.getElementById("payload").textContent = error.message;
    });

  window.LocalizationReviewKitReviewerApp = {
    submitPayload: submitPayload,
    render: render
  };
})();
