/* eslint-disable */
// @ts-nocheck
import { MainLayout } from "@/components/guardian/layout/MainLayout";
import { AttendancePage } from "@/modules/guardian/attendance/AttendancePage";

export const dynamic = "force-dynamic";

export default async function CobrancaPage() {
  return (
    <MainLayout>
      <AttendancePage clients={[]} loadFromC2x />
    </MainLayout>
  );
}
