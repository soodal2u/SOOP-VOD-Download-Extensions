chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'uploadTSFiles') {
    const { files } = message;
    uploadTSFiles(files, sendResponse);
    return true;
  }
});

async function uploadTSFiles(files, sendResponse) {
  try {
    const formData = new FormData();

    for (const file of files) {
      const response = await fetch(file.data);
      const blob = await response.blob();
      formData.append('tsFiles', blob, file.name);
    }

    const response = await fetch('http://soopvod.mcv.kr:2053/upload', {
      method: 'POST',
      body: formData
    });

    if (!response.ok) {
      throw new Error(`서버 응답 오류: ${response.status} ${response.statusText}`);
    }

    const blob = await response.blob();
    const url = URL.createObjectURL(blob);

    sendResponse({ success: true, url });
  } catch (error) {
    console.error("TS 파일 업로드 중 오류 발생:", error);
    sendResponse({ success: false, error: error.message });
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log('SOOP VOD 다운로더가 설치되었습니다.');
});

console.log('SOOP VOD 다운로더 Service Worker가 로드되었습니다.');
