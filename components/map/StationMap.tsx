import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map,
  UserLocation,
  type CameraRef,
  type GeoJSONSourceRef,
  type PressEventWithFeatures,
} from "@maplibre/maplibre-react-native";
import type { Feature, FeatureCollection, Point } from "geojson";
import { useMemo, useRef } from "react";
import type { NativeSyntheticEvent } from "react-native";

import { MAP_PIN_COLOR } from "@/constants/colors";
import { DEFAULT_ZOOM, MAP_STYLES, type MapStyleId } from "@/constants/config";
import type { Coords } from "@/lib/location";
import type { NearbyStation } from "@/types/database";

const LAYER_STATIONS = "station-points";
const LAYER_GLYPH = "station-glyph";
const LAYER_GROUPS = "station-groups";
const LAYER_GROUP_GLYPH = "station-group-glyph";

/**
 * Marker sizing, tuned to match Google Maps' place pins -- a ~22px disc reads
 * as a map pin rather than an illustration.
 */
const MARKER_RADIUS = 11;

/**
 * Grouped pins are drawn a touch larger. They carry no count badge (that read
 * as clutter), so this slight size difference is the only hint that tapping
 * will reveal more than one station.
 */
const GROUP_RADIUS = 14;

/** Glyph scale. The source image is 128px, so this renders it at ~13px. */
const GLYPH_SIZE = 0.1;
const GROUP_GLYPH_SIZE = 0.12;

/** Below this zoom, pins close together collapse into one. */
const GROUP_MAX_ZOOM = 13;

/** Pixel radius within which pins are grouped. */
const GROUP_RADIUS_PX = 44;

/**
 * Street-level zoom flown to when a station is tapped. Above DEFAULT_ZOOM
 * (12), so tapping a station always zooms in further.
 */
const STATION_TAP_ZOOM = 16;

interface StationMapProps {
  stations: NearbyStation[];
  center: Coords;
  showUserLocation: boolean;
  onSelectStation: (stationId: string) => void;
  mapStyle?: MapStyleId;
}

/**
 * The map.
 *
 * Pins are a single fixed red rather than status-coloured -- see MAP_PIN_COLOR
 * for why. Status is surfaced wherever a station is named instead: the nearby
 * sheet, the list, and the detail screen.
 *
 * Stations sitting close together collapse into one pin at low zoom and split
 * apart as you zoom in, so a cluster of nearby stations does not render as a
 * pile of overlapping discs. Grouped pins carry no count badge.
 */
export function StationMap({
  stations,
  center,
  showUserLocation,
  onSelectStation,
  mapStyle = "streets",
}: StationMapProps) {
  const cameraRef = useRef<CameraRef>(null);
  const sourceRef = useRef<GeoJSONSourceRef>(null);

  const isSatellite = mapStyle === "satellite";

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
            status: station.status ?? "unknown",
          },
        }),
      ),
    }),
    [stations],
  );

  /**
   * GeoJSONSource's own onPress delivers the tapped feature already attached.
   *
   * A tapped feature is either a station (has `id`) or a group (has
   * `cluster_id`). Tapping a station flies to it and opens its info; tapping a
   * group zooms to exactly the level that splits it apart, which supercluster
   * computes for us -- it does not do this on its own.
   */
  const handleSourcePress = async (
    event: NativeSyntheticEvent<PressEventWithFeatures>,
  ): Promise<void> => {
    const feature = event.nativeEvent.features[0];
    if (!feature || feature.geometry.type !== "Point") return;

    const coordinates = feature.geometry.coordinates as [number, number];

    const stationId = feature.properties?.["id"];
    if (typeof stationId === "string") {
      cameraRef.current?.flyTo({
        center: coordinates,
        zoom: STATION_TAP_ZOOM,
        duration: 500,
      });
      onSelectStation(stationId);
      return;
    }

    const clusterId = feature.properties?.["cluster_id"];
    if (typeof clusterId !== "number") return;

    const zoom = await sourceRef.current?.getClusterExpansionZoom(clusterId);
    if (zoom === undefined) return;

    cameraRef.current?.flyTo({ center: coordinates, zoom, duration: 500 });
  };

  return (
    <Map
      style={{ flex: 1 }}
      mapStyle={MAP_STYLES[mapStyle]}
      logo={false}
      attributionPosition={{ bottom: 8, right: 8 }}
    >
      <Camera
        ref={cameraRef}
        initialViewState={{
          center: [center.longitude, center.latitude],
          zoom: DEFAULT_ZOOM,
        }}
      />

      {showUserLocation ? <UserLocation animated accuracy /> : null}

      <Images images={{ "fuel-pin": { source: require("@/assets/map/fuel-icon.png"), sdf: true } }} />

      <GeoJSONSource
        ref={sourceRef}
        id="stations"
        data={collection}
        cluster
        clusterRadius={GROUP_RADIUS_PX}
        clusterMaxZoom={GROUP_MAX_ZOOM}
        onPress={handleSourcePress}
      >
        {/* Grouped pins: same red disc and glyph as a single station, just
            slightly larger. Deliberately no count badge. */}
        <Layer
          id={LAYER_GROUPS}
          type="circle"
          filter={["has", "point_count"]}
          paint={{
            "circle-radius": GROUP_RADIUS,
            "circle-color": MAP_PIN_COLOR,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#FFFFFF",
          }}
        />

        <Layer
          id={LAYER_GROUP_GLYPH}
          type="symbol"
          filter={["has", "point_count"]}
          layout={{
            "icon-image": "fuel-pin",
            "icon-size": GROUP_GLYPH_SIZE,
            "icon-allow-overlap": true,
          }}
          paint={{ "icon-color": "#FFFFFF" }}
        />

        {/* Individual stations. Two layers because a single SDF image can only
            be one colour; white-glyph-on-red needs the red to come from a
            shape beneath it. */}
        <Layer
          id={LAYER_STATIONS}
          type="circle"
          filter={["!", ["has", "point_count"]]}
          paint={{
            "circle-radius": MARKER_RADIUS,
            "circle-color": MAP_PIN_COLOR,
            "circle-stroke-width": 2,
            "circle-stroke-color": "#FFFFFF",
          }}
        />

        <Layer
          id={LAYER_GLYPH}
          type="symbol"
          filter={["!", ["has", "point_count"]]}
          layout={{
            "icon-image": "fuel-pin",
            "icon-size": GLYPH_SIZE,
            "icon-allow-overlap": true,
            // Labels sit below the disc; `optional` lets a colliding label
            // drop without taking its marker with it.
            "text-field": ["get", "name"],
            "text-size": 11,
            "text-offset": [0, 1.1],
            "text-anchor": "top",
            "text-allow-overlap": false,
            "text-optional": true,
            "text-max-width": 8,
          }}
          paint={{
            "icon-color": "#FFFFFF",
            // Inverted over satellite: dark text on a white halo is right for
            // the light street basemap, but unreadable against imagery.
            "text-color": isSatellite ? "#FFFFFF" : "#0F172A",
            "text-halo-color": isSatellite ? "#000000" : "#FFFFFF",
            "text-halo-width": isSatellite ? 1.6 : 1.2,
          }}
        />
      </GeoJSONSource>
    </Map>
  );
}
