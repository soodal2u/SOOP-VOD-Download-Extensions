(function (globalScope) {
  const CHAT_ASS_SETTINGS_STORAGE_KEY = 'soop_chat_ass_settings';
  const CHAT_ASS_PREVIEW_CONTEXT_STORAGE_KEY = 'soop_chat_ass_preview_context';
  const CHAT_ASS_SETTINGS_SCHEMA_VERSION = 3;

  const LEGACY_WOW_RIGHT_MID_SETTINGS = Object.freeze({
    showTitle: false,
    titleText: 'SOOP CHAT',
    messageFormat: '{nickname} {message}',
    showBackdrop: false,
    backdropOpacity: 0,
    updateInterval: 12,
    lineLimit: 46,
    panelLeft: 79,
    panelTop: 27,
    panelWidth: 17,
    panelHeight: 42,
    titleFontSize: 28,
    fontSize: 32
  });

  const CHAT_ASS_PRESETS = Object.freeze([
    {
      id: 'wow-right-mid',
      name: '우측 중단 기본',
      description: '게임 화면 우측 중단에 가볍게 띄우는 FHD 템플릿',
      settings: {
        showTitle: false,
        titleText: 'SOOP 채팅',
        messageFormat: '{nickname} {message}',
        showBackdrop: false,
        backdropOpacity: 0,
        updateInterval: 12,
        lineLimit: 42,
        panelLeft: 73,
        panelTop: 24,
        panelWidth: 21,
        panelHeight: 48,
        titleFontSize: 28,
        fontSize: 30,
        fanclubColor: '#BDEFA8',
        supporterColor: '#FFB8D8',
        normalColor: '#B9DEFF',
        subscriberColor: '#D8C0FF'
      }
    },
    {
      id: 'panel-default',
      name: '패널형 기본',
      description: '반투명 배경과 제목을 포함한 고정 패널 템플릿',
      settings: {
        showTitle: true,
        titleText: 'SOOP 채팅',
        messageFormat: '[{nickname}] {message}',
        showBackdrop: true,
        backdropOpacity: 72,
        updateInterval: 11,
        lineLimit: 44,
        panelLeft: 68,
        panelTop: 10,
        panelWidth: 27,
        panelHeight: 70,
        titleFontSize: 26,
        fontSize: 24,
        fanclubColor: '#BDEFA8',
        supporterColor: '#FFB8D8',
        normalColor: '#B9DEFF',
        subscriberColor: '#D8C0FF'
      }
    }
  ]);

  const CHAT_ASS_DEFAULT_SETTINGS = Object.freeze({
    schemaVersion: CHAT_ASS_SETTINGS_SCHEMA_VERSION,
    ...CHAT_ASS_PRESETS[0].settings
  });

  function clamp(value, min, max) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) {
      return min;
    }
    return Math.min(max, Math.max(min, numeric));
  }

  function toBoolean(value, fallback) {
    if (typeof value === 'boolean') {
      return value;
    }
    if (value === 'true' || value === '1' || value === 1) {
      return true;
    }
    if (value === 'false' || value === '0' || value === 0) {
      return false;
    }
    return fallback;
  }

  function numberOrFallback(value, fallback) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : fallback;
  }

  function normalizeHexColorValue(value, fallback) {
    const normalized = String(value || '')
      .trim()
      .replace(/[^#0-9a-f]/gi, '');
    if (/^#[0-9A-F]{6}$/i.test(normalized)) {
      return normalized.toUpperCase();
    }
    if (/^[0-9A-F]{6}$/i.test(normalized)) {
      return `#${normalized.toUpperCase()}`;
    }
    return fallback;
  }

  function mapRange(value, inMin, inMax, outMin, outMax) {
    if (inMax === inMin) {
      return outMin;
    }

    const ratio = (Number(value) - inMin) / (inMax - inMin);
    return outMin + ratio * (outMax - outMin);
  }

  function toPercentFromLegacyRange(value, min, max, fallback) {
    if (!Number.isFinite(Number(value))) {
      return fallback;
    }
    return clamp(Math.round(mapRange(value, min, max, 0, 100)), 0, 100);
  }

  function migrateLegacySettings(source) {
    if (!source || source.schemaVersion === CHAT_ASS_SETTINGS_SCHEMA_VERSION) {
      return source || {};
    }

    const isPrePercentSchema = !source.schemaVersion || Number(source.schemaVersion) < 2;

    const migrated = {
      ...source,
      schemaVersion: CHAT_ASS_SETTINGS_SCHEMA_VERSION,
      updateInterval: isPrePercentSchema
        ? toPercentFromLegacyRange(source.updateInterval, 0.25, 5, CHAT_ASS_DEFAULT_SETTINGS.updateInterval)
        : numberOrFallback(source.updateInterval, CHAT_ASS_DEFAULT_SETTINGS.updateInterval),
      lineLimit: isPrePercentSchema
        ? toPercentFromLegacyRange(source.lineLimit, 3, 12, CHAT_ASS_DEFAULT_SETTINGS.lineLimit)
        : numberOrFallback(source.lineLimit, CHAT_ASS_DEFAULT_SETTINGS.lineLimit),
      titleFontSize: isPrePercentSchema
        ? toPercentFromLegacyRange(source.titleFontSize, 14, 52, CHAT_ASS_DEFAULT_SETTINGS.titleFontSize)
        : numberOrFallback(source.titleFontSize, CHAT_ASS_DEFAULT_SETTINGS.titleFontSize),
      fontSize: isPrePercentSchema
        ? toPercentFromLegacyRange(source.fontSize, 16, 56, CHAT_ASS_DEFAULT_SETTINGS.fontSize)
        : numberOrFallback(source.fontSize, CHAT_ASS_DEFAULT_SETTINGS.fontSize)
    };

    const matchesLegacyRightMid = [
      'showTitle',
      'titleText',
      'messageFormat',
      'showBackdrop',
      'backdropOpacity',
      'updateInterval',
      'lineLimit',
      'panelLeft',
      'panelTop',
      'panelWidth',
      'panelHeight',
      'titleFontSize',
      'fontSize'
    ].every((key) => migrated[key] === LEGACY_WOW_RIGHT_MID_SETTINGS[key]);

    if (matchesLegacyRightMid) {
      return {
        ...migrated,
        ...CHAT_ASS_PRESETS[0].settings,
        schemaVersion: CHAT_ASS_SETTINGS_SCHEMA_VERSION
      };
    }

    if (migrated.titleText === 'SOOP CHAT') {
      migrated.titleText = 'SOOP 채팅';
    }

    return migrated;
  }

  function getDefaultChatAssSettings() {
    return { ...CHAT_ASS_DEFAULT_SETTINGS };
  }

  function normalizeChatAssSettings(input) {
    const source = migrateLegacySettings(input || {});
    const normalized = {
      schemaVersion: CHAT_ASS_SETTINGS_SCHEMA_VERSION,
      showTitle: toBoolean(source.showTitle, CHAT_ASS_DEFAULT_SETTINGS.showTitle),
      titleText: (() => {
        const normalizedTitle = String(source.titleText || CHAT_ASS_DEFAULT_SETTINGS.titleText).trim() || CHAT_ASS_DEFAULT_SETTINGS.titleText;
        return normalizedTitle === 'SOOP CHAT' ? 'SOOP 채팅' : normalizedTitle;
      })(),
      messageFormat: String(source.messageFormat || CHAT_ASS_DEFAULT_SETTINGS.messageFormat).trim() || CHAT_ASS_DEFAULT_SETTINGS.messageFormat,
      showBackdrop: toBoolean(source.showBackdrop, CHAT_ASS_DEFAULT_SETTINGS.showBackdrop),
      backdropOpacity: Math.round(clamp(numberOrFallback(source.backdropOpacity, CHAT_ASS_DEFAULT_SETTINGS.backdropOpacity), 0, 100)),
      updateInterval: Math.round(clamp(numberOrFallback(source.updateInterval, CHAT_ASS_DEFAULT_SETTINGS.updateInterval), 0, 100)),
      lineLimit: Math.round(clamp(numberOrFallback(source.lineLimit, CHAT_ASS_DEFAULT_SETTINGS.lineLimit), 0, 100)),
      panelLeft: Math.round(clamp(numberOrFallback(source.panelLeft, CHAT_ASS_DEFAULT_SETTINGS.panelLeft), 0, 100)),
      panelTop: Math.round(clamp(numberOrFallback(source.panelTop, CHAT_ASS_DEFAULT_SETTINGS.panelTop), 0, 100)),
      panelWidth: Math.round(clamp(numberOrFallback(source.panelWidth, CHAT_ASS_DEFAULT_SETTINGS.panelWidth), 0, 100)),
      panelHeight: Math.round(clamp(numberOrFallback(source.panelHeight, CHAT_ASS_DEFAULT_SETTINGS.panelHeight), 0, 100)),
      titleFontSize: Math.round(clamp(numberOrFallback(source.titleFontSize, CHAT_ASS_DEFAULT_SETTINGS.titleFontSize), 0, 100)),
      fontSize: Math.round(clamp(numberOrFallback(source.fontSize, CHAT_ASS_DEFAULT_SETTINGS.fontSize), 0, 100)),
      fanclubColor: normalizeHexColorValue(source.fanclubColor, CHAT_ASS_DEFAULT_SETTINGS.fanclubColor),
      supporterColor: normalizeHexColorValue(source.supporterColor, CHAT_ASS_DEFAULT_SETTINGS.supporterColor),
      normalColor: normalizeHexColorValue(source.normalColor, CHAT_ASS_DEFAULT_SETTINGS.normalColor),
      subscriberColor: normalizeHexColorValue(source.subscriberColor, CHAT_ASS_DEFAULT_SETTINGS.subscriberColor)
    };

    if (normalized.panelLeft + normalized.panelWidth > 100) {
      normalized.panelLeft = Math.max(0, 100 - normalized.panelWidth);
    }

    if (normalized.panelTop + normalized.panelHeight > 100) {
      normalized.panelTop = Math.max(0, 100 - normalized.panelHeight);
    }

    return normalized;
  }

  function resolveChatAssRuntimeSettings(input) {
    const normalized = normalizeChatAssSettings(input);
    return {
      ...normalized,
      updateIntervalSeconds: Number(mapRange(normalized.updateInterval, 0, 100, 0.25, 5).toFixed(2)),
      lineLimitCount: Math.round(mapRange(normalized.lineLimit, 0, 100, 3, 12)),
      titleFontPixels: Math.round(mapRange(normalized.titleFontSize, 0, 100, 14, 52)),
      fontPixels: Math.round(mapRange(normalized.fontSize, 0, 100, 16, 56))
    };
  }

  function loadChatAssSettings() {
    try {
      const raw = globalScope.localStorage.getItem(CHAT_ASS_SETTINGS_STORAGE_KEY);
      return normalizeChatAssSettings(raw ? JSON.parse(raw) : {});
    } catch (error) {
      return getDefaultChatAssSettings();
    }
  }

  function saveChatAssSettings(settings) {
    const normalized = normalizeChatAssSettings(settings);
    globalScope.localStorage.setItem(CHAT_ASS_SETTINGS_STORAGE_KEY, JSON.stringify(normalized));
    return normalized;
  }

  function resetChatAssSettings() {
    const defaults = getDefaultChatAssSettings();
    globalScope.localStorage.removeItem(CHAT_ASS_SETTINGS_STORAGE_KEY);
    globalScope.localStorage.setItem(CHAT_ASS_SETTINGS_STORAGE_KEY, JSON.stringify(defaults));
    return defaults;
  }

  function loadChatAssPreviewContext() {
    try {
      const raw = globalScope.localStorage.getItem(CHAT_ASS_PREVIEW_CONTEXT_STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (error) {
      return null;
    }
  }

  function getChatAssPresets() {
    return CHAT_ASS_PRESETS.map((preset) => ({
      ...preset,
      settings: normalizeChatAssSettings({
        ...CHAT_ASS_DEFAULT_SETTINGS,
        ...preset.settings
      })
    }));
  }

  function getChatAssPresetById(presetId) {
    return getChatAssPresets().find((preset) => preset.id === presetId) || null;
  }

  function saveChatAssPreviewContext(context) {
    globalScope.localStorage.setItem(CHAT_ASS_PREVIEW_CONTEXT_STORAGE_KEY, JSON.stringify(context || null));
  }

  globalScope.CHAT_ASS_SETTINGS_STORAGE_KEY = CHAT_ASS_SETTINGS_STORAGE_KEY;
  globalScope.CHAT_ASS_PREVIEW_CONTEXT_STORAGE_KEY = CHAT_ASS_PREVIEW_CONTEXT_STORAGE_KEY;
  globalScope.CHAT_ASS_SETTINGS_SCHEMA_VERSION = CHAT_ASS_SETTINGS_SCHEMA_VERSION;
  globalScope.CHAT_ASS_DEFAULT_SETTINGS = CHAT_ASS_DEFAULT_SETTINGS;
  globalScope.CHAT_ASS_PRESETS = CHAT_ASS_PRESETS;
  globalScope.getDefaultChatAssSettings = getDefaultChatAssSettings;
  globalScope.normalizeChatAssSettings = normalizeChatAssSettings;
  globalScope.resolveChatAssRuntimeSettings = resolveChatAssRuntimeSettings;
  globalScope.loadChatAssSettings = loadChatAssSettings;
  globalScope.saveChatAssSettings = saveChatAssSettings;
  globalScope.resetChatAssSettings = resetChatAssSettings;
  globalScope.getChatAssPresets = getChatAssPresets;
  globalScope.getChatAssPresetById = getChatAssPresetById;
  globalScope.loadChatAssPreviewContext = loadChatAssPreviewContext;
  globalScope.saveChatAssPreviewContext = saveChatAssPreviewContext;
})(globalThis);
