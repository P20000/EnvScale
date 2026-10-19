# Generate SSH Key Pair automatically so the user doesn't need to manually create one
resource "tls_private_key" "envscale_ssh_key" {
  algorithm = "ED25519"
}

resource "aws_key_pair" "envscale_keypair" {
  key_name   = "envscale-demo-key"
  public_key = tls_private_key.envscale_ssh_key.public_key_openssh
}

# Save the private key locally with 0600 permissions
resource "local_sensitive_file" "ssh_private_key" {
  content         = tls_private_key.envscale_ssh_key.private_key_openssh
  filename        = "${path.module}/envscale_key.pem"
  file_permission = "0600"
}

# Find latest official Ubuntu 22.04 LTS AMI for current region & architecture
data "aws_ami" "ubuntu" {
  most_recent = true
  owners      = ["099720109477"] # Canonical

  filter {
    name   = "name"
    values = ["ubuntu/images/hvm-ssd/ubuntu-jammy-22.04-amd64-server-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}

# EC2 Instance
resource "aws_instance" "envscale_host" {
  ami                         = data.aws_ami.ubuntu.id
  instance_type               = var.instance_type
  subnet_id                   = aws_subnet.envscale_public_subnet.id
  vpc_security_group_ids      = [aws_security_group.envscale_sg.id]
  key_name                    = aws_key_pair.envscale_keypair.key_name
  associate_public_ip_address = true

  root_block_device {
    volume_size           = var.volume_size_gb
    volume_type           = "gp3"
    iops                  = 3000
    throughput            = 125
    delete_on_termination = true
    tags = {
      Name = "envscale-root-volume"
    }
  }

  user_data = templatefile("${path.module}/user_data.sh.tpl", {
    DOMAIN_NAME = var.domain_or_duckdns
    ACME_EMAIL  = var.acme_email
  })

  tags = {
    Name = "envscale-all-in-one-demo"
  }
}

# Optional Elastic IP (Keeps IP constant across reboots if desired)
resource "aws_eip" "envscale_eip" {
  instance = aws_instance.envscale_host.id
  domain   = "vpc"

  tags = {
    Name = "envscale-eip"
  }

  depends_on = [aws_internet_gateway.envscale_igw]
}
