export function buildGcpTerraformSnippet({ slug, region, components, commentLabel = "Google Cloud" }) {
  const resources = components
    .map((component, index) => {
      const resourceName = safeTerraformName(`${component.role}_${index + 1}`);
      const instanceName = safeGcpName(`${slug}-${component.role}-${index + 1}`);
      const diskResource =
        component.storageGb > 0
          ? `
resource "google_compute_disk" "${resourceName}_data" {
  count = ${component.count}
  name  = "${instanceName}-data-\${count.index + 1}"
  type  = "${getGcpDiskType(component.storageType)}"
  zone  = "${region}-a"
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

      return `${diskResource}resource "google_compute_instance" "${resourceName}" {
  count        = ${component.count}
  name         = "${instanceName}-\${count.index + 1}"
  machine_type = "${component.instanceType}"
  zone         = "${region}-a"

  boot_disk {
    initialize_params {
      image = "projects/debian-cloud/global/images/family/debian-12"
      size  = 50
      type  = "pd-balanced"
    }
  }

  network_interface {
    network = "default"
    access_config {}
  }${diskAttachment}

  labels = {
    app  = "${safeGcpName(slug)}"
    role = "${safeGcpName(component.role)}"
  }
}`;
    })
    .join("\n\n");

  return `terraform {
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
  zone    = "${region}-a"
}

# Generated for ${commentLabel} from the current estimate state.
${resources}
`;
}

export function safeTerraformName(value) {
  return value.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "").toLowerCase();
}

export function safeGcpName(value) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
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
