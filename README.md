# DSH Web Providers

为 DeepSeek Harness（DSH）统一接入三个消费端 Provider：

- `workbuddy-cn`：WorkBuddy 中国区；
- `workbuddy-global`：WorkBuddy 国际版；
- `doubao-web`：豆包网页版，包括普通模式和深度思考模式。

WorkBuddy 支持 API Key 或网页登录令牌。豆包使用独立 Chrome 窗口获取网页版登录状态，
不读取豆包桌面端数据，也不需要火山方舟 API Key。

本项目基于 [Axiaohungry/dsh-llm-workbuddy](https://github.com/Axiaohungry/dsh-llm-workbuddy)
继续开发，保留 MIT 许可证与上游归属。`llm-workbuddy` 内部插件 ID 暂时保留，以保证旧版
WorkBuddy 设置和凭据可直接升级。

> [!IMPORTANT]
> 这是第三方适配器，不属于 WorkBuddy、腾讯、豆包、字节跳动或 DeepSeek 官方项目。
> 豆包接入使用消费端网页协议，协议可能随网页更新而变化。请只使用你有权使用的账号和额度，
> 并遵守对应服务条款。

## 功能

- WorkBuddy 中国区、国际版和豆包在同一插件中注册，凭据彼此隔离；
- WorkBuddy 支持 API Key、多登录账号、自动刷新令牌和在线模型目录；
- WorkBuddy 模型菜单显示倍率、限时活动、上下文窗口和思考强度；
- 豆包只使用网页登录态，不依赖豆包桌面端，也不走官方 Ark API；
- 豆包调用由无界面 Chrome 加载官网签名逻辑，不在仓库中固化 `a_bogus` 算法；
- 豆包每轮把 DSH 完整上下文发给网页模型，结束后尽量删除服务端临时对话；
- 豆包通过严格 JSON 信封适配 DSH 工具调用；
- DSH 继续负责 Agent 循环、权限、工具执行、本地会话和系统提示词。

## 环境要求

- DSH `>= 0.1.5-rc.1 <0.2.0`；
- Node.js `>= 22.19.0`；
- Google Chrome 或 Chromium。也可用 `DSH_DOUBAO_CHROME` 指定浏览器可执行文件。

当前依赖线与 DSH Desktop `2.0.9` 内置的 DSH `0.1.5-rc.1`、pi-ai `0.85.1` 对齐。

## 安装

### DSH Desktop

先完全退出 DSH Desktop，再运行：

```sh
npx --yes --package=github:l77948032-cyber/DSH-Web-Providers#v2.0.0 \
  dsh-web-providers install --profile desktop
```

安装器会自动移除这个项目的旧包名，再安装当前版本。旧命令 `dsh-workbuddy` 仍作为兼容别名。

### DSH Web / Headless

```sh
dsh plugin --profile web add github:l77948032-cyber/DSH-Web-Providers#v2.0.0
dsh plugin --profile headless add github:l77948032-cyber/DSH-Web-Providers#v2.0.0
```

安装后重启 DSH。不要同时安装上游 `@axiaohungry/dsh-llm-workbuddy`，它与本项目使用相同
的兼容插件 ID。

卸载：

```sh
npx --yes --package=github:l77948032-cyber/DSH-Web-Providers#v2.0.0 \
  dsh-web-providers uninstall --profile desktop
```

## 豆包网页登录

运行：

```sh
dsh-web-providers login doubao
```

命令会打开一个独立 Chrome 窗口。完成扫码或账号登录后，窗口会自动关闭，Cookie、官网设备
参数和站点存储会作为一个 JSON 会话写入 DSH 的 `.credentials.yaml`，文件权限为 `0600`。
它们不会写入仓库或 `settings.yaml`。重启 DSH 后选择：

- `豆包 网页版`；
- `豆包 网页版（深度思考）`。

Cookie 过期时重新执行登录命令。豆包没有向第三方提供这条消费端会话的刷新令牌，因此插件
不会伪造自动续期。网页模型的免费额度、限流和可用能力均以豆包账号当时的实际页面状态为准。

## WorkBuddy 登录与 API Key

网页登录：

```sh
dsh-web-providers login workbuddy --region cn
dsh-web-providers login workbuddy --region global
```

也兼容旧写法：

```sh
dsh-workbuddy login --region global
```

WorkBuddy 登录令牌同样保存在 DSH 凭据服务中，并在到期前调用对应区域的刷新接口。也可以在
DSH 设置的模型页面选择 API Key 模式：

- 中国区：`WORKBUDDY_API_KEY`，兼容旧名 `CODEBUDDY_API_KEY`；
- 国际版：`WORKBUDDY_GLOBAL_API_KEY`，兼容 `CODEBUDDY_GLOBAL_API_KEY`。

中国区和国际版使用各自的端点、账号与 Key 列表，不会串用凭据。

## 请求边界

WorkBuddy 请求只发送到对应官方区域站点：

```text
https://copilot.tencent.com
https://www.codebuddy.ai
```

豆包提示词、Cookie 和响应只在本机 DSH、临时 Chrome 进程与以下站点之间流转：

```text
https://www.doubao.com
```

插件不向项目作者或其他统计服务发送凭据、提示词或模型响应。

## 开发

```sh
npm ci --ignore-scripts
npm run check
npm pack --dry-run
```

单元测试覆盖 Provider 隔离、凭据格式、豆包请求体、SSE 解析、工具调用信封及 CLI 原子写入。
真实网页登录和调用需要使用有效豆包账号做集成验证。

## License

[MIT](./LICENSE)
