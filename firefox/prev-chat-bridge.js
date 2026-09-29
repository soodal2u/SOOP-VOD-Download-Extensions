(function () {
  'use strict';

  const BRIDGE_SOURCE = 'soop-prev-chat-bridge';
  const MAIN_SOURCE = 'soop-prev-chat-main';
  const ENABLED_KEY = 'soop_prev_chat_enabled';
  const MAX_KEY = 'soop_prev_chat_max_messages';
  const MAX_MESSAGE_OPTIONS = [80, 200, 400];

  function normalizeSettings(raw) {
    const source = raw || {};
    const enabled = source[ENABLED_KEY];
    const maxMessages = Number(source[MAX_KEY]);
    return {
      enabled: enabled === undefined || enabled === null ? true : enabled !== false,
      maxMessages: MAX_MESSAGE_OPTIONS.includes(maxMessages) ? maxMessages : 200
    };
  }

  function pushSettings(raw) {
    const settings = normalizeSettings(raw);
    window.postMessage({
      source: BRIDGE_SOURCE,
      type: 'settings',
      enabled: settings.enabled,
      maxMessages: settings.maxMessages
    }, '*');
  }

  function loadAndPushSettings() {
    chrome.storage.local.get([ENABLED_KEY, MAX_KEY], (raw) => {
      if (chrome.runtime.lastError) {
        pushSettings({});
        return;
      }
      pushSettings(raw || {});
    });
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') {
      return;
    }
    if (!changes[ENABLED_KEY] && !changes[MAX_KEY]) {
      return;
    }
    loadAndPushSettings();
  });

  window.addEventListener('message', async (event) => {
    if (event.source !== window) {
      return;
    }

    const data = event.data;
    if (!data || data.source !== MAIN_SOURCE) {
      return;
    }

    if (data.type === 'hello') {
      loadAndPushSettings();
      return;
    }

    if (data.type !== 'fetch' || data.id == null) {
      return;
    }

    try {
      const response = await fetch(data.url, {
        method: data.method || 'GET',
        headers: data.headers || {},
        body: data.body || null,
        credentials: data.credentials || 'omit',
        mode: 'cors'
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${data.url}`);
      }
      const payload = data.responseType === 'json' ? await response.json() : await response.text();
      window.postMessage({
        source: BRIDGE_SOURCE,
        type: 'fetch-result',
        id: data.id,
        ok: true,
        data: payload
      }, '*');
    } catch (error) {
      window.postMessage({
        source: BRIDGE_SOURCE,
        type: 'fetch-result',
        id: data.id,
        ok: false,
        error: String(error && error.message ? error.message : error)
      }, '*');
    }
  });

  loadAndPushSettings();
})();
