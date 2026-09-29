const PROXY_PORT = 18787;
const PROXY_ORIGIN = `http://127.0.0.1:${PROXY_PORT}`;
const AUTH_REFRESH_FALLBACK_MS = 30000;
const AUTH_REFRESH_MARGIN_MS = 45000;
const FFMPEG_USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

const params = new URLSearchParams(window.location.search);
const job = {
  id: params.get('jobId') || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`),
  title: params.get('title') || 'SOOP_VOD',
  playlistUrl: params.get('playlistUrl') || '',
  selectedQualityFile: params.get('selectedQualityFile') || '',
  qualityLabel: params.get('qualityLabel') || '',
  titleNo: params.get('titleNo') || '',
  bjId: params.get('bjId') || '',
  pageUrl: params.get('pageUrl') || 'https://vod.sooplive.com/',
  sourceTabId: Number(params.get('sourceTabId') || 0),
  sourceUrl: params.get('sourceUrl') || '',
  clipStart: Number(params.get('clipStart') || 0),
  clipEnd: params.get('clipEnd') ? Number(params.get('clipEnd')) : 0
};

const statusEl = document.getElementById('status');
const summaryEl = document.getElementById('summary');
const commandOutputEl = document.getElementById('command-output');
const copyFfmpegButton = document.getElementById('copy-ffmpeg-command');
const copyHelperButton = document.getElementById('copy-helper-command');
const downloadHelperButton = document.getElementById('download-helper');
const stepHelperSaveEl = document.getElementById('step-helper-save');
const stepHelperRunEl = document.getElementById('step-helper-run');
const stepFfmpegEl = document.getElementById('step-ffmpeg');

let refreshTimer = 0;
let proxyWaitTimer = 0;
let controlsBound = false;

function sanitizeFileName(value) {
  return String(value || 'SOOP_VOD')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim() || 'SOOP_VOD';
}

function sanitizeCmdFileName(value) {
  return String(value || '')
    .normalize('NFC')
    .replace(/[\x00-\x1F\x7F]/g, ' ')
    .replace(/[\\/:*?"<>|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
}

function buildCmdOutputFileName() {
  const safeTitle = sanitizeCmdFileName(job.title);
  const meaningfulTitle = safeTitle
    .replace(/\b(?:2160p|1440p|1080p|720p|540p|360p|240p)\b/gi, '')
    .replace(/[._ -]+/g, '');

  if (meaningfulTitle.length >= 2) {
    return safeTitle.slice(0, 120);
  }

  const quality = sanitizeCmdFileName(job.qualityLabel || '').replace(/\s+/g, '_');
  const fallbackParts = ['SOOP', job.titleNo || job.id.slice(0, 8), quality]
    .map((part) => sanitizeCmdFileName(part).replace(/\s+/g, '_'))
    .filter(Boolean);
  return fallbackParts.join('_').slice(0, 120) || 'SOOP_VOD';
}

function setStatus(message, isError = false) {
  statusEl.textContent = message;
  statusEl.classList.toggle('error', Boolean(isError));
}

function setStage(stage) {
  const stepEls = [stepHelperSaveEl, stepHelperRunEl, stepFfmpegEl].filter(Boolean);
  for (const stepEl of stepEls) {
    stepEl.classList.remove('active', 'done');
  }

  if (stage === 'ready') {
    stepHelperSaveEl?.classList.add('done');
    stepHelperRunEl?.classList.add('done');
    stepFfmpegEl?.classList.add('active');
    return;
  }

  if (stage === 'ffmpeg-copied') {
    stepHelperSaveEl?.classList.add('done');
    stepHelperRunEl?.classList.add('done');
    stepFfmpegEl?.classList.add('done');
    return;
  }

  stepHelperSaveEl?.classList.add('active');
  stepHelperRunEl?.classList.add('active');
}

function normalizeSignedCookieHeader(signedCookie) {
  return String(signedCookie || '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => /^CloudFront-[^=]+=/.test(part))
    .join('; ');
}

function parseSignedCookieExpiresAt(signedCookie) {
  const match = String(signedCookie || '').match(/(?:^|;)\s*CloudFront-Policy=([^;]+)/);
  if (!match) {
    return 0;
  }

  try {
    const normalizedPolicy = decodeURIComponent(match[1])
      .replace(/-/g, '+')
      .replace(/_/g, '/');
    const paddedPolicy = normalizedPolicy.padEnd(Math.ceil(normalizedPolicy.length / 4) * 4, '=');
    const policy = JSON.parse(atob(paddedPolicy));
    const epochSeconds = Number(policy?.Statement?.[0]?.Condition?.DateLessThan?.['AWS:EpochTime'] || 0);
    return Number.isFinite(epochSeconds) && epochSeconds > 0 ? epochSeconds * 1000 : 0;
  } catch (error) {
    return 0;
  }
}

async function postFormJson(url, formData) {
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams(formData)
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload) {
    throw new Error(`인증 요청 실패 (${response.status})`);
  }
  return payload;
}

function executeScriptInSourceTab(options) {
  return new Promise((resolve, reject) => {
    chrome.scripting.executeScript(options, (results) => {
      const runtimeError = chrome.runtime.lastError;
      if (runtimeError) {
        reject(new Error(runtimeError.message));
        return;
      }
      resolve(results || []);
    });
  });
}

async function requestPrivateAuthInSourceTab() {
  if (
    !job.sourceTabId
    || typeof chrome === 'undefined'
    || !chrome.scripting?.executeScript
  ) {
    throw new Error('SOOP 원본 탭을 사용할 수 없습니다');
  }

  const authJob = {
    bjId: job.bjId,
    titleNo: job.titleNo,
    playlistUrl: job.playlistUrl
  };
  const injection = async (payload) => {
    const response = await fetch('https://live.sooplive.com/api/private_auth.php', {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: new URLSearchParams({
        type: 'vod',
        strm_id: payload.bjId,
        title_no: payload.titleNo,
        url: payload.playlistUrl
      })
    });
    const text = await response.text();
    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (error) {
      parsed = null;
    }
    return {
      ok: response.ok,
      status: response.status,
      payload: parsed,
      text: text.slice(0, 500)
    };
  };

  const baseOptions = {
    target: { tabId: job.sourceTabId },
    func: injection,
    args: [authJob]
  };
  let results = null;
  try {
    results = await executeScriptInSourceTab({ ...baseOptions, world: 'MAIN' });
  } catch (error) {
    results = await executeScriptInSourceTab(baseOptions);
  }

  const result = results?.[0]?.result;
  if (!result) {
    throw new Error('SOOP 원본 탭에서 인증 결과를 받지 못했습니다');
  }
  if (!result.ok || !result.payload) {
    throw new Error(`SOOP 원본 탭 인증 실패 (${result.status}) ${result.text || ''}`.trim());
  }
  return result.payload;
}

async function checkProxy() {
  const response = await fetch(`${PROXY_ORIGIN}/health`, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error('로컬 프록시가 응답하지 않습니다');
  }
}

async function pushAuthToProxy(signedCookie, expiresAt) {
  const response = await fetch(`${PROXY_ORIGIN}/auth`, {
    method: 'POST',
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: new URLSearchParams({
      jobId: job.id,
      manifestUrl: job.playlistUrl,
      cookie: normalizeSignedCookieHeader(signedCookie),
      userAgent: FFMPEG_USER_AGENT,
      referer: job.pageUrl,
      expiresAt: String(expiresAt || 0)
    })
  });

  if (!response.ok) {
    throw new Error(`로컬 프록시 인증 전달 실패 (${response.status})`);
  }
}

async function refreshAuth() {
  if (!job.playlistUrl || !job.titleNo || !job.bjId) {
    throw new Error('playlistUrl/titleNo/bjId 값이 없습니다');
  }

  let authSource = 'SOOP source tab';
  let payload = null;
  try {
    payload = await requestPrivateAuthInSourceTab();
  } catch (sourceTabError) {
    console.warn('SOOP 원본 탭 인증 실패, 확장 페이지 대체 경로를 시도합니다:', sourceTabError);
    authSource = 'extension fallback';
    payload = await postFormJson('https://live.sooplive.com/api/private_auth.php', {
      type: 'vod',
      strm_id: job.bjId,
      title_no: job.titleNo,
      url: job.playlistUrl
    });
  }

  if (payload?.result !== 1 || !payload?.data?.signed_cookie) {
    const detail = payload?.message || payload?.msg || payload?.error || JSON.stringify(payload || {}).slice(0, 240);
    throw new Error(`private_auth에서 signed_cookie를 받지 못했습니다. ${detail || ''}`.trim());
  }

  const signedCookie = payload.data.signed_cookie;
  const expiresAt = parseSignedCookieExpiresAt(signedCookie);
  await pushAuthToProxy(signedCookie, expiresAt);

  const ttlMs = expiresAt > 0 ? Math.max(0, expiresAt - Date.now()) : 0;
  const nextDelay = ttlMs > AUTH_REFRESH_MARGIN_MS
    ? Math.max(10000, ttlMs - AUTH_REFRESH_MARGIN_MS)
    : AUTH_REFRESH_FALLBACK_MS;

  const sourceLabel = authSource === 'SOOP source tab' ? 'SOOP 원본 탭' : '확장 페이지 대체 경로';
  setStatus(`인증 갱신 완료: ${sourceLabel}\n작업 ID: ${job.id}\n다음 인증 갱신: 약 ${Math.round(nextDelay / 1000)}초 후\nffmpeg가 끝날 때까지 이 탭과 helper 창을 유지하세요.`);
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(() => {
    refreshAuth().catch((error) => {
      setStatus(`인증 갱신 실패: ${error.message}`, true);
      refreshTimer = window.setTimeout(() => refreshAuth().catch(() => {}), AUTH_REFRESH_FALLBACK_MS);
    });
  }, nextDelay);
}

function buildProxyUrl(targetUrl) {
  const proxied = new URL(`${PROXY_ORIGIN}/proxy/${getProxyPathName(targetUrl)}`);
  proxied.searchParams.set('job', job.id);
  proxied.searchParams.set('url', targetUrl);
  if (job.selectedQualityFile && job.selectedQualityFile !== targetUrl) {
    proxied.searchParams.set('variant', job.selectedQualityFile);
  }
  return proxied.toString();
}

function getProxyPathName(targetUrl) {
  try {
    const pathname = new URL(targetUrl).pathname;
    const rawName = pathname.split('/').filter(Boolean).pop() || 'resource';
    const decodedName = decodeURIComponent(rawName);
    const safeName = decodedName.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 120) || 'resource';
    return encodeURIComponent(safeName);
  } catch (error) {
    return 'resource';
  }
}

function buildFfmpegCommand() {
  const outputPath = `%USERPROFILE%\\Downloads\\${buildCmdOutputFileName()}.mkv`;
  const inputUrl = buildProxyUrl(job.playlistUrl);
  const hasStart = Number.isFinite(job.clipStart) && job.clipStart > 0;
  const hasEnd = Number.isFinite(job.clipEnd) && job.clipEnd > 0;
  const beforeInput = hasStart ? `-ss ${Math.round(job.clipStart)} ` : '';
  const afterInput = hasEnd
    ? hasStart
      ? `-t ${Math.max(1, Math.round(job.clipEnd - job.clipStart))} `
      : `-to ${Math.round(job.clipEnd)} `
    : '';
  return `ffmpeg ${beforeInput}-protocol_whitelist "file,http,https,tcp,tls,crypto,data" -allowed_extensions ALL -allowed_segment_extensions ALL -rw_timeout 60000000 -reconnect 1 -reconnect_streamed 1 -reconnect_delay_max 5 -http_persistent 0 -http_multiple 1 -seg_max_retry 8 -i "${inputUrl}" ${afterInput}-map 0:v:0 -map 0:a:0? -dn -c copy "${outputPath}"`;
}

function renderWaitingCommandText() {
  commandOutputEl.value = [
    'ffmpeg 명령은 로컬 프록시 인증이 완료되면 여기에 표시됩니다.',
    '',
    '1. helper 저장 버튼으로 PowerShell helper를 저장하세요.',
    '2. 아래 helper 실행 명령을 CMD 또는 PowerShell에 붙여넣으세요.',
    helperCommand(),
    '3. 이 탭이 helper에 인증을 전달하면 ffmpeg 명령 복사가 활성화됩니다.'
  ].join('\n');
}

async function copyText(text) {
  await navigator.clipboard.writeText(text);
}

function helperScript() {
  return String.raw`param(
  [int]$Port = 18787
)

Add-Type -AssemblyName System.Net.Http

$Source = @"
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;

public sealed class SoopLocalProxy
{
  private sealed class AuthInfo
  {
    public string JobId = "";
    public string Cookie = "";
    public string UserAgent = "";
    public string Referer = "";
    public long ExpiresAt = 0;
  }

  private readonly int port;
  private readonly string prefix;
  private readonly HttpListener listener;
  private readonly HttpClient client;
  private readonly ConcurrentDictionary<string, AuthInfo> authByJob = new ConcurrentDictionary<string, AuthInfo>();
  private readonly ConcurrentDictionary<string, byte> authWaitLogKeys = new ConcurrentDictionary<string, byte>();

  public SoopLocalProxy(int port)
  {
    this.port = port;
    this.prefix = "http://127.0.0.1:" + port + "/";
    this.listener = new HttpListener();
    this.listener.Prefixes.Add(this.prefix);
    this.listener.IgnoreWriteExceptions = true;

    ServicePointManager.DefaultConnectionLimit = Math.Max(ServicePointManager.DefaultConnectionLimit, 128);
    ServicePointManager.Expect100Continue = false;
    ServicePointManager.UseNagleAlgorithm = false;
    int minWorkerThreads;
    int minCompletionPortThreads;
    ThreadPool.GetMinThreads(out minWorkerThreads, out minCompletionPortThreads);
    ThreadPool.SetMinThreads(Math.Max(minWorkerThreads, 64), Math.Max(minCompletionPortThreads, 64));

    HttpClientHandler handler = new HttpClientHandler();
    handler.UseCookies = false;
    handler.AllowAutoRedirect = false;
    try
    {
      System.Reflection.PropertyInfo maxConnections = typeof(HttpClientHandler).GetProperty("MaxConnectionsPerServer");
      if (maxConnections != null)
      {
        maxConnections.SetValue(handler, 128, null);
      }
    }
    catch
    {
    }
    this.client = new HttpClient(handler);
    this.client.Timeout = TimeSpan.FromMinutes(5);
  }

  public void Run()
  {
    this.listener.Start();
    Console.WriteLine("SOOP local proxy listening on " + this.prefix);
    Console.WriteLine("Keep this window open until ffmpeg finishes.");
    Console.WriteLine("Concurrent proxy engine is active.");

    try
    {
      while (this.listener.IsListening)
      {
        HttpListenerContext context = this.listener.GetContext();
        Task.Factory.StartNew(delegate
        {
          this.HandleContext(context);
        });
      }
    }
    finally
    {
      this.client.Dispose();
      this.listener.Close();
    }
  }

  private void HandleContext(HttpListenerContext context)
  {
    HttpListenerRequest request = context.Request;
    string path = request.Url.AbsolutePath;

    try
    {
      if (request.HttpMethod == "OPTIONS")
      {
        SendText(context, 204, "", "text/plain; charset=utf-8");
        return;
      }

      if (path == "/health")
      {
        SendText(context, 200, "ok authJobs=" + this.authByJob.Count, "text/plain; charset=utf-8");
        return;
      }

      if (path == "/auth" && request.HttpMethod == "POST")
      {
        HandleAuth(context);
        return;
      }

      if (path == "/proxy" || path.StartsWith("/proxy/", StringComparison.OrdinalIgnoreCase))
      {
        HandleProxy(context);
        return;
      }

      SendText(context, 404, "not found", "text/plain; charset=utf-8");
    }
    catch (Exception ex)
    {
      try
      {
        SendText(context, 500, ex.Message, "text/plain; charset=utf-8");
      }
      catch
      {
      }
    }
  }

  private void HandleAuth(HttpListenerContext context)
  {
    string body = ReadRequestBody(context.Request);
    Dictionary<string, string> form = ParseForm(body);
    string jobId = GetValue(form, "jobId");
    string cookie = GetValue(form, "cookie");

    if (String.IsNullOrEmpty(jobId) || String.IsNullOrEmpty(cookie))
    {
      SendText(context, 400, "missing jobId or cookie", "text/plain; charset=utf-8");
      return;
    }

    AuthInfo auth = new AuthInfo();
    auth.JobId = jobId;
    auth.Cookie = cookie;
    auth.UserAgent = GetValue(form, "userAgent");
    auth.Referer = GetValue(form, "referer");
    long expiresAt = 0;
    long.TryParse(GetValue(form, "expiresAt"), out expiresAt);
    auth.ExpiresAt = expiresAt;
    this.authByJob[jobId] = auth;

    string expiresText = "unknown";
    if (expiresAt > 0)
    {
      DateTime epoch = new DateTime(1970, 1, 1, 0, 0, 0, DateTimeKind.Utc);
      expiresText = epoch.AddMilliseconds(expiresAt).ToLocalTime().ToString("yyyy-MM-dd HH:mm:ss");
    }
    Console.WriteLine("Auth updated: job=" + jobId + " expires=" + expiresText);
    SendText(context, 200, "ok", "text/plain; charset=utf-8");
  }

  private void HandleProxy(HttpListenerContext context)
  {
    string jobId = context.Request.QueryString.Get("job");
    string targetUrl = context.Request.QueryString.Get("url");
    string selectedVariantUrl = context.Request.QueryString.Get("variant");
    if (String.IsNullOrEmpty(jobId) || String.IsNullOrEmpty(targetUrl))
    {
      SendText(context, 400, "missing job or url", "text/plain; charset=utf-8");
      return;
    }

    Console.WriteLine("Proxy START " + targetUrl);
    HttpResponseMessage upstream = FetchTarget(jobId, targetUrl);
    string contentType = upstream.Content.Headers.ContentType == null ? "" : upstream.Content.Headers.ContentType.ToString();
    bool isM3u8 = Regex.IsMatch(targetUrl, "\\.m3u8($|\\?)", RegexOptions.IgnoreCase)
      || Regex.IsMatch(contentType, "mpegurl|m3u8|text", RegexOptions.IgnoreCase);

    if (isM3u8)
    {
      byte[] bytes = upstream.Content.ReadAsByteArrayAsync().Result;
      int statusCode = (int)upstream.StatusCode;
      Console.WriteLine("Proxy PLAYLIST [" + statusCode + "] bytes=" + bytes.Length + " " + targetUrl);
      string text = Encoding.UTF8.GetString(bytes);
      upstream.Dispose();

      if (text.Contains("#EXTM3U"))
      {
        string rewritten = RewriteM3u8(text, targetUrl, jobId, selectedVariantUrl);
        SendText(context, statusCode, rewritten, "application/vnd.apple.mpegurl; charset=utf-8");
        return;
      }

      string preview = text.Length > 300 ? text.Substring(0, 300) : text;
      Console.WriteLine("Playlist response did not contain #EXTM3U. Preview: " + preview);
      SendText(context, 502, "Upstream response is not an M3U8 playlist. status=" + statusCode + " preview=" + preview, "text/plain; charset=utf-8");
      return;
    }

    SendUpstreamBytes(context, upstream, contentType, targetUrl);
  }

  private HttpResponseMessage FetchTarget(string jobId, string targetUrl)
  {
    AuthInfo auth = WaitForAuth(jobId, 300);
    if (auth == null)
    {
      throw new Exception("No auth cookie received for job " + jobId + ". Keep the local proxy page open and restart this helper.");
    }

    HttpResponseMessage last = null;
    for (int attempt = 0; attempt < 60; attempt++)
    {
      auth = this.authByJob[jobId];
      HttpRequestMessage request = NewProxyRequest(targetUrl, auth);
      HttpResponseMessage response = this.client.SendAsync(request, HttpCompletionOption.ResponseHeadersRead).Result;
      if (response.StatusCode != HttpStatusCode.Forbidden && response.StatusCode != HttpStatusCode.Unauthorized)
      {
        if (attempt > 0)
        {
          Console.WriteLine("Request recovered after auth retry: " + targetUrl);
        }
        return response;
      }

      if (attempt == 0)
      {
        Console.WriteLine("CDN returned " + response.StatusCode + ". Waiting for refreshed auth: " + targetUrl);
      }
      last = response;
      if (attempt < 59)
      {
        response.Dispose();
        Thread.Sleep(1000);
      }
    }

    return last;
  }

  private AuthInfo WaitForAuth(string jobId, int timeoutSeconds)
  {
    for (int index = 0; index < timeoutSeconds; index++)
    {
      AuthInfo auth;
      if (this.authByJob.TryGetValue(jobId, out auth))
      {
        return auth;
      }
      if (index == 0)
      {
        LogAuthWait(jobId, index, timeoutSeconds);
      }
      else if (index == 10 || (index >= 30 && index % 30 == 0))
      {
        LogAuthWait(jobId, index, timeoutSeconds);
      }
      Thread.Sleep(1000);
    }
    return null;
  }

  private void LogAuthWait(string jobId, int elapsedSeconds, int timeoutSeconds)
  {
    string key = jobId + ":" + elapsedSeconds;
    if (!this.authWaitLogKeys.TryAdd(key, 1))
    {
      return;
    }

    if (elapsedSeconds == 0)
    {
      Console.WriteLine("Waiting for auth from extension page: job=" + jobId);
      return;
    }

    Console.WriteLine("Still waiting for auth: job=" + jobId + " (" + elapsedSeconds + "/" + timeoutSeconds + " seconds)");
  }

  private HttpRequestMessage NewProxyRequest(string targetUrl, AuthInfo auth)
  {
    HttpRequestMessage request = new HttpRequestMessage(HttpMethod.Get, targetUrl);
    string userAgent = String.IsNullOrEmpty(auth.UserAgent) ? "Mozilla/5.0" : auth.UserAgent;
    request.Headers.TryAddWithoutValidation("User-Agent", userAgent);
    request.Headers.TryAddWithoutValidation("Accept", "*/*");
    request.Headers.TryAddWithoutValidation("Accept-Encoding", "identity");
    request.Headers.TryAddWithoutValidation("Accept-Language", "ko,en-US;q=0.9,en;q=0.8");
    request.Headers.TryAddWithoutValidation("Connection", "close");
    if (!String.IsNullOrEmpty(auth.Cookie))
    {
      request.Headers.TryAddWithoutValidation("Cookie", auth.Cookie);
    }
    if (!String.IsNullOrEmpty(auth.Referer))
    {
      request.Headers.TryAddWithoutValidation("Referer", auth.Referer);
      try
      {
        Uri refererUri = new Uri(auth.Referer);
        request.Headers.TryAddWithoutValidation("Origin", refererUri.Scheme + "://" + refererUri.Host);
      }
      catch
      {
        request.Headers.TryAddWithoutValidation("Origin", "https://vod.sooplive.com");
      }
    }
    return request;
  }

  private void SendUpstreamStream(HttpListenerContext context, HttpResponseMessage upstream, string contentType, string targetUrl)
  {
    HttpListenerResponse response = context.Response;
    Stream input = null;
    long totalBytes = 0;
    AddCorsHeaders(response);
    response.StatusCode = (int)upstream.StatusCode;
    response.KeepAlive = false;
    if (!String.IsNullOrEmpty(contentType))
    {
      response.ContentType = contentType;
    }
    if (upstream.Content.Headers.ContentLength.HasValue && upstream.Content.Headers.ContentLength.Value >= 0)
    {
      try
      {
        response.ContentLength64 = upstream.Content.Headers.ContentLength.Value;
      }
      catch (Exception ex)
      {
        Console.WriteLine("ContentLength64 skipped: " + ex.Message);
      }
    }

    try
    {
      Console.WriteLine("Proxy STREAM [" + (int)upstream.StatusCode + "] " + targetUrl);
      input = upstream.Content.ReadAsStreamAsync().Result;
      byte[] buffer = new byte[1048576];
      int read;
      while ((read = input.Read(buffer, 0, buffer.Length)) > 0)
      {
        response.OutputStream.Write(buffer, 0, read);
        totalBytes += read;
      }
      response.OutputStream.Flush();
      Console.WriteLine("Proxy STREAM DONE [" + (int)upstream.StatusCode + "] bytes=" + totalBytes + " " + targetUrl);
    }
    catch (Exception ex)
    {
      Console.WriteLine("Proxy STREAM ERROR bytes=" + totalBytes + " " + targetUrl + " :: " + ex.Message);
    }
    finally
    {
      if (input != null)
      {
        input.Dispose();
      }
      upstream.Dispose();
      try
      {
        response.OutputStream.Close();
      }
      catch
      {
      }
      try
      {
        response.Close();
      }
      catch
      {
      }
    }
  }

  private void SendUpstreamBytes(HttpListenerContext context, HttpResponseMessage upstream, string contentType, string targetUrl)
  {
    try
    {
      byte[] bytes = upstream.Content.ReadAsByteArrayAsync().Result;
      int statusCode = (int)upstream.StatusCode;
      Console.WriteLine("Proxy BYTES [" + statusCode + "] bytes=" + bytes.Length + " " + targetUrl);
      SendBytes(context, statusCode, bytes, contentType);
    }
    catch (Exception ex)
    {
      Console.WriteLine("Proxy BYTES ERROR " + targetUrl + " :: " + ex.Message);
      throw;
    }
    finally
    {
      upstream.Dispose();
    }
  }

  private void SendText(HttpListenerContext context, int statusCode, string text, string contentType)
  {
    byte[] bytes = Encoding.UTF8.GetBytes(text == null ? "" : text);
    SendBytes(context, statusCode, bytes, contentType);
  }

  private void SendBytes(HttpListenerContext context, int statusCode, byte[] bytes, string contentType)
  {
    HttpListenerResponse response = context.Response;
    AddCorsHeaders(response);
    response.StatusCode = statusCode;
    response.KeepAlive = false;
    if (!String.IsNullOrEmpty(contentType))
    {
      response.ContentType = contentType;
    }
    try
    {
      response.ContentLength64 = bytes == null ? 0 : bytes.Length;
    }
    catch (Exception ex)
    {
      Console.WriteLine("ContentLength64 skipped: " + ex.Message);
    }
    try
    {
      if (bytes != null && bytes.Length > 0)
      {
        response.OutputStream.Write(bytes, 0, bytes.Length);
        response.OutputStream.Flush();
      }
    }
    finally
    {
      try
      {
        response.OutputStream.Close();
      }
      catch
      {
      }
      try
      {
        response.Close();
      }
      catch
      {
      }
    }
  }

  private void AddCorsHeaders(HttpListenerResponse response)
  {
    response.Headers["Access-Control-Allow-Origin"] = "*";
    response.Headers["Access-Control-Allow-Methods"] = "GET,POST,OPTIONS";
    response.Headers["Access-Control-Allow-Headers"] = "Content-Type";
  }

  private string RewriteM3u8(string content, string baseUrl, string jobId, string selectedVariantUrl)
  {
    if (!String.IsNullOrEmpty(selectedVariantUrl) && content.IndexOf("#EXT-X-STREAM-INF", StringComparison.OrdinalIgnoreCase) >= 0)
    {
      string pinned = RewriteMasterM3u8(content, baseUrl, jobId, selectedVariantUrl);
      if (!String.IsNullOrEmpty(pinned))
      {
        return pinned;
      }
    }

    return RewriteM3u8(content, baseUrl, jobId);
  }

  private string RewriteM3u8(string content, string baseUrl, string jobId)
  {
    string[] lines = content.Replace("\r", "").Split('\n');
    List<string> output = new List<string>();
    foreach (string rawLine in lines)
    {
      string line = rawLine.Trim();
      if (line.Length == 0)
      {
        output.Add(rawLine);
        continue;
      }
      if (line.StartsWith("#"))
      {
        string rewritten = Regex.Replace(rawLine, "URI=\"([^\"]+)\"", delegate(Match match)
        {
          string resolved = ResolveUrl(baseUrl, match.Groups[1].Value);
          if (Regex.IsMatch(resolved, "^(data:|blob:|#)", RegexOptions.IgnoreCase))
          {
            return match.Value;
          }
          return "URI=\"" + BuildProxiedUrl(jobId, resolved) + "\"";
        });
        output.Add(rewritten);
        continue;
      }
      output.Add(BuildProxiedUrl(jobId, ResolveUrl(baseUrl, line)));
    }
    return String.Join("\n", output.ToArray());
  }

  private string RewriteMasterM3u8(string content, string baseUrl, string jobId, string selectedVariantUrl)
  {
    string[] lines = content.Replace("\r", "").Split('\n');
    List<string> output = new List<string>();
    string pendingStreamInfo = null;
    bool matchedVariant = false;

    foreach (string rawLine in lines)
    {
      string line = rawLine.Trim();

      if (pendingStreamInfo != null)
      {
        if (line.Length > 0 && !line.StartsWith("#"))
        {
          string resolved = ResolveUrl(baseUrl, line);
          if (VariantUrlMatches(resolved, selectedVariantUrl, baseUrl))
          {
            output.Add(pendingStreamInfo);
            output.Add(BuildProxiedUrl(jobId, resolved));
            matchedVariant = true;
          }
          pendingStreamInfo = null;
          continue;
        }

        if (line.StartsWith("#EXT-X-STREAM-INF:", StringComparison.OrdinalIgnoreCase))
        {
          pendingStreamInfo = rawLine;
          continue;
        }

        output.Add(pendingStreamInfo);
        pendingStreamInfo = null;
      }

      if (line.StartsWith("#EXT-X-STREAM-INF:", StringComparison.OrdinalIgnoreCase))
      {
        pendingStreamInfo = rawLine;
        continue;
      }

      if (line.Length == 0)
      {
        output.Add(rawLine);
        continue;
      }

      if (line.StartsWith("#"))
      {
        string rewritten = Regex.Replace(rawLine, "URI=\"([^\"]+)\"", delegate(Match match)
        {
          string resolved = ResolveUrl(baseUrl, match.Groups[1].Value);
          if (Regex.IsMatch(resolved, "^(data:|blob:|#)", RegexOptions.IgnoreCase))
          {
            return match.Value;
          }
          return "URI=\"" + BuildProxiedUrl(jobId, resolved) + "\"";
        });
        output.Add(rewritten);
        continue;
      }

      output.Add(BuildProxiedUrl(jobId, ResolveUrl(baseUrl, line)));
    }

    if (pendingStreamInfo != null)
    {
      output.Add(pendingStreamInfo);
    }

    return matchedVariant ? String.Join("\n", output.ToArray()) : "";
  }

  private bool VariantUrlMatches(string candidateUrl, string selectedVariantUrl, string baseUrl)
  {
    if (String.IsNullOrEmpty(candidateUrl) || String.IsNullOrEmpty(selectedVariantUrl))
    {
      return false;
    }

    string selectedResolved = ResolveUrl(baseUrl, selectedVariantUrl);
    if (String.Equals(candidateUrl, selectedResolved, StringComparison.OrdinalIgnoreCase))
    {
      return true;
    }

    try
    {
      Uri candidate = new Uri(candidateUrl);
      Uri selected = new Uri(selectedResolved);
      string candidateQuality = GetQueryValue(candidate.Query, "quality");
      string selectedQuality = GetQueryValue(selected.Query, "quality");
      if (!String.IsNullOrEmpty(candidateQuality) || !String.IsNullOrEmpty(selectedQuality))
      {
        if (!String.Equals(candidateQuality, selectedQuality, StringComparison.OrdinalIgnoreCase))
        {
          return false;
        }

        if (!String.Equals(candidate.Host, selected.Host, StringComparison.OrdinalIgnoreCase))
        {
          return false;
        }

        return String.Equals(GetDirectoryPath(candidate.AbsolutePath), GetDirectoryPath(selected.AbsolutePath), StringComparison.OrdinalIgnoreCase);
      }

      if (!String.Equals(candidate.AbsolutePath, selected.AbsolutePath, StringComparison.OrdinalIgnoreCase))
      {
        return false;
      }

      return String.Equals(candidate.GetLeftPart(UriPartial.Path), selected.GetLeftPart(UriPartial.Path), StringComparison.OrdinalIgnoreCase);
    }
    catch
    {
      return false;
    }
  }

  private string GetDirectoryPath(string path)
  {
    if (String.IsNullOrEmpty(path))
    {
      return "";
    }

    int index = path.LastIndexOf('/');
    return index >= 0 ? path.Substring(0, index + 1) : "";
  }

  private string GetQueryValue(string query, string key)
  {
    string normalizedQuery = (query ?? "").TrimStart('?');
    if (String.IsNullOrEmpty(normalizedQuery))
    {
      return "";
    }

    string[] pairs = normalizedQuery.Split('&');
    foreach (string pair in pairs)
    {
      int index = pair.IndexOf('=');
      string rawKey = index >= 0 ? pair.Substring(0, index) : pair;
      if (String.Equals(FormDecode(rawKey), key, StringComparison.OrdinalIgnoreCase))
      {
        return index >= 0 ? FormDecode(pair.Substring(index + 1)) : "";
      }
    }
    return "";
  }

  private string ResolveUrl(string baseUrl, string maybeRelativeUrl)
  {
    if (Regex.IsMatch(maybeRelativeUrl, "^(data:|blob:|#)", RegexOptions.IgnoreCase))
    {
      return maybeRelativeUrl;
    }
    Uri baseUri = new Uri(baseUrl);
    return new Uri(baseUri, maybeRelativeUrl).AbsoluteUri;
  }

  private string BuildProxiedUrl(string jobId, string targetUrl)
  {
    return this.prefix + "proxy/" + GetProxyPathName(targetUrl)
      + "?job=" + Uri.EscapeDataString(jobId)
      + "&url=" + Uri.EscapeDataString(targetUrl);
  }

  private string GetProxyPathName(string targetUrl)
  {
    string name = "";
    try
    {
      Uri uri = new Uri(targetUrl);
      string[] parts = uri.AbsolutePath.Split('/');
      name = parts.Length == 0 ? "" : parts[parts.Length - 1];
    }
    catch
    {
      name = "";
    }
    if (String.IsNullOrEmpty(name))
    {
      name = "resource";
    }
    try
    {
      name = Uri.UnescapeDataString(name);
    }
    catch
    {
    }
    name = Regex.Replace(name, "[^A-Za-z0-9._-]", "_");
    if (String.IsNullOrEmpty(name))
    {
      name = "resource";
    }
    if (name.Length > 120)
    {
      name = name.Substring(0, 120);
    }
    return Uri.EscapeDataString(name);
  }

  private string ReadRequestBody(HttpListenerRequest request)
  {
    using (StreamReader reader = new StreamReader(request.InputStream, request.ContentEncoding))
    {
      return reader.ReadToEnd();
    }
  }

  private Dictionary<string, string> ParseForm(string body)
  {
    Dictionary<string, string> result = new Dictionary<string, string>();
    if (String.IsNullOrEmpty(body))
    {
      return result;
    }
    string[] pairs = body.Split('&');
    foreach (string pair in pairs)
    {
      int index = pair.IndexOf('=');
      string key = index >= 0 ? pair.Substring(0, index) : pair;
      string value = index >= 0 ? pair.Substring(index + 1) : "";
      result[FormDecode(key)] = FormDecode(value);
    }
    return result;
  }

  private string FormDecode(string value)
  {
    return Uri.UnescapeDataString((value ?? "").Replace("+", " "));
  }

  private string GetValue(Dictionary<string, string> values, string key)
  {
    string value;
    return values.TryGetValue(key, out value) ? value : "";
  }
}
"@

Add-Type -ReferencedAssemblies "System.Net.Http.dll" -TypeDefinition $Source
$Server = New-Object SoopLocalProxy -ArgumentList $Port
$Server.Run()`;
}

async function downloadHelperScript() {
  const blob = new Blob(['\ufeff', helperScript()], { type: 'text/plain;charset=utf-8' });
  const objectUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = objectUrl;
  link.download = 'soop-local-proxy.ps1';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 500);
}

function helperCommand() {
  return `powershell -ExecutionPolicy Bypass -File "%USERPROFILE%\\Downloads\\soop-local-proxy.ps1" -Port ${PROXY_PORT}`;
}

async function init() {
  summaryEl.textContent = [
    `영상: ${job.title}${job.qualityLabel ? ` / ${job.qualityLabel}` : ''}`,
    `작업 ID: ${job.id}`,
    job.sourceTabId ? `SOOP 탭: ${job.sourceTabId}` : 'SOOP 탭: 연결되지 않음'
  ].join('\n');
  setStage('waiting-helper');
  renderWaitingCommandText();

  if (!controlsBound) {
    controlsBound = true;
    copyHelperButton.addEventListener('click', async () => {
      await copyText(helperCommand());
      setStatus('helper 실행 명령을 복사했습니다.\nCMD 또는 PowerShell에 붙여넣고 helper 창을 열어 두세요.');
    });

    downloadHelperButton.addEventListener('click', async () => {
      await downloadHelperScript();
      setStatus('helper 파일 저장을 시작했습니다.\n저장이 끝나면 helper 실행 명령을 복사해서 실행하세요.');
    });

    copyFfmpegButton.addEventListener('click', async () => {
      await copyText(buildFfmpegCommand());
      setStage('ffmpeg-copied');
      setStatus('ffmpeg 명령을 복사했습니다.\n다운로드가 끝날 때까지 SOOP VOD 탭, 이 탭, helper 창을 닫지 마세요.');
    });
  }

  try {
    await checkProxy();
    await refreshAuth();
    window.clearTimeout(proxyWaitTimer);
    commandOutputEl.value = buildFfmpegCommand();
    copyFfmpegButton.disabled = false;
    setStage('ready');
  } catch (error) {
    copyFfmpegButton.disabled = true;
    renderWaitingCommandText();
    setStage('waiting-helper');
    setStatus(`로컬 프록시가 아직 준비되지 않았습니다.\n1. helper를 저장하세요.\n2. helper 실행 명령을 CMD 또는 PowerShell에서 실행하세요.\n3. helper가 켜지면 이 페이지가 자동으로 인증을 보냅니다.\n\n${error.message}`, true);
    window.clearTimeout(proxyWaitTimer);
    proxyWaitTimer = window.setTimeout(() => init(), 2500);
  }
}

window.addEventListener('beforeunload', () => {
  window.clearTimeout(refreshTimer);
  window.clearTimeout(proxyWaitTimer);
});

init();
