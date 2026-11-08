# 安装包

| 文件 | 说明 |
| --- | --- |
| `CheGuanJia-iOS-v2.4.0-b8-unsigned.ipa` | 未签名 IPA，由 GitHub Actions（macOS）编译，需重签名后安装 |

## 方式一：不用签名，直接在 iPhone 上装（推荐先试这个）

iPhone 用 **Safari** 打开 <https://zsonit.github.io/carcare-ios/> → 点底部「分享」→「添加到主屏幕」。

- 图标独立、全屏运行，体验与 App 一致
- 首次打开后完全离线可用
- 不需要 Apple ID、不需要电脑、不会 7 天过期
- 数据和 IPA 版一样只存本机

## 方式二：装 IPA（原生外壳版）

不需要 Mac，Windows 电脑就够：

1. Windows 上安装 [Sideloadly](https://sideloadly.io/)（需先装 iTunes 或 Apple Devices）；
2. 数据线连 iPhone，把本目录的 `.ipa` 拖进 Sideloadly，填自己的 Apple ID；
3. 点 Start，工具自动重签名并安装；
4. 手机上「设置 → 通用 → VPN与设备管理」信任该开发者证书。

免费 Apple ID 签名有效期 7 天，到期重签一次即可；付费开发者账号为 1 年。

> 未签名 IPA 不能直接双击安装，iOS 必须经过签名校验。若你没有 Windows 电脑，用方式一即可，功能完全相同。
