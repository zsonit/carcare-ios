# 车管家 iOS（CarCare）

汽车维修保养记录与智能提醒的 **iOS 原生 App**，功能与安卓版 / PWA 版完全一致。
页面沿用开源项目 [kenowong/car-maintenance](https://github.com/kenowong/car-maintenance) 的离线自包含版（`docs/index.html`，MIT 协议），
外层是原生 iOS 外壳：内置网页通过本机 HTTP 服务加载，浏览器能力由原生桥接实现。

## 界面：iOS 27 Liquid Glass

整站视觉按 iOS 27 的液态玻璃语言重做（只改样式层与图标，业务逻辑一行未动）：

| 元素 | 做法 |
| --- | --- |
| 背景 | 多层柔和光斑墙纸（蓝 / 紫 / 青 / 暖橙径向渐变），给玻璃提供可折射的底层 |
| 卡片 / 弹窗 / 顶栏 | `backdrop-filter: blur(26px) saturate(190%)` + 半透明白渐变 + 1px 高光内描边 + 柔和投影 |
| 底部导航 | 悬浮玻璃胶囊，选中项是白色玻璃「镜头」高亮，图标换成 1.85px 线性 SVG |
| 控件 | 胶囊按钮（主按钮带玻璃高光与彩色投影）、iOS 尺寸开关（51×31）、系统蓝分段控件 |
| 弹窗 | 底部玻璃 sheet，32px 圆角 + 抓取条 + 背景模糊压暗 |
| 动效 | 页面切换 0.3s 弹簧淡入、按压 0.97 缩放，并遵循 `prefers-reduced-motion` |

| 提醒中心 | 维保服务 | 档案管理 | 成本统计 | 设置 |
| --- | --- | --- | --- | --- |
| ![提醒中心](screenshots/1-reminders.jpg) | ![维保服务](screenshots/2-services.jpg) | ![档案管理](screenshots/3-archive.jpg) | ![成本统计](screenshots/4-finance.jpg) | ![设置](screenshots/5-settings.jpg) |

## 功能对照（与安卓版逐项一致）

| 模块 | 功能 |
| --- | --- |
| 提醒中心 | 逾期/即将到期/正常统计、按车型分组的保养模板气泡、双维度（日期 + 里程）提醒、进度条、编辑 / 已保养顺延 / 删除 |
| 维保服务 | 按动力类型（燃油 / 油电混动 / 插电混动 / 纯电）自动切换服务目录、项目多选、自定义项目、逐项工时费 + 配件费、上次价格记忆、里程自动同步、同名提醒自动顺延 |
| 档案管理 | 多车档案（左滑删除）、车牌省简称 + 号码、VIN、购买日期、保险 / 年检到期自动生成提醒、维保记录列表与凭证缩略图 |
| 成本统计 | 累计 / 本月养车费用、按类别占比、按月 / 按年柱状图、手动记账（油费 / 保险 / 维修 / 停车过路 / 其他） |
| 设置 | 保养规则（按车型自定义周期）、消息推送、导出 CSV、导出 PDF、导入备份、示例数据、清空数据 |
| NAS 同步 | 本机 + NAS 双份存储、服务器地址 + 访问密钥、测试连接 / 立即同步 / 上次同步状态 |

## iOS 侧的原生适配（浏览器版做不到的部分）

| 网页能力 | iOS 实现 |
| --- | --- |
| `localStorage` 持久化 | 内置本机 HTTP 服务（`http://127.0.0.1:48700`）提供正常同源环境，数据存于 WebKit 持久化存储 |
| `confirm` / `alert` / `prompt` | 原生 `UIAlertController`，文案与网页一致 |
| 收据 / 发票凭证上传、导入备份 | WKWebView 原生文件选择面板（相册 / 拍照 / 「文件」），与 Safari 行为一致 |
| 导出 CSV | 截获 `blob:` 下载，写文件后调起系统分享（存到「文件」、发微信、AirDrop 等） |
| 导出 PDF | 离屏渲染生成 PDF，调起系统分享 |
| 查看凭证大图 | 原生全屏图片查看器，可保存 / 分享 |
| 消息推送通知 | `Notification` API 桥接到系统本地通知（前台也会弹出横幅） |
| 安装到主屏卡片 | 隐藏（本身就是独立 App，与安卓 WebView 版处理一致） |
| NAS 局域网访问 | 允许 HTTP 明文与局域网访问（`NSAllowsArbitraryLoadsInWebContent` + 本地网络权限说明） |

## 目录结构

```
CarCare/                  原生源码
  AppDelegate.swift       启动、窗口、本地通知授权
  WebViewController.swift WKWebView 容器 + 全部原生桥接
  LocalHTTPServer.swift   零依赖本地 HTTP 服务（Network.framework）
  PDFExporter.swift       HTML → PDF
  ImagePreviewController.swift  凭证图查看器
Resources/web/            内置网页（index.html / bridge.js / 图标）
tools/                    图标生成、网页资源同步脚本
project.yml               XcodeGen 工程描述
.github/workflows/build-ipa.yml   Actions 出包
```

## 构建

本机无 Mac，统一走 GitHub Actions（macOS 15 + XcodeGen）出 **未签名 IPA**：

```bash
git push origin main      # 自动构建，产物：Actions → carcare-ipa-unsigned
```

## 两种装法（都不需要 Mac）

### 方式一：直接添加到主屏幕（最快，零签名）

iPhone 用 **Safari** 打开 <https://zsonit.github.io/carcare-ios/> → 点「分享」→「添加到主屏幕」。

得到图标独立的 App 体验，Service Worker 首次加载后完全离线可用，数据本地保存。
无需 Apple ID、无需电脑、不会 7 天过期。

### 方式二：装 IPA（真·原生外壳）

`dist/CheGuanJia-iOS-v2.2.0-b4-unsigned.ipa` 是 GitHub Actions 编译出的未签名包。
iOS 强制签名校验，所以需要一个**重签名工具**（Windows 也可以，不需要 Mac）：

1. Windows 装 [Sideloadly](https://sideloadly.io/) 或 爱思助手；
2. 手机数据线连电脑，把 IPA 拖进工具，填自己的 Apple ID；
3. 工具自动签名并安装到手机。

免费 Apple ID 签名 7 天有效，到期重新点一次即可；付费开发者账号 1 年。
装完首次打开需在「设置 → 通用 → VPN与设备管理」里信任证书。

## 网页资源升级

上游页面更新后执行：

```bash
./tools/sync-web.sh /path/to/car-maintenance
```

会把 `docs/index.html`、`manifest.json`、`sw.js`、图标同步进 `Resources/web/`。

## 许可

页面与功能设计来自 kenowong/car-maintenance（MIT）。iOS 外壳代码同样以 MIT 发布。
