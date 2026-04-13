import isvCatalog from "../generated/isv-catalog.json" with { type: "json" };
import shapeMappings from "../generated/shape-mappings.json" with { type: "json" };

export function getIsvCatalog() {
  return isvCatalog;
}

export function getShapeMappings() {
  return shapeMappings;
}
