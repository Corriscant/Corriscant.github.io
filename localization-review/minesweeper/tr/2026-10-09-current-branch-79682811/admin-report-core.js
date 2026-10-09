(function(global) {
  function buildReport(reviewData, exportData) {
    const screenIndex = indexScreens(reviewData);
    const notes = buildNotes(screenIndex, exportData);
    const corrections = buildCorrections(screenIndex, exportData);
    const screens = buildScreens(screenIndex, notes, corrections);
    return {
      campaignId: value(exportData && exportData.campaignId, reviewData && reviewData.campaignId),
      localeCode: value(exportData && exportData.localeCode, reviewData && reviewData.localeCode),
      submissionCount: numberValue(exportData && exportData.submissionCount),
      screenCount: screenIndex.ordered.length,
      noteCount: notes.length,
      correctionCount: corrections.length,
      notes: notes,
      corrections: corrections,
      screens: screens
    };
  }

  function indexScreens(reviewData) {
    const ordered = [];
    const byId = new Map();
    (reviewData && reviewData.screens || []).forEach((screen, index) => {
      const record = {
        id: screen.id || "",
        number: index + 1,
        name: screen.name || screen.id || "",
        itemsByNumber: new Map()
      };
      (screen.items || []).forEach(item => {
        record.itemsByNumber.set(Number(item.itemNumber), item);
      });
      ordered.push(record);
      byId.set(record.id, record);
    });

    return { ordered: ordered, byId: byId };
  }

  function buildNotes(screenIndex, exportData) {
    const rows = [];
    (exportData && exportData.screenNotesByScenario || []).forEach(group => {
      const screen = screenIndex.byId.get(group.scenarioId) || missingScreen(group.scenarioId);
      (group.notes || []).forEach(note => {
        const text = String(note.note || "").trim();
        if (!text) {
          return;
        }

        rows.push({
          screenNumber: screen.number,
          screenName: screen.name,
          scenarioId: screen.id,
          reviewerName: note.reviewerName || "",
          note: text
        });
      });
    });

    return rows.sort(compareScreenRows);
  }

  function buildCorrections(screenIndex, exportData) {
    const rows = [];
    (exportData && exportData.correctionsByKey || []).forEach(group => {
      const screen = screenIndex.byId.get(group.scenarioId) || missingScreen(group.scenarioId);
      const itemNumber = Number(group.itemNumber);
      const item = screen.itemsByNumber ? screen.itemsByNumber.get(itemNumber) : null;
      (group.suggestions || []).forEach(suggestion => {
        const correction = String(suggestion.correction || "").trim();
        if (!correction) {
          return;
        }

        rows.push({
          screenNumber: screen.number,
          screenName: screen.name,
          scenarioId: screen.id,
          itemNumber: itemNumber,
          key: group.key || (item && item.key) || "",
          englishValue: (item && item.englishValue) || "",
          localizedValue: (item && item.localizedValue) || "",
          reviewerName: suggestion.reviewerName || "",
          correction: correction
        });
      });
    });

    return rows.sort(compareCorrectionRows);
  }

  function buildScreens(screenIndex, notes, corrections) {
    const byId = new Map();
    screenIndex.ordered.forEach(screen => {
      byId.set(screen.id, {
        screenNumber: screen.number,
        screenName: screen.name,
        scenarioId: screen.id,
        notes: [],
        corrections: []
      });
    });

    notes.forEach(note => {
      ensureScreen(byId, note).notes.push(note);
    });
    corrections.forEach(correction => {
      ensureScreen(byId, correction).corrections.push(correction);
    });

    return Array.from(byId.values())
      .filter(screen => screen.notes.length > 0 || screen.corrections.length > 0)
      .sort(compareScreenRows);
  }

  function ensureScreen(byId, row) {
    let screen = byId.get(row.scenarioId);
    if (!screen) {
      screen = {
        screenNumber: row.screenNumber,
        screenName: row.screenName,
        scenarioId: row.scenarioId,
        notes: [],
        corrections: []
      };
      byId.set(row.scenarioId, screen);
    }

    return screen;
  }

  function missingScreen(scenarioId) {
    return {
      id: scenarioId || "",
      number: 0,
      name: scenarioId || "Unknown screen",
      itemsByNumber: new Map()
    };
  }

  function compareScreenRows(left, right) {
    const screen = Number(left.screenNumber) - Number(right.screenNumber);
    if (screen !== 0) {
      return screen;
    }

    return String(left.scenarioId).localeCompare(String(right.scenarioId));
  }

  function compareCorrectionRows(left, right) {
    const screen = compareScreenRows(left, right);
    if (screen !== 0) {
      return screen;
    }

    return Number(left.itemNumber) - Number(right.itemNumber);
  }

  function value(primary, fallback) {
    return primary == null || primary === "" ? fallback || "" : primary;
  }

  function numberValue(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  global.LocalizationReviewKitAdminReport = {
    buildReport: buildReport
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
