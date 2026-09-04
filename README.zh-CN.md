# kube-panel

[English](README.md) · **中文**

一个面向 Windows 的 **kubectl 运维面板** —— 把日常 kubectl 操作（切上下文、查 pod、看日志、找 ConfigMap、重放命令）做成键盘友好的图形界面，外加一些终端做不好的事（正则日志搜索 + 上一个/下一个跳转、多 pod 日志合并、实时 port-forward 管理）。

基于 [Tauri 2](https://tauri.app/)（Rust 后端 + React 18 / TypeScript 前端）。**所有集群访问都 shell out 到本地 `kubectl`** —— 你现有的 kubeconfig、云厂商 auth 插件（aws/gcp/azure exec、kubelogin）、krew 插件全部透明可用。应用自己绝不直连集群。

> 状态：**alpha / 日常驱动开发中**。主要面向 Windows 11；Linux/macOS 理论可跑（Tauri 跨平台），但暂未打包。

---

## 功能

### 上下文与命名空间
- 直接用 `serde_yaml` 解析 `~/.kube/config`（含 `KUBECONFIG` 多文件列表），无需调 kubectl，离线可用。
- 上下文切换器（标注当前 context、cluster、user、namespace）。
- 命名空间切换器，默认 **all-namespaces** 视图（任何命名空间的 pod 都能找到）。

### Pod
- Pod 表格，客户端子串过滤（名/命名空间/node）、状态色 pill（Running=绿，CrashLoopBackOff/ImagePullBackOff/Error=红，其他非 Running=琥珀）、高重启次数高亮。
- **右键任意 pod** 弹出菜单：
  - 复制名 / 复制 `kubectl logs <pod>` 命令
  - **查看镜像** —— 每个容器的镜像 tag **及** imageID digest
  - **查看 ConfigMap** —— 该 pod 引用的 ConfigMap（`envFrom`/`env.valueFrom.configMapKeyRef`/volumes），按需查看 key/value、复制、导出
  - **Describe** —— `kubectl describe pod` 文本，CrashLoop/OOM 关键词高亮
  - **Events** —— 结构化事件表（时间/类型/原因/消息），可按 pod 或整 namespace 过滤

### 日志
- **流式** `kubectl logs -f`，Rust 侧 `StreamRegistry` 持有子进程，块经 Tauri 事件推前端；5000 行环形缓冲；跟随 tail，手动上滚自动暂停。
- 控制：容器下拉、`--previous`、`--since`（5m/1h/all）、`--tail`、follow 开关、停止。
- **全屏**模式。
- **正则搜索**，大小写敏感开关，匹配计数，上一个/下一个跳转，`<mark>` 高亮。
- **导出**当前缓冲区为 `.log`。
- **多 pod 合并 tail** —— 选 ≥2 个 pod，每个起一个 `kubectl logs -f`，`[pod]` 前缀合并到一个流。

### Deployment 与 rollout
- Deployments tab（Ready/Updated/Replicas/Age/镜像，子串过滤）。
- 右键 deployment：**restart / scale / undo / history**。写操作都走**确认弹窗，显示完整 kubectl 命令**后执行。

### Port-forward 管理器
- 活跃 port-forward 表（target、命名空间、本地→远程、状态、起始时间）。事件实时更新状态（running / stopped / failed 带 stderr 尾巴）。
- 新建表单，启动前确认。停止 / 清除。
- 子进程 `kill_on_drop`，关 app 即回收。

### 命令历史
- 每次 kubectl 调用只记录**元数据**：context、namespace、argv、退出码、耗时、`is_stream` 标记。存于本地 SQLite：`%USERPROFILE%\.kube-panel\history.db`。
- 可按 argv / context / namespace 搜索。
- **绝不存 stdout/stderr** —— kubectl 输出常带敏感信息（`kubectl get secret -o yaml` 的 base64、ConfigMap 的 DB 连接串、`describe` 的 env 变量）。只存元数据避免明文落盘泄露。

---

## 安全说明

- **无 shell，无注入。** 所有 kubectl 调用都用 `tokio::process::Command` 的 argv 数组，绝不走 shell。pod/deployment 名是独立的 argv 元素，`--since`/`--tail` 是单个 `--key=value` token，用户输入无法注入额外 flag。
- **写操作有确认门。** 破坏性/写操作（rollout restart/scale/undo、port-forward 启动）在确认弹窗里显示完整命令后执行。**切换上下文**（`kubectl config use-context`）**故意不加门** —— 它被视为非破坏性导航（只在 `~/.kube/config` 写 `current-context`，不创建/销毁资源）。真正的破坏操作（restart/scale/undo）不论当前在哪个 context 都有确认门，误切的爆炸半径仅限于"后续命令落到错的 context"。
- 应用内**没有 `delete` / `--force` / `apply -f` / `exec`** 操作。
- **历史只存元数据**（见上），无命令输出落盘。
- **kubeconfig 只解析不打印。** 应用读 `~/.kube/config` 列上下文；kubeconfig 内容（token、证书、exec 配置）从不打印或持久化。
- **Tauri CSP** 当前为 `null`（dev 默认）。稳定版前应固定一个严格 CSP。见 `src-tauri/tauri.conf.json`。

---

## 前置要求

- **Windows 11**（主要）。UI 是 WebView2 应用（Win11 自带）。
- **`kubectl` 在 PATH。** 应用调 `kubectl`，没它什么都跑不了。安装：`winget install Kubernetes.kubectl`。
- **Node.js + pnpm**（前端）。
- **Rust 工具链**（`rustup`，后端）。

## 开发

```bash
pnpm install
pnpm tauri dev      # 热重载 dev app（Vite HMR + Rust 改动自动重编译）
```

### 测试

```bash
# Rust 单测（解析器、stream registry、pf registry、history）
cd src-tauri && cargo test --lib

# 前端组件 + API 测试（Vitest）
pnpm vitest run
```

## 构建

```bash
pnpm tauri build    # 产物：NSIS 安装器 + 便携 .exe，在 src-tauri/target/release/bundle/
```

二进制**不打包 kubectl** —— 运行时探测，缺失时给 winget 提示。

---

## 架构

```
kube-panel/
  src-tauri/                 # Rust 后端（Tauri commands）
    src/
      kubeconfig.rs          # 解析 ~/.kube/config + KUBECONFIG（serde_yaml）
      kubectl.rs              # 拼 Command（argv、--context、-n、--kubeconfig 一致性）
      runtime.rs              # KubeRuntime: run（一次性，记历史）+ build_cmd（流式）
      commands.rs             # 所有 #[tauri::command] 函数
      stream.rs               # StreamRegistry: 长驻 kubectl logs -f 子进程（单/多）
      portforward.rs          # PfRegistry: kubectl port-forward 生命周期（监控 + stop channel）
      history.rs              # SQLite 命令历史 CRUD（只存元数据）
      models.rs               # JSON 解析器：pods、deployments、configmaps、events、pod-cm-refs
    tauri.conf.json
    Cargo.toml
  src/                       # React 18 + TS 前端
    App.tsx                  # 布局：侧边栏 + 顶栏 + pods/deployments tab + logs + history
    components/
      PodTable.tsx            # pod 表 + 多选 + 右键菜单
      DeploymentTable.tsx     # deployments 表 + rollout 菜单
      LogViewer.tsx           # 流式单 pod 日志（环形缓冲、follow、正则搜索、导出）
      MergedLogViewer.tsx    # 多 pod 合并 tail
      PodActionModal.tsx     # 镜像 / configmap / describe / events 面板
      RolloutModal.tsx       # restart/scale/undo/history，执行前确认
      PortForwardPanel.tsx   # port-forward 会话表 + 新建表单
      ContextSwitcher.tsx
      NamespaceSwitcher.tsx
      HistoryPanel.tsx
    api/tauri.ts             # invoke() 封装 + 事件监听（log_chunk、pf_status）
    stores/appStore.ts       # zustand（namespace）
    types.ts                 # 与 Rust serde Serialize 对齐的 TS 类型
  docs/
    specs/2026-09-03-kube-panel-design.md   # 完整设计文档（中文）
    plans/                                   # 分阶段实现计划
  .github/workflows/release.yml # 打 tag 自动构建 Windows exe 并挂到 GitHub Release
```

### 关键设计决策
- **Shell out，不绑定。** 不用 `kube` Rust crate 连集群 —— 只用 `serde_yaml` 解析 kubeconfig 文件结构。云厂商 auth exec 插件、krew 插件因此透明。
- **`KUBECONFIG` 一致性规则。** 环境变量 `KUBECONFIG` 设置时，runner **不传** `--kubeconfig`（kubectl 读 env）；否则传 `~/.kube/config`。parser 与 runner 对齐。
- **流式 = 事件，不是 await。** 长驻 `kubectl logs -f` / `port-forward` 子进程存于 registry；stdout 块经 Tauri 事件（`log_chunk`、`pf_status`）推前端。一次性 `run` 路径记历史；流式只记一条 `is_stream=true`，绝不持久化块文本。
- **TanStack Query 无竞态 context。** 当前 context 从 `['contexts']` query 派生（单一真相源），pod/deployment query 在切 context 时 key 变化，重新拉取 —— 无 stale-context 竞态。

---

## 从 Release 安装（Windows）

1. 去 [Releases](../../releases) 页，下最新版的 `.exe` 安装器（NSIS）或便携包。
2. 运行安装器，或解压便携包。
3. 确保 `kubectl` 已装（`winget install Kubernetes.kubectl`）。
4. 打开 kube-panel，选 context 即可。

> 每次打 `v*` tag 会自动触发 GitHub Actions 构建 Windows exe 并挂到 Release（草稿，需在 Releases 页点 Publish 发布）。

---

## 路线图

已完成：
- ✅ 上下文 / 命名空间切换
- ✅ Pod 表 + 过滤 + 异常高亮
- ✅ 流式日志 + 正则搜索 + 导出 + 全屏
- ✅ 多 pod 合并 tail
- ✅ Pod 右键：镜像 / configmap / describe / events
- ✅ Deployments 视图 + rollout restart/scale/undo/history
- ✅ Port-forward 管理器
- ✅ 命令历史（只存元数据，可搜）

计划 / 待定：
- ⬜ Exec 终端（ConPTY + xterm.js）—— Windows PTY 复杂，暂缓。
- ⬜ YAML apply（dry-run 预览 → 确认 → apply）
- ⬜ 集群健康徽章（`get --raw /healthz` + `auth can-i`）
- ⬜ 收藏夹 / 命令片段
- ⬜ pod/deployment 之外的资源浏览器（svc、ingress、pvc …）
- ⬜ 异常高亮打磨（重启突增检测、OOMKilled 图标）

完整 spec 见 `docs/specs/2026-09-03-kube-panel-design.md`，分阶段状态见 `docs/plans/`。

## 许可证

[MIT](LICENSE)。
