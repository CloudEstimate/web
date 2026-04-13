import { defineCollection, z } from "astro:content";

const componentSchema = z.object({
  role: z.string(),
  count: z.number().int().min(1),
  vcpu: z.number().int().min(1),
  memory_gb: z.number().min(0.5),
  storage_gb: z.number().int().min(0).optional(),
  storage_type: z.enum(["ssd", "hdd", "nvme", "object"]).optional()
});

const sizeSchema = z.object({
  label: z.string(),
  range_description: z.string(),
  ref_arch_tier: z.string(),
  components: z.array(componentSchema).min(1),
  ha_components: z.array(componentSchema).optional().default([])
});

const isvs = defineCollection({
  type: "data",
  schema: z.object({
    slug: z.string().regex(/^[a-z0-9-]+$/),
    name: z.string(),
    vendor: z.string(),
    category: z.enum([
      "devops-platform",
      "data-store",
      "search",
      "streaming",
      "artifact-repo",
      "identity",
      "other"
    ]),
    description: z.string().max(280),
    ref_arch: z.object({
      source_url: z.string().url(),
      version: z.string(),
      retrieved_date: z.string()
    }),
    sizes: z.object({
      xs: sizeSchema.optional(),
      s: sizeSchema.optional(),
      m: sizeSchema.optional(),
      l: sizeSchema.optional(),
      xl: sizeSchema.optional()
    }).refine((value) => Object.values(value).some(Boolean), {
      message: "At least one size tier is required."
    }),
    notes: z.array(z.string()).optional().default([]),
    disclaimers: z.array(z.string()).optional().default([])
  })
});

export const collections = { isvs };
