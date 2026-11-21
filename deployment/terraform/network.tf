# Fetch availability zones
data "aws_availability_zones" "available" {
  state = "available"
}

# Dedicated VPC (Zero NAT Gateway cost - 100% free VPC & IGW)
resource "aws_vpc" "envscale_vpc" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "envscale-vpc"
  }
}

# Internet Gateway (Free)
resource "aws_internet_gateway" "envscale_igw" {
  vpc_id = aws_vpc.envscale_vpc.id

  tags = {
    Name = "envscale-igw"
  }
}

# Public Subnet
resource "aws_subnet" "envscale_public_subnet" {
  vpc_id                  = aws_vpc.envscale_vpc.id
  cidr_block              = "10.0.1.0/24"
  availability_zone       = data.aws_availability_zones.available.names[0]
  map_public_ip_on_launch = true

  tags = {
    Name = "envscale-public-subnet"
  }
}

# Route Table for Internet Access
resource "aws_route_table" "envscale_public_rt" {
  vpc_id = aws_vpc.envscale_vpc.id

  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.envscale_igw.id
  }

  tags = {
    Name = "envscale-public-rt"
  }
}

# Associate Subnet with Route Table
resource "aws_route_table_association" "envscale_public_assoc" {
  subnet_id      = aws_subnet.envscale_public_subnet.id
  route_table_id = aws_route_table.envscale_public_rt.id
}
