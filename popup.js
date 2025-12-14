document.addEventListener('DOMContentLoaded', () => {
  // 초기 로드 시 비디오 정보 추출 및 목록 표시
  refreshVideoList();

  // 자동 스캔 버튼 이벤트
  document.getElementById('auto-scan').addEventListener('click', () => {
    handleAutoScan();
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

function handleAutoScan() {
  const chapterListDiv = document.getElementById('chapter-list');
  chapterListDiv.innerHTML = '<p style="color: #4CAF50;">자동 스캔 중입니다...<br>플레이어를 조작하지 마세요.</p>';

  const btn = document.getElementById('auto-scan');
  btn.disabled = true;

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabs[0].id },
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
              btn.textContent = uniqueUrls.length > 1 ? `Chapter ${index + 1} 다운로드` : `playlist.m3u8 다운로드`;
              btn.onclick = () => {
                const chapterTitle = uniqueUrls.length > 1 ? `${title}_Chapter${index + 1}` : title;
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
                const chapterTitle = uniqueUrls.length > 1 ? `${title}_Chapter${index + 1}` : title;
                const baseName = sanitizeTitle(chapterTitle);
                const mkvOut = `%USERPROFILE%\\Downloads\\${baseName}.mkv`;
                const cmd = `ffmpeg -i "${url}" -c copy "${mkvOut}"`;
                copyToClipboard(cmd).then(() => alert(`[Chapter ${index + 1}] FFmpeg 명령어가 복사되었습니다!`));
              };

              wrapper.appendChild(btn);
              wrapper.appendChild(cmdBtn);
              chapterListDiv.appendChild(wrapper);
            });

            if (uniqueUrls.length > 1) {
              const guideMsg = document.createElement('p');
              guideMsg.style.color = '#ccc';
              guideMsg.style.fontSize = '12px';
              guideMsg.innerText = '* 자동 스캔으로 모든 챕터를 찾았습니다.';
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
  alert(`✅ playlist.m3u8 파일이 저장되었습니다!\n\n파일명: ${actualFilename}\n\n파일 병합 페이지에서 이 파일을 선택하여 다운로드하세요.`);
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
      // 필터링: .m3u8 포함 AND cv=v1 미포함 AND master 미포함(선택사항)
      if (req.name.includes('.m3u8') && !req.name.includes('cv=v1') && !playlistUrls.includes(req.name)) {
        playlistUrls.push(req.name);
      }
    });

    // 2. Video Elements
    const videoElements = document.querySelectorAll('video');
    videoElements.forEach(video => {
      if (video.src && video.src.includes('.m3u8') && !video.src.includes('cv=v1') && !playlistUrls.includes(video.src)) {
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

    return {
      playlistUrls: playlistUrls,
      title: titleText,
      pageUrl: window.location.href,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    return { playlistUrls: [], title: null, error: error.message };
  }
}
