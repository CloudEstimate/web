function formatComponentLine(component) {
  if (component.instanceType === "managed-lb") {
    return `- ${component.count}x managed cloud load balancer (${component.role})`;
  }

  if (component.instanceType === "object-bucket") {
    return `- ${component.count}x cloud object storage bucket (${component.role}, ${component.storageGb} GB object storage)`;
  }

  const vcpu = component.provisionedVcpu ?? component.vcpu;
  const memoryGb = component.provisionedMemoryGb ?? component.memoryGb;
  const gpuPart = component.gpu ? `, ${component.gpu} GPU` : "";
  const storagePart = component.storageGb ? `, ${component.storageGb} GB ${component.storageType}` : "";

  return `- ${component.count}x ${component.instanceType} for ${component.role} (${vcpu} vCPU, ${memoryGb} GB RAM${gpuPart}${storagePart})`;
}

export function buildSinglePrompt({ isv, size, cloudName, region, ha, term, estimate }) {
  const componentLines = estimate.components.map(formatComponentLine).join("\n");
  const haStatus = !estimate.haAddsComponents
    ? "quorum/replication already included in baseline topology"
    : ha
      ? "enabled"
      : "disabled";

  return `Generate an explanation for this sizing recommendation.

ISV: ${isv.name}
Reference architecture: ${isv.ref_arch.version}, tier "${size.ref_arch_tier}"
Size tier: ${size.label} (${size.range_description})
Cloud: ${cloudName}
Region: ${region}
High availability: ${haStatus}
Commitment term: ${term}

Components provisioned:
${componentLines}

Monthly cost breakdown:
- Compute: $${estimate.computeTotal.toFixed(2)}
- Storage: $${estimate.storageTotal.toFixed(2)}
- Other: $${estimate.otherTotal.toFixed(2)}
- Total: $${estimate.monthlyTotal.toFixed(2)}

Write a 3-4 sentence explanation (240 to 520 characters total) covering:
1. What workload scale this sizing fits
2. Which component or resource line item drives monthly cost at this tier
3. One concrete architectural tradeoff or operational consideration at this scale`;
}

export function buildComparePrompt({ isv, size, ha, term, estimates }) {
  return `Generate a comparison explanation for this sizing across three clouds.

ISV: ${isv.name}
Size tier: ${size.label} (${size.range_description})
High availability: ${ha ? "enabled" : "disabled"}
Commitment term: ${term}

Costs per cloud (monthly):
- Google Cloud (${estimates.gcp.region}): $${estimates.gcp.estimate.monthlyTotal.toFixed(2)} (Compute $${estimates.gcp.estimate.computeTotal.toFixed(2)}, Storage $${estimates.gcp.estimate.storageTotal.toFixed(2)})
- AWS (${estimates.aws.region}): $${estimates.aws.estimate.monthlyTotal.toFixed(2)} (Compute $${estimates.aws.estimate.computeTotal.toFixed(2)}, Storage $${estimates.aws.estimate.storageTotal.toFixed(2)})
- Azure (${estimates.azure.region}): $${estimates.azure.estimate.monthlyTotal.toFixed(2)} (Compute $${estimates.azure.estimate.computeTotal.toFixed(2)}, Storage $${estimates.azure.estimate.storageTotal.toFixed(2)})

Relevant pricing mechanics:
- Google Cloud: N4, C4A, and G2 use resource-based 1-year and 3-year Committed Use Discounts without sustained-use discounts, plus Hyperdisk/PD and Standard Storage rates.
- AWS: 1-year and 3-year terms reflect No-Upfront Linux Reserved rates on 7th/8th-gen EC2 instances plus gp3/io2/st1/S3 storage.
- Azure: 1-year and 3-year terms reflect retail Linux VM Reservations on v6 instances without Azure Hybrid Benefit, plus Managed Disk and Blob rates.

Write a 3-4 sentence explanation (240 to 520 characters total) covering:
1. Which cloud is lowest-cost at this configuration and the monthly dollar spread
2. Whether compute instance pricing or storage pricing drives the spread
3. One concrete architectural or procurement factor that shifts the decision`;
}

export const sharedSystemPrompt = `You are a cloud infrastructure sizing specialist writing concise reference explanations for platform engineers and SREs.

Rules:
- Output strictly 3 or 4 sentences of plain prose (between 240 and 520 characters total). No bullet points, no headers, no markdown lists.
- Ground every claim and every dollar figure in the provided sizing and cost data. Never invent prices outside the input breakdown.
- Name the primary cost driver at this tier (specific VM family, GPU tier, or storage tier).
- Always say "Google Cloud", never "GCP".
- Never use hedging words: "might", "could", "approximately", "generally".
- Never use marketing words: "powerful", "seamless", "robust", "optimal", "innovative", "revolutionary", "smart", "delightful".
- Do not mention that you are an AI or that this text was generated.`;
