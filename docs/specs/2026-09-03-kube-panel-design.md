# kube-panel — 设计文档

> 日期：2026-09-03
> 状态：设计待评审
> 项目目录：`D:\work\tools\kube-panel`

## 1. 一句话定位

Windows 上的 kubectl 运维面板：用 Tauri 打包成单个 `.exe`，前端 React+TS。把日常 kubectl 操作（切上下文、查 pod、查 configmap、看日志、查历史）做成图形界面，并补上一组提升运维效率的增强（port-forward 管理、一键 exec、多 pod 日志合并、rollout 操作、YAML apply、异常高亮、收藏夹、剪贴板助手、集群健康徽章）。所有集群访问 shell out 到本地 `kubectl`，与用户现有 kubeconfig / 插件 / cloud auth 完全一致；上下文列表与命名空间直接解析 `~/.kube/config`（含 `KUBECONFIG` 多文件）。

## 2. 背景与动机

### 2.1 真痛点（运维视角）
- **多上下文切换烦**：`kubectl config use-context` + tab 补全在多集群环境下又慢又易切错，且当前上下文在终端里不可见。
- **pod 模糊查找靠 grep**：`kubectl get pods | grep xxx` 文本流，不能按状态/节点排序，不能多列过滤，CrashLoop 看不直观。
- **configmap 定位绕**：要 `kubectl describe pod` 找引用 → `kubectl get cm` → `kubectl get cm xxx -o yaml` 翻 data，三步。
- **日志看不清**：`kubectl logs -f` 在普通终端没有高亮、没有正则搜索、不能 prev/next 跳匹配、多 pod 没法合并流、导出靠重定向。
- **历史命令丢失**：终端 history 跨会话/跨机器不持久，复现"上次那条命令"靠人脑。
- **port-forward / exec / rollout / apply**：每个都是一段 kubectl，没有统一面板与存活管理。

### 2.2 为什么 shell out kubectl 而不是用原生 client
- 用户的 kubeconfig 里经常有云厂商 auth provider（aws/gcp/azure exec plugin）、`kubelogin`、自定义 exec 插件——这些只有 kubectl 会调。
- kubectl 插件（krew）生态可以直接复用。
- 跟 kubectl 新特性（`--dry-run=server`、新 API group）零延迟同步，不用改代码。
- 上下文列表 / 命名空间这种**只读、高频、纯配置**的查询直接解析 kubeconfig YAML，省一次进程调用、响应更快、离线可用。

### 2.3 不做什么（YAGNI）
- **不做** CRD/自定义资源的编辑器（v1 只读展示 + apply）。
- **不做** Helm / Kustomize 渲染（v1 仅 `kubectl apply` 原始 YAML）。
- **不做** 多集群并发聚合视图（v1 单上下文聚焦）。
- **不做** 远程集群凭据管理 / 注入（只读用本机 kubeconfig）。
- **不做** RBAC 细粒度编辑（仅 `kubectl auth can-i` 展示）。
- **不做** Linux/macOS 打包（v1 只出 Windows `.exe`；Tauri 跨平台，后续可扩）。

## 3. 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 桌面壳 | Tauri 2 | 单 `.exe`、体积小（~5–10MB）、原生 WebView2（Win11 自带）；Rust 后端安全 |
| 前端 | React 18 + TypeScript + Vite | 生态成熟；TanStack Table/Query、naive-ui、zustand |
| 状态 | zustand + TanStack Query | 轻量；Query 天然适配"调 kubectl 取数据"的缓存/重试 |
| 表格 | TanStack Table v8 | 虚拟行、排序、列可见性 |
| 日志查看 | Monaco Editor（只读模式）+ 自建高亮 overlay | 正则搜索、行号、大文件虚拟滚动、prev/next 跳匹配 |
| 终端 | xterm.js + 共享 PTY（Rust 侧 `portable-pty`） | exec -it 需要 PTY |
| 本地存储 | SQLite (`rusqlite`，打包进二进制) | 命令历史、收藏夹、port-forward 会话记录 |
| kubeconfig 解析 | `kube` crate（只用于解析 YAML 结构，不用于连集群） | 已知可靠；或 `serde_yaml` 自解（见 §6.1 取舍） |
| 进程管理 | Rust `tokio::process` + `portable-pty` | 异步、可流式读 stdout/stderr、PTY 终端 |

## 4. 架构

```
kube-panel/
  src-tauri/                  # Rust 后端（Tauri commands）
    src/
      main.rs                 # Tauri 启动、命令注册
      kubeconfig.rs           # 解析 ~/.kube/config + KUBECONFIG
      kubectl.rs              # shell out：run / run_stream / run_pty
      history.rs              # SQLite 命令历史 CRUD
      portforward.rs          # port-forward 会话生命周期
      pty.rs                  # exec -it 的 PTY 会话
      state.rs                # 全局状态（当前 context/namespace、活跃会话）
      error.rs                # 统一错误类型 → 前端友好消息
    Cargo.toml
  src/                        # React 前端
    main.tsx
    App.tsx                   # 顶层布局：侧边栏 + 主区 + 状态栏
    components/
      ContextSwitcher.tsx     # 上下文下拉 + 健康徽章
      NamespaceSwitcher.tsx
      PodTable.tsx            # 模糊搜索 + 排序 + 异常高亮
      ConfigMapPanel.tsx
      LogViewer.tsx           # Monaco + 搜索 + 导出
      ExecTerminal.tsx        # xterm.js
      PortForwardManager.tsx
      RolloutActions.tsx
      YamlApply.tsx
      HistoryPanel.tsx
      FavoritesPanel.tsx
    stores/                   # zustand stores
    api/                      # invoke() 封装 + TanStack Query hooks
    types/                    # 与 Rust 共享的 TS 类型
  docs/
    specs/2026-09-03-kube-panel-design.md   # 本文件
```

### 4.1 进程边界与数据流
1. 前端 React 通过 Tauri `invoke()` 调 Rust command。
2. Rust 侧 `kubectl.rs` 拼 `kubectl --context <ctx> -n <ns> <subcmd> --kubeconfig <path>` 并 spawn。
3. 一次性命令（get/describe/apply）→ 收 stdout 后返回；流式命令（logs -f / port-forward / exec）→ Rust 持有子进程，通过 Tauri **event** 向前端推 chunk；前端订阅。
4. **每次** shell-out 前后都写一条历史记录（context、ns、完整 argv、exit code、耗时、是否流式）。

### 4.2 错误处理
- `kubectl` 非 0 退出：捕获 stderr，按退出码分类（401/403 → 权限、404 → 资源不存在、其他 → 原文透传），前端 Toast。
- `kubectl` 未找到 / 不在 PATH：启动时探测，提示安装路径并给 winget 链接。
- kubeconfig 解析失败：降级到"仅靠 `kubectl config view` 取上下文"的 fallback 路径，并在徽章标黄。

## 5. 功能规格

### 5.1 上下文管理（需求 1）
- 启动时解析 `~/.kube/config`（若 `KUBECONFIG` 环境变量为多路径，合并解析），列出所有 context，标注 current-context。
- 每条显示：context 名、cluster、user、namespace（若有）。
- 点击切换：执行 `kubectl config use-context <name>`，成功后更新全局 state 并刷新健康徽章。
- 支持搜索上下文名（>10 条时）。
- 健康徽章：切到上下文后跑 `kubectl get --raw /healthz` + `kubectl auth can-i list pods`，绿/黄/红三态。

### 5.2 Pod 模糊搜索（需求 2）
- 默认 `kubectl get pods -o wide -n <ns>`；可切 `--all-namespaces`。
- 列：Name / Namespace / READY / STATUS / RESTARTS / AGE / IP / NODE。
- 顶部模糊搜索框：对 Name/Namespace/NODE 做客户端子串+模糊匹配（fuse.js），实时过滤。
- 列排序、列可见性、状态色（Running 绿、CrashLoopBackOff / ImagePullBackOff 红、其他非 Running 黄）。
- RESTARTS 高列值标红；OOMKilled 在 describe 里高亮。
- 右键菜单：查看日志 / describe / exec / 端口转发 / 复制名 / 复制 kubectl 命令。

### 5.3 ConfigMap 查询（需求 3）
- 选中 pod 后：
  - 后端 `kubectl get pod <p> -o json`，提取 `spec.containers[].envFrom`/`env.valueFrom.configMapKeyRef` 与 volumes `configMap`，得出该 pod 引用的所有 ConfigMap。
  - 左栏：pod 引用的 ConfigMap 列表（点开看 data key/value、复制、导出单文件）。
- 右栏：命名空间下**全部** ConfigMap 模糊搜索（`kubectl get cm -o json` 一次拉取，客户端 fuse.js 过滤 name/key）。
- 值查看器支持 YAML/JSON 着色；大 value（>1MB）提示而非卡死。

### 5.4 日志查看（需求 4）
- 入口：pod 行右键 → Logs；或选中 pod + 容器后进 Logs tab。
- 控制：容器下拉（多容器 pod）、`--previous` 开关、`--since`（5m/1h/全量）、`--tail` 数值、`-f` 跟随开关。
- 流式：Rust 持有 `kubectl logs -f` 子进程，按行/块 event 推前端，Monaco 增量追加；虚拟滚动，保留最近 N 行（默认 10 万，可调），溢出按环形丢弃。
- 搜索：正则 + 大小写敏感开关；高亮匹配；prev/next 跳转；匹配计数。
- 导出：导出当前缓冲区为 `.log`（UTF-8）；或"导出完整（重新跑一次非流式 `kubectl logs` 全量写盘）"。
- 停止/重启：停止流（kill 子进程）不丢已收缓冲。

### 5.5 多 pod 日志合并（增强）
- Pod 表多选 + "合并 tail" → 后端为每个 pod 起一个 `kubectl logs -f` 子进程，按 `[pod/container] ` 前缀合并到一个流，Monaco 统一展示；任一进程挂掉标灰不中断整体。

### 5.6 命令历史（需求 5）
- 每次有效 kubectl 调用写一条：`{id, ts, context, namespace, argv[], exit_code, duration_ms, stream(bool)}`。
- 历史面板：按时间倒序、可按 context/ns/argv 全文搜、可过滤只看失败。
- 操作：重跑（带确认，流式命令直接进对应 tab）、复制 argv、钉为收藏、删除。
- 持久化到 `~/.kube-panel/history.db`，跨会话/跨重启保留。

### 5.7 增强功能一览（需求 6）

| 功能 | 入口 | 实现要点 |
|---|---|---|
| 命名空间切换器 | 顶栏下拉 | 解析 kubeconfig + `kubectl get ns`；切换写回 `kubectl config set-context --current --namespace=<ns>` 持久化 |
| Port-forward 管理 | 工具栏 + 右键 | 表格：本地端口→pod:port / 资源/svc / 状态 / PID；起停 `kubectl port-forward`；崩溃/端口占用提示 |
| 一键 exec | pod 右键 | xterm.js + Rust PTY；`kubectl exec -it <pod> -c <c> -- <sh>`；容器/sh 可选 |
| Describe + Events | pod 右键 tab | `kubectl describe pod` 渲染 + `kubectl get events --sort-by=.lastTimestamp`；CrashLoop/OOM 关键词高亮 |
| Rollout 操作 | deployment 右键 | restart / scale / undo；带二次确认；undo 列 `kubectl rollout history` |
| YAML apply | 独立 tab | 粘贴 / 拖拽 `.yaml` → `kubectl apply --dry-run=client` 预览 → 确认后 apply；显示 server-side 错误 |
| 异常高亮 | pod 表 / describe | CrashLoopBackOff / ImagePullBackOff / 高 restarts / OOMKilled 自动标红+图标 |
| 收藏夹 / 片段 | 侧边栏 | 钉常用命令（带占位符如 `<pod>`）；或钉常用资源过滤；一键执行/填充 |
| 剪贴板助手 | 各右键 | 复制 pod 名 / `kubectl logs <pod>` / `kubectl describe <pod>` / 完整 YAML |
| 集群健康徽章 | 顶栏 | API 可达 + `can-i list pods`；红黄绿；点开看详情 |

## 6. 关键技术取舍

### 6.1 kubeconfig 解析：`kube` crate vs 手写 serde_yaml
- 推荐 `kube` crate 的 `Config` 解析（含 `KUBECONFIG` 多文件合并、exec auth 不执行只读结构）。好处：处理了多文件、路径展开、变量插值的边界。
- 若 `kube` 引入过重，退化为 `serde_yaml` 手解 + 自行处理 `KUBECONFIG` 分号/路径列表。**v1 选 `kube` crate，仅用于解析、不用于 client 连接。**

### 6.2 流式日志性能
- 必须虚拟滚动 + 环形缓冲，否则高频日志会把 React 渲染拖死。
- Monaco 只读 + `revealLine` 控制跟随；用户手动上滚时暂停自动跟随。
- 多 pod 合并流：Rust 侧做前缀注入与行序稳定（按到达时间，不强保证全局有序——运维场景够用，spec 里写明不保证严格有序）。

### 6.3 PTY 与 exec
- Windows 下 `kubectl exec -it` 需要真 PTY；用 `portable-pty` 创建 ConPTY，前端 xterm.js 通过 Tauri event 双向传字节。
- ConPTY 在老版本 Windows 10 可能不可用——启动时探测，不可用则降级 `kubectl exec` 非交互（仅取一次 stdout），并在 UI 标注"此环境不支持交互 exec"。

### 6.4 安全
- 切换上下文 / apply / rollout / port-forward 等写操作必须有**二次确认**（Modal 显示完整将要执行的命令）。
- **历史只存命令元数据（argv + exit_code + 耗时 + is_stream），不存 stdout/stderr 全文**。kubectl 输出里可能夹带敏感信息——`kubectl get secret -o yaml` 的 base64 `data:` 一行即可还原成明文密钥，`describe pod`/`apply` 回显里也可能带 ConfigMap 的 DB 连接串。无差别全量落盘 = 把生产密钥明文写进 `~/.kube-panel/history.db`，被备份/误传即泄露。代价：历史面板不能直接回看上次命令的完整输出，需点"重跑"重新执行一次（输出进对应 tab，不进 DB）。需要留底时走 §5.4/§5.6 的"导出本次输出"按钮，由用户主动把单次输出导成文件，而非无差别全量落盘。

## 7. 数据模型

### 7.1 历史表（SQLite）
```sql
CREATE TABLE command_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,            -- unix epoch ms
  context TEXT NOT NULL,
  namespace TEXT,
  argv_json TEXT NOT NULL,         -- JSON array of strings
  exit_code INTEGER,
  duration_ms INTEGER,
  is_stream INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_history_ts ON command_history(ts DESC);
CREATE INDEX idx_history_context ON command_history(context);
```

### 7.2 port-forward 会话（内存 + 可选持久）
```rust
struct PfSession {
    id: Uuid,
    context: String,
    namespace: String,
    target: String,       // "pod/foo" or "svc/bar" or "deploy/baz"
    local_port: u16,
    remote_port: u16,
    child: Option<Child>, // 持有 kubectl port-forward 子进程
    started_at: i64,
    status: PfStatus,     // Running / Failed(String) / Stopped
}
```

### 7.3 前端核心类型（共享）
```ts
type Context = { name: string; cluster: string; user: string; namespace?: string; current: boolean };
type PodRow  = { name: string; namespace: string; ready: string; status: string; restarts: number; age: string; ip: string; node: string; containers: string[] };
type LogChunk = { stream: "stdout"|"stderr"; text: string; lineNo: number };
type PfSessionView = { id: string; target: string; local: number; remote: number; status: string; startedAt: number };
```

## 8. 测试策略

- **Rust 单测**：kubeconfig 解析（多文件、`KUBECONFIG`、current-context 切换不破坏文件）、argv 拼接（带 `--kubeconfig`/`--context`/`-n` 注入）、历史 DB CRUD、命令分类（exit code → 错误类型）。
- **集成测试**：用 fake `kubectl`（脚本模拟 stdout/stderr/exit code）跑端到端：get pods → 表格渲染、logs -f → 流事件、apply → dry-run 分支、port-forward 起停。
- **前端**：组件测试用 Vitest + Testing Library（表格过滤、Monaco 搜索高亮、历史过滤）；Monaco/xterm 的真实渲染不强测，测其 props 调用。
- **手动验收清单**：见 §10。

## 9. 打包与分发

- `tauri build` 出 `kube-panel.exe`（NSIS 安装器 + 便携 exe）。
- 不打包 kubectl，启动时探测并在缺失时引导 `winget install Kubernetes.kubectl`。
- 配置/数据目录：`%USERPROFILE%\.kube-panel\`（history.db、settings.json、favorites）。

## 10. 验收清单（v1）

1. 启动能列出本机所有上下文并标注 current。
2. 点上下文切换 → 健康徽章刷新 → pod 表只显示该集群。
3. pod 模糊搜索 200 pod 内 <50ms 过滤；状态/重启异常高亮正确。
4. 选中 pod → 能看到引用的 ConfigMap；能模糊搜命名空间内全部 ConfigMap。
5. 日志能流式跟随、正则搜索跳转、导出 `.log` 成功；`--previous`/`--since`/`--tail` 生效。
6. 命令历史按 ts/context/ns 搜得到、能重跑、能钉收藏。
7. port-forward 起停正确、端口占用提示、进程随 app 退出被回收。
8. exec -it 进 pod 能交互 `ls`/`exit`（ConPTY 可用时）。
9. YAML apply 的 dry-run 预览与真实 apply 行为正确，server 错误透传。
10. rollout restart/scale/undo 均带确认且生效。
11. 集群健康徽章在 unreachable / 无 RBAC 时正确显黄/红。
12. 写操作（切上下文/apply/rollout/pf）均有二次确认 Modal。

## 11. 阶段划分（非本 spec 执行计划，仅示意；正式计划见后续 plan 文档）

- **Phase 1**：脚手架（Tauri+React）、kubeconfig 解析、上下文切换、pod 表 + 模糊搜索、基础日志查看（非流式先跑通）、历史记录写入。可独立验证。
- **Phase 2**：流式日志 + 搜索 + 导出、configmap 查询、多 pod 合并 tail、namespace 切换器、健康徽章。
- **Phase 3**：port-forward 管理、exec PTY、describe+events、rollout、yaml apply、异常高亮、收藏夹、剪贴板助手。

## 12. 开放问题（留给实现期决策，不阻塞 spec）

- 前端组件库选 `naive-ui` vs `antd` vs 纯 Tailwind 自绘？（影响 §5.2 表格与 §6 Modal 风格，实现期定）
- 历史记录是否做跨机器同步？（YAGNI，v1 不做）
- 是否支持 `kubectx` / `kubens` 命令复用？（shell-out kubectl 已覆盖，不强制）
