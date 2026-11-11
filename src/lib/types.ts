import type { CollectionEntry } from "astro:content";
import type { CloudSlug, CommitmentTerm, SizeSlug } from "@/lib/site";

export type IsvEntry = CollectionEntry<"isvs">;
export type IsvData = IsvEntry["data"];

export type EstimateInput = {
  isv: IsvEntry;
  cloud: CloudSlug;
  size: SizeSlug;
  ha: boolean;
  term: CommitmentTerm;
  region: string;
};

export type EstimateComponent = {
  role: string;
  count: number;
  vcpu: number;
  memoryGb: number;
  provisionedVcpu: number;
  provisionedMemoryGb: number;
  gpu: number;
  storageGb: number;
  storageType?: string;
  profile: string;
  instanceType: string;
  unitHourly: number;
  onDemandMonthlyCompute: number;
  monthlyCompute: number;
  monthlyStorage: number;
};

export type ArmAlternative = {
  archFamily: string;
  monthlyTotal: number;
  computeTotal: number;
  savingsMonthlyUsd: number;
  savingsPercent: number;
  instanceTypes: string[];
};

export type EstimateResult = {
  monthlyTotal: number;
  annualTotal: number;
  computeTotal: number;
  onDemandComputeTotal: number;
  storageTotal: number;
  otherTotal: number;
  haAddsComponents: boolean;
  armAlternative: ArmAlternative | null;
  pricingSnapshotDate: string;
  sizeLabel: string;
  sizeDescription: string;
  refArchTier: string;
  components: EstimateComponent[];
  citations: {
    refArchUrl: string;
    refArchVersion: string;
    refArchRetrievedDate: string;
    pricingRetrievedAt: string;
  };
};

export type PricingCache = {
  cloud: CloudSlug;
  retrieved_at: string;
  regions: Record<
    string,
    {
      compute: Record<
        string,
        {
          on_demand_hourly_usd: number;
          reserved_1yr_hourly_usd: number;
          reserved_3yr_hourly_usd: number;
        }
      >;
      storage: {
        ssd_gb_month_usd: number;
        hdd_gb_month_usd: number;
        nvme_gb_month_usd: number;
        object_gb_month_usd: number;
      };
      other: {
        load_balancer_monthly_usd: number;
      };
    }
  >;
};

export type ExplanationCacheEntry = {
  key: string;
  generated_at: string;
  model: string;
  explanation: string;
  prompt_hash?: string;
  source_refs?: string[];
};
