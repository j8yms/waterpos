import RoleGuard from "@/components/RoleGuard";
import Staff from "@/components/Staff";

export default function StaffPage() {
  return (
    <RoleGuard role="management">
      <Staff />
    </RoleGuard>
  );
}