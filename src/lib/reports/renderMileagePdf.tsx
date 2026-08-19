import { Document, Page, Text, View, StyleSheet, renderToBuffer } from "@react-pdf/renderer";
import type { MileageReportData } from "./mileageReport";

const styles = StyleSheet.create({
  page: { padding: 32, fontSize: 10, fontFamily: "Helvetica" },
  title: { fontSize: 18, fontWeight: 700, marginBottom: 4 },
  subtitle: { fontSize: 11, color: "#444", marginBottom: 2 },
  total: { fontSize: 12, fontWeight: 700, marginTop: 8, marginBottom: 16 },
  sectionTitle: { fontSize: 13, fontWeight: 700, marginTop: 12, marginBottom: 6 },
  table: { display: "flex", flexDirection: "column", borderWidth: 1, borderColor: "#ccc" },
  row: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#ccc" },
  rowLast: { flexDirection: "row" },
  headerCell: { flex: 1, padding: 6, fontWeight: 700, backgroundColor: "#f2f2f2" },
  cell: { flex: 1, padding: 6 },
});

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <View style={styles.table}>
      <View style={styles.row}>
        {headers.map((h) => (
          <Text key={h} style={styles.headerCell}>
            {h}
          </Text>
        ))}
      </View>
      {rows.map((row, i) => (
        <View key={i} style={i === rows.length - 1 ? styles.rowLast : styles.row}>
          {row.map((cell, j) => (
            <Text key={j} style={styles.cell}>
              {cell}
            </Text>
          ))}
        </View>
      ))}
    </View>
  );
}

function MileageReportDocument({ data, regionLabel }: { data: MileageReportData; regionLabel?: string }) {
  const { period, totalMiles, outboundMiles, returnMiles, byRM, bySchool } = data;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.title}>Mileage Report</Text>
        <Text style={styles.subtitle}>
          {period.label} ({period.startDate.toISOString().slice(0, 10)} to{" "}
          {period.endDate.toISOString().slice(0, 10)})
        </Text>
        {regionLabel && <Text style={styles.subtitle}>Region: {regionLabel}</Text>}
        <Text style={styles.total}>Total miles driven: {totalMiles.toFixed(1)}</Text>
        <Text style={styles.subtitle}>
          {outboundMiles.toFixed(1)} to schools + {returnMiles.toFixed(1)} returning home
        </Text>

        <Text style={styles.sectionTitle}>By Regional Manager</Text>
        <Table
          headers={["Regional Manager", "Visits", "Total Miles"]}
          rows={
            byRM.length > 0
              ? byRM.map((r) => [r.userName, String(r.visitCount), r.totalMiles.toFixed(1)])
              : [["—", "—", "—"]]
          }
        />

        <Text style={styles.sectionTitle}>By School</Text>
        <Table
          headers={["School", "Region", "Visits", "Total Miles"]}
          rows={
            bySchool.length > 0
              ? bySchool.map((s) => [s.schoolName, s.regionName ?? "—", String(s.visitCount), s.totalMiles.toFixed(1)])
              : [["—", "—", "—", "—"]]
          }
        />
      </Page>
    </Document>
  );
}

export async function renderMileagePdf(data: MileageReportData, regionLabel?: string): Promise<Buffer> {
  return renderToBuffer(<MileageReportDocument data={data} regionLabel={regionLabel} />);
}
