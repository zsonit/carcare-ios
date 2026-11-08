/* ============================================================================
 * 车管家 · AI 车况助手（cc-ai.js）
 *
 * 设计要点
 *  1. 完全自包含：样式、悬浮按钮、首页卡、设置卡、对话页都由本文件注入，
 *     主代码只需一行 <script src="cc-ai.js">，不改动原有结构。
 *  2. 数据即上下文：每次提问都把当前车辆的全部记录压成紧凑 JSON 交给模型，
 *     模型据此判断车况、给建议，并可返回「动作」直接写库。
 *  3. 网络走原生桥：WebView 里直连大模型 API 会被 CORS 拦，统一交给原生发请求，
 *     原生按块回传，前端自己解析 SSE 流，逐字显示。
 *  4. Key 只存本机独立键，不进 DB，不会被 NAS 同步带走。
 * ========================================================================== */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ *
   * 0. 常量
   * ------------------------------------------------------------------ */
  var STORE = 'carCareAI_v1';

  /* 服务商预设：全部 OpenAI 兼容（/chat/completions），只换地址与模型名 */
  var PROV = {
    zhipu: {
      name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
      model: 'glm-4-flash', tip: 'GLM-4-Flash 长期免费，国内直连，额度够个人日常用',
      console: 'https://open.bigmodel.cn/usercenter/apikeys'
    },
    silicon: {
      name: '硅基流动', base: 'https://api.siliconflow.cn/v1/chat/completions',
      model: 'Qwen/Qwen3-8B', tip: '多个小模型永久免费，国内直连',
      console: 'https://cloud.siliconflow.cn/account/ak'
    },
    doubao: {
      name: '火山方舟（豆包）', base: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
      model: 'doubao-lite-32k', tip: 'Lite 每日免费额度大；模型名要填控制台里的接入点/模型 ID',
      console: 'https://console.volcengine.com/ark'
    },
    deepseek: {
      name: 'DeepSeek', base: 'https://api.deepseek.com/v1/chat/completions',
      model: 'deepseek-chat', tip: '不免费但极便宜（百万 token 几毛钱）',
      console: 'https://platform.deepseek.com/api_keys'
    },
    groq: {
      name: 'Groq', base: 'https://api.groq.com/openai/v1/chat/completions',
      model: 'llama-3.3-70b-versatile', tip: '免费开发者层，需能访问境外网络',
      console: 'https://console.groq.com/keys'
    },
    openrouter: {
      name: 'OpenRouter', base: 'https://openrouter.ai/api/v1/chat/completions',
      model: 'deepseek/deepseek-chat-v3.1:free', tip: '带 :free 后缀的模型每天有免费次数',
      console: 'https://openrouter.ai/keys'
    },
    gemini: {
      name: 'Google Gemini', base: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',
      model: 'gemini-2.5-flash', tip: 'AI Studio 免费层，无需绑卡，需能访问境外网络',
      console: 'https://aistudio.google.com/apikey'
    },
    custom: {
      name: '自定义（OpenAI 兼容）', base: '', model: '', tip: '任何兼容 /chat/completions 的地址都能接',
      console: ''
    }
  };

  /* 系统提示词：角色 + 说话方式 + 动作协议 */
  var SYSTEM = [
    '你是「车管家」App 内置的用车顾问，服务对象是一位普通车主。',
    '你会收到一段 JSON（字段名中文），是这位车主当前车辆的全部真实记录：车辆信息、保养提醒、维保记录、加油与油耗、轮胎、配件保修、证照到期、费用统计。',
    '',
    '回答要求：',
    '1. 只依据 DATA 里的数据说话。数据没有的（比如具体故障码、配件价格）就直说没有记录，不要编。',
    '2. 中文口语，先给结论，再给依据。总长不超过 300 字，能用短句和 3 条以内的要点就不用长段落。',
    '3. 谈到里程/时间时给具体数字：还剩多少公里、多少天、上次是多少。',
    '4. 发现数据里有异常（油耗突然升高、保养严重逾期、轮胎花纹接近极限、保修快到期）要主动点出来并说清风险。',
    '5. 涉及制动、转向、高压系统的异常，提示尽快到店，不要给"可以再开一阵"这类判断。',
    '',
    '如果你判断用户在让你"记一笔"或"改一下"，除了文字答复，还要在回答的最后单独输出一个 JSON 代码块，形如：',
    '```json',
    '{"actions":[{"op":"add_fuel","date":"2026-11-08","mileage":32800,"liters":40.3,"amount":313,"grade":"95#","full":true}]}',
    '```',
    '没有要执行的动作就不要输出代码块。一次最多 3 条动作，日期不确定就用今天。',
    '',
    '可用动作：',
    '{"op":"add_service","date":"YYYY-MM-DD","mileage":数字,"kind":"service|repair","cat":"常规保养","items":[{"name":"更换机油","labor":0,"parts":0}],"cost":数字,"shop":"","note":"","fault":"故障现象","diag":"诊断结论"}  记录一次保养或维修',
    '{"op":"add_fuel","date":"","mileage":数字,"liters":数字,"amount":数字,"grade":"95#","full":true,"station":""}  记一次加油',
    '{"op":"add_cost","date":"","type":"停车|洗车|维修|保险|罚款|其他","amount":数字,"note":""}  记一笔其它费用',
    '{"op":"add_odo","date":"","mileage":数字}  里程打卡',
    '{"op":"set_reminder","name":"机油+机滤","months":6,"km":5000}  新建或修改保养周期',
    '{"op":"done_reminder","name":"机油+机滤","date":"","mileage":数字}  标记某项保养已完成，重置周期',
    '{"op":"update_vehicle","mileage":数字,"insuranceDue":"YYYY-MM-DD","inspectionDue":"YYYY-MM-DD"}  更新车辆信息',
    '{"op":"open","screen":"reminders|services|archive|finance|settings"}  打开某个页面'
  ].join('\n');

  var QUICK = ['现在车况怎么样？', '下次该保养什么？', '我的油耗正常吗？', '这个月花了多少？', '帮我记一次加油'];

  /* ------------------------------------------------------------------ *
   * 1. 本地小工具（不复用主脚本，避免加载顺序问题）
   * ------------------------------------------------------------------ */
  function N(v) { var n = parseFloat(v); return isNaN(n) ? 0 : n; }
  function S(v) { return v == null ? '' : String(v); }
  function esc(s) {
    s = s == null ? '' : String(s);
    return s.replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; });
  }
  function todayStr() { var d = new Date(); return d.getFullYear() + '-' + P2(d.getMonth() + 1) + '-' + P2(d.getDate()); }
  function P2(n) { return (n < 10 ? '0' : '') + n; }
  function daysBetween(a, b) {
    if (!a) return null;
    var d1 = new Date(String(a).slice(0, 10)), d2 = b ? new Date(b) : new Date();
    if (isNaN(d1)) return null;
    d1.setHours(0, 0, 0, 0); d2.setHours(0, 0, 0, 0);
    return Math.round((d1 - d2) / 86400000);
  }
  function fmtNum(n) { return (Math.round(N(n) * 10) / 10).toLocaleString('zh-CN'); }
  function getDB() { return (typeof DB !== 'undefined' && DB) ? DB : { vehicles: [], records: [], reminders: [], costs: [] }; }
  function curV() { try { return (typeof curVehicle === 'function' ? curVehicle() : null) || getDB().vehicles[0] || {}; } catch (e) { return {}; } }
  function curId() { try { return (typeof CUR !== 'undefined' ? CUR : (getDB().vehicles[0] || {}).id) || ''; } catch (e) { return ''; } }
  function toastMsg(m) { try { if (typeof toast === 'function') { toast(m); return; } } catch (e) { } }
  function persist() { try { if (typeof save === 'function') save(); } catch (e) { } }
  function redraw() { try { if (typeof renderAll === 'function') renderAll(); } catch (e) { } }
  function uid2() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  /* ------------------------------------------------------------------ *
   * 2. 配置（独立存储，不进 DB，不会被 NAS 同步带走）
   * ------------------------------------------------------------------ */
  var _cfg = null;
  function cfg() {
    if (_cfg) return _cfg;
    var def = { provider: 'zhipu', base: '', model: '', key: '', custom: false };
    try {
      var raw = localStorage.getItem(STORE);
      if (raw) { var o = JSON.parse(raw); _cfg = Object.assign(def, o.cfg || {}); }
    } catch (e) { }
    if (!_cfg) _cfg = def;
    return _cfg;
  }
  function saveCfg(patch) {
    var c = cfg();
    Object.keys(patch || {}).forEach(function (k) { c[k] = patch[k]; });
    try {
      var raw = localStorage.getItem(STORE);
      var o = raw ? JSON.parse(raw) : {};
      o.cfg = c;
      localStorage.setItem(STORE, JSON.stringify(o));
    } catch (e) { }
  }
  function prov() { return PROV[cfg().provider] || PROV.zhipu; }
  function apiBase() { return (cfg().base || prov().base || '').trim(); }
  function apiModel() { return (cfg().model || prov().model || '').trim(); }
  function apiKey() { return (cfg().key || '').trim(); }
  function ready() { return !!(apiKey() && apiBase() && apiModel()); }

  function headersFor(isStream) {
    var h = { 'Content-Type': 'application/json' };
    if (apiKey()) h['Authorization'] = 'Bearer ' + apiKey();
    if (cfg().provider === 'openrouter') {
      h['HTTP-Referer'] = 'https://zsonit.github.io/carcare-ios/';
      h['X-Title'] = 'car-care';
    }
    return h;
  }

  /* ------------------------------------------------------------------ *
   * 3. 对话记录（本机，不参与同步）
   * ------------------------------------------------------------------ */
  var _msgs = null;
  function msgs() {
    if (_msgs) return _msgs;
    try {
      var raw = localStorage.getItem(STORE);
      var o = raw ? JSON.parse(raw) : {};
      _msgs = Array.isArray(o.msgs) ? o.msgs : [];
    } catch (e) { _msgs = []; }
    return _msgs;
  }
  function pushMsg(m) {
    var list = msgs();
    list.push(m);
    while (list.length > 40) list.shift();
    try {
      var raw = localStorage.getItem(STORE);
      var o = raw ? JSON.parse(raw) : {};
      o.msgs = list;
      localStorage.setItem(STORE, JSON.stringify(o));
    } catch (e) { }
  }
  function clearMsgs() {
    _msgs = [];
    try {
      var raw = localStorage.getItem(STORE);
      var o = raw ? JSON.parse(raw) : {};
      o.msgs = [];
      localStorage.setItem(STORE, JSON.stringify(o));
    } catch (e) { }
  }

  /* ------------------------------------------------------------------ *
   * 4. 数据快照：模型看到的全部事实
   * ------------------------------------------------------------------ */
  function snap() {
    var db = getDB(), v = curV(), vid = curId();
    var out = {};
    out.今天 = todayStr();
    out.车辆 = {
      名称: S(v.name), 车型: S(v.model), 车牌: S(v.plate), 动力: S(v.power || 'fuel'),
      表显里程: N(v.mileage), 购车日期: S(v.buyDate),
      保险到期: S(v.insuranceDue), 年检到期: S(v.inspectionDue),
      原厂质保到期: S(v.warrantyEnd), 质保里程: N(v.warrantyKm)
    };
    if (N(v.warrantyKm)) {
      var kmLeftW = N(v.warrantyKm) - N(v.mileage);
      out.车辆.质保剩余公里 = kmLeftW;
    }

    /* 保养提醒：把「还剩多少」算好给模型，避免它自己算错 */
    var rem = [];
    (db.reminders || []).forEach(function (r) {
      if (r.vehicleId !== vid || r.enabled === false) return;
      var ev = {};
      try { ev = (typeof evalReminder === 'function') ? evalReminder(r) : {}; } catch (e) { }
      var item = { 项目: S(r.name), 周期月: N(r.months), 周期公里: N(r.km), 上次日期: S(r.lastDate), 上次里程: N(r.lastMileage) };
      if (ev.dateNext) item.下次日期 = ev.dateNext;
      if (ev.mileNext) item.下次里程 = ev.mileNext;
      var dLeft = daysBetween(ev.dateNext, null);
      if (dLeft !== null) item.剩余天 = dLeft;
      if (N(r.km) > 0) item.剩余公里 = Math.round(N(ev.mileNext) - N(v.mileage));
      item.状态 = ev.status === 'bad' ? '逾期' : (ev.status === 'warn' ? '快到期' : '正常');
      rem.push(item);
    });
    out.保养提醒 = rem;

    /* 维保记录：最近 20 条 */
    var recs = (db.records || []).filter(function (r) { return r.vehicleId === vid; })
      .slice().sort(function (a, b) { return S(b.date).localeCompare(S(a.date)); }).slice(0, 20);
    out.维保记录 = recs.map(function (r) {
      var o = {
        日期: S(r.date), 里程: N(r.mileage), 类别: S(r.cat),
        工单: r.kind === 'repair' ? '维修' : '保养',
        项目: (r.items || []).map(function (i) { return S(i && i.name ? i.name : i); }).filter(Boolean).join('、'),
        金额: N(r.cost), 门店: S(r.shop), 备注: S(r.note)
      };
      if (r.fault) o.故障现象 = S(r.fault);
      if (r.diag) o.诊断 = S(r.diag);
      if (r.rework) o.返修 = true;
      return o;
    });

    /* 加油与油耗 */
    var fuels = (db.fuels || []).filter(function (f) { return f.vehicleId === vid; })
      .slice().sort(function (a, b) { return S(a.date).localeCompare(S(b.date)); });
    out.加油 = fuels.slice(-10).map(function (f) {
      return { 日期: S(f.date), 里程: N(f.mileage), 升: N(f.liters), 金额: N(f.amount), 单价: N(f.price), 油品: S(f.grade), 加满: !!f.full };
    });
    try {
      if (typeof fuelStats === 'function') {
        var st = fuelStats();
        out.油耗 = {
          平均每百公里升: Math.round(N(st.avg) * 10) / 10,
          最近一箱: Math.round(N(st.last) * 10) / 10,
          每公里油费: Math.round(N(st.perKm) * 100) / 100,
          平均油价: Math.round(N(st.priceAvg) * 100) / 100,
          统计里程: N(st.span),
          最近异常升高: !!st.anomaly
        };
      }
    } catch (e) { }

    /* 轮胎 */
    var t = null;
    try { t = (typeof tireOf === 'function') ? tireOf(vid) : (db.tires || []).find(function (x) { return x.vehicleId === vid; }); } catch (e) { }
    if (t) {
      var p = t.pos || {};
      out.轮胎 = {
        品牌: S(t.brand), 规格: S(t.size), 安装日期: S(t.install), DOT: S(t.dot),
        花纹深度毫米: {
          左前: p.fl ? N(p.fl.d) : null, 右前: p.fr ? N(p.fr.d) : null,
          左后: p.rl ? N(p.rl.d) : null, 右后: p.rr ? N(p.rr.d) : null
        }
      };
    }

    /* 配件保修 */
    var parts = (db.parts || []).filter(function (x) { return x.vehicleId === vid; });
    if (parts.length) {
      out.配件保修 = parts.slice(0, 10).map(function (x) {
        var st = {};
        try { st = (typeof partStatus === 'function') ? partStatus(x) : {}; } catch (e) { }
        return { 配件: S(x.name), 安装: S(x.date), 安装里程: N(x.mileage), 保修月: N(x.warrantyMonths), 保修公里: N(x.warrantyKm), 到期: S(st.end), 已过期: st.ok === false };
      });
    }

    /* 证照 / 到期事项 */
    try {
      if (typeof expiryList === 'function') {
        var ex = expiryList().slice(0, 12).map(function (x) {
          return { 事项: S(x.label), 到期: S(x.date), 剩余天: N(x.days) };
        });
        if (ex.length) out.到期事项 = ex;
      }
    } catch (e) { }

    /* 费用：只给汇总，不给逐条，省 token */
    var costs = (db.costs || []).filter(function (c) { return c.vehicleId === vid; });
    var ymKey = todayStr().slice(0, 7), yrKey = todayStr().slice(0, 4);
    var sum = { 本月: 0, 本年: 0, 累计: 0 };
    var byType = {};
    costs.forEach(function (c) {
      var amt = N(c.amount), d = S(c.date);
      sum.累计 += amt;
      if (d.slice(0, 4) === yrKey) sum.本年 += amt;
      if (d.slice(0, 7) === ymKey) sum.本月 += amt;
      var ty = c.type === '油费' ? '加油' : S(c.type || '其他');
      byType[ty] = (byType[ty] || 0) + amt;
    });
    (db.fuels || []).forEach(function (f) {
      if (f.vehicleId !== vid) return;
      var d = S(f.date);
      sum.累计 += N(f.amount);
      if (d.slice(0, 4) === yrKey) sum.本年 += N(f.amount);
      if (d.slice(0, 7) === ymKey) sum.本月 += N(f.amount);
    });
    out.费用 = { 本月: Math.round(sum.本月), 本年: Math.round(sum.本年), 累计维保支出: Math.round(sum.累计), 分类: byType };

    /* 套餐 */
    var plans = (db.plans || []).filter(function (x) { return x.vehicleId === vid; });
    if (plans.length) {
      out.套餐 = plans.map(function (x) {
        return { 名称: S(x.name), 总次数: N(x.total), 已用: N(x.used), 到期: S(x.expire), 门店: S(x.shop) };
      });
    }

    /* 里程打卡（最近 3 次，帮助判断日均里程） */
    var odo = (db.odo || []).filter(function (x) { return x.vehicleId === vid; })
      .slice().sort(function (a, b) { return S(b.date).localeCompare(S(a.date)); }).slice(0, 3);
    if (odo.length) out.里程打卡 = odo.map(function (x) { return { 日期: S(x.date), 里程: N(x.mileage) }; });

    return out;
  }

  function snapText() {
    try { return JSON.stringify(snap()); } catch (e) { return '{}'; }
  }

  /* ------------------------------------------------------------------ *
   * 5. 本地体检（没配 Key 也能用；同时用于首页卡一句话）
   * ------------------------------------------------------------------ */
  function localCheck() {
    var db = getDB(), v = curV(), vid = curId(), lines = [];
    var worst = null;
    (db.reminders || []).forEach(function (r) {
      if (r.vehicleId !== vid || r.enabled === false) return;
      var ev = {};
      try { ev = (typeof evalReminder === 'function') ? evalReminder(r) : {}; } catch (e) { }
      var dLeft = daysBetween(ev.dateNext, null);
      var kmLeft = N(r.km) > 0 ? Math.round(N(ev.mileNext) - N(v.mileage)) : null;
      var score = ev.status === 'bad' ? 1000 : 0;
      score += (dLeft !== null ? -dLeft : 0) + (kmLeft !== null ? -kmLeft / 100 : 0);
      if (!worst || score > worst.score) worst = { r: r, ev: ev, dLeft: dLeft, kmLeft: kmLeft, score: score, status: ev.status };
    });

    if (worst) {
      var w = worst, bits = [];
      if (w.dLeft !== null) bits.push(w.dLeft >= 0 ? (w.dLeft + ' 天后到期') : ('已逾期 ' + (-w.dLeft) + ' 天'));
      if (w.kmLeft !== null) bits.push(w.kmLeft >= 0 ? ('还剩 ' + fmtNum(w.kmLeft) + ' km') : ('超出 ' + fmtNum(-w.kmLeft) + ' km'));
      lines.push({ k: w.status === 'bad' ? 'bad' : 'warn', t: '「' + S(w.r.name) + '」' + (bits.join('，') || '需要关注') });
    }

    try {
      if (typeof expiryList === 'function') {
        var ex = expiryList().filter(function (x) { return x.days <= 60; }).slice(0, 2);
        ex.forEach(function (x) {
          lines.push({ k: x.days < 0 ? 'bad' : 'warn', t: x.label + (x.days < 0 ? ('已过期 ' + (-x.days) + ' 天') : ('还有 ' + x.days + ' 天')), d: x.date });
        });
      }
    } catch (e) { }

    try {
      if (typeof tireOf === 'function') {
        var t = tireOf(vid);
        if (t && t.pos) {
          var min = Math.min(N(t.pos.fl && t.pos.fl.d), N(t.pos.fr && t.pos.fr.d), N(t.pos.rl && t.pos.rl.d), N(t.pos.rr && t.pos.rr.d));
          if (min > 0 && min < 3) lines.push({ k: min < 1.6 ? 'bad' : 'warn', t: '轮胎花纹最浅 ' + min + ' mm，接近 1.6 mm 安全线' });
        }
      }
    } catch (e) { }

    try {
      if (typeof fuelStats === 'function') {
        var st = fuelStats();
        if (st && N(st.avg) > 0) {
          lines.push({ k: st.anomaly ? 'warn' : 'ok', t: '平均油耗 ' + (Math.round(N(st.avg) * 10) / 10) + ' L/100km' + (st.anomaly ? '，最近一箱明显偏高' : '，正常') });
        }
      }
    } catch (e) { }

    var recs = (db.records || []).filter(function (r) { return r.vehicleId === vid; });
    if (recs.length) {
      var lastR = recs.slice().sort(function (a, b) { return S(b.date).localeCompare(S(a.date)); })[0];
      lines.push({ k: 'ok', t: '最近一次到店：' + S(lastR.date) + ' · ' + S(lastR.cat) + ' · ¥' + fmtNum(lastR.cost) });
    }
    if (N(v.mileage)) lines.push({ k: 'ok', t: '表显 ' + fmtNum(v.mileage) + ' km' + (recs.length ? ('，共 ' + recs.length + ' 条维保记录') : '') });
    if (!lines.length) lines.push({ k: 'ok', t: '还没有记录，先添加车辆和保养提醒，我就能帮你看车况。' });
    return lines;
  }

  function localSummary() {
    var l = localCheck();
    return l.slice(0, 2).map(function (x) { return x.t; }).join('；');
  }

  /* ------------------------------------------------------------------ *
   * 6. 请求：优先走原生桥，浏览器里退化为 fetch
   * ------------------------------------------------------------------ */
  var REQ = {};       /* id -> {onDelta,onDone,onError,buf,text,raw,timer} */
  var seq = 0;

  function parseSse(rec, chunk) {
    rec.raw += chunk;
    rec.buf += chunk;
    var idx, guard = 0;
    while ((idx = rec.buf.indexOf('\n')) >= 0 && guard++ < 5000) {
      var line = rec.buf.slice(0, idx);
      rec.buf = rec.buf.slice(idx + 1);
      line = line.replace(/\r$/, '');
      if (!line || line.charAt(0) === ':') continue;
      if (line.indexOf('data:') === 0) {
        var d = line.slice(5).trim();
        if (!d || d === '[DONE]') continue;
        var j = null;
        try { j = JSON.parse(d); } catch (e) { continue; }
        var c = j && j.choices && j.choices[0];
        if (!c) continue;
        var delta = (c.delta && (c.delta.content || c.delta.reasoning_content)) || (c.message && c.message.content) || '';
        if (typeof delta !== 'string') continue;
        if (delta) { rec.text += delta; if (rec.onDelta) rec.onDelta(rec.text); }
      }
    }
  }

  function finish(rec, err) {
    if (rec.done) return;
    rec.done = true;
    clearTimeout(rec.timer);
    if (err) {
      /* 有的服务商忽略 stream:true，直接返回整包 JSON，这里兜底解析 */
      if (!rec.text && rec.raw) {
        var whole = tryWholeJson(rec.raw);
        if (whole) { rec.text = whole; if (rec.onDelta) rec.onDelta(rec.text); }
      }
    }
    delete REQ[rec.id];
    if (rec.onDone) rec.onDone(rec.text, err || null);
  }

  function tryWholeJson(raw) {
    try {
      var j = JSON.parse(String(raw).trim().replace(/^data:\s*/, ''));
      var c = j && j.choices && j.choices[0];
      if (!c) return '';
      return (c.message && c.message.content) || (c.delta && c.delta.content) || '';
    } catch (e) { return ''; }
  }

  function callAI(messages, handlers) {
    var id = 'ai' + (++seq) + Date.now().toString(36);
    var body = {
      model: apiModel(),
      messages: messages,
      stream: true,
      temperature: 0.6,
      max_tokens: 1600
    };
    var rec = {
      id: id, buf: '', text: '', raw: '', done: false,
      onDelta: handlers.onDelta, onDone: handlers.onDone
    };
    rec.timer = setTimeout(function () {
      if (!rec.done) {
        try { if (window.__ccNative) window.__ccNative({ type: 'aiAbort', id: id }); } catch (e) { }
        finish(rec, '等太久了（超过 90 秒），检查一下网络或换个模型');
      }
    }, 90000);
    REQ[id] = rec;

    var url = apiBase();
    if (window.__ccNative) {
      try {
        window.__ccNative({ type: 'ai', id: id, url: url, headers: headersFor(true), body: JSON.stringify(body) });
        return id;
      } catch (e) { delete REQ[id]; clearTimeout(rec.timer); throw new Error('原生通道不可用'); }
    }

    /* 浏览器直连（需要服务商允许跨域；多数国内厂商不允许，仅作兜底） */
    fetch(url, { method: 'POST', headers: headersFor(true), body: JSON.stringify(body) })
      .then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            var msg = 'HTTP ' + r.status;
            try { var j = JSON.parse(t); msg = (j.error && (j.error.message || j.error.code)) || j.message || msg; } catch (e) { }
            finish(rec, msg);
          });
        }
        if (!r.body || !r.body.getReader) {
          return r.text().then(function (t) { var w = tryWholeJson(t); if (w) { rec.text = w; if (rec.onDelta) rec.onDelta(w); } finish(rec); });
        }
        var reader = r.body.getReader(), dec = new TextDecoder('utf-8');
        function pump() {
          return reader.read().then(function (res) {
            if (res.done) { finish(rec); return; }
            parseSse(rec, dec.decode(res.value, { stream: true }));
            return pump();
          });
        }
        return pump();
      })
      .catch(function (e) { finish(rec, e && e.message ? e.message : '网络请求失败'); });
    return id;
  }

  /* 原生回调 */
  window.ccAiChunk = function (id, text) {
    var rec = REQ[id];
    if (!rec || rec.done) return;
    parseSse(rec, String(text == null ? '' : text));
  };
  window.ccAiDone = function (id) {
    var rec = REQ[id];
    if (!rec) return;
    finish(rec);
  };
  window.ccAiError = function (id, msg) {
    var rec = REQ[id];
    if (!rec) return;
    finish(rec, String(msg || '请求失败'));
  };

  /* ------------------------------------------------------------------ *
   * 7. 回复解析：正文 + 动作
   * ------------------------------------------------------------------ */
  function splitReply(raw) {
    var text = String(raw || ''), actions = [];
    var re = /```(?:json|JSON)?\s*([\s\S]*?)```/g, m;
    var cuts = [];
    while ((m = re.exec(text)) !== null) {
      var body = m[1].trim();
      var parsed = null;
      try { parsed = JSON.parse(body); } catch (e) { parsed = null; }
      if (parsed && (parsed.actions || parsed.op)) {
        var arr = parsed.actions || [parsed];
        arr.forEach(function (a) { if (a && a.op) actions.push(a); });
        cuts.push([m.index, m.index + m[0].length]);
      }
    }
    cuts.reverse().forEach(function (c) { text = text.slice(0, c[0]) + text.slice(c[1]); });
    return { text: text.trim(), actions: actions.slice(0, 3) };
  }

  /* 轻量 markdown：粗体、行内代码、列表、换行 */
  function mdLite(src) {
    var t = esc(src || '');
    var lines = t.split('\n'), out = [], inList = false;
    function inline(s) {
      s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
      return s;
    }
    lines.forEach(function (ln) {
      var m = ln.match(/^\s*([-*•])\s+(.*)$/);
      if (m) {
        if (!inList) { out.push('<ul>'); inList = true; }
        out.push('<li>' + inline(m[2]) + '</li>');
        return;
      }
      if (inList) { out.push('</ul>'); inList = false; }
      if (!ln.trim()) { out.push(''); return; }
      var h = ln.match(/^#{1,4}\s+(.*)$/);
      if (h) { out.push('<div class="ai-h">' + inline(h[1]) + '</div>'); return; }
      out.push('<div class="ai-l">' + inline(ln) + '</div>');
    });
    if (inList) out.push('</ul>');
    return out.join('');
  }

  /* ------------------------------------------------------------------ *
   * 8. 动作：描述与执行
   * ------------------------------------------------------------------ */
  var SCREEN_NAME = { reminders: '提醒', services: '记录', archive: '车库', finance: '花费', settings: '设置' };

  function describe(a) {
    var d = S(a.date) || todayStr();
    switch (a.op) {
      case 'add_service':
        var items = (a.items || []).map(function (i) { return S(i && i.name ? i.name : i); }).filter(Boolean);
        return {
          t: (a.kind === 'repair' ? '新增维修工单' : '新增保养记录') + ' · ' + d,
          s: (S(a.cat) || '常规保养') + (items.length ? ' · ' + items.join('、') : '') + (N(a.cost) ? ' · ¥' + fmtNum(a.cost) : '') + (N(a.mileage) ? ' · ' + fmtNum(a.mileage) + ' km' : '')
        };
      case 'add_fuel':
        return { t: '记一次加油 · ' + d, s: (N(a.liters) ? fmtNum(a.liters) + ' L' : '') + (N(a.amount) ? ' · ¥' + fmtNum(a.amount) : '') + (S(a.grade) ? ' · ' + S(a.grade) : '') + (N(a.mileage) ? ' · ' + fmtNum(a.mileage) + ' km' : '') };
      case 'add_cost':
        return { t: '记一笔费用 · ' + d, s: (S(a.type) || '其他') + (N(a.amount) ? ' · ¥' + fmtNum(a.amount) : '') + (S(a.note) ? ' · ' + S(a.note) : '') };
      case 'add_odo':
        return { t: '里程打卡 · ' + d, s: fmtNum(a.mileage) + ' km' };
      case 'set_reminder':
        return { t: '调整保养周期 · ' + (S(a.name) || '未命名'), s: [N(a.months) ? N(a.months) + ' 个月' : '', N(a.km) ? fmtNum(a.km) + ' km' : ''].filter(Boolean).join(' / ') || '未设周期' };
      case 'done_reminder':
        return { t: '完成一次「' + (S(a.name) || '保养') + '」', s: '重置上次保养为 ' + d + (N(a.mileage) ? ' / ' + fmtNum(a.mileage) + ' km' : '') };
      case 'update_vehicle':
        var bits = [];
        if (N(a.mileage)) bits.push('里程 ' + fmtNum(a.mileage) + ' km');
        if (S(a.insuranceDue)) bits.push('保险到期 ' + S(a.insuranceDue));
        if (S(a.inspectionDue)) bits.push('年检到期 ' + S(a.inspectionDue));
        return { t: '更新车辆信息', s: bits.join(' · ') || '—' };
      case 'open':
        return { t: '打开「' + (SCREEN_NAME[a.screen] || a.screen) + '」页', s: '' };
      default:
        return { t: '未识别的操作：' + S(a.op), s: '' };
    }
  }

  function applyAction(a) {
    var db = getDB(), v = curV(), vid = curId();
    var d = S(a.date) || todayStr();
    if (!db.records) db.records = [];
    if (!db.costs) db.costs = [];
    if (!db.fuels) db.fuels = [];
    if (!db.odo) db.odo = [];
    if (!db.reminders) db.reminders = [];

    switch (a.op) {
      case 'add_service': {
        var items = (a.items || []).map(function (i) {
          var name = S(i && i.name ? i.name : i);
          return { name: name, labor: N(i && i.labor), parts: N(i && i.parts) };
        }).filter(function (i) { return i.name; });
        var labor = items.reduce(function (s, i) { return s + i.labor; }, 0);
        var parts = items.reduce(function (s, i) { return s + i.parts; }, 0);
        var rec = {
          id: uid2(), vehicleId: vid, date: d, mileage: N(a.mileage),
          cat: S(a.cat) || '常规保养', items: items, labor: labor, parts: parts,
          cost: a.cost != null && a.cost !== '' ? N(a.cost) : labor + parts,
          shop: S(a.shop), note: S(a.note), receipt: '',
          kind: a.kind === 'repair' ? 'repair' : 'service',
          fault: S(a.fault), diag: S(a.diag), rework: 0
        };
        db.records.unshift(rec);
        if (N(a.mileage) > N(v.mileage)) v.mileage = N(a.mileage);
        break;
      }
      case 'add_fuel': {
        var liters = N(a.liters), amount = N(a.amount);
        db.fuels.unshift({
          id: uid2(), vehicleId: vid, date: d, mileage: N(a.mileage),
          liters: liters, amount: amount,
          price: liters > 0 && amount > 0 ? Math.round(amount / liters * 100) / 100 : 0,
          grade: S(a.grade) || '92#', full: a.full === false ? 0 : 1, station: S(a.station)
        });
        if (N(a.mileage) > N(v.mileage)) v.mileage = N(a.mileage);
        break;
      }
      case 'add_cost': {
        db.costs.unshift({ id: uid2(), vehicleId: vid, type: S(a.type) || '其他', amount: N(a.amount), date: d, note: S(a.note) });
        break;
      }
      case 'add_odo': {
        db.odo.unshift({ id: uid2(), vehicleId: vid, date: d, mileage: N(a.mileage), src: 'AI' });
        if (N(a.mileage) > N(v.mileage)) v.mileage = N(a.mileage);
        break;
      }
      case 'set_reminder': {
        var name = S(a.name);
        if (!name) return '缺少项目名称';
        var hit = db.reminders.find(function (r) { return r.vehicleId === vid && S(r.name) === name; });
        if (hit) {
          if (N(a.months)) hit.months = N(a.months);
          if (a.km != null && a.km !== '') hit.km = N(a.km);
        } else {
          db.reminders.push({
            id: uid2(), vehicleId: vid, name: name,
            basis: N(a.km) > 0 ? 'both' : 'date',
            months: N(a.months), km: N(a.km),
            lastDate: d, lastMileage: N(v.mileage), enabled: true
          });
        }
        break;
      }
      case 'done_reminder': {
        var nm = S(a.name);
        var target = db.reminders.filter(function (r) { return r.vehicleId === vid; })
          .filter(function (r) { return S(r.name) === nm || (nm && S(r.name).indexOf(nm) >= 0) || (nm && nm.indexOf(S(r.name)) >= 0); })[0];
        if (!target) return '没找到「' + nm + '」这条提醒';
        target.lastDate = d;
        target.lastMileage = N(a.mileage) || N(v.mileage);
        break;
      }
      case 'update_vehicle': {
        if (N(a.mileage)) v.mileage = N(a.mileage);
        if (S(a.insuranceDue)) v.insuranceDue = S(a.insuranceDue);
        if (S(a.inspectionDue)) v.inspectionDue = S(a.inspectionDue);
        break;
      }
      case 'open': {
        var sc = S(a.screen);
        if (['reminders', 'services', 'archive', 'finance', 'settings'].indexOf(sc) >= 0) {
          closeAI();
          try { showScreen(sc); } catch (e) { }
        }
        return null;
      }
      default:
        return '不认识这个操作';
    }
    persist();
    redraw();
    return null;
  }

  /* ------------------------------------------------------------------ *
   * 9. 界面：样式
   * ------------------------------------------------------------------ */
  var CSS = ''
    + '.ai-page{position:fixed;inset:0;z-index:59;display:flex;flex-direction:column;'
    + '  background:linear-gradient(180deg,#eef5ff 0%,#e7effb 55%,#e9f1fb 100%);'
    + '  animation:aiIn .24s cubic-bezier(.22,.9,.28,1);}'
    + '@keyframes aiIn{from{opacity:.4;transform:translate3d(8%,0,0)}to{opacity:1;transform:none}}'
    + '.ai-head{flex:none;display:flex;align-items:center;gap:9px;'
    + '  padding:calc(9px + env(safe-area-inset-top)) 13px 9px;'
    + '  background:linear-gradient(180deg,rgba(255,255,255,.92),rgba(255,255,255,.6));'
    + '  -webkit-backdrop-filter:blur(30px) saturate(180%);backdrop-filter:blur(30px) saturate(180%);'
    + '  border-bottom:1px solid rgba(255,255,255,.9);}'
    + '.ai-head .ttl{flex:1;min-width:0}'
    + '.ai-head .ttl b{display:block;font-size:16px;font-weight:800;letter-spacing:-.3px}'
    + '.ai-head .ttl span{display:block;font-size:11px;color:var(--sub,#7c8ba1);margin-top:1px;'
    + '  white-space:nowrap;overflow:hidden;text-overflow:ellipsis}'
    + '.ai-head button{flex:0 0 auto;font-size:13.5px;font-weight:700;color:#0a6fd8;'
    + '  padding:7px 12px;border-radius:999px;background:rgba(10,132,255,.11);border:0}'
    + '.ai-scroll{flex:1;overflow-y:auto;-webkit-overflow-scrolling:touch;padding:12px 13px 4px}'
    + '.ai-msg{display:flex;gap:8px;margin-bottom:11px;align-items:flex-start}'
    + '.ai-msg.u{flex-direction:row-reverse}'
    + '.ai-ava{width:26px;height:26px;border-radius:9px;flex:none;display:flex;align-items:center;'
    + '  justify-content:center;font-size:13px;color:#fff;'
    + '  background:linear-gradient(150deg,#8b5cf6,#4f7cf7 60%,#0a84ff);'
    + '  box-shadow:0 6px 14px -8px rgba(88,86,214,.9)}'
    + '.ai-msg.u .ai-ava{background:linear-gradient(180deg,#5bb0ff,#0a84ff);font-size:11px}'
    + '.ai-bub{max-width:calc(100% - 40px);padding:10px 12px;border-radius:15px;font-size:14px;'
    + '  line-height:1.6;color:var(--ink,#16233a);word-break:break-word;'
    + '  background:rgba(255,255,255,.9);border:1px solid rgba(255,255,255,.95);'
    + '  box-shadow:0 8px 22px -14px rgba(16,44,80,.55)}'
    + '.ai-msg.u .ai-bub{background:linear-gradient(180deg,#4aa5ff,#0a84ff);color:#fff;border-color:rgba(255,255,255,.4);'
    + '  box-shadow:0 10px 22px -12px rgba(10,132,255,.85)}'
    + '.ai-bub .ai-l{margin:0 0 3px}'
    + '.ai-bub .ai-l:last-child{margin-bottom:0}'
    + '.ai-bub .ai-h{font-weight:800;margin:6px 0 3px}'
    + '.ai-bub ul{margin:3px 0 5px;padding-left:17px}'
    + '.ai-bub li{margin:1px 0}'
    + '.ai-bub code{font-family:ui-monospace,Menlo,monospace;font-size:12.5px;'
    + '  background:rgba(16,44,80,.07);padding:1px 5px;border-radius:5px}'
    + '.ai-msg.u .ai-bub code{background:rgba(255,255,255,.22)}'
    + '.ai-cursor{display:inline-block;width:7px;height:15px;vertical-align:-2px;margin-left:2px;'
    + '  background:#0a84ff;border-radius:2px;animation:aiBlink .9s steps(1) infinite}'
    + '@keyframes aiBlink{50%{opacity:0}}'
    + '.ai-act{margin-top:9px;border-radius:13px;overflow:hidden;'
    + '  border:1px solid rgba(10,132,255,.25);background:rgba(10,132,255,.055)}'
    + '.ai-act-h{display:flex;align-items:center;gap:6px;padding:8px 11px;font-size:11.5px;'
    + '  font-weight:800;color:#0a6fd8;letter-spacing:.2px}'
    + '.ai-act-row{display:flex;gap:8px;align-items:center;padding:9px 11px;'
    + '  border-top:1px solid rgba(10,132,255,.15);font-size:12.5px}'
    + '.ai-act-row .g{flex:1;min-width:0}'
    + '.ai-act-row .g b{display:block;font-size:13px;font-weight:750;color:var(--ink,#16233a)}'
    + '.ai-act-row .g span{display:block;color:var(--sub,#7c8ba1);margin-top:1px;font-size:11.5px}'
    + '.ai-act-row .bs{display:flex;gap:6px;flex:none}'
    + '.ai-act-row .bs button{font-size:12px;font-weight:750;padding:6px 11px;border-radius:9px;border:0}'
    + '.ai-act-row .bs .ok{background:linear-gradient(180deg,#4aa5ff,#0a84ff);color:#fff}'
    + '.ai-act-row .bs .no{background:rgba(16,44,80,.07);color:#51627a}'
    + '.ai-act-row .bs button:disabled{opacity:.45}'
    + '.ai-chips{display:flex;gap:7px;overflow-x:auto;padding:0 0 8px;-webkit-overflow-scrolling:touch}'
    + '.ai-chips::-webkit-scrollbar{display:none}'
    + '.ai-chips button{flex:0 0 auto;font-size:12.5px;font-weight:700;color:#0a6fd8;'
    + '  background:rgba(10,132,255,.1);border:1px solid rgba(10,132,255,.18);'
    + '  padding:7px 12px;border-radius:999px;white-space:nowrap}'
    + '.ai-bar{flex:none;padding:6px 10px calc(8px + env(safe-area-inset-bottom));'
    + '  background:linear-gradient(180deg,rgba(255,255,255,.55),rgba(255,255,255,.94));'
    + '  -webkit-backdrop-filter:blur(26px);backdrop-filter:blur(26px);'
    + '  border-top:1px solid rgba(255,255,255,.95)}'
    + '.ai-inrow{display:flex;gap:8px;align-items:flex-end}'
    + '.ai-in{flex:1;min-width:0;max-height:104px;border-radius:19px;background:#fff;'
    + '  border:1px solid rgba(150,175,205,.4);padding:10px 13px;font-size:15px;line-height:1.45;'
    + '  resize:none;outline:none;font-family:inherit;color:var(--ink,#16233a);'
    + '  box-shadow:0 2px 8px -6px rgba(16,44,80,.5)}'
    + '.ai-in:focus{border-color:rgba(10,132,255,.55)}'
    + '.ai-send{width:44px;height:44px;flex:none;border-radius:50%;border:0;color:#fff;font-size:17px;'
    + '  display:flex;align-items:center;justify-content:center;'
    + '  background:linear-gradient(180deg,#4aa5ff,#0a84ff 60%,#0774e6);'
    + '  box-shadow:0 10px 20px -10px rgba(10,132,255,.95),inset 0 1px 0 rgba(255,255,255,.5)}'
    + '.ai-send svg{width:21px;height:21px;fill:none;stroke:#fff;stroke-width:2.2;'
    + '  stroke-linecap:round;stroke-linejoin:round}'
    + '.ai-send:disabled{opacity:.5}'
    + '.ai-hero{background:linear-gradient(150deg,rgba(139,92,246,.14),rgba(10,132,255,.12) 60%,rgba(255,255,255,.5));'
    + '  border:1px solid rgba(255,255,255,.9)}'
    + '.ai-hero .pill{background:rgba(10,132,255,.12);color:#0a6fd8}'
    + '.fab.ai{bottom:calc(96px + env(safe-area-inset-bottom));width:52px;height:52px;font-size:0;'
    + '  background:linear-gradient(150deg,#8b5cf6,#4f7cf7 58%,#0a84ff);'
    + '  box-shadow:0 14px 26px -12px rgba(88,86,214,.95),inset 0 1px 0 rgba(255,255,255,.55)}'
    + '.fab.plus{bottom:calc(158px + env(safe-area-inset-bottom))}'
    + '.fab.ai svg{width:26px;height:26px;fill:none;stroke:#fff;stroke-width:1.7}'
    + '.ai-onboard{margin:4px 0 14px;padding:14px;border-radius:18px;background:rgba(255,255,255,.9);'
    + '  border:1px solid rgba(255,255,255,.95);box-shadow:0 10px 26px -18px rgba(16,44,80,.6)}'
    + '.ai-onboard h4{margin:0 0 6px;font-size:15px;font-weight:800}'
    + '.ai-onboard p{margin:0 0 10px;font-size:12.5px;line-height:1.6;color:var(--sub,#7c8ba1)}'
    + '.ai-onboard .provs{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px}'
    + '.ai-onboard .prov{text-align:left;padding:9px 11px;border-radius:12px;border:1px solid rgba(150,175,205,.32);'
    + '  background:rgba(255,255,255,.9)}'
    + '.ai-onboard .prov b{display:block;font-size:13px;font-weight:750;color:var(--ink,#16233a)}'
    + '.ai-onboard .prov span{display:block;font-size:11px;color:var(--sub,#7c8ba1);margin-top:2px;line-height:1.4}'
    + '.ai-onboard .prov.on{border-color:#0a84ff;background:rgba(10,132,255,.08)}'
    + '.ai-cfgrow{display:flex;align-items:center;gap:8px;margin-top:7px}'
    + '.ai-cfgrow label{flex:0 0 74px;font-size:12.5px;color:var(--sub,#7c8ba1);font-weight:650}'
    + '.ai-cfgrow input,.ai-cfgrow select{flex:1;min-width:0}'
    + '.ai-cfgnote{font-size:11.5px;color:var(--sub,#7c8ba1);line-height:1.55;margin-top:8px}';

  function injectStyle() {
    if (document.getElementById('ccAiStyle')) return;
    var s = document.createElement('style');
    s.id = 'ccAiStyle';
    s.textContent = CSS;
    (document.head || document.documentElement).appendChild(s);
  }

  /* ------------------------------------------------------------------ *
   * 10. 界面：悬浮按钮 + 首页卡 + 设置卡
   * ------------------------------------------------------------------ */
  function iconSpark() {
    return '<svg viewBox="0 0 24 24" aria-hidden="true">'
      + '<path d="M12 3.2l1.7 4.6 4.6 1.7-4.6 1.7L12 15.8l-1.7-4.6L5.7 9.5l4.6-1.7z"/>'
      + '<path d="M18.4 15.2l.8 2.1 2.1.8-2.1.8-.8 2.1-.8-2.1-2.1-.8 2.1-.8z"/>'
      + '</svg>';
  }

  function injectFab() {
    if (document.getElementById('fabAI')) return;
    var b = document.createElement('div');
    b.className = 'fab ai';
    b.id = 'fabAI';
    b.setAttribute('aria-label', 'AI 车况助手');
    b.innerHTML = iconSpark();
    b.onclick = function () { openAI(); };
    document.body.appendChild(b);
    var plus = document.getElementById('fab');
    if (plus) plus.classList.add('plus');
  }

  function injectHomeCard() {
    if (document.getElementById('aiHeroCard')) return;
    var host = document.getElementById('screen-reminders');
    if (!host) return;
    var d = document.createElement('div');
    d.className = 'card ai-hero';
    d.id = 'aiHeroCard';
    d.innerHTML = '<div class="row" style="align-items:center;margin-bottom:3px">'
      + '<h3 style="flex:1;margin:0">AI 车况助手</h3>'
      + '<span class="pill" id="aiHeroPill">未配置</span></div>'
      + '<div class="muted" id="aiHeroText" style="line-height:1.6">读取本机全部记录，回答车况问题，也能直接帮你记账。</div>'
      + '<div class="row" style="margin-top:10px">'
      + '<button class="btn" onclick="openAI()">问问它</button>'
      + '<button class="btn ghost" onclick="openAI(\'settings\')">配置模型</button>'
      + '</div>';
    host.insertBefore(d, host.firstChild);
  }

  function injectSettingCard() {
    if (document.getElementById('aiCfgCard')) return;
    var host = document.getElementById('screen-settings');
    if (!host) return;
    var d = document.createElement('div');
    d.className = 'card';
    d.id = 'aiCfgCard';
    d.innerHTML = '<div class="row" style="align-items:center;margin-bottom:2px">'
      + '<h3 style="flex:1;margin:0">AI 车况助手</h3>'
      + '<span class="pill" id="aiCfgPill">未配置</span></div>'
      + '<div class="muted">接入大模型后，它能看到本机所有保养、维修、加油、花费记录，回答车况问题，也能按你说的直接记账。</div>'
      + '<div id="aiCfgBox" style="margin-top:10px"></div>';
    host.insertBefore(d, host.children[1] || null);
    renderCfgBox();
  }

  function renderCfgBox() {
    var box = document.getElementById('aiCfgBox');
    if (!box) return;
    var c = cfg(), p = prov();
    var opts = Object.keys(PROV).map(function (k) {
      return '<option value="' + k + '"' + (c.provider === k ? ' selected' : '') + '>' + esc(PROV[k].name) + '</option>';
    }).join('');
    box.innerHTML = '<div class="ai-cfgrow"><label>服务商</label><select id="aiProv" onchange="ccAiPickProvider(this.value)">' + opts + '</select></div>'
      + '<div class="ai-cfgnote" id="aiProvTip">' + esc(p.tip) + (p.console ? '　<a href="' + p.console + '" target="_blank" style="color:#0a6fd8;white-space:nowrap">申请 Key →</a>' : '') + '</div>'
      + '<div class="ai-cfgrow"><label>API Key</label><input id="aiKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="粘贴你的 Key" value="' + esc(c.key) + '" oninput="ccAiSetKey(this.value)"></div>'
      + '<div class="ai-cfgrow"><label>模型名</label><input id="aiModel" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + esc(p.model || 'model-id') + '" value="' + esc(c.model || '') + '" onchange="ccAiSetModel(this.value)"></div>'
      + '<div class="ai-cfgrow"><label>接口地址</label><input id="aiBase" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + esc(p.base || 'https://…/v1/chat/completions') + '" value="' + esc(c.base || '') + '" onchange="ccAiSetBase(this.value)"></div>'
      + '<div class="row" style="margin-top:10px">'
      + '<button class="btn" onclick="ccAiTest()">测试连接</button>'
      + '<button class="btn ghost" onclick="ccAiClear()">清空对话</button>'
      + '</div>'
      + '<div class="note" id="aiCfgState">状态：未配置</div>'
      + '<div class="ai-cfgnote">Key 只存在这台手机上，不进数据备份、不上传任何服务器。留空则模型名/接口地址用默认值；换模型只改模型名即可。</div>';
    updatePills();
  }

  function updatePills() {
    var ok = ready();
    var t = ok ? (prov().name + ' · ' + apiModel()) : '未配置';
    ['aiCfgPill', 'aiHeroPill'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.textContent = t;
    });
    var st = document.getElementById('aiCfgState');
    if (st) st.textContent = ok ? ('状态：已配置（' + prov().name + '），点「测试连接」确认能通') : '状态：未配置，先选服务商并填 Key';
  }

  function renderHero() {
    var el = document.getElementById('aiHeroText');
    if (!el) return;
    el.textContent = localSummary();
    updatePills();
  }

  /* ------------------------------------------------------------------ *
   * 11. 对话页
   * ------------------------------------------------------------------ */
  var PAGE = null, scrollEl = null, listEl = null, inputEl = null, sendBtn = null;

  function openAI(tab) {
    injectStyle();
    closeAI();
    var el = document.createElement('div');
    el.className = 'ai-page';
    el.id = 'aiPage';
    el.innerHTML = '<div class="ai-head">'
      + '<div class="ttl"><b>AI 车况助手</b><span id="aiSub">' + (ready() ? esc(prov().name + ' · ' + apiModel()) : '还没配置模型') + '</span></div>'
      + '<button onclick="ccAiOpenCfg()">设置</button>'
      + '<button onclick="closeAI()">关闭</button>'
      + '</div>'
      + '<div class="ai-scroll" id="aiScroll"><div id="aiList"></div></div>'
      + '<div class="ai-bar">'
      + '<div class="ai-chips" id="aiChips"></div>'
      + '<div class="ai-inrow">'
      + '<textarea class="ai-in" id="aiIn" rows="1" placeholder="问点什么，比如：下次该保养什么？"></textarea>'
      + '<button class="ai-send" id="aiSend" onclick="ccAiSend()" aria-label="发送">'
      + '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"/>'
      + '<path d="M5.6 11.4 12 5l6.4 6.4"/></svg>'
      + '</button>'
      + '</div></div>';
    document.body.appendChild(el);
    PAGE = el;
    scrollEl = el.querySelector('#aiScroll');
    listEl = el.querySelector('#aiList');
    inputEl = el.querySelector('#aiIn');
    sendBtn = el.querySelector('#aiSend');

    injectStyle();

    var chips = el.querySelector('#aiChips');
    chips.innerHTML = QUICK.map(function (q) {
      return '<button onclick="ccAiAsk(' + JSON.stringify(q).replace(/"/g, '&quot;') + ')">' + esc(q) + '</button>';
    }).join('');

    inputEl.addEventListener('input', function () {
      inputEl.style.height = 'auto';
      inputEl.style.height = Math.min(104, inputEl.scrollHeight) + 'px';
    });
    inputEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); }
    });

    renderThread();
    if (tab === 'settings') setTimeout(openCfgSheet, 60);
    setTimeout(function () { if (inputEl && ready()) inputEl.focus(); }, 260);
  }

  function closeAI() {
    var el = document.getElementById('aiPage');
    if (el) el.remove();
    PAGE = null;
  }

  function nearBottom() {
    if (!scrollEl) return true;
    return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 90;
  }
  function toBottom(force) {
    if (!scrollEl) return;
    if (!force && !nearBottom()) return;
    scrollEl.scrollTop = scrollEl.scrollHeight;
  }

  function renderThread() {
    if (!listEl) return;
    var list = msgs();
    var html = '';
    if (!ready()) html += onboardHtml();
    list.forEach(function (m, i) {
      html += msgHtml(m, i);
    });
    if (!list.length && ready()) {
      html += '<div class="ai-msg"><div class="ai-ava">AI</div><div class="ai-bub">'
        + '<div class="ai-l">我已经读了你车上的记录。想问什么直接说，也可以点下面的常见问题。</div>'
        + '<div class="ai-l" style="color:#7c8ba1;font-size:12.5px;margin-top:6px">例如「现在车况怎么样」「下次该保养什么」</div>'
        + '</div></div>';
    }
    listEl.innerHTML = html;
    toBottom(true);
  }

  function onboardHtml() {
    var c = cfg();
    var keys = ['zhipu', 'silicon', 'doubao', 'deepseek'];
    return '<div class="ai-onboard" id="aiOnboard">'
      + '<h4>先接入一个模型</h4>'
      + '<p>选一家服务商，把 API Key 填进去就能用。推荐智谱 GLM-4-Flash（长期免费、国内直连）。Key 只存本机。</p>'
      + '<div class="provs">' + keys.map(function (k) {
        return '<button class="prov' + (c.provider === k ? ' on' : '') + '" onclick="ccAiPickProvider(\'' + k + '\');ccAiOpenCfg()">'
          + '<b>' + esc(PROV[k].name) + '</b><span>' + esc(PROV[k].tip) + '</span></button>';
      }).join('') + '</div>'
      + '<button class="btn" style="width:100%" onclick="ccAiOpenCfg()">填 API Key</button>'
      + '</div>';
  }

  function msgHtml(m, idx) {
    if (m.role === 'user') {
      return '<div class="ai-msg u"><div class="ai-ava">我</div><div class="ai-bub">' + esc(m.content).replace(/\n/g, '<br>') + '</div></div>';
    }
    var html = '<div class="ai-msg"><div class="ai-ava">AI</div><div class="ai-bub" id="aiBub' + idx + '">' + mdLite(m.content) + '</div></div>';
    if (m.actions && m.actions.length) html += actHtml(m.actions, idx);
    return html;
  }

  function actHtml(actions, idx) {
    var rows = actions.map(function (a, j) {
      var d = describe(a);
      var applied = !!(a._done);
      return '<div class="ai-act-row"><div class="g"><b>' + esc(d.t) + '</b>' + (d.s ? '<span>' + esc(d.s) + '</span>' : '') + '</div>'
        + '<div class="bs">'
        + '<button class="no" onclick="ccAiSkip(' + idx + ',' + j + ')">忽略</button>'
        + '<button class="ok" onclick="ccAiApply(' + idx + ',' + j + ')"' + (applied ? ' disabled' : '') + '>' + (applied ? '已应用' : '应用') + '</button>'
        + '</div></div>';
    }).join('');
    return '<div class="ai-act" style="margin:0 0 12px 34px">'
      + '<div class="ai-act-h">识别到 ' + actions.length + ' 个操作，确认后才会写入</div>' + rows + '</div>';
  }

  function send() {
    if (!inputEl) return;
    var text = (inputEl.value || '').trim();
    if (!text) return;
    if (!ready()) { openCfgSheet(); return; }
    inputEl.value = '';
    inputEl.style.height = 'auto';
    ask(text);
  }

  function ask(text) {
    if (PAGE == null) openAI();
    if (!ready()) { openCfgSheet(); return; }
    pushMsg({ role: 'user', content: text });
    var aiMsg = { role: 'assistant', content: '', actions: [] };
    pushMsg(aiMsg);

    renderThread();
    var idx = msgs().length - 1;
    var bub = document.getElementById('aiBub' + idx);
    if (bub) bub.innerHTML = '<span class="ai-cursor"></span>';
    toBottom(true);

    var history = msgs().slice(-8).filter(function (m) { return m.role === 'user' || (m.role === 'assistant' && m.content); })
      .map(function (m) { return { role: m.role, content: String(m.content || '').slice(0, 2000) }; });
    history = [{ role: 'system', content: SYSTEM }, { role: 'system', content: 'DATA=' + snapText() }].concat(history);

    if (sendBtn) sendBtn.disabled = true;
    var lastPaint = 0;
    callAI(history, {
      onDelta: function (full) {
        var now = Date.now();
        if (now - lastPaint < 60) return;
        lastPaint = now;
        /* 流式过程中动作 JSON 还没写完，先把 ``` 之后的内容藏起来 */
        var raw = String(full || '');
        var cut = raw.indexOf('```');
        var visible = cut >= 0 ? raw.slice(0, cut) : raw;
        if (bub) { bub.innerHTML = mdLite(visible) + '<span class="ai-cursor"></span>'; toBottom(); }
      },
      onDone: function (full, err) {
        if (sendBtn) sendBtn.disabled = false;
        var parsed = splitReply(full || '');
        aiMsg.content = parsed.text || (err ? '' : '（没有返回内容，换个模型再试试）');
        aiMsg.actions = parsed.actions;
        if (err) {
          aiMsg.content = '请求失败：' + err + '\n\n' + (parsed.text || '');
          aiMsg.actions = [];
        }
        saveMsgs();
        renderThread();
        toBottom(false);
      }
    });
  }

  function saveMsgs() {
    try {
      var raw = localStorage.getItem(STORE);
      var o = raw ? JSON.parse(raw) : {};
      o.msgs = msgs();
      o.cfg = cfg();
      localStorage.setItem(STORE, JSON.stringify(o));
    } catch (e) { }
  }

  /* ------------------------------------------------------------------ *
   * 12. 配置面板（对话页里也能直接改）
   * ------------------------------------------------------------------ */
  function openCfgSheet() {
    var el = document.getElementById('aiCfgSheet');
    if (el) el.remove();
    var c = cfg(), p = prov();
    var box = document.createElement('div');
    box.id = 'aiCfgSheet';
    box.style.cssText = 'position:fixed;inset:0;z-index:61;background:rgba(12,26,45,.32);display:flex;align-items:flex-end;'
      + '-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px)';
    box.onclick = function (e) { if (e.target === box) box.remove(); };
    box.innerHTML = '<div style="width:100%;max-height:88%;overflow:auto;border-radius:22px 22px 0 0;'
      + 'background:linear-gradient(180deg,#f7fbff,#eef4fc);padding:16px 16px calc(18px + env(safe-area-inset-bottom));'
      + 'box-shadow:0 -18px 40px -20px rgba(16,44,80,.6)">'
      + '<div style="display:flex;align-items:center;margin-bottom:10px">'
      + '<b style="flex:1;font-size:16px;font-weight:800">AI 模型设置</b>'
      + '<button style="font-size:13.5px;font-weight:700;color:#0a6fd8;padding:6px 12px;border-radius:999px;'
      + 'background:rgba(10,132,255,.11);border:0" onclick="ccAiCloseCfg()">完成</button></div>'
      + '<div class="ai-cfgrow"><label>服务商</label><select id="aiProv2" onchange="ccAiPickProvider(this.value)">'
      + Object.keys(PROV).map(function (k) { return '<option value="' + k + '"' + (c.provider === k ? ' selected' : '') + '>' + esc(PROV[k].name) + '</option>'; }).join('')
      + '</select></div>'
      + '<div class="ai-cfgnote" id="aiProvTip2">' + esc(p.tip) + (p.console ? '　<a href="' + p.console + '" target="_blank" style="color:#0a6fd8;white-space:nowrap">申请 Key →</a>' : '') + '</div>'
      + '<div class="ai-cfgrow"><label>API Key</label><input id="aiKey2" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="粘贴你的 Key" value="' + esc(c.key) + '" oninput="ccAiSetKey(this.value)"></div>'
      + '<div class="ai-cfgrow"><label>模型名</label><input id="aiModel2" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + esc(p.model || 'model-id') + '" value="' + esc(c.model || '') + '" onchange="ccAiSetModel(this.value)"></div>'
      + '<div class="ai-cfgrow"><label>接口地址</label><input id="aiBase2" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="' + esc(p.base || 'https://…/v1/chat/completions') + '" value="' + esc(c.base || '') + '" onchange="ccAiSetBase(this.value)"></div>'
      + '<div class="row" style="margin-top:12px"><button class="btn" onclick="ccAiTest()">测试连接</button>'
      + '<button class="btn ghost" onclick="ccAiClear()">清空对话</button></div>'
      + '<div class="note" id="aiCfgState2">' + (ready() ? '状态：已配置' : '状态：未配置') + '</div>'
      + '<div class="ai-cfgnote">推荐智谱 GLM-4-Flash：长期免费、国内直连。额度政策各家会变，以控制台为准；想换模型只改「模型名」即可。'
      + 'Key 只存本机，不参与备份同步。</div>'
      + '</div>';
    document.body.appendChild(box);
  }

  function closeCfgSheet() {
    var el = document.getElementById('aiCfgSheet');
    if (el) el.remove();
    if (PAGE) { renderThread(); var sub = document.getElementById('aiSub'); if (sub) sub.textContent = ready() ? (prov().name + ' · ' + apiModel()) : '还没配置模型'; }
    renderCfgBox();
    updatePills();
  }

  /* ------------------------------------------------------------------ *
   * 13. 对外动作（供内联 onclick 调用）
   * ------------------------------------------------------------------ */
  function pickProvider(k) {
    var p = PROV[k] || PROV.zhipu;
    saveCfg({ provider: k, base: '', model: '' });
    var tip1 = document.getElementById('aiProvTip'), tip2 = document.getElementById('aiProvTip2');
    var html = esc(p.tip) + (p.console ? '　<a href="' + p.console + '" target="_blank" style="color:#0a6fd8;white-space:nowrap">申请 Key →</a>' : '');
    if (tip1) tip1.innerHTML = html;
    if (tip2) tip2.innerHTML = html;
    var m1 = document.getElementById('aiModel'), m2 = document.getElementById('aiModel2');
    if (m1) m1.value = '';
    if (m2) m2.value = '';
    var b1 = document.getElementById('aiBase'), b2 = document.getElementById('aiBase2');
    if (b1) b1.value = '';
    if (b2) b2.value = '';
    var r1 = document.getElementById('aiBase'), r2 = document.getElementById('aiBase2');
    if (r1) r1.placeholder = p.base || 'https://…/v1/chat/completions';
    if (r2) r2.placeholder = p.base || 'https://…/v1/chat/completions';
    var m3 = document.getElementById('aiModel'), m4 = document.getElementById('aiModel2');
    if (m3) m3.placeholder = p.model || 'model-id';
    if (m4) m4.placeholder = p.model || 'model-id';
    updatePills();
  }
  function setKey(v) { saveCfg({ key: String(v || '').trim() }); updatePills(); }
  function setModel(v) { saveCfg({ model: String(v || '').trim() }); updatePills(); }
  function setBase(v) { saveCfg({ base: String(v || '').trim() }); updatePills(); }

  function testConn() {
    if (!apiKey()) { toastMsg('先填 API Key'); return; }
    var st = document.getElementById('aiCfgState') || document.getElementById('aiCfgState2');
    function say(s) { if (st) st.textContent = '状态：' + s; }
    say('正在测试…');
    var got = '';
    callAI([
      { role: 'system', content: '你是连通性测试助手，只回一句话。' },
      { role: 'user', content: '只回复两个字：正常' }
    ], {
      onDelta: function (t) { got = t; },
      onDone: function (t, err) {
        if (err) { say('连接失败：' + err); toastMsg('连接失败'); return; }
        say('连接正常，模型回复：' + String(t || '').slice(0, 40));
        toastMsg('连接正常');
      }
    });
  }

  function clearChat() {
    clearMsgs();
    if (PAGE) renderThread();
    toastMsg('对话已清空');
  }

  function applyOne(idx, j) {
    var list = msgs();
    var m = list[idx];
    if (!m || !m.actions || !m.actions[j]) return;
    var a = m.actions[j];
    var err = applyAction(a);
    if (err) { toastMsg(err); return; }
    a._done = true;
    saveMsgs();
    renderThread();
    toastMsg('已写入');
  }
  function skipOne(idx, j) {
    var list = msgs();
    var m = list[idx];
    if (!m || !m.actions || !m.actions[j]) return;
    m.actions.splice(j, 1);
    saveMsgs();
    renderThread();
  }

  /* ------------------------------------------------------------------ *
   * 14. 挂载
   * ------------------------------------------------------------------ */
  function mount() {
    injectStyle();
    injectFab();
    injectHomeCard();
    injectSettingCard();
    renderHero();
  }

  /* 主脚本渲染时同步刷新首页卡的一句话（不侵入主逻辑） */
  function hookRender() {
    var prev = window.xRenderAll;
    window.xRenderAll = function () {
      try { if (typeof prev === 'function') prev.apply(this, arguments); } catch (e) { }
      try { injectFab(); injectHomeCard(); renderHero(); updatePills(); } catch (e) { }
    };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { mount(); hookRender(); });
  } else {
    mount(); hookRender();
  }

  /* 全局导出 */
  window.openAI = openAI;
  window.closeAI = closeAI;
  window.ccAiAsk = function (q) { ask(q); };
  window.ccAiSend = send;
  window.ccAiPickProvider = pickProvider;
  window.ccAiSetKey = setKey;
  window.ccAiSetModel = setModel;
  window.ccAiSetBase = setBase;
  window.ccAiTest = testConn;
  window.ccAiClear = clearChat;
  window.ccAiApply = applyOne;
  window.ccAiSkip = skipOne;
  window.ccAiOpenCfg = openCfgSheet;
  window.ccAiCloseCfg = closeCfgSheet;
  window.ccAiSnap = snap;          /* 调试用 */
  window.ccAiLocal = localCheck;   /* 调试用 */

  /* 截图/自测用：仅在地址带 aitest 时开放，正常使用不会出现 */
  if (String(location.search + location.hash).indexOf('aitest') >= 0) {
    window.__ccAiSeed = function (list) {
      clearMsgs();
      (list || []).forEach(pushMsg);
      if (PAGE) renderThread();
    };
  }
})();
