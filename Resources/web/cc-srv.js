/* ============================================================================
 * 车管家 · 用车服务（cc-srv.js）
 *
 * 「服务」标签页：城市油价 / 智能提醒 / 报告解读 / AI选车 / AI旧车估价 /
 *                拍照问AI / 极速救援 / AI写手
 *
 * 设计要点
 *  1. 完全自包含：样式、卡片、弹层都由本文件注入，index.html 只留一个空 section。
 *  2. AI 能力复用 cc-ai.js 暴露的 ccAiCall / ccAiReady / ccAiSnapText，
 *     配置、Key、网络通道全部共用，用户只填一次 Key。
 *  3. 图片（拍照问AI / 报告解读）：App 内走原生选图（iOS 桥接 / 安卓文件选择），
 *     压缩成 base64 走 OpenAI 兼容的 image_url 内容块；网页版用 <input type=file>。
 * ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 0. 小工具
   * ------------------------------------------------------------------ */
  function N(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function S(v) { return v == null ? '' : String(v); }
  function esc(s) {
    s = s == null ? '' : String(s);
    return s.replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; });
  }
  function P2(n) { return (n < 10 ? '0' : '') + n; }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + P2(d.getMonth() + 1) + '-' + P2(d.getDate()); }
  function daysBetween(a) {
    if (!a) return null;
    var d1 = new Date(String(a).slice(0, 10)), d2 = new Date();
    if (isNaN(d1)) return null;
    d1.setHours(0, 0, 0, 0); d2.setHours(0, 0, 0, 0);
    return Math.round((d1 - d2) / 86400000);
  }
  function getDB() { return (typeof DB !== 'undefined' && DB) ? DB : { vehicles: [], records: [], reminders: [], fuels: [], costs: [] }; }
  function curV() { try { return (typeof curVehicle === 'function' ? curVehicle() : null) || getDB().vehicles[0] || {}; } catch (e) { return {}; } }
  function toastMsg(m) { try { if (typeof toast === 'function') { toast(m); return; } } catch (e) { } }
  function aiOK() { return !!(window.ccAiReady && window.ccAiReady()); }
  function aiCfg() { if (window.ccAiOpenCfg) window.ccAiOpenCfg(); }

  /* 极简 Markdown：标题 / 列表 / 加粗 / 表格降级为行 */
  function mdLite(t) {
    var s = esc(t == null ? '' : String(t));
    s = s.replace(/```[\s\S]*?```/g, function (m) { return '<pre>' + m.replace(/```/g, '') + '</pre>'; });
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    s = s.replace(/^#{1,4}\s*(.+)$/gm, '<b>$1</b>');
    s = s.replace(/^[-*]\s+/gm, '· ');
    s = s.replace(/\n/g, '<br>');
    return s;
  }

  /* ------------------------------------------------------------------ *
   * 1. 样式
   * ------------------------------------------------------------------ */
  var _styled = false;
  function injectStyle() {
    if (_styled) return;
    _styled = true;
    var css = ''
      + '.srv-list{display:flex;flex-direction:column;gap:10px;padding:2px 0 90px}'
      + '.srv-card{display:flex;align-items:center;gap:13px;padding:15px 16px;border-radius:18px;cursor:pointer;'
      + 'border:1px solid rgba(255,255,255,.55);box-shadow:0 2px 10px -6px rgba(60,90,140,.18);transition:transform .12s}'
      + '.srv-card:active{transform:scale(.975)}'
      + '.srv-g1{background:linear-gradient(135deg,#eaf7ee,#f2fbf4)}.srv-g2{background:linear-gradient(135deg,#fdf0ef,#fef5f4)}'
      + '.srv-g3{background:linear-gradient(135deg,#eef2fd,#f3f6fe)}.srv-g4{background:linear-gradient(135deg,#fff5ea,#fef8f0)}'
      + '.srv-ic{width:44px;height:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;flex:none;'
      + 'box-shadow:inset 0 1px 0 rgba(255,255,255,.7),0 3px 8px -4px rgba(50,80,130,.25);background:rgba(255,255,255,.75)}'
      + '.srv-ic svg{width:24px;height:24px;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}'
      + '.srv-tt{flex:1;min-width:0}.srv-tt b{display:block;font-size:15.5px;font-weight:800;color:#1b2a3d}'
      + '.srv-tt span{display:block;font-size:12.5px;color:#67788e;margin-top:2px;line-height:1.45}'
      + '.srv-tt .srv-tag{display:inline-flex;margin-top:5px;padding:1.5px 8px;border-radius:999px;font-size:10.5px;font-weight:800;'
      + 'color:#fff;background:linear-gradient(90deg,#ff9d3c,#ffb35c);letter-spacing:.3px}'
      + '.srv-arr{color:#9fb0c4;font-size:18px;flex:none;font-weight:700}'
      + '.srv-head{display:flex;align-items:center;margin:4px 2px 12px}'
      + '.srv-head .sec-title{flex:1;margin:0}'
      /* ---- 底部弹层 ---- */
      + '.srv-ov{position:fixed;inset:0;z-index:60;background:rgba(12,26,45,.38);display:flex;align-items:flex-end;'
      + '-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);animation:srvFade .18s}'
      + '@keyframes srvFade{from{opacity:0}}'
      + '.srv-sheet{width:100%;max-height:92%;overflow:auto;border-radius:22px 22px 0 0;'
      + 'background:linear-gradient(180deg,#f7fbff,#eef4fc);padding:16px 16px calc(20px + env(safe-area-inset-bottom));'
      + 'box-shadow:0 -18px 40px -20px rgba(16,44,80,.6);animation:srvUp .22s cubic-bezier(.2,.9,.3,1)}'
      + '@keyframes srvUp{from{transform:translateY(60px);opacity:.4}}'
      + '.srv-sh-head{display:flex;align-items:center;margin-bottom:10px}'
      + '.srv-sh-head b{flex:1;font-size:16.5px;font-weight:800;color:#16283c}'
      + '.srv-sh-close{font-size:13.5px;font-weight:700;color:#0a6fd8;padding:6px 12px;border-radius:999px;border:0;'
      + 'background:rgba(10,132,255,.11)}'
      + '.srv-frow{margin:10px 0}.srv-frow label{display:block;font-size:12.5px;font-weight:700;color:#41536b;margin-bottom:5px}'
      + '.srv-frow input,.srv-frow select,.srv-frow textarea{width:100%;box-sizing:border-box;padding:10px 12px;border-radius:12px;'
      + 'border:1px solid #cfdaea;background:#fff;font-size:15px;color:#1b2a3d;outline:none;font-family:inherit}'
      + '.srv-frow textarea{resize:vertical;min-height:72px}'
      + '.srv-seg{display:flex;flex-wrap:wrap;gap:8px}'
      + '.srv-seg button{padding:8px 14px;border-radius:999px;border:1px solid #c9d6e8;background:#fff;font-size:13.5px;'
      + 'font-weight:700;color:#41536b}'
      + '.srv-seg button.on{background:linear-gradient(135deg,#0a84ff,#3aa0ff);border-color:transparent;color:#fff}'
      + '.srv-btn{width:100%;padding:12px;border-radius:14px;border:0;font-size:15.5px;font-weight:800;color:#fff;'
      + 'background:linear-gradient(135deg,#0a84ff,#2f9bff);margin-top:14px;box-shadow:0 8px 18px -8px rgba(10,110,230,.55)}'
      + '.srv-btn:disabled{opacity:.55}'
      + '.srv-ghost{width:100%;padding:11px;border-radius:14px;border:1px solid #c9d6e8;background:#fff;font-size:14px;'
      + 'font-weight:700;color:#0a6fd8;margin-top:10px}'
      + '.srv-out{margin-top:14px;padding:12px 13px;border-radius:14px;background:#fff;border:1px solid #dbe5f2;'
      + 'font-size:14px;line-height:1.7;color:#22344a;min-height:44px;word-break:break-word}'
      + '.srv-out pre{background:#f0f5fb;border-radius:8px;padding:8px;font-size:12px;white-space:pre-wrap;overflow-x:auto}'
      + '.srv-out code{background:#eef3fa;border-radius:4px;padding:0 4px;font-size:12.5px}'
      + '.srv-tip{font-size:11.5px;color:#7c8ba1;line-height:1.6;margin-top:10px}'
      + '.srv-photo{display:flex;gap:10px;align-items:center;margin:4px 0 2px}'
      + '.srv-photo .ph{width:86px;height:86px;border-radius:14px;border:1.5px dashed #b7c6da;background:#fff;'
      + 'display:flex;align-items:center;justify-content:center;font-size:26px;color:#8ba0b8;cursor:pointer;overflow:hidden;flex:none}'
      + '.srv-photo .ph img{width:100%;height:100%;object-fit:cover}'
      + '.srv-photo .ph-t{font-size:12.5px;color:#67788e;line-height:1.55}'
      /* ---- 智能提醒行 ---- */
      + '.srv-rem{display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid #e3ebf5;font-size:14px}'
      + '.srv-rem:last-child{border-bottom:0}'
      + '.srv-rem .nm{flex:1;min-width:0;color:#22344a;font-weight:600}'
      + '.srv-rem .dt{color:#7c8ba1;font-size:12px}'
      + '.srv-badge{padding:2px 9px;border-radius:999px;font-size:11.5px;font-weight:800;flex:none}'
      + '.srv-b-ok{background:#e5f6ea;color:#1d7a3c}.srv-b-warn{background:#fdf3e0;color:#b26a00}'
      + '.srv-b-bad{background:#fde8e8;color:#c0392b}'
      /* ---- 救援 ---- */
      + '.srv-resc{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:4px}'
      + '.srv-resc a{display:block;padding:16px 14px;border-radius:16px;background:#fff;border:1px solid #dbe5f2;'
      + 'text-decoration:none;color:#16283c;text-align:center}'
      + '.srv-resc a b{display:block;font-size:19px;font-weight:900;letter-spacing:.5px}'
      + '.srv-resc a span{display:block;font-size:12px;color:#67788e;margin-top:4px}'
      + '.srv-resc .r-red b{color:#d64541}.srv-resc .r-org b{color:#e67e22}.srv-resc .r-grn b{color:#1d7a3c}.srv-resc .r-blu b{color:#0a6fd8}'
      + '.srv-copy{font-size:12px;color:#0a6fd8;font-weight:700;border:0;background:none;padding:2px 6px;cursor:pointer;text-decoration:underline}';
    var host = document.head || document.documentElement;
    var st = document.createElement('style');
    st.textContent = css;
    host.appendChild(st);
  }

  /* ------------------------------------------------------------------ *
   * 2. 服务屏渲染
   * ------------------------------------------------------------------ */
  var ICONS = {
    oil: '<svg viewBox="0 0 24 24" stroke="#1d9a5b"><rect x="5" y="4" width="9" height="16" rx="2"/><path d="M14 8h3l2.5 3v6.5a2 2 0 0 1-2 2H14"/><path d="M8 8.5h3"/></svg>',
    bell: '<svg viewBox="0 0 24 24" stroke="#d64541"><path d="M18 9a6 6 0 1 0-12 0c0 6-2.2 7.6-2.2 7.6h16.4S18 15 18 9"/><path d="M10.3 20a2 2 0 0 0 3.4 0"/></svg>',
    doc: '<svg viewBox="0 0 24 24" stroke="#4a63d8"><rect x="4.5" y="3.5" width="12" height="17" rx="2.4"/><path d="M8 8h5M8 11.5h3"/><circle cx="15.5" cy="15.5" r="3.2" fill="#eef2fd"/><path d="M18 18l2.6 2.6"/></svg>',
    pick: '<svg viewBox="0 0 24 24" stroke="#e2892b"><path d="M5 16.5c1.8-5.2 6-8 11.5-8 0 0 2 .2 2.5 2.4.5 2.3-1.5 3.1-3.5 3.1-3.8 0-7.5 1-10.5 2.5z"/><path d="M8.5 12.2c1.5-2.3 3.6-3.4 6-3.6"/><circle cx="18.6" cy="5.6" r="1.4"/></svg>',
    price: '<svg viewBox="0 0 24 24" stroke="#c8482f"><path d="M4 13.6 10.4 20a2 2 0 0 0 2.9 0l5.5-5.5a2 2 0 0 0 0-2.9L13.2 5.2a2 2 0 0 0-1.5-.6l-4.6.3a2 2 0 0 0-1.9 1.9l-.3 4.6c0 .6.2 1.1.6 1.5z" transform="rotate(-45 12 12)"/><circle cx="9.5" cy="9.5" r="1.6"/><path d="M12.5 13.5l3 3M14 12l3 3" transform="rotate(-45 12 12)"/></svg>',
    cam: '<svg viewBox="0 0 24 24" stroke="#3c9e5f"><rect x="3.5" y="6.5" width="17" height="12.5" rx="2.6"/><circle cx="12" cy="12.8" r="3.4"/><path d="M9 6.5l1.2-2h3.6L15 6.5"/><path d="M19.4 4.2v3M20.9 5.7h-3" stroke="#e2892b"/></svg>',
    sos: '<svg viewBox="0 0 24 24" stroke="#d64541"><path d="M12 3.5 3.5 20h17z"/><path d="M12 10v4"/><circle cx="12" cy="16.6" r=".4" fill="#d64541"/></svg>',
    pen: '<svg viewBox="0 0 24 24" stroke="#4a63d8"><path d="M4 20c1-4.5 3-9.5 8.5-13.5C15 4.5 18 4 20 4c0 2-.5 5-2.5 7.5C13.5 17 8.5 19 4 20z"/><path d="M4 20c2.5-3.5 6-6.5 9.5-8.5"/></svg>'
  };

  var FEATURES = [
    { id: 'oil', g: 'srv-g1', ic: 'oil', t: '城市油价', d: '一键速览城市油价，优惠尽在掌握', fn: openOil },
    { id: 'rem', g: 'srv-g2', ic: 'bell', t: '智能提醒', d: '车检年检保险不遗忘', fn: openRemind },
    { id: 'report', g: 'srv-g3', ic: 'doc', t: '报告解读', d: '专业解读，科学分析，智慧养护', fn: openReport },
    { id: 'pick', g: 'srv-g4', ic: 'pick', t: 'AI选车', d: 'AI帮您选到心仪的车', fn: openPick, tag: '+100' },
    { id: 'used', g: 'srv-g2', ic: 'price', t: 'AI旧车估价', d: 'AI帮您评估旧车价值', fn: openUsed },
    { id: 'photo', g: 'srv-g1', ic: 'cam', t: '拍照问AI', d: '拍照问车，秒懂疑难', fn: openPhoto },
    { id: 'sos', g: 'srv-g2', ic: 'sos', t: '极速救援', d: '一键拨打，救援极达', fn: openSOS },
    { id: 'writer', g: 'srv-g3', ic: 'pen', t: 'AI写手', d: '一键生成事故报告 | 行车总结', fn: openWriter }
  ];

  function render() {
    var host = document.getElementById('screen-srv');
    if (!host) return;
    var v = curV();
    var head = '<div class="srv-head"><div class="sec-title">用车服务</div>'
      + (S(v.name) ? '<span class="pill pri" id="srvCarTag">' + esc(S(v.name) + (v.plate ? ' ' + v.plate : '')) + '</span>' : '')
      + '</div>';
    var cards = FEATURES.map(function (f) {
      return '<div class="srv-card ' + f.g + '" onclick="ccSrvOpen(\'' + f.id + '\')">'
        + '<div class="srv-ic">' + ICONS[f.ic] + '</div>'
        + '<div class="srv-tt"><b>' + f.t + '</b><span>' + f.d + '</span>'
        + (f.tag ? '<span class="srv-tag">U ' + f.tag + '</span>' : '') + '</div>'
        + '<div class="srv-arr">›</div></div>';
    }).join('');
    host.innerHTML = head + '<div class="srv-list">' + cards + '</div>';
  }

  function openById(id) {
    var f = FEATURES.find(function (x) { return x.id === id; });
    if (f) f.fn();
  }

  /* ------------------------------------------------------------------ *
   * 3. 底部弹层
   * ------------------------------------------------------------------ */
  function sheet(id, title, inner) {
    var old = document.getElementById(id);
    if (old) old.remove();
    var ov = document.createElement('div');
    ov.className = 'srv-ov';
    ov.id = id;
    ov.onclick = function (e) { if (e.target === ov) ov.remove(); };
    ov.innerHTML = '<div class="srv-sheet"><div class="srv-sh-head"><b>' + esc(title) + '</b>'
      + '<button class="srv-sh-close" onclick="this.closest(\'.srv-ov\').remove()">完成</button></div>'
      + inner + '</div>';
    /* 统一事件委托：所有 .srv-seg 选项 chip 点击切换选中（各弹层无需重复绑定） */
    ov.addEventListener('click', function (e) {
      var b = e.target.closest('.srv-seg button');
      if (!b || !ov.contains(b)) return;
      var segEl = b.closest('.srv-seg');
      segEl.querySelectorAll('button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
    });
    document.body.appendChild(ov);
    return ov;
  }

  /* AI 流式输出到弹层里的元素 */
  function aiRun(out, messages, btn) {
    if (!aiOK()) { out.innerHTML = '<span style="color:#b26a00">先配置 AI 模型（填一次 Key 就能用）</span>'; aiCfg(); return; }
    if (btn) btn.disabled = true;
    out.innerHTML = '<span class="ai-cursor"></span>';
    window.ccAiCall(messages, {
      onDelta: function (full) { out.innerHTML = mdLite(full) + '<span class="ai-cursor"></span>'; },
      onDone: function (full, err) {
        if (btn) btn.disabled = false;
        out.innerHTML = err ? ('<span style="color:#c0392b">请求失败：' + esc(err) + '</span>')
          : mdLite(full || '（没有返回内容，换个模型再试试）');
      }
    });
  }

  /* ------------------------------------------------------------------ *
   * 4. 图片选取与压缩（拍照问AI / 报告解读）
   * ------------------------------------------------------------------ */
  function compressFile(file, cb) {
    var r = new FileReader();
    r.onload = function () {
      var img = new Image();
      img.onload = function () {
        var MAX = 1280, w = img.width, h = img.height;
        if (w > MAX || h > MAX) { var k = MAX / Math.max(w, h); w = Math.round(w * k); h = Math.round(h * k); }
        var c = document.createElement('canvas');
        c.width = w; c.height = h;
        c.getContext('2d').drawImage(img, 0, 0, w, h);
        cb(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { cb(null); };
      img.src = r.result;
    };
    r.onerror = function () { cb(null); };
    r.readAsDataURL(file);
  }

  var _pickCb = null;
  window.ccPickImageResult = function (dataUrl) {
    var cb = _pickCb; _pickCb = null;
    if (cb) cb(dataUrl && String(dataUrl).indexOf('data:image') === 0 ? dataUrl : null);
  };

  function pickImage(cb) {
    if (window.__ccNative && window.__ccPickImage) { /* iOS：原生选图 */
      _pickCb = cb;
      window.__ccNative({ type: 'pickImage' });
      return;
    }
    var inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/*';
    inp.onchange = function () {
      var f = inp.files && inp.files[0];
      if (!f) { cb(null); return; }
      compressFile(f, cb);
    };
    inp.click();
  }

  /* OpenAI 兼容的视觉消息内容块 */
  function visionMsg(text, dataUrl) {
    if (!dataUrl) return { role: 'user', content: text };
    return {
      role: 'user',
      content: [{ type: 'text', text: text }, { type: 'image_url', image_url: { url: dataUrl } }]
    };
  }

  /* ------------------------------------------------------------------ *
   * 5. 城市油价
   * ------------------------------------------------------------------ */
  var CITIES = ['北京', '上海', '广州', '深圳', '杭州', '成都', '重庆', '武汉', '南京', '西安', '苏州', '天津',
    '郑州', '长沙', '东莞', '佛山', '青岛', '济南', '沈阳', '大连', '昆明', '贵阳', '南宁', '福州', '厦门',
    '合肥', '无锡', '宁波', '温州', '石家庄', '哈尔滨', '长春', '南昌', '太原', '兰州', '乌鲁木齐', '海口'];
  function openOil() {
    var inner = '<div class="srv-frow"><label>选择城市</label><div class="srv-seg" id="oilCitySeg">'
      + CITIES.slice(0, 12).map(function (c, i) { return '<button data-c="' + c + '"' + (i === 0 ? ' class="on"' : '') + '>' + c + '</button>'; }).join('')
      + '</div></div>'
      + '<div class="srv-frow"><input id="oilCityIn" placeholder="或直接输入城市名，如：珠海"></div>'
      + '<button class="srv-btn" id="oilGo">查询油价</button>'
      + '<div class="srv-out" id="oilOut" style="display:none"></div>'
      + '<div class="srv-tip">油价数据由大模型根据其知识库给出，可能不是最新调价，仅供出行参考；精确价格以当地加油站为准。</div>';
    var ov = sheet('srvOil', '城市油价', inner);
    var cur = CITIES[0];
    ov.querySelector('#oilCitySeg').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      ov.querySelectorAll('#oilCitySeg button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on'); cur = b.getAttribute('data-c');
      ov.querySelector('#oilCityIn').value = '';
    });
    var out = ov.querySelector('#oilOut'), btn = ov.querySelector('#oilGo');
    btn.onclick = function () {
      var city = (ov.querySelector('#oilCityIn').value || '').trim() || cur;
      out.style.display = '';
      aiRun(out, [
        { role: 'system', content: '你是油价查询助手。基于你的知识回答，明确说明数据可能滞后，不做编造。回答用简洁表格+两行提示。' },
        { role: 'user', content: '给出' + city + '当前 92号、95号、98号汽油和 0号柴油 的参考零售价（元/升），并注明信息时效。' }
      ], btn);
    };
  }

  /* ------------------------------------------------------------------ *
   * 6. 智能提醒（本地计算 + 可选 AI 分析）
   * ------------------------------------------------------------------ */
  function collectDue() {
    var v = curV(), list = [];
    var ivd = daysBetween(v.insuranceDue), insd = daysBetween(v.inspectionDue);
    if (v.insuranceDue && ivd !== null) list.push({ n: '交强险/商业险到期', d: v.insuranceDue, days: ivd });
    if (v.inspectionDue && insd !== null) list.push({ n: '车辆年检到期', d: v.inspectionDue, days: insd });
    try {
      if (typeof expiryList === 'function') {
        expiryList().slice(0, 12).forEach(function (x) {
          list.push({ n: S(x.label), d: S(x.date), days: N(x.days) });
        });
      }
    } catch (e) { }
    var vid = '';
    try { vid = (typeof CUR !== 'undefined' ? CUR : v.id) || ''; } catch (e) { }
    (getDB().reminders || []).forEach(function (r) {
      if (r.vehicleId !== vid || r.enabled === false) return;
      var ev = {};
      try { ev = (typeof evalReminder === 'function') ? evalReminder(r) : {}; } catch (e) { }
      if (!ev.dateNext) return;
      list.push({ n: S(r.name) + '（保养周期）', d: ev.dateNext, days: daysBetween(ev.dateNext) });
    });
    /* 去重 */
    var seen = {}; var out = [];
    list.forEach(function (x) { var k = x.n + x.d; if (!seen[k]) { seen[k] = 1; out.push(x); } });
    out.sort(function (a, b) { return a.days - b.days; });
    return out;
  }
  function badge(days) {
    if (days < 0) return '<span class="srv-badge srv-b-bad">已逾期 ' + (-days) + ' 天</span>';
    if (days <= 30) return '<span class="srv-badge srv-b-warn">剩 ' + days + ' 天</span>';
    return '<span class="srv-badge srv-b-ok">剩 ' + days + ' 天</span>';
  }
  function openRemind() {
    var list = collectDue();
    var rows = list.length ? list.map(function (x) {
      return '<div class="srv-rem"><div class="nm">' + esc(x.n) + '<div class="dt">到期：' + esc(x.d) + '</div></div>' + badge(x.days) + '</div>';
    }).join('') : '<div style="padding:16px;text-align:center;color:#7c8ba1;font-size:13.5px">还没有到期事项，去「提醒」页添加保险、年检、保养周期后，这里会自动盯梢。</div>';
    var inner = rows
      + (list.length ? '<button class="srv-btn" id="remGo">让 AI 分析这些到期事项</button><div class="srv-out" id="remOut" style="display:none"></div>' : '')
      + '<div class="srv-tip">数据来自本机记录，仅保存在这台设备上。</div>';
    var ov = sheet('srvRem', '智能提醒', inner);
    ov.querySelector('#remGo') && (ov.querySelector('#remGo').onclick = function () {
      var out = ov.querySelector('#remOut'); out.style.display = '';
      var v = curV();
      aiRun(out, [
        { role: 'system', content: '你是用车顾问。根据用户列出的到期事项清单，按紧急程度排序提醒：哪些马上要办、哪些可以等等、逾期有什么风险（脱保、年检罚则、保险失效）。口语化，200字内。' },
        { role: 'user', content: '我的车辆：' + (S(v.name) || '我的车') + '（' + (S(v.model) || '未知车型') + '）。到期事项：' + JSON.stringify(list) + '。今天是' + todayStr() + '。' }
      ], this);
    });
  }

  /* ------------------------------------------------------------------ *
   * 7. 报告解读（拍照 / 相册 / 粘贴文本）
   * ------------------------------------------------------------------ */
  function openReport() {
    var inner = '<div class="srv-photo"><div class="ph" id="repPh" title="上传报告照片">📷'
      + '</div><div class="ph-t">拍一张保养单据 / 检测报告 / 结算单<br>或直接把报告要点粘贴到下方文本框</div></div>'
      + '<div class="srv-frow"><textarea id="repTxt" placeholder="例如：机油机滤 428元，空调滤芯 120元，工时费 180元，建议 3000公里后复查…"></textarea></div>'
      + '<button class="srv-btn" id="repGo">开始解读</button>'
      + '<div class="srv-out" id="repOut" style="display:none"></div>'
      + '<div class="srv-tip">解读在本机压缩后交给 AI 分析，报告图片不会保存。</div>';
    var ov = sheet('srvRep', '报告解读', inner);
    var img = null;
    var ph = ov.querySelector('#repPh');
    ph.onclick = function () {
      pickImage(function (d) {
        if (!d) return;
        img = d;
        ph.innerHTML = '<img src="' + d + '">';
      });
    };
    ov.querySelector('#repGo').onclick = function () {
      var txt = (ov.querySelector('#repTxt').value || '').trim();
      if (!img && !txt) { toastMsg('先上传照片或粘贴报告内容'); return; }
      var out = ov.querySelector('#repOut'); out.style.display = '';
      var sys = '你是资深汽车维修顾问，帮车主解读保养/维修/检测报告。输出：1)一句话结论 2)关键项目和价格是否合理（若能判断）3)异常项用「⚠️」标出 4)下一步建议。口语化，300字内。不要编造照片里没有的信息。';
      var q = '请解读这份报告。' + (txt ? '报告内容：' + txt : '') + (img && txt ? ' 同时参考上传的照片。' : '');
      aiRun(out, [{ role: 'system', content: sys }, visionMsg(q, img)], this);
    };
  }

  /* ------------------------------------------------------------------ *
   * 8. AI选车
   * ------------------------------------------------------------------ */
  function openPick() {
    var energies = ['不限', '燃油', '纯电', '插电混动', '油电混动'];
    var types = ['不限', '轿车', 'SUV', 'MPV', '两厢小车', '皮卡/越野'];
    var uses = ['日常通勤', '家用带娃', '长途自驾', '商务接待', '跑网约车', '越野撒野'];
    function seg(id, arr, def) {
      return '<div class="srv-frow"><label>' + id.label + '</label><div class="srv-seg" data-seg="' + id.key + '">'
        + arr.map(function (x) { return '<button data-v="' + x + '"' + (x === def ? ' class="on"' : '') + '>' + x + '</button>'; }).join('')
        + '</div></div>';
    }
    var inner = '<div class="srv-frow"><label>预算（万元）</label><input id="pickBudget" type="number" inputmode="decimal" placeholder="如：15（可填区间 12-18）"></div>'
      + seg({ label: '能源类型', key: 'energy' }, energies, '不限')
      + seg({ label: '车型', key: 'body' }, types, '不限')
      + seg({ label: '主要用途', key: 'use' }, uses, '日常通勤')
      + '<div class="srv-frow"><label>其它要求（选填）</label><textarea id="pickMore" placeholder="比如：百公里油耗低于6L、后排要大、保值率高、北方冬天用…"></textarea></div>'
      + '<button class="srv-btn" id="pickGo">让 AI 帮我选车</button>'
      + '<div class="srv-out" id="pickOut" style="display:none"></div>'
      + '<div class="srv-tip">推荐结果由大模型生成，价格和配置以经销商为准。</div>';
    var ov = sheet('srvPick', 'AI选车', inner);
    ov.querySelector('#pickGo').onclick = function () {
      function segV(key) {
        var b = ov.querySelector('[data-seg="' + key + '"] button.on');
        return b ? b.getAttribute('data-v') : '不限';
      }
      var budget = (ov.querySelector('#pickBudget').value || '').trim();
      if (!budget) { toastMsg('先填一下预算'); return; }
      var more = (ov.querySelector('#pickMore').value || '').trim();
      var out = ov.querySelector('#pickOut'); out.style.display = '';
      aiRun(out, [
        { role: 'system', content: '你是懂车的选车顾问，熟悉中国市场在售车型。推荐 3 款最匹配的车（含指导价区间），每款给 2 行推荐理由和 1 个注意点，最后给 1 条比价建议。总长 350 字内。不收厂家广告，客观中立。' },
        { role: 'user', content: '预算' + budget + '万元；能源：' + segV('energy') + '；车型：' + segV('body') + '；用途：' + segV('use') + (more ? '；其它要求：' + more : '') + '。请推荐。' }
      ], this);
    };
  }

  /* ------------------------------------------------------------------ *
   * 9. AI旧车估价
   * ------------------------------------------------------------------ */
  function openUsed() {
    var conds = ['优秀（准新车）', '良好（正常使用）', '一般（明显使用痕迹）', '有过事故或大修'];
    var inner = '<div class="srv-frow"><label>品牌车型</label><input id="usedModel" placeholder="如：大众 迈腾 330TSI 领先型"></div>'
      + '<div class="srv-frow"><label>上牌年份</label><input id="usedYear" type="number" inputmode="numeric" placeholder="如：2021"></div>'
      + '<div class="srv-frow"><label>当前里程（万公里）</label><input id="usedKm" type="number" inputmode="decimal" placeholder="如：6.5"></div>'
      + '<div class="srv-frow"><label>车况</label><div class="srv-seg" id="usedCond">'
      + conds.map(function (c, i) { return '<button data-v="' + c + '"' + (i === 1 ? ' class="on"' : '') + '>' + c.split('（')[0] + '</button>'; }).join('')
      + '</div></div>'
      + '<div class="srv-frow"><label>所在城市（选填）</label><input id="usedCity" placeholder="影响区域行情"></div>'
      + '<button class="srv-btn" id="usedGo">开始估价</button>'
      + '<div class="srv-out" id="usedOut" style="display:none"></div>'
      + '<div class="srv-tip">估价由大模型根据市场行情经验给出，仅供参考；实际成交价以车况检测和线下议价为准。</div>';
    var ov = sheet('srvUsed', 'AI旧车估价', inner);
    ov.querySelector('#usedGo').onclick = function () {
      var m = (ov.querySelector('#usedModel').value || '').trim();
      var y = (ov.querySelector('#usedYear').value || '').trim();
      var km = (ov.querySelector('#usedKm').value || '').trim();
      if (!m || !y || !km) { toastMsg('车型、年份、里程都要填'); return; }
      var cb = ov.querySelector('#usedCond button.on');
      var cond = cb ? cb.getAttribute('data-v') : conds[1];
      var city = (ov.querySelector('#usedCity').value || '').trim();
      var out = ov.querySelector('#usedOut'); out.style.display = '';
      aiRun(out, [
        { role: 'system', content: '你是二手车评估师，熟悉中国二手车市场行情。输出：1)估值区间（万元）2)影响价格的关键因素 3)卖车渠道建议（车商/平台/个人过户）4)一句风险提示。250字内。没有把握就给区间，不编精确数字。' },
        { role: 'user', content: '车型：' + m + '；上牌：' + y + '年；里程：' + km + '万公里；车况：' + cond + (city ? '；城市：' + city : '') + '。请估价。' }
      ], this);
    };
  }

  /* ------------------------------------------------------------------ *
   * 10. 拍照问AI
   * ------------------------------------------------------------------ */
  function openPhoto() {
    var inner = '<div class="srv-photo"><div class="ph" id="phqPh">📷</div>'
      + '<div class="ph-t">拍下仪表盘故障灯 / 异常部件 / 划伤部位<br>AI 帮你看图解答</div></div>'
      + '<div class="srv-frow"><textarea id="phqTxt" placeholder="想问什么？比如：这个故障灯亮了还能开吗？（不填就让你先看图）"></textarea></div>'
      + '<button class="srv-btn" id="phqGo">发送给 AI</button>'
      + '<div class="srv-out" id="phqOut" style="display:none"></div>'
      + '<div class="srv-tip">需要所配置的模型支持看图（视觉能力）。GLM-4V、豆包视觉版、GPT-4o、Gemini 等都支持；纯文本模型会提示不支持。</div>';
    var ov = sheet('srvPhq', '拍照问AI', inner);
    var img = null;
    var ph = ov.querySelector('#phqPh');
    ph.onclick = function () {
      pickImage(function (d) {
        if (!d) return;
        img = d;
        ph.innerHTML = '<img src="' + d + '">';
      });
    };
    ov.querySelector('#phqGo').onclick = function () {
      var txt = (ov.querySelector('#phqTxt').value || '').trim();
      if (!img && !txt) { toastMsg('先拍一张或写点问题'); return; }
      var out = ov.querySelector('#phqOut'); out.style.display = '';
      var sys = '你是汽车维修顾问。看图回答车主问题：先说结论（能不能开/要不要紧），再解释原因，最后给处理建议。涉及制动、转向、气囊、高压电的异常必须提示尽快检修。200字内。';
      aiRun(out, [{ role: 'system', content: sys }, visionMsg(txt || '请看这张照片，帮我分析车怎么了、需要注意什么。', img)], this);
    };
  }

  /* ------------------------------------------------------------------ *
   * 11. 极速救援
   * ------------------------------------------------------------------ */
  function openSOS() {
    var inner = '<div class="srv-resc">'
      + '<a class="r-red" href="tel:122"><b>122</b><span>交通事故报警</span></a>'
      + '<a class="r-org" href="tel:12122"><b>12122</b><span>高速公路救援</span></a>'
      + '<a class="r-grn" href="tel:120"><b>120</b><span>医疗急救</span></a>'
      + '<a class="r-blu" href="tel:114"><b>114</b><span>查号/挪车</span></a>'
      + '</div><div id="sosIns"></div>'
      + '<div class="srv-tip">点击即调起系统拨号盘（不会自动拨出）。拖车、搭电、送油、换胎可拨保险公司免费道路救援电话——保单上都有。</div>';
    var ov = sheet('srvSOS', '极速救援', inner);
    /* 从证照里找保险公司电话 */
    var extra = '';
    try {
      var docs = (getDB().docs || []);
      docs.forEach(function (d) {
        if (/保险|保单/.test(S(d.cat) + S(d.name)) && S(d.company)) extra = S(d.company);
      });
    } catch (e) { }
    if (extra) ov.querySelector('#sosIns').innerHTML = '<div class="srv-rem" style="margin-top:10px"><div class="nm">你的保险公司：' + esc(extra) + '<div class="dt">救援电话见保单，出险先报案</div></div></div>';
  }

  /* ------------------------------------------------------------------ *
   * 12. AI写手
   * ------------------------------------------------------------------ */
  function openWriter() {
    var kinds = ['事故处理报告', '行车总结', '年度用车报告'];
    var inner = '<div class="srv-frow"><label>文档类型</label><div class="srv-seg" id="wrKind">'
      + kinds.map(function (k, i) { return '<button data-v="' + k + '"' + (i === 0 ? ' class="on"' : '') + '>' + k + '</button>'; }).join('')
      + '</div></div>'
      + '<div class="srv-frow" id="wrAccRow"><label>事故经过（时间/地点/经过/责任认定/损失）</label>'
      + '<textarea id="wrAcc" placeholder="例如：11月5日17时许，在××路口与××发生追尾，对方全责，交警认定…维修费…"></textarea></div>'
      + '<button class="srv-btn" id="wrGo">生成文档</button>'
      + '<div class="srv-out" id="wrOut" style="display:none"></div>'
      + '<div class="srv-tip" id="wrTip">生成内容基于本机记录与你的描述，建议核对日期与金额后使用。</div>';
    var ov = sheet('srvWr', 'AI写手', inner);
    ov.querySelector('#wrKind').addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      ov.querySelectorAll('#wrKind button').forEach(function (x) { x.classList.remove('on'); });
      b.classList.add('on');
      var k = b.getAttribute('data-v');
      ov.querySelector('#wrAccRow').style.display = (k === '事故处理报告') ? '' : 'none';
    });
    ov.querySelector('#wrGo').onclick = function () {
      var kb = ov.querySelector('#wrKind button.on');
      var kind = kb ? kb.getAttribute('data-v') : kinds[0];
      var acc = (ov.querySelector('#wrAcc').value || '').trim();
      if (kind === '事故处理报告' && !acc) { toastMsg('先简单描述一下事故经过'); return; }
      var out = ov.querySelector('#wrOut'); out.style.display = '';
      var btn = this;
      if (!aiOK()) { out.innerHTML = '<span style="color:#b26a00">先配置 AI 模型</span>'; aiCfg(); return; }
      btn.disabled = true;
      out.innerHTML = '<span class="ai-cursor"></span>';
      var v = curV();
      var data = window.ccAiSnapText ? window.ccAiSnapText() : '';
      var prompts = {
        '事故处理报告': '写一份正式的事故处理情况报告：事故经过、责任认定、车辆损失、维修安排、费用与理赔进度、遗留事项。基于我给的经过与本机记录，不得虚构数字，未知处用「（待补充）」标注。',
        '行车总结': '基于我的车辆数据（里程、油耗、维保、费用），写一份本月/近期行车总结：里程与油耗概况、维保事项、费用构成、下阶段用车建议。数字直接引用数据。',
        '年度用车报告': '基于我的车辆数据写一份年度用车报告：总里程、总花费（油费/保养/维修/其他）、油耗趋势、维保大事记、来年养护计划。像一份体面的年终总结，适当用小标题。'
      };
      window.ccAiCall([
        { role: 'system', content: '你是专业文书助手，输出结构清晰、可直接复制使用的中文文档，用简洁小标题和条目。' },
        { role: 'system', content: 'DATA=' + data },
        { role: 'user', content: '车辆：' + (S(v.name) || '我的车') + '（' + (S(v.model) || '未知车型') + '）。今天是' + todayStr() + '。请生成：' + kind + '。' + prompts[kind] + (acc ? '\n事故经过描述：' + acc : '') }
      ], {
        onDelta: function (full) { out.innerHTML = mdLite(full) + '<span class="ai-cursor"></span>'; },
        onDone: function (full, err) {
          btn.disabled = false;
          if (err) { out.innerHTML = '<span style="color:#c0392b">请求失败：' + esc(err) + '</span>'; return; }
          out.innerHTML = mdLite(full || '（没有返回内容）')
            + '<button class="srv-ghost" id="wrCopy">复制全文</button>';
          var cp = ov.querySelector('#wrCopy');
          if (cp) cp.onclick = function () {
            var t = String(full || '');
            function done() { toastMsg('已复制'); }
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(done, done);
            else {
              var ta = document.createElement('textarea'); ta.value = t; document.body.appendChild(ta);
              ta.select(); try { document.execCommand('copy'); } catch (e) { } ta.remove(); done();
            }
          };
        }
      });
    };
  }

  /* ------------------------------------------------------------------ *
   * 13. 挂载与导出
   * ------------------------------------------------------------------ */
  function mount() {
    injectStyle();
    render();
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }

  window.ccSrvRender = render;
  window.ccSrvOpen = openById;
})();
