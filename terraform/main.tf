terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "ap-south-1"
}

# ------------------------------------------------
# Fetch Latest Ubuntu 22.04 LTS AMI
# ------------------------------------------------
data "aws_ami" "ubuntu_22" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name = "name"

    values = [
      "ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"
    ]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# ------------------------------------------------
# VPC
# ------------------------------------------------
resource "aws_vpc" "neon_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true

  tags = {
    Name = "neon-kart-vpc"
  }
}

# ------------------------------------------------
# Internet Gateway
# ------------------------------------------------
resource "aws_internet_gateway" "igw" {
  vpc_id = aws_vpc.neon_vpc.id

  tags = {
    Name = "neon-kart-igw"
  }
}

# ------------------------------------------------
# Public Subnet
# ------------------------------------------------
resource "aws_subnet" "public_subnet" {
  vpc_id                  = aws_vpc.neon_vpc.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = "ap-south-1a"
  map_public_ip_on_launch = true

  tags = {
    Name = "neon-kart-public-subnet"
  }
}

# ------------------------------------------------
# Route Table
# ------------------------------------------------
resource "aws_route_table" "public_rt" {
  vpc_id = aws_vpc.neon_vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.igw.id
  }

  tags = {
    Name = "neon-kart-route-table"
  }
}

# ------------------------------------------------
# Route Table Association
# ------------------------------------------------
resource "aws_route_table_association" "public_assoc" {
  subnet_id      = aws_subnet.public_subnet.id
  route_table_id = aws_route_table.public_rt.id
}

# ------------------------------------------------
# Security Group
# ------------------------------------------------
resource "aws_security_group" "neon_sg" {
  name   = "neon-kart-security-group"
  vpc_id = aws_vpc.neon_vpc.id

  # HTTP
  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Game Port
  ingress {
    description = "Game Port"
    from_port   = 8000
    to_port     = 8000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Grafana (NodePort)
  ingress {
    description = "Grafana NodePort"
    from_port   = 30000
    to_port     = 30000
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Prometheus (NodePort)
  ingress {
    description = "Prometheus NodePort"
    from_port   = 30090
    to_port     = 30090
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Jenkins
  ingress {
    description = "Jenkins"
    from_port   = 8080
    to_port     = 8080
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Kubernetes API
  ingress {
    description = "Kubernetes API"
    from_port   = 6443
    to_port     = 6443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # SSH
  ingress {
    description = "SSH"
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  # Outbound Traffic
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name = "neon-kart-security-group"
  }
}

# ------------------------------------------------
# EC2 Instance
# ------------------------------------------------
resource "aws_instance" "neon_server" {

  ami                    = data.aws_ami.ubuntu_22.id
  instance_type          = "c7i-flex.large"

  subnet_id              = aws_subnet.public_subnet.id
  vpc_security_group_ids = [aws_security_group.neon_sg.id]

  key_name = "neon-kart-key"

  root_block_device {
    volume_size = 16
    volume_type = "gp3"
  }

  user_data = <<-EOF
              #!/bin/bash

              apt update -y
              apt install -y curl docker.io

              systemctl enable docker
              systemctl start docker

              # Install K3s, explicitly disabling the Traefik Ingress Controller to prevent Port 80 conflicts
              curl -sfL https://get.k3s.io | INSTALL_K3S_EXEC="--disable traefik" sh -s -

              # Wait for K3s to finish generating certificates and config files
              sleep 30

              ln -s /usr/local/bin/kubectl /usr/bin/kubectl

              mkdir -p /home/ubuntu/.kube
              cp /etc/rancher/k3s/k3s.yaml /home/ubuntu/.kube/config

              chown -R ubuntu:ubuntu /home/ubuntu/.kube

              # Ensure kubectl prioritizes the local config
              echo "export KUBECONFIG=~/.kube/config" >> /home/ubuntu/.bashrc

              # ---------------------------------------------------------
              # Phase 7: Observability (Prometheus & Grafana) via Helm
              # ---------------------------------------------------------
              # 1. Install Helm
              curl -fsSL -o get_helm.sh https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3
              chmod +x get_helm.sh
              ./get_helm.sh

              # 2. Deploy the Kube-Prometheus-Stack
              export KUBECONFIG=/etc/rancher/k3s/k3s.yaml
              helm repo add prometheus-community https://prometheus-community.github.io/helm-charts
              helm repo update
              helm install monitoring prometheus-community/kube-prometheus-stack \
                --namespace monitoring \
                --create-namespace \
                --set grafana.service.type=NodePort \
                --set grafana.service.nodePort=30000 \
                --set prometheus.service.type=NodePort \
                --set prometheus.service.nodePort=30090

              echo "K3s, Prometheus, and Grafana Installed Successfully"
              EOF

  tags = {
    Name = "neon-kart-k3s-server"
  }
}

# ------------------------------------------------
# Elastic IP (Fixed IP)
# ------------------------------------------------
resource "aws_eip" "neon_eip" {
  instance = aws_instance.neon_server.id
  domain   = "vpc"

  tags = {
    Name = "neon-kart-fixed-ip"
  }
}

# ------------------------------------------------
# Outputs
# ------------------------------------------------
output "public_ip" {
  value = aws_instance.neon_server.public_ip
}

output "elastic_ip" {
  value = aws_eip.neon_eip.public_ip
}