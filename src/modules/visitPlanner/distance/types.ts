export interface LatLng {
  lat: number;
  lng: number;
}

export interface DistanceMatrixResult {
  /** Duration in seconds from origin i to destination j */
  durations: number[][];
  /** Distance in meters from origin i to destination j */
  distances: number[][];
}

export interface IDistanceService {
  getDistanceMatrix(
    origins: LatLng[],
    destinations: LatLng[]
  ): Promise<DistanceMatrixResult>;
}
