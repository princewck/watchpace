export function restPage() {
  return new Response(
    '<!doctype html><html lang=zh-CN><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1"><title>电视休息时间</title><body style="background:#123f34;color:white;font:32px system-ui;text-align:center;padding:12vh 10vw"><h1>电视休息一下</h1><p>请家长在手机上调整观看时间。</p><p>恢复后可返回视频继续观看。</p></body></html>',
    {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'",
      },
    },
  );
}
