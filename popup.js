document.addEventListener('DOMContentLoaded', () => {
  // 초기 로드 시 비디오 정보 추출 및 목록 표시
  refreshVideoList();

  // 고급 자동 스캔 버튼 이벤트
  document.getElementById('auto-scan').addEventListener('click', () => {
    handleAdvancedScan();
  });

  // 새로고침 버튼 이벤트
  document.getElementById('refresh-list').addEventListener('click', () => {
    refreshVideoList();
  });

  // 파일 병합 페이지 이동
  document.getElementById('merge-move').addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('merge.html') });
  });

  // 로컬 다운로드용 ffmpeg 명령어 복사
  document.getElementById('copy-ffmpeg').addEventListener('click', () => {
    handleFfmpegCopy();
  });

  // 후원 버튼
  document.getElementById('support-button').addEventListener('click', () => {
    chrome.tabs.create({ url: 'https://buymeacoffee.com/sooplivevod' });
  });

  // FFMPEG 설치 명령 복사
  document.getElementById('install-ffmpeg').addEventListener('click', () => {
    handleFfmpegInstall();
  });
});

function handleAdvancedScan() {
  const chapterListDiv = document.getElementById('chapter-list');
  chapterListDiv.innerHTML = '<p style="color: #4CAF50;">고급 자동 스캔 중입니다...<br>플레이어의 재생 위치가 이동될 수 있습니다.</p>';

  const btn = document.getElementById('auto-scan');
  btn.disabled = true;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabs[0].id },
        world: 'MAIN',
        function: advancedScanSegments
      },
      (results) => {
        btn.disabled = false;
        if (results && results[0] && results[0].result) {
          const { success, message, foundCount } = results[0].result;
          if (success) {
            refreshVideoList();
            alert(`스캔 완료! 총 ${foundCount}개의 구성을 찾았습니다.`);
          } else {
            chapterListDiv.innerHTML = `<p style="color: #ff6b6b;">스캔 실패: ${message}</p>`;
            alert(`스캔 실패: ${message}`);
          }
        } else {
          chapterListDiv.innerHTML = '<p style="color: #ff6b6b;">스크립트 실행 실패</p>';
        }
      }
    );
  });
}

// 이 함수는 페이지 내에서 실행됩니다 (Content Script Context)
async function advancedScanSegments() {
  try {
    const timeDisplay = document.querySelector('.time_display');
    if (!timeDisplay) return { success: false, message: '시간 표시 엘리먼트를 찾을 수 없습니다.' };

    const durationText = timeDisplay.querySelector('.time-duration')?.textContent || "";
    const totalSeconds = parseTimeToSeconds(durationText);
    if (!totalSeconds) return { success: false, message: '전체 재생 시간을 파악할 수 없습니다.' };

    console.log(`Total Duration: ${totalSeconds}s (${durationText})`);

    let foundM3u8s = [];
    const video = document.querySelector('video');

    const getUniqueM3u8s = () => {
      const resources = performance.getEntriesByType('resource');
      const urls = resources
        .filter(r => r.name.includes('.m3u8') && !r.name.includes('.smil'))
        .map(r => r.name);

      const videoEl = document.querySelector('video');
      if (videoEl && videoEl.src && videoEl.src.includes('.m3u8') && !videoEl.src.includes('.smil')) {
        urls.push(videoEl.src);
      }
      return [...new Set(urls)];
    };

    const getM3u8Duration = async (url) => {
      try {
        const resp = await fetch(url);
        if (!resp.ok) return 0;
        const manifestText = await resp.text();

        // 1. EXT-X-TOTAL_DURATION 또는 TOTAL-DURATION 확인 (대시/언더스코어 대응)
        const totalDurationRegex = /#EXT-X-TOTAL[-_]DURATION:([\d.]+)/i;
        const totalMatch = totalDurationRegex.exec(manifestText);
        if (totalMatch) {
          const dur = parseFloat(totalMatch[1]);
          console.log(`[Parsed] m3u8 TOTAL_DURATION: ${dur}s from ${url}`);
          return dur;
        }

        // 2. 변체 플레이리스트(Variant Playlist) 확인
        const variantPlaylistRegex = /#EXT-X-STREAM-INF:.*RESOLUTION=(\d+x\d+).*\n(.*?\.m3u8)/g;
        let variantMatch = variantPlaylistRegex.exec(manifestText);
        if (variantMatch) {
          const variantUrl = new URL(variantMatch[2], url).href;
          return await getM3u8Duration(variantUrl);
        }

        // 3. 총 비디오 길이 계산 (Regex 사용)
        let duration = 0;
        const extinfRegex = /#EXTINF:([\d.]+),/g;
        let match;
        while ((match = extinfRegex.exec(manifestText)) !== null) {
          duration += parseFloat(match[1]);
        }
        console.log(`[Parsed] m3u8 EXTINF Sum: ${duration}s from ${url}`);
        return duration;
      } catch (e) {
        return 0;
      }
    };

    function parseTimeToSeconds(timeStr) {
      const parts = timeStr.split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return 0;
    }

    let currentTotalDetected = 0;
    let attempts = 0;
    const maxAttempts = 20;

    // 초기 상태에서 이미 로드된 m3u8들을 먼저 수집
    const initialUrls = getUniqueM3u8s();
    for (const url of initialUrls) {
      if (!foundM3u8s.includes(url)) {
        const dur = await getM3u8Duration(url);
        if (dur > 0) {
          foundM3u8s.push(url);
          currentTotalDetected += dur;
          console.log(`Initial m3u8 found: ${url}, Duration: ${dur}s, Total Detected: ${currentTotalDetected}s`);
        }
      }
    }

    let failedAttempts = 0; // 연속 실패 횟수 기록

    while (currentTotalDetected < totalSeconds - 10 && attempts < maxAttempts) {
      // 1. 종료 조건 강화: 이미 99% 이상 찾았거나 남은 시간이 매우 적은데 계속 실패할 경우
      if (currentTotalDetected >= totalSeconds - 20 && failedAttempts >= 2) {
        console.log("[Scan] Very close to end and no new segments. Stopping.");
        break;
      }
      if (currentTotalDetected >= totalSeconds - 1) {
        console.log("[Scan] All durations accounted for. Stopping.");
        break;
      }

      // 다음 구간 탐색 지점: 현재 감지된 끝부분 + 5초
      const jumpTo = Math.min(currentTotalDetected + 5, totalSeconds - 1);

      console.log(`[Scan] Detected: ${currentTotalDetected.toFixed(1)}s / Total: ${totalSeconds}s`);
      console.log(`[Scan] Jumping to ${jumpTo.toFixed(1)}s to trigger next m3u8 load...`);

      const videoEl = document.querySelector('video');
      if (videoEl) {
        // 네이티브 API(vodCore.seek) 우선 사용, 없으면 currentTime 직접 제어
        if (window.vodCore && typeof window.vodCore.seek === 'function') {
          console.log(`[Scan] Using vodCore.seek(${jumpTo.toFixed(1)})`);
          window.vodCore.seek(jumpTo);
        } else {
          videoEl.currentTime = jumpTo;
        }
        // 네트워크 요청 및 플레이어 동기화를 위해 대기
        await new Promise(r => setTimeout(r, 4500));

        const currentUrls = getUniqueM3u8s();
        const newUrls = currentUrls.filter(url => !foundM3u8s.includes(url));

        let foundNewInLoop = false;
        for (const url of newUrls) {
          const dur = await getM3u8Duration(url);
          if (dur > 0) {
            foundM3u8s.push(url);
            currentTotalDetected += dur;
            foundNewInLoop = true;
            failedAttempts = 0; // 성공 시 실패 횟수 리셋
            console.log(`[Success] New segment found! Duration: ${dur}s. Total now: ${currentTotalDetected.toFixed(1)}s`);
          }
        }

        if (!foundNewInLoop) {
          failedAttempts++;
          console.log(`[Check] No new m3u8 at ${jumpTo.toFixed(1)}s. (Failed attempts: ${failedAttempts})`);

          // 4회 이상 연속 실패 시 더 이상 찾을 수 없다고 판단하고 종료 (끝부분인 경우)
          if (currentTotalDetected > totalSeconds - 60 && failedAttempts >= 3) {
            console.log("[Scan] Near end and repeated failure. Finishing scan.");
            break;
          }

          // 3회마다 더 멀리 시도 (현재 감지된 위치 기준)
          if (attempts > 0 && attempts % 3 === 0) {
            const forceJump = Math.min(currentTotalDetected + 600, totalSeconds - 10); // 10분 뒤로 이동
            if (forceJump > jumpTo) {
              console.log(`[Action] Forcing a jump to ${forceJump.toFixed(1)}s to find next segment...`);
              if (window.vodCore && typeof window.vodCore.seek === 'function') {
                window.vodCore.seek(forceJump);
              } else {
                videoEl.currentTime = forceJump;
              }
              await new Promise(r => setTimeout(r, 4000));
            } else if (currentTotalDetected > totalSeconds - 30) {
              // 더 이상 점프할 곳이 없는데 끝부분이면 종료
              console.log("[Scan] Cannot force jump further and near end. Stopping.");
              break;
            }
          }
        }
      } else {
        break;
      }
      attempts++;
    }

    return {
      success: true,
      foundCount: foundM3u8s.length,
      totalDetected: currentTotalDetected,
      message: `스캔 완료 (${foundM3u8s.length}개 탐색)`
    };

  } catch (e) {
    return { success: false, message: e.message };
  }
}

function handleAutoScan() {
  const chapterListDiv = document.getElementById('chapter-list');
  chapterListDiv.innerHTML = '<p style="color: #4CAF50;"><svg class="icon" viewBox="0 0 24 24" style="margin-right: 5px; stroke: #4CAF50;"><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.71-2.13.09-2.91a2.18 2.18 0 0 0-3.09-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-5c1.62-2.2 5-3 5-3"/><path d="M12 15v5s3.03-.55 5-2c2.2-1.62 3-5 3-5"/></svg> 정밀 자동 스캔 중입니다...<br>모든 파트를 탐색 중이니 플레이어를 조작하지 마세요.</p>';

  const btn = document.getElementById('auto-scan');
  btn.disabled = true;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabs[0].id },
        world: 'MAIN', // window.vodCore 접근을 위해 MAIN 월드에서 실행
        function: autoScanChapters
      },
      (results) => {
        btn.disabled = false;
        if (results && results[0] && results[0].result) {
          const { success, message } = results[0].result;
          if (success) {
            refreshVideoList(); // 스캔 완료 후 목록 갱신
            alert('자동 스캔이 완료되었습니다!');
          } else {
            chapterListDiv.innerHTML = `<p style="color: #ff6b6b;">스캔 실패: ${message}</p>`;
            alert(`자동 스캔 실패: ${message}`);
          }
        } else {
          chapterListDiv.innerHTML = '<p style="color: #ff6b6b;">스캔 스크립트 실행 실패</p>';
        }
      }
    );

  });
}

// 이 함수는 페이지 내에서 실행됩니다 (Content Script Context)
async function autoScanChapters() {
  try {
    console.log('Auto Scan Started');

    // 0. 플레이어 UI 깨우기 (전체화면 대응)
    const playerArea = document.querySelector('#player_area') || document.body;
    if (playerArea) {
      console.log('Waking up player UI by clicking...');
      const clickEvent = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true,
        clientX: window.innerWidth / 2,
        clientY: window.innerHeight - 50 // Click near bottom center
      });
      playerArea.dispatchEvent(clickEvent);
      // UI 애니메이션 대기
      await new Promise(r => setTimeout(r, 1500)); // Increased wait
    }

    // 1. 챕터 목록 열기 시도
    let listOpened = false;

    // 이미 챕터 목록이 열려있는지 확인
    const existingChapterList = document.querySelector('.chapter_list');
    if (existingChapterList && existingChapterList.offsetParent !== null) {
      console.log('Chapter list is already open. Skipping open step.');
      listOpened = true;
    }

    if (!listOpened) {
      // 우선순위 1: 하단 챕터 제목 (전체화면 등에서 챕터 목록 토글)
      const chapterTitleBtn = document.querySelector('#player .chapter_title button');
      if (chapterTitleBtn && chapterTitleBtn.offsetParent !== null) {
        console.log('Clicking Chapter Title (Bottom)');
        chapterTitleBtn.click();
        listOpened = true;
      }
    }

    // 우선순위 2: '챕터' 텍스트가 포함된 모든 클릭 가능한 요소 검색
    if (!listOpened) {
      const allElements = Array.from(document.querySelectorAll('button, a, span, div'));
      const chapterBtn = allElements.find(el => {
        const text = el.textContent ? el.textContent.trim() : '';
        return (text === '챕터' || text === 'Chapter') && el.offsetParent !== null;
      });

      if (chapterBtn) {
        console.log('Clicking Chapter Element:', chapterBtn);
        chapterBtn.click();
        listOpened = true;
      }
    }

    // 우선순위 3: 리스트 버튼 (ID 기반)
    if (!listOpened) {
      const listBtn = document.querySelector('#btnList button');
      if (listBtn && listBtn.offsetParent !== null) {
        console.log('Clicking List Button (Fallback by ID)');
        listBtn.click();
        listOpened = true;
      }
    }

    // 우선순위 4: 리스트 버튼 (클래스명 기반 - 더 넓게)
    if (!listOpened) {
      const listBtnClass = document.querySelector('.btn_list button, [class*="btn_list"] button');
      if (listBtnClass && listBtnClass.offsetParent !== null) {
        console.log('Clicking List Button (Fallback by class)');
        listBtnClass.click();
        listOpened = true;
      }
    }

    if (!listOpened) {
      // 마지막 시도: '리스트' 텍스트가 포함된 요소
      const listTextBtn = Array.from(document.querySelectorAll('button, a')).find(el => el.textContent.trim() === '리스트' || el.textContent.trim() === '방송리스트');
      if (listTextBtn && listTextBtn.offsetParent !== null) {
        console.log('Clicking List Text Button');
        listTextBtn.click();
        listOpened = true;
      }
    }

    if (!listOpened) {
      return { success: false, message: '챕터 목록을 열 수 있는 버튼을 찾지 못했습니다. (버튼을 찾을 수 없음)' };
    }

    // 목록이 열릴 때까지 대기
    await new Promise(r => setTimeout(r, 1000));

    // 2. 챕터 탭이 별도로 있다면 클릭 (리스트 내부에 챕터 탭이 있는 경우)
    const chapterTab = Array.from(document.querySelectorAll('.tab_list li a, .tab_area button')).find(el => el.textContent.includes('챕터'));
    if (chapterTab && chapterTab.offsetParent !== null) {
      console.log('Clicking Chapter Tab inside List');
      chapterTab.click();
      await new Promise(r => setTimeout(r, 1000));
    }

    // 3. 챕터 목록 가져오기
    // 다양한 선택자로 챕터 아이템 찾기 시도
    let chapterItems = document.querySelectorAll('.chapter_list li a');

    if (!chapterItems || chapterItems.length === 0) {
      chapterItems = document.querySelectorAll('li a[data-start]');
    }
    if (!chapterItems || chapterItems.length === 0) {
      // 텍스트에 시간 형식(00:00:00)이 있는 리스트 아이템 찾기
      chapterItems = Array.from(document.querySelectorAll('li a')).filter(a => /\d{2}:\d{2}/.test(a.textContent));
    }

    if (!chapterItems || chapterItems.length === 0) {
      return { success: false, message: '챕터 목록 아이템을 찾을 수 없습니다.' };
    }

    console.log(`Found ${chapterItems.length} chapters`);

    // 4. 각 챕터 클릭
    for (let i = 0; i < chapterItems.length; i++) {
      console.log(`Clicking chapter ${i + 1}`);
      chapterItems[i].click();
      // m3u8 로딩 대기 (네트워크 요청 발생 시간 고려)
      await new Promise(r => setTimeout(r, 1500));
    }

    return { success: true, message: `스캔 완료 (${chapterItems.length}개 챕터)` };

  } catch (e) {
    console.error(e);
    return { success: false, message: e.message };
  }
}

function refreshVideoList() {
  const chapterListDiv = document.getElementById('chapter-list');
  chapterListDiv.innerHTML = '<p style="color: white;">비디오 정보를 찾는 중...</p>';

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabs[0].id },
        world: 'MAIN',
        function: extractVideoInfo
      },
      (results) => {
        chapterListDiv.innerHTML = ''; // 초기화

        if (results && results[0] && results[0].result) {
          const { playlistUrls, title } = results[0].result;

          if (playlistUrls && playlistUrls.length > 0) {
            // 중복 제거 및 정렬
            const uniqueUrls = [...new Set(playlistUrls)].sort();

            uniqueUrls.forEach((url, index) => {
              const wrapper = document.createElement('div');
              wrapper.style.display = 'flex';
              wrapper.style.gap = '5px';
              wrapper.style.marginBottom = '10px';

              const btn = document.createElement('button');
              btn.className = 'playlist-button';
              btn.style.flex = '1';
              btn.style.marginBottom = '0';
              btn.innerHTML = `<svg class="icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg> ` + (uniqueUrls.length > 1 ? `영상 파트 ${index + 1} 다운로드` : `playlist.m3u8 다운로드`);
              btn.onclick = () => {
                const chapterTitle = uniqueUrls.length > 1 ? `${title}_Part${index + 1}` : title;
                downloadPlaylistFile(url, chapterTitle);
              };

              const cmdBtn = document.createElement('button');
              cmdBtn.className = 'playlist-button';
              cmdBtn.style.width = '80px';
              cmdBtn.style.backgroundColor = '#607D8B'; // 구분을 위한 색상 변경
              cmdBtn.style.marginBottom = '0';
              cmdBtn.style.fontSize = '12px';
              cmdBtn.textContent = 'CMD 복사';
              cmdBtn.onclick = () => {
                const chapterTitle = uniqueUrls.length > 1 ? `${title}_Part${index + 1}` : title;
                const baseName = sanitizeTitle(chapterTitle);
                const mkvOut = `%USERPROFILE%\\Downloads\\${baseName}.mkv`;
                const cmd = `ffmpeg -i "${url}" -c copy "${mkvOut}"`;
                copyToClipboard(cmd).then(() => alert(`[파트 ${index + 1}] FFmpeg 명령어가 복사되었습니다!`));
              };

              wrapper.appendChild(btn);
              wrapper.appendChild(cmdBtn);
              chapterListDiv.appendChild(wrapper);
            });

            if (uniqueUrls.length > 1) {
              const guideMsg = document.createElement('p');
              guideMsg.style.color = '#ccc';
              guideMsg.style.fontSize = '12px';
              guideMsg.innerText = '* 정밀 스캔으로 모든 영상 파트를 확보했습니다.';
              chapterListDiv.appendChild(guideMsg);
            }

          } else {
            chapterListDiv.innerHTML = '<p style="color: #ff6b6b;">playlist.m3u8 URL을 찾을 수 없습니다.<br>"자동 스캔"을 시도해보세요.</p>';
          }
        } else {
          chapterListDiv.innerHTML = '<p style="color: #ff6b6b;">비디오 정보를 추출하는 데 실패했습니다.</p>';
        }
      }
    );
  });
}

function handleFfmpegCopy() {
  const btn = document.getElementById('copy-ffmpeg');
  btn.disabled = true;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabs[0].id },
        world: 'MAIN',
        function: extractVideoInfo
      },
      (results) => {
        if (results && results[0] && results[0].result) {
          const { playlistUrls, title } = results[0].result;
          // 첫 번째 URL 사용 (로컬 다운로드는 보통 전체/현재 재생 중인 것 하나만 대상)
          const playlistUrl = playlistUrls && playlistUrls.length > 0 ? playlistUrls[0] : null;

          if (playlistUrl) {
            const baseName = sanitizeTitle(title);
            const mkvOut = `%USERPROFILE%\\Downloads\\${baseName}.mkv`;
            const cmd1 = `ffmpeg -i "${playlistUrl}" -c copy "${mkvOut}"`;
            copyToClipboard(cmd1)
              .then(() => {
                alert('ffmpeg 명령어가 클립보드에 복사되었습니다.\n\n저장 위치: Downloads 폴더 (MKV)\n\nCMD(명령 프롬프트)를 열고 붙여넣기 하여 실행하세요.');
              })
              .catch((err) => {
                console.error('클립보드 복사 실패:', err);
                alert('클립보드 복사에 실패했습니다.');
              });
          } else {
            alert('playlist.m3u8 URL을 찾을 수 없습니다.');
          }
        } else {
          alert('비디오 정보를 추출하는 데 실패했습니다.');
        }
      }
    );
  });

  setTimeout(() => {
    btn.disabled = false;
  }, 1500);
}

function handleFfmpegInstall() {
  const btn = document.getElementById('install-ffmpeg');
  btn.disabled = true;
  const installCmd = 'winget install "FFmpeg (Essentials Build)"';
  copyToClipboard(installCmd)
    .then(() => {
      alert('FFmpeg 설치 명령이 클립보드에 복사되었습니다.\n\n1) CMD(명령 프롬프트)를 여신 다음\n2) 붙여넣기 후 Enter로 설치하세요.');
    })
    .catch((err) => {
      console.error('클립보드 복사 실패:', err);
      alert('클립보드 복사에 실패했습니다.');
    })
    .finally(() => {
      setTimeout(() => { btn.disabled = false; }, 1200);
    });
}

function sanitizeTitle(title) {
  let sanitizedTitle = '';
  if (title && title.trim()) {
    sanitizedTitle = title.replace(/[\/\\:\\*?"<>|]/g, '').trim();
    sanitizedTitle = sanitizedTitle.replace(/[^a-zA-Z0-9가-힣\s\-]/g, '').trim();
    sanitizedTitle = sanitizedTitle.replace(/\s+/g, '_');
    sanitizedTitle = sanitizedTitle.replace(/_{2,}/g, '_').replace(/^_|_$/g, '');
  }
  if (!sanitizedTitle || sanitizedTitle.length === 0) {
    sanitizedTitle = 'soop_video';
  }
  if (sanitizedTitle.length > 40) {
    sanitizedTitle = sanitizedTitle.substring(0, 40);
  }
  return sanitizedTitle;
}

async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
  } catch (e) {
    console.warn('navigator.clipboard 사용 실패, fallback 시도:', e);
  }
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.top = '-9999px';
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();
  try {
    document.execCommand('copy');
  } finally {
    document.body.removeChild(textarea);
  }
}

async function downloadPlaylistFile(playlistUrl, title) {
  try {
    const response = await fetch(playlistUrl);
    if (!response.ok) {
      throw new Error('playlist.m3u8 파일 다운로드에 실패했습니다.');
    }

    let playlistContent = await response.text();

    const enhancedContent = `# Original URL: ${playlistUrl}
# Downloaded from: ${window.location.href}
# Download time: ${new Date().toISOString()}
# Title: ${title || 'Unknown'}
${playlistContent}`;

    const base64Content = btoa(unescape(encodeURIComponent(enhancedContent)));
    const dataUrl = `data:application/vnd.apple.mpegurl;base64,${base64Content}`;

    let sanitizedTitle = sanitizeTitle(title);
    const now = new Date();
    const timeStr = `${now.getMonth() + 1}${now.getDate()}_${now.getHours()}${now.getMinutes()}`;
    const filename = `${sanitizedTitle}_${timeStr}_playlist.m3u8`;

    try {
      const link = document.createElement('a');
      link.href = dataUrl;
      link.download = filename;
      link.style.display = 'none';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showSuccessMessage(filename);
    } catch (error) {
      console.error('popup 다운로드 실패, content script 시도:', error);
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        chrome.scripting.executeScript({
          target: { tabId: tabs[0].id },
          world: 'MAIN',
          function: (downloadUrl, fileName) => {
            const link = document.createElement('a');
            link.href = downloadUrl;
            link.download = fileName;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            setTimeout(() => document.body.removeChild(link), 100);
          },
          args: [dataUrl, filename]
        });
      });
    }

  } catch (error) {
    console.error('playlist 다운로드 오류:', error);
    alert(`playlist 다운로드에 실패했습니다: ${error.message}`);
  }
}

function showSuccessMessage(filename) {
  const actualFilename = filename.split('/').pop();
  alert(`playlist.m3u8 파일이 저장되었습니다!\n\n파일명: ${actualFilename}\n\n파일 병합 페이지에서 이 파일을 선택하여 다운로드하세요.`);
}

function extractVideoInfo() {
  try {
    let titleText = null;
    const titleSelectors = [".broadcast_title", ".title", ".video-title", "h1", "h2"];
    for (const selector of titleSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent && element.textContent.trim()) {
        titleText = element.textContent.trim();
        break;
      }
    }
    if (!titleText && document.title) {
      titleText = document.title.replace(/\s*-\s*SOOP.*$/i, '').trim();
    }

    let playlistUrls = [];

    // 1. Performance API
    const resources = performance.getEntriesByType('resource');
    resources.forEach(req => {
      if (req.name.includes('.m3u8') && !req.name.includes('.smil') && !playlistUrls.includes(req.name)) {
        playlistUrls.push(req.name);
      }
    });

    // 2. Video Elements
    const videoElements = document.querySelectorAll('video');
    videoElements.forEach(video => {
      if (video.src && video.src.includes('.m3u8') && !video.src.includes('.smil') && !playlistUrls.includes(video.src)) {
        playlistUrls.push(video.src);
      }
    });

    // 3. Script/Source Search (Fallback)
    if (playlistUrls.length === 0) {
      const pageContent = document.documentElement.outerHTML;
      const m3u8Regex = /(https?:\/\/[^\s"']+\.m3u8[^\s"']*)/gi;
      const matches = pageContent.match(m3u8Regex);
      if (matches) {
        matches.forEach(url => {
          if (!url.includes('cv=v1') && !playlistUrls.includes(url)) playlistUrls.push(url);
        });
      }
    }

    playlistUrls = playlistUrls.map(url => {
      if (url.startsWith('//')) return window.location.protocol + url;
      if (url.startsWith('/')) return window.location.origin + url;
      return url;
    });

    const timeDisplay = document.querySelector('.time_display');
    const durationText = timeDisplay?.querySelector('.time-duration')?.textContent || "";
    const currentTimeText = timeDisplay?.querySelector('.time-current')?.textContent || "";

    return {
      playlistUrls: playlistUrls,
      title: titleText,
      pageUrl: window.location.href,
      durationText: durationText,
      currentTimeText: currentTimeText,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    return { playlistUrls: [], title: null, error: error.message };
  }
}
