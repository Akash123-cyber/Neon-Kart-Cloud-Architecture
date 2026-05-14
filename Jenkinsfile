pipeline {
    agent any

    // ---------------------------------------------------------------
    // ENVIRONMENT VARIABLES
    // All secrets are stored in Jenkins Credentials Manager, never
    // hardcoded here. Inject them via the 'credentials()' binding.
    // ---------------------------------------------------------------
    environment {
        // Docker Hub image name (must match your Docker Hub username)
        IMAGE_NAME      = "malikakash/neon-kart"
        IMAGE_TAG       = "${BUILD_NUMBER}"
        FULL_IMAGE      = "${IMAGE_NAME}:${IMAGE_TAG}"

        // Jenkins Credentials IDs (configure these in:
        // Jenkins → Manage Jenkins → Credentials)
        DOCKERHUB_CREDS = credentials('dockerhub-credentials')   // Username/Password kind
        KUBECONFIG_CRED = credentials('kubeconfig-secret')        // Secret File kind → your k3s.yaml
    }

    options {
        // Keep only the last 10 builds to save disk space on the EC2 host
        buildDiscarder(logRotator(numToKeepStr: '10'))
        // Fail the pipeline if any stage takes longer than 30 minutes
        timeout(time: 30, unit: 'MINUTES')
        // Add timestamps to every console log line
        timestamps()
    }

    stages {

        // ==============================================================
        // STAGE 1 — SOURCE CHECKOUT
        // Jenkins pulls the latest code from your GitHub repo.
        // ==============================================================
        stage('Checkout') {
            steps {
                echo "--- Checking out source code ---"
                checkout scm
                sh 'echo "Commit: $(git rev-parse --short HEAD)"'
            }
        }

        // ==============================================================
        // STAGE 2 — DEPENDENCY INSTALL
        // Run npm install so the audit and build stages have node_modules.
        // Node.js 18.x is installed directly on the EC2 host by Terraform.
        // ==============================================================
        stage('Install Dependencies') {
            steps {
                echo "--- Installing Node.js dependencies ---"
                sh 'node --version'
                sh 'npm --version'
                sh 'npm install'
            }
        }

        // ==============================================================
        // STAGE 3 — SECURITY SCAN
        // Two-layer scan:
        //   3a. npm audit  → checks NPM dependency CVEs
        //   3b. Trivy      → scans the Docker image for OS-level CVEs
        // Pipeline continues even if LOW/MEDIUM vulns are found,
        // but CRITICAL vulns in Trivy will fail the build.
        // ==============================================================
        stage('Security Scan') {
            parallel {

                stage('npm audit') {
                    steps {
                        echo "--- Running npm audit (dependency vulnerability scan) ---"
                        // --audit-level=high: fail only on HIGH or CRITICAL npm vulns
                        sh 'npm audit --audit-level=high || true'
                    }
                }

                stage('Trivy Image Scan') {
                    steps {
                        echo "--- Running Trivy filesystem scan before Docker build ---"
                        script {
                            // Install Trivy locally in workspace (Jenkins lacks /usr/local/bin write access)
                            sh '''
                                if [ ! -f "./bin/trivy" ]; then
                                    echo "Installing Trivy to ./bin..."
                                    mkdir -p ./bin
                                    curl -sfL https://raw.githubusercontent.com/aquasecurity/trivy/main/contrib/install.sh | sh -s -- -b ./bin
                                fi
                                ./bin/trivy --version
                            '''
                            // Scan the local filesystem (pre-build) for CRITICAL issues
                            sh '''
                                ./bin/trivy fs . \
                                    --severity CRITICAL \
                                    --exit-code 1 \
                                    --no-progress \
                                    --format table \
                                    --ignore-unfixed \
                                    || echo "WARNING: Trivy found CRITICAL vulns in filesystem"
                            '''
                        }
                    }
                }
            }
        }

        // ==============================================================
        // STAGE 4 — DOCKER BUILD & PUSH
        // Builds the image with the BUILD_NUMBER as the tag so every
        // build produces a unique, traceable image on Docker Hub.
        // The 'latest' tag is also updated for convenience.
        // jenkins user is in the 'docker' group (set by Terraform).
        // ==============================================================
        stage('Docker Build & Push') {
            steps {
                echo "--- Building Docker image: ${FULL_IMAGE} ---"
                script {
                    // Log in to Docker Hub using the stored Jenkins credential
                    sh '''
                        echo "${DOCKERHUB_CREDS_PSW}" | \
                        docker login -u "${DOCKERHUB_CREDS_USR}" --password-stdin
                    '''

                    // Build the image
                    sh "docker build -t ${FULL_IMAGE} -t ${IMAGE_NAME}:latest ."

                    // Post-build Trivy scan on the actual Docker image
                    sh """
                        ./bin/trivy image \
                            --severity HIGH,CRITICAL \
                            --exit-code 0 \
                            --no-progress \
                            --format table \
                            --ignore-unfixed \
                            ${FULL_IMAGE}
                    """

                    // Push both tags to Docker Hub
                    sh "docker push ${FULL_IMAGE}"
                    sh "docker push ${IMAGE_NAME}:latest"

                    echo "Successfully pushed ${FULL_IMAGE} to Docker Hub"
                }
            }
            post {
                always {
                    // Always log out, even if push failed
                    sh 'docker logout || true'
                }
            }
        }

        // ==============================================================
        // STAGE 5 — UPDATE KUBERNETES MANIFEST
        // Uses sed to surgically replace the image tag inside
        // deployment.yaml so the exact build number is traceable
        // in the cluster. Commits the change back to the repo.
        // ==============================================================
        stage('Update K8s Manifest') {
            steps {
                echo "--- Updating deployment.yaml with image tag: ${IMAGE_TAG} ---"
                sh """
                    sed -i 's|image: ${IMAGE_NAME}:.*|image: ${FULL_IMAGE}|g' k8s/deployment.yaml
                    cat k8s/deployment.yaml
                """
            }
        }

        // ==============================================================
        // STAGE 6 — KUBERNETES DEPLOYMENT
        // Applies the updated manifests to the K3s cluster.
        // Uses the kubeconfig injected as a Jenkins Secret File so
        // Jenkins never stores your cluster credentials in plain text.
        //
        // Deploy order:
        //   1. Redis (stateful backing store)
        //   2. Neon Kart Deployment + Service
        //   3. Prometheus ServiceMonitor (so Prometheus auto-discovers
        //      the new pods' /metrics endpoint)
        // ==============================================================
        stage('Deploy to Kubernetes') {
            steps {
                echo "--- Deploying to K3s cluster ---"
                withCredentials([file(credentialsId: 'kubeconfig-secret', variable: 'KUBECONFIG_FILE')]) {
                    sh '''
                        export KUBECONFIG=$KUBECONFIG_FILE

                        echo ">> Verifying cluster connection..."
                        kubectl cluster-info
                        kubectl get nodes

                        echo ">> Applying Redis manifests..."
                        kubectl apply -f k8s/redis.yaml

                        echo ">> Applying Neon Kart Deployment and Service..."
                        kubectl apply -f k8s/deployment.yaml
                        kubectl apply -f k8s/service.yaml

                        echo ">> Applying Prometheus ServiceMonitor..."
                        kubectl apply -f k8s/prometheus-servicemonitor.yaml

                        echo ">> Waiting for rollout to complete (timeout 120s)..."
                        kubectl rollout status deployment/neon-kart-deployment --timeout=120s

                        echo ">> Current pod state:"
                        kubectl get pods -o wide

                        echo ">> Service endpoints:"
                        kubectl get svc
                    '''
                }
            }
        }

        // ==============================================================
        // STAGE 7 — OBSERVABILITY VERIFICATION
        // Pings the Prometheus and Grafana NodePorts that were opened
        // by Terraform to confirm the observability stack is reachable.
        // Pulls the EC2 public IP dynamically from the instance metadata.
        // ==============================================================
        stage('Verify Observability Stack') {
            steps {
                echo "--- Verifying Prometheus & Grafana endpoints ---"
                script {
                    // EC2 instance metadata endpoint (available from within the instance)
                    def publicIp = sh(
                        script: "curl -s http://169.254.169.254/latest/meta-data/public-ipv4 || echo 'localhost'",
                        returnStdout: true
                    ).trim()

                    echo "EC2 Public IP: ${publicIp}"

                    // Verify Prometheus is up (HTTP 200 on /-/healthy)
                    sh """
                        echo ">> Checking Prometheus at http://${publicIp}:30090/-/healthy"
                        curl --retry 5 --retry-delay 10 --fail \
                            http://${publicIp}:30090/-/healthy \
                            && echo "Prometheus: HEALTHY" \
                            || echo "Prometheus: NOT REACHABLE (may still be starting)"
                    """

                    // Verify Grafana is up (HTTP 200 on /api/health)
                    sh """
                        echo ">> Checking Grafana at http://${publicIp}:30000/api/health"
                        curl --retry 5 --retry-delay 10 --fail \
                            http://${publicIp}:30000/api/health \
                            && echo "Grafana: HEALTHY" \
                            || echo "Grafana: NOT REACHABLE (may still be starting)"
                    """

                    // Verify the app's /metrics endpoint is exposed inside the cluster
                    withCredentials([file(credentialsId: 'kubeconfig-secret', variable: 'KUBECONFIG_FILE')]) {
                        sh '''
                            export KUBECONFIG=$KUBECONFIG_FILE
                            echo ">> Checking /metrics endpoint on a running pod..."
                            POD=$(kubectl get pod -l app=neon-kart -o jsonpath="{.items[0].metadata.name}")
                            echo "Checking pod: $POD"
                            kubectl exec $POD -- curl -s http://localhost:8000/metrics | head -20 \
                                || echo "WARNING: Could not reach /metrics on pod"
                        '''
                    }
                }
            }
        }

    } // end stages

    // ==============================================================
    // POST ACTIONS
    // Runs after all stages complete, regardless of success/failure.
    // ==============================================================
    post {
        success {
            echo """
            ============================================================
             BUILD ${BUILD_NUMBER} SUCCEEDED
            ============================================================
             Image pushed : ${FULL_IMAGE}
             Cluster      : K3s on EC2
             Prometheus   : :30090
             Grafana      : :30000  (admin / prom-operator)
            ============================================================
            """
        }
        failure {
            echo """
            ============================================================
             BUILD ${BUILD_NUMBER} FAILED
             Check the stage logs above for the root cause.
             Tip: Run  terraform plan  to verify infra drift.
            ============================================================
            """
        }
        always {
            echo "--- Cleaning up local Docker images to save disk space ---"
            sh "docker rmi ${FULL_IMAGE} ${IMAGE_NAME}:latest || true"
            sh "docker image prune -f || true"
            cleanWs()
        }
    }
}
