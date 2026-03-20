export async function onRequest(context) {
  return handleRequest(context.request);
}

// ===== 配置 =====
const CONFIG = {
  PROXY_TS: "", // 推荐填：你的中转，例如 https://xxx.com/ts?url=
  PROXY_TS_URLENCODE: true,

  CACHE_TTL: 86400,
  FILTER_ADS_INTELLIGENTLY: true,

  USER_AGENTS: [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17 Mobile Safari/604.1'
  ]
};

// ===== 主入口 =====
async function handleRequest(request) {
  try {
    const url = new URL(request.url);
    const targetUrl = getTargetUrl(url);

    if (!targetUrl) {
      return text("Missing ?url=", 400);
    }

    const { content, contentType } = await fetchContent(targetUrl);

    // 非 m3u8
    if (!isM3u8(content, contentType)) {
      // 直接透传（比 302 稳）
      return fetch(targetUrl);
    }

    let result = processPlaylist(targetUrl, content);

    if (CONFIG.FILTER_ADS_INTELLIGENTLY) {
      result = filterAds(result);
    }

    return m3u8Response(result);

  } catch (e) {
    return text("Error: " + e.message, 500);
  }
}

// ===== 获取 URL =====
function getTargetUrl(url) {
  if (url.searchParams.get("url")) {
    return url.searchParams.get("url");
  }
  const m = url.pathname.match(/^\/m3u8filter\/(.+)/);
  return m ? decodeURIComponent(m[1]) : null;
}

// ===== fetch =====
async function fetchContent(url) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": randUA(),
      "Referer": new URL(url).origin
    }
  });

  const text = await res.text();
  return {
    content: text,
    contentType: res.headers.get("content-type") || ""
  };
}

// ===== 判断 m3u8 =====
function isM3u8(content, type) {
  return (
    content.startsWith("#EXTM3U") ||
    type.includes("mpegurl")
  );
}

// ===== 处理播放列表 =====
function processPlaylist(url, content) {
  const base = baseUrl(url);
  const lines = content.split("\n");
  const out = [];

  let isSeg = false;

  for (let l of lines) {
    l = l.trim();
    if (!l) continue;

    if (l.startsWith("#EXTINF")) {
      isSeg = true;
      out.push(l);
      continue;
    }

    if (l.startsWith("#EXT-X-KEY")) {
      out.push(rewriteKey(l, base));
      continue;
    }

    if (l.startsWith("#EXT-X-MAP")) {
      out.push(rewriteMap(l, base));
      continue;
    }

    if (isSeg && !l.startsWith("#")) {
      out.push(proxy(resolve(base, l)));
      isSeg = false;
      continue;
    }

    out.push(l);
  }

  return out.join("\n");
}

// ===== KEY =====
function rewriteKey(line, base) {
  return line.replace(/URI="([^"]+)"/, (_, u) => {
    return `URI="${proxy(resolve(base, u))}"`;
  });
}

// ===== MAP =====
function rewriteMap(line, base) {
  return line.replace(/URI="([^"]+)"/, (_, u) => {
    return `URI="${proxy(resolve(base, u))}"`;
  });
}

// ===== TS代理 =====
function proxy(u) {
  if (!CONFIG.PROXY_TS) return u;
  return CONFIG.PROXY_TS_URLENCODE
    ? CONFIG.PROXY_TS + encodeURIComponent(u)
    : CONFIG.PROXY_TS + u;
}

// ===== URL处理 =====
function resolve(base, rel) {
  if (rel.startsWith("http")) return rel;
  return new URL(rel, base).toString();
}

function baseUrl(u) {
  const x = new URL(u);
  return x.origin + x.pathname.substring(0, x.pathname.lastIndexOf("/") + 1);
}

// ===== UA =====
function randUA() {
  return CONFIG.USER_AGENTS[
    Math.floor(Math.random() * CONFIG.USER_AGENTS.length)
  ];
}

// ===== 响应 =====
function m3u8Response(body) {
  return new Response(body, {
    headers: {
      "Content-Type": "application/vnd.apple.mpegurl",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=" + CONFIG.CACHE_TTL
    }
  });
}

function text(t, s=200) {
  return new Response(t, { status: s });
}

// ===== 简化版广告过滤 =====
function filterAds(content) {
  const lines = content.split("\n");

  return lines.filter(line => {
    if (!line) return false;

    // 过滤短片段（简单版）
    if (line.startsWith("#EXTINF:")) {
      const d = parseFloat(line.split(":")[1]);
      if (d < 1) return false;
    }

    return true;
  }).join("\n");
}
