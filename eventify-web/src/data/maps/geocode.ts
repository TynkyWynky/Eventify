export type GeocodeResult = { lat: number; lng: number; displayName: string };

export async function geocodeAddress(query: string, signal?: AbortSignal): Promise<GeocodeResult> {
  const url =
    `https://nominatim.openstreetmap.org/search?` +
    new URLSearchParams({
      q: query,
      format: "json",
      limit: "1",
      addressdetails: "0",
    }).toString();

  const res = await fetch(url, {
    signal,
    headers: {
      // Nominatim vraagt best een duidelijke UA; browser zet dit beperkt,
      // maar deze header helpt soms toch.
      "Accept": "application/json",
    },
  });

  if (!res.ok) throw new Error("Geocoding failed.");
  const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;

  if (!data.length) throw new Error("Address not found.");

  return {
    lat: Number(data[0].lat),
    lng: Number(data[0].lon),
    displayName: data[0].display_name,
  };
}
