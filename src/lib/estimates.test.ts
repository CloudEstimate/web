import { describe, expect, it } from "vitest";
import { buildEstimate, getDefaultSize, getRegionsForCloud } from "./estimates";
import { buildCompareExplanationFallback, buildSizingExplanationFallback } from "./explanations";
import { wrapTitleLines } from "./og";
import { buildTerraformSnippet } from "./terraform";
import { validateExplanation } from "../../functions/lib/validate-explanation.mjs";

const mockIsv = {
  slug: "fixture-app",
  data: {
    slug: "fixture-app",
    name: "Fixture App",
    vendor: "Fixture Inc.",
    category: "other",
    arch_support: ["x86_64", "arm64"],
    description: "Fixture workload for sizing tests.",
    ref_arch: {
      source_url: "https://example.com/ref",
      version: "2.0",
      retrieved_date: "2026-11-11"
    },
    sizes: {
      xs: {
        label: "Extra Small",
        range_description: "up to 250 users",
        ref_arch_tier: "250-users",
        components: [
          {
            role: "cluster-node",
            count: 3,
            vcpu: 2,
            memory_gb: 4,
            storage_gb: 100,
            storage_type: "ssd"
          }
        ],
        ha_components: []
      },
      m: {
        label: "Medium",
        range_description: "500 to 2,000 users",
        ref_arch_tier: "2k-users",
        components: [
          {
            role: "application",
            count: 2,
            vcpu: 4,
            memory_gb: 16,
            storage_gb: 200,
            storage_type: "ssd"
          },
          {
            role: "database",
            count: 1,
            vcpu: 8,
            memory_gb: 64,
            storage_gb: 500,
            storage_type: "nvme"
          },
          {
            role: "object-storage",
            count: 1,
            vcpu: 0,
            memory_gb: 0,
            storage_gb: 1000,
            storage_type: "object"
          }
        ],
        ha_components: [
          {
            role: "load-balancer",
            count: 1,
            vcpu: 0,
            memory_gb: 0
          }
        ]
      }
    },
    notes: [],
    disclaimers: []
  }
} as any;

const mockGpuIsv = {
  slug: "fixture-gpu",
  data: {
    slug: "fixture-gpu",
    name: "Fixture GPU Engine",
    vendor: "Fixture AI",
    category: "ai-infrastructure",
    arch_support: ["x86_64"],
    description: "Fixture GPU inference workload.",
    ref_arch: {
      source_url: "https://example.com/gpu",
      version: "1.0",
      retrieved_date: "2026-11-11"
    },
    sizes: {
      l: {
        label: "Large",
        range_description: "32B model serving",
        ref_arch_tier: "gpu-single",
        components: [
          {
            role: "inference-worker",
            count: 2,
            vcpu: 8,
            memory_gb: 32,
            gpu: 1,
            storage_gb: 300,
            storage_type: "nvme"
          }
        ],
        ha_components: []
      }
    },
    notes: [],
    disclaimers: []
  }
} as any;

describe("getDefaultSize and regional coverage", () => {
  it("prefers Medium ('m') when present even if 'xs' is also defined", () => {
    expect(getDefaultSize(mockIsv)).toBe("m");
    expect(getDefaultSize(mockGpuIsv)).toBe("l");
  });

  it("exposes 4 commercial regions per cloud across North America, Europe, and APAC", () => {
    expect(getRegionsForCloud("gcp")).toEqual([
      "us-central1",
      "us-east1",
      "europe-west1",
      "asia-southeast1"
    ]);
    expect(getRegionsForCloud("aws")).toEqual([
      "us-east-1",
      "us-west-2",
      "eu-west-1",
      "ap-southeast-1"
    ]);
    expect(getRegionsForCloud("azure")).toEqual([
      "eastus",
      "westus3",
      "westeurope",
      "southeastasia"
    ]);
  });
});

describe("buildEstimate", () => {
  it("maps 1:2, 1:4, 1:8, and object-storage roles accurately without double-charging load balancers", () => {
    const awsEstimate = buildEstimate({
      isv: mockIsv,
      cloud: "aws",
      size: "m",
      ha: false,
      term: "on-demand",
      region: "us-east-1"
    });

    expect(awsEstimate.components).toHaveLength(3);
    expect(awsEstimate.components[0].instanceType).toBe("m7i.xlarge");
    expect(awsEstimate.components[1].instanceType).toBe("r7i.2xlarge");
    expect(awsEstimate.components[2].instanceType).toBe("object-bucket");
    expect(awsEstimate.components[2].monthlyCompute).toBe(0);
    expect(awsEstimate.components[2].monthlyStorage).toBeGreaterThan(0);
    expect(awsEstimate.otherTotal).toBe(0);
    expect(awsEstimate.armAlternative).not.toBeNull();
    expect(awsEstimate.armAlternative?.instanceTypes).toContain("m8g.xlarge");
    expect(awsEstimate.armAlternative?.instanceTypes).toContain("r8g.2xlarge");

    const gcpXs = buildEstimate({
      isv: mockIsv,
      cloud: "gcp",
      size: "xs",
      ha: false,
      term: "on-demand",
      region: "us-central1"
    });
    expect(gcpXs.components[0].instanceType).toBe("n4-highcpu-2");
    expect(gcpXs.haAddsComponents).toBe(false);
  });

  it("bills managed load-balancer solely in otherTotal with zero VM compute cost", () => {
    const withoutHa = buildEstimate({
      isv: mockIsv,
      cloud: "gcp",
      size: "m",
      ha: false,
      term: "1yr",
      region: "us-central1"
    });
    const withHa = buildEstimate({
      isv: mockIsv,
      cloud: "gcp",
      size: "m",
      ha: true,
      term: "1yr",
      region: "us-central1"
    });

    expect(withHa.otherTotal).toBe(18);
    expect(withHa.computeTotal).toBe(withoutHa.computeTotal);
    const lbComponent = withHa.components.find((c) => c.role === "load-balancer");
    expect(lbComponent?.instanceType).toBe("managed-lb");
    expect(lbComponent?.monthlyCompute).toBe(0);
  });

  it("maps GPU inference profiles across all three clouds and omits Arm64 on GPU workloads", () => {
    const gcpGpu = buildEstimate({
      isv: mockGpuIsv,
      cloud: "gcp",
      size: "l",
      ha: false,
      term: "on-demand",
      region: "us-central1"
    });
    const awsGpu = buildEstimate({
      isv: mockGpuIsv,
      cloud: "aws",
      size: "l",
      ha: false,
      term: "on-demand",
      region: "ap-southeast-1"
    });
    const azureGpu = buildEstimate({
      isv: mockGpuIsv,
      cloud: "azure",
      size: "l",
      ha: false,
      term: "on-demand",
      region: "westeurope"
    });

    expect(gcpGpu.components[0].instanceType).toBe("g2-standard-8");
    expect(awsGpu.components[0].instanceType).toBe("g4dn.2xlarge");
    expect(azureGpu.components[0].instanceType).toBe("Standard_NC8as_T4_v3");
    expect(gcpGpu.armAlternative).toBeNull();
  });
});

describe("validateExplanation and deterministic fallbacks", () => {
  it("counts sentences accurately around SKU dots, version numbers, and decimals", () => {
    const valid =
      "Provisioning 3x m7i.2xlarge nodes on AWS us-east-1 fits Jira 10.x up to 5,000 users. Compute dominates monthly spend at $1,240.50 across the application cluster. Enabling high availability adds a managed load balancer and standby replica.";
    expect(validateExplanation(valid)).toEqual({ ok: true });

    const forbidden =
      "Provisioning 3x m7i.2xlarge nodes on AWS us-east-1 fits Jira 10.x up to 5,000 users. This powerful setup costs $1,240.50 per month. High availability adds a standby database node.";
    expect(validateExplanation(forbidden).ok).toBe(false);
  });

  it("produces compliant fallback explanations with exact commitment math and baseline quorum awareness", () => {
    const quorumEstimate = buildEstimate({
      isv: mockIsv,
      cloud: "gcp",
      size: "xs",
      ha: true,
      term: "3yr",
      region: "us-central1"
    });

    const singleFallback = buildSizingExplanationFallback({
      isv: mockIsv,
      cloud: "gcp",
      size: "xs",
      region: "us-central1",
      term: "3yr",
      ha: true,
      estimate: quorumEstimate
    });

    expect(singleFallback).toContain("already provisions multi-node quorum");
    expect(singleFallback).toContain("3yr commitment pricing cuts compute spend");
    expect(validateExplanation(singleFallback)).toEqual({ ok: true });

    const compareFallback = buildCompareExplanationFallback({
      isv: mockIsv,
      size: "m",
      sizeLabel: "Medium",
      rangeDescription: "500 to 2,000 users",
      term: "on-demand",
      ha: false,
      estimates: {
        gcp: buildEstimate({ isv: mockIsv, cloud: "gcp", size: "m", ha: false, term: "on-demand", region: "us-central1" }),
        aws: buildEstimate({ isv: mockIsv, cloud: "aws", size: "m", ha: false, term: "on-demand", region: "us-east-1" }),
        azure: buildEstimate({ isv: mockIsv, cloud: "azure", size: "m", ha: false, term: "on-demand", region: "eastus" })
      }
    });
    expect(validateExplanation(compareFallback)).toEqual({ ok: true });
  });
});

describe("buildTerraformSnippet across Google Cloud, AWS, and Azure", () => {
  it("generates Hyperdisk-backed Google Cloud HCL, native GCS buckets, and private database NICs", () => {
    const estimate = buildEstimate({
      isv: mockIsv,
      cloud: "gcp",
      size: "m",
      ha: true,
      term: "on-demand",
      region: "us-central1"
    });
    const terraform = buildTerraformSnippet({
      slug: "fixture-app",
      cloud: "gcp",
      region: "us-central1",
      estimate
    });

    expect(terraform).toContain('machine_type = "n4-standard-4"');
    expect(terraform).toContain('type  = "hyperdisk-balanced"');
    expect(terraform).toContain('resource "google_storage_bucket"');
    expect(terraform).toContain('resource "google_compute_address"');
    expect(terraform).toContain("local.zones[count.index % length(local.zones)]");
  });

  it("generates AWS HCL with VPC subnets, EC2, EBS gp3, S3 bucket, and NLB", () => {
    const estimate = buildEstimate({
      isv: mockIsv,
      cloud: "aws",
      size: "m",
      ha: true,
      term: "on-demand",
      region: "us-east-1"
    });
    const terraform = buildTerraformSnippet({
      slug: "fixture-app",
      cloud: "aws",
      region: "us-east-1",
      estimate
    });

    expect(terraform).toContain('source  = "hashicorp/aws"');
    expect(terraform).toContain('instance_type               = "m7i.xlarge"');
    expect(terraform).toContain('associate_public_ip_address = false');
    expect(terraform).toContain('resource "aws_s3_bucket"');
    expect(terraform).toContain('resource "aws_lb"');
  });

  it("generates Azure HCL with Resource Group, VNet, Linux VMs, Managed Disks, Blob container, and Standard LB", () => {
    const estimate = buildEstimate({
      isv: mockIsv,
      cloud: "azure",
      size: "m",
      ha: true,
      term: "on-demand",
      region: "eastus"
    });
    const terraform = buildTerraformSnippet({
      slug: "fixture-app",
      cloud: "azure",
      region: "eastus",
      estimate
    });

    expect(terraform).toContain('source  = "hashicorp/azurerm"');
    expect(terraform).toContain('size                  = "Standard_D4s_v6"');
    expect(terraform).toContain('storage_account_type = "Premium_LRS"');
    expect(terraform).toContain('resource "azurerm_storage_account"');
    expect(terraform).toContain('resource "azurerm_lb"');
  });
});

describe("wrapTitleLines for OG cards", () => {
  it("wraps long ISV titles onto two balanced lines", () => {
    expect(wrapTitleLines("Valkey")).toEqual(["Valkey"]);
    const wrapped = wrapTitleLines("Apache Kafka via Confluent Platform");
    expect(wrapped).toHaveLength(2);
    expect(wrapped[0].length).toBeLessThanOrEqual(28);
  });
});
