// 调试：逐阶段定位 provider 隧道请求卡点
const net = require('net');
const tls = require('tls');
const store = require('../server/store');

const API_HOST = 'agentrouter.org';
const t0 = Date.now();
const log = (msg) => console.log(`[+${Date.now() - t0}ms]`, msg);

function buildHeaders(account) {
  const h = { 'x-device-fingerprint': 'fp-debug' };
  const cookie = account.session_cookie;
  if (cookie) h.Cookie = cookie;
  return h;
}

function tunneledRequest(pathName, { headers = {}, body, timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    log('net.connect → 192.168.31.32:7890');
    const socket = net.connect({ host: '192.168.31.32', port: 7890 });
    socket.setTimeout(timeoutMs);
    let stage = 'connecting';
    let tlsSock = null;
    let buf = Buffer.alloc(0);
    const fail = (message) => {
      log('FAIL at', stage, ':', message);
      socket.destroy();
      if (tlsSock) tlsSock.destroy();
      reject(new Error(message));
    };
    socket.on('error', (e) => fail('socket: ' + e.message));
    socket.on('timeout', () => fail('socket 超时（25s 无数据）'));
    socket.on('data', function onData(d) {
      log(`socket data +${d.length}B (stage=${stage})`);
      buf = Buffer.concat([buf, d]);
      if (stage === 'connecting') {
        const headText = buf.toString('latin1');
        const idx = headText.indexOf('\r\n\r\n');
        if (idx === -1) return;
        const ok = /^HTTP\/1\.[01] 200/.test(headText);
        const rest = buf.slice(idx + 4);
        log('CONNECT resp:', headText.split('\r\n')[0], '| rest:', rest.length, 'B');
        buf = Buffer.alloc(0);
        if (!ok) return fail('CONNECT 失败');
        stage = 'tls';
        socket.removeListener('data', onData);
        tlsSock = tls.connect({ socket, servername: API_HOST }, () => {
          log('TLS 握手完成，发送请求:', pathName);
          stage = 'http';
          const h = { Host: API_HOST, 'User-Agent': 'Mozilla/5.0', Accept: 'application/json', Connection: 'close', ...headers };
          const bodyStr = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
          if (bodyStr) h['Content-Length'] = Buffer.byteLength(bodyStr);
          let req = `${'GET'} ${pathName} HTTP/1.1\r\n`;
          for (const [k, v] of Object.entries(h)) req += `${k}: ${v}\r\n`;
          req += '\r\n';
          tlsSock.write(req, 'latin1');
          if (bodyStr) tlsSock.write(bodyStr, 'utf8');
        });
        if (rest.length) tlsSock.emit('data', rest);
        tlsSock.on('data', (d2) => {
          log(`tls data +${d2.length}B`);
          buf = Buffer.concat([buf, d2]);
        });
        tlsSock.on('end', () => {
          const idx2 = buf.indexOf('\r\n\r\n');
          log('响应完成:', buf.slice(0, buf.indexOf('\r\n')).toString(), '| body:', buf.slice(idx2 + 4).toString().slice(0, 100));
          resolve(buf);
        });
        tlsSock.on('error', (e) => fail('tls: ' + e.message));
      }
    });
  });
}

(async () => {
  const acc = store.loadAccounts().find((a) => a.provider === 'agentrouter');
  try {
    await tunneledRequest('/api/user/self', { headers: buildHeaders(acc), timeoutMs: 15000 });
  } catch (e) {
    console.log('最终错误:', e.message);
  }
})();
