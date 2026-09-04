import { Text, View } from "react-native";

import { colorForStatus, statusLabel, timeAgo } from "@/lib/confidence";
import type { StationReport } from "@/types/database";

interface ReportTimelineProps {
  reports: StationReport[];
  isLoading: boolean;
}

/**
 * Recent driver reports for one station.
 *
 * Deliberately shows no reporter identity -- the `station_reports` RPC does not
 * return one, and reports are meant to be anonymous.
 */
export function ReportTimeline({ reports, isLoading }: ReportTimelineProps) {
  if (isLoading) {
    return (
      <Text className="font-sans text-caption text-muted">Loading recent reports…</Text>
    );
  }

  if (reports.length === 0) {
    return (
      <View className="rounded-xl bg-slate-50 p-4">
        <Text className="font-medium text-caption text-ink">No reports yet</Text>
        <Text className="mt-1 font-sans text-label text-muted">
          Be the first to tell other drivers what it is like here.
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-3">
      {reports.map((report, index) => {
        const color = colorForStatus(report.status);
        const isLast = index === reports.length - 1;

        return (
          <View key={report.id} className="flex-row">
            {/* Dot-and-line rail */}
            <View className="w-6 items-center">
              <View
                className="mt-1 h-3 w-3 rounded-full"
                style={{ backgroundColor: color }}
              />
              {!isLast ? <View className="mt-1 w-0.5 flex-1 bg-slate-200" /> : null}
            </View>

            <View className="flex-1 pb-1">
              <View className="flex-row items-center">
                <Text className="font-medium text-caption" style={{ color }}>
                  {statusLabel(report.status)}
                </Text>
                <Text className="ml-2 font-sans text-label text-muted">
                  · {timeAgo(report.created_at)}
                </Text>
              </View>

              {report.note ? (
                <Text className="mt-1 font-sans text-label text-muted">
                  “{report.note}”
                </Text>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}
