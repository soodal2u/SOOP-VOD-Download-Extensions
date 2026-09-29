/**
 * SOOP VOD 이전 채팅 자동 로드 (MAIN world)
 * 시크 후 숲이 채팅창을 비우고 #boxVstart 를 다시 만든 뒤,
 * 시크 시각보다 앞선 채팅을 네이티브 채팅 아이템으로 넣습니다.
 */
(function () {
  'use strict';

  if (window.__SOOP_VOD_PREV_CHAT__) {
    return;
  }
  window.__SOOP_VOD_PREV_CHAT__ = true;

  const LOG_PREFIX = '[SOOP PrevChat]';
  const ITEM_ATTR = 'data-soop-prev-chat';
  const MARKER_ATTR = 'data-soop-prev-chat-marker';
  const BRIDGE_SOURCE = 'soop-prev-chat-bridge';
  const MAIN_SOURCE = 'soop-prev-chat-main';

  const DEFAULTS = {
    maxMessages: 200,
    maxChunks: 8,
    skipIfNearStartSec: 1.5,
    resetTimeoutMs: 2500,
    settleQuietMs: 80,
    settleTimeoutMs: 500,
    watchdogMs: 2800,
    watchdogMaxRetry: 6
  };

  const MAX_MESSAGE_OPTIONS = [80, 200, 400];

  const SELECTORS = {
    video: '#video, video',
    boxVstart: '#boxVstart',
    chatArea: '#chatArea, #chat_area, .chatting-item-wrap'
  };

  const API = {
    vodView: (origin) => `${origin}/station/video/a/view`,
    emoticon: 'https://st.sooplive.com/api/emoticons.php',
    signatureEmoticon: 'https://live.sooplive.com/api/signature_emoticon_api.php',
    ogqCdn: 'https://ogq-sticker-global-cdn-z01.sooplive.com',
    ogqMarket: 'https://ogqmarket.sooplive.com',
    res: 'https://res.sooplive.com'
  };

  const state = {
    enabled: true,
    maxMessages: DEFAULTS.maxMessages,
    vodId: null,
    vodInfo: null,
    vodInfoPromise: null,
    emoticonMap: new Map(),
    nativeChatUrl: null,
    pageFetch: null,
    nativeChatDuration: 300,
    lastInjectGen: 0,
    lastSeekAt: 0,
    lastSeekTime: -1,
    lastBoxVstart: null,
    injecting: false,
    pendingRestoreSec: null,
    pipelineActive: false,
    chatResetFlag: false,
    watchdog: null,
    lastMessages: [],
    lastEndSec: 0,
    fetchSeq: 0
  };

  function log(...args) {
    console.log(LOG_PREFIX, ...args);
  }

  function warn(...args) {
    console.warn(LOG_PREFIX, ...args);
  }

  function applySettings(data) {
    const wasEnabled = state.enabled;
    state.enabled = data && data.enabled !== false;
    const nextMax = Number(data && data.maxMessages);
    if (MAX_MESSAGE_OPTIONS.includes(nextMax)) {
      state.maxMessages = nextMax;
    }

    if (!state.enabled && wasEnabled) {
      stopWatchdog();
      state.lastInjectGen += 1;
      state.pipelineActive = false;
      state.injecting = false;
      const found = findChatMemo();
      if (found) {
        removeInjected(found.parent);
      }
      log('disabled');
      return;
    }

    if (state.enabled && !wasEnabled) {
      log(`enabled (max ${state.maxMessages})`);
    }
  }

  function extensionRequest(url, options) {
    const id = ++state.fetchSeq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        window.removeEventListener('message', onMessage);
        reject(new Error('extension fetch timeout'));
      }, 15000);

      function onMessage(event) {
        if (event.source !== window) {
          return;
        }
        const data = event.data;
        if (!data || data.source !== BRIDGE_SOURCE || data.type !== 'fetch-result' || data.id !== id) {
          return;
        }
        window.removeEventListener('message', onMessage);
        clearTimeout(timer);
        if (data.ok) {
          resolve(data.data);
          return;
        }
        reject(new Error(data.error || 'extension fetch failed'));
      }

      window.addEventListener('message', onMessage);
      window.postMessage({
        source: MAIN_SOURCE,
        type: 'fetch',
        id,
        url,
        method: options.method || 'GET',
        headers: options.headers || {},
        body: options.body || null,
        credentials: options.credentials || 'omit',
        responseType: options.responseType || 'text'
      }, '*');
    });
  }

  function getVodId() {
    const match = location.pathname.match(/\/player\/(\d+)/);
    return match ? match[1] : null;
  }

  function getPageWindow() {
    return window;
  }

  function getVideo() {
    return document.querySelector(SELECTORS.video);
  }

  function parseClockSeconds(text) {
    const match = String(text || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
    if (!match || Number(match[3]) >= 60 || (match[1] && Number(match[2]) >= 60)) {
      return null;
    }
    return (Number(match[1] || 0) * 3600) + (Number(match[2]) * 60) + Number(match[3]);
  }

  function getActiveFileStartSec() {
    const files = state.vodInfo && state.vodInfo.data && state.vodInfo.data.files;
    if (!Array.isArray(files) || files.length < 2) {
      return 0;
    }
    const chatCoreKey = String(getPageWindow().oChatCore?.preChatItemFileInfoKey || '');
    const nativeUrl = state.nativeChatUrl && parseChatUrl(state.nativeChatUrl);
    const nativeChatKey = nativeUrl && nativeUrl.searchParams.get('rowKey');
    let offsetSec = 0;
    let nativeOffsetSec = null;
    for (const file of files) {
      const fileKey = String(file.file_info_key || '');
      const fileChatUrl = file.chat && parseChatUrl(file.chat);
      const fileChatKey = fileChatUrl && fileChatUrl.searchParams.get('rowKey');
      if (chatCoreKey && (chatCoreKey === fileKey || `${chatCoreKey}_c` === fileChatKey)) {
        return offsetSec;
      }
      if (nativeChatKey && nativeChatKey === fileChatKey) {
        nativeOffsetSec = offsetSec;
      }
      offsetSec += Math.max(0, Number(file.duration) || 0) / 1000;
    }
    return nativeOffsetSec ?? 0;
  }

  function getPlaybackTimeSec() {
    // SOOP's video element starts at zero for each file, while the player clock
    // shows the position across the entire VOD.
    const displayedTime = document.querySelector('.time_display .time-current, .time-current');
    const totalSec = parseClockSeconds(displayedTime && displayedTime.textContent);
    if (totalSec !== null) {
      return totalSec;
    }
    const video = getVideo();
    if (video && Number.isFinite(video.currentTime)) {
      return getActiveFileStartSec() + video.currentTime;
    }
    const core = getPageWindow().vodCore;
    const t = core && (core.currentTime || core.current_time);
    if (Number.isFinite(t)) {
      return t;
    }
    return 0;
  }

  function getApiMOrigin() {
    return location.hostname.endsWith('.co.kr')
      ? 'https://api.m.sooplive.co.kr'
      : 'https://api.m.sooplive.com';
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    }[ch]));
  }

  function formatClock(seconds) {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(2, '0');
    const ss = String(sec).padStart(2, '0');
    return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  }

  function request(url, options = {}) {
    const method = options.method || 'GET';
    const headers = options.headers || {};
    const body = options.body || null;
    const credentials = options.credentials || 'omit';

    const pageFetch = state.pageFetch || fetch;
    return pageFetch.call(window, url, { method, headers, body, credentials, mode: 'cors' })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} ${url}`);
        }
        return options.responseType === 'json' ? res.json() : res.text();
      })
      .catch((err) => extensionRequest(url, options).catch(() => {
        throw err;
      }));
  }

  async function ensureVodInfo() {
    const vodId = getVodId();
    if (!vodId) {
      return null;
    }
    if (state.vodId === vodId && state.vodInfo) {
      return state.vodInfo;
    }
    if (state.vodId === vodId && state.vodInfoPromise) {
      return state.vodInfoPromise;
    }

    state.vodId = vodId;
    state.vodInfo = null;
    state.emoticonMap = new Map();

    state.vodInfoPromise = (async () => {
      const info = await request(API.vodView(getApiMOrigin()), {
        method: 'POST',
        credentials: 'include',
        responseType: 'json',
        headers: {
          accept: 'application/json, text/plain, */*',
          'content-type': 'application/x-www-form-urlencoded'
        },
        body: `nTitleNo=${encodeURIComponent(vodId)}&nApiLevel=11&nPlaylistIdx=0`
      });
      if (!info || info.result !== 1 || !info.data) {
        warn('VOD 정보 조회 실패', info);
        return null;
      }
      state.vodInfo = info;
      state.nativeChatDuration = Number(info.data.chat_duration) || 300;
      loadEmoticons(info.data.bj_id).catch((error) => warn('이모티콘 로드 실패', error));
      return info;
    })().catch((err) => {
      warn('VOD 정보 요청 오류', err);
      return null;
    });

    return state.vodInfoPromise;
  }

  async function loadEmoticons(bjId) {
    const tasks = [
      request(API.emoticon, { responseType: 'json' }).catch(() => null)
    ];
    if (bjId) {
      tasks.push(request(API.signatureEmoticon, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: '*/*' },
        body: `work=list&szBjId=${encodeURIComponent(bjId)}&nState=2&v=tier`,
        responseType: 'json'
      }).catch(() => null));
    }
    const [defaultEmote, signature] = await Promise.all(tasks);
    const map = new Map();

    if (signature && signature.data && signature.img_path) {
      const imgPath = signature.img_path;
      const all = [...(signature.data.tier1 || []), ...(signature.data.tier2 || [])];
      all.forEach((em) => {
        if (!em || !em.title) {
          return;
        }
        const file = em.move_img === 'Y' && em.pc_alternate_img ? em.pc_alternate_img : em.pc_img;
        if (!file) {
          return;
        }
        map.set(`/${em.title}/`, `<img class="emoticon" src="${escapeHtml(imgPath + file)}" alt="">`);
      });
    }

    const groupsOf = (pack) => (pack && pack.groups) || [];
    const addPack = (pack) => {
      if (!pack) {
        return;
      }
      const base = pack.small_url || pack.big_url || '';
      groupsOf(pack).forEach((group) => {
        (group.emoticons || []).forEach((em) => {
          if (em.isDeprecated || !em.keyword) {
            return;
          }
          const file = em.staticFileName || em.fileName;
          if (!file) {
            return;
          }
          map.set(em.keyword, `<img class="emoticon" src="${escapeHtml(base + file)}" alt="">`);
        });
      });
    };

    if (defaultEmote && defaultEmote.data) {
      addPack(defaultEmote.data.default);
      addPack(defaultEmote.data.subscribe);
    }

    state.emoticonMap = map;
  }

  function parseChatUrl(urlLike) {
    try {
      return new URL(urlLike, location.href);
    } catch (_) {
      return null;
    }
  }

  function rememberNativeChatUrl(rawUrl) {
    const url = parseChatUrl(rawUrl);
    if (!url || !/ChatLoadSplit\.php/i.test(url.pathname)) {
      return;
    }
    url.searchParams.delete('startTime');
    const normalized = url.toString();
    const isNew = normalized !== state.nativeChatUrl;
    state.nativeChatUrl = normalized;
    if (!state.vodInfo) {
      state.nativeChatDuration = 300;
    }
    if (isNew && state.pendingRestoreSec != null && !state.pipelineActive) {
      const t = state.pendingRestoreSec;
      state.pendingRestoreSec = null;
      noteSeek('native-chat-url', t);
    }
  }

  function buildChatFetchUrl(chatUrl, startTimeSec) {
    const url = parseChatUrl(chatUrl);
    if (!url) {
      return null;
    }
    url.searchParams.set('startTime', String(Math.max(0, Math.floor(startTimeSec))));
    return url.toString();
  }

  function getFilePlan(playbackStartSec, playbackEndSec) {
    const files = state.vodInfo && state.vodInfo.data && state.vodInfo.data.files;
    const durationSec = Number(state.vodInfo && state.vodInfo.data && state.vodInfo.data.chat_duration) || state.nativeChatDuration || 300;
    const tasks = [];

    if (Array.isArray(files) && files.length) {
      let cumSec = 0;
      for (const file of files) {
        const fileDurSec = (Number(file.duration) > 0 ? Number(file.duration) : 0) / 1000;
        const fileStart = cumSec;
        const fileEnd = cumSec + fileDurSec;
        cumSec = fileEnd;
        if (!file.chat || fileDurSec <= 0 || fileEnd <= playbackStartSec) {
          continue;
        }
        if (fileStart >= playbackEndSec) {
          break;
        }

        const relStart = Math.max(0, playbackStartSec - fileStart);
        const chunk0 = Math.floor(relStart / durationSec) * durationSec;
        for (let rel = chunk0; rel < fileDurSec && fileStart + rel < playbackEndSec; rel += durationSec) {
          tasks.push({
            chatUrl: file.chat,
            relativeStartSec: rel,
            fileStartSec: fileStart
          });
        }
      }
      return { durationSec, tasks };
    }

    if (state.nativeChatUrl) {
      const chunk0 = Math.floor(Math.max(0, playbackStartSec) / durationSec) * durationSec;
      for (let rel = chunk0; rel < playbackEndSec; rel += durationSec) {
        tasks.push({
          chatUrl: state.nativeChatUrl,
          relativeStartSec: rel,
          fileStartSec: 0
        });
      }
    }
    return { durationSec, tasks };
  }

  function xmlText(node, tag) {
    return ((node.querySelector(tag) && node.querySelector(tag).textContent) || '').trim();
  }

  function parseChatXml(xmlTextStr, fileStartSec) {
    const messages = [];
    if (!xmlTextStr) {
      return messages;
    }
    const doc = new DOMParser().parseFromString(xmlTextStr, 'application/xml');
    if (doc.querySelector('parsererror')) {
      return messages;
    }

    doc.querySelectorAll('root > chat, root > ogq').forEach((chat) => {
      const isOgq = chat.tagName.toLowerCase() === 'ogq';
      const t = parseFloat(xmlText(chat, 't'));
      if (!Number.isFinite(t)) {
        return;
      }

      let pValue;
      let p2Value;
      if (isOgq) {
        const sf = xmlText(chat, 'sf');
        const parts = sf.split('|');
        pValue = (parts[0] || '').trim();
        p2Value = (parts[1] || '').trim();
      } else {
        pValue = xmlText(chat, 'p');
        p2Value = xmlText(chat, 'p2');
      }

      const ogqGid = isOgq ? xmlText(chat, 'gid') : '';
      const ogqSid = isOgq ? xmlText(chat, 'sid') : '';
      const ogqVersion = isOgq ? xmlText(chat, 'v') : '1';
      const ogqAnm = isOgq ? xmlText(chat, 'anm') : '';
      let ogqImageUrl = null;
      if (isOgq && ogqGid && ogqSid) {
        const ext = ogqAnm === '1' ? 'webp' : 'png';
        ogqImageUrl = `${API.ogqCdn}/sticker/${ogqGid}/${ogqSid}_80.${ext}?ver=${ogqVersion || '1'}`;
      }

      messages.push({
        playbackSec: fileStartSec + t,
        userId: isOgq ? xmlText(chat, 's') : xmlText(chat, 'u'),
        userNick: isOgq ? xmlText(chat, 'sn') : xmlText(chat, 'n'),
        msg: xmlText(chat, 'm'),
        nicknameColor: xmlText(chat, 'nf'),
        subscriptionMonths: xmlText(chat, 'acfw'),
        pValue,
        p2Value,
        isOgq,
        ogqImageUrl,
        ogqPurchaseUrl: isOgq && ogqGid ? `${API.ogqMarket}?m=detail&productId=${ogqGid}` : null
      });
    });
    return messages;
  }

  function taskKey(task) {
    return `${task.chatUrl}|${task.fileStartSec}|${task.relativeStartSec}`;
  }

  async function fetchChunkMessages(task) {
    const url = buildChatFetchUrl(task.chatUrl, task.relativeStartSec);
    if (!url) {
      return [];
    }
    try {
      const xml = await request(url, { credentials: 'omit' });
      return parseChatXml(xml, task.fileStartSec);
    } catch (err) {
      warn('채팅 청크 실패', url, err);
      return [];
    }
  }

  async function fetchPreviousMessages(endSec) {
    if (endSec <= 0.5) {
      return [];
    }

    await ensureVodInfo();
    const durationSec = Number(state.vodInfo && state.vodInfo.data && state.vodInfo.data.chat_duration) || state.nativeChatDuration || 300;
    const limit = state.maxMessages || DEFAULTS.maxMessages;
    const cutoff = endSec - 0.25;

    const collected = [];
    const seen = new Set();
    const fetchedChunks = new Set();
    let cursor = endSec;
    let emptyStreak = 0;

    for (let i = 0; i < DEFAULTS.maxChunks && cursor > 0.05 && collected.length < limit; i++) {
      const plan = getFilePlan(Math.max(0, cursor - 0.05), cursor);
      const task = plan.tasks[0];
      if (!task) {
        emptyStreak += 1;
        cursor = Math.max(0, cursor - durationSec);
        if (emptyStreak >= 2) {
          break;
        }
        continue;
      }
      emptyStreak = 0;

      const key = taskKey(task);
      if (fetchedChunks.has(key)) {
        cursor = Math.max(0, task.fileStartSec + task.relativeStartSec - 0.05);
        continue;
      }
      fetchedChunks.add(key);

      const chunkStart = task.fileStartSec + task.relativeStartSec;
      const msgs = await fetchChunkMessages(task);
      const older = [];
      for (const msg of msgs) {
        if (msg.playbackSec >= cutoff) {
          continue;
        }
        const id = `${msg.playbackSec.toFixed(3)}|${msg.userId}|${msg.msg}`;
        if (seen.has(id)) {
          continue;
        }
        seen.add(id);
        older.push(msg);
      }
      older.sort((a, b) => a.playbackSec - b.playbackSec);
      collected.unshift(...older);
      cursor = chunkStart;
      if (cursor <= 0) {
        break;
      }
    }

    if (!fetchedChunks.size) {
      state.pendingRestoreSec = endSec;
      warn('채팅 URL 을 찾지 못했습니다. 네이티브 ChatLoadSplit 요청을 기다립니다.');
      return [];
    }

    collected.sort((a, b) => a.playbackSec - b.playbackSec);
    return collected.slice(-limit);
  }

  function getBadgeType(pValue) {
    const pNum = parseInt(pValue || '0', 10);
    if ((pNum & 0x40) !== 0) {
      return 'manager';
    }
    if ((pNum & 0x8000) !== 0) {
      return 'vip';
    }
    if ((pNum & 0x20) !== 0) {
      return 'subscribe';
    }
    if ((pNum & 0x100000) !== 0) {
      return 'support';
    }
    return null;
  }

  function getGradeValue(pValue, subscriptionMonths) {
    const pNum = parseInt(pValue || '0', 10);
    const monthsNum = parseInt(subscriptionMonths || '-1', 10);
    if (monthsNum !== -1) {
      return 6;
    }
    if ((pNum & 0x20) !== 0) {
      return 3;
    }
    return 5;
  }

  function getPersonalconUrl(subscriptionMonths, p2Value) {
    const monthsNum = parseInt(subscriptionMonths || '-1', 10);
    if (monthsNum < 0) {
      return null;
    }
    const p2Num = parseInt(p2Value || '0', 10);
    const tierNo = (p2Num & 0x80000) !== 0 ? 2 : 1;
    const pack = state.vodInfo && state.vodInfo.data && state.vodInfo.data.subscription_personalcon;
    const tier = tierNo === 2 ? pack && pack.tier2 : pack && pack.tier1;
    if (!Array.isArray(tier) || !tier.length) {
      return `${API.res}/images/chatting/signature-default.svg`;
    }
    let best = null;
    for (const item of tier) {
      if (item.month <= monthsNum && (!best || item.month > best.month)) {
        best = item;
      }
    }
    return (best && best.file_name) || (tier[0] && tier[0].file_name) || `${API.res}/images/chatting/signature-default.svg`;
  }

  function renderMessageHtml(msgText) {
    let html = escapeHtml(msgText || '');
    if (!html || state.emoticonMap.size === 0) {
      return html;
    }
    state.emoticonMap.forEach((imgHtml, keyword) => {
      if (!keyword) {
        return;
      }
      html = html.split(escapeHtml(keyword)).join(imgHtml);
    });
    return html;
  }

  function createChatElement(msg) {
    const badgeType = getBadgeType(msg.pValue);
    const grade = String(getGradeValue(msg.pValue, msg.subscriptionMonths));
    const item = document.createElement('div');
    item.className = 'chatting-list-item';
    item.setAttribute(ITEM_ATTR, '1');
    item.setAttribute('data-playback-sec', String(msg.playbackSec));
    if (badgeType) {
      item.setAttribute('user-type', badgeType);
    }

    const usernameBtn = document.createElement('button');
    usernameBtn.type = 'button';
    const monthsNum = parseInt(msg.subscriptionMonths || '-1', 10);
    if (monthsNum !== -1) {
      const thumb = document.createElement('span');
      thumb.className = 'thumb';
      const img = document.createElement('img');
      img.id = 'author';
      if (msg.userId) {
        img.setAttribute('user_id', msg.userId);
      }
      img.setAttribute('user_nick', msg.userNick || '');
      img.setAttribute('grade', grade);
      img.src = getPersonalconUrl(msg.subscriptionMonths, msg.p2Value) || `${API.res}/images/chatting/signature-default.svg`;
      img.onerror = function () {
        this.src = `${API.res}/images/chatting/signature-default.svg`;
      };
      thumb.appendChild(img);
      usernameBtn.appendChild(thumb);
    }

    if (badgeType) {
      const badge = document.createElement('span');
      const badgeMap = {
        support: ['grade-badge-support', '서포터', 'S'],
        vip: ['grade-badge-vip', '열혈팬', '열'],
        subscribe: ['grade-badge-fan', '팬클럽', 'F'],
        manager: ['grade-badge-manager', '매니저', 'M']
      };
      const [cls, tip, text] = badgeMap[badgeType];
      badge.className = cls;
      badge.setAttribute('tip', tip);
      badge.id = 'author';
      if (msg.userId) {
        badge.setAttribute('user_id', msg.userId);
      }
      badge.setAttribute('user_nick', msg.userNick || '');
      badge.setAttribute('grade', grade);
      badge.textContent = text;
      usernameBtn.appendChild(badge);
    }

    const author = document.createElement('span');
    author.className = 'author random-color4';
    author.id = 'author';
    author.setAttribute('href', 'javascript:;');
    if (msg.userId) {
      author.setAttribute('user_id', msg.userId);
    }
    author.setAttribute('user_nick', msg.userNick || '');
    author.setAttribute('grade', grade);
    author.textContent = msg.userNick || msg.userId || '알 수 없음';
    if (msg.nicknameColor) {
      author.style.color = `#${msg.nicknameColor}`;
    }
    usernameBtn.appendChild(author);

    const usernameDiv = document.createElement('div');
    usernameDiv.className = 'username';
    usernameDiv.appendChild(usernameBtn);

    const messageTextDiv = document.createElement('div');
    messageTextDiv.className = 'message-text';
    messageTextDiv.title = formatClock(msg.playbackSec);

    if (msg.isOgq && msg.ogqImageUrl) {
      const box = document.createElement('div');
      box.className = 'emoticon-box';
      const a = document.createElement('a');
      a.className = 'img-box';
      a.href = msg.ogqPurchaseUrl || '#';
      a.target = '_blank';
      const img = document.createElement('img');
      img.className = 'ogqEmoticon';
      img.src = msg.ogqImageUrl;
      a.appendChild(img);
      box.appendChild(a);
      messageTextDiv.appendChild(box);
    }

    const p = document.createElement('p');
    p.className = 'msg';
    p.innerHTML = renderMessageHtml(msg.msg);
    messageTextDiv.appendChild(p);

    const container = document.createElement('div');
    container.className = 'message-container';
    container.appendChild(usernameDiv);
    container.appendChild(messageTextDiv);
    item.appendChild(container);
    return item;
  }

  function findChatMemo() {
    const box = document.getElementById('boxVstart');
    if (box && box.parentElement) {
      return { box, parent: box.parentElement };
    }
    const area = document.querySelector(SELECTORS.chatArea);
    if (area) {
      return { box: null, parent: area };
    }
    return null;
  }

  function removeInjected(parent) {
    if (!parent) {
      return;
    }
    parent.querySelectorAll(`[${ITEM_ATTR}], [${MARKER_ATTR}]`).forEach((el) => el.remove());
  }

  function injectedStillPresent(parent) {
    return !!(parent && parent.querySelector(`[${ITEM_ATTR}], [${MARKER_ATTR}]`));
  }

  function nativeChatItemCount(parent) {
    if (!parent) {
      return 0;
    }
    const items = parent.querySelectorAll('.chatting-list-item');
    const ours = parent.querySelectorAll(`[${ITEM_ATTR}]`);
    return Math.max(0, items.length - ours.length);
  }

  function scrollChatToBottom(parent) {
    const candidates = [
      parent,
      document.getElementById('chatArea'),
      document.getElementById('chat_area'),
      document.querySelector('.chatting-item-wrap'),
      parent && parent.parentElement
    ].filter(Boolean);
    candidates.forEach((el) => {
      try {
        el.scrollTop = el.scrollHeight;
      } catch (_) { /* ignore */ }
    });
  }

  function injectMessages(messages, endSec) {
    const found = findChatMemo();
    if (!found) {
      return false;
    }
    const { box, parent } = found;
    removeInjected(parent);
    if (!messages.length) {
      return true;
    }

    const fragment = document.createDocumentFragment();
    const marker = document.createElement('div');
    marker.setAttribute(MARKER_ATTR, '1');
    marker.className = 'soop-prev-chat-marker';
    const fromSec = messages[0] ? messages[0].playbackSec : 0;
    marker.textContent = `${formatClock(fromSec)} ~ ${formatClock(endSec)} 이전 채팅 ${messages.length}개`;
    fragment.appendChild(marker);
    messages.forEach((msg) => fragment.appendChild(createChatElement(msg)));

    if (box && box.parentElement === parent) {
      parent.insertBefore(fragment, box);
    } else {
      parent.insertBefore(fragment, parent.firstChild);
    }
    requestAnimationFrame(() => scrollChatToBottom(parent));
    return true;
  }

  function waitForDomSettle(el, quietMs, timeoutMs) {
    return new Promise((resolve) => {
      if (!el) {
        resolve();
        return;
      }
      let settled = false;
      let quietTimer = 0;
      let hardTimer = 0;
      let obs = null;
      const finish = () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(quietTimer);
        clearTimeout(hardTimer);
        if (obs) {
          obs.disconnect();
        }
        resolve();
      };
      obs = new MutationObserver(() => {
        clearTimeout(quietTimer);
        quietTimer = setTimeout(finish, quietMs);
      });
      obs.observe(el, { childList: true, subtree: true });
      quietTimer = setTimeout(finish, quietMs);
      hardTimer = setTimeout(finish, timeoutMs);
    });
  }

  function isChatResetComplete(boxAtSeek) {
    if (state.chatResetFlag) {
      return true;
    }
    const box = document.getElementById('boxVstart');
    if (box && box !== boxAtSeek) {
      return true;
    }
    if (boxAtSeek && !boxAtSeek.isConnected && box) {
      return true;
    }

    const found = findChatMemo();
    if (!found) {
      return false;
    }
    const nativeCount = nativeChatItemCount(found.parent);
    const elapsed = Date.now() - state.lastSeekAt;
    if (nativeCount === 0 && elapsed >= 80) {
      return true;
    }
    return false;
  }

  function waitForChatReset(gen, boxAtSeek, alreadyReset) {
    return new Promise((resolve) => {
      if (alreadyReset || isChatResetComplete(boxAtSeek)) {
        resolve({ ok: true, why: alreadyReset ? 'already-reset' : 'reset-now' });
        return;
      }

      const started = Date.now();
      let done = false;
      const finish = (ok, why) => {
        if (done) {
          return;
        }
        done = true;
        obs.disconnect();
        clearInterval(poll);
        resolve({ ok, why });
      };

      const check = (why) => {
        if (gen !== state.lastInjectGen) {
          finish(false, 'stale');
          return;
        }
        if (isChatResetComplete(boxAtSeek)) {
          finish(true, why);
          return;
        }
        if (Date.now() - started >= DEFAULTS.resetTimeoutMs) {
          finish(true, 'timeout');
        }
      };

      const obs = new MutationObserver(() => check('mutation'));
      obs.observe(document.documentElement, { childList: true, subtree: true });
      const poll = setInterval(() => check('poll'), 50);
    });
  }

  function stopWatchdog() {
    if (state.watchdog) {
      state.watchdog.disconnect();
      state.watchdog = null;
    }
  }

  function armInjectWatchdog(gen, messages, endSec) {
    stopWatchdog();
    if (!messages.length) {
      return;
    }

    const deadline = Date.now() + DEFAULTS.watchdogMs;
    let retries = 0;
    const obs = new MutationObserver(() => {
      if (!state.enabled || gen !== state.lastInjectGen || Date.now() > deadline) {
        stopWatchdog();
        return;
      }
      const found = findChatMemo();
      if (!found) {
        return;
      }
      if (injectedStillPresent(found.parent)) {
        return;
      }
      if (retries >= DEFAULTS.watchdogMaxRetry) {
        stopWatchdog();
        return;
      }
      retries += 1;
      log(`네이티브 채팅 초기화로 지워짐 → 다시 삽입 (${retries}/${DEFAULTS.watchdogMaxRetry})`);
      injectMessages(messages, endSec);
    });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    state.watchdog = obs;
    setTimeout(() => {
      if (state.watchdog === obs) {
        stopWatchdog();
      }
    }, DEFAULTS.watchdogMs + 200);
  }

  async function runRestorePipeline(gen, endSec, boxAtSeek, alreadyReset, reason) {
    if (!state.enabled) {
      state.pipelineActive = false;
      return;
    }
    state.injecting = true;
    try {
      log(`복원 시작 (${reason}) @ ${formatClock(endSec)} / 초기화 대기`);
      const fetchPromise = fetchPreviousMessages(endSec);
      const reset = await waitForChatReset(gen, boxAtSeek, alreadyReset);
      if (gen !== state.lastInjectGen || !state.enabled) {
        return;
      }
      if (!reset.ok) {
        log(`복원 취소 (${reset.why})`);
        return;
      }

      const parent = findChatMemo() && findChatMemo().parent;
      await waitForDomSettle(parent, DEFAULTS.settleQuietMs, DEFAULTS.settleTimeoutMs);
      await new Promise((r) => setTimeout(r, 50));
      if (gen !== state.lastInjectGen || !state.enabled) {
        return;
      }

      const messages = await fetchPromise;
      if (gen !== state.lastInjectGen || !state.enabled) {
        return;
      }

      const ok = injectMessages(messages, endSec);
      if (!ok) {
        warn('채팅 컨테이너를 찾지 못해 삽입하지 못했습니다.');
        return;
      }
      state.lastMessages = messages;
      state.lastEndSec = endSec;
      const fromSec = messages[0] ? messages[0].playbackSec : 0;
      log(`${messages.length}개 이전 채팅 삽입 (${formatClock(fromSec)} ~ ${formatClock(endSec)}, reset=${reset.why})`);
      armInjectWatchdog(gen, messages, endSec);
    } catch (err) {
      warn('이전 채팅 복원 실패', err);
    } finally {
      if (gen === state.lastInjectGen) {
        state.injecting = false;
        state.pipelineActive = false;
      }
    }
  }

  function noteSeek(reason, forcedTime) {
    if (!state.enabled) {
      return;
    }
    const vodId = getVodId();
    if (!vodId) {
      return;
    }
    if (state.vodId && state.vodId !== vodId) {
      resetForNewVod(vodId);
    }

    const t = Number.isFinite(forcedTime) ? forcedTime : getPlaybackTimeSec();
    if (t < DEFAULTS.skipIfNearStartSec) {
      return;
    }

    const now = Date.now();
    const sameSeek = Math.abs(t - state.lastSeekTime) < 1.2 && now - state.lastSeekAt < 2000;

    if (reason === 'boxVstart') {
      state.chatResetFlag = true;
    }

    if (state.pipelineActive && sameSeek) {
      log(`시크 신호 (${reason}) — 초기화 대기 유지 @ ${formatClock(t)}`);
      return;
    }

    stopWatchdog();
    state.lastSeekTime = t;
    state.lastSeekAt = now;
    state.chatResetFlag = reason === 'boxVstart';
    state.pipelineActive = true;
    const boxAtSeek = document.getElementById('boxVstart');
    const gen = ++state.lastInjectGen;
    runRestorePipeline(gen, t, boxAtSeek, reason === 'boxVstart', reason);
  }

  function resetForNewVod(vodId) {
    stopWatchdog();
    state.vodId = vodId;
    state.vodInfo = null;
    state.vodInfoPromise = null;
    state.emoticonMap = new Map();
    state.nativeChatUrl = null;
    state.lastBoxVstart = null;
    state.lastSeekTime = -1;
    state.pendingRestoreSec = null;
    state.pipelineActive = false;
    state.chatResetFlag = false;
    state.lastMessages = [];
    state.lastInjectGen += 1;
  }

  function hookNetwork() {
    const win = getPageWindow();
    const capture = (raw) => {
      if (typeof raw !== 'string') {
        try {
          raw = raw && raw.url ? String(raw.url) : String(raw);
        } catch (_) {
          return;
        }
      }
      if (raw.includes('ChatLoadSplit.php')) {
        rememberNativeChatUrl(raw);
      }
    };

    try {
      const origFetch = win.fetch;
      state.pageFetch = origFetch;
      if (typeof origFetch === 'function' && !origFetch.__soopPrevChatHooked) {
        const wrapped = function (...args) {
          try {
            capture(args[0]);
          } catch (_) { /* ignore */ }
          return origFetch.apply(this, args);
        };
        wrapped.__soopPrevChatHooked = true;
        win.fetch = wrapped;
      }
    } catch (_) { /* ignore */ }

    try {
      const XHR = win.XMLHttpRequest;
      if (XHR && !XHR.prototype.__soopPrevChatHooked) {
        const origOpen = XHR.prototype.open;
        XHR.prototype.open = function (method, url, ...rest) {
          try {
            capture(url);
          } catch (_) { /* ignore */ }
          return origOpen.call(this, method, url, ...rest);
        };
        XHR.prototype.__soopPrevChatHooked = true;
      }
    } catch (_) { /* ignore */ }
  }

  function bindVideo(video) {
    if (!video || video.dataset.soopPrevChatBound === '1') {
      return;
    }
    video.dataset.soopPrevChatBound = '1';
    video.addEventListener('seeking', () => {
      state.chatResetFlag = false;
    });
    video.addEventListener('seeked', () => noteSeek('seeked'));
    video.addEventListener('loadedmetadata', () => {
      if (video.currentTime >= DEFAULTS.skipIfNearStartSec) {
        noteSeek('loadedmetadata');
      }
    });
  }

  function watchDom() {
    const boot = () => {
      bindVideo(getVideo());
      const box = document.getElementById('boxVstart');
      if (box && box !== state.lastBoxVstart) {
        state.lastBoxVstart = box;
        noteSeek('boxVstart');
      }
    };
    boot();
    const observer = new MutationObserver(() => boot());
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setInterval(boot, 1500);
  }

  function watchSpa() {
    let lastPath = location.pathname;
    const onChange = () => {
      if (location.pathname === lastPath) {
        return;
      }
      lastPath = location.pathname;
      const vodId = getVodId();
      if (vodId) {
        resetForNewVod(vodId);
        ensureVodInfo();
        setTimeout(() => noteSeek('spa'), 800);
      }
    };
    const wrap = (fnName) => {
      const orig = history[fnName];
      if (typeof orig !== 'function') {
        return;
      }
      history[fnName] = function (...args) {
        const ret = orig.apply(this, args);
        onChange();
        return ret;
      };
    };
    wrap('pushState');
    wrap('replaceState');
    window.addEventListener('popstate', onChange);
  }

  function injectStyle() {
    if (document.getElementById('soop-prev-chat-style')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'soop-prev-chat-style';
    style.textContent = `
      .soop-prev-chat-marker {
        opacity: 0.65;
        font-size: 11px;
        line-height: 1.4;
        padding: 6px 10px;
        text-align: center;
        user-select: none;
      }
      [${ITEM_ATTR}] .message-text {
        cursor: default;
      }
    `;
    document.documentElement.appendChild(style);
  }

  function bindSettingsBridge() {
    window.addEventListener('message', (event) => {
      if (event.source !== window) {
        return;
      }
      const data = event.data;
      if (!data || data.source !== BRIDGE_SOURCE || data.type !== 'settings') {
        return;
      }
      applySettings(data);
    });
    window.postMessage({ source: MAIN_SOURCE, type: 'hello' }, '*');
  }

  function init() {
    bindSettingsBridge();
    injectStyle();
    hookNetwork();
    watchSpa();
    watchDom();
    ensureVodInfo();
    log(`ready (max previous messages ${state.maxMessages})`);
  }

  init();
})();
