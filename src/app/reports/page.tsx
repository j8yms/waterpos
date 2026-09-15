import RoleGuard from "@/components/RoleGuard";
import Reports from "@/components/Reports";

export default function ReportsPage() {
  return (
    <RoleGuard role="management">
      <Reports />
    </RoleGuard>
  );
}