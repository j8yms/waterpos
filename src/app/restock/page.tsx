import RoleGuard from "@/components/RoleGuard";
import Restock from "@/components/Restock";

export default function RestockPage() {
  return (
    <RoleGuard role="management">
      <Restock />
    </RoleGuard>
  );
}