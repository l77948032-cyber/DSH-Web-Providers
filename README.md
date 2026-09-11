# DSH WorkBuddy Provider

以独立 Provider 为 DeepSeek Harness（DSH）接入 `WorkBuddy 中国区` 模型。支持
WorkBuddy API Key 和中国站网页登录令牌，不要求安装 WorkBuddy Desktop 或 WorkBuddy CLI。

本项目基于 [Axiaohungry/dsh-llm-workbuddy](https://github.com/Axiaohungry/dsh-llm-workbuddy)
修改，保留 MIT 许可证与上游归属。

> [!IMPORTANT]
> 这是第三方适配器，不属于 WorkBuddy、腾讯或 DeepSeek 官方项目。请只使用你有权使用的
> 账号和额度，并遵守对应服务条款。

## 与上游版本的区别

这个分支不会替换 DSH 内置的 `llm-pi-ai`：

- Cordis 补丁只新增 `llm-workbuddy`，不禁用任何内置插件；
- 运行时只注册 `workbuddy-cn`，不会代理其他 Provider 的请求；
- 使用独立的 `llm-workbuddy` 设置命名空间；
- OpenAI、Anthropic、自定义网关等 Provider 继续由 DSH 原生 Adapter 负责；
- CLI 写入令牌时以 `0600` 权限原子替换凭据文件。

因此，WorkBuddy 可以和 DeepSeek 官方 Provider、`llm-pi-ai` 内置 Provider，以及用户自定义
Provider 同时出现在模型选择器中。

## 功能

- API Key 与网页登录令牌两种认证模式；
- 无需下载 WorkBuddy 客户端即可在浏览器登录；
- 多 API Key、多登录账号和账号切换；
- 自动刷新网页登录令牌；
- 在线获取当前账号可用模型，失败时使用内置目录；
- 在 DSH 模型菜单中显示 WorkBuddy 当前倍率、活动徽标、活动说明、上下文窗口与思考强度；
- 与 WorkBuddy 一致地展开 Auto 为“快速 / 均衡 / 极致”三档；
- 按模型提供上下文窗口与图片输入，推理策略遵循 WorkBuddy 的模型默认值；
- 令牌模式在设置页显示剩余积分和今日用量，会话底部只显示剩余积分；
- DSH 继续负责 Agent 循环、工具调用、会话、权限和系统提示词。

## 环境要求

- DSH `>= 0.1.5-rc.1 < 0.2.0`；
- Node.js `>= 22.19.0`；
- Windows、Linux 或 macOS。

当前依赖线与 DSH Desktop `2.0.9` 内置的 DSH `0.1.5-rc.1`、pi-ai `0.85.1` 对齐。

## 安装

### 普通 DSH Web

```sh
dsh plugin --profile web add github:l77948032-cyber/DSH-Workbuddy#v1.1.1
```

如果同时使用 headless Profile，需要分别安装：

```sh
dsh plugin --profile headless add github:l77948032-cyber/DSH-Workbuddy#v1.1.1
```

安装后重启 DSH。不要同时启用上游包 `@axiaohungry/dsh-llm-workbuddy`，两个包使用相同的
Cordis 插件 ID。

### DSH Desktop

先完全退出 DSH Desktop，再运行：

```sh
npx --yes --package=github:l77948032-cyber/DSH-Workbuddy#v1.1.1 \
  dsh-workbuddy install --profile desktop
```

安装器会在 macOS 上自动使用 DSH Desktop 自带的管理入口，不依赖终端中存在 `dsh` 命令。
它只修改 `desktop` Profile，不会安装到 `web` 或 `headless`。重新打开 DSH Desktop 后即可配置。

卸载方式：

```sh
npx --yes --package=github:l77948032-cyber/DSH-Workbuddy#v1.1.1 \
  dsh-workbuddy uninstall --profile desktop
```

也可以重复传入 `--profile`，显式选择多个 Profile。通过环境变量
`DSH_WORKBUDDY_PACKAGE_SPEC` 可以覆盖安装源；默认始终使用与安装器版本相同的 Git tag，
不会自动追随 `latest`。

## 配置

打开 **设置 -> 模型**，添加或编辑 `WorkBuddy 中国区`。

### 网页登录

1. 选择 `网页登录`；
2. 点击“登录 WorkBuddy”；
3. 在打开的浏览器页面完成登录；
4. 返回 DSH，选择需要使用的账号。

令牌保存在 DSH 凭据服务中，不写入 `settings.yaml`。过期前插件会使用 WorkBuddy 刷新接口
更新令牌。令牌模式还会尝试显示积分和当日请求用量。

### API Key

选择 `API Key` 后，可以使用环境变量 `WORKBUDDY_API_KEY`，也可以在插件界面保存多个 Key。
Key 的值只进入 DSH 凭据服务，设置文件仅保存凭据引用。

旧环境变量 `CODEBUDDY_API_KEY` 仍兼容。

## 模型目录

在 WorkBuddy Provider 设置中点击“获取可用模型”。插件会用当前凭据请求 WorkBuddy 模型
目录，并允许选择和调整模型名称、上下文窗口与最大输出 Token。与 WorkBuddy 原生行为一致，
思考强度只展示模型配置，不在 DSH 中提供手动档位覆盖。更换账号或 Key 后建议重新获取一次。

在会话底部打开模型菜单时，插件会读取腾讯当前模型目录中的计费倍率。限时免费、独家优惠、
夜间折扣等 WorkBuddy 当前活动标识会显示在对应模型行；悬停或聚焦模型时可查看消耗速度、
思考强度、上下文窗口和活动说明。服务端下发活动规则时，插件按其有效期和时段动态计算。

## 请求边界

模型请求发送到 WorkBuddy 中国区接口：

```text
https://copilot.tencent.com/v2
https://copilot.tencent.com/v3/config
```

令牌模式另外使用腾讯的登录刷新与 CodeBuddy billing 接口。插件不向本项目作者或其他统计
服务发送凭据、提示词或模型响应。

## 开发

```sh
npm ci --ignore-scripts
npm run check
npm pack --dry-run
```

测试包含 Provider 隔离断言：即使配置中存在其他自定义 Provider，插件也只允许注册
`workbuddy-cn`。

## License

[MIT](./LICENSE)
