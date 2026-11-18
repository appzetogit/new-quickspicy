import DisbursementReport from "@food/components/admin/reports/DisbursementReport"

/** Payouts made to riders (see DisbursementReport). */
export default function DisbursementReportDeliverymen() {
  return <DisbursementReport entityType="rider" />
}
