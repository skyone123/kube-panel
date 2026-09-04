<div align="center">

# 🛰️ kube-panel

一个面向 Windows 的 **kubectl 运维面板** —— 上下文切换、pod 搜索、
流式日志（正则搜索）、多 pod 合并 tail、ConfigMap、describe/events、
deployments + rollout、实时 port-forward 管理，一个桌面应用搞定。

[![Release CI](https://github.com/skyone123/kube-panel/actions/workflows/release.yml/badge.svg)](https://github.com/skyone123/kube-panel/actions/workflows/release.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows%2011-0078D4.svg?logo=windows11&logoColor=white)](https://github.com/skyone123/kube-panel/releases)
[![Tauri](https://img.shields.io/badge/Tauri-v2-orange.svg?logo=tauri)](https://tauri.app/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg?logo=react&logoColor=black)](https://react.dev/)
[![Rust](https://img.shields.io/badge/Rust-stable-DEA584.svg?logo=rust)](https://www.rust-lang.org/)

[English](README.md) · **中文**

</div>

---

> 💡 **初衷**：日常 kubectl 操作（切上下文、grep pod、tail 日志、找
> ConfigMap、重放命令）在终端里又慢、跨会话又不可见。kube-panel 把它
> 做成键盘友好的 GUI，外加一些终端做不好的事。
>
> **不用原生 k8s client。** 所有集群访问都 shell out 到本地 `kubectl` ——
> 你现有的 kubeconfig、云厂商 auth 插件（aws/gcp/azure exec、kubelogin）、
> krew 插件全部透明可用。应用自己绝不直连集群。

---

## ✨ 功能

| 领域 | 你能得到什么 |
| :--- | :--- |
| 🧭 **上下文与命名空间** | 离线解析 `~/.kube/config` + `KUBECONFIG`；一键切上下文；默认 all-namespaces 视图，任何 pod 都找得到。 |
| 📋 **Pod** | 子串过滤（名/命名空间/node）、状态色 pill、高重启高亮、**右键 → 镜像 / ConfigMap / describe / events**。 |
| 📜 **日志** | 流式 `kubectl logs -f`（环形缓冲、follow tail、`--previous`/`--since`/`--tail`、容器下拉）、**全屏**、**正则搜索**带上一个/下一个 + 匹配计数、**导出 `.log`**。 |
| 🔀 **多 pod tail** | 选 ≥2 个 pod → 合并到一个流，带 `[pod]` 前缀。 |
| 🚀 **Deployment 与 rollout** | Deployments tab + 右键 **restart / scale / undo / history**，每个都在确认弹窗显示完整命令后执行。 |
| 🔌 **Port-forward 管理器** | 实时会话表（running / stopped / failed）、启动前确认、停止/清除、关 app 回收子进程。 |
| 🧱 **命令历史** | 可搜，存 SQLite。**只存元数据** —— stdout/stderr 绝不落盘（kubectl 输出常带敏感信息）。 |

<details>
<summary><b>🎯 右键 pod 菜单 —— 完整细节</b></summary>

- **复制名** / **复制 `kubectl logs <pod>`**
- **查看镜像** —— 每个容器的镜像 tag **及** imageID digest
- **查看 ConfigMap** —— 该 pod 引用的 ConfigMap（`envFrom` /
  `env.valueFrom.configMapKeyRef` / `volumes`），按需查看 key/value、复制、导出
- **Describe** —— `kubectl describe pod` 文本，CrashLoop/OOM 关键词高亮
- **Events** —— 结构化表格（时间 / 类型 / 原因 / 消息），可按 pod 或整 namespace 过滤

</details>

---

## 📦 安装（Windows）

1. 打开 [**Releases**](https://github.com/skyone123/kube-panel/releases) 页。
2. 下载最新版的 `.exe` 安装器（NSIS）或便携包。
3. 确保装了 `kubectl`：
   ```powershell
   winget install Kubernetes.kubectl
   ```
4. 运行 kube-panel，选个 context，开搞。

> 每次打 `v*` tag 会触发 GitHub Actions 构建，把 Windows `.exe` 挂到草稿
> Release（去 Releases 页点 Publish 发布即公开可下载）。

---

## 🛠️ 开发

**前置要求**：Windows 11 · `kubectl` 在 PATH · Node.js + pnpm · Rust（rustup）

```bash
pnpm install
pnpm tauri dev      # 热重载 dev app（Vite HMR + Rust 改动自动重编译）
```

### 测试

```bash
# Rust 单测（解析器、stream/pf registry、history DB）
cd src-tauri && cargo test --lib

# 前端组件 + API 测试
pnpm vitest run
```

### 生产构建

```bash
pnpm tauri build    # NSIS 安装器 + 便携 .exe → src-tauri/target/release/bundle/
```

二进制**不打包 kubectl** —— 运行时探测，缺失时给 winget 提示。

---

## 🏗️ 架构

```
kube-panel/
├─ src-tauri/                 # Rust 后端（Tauri commands）
│  ├─ src/
│  │  ├─ kubeconfig.rs        # 解析 ~/.kube/config + KUBECONFIG（serde_yaml）
│  │  ├─ kubectl.rs           # 拼 Command（argv、--context、-n、--kubeconfig）
│  │  ├─ runtime.rs           # KubeRuntime: run（一次性，记历史）+ build_cmd（流式）
│  │  ├─ commands.rs          # 所有 #[tauri::command] 函数
│  │  ├─ stream.rs            # StreamRegistry: kubectl logs -f 子进程（单/多）
│  │  ├─ portforward.rs       # PfRegistry: port-forward 生命周期（监控 + stop channel）
│  │  ├─ history.rs           # SQLite 历史 CRUD（只存元数据）
│  │  └─ models.rs            # JSON 解析器：pods、deployments、configmaps、events
│  ├─ tauri.conf.json
│  └─ Cargo.toml
├─ src/                       # React 18 + TS 前端
│  ├─ App.tsx
│  ├─ components/             # PodTable, DeploymentTable, LogViewer, MergedLogViewer,
│  │                          # PodActionModal, RolloutModal, PortForwardPanel, …
│  ├─ api/tauri.ts            # invoke() 封装 + 事件监听（log_chunk、pf_status）
│  ├─ stores/appStore.ts      # zustand（namespace）
│  └─ types.ts                # 与 Rust serde::Serialize 对齐的 TS 类型
├─ docs/                      # 设计 spec + 分阶段计划
└─ .github/workflows/release.yml
```

<details>
<summary><b>🔧 关键设计决策</b></summary>

- **Shell out，不绑定。** 不用 `kube` Rust crate 连集群 —— 只用 `serde_yaml`
  解析 kubeconfig 文件。云厂商 auth exec 插件、krew 插件因此透明。
- **`KUBECONFIG` 一致性规则。** 环境变量 `KUBECONFIG` 设置时，runner **不传**
  `--kubeconfig`（kubectl 读 env）；否则传 `~/.kube/config`。parser 与 runner 对齐。
- **流式 = 事件，不是 await。** 长驻 `kubectl logs -f` / `port-forward` 子进程存于
  registry；stdout 块经 Tauri 事件（`log_chunk`、`pf_status`）推前端。一次性 `run`
  路径记历史；流式只记一条 `is_stream=true`，绝不持久化块文本。
- **无竞态 context。** 当前 context 从 `['contexts']` query 派生（单一真相源），
  pod/deployment query 在切 context 时 key 变化，重新拉取 —— 无 stale-context 竞态。

</details>

---

## 🔐 安全

- ✅ **无 shell，无注入** —— 所有 kubectl 调用都用 `tokio::process::Command`
  的 argv 数组。pod/deployment 名是独立 argv 元素；`--since`/`--tail` 是单个
  `--key=value` token。
- ✅ **无破坏性命令** —— `delete` / `apply -f` / `exec` / `patch` / `--force`
  在代码中不存在。
- ✅ **写操作有确认门** —— rollout restart/scale/undo 和 port-forward 启动在
  确认弹窗显示完整命令。**切上下文**故意不加门（非破坏性导航 —— 真正的破坏
  操作始终有门，误切爆炸半径有限）。
- ✅ **历史只存元数据** —— 无 stdout/stderr 列；kubectl 输出（可能带 `secret`
  base64、ConfigMap DB 串、describe env 变量）绝不落 `~/.kube-panel/history.db`。
- ✅ **kubeconfig 只解析不打印** —— 只有 context/cluster/user **名字**过 IPC；
  token、证书、exec 配置被 serde 丢弃。
- ⚠️ **Tauri CSP** 当前为 `null`（dev 默认）—— 稳定版前应固定严格 CSP。已记 TODO。

完整安全理由见设计文档（§6.4）。

---

## 🗺️ 路线图

**已完成**
- [x] 上下文 / 命名空间切换
- [x] Pod 表 + 过滤 + 异常高亮
- [x] 流式日志 + 正则搜索 + 导出 + 全屏
- [x] 多 pod 合并 tail
- [x] Pod 右键：镜像 / configmap / describe / events
- [x] Deployments 视图 + rollout restart/scale/undo/history
- [x] Port-forward 管理器
- [x] 命令历史（只存元数据，可搜）

**计划 / 待定**
- [ ] Exec 终端（ConPTY + xterm.js）
- [ ] YAML apply（dry-run 预览 → 确认 → apply）
- [ ] 集群健康徽章（`get --raw /healthz` + `auth can-i`）
- [ ] 收藏夹 / 命令片段
- [ ] pod/deployment 之外的资源浏览器（svc、ingress、pvc …）
- [ ] 异常高亮打磨（重启突增检测、OOMKilled 图标）
- [ ] 严格 Tauri CSP

完整 spec：[`docs/specs/2026-09-03-kube-panel-design.md`](docs/specs/2026-09-03-kube-panel-design.md)

---

## 🤝 贡献

欢迎 PR。有逻辑的地方保持 TDD（Rust 解析器、registry；TS 组件用 Vitest）。
写操作必须留在确认弹窗后；历史必须只存元数据。

---

## 📄 许可证

[MIT](LICENSE) © luyuxin
