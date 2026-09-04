import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  UserLocation,
  type MapRef,
} from "@maplibre/maplibre-react-native";
import type { Feature, FeatureCollection, Point } from "geojson";
import { useMemo, useRef } from "react";

import { COLORS, STATUS_COLORS } from "@/constants/colors";
import { DEFAULT_ZOOM, MAP_STYLE_URL } from "@/constants/config";
import type { Coords } from "@/lib/location";
import type { NearbyStation } from "@/types/database";

/** Layer ids, shared between the layer definitions and the tap hit-test. */
const LAYER_STATIONS = "station-points";
const LAYER_CLUSTERS = "station-clusters";

interface StationMapProps {
  stations: NearbyStation[];
  center: Coords;
  showUserLocation: boolean;
  onSelectStation: (stationId: string) => void;
}

/**
 * The map.
 *
 * Stations render as ONE clustered GeoJSON source rather than individual marker
 * components: a few hundred markers tank the frame rate, while a clustered
 * source stays smooth into the thousands. Marker colour is resolved inside a
 * style expression (`match` on the `status` property), so a station changing
 * status never costs a React re-render.
 */
export function StationMap({
  stations,
  center,
  showUserLocation,
  onSelectStation,
}: StationMapProps) {
  const mapRef = useRef<MapRef>(null);

  const collection = useMemo<FeatureCollection<Point>>(
    () => ({
      type: "FeatureCollection",
      features: stations.map(
        (station): Feature<Point> => ({
          type: "Feature",
          id: station.id,
          geometry: {
            type: "Point",
            coordinates: [station.longitude, station.latitude],
          },
          properties: {
            id: station.id,
            name: station.name,
            // `status` is null when there are no recent reports; the style
            // expression's fallback paints those grey.
            status: station.status ?? "unknown",
            confidence: station.confidence,
          },
        }),
      ),
    }),
    [stations],
  );

  /**
   * v11 has no per-source onPress, so hit-testing happens here: query the
   * rendered features at the tapped pixel, restricted to our station layer.
   * Cluster taps carry no station id and are ignored -- the user zooms instead.
   */
  const handlePress = async (event: {
    nativeEvent: { point: [number, number] };
  }): Promise<void> => {
    const features = await mapRef.current?.queryRenderedFeatures(
      event.nativeEvent.point,
      { layers: [LAYER_STATIONS] },
    );

    const stationId = features?.[0]?.properties?.["id"];
    if (typeof stationId === "string") onSelectStation(stationId);
  };

  return (
    <Map
      ref={mapRef}
      style={{ flex: 1 }}
      mapStyle={MAP_STYLE_URL}
      logo={false}
      attributionPosition={{ bottom: 8, right: 8 }}
      onPress={handlePress}
    >
      <Camera
        initialViewState={{
          center: [center.longitude, center.latitude],
          zoom: DEFAULT_ZOOM,
        }}
      />

      {showUserLocation ? <UserLocation animated /> : null}

      <GeoJSONSource
        id="stations"
        data={collection}
        cluster
        clusterRadius={50}
        clusterMaxZoom={14}
      >
        {/* Cluster bubbles: radius steps up with the number of stations. */}
        <Layer
          id={LAYER_CLUSTERS}
          type="circle"
          filter={["has", "point_count"]}
          paint={{
            "circle-color": COLORS.primary,
            "circle-radius": ["step", ["get", "point_count"], 18, 10, 24, 25, 30],
            "circle-stroke-width": 3,
            "circle-stroke-color": "#FFFFFF",
          }}
        />

        <Layer
          id="station-cluster-count"
          type="symbol"
          filter={["has", "point_count"]}
          layout={{
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 14,
            "text-allow-overlap": true,
          }}
          paint={{ "text-color": "#FFFFFF" }}
        />

        {/* Individual stations, coloured by live crowd-sourced status. */}
        <Layer
          id={LAYER_STATIONS}
          type="circle"
          filter={["!", ["has", "point_count"]]}
          paint={{
            "circle-radius": 11,
            "circle-stroke-width": 3,
            "circle-stroke-color": "#FFFFFF",
            "circle-color": [
              "match",
              ["get", "status"],
              "available",
              STATUS_COLORS.available,
              "long_queue",
              STATUS_COLORS.long_queue,
              "not_available",
              STATUS_COLORS.not_available,
              STATUS_COLORS.unknown,
            ],
          }}
        />
      </GeoJSONSource>
    </Map>
  );
}
