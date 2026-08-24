(function() {
  const core = window.LocalizationReviewKitReviewer;
  const backendConfig = window.LRK_BACKEND_CONFIG || {};
  let data;
  let index = 0;
  let state = {};
  let turnstileToken = "";
  let turnstileWidgetId = null;
  let backendSessionError = "";
  let markersVisible = true;
  let submissionInFlight = false;
  let submitCooldownTimerId = 0;
  let resubmitCooldownMs = 30000;
  const humanVerificationRequiredMessage = "Please complete Human verification, then press Submit Review again.";

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

    if (!state.submissionId) {
      state.submissionId = core.createSubmissionId();
    }

    if (!Number.isFinite(Number(state.submitCooldownUntilMs))) {
      state.submitCooldownUntilMs = 0;
    }

    if (!Number.isFinite(Number(state.resubmitCooldownMs)) || Number(state.resubmitCooldownMs) <= 0) {
      state.resubmitCooldownMs = resubmitCooldownMs;
    }

    resubmitCooldownMs = Number(state.resubmitCooldownMs);
    state.imageMode = core.normalizeImageMode(state.imageMode);
    saveState();
  }

  function saveState() {
    localStorage.setItem(core.storageKey(data), JSON.stringify(state));
  }

  function render() {
    const screen = data.screens[index];
    const screenState = core.currentScreenState(state, screen.id);
    document.getElementById("campaign").textContent = data.campaignId + " / " + data.localeCode;
    document.getElementById("progress").textContent = (index + 1) + " of " + data.screens.length;
    document.getElementById("screen-title").textContent = screen.name + " (" + (index + 1) + " of " + data.screens.length + ")";
    document.getElementById("screenshot").src = screen.screenshotPath;
    document.getElementById("screen-ok").checked = !!screenState.ok;
    document.getElementById("image-original").checked = core.normalizeImageMode(state.imageMode) === "original";
    document.getElementById("show-markers").checked = markersVisible;
    document.getElementById("screen-notes").value = screenState.notes || "";
    document.getElementById("reviewer").value = state.reviewerName || "";
    document.getElementById("company").value = state.honeypot || "";
    document.getElementById("prev").disabled = index === 0;
    document.getElementById("next").disabled = index === data.screens.length - 1;
    document.getElementById("screen-jump").value = String(index);
    renderMarkers(screen);
    renderItems(screen, screenState);
    applyImageMode(screen);
    setSubmitStatus(backendSessionError, backendSessionError ? "error" : "");
    updateSubmitButtonState();
  }

  function setSubmitStatus(message, kind) {
    const status = document.getElementById("payload");
    status.textContent = message || "";
    status.className = "submit-status" + (message && kind ? " " + kind : "");
  }

  function setSubmitBusy(isBusy) {
    submissionInFlight = isBusy;
    updateSubmitButtonState();
  }

  function updateSubmitButtonState() {
    const button = document.getElementById("submit");
    if (submissionInFlight) {
      button.disabled = true;
      button.textContent = "Submitting...";
      return;
    }

    const remainingSeconds = cooldownRemainingSeconds();
    if (remainingSeconds > 0) {
      button.disabled = true;
      button.textContent = "Submit Review (" + remainingSeconds + "s)";
      return;
    }

    button.disabled = false;
    button.textContent = "Submit Review";
  }

  function cooldownRemainingSeconds() {
    return Math.max(0, Math.ceil(cooldownRemainingMs() / 1000));
  }

  function cooldownRemainingMs() {
    return Math.max(0, Number(state.submitCooldownUntilMs || 0) - Date.now());
  }

  function startSubmitCooldown(milliseconds) {
    state.submitCooldownUntilMs = Date.now() + milliseconds;
    saveState();
    scheduleSubmitCooldownTimer();
    updateSubmitButtonState();
  }

  function scheduleSubmitCooldownTimer() {
    if (submitCooldownTimerId) {
      window.clearInterval(submitCooldownTimerId);
      submitCooldownTimerId = 0;
    }

    if (cooldownRemainingMs() <= 0) {
      state.submitCooldownUntilMs = 0;
      saveState();
      updateSubmitButtonState();
      return;
    }

    submitCooldownTimerId = window.setInterval(() => {
      if (cooldownRemainingMs() <= 0) {
        window.clearInterval(submitCooldownTimerId);
        submitCooldownTimerId = 0;
        state.submitCooldownUntilMs = 0;
        saveState();
      }

      updateSubmitButtonState();
    }, 1000);
  }

  function populateScreenJump() {
    const jump = document.getElementById("screen-jump");
    jump.innerHTML = "";
    data.screens.forEach((screen, screenIndex) => {
      const option = document.createElement("option");
      option.value = String(screenIndex);
      option.textContent = (screenIndex + 1) + ". " + screen.name;
      jump.appendChild(option);
    });
  }

  function setHumanCheckMessage(message) {
    const panel = document.getElementById("human-check");
    const messageNode = document.getElementById("human-check-message");
    messageNode.textContent = message || "";
    panel.classList.toggle("attention", !!message);
    if (message) {
      panel.scrollIntoView({ block: "nearest" });
    }
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
    layer.hidden = !markersVisible;
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

  function resetMarkersForScreenChange() {
    markersVisible = true;
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
    if (!backendConfig.apiBaseUrl || state.sessionId) {
      return;
    }

    try {
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
      applyBackendCooldown(body.resubmitCooldownSeconds);
      backendSessionError = "";
      saveState();
    } catch (error) {
      backendSessionError = "The review server is unavailable. Please refresh the page and try again.";
    }
  }

  function applyBackendCooldown(seconds) {
    const parsedSeconds = Number(seconds);
    if (!Number.isFinite(parsedSeconds) || parsedSeconds <= 0) {
      return;
    }

    resubmitCooldownMs = Math.ceil(parsedSeconds * 1000);
    state.resubmitCooldownMs = resubmitCooldownMs;
  }

  function renderTurnstile() {
    if (!backendConfig.turnstileSiteKey || !window.turnstile) {
      return;
    }

    turnstileWidgetId = window.turnstile.render("#turnstile-container", {
      sitekey: backendConfig.turnstileSiteKey,
      callback: token => {
        turnstileToken = token;
        setHumanCheckMessage("");
      },
      "expired-callback": () => {
        turnstileToken = "";
      },
      "error-callback": () => {
        turnstileToken = "";
        setHumanCheckMessage("Human verification is unavailable. Please refresh the page and try again.");
      }
    });
  }

  function resetTurnstile() {
    turnstileToken = "";
    if (!window.turnstile || turnstileWidgetId === null || typeof window.turnstile.reset !== "function") {
      return;
    }

    window.turnstile.reset(turnstileWidgetId);
  }

  async function submitPayload() {
    if (submissionInFlight) {
      const result = { ok: false, pending: true };
      setSubmitStatus("Review submission is already in progress.", "info");
      return result;
    }

    const remainingSeconds = cooldownRemainingSeconds();
    if (remainingSeconds > 0) {
      const result = { ok: false, retryAfterSeconds: remainingSeconds };
      setSubmitStatus("Please wait " + remainingSeconds + " seconds before submitting again.", "info");
      updateSubmitButtonState();
      return result;
    }

    if (backendConfig.apiBaseUrl && backendConfig.turnstileSiteKey && !turnstileToken) {
      const error = { error: humanVerificationRequiredMessage };
      setHumanCheckMessage(humanVerificationRequiredMessage);
      setSubmitStatus(humanVerificationRequiredMessage, "error");
      return error;
    }

    const payload = core.buildSubmissionPayload(data, state, {
      turnstileToken: turnstileToken
    });
    const validation = core.validateSubmissionPayload(data, payload);
    if (!validation.valid) {
      setSubmitStatus("The review could not be prepared. Please refresh the page and try again.", "error");
      return payload;
    }

    if (!backendConfig.apiBaseUrl) {
      setSubmitStatus("Online submission is not configured for this review package. Please contact the project owner.", "error");
      return payload;
    }

    if (!state.sessionId) {
      setSubmitStatus("The review session is not ready. Please refresh the page and try again.", "error");
      return payload;
    }

    submissionInFlight = true;
    setSubmitBusy(true);
    setSubmitStatus("Submitting review...", "info");
    try {
      const response = await fetch(backendConfig.apiBaseUrl.replace(/\/$/, "") + "/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json();
      if (!response.ok) {
        const error = new Error(body.error || "Submission failed");
        error.retryAfterSeconds = Number(body.retryAfterSeconds || 0);
        throw error;
      }

      const cooldownSeconds = Math.ceil(resubmitCooldownMs / 1000);
      setSubmitStatus("Review submitted. You can send updates in " + cooldownSeconds + " seconds.", "success");
      startSubmitCooldown(resubmitCooldownMs);
      return body;
    } catch (error) {
      if (Number.isFinite(error.retryAfterSeconds) && error.retryAfterSeconds > 0) {
        startSubmitCooldown(error.retryAfterSeconds * 1000);
        const retryMessage = "Please wait " + Math.ceil(error.retryAfterSeconds) + " seconds before submitting again.";
        setSubmitStatus(retryMessage, "error");
        return { error: retryMessage, details: error.message };
      }

      const message = "Review could not be submitted. Please try again.";
      setSubmitStatus(message, "error");
      return { error: message, details: error.message };
    } finally {
      resetTurnstile();
      setSubmitBusy(false);
    }
  }

  document.getElementById("prev").addEventListener("click", () => { if (index > 0) { index--; resetMarkersForScreenChange(); render(); } });
  document.getElementById("next").addEventListener("click", () => { if (index < data.screens.length - 1) { index++; resetMarkersForScreenChange(); render(); } });
  document.getElementById("screen-jump").addEventListener("change", event => {
    const requestedIndex = Number.parseInt(event.target.value, 10);
    if (Number.isInteger(requestedIndex) && requestedIndex >= 0 && data && requestedIndex < data.screens.length) {
      index = requestedIndex;
      resetMarkersForScreenChange();
      render();
    }
  });
  document.getElementById("screen-ok").addEventListener("change", event => {
    core.currentScreenState(state, data.screens[index].id).ok = event.target.checked;
    saveState();
  });
  document.getElementById("image-original").addEventListener("change", event => {
    state.imageMode = event.target.checked ? "original" : "fit";
    saveState();
    applyImageMode(data.screens[index]);
  });
  document.getElementById("show-markers").addEventListener("change", event => {
    markersVisible = event.target.checked;
    renderMarkers(data.screens[index]);
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
      populateScreenJump();
      renderTurnstile();
      await startBackendSession();
      render();
      scheduleSubmitCooldownTimer();
    })
    .catch(error => {
      setSubmitStatus("The review package could not be loaded. Please refresh the page and try again.", "error");
    });

  window.LocalizationReviewKitReviewerApp = {
    submitPayload: submitPayload,
    render: render
  };
})();
