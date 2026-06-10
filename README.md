# oci-proxy

Cloudflare Worker 代理 OCI 容器镜像仓库，解决国内无法访问 Docker Hub、GHCR、GCR 等仓库的问题。

## 架构

```
docker pull nginx:latest
  │
  ▼
docker daemon (daemon.json 配置 registry-mirrors)
  │
  ▼
docker.example.com  ← Cloudflare Worker 代理
  │  子域名路由
  ├── docker.example.com → registry-1.docker.io (Docker Hub) ✅ Phase 1
  ├── ghcr.example.com   → ghcr.io              (GHCR)     🔜 Phase 2
  ├── gcr.example.com    → gcr.io               (GCR)      🔜 Phase 2
  └── k8s.example.com    → registry.k8s.io      (k8s.io)   🔜 Phase 2
```

## Phase 1: Docker Hub

### Docker daemon 配置

```bash
sudo tee /etc/docker/daemon.json << 'EOF'
{
  "registry-mirrors": ["https://docker.example.com"]
}
EOF
sudo systemctl restart docker
```

### containerd 配置

```toml
# /etc/containerd/config.toml
[plugins."io.containerd.grpc.v1.cri".registry.mirrors]
  [plugins."io.containerd.grpc.v1.cri".registry.mirrors."docker.io"]
    endpoint = ["https://docker.example.com"]
```

### 验证

```bash
docker pull nginx:latest
docker pull redis:alpine
docker pull golang:1.23
```

## 开发

```bash
# 安装依赖
npm install

# 本地开发 (监听 0.0.0.0:8787)
npm run dev

# 本地测试 (使用 --env dev 或设置 DOCKER_HUB 测试)
curl -I http://localhost:8787/v2/
```

## 部署

```bash
npm run deploy
```

## 关键技术点

### Docker Hub 认证流程

1. Docker daemon 请求 `/v2/` → 收到 401 + `Www-Authenticate` 头
2. Worker 重写 `Www-Authenticate` 中的 `realm` 指向自己的 `/v2/auth`
3. Docker daemon 请求 `/v2/auth?scope=...` → Worker 代理到 `auth.docker.io/token`
4. 获取 Bearer Token 后，后续请求带上 Token 转发到 `registry-1.docker.io`

### Docker Hub Library 镜像处理

官方镜像（如 `nginx`）在 Docker Hub 上的实际路径是 `library/nginx`。
Docker daemon 发送的是 `nginx`，Worker 需要自动补全 `library/` 前缀：
- 路径：`/v2/nginx/manifests/latest` → 301 重定向到 `/v2/library/nginx/manifests/latest`
- Scope：`repository:nginx:pull` → `repository:library/nginx:pull`

### Blob 307 重定向

Docker Hub 的 blob 下载会返回 307 重定向到 CDN。
Worker 设置 `redirect: "manual"` 手动拦截 307，然后自行跟随重定向。

## License

MIT
