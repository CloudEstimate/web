import { renderOgPng } from "@/lib/og";

export function GET() {
  return new Response(
    new Uint8Array(renderOgPng({
      title: "CloudEstimate",
      subtitle: "Sizing self-managed workloads across Google Cloud, AWS, and Azure",
      costLabel: "Reference estimates",
      accent: "#575d8d"
    })),
    {
      headers: {
        "Content-Type": "image/png"
      }
    }
  );
}
