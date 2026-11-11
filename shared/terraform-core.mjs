const PRIVATE_BACKEND_ROLE_PATTERN =
  /(^|[-_])(db|database|postgres|mysql|redis|valkey|cache|storage|volume|gitaly|etcd|keeper|zookeeper|broker|bookkeeper|ingester|data|master|metadata|search|index|cassandra|cockroach|clickhouse|qdrant|milvus|minio|seaweedfs|scanner|worker|sidekiq|compactor)($|[-_])/i;

export function isManagedLoadBalancerComponent(component) {
  return component.instanceType === "managed-lb" || component.role === "load-balancer";
}

export function isObjectStorageComponent(component) {
  return (
    component.instanceType === "object-bucket" ||
    component.storageType === "object" ||
    component.role === "object-storage"
  );
}

export function isPrivateBackendRole(role) {
  return PRIVATE_BACKEND_ROLE_PATTERN.test(role);
}

export function buildCloudTerraformSnippet({ cloud, slug, region, components, commentLabel }) {
  if (cloud === "gcp") {
    return buildGcpTerraformSnippet({ slug, region, components, commentLabel: commentLabel ?? "Google Cloud" });
  }

  if (cloud === "aws") {
    return buildAwsTerraformSnippet({ slug, region, components, commentLabel: commentLabel ?? "AWS" });
  }

  if (cloud === "azure") {
    return buildAzureTerraformSnippet({ slug, region, components, commentLabel: commentLabel ?? "Azure" });
  }

  return null;
}

export function buildGcpTerraformSnippet({ slug, region, components, commentLabel = "Google Cloud" }) {
  const resources = components
    .map((component, index) => {
      const resourceName = safeTerraformName(`${component.role}_${index + 1}`);
      const gcpBaseName = safeGcpName(`${slug}-${component.role}-${index + 1}`).slice(0, 46);

      if (isManagedLoadBalancerComponent(component)) {
        return `resource "google_compute_address" "${resourceName}_vip" {
  count        = ${component.count}
  name         = "${gcpBaseName}-vip-\${count.index + 1}"
  region       = "${region}"
  address_type = "EXTERNAL"
}`;
      }

      if (isObjectStorageComponent(component)) {
        return `resource "google_storage_bucket" "${resourceName}" {
  count                       = ${component.count}
  name                        = "\${var.project_id}-${gcpBaseName}-\${count.index + 1}"
  location                    = "${region}"
  storage_class               = "STANDARD"
  uniform_bucket_level_access = true

  labels = {
    app          = "${safeGcpName(slug)}"
    role         = "${safeGcpName(component.role)}"
    estimated_gb = "${component.storageGb ?? 0}"
  }
}`;
      }

      const bootDiskType = getGcpBootDiskType(component.instanceType);
      const dataDiskType = getGcpDataDiskType(component.instanceType, component.storageType);
      const attachPublicIp = !isPrivateBackendRole(component.role);
      const isGpuInstance = (component.gpu ?? 0) > 0 || /^g2-/.test(component.instanceType);

      const diskResource =
        component.storageGb > 0
          ? `resource "google_compute_disk" "${resourceName}_data" {
  count = ${component.count}
  name  = "${gcpBaseName}-data-\${count.index + 1}"
  type  = "${dataDiskType}"
  zone  = local.zones[count.index % length(local.zones)]
  size  = ${component.storageGb}
}

`
          : "";

      const diskAttachment =
        component.storageGb > 0
          ? `

  attached_disk {
    source = google_compute_disk.${resourceName}_data[count.index].id
    mode   = "READ_WRITE"
  }`
          : "";

      const accessConfigBlock = attachPublicIp
        ? `
    access_config {}`
        : "";

      const schedulingBlock = isGpuInstance
        ? `

  scheduling {
    on_host_maintenance = "TERMINATE"
    automatic_restart   = true
  }`
        : "";

      return `${diskResource}resource "google_compute_instance" "${resourceName}" {
  count        = ${component.count}
  name         = "${gcpBaseName}-\${count.index + 1}"
  machine_type = "${component.instanceType}"
  zone         = local.zones[count.index % length(local.zones)]

  boot_disk {
    initialize_params {
      image = "projects/debian-cloud/global/images/family/debian-12"
      size  = 50
      type  = "${bootDiskType}"
    }
  }

  network_interface {
    network = "default"${accessConfigBlock}
  }${diskAttachment}${schedulingBlock}

  labels = {
    app  = "${safeGcpName(slug)}"
    role = "${safeGcpName(component.role)}"
  }
}`;
    })
    .join("\n\n");

  return `# Compatible with Terraform >= 1.6 and OpenTofu >= 1.6
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 6.0"
    }
  }
}

variable "project_id" {
  description = "Google Cloud project ID for this deployment."
  type        = string
  default     = "replace-with-project-id"
}

provider "google" {
  project = var.project_id
  region  = "${region}"
}

locals {
  zones = ["${region}-a", "${region}-b", "${region}-c"]
}

# Generated for ${commentLabel} (${region}) from the current estimate state.
${resources}
`;
}

export function buildAwsTerraformSnippet({ slug, region, components, commentLabel = "AWS" }) {
  const slugTag = safeGcpName(slug).slice(0, 40);
  const resources = components
    .map((component, index) => {
      const resourceName = safeTerraformName(`${component.role}_${index + 1}`);
      const awsBaseName = safeGcpName(`${slug}-${component.role}-${index + 1}`).slice(0, 42);

      if (isManagedLoadBalancerComponent(component)) {
        const lbPrefix = awsBaseName.slice(0, 26).replace(/-+$/, "");
        return `resource "aws_lb" "${resourceName}" {
  count              = ${component.count}
  name               = "${lbPrefix}-\${count.index + 1}"
  internal           = false
  load_balancer_type = "network"
  subnets            = aws_subnet.workload[*].id

  tags = {
    App  = "${slugTag}"
    Role = "${safeGcpName(component.role)}"
  }
}`;
      }

      if (isObjectStorageComponent(component)) {
        const bucketPrefix = awsBaseName.slice(0, 32).replace(/-+$/, "");
        return `resource "aws_s3_bucket" "${resourceName}" {
  count         = ${component.count}
  bucket_prefix = "${bucketPrefix}-"

  tags = {
    App         = "${slugTag}"
    Role        = "${safeGcpName(component.role)}"
    EstimatedGb = "${component.storageGb ?? 0}"
  }
}

resource "aws_s3_bucket_public_access_block" "${resourceName}_private" {
  count                   = ${component.count}
  bucket                  = aws_s3_bucket.${resourceName}[count.index].id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}`;
      }

      const attachPublicIp = !isPrivateBackendRole(component.role);
      const isArmInstance = /^[a-z]+[0-9]+g[a-z]*\./.test(component.instanceType);
      const amiRef = isArmInstance ? "data.aws_ami.debian_12_arm64.id" : "data.aws_ami.debian_12_x86.id";
      const ebsType = getAwsEbsType(component.storageType, component.storageGb);

      const ebsBlocks =
        component.storageGb > 0
          ? `

resource "aws_ebs_volume" "${resourceName}_data" {
  count             = ${component.count}
  availability_zone = local.azs[count.index % length(local.azs)]
  size              = ${component.storageGb}
  type              = "${ebsType}"
  encrypted         = true

  tags = {
    Name = "${awsBaseName}-data-\${count.index + 1}"
    App  = "${slugTag}"
    Role = "${safeGcpName(component.role)}"
  }
}

resource "aws_volume_attachment" "${resourceName}_attach" {
  count       = ${component.count}
  device_name = "/dev/sdf"
  volume_id   = aws_ebs_volume.${resourceName}_data[count.index].id
  instance_id = aws_instance.${resourceName}[count.index].id
}`
          : "";

      return `resource "aws_instance" "${resourceName}" {
  count                       = ${component.count}
  ami                         = ${amiRef}
  instance_type               = "${component.instanceType}"
  subnet_id                   = aws_subnet.workload[count.index % length(aws_subnet.workload)].id
  associate_public_ip_address = ${attachPublicIp}

  root_block_device {
    volume_type = "gp3"
    volume_size = 50
    encrypted   = true
  }

  tags = {
    Name = "${awsBaseName}-\${count.index + 1}"
    App  = "${slugTag}"
    Role = "${safeGcpName(component.role)}"
  }
}${ebsBlocks}`;
    })
    .join("\n\n");

  const needsArmAmi = components.some(
    (c) => !isManagedLoadBalancerComponent(c) && !isObjectStorageComponent(c) && /^[a-z]+[0-9]+g[a-z]*\./.test(c.instanceType)
  );
  const armAmiData = needsArmAmi
    ? `

data "aws_ami" "debian_12_arm64" {
  most_recent = true
  owners      = ["136693071363"]

  filter {
    name   = "name"
    values = ["debian-12-arm64-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}`
    : "";

  return `# Compatible with Terraform >= 1.6 and OpenTofu >= 1.6
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = "${region}"
}

data "aws_availability_zones" "available" {
  state = "available"
}

data "aws_ami" "debian_12_x86" {
  most_recent = true
  owners      = ["136693071363"]

  filter {
    name   = "name"
    values = ["debian-12-amd64-*"]
  }

  filter {
    name   = "virtualization-type"
    values = ["hvm"]
  }
}${armAmiData}

locals {
  azs = slice(data.aws_availability_zones.available.names, 0, 3)
}

resource "aws_vpc" "workload" {
  cidr_block           = "10.42.0.0/16"
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = {
    Name = "${slugTag}-vpc"
  }
}

resource "aws_subnet" "workload" {
  count             = 3
  vpc_id            = aws_vpc.workload.id
  cidr_block        = cidrsubnet(aws_vpc.workload.cidr_block, 8, count.index)
  availability_zone = local.azs[count.index]

  tags = {
    Name = "${slugTag}-subnet-\${count.index + 1}"
  }
}

# Generated for ${commentLabel} (${region}) from the current estimate state.
${resources}
`;
}

export function buildAzureTerraformSnippet({ slug, region, components, commentLabel = "Azure" }) {
  const slugClean = safeGcpName(slug).slice(0, 36);
  const storageAccountPrefix = slug.replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 12) || "cloudest";

  const resources = components
    .map((component, index) => {
      const resourceName = safeTerraformName(`${component.role}_${index + 1}`);
      const azureBaseName = safeGcpName(`${slug}-${component.role}-${index + 1}`).slice(0, 42);

      if (isManagedLoadBalancerComponent(component)) {
        return `resource "azurerm_public_ip" "${resourceName}_pip" {
  count               = ${component.count}
  name                = "${azureBaseName}-pip-\${count.index + 1}"
  location            = azurerm_resource_group.workload.location
  resource_group_name = azurerm_resource_group.workload.name
  allocation_method   = "Static"
  sku                 = "Standard"
}

resource "azurerm_lb" "${resourceName}" {
  count               = ${component.count}
  name                = "${azureBaseName}-lb-\${count.index + 1}"
  location            = azurerm_resource_group.workload.location
  resource_group_name = azurerm_resource_group.workload.name
  sku                 = "Standard"

  frontend_ip_configuration {
    name                 = "public-frontend"
    public_ip_address_id = azurerm_public_ip.${resourceName}_pip[count.index].id
  }
}`;
      }

      if (isObjectStorageComponent(component)) {
        const acctSeed = `${storageAccountPrefix}obj${index + 1}`.slice(0, 20);
        return `resource "azurerm_storage_account" "${resourceName}" {
  count                           = ${component.count}
  name                            = "${acctSeed}\${count.index + 1}"
  resource_group_name             = azurerm_resource_group.workload.name
  location                        = azurerm_resource_group.workload.location
  account_tier                    = "Standard"
  account_replication_type        = "LRS"
  allow_nested_items_to_be_public = false

  tags = {
    app          = "${slugClean}"
    role         = "${safeGcpName(component.role)}"
    estimated_gb = "${component.storageGb ?? 0}"
  }
}

resource "azurerm_storage_container" "${resourceName}_blobs" {
  count                 = ${component.count}
  name                  = "${safeGcpName(component.role).slice(0, 40).replace(/-+$/, "")}-blobs"
  storage_account_id    = azurerm_storage_account.${resourceName}[count.index].id
  container_access_type = "private"
}`;
      }

      const isArmVm = /_D[0-9]+p|_E[0-9]+p/i.test(component.instanceType);
      const imageSku = isArmVm ? "12-arm64" : "12-gen2";
      const diskAccountType = getAzureDiskType(component.storageType);

      const dataDiskResources =
        component.storageGb > 0
          ? `

resource "azurerm_managed_disk" "${resourceName}_data" {
  count                = ${component.count}
  name                 = "${azureBaseName}-data-\${count.index + 1}"
  location             = azurerm_resource_group.workload.location
  resource_group_name  = azurerm_resource_group.workload.name
  storage_account_type = "${diskAccountType}"
  create_option        = "Empty"
  disk_size_gb         = ${component.storageGb}
  zone                 = tostring((count.index % 3) + 1)
}

resource "azurerm_virtual_machine_data_disk_attachment" "${resourceName}_attach" {
  count              = ${component.count}
  managed_disk_id    = azurerm_managed_disk.${resourceName}_data[count.index].id
  virtual_machine_id = azurerm_linux_virtual_machine.${resourceName}[count.index].id
  lun                = 0
  caching            = "None"
}`
          : "";

      return `resource "azurerm_network_interface" "${resourceName}_nic" {
  count               = ${component.count}
  name                = "${azureBaseName}-nic-\${count.index + 1}"
  location            = azurerm_resource_group.workload.location
  resource_group_name = azurerm_resource_group.workload.name

  ip_configuration {
    name                          = "internal"
    subnet_id                     = azurerm_subnet.workload.id
    private_ip_address_allocation = "Dynamic"
  }
}

resource "azurerm_linux_virtual_machine" "${resourceName}" {
  count                 = ${component.count}
  name                  = "${azureBaseName}-\${count.index + 1}"
  location              = azurerm_resource_group.workload.location
  resource_group_name   = azurerm_resource_group.workload.name
  size                  = "${component.instanceType}"
  zone                  = tostring((count.index % 3) + 1)
  admin_username        = "azureuser"
  network_interface_ids = [azurerm_network_interface.${resourceName}_nic[count.index].id]

  admin_ssh_key {
    username   = "azureuser"
    public_key = var.ssh_public_key
  }

  os_disk {
    caching              = "ReadWrite"
    storage_account_type = "StandardSSD_LRS"
    disk_size_gb         = 50
  }

  source_image_reference {
    publisher = "Debian"
    offer     = "debian-12"
    sku       = "${imageSku}"
    version   = "latest"
  }

  tags = {
    app  = "${slugClean}"
    role = "${safeGcpName(component.role)}"
  }
}${dataDiskResources}`;
    })
    .join("\n\n");

  return `# Compatible with Terraform >= 1.6 and OpenTofu >= 1.6
terraform {
  required_version = ">= 1.6.0"

  required_providers {
    azurerm = {
      source  = "hashicorp/azurerm"
      version = "~> 4.0"
    }
  }
}

variable "ssh_public_key" {
  description = "SSH public key installed on Linux virtual machines."
  type        = string
  default     = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIG5vplaceholderreplacebeforeapply00000000000 azureuser@example"
}

provider "azurerm" {
  features {}
}

resource "azurerm_resource_group" "workload" {
  name     = "${slugClean}-${region}-rg"
  location = "${region}"
}

resource "azurerm_virtual_network" "workload" {
  name                = "${slugClean}-vnet"
  address_space       = ["10.42.0.0/16"]
  location            = azurerm_resource_group.workload.location
  resource_group_name = azurerm_resource_group.workload.name
}

resource "azurerm_subnet" "workload" {
  name                 = "workload-internal"
  resource_group_name  = azurerm_resource_group.workload.name
  virtual_network_name = azurerm_virtual_network.workload.name
  address_prefixes     = ["10.42.1.0/24"]
}

# Generated for ${commentLabel} (${region}) from the current estimate state.
${resources}
`;
}

export function safeTerraformName(value) {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

export function safeGcpName(value) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

export function getGcpBootDiskType(instanceType = "") {
  if (/^(n4|c4a)-/.test(instanceType)) {
    return "hyperdisk-balanced";
  }

  return "pd-balanced";
}

export function getGcpDataDiskType(instanceType = "", storageType = "ssd") {
  if (/^(n4|c4a)-/.test(instanceType)) {
    return "hyperdisk-balanced";
  }

  return getGcpDiskType(storageType);
}

export function getGcpDiskType(storageType) {
  if (storageType === "ssd") {
    return "pd-ssd";
  }

  if (storageType === "nvme") {
    return "hyperdisk-balanced";
  }

  return "pd-standard";
}

export function getAwsEbsType(storageType, storageGb = 0) {
  if (storageType === "hdd" && storageGb >= 125) {
    return "st1";
  }

  return "gp3";
}

export function getAzureDiskType(storageType) {
  if (storageType === "nvme") {
    return "Premium_LRS";
  }

  if (storageType === "hdd") {
    return "Standard_LRS";
  }

  return "StandardSSD_LRS";
}
