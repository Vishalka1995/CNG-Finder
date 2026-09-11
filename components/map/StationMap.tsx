import {
  Camera,
  GeoJSONSource,
  Images,
  Layer,
  Map,
  UserLocation,
  type CameraRef,
  type PressEventWithFeatures,
} from "@maplibre/maplibre-react-native";
import type { Feature, FeatureCollection, Point } from "geojson";
import { useMemo, useRef } from "react";
import type { NativeSyntheticEvent } from "react-native";

import { STATUS_COLORS } from "@/constants/colors";
import { DEFAULT_ZOOM, MAP_STYLE_URL } from "@/constants/config";
import type { Coords } from "@/lib/location";
import type { NearbyStation } from "@/types/database";

const LAYER_STATIONS = "station-points";
const LAYER_GLYPH = "station-glyph";

/**
 * Marker sizing, tuned to match Google Maps' place pins. The previous marker
 * drew the pump silhouette itself at ~45px tall, which dominated the map; a
 * ~22px disc reads as a map pin rather than an illustration.
 */
const MARKER_RADIUS = 11;

/**
 * Glyph scale. The source image is 128px, so this renders it at ~13px --
 * sized to sit inside the disc above with a little breathing room.
 */
const GLYPH_SIZE = 0.1;

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
}

/**
 * The map.
 *
 * Every station gets its own pin -- no clustering into number bubbles -- with
 * a fuel-pump icon and its name labelled underneath, matching how Google Maps
 * shows a "nearest CNG station" search. Icon and label are one GeoJSON source
 * rendered as a single `symbol` layer, so 97+ stations is still one native
 * draw call rather than that many React-managed marker views.
 *
 * The icon is a single SDF (signed-distance-field) asset: a white silhouette
 * on transparent background, tinted per-feature via `icon-color` in the paint
 * expression below -- the same mechanism `circle-color` used before, so a
 * station's marker recolours when its status changes without any React
 * re-render.
 */
export function StationMap({
  stations,
  center,
  showUserLocation,
  onSelectStation,
}: StationMapProps) {
  const cameraRef = useRef<CameraRef>(null);

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
   * GeoJSONSource's own onPress fires with the tapped feature already attached
   * (`event.nativeEvent.features`), so no separate pixel-query round trip is
   * needed. Flies the camera to the tapped station before opening its info
   * card, so the tapped pin becomes visually prominent.
   */
  const handleSourcePress = (event: NativeSyntheticEvent<PressEventWithFeatures>): void => {
    const feature = event.nativeEvent.features[0];
    if (!feature || feature.geometry.type !== "Point") return;

    const stationId = feature.properties?.["id"];
    if (typeof stationId !== "string") return;

    cameraRef.current?.flyTo({
      center: feature.geometry.coordinates as [number, number],
      zoom: STATION_TAP_ZOOM,
      duration: 500,
    });
    onSelectStation(stationId);
  };

  return (
    <Map
      style={{ flex: 1 }}
      mapStyle={MAP_STYLE_URL}
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

      {showUserLocation ? <UserLocation animated /> : null}

      <Images images={{ "fuel-pin": { source: require("@/assets/map/fuel-icon.png"), sdf: true } }} />

      <GeoJSONSource id="stations" data={collection} onPress={handleSourcePress}>
        {/* Google Maps-style marker: a small status-coloured disc with a white
            glyph on top. Two layers rather than one tinted silhouette, because
            a single SDF image can only be one colour -- the white-glyph-on-
            colour look needs the colour to come from a shape underneath. */}
        <Layer
          id={LAYER_STATIONS}
          type="circle"
          paint={{
            "circle-radius": MARKER_RADIUS,
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
            "circle-stroke-width": 2,
            "circle-stroke-color": "#FFFFFF",
          }}
        />

        <Layer
          id={LAYER_GLYPH}
          type="symbol"
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
            "text-color": "#0F172A",
            "text-halo-color": "#FFFFFF",
            "text-halo-width": 1.2,
          }}
        />
      </GeoJSONSource>
    </Map>
  );
}
