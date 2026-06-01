const CHAT_ASS_PREVIEW_RESOLUTION = {
  width: 1920,
  height: 1080
};

const FALLBACK_SAMPLE_CHATS = [
  { time: 1.0, nickname: '퐁당홀', message: '고두가 샤워', role: 'fanclub' },
  { time: 1.3, nickname: '사과카페', message: '오늘 저녁뱅 없다 하심?', role: 'normal' },
  { time: 2.0, nickname: '혁이네누22', message: '일반뱅 나이스', role: 'normal' },
  { time: 2.7, nickname: '대지잉', message: '샤워뱅 미쳤다 ㅋㅋㅋㅋㅋㅋㅋㅋㅋㅋ', role: 'subscriber' },
  { time: 3.2, nickname: '누따왁', message: 'ㄷㄱㅈ', role: 'supporter' },
  { time: 4.0, nickname: '중학생들기', message: '와카', role: 'fanclub' },
  { time: 4.6, nickname: 'DONTDIE', message: '이제야 말이 통하네', role: 'subscriber' }
];

const CONTROL_BINDINGS = [
  { id: 'setting-show-title', key: 'showTitle', type: 'checkbox' },
  { id: 'setting-title-text', key: 'titleText', type: 'text' },
  { id: 'setting-message-format', key: 'messageFormat', type: 'text' },
  { id: 'setting-fanclub-color', key: 'fanclubColor', type: 'color' },
  { id: 'setting-supporter-color', key: 'supporterColor', type: 'color' },
  { id: 'setting-normal-color', key: 'normalColor', type: 'color' },
  { id: 'setting-subscriber-color', key: 'subscriberColor', type: 'color' },
  { id: 'setting-show-backdrop', key: 'showBackdrop', type: 'checkbox' },
  { id: 'setting-backdrop-opacity', key: 'backdropOpacity', type: 'range' },
  { id: 'setting-update-interval', key: 'updateInterval', type: 'range' },
  { id: 'setting-line-limit', key: 'lineLimit', type: 'range' },
  { id: 'setting-panel-left', key: 'panelLeft', type: 'range' },
  { id: 'setting-panel-top', key: 'panelTop', type: 'range' },
  { id: 'setting-panel-width', key: 'panelWidth', type: 'range' },
  { id: 'setting-panel-height', key: 'panelHeight', type: 'range' },
  { id: 'setting-title-font-size', key: 'titleFontSize', type: 'range' },
  { id: 'setting-font-size', key: 'fontSize', type: 'range' }
];

const state = {
  settings: loadChatAssSettings(),
  context: loadChatAssPreviewContext(),
  sampleChats: [...FALLBACK_SAMPLE_CHATS],
  activePresetId: null
};

const elements = {};
const SETTINGS_TAB_STORAGE_KEY = 'soop_chat_ass_active_tab';

document.addEventListener('DOMContentLoaded', () => {
  state.activePresetId = findMatchingPresetId(state.settings);

  cacheElements();
  initTabs();
  renderPresetButtons();
  setupRangeNumberInputs();
  bindActions();
  bindControls();
  syncFormWithSettings();
  renderContext();
  renderPreview();
  loadPreviewData();

  window.addEventListener('resize', renderPreview);
});

function cacheElements() {
  [
    'context-title',
    'context-page',
    'sample-status',
    'context-timing',
    'preview-stage',
    'preview-placeholder',
    'preview-overlay',
    'preview-overlay-title',
    'preview-overlay-lines',
    'restore-defaults',
    'close-page',
    'preset-list',
    'value-backdrop-opacity',
    'value-fanclub-color',
    'value-supporter-color',
    'value-normal-color',
    'value-subscriber-color',
    'value-update-interval',
    'value-line-limit',
    'value-panel-left',
    'value-panel-top',
    'value-panel-width',
    'value-panel-height',
    'value-title-font-size',
    'value-font-size'
  ].forEach((id) => {
    elements[id] = document.getElementById(id);
  });
}

function initTabs() {
  const tabButtons = Array.from(document.querySelectorAll('[data-tab-target]'));
  const tabPanels = Array.from(document.querySelectorAll('[data-tab-panel]'));

  if (tabButtons.length === 0 || tabPanels.length === 0) {
    return;
  }

  const storedTab = localStorage.getItem(SETTINGS_TAB_STORAGE_KEY);
  const initialTab = tabButtons.some((button) => button.dataset.tabTarget === storedTab)
    ? storedTab
    : tabButtons[0].dataset.tabTarget;

  const activateTab = (tabId) => {
    tabButtons.forEach((button) => {
      const isActive = button.dataset.tabTarget === tabId;
      button.classList.toggle('is-active', isActive);
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    tabPanels.forEach((panel) => {
      const isActive = panel.dataset.tabPanel === tabId;
      panel.classList.toggle('is-active', isActive);
      panel.hidden = !isActive;
    });

    localStorage.setItem(SETTINGS_TAB_STORAGE_KEY, tabId);
  };

  tabButtons.forEach((button) => {
    button.addEventListener('click', () => {
      activateTab(button.dataset.tabTarget);
    });
  });

  activateTab(initialTab);
}

function renderPresetButtons() {
  const presets = getChatAssPresets();
  elements['preset-list'].innerHTML = presets
    .map((preset) => `
      <button class="preset-button${preset.id === state.activePresetId ? ' is-active' : ''}" type="button" data-preset-id="${preset.id}">
        <strong>${escapePreviewHtml(preset.name)}</strong>
        <span>${escapePreviewHtml(preset.description)}</span>
      </button>
    `)
    .join('');

  elements['preset-list'].querySelectorAll('[data-preset-id]').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = getChatAssPresetById(button.dataset.presetId);
      if (!preset) {
        return;
      }

      state.settings = saveChatAssSettings(preset.settings);
      state.activePresetId = preset.id;
      syncFormWithSettings();
      renderPreview();
    });
  });
}

function setupRangeNumberInputs() {
  CONTROL_BINDINGS
    .filter((binding) => binding.type === 'range')
    .forEach((binding) => {
      const rangeInput = document.getElementById(binding.id);
      const wrapper = document.createElement('div');
      wrapper.className = 'control-inputs';
      const numberInput = document.createElement('input');

      numberInput.type = 'number';
      numberInput.min = '0';
      numberInput.max = '100';
      numberInput.step = '1';
      numberInput.className = 'control-number';
      numberInput.id = `number-${binding.key}`;

      rangeInput.parentNode.insertBefore(wrapper, rangeInput);
      wrapper.appendChild(rangeInput);
      wrapper.appendChild(numberInput);

      elements[numberInput.id] = numberInput;

      rangeInput.addEventListener('input', () => {
        applySettingChange(binding.key, clampPercent(rangeInput.value));
      });

      numberInput.addEventListener('input', () => {
        if (numberInput.value === '') {
          return;
        }
        applySettingChange(binding.key, clampPercent(numberInput.value));
      });

      numberInput.addEventListener('change', () => {
        applySettingChange(binding.key, clampPercent(numberInput.value || 0));
      });
    });
}

function bindActions() {
  elements['restore-defaults'].addEventListener('click', () => {
    state.settings = resetChatAssSettings();
    state.activePresetId = findMatchingPresetId(state.settings);
    syncFormWithSettings();
    renderPreview();
  });

  elements['close-page'].addEventListener('click', () => {
    window.close();
  });
}

function bindControls() {
  CONTROL_BINDINGS
    .filter((binding) => binding.type !== 'range')
    .forEach((binding) => {
      const element = document.getElementById(binding.id);
      const eventName = binding.type === 'checkbox' ? 'change' : 'input';
      element.addEventListener(eventName, () => {
        const value = binding.type === 'checkbox' ? element.checked : element.value;
        applySettingChange(binding.key, value);
      });
    });
}

function applySettingChange(key, value) {
  state.settings = saveChatAssSettings({
    ...state.settings,
    [key]: value
  });
  state.activePresetId = findMatchingPresetId(state.settings);
  syncFormWithSettings();
  renderPreview();
}

function syncFormWithSettings() {
  const settings = state.settings;
  const runtime = resolveChatAssRuntimeSettings(settings);

  CONTROL_BINDINGS.forEach((binding) => {
    const element = document.getElementById(binding.id);
    if (binding.type === 'checkbox') {
      element.checked = Boolean(settings[binding.key]);
    } else {
      element.value = settings[binding.key];
    }

    if (binding.type === 'range') {
      const numberInput = elements[`number-${binding.key}`];
      if (numberInput) {
        numberInput.value = settings[binding.key];
      }
    }
  });

  elements['value-backdrop-opacity'].textContent = `${settings.backdropOpacity}%`;
  elements['value-fanclub-color'].textContent = settings.fanclubColor;
  elements['value-supporter-color'].textContent = settings.supporterColor;
  elements['value-normal-color'].textContent = settings.normalColor;
  elements['value-subscriber-color'].textContent = settings.subscriberColor;
  elements['value-update-interval'].textContent = `${settings.updateInterval}% / ${runtime.updateIntervalSeconds.toFixed(2)}초`;
  elements['value-line-limit'].textContent = `${settings.lineLimit}% / ${runtime.lineLimitCount}줄`;
  elements['value-panel-left'].textContent = `${settings.panelLeft}%`;
  elements['value-panel-top'].textContent = `${settings.panelTop}%`;
  elements['value-panel-width'].textContent = `${settings.panelWidth}%`;
  elements['value-panel-height'].textContent = `${settings.panelHeight}%`;
  elements['value-title-font-size'].textContent = `${settings.titleFontSize}% / ${runtime.titleFontPixels}px`;
  elements['value-font-size'].textContent = `${settings.fontSize}% / ${runtime.fontPixels}px`;

  renderPresetButtons();
}

function renderContext() {
  const context = state.context;
  if (!context) {
    elements['context-title'].textContent = '현재 영상 정보를 찾지 못했습니다.';
    elements['context-page'].textContent = 'SOOP VOD 페이지에서 팝업을 다시 열고 설정 버튼을 눌러 주세요.';
    elements['context-timing'].textContent = '현재 시점: -';
    return;
  }

  elements['context-title'].textContent = context.title || 'SOOP VOD';
  elements['context-page'].textContent = context.pageUrl || '';
  elements['context-timing'].textContent = `현재 시점: ${formatClock(context.currentTimeSeconds || 0)} / ${formatClock(context.durationSeconds || 0)}`;
}

async function loadPreviewData() {
  const context = state.context;

  if (!context?.thumbnailUrl) {
    elements['sample-status'].textContent = '썸네일 URL이 없어 기본 배경으로 미리보기를 보여줍니다.';
  } else {
    elements['preview-stage'].style.backgroundImage = `linear-gradient(180deg, rgba(0,0,0,0.12), rgba(0,0,0,0.26)), url("${context.thumbnailUrl}")`;
    elements['preview-placeholder'].style.display = 'none';
  }

  if (!context?.chatRowKey) {
    elements['sample-status'].textContent = '채팅 rowKey를 찾지 못해 기본 샘플 채팅으로 미리보기를 보여줍니다.';
    renderPreview();
    return;
  }

  if (Array.isArray(context.previewSampleChats) && context.previewSampleChats.length > 0) {
    state.sampleChats = context.previewSampleChats;
    elements['sample-status'].textContent = `팝업에서 가져온 샘플 채팅 ${state.sampleChats.length}개를 미리보기에 사용합니다.`;
    renderPreview();
    return;
  }

  try {
    const segmentDuration = Number(context.chatSegmentDuration || 300);
    const currentTimeSeconds = Number(context.currentTimeSeconds || 0);
    const startTime = Math.max(0, Math.floor(currentTimeSeconds / segmentDuration) * segmentDuration);
    const chats = await fetchPreviewChats(context.chatRowKey, startTime);
    const filteredChats = chats.filter((chat) => chat.time >= Math.max(0, currentTimeSeconds - 6));
    state.sampleChats = (filteredChats.length > 0 ? filteredChats : chats).slice(0, 20);

    if (state.sampleChats.length === 0) {
      state.sampleChats = [...FALLBACK_SAMPLE_CHATS];
      elements['sample-status'].textContent = '실제 채팅을 찾지 못해 기본 샘플 채팅으로 대체했습니다.';
    } else {
      elements['sample-status'].textContent = `샘플 채팅 ${state.sampleChats.length}개를 ${formatClock(startTime)} 구간에서 불러왔습니다.`;
    }
  } catch (error) {
    console.error('샘플 채팅 로딩 오류:', error);
    state.sampleChats = [...FALLBACK_SAMPLE_CHATS];
    elements['sample-status'].textContent = `샘플 채팅을 불러오지 못해 기본 예시를 표시합니다: ${error.message}`;
  }

  renderPreview();
}

async function fetchPreviewChats(rowKey, startTime) {
  const response = await fetch(
    `https://videoimg.sooplive.com/php/ChatLoadSplit.php?rowKey=${encodeURIComponent(rowKey)}&startTime=${startTime}`,
    { cache: 'no-store' }
  );

  if (!response.ok) {
    throw new Error(`채팅 구간 요청 실패 (${response.status})`);
  }

  const xmlText = await response.text();
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlText, 'text/xml');
  if (xmlDoc.querySelector('parsererror')) {
    throw new Error('채팅 XML 파싱 실패');
  }

  return Array.from(xmlDoc.getElementsByTagName('chat'))
    .map((node, index) => ({
      time: Number(node.querySelector('t')?.textContent || 0),
      index,
      nickname: (node.querySelector('n')?.textContent || '익명').trim(),
      message: normalizePreviewMessage(node.querySelector('m')?.textContent || ''),
      nickColor: normalizePreviewHex(node.querySelector('nf')?.textContent || ''),
      role: 'normal'
    }))
    .filter((chat) => chat.message);
}

function renderPreview() {
  const settings = state.settings;
  const runtime = resolveChatAssRuntimeSettings(settings);
  const stageRect = elements['preview-stage'].getBoundingClientRect();
  const stageScale = Math.max(0.01, stageRect.width / CHAT_ASS_PREVIEW_RESOLUTION.width);
  const previewLines = buildPreviewLines(state.sampleChats, runtime);
  const paddingX = scaled(stageScale, 22);
  const titleTop = scaled(stageScale, 18);
  const contentTop = scaled(stageScale, runtime.showTitle ? runtime.titleFontPixels + 34 : 26);
  const lineGap = scaled(stageScale, Math.max(8, runtime.fontPixels * 0.26));

  elements['preview-overlay'].style.left = `${settings.panelLeft}%`;
  elements['preview-overlay'].style.top = `${settings.panelTop}%`;
  elements['preview-overlay'].style.width = `${settings.panelWidth}%`;
  elements['preview-overlay'].style.height = `${settings.panelHeight}%`;
  elements['preview-overlay'].style.background = runtime.showBackdrop
    ? `rgba(16, 16, 16, ${runtime.backdropOpacity / 100})`
    : 'linear-gradient(180deg, rgba(136, 244, 155, 0.06), rgba(136, 244, 155, 0.02))';
  elements['preview-overlay'].style.border = runtime.showBackdrop
    ? '1px solid rgba(255,255,255,0.08)'
    : '1px dashed rgba(136, 244, 155, 0.28)';
  elements['preview-overlay'].style.boxShadow = runtime.showBackdrop
    ? 'none'
    : 'inset 0 0 0 1px rgba(255,255,255,0.03)';

  elements['preview-overlay-title'].style.display = runtime.showTitle ? 'block' : 'none';
  elements['preview-overlay-title'].textContent = runtime.titleText;
  elements['preview-overlay-title'].style.fontSize = `${scaled(stageScale, runtime.titleFontPixels)}px`;
  elements['preview-overlay-title'].style.left = `${paddingX}px`;
  elements['preview-overlay-title'].style.right = `${paddingX}px`;
  elements['preview-overlay-title'].style.top = `${titleTop}px`;

  elements['preview-overlay-lines'].style.top = `${contentTop}px`;
  elements['preview-overlay-lines'].style.left = `${paddingX}px`;
  elements['preview-overlay-lines'].style.right = `${paddingX}px`;
  elements['preview-overlay-lines'].style.gap = `${lineGap}px`;
  elements['preview-overlay-lines'].style.fontSize = `${scaled(stageScale, runtime.fontPixels)}px`;

  elements['preview-overlay-lines'].innerHTML = previewLines
    .map((line) => `
      <div class="preview-line">${line.html}</div>
    `)
    .join('');
}

function buildPreviewLines(chats, runtimeSettings) {
  const layout = resolvePreviewLayout(runtimeSettings);
  const visibleLines = [];
  const groupedChats = new Map();

  chats.forEach((chat) => {
    const slot = Number((Math.floor(chat.time / runtimeSettings.updateIntervalSeconds) * runtimeSettings.updateIntervalSeconds).toFixed(2));
    if (!groupedChats.has(slot)) {
      groupedChats.set(slot, []);
    }
    groupedChats.get(slot).push(chat);
  });

  const slots = Array.from(groupedChats.keys()).sort((a, b) => a - b);
  slots.forEach((slot) => {
    const slotChats = groupedChats.get(slot) || [];
    slotChats.forEach((chat) => {
      buildWrappedPreviewLines(chat, runtimeSettings, layout).forEach((wrappedLine) => {
        visibleLines.push(wrappedLine);
        while (visibleLines.length > runtimeSettings.lineLimitCount) {
          visibleLines.shift();
        }
      });
    });
  });

  return visibleLines.length > 0
    ? visibleLines
    : FALLBACK_SAMPLE_CHATS
      .slice(0, runtimeSettings.lineLimitCount)
      .flatMap((chat) => buildWrappedPreviewLines(chat, runtimeSettings, layout));
}

function findMatchingPresetId(settings) {
  const current = JSON.stringify(normalizeChatAssSettings(settings));
  const preset = getChatAssPresets().find((item) => JSON.stringify(item.settings) === current);
  return preset ? preset.id : null;
}

function normalizePreviewMessage(message) {
  const normalized = String(message || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\/([^/]+)\//g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized || '[이모티콘]';
}

function normalizePreviewHex(value) {
  const normalized = String(value || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return normalized.length === 6 ? normalized : null;
}

function previewHexToCss(hexColor) {
  return hexColor ? `#${hexColor}` : '#7DE3FF';
}

function buildWrappedPreviewLines(chat, runtimeSettings, layout) {
  const nickname = truncatePreview(chat.nickname, 12);
  const message = truncatePreview(chat.message, 120);
  const lineUnits = calculatePreviewWrapUnits(layout.contentWidth, runtimeSettings.fontPixels);
  const templatePrefixUnits = measurePreviewTextUnits(renderPreviewTemplateLine(runtimeSettings.messageFormat, nickname, ''));
  const firstLineUnits = Math.max(4, lineUnits - templatePrefixUnits);
  const wrappedSegments = wrapPreviewTextByUnits(message, firstLineUnits, lineUnits);
  const roleColor = resolvePreviewRoleColor(chat.role, runtimeSettings);

  return wrappedSegments.map((segment, index) => ({
    html: index === 0
      ? renderPreviewTemplateHtml(runtimeSettings.messageFormat, nickname, segment, roleColor)
      : escapePreviewHtml(`　${segment}`)
  }));
}

function resolvePreviewLayout(runtimeSettings) {
  const width = Math.round((runtimeSettings.panelWidth / 100) * CHAT_ASS_PREVIEW_RESOLUTION.width);
  const paddingX = 22;

  return {
    contentWidth: Math.max(120, width - paddingX * 2)
  };
}

function calculatePreviewWrapUnits(contentWidth, fontPixels) {
  return Math.max(6, Math.floor(contentWidth / Math.max(1, fontPixels * 0.92)));
}

function wrapPreviewTextByUnits(text, firstLineUnits, lineUnits) {
  const lines = [];
  let current = '';
  let currentUnits = 0;
  let currentLimit = firstLineUnits;

  Array.from(String(text || '')).forEach((character) => {
    const characterUnits = measurePreviewCharacterUnits(character);
    if (current && currentUnits + characterUnits > currentLimit) {
      lines.push(current.trim());
      current = character === ' ' ? '' : character;
      currentUnits = measurePreviewTextUnits(current);
      currentLimit = lineUnits;
      return;
    }

    current += character;
    currentUnits += characterUnits;
  });

  if (current.trim()) {
    lines.push(current.trim());
  }

  return lines.length > 0 ? lines : [''];
}

function measurePreviewTextUnits(text) {
  return Array.from(String(text || '')).reduce((total, character) => total + measurePreviewCharacterUnits(character), 0);
}

function measurePreviewCharacterUnits(character) {
  if (/\s/.test(character)) {
    return 0.38;
  }

  if (/[A-Za-z0-9]/.test(character)) {
    return 0.62;
  }

  if (/[\u1100-\u11FF\u3130-\u318F\uAC00-\uD7A3\u3040-\u30FF\u4E00-\u9FFF]/u.test(character)) {
    return 1;
  }

  if (/[\u{1F300}-\u{1FAFF}]/u.test(character)) {
    return 1.18;
  }

  return 0.78;
}

function renderPreviewTemplateHtml(template, nickname, message, color) {
  return String(template || '{nickname} {message}')
    .replace(/\{nickname\}/g, `<span class="nick" style="color: ${color};">${escapePreviewHtml(nickname)}</span>`)
    .replace(/\{message\}/g, `<span class="message">${escapePreviewHtml(message)}</span>`)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function renderPreviewTemplateLine(template, nickname, message) {
  return String(template || '{nickname} {message}')
    .replace(/\{nickname\}/g, nickname)
    .replace(/\{message\}/g, message)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function resolvePreviewRoleColor(role, settings) {
  switch (role) {
    case 'fanclub':
      return settings.fanclubColor;
    case 'supporter':
      return settings.supporterColor;
    case 'subscriber':
      return settings.subscriberColor;
    default:
      return settings.normalColor;
  }
}

function truncatePreview(text, limit) {
  const chars = Array.from(String(text || ''));
  if (chars.length <= limit) {
    return chars.join('');
  }
  return `${chars.slice(0, limit - 1).join('')}…`;
}

function escapePreviewHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatClock(totalSeconds) {
  const safeSeconds = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function clampPercent(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.min(100, Math.max(0, Math.round(numeric)));
}

function scaled(scale, value) {
  return Math.max(1, Math.round(value * scale));
}
