# 拿铁桌宠

一个面向 Windows 与 macOS 的 Electron 桌宠。拿铁具备透明窗口、置顶、拖动、逐帧点击互动、自主散步、睡眠、伸懒腰、待机动作、托盘菜单、位置记忆、固定 80% 尺寸和开机启动。所有逐帧动作使用统一的底部锚点和固定动作比例，避免动作切换时整体漂移或缩放。

## 互动

- 从“和拿铁互动”菜单拿小饼干：拿铁会盯着饼干、坐好等待，吃完后低头回应并摇尾巴；自主模式下她也会偶尔讨零食。
- 从菜单拿出小球后，可将小球拖到桌面任意位置。拿铁会跑去叼回，并把它放到鼠标附近；偶尔会叼着不放，点击她即可让她松口。
- 小窝是可移动、会记住位置的独立桌面垫子。点击小窝或选择“回小窝休息”可让她回去睡觉；夜间自主打盹的概率更高。点击睡着的拿铁会先睁一只眼，再慢慢抬头。

## 本地运行

```powershell
npm install
npm start
```

右键拿铁可以打开菜单。拖动拿铁会移动窗口；单击不同身体部位会触发不同反应。拿铁会偶尔自主散步、讨零食、睡觉、伸懒腰或执行待机动作，也可以从右键菜单手动触发主要动作。

## 检查与测试

```powershell
npm run check
npm test
npm run smoke:windows
```

## macOS 打包

必须在 macOS 上运行以下命令；它会构建同时支持 Apple Silicon 与 Intel Mac 的 Universal `.app`、`.zip` 和 `.dmg`。Electron Forge 的 DMG 只能在 macOS 上构建，产物会位于 `out/make/`。 

```bash
npm ci
npm run make:mac
```

构建完成后，将 `out/make/**/Latte Pet-*.dmg` 发给普通用户安装，或解压 ZIP 后将 `Latte Pet.app` 拖入“应用程序”文件夹。未签名包能运行但 macOS Gatekeeper 可能提示风险；正式分发请签名并公证。

### GitHub Actions 构建

仓库包含 [macOS 构建工作流](.github/workflows/macos-build.yml)。推送到 `main` 的应用相关改动或手动执行 **Build macOS Latte Pet** 后，Actions 会在 `macos-14` 上检查、测试、构建 Universal `.app`、DMG 与 ZIP，并将它们作为 `Latte-Pet-macos-universal` 构建产物上传。

要让 CI 生成可直接分发的签名/公证版本，在仓库 Secrets 中配置：

- `MACOS_CERTIFICATE_BASE64`：Developer ID Application `.p12` 的 Base64 内容
- `MACOS_CERTIFICATE_PASSWORD`：`.p12` 密码
- `MACOS_KEYCHAIN_PASSWORD`：CI 临时钥匙串密码
- `MAC_CODESIGN_IDENTITY`：证书完整名称
- `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`：Apple 公证凭据

正式分发前，需要 Apple Developer Program、Xcode、Developer ID Application 证书以及 Apple 公证凭据：

```bash
export MAC_CODESIGN_IDENTITY="Developer ID Application: Your Name (TEAMID)"
export APPLE_ID="your-apple-id@example.com"
export APPLE_APP_SPECIFIC_PASSWORD="your-app-specific-password"
export APPLE_TEAM_ID="TEAMID"
npm run make:mac
```

凭据只通过环境变量读取，不要写入项目文件。

## 隐私与素材

`images/` 中的原始参考照片、测试代码、生成提示词和已停用的服装源素材都被排除在应用安装包之外。运行时只打包定稿图和逐帧动作。

## macOS 已知事项

- 本项目已配置为 macOS 菜单栏型应用（启动后不显示 Dock 图标），小球和小窝同样以透明桌面窗口呈现。
- 真机分发前仍建议在目标 macOS 版本验证多桌面、全屏空间、Gatekeeper 与公证结果。
