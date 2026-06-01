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

  // 채팅 ASS 자막 다운로드
  document.getElementById('download-chat-ass').addEventListener('click', () => {
    handleChatAssDownload();
  });

  // 채팅 ASS 설정 페이지
  document.getElementById('open-chat-settings').addEventListener('click', () => {
    handleOpenChatSettings();
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

const CHAT_ASS_RESOLUTION = {
  width: 1920,
  height: 1080
};

const DOWNLOAD_ICON_MARKUP = '<svg class="icon" viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>';
const COMMAND_ICON_MARKUP = '<svg class="icon" viewBox="0 0 24 24"><path d="M8 9l-4 3 4 3"/><path d="M16 9l4 3-4 3"/><path d="M13 6l-2 12"/></svg>';
const QUALITY_PREFERENCE_STORAGE_KEY = 'soop_preferred_quality';
const PART_TIMELINE_COLORS = [
  '#83f28f',
  '#fbbf24',
  '#fb7185',
  '#a78bfa',
  '#38bdf8',
  '#f97316',
  '#22c55e',
  '#e879f9'
];
let preferredQualityPreference = '';
let latestVideoInfo = null;
let latestPartItems = [];

try {
  preferredQualityPreference = String(localStorage.getItem(QUALITY_PREFERENCE_STORAGE_KEY) || '');
} catch (error) {
  preferredQualityPreference = '';
}

function normalizeComparableUrl(url) {
  const rawUrl = String(url || '').trim();
  if (!rawUrl) {
    return '';
  }

  try {
    return new URL(rawUrl).href;
  } catch (error) {
    return rawUrl;
  }
}

function parseResolutionInfo(value) {
  const match = String(value || '').match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) {
    return {
      width: 0,
      height: 0
    };
  }

  return {
    width: Number(match[1]) || 0,
    height: Number(match[2]) || 0
  };
}

function parseBitrateValue(value) {
  const bitrateText = String(value || '').trim().toLowerCase();
  if (!bitrateText) {
    return 0;
  }

  const numericMatch = bitrateText.replace(/,/g, '').match(/[\d.]+/);
  const numericValue = numericMatch ? Number.parseFloat(numericMatch[0]) : 0;
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return 0;
  }

  if (bitrateText.includes('mbps') || bitrateText.endsWith('m')) {
    return numericValue * 1000000;
  }

  if (bitrateText.includes('kbps') || bitrateText.endsWith('k')) {
    return numericValue * 1000;
  }

  return numericValue;
}

function formatQualityResolution(resolution) {
  const info = parseResolutionInfo(resolution);
  if (info.height > 0) {
    return `${info.height}p`;
  }

  return String(resolution || '').trim();
}

function formatQualityBitrate(bitrate) {
  const bitrateText = String(bitrate || '').trim();
  if (!bitrateText) {
    return '';
  }

  if (/[a-z]/i.test(bitrateText)) {
    return bitrateText;
  }

  const numericValue = Number.parseFloat(bitrateText.replace(/,/g, ''));
  if (!Number.isFinite(numericValue) || numericValue <= 0) {
    return bitrateText;
  }

  if (numericValue >= 1000000) {
    return `${(numericValue / 1000000).toFixed(numericValue >= 10000000 ? 0 : 1)} Mbps`;
  }

  return Math.round(numericValue).toLocaleString();
}

function buildQualityPreferenceKey(option) {
  const resolution = parseResolutionInfo(option?.resolution || option?.resolutionLabel || '');
  if (resolution.height > 0) {
    return `height:${resolution.height}`;
  }

  const name = String(option?.name || option?.label || '').trim().toLowerCase();
  return name ? `name:${name}` : '';
}

function normalizeQualityOption(option, fallback = {}) {
  const file = String(option?.file || fallback.file || '').trim();
  const resolution = String(option?.resolution || fallback.resolution || '').trim();
  const bitrate = String(option?.bitrate || fallback.bitrate || '').trim();
  const name = String(option?.name || fallback.name || '').trim();
  const displayName = String(option?.label || fallback.label || '').trim() || (/original/i.test(name) ? '원본' : '');
  const resolutionLabel = formatQualityResolution(resolution);
  const bitrateLabel = formatQualityBitrate(bitrate);
  const displayLabel = [...new Set([displayName, resolutionLabel, bitrateLabel].filter(Boolean))].join(' · ') || '기본 화질';

  return {
    file,
    resolution,
    bitrate,
    name,
    label: displayName || resolutionLabel || '기본 화질',
    displayLabel,
    resolutionLabel,
    bitrateLabel,
    preferenceKey: buildQualityPreferenceKey({ name, label: displayName || resolutionLabel || '기본 화질', resolution })
  };
}

function scoreQualityOption(option) {
  const resolution = parseResolutionInfo(option?.resolution);
  const bitrate = parseBitrateValue(option?.bitrate);
  const originalBonus = /original/i.test(String(option?.name || '')) || String(option?.label || '').includes('원본') ? 1 : 0;
  return (originalBonus * 1000000000000) + (resolution.width * resolution.height) + bitrate;
}

function buildQualityOptions(fileInfo, fallbackPlaylistUrl = '') {
  const qualityInfo = Array.isArray(fileInfo?.quality_info)
    ? fileInfo.quality_info.filter((entry) => entry?.file)
    : [];

  const normalizedOptions = qualityInfo
    .map((entry) => normalizeQualityOption(entry))
    .filter((entry) => entry.file);

  if (normalizedOptions.length === 0) {
    const fallbackFile = String(fileInfo?.file || fallbackPlaylistUrl || '').trim();
    return fallbackFile ? [normalizeQualityOption({
      label: '기본 화질',
      file: fallbackFile,
      resolution: fileInfo?.resolution || '',
      bitrate: fileInfo?.bitrate || '',
      name: fileInfo?.name || ''
    })] : [];
  }

  return normalizedOptions.sort((left, right) => scoreQualityOption(right) - scoreQualityOption(left));
}

function collectFileInfoKeys(fileInfo) {
  const keys = new Set();
  const pushKey = (value) => {
    const nextValue = String(value || '').trim();
    if (nextValue) {
      keys.add(nextValue);
    }
  };

  pushKey(fileInfo?.fileInfoKey);
  pushKey(fileInfo?.file_info_key);
  pushKey(fileInfo?.key);
  pushKey(deriveFileInfoKeyFromPlaylistUrl(fileInfo?.file || ''));

  if (Array.isArray(fileInfo?.quality_info)) {
    fileInfo.quality_info.forEach((entry) => {
      pushKey(entry?.fileInfoKey);
      pushKey(entry?.file_info_key);
      pushKey(deriveFileInfoKeyFromPlaylistUrl(entry?.file || ''));
    });
  }

  return keys;
}

function getFileInfoUrls(fileInfo) {
  return [
    fileInfo?.file,
    ...(Array.isArray(fileInfo?.quality_info) ? fileInfo.quality_info.map((entry) => entry?.file) : [])
  ]
    .map((url) => normalizeComparableUrl(url))
    .filter(Boolean);
}

function findMatchingFileInfo(videoInfo, part, partIndex = 0) {
  const files = Array.isArray(videoInfo?.videoFiles) ? videoInfo.videoFiles.filter(Boolean) : [];
  if (files.length === 0) {
    return null;
  }

  const partUrl = normalizeComparableUrl(part?.playlistUrl);
  const partKeys = [
    String(part?.fileInfoKey || '').trim(),
    deriveFileInfoKeyFromPlaylistUrl(part?.playlistUrl || '')
  ].filter(Boolean);

  if (partKeys.length > 0) {
    const byKey = files.find((fileInfo) => {
      const fileInfoKeys = collectFileInfoKeys(fileInfo);
      return partKeys.some((key) => fileInfoKeys.has(key));
    });

    if (byKey) {
      return byKey;
    }
  }

  if (partUrl) {
    const byUrl = files.find((fileInfo) => getFileInfoUrls(fileInfo).includes(partUrl));
    if (byUrl) {
      return byUrl;
    }
  }

  return files[Math.min(Math.max(partIndex, 0), files.length - 1)] || files[0] || null;
}

function getPartQualityOptions(videoInfo, part, partIndex = 0) {
  const fileInfo = findMatchingFileInfo(videoInfo, part, partIndex);
  return {
    fileInfo,
    qualityOptions: buildQualityOptions(fileInfo, part?.playlistUrl || '')
  };
}

function savePreferredQuality(option) {
  preferredQualityPreference = buildQualityPreferenceKey(option);

  try {
    if (preferredQualityPreference) {
      localStorage.setItem(QUALITY_PREFERENCE_STORAGE_KEY, preferredQualityPreference);
    } else {
      localStorage.removeItem(QUALITY_PREFERENCE_STORAGE_KEY);
    }
  } catch (error) {
    // Ignore storage write failures and continue with in-memory preference only.
  }
}

function pickDefaultQualityIndex(qualityOptions) {
  if (!Array.isArray(qualityOptions) || qualityOptions.length === 0) {
    return 0;
  }

  if (preferredQualityPreference) {
    const exactMatchIndex = qualityOptions.findIndex((option) => option.preferenceKey === preferredQualityPreference);
    if (exactMatchIndex >= 0) {
      return exactMatchIndex;
    }

    const preferredHeightMatch = preferredQualityPreference.match(/^height:(\d+)$/);
    const preferredHeight = preferredHeightMatch ? Number(preferredHeightMatch[1]) : 0;
    if (preferredHeight > 0) {
      const heightMatchIndex = qualityOptions.findIndex((option) => parseResolutionInfo(option.resolution).height === preferredHeight);
      if (heightMatchIndex >= 0) {
        return heightMatchIndex;
      }
    }
  }

  return 0;
}

function getSelectedQualityOption(selectElement, qualityOptions) {
  if (!Array.isArray(qualityOptions) || qualityOptions.length === 0) {
    return null;
  }

  const optionIndex = Number.parseInt(String(selectElement?.value ?? '0'), 10);
  return Number.isInteger(optionIndex) && optionIndex >= 0 && optionIndex < qualityOptions.length
    ? qualityOptions[optionIndex]
    : qualityOptions[0];
}

function buildQualityTitle(title, option, qualityOptionsLength = 0) {
  const safeTitle = String(title || '현재 영상').trim() || '현재 영상';
  const suffix = String(option?.resolutionLabel || option?.label || '').trim();

  if (!suffix || qualityOptionsLength <= 1 || safeTitle.includes(suffix)) {
    return safeTitle;
  }

  return `${safeTitle} ${suffix}`;
}

function parseClipTimeInput(value, fieldLabel) {
  const rawValue = String(value || '').trim();
  if (!rawValue) {
    return {
      ok: true,
      seconds: null
    };
  }

  const parts = rawValue.split(':');
  if (parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) {
    return {
      ok: false,
      message: `${fieldLabel}은 01:05:00 또는 65:00 형식으로 입력해주세요.`
    };
  }

  const numbers = parts.map((part) => Number(part));
  if (numbers.some((number) => !Number.isInteger(number) || number < 0)) {
    return {
      ok: false,
      message: `${fieldLabel}에 사용할 수 없는 시간이 있습니다.`
    };
  }

  if (numbers.length >= 2 && numbers[numbers.length - 1] >= 60) {
    return {
      ok: false,
      message: `${fieldLabel}의 초는 60보다 작아야 합니다.`
    };
  }

  if (numbers.length === 3 && numbers[1] >= 60) {
    return {
      ok: false,
      message: `${fieldLabel}의 분은 60보다 작아야 합니다.`
    };
  }

  const seconds = numbers.length === 3
    ? (numbers[0] * 3600) + (numbers[1] * 60) + numbers[2]
    : numbers.length === 2
      ? (numbers[0] * 60) + numbers[1]
      : numbers[0];

  return {
    ok: true,
    seconds
  };
}

function buildClipRangeLabel(range) {
  if (!range?.active) {
    return '전체 구간';
  }

  const startLabel = range.startSeconds > 0 ? formatSecondsAsClock(range.startSeconds) : '처음';
  const endLabel = Number.isFinite(Number(range.endSeconds)) && Number(range.endSeconds) > 0
    ? formatSecondsAsClock(range.endSeconds)
    : '끝';

  if (startLabel === '처음') {
    return `${endLabel}까지`;
  }

  if (endLabel === '끝') {
    return `${startLabel}부터 끝까지`;
  }

  return `${startLabel}부터 ${endLabel}까지`;
}

function buildClipRangeConfig(startValue, endValue) {
  const startResult = parseClipTimeInput(startValue, '시작 시간');
  if (!startResult.ok) {
    return startResult;
  }

  const endResult = parseClipTimeInput(endValue, '종료 시간');
  if (!endResult.ok) {
    return endResult;
  }

  const hasStart = startResult.seconds !== null;
  const hasEnd = endResult.seconds !== null;
  const startSeconds = hasStart ? startResult.seconds : 0;
  const endSeconds = hasEnd ? endResult.seconds : null;

  if (hasEnd && endSeconds <= startSeconds) {
    return {
      ok: false,
      message: '종료 시간은 시작 시간보다 뒤여야 합니다.'
    };
  }

  const range = {
    ok: true,
    active: (hasStart && startSeconds > 0) || hasEnd,
    startSeconds,
    endSeconds
  };

  range.label = buildClipRangeLabel(range);
  return range;
}

function formatClipTimeForCommand(seconds) {
  const safeSeconds = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = safeSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatClipTimeForFileName(seconds) {
  return formatClipTimeForCommand(seconds).replace(/:/g, '-');
}

function buildClipRangeTitle(title, range) {
  if (!range?.active) {
    return title;
  }

  const startLabel = range.startSeconds > 0 ? formatClipTimeForFileName(range.startSeconds) : '처음';
  const endLabel = Number.isFinite(Number(range.endSeconds)) && Number(range.endSeconds) > 0
    ? formatClipTimeForFileName(range.endSeconds)
    : '끝';
  return `${title} 구간 ${startLabel}-${endLabel}`;
}

function buildFfmpegCommand(playlistUrl, title, clipRange = null) {
  const baseName = sanitizeTitle(title);
  const mkvOut = `%USERPROFILE%\\Downloads\\${baseName}.mkv`;
  const hasClipStart = Boolean(clipRange?.active) && Number(clipRange.startSeconds || 0) > 0;
  const hasClipEnd = Boolean(clipRange?.active) && Number.isFinite(Number(clipRange.endSeconds)) && Number(clipRange.endSeconds) > 0;
  const beforeInput = hasClipStart ? `-ss ${formatClipTimeForCommand(clipRange.startSeconds)} ` : '';
  const afterInput = hasClipEnd
    ? hasClipStart
      ? `-t ${formatClipTimeForCommand(Number(clipRange.endSeconds) - Number(clipRange.startSeconds || 0))} `
      : `-to ${formatClipTimeForCommand(clipRange.endSeconds)} `
    : '';

  return `ffmpeg ${beforeInput}-i "${playlistUrl}" ${afterInput}-c copy "${mkvOut}"`;
}

function replaceVariantNameAttribute(infoLine, nextName) {
  const safeName = String(nextName || 'variant').replace(/"/g, '').trim() || 'variant';

  if (/NAME="[^"]*"/i.test(infoLine)) {
    return infoLine.replace(/NAME="[^"]*"/i, `NAME="${safeName}"`);
  }

  const prefix = '#EXT-X-STREAM-INF:';
  if (!String(infoLine).startsWith(prefix)) {
    return infoLine;
  }

  return `${prefix}NAME="${safeName}",${String(infoLine).slice(prefix.length)}`;
}

function normalizeUrlForComparison(url) {
  const normalizedUrl = normalizeComparableUrl(url);
  if (!normalizedUrl) {
    return '';
  }

  try {
    const parsedUrl = new URL(normalizedUrl);
    return `${parsedUrl.origin}${parsedUrl.pathname}`;
  } catch (error) {
    return normalizedUrl.split('?')[0];
  }
}

function extractVariantMetaFromInfoLine(infoLine) {
  const resolution = String(infoLine || '').match(/RESOLUTION=(\d+x\d+)/i)?.[1] || '';
  const bandwidth = String(infoLine || '').match(/(?:AVERAGE-)?BANDWIDTH=(\d+)/i)?.[1] || '';
  return {
    resolution,
    bitrate: bandwidth
  };
}

function chooseMasterVariantEntry(entries, selectedQuality) {
  if (!Array.isArray(entries) || entries.length === 0) {
    return null;
  }

  const selectedVariantUrl = normalizeComparableUrl(selectedQuality?.file || '');
  if (selectedVariantUrl) {
    const exactMatch = entries.find((entry) => normalizeComparableUrl(entry.absoluteUrl) === selectedVariantUrl);
    if (exactMatch) {
      return exactMatch;
    }

    const pathMatch = entries.find((entry) => normalizeUrlForComparison(entry.absoluteUrl) === normalizeUrlForComparison(selectedVariantUrl));
    if (pathMatch) {
      return pathMatch;
    }
  }

  const preferredResolution = parseResolutionInfo(selectedQuality?.resolution || selectedQuality?.resolutionLabel || '');
  const preferredBitrate = parseBitrateValue(selectedQuality?.bitrate || selectedQuality?.bitrateLabel || '');

  const scoredEntries = entries.map((entry) => {
    const entryMeta = extractVariantMetaFromInfoLine(entry.infoLine);
    const entryResolution = parseResolutionInfo(entryMeta.resolution);
    const entryBitrate = parseBitrateValue(entryMeta.bitrate);
    const resolutionPenalty = preferredResolution.height > 0
      ? Math.abs(entryResolution.height - preferredResolution.height) * 100000000
      : 0;
    const bitratePenalty = preferredBitrate > 0
      ? Math.abs(entryBitrate - preferredBitrate)
      : 0;

    return {
      entry,
      score: resolutionPenalty + bitratePenalty
    };
  });

  scoredEntries.sort((left, right) => left.score - right.score || parseVariantScore(right.entry) - parseVariantScore(left.entry));
  return scoredEntries[0]?.entry || null;
}

function pinMasterPlaylistToSelectedQuality(playlistContent, playlistUrl, selectedQuality) {
  if (!selectedQuality || !String(playlistContent || '').includes('#EXT-X-STREAM-INF')) {
    return String(playlistContent || '');
  }

  const lines = String(playlistContent || '').replace(/\r/g, '').split('\n');
  const preservedLines = [];
  const variantEntries = [];
  let pendingInfoLine = null;

  for (let index = 0; index < lines.length; index += 1) {
    const line = String(lines[index] || '');
    const trimmedLine = line.trim();

    if (trimmedLine.startsWith('#EXT-X-STREAM-INF:')) {
      pendingInfoLine = line;
      continue;
    }

    if (pendingInfoLine && trimmedLine && !trimmedLine.startsWith('#')) {
      let absoluteVariantUrl = '';
      try {
        absoluteVariantUrl = new URL(trimmedLine, playlistUrl).href;
      } catch (error) {
        absoluteVariantUrl = trimmedLine;
      }

      variantEntries.push({
        infoLine: pendingInfoLine,
        urlLine: line,
        absoluteUrl: absoluteVariantUrl
      });
      pendingInfoLine = null;
      continue;
    }

    if (!pendingInfoLine) {
      preservedLines.push(line);
    }
  }

  const selectedEntry = chooseMasterVariantEntry(variantEntries, selectedQuality);
  if (!selectedEntry) {
    return String(playlistContent || '');
  }

  const compactLines = preservedLines.filter((line, index, source) => {
    if (line.trim()) {
      return true;
    }

    const previousLine = index > 0 ? source[index - 1] : '';
    return String(previousLine || '').trim() !== '';
  });

  compactLines.push(replaceVariantNameAttribute(selectedEntry.infoLine, 'original'));
  compactLines.push(selectedEntry.urlLine);
  return compactLines.join('\n');
}

function updateActionHint(message) {
  const hintText = document.getElementById('action-hint');
  if (hintText) {
    hintText.textContent = message;
  }
}

function setHeroMedia(thumbnailUrl) {
  const heroMedia = document.getElementById('hero-media');
  if (!heroMedia) {
    return;
  }

  if (thumbnailUrl) {
    const safeUrl = encodeURI(String(thumbnailUrl)).replace(/"/g, '\\"');
    heroMedia.style.backgroundImage = `linear-gradient(180deg, rgba(10, 14, 26, 0.18), rgba(4, 7, 16, 0.86)), url("${safeUrl}")`;
    heroMedia.classList.add('has-thumbnail');
    return;
  }

  heroMedia.style.backgroundImage = '';
  heroMedia.classList.remove('has-thumbnail');
}

function formatSecondsAsClock(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function formatSecondsAsFullClock(totalSeconds) {
  const safeSeconds = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = safeSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function buildClockLabel(rawText, seconds) {
  const trimmed = String(rawText || '').trim();
  if (trimmed) {
    return trimmed;
  }

  const numericSeconds = Number(seconds || 0);
  if (numericSeconds > 0) {
    return formatSecondsAsClock(numericSeconds);
  }

  return '--:--';
}

function buildTimingLabel(videoInfo) {
  const currentLabel = buildClockLabel(videoInfo?.currentTimeText, videoInfo?.currentTimeSeconds);
  const durationLabel = buildClockLabel(videoInfo?.durationText, videoInfo?.durationSeconds);
  return `${currentLabel} / ${durationLabel}`;
}

function rewritePlaylistTagUriToAbsolute(line, manifestUrl) {
  return line.replace(/URI="([^"]+)"/gi, (_, rawUrl) => {
    try {
      return `URI="${new URL(rawUrl, manifestUrl).href}"`;
    } catch (error) {
      return `URI="${rawUrl}"`;
    }
  });
}

function parseMediaPlaylistForMerge(manifestText, manifestUrl) {
  const sourceLines = String(manifestText || '').replace(/\r/g, '').split('\n');
  const mergedLines = [];
  let targetDuration = 0;
  let version = 3;
  let independentSegments = false;

  sourceLines.forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) {
      return;
    }

    if (line === '#EXTM3U' || line.startsWith('#EXT-X-ENDLIST') || line.startsWith('#EXT-X-MEDIA-SEQUENCE') || line.startsWith('#EXT-X-PLAYLIST-TYPE')) {
      return;
    }

    if (line.startsWith('#EXT-X-TARGETDURATION:')) {
      targetDuration = Math.max(targetDuration, Number.parseInt(line.split(':')[1], 10) || 0);
      return;
    }

    if (line.startsWith('#EXT-X-VERSION:')) {
      version = Math.max(version, Number.parseInt(line.split(':')[1], 10) || 0);
      return;
    }

    if (line.startsWith('#EXT-X-INDEPENDENT-SEGMENTS')) {
      independentSegments = true;
      return;
    }

    if (line.startsWith('#EXT-X-MAP:') || line.startsWith('#EXT-X-KEY:')) {
      mergedLines.push(rewritePlaylistTagUriToAbsolute(line, manifestUrl));
      return;
    }

    if (line.startsWith('#EXTINF:') || line.startsWith('#EXT-X-BYTERANGE:') || line.startsWith('#EXT-X-DISCONTINUITY')) {
      mergedLines.push(line);
      return;
    }

    if (!line.startsWith('#')) {
      try {
        mergedLines.push(new URL(line, manifestUrl).href);
      } catch (error) {
        mergedLines.push(line);
      }
    }
  });

  return {
    mergedLines,
    targetDuration,
    version,
    independentSegments
  };
}

function scoreVariantInfoLine(infoLine) {
  const safeInfoLine = String(infoLine || '');
  const bandwidthMatch = safeInfoLine.match(/BANDWIDTH=(\d+)/i);
  const resolutionMatch = safeInfoLine.match(/RESOLUTION=(\d+)x(\d+)/i);
  const nameMatch = safeInfoLine.match(/NAME="([^"]+)"/i);
  const bandwidth = bandwidthMatch ? Number(bandwidthMatch[1]) : 0;
  const width = resolutionMatch ? Number(resolutionMatch[1]) : 0;
  const height = resolutionMatch ? Number(resolutionMatch[2]) : 0;
  const originalBonus = String(nameMatch?.[1] || '').toLowerCase() === 'original' ? 1000000000 : 0;
  return originalBonus + bandwidth + (width * height);
}

async function fetchResolvedMediaPlaylist(playlistUrl) {
  const response = await fetch(playlistUrl, {
    credentials: 'include',
    cache: 'no-store'
  });

  if (!response.ok) {
    throw new Error(`플레이리스트를 불러오지 못했습니다. (${response.status})`);
  }

  const manifestText = await response.text();
  const variantMatches = [...manifestText.matchAll(/#EXT-X-STREAM-INF:([^\n]*)\n([^\n]+\.m3u8[^\n]*)/g)];
  if (variantMatches.length > 0) {
    const bestVariant = variantMatches
      .map((match) => ({
        infoLine: match[1],
        url: new URL(match[2].trim(), playlistUrl).href
      }))
      .sort((left, right) => scoreVariantInfoLine(right.infoLine) - scoreVariantInfoLine(left.infoLine))[0];
    const variantUrl = bestVariant.url;
    return fetchResolvedMediaPlaylist(variantUrl);
  }

  return {
    manifestUrl: playlistUrl,
    manifestText
  };
}

function buildMergedPlaylistContent(title, playlistParts) {
  const maxTargetDuration = Math.max(1, ...playlistParts.map((part) => Number(part.targetDuration || 0)));
  const maxVersion = Math.max(3, ...playlistParts.map((part) => Number(part.version || 0)));
  const includeIndependentSegments = playlistParts.some((part) => part.independentSegments);
  const lines = [
    '#EXTM3U',
    `#EXT-X-VERSION:${maxVersion}`,
    '#EXT-X-PLAYLIST-TYPE:VOD',
    `#EXT-X-TARGETDURATION:${maxTargetDuration}`
  ];

  if (includeIndependentSegments) {
    lines.push('#EXT-X-INDEPENDENT-SEGMENTS');
  }

  lines.push(`# 생성 대상: ${title}`);

  playlistParts.forEach((part, index) => {
    if (index > 0) {
      lines.push('#EXT-X-DISCONTINUITY');
    }
    lines.push(...part.mergedLines);
  });

  lines.push('#EXT-X-ENDLIST');
  return lines.join('\n');
}

async function downloadMergedPlaylistFile(title, partItems) {
  const playlistParts = [];

  for (const part of partItems) {
    const resolvedPlaylist = await fetchResolvedMediaPlaylist(part.playlistUrl);
    playlistParts.push(parseMediaPlaylistForMerge(resolvedPlaylist.manifestText, resolvedPlaylist.manifestUrl));
  }

  const mergedPlaylistText = buildMergedPlaylistContent(title, playlistParts);
  const fileName = `${sanitizeTitle(title)}_playlist.m3u8`;
  downloadTextFile(mergedPlaylistText, fileName, 'application/vnd.apple.mpegurl;charset=utf-8');
}

function detectAccessTypeFromPlaylistHosts(urls) {
  const hosts = (urls || [])
    .map((rawUrl) => {
      try {
        return new URL(String(rawUrl)).hostname.toLowerCase();
      } catch (error) {
        return '';
      }
    })
    .filter(Boolean);

  if (hosts.some((host) => host.includes('vod-archive-sub-kr-cdn'))) {
    return 'subscription_plus';
  }

  if (hosts.some((host) => host.includes('vod-archive-kr-cdn'))) {
    return 'general';
  }

  return null;
}

function extractDownloadParts(videoInfo) {
  if (Array.isArray(videoInfo?.partItems) && videoInfo.partItems.length > 0) {
    return videoInfo.partItems
      .map((part, index) => ({
        index: part.index ?? index,
        playlistUrl: part.playlistUrl || part.url || part.cmafUrl || null,
        durationSeconds: Math.max(0, Math.round(Number(part.durationSeconds || part.duration || 0))),
        fileInfoKey: part.fileInfoKey || deriveFileInfoKeyFromPlaylistUrl(part.playlistUrl || part.url || part.cmafUrl || '')
      }))
      .filter((part) => part.playlistUrl);
  }

  return [...new Set(videoInfo?.playlistUrls || [])]
    .map((playlistUrl, index) => ({
      index,
      playlistUrl,
      durationSeconds: 0,
      fileInfoKey: deriveFileInfoKeyFromPlaylistUrl(playlistUrl)
    }))
    .filter((part) => part.playlistUrl);
}

function getPartTimelineColor(index) {
  return PART_TIMELINE_COLORS[index % PART_TIMELINE_COLORS.length];
}

function getPartDurationSeconds(videoInfo, part, index, partItems) {
  const directDuration = Number(part?.durationSeconds || part?.duration || 0);
  if (Number.isFinite(directDuration) && directDuration > 0) {
    return Math.round(directDuration);
  }

  const fileInfo = findMatchingFileInfo(videoInfo, part, index);
  const fileDuration = Number(
    fileInfo?.durationSeconds ||
    fileInfo?.duration ||
    fileInfo?.totalDuration ||
    fileInfo?.playtime ||
    0
  );
  if (Number.isFinite(fileDuration) && fileDuration > 0) {
    return Math.round(fileDuration);
  }

  const totalDuration = Number(videoInfo?.durationSeconds || 0);
  if (partItems?.length === 1 && Number.isFinite(totalDuration) && totalDuration > 0) {
    return Math.round(totalDuration);
  }

  return 0;
}

function buildPartTimelineItems(partItems, videoInfo) {
  if (!Array.isArray(partItems) || partItems.length === 0) {
    return [];
  }

  const totalDurationHint = Math.max(0, Math.round(Number(videoInfo?.durationSeconds || 0)));
  let cursor = 0;
  const timelineItems = [];

  partItems.forEach((part, index) => {
    const durationSeconds = getPartDurationSeconds(videoInfo, part, index, partItems);
    if (durationSeconds <= 0) {
      return;
    }

    const startSeconds = cursor;
    const endSeconds = startSeconds + durationSeconds;
    const color = getPartTimelineColor(index);

    timelineItems.push({
      index,
      partNumber: index + 1,
      label: `파트 ${index + 1}`,
      startSeconds,
      endSeconds,
      durationSeconds,
      startLabel: formatSecondsAsFullClock(startSeconds),
      endLabel: formatSecondsAsFullClock(endSeconds),
      durationLabel: formatSecondsAsFullClock(durationSeconds),
      color
    });

    cursor = endSeconds;
  });

  if (timelineItems.length > 0 && totalDurationHint > 0) {
    const lastItem = timelineItems[timelineItems.length - 1];
    if (Math.abs(totalDurationHint - lastItem.endSeconds) <= 3 || totalDurationHint > lastItem.endSeconds) {
      lastItem.endSeconds = totalDurationHint;
      lastItem.durationSeconds = Math.max(1, lastItem.endSeconds - lastItem.startSeconds);
      lastItem.endLabel = formatSecondsAsFullClock(lastItem.endSeconds);
      lastItem.durationLabel = formatSecondsAsFullClock(lastItem.durationSeconds);
    }
  }

  return timelineItems;
}

function getPartTimelineTotalDuration(timelineItems, videoInfo) {
  const totalFromItems = Math.max(0, ...timelineItems.map((item) => Number(item.endSeconds || 0)));
  const totalFromVideo = Math.max(0, Number(videoInfo?.durationSeconds || 0));
  return Math.max(totalFromItems, totalFromVideo);
}

function createStatusCard(type, title, description) {
  const card = document.createElement('div');
  card.className = `status-card ${type || ''}`.trim();

  const heading = document.createElement('p');
  heading.className = 'status-card-title';
  heading.textContent = title;
  card.appendChild(heading);

  if (description) {
    const paragraph = document.createElement('p');
    paragraph.className = 'status-card-description';
    paragraph.textContent = description;
    card.appendChild(paragraph);
  }

  return card;
}

function setChapterListState(type, title, description) {
  const chapterListDiv = document.getElementById('chapter-list');
  if (!chapterListDiv) {
    return;
  }

  chapterListDiv.innerHTML = '';
  chapterListDiv.appendChild(createStatusCard(type, title, description));
}

function updateVideoHero(videoInfo, partItems) {
  const titleEl = document.getElementById('video-title');
  const subtitleEl = document.getElementById('video-subtitle');
  const accessBadgeEl = document.getElementById('video-access-badge');
  const durationBadgeEl = document.getElementById('video-duration-badge');
  const modeEl = document.getElementById('video-mode');
  const timingEl = document.getElementById('video-timing');
  const partCountEl = document.getElementById('video-part-count');

  const title = String(videoInfo?.title || '').trim();
  const isSubscriptionPlus = videoInfo?.accessType === 'subscription_plus';
  const isGeneralVideo = videoInfo?.accessType === 'general';
  const hasParts = partItems.length > 0;

  if (!title && !videoInfo?.thumbnailUrl && !hasParts) {
    if (titleEl) {
      titleEl.textContent = '현재 SOOP 다시보기를 확인하는 중';
    }
    if (subtitleEl) {
      subtitleEl.textContent = 'VOD 다시보기나 구독플러스 플레이어를 연 상태에서 다시 감지하면 다운로드 파트가 이곳에 나타납니다.';
    }
    if (accessBadgeEl) {
      accessBadgeEl.textContent = '페이지 확인 중';
    }
    if (durationBadgeEl) {
      durationBadgeEl.textContent = '길이 확인 중';
    }
    if (modeEl) {
      modeEl.textContent = '판별 중';
    }
    if (timingEl) {
      timingEl.textContent = '--:-- / --:--';
    }
    if (partCountEl) {
      partCountEl.textContent = '0개';
    }
    setHeroMedia(null);
    return;
  }

  if (titleEl) {
    titleEl.textContent = title || 'SOOP 다시보기 다운로드';
  }

  if (subtitleEl) {
    subtitleEl.textContent = isSubscriptionPlus
      ? (hasParts
        ? '구독플러스 다운로드가 감지되었습니다. 브라우저 직접 저장과 M3U8 백업을 함께 제공합니다.'
        : '구독플러스 다운로드 가능 여부를 확인했습니다. 정밀 자동 스캔으로 실제 파트를 더 정확히 찾을 수 있습니다.')
      : isGeneralVideo
        ? (hasParts
          ? 'VOD 다시보기와 SOOP 다운로드를 바로 준비했습니다. 필요한 파트만 골라 저장하거나 ffmpeg CMD를 복사할 수 있습니다.'
          : 'VOD 다시보기 페이지를 찾았지만 저장 파트를 아직 찾지 못했습니다. 정밀 자동 스캔으로 다시 시도해 보세요.')
        : 'API 응답과 M3U8 주소를 바탕으로 일반 영상 또는 구독플러스 여부를 판별하는 중입니다.';
  }

  if (accessBadgeEl) {
    accessBadgeEl.textContent = isSubscriptionPlus ? '구독플러스' : isGeneralVideo ? '다시보기' : '판별 중';
  }

  if (durationBadgeEl) {
    durationBadgeEl.textContent = Number(videoInfo?.durationSeconds || 0) > 0
      ? `재생 ${buildClockLabel(videoInfo?.durationText, videoInfo?.durationSeconds)}`
      : '길이 미확인';
  }

  if (modeEl) {
    modeEl.textContent = isSubscriptionPlus ? '구독플러스' : isGeneralVideo ? '일반 영상' : '판별 중';
  }

  if (timingEl) {
    timingEl.textContent = buildTimingLabel(videoInfo);
  }

  if (partCountEl) {
    partCountEl.textContent = hasParts ? `${partItems.length}개 감지` : '탐색 필요';
  }

  setHeroMedia(videoInfo?.thumbnailUrl || null);
}

function createActionButton({ className, label, iconMarkup, onClick }) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.innerHTML = `${iconMarkup || ''}<span>${label}</span>`;
  button.onclick = onClick;
  return button;
}

function buildPartDisplayTitle(title, index, total) {
  const safeTitle = String(title || '현재 영상').trim() || '현재 영상';
  return total > 1 ? `${safeTitle} 파트 ${index + 1}` : safeTitle;
}

function createMergedDownloadRow(videoInfo, title, partItems) {
  const wrapper = document.createElement('article');
  wrapper.className = 'download-row merged-download-row';
  wrapper.style.setProperty('--item-index', '0');

  const header = document.createElement('div');
  header.className = 'download-top';

  const copy = document.createElement('div');
  const eyebrow = document.createElement('p');
  eyebrow.className = 'download-eyebrow';
  eyebrow.textContent = '전체 병합';

  const name = document.createElement('h3');
  name.className = 'download-name';
  name.textContent = `${title} 전체 파트`;

  const meta = document.createElement('p');
  meta.className = 'download-meta';
  meta.textContent = `${partItems.length}개 파트 통합 M3U8은 현재 비활성화되어 있습니다. 파트별 M3U8을 사용해서 브라우저 쪽 처리 방식으로 다시 설계할 예정입니다.`;

  copy.appendChild(eyebrow);
  copy.appendChild(name);
  copy.appendChild(meta);

  const badge = document.createElement('span');
  badge.className = 'download-badge';
  badge.textContent = `${partItems.length}개 병합`;

  header.appendChild(copy);
  header.appendChild(badge);

  const actions = document.createElement('div');
  actions.className = 'download-actions';

  const mergedButton = createActionButton({
    className: 'direct-button primary-action',
    label: '전체 파트 통합 M3U8 준비중',
    iconMarkup: DOWNLOAD_ICON_MARKUP,
    onClick: () => {
      alert('전체 파트 통합 M3U8 기능은 현재 비활성화되어 있습니다. 파트별 M3U8을 이용해주세요.');
    }
  });
  mergedButton.disabled = true;

  actions.appendChild(mergedButton);
  wrapper.appendChild(header);
  wrapper.appendChild(actions);
  return wrapper;
}

function renderDownloadParts(videoInfo, partItems) {
  const chapterListDiv = document.getElementById('chapter-list');
  if (!chapterListDiv) {
    return;
  }

  chapterListDiv.innerHTML = '';

  const title = String(videoInfo?.title || '현재 영상').trim() || '현재 영상';
  const isSubscriptionPlus = videoInfo?.accessType === 'subscription_plus';
  const timelineItems = buildPartTimelineItems(partItems, videoInfo);

  if (partItems.length > 1) {
    chapterListDiv.appendChild(createMergedDownloadRow(videoInfo, title, partItems));
  }

  partItems.forEach((part, index) => {
    const displayTitle = buildPartDisplayTitle(title, index, partItems.length);
    const fileTitle = displayTitle;
    const partIndex = Number(part.index ?? index);
    const { qualityOptions } = getPartQualityOptions(videoInfo, part, index);
    const qualityOptionCount = qualityOptions.length;
    const defaultQualityIndex = pickDefaultQualityIndex(qualityOptions);
    const timelineItem = timelineItems.find((item) => item.index === index) || null;

    const wrapper = document.createElement('article');
    wrapper.className = 'download-row';
    wrapper.style.setProperty('--item-index', String(index));
    wrapper.style.setProperty('--part-color', timelineItem?.color || getPartTimelineColor(index));

    const header = document.createElement('div');
    header.className = 'download-top';

    const copy = document.createElement('div');
    const eyebrow = document.createElement('p');
    eyebrow.className = 'download-eyebrow';
    eyebrow.textContent = partItems.length > 1 ? `파트 ${String(index + 1).padStart(2, '0')}` : '단일 영상';

    const name = document.createElement('h3');
    name.className = 'download-name';
    name.textContent = displayTitle;

    let timeRange = null;
    if (timelineItem) {
      timeRange = document.createElement('p');
      timeRange.className = 'part-time-range';

      const swatch = document.createElement('span');
      swatch.className = 'part-time-swatch';
      swatch.setAttribute('aria-hidden', 'true');

      const rangeText = document.createElement('strong');
      rangeText.textContent = `${timelineItem.startLabel} ~ ${timelineItem.endLabel}`;

      const durationText = document.createElement('span');
      durationText.className = 'part-time-duration';
      durationText.textContent = `${timelineItem.durationLabel}`;

      timeRange.appendChild(swatch);
      timeRange.appendChild(rangeText);
      timeRange.appendChild(durationText);
    }

    const meta = document.createElement('p');
    meta.className = 'download-meta';
    meta.textContent = isSubscriptionPlus
      ? '브라우저 직접 저장으로 바로 받고, 아래에서 고른 화질을 M3U8 백업과 ffmpeg CMD에도 함께 적용할 수 있습니다.'
      : '일반 영상도 직접 저장으로 바로 받을 수 있고, 아래 화질 선택을 M3U8 백업과 ffmpeg CMD에 공통으로 적용할 수 있습니다.';

    copy.appendChild(eyebrow);
    copy.appendChild(name);
    if (timeRange) {
      copy.appendChild(timeRange);
    }
    copy.appendChild(meta);

    const badge = document.createElement('span');
    badge.className = 'download-badge';
    badge.textContent = isSubscriptionPlus ? '구독+' : (partItems.length > 1 ? `${index + 1}/${partItems.length}` : '저장 가능');

    header.appendChild(copy);
    header.appendChild(badge);

    const qualityControls = document.createElement('div');
    qualityControls.className = 'quality-controls';

    const qualityHeader = document.createElement('div');
    qualityHeader.className = 'quality-header';

    const qualityLabel = document.createElement('span');
    qualityLabel.className = 'quality-label';
    qualityLabel.textContent = '다운로드 화질';

    const qualityNote = document.createElement('span');
    qualityNote.className = 'quality-note';
    qualityNote.textContent = qualityOptionCount > 1
      ? '최근 선택 화질을 기본값으로 유지합니다.'
      : '제공된 단일 화질입니다.';

    qualityHeader.appendChild(qualityLabel);
    qualityHeader.appendChild(qualityNote);
    qualityControls.appendChild(qualityHeader);

    const qualitySelect = document.createElement('select');
    qualitySelect.className = 'quality-select';
    qualitySelect.dataset.partIndex = String(index);
    qualitySelect.setAttribute('aria-label', `${displayTitle} 다운로드 화질`);

    qualityOptions.forEach((qualityOption, optionIndex) => {
      const optionElement = document.createElement('option');
      optionElement.value = String(optionIndex);
      optionElement.textContent = qualityOption.displayLabel;
      qualitySelect.appendChild(optionElement);
    });

    qualitySelect.value = String(defaultQualityIndex);
    qualitySelect.disabled = qualityOptionCount <= 1;
    qualityControls.appendChild(qualitySelect);

    const qualitySummary = document.createElement('p');
    qualitySummary.className = 'quality-summary';
    const getCurrentQuality = () => getSelectedQualityOption(qualitySelect, qualityOptions) || normalizeQualityOption({
      label: '기본 화질',
      file: part.playlistUrl
    });
    const updateQualitySummary = () => {
      const selectedQuality = getCurrentQuality();
      qualitySummary.textContent = selectedQuality
        ? `${selectedQuality.displayLabel} 기준으로 직접 저장, M3U8 백업, ffmpeg CMD를 맞춥니다.`
        : '기본 화질로 저장합니다.';
    };

    qualitySelect.addEventListener('change', () => {
      const selectedQuality = getCurrentQuality();
      if (selectedQuality) {
        savePreferredQuality(selectedQuality);
      }
      updateQualitySummary();
    });
    updateQualitySummary();
    qualityControls.appendChild(qualitySummary);

    const clipControls = document.createElement('div');
    clipControls.className = 'clip-controls';

    const clipHeader = document.createElement('div');
    clipHeader.className = 'clip-header';

    const clipLabel = document.createElement('span');
    clipLabel.className = 'clip-label';
    clipLabel.textContent = '구간 저장';

    const clipNote = document.createElement('span');
    clipNote.className = 'clip-note';
    clipNote.textContent = '비워두면 전체 저장';

    clipHeader.appendChild(clipLabel);
    clipHeader.appendChild(clipNote);
    clipControls.appendChild(clipHeader);

    const clipFields = document.createElement('div');
    clipFields.className = 'clip-fields';

    const startField = document.createElement('label');
    startField.className = 'clip-field';
    const startCaption = document.createElement('span');
    startCaption.textContent = '시작';
    const startInput = document.createElement('input');
    startInput.type = 'text';
    startInput.className = 'clip-time-input clip-start-input';
    startInput.dataset.partIndex = String(index);
    startInput.inputMode = 'numeric';
    startInput.placeholder = '01:05:00';
    startInput.setAttribute('aria-label', `${displayTitle} 구간 시작 시간`);
    startField.appendChild(startCaption);
    startField.appendChild(startInput);

    const endField = document.createElement('label');
    endField.className = 'clip-field';
    const endCaption = document.createElement('span');
    endCaption.textContent = '종료';
    const endInput = document.createElement('input');
    endInput.type = 'text';
    endInput.className = 'clip-time-input clip-end-input';
    endInput.dataset.partIndex = String(index);
    endInput.inputMode = 'numeric';
    endInput.placeholder = '01:55:00';
    endInput.setAttribute('aria-label', `${displayTitle} 구간 종료 시간`);
    endField.appendChild(endCaption);
    endField.appendChild(endInput);

    clipFields.appendChild(startField);
    clipFields.appendChild(endField);
    clipControls.appendChild(clipFields);

    const clipSummary = document.createElement('p');
    clipSummary.className = 'clip-summary';
    const getCurrentClipRange = () => buildClipRangeConfig(startInput.value, endInput.value);
    const updateClipSummary = () => {
      const clipRange = getCurrentClipRange();
      clipSummary.classList.toggle('error', !clipRange.ok);
      clipSummary.textContent = clipRange.ok
        ? clipRange.active
          ? `${clipRange.label} 직접 저장과 ffmpeg CMD에 적용됩니다.`
          : '전체 구간을 저장합니다.'
        : clipRange.message;
    };

    startInput.addEventListener('input', updateClipSummary);
    endInput.addEventListener('input', updateClipSummary);
    updateClipSummary();
    clipControls.appendChild(clipSummary);

    const actions = document.createElement('div');
    actions.className = 'download-actions';

    const primaryBtn = createActionButton({
      className: 'direct-button primary-action',
      label: partItems.length > 1 ? `파트 ${index + 1} 직접 저장` : '직접 저장',
      iconMarkup: DOWNLOAD_ICON_MARKUP,
      onClick: async () => {
        const clipRange = getCurrentClipRange();
        if (!clipRange.ok) {
          alert(clipRange.message);
          return;
        }

        const originalMarkup = primaryBtn.innerHTML;
        primaryBtn.disabled = true;
        primaryBtn.textContent = '패널 여는 중...';

        try {
          const selectedQuality = getCurrentQuality();
          const downloadTitle = buildClipRangeTitle(
            buildQualityTitle(fileTitle, selectedQuality, qualityOptionCount),
            clipRange
          );
          await openBrowserDirectDownloadOverlay({
            title: downloadTitle,
            partIndex,
            partNumber: index + 1,
            totalParts: partItems.length,
            playlistUrl: selectedQuality?.file || part.playlistUrl,
            titleNo: videoInfo?.titleNo || null,
            bjId: videoInfo?.bjId || null,
            accessType: videoInfo?.accessType || 'subscription_plus',
            downloadLabel: '영상 다운로드',
            selectedQuality,
            clipStartSeconds: clipRange.active ? clipRange.startSeconds : 0,
            clipEndSeconds: clipRange.active ? clipRange.endSeconds : null,
            clipLabel: clipRange.active ? clipRange.label : ''
          });
        } catch (error) {
          console.error('영상 다운로드 패널 열기 실패:', error);
          primaryBtn.disabled = false;
          primaryBtn.innerHTML = originalMarkup;
          alert(`영상 다운로드 패널을 열지 못했습니다: ${error.message}`);
        }
      }
    });

    actions.appendChild(primaryBtn);

    const playlistBtn = createActionButton({
      className: 'playlist-button secondary-button compact-action',
      label: 'M3U8 백업',
      iconMarkup: '',
      onClick: () => {
        const selectedQuality = getCurrentQuality();
        const downloadTitle = buildQualityTitle(fileTitle, selectedQuality, qualityOptionCount);
        downloadPlaylistFile(selectedQuality?.file || part.playlistUrl, downloadTitle, selectedQuality);
      }
    });
    actions.appendChild(playlistBtn);

    const cmdBtn = createActionButton({
      className: 'secondary-button command-button',
      label: 'ffmpeg CMD',
      iconMarkup: COMMAND_ICON_MARKUP,
      onClick: () => {
        const clipRange = getCurrentClipRange();
        if (!clipRange.ok) {
          alert(clipRange.message);
          return;
        }

        const selectedQuality = getCurrentQuality();
        const downloadTitle = buildClipRangeTitle(
          buildQualityTitle(fileTitle, selectedQuality, qualityOptionCount),
          clipRange
        );
        const cmd = buildFfmpegCommand(selectedQuality?.file || part.playlistUrl, downloadTitle, clipRange);
        const partPrefix = partItems.length > 1 ? `[파트 ${index + 1}] ` : '';
        copyToClipboard(cmd).then(() => alert(`${partPrefix}${selectedQuality?.displayLabel || '기본 화질'} FFmpeg 명령어가 복사되었습니다!\n구간: ${clipRange.active ? clipRange.label : '전체'}`));
      }
    });

    actions.appendChild(cmdBtn);

    wrapper.appendChild(header);
    wrapper.appendChild(qualityControls);
    wrapper.appendChild(clipControls);
    wrapper.appendChild(actions);
    chapterListDiv.appendChild(wrapper);
  });

  if (partItems.length > 1) {
    const guideMsg = document.createElement('p');
    guideMsg.className = 'part-guide';
    guideMsg.textContent = '파트별 재생 구간을 기준으로 필요한 파트나 시간만 골라 저장할 수 있습니다. 플레이어 재생바에도 같은 색상 구간을 표시합니다.';
    chapterListDiv.appendChild(guideMsg);
  }
}

function executeInActiveTab(pageFunction, args = []) {
  return new Promise((resolve, reject) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tabId = tabs && tabs[0] ? tabs[0].id : null;
      if (!tabId) {
        reject(new Error('활성 탭을 찾을 수 없습니다.'));
        return;
      }

      chrome.scripting.executeScript(
        {
          target: { tabId },
          world: 'MAIN',
          function: pageFunction,
          args
        },
        (results) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }

          if (!results || !results[0]) {
            reject(new Error('페이지 스크립트 실행 결과를 받지 못했습니다.'));
            return;
          }

          resolve(results[0].result);
        }
      );
    });
  });
}

function syncPlayerPartTimeline(videoInfo, partItems) {
  const timelineItems = buildPartTimelineItems(partItems, videoInfo);
  const totalDurationSeconds = getPartTimelineTotalDuration(timelineItems, videoInfo);

  if (timelineItems.length === 0 || totalDurationSeconds <= 0) {
    return;
  }

  executeInActiveTab(injectPlayerPartTimeline, [{
    totalDurationSeconds,
    parts: timelineItems.map((item) => ({
      index: item.index,
      partNumber: item.partNumber,
      label: item.label,
      startSeconds: item.startSeconds,
      endSeconds: item.endSeconds,
      startLabel: item.startLabel,
      endLabel: item.endLabel,
      color: item.color
    }))
  }]).catch((error) => {
    console.warn('플레이어 파트 타임라인 표시 실패:', error);
  });
}

function clearPlayerPartTimeline() {
  executeInActiveTab(injectPlayerPartTimeline, [{
    totalDurationSeconds: 0,
    parts: []
  }]).catch(() => {});
}

function injectPlayerPartTimeline(payload) {
  const stateKey = '__SOOP_PART_TIMELINE_STATE__';
  const overlayId = '__soop-part-timeline-overlay__';
  const styleId = '__soop-part-timeline-style__';
  const legacyPartLabelId = '__soop-part-timeline-label__';
  const legacyInlineLabelClass = 'soop-part-inline-label';

  const previousState = window[stateKey];
  if (previousState?.cleanup) {
    previousState.cleanup();
  }

  const totalDurationSeconds = Math.max(0, Number(payload?.totalDurationSeconds || 0));
  const parts = Array.isArray(payload?.parts)
    ? payload.parts
      .map((part, index) => ({
        index: Number(part.index ?? index),
        partNumber: Number(part.partNumber || index + 1),
        label: String(part.label || `파트 ${index + 1}`),
        startSeconds: Math.max(0, Number(part.startSeconds || 0)),
        endSeconds: Math.max(0, Number(part.endSeconds || 0)),
        startLabel: String(part.startLabel || ''),
        endLabel: String(part.endLabel || ''),
        color: String(part.color || '#83f28f')
      }))
      .filter((part) => part.endSeconds > part.startSeconds)
    : [];

  const removeExisting = (includeStyle = false) => {
    document.getElementById(overlayId)?.remove();
    document.getElementById(legacyPartLabelId)?.remove();
    document.querySelectorAll(`.${legacyInlineLabelClass}`).forEach((element) => element.remove());
    if (includeStyle) {
      document.getElementById(styleId)?.remove();
    }
  };

  if (parts.length === 0 || totalDurationSeconds <= 0) {
    removeExisting(true);
    delete window[stateKey];
    return {
      ok: false,
      message: '파트 타임라인을 표시할 시간이 부족합니다.'
    };
  }

  const toTransparentPartColor = (color, alpha = 0.42) => {
    const normalized = String(color || '').trim();
    const hexMatch = normalized.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!hexMatch) {
      return normalized || `rgba(255, 255, 255, ${alpha})`;
    }

    const hexValue = hexMatch[1].length === 3
      ? hexMatch[1].split('').map((char) => `${char}${char}`).join('')
      : hexMatch[1];
    const red = Number.parseInt(hexValue.slice(0, 2), 16);
    const green = Number.parseInt(hexValue.slice(2, 4), 16);
    const blue = Number.parseInt(hexValue.slice(4, 6), 16);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
  };

  const buildTimelineBackground = (playedSeconds = 0) => {
    const baseColor = 'transparent';
    const clampPercent = (value) => Math.max(0, Math.min(100, value));
    const formatPercent = (value) => clampPercent(value).toFixed(3).replace(/\.?0+$/, '');
    const playedPercent = clampPercent((Math.max(0, Number(playedSeconds) || 0) / totalDurationSeconds) * 100);
    const stops = [
      `${baseColor} 0%`,
      `${baseColor} ${formatPercent(playedPercent)}%`
    ];
    let cursorPercent = playedPercent;

    parts.forEach((part) => {
      const startPercent = clampPercent((part.startSeconds / totalDurationSeconds) * 100);
      const endPercent = clampPercent((part.endSeconds / totalDurationSeconds) * 100);
      if (endPercent <= playedPercent) {
        return;
      }

      const visibleStartPercent = Math.max(startPercent, playedPercent);

      if (visibleStartPercent > cursorPercent) {
        stops.push(`${baseColor} ${formatPercent(cursorPercent)}%`);
        stops.push(`${baseColor} ${formatPercent(visibleStartPercent)}%`);
      }

      const partColor = toTransparentPartColor(part.color);
      stops.push(`${partColor} ${formatPercent(visibleStartPercent)}%`);
      stops.push(`${partColor} ${formatPercent(endPercent)}%`);
      cursorPercent = Math.max(cursorPercent, endPercent);
    });

    if (cursorPercent < 100) {
      stops.push(`${baseColor} ${formatPercent(cursorPercent)}%`);
      stops.push(`${baseColor} 100%`);
    }

    return `linear-gradient(90deg, ${stops.join(', ')})`;
  };

  const ensureStyle = () => {
    const styleText = `
      #${overlayId} {
        position: absolute;
        left: 0;
        top: 50%;
        width: 100%;
        height: 100%;
        max-height: 6px;
        z-index: 2;
        display: none;
        overflow: hidden;
        border-radius: 2px;
        pointer-events: none;
        contain: layout style paint;
        opacity: 1;
        transform: translateY(-50%);
      }
    `;

    let style = document.getElementById(styleId);
    if (!style) {
      style = document.createElement('style');
      style.id = styleId;
      document.documentElement.appendChild(style);
    }
    if (style.textContent !== styleText) {
      style.textContent = styleText;
    }
  };

  const isVisible = (element) => {
    if (!element || !(element instanceof Element)) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width >= 220 &&
      rect.height >= 3 &&
      rect.height <= 28 &&
      rect.bottom >= 0 &&
      rect.top <= window.innerHeight &&
      style.display !== 'none' &&
      style.visibility !== 'hidden' &&
      Number(style.opacity || 1) > 0;
  };

  const scoreCandidate = (element) => {
    const rect = element.getBoundingClientRect();
    const text = `${element.id || ''} ${element.className || ''}`.toLowerCase();
    let score = rect.width;
    if (/progress|seek|time|timeline|slider|bar|control|scrub|track/.test(text)) {
      score += 700;
    }
    if (/volume|sound|chat|thumb|preview|ad|banner|thumbnail/.test(text)) {
      score -= 900;
    }
    if (element.closest('#player')) {
      score += 900;
    }
    score += Math.max(0, 900 - Math.abs(rect.top - (window.innerHeight * 0.82)));
    return score;
  };

  const findProgressHost = () => {
    const playerElement = document.getElementById('player') || document.querySelector('.video[dark], .video');
    if (!playerElement) {
      return null;
    }

    const selectors = [
      '.time_slider',
      '.time-slider',
      '.progress_bar',
      '.progress-bar',
      '.progressbar',
      '.seek_bar',
      '.seek-bar',
      '.seekbar',
      '.timeline',
      '.player_timeline',
      '.player-timeline',
      '.vod_progress',
      '.vod-progress',
      '[role="slider"]',
      '[class*="progress"]',
      '[class*="seek"]',
      '[class*="timeline"]',
      '[class*="slider"]'
    ];
    const directCandidates = selectors.flatMap((selector) => Array.from(playerElement.querySelectorAll(selector)));
    const candidates = [...new Set(directCandidates)]
      .filter(isVisible)
      .sort((left, right) => scoreCandidate(right) - scoreCandidate(left));
    return candidates[0] || null;
  };

  ensureStyle();
  removeExisting();

  const overlay = document.createElement('div');
  overlay.id = overlayId;
  overlay.style.background = buildTimelineBackground(0);

  document.body.appendChild(overlay);

  let host = null;
  let player = null;
  let video = null;
  let updateFrame = 0;
  let playerObserver = null;
  let progressTimer = 0;
  let lastPlayedPercent = -1;
  let lastHostValidatedAt = 0;
  let lastOverlayRectKey = '';
  let decoratedHost = null;
  let decoratedHostInlinePosition = '';

  const getPlayer = () => document.getElementById('player') || document.querySelector('.video[dark], .video');

  const isPlayerActive = () => {
    const currentPlayer = player || getPlayer();
    return Boolean(currentPlayer && (
      currentPlayer.classList.contains('mouseover') ||
      currentPlayer.classList.contains('ctrl_output')
    ));
  };

  const hideTimeline = () => {
    overlay.style.display = 'none';
    stopProgressTimer();
    lastOverlayRectKey = '';
  };

  const parseClockTextToSeconds = (value) => {
    const parts = String(value || '')
      .trim()
      .split(':')
      .map((part) => Number(part));

    if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
      return (parts[0] * 3600) + (parts[1] * 60) + parts[2];
    }
    if (parts.length === 2 && parts.every((part) => Number.isFinite(part))) {
      return (parts[0] * 60) + parts[1];
    }
    return 0;
  };

  const getActiveVideo = () => {
    return player?.querySelector('video') ||
      document.querySelector('#player video') ||
      document.querySelector('video') ||
      null;
  };

  const getCurrentPlaybackSeconds = () => {
    const activeVideo = video || getActiveVideo();
    if (activeVideo && Number.isFinite(activeVideo.currentTime)) {
      return activeVideo.currentTime;
    }

    const currentTimeText =
      player?.querySelector('.time-current')?.textContent ||
      document.querySelector('.time-current')?.textContent ||
      '';
    return parseClockTextToSeconds(currentTimeText);
  };

  const updateTimelineBackground = () => {
    const currentSeconds = Math.max(0, Math.min(totalDurationSeconds, getCurrentPlaybackSeconds()));
    const playedPercent = (currentSeconds / totalDurationSeconds) * 100;
    if (Math.abs(playedPercent - lastPlayedPercent) < 0.05) {
      return;
    }

    overlay.style.background = buildTimelineBackground(currentSeconds);
    lastPlayedPercent = playedPercent;
  };

  const startProgressTimer = () => {
    if (progressTimer) {
      return;
    }

    progressTimer = window.setInterval(() => {
      if (isPlayerActive()) {
        updateTimelineBackground();
      }
    }, 500);
  };

  const stopProgressTimer = () => {
    if (!progressTimer) {
      return;
    }

    window.clearInterval(progressTimer);
    progressTimer = 0;
  };

  const handlePlaybackProgress = () => {
    updateTimelineBackground();
  };

  const detachVideo = () => {
    if (!video) {
      return;
    }

    video.removeEventListener('timeupdate', handlePlaybackProgress);
    video.removeEventListener('seeking', handlePlaybackProgress);
    video.removeEventListener('loadedmetadata', handlePlaybackProgress);
    video.removeEventListener('play', handlePlaybackProgress);
    video.removeEventListener('pause', handlePlaybackProgress);
    video = null;
  };

  const attachVideo = () => {
    const nextVideo = getActiveVideo();
    if (!nextVideo || nextVideo === video) {
      return;
    }

    detachVideo();
    video = nextVideo;
    video.addEventListener('timeupdate', handlePlaybackProgress, { passive: true });
    video.addEventListener('seeking', handlePlaybackProgress, { passive: true });
    video.addEventListener('loadedmetadata', handlePlaybackProgress, { passive: true });
    video.addEventListener('play', handlePlaybackProgress, { passive: true });
    video.addEventListener('pause', handlePlaybackProgress, { passive: true });
    updateTimelineBackground();
  };

  const restoreDecoratedHost = () => {
    if (!decoratedHost) {
      return;
    }

    decoratedHost.style.position = decoratedHostInlinePosition;
    decoratedHost = null;
    decoratedHostInlinePosition = '';
  };

  const attachOverlayToHost = (nextHost) => {
    if (!nextHost || /^(INPUT|VIDEO|CANVAS)$/i.test(nextHost.tagName || '')) {
      return false;
    }

    if (decoratedHost !== nextHost) {
      restoreDecoratedHost();
      decoratedHost = nextHost;
      decoratedHostInlinePosition = nextHost.style.position || '';

      if (window.getComputedStyle(nextHost).position === 'static') {
        nextHost.style.position = 'relative';
      }
    }

    if (overlay.parentElement !== nextHost) {
      nextHost.insertBefore(overlay, nextHost.firstChild);
    }

    return true;
  };

  const updatePosition = () => {
    if (!isPlayerActive()) {
      hideTimeline();
      return false;
    }

    const now = performance.now();
    if (!host || !document.documentElement.contains(host) || now - lastHostValidatedAt > 800) {
      if (host && document.documentElement.contains(host) && isVisible(host)) {
        lastHostValidatedAt = now;
      } else {
        host = findProgressHost();
        lastHostValidatedAt = now;
      }
    }

    if (!host) {
      hideTimeline();
      return false;
    }

    const rect = host.getBoundingClientRect();
    if (rect.width < 220 || rect.height < 3) {
      hideTimeline();
      return false;
    }

    if (!attachOverlayToHost(host)) {
      hideTimeline();
      return false;
    }

    attachVideo();
    updateTimelineBackground();
    startProgressTimer();

    const rectKey = `${host.className || ''}:${Math.round(rect.width)}:${Math.round(rect.height)}`;
    if (rectKey !== lastOverlayRectKey || overlay.style.display !== 'block') {
      overlay.style.display = 'block';
      lastOverlayRectKey = rectKey;
    }
    return true;
  };

  const updateTimeline = () => {
    updateFrame = 0;
    updatePosition();
  };

  const queueUpdate = () => {
    if (!updateFrame) {
      updateFrame = window.requestAnimationFrame(updateTimeline);
    }
  };

  const requestUpdate = () => {
    queueUpdate();
  };

  const attachPlayer = () => {
    const nextPlayer = getPlayer();
    if (!nextPlayer || nextPlayer === player) {
      return;
    }

    if (player) {
      player.removeEventListener('mouseenter', requestUpdate);
      player.removeEventListener('mouseleave', hideTimeline);
    }

    player = nextPlayer;
    player.addEventListener('mouseenter', requestUpdate, { passive: true });
    player.addEventListener('mouseleave', hideTimeline, { passive: true });

    playerObserver?.disconnect();
    playerObserver = new MutationObserver(() => {
      if (isPlayerActive()) {
        requestUpdate();
      } else {
        hideTimeline();
      }
    });
    playerObserver.observe(player, { attributes: true, attributeFilter: ['class'] });
  };

  attachPlayer();

  const resizeHandler = () => {
    host = null;
    lastHostValidatedAt = 0;
    lastOverlayRectKey = '';
    requestUpdate();
  };

  window.addEventListener('resize', resizeHandler, { passive: true });
  requestUpdate();

  window[stateKey] = {
    cleanup: () => {
      if (updateFrame) {
        window.cancelAnimationFrame(updateFrame);
      }
      if (player) {
        player.removeEventListener('mouseenter', requestUpdate);
        player.removeEventListener('mouseleave', hideTimeline);
      }
      stopProgressTimer();
      detachVideo();
      playerObserver?.disconnect();
      window.removeEventListener('resize', resizeHandler);
      restoreDecoratedHost();
      removeExisting(true);
    }
  };

  return {
    ok: true,
    parts: parts.length
  };
}

function handleAdvancedScan() {
  setChapterListState(
    'loading',
    '정밀 자동 스캔을 실행하는 중입니다.',
    '플레이어의 재생 위치가 잠시 이동할 수 있습니다. 스캔이 끝나면 다운로드 파트를 다시 정리합니다.'
  );
  updateActionHint('정밀 자동 스캔 중에는 플레이어를 조작하지 않는 편이 안전합니다.');

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
            setChapterListState('error', '정밀 자동 스캔에 실패했습니다.', message);
            alert(`스캔 실패: ${message}`);
          }
        } else {
          setChapterListState('error', '정밀 자동 스캔을 실행하지 못했습니다.', '스크립트 실행 결과를 받지 못했습니다.');
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
  latestVideoInfo = null;
  latestPartItems = [];
  setChapterListState(
    'loading',
    '현재 VOD 정보를 읽는 중입니다.',
    '열려 있는 SOOP 다시보기 페이지의 썸네일, 재생 시간, 파트 구성을 확인하고 있습니다.'
  );
  updateActionHint('영상 다운로드 버튼은 구독플러스도 호환됩니다.');
  updateVideoHero(null, []);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    chrome.scripting.executeScript(
      {
        target: { tabId: tabs[0].id },
        world: 'MAIN',
        function: extractVideoInfo
      },
      (results) => {
        if (results && results[0] && results[0].result) {
          const videoInfo = results[0].result;
          const partItems = extractDownloadParts(videoInfo);
          latestVideoInfo = videoInfo;
          latestPartItems = partItems;

          updateVideoHero(videoInfo, partItems);
          updateActionHint(
            videoInfo?.accessType === 'subscription_plus'
              ? '구독플러스 다운로드를 감지했습니다. 직접 저장과 M3U8 백업을 함께 지원합니다.'
              : videoInfo?.accessType === 'general'
                ? '일반 영상도 직접 저장과 M3U8 백업을 함께 지원합니다.'
                : 'auth_no 또는 M3U8 주소를 확인해 유형을 판별하는 중입니다.'
          );

          if (videoInfo?.error) {
            clearPlayerPartTimeline();
            setChapterListState('error', '현재 탭에서 비디오 정보를 읽지 못했습니다.', videoInfo.error);
            return;
          }

          if (partItems.length > 0) {
            renderDownloadParts(videoInfo, partItems);
            syncPlayerPartTimeline(videoInfo, partItems);
            updateActionHint('파트 카드에서 화질을 고르면 직접 저장, M3U8 백업, ffmpeg CMD에 함께 적용됩니다.');
          } else {
            clearPlayerPartTimeline();
            setChapterListState(
              'error',
              '다운로드 파트를 찾지 못했습니다.',
              'playlist.m3u8 URL을 찾지 못했습니다. SOOP 다시보기 페이지에서 "정밀 자동 스캔"을 먼저 시도해 보세요.'
            );
          }
        } else {
          updateVideoHero(null, []);
          setChapterListState(
            'error',
            '비디오 정보를 추출하는 데 실패했습니다.',
            '현재 활성 탭이 SOOP 다시보기 플레이어인지 확인한 뒤 다시 감지해 주세요.'
          );
          updateActionHint('SOOP 플레이어 페이지가 아니면 다운로드 정보를 불러오지 못할 수 있습니다.');
        }
      }
    );
  });
}

async function openBrowserDirectDownloadOverlay(downloadConfig) {
  const result = await executeInActiveTab(injectBrowserDirectDownloadPanel, [downloadConfig || {}]);
  if (!result || result.ok !== true) {
    throw new Error(result?.message || '페이지에 브라우저 다운로드 패널을 만들지 못했습니다.');
  }

  setTimeout(() => {
    window.close();
  }, 120);
}

function injectBrowserDirectDownloadPanel(downloadConfig) {
  const stateKey = '__SOOP_DIRECT_DOWNLOAD_STATE__';
  const overlayId = '__soop-direct-download-overlay__';
  const styleId = '__soop-direct-download-style__';
  const existingState = window[stateKey];

  if (existingState?.busy) {
    return {
      ok: false,
      message: '이미 직접 다운로드가 진행 중입니다. 페이지의 다운로드 패널을 확인해주세요.'
    };
  }

  const job = {
    title: String(downloadConfig?.title || document.title || 'SOOP_VOD'),
    partIndex: Math.max(0, Number(downloadConfig?.partIndex || 0)),
    partNumber: Math.max(1, Number(downloadConfig?.partNumber || 1)),
    totalParts: Math.max(1, Number(downloadConfig?.totalParts || 1)),
    playlistUrl: String(downloadConfig?.playlistUrl || ''),
    playlistUrls: Array.isArray(downloadConfig?.playlistUrls)
      ? downloadConfig.playlistUrls.map((url) => String(url || '')).filter(Boolean)
      : [],
    titleNo: String(downloadConfig?.titleNo || ''),
    bjId: String(downloadConfig?.bjId || ''),
    accessType: String(downloadConfig?.accessType || 'subscription_plus'),
    downloadLabel: String(downloadConfig?.downloadLabel || '영상 다운로드'),
    mergeParts: Boolean(downloadConfig?.mergeParts),
    clipStartSeconds: Math.max(0, Number(downloadConfig?.clipStartSeconds || 0)),
    clipEndSeconds: Number.isFinite(Number(downloadConfig?.clipEndSeconds)) && Number(downloadConfig?.clipEndSeconds) > 0
      ? Number(downloadConfig.clipEndSeconds)
      : null,
    clipLabel: String(downloadConfig?.clipLabel || ''),
    selectedQuality: downloadConfig?.selectedQuality ? {
      file: String(downloadConfig.selectedQuality.file || ''),
      resolution: String(downloadConfig.selectedQuality.resolution || ''),
      bitrate: String(downloadConfig.selectedQuality.bitrate || ''),
      label: String(downloadConfig.selectedQuality.label || ''),
      displayLabel: String(downloadConfig.selectedQuality.displayLabel || ''),
      resolutionLabel: String(downloadConfig.selectedQuality.resolutionLabel || ''),
      bitrateLabel: String(downloadConfig.selectedQuality.bitrateLabel || ''),
      name: String(downloadConfig.selectedQuality.name || '')
    } : null
  };

  const removeExistingOverlay = () => {
    const oldOverlay = document.getElementById(overlayId);
    if (oldOverlay) {
      oldOverlay.remove();
    }
  };

  const ensureStyle = () => {
    if (document.getElementById(styleId)) {
      return;
    }

    const style = document.createElement('style');
    style.id = styleId;
    style.textContent = `
      #${overlayId} {
        position: fixed;
        right: 24px;
        bottom: 24px;
        width: min(360px, calc(100vw - 32px));
        background: rgba(17, 24, 39, 0.96);
        color: #f9fafb;
        border-radius: 16px;
        box-shadow: 0 18px 40px rgba(0, 0, 0, 0.35);
        border: 1px solid rgba(148, 163, 184, 0.28);
        padding: 18px 18px 16px;
        z-index: 2147483647;
        font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif;
      }
      #${overlayId} * {
        box-sizing: border-box;
      }
      #${overlayId} .soop-direct-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 10px;
      }
      #${overlayId} .soop-direct-title {
        font-size: 16px;
        font-weight: 700;
        line-height: 1.4;
      }
      #${overlayId} .soop-direct-subtitle {
        color: #cbd5e1;
        font-size: 12px;
        line-height: 1.5;
        margin-bottom: 12px;
      }
      #${overlayId} .soop-direct-status {
        font-size: 13px;
        line-height: 1.6;
        color: #e5e7eb;
        margin-bottom: 10px;
        white-space: pre-line;
      }
      #${overlayId} .soop-direct-detail {
        font-size: 12px;
        line-height: 1.5;
        color: #cbd5e1;
        margin-bottom: 12px;
        min-height: 18px;
      }
      #${overlayId} .soop-direct-progress {
        width: 100%;
        height: 10px;
        border-radius: 999px;
        overflow: hidden;
        background: rgba(148, 163, 184, 0.2);
        margin-bottom: 14px;
      }
      #${overlayId} .soop-direct-progress-bar {
        width: 0%;
        height: 100%;
        background: linear-gradient(90deg, #22c55e 0%, #06b6d4 100%);
        transition: width 0.2s ease;
      }
      #${overlayId} .soop-direct-actions {
        display: flex;
        gap: 8px;
      }
      #${overlayId} button {
        border: 0;
        border-radius: 10px;
        padding: 11px 12px;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
      }
      #${overlayId} .soop-direct-start {
        flex: 1;
        background: #22c55e;
        color: #04130a;
      }
      #${overlayId} .soop-direct-cancel {
        background: #475569;
        color: #f8fafc;
      }
      #${overlayId} .soop-direct-close {
        background: transparent;
        color: #94a3b8;
        padding: 0;
        width: 24px;
        height: 24px;
        font-size: 18px;
        line-height: 1;
      }
      #${overlayId} button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `;
    document.documentElement.appendChild(style);
  };

  const sanitizeFileName = (value) => String(value || 'SOOP_VOD')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'SOOP_VOD';

  const extractTitleNo = () => {
    const match = window.location.pathname.match(/\/player\/(\d+)/i);
    return match ? match[1] : null;
  };

  const formatBytes = (bytes) => {
    const value = Number(bytes || 0);
    if (!Number.isFinite(value) || value <= 0) {
      return '0 B';
    }

    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = value;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) {
      size /= 1024;
      index += 1;
    }
    return `${size.toFixed(size >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
  };

  const formatDuration = (seconds) => {
    const safeSeconds = Math.max(0, Math.round(Number(seconds || 0)));
    const hours = Math.floor(safeSeconds / 3600);
    const minutes = Math.floor((safeSeconds % 3600) / 60);
    const secs = safeSeconds % 60;
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${minutes}:${String(secs).padStart(2, '0')}`;
  };

  const getCookiePath = (manifestUrl) => {
    try {
      const pathname = new URL(manifestUrl).pathname;
      const match = pathname.match(/(\/spkt\/vod\/\d{8}\/\d+\/\d+)/);
      return match ? match[1] : pathname.replace(/\/[^/]*$/, '') || '/';
    } catch (error) {
      return '/';
    }
  };

  const applySignedCookies = (manifestUrl, signedCookie) => {
    const cookiePath = getCookiePath(manifestUrl);
    const cookieParts = String(signedCookie || '')
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => part.startsWith('CloudFront-'));

    cookieParts.forEach((part) => {
      document.cookie = `${part}; domain=.sooplive.com; path=${cookiePath}; Secure; SameSite=Lax`;
    });
  };

  const postFormJson = async (url, formData, signal) => {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams(formData)
    });

    const text = await response.text();
    let payload = null;
    try {
      payload = JSON.parse(text);
    } catch (error) {
      throw new Error(`응답을 파싱하지 못했습니다: ${url}`);
    }

    if (!response.ok) {
      throw new Error(`요청 실패 (${response.status}): ${url}`);
    }

    return payload;
  };

  const parseVariantScore = (variant) => {
    const infoLine = String(variant?.infoLine || '');
    const bandwidthMatch = infoLine.match(/BANDWIDTH=(\d+)/i);
    const resolutionMatch = infoLine.match(/RESOLUTION=(\d+)x(\d+)/i);
    const bandwidth = bandwidthMatch ? Number(bandwidthMatch[1]) : 0;
    const width = resolutionMatch ? Number(resolutionMatch[1]) : 0;
    const height = resolutionMatch ? Number(resolutionMatch[2]) : 0;
    return bandwidth + (width * height);
  };

  const parseHlsAttributeList = (attributeText) => {
    const attributes = {};
    let key = '';
    let value = '';
    let readingKey = true;
    let inQuotes = false;

    const commit = () => {
      const normalizedKey = key.trim().toUpperCase();
      if (normalizedKey) {
        attributes[normalizedKey] = value.trim().replace(/^"|"$/g, '');
      }
      key = '';
      value = '';
      readingKey = true;
    };

    for (const character of String(attributeText || '')) {
      if (readingKey) {
        if (character === '=') {
          readingKey = false;
        } else if (character === ',') {
          commit();
        } else {
          key += character;
        }
        continue;
      }

      if (character === '"') {
        inQuotes = !inQuotes;
        value += character;
        continue;
      }

      if (character === ',' && !inQuotes) {
        commit();
        continue;
      }

      value += character;
    }

    commit();
    return attributes;
  };

  const parseM3u8 = (manifestText, manifestUrl) => {
    const variants = [];
    const audioGroups = new Map();
    const segments = [];
    let initSegmentUrl = null;
    let pendingStreamInfo = null;
    let pendingDuration = 0;
    let hasDiscontinuity = false;

    String(manifestText || '')
      .replace(/\r/g, '')
      .split('\n')
      .map((line) => line.trim())
      .forEach((line) => {
        if (!line) {
          return;
        }

        if (line.startsWith('#EXT-X-MEDIA:')) {
          const attributes = parseHlsAttributeList(line.slice(line.indexOf(':') + 1));
          if (String(attributes.TYPE || '').toUpperCase() === 'AUDIO' && attributes['GROUP-ID']) {
            const entries = audioGroups.get(attributes['GROUP-ID']) || [];
            let audioUri = '';
            try {
              audioUri = attributes.URI ? new URL(attributes.URI, manifestUrl).href : '';
            } catch (error) {
              audioUri = attributes.URI || '';
            }
            entries.push({
              groupId: attributes['GROUP-ID'],
              name: attributes.NAME || '',
              isDefault: String(attributes.DEFAULT || '').toUpperCase() === 'YES',
              uri: audioUri
            });
            audioGroups.set(attributes['GROUP-ID'], entries);
          }
          return;
        }

        if (line.startsWith('#EXT-X-STREAM-INF:')) {
          pendingStreamInfo = {
            line,
            attributes: parseHlsAttributeList(line.slice(line.indexOf(':') + 1))
          };
          return;
        }

        if (pendingStreamInfo && !line.startsWith('#')) {
          variants.push({
            url: new URL(line, manifestUrl).href,
            infoLine: pendingStreamInfo.line,
            audioGroupId: pendingStreamInfo.attributes.AUDIO || '',
            codecs: pendingStreamInfo.attributes.CODECS || ''
          });
          pendingStreamInfo = null;
          return;
        }

        if (line.startsWith('#EXT-X-MAP:')) {
          const match = line.match(/URI="([^"]+)"/i);
          if (match) {
            initSegmentUrl = new URL(match[1], manifestUrl).href;
          }
          return;
        }

        if (line.startsWith('#EXT-X-DISCONTINUITY')) {
          hasDiscontinuity = true;
          return;
        }

        if (line.startsWith('#EXTINF:')) {
          pendingDuration = Number.parseFloat(line.slice(8)) || 0;
          return;
        }

        if (!line.startsWith('#')) {
          segments.push({
            url: new URL(line, manifestUrl).href,
            duration: pendingDuration
          });
          pendingDuration = 0;
        }
      });

    const usesFragmentedMp4 = Boolean(initSegmentUrl) || segments.some((segment) => /\.m4s(?:[?#]|$)|\.mp4(?:[?#]|$)/i.test(segment.url));
    return { variants, audioGroups, initSegmentUrl, segments, usesFragmentedMp4, hasDiscontinuity };
  };

  const normalizeComparableUrl = (url) => {
    const rawUrl = String(url || '').trim();
    if (!rawUrl) {
      return '';
    }

    try {
      return new URL(rawUrl).href;
    } catch (error) {
      return rawUrl;
    }
  };

  const parseResolutionInfo = (value) => {
    const match = String(value || '').match(/(\d+)\s*x\s*(\d+)/i);
    if (!match) {
      return {
        width: 0,
        height: 0
      };
    }

    return {
      width: Number(match[1]) || 0,
      height: Number(match[2]) || 0
    };
  };

  const parseBitrateValue = (value) => {
    const bitrateText = String(value || '').trim().toLowerCase();
    if (!bitrateText) {
      return 0;
    }

    const numericMatch = bitrateText.replace(/,/g, '').match(/[\d.]+/);
    const numericValue = numericMatch ? Number.parseFloat(numericMatch[0]) : 0;
    if (!Number.isFinite(numericValue) || numericValue <= 0) {
      return 0;
    }

    if (bitrateText.includes('mbps') || bitrateText.endsWith('m')) {
      return numericValue * 1000000;
    }

    if (bitrateText.includes('kbps') || bitrateText.endsWith('k')) {
      return numericValue * 1000;
    }

    return numericValue;
  };

  const formatQualityResolution = (resolution) => {
    const info = parseResolutionInfo(resolution);
    if (info.height > 0) {
      return `${info.height}p`;
    }

    return String(resolution || '').trim();
  };

  const normalizeQualityOption = (option, fallback = {}) => {
    const file = String(option?.file || fallback.file || '').trim();
    const resolution = String(option?.resolution || fallback.resolution || '').trim();
    const bitrate = String(option?.bitrate || fallback.bitrate || '').trim();
    const name = String(option?.name || fallback.name || '').trim();
    const displayName = String(option?.label || fallback.label || '').trim() || (/original/i.test(name) ? '원본' : '');
    const resolutionLabel = formatQualityResolution(resolution);
    const bitrateLabel = String(option?.bitrateLabel || fallback.bitrateLabel || '').trim() || String(bitrate || '').trim();
    const displayLabel = [...new Set([displayName, resolutionLabel, bitrateLabel].filter(Boolean))].join(' · ') || '기본 화질';

    return {
      file,
      resolution,
      bitrate,
      name,
      label: displayName || resolutionLabel || '기본 화질',
      displayLabel,
      resolutionLabel,
      bitrateLabel
    };
  };

  const scoreQualityOption = (option) => {
    const resolution = parseResolutionInfo(option?.resolution);
    const bitrate = parseBitrateValue(option?.bitrate);
    const originalBonus = /original/i.test(String(option?.name || '')) || String(option?.label || '').includes('원본') ? 1 : 0;
    return (originalBonus * 1000000000000) + (resolution.width * resolution.height) + bitrate;
  };

  const buildQualityOptions = (fileInfo, fallbackPlaylistUrl = '') => {
    const qualityInfo = Array.isArray(fileInfo?.quality_info)
      ? fileInfo.quality_info.filter((entry) => entry?.file)
      : [];

    const normalizedOptions = qualityInfo
      .map((entry) => normalizeQualityOption(entry))
      .filter((entry) => entry.file);

    if (normalizedOptions.length === 0) {
      const fallbackFile = String(fileInfo?.file || fallbackPlaylistUrl || '').trim();
      return fallbackFile ? [normalizeQualityOption({
        label: '기본 화질',
        file: fallbackFile,
        resolution: fileInfo?.resolution || '',
        bitrate: fileInfo?.bitrate || '',
        name: fileInfo?.name || ''
      })] : [];
    }

    return normalizedOptions.sort((left, right) => scoreQualityOption(right) - scoreQualityOption(left));
  };

  const getFileInfoUrls = (fileInfo) => {
    return [
      fileInfo?.file,
      ...(Array.isArray(fileInfo?.quality_info) ? fileInfo.quality_info.map((entry) => entry?.file) : [])
    ]
      .map((url) => normalizeComparableUrl(url))
      .filter(Boolean);
  };

  const findMatchingFileInfo = (files) => {
    const selectedQualityUrl = normalizeComparableUrl(job.selectedQuality?.file || '');
    const playlistUrl = normalizeComparableUrl(job.playlistUrl || '');

    if (selectedQualityUrl) {
      const byQualityUrl = files.find((fileInfo) => getFileInfoUrls(fileInfo).includes(selectedQualityUrl));
      if (byQualityUrl) {
        return byQualityUrl;
      }
    }

    if (playlistUrl) {
      const byPlaylistUrl = files.find((fileInfo) => getFileInfoUrls(fileInfo).includes(playlistUrl));
      if (byPlaylistUrl) {
        return byPlaylistUrl;
      }
    }

    return files[Math.min(job.partIndex, files.length - 1)] || files[0] || null;
  };

  const chooseQualityInfo = (fileInfo) => {
    const qualityOptions = buildQualityOptions(fileInfo, job.selectedQuality?.file || job.playlistUrl || '');
    const selectedQualityUrl = normalizeComparableUrl(job.selectedQuality?.file || '');

    if (selectedQualityUrl) {
      const matchedQuality = qualityOptions.find((entry) => normalizeComparableUrl(entry.file) === selectedQualityUrl);
      if (matchedQuality) {
        return matchedQuality;
      }
    }

    if (job.selectedQuality?.file) {
      return normalizeQualityOption(job.selectedQuality, { file: job.selectedQuality.file });
    }

    return qualityOptions[0] || null;
  };

  const parseVariantBitrate = (variant) => {
    const infoLine = String(variant?.infoLine || '');
    const averageBandwidth = infoLine.match(/AVERAGE-BANDWIDTH=(\d+)/i);
    const bandwidth = infoLine.match(/BANDWIDTH=(\d+)/i);
    return averageBandwidth ? Number(averageBandwidth[1]) : bandwidth ? Number(bandwidth[1]) : 0;
  };

  const chooseVariantForQuality = (variants, preferredQuality) => {
    const sortedVariants = [...variants].sort((left, right) => parseVariantScore(right) - parseVariantScore(left));
    if (!preferredQuality) {
      return sortedVariants[0] || null;
    }

    const preferredUrl = normalizeComparableUrl(preferredQuality.file);
    if (preferredUrl) {
      const exactUrlMatch = sortedVariants.find((variant) => normalizeComparableUrl(variant.url) === preferredUrl);
      if (exactUrlMatch) {
        return exactUrlMatch;
      }
    }

    const preferredResolution = parseResolutionInfo(preferredQuality.resolution);
    let candidates = sortedVariants;

    if (preferredResolution.width > 0 && preferredResolution.height > 0) {
      const resolutionMatches = sortedVariants.filter((variant) => {
        const variantResolution = parseResolutionInfo(String(variant.infoLine || '').match(/RESOLUTION=([^,]+)/i)?.[1] || '');
        return variantResolution.width === preferredResolution.width && variantResolution.height === preferredResolution.height;
      });

      if (resolutionMatches.length > 0) {
        candidates = resolutionMatches;
      }
    }

    const preferredBitrate = parseBitrateValue(preferredQuality.bitrate);
    if (preferredBitrate > 0 && candidates.length > 1) {
      candidates = [...candidates].sort((left, right) => {
        return Math.abs(parseVariantBitrate(left) - preferredBitrate) - Math.abs(parseVariantBitrate(right) - preferredBitrate);
      });
    }

    return candidates[0] || sortedVariants[0] || null;
  };

  const ensureAuthorized = async (authContext, signal) => {
    const authPayload = await postFormJson('https://live.sooplive.com/api/private_auth.php', {
      type: 'vod',
      strm_id: authContext.bjId,
      title_no: authContext.titleNo,
      url: authContext.manifestUrl
    }, signal);

    if (authPayload?.result !== 1) {
      throw new Error('재생 인증에 실패했습니다.');
    }

    if (authPayload?.data?.signed_cookie) {
      applySignedCookies(authContext.manifestUrl, authPayload.data.signed_cookie);
    }

    return authPayload;
  };

  const fetchWithReauth = async (url, authContext, signal, attempt = 0) => {
    const response = await fetch(url, {
      credentials: 'include',
      cache: 'no-store',
      signal
    });

    if ((response.status === 401 || response.status === 403) && attempt < 2) {
      await ensureAuthorized(authContext, signal);
      return fetchWithReauth(url, authContext, signal, attempt + 1);
    }

    if (!response.ok) {
      throw new Error(`다운로드 요청 실패 (${response.status})`);
    }

    return response;
  };

  const fetchManifestWithOptionalAuth = async (authContext, signal) => {
    const directResponse = await fetch(authContext.manifestUrl, {
      credentials: 'include',
      cache: 'no-store'
    });

    if (directResponse.ok) {
      return directResponse;
    }

    if (directResponse.status !== 401 && directResponse.status !== 403 && job.accessType !== 'subscription_plus') {
      throw new Error(`재생 목록을 불러오지 못했습니다. (${directResponse.status})`);
    }

    await ensureAuthorized(authContext, signal);
    return fetchWithReauth(authContext.manifestUrl, authContext, signal);
  };

  const resolveClipRangeForDuration = (sourceDuration) => {
    const totalSeconds = Math.max(0, Number(sourceDuration || 0));
    const requestedStart = Math.max(0, Number(job.clipStartSeconds || 0));
    const requestedEnd = Number.isFinite(Number(job.clipEndSeconds)) && Number(job.clipEndSeconds) > 0
      ? Number(job.clipEndSeconds)
      : null;

    if (!requestedStart && !requestedEnd) {
      return {
        active: false,
        startSeconds: 0,
        endSeconds: totalSeconds,
        label: ''
      };
    }

    if (totalSeconds <= 0) {
      throw new Error('구간 저장에 필요한 영상 길이를 계산하지 못했습니다.');
    }

    if (requestedStart >= totalSeconds) {
      throw new Error(`시작 시간이 영상 길이(${formatDuration(totalSeconds)})보다 뒤입니다.`);
    }

    const endSeconds = requestedEnd ? Math.min(requestedEnd, totalSeconds) : totalSeconds;
    if (endSeconds <= requestedStart) {
      throw new Error('종료 시간은 시작 시간보다 뒤여야 합니다.');
    }

    return {
      active: true,
      startSeconds: requestedStart,
      endSeconds,
      label: job.clipLabel || `${formatDuration(requestedStart)}부터 ${formatDuration(endSeconds)}까지`
    };
  };

  const filterSegmentsByClipRange = (segments, clipRange) => {
    if (!clipRange?.active) {
      return segments;
    }

    let cursor = 0;
    return segments.filter((segment) => {
      const duration = Math.max(0, Number(segment.duration || 0));
      const segmentStart = cursor;
      const segmentEnd = cursor + duration;
      cursor = segmentEnd;
      return segmentEnd > clipRange.startSeconds && segmentStart < clipRange.endSeconds;
    });
  };

  const buildOverlay = () => {
    ensureStyle();
    removeExistingOverlay();

    const overlay = document.createElement('aside');
    overlay.id = overlayId;
    overlay.innerHTML = `
      <div class="soop-direct-header">
        <div class="soop-direct-title">${job.downloadLabel}</div>
        <button type="button" class="soop-direct-close" aria-label="닫기">×</button>
      </div>
      <div class="soop-direct-subtitle"></div>
      <div class="soop-direct-status"></div>
      <div class="soop-direct-detail"></div>
      <div class="soop-direct-progress"><div class="soop-direct-progress-bar"></div></div>
      <div class="soop-direct-actions">
        <button type="button" class="soop-direct-start">저장 위치 선택 후 시작</button>
        <button type="button" class="soop-direct-cancel">닫기</button>
      </div>
    `;

    document.body.appendChild(overlay);
    return overlay;
  };

  const overlay = buildOverlay();
  const subtitleEl = overlay.querySelector('.soop-direct-subtitle');
  const statusEl = overlay.querySelector('.soop-direct-status');
  const detailEl = overlay.querySelector('.soop-direct-detail');
  const progressBarEl = overlay.querySelector('.soop-direct-progress-bar');
  const startButton = overlay.querySelector('.soop-direct-start');
  const cancelButton = overlay.querySelector('.soop-direct-cancel');
  const closeButton = overlay.querySelector('.soop-direct-close');
  let lastProgressPercent = 0;

  const updateUi = ({ status, detail, percent, running, finished, failed }) => {
    const rangeSuffix = job.clipLabel ? ` · ${job.clipLabel}` : '';
    subtitleEl.textContent = (job.mergeParts && job.totalParts > 1
      ? `${job.totalParts}개 파트를 이어서 하나의 파일로 저장합니다.`
      : job.totalParts > 1
        ? `${job.partNumber}/${job.totalParts} 파트 · 저장 위치 선택 후 시작하세요.`
        : '저장 위치 선택 후 시작하세요.') + rangeSuffix;
    statusEl.textContent = status || '준비되었습니다.';
    detailEl.textContent = detail || '';
    if (Number.isFinite(Number(percent))) {
      lastProgressPercent = Math.max(0, Math.min(100, Number(percent)));
    }
    progressBarEl.style.width = `${lastProgressPercent}%`;
    startButton.disabled = Boolean(running);
    closeButton.disabled = Boolean(running);
    cancelButton.textContent = running ? '취소' : (finished ? '닫기' : failed ? '닫기' : '닫기');
    startButton.textContent = running
      ? '다운로드 진행 중...'
      : finished
        ? '다시 다운로드'
        : failed
          ? '다시 시도'
          : '저장 위치 선택 후 시작';
  };

  const cleanupOverlay = () => {
    if (window[stateKey]?.busy) {
      return;
    }
    delete window[stateKey];
    overlay.remove();
  };

  const startDownload = async () => {
    if (!('showSaveFilePicker' in window)) {
      updateUi({
        status: '이 브라우저에서는 직접 저장을 지원하지 않습니다.',
        detail: '최신 크롬 브라우저에서 다시 시도해주세요.',
        percent: 0,
        failed: true
      });
      return;
    }

    let writable = null;
    const signal = undefined;
    let totalSegments = 0;
    let totalDuration = 0;
    let writtenBytes = 0;
    let writtenDuration = 0;
    let nextSegmentToWrite = 0;
    let flushCompletedSegments = async () => {};

    window[stateKey] = {
      busy: true,
      cancelRequested: false,
      overlay
    };

    try {
      updateUi({
        status: '영상 정보를 확인하는 중...',
        detail: 'SOOP 플레이어 인증 정보를 불러오고 있습니다.',
        percent: 2,
        running: true
      });

      const titleNo = job.titleNo || extractTitleNo();
      if (!titleNo) {
        throw new Error('현재 페이지에서 영상 번호를 찾을 수 없습니다.');
      }

      const viewPayload = await postFormJson('https://api.m.sooplive.com/station/video/a/view', {
        nTitleNo: titleNo,
        nApiLevel: '11',
        nPlaylistIdx: '0'
      }, signal);

      if (viewPayload?.result !== 1 || !viewPayload?.data) {
        throw new Error('영상 정보 조회에 실패했습니다.');
      }

      const videoData = viewPayload.data;
      const fileInfo = Array.isArray(videoData.files) && videoData.files.length > 0
        ? findMatchingFileInfo(videoData.files)
        : null;
      const selectedQuality = fileInfo
        ? chooseQualityInfo(fileInfo)
        : job.selectedQuality?.file
          ? normalizeQualityOption(job.selectedQuality, { file: job.selectedQuality.file })
          : null;
      const manifestUrls = job.playlistUrls.length > 0 && !job.selectedQuality?.file
        ? job.playlistUrls
        : [job.selectedQuality?.file || selectedQuality?.file || job.playlistUrl || fileInfo?.file].filter(Boolean);

      if (manifestUrls.length === 0) {
        throw new Error('재생용 m3u8 주소를 찾을 수 없습니다.');
      }

      const baseAuthContext = {
        bjId: job.bjId || videoData.bj_id || videoData.writer_id || '',
        titleNo
      };

      if (!baseAuthContext.bjId) {
        throw new Error('BJ 식별자를 찾을 수 없습니다.');
      }

      const parsedParts = [];
      let initSegmentContext = null;

      for (const sourceManifestUrl of manifestUrls) {
        let manifestUrl = sourceManifestUrl;
        const authContext = {
          ...baseAuthContext,
          manifestUrl
        };

        let manifestResponse = await fetchManifestWithOptionalAuth(authContext, signal);
        let manifestText = await manifestResponse.text();
        let parsedManifest = parseM3u8(manifestText, manifestUrl);

        if (parsedManifest.variants.length > 0) {
          const chosenVariant = chooseVariantForQuality(parsedManifest.variants, selectedQuality);
          if (!chosenVariant?.url) {
            throw new Error('선택한 화질의 재생 목록을 찾지 못했습니다.');
          }

          const audioEntries = chosenVariant?.audioGroupId
            ? (parsedManifest.audioGroups.get(chosenVariant.audioGroupId) || [])
            : [];
          const externalAudioEntry = audioEntries.find((entry) => entry.isDefault && entry.uri) || audioEntries.find((entry) => entry.uri);
          if (externalAudioEntry?.uri) {
            throw new Error('이 영상은 오디오가 별도 트랙으로 제공됩니다. 브라우저 직접 저장은 무음 파일이 될 수 있어 중단했습니다. M3U8 백업 또는 ffmpeg CMD로 저장해주세요.');
          }

          manifestUrl = chosenVariant.url;
          authContext.manifestUrl = manifestUrl;
          manifestResponse = await fetchManifestWithOptionalAuth(authContext, signal);
          manifestText = await manifestResponse.text();
          parsedManifest = parseM3u8(manifestText, manifestUrl);
        }

        if (parsedManifest.segments.length === 0) {
          throw new Error('세그먼트 목록을 찾지 못했습니다.');
        }

        if (!initSegmentContext && parsedManifest.initSegmentUrl) {
          initSegmentContext = {
            url: parsedManifest.initSegmentUrl,
            authContext: { ...authContext }
          };
        }

        parsedParts.push({
          authContext: { ...authContext },
          parsedManifest
        });
      }

      const allSegments = parsedParts.flatMap((entry) => entry.parsedManifest.segments.map((segment) => ({
        ...segment,
        authContext: entry.authContext
      })));

      const sourceDuration = allSegments.reduce((sum, segment) => sum + (Number(segment.duration || 0)), 0);
      const clipRange = resolveClipRangeForDuration(sourceDuration);
      const combinedSegments = filterSegmentsByClipRange(allSegments, clipRange);
      if (combinedSegments.length === 0) {
        throw new Error('선택한 시간 구간에 포함되는 세그먼트가 없습니다.');
      }

      totalSegments = combinedSegments.length;
      const segmentConcurrency = Math.min(
        6,
        Math.max(
          2,
          Math.min(
            totalSegments,
            Math.floor(Number(window.navigator?.hardwareConcurrency || 8) / 2)
          )
        )
      );
      totalDuration = combinedSegments.reduce((sum, segment) => sum + (Number(segment.duration || 0)), 0);
      const usesFragmentedMp4 = parsedParts.some((entry) => entry.parsedManifest.usesFragmentedMp4);
      const hasDiscontinuity = parsedParts.some((entry) => entry.parsedManifest.hasDiscontinuity);

      if (hasDiscontinuity) {
        throw new Error('이 영상은 세그먼트 타임스탬프가 중간에 끊깁니다. 브라우저 직접 저장은 싱크가 밀릴 수 있어 중단했습니다. M3U8 백업 또는 ffmpeg CMD로 저장해주세요.');
      }

      const outputProfile = usesFragmentedMp4
        ? {
          extension: 'mp4',
          description: 'MP4 Video',
          mimeType: 'video/mp4',
          detailLabel: 'fMP4'
        }
        : {
          extension: 'ts',
          description: 'MPEG-TS Video',
          mimeType: 'video/mp2t',
          detailLabel: 'MPEG-TS'
        };
      const suggestedName = `${sanitizeFileName(job.title)}.${outputProfile.extension}`;
      const fileHandle = await window.showSaveFilePicker({
        suggestedName,
        types: [
          {
            description: outputProfile.description,
            accept: {
              [outputProfile.mimeType]: [`.${outputProfile.extension}`]
            }
          }
        ]
      });

      writable = await fileHandle.createWritable();

      const qualitySummary = selectedQuality?.displayLabel || [
        selectedQuality?.label || '',
        selectedQuality?.resolution || '',
        selectedQuality?.bitrate || ''
      ].filter(Boolean).join(' / ');

      updateUi({
        status: '다운로드를 시작합니다...',
        detail: `${qualitySummary || '기본 화질'} · ${clipRange.active ? `${clipRange.label} · ` : ''}${outputProfile.detailLabel} · 세그먼트 ${totalSegments}개 · 동시 다운로드 ${segmentConcurrency}개`,
        percent: 4,
        running: true
      });

      if (initSegmentContext?.url) {
        const initResponse = await fetchWithReauth(initSegmentContext.url, initSegmentContext.authContext, signal);
        const initChunk = await initResponse.arrayBuffer();
        await writable.write(initChunk);
        writtenBytes += initChunk.byteLength;
      }

      const completedSegments = new Map();
      let nextSegmentToFetch = 0;
      let writeChain = Promise.resolve();

      flushCompletedSegments = () => {
        writeChain = writeChain.then(async () => {
          while (completedSegments.has(nextSegmentToWrite)) {
            const completed = completedSegments.get(nextSegmentToWrite);
            completedSegments.delete(nextSegmentToWrite);

            await writable.write(completed.chunk);

            writtenBytes += completed.size;
            writtenDuration += completed.duration;
            nextSegmentToWrite += 1;

            updateUi({
              status: `세그먼트 저장 중... (${nextSegmentToWrite}/${totalSegments})`,
              detail: `${formatDuration(writtenDuration)} / ${formatDuration(totalDuration)} · ${formatBytes(writtenBytes)}`,
              percent: 4 + ((nextSegmentToWrite / totalSegments) * 96),
              running: true
            });
          }
        });

        return writeChain;
      };

      const downloadWorker = async () => {
        while (true) {
          if (window[stateKey]?.cancelRequested) {
            return;
          }

          const currentIndex = nextSegmentToFetch;
          nextSegmentToFetch += 1;

          if (currentIndex >= totalSegments) {
            return;
          }

          const segment = combinedSegments[currentIndex];
          const segmentResponse = await fetchWithReauth(segment.url, segment.authContext, signal);
          const segmentChunk = await segmentResponse.arrayBuffer();

          completedSegments.set(currentIndex, {
            chunk: segmentChunk,
            size: segmentChunk.byteLength,
            duration: Number(segment.duration || 0)
          });

          await flushCompletedSegments();
        }
      };

      await Promise.all(
        Array.from({ length: segmentConcurrency }, () => downloadWorker())
      );
      await writeChain;

      const wasCancelled = Boolean(window[stateKey]?.cancelRequested);

      await writable.close();
      writable = null;

      window[stateKey] = {
        busy: false,
        cancelRequested: false,
        overlay
      };

      if (wasCancelled) {
        updateUi({
          status: '취소 요청에 따라 현재까지 받은 구간만 저장했습니다.',
          detail: `${nextSegmentToWrite}개 세그먼트 · ${formatDuration(writtenDuration)} · ${formatBytes(writtenBytes)} 저장 완료`,
          percent: lastProgressPercent,
          finished: true
        });
      } else {
        updateUi({
        status: `${job.downloadLabel}가 완료되었습니다.`,
        detail: `${formatBytes(writtenBytes)} 저장 완료`,
        percent: 100,
        finished: true
        });
      }
    } catch (error) {
      const wasCancelled = Boolean(window[stateKey]?.cancelRequested);

      if (writable) {
        try {
          await flushCompletedSegments();

          if (wasCancelled && nextSegmentToWrite > 0) {
            await writable.close();
            writable = null;
          } else {
            await writable.abort();
            writable = null;
          }
        } catch (abortError) {
          // Ignore abort failures and surface the original error instead.
        }
      }

      window[stateKey] = {
        busy: false,
        cancelRequested: false,
        overlay
      };

      const message = wasCancelled
        ? (nextSegmentToWrite > 0
          ? `현재까지 받은 ${nextSegmentToWrite}개 세그먼트를 저장했습니다.`
          : '아직 저장된 구간이 없어 파일을 남기지 않았습니다.')
        : error?.name === 'AbortError'
          ? '사용자가 다운로드를 취소했습니다.'
        : error?.message || '다운로드 중 알 수 없는 오류가 발생했습니다.';

      updateUi({
        status: wasCancelled && nextSegmentToWrite > 0
          ? '부분 저장 후 다운로드를 중단했습니다.'
          : `${job.downloadLabel}가 중단되었습니다.`,
        detail: message,
        percent: wasCancelled && nextSegmentToWrite > 0 ? lastProgressPercent : 0,
        failed: !wasCancelled || nextSegmentToWrite === 0,
        finished: wasCancelled && nextSegmentToWrite > 0
      });
    }
  };

  updateUi({
    status: '직접 저장 준비 완료',
    detail: job.clipLabel
      ? `${job.clipLabel} 구간만 SOOP 페이지 안에서 바로 받습니다.`
      : '저장 위치를 고른 뒤 SOOP 페이지 안에서 바로 세그먼트를 받습니다.',
    percent: 0
  });

  startButton.addEventListener('click', () => {
    startDownload();
  });

  cancelButton.addEventListener('click', () => {
    const currentState = window[stateKey];
    if (currentState?.busy) {
      currentState.cancelRequested = true;
      updateUi({
        status: '중지 요청을 처리하는 중...',
        detail: '현재 받고 있는 조각까지만 정리해서 파일을 마무리합니다.',
        percent: lastProgressPercent,
        running: true
      });
      return;
    }
    cleanupOverlay();
  });

  closeButton.addEventListener('click', () => {
    cleanupOverlay();
  });

  window[stateKey] = {
    busy: false,
    cancelRequested: false,
    overlay
  };

  return {
    ok: true,
    message: '페이지에 브라우저 다운로드 패널을 표시했습니다.'
  };
}

function handleFfmpegCopy() {
  const btn = document.getElementById('copy-ffmpeg');
  btn.disabled = true;

  if (latestVideoInfo && latestPartItems.length > 0) {
    const firstPart = latestPartItems[0];
    const { qualityOptions } = getPartQualityOptions(latestVideoInfo, firstPart, 0);
    const qualitySelect = document.querySelector('.quality-select[data-part-index="0"]');
    const clipStartInput = document.querySelector('.clip-start-input[data-part-index="0"]');
    const clipEndInput = document.querySelector('.clip-end-input[data-part-index="0"]');
    const selectedQuality = getSelectedQualityOption(qualitySelect, qualityOptions) || qualityOptions[0] || null;
    const clipRange = buildClipRangeConfig(clipStartInput?.value, clipEndInput?.value);
    const playlistUrl = selectedQuality?.file || firstPart?.playlistUrl || null;

    if (!clipRange.ok) {
      alert(clipRange.message);
      btn.disabled = false;
      return;
    }

    if (playlistUrl) {
      const baseTitle = buildPartDisplayTitle(latestVideoInfo?.title || '현재 영상', 0, latestPartItems.length);
      const outputTitle = buildClipRangeTitle(buildQualityTitle(baseTitle, selectedQuality, qualityOptions.length), clipRange);
      const cmd = buildFfmpegCommand(playlistUrl, outputTitle, clipRange);

      copyToClipboard(cmd)
        .then(() => {
          alert(`ffmpeg 명령어가 클립보드에 복사되었습니다.\n\n선택 화질: ${selectedQuality?.displayLabel || '기본 화질'}\n구간: ${clipRange.active ? clipRange.label : '전체'}\n저장 위치: Downloads 폴더 (MKV)\n\nCMD(명령 프롬프트)를 열고 붙여넣기 하여 실행하세요.`);
        })
        .catch((error) => {
          console.error('클립보드 복사 실패:', error);
          alert('클립보드 복사에 실패했습니다.');
        });

      setTimeout(() => {
        btn.disabled = false;
      }, 1000);
      return;
    }
  }

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
            const cmd1 = buildFfmpegCommand(playlistUrl, title);
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

async function handleOpenChatSettings() {
  const button = document.getElementById('open-chat-settings');
  const originalMarkup = button.innerHTML;

  try {
    button.disabled = true;
    button.textContent = '로딩...';

    const videoInfo = await executeInActiveTab(extractVideoInfo);
    if (videoInfo?.error) {
      throw new Error(videoInfo.error);
    }

    const durationSeconds = Math.max(0, Math.ceil(Number(videoInfo?.durationSeconds || 0)));
    const parts = await resolveVideoParts(videoInfo, durationSeconds);
    const activePartInfo = getActivePartForTime(parts, Number(videoInfo?.currentTimeSeconds || 0));
    const chatRowKey = activePartInfo?.part?.chatRowKey || videoInfo?.chatRowKey || null;
    const previewStartTime = chatRowKey
      ? Math.max(0, Math.floor(Number(activePartInfo?.localTimeSeconds || 0) / Math.max(1, Number(videoInfo?.chatSegmentDuration || 300))) * Math.max(1, Number(videoInfo?.chatSegmentDuration || 300)))
      : 0;
    let previewSampleChats = [];

    if (chatRowKey) {
      const previewSegment = await executeInActiveTab(fetchParsedChatSegment, [chatRowKey, previewStartTime]);
      if (previewSegment?.ok && Array.isArray(previewSegment.chats)) {
        previewSampleChats = previewSegment.chats
          .slice(0, 20)
          .map((chat, index) => normalizeFetchedChat(chat, index));
      }
    }

    saveChatAssPreviewContext({
      title: videoInfo?.title || 'SOOP VOD',
      pageUrl: videoInfo?.pageUrl || '',
      durationSeconds: Number(videoInfo?.durationSeconds || 0),
      currentTimeSeconds: Number(videoInfo?.currentTimeSeconds || 0),
      chatRowKey: chatRowKey,
      chatSegmentDuration: Number(videoInfo?.chatSegmentDuration || 300),
      thumbnailUrl: videoInfo?.thumbnailUrl || null,
      previewSampleChats,
      timestamp: new Date().toISOString()
    });

    chrome.tabs.create({ url: chrome.runtime.getURL('chat-settings.html') });
  } catch (error) {
    console.error('채팅 설정 페이지 열기 오류:', error);
    alert(`채팅 설정 페이지를 열지 못했습니다: ${error.message}`);
  } finally {
    button.disabled = false;
    button.innerHTML = originalMarkup;
  }
}

async function handleChatAssDownload() {
  const btn = document.getElementById('download-chat-ass');
  const originalMarkup = btn.innerHTML;

  try {
    btn.disabled = true;
    btn.textContent = '채팅 정보 확인 중...';

    const videoInfo = await executeInActiveTab(extractVideoInfo);
    if (videoInfo?.error) {
      throw new Error(videoInfo.error);
    }

    const durationSeconds = Math.max(0, Math.ceil(Number(videoInfo?.durationSeconds || 0)));
    const chatSegmentDuration = Math.max(1, Number(videoInfo?.chatSegmentDuration || 300));

    if (!durationSeconds) {
      throw new Error('영상 길이를 확인하지 못했습니다.');
    }

    btn.textContent = 'ASS 자막 조합 중...';
    const chatSettings = loadChatAssSettings();
    const parts = await resolveVideoParts(videoInfo, durationSeconds);
    const downloads = [];

    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (!part.chatRowKey) {
        continue;
      }

      btn.textContent = parts.length > 1
        ? `채팅 수집 중 (파트 ${index + 1}/${parts.length})`
        : '채팅 수집 중...';

      const partChats = await fetchAllChatMessages(part.chatRowKey, Math.max(1, Number(part.durationSeconds || 0)), chatSegmentDuration, (current, total) => {
        btn.textContent = parts.length > 1
          ? `채팅 수집 중 (파트 ${index + 1}/${parts.length}, ${current}/${total})`
          : `채팅 수집 중 (${current}/${total})`;
      });

      if (partChats.length === 0) {
        continue;
      }

      btn.textContent = parts.length > 1
        ? `ASS 자막 조합 중 (파트 ${index + 1}/${parts.length})`
        : 'ASS 자막 조합 중...';

      const assContent = buildChatAssSubtitle({
        title: part.displayName,
        pageUrl: videoInfo?.pageUrl || '',
        rowKey: part.chatRowKey,
        durationSeconds: Math.max(1, Number(part.durationSeconds || 0)),
        chats: partChats,
        settings: chatSettings
      });
      const filename = `${part.baseName}.ass`;
      downloadTextFile(assContent, filename, 'text/x-ass;charset=utf-8');
      downloads.push({ filename, chatCount: partChats.length });
      await new Promise((resolve) => setTimeout(resolve, 120));
    }

    if (downloads.length === 0) {
      throw new Error('다운로드 가능한 파트 채팅을 찾지 못했습니다.');
    }

    const summary = downloads
      .map((download) => `${download.filename} (${download.chatCount.toLocaleString()}개)`)
      .join('\n');

    alert(`채팅 ASS 자막이 저장되었습니다!\n\n${summary}\n\n영상 파트 이름과 같은 파일명으로 저장했습니다.`);
  } catch (error) {
    console.error('채팅 ASS 다운로드 오류:', error);
    alert(`채팅 ASS 자막 생성에 실패했습니다: ${error.message}`);
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalMarkup;
  }
}

function sanitizeTitle(title) {
  let sanitizedTitle = '';
  if (title && title.trim()) {
    sanitizedTitle = title.replace(/[\/\\:\\*?"<>|]/g, '').trim();
    sanitizedTitle = sanitizedTitle.replace(/[^a-zA-Z0-9가-힣\s\-]/g, '').trim();
    sanitizedTitle = sanitizedTitle.replace(/\s+/g, ' ');
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

async function fetchAllChatMessages(rowKey, durationSeconds, segmentDuration = 300, onProgress) {
  const chats = [];
  const seen = new Set();
  let start = 0;
  let requestCount = 0;
  let maxChatTime = -1;
  const maxRequests = Math.max(4, Math.ceil(durationSeconds / Math.max(1, segmentDuration)) + 6);

  while (requestCount < maxRequests) {
    if (typeof onProgress === 'function') {
      onProgress(requestCount + 1, maxRequests, start);
    }

    const segmentResult = await executeInActiveTab(fetchParsedChatSegment, [rowKey, start]);

    if (!segmentResult?.ok) {
      if (segmentResult?.status === 404 && start > 0) {
        break;
      }
      throw new Error(segmentResult?.error || `채팅 ${start}초 구간 요청 실패`);
    }

    const segmentChats = Array.isArray(segmentResult.chats) ? segmentResult.chats : [];
    let segmentMaxTime = -1;

    for (const chat of segmentChats) {
      const normalizedChat = normalizeFetchedChat(chat, chats.length);
      const dedupeKey = `${normalizedChat.time.toFixed(3)}|${normalizedChat.userId}|${normalizedChat.message}`;
      if (!seen.has(dedupeKey)) {
        seen.add(dedupeKey);
        chats.push(normalizedChat);
      }
      if (normalizedChat.time > segmentMaxTime) {
        segmentMaxTime = normalizedChat.time;
      }
    }

    if (segmentMaxTime > maxChatTime) {
      maxChatTime = segmentMaxTime;
    }

    const nextStartByWindow = start + segmentDuration;
    const nextStartByChat = maxChatTime >= 0
      ? (Math.floor(maxChatTime / segmentDuration) + 1) * segmentDuration
      : nextStartByWindow;
    const nextStart = Math.max(nextStartByWindow, nextStartByChat);

    requestCount += 1;

    if (nextStart <= start) {
      break;
    }

    if (start >= durationSeconds && segmentChats.length === 0) {
      break;
    }

    if (nextStart > durationSeconds + segmentDuration && maxChatTime >= 0 && maxChatTime < durationSeconds) {
      break;
    }

    start = nextStart;
  }

  chats.sort((a, b) => a.time - b.time || a.index - b.index);
  return chats;
}

function normalizeFetchedChat(chat, index = 0) {
  const time = Number.parseFloat(chat?.time ?? 0);
  const message = normalizeChatMessage(chat?.message || '');
  const nickname = String(chat?.nickname || chat?.nickName || '익명').trim() || '익명';

  return {
    time: Number.isFinite(time) ? time : 0,
    index,
    message,
    nickname,
    userId: String(chat?.userId || chat?.realId || chat?.id || '').trim(),
    nickColor: normalizeHexColor(chat?.randomColor || chat?.nickColor || ''),
    role: normalizeChatRole(chat?.role)
  };
}

function normalizeChatRole(role) {
  switch (role) {
    case 'fanclub':
    case 'supporter':
    case 'subscriber':
      return role;
    default:
      return 'normal';
  }
}

function normalizeChatMessage(message) {
  let normalized = String(message || '')
    .replace(/\r?\n+/g, ' ')
    .replace(/\/([^/]+)\//g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalized) {
    normalized = '[이모티콘]';
  }

  return normalized;
}

function normalizeHexColor(colorText) {
  const normalized = String(colorText || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (normalized.length !== 6) {
    return null;
  }
  return normalized;
}

function buildChatAssSubtitle({ title, pageUrl, rowKey, durationSeconds, chats, settings }) {
  const runtimeSettings = resolveChatAssRuntimeSettings(settings || loadChatAssSettings());
  const finalEndTime = formatAssTime(durationSeconds);
  const eventLines = buildChatAssEvents(chats, durationSeconds, runtimeSettings);
  const layout = resolveChatAssLayout(runtimeSettings);
  const safeTitle = String(title || 'SOOP Chat').replace(/\r?\n/g, ' ');
  const safePageUrl = String(pageUrl || '').replace(/\r?\n/g, ' ');
  const safeRowKey = String(rowKey || '').replace(/\r?\n/g, ' ');
  const eventRows = [];

  if (runtimeSettings.showBackdrop) {
    eventRows.push(
      `Dialogue: 0,0:00:00.00,${finalEndTime},ChatBackdrop,,0,0,0,,{\\an7\\pos(${layout.left},${layout.top})\\p1\\bord0\\shad0\\1c&H101010&\\alpha&H${opacityPercentToAssAlpha(runtimeSettings.backdropOpacity)}&}m 0 0 l ${layout.width} 0 ${layout.width} ${layout.height} 0 ${layout.height}`
    );
  }

  if (runtimeSettings.showTitle) {
    eventRows.push(
      `Dialogue: 1,0:00:00.00,${finalEndTime},ChatTitle,,${layout.textMarginL},${layout.textMarginR},${layout.titleMarginV},,${escapeAssText(runtimeSettings.titleText)}`
    );
  }

  return `[Script Info]
Title: ${safeTitle} - Chat Overlay
ScriptType: v4.00+
WrapStyle: 2
ScaledBorderAndShadow: yes
PlayResX: ${CHAT_ASS_RESOLUTION.width}
PlayResY: ${CHAT_ASS_RESOLUTION.height}
YCbCr Matrix: TV.601
; Source: ${safePageUrl}
; ChatRowKey: ${safeRowKey}
; GeneratedAt: ${new Date().toISOString()}

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: ChatTitle,Malgun Gothic,${runtimeSettings.titleFontPixels},&H00FFFFFF,&H000000FF,&H70000000,&H00000000,1,0,0,0,100,100,0,0,1,1.2,0.5,7,0,0,0,1
Style: ChatText,Malgun Gothic,${runtimeSettings.fontPixels},&H00FFFFFF,&H000000FF,&H8C000000,&H00000000,0,0,0,0,100,100,0,0,1,2.2,0.8,7,0,0,0,1
Style: ChatBackdrop,Malgun Gothic,20,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
${eventRows.concat(eventLines).join('\n')}`;
}

function buildChatAssEvents(chats, durationSeconds, settings) {
  const layout = resolveChatAssLayout(settings);
  const updateInterval = Math.max(0.25, Number(settings.updateIntervalSeconds || 0.75));
  const lineLimit = Math.max(3, Number(settings.lineLimitCount || 7));
  const groupedChats = new Map();

  chats.forEach((chat) => {
    const slot = Number((Math.floor(chat.time / updateInterval) * updateInterval).toFixed(2));
    if (!groupedChats.has(slot)) {
      groupedChats.set(slot, []);
    }
    groupedChats.get(slot).push(chat);
  });

  const slots = Array.from(groupedChats.keys()).sort((a, b) => a - b);
  const visibleLines = [];
  const snapshots = [];

  slots.forEach((slot) => {
    const slotChats = groupedChats.get(slot) || [];
    slotChats.forEach((chat) => {
      buildWrappedAssChatLines(chat, settings, layout).forEach((wrappedLine) => {
        visibleLines.push(wrappedLine);
        while (visibleLines.length > lineLimit) {
          visibleLines.shift();
        }
      });
    });

    snapshots.push({
      start: slot,
      text: visibleLines.join('\\N')
    });
  });

  return snapshots.map((snapshot, index) => {
    const nextStart = index + 1 < snapshots.length ? snapshots[index + 1].start : durationSeconds;
    const safeEnd = Math.max(snapshot.start + 0.05, nextStart);
    return `Dialogue: 2,${formatAssTime(snapshot.start)},${formatAssTime(safeEnd)},ChatText,,${layout.textMarginL},${layout.textMarginR},${layout.contentMarginV},,${snapshot.text}`;
  });
}

function resolveChatAssLayout(settings) {
  const left = Math.round((settings.panelLeft / 100) * CHAT_ASS_RESOLUTION.width);
  const top = Math.round((settings.panelTop / 100) * CHAT_ASS_RESOLUTION.height);
  const width = Math.round((settings.panelWidth / 100) * CHAT_ASS_RESOLUTION.width);
  const height = Math.round((settings.panelHeight / 100) * CHAT_ASS_RESOLUTION.height);
  const paddingX = 22;
  const right = Math.max(0, CHAT_ASS_RESOLUTION.width - left - width);
  const contentTop = top + (settings.showTitle ? Math.round(settings.titleFontPixels + 34) : 26);
  const contentWidth = Math.max(120, width - paddingX * 2);

  return {
    left,
    top,
    width,
    height,
    contentWidth,
    textMarginL: left + paddingX,
    textMarginR: right + paddingX,
    titleMarginV: top + 18,
    contentMarginV: contentTop
  };
}

function buildWrappedAssChatLines(chat, settings, layout) {
  const nick = escapeAssText(truncateForDisplay(chat.nickname || '익명', 12));
  const message = escapeAssText(truncateForDisplay(chat.message || '', 120));
  const nickColor = hexToAssBgr(resolveRoleColor(chat.role, settings)) || '7DE3FF';
  const lineUnits = calculateWrapUnits(layout.contentWidth, settings.fontPixels);
  const templatePrefixUnits = measureTextUnits(renderTemplateLine(settings.messageFormat, nick, '').replace(/\{\\[^}]+\}/g, ''));
  const firstLineUnits = Math.max(4, lineUnits - templatePrefixUnits);
  const wrappedSegments = wrapTextByUnits(message, firstLineUnits, lineUnits);
  const nicknameMarkup = `{\\b1\\c&H${nickColor}&}${nick}{\\b0\\c&HFFFFFF&}`;

  return wrappedSegments.map((segment, index) => {
    if (index === 0) {
      return renderTemplateLine(settings.messageFormat, nicknameMarkup, segment);
    }
    return `{\\c&HFFFFFF&}　${segment}`;
  });
}

function calculateWrapUnits(contentWidth, fontPixels) {
  return Math.max(6, Math.floor(contentWidth / Math.max(1, fontPixels * 0.92)));
}

function wrapTextByUnits(text, firstLineUnits, lineUnits) {
  const lines = [];
  let current = '';
  let currentUnits = 0;
  let currentLimit = firstLineUnits;

  Array.from(String(text || '')).forEach((character) => {
    const characterUnits = measureCharacterUnits(character);
    if (current && currentUnits + characterUnits > currentLimit) {
      lines.push(current.trim());
      current = character === ' ' ? '' : character;
      currentUnits = measureTextUnits(current);
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

function measureTextUnits(text) {
  return Array.from(String(text || '')).reduce((total, character) => total + measureCharacterUnits(character), 0);
}

function measureCharacterUnits(character) {
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

function renderTemplateLine(template, nicknameMarkup, messageText) {
  return String(template || '{nickname} {message}')
    .replace(/\{nickname\}/g, nicknameMarkup)
    .replace(/\{message\}/g, messageText)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function resolveRoleColor(role, settings) {
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

function truncateForDisplay(text, limit) {
  const chars = Array.from(String(text || ''));
  if (chars.length <= limit) {
    return chars.join('');
  }
  return `${chars.slice(0, limit - 1).join('')}…`;
}

function escapeAssText(text) {
  return String(text || '')
    .replace(/\\/g, '＼')
    .replace(/\{/g, '｛')
    .replace(/\}/g, '｝')
    .replace(/\r?\n/g, ' ');
}

function hexToAssBgr(hexColor) {
  const normalized = String(hexColor || '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (normalized.length !== 6) {
    return null;
  }
  return `${normalized.slice(4, 6)}${normalized.slice(2, 4)}${normalized.slice(0, 2)}`;
}

function opacityPercentToAssAlpha(opacityPercent) {
  const opacity = Math.max(0, Math.min(100, Number(opacityPercent) || 0));
  const alpha = Math.round(255 - (opacity / 100) * 255);
  return alpha.toString(16).toUpperCase().padStart(2, '0');
}

function formatAssTime(totalSeconds) {
  const totalCentiseconds = Math.max(0, Math.round((Number(totalSeconds) || 0) * 100));
  const hours = Math.floor(totalCentiseconds / 360000);
  const minutes = Math.floor((totalCentiseconds % 360000) / 6000);
  const seconds = Math.floor((totalCentiseconds % 6000) / 100);
  const centiseconds = totalCentiseconds % 100;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(centiseconds).padStart(2, '0')}`;
}

function buildFileTimestamp(date = new Date()) {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${month}${day}_${hours}${minutes}`;
}

async function resolveVideoParts(videoInfo, totalDurationSeconds) {
  const baseTitle = videoInfo?.title || 'SOOP Chat';
  let parts = Array.isArray(videoInfo?.partItems) ? videoInfo.partItems
    .map((part, index) => ({
      index,
      playlistUrl: part.playlistUrl || part.url || part.cmafUrl || null,
      durationSeconds: Number(part.durationSeconds || part.duration || 0),
      fileInfoKey: part.fileInfoKey || deriveFileInfoKeyFromPlaylistUrl(part.playlistUrl || part.url || part.cmafUrl || '')
    }))
    .filter((part) => part.playlistUrl) : [];

  if (parts.length === 0) {
    const uniqueUrls = [...new Set(videoInfo?.playlistUrls || [])];
    parts = uniqueUrls.map((playlistUrl, index) => ({
      index,
      playlistUrl,
      durationSeconds: 0,
      fileInfoKey: deriveFileInfoKeyFromPlaylistUrl(playlistUrl)
    }));
  }

  if (parts.length === 0) {
    return [{
      index: 0,
      playlistUrl: null,
      durationSeconds: totalDurationSeconds,
      fileInfoKey: null,
      chatRowKey: videoInfo?.chatRowKey || null,
      baseName: sanitizeTitle(baseTitle),
      displayName: baseTitle
    }];
  }

  for (const part of parts) {
    if (!part.durationSeconds) {
      part.durationSeconds = await fetchPlaylistDuration(part.playlistUrl);
    }
  }

  return parts.map((part, index) => ({
    ...part,
    durationSeconds: Math.max(1, Math.round(Number(part.durationSeconds || 0))),
    chatRowKey: part.fileInfoKey ? `${part.fileInfoKey}_c` : null,
    baseName: buildPartBaseName(baseTitle, index, parts.length),
    displayName: buildPartDisplayTitle(baseTitle, index, parts.length)
  }));
}

function buildPartBaseName(title, index, total) {
  const baseName = sanitizeTitle(title);
  return sanitizeTitle(buildPartDisplayTitle(baseName, index, total));
}

function deriveFileInfoKeyFromPlaylistUrl(url) {
  const normalizedUrl = String(url || '');
  const match = normalizedUrl.match(/\/spkt\/vod\/(\d{8})\/\d+\/\d+\/REGL_([^\/]+?)\.smil\/manifest\.m3u8/i);
  if (!match) {
    return null;
  }

  return `${match[1]}_${match[2]}`;
}

function getActivePartForTime(parts, currentTimeSeconds) {
  let offset = 0;

  for (const part of parts) {
    const durationSeconds = Math.max(1, Number(part.durationSeconds || 0));
    const end = offset + durationSeconds;
    if (currentTimeSeconds < end) {
      return {
        part,
        localTimeSeconds: Math.max(0, currentTimeSeconds - offset),
        startOffsetSeconds: offset
      };
    }
    offset = end;
  }

  const lastPart = parts[parts.length - 1] || null;
  return lastPart ? {
    part: lastPart,
    localTimeSeconds: Math.max(0, Number(lastPart.durationSeconds || 0) - 1),
    startOffsetSeconds: Math.max(0, offset - Number(lastPart.durationSeconds || 0))
  } : null;
}

async function fetchPlaylistDuration(url, visited = new Set()) {
  if (!url || visited.has(url)) {
    return 0;
  }

  visited.add(url);

  try {
    const response = await fetch(url, { cache: 'no-store' });
    if (!response.ok) {
      return 0;
    }

    const manifestText = await response.text();
    const totalDurationMatch = manifestText.match(/#EXT-X-TOTAL[-_]DURATION:([\d.]+)/i);
    if (totalDurationMatch) {
      return Math.round(Number.parseFloat(totalDurationMatch[1]) || 0);
    }

    const variantMatches = [...manifestText.matchAll(/#EXT-X-STREAM-INF:[^\n]*\n([^\n]+\.m3u8[^\n]*)/g)];
    if (variantMatches.length > 0) {
      const variantUrl = new URL(variantMatches[0][1].trim(), url).href;
      return fetchPlaylistDuration(variantUrl, visited);
    }

    let total = 0;
    for (const match of manifestText.matchAll(/#EXTINF:([\d.]+),/g)) {
      total += Number.parseFloat(match[1]) || 0;
    }

    return Math.round(total);
  } catch (error) {
    return 0;
  }
}

function downloadTextFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType || 'text/plain;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  setTimeout(() => {
    document.body.removeChild(link);
    URL.revokeObjectURL(objectUrl);
  }, 200);
}

function parseClockTextToSeconds(timeText) {
  const parts = String(timeText || '')
    .split(':')
    .map((part) => Number(part));

  if (parts.some((part) => Number.isNaN(part))) {
    return 0;
  }

  if (parts.length === 3) {
    return parts[0] * 3600 + parts[1] * 60 + parts[2];
  }
  if (parts.length === 2) {
    return parts[0] * 60 + parts[1];
  }
  if (parts.length === 1) {
    return parts[0];
  }
  return 0;
}

async function downloadPlaylistFile(playlistUrl, title, selectedQuality = null) {
  try {
    const sourcePlaylistUrl = String(playlistUrl || selectedQuality?.file || '').trim();
    if (!sourcePlaylistUrl) {
      throw new Error('playlist.m3u8 주소를 찾을 수 없습니다.');
    }

    const response = await fetch(sourcePlaylistUrl);
    if (!response.ok) {
      throw new Error('playlist.m3u8 파일 다운로드에 실패했습니다.');
    }

    let playlistContent = await response.text();
    playlistContent = pinMasterPlaylistToSelectedQuality(playlistContent, sourcePlaylistUrl, selectedQuality);
    const qualityLine = selectedQuality?.displayLabel ? `# Quality: ${selectedQuality.displayLabel}` : '';

    const enhancedContent = `# Original URL: ${sourcePlaylistUrl}
# Downloaded from: ${window.location.href}
# Download time: ${new Date().toISOString()}
# Title: ${title || 'Unknown'}
${qualityLine ? `${qualityLine}\n` : ''}
${playlistContent}`;

    const base64Content = btoa(unescape(encodeURIComponent(enhancedContent)));
    const dataUrl = `data:application/vnd.apple.mpegurl;base64,${base64Content}`;

    const sanitizedTitle = sanitizeTitle(title);
    const filename = `${sanitizedTitle}_playlist.m3u8`;

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

async function extractVideoInfo() {
  try {
    const detectAccessTypeFromPlaylistHostsInPage = (urls) => {
      const hosts = (urls || [])
        .map((rawUrl) => {
          try {
            return new URL(String(rawUrl)).hostname.toLowerCase();
          } catch (error) {
            return '';
          }
        })
        .filter(Boolean);

      if (hosts.some((host) => host.includes('vod-archive-sub-kr-cdn'))) {
        return 'subscription_plus';
      }

      if (hosts.some((host) => host.includes('vod-archive-kr-cdn'))) {
        return 'general';
      }

      return null;
    };

    const parseTimeTextToSeconds = (timeText) => {
      const parts = String(timeText || '')
        .split(':')
        .map((part) => Number(part));

      if (parts.some((part) => Number.isNaN(part))) {
        return 0;
      }

      if (parts.length === 3) {
        return parts[0] * 3600 + parts[1] * 60 + parts[2];
      }
      if (parts.length === 2) {
        return parts[0] * 60 + parts[1];
      }
      if (parts.length === 1) {
        return parts[0];
      }
      return 0;
    };

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

    const resources = performance.getEntriesByType('resource');

    // 1. Performance API
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

    const partItems = Array.isArray(window.vodCore?.fileItems)
      ? window.vodCore.fileItems
        .map((item, index) => {
          const playlistUrl = item.cmafUrl || item.url || '';
          const normalizedUrl = playlistUrl.startsWith('//')
            ? `${window.location.protocol}${playlistUrl}`
            : playlistUrl.startsWith('/')
              ? `${window.location.origin}${playlistUrl}`
              : playlistUrl;

          return {
            index,
            playlistUrl: normalizedUrl || null,
            durationSeconds: Math.round(Number(item.duration || 0)) || 0,
            fileInfoKey: item.fileInfoKey || null
          };
        })
        .filter((item) => item.playlistUrl)
      : [];

    const scriptContent = Array.from(document.scripts)
      .map((script) => script.textContent || '')
      .join('\n');

    const timeDisplay = document.querySelector('.time_display');
    const durationText = timeDisplay?.querySelector('.time-duration')?.textContent || "";
    const currentTimeText = timeDisplay?.querySelector('.time-current')?.textContent || "";
    const currentTimeSeconds =
      parseTimeTextToSeconds(currentTimeText) ||
      Math.round(document.querySelector('video')?.currentTime || 0);
    const durationSeconds =
      parseTimeTextToSeconds(durationText) ||
      Math.round(document.querySelector('video')?.duration || 0) ||
      Math.round(window.vodCore?.fileItems?.[0]?.duration || 0);

    const chatCore = window.oChatCore || null;
    const chatRequestUrl = resources
      .map((resource) => resource.name)
      .find((resourceUrl) => resourceUrl.includes('ChatLoadSplit.php')) || null;

    let chatRowKey = null;
    if (chatRequestUrl) {
      try {
        chatRowKey = new URL(chatRequestUrl).searchParams.get('rowKey');
      } catch (error) {
        console.warn('채팅 요청 URL 파싱 실패:', error);
      }
    }

    if (!chatRowKey && chatCore?.preChatItemFileInfoKey) {
      chatRowKey = `${chatCore.preChatItemFileInfoKey}_c`;
    }

    let thumbnailUrl =
      document.querySelector('meta[property="og:image"]')?.content ||
      document.querySelector('meta[name="twitter:image"]')?.content ||
      '';

    if (!thumbnailUrl) {
      const thumbnailMatch = scriptContent.match(/thumbnailUrl\\?":\s*\\?"([^"\\]+(?:\\\/[^"\\]+)*)\\?"/i);
      if (thumbnailMatch) {
        thumbnailUrl = thumbnailMatch[1].replace(/\\\//g, '/');
      }
    }

    const titleNoMatch = window.location.pathname.match(/\/player\/(\d+)/i);
    const titleNo = titleNoMatch ? titleNoMatch[1] : null;
    let bjId =
      window.oChatCore?.szBjId ||
      window.vodCore?.szBjId ||
      window.vodCore?.station?.bj_id ||
      window.vodCore?.station?.user_id ||
      null;
    let accessType = 'unknown';
    let quickview = null;
    let authNo = 0;
    let videoFiles = [];

    const playlistHostAccessType = detectAccessTypeFromPlaylistHostsInPage([
      ...playlistUrls,
      ...partItems.map((item) => item.playlistUrl).filter(Boolean)
    ]);

    if (playlistHostAccessType) {
      accessType = playlistHostAccessType;
    }

    if (titleNo) {
      try {
        const viewResponse = await fetch('https://api.m.sooplive.com/station/video/a/view', {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: new URLSearchParams({
            nTitleNo: titleNo,
            nApiLevel: '11',
            nPlaylistIdx: '0'
          })
        });

        if (viewResponse.ok) {
          const viewPayload = await viewResponse.json();
          quickview = viewPayload?.data?.quickview || null;
          bjId = bjId || viewPayload?.data?.bj_id || viewPayload?.data?.writer_id || null;
          authNo = Number(viewPayload?.data?.auth_no || 0);
          videoFiles = Array.isArray(viewPayload?.data?.files) ? viewPayload.data.files : [];
          titleText = titleText || viewPayload?.data?.title || titleText;

          if (authNo === 107) {
            accessType = 'subscription_plus';
          } else if (authNo === 101) {
            accessType = 'general';
          }
        }
      } catch (error) {
        // Ignore metadata lookup failures and fall back to the default general type.
      }
    }

    return {
      playlistUrls: playlistUrls,
      partItems: partItems,
      title: titleText,
      titleNo: titleNo,
      bjId: bjId,
      authNo: authNo,
      accessType: accessType,
      quickview: quickview,
      videoFiles: videoFiles,
      pageUrl: window.location.href,
      durationText: durationText,
      currentTimeText: currentTimeText,
      currentTimeSeconds: currentTimeSeconds,
      durationSeconds: durationSeconds,
      chatRowKey: chatRowKey,
      chatRequestUrl: chatRequestUrl,
      thumbnailUrl: thumbnailUrl || null,
      chatSegmentDuration: Number(chatCore?.chat_column_duration) || 300,
      timestamp: new Date().toISOString()
    };

  } catch (error) {
    return { playlistUrls: [], title: null, error: error.message };
  }
}

async function fetchParsedChatSegment(rowKey, startTime) {
  try {
    const response = await fetch(
      `https://videoimg.sooplive.com/php/ChatLoadSplit.php?rowKey=${encodeURIComponent(rowKey)}&startTime=${startTime}`,
      { cache: 'no-store' }
    );

    if (!response.ok) {
      return {
        ok: false,
        status: response.status,
        error: `채팅 ${startTime}초 구간 요청 실패 (${response.status})`
      };
    }

    const xmlText = await response.text();
    const xmlDoc = new DOMParser().parseFromString(xmlText, 'text/xml');
    if (xmlDoc.querySelector('parsererror')) {
      return {
        ok: false,
        status: 0,
        error: '채팅 XML 파싱 실패'
      };
    }

    const chatPrototype = window.oChatCore?.chatItemList
      ?.flatMap((item) => item.chats || [])
      .find((chat) => chat?.type === 'chat');
    const ChatConstructor = chatPrototype?.constructor || null;

    const chats = Array.from(xmlDoc.getElementsByTagName('chat')).map((node, index) => {
      let parsedChat = null;

      if (ChatConstructor) {
        try {
          node.szBjId = window.oChatCore?.szBjId || '';
          node.fileType = window.oChatCore?.fileType || '';
          node.copyrightId = window.oChatCore?.copyrightId || '';
          parsedChat = new ChatConstructor(node);
        } catch (error) {
          parsedChat = null;
        }
      }

      const message = parsedChat?.message || node.querySelector('m')?.textContent || '';
      const role = parsedChat?.subscriptionAndTopFan || parsedChat?.subscriptionAndSupporter
        ? 'supporter'
        : parsedChat?.group === 6 || parsedChat?.subscriptionAndFan || parsedChat?.tier
          ? 'subscriber'
          : parsedChat?.group === 3
            ? 'fanclub'
            : 'normal';

      return {
        index,
        time: Number.parseFloat(parsedChat?.time ?? node.querySelector('t')?.textContent ?? '0'),
        nickname: parsedChat?.nickName || node.querySelector('n')?.textContent || '익명',
        message,
        userId: parsedChat?.realId || parsedChat?.id || node.querySelector('u')?.textContent || '',
        randomColor: parsedChat?.randomColor || node.querySelector('nf')?.textContent || '',
        role
      };
    });

    return {
      ok: true,
      status: response.status,
      chats
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      error: error.message
    };
  }
}
