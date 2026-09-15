import RoleGuard from "@/components/RoleGuard";
import SalesFloor from "@/components/pos/SalesFloor";

export default function PosPage() {
  return (
    <RoleGuard role="management">
      <SalesFloor />
    </RoleGuard>
  );
}