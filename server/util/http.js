// 统一 HTTP 请求助手：所有 provider 都通过它发请求。
// 返回解析后的 JSON；网络错误返回 { code: -1, message }，与上游语义保持一致。

const DEFAULT_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

async function httpRequest(url, { method = 'GET', body, headers = {}, timeoutMs = 15000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', 'User-Agent': DEFAULT_UA, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await resp.text();
    try {
      return JSON.parse(text);
    } catch {
      // 网关层错误常返回 HTML 页面，截取标题保持记录可读
      const title = /<title>(.*?)<\/title>/i.exec(text);
      const message = title
        ? title[1]
        : text.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
      return { code: resp.status, message: `HTTP ${resp.status} ${message}`.trim() };
    }
  } catch (e) {
    return { code: -1, message: e.name === 'AbortError' ? `请求超时(${timeoutMs}ms)` : e.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { httpRequest };
