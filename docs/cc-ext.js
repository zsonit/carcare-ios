/* ============================================================================
 * 车管家 · 增强模块（在 index.html 主脚本之前加载）
 * 覆盖：加油与油耗 / 证照到期 / 里程打卡 / 证件文档库 / 车型周期模板 /
 *       轮胎四轮档案 / 配件保修卡 / 故障灯与症状自查 / 维修工单 /
 *       季节保养清单 / 到期日历 / 每公里成本 / 套餐储值 /
 *       本地定时通知排程 / 车辆履历导出 / 语音记账
 * 约定：本文件只做定义，不在顶层读写 DB（DB 在后面的主脚本里声明）。
 * ========================================================================== */

/* ---------- 小工具 ---------- */
function xNum(v, d) { const n = parseFloat(v); return isNaN(n) ? (d || 0) : n; }
function xDays(s) {
  if (!s) return null;
  const d = new Date(String(s).slice(0, 10) + 'T00:00:00');
  if (isNaN(d)) return null;
  const n = new Date(); n.setHours(0, 0, 0, 0);
  return Math.round((d - n) / 86400000);
}
function xPad(n) { return String(n).padStart(2, '0'); }
function xYm(d) { return d.getFullYear() + '-' + xPad(d.getMonth() + 1); }
function xMoney(n) { return '¥' + fmt(Math.round((+n || 0) * 100) / 100); }

/* ---------- 修复老数据 ---------- */
function xEnsureArrays() {
  ['fuels', 'charges', 'odo', 'docs', 'tires', 'tireLogs', 'parts', 'plans'].forEach(k => {
    if (!Array.isArray(DB[k])) DB[k] = [];
  });
  DB.seasonCheck = DB.seasonCheck || {};
  DB.settings = Object.assign({
    push: false, lead: 7, notiTime: '09:00', quietStart: '22:00', quietEnd: '07:00',
    badge: true, seasonal: true
  }, DB.settings || {});
  DB.vehicles.forEach(v => {
    if (v.warrantyEnd === undefined) v.warrantyEnd = '';
    if (v.warrantyKm === undefined) v.warrantyKm = 0;
    if (v.firstDue === undefined) v.firstDue = '';
  });
  DB.records.forEach(r => { if (!r.kind) r.kind = 'service'; });
}

/* ============================================================================
 * 一、证照与到期事项
 * ========================================================================== */
function expiryList() {
  const v = curVehicle() || {};
  const out = [];
  const push = (date, label, sub) => {
    const dd = xDays(date);
    if (dd === null) return;
    out.push({ date: String(date).slice(0, 10), label, sub: sub || '', days: dd, st: dd < 0 ? 'bad' : dd <= 30 ? 'warn' : 'ok' });
  };
  push(v.insuranceDue, '保险到期', v.insurer ? v.insurer : '');
  push(v.inspectionDue, '年检到期', '');
  push(v.warrantyEnd, '原厂质保到期', v.warrantyKm ? ('或 ' + fmt(v.warrantyKm) + ' km') : '');
  DB.docs.filter(d => d.expire && (d.vehicleId === CUR || (!d.vehicleId && d.cat === '驾驶证'))).forEach(d => {
    if (d.cat === '保险单' && v.insuranceDue) return;   // 与车辆字段重复
    if (d.cat === '年检' && v.inspectionDue) return;
    push(d.expire, (d.name || d.cat), d.company || d.no || '');
  });
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

function renderExpiry() {
  const box = document.getElementById('expiryList');
  if (!box) return;
  const list = expiryList();
  if (!list.length) {
    box.innerHTML = '<div class="muted">还没有到期记录。点右上「+ 添加」，把保险、年检、驾照、质保的到期日记进来，到期前会推送提醒。</div>';
    return;
  }
  box.innerHTML = list.slice(0, 6).map(x => {
    const cls = x.st;
    const txt = x.days < 0 ? ('逾期 ' + (-x.days) + ' 天') : (x.days === 0 ? '今天到期' : (x.days + ' 天后'));
    return '<div class="item"><div class="t"><span class="sp">' + esc(x.label) + '</span>'
      + '<span class="pill ' + cls + '">' + txt + '</span></div>'
      + '<div class="s">' + x.date + (x.sub ? '　' + esc(x.sub) : '') + '</div></div>';
  }).join('');
}

/* ============================================================================
 * 二、到期日历
 * ========================================================================== */
let calCursor = null, calSelected = '';

/* 里程基准的提醒按「日均行驶」折算成预计日期，才能落到日历上 */
function avgDailyKm() {
  const rows = [];
  DB.odo.filter(o => o.vehicleId === CUR).forEach(o => rows.push({ d: o.date, m: xNum(o.mileage) }));
  DB.fuels.filter(f => f.vehicleId === CUR).forEach(f => rows.push({ d: f.date, m: xNum(f.mileage) }));
  DB.records.filter(r => r.vehicleId === CUR).forEach(r => rows.push({ d: r.date, m: xNum(r.mileage) }));
  const ok = rows.filter(r => r.d && r.m > 0).sort((a, b) => a.d.localeCompare(b.d));
  if (ok.length < 2) return 0;
  const a = ok[0], b = ok[ok.length - 1];
  const days = (new Date(b.d) - new Date(a.d)) / 86400000;
  const km = b.m - a.m;
  if (days < 7 || km <= 0) return 0;
  const v = km / days;
  return v > 0.5 && v < 1000 ? v : 0;   // 异常值丢弃
}

function dueMap() {
  const map = {};
  const add = (d, label, st) => {
    if (!d) return;
    const k = String(d).slice(0, 10);
    (map[k] = map[k] || []).push({ label, st: st || 'warn' });
  };
  const v = curVehicle() || {};
  DB.reminders.filter(r => r.vehicleId === CUR).forEach(r => {
    const e = evalReminder(r);
    const st = e.status === 'bad' ? 'bad' : 'warn';
    if (e.dateNext) add(e.dateNext, r.name, st);
    if ((r.basis === 'mileage' || r.basis === 'both') && +r.km > 0) {
      const rem = xNum(r.lastMileage) + xNum(r.km) - xNum(v.mileage);
      const dd = avgDailyKm();
      if (dd > 0 && rem > 0) {
        const d2 = new Date(); d2.setDate(d2.getDate() + Math.round(rem / dd));
        add(d2.toISOString().slice(0, 10), r.name + '（估）', st);
      }
    }
  });
  expiryList().forEach(x => add(x.date, x.label, x.st));
  DB.parts.filter(p => p.vehicleId === CUR).forEach(p => {
    const w = partWarrantyEnd(p);
    if (w) add(w, p.name + ' 保修到期', 'warn');
  });
  DB.records.filter(r => r.vehicleId === CUR).forEach(r => add(r.date, r.cat, 'done'));
  return map;
}

function calMove(n) {
  if (!calCursor) { const d = new Date(); calCursor = { y: d.getFullYear(), m: d.getMonth() }; }
  calCursor.m += n;
  if (calCursor.m < 0) { calCursor.m = 11; calCursor.y--; }
  if (calCursor.m > 11) { calCursor.m = 0; calCursor.y++; }
  calSelected = '';
  renderCalendar();
}
function calPick(ds) { calSelected = (calSelected === ds ? '' : ds); renderCalendar(); }

function renderCalendar() {
  const grid = document.getElementById('calGrid');
  if (!grid) return;
  if (!calCursor) { const d = new Date(); calCursor = { y: d.getFullYear(), m: d.getMonth() }; }
  const y = calCursor.y, m = calCursor.m;
  const title = document.getElementById('calTitle');
  if (title) title.textContent = y + ' 年 ' + (m + 1) + ' 月';
  const first = new Date(y, m, 1);
  const start = first.getDay();
  const dim = new Date(y, m + 1, 0).getDate();
  const prevDim = new Date(y, m, 0).getDate();
  const map = dueMap();
  const ts = today();
  let html = '';
  ['日', '一', '二', '三', '四', '五', '六'].forEach(d => { html += '<div class="cal-dow">' + d + '</div>'; });
  for (let i = start - 1; i >= 0; i--) html += '<div class="cal-cell dim">' + (prevDim - i) + '</div>';
  for (let d = 1; d <= dim; d++) {
    const ds = y + '-' + xPad(m + 1) + '-' + xPad(d);
    const items = map[ds] || [];
    const dots = items.slice(0, 3).map(it => '<i class="' + it.st + '"></i>').join('');
    const cls = 'cal-cell' + (ds === ts ? ' today' : '') + (ds === calSelected ? ' sel' : '');
    html += '<div class="' + cls + '" onclick="calPick(\'' + ds + '\')">' + d + '<div class="dt">' + dots + '</div></div>';
  }
  const rest = (7 - ((start + dim) % 7)) % 7;
  for (let d = 1; d <= rest; d++) html += '<div class="cal-cell dim">' + d + '</div>';
  grid.innerHTML = html;

  const day = document.getElementById('calDay');
  if (!day) return;
  if (!calSelected) {
    day.innerHTML = '点日期看当天事项；蓝点＝到期提醒，红点＝已逾期。虚线无标记的日子不会有事。';
    return;
  }
  const items = map[calSelected] || [];
  day.innerHTML = '<b>' + calSelected + '</b><br>'
    + (items.length ? items.map(i => '· ' + esc(i.label)).join('<br>') : '当天没有到期事项。');
}

/* ============================================================================
 * 三、季节保养清单
 * ========================================================================== */
const SEASON = {
  1: [['防冻液冰点检测', '严寒地区必须 -25℃ 以下'], ['电瓶冷启动能力', '低温亏电高发，超 4 年重点查'], ['胎压按冬季值', '气温每降 10℃ 胎压掉约 0.1 bar'], ['换防冻型玻璃水', '普通玻璃水会冻裂水壶']],
  2: [['长途前全车检查', '刹车/轮胎/灯光/油液'], ['轮胎花纹深度', '雨天抓地力优先'], ['空调滤芯', '春季花粉前更换'], ['雨刮片', '老化胶条刮不干净']],
  3: [['漆面去盐去泥', '化雪剂腐蚀性很强'], ['空调系统清洗', '换季异味源头在蒸发箱'], ['四轮定位', '冬季颠簸后易失准'], ['刹车盘片检查', '潮湿季节易锈']],
  4: [['空调制冷检测', '入夏前修，别等热起来'], ['冷却液液位与浓度', ''], ['轮胎换位', '每 1 万公里一次'], ['雨刮片', '梅雨前换新']],
  5: [['空调蒸发箱清洗', '异味与细菌'], ['胎压按夏季值', '高温易爆胎'], ['电瓶接线柱清洁', '防止氧化虚接'], ['玻璃水', '虫胶多，加大浓度']],
  6: [['空调制冷效果', '出风温差应 >8℃'], ['冷却系统', '高温前查水泵与风扇'], ['刹车片厚度', '小于 3mm 安排更换'], ['车内杀菌除味', '']],
  7: [['胎压（高温）', '长途前别忘备胎'], ['冷却液', '开锅风险最高'], ['空调滤', '勤换'], ['避免内饰暴晒', '防老化开裂']],
  8: [['长途前全车检查', '暑期自驾'], ['雨刮', '暴雨季'], ['轮胎', '注意鼓包与老化'], ['刹车油含水率', '']],
  9: [['入秋电瓶检测', '换季最易亏电'], ['空调停用前清洗', '防霉'], ['轮胎换位', ''], ['雨刮', '']],
  10: [['防冻液冰点', '入冬前必查'], ['玻璃水换季', '换 -25℃ 型'], ['暖风与除雾', '提前试好'], ['胎压', '气温下降要补气']],
  11: [['防冻液冰点检测', ''], ['电瓶电压', ''], ['雨刮与玻璃水', ''], ['暖风除雾功能', '']],
  12: [['冷启动检查', '打火变慢是电瓶信号'], ['轮胎气压', ''], ['刹车系统', '雪天安全'], ['应急工具', '三角牌/搭电线/防滑链']]
};
function seasonKey() { const d = new Date(); return d.getFullYear() + '-' + xPad(d.getMonth() + 1); }
function renderSeasonList() {
  const box = document.getElementById('seasonBox');
  if (!box) return;
  const m = new Date().getMonth() + 1;
  const tag = document.getElementById('seasonTag');
  if (tag) tag.textContent = m + ' 月';
  const list = SEASON[m] || [];
  const done = DB.seasonCheck[seasonKey()] || [];
  box.innerHTML = list.map((it, i) => {
    const on = done.indexOf(i) >= 0;
    return '<label class="chk" style="margin-bottom:7px">'
      + '<input type="checkbox"' + (on ? ' checked' : '') + ' onchange="toggleSeason(' + i + ')">'
      + '<span>' + esc(it[0]) + (it[1] ? '<div class="muted" style="font-size:11.5px;margin-top:1px">' + esc(it[1]) + '</div>' : '') + '</span></label>';
  }).join('') || '<div class="muted">本月无特别事项。</div>';
}
function toggleSeason(i) {
  const k = seasonKey();
  DB.seasonCheck[k] = DB.seasonCheck[k] || [];
  const a = DB.seasonCheck[k];
  const p = a.indexOf(i);
  if (p >= 0) a.splice(p, 1); else a.push(i);
  save(); renderSeasonList();
}

/* ============================================================================
 * 四、加油与油耗
 * ========================================================================== */
function fuelList() {
  return DB.fuels.filter(f => f.vehicleId === CUR)
    .slice().sort((a, b) => (xNum(b.mileage) - xNum(a.mileage)) || String(b.date).localeCompare(String(a.date)));
}
/* 满箱法：上一箱加满 → 本次加满，中间累计油量 ÷ 里程差 */
function fuelStats() {
  const list = fuelList().slice().sort((a, b) => xNum(a.mileage) - xNum(b.mileage));
  let prevFull = null, accL = 0, sumL = 0, sumKm = 0;
  const segs = [];
  list.forEach(f => {
    if (!prevFull) { prevFull = f; accL = 0; return; }
    accL += xNum(f.liters);
    if (f.full) {
      const dist = xNum(f.mileage) - xNum(prevFull.mileage);
      if (dist > 0 && accL > 0) {
        const l100 = accL / dist * 100;
        segs.push({ id: f.id, date: f.date, l100: l100 });
        sumL += accL; sumKm += dist;
        accL = 0;
      }
      prevFull = f;
    }
  });
  const totalL = list.reduce((s, f) => s + xNum(f.liters), 0);
  const totalAmt = list.reduce((s, f) => s + xNum(f.amount), 0);
  const kms = list.map(f => xNum(f.mileage)).filter(x => x > 0);
  const span = kms.length > 1 ? Math.max.apply(null, kms) - Math.min.apply(null, kms) : 0;
  const avg = sumKm > 0 ? sumL / sumKm * 100 : 0;
  const last = segs.length ? segs[segs.length - 1].l100 : 0;
  return {
    segs, avg, last, totalL, totalAmt, span,
    perKm: span > 0 ? totalAmt / span : 0,
    priceAvg: totalL > 0 ? totalAmt / totalL : 0,
    anomaly: avg > 0 && last > avg * 1.25
  };
}

function renderFuelList() {
  const box = document.getElementById('fuelList');
  if (!box) return;
  const st = fuelStats();
  const quick = document.getElementById('fuelQuick');
  if (quick) {
    quick.textContent = st.avg
      ? ('历史平均 ' + st.avg.toFixed(1) + ' L/100km　每公里油费 ' + st.perKm.toFixed(2) + ' 元')
      : '再记 2 次「加满」就能算出百公里油耗。';
  }
  const list = fuelList().slice(0, 8);
  box.innerHTML = list.length ? list.map(f => {
    const seg = st.segs.find(s => s.id === f.id);
    return '<div class="item"><div class="t"><span class="sp">' + (f.grade || '—') + '　' + xMoney(f.amount) + '</span>'
      + (seg ? '<span class="pill pri">' + seg.l100.toFixed(1) + ' L/100</span>' : '')
      + '</div>'
      + '<div class="s">' + (f.date || '') + '　' + fmt(f.mileage) + ' km　' + xNum(f.liters).toFixed(2) + ' L'
      + (f.price ? '　' + f.price + ' 元/L' : '') + (f.full ? '　加满' : '')
      + (f.station ? '<br>' + esc(f.station) : '') + '</div>'
      + '<div class="acts"><button class="del" onclick="delFuel(\'' + f.id + '\')">删除</button></div></div>';
  }).join('') : '<div class="muted">还没有加油记录。</div>';
}

let fuelFull = 1;
function setFull(v) {
  fuelFull = v;
  const y = document.getElementById('fFullY'), n = document.getElementById('fFullN');
  if (y) y.classList.toggle('on', v === 1);
  if (n) n.classList.toggle('on', v === 0);
}
function calcFuelPrice() {
  const l = xNum(document.getElementById('fLiters').value);
  const a = xNum(document.getElementById('fAmt').value);
  const p = document.getElementById('fPrice');
  if (p) p.value = (l > 0 && a > 0) ? (a / l).toFixed(2) : '—';
}
function saveFuel() {
  const v = curVehicle();
  const mileage = xNum(document.getElementById('fMile').value) || xNum(v.mileage);
  const liters = xNum(document.getElementById('fLiters').value);
  const amount = xNum(document.getElementById('fAmt').value);
  if (!mileage) { toast('请填写当前里程'); return; }
  if (!liters || !amount) { toast('请填写加油量与金额'); return; }
  const date = document.getElementById('fDate').value || today();
  const rec = {
    id: uid(), vehicleId: CUR, date, mileage, liters, amount,
    price: +(amount / liters).toFixed(2),
    grade: document.getElementById('fGrade').value,
    full: fuelFull ? 1 : 0,
    station: document.getElementById('fStation').value.trim()
  };
  DB.fuels.unshift(rec);
  // 同一次加油不再重复计入「费用」（油耗统计已覆盖），但成本统计里要算上：用 fuels 参与
  if (mileage > xNum(v.mileage)) v.mileage = mileage;
  addOdo(CUR, date, mileage, '加油');
  save();
  document.getElementById('fLiters').value = '';
  document.getElementById('fAmt').value = '';
  document.getElementById('fPrice').value = '—';
  document.getElementById('fStation').value = '';
  renderFuelList(); renderOilStats(); renderFinance(); renderOdo(); renderExpiry(); renderCalendar();
  toast('加油已记录');
}
function delFuel(id) {
  if (!confirm('删除这条加油记录？')) return;
  DB.fuels = DB.fuels.filter(f => f.id !== id);
  save(); renderFuelList(); renderOilStats(); renderFinance(); renderOdo(); toast('已删除');
}

/* ============================================================================
 * 四·五、充电与电耗（满充法：上一箱充满 → 本次充满，中间累计电量 ÷ 里程差）
 * ========================================================================== */
function chargeList() {
  return (DB.charges || []).filter(c => c.vehicleId === CUR)
    .slice().sort((a, b) => (xNum(b.mileage) - xNum(a.mileage)) || String(b.date).localeCompare(String(a.date)));
}
function chargeStats() {
  const list = chargeList().slice().sort((a, b) => xNum(a.mileage) - xNum(b.mileage));
  let prevFull = null, accK = 0, sumK = 0, sumKm = 0;
  const segs = [];
  list.forEach(c => {
    if (!prevFull) { prevFull = c; accK = 0; return; }
    accK += xNum(c.kwh);
    if (c.full) {
      const dist = xNum(c.mileage) - xNum(prevFull.mileage);
      if (dist > 0 && accK > 0) {
        const k100 = accK / dist * 100;
        segs.push({ id: c.id, date: c.date, k100: k100 });
        sumK += accK; sumKm += dist;
        accK = 0;
      }
      prevFull = c;
    }
  });
  const totalK = list.reduce((s, c) => s + xNum(c.kwh), 0);
  const totalAmt = list.reduce((s, c) => s + xNum(c.amount), 0);
  const kms = list.map(c => xNum(c.mileage)).filter(x => x > 0);
  const span = kms.length > 1 ? Math.max.apply(null, kms) - Math.min.apply(null, kms) : 0;
  const avg = sumKm > 0 ? sumK / sumKm * 100 : 0;
  const last = segs.length ? segs[segs.length - 1].k100 : 0;
  return {
    segs, avg, last, totalK, totalAmt, span,
    perKm: span > 0 ? totalAmt / span : 0,
    priceAvg: totalK > 0 ? totalAmt / totalK : 0
  };
}
function renderChargeList() {
  const box = document.getElementById('chargeList');
  if (!box) return;
  const st = chargeStats();
  const quick = document.getElementById('chargeQuick');
  if (quick) {
    quick.textContent = st.avg
      ? ('历史平均 ' + st.avg.toFixed(1) + ' 度/100km　每公里电费 ' + st.perKm.toFixed(2) + ' 元')
      : '再记 2 次「充满」就能算出百公里电耗。';
  }
  const list = chargeList().slice(0, 8);
  box.innerHTML = list.length ? list.map(c => {
    const seg = st.segs.find(s => s.id === c.id);
    return '<div class="item"><div class="t"><span class="sp">' + esc(c.mode || '充电') + '　' + xMoney(c.amount) + '</span>'
      + (seg ? '<span class="pill pri">' + seg.k100.toFixed(1) + ' 度/100</span>' : '')
      + '</div>'
      + '<div class="s">' + (c.date || '') + '　' + fmt(c.mileage) + ' km　' + xNum(c.kwh).toFixed(2) + ' 度'
      + (c.price ? '　' + c.price + ' 元/度' : '') + (c.full ? '　充满' : '')
      + (c.place ? '<br>' + esc(c.place) : '') + '</div>'
      + '<div class="acts"><button class="del" onclick="delCharge(\'' + c.id + '\')">删除</button></div></div>';
  }).join('') : '<div class="muted">还没有充电记录。</div>';
}
let chFull = 1;
function setChFull(v) {
  chFull = v;
  const y = document.getElementById('chFullY'), n = document.getElementById('chFullN');
  if (y) y.classList.toggle('on', v === 1);
  if (n) n.classList.toggle('on', v === 0);
}
function calcChPrice() {
  const k = xNum(document.getElementById('chKwh').value);
  const a = xNum(document.getElementById('chAmt').value);
  const p = document.getElementById('chPrice');
  if (p) p.value = (k > 0 && a > 0) ? (a / k).toFixed(2) : '—';
}
function saveCharge() {
  const v = curVehicle();
  const mileage = xNum(document.getElementById('chMile').value) || xNum(v.mileage);
  const kwh = xNum(document.getElementById('chKwh').value);
  const amount = xNum(document.getElementById('chAmt').value);
  if (!mileage) { toast('请填写当前里程'); return; }
  if (!kwh || !amount) { toast('请填写充电量与金额'); return; }
  const date = document.getElementById('chDate').value || today();
  const rec = {
    id: uid(), vehicleId: CUR, date, mileage, kwh, amount,
    price: +(amount / kwh).toFixed(2),
    full: chFull ? 1 : 0,
    mode: document.getElementById('chMode').value,
    place: document.getElementById('chPlace').value.trim()
  };
  DB.charges.unshift(rec);
  if (mileage > xNum(v.mileage)) v.mileage = mileage;
  addOdo(CUR, date, mileage, '充电');
  save();
  document.getElementById('chKwh').value = '';
  document.getElementById('chAmt').value = '';
  document.getElementById('chPrice').value = '—';
  document.getElementById('chPlace').value = '';
  renderChargeList(); renderFinance(); renderOdo(); renderExpiry(); renderCalendar();
  toast('充电已记录');
}
function delCharge(id) {
  if (!confirm('删除这条充电记录？')) return;
  DB.charges = (DB.charges || []).filter(c => c.id !== id);
  save(); renderChargeList(); renderFinance(); renderOdo(); toast('已删除');
}

/* 油耗分析（成本页） */
function renderOilStats() {
  const box = document.getElementById('oilBox');
  if (!box) return;
  const st = fuelStats();
  const pill = document.getElementById('oilPill');
  if (pill) {
    pill.className = 'pill ' + (st.avg ? (st.anomaly ? 'bad' : 'ok') : 'gray');
    pill.textContent = st.avg ? (st.anomaly ? '油耗偏高' : '正常') : '数据不足';
  }
  if (!st.avg) {
    box.innerHTML = '<div class="muted">记 2 次以上「加满」的加油记录，这里会显示百公里油耗、每公里油费和趋势曲线。</div>';
    return;
  }
  const recent = st.segs.slice(-12);
  const vals = recent.map(s => s.l100);
  const mx = Math.max.apply(null, vals), mn = Math.min.apply(null, vals);
  const W = 340, H = 96, pad = 8;
  const pts = vals.map((v, i) => {
    const x = vals.length === 1 ? W / 2 : pad + i * (W - pad * 2) / (vals.length - 1);
    const y = H - pad - (mx === mn ? (H - pad * 2) / 2 : (v - mn) / (mx - mn) * (H - pad * 2));
    return [x, y];
  });
  const line = pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ');
  const area = 'M' + pts[0][0].toFixed(1) + ',' + (H - pad) + ' L ' + line.replace(/ /g, ' L ') + ' L' + pts[pts.length - 1][0].toFixed(1) + ',' + (H - pad) + ' Z';
  box.innerHTML = ''
    + '<div class="kcards" style="margin:6px 0 10px">'
    + '<div class="card"><b>' + st.avg.toFixed(1) + '</b><span>平均 L/100km</span></div>'
    + '<div class="card"><b>' + st.last.toFixed(1) + '</b><span>最近一箱</span></div>'
    + '<div class="card"><b>' + st.perKm.toFixed(2) + '</b><span>每公里油费 ¥</span></div>'
    + '<div class="card"><b>' + st.priceAvg.toFixed(2) + '</b><span>平均油价 ¥/L</span></div>'
    + '</div>'
    + (vals.length > 1 ? '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="油耗趋势">'
      + '<defs><linearGradient id="oilG" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="rgba(10,132,255,.28)"/><stop offset="1" stop-color="rgba(10,132,255,0)"/>'
      + '</linearGradient></defs>'
      + '<path d="' + area + '" fill="url(#oilG)"/>'
      + '<polyline points="' + line + '" fill="none" stroke="#0a84ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>'
      + pts.map(p => '<circle cx="' + p[0].toFixed(1) + '" cy="' + p[1].toFixed(1) + '" r="2.6" fill="#fff" stroke="#0a84ff" stroke-width="1.8"/>').join('')
      + '</svg>' : '')
    + (st.anomaly ? '<div class="note" style="color:var(--bad-c)">最近一箱比平均高 ' + Math.round((st.last / st.avg - 1) * 100) + '%，建议查胎压、空滤与氧传感器。</div>' : '')
    + '<div class="note">共 ' + DB.fuels.filter(f => f.vehicleId === CUR).length + ' 次加油，累计 ' + st.totalL.toFixed(1) + ' L / ' + xMoney(st.totalAmt) + '，统计里程 ' + fmt(st.span) + ' km。</div>';
}

/* ============================================================================
 * 五、里程打卡
 * ========================================================================== */
function addOdo(vid, date, mileage, src) {
  mileage = xNum(mileage);
  if (!mileage) return;
  const dup = DB.odo.find(o => o.vehicleId === vid && o.date === date && xNum(o.mileage) === mileage);
  if (dup) return;
  DB.odo.push({ id: uid(), vehicleId: vid, date: date || today(), mileage, src: src || '打卡' });
}
function odometerHistory() {
  const rows = [];
  DB.odo.filter(o => o.vehicleId === CUR).forEach(o => rows.push({ d: o.date, m: xNum(o.mileage), s: o.src || '打卡' }));
  return rows.filter(r => r.m > 0).sort((a, b) => String(b.d || '').localeCompare(String(a.d || '')));
}
function renderOdo() {
  const box = document.getElementById('odoBox');
  if (!box) return;
  const v = curVehicle() || {};
  const est = document.getElementById('odoEstimate');
  const dd = avgDailyKm();
  if (est) est.textContent = dd > 0 ? ('约 ' + dd.toFixed(1) + ' km/天') : '数据不足';
  const rows = odometerHistory().slice(0, 8);
  box.innerHTML = (rows.length ? '<div class="kv"><span>当前里程</span><b>' + fmt(v.mileage) + ' km</b></div>'
    + rows.map(r => '<div class="kv"><span>' + r.d + '　<span class="rtag muted-tag">' + esc(r.s) + '</span></span><b>' + fmt(r.m) + ' km</b></div>').join('')
    : '<div class="muted">还没有里程记录。点上方「更新里程」或在「记录 → 加油」里填里程，会自动累计。</div>')
    + '<div class="note">里程会用于「按里程」的保养提醒，长期不更新会算不准。</div>';
}
function openOdoModal() {
  const v = curVehicle() || {};
  openModal('<h2>更新里程</h2>'
    + '<label>日期</label><input id="odoDate" type="date" value="' + today() + '">'
    + '<label>当前里程 (km)</label><input id="odoVal" type="number" inputmode="numeric" value="' + xNum(v.mileage) + '">'
    + '<div class="note">只能往前加；填了更小的值会被忽略，避免误改。</div>'
    + '<button class="btn" style="width:100%;margin-top:14px" onclick="saveOdo()">保存</button>');
}
function saveOdo() {
  const v = curVehicle();
  const n = xNum(document.getElementById('odoVal').value);
  if (!n) { toast('请填写里程'); return; }
  if (n < xNum(v.mileage)) { toast('新里程不能小于当前里程 ' + fmt(v.mileage) + ' km'); return; }
  addOdo(CUR, document.getElementById('odoDate').value || today(), n, '打卡');
  v.mileage = n;
  save(); closeModal(); renderOdo(); renderArchive(); renderReminders(); toast('里程已更新');
}

/* ============================================================================
 * 六、轮胎
 * ========================================================================== */
const TIRE_POS = [['fl', '左前'], ['fr', '右前'], ['rl', '左后'], ['rr', '右后']];
function tireOf(vid) { return DB.tires.find(t => t.vehicleId === vid); }
function tireCls(dep) { return dep > 0 && dep < 3 ? (dep < 1.6 ? 'bad' : 'warn') : ''; }
function renderTire() {
  const box = document.getElementById('tireBox');
  if (!box) return;
  const t = tireOf(CUR);
  if (!t) {
    box.innerHTML = '<div class="muted">还没有轮胎档案。点「档案」填品牌型号与 DOT 生产周，点「+ 花纹深度」每次保养录一次，就能看磨损曲线。</div>';
    return;
  }
  const p = t.pos || {};
  const cells = TIRE_POS.map(([k, name]) => {
    const o = p[k] || {};
    const dep = xNum(o.d);
    return '<div class="tcell ' + tireCls(dep) + '">'
      + '<div class="pos">' + name + '</div>'
      + '<div class="dep">' + (dep ? dep.toFixed(1) : '—') + '<small>mm</small></div>'
      + '<div class="pre">' + (o.p ? o.p + ' bar' : '胎压未录') + '</div></div>';
  }).join('');
  const logs = (t.logs || []).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const last = logs[0];
  box.innerHTML = '<div class="kv" style="border:none;padding-bottom:6px"><span>'
    + esc([t.brand, t.size].filter(Boolean).join(' ') || '未填品牌型号')
    + (t.dot ? '　<span class="rtag muted-tag">DOT ' + esc(t.dot) + '</span>' : '') + '</span>'
    + '<b>' + (last ? ('上次 ' + last.date) : '') + '</b></div>'
    + '<div class="tire-grid">' + cells + '</div>'
    + (logs.length ? '<div class="note">' + logs.slice(0, 3).map(l => l.date + '　' + [l.fl, l.fr, l.rl, l.rr].map(v => (xNum(v) ? xNum(v).toFixed(1) : '—')).join(' / ') + ' mm').join('<br>') + '</div>' : '')
    + '<div class="note" style="color:var(--sub)">低于 3mm 建议安排更换，1.6mm 为法定极限。四条胎建议同轴成对更换。</div>';
}
function openTireModal() {
  const t = tireOf(CUR) || {};
  openModal('<h2>轮胎档案</h2>'
    + '<label>品牌型号</label><input id="tBrand" value="' + esc(t.brand || '') + '" placeholder="如：米其林 浩悦4 225/45R17">'
    + '<label>规格</label><input id="tSize" value="' + esc(t.size || '') + '" placeholder="如：225/45 R17">'
    + '<div class="grid2">'
    + '<div><label>DOT 生产周</label><input id="tDot" value="' + esc(t.dot || '') + '" placeholder="如：3824"></div>'
    + '<div><label>安装日期</label><input id="tInstall" type="date" value="' + esc(t.install || '') + '"></div>'
    + '</div>'
    + '<div class="note">DOT 后四位＝第几周+年份，超过 5 年的胎即使花纹够也要留意老化。</div>'
    + '<button class="btn" style="width:100%;margin-top:14px" onclick="saveTire()">保存</button>');
}
function saveTire() {
  let t = tireOf(CUR);
  if (!t) { t = { vehicleId: CUR, pos: {}, logs: [] }; DB.tires.push(t); }
  t.brand = document.getElementById('tBrand').value.trim();
  t.size = document.getElementById('tSize').value.trim();
  t.dot = document.getElementById('tDot').value.trim();
  t.install = document.getElementById('tInstall').value;
  save(); closeModal(); renderTire(); toast('轮胎档案已保存');
}
function openTireLog() {
  const t = tireOf(CUR) || { pos: {} };
  const p = t.pos || {};
  const row = (k, name) => {
    const o = p[k] || {};
    return '<div class="grid2"><div><label>' + name + ' 花纹(mm)</label><input id="td_' + k + '" type="number" step="0.1" value="' + (xNum(o.d) || '') + '"></div>'
      + '<div><label>' + name + ' 胎压(bar)</label><input id="tp_' + k + '" type="number" step="0.1" value="' + (xNum(o.p) || '') + '"></div></div>';
  };
  openModal('<h2>录入花纹深度</h2>'
    + '<label>日期</label><input id="tlDate" type="date" value="' + today() + '">'
    + '<label>里程 (km)</label><input id="tlMile" type="number" value="' + xNum((curVehicle() || {}).mileage) + '">'
    + TIRE_POS.map(([k, n]) => row(k, n)).join('')
    + '<button class="btn" style="width:100%;margin-top:14px" onclick="saveTireLog()">保存记录</button>');
}
function saveTireLog() {
  let t = tireOf(CUR);
  if (!t) { t = { vehicleId: CUR, pos: {}, logs: [] }; DB.tires.push(t); }
  t.pos = t.pos || {}; t.logs = t.logs || [];
  const log = { date: document.getElementById('tlDate').value || today(), mileage: xNum(document.getElementById('tlMile').value) };
  TIRE_POS.forEach(([k]) => {
    const d = xNum(document.getElementById('td_' + k).value);
    const p = xNum(document.getElementById('tp_' + k).value);
    log[k] = d;
    t.pos[k] = { d: d || (t.pos[k] || {}).d || 0, p: p || (t.pos[k] || {}).p || 0 };
  });
  t.logs.push(log);
  if (t.logs.length > 40) t.logs = t.logs.slice(-40);
  save(); closeModal(); renderTire(); toast('已记录');
}

/* ============================================================================
 * 七、配件保修卡
 * ========================================================================== */
function partWarrantyEnd(p) {
  if (!p.warrantyMonths) return '';
  return addMonths(p.date, p.warrantyMonths);
}
function partStatus(p) {
  const v = curVehicle() || {};
  const end = partWarrantyEnd(p);
  const dLeft = end ? xDays(end) : null;
  const kmLeft = p.warrantyKm ? (xNum(p.mileage) + xNum(p.warrantyKm) - xNum(v.mileage)) : null;
  const dateOk = dLeft === null ? true : dLeft >= 0;
  const kmOk = kmLeft === null ? true : kmLeft > 0;
  return { end, dLeft, kmLeft, ok: dateOk && kmOk };
}
function renderParts() {
  const box = document.getElementById('partBox');
  if (!box) return;
  const list = DB.parts.filter(p => p.vehicleId === CUR).slice().sort((a, b) => String(b.date).localeCompare(String(a.date)));
  box.innerHTML = list.length ? list.map(p => {
    const s = partStatus(p);
    const txt = s.ok
      ? (s.dLeft !== null ? ('剩 ' + s.dLeft + ' 天') : (s.kmLeft !== null ? ('剩 ' + fmt(s.kmLeft) + ' km') : '无保修'))
      : '已过保';
    return '<div class="item"><div class="t"><span class="sp">' + esc(p.name) + '</span>'
      + '<span class="pill ' + (s.ok ? 'ok' : 'gray') + '">' + txt + '</span></div>'
      + '<div class="s">' + (p.date || '') + '　' + fmt(p.mileage) + ' km'
      + (p.shop ? '　' + esc(p.shop) : '') + (p.cost ? '　' + xMoney(p.cost) : '') + '</div>'
      + '<div class="s">' + (p.warrantyMonths ? p.warrantyMonths + ' 个月' : '') + (p.warrantyKm ? ' / ' + fmt(p.warrantyKm) + ' km' : '')
      + (p.note ? '　' + esc(p.note) : '') + '</div>'
      + '<div class="acts"><button class="del" onclick="delPart(\'' + p.id + '\')">删除</button></div></div>';
  }).join('') : '<div class="muted">还没记录。换电瓶、刹车片、减震器这类带保修的件，记一笔，到期前提醒你去索赔。</div>';
}
function openPartModal() {
  const name = document.getElementById('customItem');
  openModal('<h2>配件保修卡</h2>'
    + '<label>配件名称</label><input id="pName" placeholder="如：瓦尔塔 AGM 电瓶" value="' + esc((name && name.value) || '') + '">'
    + '<div class="grid2">'
    + '<div><label>更换日期</label><input id="pDate" type="date" value="' + today() + '"></div>'
    + '<div><label>更换时里程</label><input id="pMile" type="number" value="' + xNum((curVehicle() || {}).mileage) + '"></div>'
    + '</div>'
    + '<div class="grid2">'
    + '<div><label>保修(月)</label><input id="pMon" type="number" value="12"></div>'
    + '<div><label>保修(公里)</label><input id="pKm" type="number" value="20000"></div>'
    + '</div>'
    + '<label>门店</label><input id="pShop" placeholder="如：途虎养车">'
    + '<div class="grid2">'
    + '<div><label>金额 (¥)</label><input id="pCost" type="number" step="0.01"></div>'
    + '<div><label>备注</label><input id="pNote" placeholder="可选"></div>'
    + '</div>'
    + '<button class="btn" style="width:100%;margin-top:14px" onclick="savePart()">保存</button>');
}
function savePart() {
  const name = document.getElementById('pName').value.trim();
  if (!name) { toast('请填写配件名称'); return; }
  DB.parts.unshift({
    id: uid(), vehicleId: CUR, name,
    date: document.getElementById('pDate').value || today(),
    mileage: xNum(document.getElementById('pMile').value),
    warrantyMonths: parseInt(document.getElementById('pMon').value) || 0,
    warrantyKm: parseInt(document.getElementById('pKm').value) || 0,
    shop: document.getElementById('pShop').value.trim(),
    cost: xNum(document.getElementById('pCost').value),
    note: document.getElementById('pNote').value.trim()
  });
  save(); closeModal(); renderParts(); renderExpiry(); renderCalendar(); toast('保修卡已保存');
}
function delPart(id) {
  if (!confirm('删除这张保修卡？')) return;
  DB.parts = DB.parts.filter(p => p.id !== id);
  save(); renderParts(); toast('已删除');
}

/* ============================================================================
 * 八、证件与保单
 * ========================================================================== */
const DOC_CATS = ['行驶证', '驾驶证', '保险单', '年检', '车船税', '购车发票', '保养手册', '保修卡', '其他'];
function renderDocs() {
  const box = document.getElementById('docBox');
  if (!box) return;
  const list = DB.docs.filter(d => d.vehicleId === CUR || (!d.vehicleId && d.cat === '驾驶证'));
  box.innerHTML = list.length ? list.map(d => {
    const dd = xDays(d.expire);
    const cls = dd === null ? '' : (dd < 0 ? 'bad' : dd <= 30 ? 'warn' : '');
    const tag = d.expire ? (dd < 0 ? '过期' : dd + '天') : '长期';
    return '<div class="doc" onclick="openDocModal(\'' + d.id + '\')">'
      + '<span class="dc ' + cls + '">' + tag + '</span>'
      + '<div class="dn">' + esc(d.name || d.cat) + '</div>'
      + '<div class="dd">' + esc(d.cat) + (d.no ? ' · ' + esc(String(d.no).slice(-6)) : '') + '</div>'
      + (d.photo ? '<img src="' + d.photo + '" alt="">' : '')
      + '</div>';
  }).join('') : '<div class="muted" style="grid-column:1/-1">还没有证件照片。行驶证、保单、购车发票拍一张存进来，年检或出险时不用翻文件袋。</div>';
}
let docPhoto = '';
function openDocModal(id) {
  const d = id ? DB.docs.find(x => x.id === id) : { cat: '保险单', name: '', no: '', expire: '', company: '', photo: '' };
  docPhoto = d.photo || '';
  openModal('<h2>' + (id ? '编辑' : '添加') + '证件</h2>'
    + '<label>类型</label><select id="dCat">' + DOC_CATS.map(c => '<option' + (d.cat === c ? ' selected' : '') + '>' + c + '</option>').join('') + '</select>'
    + '<label>名称</label><input id="dName" value="' + esc(d.name || '') + '" placeholder="如：交强险 2026 / 我的驾驶证">'
    + '<label>证件号 / 保单号</label><input id="dNo" value="' + esc(d.no || '') + '">'
    + '<div class="grid2">'
    + '<div><label>到期日</label><input id="dExp" type="date" value="' + esc(d.expire || '') + '"></div>'
    + '<div><label>金额 (¥)</label><input id="dAmt" type="number" step="0.01" value="' + (xNum(d.amount) || '') + '"></div>'
    + '</div>'
    + '<label>保险公司 / 经办</label><input id="dCom" value="' + esc(d.company || '') + '">'
    + '<label>照片</label><input id="dPhoto" type="file" accept="image/*">'
    + '<div id="dPrev" class="row" style="margin-top:8px">' + (docPhoto ? '<img class="thumb" src="' + docPhoto + '">' : '') + '</div>'
    + '<button class="btn" style="width:100%;margin-top:14px" onclick="saveDoc(\'' + (id || '') + '\')">保存</button>'
    + (id ? '<button class="btn del" style="width:100%" onclick="delDoc(\'' + id + '\')">删除</button>' : ''));
  const inp = document.getElementById('dPhoto');
  inp.addEventListener('change', function () {
    const f = this.files[0]; if (!f) return;
    compressImg(f, function (b64) {
      docPhoto = b64;
      document.getElementById('dPrev').innerHTML = '<img class="thumb" src="' + b64 + '">';
    });
  });
}
function saveDoc(id) {
  const cat = document.getElementById('dCat').value;
  const data = {
    cat,
    name: document.getElementById('dName').value.trim() || cat,
    no: document.getElementById('dNo').value.trim(),
    expire: document.getElementById('dExp').value,
    amount: xNum(document.getElementById('dAmt').value),
    company: document.getElementById('dCom').value.trim(),
    photo: docPhoto,
    vehicleId: cat === '驾驶证' ? '' : CUR
  };
  if (id) Object.assign(DB.docs.find(x => x.id === id), data);
  else { data.id = uid(); DB.docs.push(data); }
  // 与车辆字段保持同步（老用户仍能在车辆卡上看到）
  if (cat === '保险单' && data.expire) { const v = curVehicle(); v.insuranceDue = data.expire; }
  if (cat === '年检' && data.expire) { const v = curVehicle(); v.inspectionDue = data.expire; }
  save(); closeModal(); renderDocs(); renderExpiry(); renderCalendar(); renderArchive(); toast('证件已保存');
}
function delDoc(id) {
  if (!confirm('删除该证件记录？')) return;
  DB.docs = DB.docs.filter(d => d.id !== id);
  save(); closeModal(); renderDocs(); renderExpiry(); renderCalendar(); toast('已删除');
}

/* 通用图片压缩 */
function compressImg(file, cb, max) {
  max = max || 900;
  const rd = new FileReader();
  rd.onload = function () {
    const img = new Image();
    img.onload = function () {
      let w = img.width, h = img.height;
      if (w > max) { h = h * max / w; w = max; }
      if (h > max) { w = w * max / h; h = max; }
      const c = document.createElement('canvas');
      c.width = Math.round(w); c.height = Math.round(h);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      cb(c.toDataURL('image/jpeg', 0.72));
    };
    img.src = rd.result;
  };
  rd.readAsDataURL(file);
}

/* ============================================================================
 * 九、费用（新表单）与套餐
 * ========================================================================== */
function saveCost2() {
  const amt = xNum(document.getElementById('cAmt2').value);
  if (!amt) { toast('请填写金额'); return; }
  DB.costs.unshift({
    id: uid(), vehicleId: CUR, type: document.getElementById('cType2').value, amount: amt,
    date: document.getElementById('cDate2').value || today(),
    note: document.getElementById('cNote2').value.trim()
  });
  save();
  document.getElementById('cAmt2').value = '';
  document.getElementById('cNote2').value = '';
  renderCostList(); renderFinance(); toast('已记录');
}
function renderCostList() {
  const box = document.getElementById('costList');
  if (!box) return;
  const list = DB.costs.filter(c => c.vehicleId === CUR).slice(0, 10);
  box.innerHTML = list.length ? list.map(c => '<div class="item"><div class="t"><span class="sp">'
    + esc(c.type) + '</span><b>' + xMoney(c.amount) + '</b></div>'
    + '<div class="s">' + (c.date || '') + (c.note ? '　' + esc(c.note) : '') + '</div>'
    + '<div class="acts"><button class="del" onclick="delCost(\'' + c.id + '\')">删除</button></div></div>').join('')
    : '<div class="muted">还没有费用记录。</div>';
}
function delCost(id) {
  if (!confirm('删除这条费用？')) return;
  DB.costs = DB.costs.filter(c => c.id !== id);
  save(); renderCostList(); renderFinance(); toast('已删除');
}

function renderPlans() {
  const box = document.getElementById('planBox');
  if (!box) return;
  const list = DB.plans.filter(p => p.vehicleId === CUR);
  box.innerHTML = list.length ? list.map(p => {
    const left = Math.max(0, xNum(p.total) - xNum(p.used));
    const pct = p.total > 0 ? Math.round(left / xNum(p.total) * 100) : 0;
    const dd = xDays(p.expire);
    return '<div class="item"><div class="t"><span class="sp">' + esc(p.name) + '</span>'
      + '<span class="pill ' + (left <= 0 ? 'gray' : (pct < 30 ? 'warn' : 'ok')) + '">剩 ' + left + ' 次</span></div>'
      + '<div class="bar" style="margin:8px 0 6px"><i style="width:' + pct + '%"></i></div>'
      + '<div class="s">' + (p.expire ? ('有效期至 ' + p.expire + (dd !== null && dd < 0 ? '（已过期）' : '')) : '无有效期')
      + (p.shop ? '　' + esc(p.shop) : '') + '</div>'
      + '<div class="acts"><button onclick="usePlan(\'' + p.id + '\')">用一次</button>'
      + '<button class="del" onclick="delPlan(\'' + p.id + '\')">删除</button></div></div>';
  }).join('') : '<div class="muted">还没有套餐。买过「三次保养套餐」「洗车卡」的，记下剩余次数，用完前会提醒。</div>';
}
function openPlanModal() {
  openModal('<h2>添加套餐 / 储值</h2>'
    + '<label>名称</label><input id="plName" placeholder="如：4S 店三次保养套餐">'
    + '<div class="grid2">'
    + '<div><label>总次数</label><input id="plTotal" type="number" value="3"></div>'
    + '<div><label>已用</label><input id="plUsed" type="number" value="0"></div>'
    + '</div>'
    + '<div class="grid2">'
    + '<div><label>有效期至</label><input id="plExp" type="date"></div>'
    + '<div><label>门店</label><input id="plShop"></div>'
    + '</div>'
    + '<button class="btn" style="width:100%;margin-top:14px" onclick="savePlan()">保存</button>');
}
function savePlan() {
  const name = document.getElementById('plName').value.trim();
  if (!name) { toast('请填写名称'); return; }
  DB.plans.unshift({
    id: uid(), vehicleId: CUR, name,
    total: parseInt(document.getElementById('plTotal').value) || 0,
    used: parseInt(document.getElementById('plUsed').value) || 0,
    expire: document.getElementById('plExp').value,
    shop: document.getElementById('plShop').value.trim()
  });
  save(); closeModal(); renderPlans(); toast('已保存');
}
function usePlan(id) {
  const p = DB.plans.find(x => x.id === id); if (!p) return;
  p.used = xNum(p.used) + 1;
  save(); renderPlans(); toast('已核销一次，剩余 ' + Math.max(0, xNum(p.total) - xNum(p.used)));
}
function delPlan(id) {
  if (!confirm('删除该套餐？')) return;
  DB.plans = DB.plans.filter(p => p.id !== id);
  save(); renderPlans(); toast('已删除');
}

/* ============================================================================
 * 十、车库聚合 / 历史记录
 * ========================================================================== */
let histFilter = 'all';
function pickHist(h) {
  histFilter = h;
  document.querySelectorAll('#histSeg button').forEach(b => b.classList.toggle('on', b.dataset.h === h));
  renderHistory();
}
function renderGarageHealth() {
  try { renderTire(); } catch (e) { }
  try { renderParts(); } catch (e) { }
  try { renderDocs(); } catch (e) { }
  try { renderOdo(); } catch (e) { }
  try { renderHistory(); } catch (e) { }
}
function renderHistory() {
  const box = document.getElementById('recordList');
  if (!box) return;
  const rows = [];
  DB.records.filter(r => r.vehicleId === CUR).forEach(r => {
    const kind = r.kind === 'repair' ? 'repair' : 'service';
    const items = (r.items || []).map(i => {
      const nm = typeof i === 'string' ? i : i.name;
      const c = typeof i === 'string' ? 0 : ((+i.labor || 0) + (+i.parts || 0));
      return '<span class="it">' + esc(nm) + (c ? ' <b>' + money(c) + '</b>' : '') + '</span>';
    }).join('、');
    let html = '<div class="rec-item">'
      + (r.receipt ? '<img class="thumb" src="' + r.receipt + '" onclick="viewImg(\'' + r.receipt + '\')">' : '')
      + '<div class="body"><div class="t">' + (kind === 'repair' ? '🔧 ' : '') + esc(r.cat) + ' · ' + money(r.cost) + (r.rework ? ' <span class="pill bad">返修</span>' : '') + '</div>'
      + (r.fault ? '<div class="s">故障：' + esc(r.fault) + '</div>' : '')
      + (r.diag ? '<div class="s">结论：' + esc(r.diag) + '</div>' : '')
      + '<div class="s">工时 ' + money(r.labor || 0) + ' ＋ 配件 ' + money(r.parts || 0) + '</div>'
      + '<div class="s">' + r.date + '　' + fmt(r.mileage) + ' km　' + esc(r.shop || '') + '</div>'
      + '<div class="s items">' + items + '</div>'
      + (r.note ? '<div class="s">备注：' + esc(r.note) + '</div>' : '')
      + '</div></div>'
      + ((r.before || r.after) ? '<div class="row" style="margin-top:8px">'
        + (r.before ? '<img class="thumb" src="' + r.before + '" onclick="viewImg(\'' + r.before + '\')">' : '')
        + (r.after ? '<img class="thumb" src="' + r.after + '" onclick="viewImg(\'' + r.after + '\')">' : '') + '</div>' : '')
      + '<div class="row" style="margin-top:10px"><button class="btn ghost" onclick="delRecord(\'' + r.id + '\')">删除</button></div>';
    rows.push({ k: kind, d: r.date, html });
  });
  DB.fuels.filter(f => f.vehicleId === CUR).forEach(f => {
    rows.push({
      k: 'fuel', d: f.date,
      html: '<div class="rec-item"><div class="body"><div class="t">⛽ 加油 ' + xMoney(f.amount) + '</div>'
        + '<div class="s">' + f.date + '　' + fmt(f.mileage) + ' km　' + xNum(f.liters).toFixed(2) + ' L'
        + (f.price ? '　' + f.price + ' 元/L' : '') + (f.full ? '　加满' : '') + '</div>'
        + (f.station ? '<div class="s">' + esc(f.station) + '</div>' : '') + '</div></div>'
        + '<div class="row" style="margin-top:10px"><button class="btn ghost" onclick="delFuel(\'' + f.id + '\')">删除</button></div>'
    });
  });
  (DB.charges || []).filter(c => c.vehicleId === CUR).forEach(c => {
    rows.push({
      k: 'charge', d: c.date,
      html: '<div class="rec-item"><div class="body"><div class="t">⚡ 充电 ' + xMoney(c.amount) + '</div>'
        + '<div class="s">' + c.date + '　' + fmt(c.mileage) + ' km　' + xNum(c.kwh).toFixed(2) + ' 度'
        + (c.price ? '　' + c.price + ' 元/度' : '') + (c.full ? '　充满' : '') + (c.mode ? '　' + esc(c.mode) : '') + '</div>'
        + (c.place ? '<div class="s">' + esc(c.place) + '</div>' : '') + '</div></div>'
        + '<div class="row" style="margin-top:10px"><button class="btn ghost" onclick="delCharge(\'' + c.id + '\')">删除</button></div>'
    });
  });
  DB.costs.filter(c => c.vehicleId === CUR).forEach(c => {
    rows.push({
      k: 'cost', d: c.date,
      html: '<div class="rec-item"><div class="body"><div class="t">🧾 ' + esc(c.type) + ' ' + xMoney(c.amount) + '</div>'
        + '<div class="s">' + (c.date || '') + (c.note ? '　' + esc(c.note) : '') + '</div></div></div>'
        + '<div class="row" style="margin-top:10px"><button class="btn ghost" onclick="delCost(\'' + c.id + '\')">删除</button></div>'
    });
  });
  const list = rows.filter(r => histFilter === 'all' || r.k === histFilter)
    .sort((a, b) => String(b.d || '').localeCompare(String(a.d || '')))
    .slice(0, 40);
  box.innerHTML = list.length ? list.map(r => '<div class="card">' + r.html + '</div>').join('')
    : '<div class="empty">该分类下暂无记录。</div>';
}

/* ============================================================================
 * 十一、记录页的三个面板
 * ========================================================================== */
let recPane = 'service', recKind = 'service';
function pickRec(p) {
  recPane = p;
  ['service', 'fuel', 'charge', 'cost'].forEach(k => {
    const el = document.getElementById('recPane-' + k);
    if (el) el.classList.toggle('hidden', k !== p);
    const b = document.querySelector('#recSeg button[data-pane="' + k + '"]');
    if (b) b.classList.toggle('on', k === p);
  });
  if (p === 'fuel') { if (!document.getElementById('fDate').value) document.getElementById('fDate').value = today();
    document.getElementById('fMile').value = xNum((curVehicle() || {}).mileage) || ''; renderFuelList(); }
  if (p === 'charge') { if (!document.getElementById('chDate').value) document.getElementById('chDate').value = today();
    document.getElementById('chMile').value = xNum((curVehicle() || {}).mileage) || ''; renderChargeList(); }
  if (p === 'cost') { if (!document.getElementById('cDate2').value) document.getElementById('cDate2').value = today(); renderCostList(); }
}
function setKind(k) {
  recKind = k;
  document.querySelectorAll('#screen-services [data-kind]').forEach(b => b.classList.toggle('on', b.dataset.kind === k));
  const box = document.getElementById('repairBox');
  if (box) box.classList.toggle('hidden', k !== 'repair');
  curBill = {}; customNames = [];
  renderCatTabs(); renderItemBill();
}

/* 维修项目目录 */
const REPAIR_CATALOG = {
  '发动机': ['点火线圈更换', '火花塞更换', '喷油嘴清洗/更换', '节气门清洗', '正时皮带/链条', '水泵更换', '节温器更换', '气门室盖垫更换', '发动机机脚更换', '缸垫更换', '涡轮增压器检修'],
  '变速箱': ['变速箱油更换', '双离合油更换', '阀体清洗/更换', '离合器片更换', '变速箱电脑检修', '换挡执行机构'],
  '底盘悬挂': ['减震器更换', '下摆臂/球头更换', '稳定杆拉杆更换', '平衡杆胶套', '转向机检修', '四轮定位', '轮毂轴承更换', '半轴/防尘套'],
  '电气': ['电瓶更换', '发电机检修', '起动机检修', '全车灯光检修', '中控锁/升降器', '线束检修', '传感器更换'],
  '空调': ['空调不制冷检修', '压缩机更换', '冷凝器更换', '蒸发箱清洗', '冷媒补充', '暖风系统检修'],
  '车身钣金': ['钣金喷漆', '保险杠修复', '玻璃更换', '天窗检修', '门锁/合页', '底盘装甲'],
  '其他': ['事故维修', '异响排查', '漏油排查', '年检整备', '其他']
};

/* ============================================================================
 * 十二、车型保养周期模板
 * ========================================================================== */
const BRAND_TPL = {
  '大众 / 斯柯达': { f: [['机油+机滤', 12, 10000], ['空气滤清器', 12, 20000], ['空调滤清器', 12, 15000], ['火花塞', 24, 30000], ['刹车油', 24, 40000], ['变速箱油', 48, 60000], ['防冻液/冷却液', 48, 60000]] },
  '丰田 / 雷克萨斯': { f: [['机油+机滤', 12, 10000], ['空气滤清器', 12, 20000], ['空调滤清器', 12, 15000], ['火花塞', 72, 100000], ['刹车油', 24, 40000], ['变速箱油', 48, 80000], ['防冻液/冷却液', 96, 160000]], e: [['空调滤清器', 12, 15000], ['刹车油', 24, 40000], ['电池冷却液', 96, 80000]] },
  '本田': { f: [['机油+机滤', 12, 10000], ['空气滤清器', 12, 20000], ['空调滤清器', 12, 15000], ['火花塞', 60, 80000], ['刹车油', 36, 60000], ['变速箱油', 48, 80000]] },
  '日产': { f: [['机油+机滤', 12, 10000], ['空气滤清器', 12, 20000], ['空调滤清器', 12, 15000], ['火花塞', 60, 100000], ['刹车油', 24, 40000], ['变速箱油', 48, 80000]] },
  '吉利 / 长安 / 奇瑞': { f: [['机油+机滤', 12, 10000], ['空气滤清器', 12, 20000], ['空调滤清器', 12, 15000], ['火花塞', 36, 40000], ['刹车油', 24, 40000], ['变速箱油', 48, 60000]] },
  '比亚迪 DM-i': { f: [['机油+机滤', 12, 7500], ['空气滤清器', 12, 20000], ['空调滤清器', 12, 15000], ['火花塞', 48, 40000], ['刹车油', 24, 40000]], e: [['三电系统检测', 12, 0], ['电池/电机冷却液', 48, 60000], ['减速器油', 48, 60000]] },
  '特斯拉 / 纯电': { e: [['空调滤清器', 24, 0], ['刹车油', 48, 40000], ['电池/电机冷却液', 96, 0], ['轮胎换位', 12, 10000], ['空调干燥剂', 48, 0]] }
};
function renderBrandTpl() {
  const box = document.getElementById('tplBox');
  if (!box) return;
  const v = curVehicle() || {};
  const keys = Object.keys(BRAND_TPL);
  box.innerHTML = '<select id="tplBrand">' + keys.map(k => '<option>' + k + '</option>').join('') + '</select>'
    + '<button class="btn ghost" style="width:100%;margin-top:10px" onclick="applyBrandTpl()">应用到「' + esc(v.name || '当前车辆') + '」</button>'
    + '<div class="note">按厂家保养手册整理，仅作参考；以随车手册与 4S 要求为准。</div>';
}
function applyBrandTpl() {
  const key = document.getElementById('tplBrand').value;
  const tpl = BRAND_TPL[key]; if (!tpl) return;
  const v = curVehicle();
  const power = normPower(v.power);
  const arr = (power === 'ev' ? (tpl.e || tpl.f) : (power === 'fuel' ? tpl.f : (tpl.f || []).concat(tpl.e || [])));
  if (!arr || !arr.length) { toast('该品牌暂无对应动力类型的模板'); return; }
  if (!confirm('把「' + key + '」的 ' + arr.length + ' 条周期写入「' + v.name + '」的保养规则？同名规则会被覆盖。')) return;
  arr.forEach(([name, months, km]) => {
    const r = DB.rules.find(x => x.name === name && (x.model || '') === v.name);
    if (r) { r.months = months; r.km = km; }
    else DB.rules.push({ id: uid(), name, model: v.name, months, km });
  });
  save(); renderSettings(); renderReminders(); toast('已应用 ' + arr.length + ' 条规则');
}

/* ============================================================================
 * 十三、通知排程（系统级定时）
 * ========================================================================== */
function buildNotiList() {
  const s = DB.settings;
  const lead = parseInt(s.lead) || 0;
  let hh = 9, mm = 0;
  const t = String(s.notiTime || '09:00').split(':');
  hh = parseInt(t[0]); mm = parseInt(t[1]) || 0;
  if (isNaN(hh)) { hh = 9; mm = 0; }
  const cur = hh * 60 + mm;
  const qs = String(s.quietStart || '22:00').split(':'), qe = String(s.quietEnd || '07:00').split(':');
  const a = (parseInt(qs[0]) || 22) * 60 + (parseInt(qs[1]) || 0);
  const b = (parseInt(qe[0]) || 7) * 60 + (parseInt(qe[1]) || 0);
  const inQuiet = a > b ? (cur >= a || cur < b) : (cur >= a && cur < b);
  if (inQuiet) { hh = parseInt(qe[0]) || 7; mm = parseInt(qe[1]) || 0; }

  const out = [];
  const now = Date.now();
  const push = (id, title, body, dateStr) => {
    if (!dateStr) return;
    const d = new Date(String(dateStr).slice(0, 10) + 'T00:00:00');
    if (isNaN(d)) return;
    d.setDate(d.getDate() - lead);
    d.setHours(hh, mm, 0, 0);
    const ts = d.getTime();
    if (ts < now - 3600000) return;              // 已经过去的排了也没用
    if (ts > now + 400 * 86400000) return;        // 只排一年内，避免系统限制
    out.push({ id: String(id).replace(/[^\w-]/g, '').slice(0, 40), title: String(title).slice(0, 60), body: String(body || '').slice(0, 120), ts: ts });
  };
  const v = curVehicle() || {};
  DB.reminders.filter(r => r.vehicleId === CUR).forEach(r => {
    const e = evalReminder(r);
    if (e.dateNext) push(r.id, '保养提醒：' + r.name, e.detail.join('，'), e.dateNext);
    if ((r.basis === 'mileage' || r.basis === 'both') && +r.km > 0) {
      const rem = xNum(r.lastMileage) + xNum(r.km) - xNum(v.mileage);
      const dd = avgDailyKm();
      if (dd > 0 && rem > 0) {
        const d2 = new Date(); d2.setDate(d2.getDate() + Math.round(rem / dd));
        push(r.id + 'm', '里程提醒：' + r.name, '按你的用车频率，约 ' + Math.round(rem) + ' km 后到期', d2.toISOString().slice(0, 10));
      }
    }
  });
  expiryList().forEach(x => push('exp' + x.label, '到期提醒：' + x.label, x.date + (x.sub ? '　' + x.sub : ''), x.date));
  DB.parts.filter(p => p.vehicleId === CUR).forEach(p => {
    const w = partWarrantyEnd(p);
    if (w) push('pw' + p.id, '保修将到期：' + p.name, '保修至 ' + w, w);
  });
  DB.plans.filter(p => p.vehicleId === CUR && p.expire).forEach(p => {
    push('pl' + p.id, '套餐将到期：' + p.name, '有效期至 ' + p.expire, p.expire);
  });
  return out.sort((x, y) => x.ts - y.ts).slice(0, 64);
}
function pushNotifications() {
  if (!window.__ccNative) return;
  if (!DB.settings.push) { try { window.__ccNative({ type: 'schedule', items: [] }); } catch (e) { } return; }
  try { window.__ccNative({ type: 'schedule', items: buildNotiList() }); } catch (e) { }
}
function updateBadge() {
  if (!window.__ccNative) return;
  const n = DB.reminders.filter(r => r.vehicleId === CUR && evalReminder(r).status !== 'ok').length
    + expiryList().filter(x => x.days <= 30).length;
  const v = curVehicle() || {};
  const st = fuelStats();
  const mKey = xYm(new Date());
  const monthCost = DB.costs.filter(c => c.vehicleId === CUR && String(c.date).slice(0, 7) === mKey)
    .reduce((s, c) => s + xNum(c.amount), 0)
    + DB.fuels.filter(f => f.vehicleId === CUR && String(f.date).slice(0, 7) === mKey).reduce((s, f) => s + xNum(f.amount), 0)
    + DB.records.filter(r => r.vehicleId === CUR && String(r.date).slice(0, 7) === mKey).reduce((s, r) => s + xNum(r.cost), 0);
  let nextLabel = '暂无待办', nextDays = null;
  const cands = [];
  DB.reminders.filter(r => r.vehicleId === CUR).forEach(r => {
    const e = evalReminder(r);
    if (e.dateNext) cands.push({ label: r.name, d: xDays(e.dateNext) });
  });
  expiryList().forEach(x => cands.push({ label: x.label, d: x.days }));
  cands.sort((a, b) => (a.d === null ? 9999 : a.d) - (b.d === null ? 9999 : b.d));
  if (cands.length) { nextLabel = cands[0].label; nextDays = cands[0].d; }
  try {
    window.__ccNative({
      type: 'badge', count: DB.settings.badge ? n : 0,
      widget: {
        title: nextLabel,
        days: nextDays,
        mileage: xNum(v.mileage),
        month: Math.round(monthCost),
        oil: st.avg ? +st.avg.toFixed(1) : 0,
        updated: Date.now()
      }
    });
  } catch (e) { }
}
let _nativeTimer = null;
function scheduleNativeSync() {
  clearTimeout(_nativeTimer);
  _nativeTimer = setTimeout(() => {
    try { pushNotifications(); } catch (e) { }
    try { updateBadge(); } catch (e) { }
  }, 900);
}
function reSchedule() {
  pushNotifications(); updateBadge();
  toast('已按当前数据重排 ' + buildNotiList().length + ' 条提醒');
}

function renderNotiCfg() {
  const box = document.getElementById('notiBox');
  if (!box) return;
  const s = DB.settings;
  const leads = [0, 1, 3, 7, 15, 30];
  box.innerHTML = '<div class="kv"><span>提前提醒</span>'
    + '<select id="nLead" style="width:118px" onchange="saveNotiCfg(\'lead\',this.value)">'
    + leads.map(n => '<option value="' + n + '"' + (parseInt(s.lead) === n ? ' selected' : '') + '>' + (n === 0 ? '当天' : n + ' 天前') + '</option>').join('')
    + '</select></div>'
    + '<div class="kv"><span>推送时间</span><input id="nTime" type="time" style="width:118px" value="' + (s.notiTime || '09:00') + '" onchange="saveNotiCfg(\'notiTime\',this.value)"></div>'
    + '<div class="kv"><span>免打扰</span><div class="row" style="gap:6px"><input id="nQS" type="time" style="width:96px" value="' + (s.quietStart || '22:00') + '" onchange="saveNotiCfg(\'quietStart\',this.value)">'
    + '<input id="nQE" type="time" style="width:96px" value="' + (s.quietEnd || '07:00') + '" onchange="saveNotiCfg(\'quietEnd\',this.value)"></div></div>'
    + '<div class="kv" style="align-items:center"><span>图标角标显示待办数</span>'
    + '<label class="switch"><input type="checkbox"' + (s.badge ? ' checked' : '') + ' onchange="saveNotiCfg(\'badge\',this.checked)"><i></i></label></div>'
    + '<button class="btn line" style="width:100%;margin-top:10px" onclick="reSchedule()">立即重排全部提醒</button>'
    + '<div class="note">当前将排入 ' + buildNotiList().length + ' 条系统通知；重装或改系统时间后点一次「立即重排」。</div>';
}
function saveNotiCfg(k, v) {
  if (k === 'lead') DB.settings[k] = parseInt(v) || 0;
  else if (k === 'badge') DB.settings[k] = !!v;
  else DB.settings[k] = v;
  save(); renderNotiCfg(); pushNotifications(); updateBadge();
}

/* ============================================================================
 * 十四、故障灯与症状自查（离线手册）
 * ========================================================================== */
const LIGHTS = [
  { n: '机油压力警告', c: 'red', d: '机油压力过低，润滑随时可能失效', a: '立即靠边停车熄火。等 5 分钟查机油尺，不足则补同规格机油；补后仍亮说明泵或油道故障，不要继续行驶，直接叫救援。' },
  { n: '水温过高', c: 'red', d: '冷却液温度超标', a: '停车怠速散热，绝对不要立刻开水箱盖（会喷沸水）。等降温后查冷却液与风扇皮带；继续行驶会拉缸、顶缸盖。' },
  { n: '制动系统警告', c: 'red', d: '手刹未松 / 刹车油位低 / 制动系统故障', a: '先确认手刹。若踩刹车变软、踏板下沉，立即停车，切勿行驶——可能已失去部分制动力。' },
  { n: '电瓶 / 充电警告', c: 'red', d: '发电机不发电或电瓶故障', a: '关掉空调、音响等大功率电器，就近到维修点。此时靠电瓶余电行驶，熄火后很可能无法再启动。' },
  { n: '安全气囊 SRS', c: 'red', d: '气囊系统故障', a: '碰撞时气囊可能不弹出，尽快检修；期间保持安全带正确佩戴。' },
  { n: '胎压警告', c: 'amber', d: '胎压异常或传感器故障', a: '就近检查四轮胎压并补气；冬季气温骤降常触发误报，复位后观察。胎侧鼓包必须换胎。' },
  { n: '发动机故障灯', c: 'amber', d: '发动机 / 排放系统异常', a: '常亮可低速行驶并尽快读故障码；若闪烁，说明可能正在损伤三元催化，应立即停车。' },
  { n: 'ABS 警告', c: 'amber', d: '防抱死系统失效', a: '常规制动仍有效，但急刹易抱死。雨天降速慢行，尽快检修轮速传感器。' },
  { n: 'EPS 转向助力', c: 'amber', d: '电动助力转向异常', a: '转向会明显变沉，低速谨慎行驶至维修点，避免高速并线。' },
  { n: '保养提示', c: 'amber', d: '达到保养里程 / 时间', a: '按手册更换机油机滤，并复位保养提示（部分车型需诊断仪）。' },
  { n: '变速箱温度', c: 'amber', d: '变速箱油温过高', a: '停车怠速散热，避免长时间拖车或高负荷爬坡；反复出现需查油量与散热器。' },
  { n: '机油液位', c: 'amber', d: '机油量低于标准', a: '补加同规格机油至上限，并留意是否渗漏或烧机油（蓝烟）。' }
];
const SYMPTOMS = [
  { n: '冷车启动抖动 / 怠速不稳', c: '节气门积碳、火花塞老化、点火线圈失效、进气漏气', a: '先查火花塞与节气门，多在 3 万公里后出现；故障灯亮时读码可定位缺火缸。' },
  { n: '刹车异响（尖叫 / 金属摩擦）', c: '刹车片磨到极限、背板直接磨盘、砂石异物', a: '尖叫多为磨损指示片报警，尽快换片并检查刹车盘厚度；金属摩擦声说明已到极限。' },
  { n: '方向盘抖动', c: '低速抖＝轮胎变形鼓包；高速抖＝动平衡或四轮定位失准', a: '先做四轮动平衡，再做定位；同时检查轮胎是否鼓包或失圆。' },
  { n: '油耗突然升高', c: '胎压不足、氧传感器失效、积碳、刹车拖滞、长期拥堵', a: '按顺序查：胎压 → 空滤 → 氧传感器 → 刹车是否拖滞；别急着大修。' },
  { n: '空调不制冷', c: '冷媒不足或渗漏、压缩机不工作、冷凝器脏堵、空调滤堵塞', a: '先换空调滤、清洗冷凝器，再测高低压判断是否缺冷媒；只补冷媒不查漏会复发。' },
  { n: '加速无力 / 提速肉', c: '燃油滤堵塞、三元催化堵塞、涡轮故障、变速箱打滑', a: '读故障码 + 查燃油压力与进气；变速箱打滑通常伴随转速飙升但车速不上。' },
  { n: '底盘异响（过坎咚咚）', c: '减震器失效、稳定杆衬套老化、球头松旷', a: '举升检查衬套与球头；减震器漏油建议同轴成对更换。' },
  { n: '方向盘跑偏', c: '四轮定位失准、胎压不均、悬挂件变形', a: '先校准四轮胎压，再做四轮定位；事故后跑偏要查悬挂是否变形。' },
  { n: '排气管冒蓝烟 / 白烟', c: '蓝烟＝烧机油；持续白烟＝冷却液进入燃烧室', a: '蓝烟查活塞环与气门油封；持续白烟多为缸垫损坏，需尽快维修，否则会拉缸。' },
  { n: '电瓶频繁亏电', c: '电瓶老化、发电机输出不足、暗电流过大', a: '测静态暗电流与充电电压（应在 13.8–14.6V）；超过 4 年的电瓶建议直接更换。' },
  { n: '变速箱顿挫 / 冲击', c: '变速箱油老化、阀体脏堵、电控故障', a: '按周期换油（4–6 万公里）；顿挫明显需读变速箱故障码，别只做「自适应学习」。' },
  { n: '雨刮刮不干净 / 异响', c: '胶条老化、雨刮臂压力不足、玻璃有油膜', a: '换雨刮片并做玻璃去油膜，通常 1 年一换；异响多为胶条硬化。' }
];
let manualTab = 'lights';
function openManual(tab) {
  manualTab = tab || 'lights';
  const old = document.getElementById('cc-page');
  if (old) old.remove();
  const el = document.createElement('div');
  el.className = 'page';
  el.id = 'cc-page';
  el.innerHTML = '<div class="page-head"><b>用车手册</b><button class="back" onclick="closePage()">关闭</button></div>'
    + '<div class="page-body">'
    + '<div class="seg"><button class="' + (manualTab === 'lights' ? 'on' : '') + '" onclick="openManual(\'lights\')">故障灯</button>'
    + '<button class="' + (manualTab === 'symptoms' ? 'on' : '') + '" onclick="openManual(\'symptoms\')">症状自查</button></div>'
    + '<input id="manQ" placeholder="搜索，如：抖动 / 刹车 / 空调" oninput="renderManual()">'
    + '<div id="manList" style="margin-top:12px" class="rowlist"></div>'
    + '<div class="note" style="margin-top:14px">以上为通用经验判断，不能替代现场检测；涉及制动、转向、高压系统的异常请直接到店检修。</div>'
    + '</div>';
  document.body.appendChild(el);
  renderManual();
}
function closePage() {
  const el = document.getElementById('cc-page');
  if (el) el.remove();
}
function renderManual() {
  const box = document.getElementById('manList');
  if (!box) return;
  const q = (document.getElementById('manQ').value || '').trim();
  if (manualTab === 'lights') {
    const list = LIGHTS.filter(x => !q || (x.n + x.d + x.a).indexOf(q) >= 0);
    box.innerHTML = list.length ? list.map(x => '<div class="item"><div class="lamp">'
      + '<div class="g ' + x.c + '">' + (x.c === 'red' ? '●' : '▲') + '</div>'
      + '<div style="flex:1;min-width:0"><div class="t">' + esc(x.n) + '<span class="sp"></span>'
      + '<span class="pill ' + (x.c === 'red' ? 'bad' : 'warn') + '">' + (x.c === 'red' ? '立即停车' : '尽快检查') + '</span></div>'
      + '<div class="s">' + esc(x.d) + '</div>'
      + '<div class="s" style="color:var(--ink-2)">' + esc(x.a) + '</div></div></div></div>').join('')
      : '<div class="empty">没有匹配的故障灯。</div>';
  } else {
    const list = SYMPTOMS.filter(x => !q || (x.n + x.c + x.a).indexOf(q) >= 0);
    box.innerHTML = list.length ? list.map(x => '<div class="item"><div class="t">' + esc(x.n) + '</div>'
      + '<div class="s">可能原因：' + esc(x.c) + '</div>'
      + '<div class="s" style="color:var(--ink-2)">建议：' + esc(x.a) + '</div></div>').join('')
      : '<div class="empty">没有匹配的症状。</div>';
  }
}

/* ============================================================================
 * 十五、车辆履历 PDF（卖车用）
 * ========================================================================== */
function exportHistory() {
  const v = curVehicle() || {};
  const recs = DB.records.filter(r => r.vehicleId === CUR).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const fuels = DB.fuels.filter(f => f.vehicleId === CUR).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const costs = DB.costs.filter(c => c.vehicleId === CUR);
  const st = fuelStats();
  const parts = DB.parts.filter(p => p.vehicleId === CUR);
  const t = tireOf(CUR);
  const recCost = recs.reduce((s, r) => s + xNum(r.cost), 0);
  const fuelCost = fuels.reduce((s, f) => s + xNum(f.amount), 0);
  const otherCost = costs.reduce((s, c) => s + xNum(c.amount), 0);
  const km = xNum(v.mileage);
  const row = (a, b) => '<tr><td style="width:96px;color:#6b7785">' + a + '</td><td>' + b + '</td></tr>';
  const html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>' + esc(v.name) + ' 车辆履历</title>'
    + '<style>'
    + 'body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#16202c;padding:30px 26px;line-height:1.6}'
    + 'h1{font-size:21px;margin:0 0 4px}'
    + '.sub{color:#6b7785;font-size:12px;margin-bottom:18px}'
    + 'h2{font-size:14px;margin:22px 0 8px;padding-left:8px;border-left:3px solid #0a84ff}'
    + 'table{width:100%;border-collapse:collapse;font-size:11.5px}'
    + 'th,td{border:1px solid #dde3ea;padding:6px 7px;text-align:left;vertical-align:top}'
    + 'th{background:#f4f7fb;font-weight:600}'
    + '.kv td{border:none;border-bottom:1px solid #eef1f5;padding:5px 2px}'
    + '.sum{margin-top:8px;font-size:12.5px;font-weight:700}'
    + '.foot{margin-top:26px;color:#8a95a3;font-size:10.5px;border-top:1px dashed #dde3ea;padding-top:10px}'
    + '@media print{.nop{display:none}body{padding:12px}}'
    + '</style></head><body>'
    + '<h1>' + esc(v.name) + ' · 车辆履历</h1>'
    + '<div class="sub">' + esc(v.model || '') + '　' + esc(v.plate || '') + '　生成于 ' + today() + '</div>'
    + '<button class="nop" onclick="window.print()" style="padding:8px 16px;margin-bottom:14px">打印 / 另存为 PDF</button>'
    + '<h2>车辆信息</h2><table class="kv">'
    + row('车型', esc(v.model || '—')) + row('车牌', esc(v.plate || '—')) + row('VIN', esc(v.vin || '—'))
    + row('动力类型', POWER_LABEL[normPower(v.power)]) + row('购买日期', esc(v.buyDate || '—'))
    + row('当前里程', fmt(km) + ' km') + row('保险到期', esc(v.insuranceDue || '—'))
    + row('年检到期', esc(v.inspectionDue || '—')) + row('原厂质保', esc(v.warrantyEnd || '—'))
    + '</table>'
    + '<h2>养护与维修记录（' + recs.length + ' 次）</h2>'
    + (recs.length ? '<table><tr><th>日期</th><th>里程</th><th>类别</th><th>项目</th><th>金额</th><th>门店</th></tr>'
      + recs.map(r => '<tr><td>' + r.date + '</td><td>' + fmt(r.mileage) + '</td><td>' + esc(r.cat) + (r.kind === 'repair' ? '（维修）' : '') + '</td><td>'
        + (r.items || []).map(i => esc(typeof i === 'string' ? i : i.name)).join('、')
        + (r.fault ? '<br><span style="color:#6b7785">故障：' + esc(r.fault) + '</span>' : '')
        + '</td><td>' + money(r.cost) + '</td><td>' + esc(r.shop || '') + '</td></tr>').join('')
      + '</table>' : '<div class="sub">暂无记录</div>')
    + '<h2>加油与油耗</h2>'
    + (fuels.length ? '<table><tr><th>日期</th><th>里程</th><th>油量</th><th>金额</th><th>单价</th></tr>'
      + fuels.map(f => '<tr><td>' + f.date + '</td><td>' + fmt(f.mileage) + '</td><td>' + xNum(f.liters).toFixed(2) + ' L</td><td>' + money(f.amount) + '</td><td>' + (f.price || '—') + '</td></tr>').join('')
      + '</table><div class="sum">平均油耗 ' + (st.avg ? st.avg.toFixed(1) : '—') + ' L/100km　累计加油 ' + money(fuelCost) + '</div>'
      : '<div class="sub">暂无加油记录</div>')
    + (t ? '<h2>轮胎</h2><table class="kv">' + row('品牌型号', esc([t.brand, t.size].filter(Boolean).join(' ') || '—'))
      + row('DOT 生产周', esc(t.dot || '—'))
      + row('上次花纹(mm)', TIRE_POS.map(([k, n]) => n + ' ' + (xNum((t.pos || {})[k] && t.pos[k].d) ? xNum(t.pos[k].d).toFixed(1) : '—')).join('　'))
      + '</table>' : '')
    + (parts.length ? '<h2>更换配件与保修</h2><table><tr><th>配件</th><th>更换日期</th><th>里程</th><th>保修</th></tr>'
      + parts.map(p => '<tr><td>' + esc(p.name) + '</td><td>' + p.date + '</td><td>' + fmt(p.mileage) + '</td><td>'
        + (p.warrantyMonths ? p.warrantyMonths + ' 个月' : '') + (p.warrantyKm ? ' / ' + fmt(p.warrantyKm) + ' km' : '') + '</td></tr>').join('')
      + '</table>' : '')
    + '<h2>费用汇总</h2><table class="kv">'
    + row('养护维修', money(recCost)) + row('加油', money(fuelCost)) + row('其他', money(otherCost))
    + row('累计', money(recCost + fuelCost + otherCost))
    + (km > 0 ? row('每公里综合成本', '¥' + ((recCost + fuelCost + otherCost) / km).toFixed(2)) : '')
    + '</table>'
    + '<div class="foot">本履历由「车管家」根据车主日常记录生成，用于展示车辆养护情况，可作为二手交易时的车况参考，不具备法律效力。</div>'
    + '</body></html>';
  const w = window.open('');
  if (w) { w.document.write(html); w.document.close(); }
}

/* ============================================================================
 * 十六、语音记账（原生识别后回调）
 * ========================================================================== */
let _voiceKind = 'cost';
function voiceFill(kind) {
  _voiceKind = kind || 'cost';
  if (!window.__ccNative) { toast('当前环境不支持语音录入'); return; }
  try { window.__ccNative({ type: 'voice' }); toast('请说出，如「加油 300 块」'); }
  catch (e) { toast('语音不可用'); }
}
function ccVoiceResult(text) {
  if (window.__ccVoiceHook) { const hk = window.__ccVoiceHook; window.__ccVoiceHook = null; hk(String(text || '').trim()); return; }
  const s = String(text || '').trim();
  if (!s) { toast('没听清，再试一次'); return; }
  const nums = (s.match(/\d+(\.\d+)?/g) || []).map(Number);
  const amt = nums.length ? nums[nums.length - 1] : 0;
  const isFuel = /加油|油|升/.test(s), isChg = /充电|度|桩|电费/.test(s) && !isFuel;
  if (_voiceKind === 'charge' || (isChg && _voiceKind !== 'cost' && _voiceKind !== 'fuel')) {
    pickRec('charge');
    if (amt) document.getElementById('chAmt').value = amt;
    const pl = document.getElementById('chPlace');
    if (pl && !pl.value) pl.value = s;
    calcChPrice();
    toast('已识别：' + s); return;
  }
  if (_voiceKind === 'fuel' || (isFuel && _voiceKind !== 'cost')) {
    pickRec('fuel');
    if (amt) document.getElementById('fAmt').value = amt;
    const st = document.getElementById('fStation');
    if (st && !st.value) st.value = s;
    calcFuelPrice();
  } else {
    pickRec('cost');
    if (amt) document.getElementById('cAmt2').value = amt;
    const n = document.getElementById('cNote2');
    if (n) n.value = s;
    const t = document.getElementById('cType2');
    if (t) {
      if (/停车|过路|高速/.test(s)) t.value = '停车/过路';
      else if (/洗车|美容|打蜡/.test(s)) t.value = '洗车美容';
      else if (/保险/.test(s)) t.value = '保险';
      else if (/违章|罚款/.test(s)) t.value = '违章罚款';
      else if (isFuel) t.value = '油费';
      else if (/维修|修车/.test(s)) t.value = '维修';
    }
  }
  toast('已识别：' + s);
}

/* ============================================================================
 * 十七、聚合渲染（由主脚本在 renderAll 时调用）
 * ========================================================================== */
/* 每公里综合成本 / 本年支出（成本页顶部两个小卡） */
function updateFinanceExtra(){
  const v = curVehicle() || {};
  const recs = DB.records.filter(r => r.vehicleId === CUR);
  const fuels = DB.fuels.filter(f => f.vehicleId === CUR);
  const costs = DB.costs.filter(c => c.vehicleId === CUR);
  const total = recs.reduce((s, r) => s + xNum(r.cost), 0)
    + fuels.reduce((s, f) => s + xNum(f.amount), 0)
    + costs.reduce((s, c) => s + xNum(c.amount), 0);
  // 统计里程：取最早与最晚的里程记录
  const kmRows = [];
  recs.forEach(r => kmRows.push({ d: r.date, m: xNum(r.mileage) }));
  fuels.forEach(f => kmRows.push({ d: f.date, m: xNum(f.mileage) }));
  DB.odo.filter(o => o.vehicleId === CUR).forEach(o => kmRows.push({ d: o.date, m: xNum(o.mileage) }));
  const ok = kmRows.filter(r => r.d && r.m > 0).sort((a, b) => String(a.d).localeCompare(String(b.d)));
  const span = ok.length > 1 ? ok[ok.length - 1].m - ok[0].m : 0;
  const per = document.getElementById('costPerKm');
  if (per) per.textContent = span > 0 ? ('¥' + (total / span).toFixed(2)) : '—';
  const y = new Date().getFullYear() + '-';
  const yearTotal = recs.filter(r => String(r.date).indexOf(y) === 0).reduce((s, r) => s + xNum(r.cost), 0)
    + fuels.filter(f => String(f.date).indexOf(y) === 0).reduce((s, f) => s + xNum(f.amount), 0)
    + costs.filter(c => String(c.date).indexOf(y) === 0).reduce((s, c) => s + xNum(c.amount), 0);
  const ye = document.getElementById('costYear');
  if (ye) ye.textContent = '¥' + fmt(Math.round(yearTotal));
}

function xRenderAll() {
  try { renderExpiry(); } catch (e) { }
  try { renderSeasonList(); } catch (e) { }
  try { renderCalendar(); } catch (e) { }
  try { renderGarageHealth(); } catch (e) { }
  try { renderOilStats(); } catch (e) { }
  try { renderPlans(); } catch (e) { }
  try { renderNotiCfg(); } catch (e) { }
  try { renderBrandTpl(); } catch (e) { }
  try { renderFuelList(); } catch (e) { }
  try { renderCostList(); } catch (e) { }
  try { scheduleNativeSync(); } catch (e) { }
}
