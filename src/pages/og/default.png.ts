import { renderOgPng } from "@/lib/og";

export function GET() {
  return new Response(
    new Uint8Array(renderOgPng({
      title: "CloudEstimate",
      subtitle: "Precomputed AI worked example for cloud sizing",
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
