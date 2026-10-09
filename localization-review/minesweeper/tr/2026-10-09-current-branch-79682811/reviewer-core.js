(function(global) {
  const MaxCorrectionLength = 2000;
  const MaxNoteLength = 4000;
  const NumericFormatTypes = new Set([
    "byte", "sbyte", "short", "ushort", "int", "uint", "long", "ulong",
    "float", "double", "decimal", "bigint", "int16", "uint16", "int32",
    "uint32", "int64", "uint64", "single", "biginteger"
  ]);
  const NumericTokenPattern = /[+\-−]?\p{Nd}+(?:[.,٫٬'\u2019][\p{Nd}]+|[ \u00a0\u202f\u2009]\p{Nd}{3})*(?:%|‰)?/gu;

  function createEmptyState(startedAtClientUtc) {
    return {
      reviewerName: "",
      submissionId: "",
      sessionId: "",
      startedAtClientUtc: startedAtClientUtc || new Date().toISOString(),
      submitCooldownUntilMs: 0,
      imageMode: "fit",
      showPreviouslyOffered: false,
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

  function hasReviewableLocalizedText(item) {
    if (!item || item.localizedValue == null) {
      return false;
    }

    const visibleText = String(item.localizedValue)
      .replace(/<[^>]*>/gu, " ")
      .replace(/[\p{White_Space}\p{Cc}\p{Cf}\p{Cs}\p{M}]/gu, "");
    return visibleText.length > 0;
  }

  function buildDisplayScreens(screens, showPreviouslyOffered) {
    const offeredVariants = new Set();
    return (screens || []).map(screen => {
      const displayItems = [];
      let displayItemNumber = 0;
      let reviewableItemCount = 0;
      let previouslyOfferedCount = 0;
      const sourceItems = screen && Array.isArray(screen.items) ? screen.items : [];

      sourceItems.forEach(item => {
        if (!hasReviewableLocalizedText(item)) {
          return;
        }

        reviewableItemCount++;
        const identity = itemIdentity(item, screen);
        const previouslyOffered = offeredVariants.has(identity);
        if (!previouslyOffered) {
          offeredVariants.add(identity);
        } else {
          previouslyOfferedCount++;
        }

        if (previouslyOffered && !showPreviouslyOffered) {
          return;
        }

        displayItemNumber++;
        displayItems.push({
          item: item,
          displayItemNumber: displayItemNumber,
          isPreviouslyOffered: previouslyOffered
        });
      });

      return {
        screen: screen,
        items: displayItems,
        reviewableItemCount: reviewableItemCount,
        previouslyOfferedCount: previouslyOfferedCount
      };
    });
  }

  function itemIdentity(item, screen) {
    const key = item && item.key != null ? String(item.key) : "";
    const sourceIdentity = key.length > 0
      ? key
      : JSON.stringify([
          "unkeyed-observation",
          screen && screen.id,
          item && item.itemNumber,
          item && item.objectPath
        ]);
    return JSON.stringify([
      sourceIdentity,
      normalizeFormattedNumbers(item),
      formatArgumentIdentity(item)
    ]);
  }

  function normalizeFormattedNumbers(item) {
    const text = item && item.localizedValue != null ? String(item.localizedValue) : "";
    const args = item && Array.isArray(item.formatArguments) ? item.formatArguments : [];
    const types = item && Array.isArray(item.formatArgumentTypes) ? item.formatArgumentTypes : [];
    const matches = findNumericTokensOutsideRichText(text);
    const clockMatches = findClockTokensOutsideRichText(text);
    const replacements = [];

    args.forEach((argument, index) => {
      if (!isNumericFormatArgument(argument, types[index])) {
        return;
      }

      const argumentText = String(argument == null ? "" : argument);
      const exactMatch = findTextArgumentOutsideRichText(text, argumentText, replacements);
      if (exactMatch) {
        replacements.push(exactMatch);
        return;
      }

      const markupArgumentMatches = findMarkupArgumentNumberRanges(text, argumentText, replacements);
      if (markupArgumentMatches.length > 0) {
        replacements.push(...markupArgumentMatches);
        return;
      }

      const argumentValues = numericEquivalents(visibleTextWithoutRichText(argument));
      if (argumentValues.size === 0) {
        return;
      }

      const hasClockValue = Array.from(argumentValues).some(value => {
        return typeof value === "string" && value.startsWith("clock:");
      });
      const candidates = hasClockValue ? clockMatches.concat(matches) : matches;
      const match = candidates.find(candidate => {
        return !rangesOverlap(candidate.index, candidate.index + candidate[0].length, replacements) &&
          setsIntersect(argumentValues, numericEquivalents(candidate[0]));
      });
      if (match) {
        replacements.push({
          start: match.index,
          end: match.index + match[0].length
        });
      }
    });

    replacements.sort((left, right) => right.start - left.start);
    let normalized = text;
    replacements.forEach(replacement => {
      normalized = normalized.substring(0, replacement.start) +
        "\u0001numeric\u0001" +
        normalized.substring(replacement.end);
    });
    return normalized;
  }

  function findNumericTokensOutsideRichText(text) {
    const matches = [];
    const richTextTags = /<[^>]*>/gu;
    let segmentStart = 0;

    const appendSegment = (start, end) => {
      const segment = text.substring(start, end);
      const pattern = new RegExp(NumericTokenPattern.source, NumericTokenPattern.flags);
      for (const match of segment.matchAll(pattern)) {
        matches.push({
          0: match[0],
          index: start + match.index
        });
      }
    };

    for (const tag of text.matchAll(richTextTags)) {
      appendSegment(segmentStart, tag.index);
      segmentStart = tag.index + tag[0].length;
    }
    appendSegment(segmentStart, text.length);
    return matches;
  }

  function findClockTokensOutsideRichText(text) {
    const matches = [];
    const richTextTags = /<[^>]*>/gu;
    let segmentStart = 0;

    const appendSegment = (start, end) => {
      const segment = text.substring(start, end);
      for (const match of segment.matchAll(/[+\-−]?\p{Nd}+(?::\p{Nd}+)+/gu)) {
        matches.push({
          0: match[0],
          index: start + match.index
        });
      }
    };

    for (const tag of text.matchAll(richTextTags)) {
      appendSegment(segmentStart, tag.index);
      segmentStart = tag.index + tag[0].length;
    }
    appendSegment(segmentStart, text.length);
    return matches;
  }
  function findTextArgumentOutsideRichText(text, argument, occupiedRanges) {
    if (!argument.length) {
      return null;
    }

    let result = null;
    let segmentStart = 0;
    const appendSegment = end => {
      if (result) {
        return;
      }

      const segment = text.substring(segmentStart, end);
      let searchFrom = 0;
      while (searchFrom <= segment.length - argument.length) {
        const localStart = segment.indexOf(argument, searchFrom);
        if (localStart < 0) {
          return;
        }

        const start = segmentStart + localStart;
        const finish = start + argument.length;
        if (!isPartOfLargerNumericToken(text, start, finish) &&
            !rangesOverlap(start, finish, occupiedRanges)) {
          result = { start: start, end: finish };
          return;
        }
        searchFrom = localStart + 1;
      }
    };

    for (const tag of text.matchAll(/<[^>]*>/gu)) {
      appendSegment(tag.index);
      if (result) {
        return result;
      }
      segmentStart = tag.index + tag[0].length;
    }
    appendSegment(text.length);
    return result;
  }

  function findMarkupArgumentNumberRanges(text, argument, occupiedRanges) {
    if (!/<[^>]*>/u.test(argument)) {
      return [];
    }

    const argumentNumberRanges = findNumericTokensOutsideRichText(argument);
    if (argumentNumberRanges.length === 0) {
      return [];
    }

    let searchFrom = 0;
    while (searchFrom <= text.length - argument.length) {
      const argumentStart = text.indexOf(argument, searchFrom);
      if (argumentStart < 0) {
        return [];
      }

      const ranges = argumentNumberRanges.map(match => ({
        start: argumentStart + match.index,
        end: argumentStart + match.index + match[0].length
      }));
      if (ranges.every(range => !rangesOverlap(range.start, range.end, occupiedRanges))) {
        return ranges;
      }
      searchFrom = argumentStart + 1;
    }

    return [];
  }
  function isPartOfLargerNumericToken(text, start, end) {
    const before = start > 0 ? text.substring(start - 1, start) : "";
    const beforeBefore = start > 1 ? text.substring(start - 2, start - 1) : "";
    const after = end < text.length ? text.substring(end, end + 1) : "";
    const afterAfter = end + 1 < text.length ? text.substring(end + 1, end + 2) : "";
    return isDecimalDigit(before) ||
      (isNumericSeparator(before) && isDecimalDigit(beforeBefore)) ||
      isDecimalDigit(after) ||
      (isNumericSeparator(after) && isDecimalDigit(afterAfter));
  }

  function isDecimalDigit(value) {
    return value.length > 0 && /\p{Nd}/u.test(value);
  }

  function isNumericSeparator(value) {
    return value.length > 0 &&
      (/[\p{White_Space}.,:\/'’+\-−()%‰\u066b\u066c]/u.test(value));
  }

  function rangesOverlap(start, end, ranges) {
    return ranges.some(range => start < range.end && end > range.start);
  }

  function isNumericFormatArgument(argument, type) {
    return isNumericFormatType(type) || isNumericStringArgument(argument);
  }

  function isNumericStringArgument(argument) {
    const text = visibleTextWithoutRichText(argument).trim();
    return /\p{Nd}/u.test(text) &&
      /^[\p{Nd}\p{White_Space}.,:\/'’+\-−()%‰\u066b\u066c]+$/u.test(text);
  }

  function visibleTextWithoutRichText(value) {
    return String(value == null ? "" : value).replace(/<[^>]*>/gu, " ");
  }

  function normalizeVisibleNumericTokens(text) {
    const replacements = findNumericTokensOutsideRichText(text).map(match => ({
      start: match.index,
      end: match.index + match[0].length
    })).sort((left, right) => right.start - left.start);
    let normalized = text;
    replacements.forEach(replacement => {
      normalized = normalized.substring(0, replacement.start) +
        "\u0001numeric\u0001" +
        normalized.substring(replacement.end);
    });
    return normalized;
  }

  function formatArgumentIdentity(item) {
    const args = item && Array.isArray(item.formatArguments) ? item.formatArguments : [];
    const types = item && Array.isArray(item.formatArgumentTypes) ? item.formatArgumentTypes : [];
    const lexicalArguments = [];
    args.forEach((argument, index) => {
      if (isNumericFormatType(types[index])) {
        return;
      }

      const argumentText = String(argument == null ? "" : argument);
      if (isNumericStringArgument(argument)) {
        if (/<[^>]*>/u.test(argumentText)) {
          lexicalArguments.push(index + ":" + normalizeVisibleNumericTokens(argumentText));
        }
        return;
      }

      lexicalArguments.push(index + ":" + argumentText);
    });
    return lexicalArguments;
  }

  function isNumericFormatType(type) {
    const name = String(type == null ? "" : type)
      .trim()
      .replace(/\?$/u, "")
      .split(/[.+]/u)
      .pop()
      .toLowerCase();
    return NumericFormatTypes.has(name);
  }

  function numericEquivalents(value) {
    const normalizedDigits = normalizeDecimalDigits(String(value == null ? "" : value))
      .trim()
      .replace(/[−\u2212]/gu, "-")
      .replace(/[%‰]/gu, "")
      .replace(/[ \u00a0\u202f\u2009'’\u066c]/gu, "");
    const results = new Set();
    const clockParts = normalizedDigits.match(/^[+\-]?\d+(?::\d+)+$/u);
    if (clockParts) {
      results.add("clock:" + clockParts[0].split(":").map(part => String(Number(part))).join(":"));
      return results;
    }

    const add = candidate => {
      const parsed = Number(candidate.replace(/\u066b/gu, "."));
      if (Number.isFinite(parsed)) {
        results.add(parsed);
      }
    };

    add(normalizedDigits);
    if (/[.,]/u.test(normalizedDigits)) {
      const separatorGroups = normalizedDigits.match(/[.,]/gu) || [];
      add(normalizedDigits.replace(/[.,]/gu, ""));
      const lastSeparator = Math.max(normalizedDigits.lastIndexOf("."), normalizedDigits.lastIndexOf(","));
      if (lastSeparator >= 0) {
        add(normalizedDigits.substring(0, lastSeparator).replace(/[.,]/gu, "") + "." +
          normalizedDigits.substring(lastSeparator + 1).replace(/[.,]/gu, ""));
      }
      if (separatorGroups.length === 1) {
        add(normalizedDigits.replace(",", "."));
      }
    }

    return results;
  }

  function normalizeDecimalDigits(value) {
    const zeroCodePoints = [
      0x0030, 0x0660, 0x06f0, 0x07c0, 0x0966, 0x09e6, 0x0a66, 0x0ae6,
      0x0b66, 0x0be6, 0x0c66, 0x0ce6, 0x0d66, 0x0de6, 0x0e50, 0x0ed0,
      0x0f20, 0x1040, 0x1090, 0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80,
      0x1a90, 0x1b50, 0x1bb0, 0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900,
      0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10, 0x104a0, 0x10d30, 0x11066,
      0x110f0, 0x11136, 0x111d0, 0x112f0, 0x11450, 0x114d0, 0x11650,
      0x116c0, 0x11730, 0x118e0, 0x11950, 0x11c50, 0x11d50, 0x11da0,
      0x11f50, 0x16a60, 0x16ac0, 0x16b50, 0x1d7ce, 0x1e140, 0x1e2f0,
      0x1e4f0, 0x1e950, 0x1fbf0
    ];
    return Array.from(value, character => {
      const codePoint = character.codePointAt(0);
      const zeroCodePoint = zeroCodePoints.find(candidate => {
        return codePoint >= candidate && codePoint < candidate + 10;
      });
      return zeroCodePoint == null ? character : String(codePoint - zeroCodePoint);
    }).join("");
  }

  function setsIntersect(left, right) {
    for (const value of left) {
      if (right.has(value)) {
        return true;
      }
    }
    return false;
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
      submissionId: settings.submissionId || state.submissionId || createSubmissionId(),
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
    createSubmissionId: createSubmissionId,
    storageKey: storageKey,
    currentScreenState: currentScreenState,
    markerPositionPercent: markerPositionPercent,
    normalizeImageMode: normalizeImageMode,
    hasReviewableLocalizedText: hasReviewableLocalizedText,
    buildDisplayScreens: buildDisplayScreens,
    normalizeNote: normalizeNote,
    buildSubmissionPayload: buildSubmissionPayload,
    validateSubmissionPayload: validateSubmissionPayload
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
