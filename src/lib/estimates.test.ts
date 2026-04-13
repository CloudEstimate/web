import { describe, expect, it } from "vitest";
import { buildEstimate } from "./estimates";
import { buildTerraformSnippet } from "./terraform";

const mockIsv = {
  slug: "fixture-app",
  data: {
    slug: "fixture-app",
    name: "Fixture App",
    vendor: "Fixture Inc.",
    category: "other",
    description: "Fixture workload for sizing tests.",
    ref_arch: {
      source_url: "https://example.com/ref",
      version: "1.0",
      retrieved_date: "2026-04-12"
    },
    sizes: {
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
            memory_gb: 32,
            storage_gb: 500,
            storage_type: "ssd"
          }
        ],
        ha_components: [
          {
            role: "load-balancer",
            count: 1,
            vcpu: 2,
            memory_gb: 8
          }
        ]
      }
    },
    notes: [],
    disclaimers: []
  }
} as any;

describe("buildEstimate", () => {
  it("calculates compute and storage totals for a region and term", () => {
    const estimate = buildEstimate({
      isv: mockIsv,
      cloud: "aws",
      size: "m",
      ha: false,
      term: "on-demand",
      region: "us-east-1"
    });

    expect(estimate.monthlyTotal).toBeGreaterThan(estimate.storageTotal);
    expect(estimate.computeTotal).toBeGreaterThan(0);
    expect(estimate.storageTotal).toBeGreaterThan(0);
    expect(estimate.otherTotal).toBe(0);
    expect(estimate.components).toHaveLength(2);
    expect(estimate.components[0].instanceType).toBe("m6i.xlarge");
  });

  it("adds HA components and load balancer overhead when enabled", () => {
    const estimate = buildEstimate({
      isv: mockIsv,
      cloud: "gcp",
      size: "m",
      ha: true,
      term: "1yr",
      region: "us-central1"
    });

    expect(estimate.otherTotal).toBe(18);
    expect(estimate.components).toHaveLength(3);
    expect(estimate.monthlyTotal).toBeGreaterThan(estimate.computeTotal);
  });
});

describe("buildTerraformSnippet", () => {
  it("returns a Google Cloud Terraform baseline with compute resources", () => {
    const estimate = buildEstimate({
      isv: mockIsv,
      cloud: "gcp",
      size: "m",
      ha: false,
      term: "on-demand",
      region: "us-central1"
    });
    const terraform = buildTerraformSnippet({
      slug: "fixture-app",
      cloud: "gcp",
      region: "us-central1",
      estimate
    });

    expect(terraform).toContain('resource "google_compute_instance"');
    expect(terraform).toContain('resource "google_compute_disk"');
    expect(terraform).toContain('machine_type = "n2-standard-4"');
    expect(terraform).toContain('project = var.project_id');
    expect(terraform).toContain('source = google_compute_disk.application_1_data[count.index].id');
    expect(terraform).toContain('name         = "fixture-app-application-1-${count.index + 1}"');
  });
});
