import DisbursementReport from "@food/components/admin/reports/DisbursementReport"

/** Payouts made to restaurants (see DisbursementReport). */
export default function DisbursementReportRestaurants() {
  return <DisbursementReport entityType="restaurant" />
}
