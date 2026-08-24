(function(global) {
  const MaxCorrectionLength = 2000;
  const MaxNoteLength = 4000;

  function createEmptyState(startedAtClientUtc) {
    return {
      reviewerName: "",
      sessionId: "",
      startedAtClientUtc: startedAtClientUtc || new Date().toISOString(),
      imageMode: "fit",
      screens: {},
      honeypot: ""
    };
  }

  function storageKey(data) {
    return "lrk:" + data.campaignId + ":" + data.manifestHash;
  }

  function currentScreenState(state, screenId) {
    if (!state.screens) {
      state.screens = {};
    }

    if (!state.screens[screenId]) {
      state.screens[screenId] = { ok: false, notes: "", corrections: {} };
    }

    if (!state.screens[screenId].corrections) {
      state.screens[screenId].corrections = {};
    }

    if (typeof state.screens[screenId].notes !== "string") {
      state.screens[screenId].notes = "";
    }

    return state.screens[screenId];
  }

  function markerPositionPercent(item, screen) {
    return {
      left: item.markerAnchor.x / screen.imageWidth * 100,
      top: item.markerAnchor.y / screen.imageHeight * 100
    };
  }

  function normalizeImageMode(value) {
    return value === "original" ? "original" : "fit";
  }

  function normalizeCorrection(value) {
    const text = value == null ? "" : String(value).trim();
    return text.length > MaxCorrectionLength ? text.substring(0, MaxCorrectionLength) : text;
  }

  function normalizeNote(value) {
    const text = value == null ? "" : String(value).trim();
    return text.length > MaxNoteLength ? text.substring(0, MaxNoteLength) : text;
  }

  function createSubmissionId() {
    if (global.crypto && typeof global.crypto.randomUUID === "function") {
      return global.crypto.randomUUID();
    }

    return "submission-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
  }

  function buildSubmissionPayload(data, state, options) {
    const settings = options || {};
    const payloadScreens = data.screens.map(screen => {
      const screenState = currentScreenState(state, screen.id);
      const items = screen.items
        .map(item => ({
          itemNumber: item.itemNumber,
          key: item.key,
          correction: normalizeCorrection(screenState.corrections[item.itemNumber])
        }))
        .filter(item => item.correction.length > 0);
      return {
        scenarioId: screen.id,
        ok: !!screenState.ok,
        notes: normalizeNote(screenState.notes),
        items: items
      };
    });

    return {
      submissionId: settings.submissionId || createSubmissionId(),
      campaignId: data.campaignId,
      manifestHash: data.manifestHash,
      localeCode: data.localeCode,
      sessionId: settings.sessionId || state.sessionId || "",
      reviewerName: state.reviewerName || "",
      startedAtClientUtc: state.startedAtClientUtc || "",
      submittedAtClientUtc: settings.submittedAtClientUtc || new Date().toISOString(),
      turnstileToken: settings.turnstileToken || "",
      honeypot: state.honeypot || "",
      screens: payloadScreens
    };
  }

  function validateSubmissionPayload(data, payload) {
    const errors = [];
    if (!payload || payload.campaignId !== data.campaignId) {
      errors.push("campaignId mismatch");
    }

    if (!payload || payload.manifestHash !== data.manifestHash) {
      errors.push("manifestHash mismatch");
    }

    if (!payload || payload.localeCode !== data.localeCode) {
      errors.push("localeCode mismatch");
    }

    const screensById = {};
    data.screens.forEach(screen => {
      screensById[screen.id] = screen;
    });

    if (!payload || !Array.isArray(payload.screens)) {
      errors.push("screens missing");
      return { valid: false, errors: errors };
    }

    payload.screens.forEach(screenPayload => {
      const screen = screensById[screenPayload.scenarioId];
      if (!screen) {
        errors.push("unknown scenario " + screenPayload.scenarioId);
        return;
      }

      const itemsByNumber = {};
      screen.items.forEach(item => {
        itemsByNumber[item.itemNumber] = item;
      });

      if (!Array.isArray(screenPayload.items)) {
        errors.push("items missing for " + screenPayload.scenarioId);
        return;
      }

      if (typeof screenPayload.notes !== "string") {
        errors.push("notes missing for " + screenPayload.scenarioId);
      } else if (screenPayload.notes.length > MaxNoteLength) {
        errors.push("notes too long for " + screenPayload.scenarioId);
      }

      screenPayload.items.forEach(itemPayload => {
        const item = itemsByNumber[itemPayload.itemNumber];
        if (!item || item.key !== itemPayload.key) {
          errors.push("unknown item " + screenPayload.scenarioId + "#" + itemPayload.itemNumber);
        }
      });
    });

    return { valid: errors.length === 0, errors: errors };
  }

  global.LocalizationReviewKitReviewer = {
    createEmptyState: createEmptyState,
    storageKey: storageKey,
    currentScreenState: currentScreenState,
    markerPositionPercent: markerPositionPercent,
    normalizeImageMode: normalizeImageMode,
    normalizeNote: normalizeNote,
    buildSubmissionPayload: buildSubmissionPayload,
    validateSubmissionPayload: validateSubmissionPayload
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
