// 서버 목록 및 관리
const servers = [
  'https://soop.space:2083'
];

const DEFAULT_NOTICE_SOURCE_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vQn9MdI81blZLum0uthQhTCKHT0xxaZDk7NWmIQL6fCicMgOYNIEx3Z5mF3LLwbv_d0Ny_8JcAd3OZa/pubhtml?gid=0&single=true';

// 현재 서버 인덱스 관리
let currentServerIndex = parseInt(localStorage.getItem('soop_current_server_index') || '0');

// 현재 서버 URL 가져오기
function getCurrentServer() {
  return servers[currentServerIndex];
}

function normalizeGoogleSheetUrl(rawUrl) {
  if (!rawUrl || !rawUrl.trim()) {
    return '';
  }

  try {
    const url = new URL(rawUrl.trim());
    const gid = url.searchParams.get('gid') || '0';

    if (url.hostname !== 'docs.google.com') {
      return url.toString();
    }

    if (url.pathname.includes('/pubhtml')) {
      url.pathname = url.pathname.replace('/pubhtml', '/pub');
      url.searchParams.set('gid', gid);
      url.searchParams.set('single', url.searchParams.get('single') || 'true');
      url.searchParams.set('output', 'tsv');
      return url.toString();
    }

    if (url.pathname.includes('/pub')) {
      url.searchParams.set('gid', gid);
      url.searchParams.set('single', url.searchParams.get('single') || 'true');
      url.searchParams.set('output', 'tsv');
      return url.toString();
    }

    const privateSheetMatch = url.pathname.match(/^\/spreadsheets\/d\/([^/]+)\//);
    if (privateSheetMatch) {
      url.pathname = `/spreadsheets/d/${privateSheetMatch[1]}/export`;
      url.search = '';
      url.searchParams.set('format', 'tsv');
      url.searchParams.set('gid', gid);
      return url.toString();
    }

    return url.toString();
  } catch (error) {
    return '';
  }
}

function normalizeNoticeHeader(header) {
  const normalized = header.trim().toLowerCase().replace(/[\s_-]+/g, '');
  const headerAliases = {
    enabled: ['enabled', 'use', 'show', 'visible', '사용', '노출', '활성'],
    title: ['title', '제목'],
    message: ['message', 'body', 'content', '내용', '본문', '공지'],
    linkText: ['linktext', 'buttontext', '버튼텍스트', '링크텍스트', '링크이름'],
    linkUrl: ['linkurl', 'buttonurl', '버튼링크', '링크url', 'url', '링크'],
    updatedAt: ['updatedat', 'updated', 'date', '수정일', '업데이트일']
  };

  for (const [canonicalName, aliases] of Object.entries(headerAliases)) {
    if (aliases.includes(normalized)) {
      return canonicalName;
    }
  }

  return normalized;
}

function splitDelimitedLine(line, delimiter) {
  const values = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === delimiter && !inQuotes) {
      values.push(current);
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current);
  return values;
}

function parseNoticeSheet(text) {
  const normalizedText = text.replace(/\r\n/g, '\n').trim();
  if (!normalizedText) {
    return [];
  }

  const lines = normalizedText.split('\n').filter(line => line.trim() !== '');
  if (lines.length < 2) {
    return [];
  }

  const headers = splitDelimitedLine(lines[0], '\t').map(normalizeNoticeHeader);
  return lines.slice(1).map(line => {
    const row = {};
    const values = splitDelimitedLine(line, '\t');

    headers.forEach((header, index) => {
      if (!header) {
        return;
      }
      row[header] = (values[index] || '').trim();
    });

    return row;
  });
}

function isNoticeEnabled(value) {
  const normalized = String(value || 'true').trim().toLowerCase();
  return !['0', 'false', 'no', 'off', '숨김', '비활성'].includes(normalized);
}

function createNoticeItem(row) {
  if (!isNoticeEnabled(row.enabled)) {
    return null;
  }

  const rawTitle = (row.title || '').trim();
  const message = (row.message || '').replace(/\\n/g, '\n').trim();
  const linkText = (row.linkText || '자세히 보기').trim();
  const linkUrl = (row.linkUrl || '').trim();
  const updatedAt = (row.updatedAt || '').trim();

  if (!rawTitle && !message && !linkUrl) {
    return null;
  }

  return {
    title: rawTitle || '공지',
    message,
    linkText,
    linkUrl,
    updatedAt
  };
}

function setNoticeStatus(message, isError = false) {
  const noticeSection = document.getElementById('notice-section');
  const noticeStatus = document.getElementById('notice-status');
  noticeSection.hidden = false;
  noticeStatus.textContent = message;
  noticeStatus.classList.toggle('error', isError);
}

function renderNotices(notices) {
  const noticeSection = document.getElementById('notice-section');
  const noticeList = document.getElementById('notice-list');
  const noticeStatus = document.getElementById('notice-status');

  noticeSection.hidden = false;
  noticeStatus.classList.remove('error');
  noticeStatus.textContent = `공지 ${notices.length}건을 불러왔습니다.`;
  noticeList.innerHTML = '';

  notices.forEach(notice => {
    const noticeItem = document.createElement('article');
    noticeItem.className = 'notice-item';

    const titleElement = document.createElement('h3');
    titleElement.textContent = notice.title;
    noticeItem.appendChild(titleElement);

    if (notice.message) {
      const messageElement = document.createElement('p');
      messageElement.className = 'notice-message';
      messageElement.textContent = notice.message;
      noticeItem.appendChild(messageElement);
    }

    if (notice.linkUrl) {
      const linkElement = document.createElement('a');
      linkElement.className = 'notice-link';
      linkElement.href = notice.linkUrl;
      linkElement.target = '_blank';
      linkElement.rel = 'noreferrer noopener';
      linkElement.textContent = notice.linkText;
      noticeItem.appendChild(linkElement);
    }

    if (notice.updatedAt) {
      const metaElement = document.createElement('div');
      metaElement.className = 'notice-meta';
      metaElement.textContent = `수정일: ${notice.updatedAt}`;
      noticeItem.appendChild(metaElement);
    }

    noticeList.appendChild(noticeItem);
  });
}

async function loadNoticeFeed() {
  const refreshButton = document.getElementById('refresh-notice-btn');
  const noticeList = document.getElementById('notice-list');
  const noticeUrl = normalizeGoogleSheetUrl(DEFAULT_NOTICE_SOURCE_URL);

  noticeList.innerHTML = '';

  if (!noticeUrl) {
    setNoticeStatus('공지 시트 URL이 설정되지 않았습니다.', true);
    return;
  }

  refreshButton.disabled = true;
  refreshButton.textContent = '공지 확인 중...';
  setNoticeStatus('공지사항을 불러오는 중입니다...');

  try {
    const response = await fetch(noticeUrl, {
      method: 'GET',
      cache: 'no-store'
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const text = await response.text();
    const notices = parseNoticeSheet(text)
      .map(createNoticeItem)
      .filter(Boolean);

    if (!notices.length) {
      setNoticeStatus('표시할 공지가 없습니다.');
      return;
    }

    renderNotices(notices);
  } catch (error) {
    console.error('공지사항 로드 실패:', error);
    setNoticeStatus('공지사항을 불러오지 못했습니다. 시트를 웹에 게시했는지와 링크가 올바른지 확인해주세요.', true);
  } finally {
    refreshButton.disabled = false;
    refreshButton.textContent = '공지 새로고침';
  }
}

// 다음 서버로 변경
function switchToNextServer() {
  currentServerIndex = (currentServerIndex + 1) % servers.length;
  localStorage.setItem('soop_current_server_index', currentServerIndex);
  updateServerDisplay();
  console.log(`서버 변경: ${getCurrentServer()}`);
}

// 서버 상태 표시 업데이트
function updateServerDisplay() {
  const serverDisplay = document.getElementById('current-server-display');
  const currentServer = getCurrentServer();
  const serverNumber = currentServerIndex + 1;
  serverDisplay.textContent = `현재 서버: 서버 ${serverNumber} (${currentServer})`;
}

// 서버 상태 확인
async function checkServerHealth(serverUrl) {
  try {
    const response = await fetch(`${serverUrl}/health`, {
      method: 'GET',
      timeout: 5000,
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
    return response.ok;
  } catch (error) {
    return false;
  }
}

// 건강한 서버 찾기
async function findHealthyServer() {
  for (let i = 0; i < servers.length; i++) {
    const serverIndex = (currentServerIndex + i) % servers.length;
    const server = servers[serverIndex];

    const isHealthy = await checkServerHealth(server);
    if (isHealthy) {
      if (serverIndex !== currentServerIndex) {
        currentServerIndex = serverIndex;
        localStorage.setItem('soop_current_server_index', currentServerIndex);
        updateServerDisplay();
      }
      return server;
    }
  }
  throw new Error('모든 서버가 사용 불가능합니다');
}

// 시간 형식 유효성 검사
function validateTimeFormat(timeString) {
  const timeRegex = /^([0-9]{1,2}):([0-5][0-9]):([0-5][0-9])$/;
  const match = timeString.match(timeRegex);
  if (!match) {
    return false;
  }

  const hours = parseInt(match[1]);
  const minutes = parseInt(match[2]);
  const seconds = parseInt(match[3]);
  return hours >= 0 && minutes >= 0 && minutes < 60 && seconds >= 0 && seconds < 60;
}

// 시간 입력 자동 포맷팅
function formatTimeInput(input) {
  input.addEventListener('input', function (e) {
    let value = e.target.value.replace(/[^\d]/g, '');
    if (value.length >= 2) {
      value = value.substring(0, 2) + ':' + value.substring(2);
    }
    if (value.length >= 5) {
      value = value.substring(0, 5) + ':' + value.substring(5, 7);
    }
    e.target.value = value;
  });
}

// 플레이리스트 처리 상태 관리
let isProcessingPlaylist = false;
function setPlaylistProcessingState(processing) {
  isProcessingPlaylist = processing;
  const processButton = document.getElementById('process-playlist');
  const downloadButton = document.getElementById('download-full-video');
  const playlistInput = document.getElementById('playlist-file');
  const startTimeInput = document.getElementById('start-time');
  const endTimeInput = document.getElementById('end-time');
  const includeTitleCheckbox = document.getElementById('include-title-playlist');

  if (processing) {
    processButton.disabled = true;
    downloadButton.disabled = true;
    playlistInput.disabled = true;
    startTimeInput.disabled = true;
    endTimeInput.disabled = true;
    includeTitleCheckbox.disabled = true;
  } else {
    processButton.disabled = false;
    downloadButton.disabled = false;
    playlistInput.disabled = false;
    startTimeInput.disabled = false;
    endTimeInput.disabled = false;
    includeTitleCheckbox.disabled = false;
  }
}

// 페이지 로드 시 초기화
document.addEventListener('DOMContentLoaded', () => {
  const startTimeInput = document.getElementById('start-time');
  const endTimeInput = document.getElementById('end-time');
  formatTimeInput(startTimeInput);
  formatTimeInput(endTimeInput);
  updateButtonState();
  updateServerDisplay();

  // 서버 변경 버튼 이벤트
  document.getElementById('change-server-btn').addEventListener('click', () => {
    switchToNextServer();
    alert(`서버가 변경되었습니다: 서버 ${currentServerIndex + 1}`);
  });

  // 서버 새로고침 버튼 이벤트
  document.getElementById('refresh-server-btn').addEventListener('click', async () => {
    const refreshBtn = document.getElementById('refresh-server-btn');
    refreshBtn.disabled = true;
    refreshBtn.textContent = '확인 중...';

    try {
      await findHealthyServer();
      alert(`서버 상태 확인 완료: 서버 ${currentServerIndex + 1}`);
    } catch (error) {
      alert('모든 서버가 응답하지 않습니다. 잠시 후 다시 시도해주세요.');
    } finally {
      refreshBtn.disabled = false;
      refreshBtn.textContent = '서버 새로고침';
    }
  });

  // F5 새로고침 시 서버 변경
  window.addEventListener('beforeunload', function () {
    switchToNextServer();
  });

  document.getElementById('refresh-notice-btn').addEventListener('click', () => {
    loadNoticeFeed();
  });

  loadNoticeFeed();
});

// M3U8 구간 처리 기능
document.getElementById('process-playlist').addEventListener('click', async () => {
  const processButton = document.getElementById('process-playlist');
  const startTimeInput = document.getElementById('start-time');
  const endTimeInput = document.getElementById('end-time');
  const includeTitleCheckbox = document.getElementById('include-title-playlist');

  const playlistFiles = getSelectedPlaylistFiles();
  const startTime = startTimeInput.value;
  const endTime = endTimeInput.value;
  const includeTitle = includeTitleCheckbox.checked;

  if (playlistFiles.length === 0) {
    alert('playlist.m3u8 파일을 선택해주세요.');
    return;
  }

  if (!startTime || !endTime) {
    alert('시작 시간과 종료 시간을 모두 입력해주세요.');
    return;
  }

  if (!validateTimeFormat(startTime)) {
    alert('시작 시간 형식이 올바르지 않습니다. (예: 00:05:30)');
    return;
  }

  if (!validateTimeFormat(endTime)) {
    alert('종료 시간 형식이 올바르지 않습니다. (예: 01:30:45)');
    return;
  }

  const startSeconds = timeToSeconds(startTime);
  const endSeconds = timeToSeconds(endTime);
  const duration = endSeconds - startSeconds;

  if (duration <= 0) {
    alert('종료 시간이 시작 시간보다 늦어야 합니다.');
    return;
  }

  setPlaylistProcessingState(true);
  processButton.innerText = '서버에서 처리 중...';

  try {
    const result = await processPlaylistFilesSequentially(
      playlistFiles,
      startSeconds,
      duration,
      includeTitle,
      {
        onProgress: (index, playlistFile, total) => {
          processButton.innerText = total > 1
            ? `구간 처리 중 (${index + 1}/${total})`
            : '서버에서 처리 중...';
        }
      }
    );
    processButton.innerText = '구간 영상 다운로드';
    alert(buildBatchResultMessage(result, includeTitle, result.forceTitle));
  } catch (error) {
    console.error('Error processing playlist:', error);
    alert(`구간 영상 처리 중 오류가 발생했습니다: ${error.message}`);
    processButton.innerText = '구간 영상 다운로드';
  } finally {
    setPlaylistProcessingState(false);
  }
});

// 전체 영상 다운로드
document.getElementById('download-full-video').addEventListener('click', async () => {
  const downloadButton = document.getElementById('download-full-video');
  const includeTitleCheckbox = document.getElementById('include-title-playlist');

  const playlistFiles = getSelectedPlaylistFiles();
  const includeTitle = includeTitleCheckbox.checked;

  if (playlistFiles.length === 0) {
    alert('playlist.m3u8 파일을 선택해주세요.');
    return;
  }

  setPlaylistProcessingState(true);
  downloadButton.innerText = '전체 영상 처리 중...';

  try {
    const result = await processPlaylistFilesSequentially(
      playlistFiles,
      0,
      null,
      includeTitle,
      {
        onProgress: (index, playlistFile, total) => {
          downloadButton.innerText = total > 1
            ? `전체 처리 중 (${index + 1}/${total})`
            : '전체 영상 처리 중...';
        }
      }
    );
    downloadButton.innerText = '전체 영상 다운로드';
    alert(buildBatchResultMessage(result, includeTitle, result.forceTitle));
  } catch (error) {
    console.error('Error downloading full video:', error);
    alert(`전체 영상 다운로드 중 오류가 발생했습니다: ${error.message}`);
    downloadButton.innerText = '전체 영상 다운로드';
  } finally {
    setPlaylistProcessingState(false);
  }
});

// ZIP 파일 다운로드 기능
document.getElementById('download-zip').addEventListener('click', function () {
  downloadZipFile();
});

// ZIP 파일 다운로드 함수 (서버 자동 선택 적용)
async function downloadZipFile() {
  const button = document.getElementById('download-zip');
  button.disabled = true;
  button.textContent = '다운로드 중...';

  try {
    const server = await findHealthyServer();
    const response = await fetch(`${server}/download-zip`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache'
      }
    });

    if (!response.ok) {
      throw new Error('ZIP 파일 다운로드에 실패했습니다.');
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = url;
    a.download = 'download.zip';
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    alert('ZIP 파일 다운로드가 완료되었습니다.');

  } catch (error) {
    console.error('Error:', error);
    alert('ZIP 파일 다운로드 중 오류가 발생했습니다: ' + error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'ZIP 파일 다운로드';
  }
}

// 시간 문자열을 초로 변환
function timeToSeconds(timeString) {
  const [hours, minutes, seconds] = timeString.split(':').map(Number);
  return (hours * 3600) + (minutes * 60) + seconds;
}

function sortPlaylistFiles(files) {
  return [...files].sort((left, right) => (
    left.name.localeCompare(right.name, 'ko', { numeric: true, sensitivity: 'base' })
  ));
}

function getSelectedPlaylistFiles() {
  const playlistInput = document.getElementById('playlist-file');
  return sortPlaylistFiles(Array.from(playlistInput?.files || []));
}

// 플레이리스트 파일에서 제목 추출
function extractTitleFromPlaylist(filename) {
  return filename.replace('_playlist.m3u8', '').replace('.m3u8', '').trim();
}

function detectPlaylistModeFromContent(content) {
  const lines = String(content || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.some((line) => line.startsWith('# Original URL:'))) {
    return 'standard';
  }

  const hasExtM3u = lines.includes('#EXTM3U');
  const hasAbsoluteMediaUrl = lines.some((line) => /^https?:\/\//i.test(line));
  const hasMediaEntries = lines.some((line) => line.startsWith('#EXTINF:') || line.startsWith('#EXT-X-MAP:'));

  return hasExtM3u && hasAbsoluteMediaUrl && hasMediaEntries ? 'merged' : 'standard';
}

// 플레이리스트 파일 처리 함수 (서버 자동 선택 적용)
async function processPlaylistFile(playlistFile, startTime, duration, includeTitle, options = {}) {
  const formData = new FormData();
  const title = extractTitleFromPlaylist(playlistFile.name);
  const playlistContent = await playlistFile.text();
  const playlistMode = detectPlaylistModeFromContent(playlistContent);
  const resolvedIncludeTitle = includeTitle || Boolean(options.forceTitle);

  formData.append('playlistFile', playlistFile);
  formData.append('startTime', startTime.toString());
  if (duration !== null) {
    formData.append('duration', duration.toString());
  }
  formData.append('title', title);
  formData.append('includeTitle', resolvedIncludeTitle.toString());
  formData.append('playlistMode', playlistMode);

  const server = await findHealthyServer();
  const response = await fetch(`${server}/process-playlist`, {
    method: 'POST',
    body: formData,
    headers: {
      'Cache-Control': 'no-cache'
    }
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}));
    throw new Error(errorData.error || 'Network response was not ok');
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.style.display = 'none';
  a.href = url;
  a.download = resolvedIncludeTitle ? `${title}.mp4` : 'video.mp4';
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
  return {
    title,
    downloadName: a.download
  };
}

function buildBatchResultMessage(result, includeTitle, forceTitle) {
  const lines = [
    `${result.successes.length}개 파일 다운로드를 요청했습니다.`
  ];

  if (forceTitle && !includeTitle) {
    lines.push('동일한 video.mp4 이름 충돌을 막기 위해 제목 포함 저장을 자동 적용했습니다.');
  }

  if (result.failures.length > 0) {
    lines.push(`실패 ${result.failures.length}개`);
    result.failures.slice(0, 3).forEach((failure) => {
      lines.push(`- ${failure.name}: ${failure.message}`);
    });
  }

  return lines.join('\n');
}

async function processPlaylistFilesSequentially(playlistFiles, startTime, duration, includeTitle, options = {}) {
  const forceTitle = playlistFiles.length > 1;
  const result = {
    successes: [],
    failures: [],
    forceTitle
  };

  for (let index = 0; index < playlistFiles.length; index++) {
    const playlistFile = playlistFiles[index];
    if (typeof options.onProgress === 'function') {
      options.onProgress(index, playlistFile, playlistFiles.length);
    }

    try {
      const downloadResult = await processPlaylistFile(
        playlistFile,
        startTime,
        duration,
        includeTitle,
        { forceTitle }
      );
      result.successes.push({
        name: playlistFile.name,
        title: downloadResult.title
      });
    } catch (error) {
      result.failures.push({
        name: playlistFile.name,
        message: error.message
      });
    }

    if (index < playlistFiles.length - 1) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  return result;
}

// 서버 재시작 기능 (서버 자동 선택 적용)
const restartButton = document.getElementById('restart-server');
const countdownDiv = document.getElementById('countdown');

async function updateButtonState() {
  try {
    const server = await findHealthyServer();
    const response = await fetch(`${server}/restart-status`, {
      headers: {
        'Cache-Control': 'no-cache'
      }
    });
    const data = await response.json();

    if (!data.can_restart) {
      const remainingTime = data.remaining_time;
      setButtonState(false, remainingTime);
    } else {
      setButtonState(true);
    }
  } catch (error) {
    console.error('서버 상태 확인 중 오류 발생:', error);
  }
}

function setButtonState(isEnabled, remainingTime = 0) {
  if (isEnabled) {
    restartButton.disabled = false;
    restartButton.innerText = "서버 재시작";
    countdownDiv.style.display = "none";
  } else {
    restartButton.disabled = true;
    restartButton.innerText = "30분 대기 중...";
    countdownDiv.style.display = "block";
    startCountdown(remainingTime);
  }
}

function startCountdown(seconds) {
  const updateCountdown = () => {
    if (seconds <= 0) {
      setButtonState(true);
      return;
    }
    countdownDiv.innerText = `남은 시간: ${formatTime(seconds)}`;
    seconds--;
    setTimeout(updateCountdown, 1000);
  };
  updateCountdown();
}

function formatTime(seconds) {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}분 ${remainingSeconds}초`;
}

restartButton.addEventListener('click', async () => {
  restartButton.disabled = true;
  restartButton.innerText = "재시작 중...";

  try {
    const server = await findHealthyServer();
    const response = await fetch(`${server}/restart`, {
      method: 'POST',
      headers: {
        'Cache-Control': 'no-cache'
      }
    });

    if (response.ok) {
      alert('서버 재시작 요청 성공!');
      setButtonState(false, 30 * 60);
    } else if (response.status === 429) {
      const data = await response.json();
      alert(`서버 재시작 요청 제한: 남은 시간 ${data.remaining_time}초`);
      setButtonState(false, data.remaining_time);
    } else {
      alert('서버 재시작 요청 실패.');
      restartButton.disabled = false;
      restartButton.innerText = "서버 재시작";
    }
  } catch (e) {
    console.error('서버 재시작 요청 중 오류 발생:', e);
    alert('서버 재시작 요청 중 오류가 발생했습니다.');
    restartButton.disabled = false;
    restartButton.innerText = "서버 재시작";
  }
});
