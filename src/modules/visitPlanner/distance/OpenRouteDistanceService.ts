import type {
  IDistanceService,
  LatLng,
  DistanceMatrixResult,
} from "./types";

const ORS_MATRIX_URL = "https://api.openrouteservice.org/v2/matrix/driving-car";

/**
 * OpenRouteService implementation of IDistanceService.
 * Requires OPENROUTE_SERVICE_API_KEY in env.
 */
export class OpenRouteDistanceService implements IDistanceService {
  private apiKey: string;

  constructor(apiKey?: string) {
    this.apiKey = apiKey ?? process.env.OPENROUTE_SERVICE_API_KEY ?? "";
    if (!this.apiKey) {
      throw new Error("OPENROUTE_SERVICE_API_KEY is required for OpenRouteDistanceService");
    }
  }

  async getDistanceMatrix(
    origins: LatLng[],
    destinations: LatLng[]
  ): Promise<DistanceMatrixResult> {
    const locations = [...origins, ...destinations].map((p) => [p.lng, p.lat] as [number, number]);
    const srcIndices = origins.map((_, i) => i);
    const destIndices = destinations.map((_, i) => origins.length + i);

    const res = await fetch(ORS_MATRIX_URL, {
      method: "POST",
      headers: {
        Authorization: this.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locations,
        sources: srcIndices,
        destinations: destIndices,
        metrics: ["duration", "distance"],
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouteService matrix failed: ${res.status} ${text}`);
    }

    const data = (await res.json()) as {
      durations?: number[][];
      distances?: number[][];
    };

    return {
      durations: data.durations ?? [],
      distances: data.distances ?? [],
    };
  }
}
