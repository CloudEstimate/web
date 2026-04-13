export function buildSinglePrompt({ isv, size, cloudName, region, ha, term, estimate }) {
  const componentLines = estimate.components
    .map(
      (component) =>
        `- ${component.count}x ${component.instanceType} (${component.vcpu} vCPU, ${component.memoryGb} GB RAM${component.storageGb ? `, ${component.storageGb} GB ${component.storageType}` : ""})`
    )
    .join("\n");

  return `Generate an explanation for this sizing recommendation.

ISV: ${isv.name}
Reference architecture: ${isv.ref_arch.version}, tier "${size.ref_arch_tier}"
Size tier: ${size.label} (${size.range_description})
Cloud: ${cloudName}
Region: ${region}
High availability: ${ha ? "enabled" : "disabled"}
Commitment term: ${term}

Components provisioned:
${componentLines}

Monthly cost breakdown:
- Compute: $${estimate.computeTotal.toFixed(2)}
- Storage: $${estimate.storageTotal.toFixed(2)}
- Other: $${estimate.otherTotal.toFixed(2)}
- Total: $${estimate.monthlyTotal.toFixed(2)}

Write a 3-4 sentence explanation covering:
1. What this sizing fits
2. The dominant cost driver at this tier
3. One concrete tradeoff or consideration at this scale`;
}

export function buildComparePrompt({ isv, size, ha, term, estimates }) {
  return `Generate a comparison explanation for this sizing across three clouds.

ISV: ${isv.name}
Size tier: ${size.label} (${size.range_description})
High availability: ${ha ? "enabled" : "disabled"}
Commitment term: ${term}

Costs per cloud (monthly):
- Google Cloud (${estimates.gcp.region}): $${estimates.gcp.estimate.monthlyTotal.toFixed(2)}
- AWS (${estimates.aws.region}): $${estimates.aws.estimate.monthlyTotal.toFixed(2)}
- Azure (${estimates.azure.region}): $${estimates.azure.estimate.monthlyTotal.toFixed(2)}

Relevant pricing mechanics:
- Google Cloud: sustained use and committed use differ by machine family and region.
- AWS: reserved pricing is modeled as no-upfront reserved rates for Linux shared tenancy.
- Azure: reservation pricing is modeled from retail reservation terms without hybrid benefit.

Write a 3-4 sentence explanation covering:
1. Which cloud is cheapest at this configuration and by roughly how much
2. What pricing mechanic drives the difference
3. One consideration that could shift the calculus`;
}

export const sharedSystemPrompt = `You are a cloud infrastructure sizing expert writing concise explanations for
a reference tool. Your audience is platform engineers and SREs who need to
understand why a specific sizing recommendation was made.

Rules:
- Output exactly 3 to 4 sentences. No bullet points, no headers, no lists.
- Ground every claim in the reference architecture data provided. Do not
  speculate about scenarios not covered by the data.
- Name the primary cost drivers at this tier.
- Be specific with numbers when they illuminate a tradeoff. Round cleanly.
- Do not use hedging language: avoid "might", "could", "approximately",
  "generally". State what the data says.
- Do not use marketing language: avoid "powerful", "seamless", "robust",
  "optimal".
- Do not mention that you are an AI or that this is a generated explanation.
- Do not repeat the input numbers verbatim; synthesize insight from them.`;
