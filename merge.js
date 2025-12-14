// 서버 목록 및 관리
const servers = [
  'https://soop.space:2083'
];

// 현재 서버 인덱스 관리
let currentServerIndex = parseInt(localStorage.getItem('soop_current_server_index') || '0');

// 현재 서버 URL 가져오기
function getCurrentServer() {
  return servers[currentServerIndex];
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
});

// M3U8 구간 처리 기능
document.getElementById('process-playlist').addEventListener('click', async () => {
  const processButton = document.getElementById('process-playlist');
  const playlistInput = document.getElementById('playlist-file');
  const startTimeInput = document.getElementById('start-time');
  const endTimeInput = document.getElementById('end-time');
  const includeTitleCheckbox = document.getElementById('include-title-playlist');

  const playlistFile = playlistInput.files[0];
  const startTime = startTimeInput.value;
  const endTime = endTimeInput.value;
  const includeTitle = includeTitleCheckbox.checked;

  if (!playlistFile) {
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
    await processPlaylistFile(playlistFile, startSeconds, duration, includeTitle);
    processButton.innerText = '구간 영상 다운로드';
    alert('구간 영상이 성공적으로 다운로드되었습니다!');
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
  const playlistInput = document.getElementById('playlist-file');
  const includeTitleCheckbox = document.getElementById('include-title-playlist');

  const playlistFile = playlistInput.files[0];
  const includeTitle = includeTitleCheckbox.checked;

  if (!playlistFile) {
    alert('playlist.m3u8 파일을 선택해주세요.');
    return;
  }

  setPlaylistProcessingState(true);
  downloadButton.innerText = '전체 영상 처리 중...';

  try {
    await processPlaylistFile(playlistFile, 0, null, includeTitle);
    downloadButton.innerText = '전체 영상 다운로드';
    alert('전체 영상이 성공적으로 다운로드되었습니다!');
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

// 플레이리스트 파일에서 제목 추출
function extractTitleFromPlaylist(filename) {
  return filename.replace('_playlist.m3u8', '').replace('.m3u8', '').trim();
}

// 플레이리스트 파일 처리 함수 (서버 자동 선택 적용)
async function processPlaylistFile(playlistFile, startTime, duration, includeTitle) {
  const formData = new FormData();
  const title = extractTitleFromPlaylist(playlistFile.name);

  formData.append('playlistFile', playlistFile);
  formData.append('startTime', startTime.toString());
  if (duration !== null) {
    formData.append('duration', duration.toString());
  }
  formData.append('title', title);
  formData.append('includeTitle', includeTitle.toString());

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
  a.download = includeTitle ? `${title}.mp4` : 'video.mp4';
  document.body.appendChild(a);
  a.click();
  window.URL.revokeObjectURL(url);
  document.body.removeChild(a);
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
