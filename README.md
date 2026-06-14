# oci-proxy

Cloudflare Worker 代理 OCI 容器镜像仓库，解决国内无法访问 Docker Hub、GHCR、GCR 等仓库的问题。

## 特性

- 一个 Worker 代理多个注册表，通过子域名自动路由
- 支持 Docker Hub、GHCR、GCR、k8s.io
- 自动处理 OCI 认证流程（token 获取、Www-Authenticate 重写）
- 域名零硬编码，从请求 Host 头动态提取
- 配置化启停注册表，无需改代码

## 工作原理

```
docker pull nginx:latest
  │
  ▼
docker.<domain>  ← Cloudflare Worker (oci-proxy)
  │
  ├── 子域名前缀识别
  ├── OCI 认证流程代理（token 获取 + Www-Authenticate 重写）
  ├── manifest / blob 请求转发
  └── CDN 重定向自动跟随
```

通过子域名前缀路由到不同的上游注册表：

| 子域名前缀 | 上游 | 启用方式 |
|-----------|------|---------|
| docker | registry-1.docker.io | 默认启用 |
| ghcr | ghcr.io | REGISTRIES=ghcr |
| gcr | gcr.io | REGISTRIES=gcr |
| k8s | registry.k8s.io | REGISTRIES=k8s |

认证流程（所有注册表遵循 OCI Distribution Spec）：

1. 客户端请求 /v2/ → Worker 返回 401，Www-Authenticate 中的 realm 指向代理自身
2. 客户端请求 /v2/auth?scope=... → Worker 从上游获取真实 realm，代理 token 请求
3. 客户端携带 token 请求 manifest / blob
4. blob 下载遇 3xx 重定向 → Worker 手动跟随 CDN 并返回内容

## 前置条件

- Cloudflare 账号（Free 计划即可）
- 域名已托管在 Cloudflare DNS
- Node.js 18+
- Wrangler CLI（`npm install` 自动安装）

## 快速开始

### 1. 克隆并安装依赖

```bash
git clone https://github.com/whg517/oci-proxy.git
cd oci-proxy
npm install
```

### 2. 登录 Cloudflare

```bash
npx wrangler login
```

### 3. 创建部署配置

项目提供 `wrangler.toml` 作为模板（已 gitignore 真实域名）。复制一份用于实际部署：

```bash
cp wrangler.toml wrangler-deploy.toml
```

编辑 `wrangler-deploy.toml`，将 routes 中注释的部分取消注释并替换为你的域名：

```toml
routes = [
  { pattern = "docker.your-domain.com", custom_domain = true },
  { pattern = "ghcr.your-domain.com", custom_domain = true },
  { pattern = "gcr.your-domain.com", custom_domain = true },
  { pattern = "k8s.your-domain.com", custom_domain = true },
]

[vars]
REGISTRIES = "ghcr,gcr,k8s"
```

wrangler deploy 时 Custom Domain 和 DNS 记录会自动创建，无需在 Dashboard 手动配置。

wrangler-deploy.toml 已在 .gitignore 中排除，不会提交到仓库。

### 4. 部署

```bash
npx wrangler deploy -c wrangler-deploy.toml
```

### 5. 配置 Docker

```bash
sudo tee /etc/docker/daemon.json << 'EOF'
{
  "registry-mirrors": ["https://docker.your-domain.com"]
}
EOF
sudo systemctl restart docker
```

### 6. 验证

```bash
docker pull nginx:alpine
```

## 客户端配置

### Docker

```json
// /etc/docker/daemon.json
{
  "registry-mirrors": ["https://docker.your-domain.com"]
}
```

配置后 `docker pull nginx:alpine` 会自动走代理。拉取非 Docker Hub 镜像需指定完整地址：

```bash
docker pull ghcr.your-domain.com/<owner>/<image>:<tag>
docker pull gcr.your-domain.com/<project>/<image>:<tag>
docker pull k8s.your-domain.com/<image>:<tag>
```

### kind (Kubernetes in Docker)

```yaml
# kind-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
containerdConfigPatches:
  - |-
    [plugins."io.containerd.grpc.v1.cri".registry.mirrors]
      [plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]
        endpoint = ["https://docker.your-domain.com"]
      [plugins."io.containerd.grpc.v1.cri".registry.mirrors."ghcr.io"]
        endpoint = ["https://ghcr.your-domain.com"]
      [plugins."io.containerd.grpc.v1.cri".registry.mirrors."gcr.io"]
        endpoint = ["https://gcr.your-domain.com"]
      [plugins."io.containerd.grpc.v1.cri".registry.mirrors."registry.k8s.io"]
        endpoint = ["https://k8s.your-domain.com"]
```

### 原生 containerd

```toml
# /etc/containerd/config.toml
[plugins."io.containerd.grpc.v1.cri".registry.mirrors]
  [plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]
    endpoint = ["https://docker.your-domain.com"]
  [plugins."io.containerd.grpc.v1.cri".registry.mirrors."ghcr.io"]
    endpoint = ["https://ghcr.your-domain.com"]
```

## 配置参考

### 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| REGISTRIES | 启用的注册表前缀（逗号分隔） | "" (仅 docker) |

`docker` 前缀始终启用，无需在 REGISTRIES 中指定。

### 添加新注册表

只需两步，无需改代码：

1. 在 `wrangler-deploy.toml` 的 routes 中添加子域名
2. 在 REGISTRIES 环境变量中添加对应前缀

```toml
# 例：启用 ghcr
routes = [
  { pattern = "ghcr.your-domain.com", custom_domain = true },
]
[vars]
REGISTRIES = "ghcr"
```

然后重新部署即可。

## 开发与测试

### 本地开发

```bash
npx wrangler dev    # http://localhost:8787
```

### 部署相关

```bash
npx wrangler deploy -c wrangler-deploy.toml  # 部署
npx wrangler tail                             # 查看实时日志
```

### E2E 测试

项目包含完整的 e2e 测试套件，通过 Makefile 运行：

```bash
make test-docker-hub                     # Docker Hub 代理测试（5 个场景）
make test-kind                           # kind 集群拉取测试
make test-e2e                            # 全部 e2e 测试
make test-e2e PROXY_URL=https://docker.your-domain.com  # 指定代理地址
```

测试场景覆盖：
- API 版本检查 (/v2/)
- 认证 token 获取
- library 镜像重定向
- 实际镜像拉取
- 未知路由 404
- kind 集群 containerd mirror 配置

## 限制与注意事项

- **Cloudflare Free 计划**：每天 10 万次请求、单次请求 CPU 时间 10ms。个人使用完全够用，高频拉取场景建议评估用量。
- **仅支持公共镜像**：不支持需要认证的私有仓库。
- **Docker Hub library 镜像**：官方镜像（如 nginx、redis）会自动补全 library/ 前缀，无需手动指定。
- **域名隐私**：wrangler-deploy.toml 含真实域名，已在 .gitignore 中排除。wrangler.toml 仅作为模板提交到仓库。

## License

MIT
