/* 车管家 iOS 原生桥接（在页面脚本之前注入）
 * 作用：把 WKWebView 缺失/受限的浏览器能力，转交给原生实现，
 *       保证与安卓版、浏览器版功能表现一致。
 */
(function () {
  if (window.__ccIOSBridge) { return; }
  var native = null;
  try {
    native = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.carcare;
  } catch (e) { native = null; }
  if (!native) { return; }
  window.__ccIOSBridge = true;

  function post(payload) {
    try { native.postMessage(payload); } catch (e) {}
  }
  window.__ccNative = post;

  /* 1) 本身就是独立 App：隐藏「安装到手机」卡片（与安卓 WebView 版一致） */
  try {
    var style = document.createElement('style');
    style.textContent = '#installCard{display:none!important}' +
      'input,select,textarea{font-size:16px!important}'; /* 避免 iOS 聚焦表单时自动放大页面 */
    (document.head || document.documentElement).appendChild(style);
  } catch (e) {}

  /* 2) 系统通知：WKWebView 不提供 Notification API，转成原生本地通知 */
  function CCNotification(title, options) {
    options = options || {};
    post({
      type: 'notify',
      title: title == null ? '' : String(title),
      body: options.body == null ? '' : String(options.body)
    });
  }
  CCNotification.permission = 'granted';
  CCNotification.requestPermission = function (callback) {
    if (typeof callback === 'function') { try { callback('granted'); } catch (e) {} }
    return Promise.resolve('granted');
  };
  try {
    Object.defineProperty(window, 'Notification', { value: CCNotification, writable: true, configurable: true });
  } catch (e) {
    try { window.Notification = CCNotification; } catch (e2) {}
  }

  /* 3) window.open('') 的两种用法：导出 PDF（写整页 HTML）、查看凭证图
   *    WKWebView 弹不出新窗口，这里截获写入内容交给原生处理 */
  var origOpen = window.open;
  window.open = function (url) {
    if (url && String(url).length && String(url) !== 'about:blank') {
      try { return origOpen.apply(window, arguments); } catch (e) { return null; }
    }
    var buffer = { html: '' };
    var done = false;

    function flush() {
      if (done) { return; }
      var html = buffer.html;
      if (!html || !html.trim().length) { return; }
      done = true;
      var trimmed = html.trim();
      var imgMatch = trimmed.match(/^<img[^>]*src="([^"]+)"[^>]*>$/i);
      if (imgMatch && imgMatch[1].indexOf('data:') === 0) {
        post({ type: 'previewImage', dataURL: imgMatch[1] });
        return;
      }
      var titleMatch = html.match(/<title>([^<]*)<\/title>/i);
      var name = (titleMatch && titleMatch[1] ? titleMatch[1].trim() : '维保记录') + '.pdf';
      post({ type: 'sharePDF', html: html, name: name });
    }

    var fakeDoc = {
      write: function (s) { buffer.html += String(s); },
      writeln: function (s) { buffer.html += String(s) + '\n'; },
      open: function () {},
      close: function () { flush(); },
      getElementById: function () { return null; }
    };
    var fakeWin = {
      document: fakeDoc,
      print: flush,
      focus: function () {},
      close: flush,
      location: { href: '' }
    };
    setTimeout(flush, 180);
    setTimeout(flush, 1500);
    return fakeWin;
  };

  /* 4) 导出 CSV：<a download href="blob:..."> 在 WKWebView 里不会触发下载，
   *    改为读出文本交给原生保存并调起分享 */
  if (window.HTMLAnchorElement) {
    var origClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      try {
        var name = this.getAttribute('download');
        var href = this.href || '';
        if (name && href.indexOf('blob:') === 0) {
          fetch(href).then(function (r) { return r.text(); }).then(function (text) {
            post({ type: 'shareFile', name: name, text: text });
          }).catch(function () {});
          return;
        }
      } catch (e) {}
      return origClick.apply(this, arguments);
    };
  }
})();
