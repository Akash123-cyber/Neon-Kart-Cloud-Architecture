# 🏎️ Neon Kart Battle: Cloud-Native Multiplayer Game

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D18.0.0-blue.svg)](https://nodejs.org/)
[![Socket.io](https://img.shields.io/badge/socket.io-v4.8.3-green.svg)](https://socket.io/)
[![Redis](https://img.shields.io/badge/redis-v4.6.13-red.svg)](https://redis.io/)
[![Docker](https://img.shields.io/badge/docker-multi--stage-blue.svg)](https://www.docker.com/)
[![Kubernetes](https://img.shields.io/badge/kubernetes-K3s-blue.svg)](https://k3s.io/)
[![Terraform](https://img.shields.io/badge/terraform-v1.5+-purple.svg)](https://www.terraform.io/)
[![Jenkins](https://img.shields.io/badge/jenkins-pipeline-orange.svg)](https://www.jenkins.io/)
[![Observability](https://img.shields.io/badge/metrics-prometheus%20%2F%20grafana-brightgreen.svg)](https://prometheus.io/)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](https://opensource.org/licenses/MIT)

Neon Kart Battle is a highly concurrent, real-time multiplayer PvP and solo kart battle game. Designed with a **cloud-native, cost-optimized AWS architecture**, it runs a stateless containerized backend on a self-managed, lightweight **K3s (Kubernetes)** cluster, managed with **Terraform**, deployed via **Jenkins**, and monitored through **Prometheus & Grafana**.

---

## 📖 Table of Contents
1. [Key Architectural Features](#-key-architectural-features)
2. [Cloud-Native System Architecture](#%EF%B8%8F-cloud-native-system-architecture)
3. [Repository Directory Structure](#-repository-directory-structure)
4. [Core Game Mechanics & Netcode](#-core-game-mechanics--netcode)
5. [Dual-Tier Session Persistence](#-dual-tier-session-persistence)
6. [Continuous Integration & DevSecOps](#-continuous-integration--devsecops)
7. [Observability & Monitoring](#-observability--monitoring)
8. [Local Development Setup](#-local-development-setup)
9. [Infrastructure Provisioning (Terraform)](#-infrastructure-provisioning-terraform)
10. [Production Jenkins CI/CD Setup](#-production-jenkins-cicd-setup)

---

## 🚀 Key Architectural Features

- **Cost-Optimized Compute (Saving $73+/mo):** Avoids AWS EKS control-plane charges. The entire Kubernetes orchestration environment (K3s), Jenkins automation engine, and monitoring stack are bootstrapped onto a single, high-performance `c7i-flex.large` EC2 instance using Terraform.
- **Stateless Redis Pub/Sub Router:** Socket.io connections utilize `@socket.io/redis-adapter` for a distributed event broker model, coordinating game sessions, authentication, and player state across horizontally scaled pods.
- **AAA Real-Time Networking (30 FPS/60+ FPS):** Minimizes network overhead by processing server physics and broadcasting game states at an efficient **30 FPS**. Client browsers apply **Linear Interpolation (Lerp)** on position and angle vectors to render smooth gameplay at **60/144/240 FPS**.
- **DevSecOps Compliance:** Jenkins enforces a multi-layer security scan—running `npm audit` on NPM dependencies and `Trivy` filesystem/container vulnerability scanning to fail builds on `CRITICAL` issues.
- **Exposed Custom Metrics:** The Node.js server incorporates `prom-client` to publish core system performance and game metrics (e.g., active players, event-loop lag, HTTP response duration histograms) on a `/metrics` route scraped by Prometheus.

---

## 🗺️ Cloud-Native System Architecture

The following diagram illustrates the network topography, container deployment namespaces, data flows, and monitoring scrape paths of the system:

```mermaid
graph TD
    subgraph AWS_Cloud ["AWS Cloud (AP-South-1)"]
        subgraph VPC ["VPC (10.0.0.0/16)"]
            EIP["Elastic IP"] --> EC2["c7i-flex.large EC2 Instance"]
            
            subgraph EC2_Host ["EC2 Bare-Metal Host OS"]
                Jenkins["Jenkins CI/CD Server (Port 8080)"]
                Docker["Docker Engine"]
            end
            
            subgraph K3s_Cluster ["K3s Kubernetes Cluster"]
                direction TB
                
                subgraph Default_Namespace ["Namespace: default"]
                    ServiceLB["K3s ServiceLB (Port 80 -> Port 8000)"]
                    
                    Pod1["Neon Kart Pod 1"]
                    Pod2["Neon Kart Pod 2"]
                    
                    Redis["Redis Deployment (1 Replica)"]
                    RedisPVC["Persistent Volume Claim (1Gi local-path)"]
                end
                
                subgraph Monitoring_Namespace ["Namespace: monitoring"]
                    Prometheus["Prometheus Server (Port 30090)"]
                    Grafana["Grafana Dashboard (Port 30000)"]
                    ServiceMonitor["Prometheus ServiceMonitor"]
                end
            end
        end
    end
    
    %% Connections & Data Flow
    Client["Player Web Browser"] -->|HTTP / WebSocket (Port 80)| ServiceLB
    ServiceLB -->|Load Balance| Pod1
    ServiceLB -->|Load Balance| Pod2
    
    Pod1 <-->|Redis Pub/Sub Event Router| Redis
    Pod2 <-->|Redis Pub/Sub Event Router| Redis
    Redis <-->|Data Persistence| RedisPVC
    
    %% Monitoring Flow
    ServiceMonitor -->|Auto-Discover Target| Pod1
    ServiceMonitor -->|Auto-Discover Target| Pod2
    Prometheus -->|Scrape /metrics| ServiceMonitor
    Grafana -->|Query Metrics| Prometheus
    Developer["Ops / Administrator"] -->|View Analytics| Grafana
    
    %% CI/CD flow
    Github["GitHub Repository"] -->|Trigger Push| Jenkins
    Jenkins -->|1. Run npm audit & Trivy fs scan| Docker
    Jenkins -->|2. Build & Push Image| DockerHub["Docker Hub Registry"]
    Jenkins -->|3. Mutate k8s/deployment.yaml| K3sAPI["K3s Cluster API (Port 6443)"]
```

---

## 📁 Repository Directory Structure

```bash
├── Dockerfile                      # Multi-stage production container build (Node 18 Alpine)
├── Jenkinsfile                     # 7-stage automated DevSecOps and deployment pipeline
├── package.json                    # Node dependencies (Express, Socket.IO, prom-client, Redis, Bcryptjs)
├── server.js                       # Game server: matchmaking, Redis event broker, auth routes, game loop
├── game.js                         # Game client: Canvas rendering, client LERP, Sound Synth, Bot AI
├── index.html                      # Glassmorphism UI lobby interfaces and HTML5 canvas container
├── style.css                       # Modern CSS styling (Glassmorphism layout, animations)
├── neon-kart-grafana-dashboard.json # Pre-configured JSON dashboard for Grafana imports
├── k8s/                            # Kubernetes Orchestration manifests
│   ├── deployment.yaml             # Horizontally-scaled game server pods config with liveness/readiness probes
│   ├── service.yaml                # LoadBalancer Service mapping traffic (port 80 -> 8000)
│   ├── redis.yaml                  # Persistent Redis database Deployment, Service, and local-path PVC
│   └── prometheus-servicemonitor.yaml # ServiceMonitor telling Prometheus Operator to scrape metrics
├── terraform/                      # Infrastructure as Code manifests
│   └── main.tf                     # Provisions AWS VPC, Security Group, EIP, EC2 instance, and user_data scripts
└── ProjectRelatedMarkdownFiles/    # Extended architectural research documentation
    ├── technical_architecture.md   # Core engine specs, networking models, and authentication logic
    ├── Implementation.md           # Step-by-step checklist of development phases
    ├── k3s_architecture_guide.md   # In-depth mechanics of K3s, ServiceLB, and Traefik configurations
    ├── JENKINS_SETUP_GUIDE.md      # Detailed Jenkins initialization guide
    └── terraform_architecture_guide.md # Concepts of declarative IaC and AWS bootstrapping script details
```

---

## 🎮 Core Game Mechanics & Netcode

### Matchmaking & Rooms
The application avoids global traffic broadcasting by grouping player socket IDs into isolated **Socket.IO Rooms**. 
1. **Creation:** Lobbies generate a unique 6-character code (e.g. `XJ8K3Q`), binding settings like game duration, theme, and capacity (2-10 players).
2. **Dynamic Entry:** The lobby displays player count updates and restricts game start until the room is full.
3. **Master Room Ownership:** When a room is created, the Node.js pod that received the socket request registers itself as the **Master Owner** of that room in Redis. Subsequent player joins query Redis to find the Master Owner pod, proxying all keyboard inputs and collision calculations to that single authoritative node to prevent desynchronization.

### Interpolation (LERP)
To optimize network bandwidth costs, the server ticks physics and broadcasts player coordinates at **30 FPS**. To ensure smooth rendering on modern high-refresh-rate displays (60Hz to 240Hz+), the client browser calculates the delta time (`dt`) and uses linear interpolation to render intermediate frames:
```javascript
// Position Lerp
op.x += (op.targetX - op.x) * lerpFactor;
op.y += (op.targetY - op.y) * lerpFactor;

// Shortest-arc Angle Lerp (prevents erratic 360-degree spins)
let angleDiff = op.targetAngle - op.angle;
while (angleDiff >  Math.PI) angleDiff -= 2 * Math.PI;
while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;
op.angle += angleDiff * lerpFactor;
```

---

## 💾 Dual-Tier Session Persistence

To guarantee persistent player statistics without causing database thrashing, a dual-tier storage strategy is implemented:

### 1. Registered Users (Stateless Redis Mode)
Credentials are securely hashed using `bcrypt` and stored within Redis hashes (`user:${username}`). This architecture makes the Node.js server pods entirely **stateless**, removing local filesystem dependencies (like SQLite locks) and allowing replicas to scale horizontally:
- **Redis Schema (hSet):** `password_hash`, `wins`, `matches_played`, `high_score`.

### 2. Guest Sessions (Hybrid In-Memory & Local Storage)
To prevent transient guest accounts from bloating the database:
- **Active Session (Server RAM):** Dynamic session parameters (`coordinates`, `health`, `live score`) are held in the server's `rooms` RAM, acting as a temporary high-speed database. This state is instantly garbage-collected upon user disconnect.
- **Persistent Stats (Browser Local Storage):** Long-term totals for `Wins`, `Matches`, and `High Score` are cached using the browser's `localStorage` API, keeping state persistent between sessions.

---

## 🛡️ Continuous Integration & DevSecOps

The [Jenkinsfile](./Jenkinsfile) automates the code validation, security scanning, build generation, manifest mutation, and deployment cycle:

```
[Checkout] ──> [Install Deps] ──> [Security Scan] ──> [Docker Build & Push] ──> [Update Manifest] ──> [Deploy K3s] ──> [Verify Observability]
```

1. **Checkout:** Pulls latest revisions from the GitHub `main` branch.
2. **Install Dependencies:** Installs packages using native `npm install` on the EC2 host.
3. **Security Scan (Parallel):**
   - **npm audit:** Checks NPM packages for security advisories.
   - **Trivy File Scan:** Installs Trivy locally to inspect the workspace for `CRITICAL` system vulnerabilities.
4. **Docker Build & Push:** Authenticates against Docker Hub, builds a production image using the Jenkins `BUILD_NUMBER` tag, runs a Trivy container image scan, and pushes the tagged and `:latest` images to Docker Hub.
5. **Update K8s Manifest:** Modifies `k8s/deployment.yaml` with the unique image tag using `sed`.
6. **Deploy to Kubernetes:** Imports cluster credentials (`kubeconfig-secret`), applies manifests (`redis.yaml`, `deployment.yaml`, `service.yaml`, `prometheus-servicemonitor.yaml`), and monitors rollout completion.
7. **Verify Observability:** Queries Prometheus and Grafana health endpoints to confirm the monitoring stack is live and responsive.

---

## 📊 Observability & Monitoring

The repository integrates a complete logging and telemetry stack using Prometheus operator CRDs:

### Metrics Exporter (`prom-client`)
- **System Metrics:** Tracks standard Node.js runtime parameters (CPU utilization, resident memory size `RSS`, heap total/used size, active handles, active async requests, garbage collection frequency).
- **Custom Game Metrics:** Implements a custom Prometheus Gauge `neon_kart_active_players` tracking concurrent connections tagged with the host pod name (`pod`).
- **HTTP Metrics:** Implements a HTTP Request Duration Histogram tracking processing latencies by method and route status codes.

### Grafana Dashboard Import
The [neon-kart-grafana-dashboard.json](./neon-kart-grafana-dashboard.json) file configures the following panels:
- **🟢 Active Players (Live):** Single-value gauge showing aggregate connections.
- **📈 Player Count Over Time:** Split timeseries tracking total players vs. individual pod allocations.
- **⚡ Server Load:** Gauge metric scaling active players against maximum capacity (20).
- **🧠 Node.js Memory:** Heap memory consumption overlay tracked per Pod.
- **⏱️ HTTP Latency:** Quantiles displaying p50 and p95 request latencies.
- **💻 Pod Resource Allocation:** Kubernetes container level metrics for CPU and Memory.

---

## 💻 Local Development Setup

### Prerequisites
- Node.js (v18.x or higher)
- Redis server running locally (or fallback to Local-Memory simulation Mode automatically if connection times out)

### Installation
1. Clone the repository:
   ```bash
   git clone <your-repo-url>
   cd Neon-Kart-Cloud-Architecture
   ```
2. Install standard production and development dependencies:
   ```bash
   npm install
   ```
3. Boot the Express and Socket.IO server:
   ```bash
   npm start
   ```
4. Access the client interface at `http://localhost:8000`.

---

## 🛠️ Infrastructure Provisioning (Terraform)

### Prerequisites
- Install Terraform (v1.5+)
- AWS CLI configured with administrator privileges (`aws configure`)
- SSH key pair named `neon-kart-key` generated in region `ap-south-1`

### Deployment Steps
1. Navigate to the infrastructure folder:
   ```bash
   cd terraform
   ```
2. Initialize provider plugins (installs AWS providers):
   ```bash
   terraform init
   ```
3. Perform a syntax and config validation check:
   ```bash
   terraform validate
   ```
4. Execute a dry-run to preview resources to be created:
   ```bash
   terraform plan
   ```
5. Apply modifications (provisions VPC, EC2, Subnets, Helm, K3s, and Monitoring Stack):
   ```bash
   terraform apply -auto-approve
   ```
6. Take note of the printed Outputs (e.g. `elastic_ip`). Keep the EC2 `.pem` key secure for SSH connection.
7. Teardown resources when done to avoid AWS billing costs:
   ```bash
   terraform destroy -auto-approve
   ```

---

## ☸️ Production Jenkins CI/CD Setup

### 1. Unlock Jenkins
Following a successful `terraform apply`, access the Jenkins UI at `http://<EC2_PUBLIC_IP>:8080`. Retrieve the initial administrator key:
```bash
ssh -i neon-kart-key.pem ubuntu@<EC2_PUBLIC_IP>
sudo cat /var/lib/jenkins/secrets/initialAdminPassword
```
Paste this into the login page, then select "Install Suggested Plugins".

### 2. Install Pipeline Plugins
Navigate to **Manage Jenkins → Plugins → Available Plugins** and install:
- `Docker Pipeline`
- `Credentials Binding`
- `Pipeline: GitHub`
- `Timestamper`

### 3. Add Environment Credentials
Navigate to **Manage Jenkins → Credentials → System → Global credentials → Add Credentials**:
- **Credential 1 (Docker Hub Registry):**
  - **Kind:** Username with password
  - **ID:** `dockerhub-credentials`
  - **Username:** your Docker Hub profile name (e.g. `malikakash`)
  - **Password:** your Docker Hub password or personal access token
- **Credential 2 (K3s Access Config):**
  - **Kind:** Secret file
  - **ID:** `kubeconfig-secret`
  - **File:** Upload the generated cluster config from your EC2 instance (`/home/ubuntu/.kube/config` or `/etc/rancher/k3s/k3s.yaml`)

### 4. Create Pipeline Job
1. Click **New Item**, enter `neon-kart-pipeline`, and select **Pipeline**.
2. Under **Pipeline Definition**, select **Pipeline script from SCM**.
3. Choose **Git** as the SCM, input your GitHub repo HTTPS URL, and target the branches parameter to `*/main`.
4. Define the script path as `Jenkinsfile`.
5. Click **Save** and trigger a test build using **Build Now**.
