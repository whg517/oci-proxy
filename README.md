# oci-proxy

Cloudflare Worker 代理 OCI 容器镜像仓库，解决国内无法访问 Docker Hub、GHCR、GCR 等仓库的问题。

## 架构

```
docker pull nginx:latest
  │
  ▼
docker daemon / containerd (配置 registry mirror)
  │
  ▼
docker.<your-domain>  ← Cloudflare Worker 代理
  │  子域名自动路由（无需改代码）
  ├── docker.<domain> → registry-1.docker.io  (默认启用)
  ├── ghcr.<domain>   → ghcr.io               (REGISTRIES=ghcr)
  ├── gcr.<domain>    → gcr.io                (REGISTRIES=gcr)
  └── k8s.<domain>    → registry.k8s.io       (REGISTRIES=k8s)
```

## 快速开始

### 1. 部署 Worker

```bash
npm install
npm run deploy
```

### 2. Docker 配置

```bash
sudo tee /etc/docker/daemon.json << 'EOF'
{
  "registry-mirrors": ["https://docker.<your-domain>"]
}
EOF
sudo systemctl restart docker
```

### 3. 验证

```bash
docker pull nginx:alpine
```

## 添加新注册表（不改代码）

只需三步：

### 1. 设置环境变量

在 `wrangler.toml` 中添加：
```toml
[vars]
REGISTRIES = "ghcr,gcr,k8s"
```

或在 Cloudflare Dashboard → Worker → Settings → Variables 中设置。

### 2. 添加 Custom Domain

在 `wrangler.toml` 的 `routes` 中添加：
```toml
routes = [
  { pattern = "docker.<your-domain>", custom_domain = true },
  { pattern = "ghcr.<your-domain>", custom_domain = true },
  { pattern = "gcr.<your-domain>", custom_domain = true },
  { pattern = "k8s.<your-domain>", custom_domain = true },
]
```

### 3. 添加 DNS 解析

在 Cloudflare DNS 中添加对应子域名的 CNAME 记录指向 Worker。

### 4. 重新部署

```bash
npm run deploy
```

## containerd / Kubernetes 配置

### kind 集群

```yaml
# kind-config.yaml
kind: Cluster
apiVersion: kind.x-k8s.io/v1alpha4
name: my-cluster
containerdConfigPatches:
  - |-
    [plugins."io.containerd.grpc.v1.cri".registry.mirrors]
      [plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]
        endpoint = ["https://docker.<your-domain>"]
```

### 原生 containerd

```toml
# /etc/containerd/config.toml
[plugins."io.containerd.grpc.v1.cri".registry.mirrors]
  [plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]
    endpoint = ["https://docker.<your-domain>"]
  [plugins."io.containerd.grpc.v1.cri".registry.mirrors."ghcr.io"]
    endpoint = ["https://ghcr.<your-domain>"]
```

## 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `REGISTRIES` | 启用的注册表前缀（逗号分隔） | `""` (仅 docker) |

`docker` 前缀始终启用，无需在 `REGISTRIES` 中指定。

## 支持的注册表

| 前缀 | 上游 | 状态 |
|------|------|------|
| `docker` | registry-1.docker.io | 默认启用 |
| `ghcr` | ghcr.io | opt-in |
| `gcr` | gcr.io | opt-in |
| `k8s` | registry.k8s.io | opt-in |

## 开发

```bash
npm run dev    # 本地开发 (http://localhost:8787)
npm run deploy # 部署到 Cloudflare
npm run tail   # 查看实时日志
```

## License

MIT
